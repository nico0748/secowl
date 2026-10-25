/**
 * 機械可読スコープ（S4）。サーバ・画面・テストで同じモジュールを使います。ブラウザでも動くよう、
 * node: のモジュールには頼らず、IDN の変換は WHATWG URL（ブラウザと Node で同じ UTS #46）に任せます。
 *
 * 不変条件: 判定に使う値と、コマンドの引数に入れる値は同じ（canonicalTarget の value）。
 * 素の入力は引数に入れません。解釈できない値はエラーにして、黙って読み飛ばしません。
 *
 * スコープ文書（type: vs-scope）の frontmatter:
 *   scope_targets: ['app.example.com', '*.example.com', '198.51.100.0/24']   # 診断してよい対象
 *   scope_allow:   ['10.10.0.0/16']        # 例外（自分の検証環境）。スコープ外でも実行を許す
 *   scope_deny:    ['payment.example.com'] # 除外。ほかのどれに一致しても実行しない
 *   scope_ports:   [443, '8000-8100']      # 空なら全ポート
 */

export const SCOPE_KEYS = ['scope_targets', 'scope_allow', 'scope_deny', 'scope_ports']

/** 判定ラベル（色に頼らず文字で示します）。 */
export const VERDICT_LABELS = {
  in: 'スコープ内',
  allow: '例外として許可',
  out: 'スコープ外',
  deny: '除外（実行不可）',
  invalid: '判定できません（実行不可）',
}

export const ALLOW_NOTE = 'この対象はスコープ外ですが、例外リスト（scope_allow）に入っているため実行できます。自分の検証環境だけを登録してください。'

const CTRL = /[\u0000-\u001f\u007f-\u009f]/
const IPV4 = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/
const LDH = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const NUMERIC_LABEL = /^(?:\d+|0x[0-9a-f]*)$/i

const fail = (error) => ({ error })

/* ---------------- IP アドレス ---------------- */

function parseIPv4(s) {
  const m = IPV4.exec(s)
  if (!m) return null
  const o = m.slice(1).map(Number)
  if (o.some((x) => x > 255)) return null
  return o
}

const v4ToBig = (o) => BigInt(o[0] * 16777216 + o[1] * 65536 + o[2] * 256 + o[3])
const bigToV4 = (v) => [24n, 16n, 8n, 0n].map((sh) => Number((v >> sh) & 0xffn)).join('.')

/** IPv6 を 128 ビットの BigInt に。ゾーン ID（%en0）や不正な形は null。 */
function parseIPv6(input) {
  let s = input
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(':')) return null
  let tail4 = null
  if (s.includes('.')) {
    const last = s.lastIndexOf(':')
    tail4 = parseIPv4(s.slice(last + 1))
    if (!tail4) return null
    s = s.slice(0, last + 1) + '0:0'
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const groups = (str) => (str === '' ? [] : str.split(':'))
  const head = groups(halves[0])
  const tail = halves.length === 2 ? groups(halves[1]) : []
  if ([...head, ...tail].some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null
  let all
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 1) return null
    all = [...head, ...Array(missing).fill('0'), ...tail]
  } else {
    if (head.length !== 8) return null
    all = head
  }
  let v = 0n
  for (const g of all) v = (v << 16n) | BigInt(parseInt(g, 16))
  if (tail4) v = (v & ~0xffffffffn) | v4ToBig(tail4)
  return v
}

