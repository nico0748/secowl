/**
 * 診断対象 1 件を ZIP に書き出し、別の PC で取り込みます（チームメイトとの受け渡し用）。
 *
 * ZIP の中身は次のとおりです。
 *
 *   secowl-export.json         目録（形式・版・診断対象・ファイルごとの大きさと SHA-256）
 *   <診断対象 ID>/...           診断対象フォルダの中身をそのまま
 *
 * 書き出さないもの:
 * - `.secowl/`：採番の予約（ids/）、コマンド実行の生の出力（run/。Cookie やトークンを伏せていない）、
 *   実行の監査記録（audit.jsonl。その PC での記録で、プログラムの絶対パスやホームのパスを含む）
 * - `.git/`、シンボリックリンク、`.DS_Store` などの OS のメタデータ
 *
 * 取り込みは、受け取った ZIP を信用せずに確かめてから展開します。
 * - SecOwl の目録がない ZIP、目録にないファイルを含む ZIP、大きさか SHA-256 が目録と合わない ZIP は拒否します
 * - パスは 1 段ずつ確かめ、絶対パス・`..`・バックスラッシュ・制御文字・`.secowl/` と `.git/` を拒否します
 *   （zip slip 対策）。macOS の大文字と小文字を区別しないファイルシステムで重なる名前も拒否します
 * - 件数・1 ファイル・合計の大きさに上限を設けます（zip bomb 対策）。目録の大きさで先に弾き、展開後も照合します
 * - 既存の診断対象は上書きしません。同じ ID があるときは、別の ID を指定してもらいます
 * - 保存先の下の隠しフォルダに書き出してから、最後に 1 回の rename で診断対象フォルダにします。
 *   途中で失敗しても、中途半端な診断対象は残りません
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { dataRoot, APP_ROOT } from './config.js'
import { engDir, getEngagement, secowlDir, toPosix, DIRS } from './store.js'
import { today } from './md.js'

export const MANIFEST = 'secowl-export.json'
export const FORMAT = 'secowl-engagement'
export const FORMAT_VERSION = 1

export const LIMITS = {
  /** 受け取る ZIP そのものの大きさ */
  zipBytes: 512 * 1024 * 1024,
  /** 展開後の合計 */
  totalBytes: 1024 * 1024 * 1024,
  /** 1 ファイルあたり */
  fileBytes: 256 * 1024 * 1024,
  entries: 20000,
}

/** 書き出さない名前（どの階層でも）。 */
const SKIP_NAMES = new Set(['.git', '.secowl', '.DS_Store', 'Thumbs.db', 'desktop.ini'])
/** 取り込みで拒否する先頭の名前。 */
const RESERVED_TOP = new Set(['.git', '.secowl'])
/** 圧縮してもほとんど縮まないため、そのまま格納する拡張子。 */
const STORED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.gz', '.pdf', '.docx', '.mp4', '.mov'])

export class TransferError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

function appVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version || '' } catch { return '' }
}

/** 診断対象フォルダの中で、書き出すファイルを相対パス（/ 区切り）で集めます。シンボリックリンクはたどりません。 */
function collect(base) {
  const out = []
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_NAMES.has(e.name)) continue
      const abs = path.join(dir, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) walk(abs, r)
      else if (e.isFile()) out.push({ rel: r, abs })
    }
  }
  walk(base, '')
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/** ファイル名に使える日付つきの名前（SecOwl-<ID>-<日付>.zip）。 */
export function exportFilename(eid) {
  return `SecOwl-${eid}-${today()}.zip`
}

/**
 * 診断対象を ZIP にします。
 * @param {string} eid
 * @param {{ includeEvidence?: boolean }} [opts] includeEvidence: 証跡（evidence/）を含める（既定は含める）
 * @returns {{ filename: string, buffer: Buffer, manifest: object }}
 */
export function exportEngagement(eid, { includeEvidence = true } = {}) {
  const meta = getEngagement(eid)
  if (!meta) throw new TransferError(404, 'NO_ENGAGEMENT', '診断対象が見つかりません')
  const base = engDir(eid)
  const files = collect(base).filter((f) => includeEvidence || !f.rel.startsWith('evidence/'))

  const entries = {}
  const list = []
  for (const f of files) {
    const data = fs.readFileSync(f.abs)
    const level = STORED_EXTS.has(path.extname(f.rel).toLowerCase()) ? 0 : 6
    entries[`${eid}/${f.rel}`] = [data, { level }]
    list.push({ path: f.rel, bytes: data.length, sha256: sha256(data) })
  }
  const manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    app_version: appVersion(),
    exported_at: new Date().toISOString(),
    engagement: { id: eid, name: meta.name || eid, client: meta.client || '', period_from: meta.period_from || '', period_to: meta.period_to || '' },
    include_evidence: includeEvidence,
    files: list,
  }
  entries[MANIFEST] = [strToU8(JSON.stringify(manifest, null, 2) + '\n'), { level: 6 }]
  const buffer = Buffer.from(zipSync(entries))
  return { filename: exportFilename(eid), buffer, manifest }
}

