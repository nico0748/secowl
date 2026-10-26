// accept.sh r22-unit と reg.sh B8 の移植です。
import test from 'node:test'
import assert from 'node:assert/strict'
import { redactHttp, findLeaks, fence } from '../../shared/redact.js'

test('r22: redactHttp は Cookie と Bearer の JWT を伏せる', () => {
  const r = redactHttp('GET / HTTP/1.1\nCookie: sid=abc123\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.sig', { cookie: true, authorization: true, jwt: true })
  assert.equal(r.text.includes('abc123'), false)
  assert.equal(r.text.includes('eyJhbGci'), false)
})

test('r22: findLeaks はメールアドレスをまとめて 1 種として数える', () => {
  assert.equal(findLeaks('foo@example.com bar@corp.co.jp').length, 1)
})

test('r22: マスキング済みの値は漏れとして数えない', () => {
  const s = 'Authorization: Bearer eyJhbGciOi...（マスキング済み）\nCookie: is_admin=0\nSet-Cookie: SESSID=...; Path=/\n███@example.jp'
  assert.equal(findLeaks(s).length, 0)
})

test('r22: 実値の Cookie と JWT を 1 件ずつ検出する', () => {
  const s = 'Cookie: sid=a1b2c3d4e5f6\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl'
  assert.equal(findLeaks(s).map((x) => `${x.kind}:${x.count}`).sort().join(), 'cookie:1,jwt:1')
})

test('r22: Cookie の値をすべて伏せる', () => {
  assert.equal(redactHttp('Cookie: sid=a1b2c3d4e5f6; lang=ja', { cookie: true }).text, 'Cookie: sid=[REDACTED]; lang=[REDACTED]')
})

test('r22: fence は中身のバッククォートより長い囲みを使う', () => {
  assert.ok(fence('a\n```\nb', 'http').startsWith('````http'))
})

test('B8: findLeaks の誤検出と検出', () => {
  const k = (s) => findLeaks(s).map((x) => x.kind).sort().join() || '-'
  const cases = [
    ['https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js', '-'],
    ['logo@2x.png', '-'],
    ['contact: taro@example.co.jp', 'email'],
    ['Cookie: PHPSESSID=12345678901234567890', 'cookie'],
    ['X-Api-Key: sk_live_abcdef123456', 'secret'],
    ['GET /?access_token=abcdef123456', 'secret'],
    ['password=hunter2hunter', 'secret'],
    ['{"token":"abcdef123456"}', 'secret'],
    ['| Cookie | session=a1b2c3d4e5f6 |', 'cookie'],
    ['password=<password>', '-'],
    ['X-Api-Key: ********', '-'],
  ]
  for (const [input, want] of cases) assert.equal(k(input), want, input)
})

test('B8: redactHttp は API キーとメールを伏せる', () => {
  const r = redactHttp('X-Api-Key: sk_live_abcdef123456\n\n{"mail":"a@b.example.com"}', { secret: true, email: true })
  assert.equal(r.text.includes('sk_live'), false)
  assert.equal(r.text.includes('a@b'), false)
})