/** RFC 5952 の表記（小文字・先頭の 0 を省く・最長の 0 の並びを :: に）。 */
function formatIPv6(v) {
  const g = []
  for (let i = 7; i >= 0; i--) g.push(Number((v >> BigInt(i * 16)) & 0xffffn))
  let best = -1
  let bestLen = 1
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue }
    let j = i
    while (j < 8 && g[j] === 0) j++
    if (j - i > bestLen) { best = i; bestLen = j - i }
    i = j
  }
  const hex = g.map((x) => x.toString(16))
  if (best < 0) return hex.join(':')
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`
}

const isMappedV4 = (v) => (v >> 32n) === 0xffffn

/** IP の文字列を { ip: 4|6, host, big } に。IPv4 射影アドレスは IPv4 にそろえます。 */
function canonicalIp(s) {
  const v4 = parseIPv4(s)
  if (v4) return { ip: 4, host: v4.join('.'), big: v4ToBig(v4) }
  if (s.includes('%')) return fail('IPv6 のゾーン ID（%…）は使えません')
  const v6 = parseIPv6(s)
  if (v6 === null) return null
  if (isMappedV4(v6)) {
    const big = v6 & 0xffffffffn
    return { ip: 4, host: bigToV4(big), big }
  }
  return { ip: 6, host: formatIPv6(v6), big: v6 }
}

/* ---------------- ホスト名 ---------------- */

/**
 * ホスト名を IDN 変換（NFKC・小文字化・punycode）して、LDH ラベルだけからなることを確かめます。
 * 先頭の - はオプションとして解釈されるため拒否します（例: -oNx.example.com）。
 */
function canonicalHostname(input) {
  let s = input
  if (s.endsWith('.')) s = s.slice(0, -1)
  if (!s) return fail('ホスト名が空です')
  if (s.startsWith('-')) return fail('- で始まる値は使えません（コマンドのオプションとして解釈されるため）')
  if (s.includes('*')) return fail('* は使えません（範囲の指定はスコープのパターンにだけ書けます）')
  if (s.includes('_')) return fail('ホスト名に _ は使えません')
  if (/[\s/\\?#@:%,[\]]/.test(s) || CTRL.test(s)) return fail('ホスト名に使えない文字が含まれています')
  const labels0 = s.split('.')
  if (labels0.some((l) => l === '')) return fail('ホスト名に空のラベル（.. など）があります')
  if (NUMERIC_LABEL.test(labels0.at(-1))) {
    return fail('IP アドレスの書き方が正しくありません（先頭の 0・8 進・16 進・整数の表記は使えません）')
  }
  let ascii
  try { ascii = new URL(`http://${s}/`).hostname } catch { return fail('ホスト名として解釈できません') }
  const labels = ascii.split('.')
  if (labels.some((l) => l === '')) return fail('ホスト名に空のラベルがあります')
  if (ascii.length > 253) return fail('ホスト名が長すぎます')
  if (!labels.every((l) => LDH.test(l))) return fail('ホスト名に使えない文字が含まれています（英数字とハイフンのみ）')
  const tld = labels.at(-1)
  if (!/^[a-z]/.test(tld)) return fail('ホスト名の最後のラベルが数字で始まっています（範囲の指定は使えません）')
  return { host: ascii }
}

/* ---------------- ポート ---------------- */

function parsePort(s) {
  if (!/^[1-9]\d{0,4}$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= 65535 ? n : null
}

/** host、host:port、[v6]、[v6]:port、素の IPv6 を分けて正規化します。 */
function hostPort(s) {
  let host = s
  let portStr = null
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    if (end < 0) return fail('[ に対応する ] がありません')
    host = s.slice(1, end)
    const rest = s.slice(end + 1)
    if (rest) {
      if (!rest.startsWith(':')) return fail('] のあとにはポートだけを書けます')
      portStr = rest.slice(1)
    }
    const ip = canonicalIp(host)
    if (!ip || ip.error || ip.ip !== 6 && !host.includes(':')) return ip?.error ? ip : fail('[ ] の中は IPv6 アドレスにしてください')
    const port = portStr === null ? null : parsePort(portStr)
    if (portStr !== null && port === null) return fail('ポートは 1〜65535 の整数にしてください')
    return { ...ip, port }
  }
  const colons = (s.match(/:/g) || []).length
  if (colons >= 2) {
    const ip = canonicalIp(s)
    if (!ip) return fail('IPv6 アドレスとして解釈できません')
    if (ip.error) return ip
    return { ...ip, port: null }
  }
  if (colons === 1) {
    const i = s.indexOf(':')
    host = s.slice(0, i)
    portStr = s.slice(i + 1)
  }
  const port = portStr === null ? null : parsePort(portStr)
  if (portStr !== null && port === null) return fail('ポートは 1〜65535 の整数にしてください')
  const ip = canonicalIp(host)
  if (ip && !ip.error) return { ...ip, port }
  if (ip?.error) return ip
  const h = canonicalHostname(host)
  if (h.error) return h
  return { ip: null, host: h.host, big: null, port }
}

/**
 * 対象を 1 つ正規化します。
 *   成功 → { kind: 'ip' | 'host' | 'url', host, ip: 4 | 6 | null, port, portExplicit, value }
 *   失敗 → { error: '<理由>' }
 * value が「判定にも引数にも入る唯一の値」です。URL の port は省略時の既定（80 / 443）を入れます。
 * 範囲（/24・1-50・*）と、カンマや空白で区切った複数の対象は受け付けません。
 */