/* ---------------- 取り込み ---------------- */

// 制御文字（C0・DEL・C1）
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** ZIP の中の相対パスを確かめます。正しくなければ理由を返します。 */
export function pathProblem(rel) {
  const s = String(rel)
  if (!s) return '空のパス'
  if (s.includes('\\')) return 'バックスラッシュを含むパス'
  if (CONTROL.test(s)) return '制御文字を含むパス'
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) return '絶対パス'
  const segs = s.split('/')
  for (const seg of segs) {
    if (seg === '' || seg === '.' || seg === '..') return '「.」「..」や空の区切りを含むパス'
    if (Buffer.byteLength(seg, 'utf8') > 255) return '長すぎる名前'
  }
  if (RESERVED_TOP.has(segs[0])) return `${segs[0]}/ の中のファイル`
  if (segs.some((seg) => seg === '.git')) return '.git/ の中のファイル'
  return null
}

/** 診断対象 ID として使える名前かを確かめます（engDir と同じ規則に、隠しフォルダの禁止を足します）。 */
export function checkEngagementId(id) {
  const name = String(id ?? '')
  if (!name || name.startsWith('.') || CONTROL.test(name)) throw new TransferError(400, 'BAD_ID', `診断対象 ID が正しくありません: ${name}`)
  try { engDir(name) } catch (e) { throw new TransferError(400, 'BAD_ID', e.message) }
  return name
}

/** macOS と Windows の既定のファイルシステムで同じ場所を指す名前を、同じキーにします。 */
const foldKey = (p) => p.normalize('NFC').toLowerCase()

/**
 * ZIP を読み、目録と中身を確かめます。書き込みはしません。
 * @param {Buffer|Uint8Array} buf
 * @returns {{ manifest: object, id: string, files: Map<string, Uint8Array>, bytes: number }}
 */
export function readExport(buf) {
  if (!buf || !buf.length) throw new TransferError(400, 'EMPTY', 'ZIP ファイルが空です')
  if (buf.length > LIMITS.zipBytes) throw new TransferError(413, 'TOO_LARGE', 'ZIP ファイルが大きすぎます')
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)

  // 先に目録だけを取り出します。
  let manifest
  try {
    const m = unzipSync(u8, { filter: (f) => f.name === MANIFEST && f.originalSize <= 16 * 1024 * 1024 })
    if (!m[MANIFEST]) throw new TransferError(400, 'NO_MANIFEST', 'SecOwl で書き出した ZIP ではありません（secowl-export.json がありません）')
    manifest = JSON.parse(strFromU8(m[MANIFEST]))
  } catch (e) {
    if (e instanceof TransferError) throw e
    throw new TransferError(400, 'BAD_ZIP', `ZIP を読めませんでした: ${e.message}`)
  }
  if (manifest?.format !== FORMAT) throw new TransferError(400, 'NO_MANIFEST', 'SecOwl で書き出した ZIP ではありません')
  if (manifest.version !== FORMAT_VERSION) {
    throw new TransferError(400, 'VERSION', `この ZIP の形式（${manifest.version}）には対応していません。SecOwl を更新してください`)
  }
  const id = checkEngagementId(manifest.engagement?.id)
  if (!Array.isArray(manifest.files)) throw new TransferError(400, 'BAD_MANIFEST', '目録の files が正しくありません')
  if (manifest.files.length > LIMITS.entries) throw new TransferError(413, 'TOO_MANY', 'ファイルの数が多すぎます')

  const expected = new Map()
  const seen = new Set()
  let total = 0
  for (const f of manifest.files) {
    const rel = String(f?.path ?? '')
    const problem = pathProblem(rel)
    if (problem) throw new TransferError(400, 'BAD_PATH', `取り込めないパスがあります（${problem}）: ${rel}`)
    const key = foldKey(rel)
    if (seen.has(key)) throw new TransferError(400, 'BAD_PATH', `同じ場所を指すパスが重なっています: ${rel}`)
    seen.add(key)
    const bytes = Number(f.bytes)
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TransferError(400, 'BAD_MANIFEST', `目録の大きさが正しくありません: ${rel}`)
    if (bytes > LIMITS.fileBytes) throw new TransferError(413, 'TOO_LARGE', `大きすぎるファイルがあります: ${rel}`)
    total += bytes
    if (total > LIMITS.totalBytes) throw new TransferError(413, 'TOO_LARGE', '展開後の合計が大きすぎます')
    if (!/^[0-9a-f]{64}$/.test(String(f.sha256))) throw new TransferError(400, 'BAD_MANIFEST', `目録のハッシュが正しくありません: ${rel}`)
    expected.set(`${id}/${rel}`, { rel, bytes, sha256: f.sha256 })
  }
  if (!expected.has(`${id}/engagement.json`)) throw new TransferError(400, 'BAD_MANIFEST', 'engagement.json が含まれていません')

  // 中身を取り出します。目録にない名前と、目録より大きいと申告されたものは展開しません。
  const unknown = []
  let raw
  try {
    raw = unzipSync(u8, {
      filter: (f) => {
        if (f.name === MANIFEST || f.name.endsWith('/')) return false
        const exp = expected.get(f.name)
        if (!exp || f.originalSize !== exp.bytes) { unknown.push(f.name); return false }
        return true
      },
    })
  } catch (e) {
    throw new TransferError(400, 'BAD_ZIP', `ZIP を読めませんでした: ${e.message}`)
  }
  if (unknown.length) {
    throw new TransferError(400, 'MISMATCH', `目録にない、または大きさが目録と合わないファイルがあります: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? ` ほか ${unknown.length - 3} 件` : ''}`)
  }

  const files = new Map()
  for (const [name, exp] of expected) {
    const data = raw[name]
    if (!data) throw new TransferError(400, 'MISMATCH', `目録にあるファイルが ZIP にありません: ${exp.rel}`)
    if (data.length !== exp.bytes || sha256(data) !== exp.sha256) {
      throw new TransferError(400, 'MISMATCH', `中身が目録と合いません（壊れているか、書き換えられています）: ${exp.rel}`)
    }
    files.set(exp.rel, data)
  }

  let meta
  try { meta = JSON.parse(strFromU8(files.get('engagement.json'))) } catch { meta = null }
  if (!meta || typeof meta !== 'object') throw new TransferError(400, 'BAD_ENGAGEMENT', 'engagement.json を読めませんでした')

  return { manifest, id, meta, files, bytes: total }
}

