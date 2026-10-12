import { listSurfaces, listFindings, listToolLogs, SURFACE_KINDS } from './store.js'
import { SEVERITIES, SEVERITY_META } from './severity.js'

/** ホーム画面が必要とする集計をまとめて返す。 */
export function dashboard(eid) {
  const surfaces = listSurfaces(eid)
  const findings = listFindings(eid)
  const logs = listToolLogs(eid)

  const inScope = surfaces.filter((s) => s.in_scope)

  const kindCounts = Object.keys(SURFACE_KINDS).map((k) => ({
    kind: k,
    label: SURFACE_KINDS[k],
    count: inScope.filter((s) => s.kind === k).length,
  }))

  const portMap = new Map()
  for (const s of inScope) {
    if (s.port === null || Number.isNaN(s.port)) continue
    const cur = portMap.get(s.port) || { port: s.port, count: 0, service: s.service, surfaceIds: [] }
    cur.count += 1
    cur.service = cur.service || s.service
    cur.surfaceIds.push(s.id)
    portMap.set(s.port, cur)
  }
  const ports = [...portMap.values()].sort((a, b) => b.count - a.count || a.port - b.port)

  const severity = SEVERITIES.map((key) => ({
    ...SEVERITY_META[key],
    count: findings.filter((f) => f.severity === key).length,
  }))

  const toolMap = new Map()
  for (const l of logs) {
    const cur = toolMap.get(l.tool) || { tool: l.tool, count: 0, lastUsed: '' }
    cur.count += 1
    if ((l.executed_at || '') > cur.lastUsed) cur.lastUsed = l.executed_at || ''
    toolMap.set(l.tool, cur)
  }
  for (const f of findings) {
    for (const t of f.tools) {
      const cur = toolMap.get(t) || { tool: t, count: 0, lastUsed: '' }
      cur.count += 1
      toolMap.set(t, cur)
    }
  }
  const tools = [...toolMap.values()].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))

  const techMap = new Map()
  for (const s of inScope) {
    const items = [...(s.tech || [])]
    if (s.product) items.push(s.product)
    for (const t of items) {
      if (!t) continue
      techMap.set(t, (techMap.get(t) || 0) + 1)
    }
  }
  const technology = [...techMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const statusCounts = ['未調査', '調査中', '調査済', '対象外'].map((st) => ({
    status: st,
    count: surfaces.filter((s) => s.status === st).length,
  }))

  return {
    totals: {
      surfaces: inScope.length,
      surfacesAll: surfaces.length,
      findings: findings.length,
      tools: tools.length,
      logs: logs.length,
    },
    kindCounts,
    ports,
    severity,
    tools,
    technology,
    statusCounts,
  }
}