export function canonicalTarget(raw) {
  if (typeof raw !== 'string') return fail('対象は文字列で指定してください')
  if (raw.length === 0 || raw.length > 2048) return fail('対象は 1〜2048 文字で指定してください')
  if (CTRL.test(raw)) return fail('制御文字は使えません')
  const s = raw.normalize('NFKC').trim()
  if (!s) return fail('対象が空です')
  if (/\s/.test(s)) return fail('空白は使えません（複数の対象は 1 つずつ実行してください）')
  if (/^https?:\/\//i.test(s)) return canonicalUrl(s)
  if (s.startsWith('-')) return fail('- で始まる値は使えません（コマンドのオプションとして解釈されるため）')
  if (s.includes(',')) return fail('カンマで区切った複数の対象は使えません')
  if (s.includes('/')) return fail('範囲（/24 など）の指定は使えません。対象を 1 つずつ指定してください')
  if (s.includes('*')) return fail('* は使えません。対象を 1 つずつ指定してください')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return fail('http:// か https:// の URL だけを使えます')
  const hp = hostPort(s)
  if (hp.error) return hp
  const hostOut = hp.ip === 6 && hp.port !== null ? `[${hp.host}]` : hp.host
  return {
    kind: hp.ip ? 'ip' : 'host',
    host: hp.host,
    ip: hp.ip,
    port: hp.port,
    portExplicit: hp.port !== null,
    value: hp.port !== null ? `${hostOut}:${hp.port}` : hp.host,
  }
}

function canonicalUrl(s) {
  if (/[@\\]/.test(s)) return fail('URL にユーザー情報（@）や \\ は使えません')
  const m = /^(https?):\/\/([^/?#]*)(.*)$/i.exec(s)
  if (!m || !m[2]) return fail('URL のホストがありません')
  const scheme = m[1].toLowerCase()
  const hp = hostPort(m[2])
  if (hp.error) return hp
  let u
  try { u = new URL(s) } catch { return fail('URL として解釈できません') }
  const def = scheme === 'https' ? 443 : 80
  const port = hp.port ?? def
  const hostOut = hp.ip === 6 ? `[${hp.host}]` : hp.host
  const value = `${scheme}://${hostOut}${hp.port !== null && hp.port !== def ? `:${hp.port}` : ''}${u.pathname}${u.search}${u.hash}`
  return { kind: 'url', host: hp.host, ip: hp.ip, port, portExplicit: hp.port !== null, value, scheme }
}

/* ---------------- パターン ---------------- */

/**
 * スコープのパターンを 1 つ解釈します。
 *   * / *.example.com / example.com / example.com:8443 / 198.51.100.7 / 198.51.100.0/24 / 2001:db8::/32 / https://app.example.com/
 * 失敗 → { error }
 */
export function parsePattern(raw) {
  if (raw === null || raw === undefined || typeof raw === 'object') return { raw, error: '文字列で書いてください' }
  const src = String(raw)
  if (CTRL.test(src)) return { raw: src, error: '制御文字は使えません' }
  const s = src.normalize('NFKC').trim()
  if (!s) return { raw: src, error: '空の値です' }
  if (s === '*') return { raw: src, kind: 'any' }
  if (s.startsWith('*.')) {
    const h = canonicalHostname(s.slice(2))
    if (h.error) return { raw: src, error: h.error }
    return { raw: src, kind: 'wildcard', suffix: h.host }
  }
  if (!/^https?:\/\//i.test(s) && s.includes('/')) {
    const [base, bitsStr, ...more] = s.split('/')
    if (more.length) return { raw: src, error: 'CIDR の書き方が正しくありません' }
    const ip = canonicalIp(base)
    if (!ip || ip.error) return { raw: src, error: ip?.error || 'CIDR の前半は IP アドレスにしてください' }
    if (!/^(0|[1-9]\d{0,2})$/.test(bitsStr)) return { raw: src, error: 'CIDR のプレフィックス長は整数にしてください' }
    let bits = Number(bitsStr)
    let version = ip.ip
    // ::ffff:a.b.c.d/120 のような射影アドレスの範囲は IPv4 の範囲として扱います。
    if (version === 4 && base.includes(':')) bits -= 96
    const width = version === 4 ? 32 : 128
    if (bits < 0 || bits > width) return { raw: src, error: `プレフィックス長は 0〜${width} にしてください` }
    const shift = BigInt(width - bits)
    const network = (ip.big >> shift) << shift
    return { raw: src, kind: 'cidr', version, bits, network, shift }
  }
  const c = canonicalTarget(s)
  if (c.error) return { raw: src, error: c.error }
  return { raw: src, kind: c.ip ? 'ip' : 'host', host: c.host, ip: c.ip, port: c.portExplicit ? c.port : null }
}

/** 正規化済みの対象がパターンに一致するか。pattern は文字列でも parsePattern の結果でもかまいません。 */
export function matchHost(canon, pattern) {
  if (!canon || canon.error) return false
  const p = typeof pattern === 'string' ? parsePattern(pattern) : pattern
  if (!p || p.error) return false
  switch (p.kind) {
    case 'any':
      return true
    case 'wildcard':
      // ドット境界のサフィックス一致。多段（a.b.example.com）にも一致し、example.com 自身は含みません。
      return !canon.ip && canon.host.endsWith(`.${p.suffix}`)
    case 'host':
      return !canon.ip && canon.host === p.host && (p.port === null || canon.port === p.port)
    case 'ip':
      return canon.ip === p.ip && canon.host === p.host && (p.port === null || canon.port === p.port)
    case 'cidr': {
      if (canon.ip !== p.version) return false
      const big = canonicalIp(canon.host)?.big
      return big !== undefined && (big >> p.shift) << p.shift === p.network
    }
    default:
      return false
  }
}

/* ---------------- ポートの一覧 ---------------- */

/**
 * ポートの一覧を [[from, to], ...] に。数値・"80,443"・"8000-8100"・配列を受け付けます。
 * 失敗 → { error }
 */
export function parsePortList(input) {
  if (input === undefined || input === null || input === '') return { ranges: [] }
  const items = Array.isArray(input) ? input : [input]
  const ranges = []
  for (const item of items) {
    if (item === null || typeof item === 'object' || typeof item === 'boolean') return { error: `ポートの値が正しくありません: ${JSON.stringify(item)}` }
    for (const tok of String(item).normalize('NFKC').split(/[\s,]+/).filter(Boolean)) {
      const m = /^([1-9]\d{0,4})(?:-([1-9]\d{0,4}))?$/.exec(tok)
      const a = m && Number(m[1])
      const b = m && (m[2] ? Number(m[2]) : a)
      if (!m || a > 65535 || b > 65535 || b < a) return { error: `ポートは 1〜65535 の整数か「8000-8100」の形にしてください: ${tok}` }
      ranges.push([a, b])
    }
  }
  return { ranges }
}

const within = ([a, b], allowed) => allowed.some(([x, y]) => a >= x && b <= y)
const fmtRanges = (rs) => rs.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(', ')

/* ---------------- スコープ全体 ---------------- */

const asList = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : typeof v === 'object' ? null : [v])

/**
 * スコープ文書の frontmatter（または同じ形のオブジェクト）を解釈します。
 * problems に 1 件でもあれば、その案件では実行させません（fail-closed）。
 */
export function normalizeScope(data) {
  if (data && data.__normalized) return data
  const out = { __normalized: true, targets: [], allow: [], deny: [], ports: [], problems: [] }
  for (const [key, name] of [['scope_targets', 'targets'], ['scope_allow', 'allow'], ['scope_deny', 'deny']]) {
    const list = asList(data?.[key])
    if (list === null) { out.problems.push({ key, raw: data[key], error: '一覧（1 行 1 値）で書いてください' }); continue }
    for (const raw of list) {
      const p = parsePattern(raw)
      if (p.error) out.problems.push({ key, raw: p.raw, error: p.error })
      else out[name].push(p)
    }
  }
  const ports = parsePortList(data?.scope_ports)
  if (ports.error) out.problems.push({ key: 'scope_ports', raw: data.scope_ports, error: ports.error })
  else out.ports = ports.ranges
  return out
}

/**
 * 対象をスコープで判定します。優先順位は deny（上書き不可）> in（scope_targets と ポート条件）> allow（例外）> out（既定でブロック）。
 * opts.ports は、テンプレートの ports 変数のように対象とは別に渡すポート（"80,443" や [[80,80]]）。
 * 返り値: { verdict, label, blocked, matched, reason, warning? }
 */
export function evaluate(canon, scope, opts = {}) {
  const sc = normalizeScope(scope)
  const done = (verdict, extra) => ({ verdict, label: VERDICT_LABELS[verdict], blocked: verdict !== 'in' && verdict !== 'allow', matched: null, ...extra })
  if (sc.problems.length) {
    const list = sc.problems.map((p) => `${p.key}: ${typeof p.raw === 'string' ? p.raw : JSON.stringify(p.raw)}（${p.error}）`).join(' / ')
    return done('invalid', { reason: `スコープ設定に解釈できない値があるため、この診断対象では実行できません: ${list}`, problems: sc.problems })
  }
  if (!canon || canon.error) return done('invalid', { reason: `対象を解釈できません: ${canon?.error || '空です'}` })

  const deny = sc.deny.find((p) => matchHost(canon, p))
  if (deny) return done('deny', { matched: deny.raw, reason: `除外リスト（scope_deny）の「${deny.raw}」に一致します。ほかの設定にかかわらず実行できません。` })

  const target = sc.targets.find((p) => matchHost(canon, p))
  let portProblem = null
  if (target) {
    portProblem = checkPorts(canon, sc.ports, opts.ports)
    if (!portProblem) return done('in', { matched: target.raw, reason: `スコープ対象（scope_targets）の「${target.raw}」に一致します。` })
  }
  const allow = sc.allow.find((p) => matchHost(canon, p))
  if (allow) return done('allow', { matched: allow.raw, reason: `例外リスト（scope_allow）の「${allow.raw}」に一致します。`, warning: ALLOW_NOTE })
  if (target) return done('out', { matched: target.raw, reason: portProblem })
  return done('out', { reason: 'どのスコープ対象（scope_targets）にも一致しません。' })
}

/** scope_ports の条件を満たさないときは理由の文を、満たすときは null を返します。 */
function checkPorts(canon, allowed, extra) {
  if (!allowed.length) return null
  const wanted = []
  if (canon.port !== null && canon.port !== undefined) wanted.push([canon.port, canon.port])
  if (extra !== undefined && extra !== null && extra !== '') {
    const parsed = Array.isArray(extra) && Array.isArray(extra[0]) ? { ranges: extra } : parsePortList(extra)
    if (parsed.error) return parsed.error
    wanted.push(...parsed.ranges)
  }
  if (!wanted.length) return `スコープのポート（scope_ports: ${fmtRanges(allowed)}）が決まっているため、ポートを指定してください。`
  const bad = wanted.filter((r) => !within(r, allowed))
  if (bad.length) return `ポート ${fmtRanges(bad)} はスコープ外です（scope_ports: ${fmtRanges(allowed)}）。`
  return null
}

/** 広すぎるパターンへの警告。保存はできますが、画面で確認してもらいます。 */
export function scopeWarnings(scope) {
  const sc = normalizeScope(scope)
  const out = []
  const SECOND_LEVEL = new Set(['co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp', 'gr.jp', 'lg.jp', 'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.kr', 'com.cn', 'com.tw', 'com.br', 'co.in'])
  for (const [key, list] of [['scope_targets', sc.targets], ['scope_allow', sc.allow]]) {
    for (const p of list) {
      const broad = p.kind === 'any'
        || (p.kind === 'wildcard' && (!p.suffix.includes('.') || SECOND_LEVEL.has(p.suffix)))
        || (p.kind === 'cidr' && ((p.version === 4 && p.bits < 16) || (p.version === 6 && p.bits < 32)))
      if (broad) out.push({ key, raw: p.raw, message: `「${p.raw}」は範囲が広すぎます。契約で合意した対象だけに絞ってください。` })
    }
  }
  return out
}

/**
 * 今日が診断期間（period_from〜period_to）に入っているか。どちらかが未記入なら入っていないとみなします。
 * today は 'YYYY-MM-DD'。
 */
export function inPeriod(data, today) {
  const ymd = (v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    const s = v === undefined || v === null ? '' : String(v).trim()
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''
  }
  const from = ymd(data?.period_from)
  const to = ymd(data?.period_to)
  if (!from || !to) return { ok: false, reason: '診断期間（開始日・終了日）が記録されていません。' }
  if (today < from) return { ok: false, reason: `診断期間の前です（${from} 〜 ${to}）。` }
  if (today > to) return { ok: false, reason: `診断期間を過ぎています（${from} 〜 ${to}）。` }
  return { ok: true, reason: `診断期間内です（${from} 〜 ${to}）。` }
}
