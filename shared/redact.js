/**
 * HTTP のやり取りや本文から、伏せるべき値（Cookie・Authorization・JWT・メールアドレス）を扱います。
 * クライアント（貼り付けダイアログ・警告）とサーバ（共有前の点検）の両方から使います。
 */

/** コードブロックを作ります。区切りは、本文中で最も長いバッククォートの連続 + 1（最低 3）。 */
export function fence(text, lang = '') {
  const body = String(text ?? '').replace(/\n+$/, '')
  let longest = 0
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  const tick = '`'.repeat(Math.max(3, longest + 1))
  return `${tick}${lang}\n${body}\n${tick}`
}

const REDACTED = '[REDACTED]'

/** 伏せ字とみなす表記を含むか。 */
export function isMasked(value) {
  const v = String(value ?? '')
  return /\[REDACTED\]|<redacted>|\.\.\.|…|\*{3,}|x{4,}|█|（マスキング済み）|\(masked\)|伏せ字/i.test(v)
}

const JWT_RE = /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/g
// TLD は英字 2 文字以上（jquery@3.4.1 のような版番号を拾わないため）。
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g
// logo@2x.png のようなファイル名を拾わないよう、拡張子に見える末尾は除きます。
const FILE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp|js|mjs|cjs|css|map|html?|json|txt|md|xml|pdf|zip|woff2?|ttf)$/i
const SAFE_EMAIL_DOMAIN = /(^|\.)example\.(com|jp|org|net)$/i
// Cookie の値の区切り。行末まで取ると説明文を値として拾うため、空白・; ・,・` で止めます。
const COOKIE_PAIR_RE = /([^\s=;,`]+)=([^\s;,`]*)/g
// 「Cookie: …」のほか、Markdown の表に書いた「| Cookie | … |」も対象にします。
const COOKIE_HEADER_RE = /(?:^|[^\w-])((?:Set-)?Cookie)\s*(?::|\|)[ \t]*([^\n]*)/gi
// API キーやトークンを運ぶヘッダ
const SECRET_HEADER_RE = /(?:^|[^\w-])(X-(?:Api-Key|Auth-Token|Access-Token|Amz-Security-Token|Csrf-Token|Session-Token)|Api-Key)\s*:[ \t]*([^\s`|]+)/gi
// クエリ・フォームの値（access_token=… / password=…）
const SECRET_PARAM_RE = /(?:^|[^\w-])(access_token|refresh_token|id_token|api_key|apikey|token|password|passwd|pwd|secret|client_secret)=([^\s&"'`;,|)]+)/gi
// JSON の値（"token": "…" / "password": "…"）
const SECRET_JSON_RE = /"([^"\n]*(?:token|password|passwd|secret|api_?key)[^"\n]*)"\s*:\s*"([^"\n]+)"/gi
const AUTH_HEADER_RE = /(?:^|[^\w-])((?:Proxy-)?Authorization)\s*:[ \t]*([^\n]*)/gi
const SET_COOKIE_ATTRS = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly', 'priority', 'partitioned'])

function sampleOf(v) {
  const s = String(v)
  return s.length <= 8 ? s : `${s.slice(0, 8)}${'*'.repeat(Math.min(12, s.length - 8))}`
}

function isJwt(v) {
  JWT_RE.lastIndex = 0
  const m = JWT_RE.exec(String(v))
  JWT_RE.lastIndex = 0
  return !!m && m.index === 0
}

