// accept.sh b1〜b9 の移植です。Host の検査は http.request で送ります（fetch は Host を差し替えられません）。
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { seed, E } from '../helpers/seed.mjs'
import { startTestServer, raw } from '../helpers/server.mjs'

let srv
before(async () => { seed(); srv = await startTestServer() })
after(() => srv?.close())

const code = async (method, p, headers = {}, body) => (await raw(srv.baseUrl, method, p, { headers, body })).status

test('b1 自分の Host なら 200', async () => {
  assert.equal(await code('GET', '/api/meta'), 200)
})

test('b2 Host: attacker.example は 403（http.request で実際に送る）', async () => {
  const r = await raw(srv.baseUrl, 'GET', '/api/meta', { headers: { host: 'attacker.example' } })
  assert.equal(r.status, 403)
  assert.match(r.json.error, /ホスト名/)
})

test('fetch では Host を差し替えられない（だから http.request を使う）', async () => {
  const r = await fetch(srv.baseUrl + '/api/meta', { headers: { Host: 'attacker.example' } })
  assert.equal(r.status, 200)
})

test('b3 別サイトの Origin からの書き込みは 403', async () => {
  assert.equal(await code('POST', `/api/engagements/${E}/report/build`, { origin: 'https://attacker.example' }), 403)
})

test('b4 同じオリジンからの書き込みは 200', async () => {
  assert.equal(await code('POST', `/api/engagements/${E}/report/build`, { origin: srv.baseUrl }, {}), 200)
})

test('b5 同じ PC の別ポートからは 403', async () => {
  assert.equal(await code('POST', `/api/engagements/${E}/report/build`, { origin: 'http://127.0.0.1:8000' }), 403)
})

test('b6 Sec-Fetch-Site: same-site は 403', async () => {
  assert.equal(await code('POST', `/api/engagements/${E}/docs/ensure`, { 'sec-fetch-site': 'same-site' }), 403)
})

test('b7 Origin: null は 403', async () => {
  assert.equal(await code('POST', '/api/git/init', { origin: 'null' }), 403)
})

test('b8 Host なしは 403', async () => {
  assert.equal(await code('GET', '/api/meta', { host: null }), 403)
})

test('b9 静的ファイルも Host を確かめる', async () => {
  assert.equal(await code('GET', '/', { host: 'attacker.example' }), 403)
})
