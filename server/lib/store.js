import fs from 'node:fs'
import path from 'node:path'
import { dataRoot, TEMPLATE_DIR } from './config.js'
import {
  readMd, writeMd, patchFrontmatter, parseSections, stringifySections, replaceSection,
  parseChecklist, setChecklistItem, today, nowStamp, slug, fillTemplate, listMd,
} from './md.js'
import { normalizeSeverity, severityFromScore, severityLabelJa, SEVERITIES } from './severity.js'

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

function engDir(id) {
  return path.join(dataRoot(), id)
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function nextId(dir, prefix) {
  const files = listMd(dir)
  let max = 0
  for (const f of files) {
    const m = new RegExp(`^${prefix}-(\\d+)`).exec(path.basename(f))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
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
  fs.writeFileSync(path.join(base, DIRS.scope, 'スコープとRoE.md'), fillTemplate(tpl('00-スコープとRoE.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.scope, '進め方.md'), fillTemplate(tpl('01-進め方.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.recon, '攻撃面マップ.md'), fillTemplate(tpl('11-攻撃面マップ.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.survey, 'チェックリスト.md'), fillTemplate(tpl('20-調査チェックリスト.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.survey, '未検出記録.md'), fillTemplate(tpl('22-未検出記録.md'), vars), 'utf8')
  fs.writeFileSync(path.join(base, DIRS.report, '診断報告書.md'), fillTemplate(tpl('40-診断報告書.md'), vars), 'utf8')
  return meta
}

export function getEngagement(id) {
  const metaPath = path.join(engDir(id), 'engagement.json')
  if (!fs.existsSync(metaPath)) return null
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
}

/* ---------------- サーフェス（偵察・列挙） ---------------- */

export function listSurfaces(eid) {
  const dir = path.join(engDir(eid), DIRS.recon)
  return listMd(dir).map((f) => {
    const { data } = readMd(f)
    return {
      id: data.id || path.basename(f).split('-').slice(0, 2).join('-'),
      file: path.relative(dataRoot(), f),
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
  const id = nextId(dir, 'srf')
  const kind = input.kind || 'endpoint'
  const value = input.value || ''
  const title = input.title || (kind === 'port' ? `${input.host || ''}:${input.port || ''}` : value) || id
  const vars = {
    id, title, engagement: eid, kind, kind_label: SURFACE_KINDS[kind] || kind,
    value, host: input.host || '', port: input.port ?? '', protocol: input.protocol || 'tcp',
    service: input.service || '', product: input.product || '', today: today(),
  }
  const file = path.join(dir, `${id}-${slug(title)}.md`)
  fs.writeFileSync(file, fillTemplate(tpl('10-サーフェス.md'), vars), 'utf8')
  if (input.discovered_by?.length || input.tech?.length || input.status) {
    patchFrontmatter(file, {
      discovered_by: input.discovered_by || [],
      tech: input.tech || [],
      status: input.status || '未調査',
    })
  }
  return { id, file: path.relative(dataRoot(), file) }
}

/* ---------------- 発見事項個票（トリアージ） ---------------- */

export function listFindings(eid) {
  const dir = path.join(engDir(eid), DIRS.triage)
  return listMd(dir).map((f) => {
    const { data } = readMd(f)
    const sev = normalizeSeverity(data.severity)
    return {
      id: data.id || path.basename(f).split('-').slice(0, 2).join('-'),
      file: path.relative(dataRoot(), f),
      finding_no: data.finding_no || '',
      title: data.title || data.vuln_name || '',
      vuln_name: data.vuln_name || '',
      identifier: data.identifier || '',
      severity: sev,
      severity_label: severityLabelJa(sev),
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
  const dir = ensure(path.join(engDir(eid), DIRS.triage))
  const id = nextId(dir, 'fnd')
  const no = String(listMd(dir).length + 1)
  const score = input.cvss_score
  const severity = normalizeSeverity(input.severity || severityFromScore(score) || 'info')
  const vuln_name = input.vuln_name || '名称未設定'
  const vars = {
    id, title: vuln_name, engagement: eid, finding_no: no, vuln_name,
    severity, severity_label: severityLabelJa(severity),
    target: input.target || '', cvss_vector: input.cvss_vector || '', cvss_score: score ?? '',
    today: today(),
  }
  const file = path.join(dir, `${id}-${slug(vuln_name)}.md`)
  fs.writeFileSync(file, fillTemplate(tpl('30-発見事項個票.md'), vars), 'utf8')
  patchFrontmatter(file, {
    surfaces: input.surfaces || [],
    tools: input.tools || [],
    identifier: input.identifier || '',
    wstg_id: input.wstg_id || '',
    cvss_score: score ?? '',
    cvss_vector: input.cvss_vector || '',
    status: input.status || 'draft',
  })
  return { id, file: path.relative(dataRoot(), file) }
}

/* ---------------- ツール実行ログ ---------------- */

export function listToolLogs(eid) {
  const dir = path.join(engDir(eid), DIRS.logs)
  return listMd(dir).map((f) => {
    const { data } = readMd(f)
    return {
      id: data.id || path.basename(f).split('-').slice(0, 2).join('-'),
      file: path.relative(dataRoot(), f),
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

export function createToolLog(eid, input) {
  const dir = ensure(path.join(engDir(eid), DIRS.logs))
  const id = nextId(dir, 'log')
  const tool = input.tool || '不明'
  const title = input.title || `${tool} — ${nowStamp()}`
  const phase = input.phase || 'survey'
  const vars = {
    id, title, engagement: eid, tool, phase, phase_label: PHASES[phase] || phase,
    command: input.command || '', now: input.executed_at || nowStamp(), today: today(),
  }
  const file = path.join(dir, `${id}-${slug(title)}.md`)
  fs.writeFileSync(file, fillTemplate(tpl('21-ツール実行ログ.md'), vars), 'utf8')
  patchFrontmatter(file, { surfaces: input.surfaces || [], findings: input.findings || [] })
  return { id, file: path.relative(dataRoot(), file) }
}

/* ---------------- 共通: 1ファイルの読み書き ---------------- */

export function resolveFile(relPath) {
  const root = dataRoot()
  const abs = path.resolve(root, relPath)
  if (!abs.startsWith(root + path.sep)) throw new Error('データフォルダの外は開けません')
  if (!abs.endsWith('.md')) throw new Error('Markdown ファイルだけを扱います')
  return abs
}

export function readDoc(relPath) {
  const abs = resolveFile(relPath)
  const { data, body, raw } = readMd(abs)
  return { file: relPath, data, body, raw, sections: parseSections(body), checklist: parseChecklist(body) }
}

export function writeDoc(relPath, { data, sections, body }) {
  const abs = resolveFile(relPath)
  const current = readMd(abs)
  let nextBody = current.body
  if (typeof body === 'string') nextBody = body
  else if (Array.isArray(sections)) {
    nextBody = sections.reduce((acc, s) => (s.heading ? replaceSection(acc, s.heading, s.content ?? '') : acc), current.body)
  }
  const nextData = { ...current.data, ...(data || {}), updated: today() }
  if (nextData.cvss_score !== undefined && nextData.cvss_score !== '' && !data?.severity) {
    const derived = severityFromScore(nextData.cvss_score)
    if (derived) {
      nextData.severity = derived
      nextData.severity_label = severityLabelJa(derived)
    }
  }
  if (data?.severity) {
    nextData.severity = normalizeSeverity(data.severity)
    nextData.severity_label = severityLabelJa(nextData.severity)
  }
  writeMd(abs, nextData, nextBody)
  return readDoc(relPath)
}

export function toggleChecklist(relPath, lineIndex, checked) {
  const abs = resolveFile(relPath)
  const { data, body } = readMd(abs)
  writeMd(abs, { ...data, updated: today() }, setChecklistItem(body, lineIndex, checked))
  return readDoc(relPath)
}

/**
 * 診断対象フォルダの中の 1 ファイルを指します。
 * 旧バージョンが作った 00-案件/ のデータも、そのまま開けるようにしています。
 */
function pick(eid, dir, name, legacyDir = '') {
  const rel = path.join(eid, dir, name)
  if (legacyDir && !fs.existsSync(path.join(dataRoot(), rel))) {
    const legacy = path.join(eid, legacyDir, name)
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
  return { added }
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