/** Authorization の値から資格情報の部分を取り出します（Bearer / Basic などのスキーム名の後ろ）。 */
function credentialOf(value) {
  const m = /^(\S+)\s+(\S+)/.exec(String(value).trim())
  if (m) return m[2].replace(/[`'"]+$/, '')
  return String(value).trim().split(/\s/)[0].replace(/[`'"]+$/, '')
}

function isRealEmail(src, m) {
  const [local, domain] = m[0].split('@')
  if (SAFE_EMAIL_DOMAIN.test(domain)) return false
  if (isMasked(local)) return false
  if (FILE_EXT.test(m[0])) return false
  if (m.index > 0 && src[m.index - 1] === '/') return false // /npm/pkg@1.2.3 のような URL の一部
  return true
}

/**
 * 伏せていない可能性がある値を数えます。
 * 返り値は種類ごとの { kind, count, sample }。sample は先頭 8 文字だけを残し、残りを伏せた文字列です。
 */
export function findLeaks(text) {
  const src = String(text ?? '')
  const found = new Map()
  const add = (kind, value) => {
    const cur = found.get(kind)
    if (cur) cur.count++
    else found.set(kind, { kind, count: 1, sample: sampleOf(value) })
  }

  for (const m of src.matchAll(COOKIE_HEADER_RE)) {
    for (const p of m[2].matchAll(COOKIE_PAIR_RE)) {
      const value = p[2]
      if (isMasked(value) || isJwt(value)) continue // JWT は jwt として数えます
      // 16 文字以上なら文字の種類を問わず、8 文字以上なら英字と数字の両方を含むものを数えます（is_admin=0 は数えない）。
      const long = value.length >= 16
      const mixed = value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value)
      if (!long && !mixed) continue
      add('cookie', value)
    }
  }

  const secret = (value) => {
    const v = String(value).replace(/^["']|["']$/g, '')
    if (v.length < 6 || isMasked(v) || isJwt(v)) return
    if (/^[<{[]|^\$\{|^%[A-Z_]+%$/.test(v)) return // <password> や {{token}} などの雛形
    add('secret', v)
  }
  for (const m of src.matchAll(SECRET_HEADER_RE)) secret(m[2])
  for (const m of src.matchAll(SECRET_PARAM_RE)) secret(m[2])
  for (const m of src.matchAll(SECRET_JSON_RE)) secret(m[2])

  for (const m of src.matchAll(AUTH_HEADER_RE)) {
    const rest = m[2]
    if (isMasked(rest)) continue
    const cred = credentialOf(rest)
    if (!cred || cred.length < 8 || isMasked(cred)) continue
    if (isJwt(cred)) continue // JWT の形なら jwt としてだけ数えます
    add('authorization', cred)
  }

  for (const m of src.matchAll(JWT_RE)) {
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 3)
    if (after.startsWith('...') || after.startsWith('…')) continue
    if (isMasked(m[0])) continue
    add('jwt', m[0])
  }

  for (const m of src.matchAll(EMAIL_RE)) {
    if (!isRealEmail(src, m)) continue
    add('email', m[0])
  }

  return [...found.values()]
}

/**
 * HTTP のやり取りから、選んだ種類の値を長さに関係なくすべて伏せます。
 * Cookie は名前を残して値だけを、Authorization はスキーム名を残して資格情報だけを伏せます。
 */
export function redactHttp(text, opts = {}) {
  let out = String(text ?? '')
  const hits = new Map()
  const hit = (kind, n = 1) => hits.set(kind, (hits.get(kind) || 0) + n)

  if (opts.cookie) {
    out = out.replace(/^([ \t]*((?:Set-)?Cookie)[ \t]*:[ \t]*)(.*)$/gim, (_, head, name, rest) => {
      const isSet = /^set-/i.test(name)
      let first = true
      const next = rest.replace(COOKIE_PAIR_RE, (pair, k, v) => {
        const attr = isSet && !first && SET_COOKIE_ATTRS.has(k.toLowerCase())
        first = false
        if (attr || v === REDACTED) return pair
        hit('cookie')
        return `${k}=${REDACTED}`
      })
      return head + next
    })
  }

  if (opts.authorization) {
    out = out.replace(/^([ \t]*(?:Proxy-)?Authorization[ \t]*:[ \t]*)(.*)$/gim, (_, head, rest) => {
      const m = /^(\S+)(\s+)(.+)$/.exec(rest)
      if (m) {
        if (m[3].trim() === REDACTED) return head + rest
        hit('authorization')
        return `${head}${m[1]}${m[2]}${REDACTED}`
      }
      if (!rest.trim() || rest.trim() === REDACTED) return head + rest
      hit('authorization')
      return head + REDACTED
    })
  }

  if (opts.jwt) {
    out = out.replace(JWT_RE, () => { hit('jwt'); return REDACTED })
  }

  if (opts.secret) {
    const mask = (whole, value) => {
      if (value === REDACTED) return whole
      hit('secret')
      return whole.slice(0, whole.lastIndexOf(value)) + REDACTED + whole.slice(whole.lastIndexOf(value) + value.length)
    }
    out = out.replace(SECRET_HEADER_RE, (whole, _k, v) => mask(whole, v))
    out = out.replace(SECRET_PARAM_RE, (whole, _k, v) => mask(whole, v))
    out = out.replace(SECRET_JSON_RE, (whole, _k, v) => mask(whole, v))
  }

  if (opts.email) {
    out = out.replace(EMAIL_RE, (whole, ...rest) => {
      const index = rest[rest.length - 2]
      const src = rest[rest.length - 1]
      if (FILE_EXT.test(whole) || (index > 0 && src[index - 1] === '/')) return whole
      hit('email')
      return REDACTED
    })
  }

  for (const term of opts.terms || []) {
    const t = String(term).trim()
    if (!t) continue
    const parts = out.split(t)
    if (parts.length > 1) {
      hit('term', parts.length - 1)
      out = parts.join(REDACTED)
    }
  }

  return { text: out, hits: [...hits.entries()].map(([kind, count]) => ({ kind, count })) }
}
