import http from 'node:http'

/**
 * テスト用にサーバを空いているポートで起動します。
 * 後片付けは closeAllConnections → close の順です（keep-alive の接続が残ると close が終わらないため）。
 */
export async function startTestServer() {
  const { startServer } = await import('../../server/app.js')
  const { server, port, url } = await startServer({ port: 0 })
  return {
    server,
    port,
    baseUrl: url,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}

/**
 * http.request で送ります。fetch（undici）は Host ヘッダを差し替えられないため、Host の検査はこちらを使います。
 * headers に host: null を渡すと Host ヘッダを送りません。
 */
export function raw(baseUrl, method, urlPath, { headers = {}, body } = {}) {
  const u = new URL(urlPath, baseUrl)
  return new Promise((resolve, reject) => {
    const h = { ...headers }
    const omitHost = Object.prototype.hasOwnProperty.call(h, 'host') && h.host === null
    if (omitHost) delete h.host
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    if (payload !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json'
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h, setHost: !omitHost,
      agent: false,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        const text = buf.toString('utf8')
        let json
        try { json = JSON.parse(text) } catch { json = undefined }
        resolve({ status: res.statusCode, headers: res.headers, text, json, buf })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/** JSON API の小さなクライアント。同一オリジンの要求として送ります。 */
export function client(baseUrl) {
  const go = async (method, p, body) => {
    const res = await fetch(new URL(p, baseUrl), {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: res.status, json, text, headers: res.headers }
  }
  return {
    get: (p) => go('GET', p),
    post: (p, b = {}) => go('POST', p, b),
    put: (p, b = {}) => go('PUT', p, b),
    del: (p) => go('DELETE', p),
  }
}

export const enc = encodeURIComponent
