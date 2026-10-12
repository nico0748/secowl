import { XMLParser } from 'fast-xml-parser'

/**
 * 各ツールの出力を、サーフェス候補と発見事項候補の配列へ変換します。
 * 返り値の surfaces / findings は store 側で既存レコードと突き合わせます。
 */

const FORMATS = {
  nmap: 'nmap XML（-oX）',
  httpx: 'httpx JSONL',
  nuclei: 'nuclei JSONL',
  subdomains: 'サブドメイン一覧（subfinder / amass / 改行区切り）',
  ffuf: 'ffuf JSON',
  gobuster: 'gobuster 標準出力',
}

export const IMPORT_FORMATS = FORMATS

function jsonLines(text) {
  const out = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t[0] !== '{') continue
    try { out.push(JSON.parse(t)) } catch { /* 壊れた行は読み飛ばします */ }
  }
  return out
}

/** 内容から形式を推定します。判定できないときは null を返します。 */
export function detectFormat(text) {
  const head = text.slice(0, 4000)
  if (/<nmaprun[\s>]/.test(head)) return 'nmap'

  const rows = jsonLines(text.slice(0, 200000))
  if (rows.length) {
    if (rows.some((r) => r['template-id'] || r.templateID || r.info?.severity)) return 'nuclei'
    if (rows.some((r) => r.url && (r.status_code !== undefined || r['status-code'] !== undefined))) return 'httpx'
    if (rows.some((r) => r.host || r.name)) return 'subdomains'
  }

  const t = head.trim()
  if (t.startsWith('{') && /"results"\s*:/.test(head)) return 'ffuf'
  if (/\(Status:\s*\d+\)/.test(head)) return 'gobuster'
  if (t && t.split('\n').every((l) => /^[A-Za-z0-9._-]+\.[A-Za-z]{2,}$/.test(l.trim()) || !l.trim())) return 'subdomains'
  return null
}

function host2(v) {
  return String(v || '').trim().toLowerCase()
}

/* ---------------- nmap ---------------- */

function parseNmap(text) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' })
  const doc = parser.parse(text)
  const run = doc?.nmaprun
  if (!run) throw new Error('nmap の XML として読めませんでした')
  const hosts = [].concat(run.host || [])
  const surfaces = []

  for (const h of hosts) {
    if (!h) continue
    const addrs = [].concat(h.address || [])
    const ip = addrs.find((a) => a['@addrtype'] === 'ipv4' || a['@addrtype'] === 'ipv6')?.['@addr'] || ''
    const names = [].concat(h.hostnames?.hostname || []).map((n) => n?.['@name']).filter(Boolean)
    const label = names[0] || ip
    if (!label) continue

    surfaces.push({
      kind: 'host', value: label, host: ip, discovered_by: ['nmap'],
      status: h.status?.['@state'] === 'up' ? '調査中' : '未調査',
    })

    const ports = [].concat(h.ports?.port || [])
    for (const p of ports) {
      if (!p) continue
      if (p.state?.['@state'] !== 'open') continue
      const svc = p.service || {}
      const product = [svc['@product'], svc['@version']].filter(Boolean).join(' ')
      surfaces.push({
        kind: 'port',
        value: `${label}:${p['@portid']}`,
        host: ip || label,
        port: Number(p['@portid']),
        protocol: p['@protocol'] || 'tcp',
        service: svc['@name'] || '',
        product,
        tech: svc['@extrainfo'] ? [svc['@extrainfo']] : [],
        discovered_by: ['nmap'],
        status: '未調査',
      })
    }
  }
  return { surfaces, findings: [] }
}

/* ---------------- httpx ---------------- */

function parseHttpx(text) {
  const surfaces = []
  for (const r of jsonLines(text)) {
    if (!r.url) continue
    const tech = []
      .concat(r.tech || r.technologies || [])
      .filter(Boolean)
      .map(String)
    surfaces.push({
      kind: 'endpoint',
      value: r.url,
      host: host2(r.host || r.input || ''),
      port: r.port ? Number(r.port) : null,
      service: String(r.scheme || r.url).startsWith('https') ? 'https' : 'http',
      product: r.webserver || '',
      tech,
      discovered_by: ['httpx'],
      status: '未調査',
      note: [r.title && `title: ${r.title}`, (r.status_code ?? r['status-code']) && `status: ${r.status_code ?? r['status-code']}`]
        .filter(Boolean).join(' / '),
    })
  }
  return { surfaces, findings: [] }
}

/* ---------------- nuclei ---------------- */

const NUCLEI_SEVERITY = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info', unknown: 'info' }

