import test from 'node:test'
import assert from 'node:assert/strict'
import { localOnly, hostnameOf } from '../../server/lib/guard.js'

function run(method, headers) {
  let status = 200
  let nextCalled = false
  const res = { status(c) { status = c; return this }, json() { return this } }
  localOnly({ method, headers }, res, () => { nextCalled = true })
  return nextCalled ? 'next' : status
}

test('hostnameOf', () => {
  assert.equal(hostnameOf('127.0.0.1:5174'), '127.0.0.1')
  assert.equal(hostnameOf('[::1]:80'), '[::1]')
  assert.equal(hostnameOf('LocalHost'), 'localhost')
  assert.equal(hostnameOf(''), '')
})

test('Host が手元以外なら 403', () => {
  assert.equal(run('GET', { host: '127.0.0.1:5174' }), 'next')
  assert.equal(run('GET', { host: 'localhost:5174' }), 'next')
  assert.equal(run('GET', { host: '[::1]:5174' }), 'next')
  assert.equal(run('GET', { host: 'attacker.example' }), 403)
  assert.equal(run('GET', { host: '127.0.0.1.attacker.example' }), 403)
  assert.equal(run('GET', {}), 403)
})

test('書き込みは Origin が Host と一致し、Sec-Fetch-Site が same-origin / none のときだけ', () => {
  const host = '127.0.0.1:5174'
  assert.equal(run('POST', { host }), 'next')
  assert.equal(run('POST', { host, origin: 'http://127.0.0.1:5174' }), 'next')
  assert.equal(run('POST', { host, origin: 'http://127.0.0.1:8000' }), 403)
  assert.equal(run('POST', { host, origin: 'https://attacker.example' }), 403)
  assert.equal(run('POST', { host, origin: 'null' }), 403)
  assert.equal(run('POST', { host, 'sec-fetch-site': 'same-site' }), 403)
  assert.equal(run('POST', { host, 'sec-fetch-site': 'cross-site' }), 403)
  assert.equal(run('PUT', { host, 'sec-fetch-site': 'same-origin' }), 'next')
  assert.equal(run('DELETE', { host, 'sec-fetch-site': 'none' }), 'next')
  // 読み取りは Origin を見ない
  assert.equal(run('GET', { host, origin: 'https://attacker.example' }), 'next')
})
