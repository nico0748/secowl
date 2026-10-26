#!/usr/bin/env node
/**
 * MCP サーバ（mcp/server.js）を stdio で起動し、主要なツールの振る舞いを確かめます。
 *
 *   SECOWL_DATA=$(mktemp -d) node scripts/seed-mock.js
 *   SECOWL_DATA=<同じパス> node scripts/check-mcp.mjs
 *
 * 実データに書き込まないよう、SECOWL_DATA が無いときは何もしません。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const E = process.env.SECOWL_ENGAGEMENT || '2026-10-example-shop'

if (!process.env.SECOWL_DATA) {
  console.error('SECOWL_DATA を一時フォルダに設定してから実行してください（実データへの書き込みを防ぐため）。')
  process.exit(2)
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'mcp', 'server.js')],
  // SECOWL_DATA を子プロセスへ引き継ぎます。
  env: { ...process.env },
  stderr: 'ignore',
})
const client = new Client({ name: 'secowl-check', version: '1.0.0' })
await client.connect(transport)

let failed = 0
const results = []
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed++
}

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args })
  const text = res.content?.[0]?.text ?? ''
  if (res.isError) throw new Error(`${name}: ${text}`)
  try { return JSON.parse(text) } catch { return text }
}

try {
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name)
  check('ツールの数が 39', names.length === 39, `${names.length}`)

  // R2-0(c): 仮の深刻度 → 基本値を入れると追従する
  const created = await call('create_finding', { engagement: E, vuln_name: 'MCP 深刻度テスト', severity: 'high' })
  const before = await call('read_doc', { file: created.file })
  check('create_finding: 基本値なしの severity は仮の値（cvss）', before.data.severity === 'high' && before.data.severity_source === 'cvss',
    `${before.data.severity}/${before.data.severity_source}`)
  const after = await call('update_doc', { file: created.file, data: { cvss_score: 5.0 } })
  check('update_doc: cvss_score 5.0 で medium になる', after.data.severity === 'medium', after.data.severity)
  check('update_doc: cvss_score は数値のまま', typeof after.data.cvss_score === 'number', typeof after.data.cvss_score)

  // 読み込んだ frontmatter をそのまま送り返しても manual にならない
  const round = await call('update_doc', { file: created.file, data: after.data })
  check('update_doc: 読んだ値の送り返しで manual にならない', round.data.severity_source === 'cvss', round.data.severity_source)

  // R2-3: search の返り値は file / line / text を含み、id と title の一致が先に並ぶ
  const hits = await call('search', { engagement: E, query: 'fnd-0003' })
  check('search: file / line / text を返す', Array.isArray(hits) && hits.length > 0 && ['file', 'line', 'text'].every((k) => k in hits[0]))
  check('search: 先頭が fnd-0003', hits[0]?.id === 'fnd-0003', hits[0]?.id)

  // R2-1: build_report は included / excluded を返す
  const built = await call('build_report', { engagement: E })
  check('build_report: included と excluded を返す', typeof built.included === 'number' && Array.isArray(built.excluded),
    `${built.included} / ${built.excluded?.length}`)

  // R2-2: check_report
  const rc = await call('check_report', { engagement: E })
  check('check_report: included / excluded / leaks', ['included', 'excluded', 'leaks'].every((k) => k in rc))

  // R2-4: update_engagement
  const ue = await call('update_engagement', { engagement: E, target_system: 'MCP から更新した対象' })
  check('update_engagement: 同期した文書を返す', Array.isArray(ue.synced) && ue.synced.length === 2 && ue.id === E, `${ue.synced?.length}`)
} catch (err) {
  check('例外なく完了する', false, String(err.message || err))
} finally {
  await client.close()
}

console.log(results.join('\n'))
console.log(failed ? `\n${failed} 件が失敗しました` : '\nすべて成功しました')
process.exit(failed ? 1 : 0)
