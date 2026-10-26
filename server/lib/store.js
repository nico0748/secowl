import fs from 'node:fs'
import path from 'node:path'
import { dataRoot, TEMPLATE_DIR } from './config.js'
import { syncFindingBody, isFindingDoc, syncScopeBody, approvalComplete } from '../../shared/finding-table.js'
import { normalizeScope, inPeriod } from '../../shared/scope.js'
import { fence } from '../../shared/redact.js'
import {
  readMd, writeMd, patchFrontmatter, parseSections, stringifySections, replaceSection,
  parseChecklist, setChecklistItem, today, nowStamp, slug, fillTemplate, listMd,
  sectionVersion, StaleWriteError, parseMd, stringifyMd, writeFileAtomic,
} from './md.js'
import { normalizeSeverity, resolveSeverity, severityLabelJa, SEVERITIES, parseSeverity, isValidScore, effectiveSeveritySource } from './severity.js'

const DIRS = {
  scope: '00-診断対象',
  // 旧バージョンが作ったフォルダ名。読み出しだけ互換を保ちます。
  legacyScope: '00-案件',
  recon: '10-偵察',
  survey: '20-調査',
  logs: path.join('20-調査', 'logs'),
  triage: '30-トリアージ',
  report: '40-報告',
}

export const SURFACE_KINDS = {
  subdomain: 'サブドメイン',
  host: 'ホスト',
  port: 'ポート',
  endpoint: 'エンドポイント',
  service: 'サービス',
}

export const PHASES = {
  recon: '偵察・列挙',
  survey: '脆弱性調査',
  triage: 'トリアージ',
  report: '報告',
}

function tpl(name) {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8')
}

/**
 * 診断対象のフォルダ。id はフォルダ名 1 つだけを受け付け、保存先の外を指す値（.. や区切り文字）は拒否します。
 */
export function engDir(id) {
  const name = String(id ?? '')
  if (!/^[^\\/]+$/.test(name) || name === '.' || name === '..' || name.includes('\0')) {
    throw new Error(`診断対象 ID が正しくありません: ${name}`)
  }
  const root = dataRoot()
  const dir = path.resolve(root, name)
  if (path.dirname(dir) !== root) throw new Error(`診断対象 ID が正しくありません: ${name}`)
  return dir
}

