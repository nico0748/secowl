// S1・S4: MCP のツール（mcp/tools.js）を直接呼んで、base_version と関門のキーの拒否を確かめます。
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ALL_TOOLS } from '../../mcp/tools.js'
import { createEngagement, createFinding, readDoc, docPaths, resolveFile } from '../../server/lib/store.js'

const EID = 'mcp-test'
const tool = (name) => ALL_TOOLS.find((t) => t.name === name)
const run = async (name, args) => tool(name).handler(args)
const call = async (name, args) => {
  const res = await tool(name).handler(args)
  return JSON.parse(res.content[0].text)
}

let finding
before(() => {
  createEngagement({ name: EID })
  finding = createFinding(EID, { vuln_name: 'MCP テスト' }).file
})

test('update_doc: vs-scope の scope_* と承認のキーは書けない', async () => {
  const scope = docPaths(EID).scope
  const before = fs.readFileSync(resolveFile(scope), 'utf8')
  for (const data of [
    { scope_allow: ['0.0.0.0/0'] },
    { scope_targets: ['*.example.com'] },
    { SCOPE_DENY: [] },
    { agreed: true },
    { agreed_at: '2026-10-25' },
    { agreed_by: 'エージェント' },
    { type: 'note' },
  ]) {
    await assert.rejects(() => run('update_doc', { file: scope, data }), /MCP からは変更できません/, JSON.stringify(data))
  }
  assert.equal(fs.readFileSync(resolveFile(scope), 'utf8'), before)
  // 関門でないキーは書ける
  const ok = await call('update_doc', { file: scope, data: { status: 'draft' } })
  assert.equal(ok.data.status, 'draft')
})

test('update_doc: スコープ文書以外の文書に type: vs-scope と関門のキーを足すことも拒否する', async () => {
  await assert.rejects(() => run('update_doc', { file: finding, data: { type: 'vs-scope', scope_allow: ['0.0.0.0/0'] } }), /MCP からは変更できません/)
})

test('update_doc: 古い base_version は失敗し、最新の version を知らせる。正しい版なら成功', async () => {
  const d = readDoc(finding)
  const abs = resolveFile(finding)
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace('## 対策\n', '## 対策\n\n人が追記\n'))
  const now = readDoc(finding).version
  await assert.rejects(
    () => run('update_doc', { file: finding, data: { target: 'x' }, base_version: d.version }),
    (err) => err.message.includes(`最新の version: ${now}`),
  )
  const ok = await call('update_doc', { file: finding, data: { target: 'x' }, base_version: now })
  assert.equal(ok.data.target, 'x')
  // base_version なしは従来どおり
  assert.equal((await call('update_doc', { file: finding, data: { target: 'y' } })).data.target, 'y')
})

test('set_checklist_item: line だけでは切り替えず、文言で確かめる', async () => {
  const items = readDoc(docPaths(EID).checklist).checklist
  const item = items.find((c) => items.filter((x) => x.text === c.text).length === 1)
  await assert.rejects(() => run('set_checklist_item', { engagement: EID, line: item.line, checked: true }), /text/)
  await assert.rejects(() => run('set_checklist_item', { engagement: EID, line: item.line, text: 'ちがう文言', checked: true }), /get_checklist で読み直してください/)
  const ok = await call('set_checklist_item', { engagement: EID, line: item.line, text: item.text, checked: true })
  assert.equal(ok.checklist.find((c) => c.text === item.text).checked, true)
  const ok2 = await call('set_checklist_item', { engagement: EID, text: item.text, checked: false })
  assert.equal(ok2.checklist.find((c) => c.text === item.text).checked, false)
})

test('export_report: スコープ文書を上書きする書き出し先は拒否する', async () => {
  const scopeAbs = resolveFile(docPaths(EID).scope)
  await assert.rejects(() => run('export_report', { engagement: EID, format: 'markdown', out_path: scopeAbs }), /書き出せません|拡張子|exports/)
  await assert.rejects(() => run('export_report', { engagement: EID, format: 'markdown', out_path: path.join(process.env.SECOWL_TEST_TMP, 'other', '00-診断対象', 'スコープとRoE.md') }), /書き出せません/)
  await assert.rejects(() => run('export_report', { engagement: EID, format: 'docx', out_path: path.join(process.env.SECOWL_TEST_TMP, 'a.md') }), /拡張子/)
  const out = await call('export_report', { engagement: EID, format: 'markdown', out_path: path.join(process.env.SECOWL_TEST_TMP, 'out', 'report.md') })
  assert.ok(fs.existsSync(out.path))
})
