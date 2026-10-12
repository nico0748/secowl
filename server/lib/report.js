import { listSurfaces, listFindings, listToolLogs, docPaths } from './store.js'
import { readDoc, writeDoc } from './store.js'
import { SEVERITIES, SEVERITY_META } from './severity.js'
import { getSection } from './md.js'
import { resolveFile } from './store.js'
import { readMd } from './md.js'
import { replaceMarker } from './md.js'

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** 報告書の自動生成ブロックを、現在の発見事項とサーフェスで更新する。手書き部分は保持する。 */
export function buildReport(eid) {
  const rel = docPaths(eid).report
  const abs = resolveFile(rel)
  const { data, body } = readMd(abs)

  const findings = listFindings(eid).sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || String(a.finding_no).localeCompare(String(b.finding_no)),
  )
  const surfaces = listSurfaces(eid).filter((s) => s.in_scope)
  const logs = listToolLogs(eid)

  const counts = Object.fromEntries(SEVERITIES.map((k) => [k, findings.filter((f) => f.severity === k).length]))
  const highest = SEVERITIES.find((k) => counts[k] > 0) || 'info'

  const sevTable = [
    '| 深刻度 | CVSS スコア帯 | 件数 |',
    '|---|---|---|',
    ...SEVERITIES.map((k) => `| ${SEVERITY_META[k].ja} | ${SEVERITY_META[k].range} | ${counts[k]} |`),
  ].join('\n')

  const bySurface = new Map()
  for (const f of findings) {
    const keys = f.surfaces.length ? f.surfaces : [f.target || '(未割当)']
    for (const k of keys) {
      const label = surfaces.find((s) => s.id === k)?.value || k
      const cur = bySurface.get(label) || { label, count: 0, worst: 'info' }
      cur.count += 1
      if (SEV_ORDER[f.severity] < SEV_ORDER[cur.worst]) cur.worst = f.severity
      bySurface.set(label, cur)
    }
  }
  const surfaceTable = [
    '| 診断対象 | 最大深刻度 | 発見事項件数 |',
    '|---|---|---|',
    ...(bySurface.size
      ? [...bySurface.values()].map((r) => `| ${esc(r.label)} | ${SEVERITY_META[r.worst].ja} | ${r.count} |`)
      : ['|  |  |  |']),
  ].join('\n')

  const findingTable = [
    '| # | 脆弱性名称 | 識別子 | 深刻度 | CVSS | 対象 |',
    '|---|---|---|---|---|---|',
    ...(findings.length
      ? findings.map(
          (f) =>
            `| ${esc(f.finding_no)} | ${esc(f.vuln_name)} | ${esc(f.identifier)} | ${SEVERITY_META[f.severity].ja} | ${f.cvss_score ?? ''} | ${esc(f.target)} |`,
        )
      : ['|  |  |  |  |  |  |']),
  ].join('\n')

  const detail = findings.length
    ? findings
        .map((f) => {
          const d = readDoc(f.file)
          const pick = (h) => getSection(d.body, h).trim()
          const block = (label, heading) => {
            const v = pick(heading)
            return v ? ['', `**${label}**`, '', v] : []
          }
          return [
            `#### 発見事項 #${f.finding_no} — ${f.vuln_name}`,
            '',
            '| 項目 | 内容 |',
            '|---|---|',
            `| 識別子 | ${esc(f.identifier)} |`,
            `| 深刻度 | ${SEVERITY_META[f.severity].ja} |`,
            `| CVSS | ${esc(f.cvss_vector)} → ${f.cvss_score ?? ''} |`,
            `| 対象 | ${esc(f.target)} |`,
            ...block('平易な説明', '平易な説明'),
            ...block('発見場所', '発見場所'),
            ...block('リクエスト / レスポンス', 'リクエスト / レスポンス'),
            ...block('再現手順', '再現手順'),
            ...block('脆弱性があると判断した理由', '脆弱性があると判断した理由'),
            ...block('システム・ビジネスへの影響', 'システム・ビジネスへの影響'),
            ...block('対策', '対策'),
            '',
            `> 出典ノート: \`${f.file}\``,
          ].join('\n')
        })
        .join('\n\n---\n\n')
    : '発見事項はありません。'

  const inventory = [
    '| 種別 | 値 | ポート | サービス | 製品 | 状態 |',
    '|---|---|---|---|---|---|',
    ...(surfaces.length
      ? surfaces.map(
          (s) => `| ${esc(s.kind_label)} | ${esc(s.value)} | ${s.port ?? ''} | ${esc(s.service)} | ${esc(s.product)} | ${esc(s.status)} |`,
        )
      : ['|  |  |  |  |  |  |']),
  ].join('\n')

  const toolNames = [...new Set(logs.map((l) => l.tool))]
  const toolLine = toolNames.length ? toolNames.join(' / ') : '（未記入）'

  const overall = findings.length
    ? `**総合リスク: ${SEVERITY_META[highest].ja}**\n\n発見事項 ${findings.length} 件のうち、最も深刻度が高いものは「${SEVERITY_META[highest].ja}」です。`
    : '**総合リスク: なし**\n\n本診断の範囲では脆弱性を検出していません。'

  let next = body
  next = replaceMarker(next, 'severity-table', sevTable)
  next = replaceMarker(next, 'surface-table', surfaceTable)
  next = replaceMarker(next, 'finding-table', findingTable)
  next = replaceMarker(next, 'findings', detail)
  next = replaceMarker(next, 'surface-inventory', inventory)
  next = replaceMarker(next, 'tools', toolLine)
  next = replaceMarker(next, 'overall', overall)

  writeDoc(rel, { data: { ...data, overall_severity: SEVERITY_META[highest].ja }, body: next })
  return readDoc(rel)
}