function parseNuclei(text) {
  const surfaces = []
  const findings = []
  for (const r of jsonLines(text)) {
    const id = r['template-id'] || r.templateID || ''
    const info = r.info || {}
    const target = r['matched-at'] || r.matched || r.host || ''
    if (!id && !target) continue
    if (target) {
      surfaces.push({ kind: 'endpoint', value: target, host: host2(r.host || ''), discovered_by: ['nuclei'], status: '調査中' })
    }
    const sev = NUCLEI_SEVERITY[String(info.severity || 'info').toLowerCase()] || 'info'
    findings.push({
      vuln_name: info.name || id,
      identifier: [].concat(info.classification?.['cve-id'] || [])[0] || [].concat(info.classification?.['cwe-id'] || [])[0] || '',
      severity: sev,
      cvss_score: info.classification?.['cvss-score'] ?? '',
      cvss_vector: info.classification?.['cvss-metrics'] || '',
      target,
      tools: ['nuclei'],
      surfaceValues: target ? [target] : [],
      evidenceText: [
        id && `template: ${id}`,
        info.description && `説明: ${info.description}`,
        r['curl-command'] && `再現: ${r['curl-command']}`,
        [].concat(info.reference || []).length ? `参照: ${[].concat(info.reference).join(' / ')}` : '',
      ].filter(Boolean).join('\n'),
    })
  }
  return { surfaces, findings }
}

/* ---------------- サブドメイン一覧 ---------------- */

function parseSubdomains(text) {
  const names = new Set()
  const tools = new Set()
  for (const r of jsonLines(text)) {
    const n = r.host || r.name
    if (n) names.add(host2(n))
    for (const s of [].concat(r.source || r.sources || [])) if (s) tools.add(String(s))
  }
  if (names.size === 0) {
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (/^[A-Za-z0-9._-]+\.[A-Za-z]{2,}$/.test(t)) names.add(host2(t))
    }
  }
  const by = tools.size ? [...tools].slice(0, 5) : ['サブドメイン列挙']
  return {
    surfaces: [...names].map((value) => ({ kind: 'subdomain', value, discovered_by: by, status: '未調査' })),
    findings: [],
  }
}

/* ---------------- ffuf / gobuster ---------------- */

function parseFfuf(text) {
  let doc
  try { doc = JSON.parse(text) } catch { throw new Error('ffuf の JSON として読めませんでした') }
  const rows = [].concat(doc.results || [])
  return {
    surfaces: rows.filter((r) => r.url).map((r) => ({
      kind: 'endpoint', value: r.url, discovered_by: ['ffuf'], status: '未調査',
      note: `status: ${r.status ?? ''} / length: ${r.length ?? ''}`,
    })),
    findings: [],
  }
}

function parseGobuster(text) {
  const base = /^Url:\s*(\S+)/m.exec(text)?.[1] || ''
  const surfaces = []
  for (const line of text.split('\n')) {
    const m = /^(\/\S*)\s+\(Status:\s*(\d+)\)/.exec(line.trim())
    if (!m) continue
    surfaces.push({
      kind: 'endpoint',
      value: base ? base.replace(/\/$/, '') + m[1] : m[1],
      discovered_by: ['gobuster'],
      status: '未調査',
      note: `status: ${m[2]}`,
    })
  }
  return { surfaces, findings: [] }
}

const PARSERS = {
  nmap: parseNmap,
  httpx: parseHttpx,
  nuclei: parseNuclei,
  subdomains: parseSubdomains,
  ffuf: parseFfuf,
  gobuster: parseGobuster,
}

/** text を解析し、{ format, surfaces, findings } を返します。 */
export function parseToolOutput(text, format) {
  const fmt = format && format !== 'auto' ? format : detectFormat(text)
  if (!fmt) throw new Error('形式を判定できませんでした。形式を指定して読み込んでください。')
  const parse = PARSERS[fmt]
  if (!parse) throw new Error(`未対応の形式です: ${fmt}`)
  const out = parse(text)

  // 同じ値のサーフェスをまとめます。
  const map = new Map()
  for (const s of out.surfaces) {
    const key = `${s.kind}::${host2(s.value)}`
    const cur = map.get(key)
    if (!cur) { map.set(key, { ...s, discovered_by: [...(s.discovered_by || [])], tech: [...(s.tech || [])] }); continue }
    cur.discovered_by = [...new Set([...cur.discovered_by, ...(s.discovered_by || [])])]
    cur.tech = [...new Set([...cur.tech, ...(s.tech || [])])]
    for (const k of ['host', 'port', 'protocol', 'service', 'product', 'note']) {
      if (!cur[k] && s[k]) cur[k] = s[k]
    }
  }
  return { format: fmt, formatLabel: FORMATS[fmt], surfaces: [...map.values()], findings: out.findings }
}
