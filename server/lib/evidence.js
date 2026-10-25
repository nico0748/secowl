import fs from 'node:fs'
import path from 'node:path'
import { dataRoot } from './config.js'
import { engDir } from './store.js'

const ALLOWED = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }
const MAX_BYTES = 12 * 1024 * 1024

export function evidenceDir(eid) {
  const dir = path.join(engDir(eid), 'evidence')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeName(name) {
  return String(name || 'evidence')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.\.+/g, '.')
    .slice(0, 80)
}

export function listEvidence(eid) {
  const dir = evidenceDir(eid)
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name))
    .map((e) => {
      const st = fs.statSync(path.join(dir, e.name))
      return { name: e.name, rel: path.posix.join(eid, 'evidence', e.name), bytes: st.size, mtime: st.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

/** data URL を受け取り、診断対象の evidence/ へ保存します。name が既存なら上書きします。 */
export function saveEvidence(eid, { name, dataUrl, overwrite = false }) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ''))
  if (!m) throw new Error('画像データを読めませんでした')
  const ext = ALLOWED[m[1]]
  if (!ext) throw new Error('png / jpeg / webp のみ保存できます')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > MAX_BYTES) throw new Error(`画像が大きすぎます（上限 ${MAX_BYTES / 1024 / 1024} MB）`)

  const dir = evidenceDir(eid)
  let base = safeName(name).replace(/\.(png|jpe?g|webp)$/i, '')
  let file = path.join(dir, base + ext)
  if (!overwrite) {
    let n = 1
    while (fs.existsSync(file)) file = path.join(dir, `${base}-${String(++n).padStart(2, '0')}${ext}`)
  }
  fs.writeFileSync(file, buf)
  const rel = path.posix.join(eid, 'evidence', path.basename(file))
  return { name: path.basename(file), rel, bytes: buf.length }
}

export function deleteEvidence(eid, name) {
  const file = path.join(evidenceDir(eid), safeName(name))
  if (!file.startsWith(evidenceDir(eid) + path.sep)) throw new Error('証跡フォルダの外は操作できません')
  if (!fs.existsSync(file)) throw new Error('その証跡は見つかりません')
  fs.unlinkSync(file)
  return { deleted: path.basename(file) }
}

/** 証跡ファイルを読み、data URL として返します。共有バンドルの埋め込みにも使います。 */
export function readEvidenceDataUrl(relPath) {
  const root = dataRoot()
  const abs = path.resolve(root, relPath)
  if (!abs.startsWith(root + path.sep)) throw new Error('データフォルダの外は開けません')
  if (!/\.(png|jpe?g|webp)$/i.test(abs) || !fs.existsSync(abs)) return null
  const ext = path.extname(abs).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`
}

export function evidenceMime(file) {
  const ext = path.extname(file).toLowerCase()
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
}
