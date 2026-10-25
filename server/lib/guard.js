/**
 * ローカル API を、同じ PC の同じオリジンからの要求だけに絞ります。
 *
 * - Host ヘッダのホスト名が 127.0.0.1 / localhost / [::1] 以外なら拒否します（DNS rebinding 対策）。
 *   Vite のプロキシは Host: 127.0.0.1:5173 のまま転送するため、この段階ではポートを見ません。
 * - 書き込み（GET / HEAD / OPTIONS 以外）は、Origin の host:port が Host と完全に一致しない場合と、
 *   Sec-Fetch-Site が same-origin / none 以外の場合に拒否します（CSRF 対策）。
 *   同じ PC の別ポート（練習用アプリや PoC の配布サーバ）から来る same-site も拒否します。
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function hostnameOf(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase()
  if (!h) return ''
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end === -1 ? h : h.slice(0, end + 1)
  }
  const i = h.indexOf(':')
  return i === -1 ? h : h.slice(0, i)
}

function deny(res, message) {
  res.status(403).json({ error: message })
}

export function localOnly(req, res, next) {
  const host = req.headers.host
  if (!host || !LOCAL_HOSTS.has(hostnameOf(host))) {
    return deny(res, 'このホスト名からの接続は受け付けません')
  }
  if (!SAFE_METHODS.has(req.method)) {
    const origin = req.headers.origin
    if (origin !== undefined) {
      let originHost = ''
      try { originHost = new URL(origin).host } catch { originHost = '' }
      if (!originHost || originHost.toLowerCase() !== String(host).trim().toLowerCase()) {
        return deny(res, '別のサイトからの書き込み要求は受け付けません')
      }
    }
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return deny(res, '別のサイトからの書き込み要求は受け付けません')
    }
  }
  next()
}
