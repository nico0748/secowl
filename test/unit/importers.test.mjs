import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseToolOutput, detectFormat } from '../../server/lib/importers.js'

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const read = (n) => fs.readFileSync(path.join(FX, n), 'utf8')

test('nmap XML: ホストと開いているポートだけ', () => {
  const r = parseToolOutput(read('nmap.xml'), 'auto')
  assert.equal(r.format, 'nmap')
  const ports = r.surfaces.filter((s) => s.kind === 'port').map((s) => s.value).sort()
  assert.deepEqual(ports, ['198.51.100.11:80', 'app.example.com:22', 'app.example.com:443'])
  assert.equal(r.surfaces.filter((s) => s.kind === 'host').length, 2)
  const https = r.surfaces.find((s) => s.value === 'app.example.com:443')
  assert.equal(https.product, 'nginx 1.25.3')
  assert.deepEqual(https.tech, ['TLS'])
  assert.equal(r.findings.length, 0)
})

test('httpx JSONL: エンドポイント 2 件', () => {
  const r = parseToolOutput(read('httpx.jsonl'), 'auto')
  assert.equal(r.format, 'httpx')
  assert.deepEqual(r.surfaces.map((s) => s.value), ['https://app.example.com', 'http://api.example.com'])
  assert.equal(r.surfaces[0].service, 'https')
  assert.equal(r.surfaces[0].port, 443)
})

test('nuclei JSONL: 発見事項と、curl をコードブロックに閉じ込めた根拠', () => {
  const r = parseToolOutput(read('nuclei.jsonl'), 'auto')
  assert.equal(r.format, 'nuclei')
  assert.equal(r.findings.length, 2)
  const xss = r.findings.find((f) => f.vuln_name === 'Reflected XSS')
  assert.equal(xss.severity, 'high')
  assert.equal(xss.cvss_score, 6.1)
  assert.equal(xss.identifier, 'cwe-79')
  // 中身に ``` があるので、それより長い囲みを使う
  assert.match(xss.evidenceText, /````bash\ncurl -X GET/)
  assert.ok(xss.evidenceText.includes('説明: Reflected input without encoding'))
  assert.equal(r.findings.find((f) => f.vuln_name === 'Nginx Detect').severity, 'info')
})

test('ffuf JSON', () => {
  const r = parseToolOutput(read('ffuf.json'), 'auto')
  assert.equal(r.format, 'ffuf')
  assert.deepEqual(r.surfaces.map((s) => s.value), ['https://app.example.com/admin', 'https://app.example.com/backup.zip'])
})

test('gobuster 標準出力: Url を前に付ける', () => {
  const r = parseToolOutput(read('gobuster.txt'), 'auto')
  assert.equal(r.format, 'gobuster')
  assert.deepEqual(r.surfaces.map((s) => s.value), ['https://app.example.com/admin', 'https://app.example.com/login', 'https://app.example.com/static'])
})

test('サブドメイン一覧: 小文字にそろえ、重複をまとめる', () => {
  const r = parseToolOutput(read('subdomains.txt'), 'auto')
  assert.equal(r.format, 'subdomains')
  assert.deepEqual(r.surfaces.map((s) => s.value).sort(), ['api.example.com', 'app.example.com', 'staging.example.com'])
})

test('判定できない内容はエラー', () => {
  assert.equal(detectFormat('hello world!'), null)
  assert.throws(() => parseToolOutput('hello world!', 'auto'), /形式を判定できませんでした/)
})