/** OS の区切り文字を / にそろえます。API と MCP が返すパスは常に / 区切りです。 */
export function toPosix(p) {
  return String(p).split(path.sep).join('/')
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** フォルダにある `<prefix>-NNNN-*.md` の番号の最大値。 */
function scanMaxId(dir, prefix) {
  let max = 0
  for (const f of listMd(dir)) {
    const m = new RegExp(`^${prefix}-(\\d+)`).exec(path.basename(f))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

// <eid>/.secowl/ は作業用の隠しフォルダです（Obsidian には出ません）。
// ids/ は採番の予約、run/ はコマンド実行の作業場所で、どちらも Git では追跡しません。
const SECOWL_IGNORE_RULES = ['ids/', 'run/']
const SECOWL_GITIGNORE = `# SecOwl の作業用ファイル。採番の予約（ids/）と実行の作業場所（run/）は追跡しません。
# audit.jsonl（実行の記録）は追跡します。
${SECOWL_IGNORE_RULES.join('\n')}
`

/** <eid>/.secowl/ を用意し、.gitignore がなければ作り、足りない行（以前のバージョンで作ったものには run/ が無い）は足します。 */
export function secowlDir(eid) {
  const dir = ensure(path.join(engDir(eid), '.secowl'))
  const gi = path.join(dir, '.gitignore')
  if (!fs.existsSync(gi)) {
    try { fs.writeFileSync(gi, SECOWL_GITIGNORE, { encoding: 'utf8', flag: 'wx' }) } catch (e) { if (e.code !== 'EEXIST') throw e }
  } else {
    try {
      const cur = fs.readFileSync(gi, 'utf8')
      const have = cur.split(/\r?\n/).map((l) => l.trim())
      const missing = SECOWL_IGNORE_RULES.filter((r) => !have.includes(r))
      if (missing.length) fs.appendFileSync(gi, `${cur === '' || cur.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`, 'utf8')
    } catch { /* 読めないときはそのままにします */ }
  }
  return dir
}

function idDir(eid) {
  return ensure(path.join(secowlDir(eid), 'ids'))
}

/**
 * 番号を 1 つ予約します。<eid>/.secowl/ids/<prefix>-NNNN を O_EXCL（wx）で作れた番号だけを使うので、
 * アプリのサーバと MCP のように別のプロセスが同時に採番しても、同じ番号は出ません。
 * scanMax には既存の Markdown の最大番号を渡します（予約の記録がない既存データでも重複しないように）。
 * 予約の記録は消さないため、番号は単調に増えます（書き込みの前に落ちたときは欠番になります）。
 */
export function reserveSeq(eid, prefix, scanMax = 0) {
  const dir = idDir(eid)
  let max = Number(scanMax) || 0
  for (const name of fs.readdirSync(dir)) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  let n = max + 1
  for (;;) {
    const id = `${prefix}-${String(n).padStart(4, '0')}`
    try {
      fs.closeSync(fs.openSync(path.join(dir, id), 'wx'))
      return { id, n }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      n++
    }
  }
}

/** テンプレートを埋め、frontmatter に patch を足した文字列を作ります（書き込みは呼び出し側で 1 回だけ）。 */
function renderTemplate(name, vars, patch = null, transform = null) {
  const text = fillTemplate(tpl(name), vars)
  if (!patch && !transform) return text
  const { data, body } = parseMd(text)
  const next = patch ? { ...data, ...patch, updated: today() } : data
  return stringifyMd(next, transform ? transform(body, next) : body)
}

/** 新しいファイルを 1 回で書きます。同じ名前のファイルがあれば上書きせずにエラーにします。 */
function writeNew(file, text) {
  if (fs.existsSync(file)) throw new Error(`同じ名前のファイルがすでにあります: ${path.basename(file)}`)
  writeFileAtomic(file, text)
}

function findById(dir, id) {
  return listMd(dir).find((f) => path.basename(f).startsWith(id + '-')) || null
}

/* ---------------- 診断対象 ---------------- */

export function listEngagements() {
  const root = dataRoot()
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => {
      const metaPath = path.join(root, e.name, 'engagement.json')
      let meta = {}
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch { meta = {} }
      }
      return { id: e.name, name: meta.name || e.name, client: meta.client || '', target_system: meta.target_system || '', period_from: meta.period_from || '', period_to: meta.period_to || '', created: meta.created || '' }
    })
    .sort((a, b) => (b.created || '').localeCompare(a.created || '') || a.id.localeCompare(b.id))
}

export function createEngagement({ name, client = '', target_system = '', period_from = '', period_to = '' }) {
  const id = slug(name)
  const base = engDir(id)
  if (fs.existsSync(base)) throw new Error(`同じ名前の診断対象がすでにあります: ${id}`)
  for (const [k, d] of Object.entries(DIRS)) {
    if (k === 'legacyScope') continue
    ensure(path.join(base, d))
  }
  const meta = { id, name, client, target_system, period_from, period_to, created: today() }
  fs.writeFileSync(path.join(base, 'engagement.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')

  const vars = { title: name, engagement: id, client, target_system, period_from, period_to, today: today() }
  secowlDir(id)
  fs.writeFileSync(path.join(base, DIRS.scope, 'スコープとRoE.md'), fillTemplate(tpl('00-スコープとRoE.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.scope, '進め方.md'), fillTemplate(tpl('01-進め方.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.recon, '攻撃面マップ.md'), fillTemplate(tpl('11-攻撃面マップ.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.survey, 'チェックリスト.md'), fillTemplate(tpl('20-調査チェックリスト.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.survey, '未検出記録.md'), fillTemplate(tpl('22-未検出記録.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.report, '診断報告書.md'), fillTemplate(tpl('40-診断報告書.md'), vars), 'utf8')
  // テンプレートが古い場合に備えて、スコープ文書と報告書の写しを engagement.json にそろえます。
  updateEngagement(id, {})
  return meta
}

export function getEngagement(id) {
  const metaPath = path.join(engDir(id), 'engagement.json')
  if (!fs.existsSync(metaPath)) return null
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
}

const ENGAGEMENT_KEYS = ['name', 'client', 'target_system', 'period_from', 'period_to']
// スコープ文書と報告書の frontmatter に写しとして持つキー。正は engagement.json です。
const SYNCED_KEYS = ['client', 'target_system', 'period_from', 'period_to']

/**
 * 診断対象の情報（engagement.json）を更新し、スコープ文書と報告書の frontmatter にある写しを同期します。
 * 既知のキーだけを上書きし、未知のキーは残します。id とフォルダ名は変えません。
 */
export function updateEngagement(eid, patch = {}) {
  const metaPath = path.join(engDir(eid), 'engagement.json')
  if (!fs.existsSync(metaPath)) throw new Error(`診断対象が見つかりません: ${eid}`)
  const current = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  const next = { ...current }
  for (const k of ENGAGEMENT_KEYS) {
    if (patch[k] === undefined || patch[k] === null) continue
    next[k] = String(patch[k]).trim()
  }
  if (!next.name) throw new Error('診断対象名を入力してください')
  next.id = current.id || eid
  fs.writeFileSync(metaPath, JSON.stringify(next, null, 2) + '\n', 'utf8')

  const synced = []
  const paths = docPaths(eid)
  for (const rel of [paths.scope, paths.report]) {
    const abs = path.join(dataRoot(), rel)
    if (!fs.existsSync(abs)) continue
    patchFrontmatter(abs, Object.fromEntries(SYNCED_KEYS.map((k) => [k, next[k] ?? ''])))
    synced.push(rel)
  }
  return { ...next, synced }
}

/* ---------------- サーフェス（偵察・列挙） ---------------- */

export function listSurfaces(eid) {
  const dir = path.join(engDir(eid), DIRS.recon)
  return listMd(dir).map((f) => {
    const { data } = readMd(f)
    return {
      id: data.id || path.basename(f).split('-').slice(0, 2).join('-'),
      file: toPosix(path.relative(dataRoot(), f)),
      title: data.title || '',
      kind: data.kind || 'endpoint',
      kind_label: SURFACE_KINDS[data.kind] || data.kind || '',
      value: data.value || '',
      host: data.host || '',
      port: data.port === '' || data.port === undefined ? null : Number(data.port),
      protocol: data.protocol || '',
      service: data.service || '',
      product: data.product || '',
      tech: Array.isArray(data.tech) ? data.tech : [],
      status: data.status || '未調査',
      in_scope: data.in_scope !== false,
      discovered_by: Array.isArray(data.discovered_by) ? data.discovered_by : [],
      discovered_at: data.discovered_at || '',
      updated: data.updated || '',
    }
  })
}

export function createSurface(eid, input) {
  const dir = ensure(path.join(engDir(eid), DIRS.recon))
  const { id } = reserveSeq(eid, 'srf', scanMaxId(dir, 'srf'))
  const kind = input.kind || 'endpoint'
  const value = input.value || ''
  const title = input.title || (kind === 'port' ? `${input.host || ''}:${input.port || ''}` : value) || id
  const vars = {
    id, title, engagement: eid, kind, kind_label: SURFACE_KINDS[kind] || kind,
    value, host: input.host || '', port: input.port ?? '', protocol: input.protocol || 'tcp',
    service: input.service || '', product: input.product || '', today: today(),
  }
  const file = path.join(dir, `${id}-${slug(title)}.md`)
  const patch = {}
  if (input.discovered_by?.length || input.tech?.length || input.status) {
    Object.assign(patch, {
      discovered_by: input.discovered_by || [],
      tech: input.tech || [],
      status: input.status || '未調査',
    })
  }
  // テンプレートは port を文字列で書くため、数値として読めるときだけ数値で上書きします。
  const portNum = input.port === '' || input.port === null || input.port === undefined ? NaN : Number(input.port)
  if (Number.isFinite(portNum)) patch.port = portNum
  writeNew(file, renderTemplate('10-サーフェス.md', vars, Object.keys(patch).length ? patch : null))
  return { id, file: toPosix(path.relative(dataRoot(), file)) }
}

/* ---------------- 発見事項個票（トリアージ） ---------------- */

export function listFindings(eid) {
  const dir = path.join(engDir(eid), DIRS.triage)
  return listMd(dir).map((f) => {
    const { data } = readMd(f)
    const sev = normalizeSeverity(data.severity)
    return {
      id: data.id || path.basename(f).split('-').slice(0, 2).join('-'),
      file: toPosix(path.relative(dataRoot(), f)),
      finding_no: data.finding_no || '',
      title: data.title || data.vuln_name || '',
      vuln_name: data.vuln_name || '',
      identifier: data.identifier || '',
      severity: sev,
      severity_label: severityLabelJa(sev),
      severity_source: effectiveSeveritySource(data),
      cvss_vector: data.cvss_vector || '',
      cvss_score: data.cvss_score === '' || data.cvss_score === undefined ? null : Number(data.cvss_score),
      wstg_id: data.wstg_id || '',
      target: data.target || '',
      surfaces: Array.isArray(data.surfaces) ? data.surfaces : [],
      tools: Array.isArray(data.tools) ? data.tools : [],
      status: data.status || 'draft',
      retest_result: data.retest_result || '',
      updated: data.updated || '',
    }
  })
}

export function createFinding(eid, input) {
  validateSeverityInput(input)
  const dir = ensure(path.join(engDir(eid), DIRS.triage))
  const { id } = reserveSeq(eid, 'fnd', scanMaxId(dir, 'fnd'))
  const no = String(reserveSeq(eid, 'fno', maxFindingNo(eid)).n)
  const score = input.cvss_score
  const { severity, severity_source } = resolveSeverity({ current: {}, sent: input.severity, score })
  const vuln_name = input.vuln_name || '名称未設定'
  const vars = {
    id, title: vuln_name, engagement: eid, finding_no: no, vuln_name,
    severity, severity_label: severityLabelJa(severity),
    target: input.target || '', cvss_vector: input.cvss_vector || '', cvss_score: score ?? '',
    today: today(),
  }
  const file = path.join(dir, `${id}-${slug(vuln_name)}.md`)
  // テンプレートの展開・欄の追加・基本情報表の同期をメモリ上で済ませ、ファイルは 1 回だけ書きます
  // （途中で落ちても半端な個票を残さないため）。
  writeNew(file, renderTemplate('30-発見事項個票.md', vars, {
    surfaces: input.surfaces || [],
    tools: input.tools || [],
    identifier: input.identifier || '',
    wstg_id: input.wstg_id || '',
    cvss_score: score ?? '',
    cvss_vector: input.cvss_vector || '',
    severity_source,
    status: input.status || 'draft',
  }, (body, data) => syncFindingBody(body, data)))
  return { id, file: toPosix(path.relative(dataRoot(), file)) }
}

/** 既存ファイルの finding_no の最大値。通し番号はこの次から予約します。既存の番号は振り直しません。 */
function maxFindingNo(eid) {
  let max = 0
  for (const f of listFindings(eid)) {
    const n = Number(f.finding_no)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/* ---------------- ツール実行ログ ---------------- */

export function listToolLogs(eid) {
  const dir = path.join(engDir(eid), DIRS.logs)
  return listMd(dir).map((f) => {
    const { data } = readMd(f)
    return {
      id: data.id || path.basename(f).split('-').slice(0, 2).join('-'),
      file: toPosix(path.relative(dataRoot(), f)),
      title: data.title || '',
      tool: data.tool || '不明',
      phase: data.phase || 'survey',
      phase_label: PHASES[data.phase] || data.phase || '',
      command: data.command || '',
      surfaces: Array.isArray(data.surfaces) ? data.surfaces : [],
      findings: Array.isArray(data.findings) ? data.findings : [],
      executed_at: data.executed_at || '',
      updated: data.updated || '',
    }
  })
}

/** Markdown の表の 1 マスに入れる値。| は列の区切り、[[ は Obsidian のウィキリンクと解釈されるため、URL として同じ意味の表記に直す。 */
function tableCell(v) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '%7C').replace(/`/g, '%60').replace(/\[\[/g, '[%5B')
}

export function createToolLog(eid, input) {
  const dir = ensure(path.join(engDir(eid), DIRS.logs))
  const { id } = reserveSeq(eid, 'log', scanMaxId(dir, 'log'))
  const tool = input.tool || '不明'
  const title = input.title || `${tool} — ${nowStamp()}`
  const phase = input.phase || 'survey'
  const vars = {
    id, title, engagement: eid, tool, phase, phase_label: PHASES[phase] || phase,
    command: input.command || '', now: input.executed_at || nowStamp(), today: today(),
    target: tableCell(input.target),
    // アプリから実行したときだけ、終了コードと所要時間の行と、取得した出力を入れます（出力は呼び出し側で伏せ字にしてから渡します）。
    extra_rows: [
      input.exit_code !== undefined && input.exit_code !== null ? `\n| 終了コード | ${tableCell(input.exit_code)} |` : '',
      Number.isFinite(input.duration_ms) ? `\n| 所要時間 | ${(input.duration_ms / 1000).toFixed(1)} 秒 |` : '',
      input.run_note ? `\n| 実行 | ${tableCell(input.run_note)} |` : '',
    ].join(''),
    output: typeof input.stdout === 'string' && input.stdout !== '' ? fence(input.stdout) : '```\n```',
  }
  const file = path.join(dir, `${id}-${slug(title)}.md`)
  writeNew(file, renderTemplate('21-ツール実行ログ.md', vars, { surfaces: input.surfaces || [], findings: input.findings || [] }))
  return { id, file: toPosix(path.relative(dataRoot(), file)) }
}

/* ---------------- 共通: 1ファイルの読み書き ---------------- */

export function resolveFile(relPath) {
  const root = dataRoot()
  const abs = path.resolve(root, relPath)
  if (!abs.startsWith(root + path.sep)) throw new Error('データフォルダの外は開けません')
  if (!abs.endsWith('.md')) throw new Error('Markdown ファイルだけを扱います')
  return abs
}

/** 見出しごとの版。同じ見出しが複数あるときは、replaceSection と同じく最初のものを使う。 */
function sectionVersionsOf(sections) {
  const out = {}
  for (const s of sections) {
    if (s.heading && !Object.prototype.hasOwnProperty.call(out, s.heading)) out[s.heading] = sectionVersion(s.content)
  }
  return out
}

/**
 * 1 ファイルを読む。version はファイル全体の版、sectionVersions は見出しごとの版。
 * 保存するときに baseVersion / baseSections として送り返すと、競合を検知できる。
 */
export function readDoc(relPath) {
  const abs = resolveFile(relPath)
  const { data, body, raw, version } = readMd(abs)
  const sections = parseSections(body)
  return { file: relPath, version, data, body, raw, sections, sectionVersions: sectionVersionsOf(sections), checklist: parseChecklist(body) }
}

/**
 * 欄の値を比べられる形にする。YAML の Date と、JSON を経由した ISO 形式の日時は YYYY-MM-DD にそろえる。
 * 未設定（undefined / null）と空文字は同じとみなす。
 */
export function fieldKey(v) {
  if (v === undefined || v === null) return ''
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0')
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`
  }
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 10) : v
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 読み込んだときの状態（base*）と、いまのファイルを比べて、衝突した見出しと欄を返す。
 * - baseSections / baseFields のどちらかがあれば、渡された見出し・欄だけを比べる（ほかの場所の変更は衝突にしない）
 * - どちらもなく baseVersion だけなら、ファイル全体の版で比べる
 * - 何も渡さなければ比べない（従来どおり後勝ち）
 */
function findConflicts(current, currentSections, { baseVersion, baseSections, baseFields }) {
  if (baseSections !== undefined || baseFields !== undefined) {
    const conflicts = []
    if (baseSections !== undefined && !isPlainObject(baseSections)) throw new Error('baseSections は { 見出し: 版 } の形で渡してください')
    if (baseFields !== undefined && !isPlainObject(baseFields)) throw new Error('baseFields は { キー: 値 } の形で渡してください')
    const now = sectionVersionsOf(currentSections)
    for (const [heading, base] of Object.entries(baseSections || {})) {
      const cur = Object.prototype.hasOwnProperty.call(now, heading) ? now[heading] : null
      if ((base ?? null) !== cur) conflicts.push({ heading })
    }
    for (const [field, base] of Object.entries(baseFields || {})) {
      if (fieldKey(base) !== fieldKey(current.data[field])) conflicts.push({ field })
    }
    return { checked: true, conflicts }
  }
  if (baseVersion !== undefined && baseVersion !== null && baseVersion !== '') {
    return { checked: true, conflicts: String(baseVersion) === current.version ? [] : [{ file: true }] }
  }
  return { checked: false, conflicts: [] }
}

function staleError(relPath, conflicts) {
  const names = conflicts.map((c) => (c.heading ? `見出し「${c.heading}」` : c.field ? `欄「${c.field}」` : null)).filter(Boolean)
  const msg = names.length
    ? `読み込んだあとで、このファイルの ${names.join('、')} が更新されています`
    : '読み込んだあとで、このファイルが更新されています'
  return new StaleWriteError(msg, { conflicts, current: readDoc(relPath) })
}

/** 深刻度と CVSS 基本値の入力を検査します。未知の深刻度や範囲外の基本値はエラーにします。 */
function validateSeverityInput(input) {
  if (!input) return
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k)
  if (has('severity') && input.severity !== undefined && input.severity !== null && String(input.severity).trim() !== '' && !parseSeverity(input.severity)) {
    throw new Error(`深刻度の値が正しくありません: ${String(input.severity)}（critical / high / medium / low / info、または空文字）`)
  }
  if (has('cvss_score') && input.cvss_score !== undefined && !isValidScore(input.cvss_score)) {
    throw new Error(`CVSS 基本値は 0〜10 の数値か空文字で指定してください: ${JSON.stringify(input.cvss_score)}`)
  }
}

/** 発見事項個票かどうか。深刻度の判定はこの文書にだけ行います。 */
function isFindingData(currentData, sent) {
  if (currentData?.type === 'vs-finding') return true
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k)
  return has(currentData, 'severity') || has(currentData, 'cvss_score') || has(sent, 'severity') || has(sent, 'cvss_score')
}

/**
 * 1 ファイルの frontmatter と見出しを書き換える。
 * baseVersion / baseSections / baseFields を渡すと、読み込んだあとの変更と衝突したときに
 * STALE_WRITE（err.conflicts・err.current 付き）を投げて書き込まない。
 */
export function writeDoc(relPath, opts = {}) {
  const abs = resolveFile(relPath)
  // 判定から置き換えまでの間に別のプロセスが書いたときは、もう一度読み直して判定し直す。
  for (let attempt = 0; ; attempt++) {
    try {
      return writeDocOnce(relPath, abs, opts)
    } catch (err) {
      if (err?.code === 'STALE_WRITE' && err.retry && attempt < 3) continue
      if (err?.code === 'STALE_WRITE' && err.retry) throw staleError(relPath, [])
      throw err
    }
  }
}

function writeDocOnce(relPath, abs, { data, sections, body, baseVersion, baseSections, baseFields } = {}) {
  const current = readMd(abs)
  const currentSections = parseSections(current.body)
  const { checked, conflicts } = findConflicts(current, currentSections, { baseVersion, baseSections, baseFields })
  if (conflicts.length) throw staleError(relPath, conflicts)
  let nextBody = current.body
  if (typeof body === 'string') nextBody = body
  else if (Array.isArray(sections)) {
    nextBody = sections.reduce((acc, s) => (s.heading ? replaceSection(acc, s.heading, s.content ?? '') : acc), current.body)
  }
  const nextData = { ...current.data, ...(data || {}), updated: today() }
  if (isFindingData(current.data, data)) {
    const sent = data && Object.prototype.hasOwnProperty.call(data, 'severity') ? data.severity : undefined
    validateSeverityInput(data)
    const { severity, severity_source } = resolveSeverity({
      current: { severity: current.data.severity, severity_source: current.data.severity_source, cvss_score: current.data.cvss_score },
      sent,
      score: nextData.cvss_score,
    })
    nextData.severity = severity
    nextData.severity_label = severityLabelJa(severity)
    // キーがない既存ファイルは cvss とみなし、手で決めたときだけ書き足します。
    if (severity_source === 'manual' || Object.prototype.hasOwnProperty.call(current.data, 'severity_source')) {
      nextData.severity_source = severity_source
    }
  }
  // 個票の「基本情報」表は欄（frontmatter）から作り直します。
  if (isFindingDoc(nextData)) nextBody = syncFindingBody(nextBody, nextData)
  // スコープ文書の承認表も、承認欄から書き写します。
  if (nextData.type === 'vs-scope') nextBody = syncScopeBody(nextBody, nextData)
  try {
    writeMd(abs, nextData, nextBody, checked ? { expectVersion: current.version } : {})
  } catch (err) {
    if (err?.code === 'STALE_WRITE') err.retry = true
    throw err
  }
  return readDoc(relPath)
}

/**
 * チェックリストの 1 項目を切り替える。
 * expectText を渡すと、その行の文言が一致するかを確かめる。行がずれていれば同じ文言の項目を探し直し、
 * 見つからない（または同じ文言が複数ある）ときは STALE_WRITE にする。別の項目を黙って切り替えないため。
 */
export function toggleChecklist(relPath, lineIndex, checked, expectText) {
  const abs = resolveFile(relPath)
  for (let attempt = 0; ; attempt++) {
    const { data, body, version } = readMd(abs)
    let line = Number(lineIndex)
    const items = parseChecklist(body)
    if (expectText !== undefined && expectText !== null) {
      const want = String(expectText).trim()
      const hit = items.find((i) => i.line === line)
      if (!hit || hit.text !== want) {
        const same = items.filter((i) => i.text === want)
        if (same.length !== 1) {
          throw new StaleWriteError(
            same.length
              ? `同じ文言の項目が複数あるため、どれを切り替えるか決められません: ${want}`
              : `チェックリストが更新されていて、項目が見つかりません: ${want}`,
            { conflicts: [{ checklist: want }], current: readDoc(relPath) },
          )
        }
        line = same[0].line
      }
    } else if (!items.some((i) => i.line === line)) {
      throw new Error(`その行はチェックリストの項目ではありません: ${lineIndex}`)
    }
    try {
      writeMd(abs, { ...data, updated: today() }, setChecklistItem(body, line, checked), { expectVersion: version })
      return readDoc(relPath)
    } catch (err) {
      if (err?.code === 'STALE_WRITE' && attempt < 3) continue
      throw err
    }
  }
}

/**
 * 診断対象フォルダの中の 1 ファイルを指します。
 * 旧バージョンが作った 00-案件/ のデータも、そのまま開けるようにしています。
 */
function pick(eid, dir, name, legacyDir = '') {
  engDir(eid)
  const rel = toPosix(path.join(eid, dir, name))
  if (legacyDir && !fs.existsSync(path.join(dataRoot(), rel))) {
    const legacy = toPosix(path.join(eid, legacyDir, name))
    if (fs.existsSync(path.join(dataRoot(), legacy))) return legacy
  }
  return rel
}

export function docPaths(eid) {
  return {
    scope: pick(eid, DIRS.scope, 'スコープとRoE.md', DIRS.legacyScope),
    guide: pick(eid, DIRS.scope, '進め方.md', DIRS.legacyScope),
    surfaceMap: pick(eid, DIRS.recon, '攻撃面マップ.md'),
    checklist: pick(eid, DIRS.survey, 'チェックリスト.md'),
    negative: pick(eid, DIRS.survey, '未検出記録.md'),
    report: pick(eid, DIRS.report, '診断報告書.md'),
  }
}

/**
 * 既にある診断対象に、あとから追加されたテンプレートを補います。
 * すでにあるファイルは触りません。
 */
export function ensureDocs(eid) {
  const base = engDir(eid)
  const meta = getEngagement(eid)
  if (!meta) throw new Error(`診断対象が見つかりません: ${eid}`)
  secowlDir(eid)
  const vars = {
    title: meta.name, engagement: eid, client: meta.client || '',
    target_system: meta.target_system || '', period_from: meta.period_from || '',
    period_to: meta.period_to || '', today: today(),
  }
  const wanted = [
    [DIRS.scope, '進め方.md', '01-進め方.md'],
    [DIRS.recon, '攻撃面マップ.md', '11-攻撃面マップ.md'],
    [DIRS.survey, '未検出記録.md', '22-未検出記録.md'],
  ]
  const added = []
  for (const [dir, name, template] of wanted) {
    const abs = path.join(base, dir, name)
    const legacy = dir === DIRS.scope ? path.join(base, DIRS.legacyScope, name) : null
    if (fs.existsSync(abs) || (legacy && fs.existsSync(legacy))) continue
    ensure(path.dirname(abs))
    fs.writeFileSync(abs, fillTemplate(tpl(template), vars), 'utf8')
    added.push(path.join(eid, dir, name))
  }
  // 写しが空のままのスコープ文書と報告書には、engagement.json の値を補います（手で書いた値は残します）。
  const paths = docPaths(eid)
  for (const rel of [paths.scope, paths.report]) {
    const abs = path.join(dataRoot(), rel)
    if (!fs.existsSync(abs)) continue
    const { data } = readMd(abs)
    const fill = Object.fromEntries(SYNCED_KEYS
      .filter((k) => (data[k] === undefined || data[k] === null || String(data[k]).trim() === '') && meta[k])
      .map((k) => [k, meta[k]]))
    if (Object.keys(fill).length) {
      patchFrontmatter(abs, fill)
      added.push(toPosix(rel))
    }
  }
  return { added }
}

/**
 * 診断対象のスコープ（スコープ文書の scope_* と承認・期間）を読みます。コマンド実行の関門に使います。
 * 文書を読めない（YAML の誤りなど）・type が vs-scope でない・パターンを解釈できない、のどれかなら ok: false です。
 * 判定は shared/scope.js の evaluate(canonicalTarget(入力), result.scope) で行います。
 */
export function readScope(eid, { on = today() } = {}) {
  const file = docPaths(eid).scope
  let doc
  try {
    doc = readDoc(file)
  } catch (err) {
    return { ok: false, file, error: `スコープ文書を読めません: ${err.message || err}` }
  }
  if (doc.data?.type !== 'vs-scope') {
    return { ok: false, file, version: doc.version, error: 'スコープ文書の type が vs-scope ではありません' }
  }
  const scope = normalizeScope(doc.data)
  return {
    ok: scope.problems.length === 0,
    file,
    version: doc.version,
    data: doc.data,
    scope,
    error: scope.problems.length ? `スコープ設定に解釈できない値があります（${scope.problems.length} 件）` : null,
    approved: approvalComplete(doc.data),
    period: inPeriod(doc.data, on),
  }
}

export { DIRS, SEVERITIES }

/* ---------------- ツール出力の取り込み ---------------- */

function sameValue(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

/**
 * 解析済みのサーフェス・発見事項を診断対象へ取り込みます。
 * dryRun が true のときはファイルを書かず、件数と内訳だけ返します。
 */
export function importIntoEngagement(eid, parsed, { dryRun = false, importFindings = true } = {}) {
  const existingSurfaces = listSurfaces(eid)
  const existingFindings = listFindings(eid)

  const created = []
  const updated = []
  const valueToId = new Map(existingSurfaces.map((s) => [String(s.value).toLowerCase(), s.id]))

  // サブドメインとホストは同じ対象を指すことがあるため、値が一致すれば同一として扱います。
  const kindGroup = (k) => (k === 'subdomain' || k === 'host' ? 'node' : k)

  for (const cand of parsed.surfaces) {
    const hit = existingSurfaces.find((s) => kindGroup(s.kind) === kindGroup(cand.kind) && sameValue(s.value, cand.value))
    if (hit) {
      const nextBy = [...new Set([...hit.discovered_by, ...(cand.discovered_by || [])])]
      const nextTech = [...new Set([...hit.tech, ...(cand.tech || [])])]
      const patch = { discovered_by: nextBy, tech: nextTech }
      for (const k of ['host', 'port', 'protocol', 'service', 'product']) {
        if ((hit[k] === null || hit[k] === '' || hit[k] === undefined) && cand[k]) patch[k] = cand[k]
      }
      const changed = nextBy.length !== hit.discovered_by.length || nextTech.length !== hit.tech.length || Object.keys(patch).length > 2
      if (changed) {
        updated.push({ id: hit.id, value: hit.value, kind: hit.kind })
        if (!dryRun) patchFrontmatter(resolveFile(hit.file), patch)
      }
      continue
    }
    created.push({ value: cand.value, kind: cand.kind, kind_label: SURFACE_KINDS[cand.kind] || cand.kind })
    if (!dryRun) {
      const res = createSurface(eid, cand)
      valueToId.set(String(cand.value).toLowerCase(), res.id)
      if (cand.note) {
        const abs = resolveFile(res.file)
        const { data, body } = readMd(abs)
        writeMd(abs, data, replaceSection(body, '発見の経緯', `取り込み元: ${parsed.formatLabel}\n${cand.note}`))
      }
    }
  }

  const newFindings = []
  const skippedFindings = []
  if (importFindings) {
    for (const cand of parsed.findings) {
      const dup = existingFindings.find((f) => sameValue(f.vuln_name, cand.vuln_name) && sameValue(f.target, cand.target))
      if (dup) { skippedFindings.push({ vuln_name: cand.vuln_name, target: cand.target, reason: '同じ名称と対象の発見事項があります' }); continue }
      newFindings.push({ vuln_name: cand.vuln_name, target: cand.target, severity: cand.severity })
      if (!dryRun) {
        const surfaceIds = (cand.surfaceValues || []).map((v) => valueToId.get(String(v).toLowerCase())).filter(Boolean)
        const res = createFinding(eid, { ...cand, surfaces: surfaceIds })
        const abs = resolveFile(res.file)
        const { data, body } = readMd(abs)
        const note = [
          `> 自動検出の結果です。手動で裏取りし、False Positive でないことを確認してから confirmed にしてください。`,
          '',
          cand.evidenceText || '',
        ].join('\n')
        writeMd(abs, data, replaceSection(body, '脆弱性があると判断した理由', note))
      }
    }
  }

  return {
    format: parsed.format,
    formatLabel: parsed.formatLabel,
    dryRun,
    surfaces: { created, updated, unchanged: parsed.surfaces.length - created.length - updated.length },
    findings: { created: newFindings, skipped: skippedFindings },
  }
}