/** 同じ ID がすでにあるときに使う、空いている ID を返します（<ID>-2、<ID>-3 …）。 */
function freeId(id) {
  if (!fs.existsSync(engDir(id))) return id
  for (let n = 2; n < 1000; n++) {
    const cand = `${id}-${n}`
    if (!fs.existsSync(engDir(cand))) return cand
  }
  return `${id}-${crypto.randomBytes(3).toString('hex')}`
}

const countIn = (files, dir, prefix) =>
  [...files.keys()].filter((r) => r.startsWith(`${dir}/`) && path.posix.basename(r).startsWith(prefix) && r.endsWith('.md')).length

/** 取り込む前の確認用に、ZIP の中身をまとめます。 */
export function previewImport(buf) {
  const { manifest, id, meta, files, bytes } = readExport(buf)
  const exists = fs.existsSync(engDir(id))
  return {
    id,
    name: meta.name || manifest.engagement?.name || id,
    client: meta.client || '',
    period_from: meta.period_from || '',
    period_to: meta.period_to || '',
    exported_at: manifest.exported_at || '',
    app_version: manifest.app_version || '',
    files: files.size,
    bytes,
    findings: countIn(files, DIRS.triage, 'fnd-'),
    surfaces: countIn(files, DIRS.recon, 'srf-'),
    evidence: [...files.keys()].filter((r) => r.startsWith('evidence/')).length,
    exists,
    suggestedId: exists ? freeId(id) : id,
  }
}

/**
 * ZIP を新しい診断対象として展開します。既存の診断対象は上書きしません。
 * @param {Buffer|Uint8Array} buf
 * @param {{ id?: string }} [opts] id: 取り込み先の ID（省略すると ZIP の ID）
 */
export function importEngagement(buf, { id: wanted } = {}) {
  const { id: original, meta, files, bytes } = readExport(buf)
  const id = checkEngagementId(wanted || original)
  const root = dataRoot()
  fs.mkdirSync(root, { recursive: true })
  const target = engDir(id)
  if (fs.existsSync(target)) {
    throw new TransferError(409, 'EXISTS', `同じ ID の診断対象がすでにあります: ${id}。別の ID を指定して取り込んでください`)
  }

  const staging = fs.mkdtempSync(path.join(root, '.secowl-import-'))
  try {
    for (const [rel, data] of files) {
      const dest = path.join(staging, ...rel.split('/'))
      // pathProblem で確かめ済みですが、念のため展開先の外に出ないことを確かめます。
      if (!dest.startsWith(staging + path.sep)) throw new TransferError(400, 'BAD_PATH', `取り込めないパスがあります: ${rel}`)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, data, { flag: 'wx' })
    }
    if (id !== original) {
      fs.writeFileSync(path.join(staging, 'engagement.json'), JSON.stringify({ ...meta, id }, null, 2) + '\n', 'utf8')
    }
    if (fs.existsSync(target)) throw new TransferError(409, 'EXISTS', `同じ ID の診断対象がすでにあります: ${id}`)
    fs.renameSync(staging, target)
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw e
  }
  secowlDir(id)
  return { id, name: meta.name || id, files: files.size, bytes, renamed: id !== original, from: original, path: toPosix(target) }
}
