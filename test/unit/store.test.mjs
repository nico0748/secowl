// S1（書き込みの競合検知）の store 単体テストです。
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  createEngagement, createFinding, readDoc, writeDoc, toggleChecklist, docPaths, resolveFile, fieldKey,
} from '../../server/lib/store.js'
import { fileVersion, writeFileAtomic, parseSections } from '../../server/lib/md.js'

const EID = 's1-test'
let findingRel

before(() => {
  createEngagement({ name: EID, client: '株式会社テスト', period_from: '2026-11-01', period_to: '2026-11-30' })
  findingRel = createFinding(EID, { vuln_name: '競合テスト' }).file
})

/** Obsidian や MCP の書き込みを、ファイルを直接書き換えて再現します。 */
function externalEdit(rel, fn) {
  const abs = resolveFile(rel)
  fs.writeFileSync(abs, fn(fs.readFileSync(abs, 'utf8')))
}

const expectStale = (fn) => {
  try { fn() } catch (err) {
    assert.equal(err.code, 'STALE_WRITE', String(err.message))
    return err
  }
  assert.fail('STALE_WRITE になりませんでした')
}

test('readDoc は version と見出しごとの版を返す', () => {
  const d = readDoc(findingRel)
  assert.match(d.version, /^[0-9a-f]{16}$/)
  assert.equal(d.version, fileVersion(d.raw))
  assert.match(d.sectionVersions['再現手順'], /^[0-9a-f]{16}$/)
})

test('古い baseVersion の書き込みは STALE_WRITE で、current は新しい版。同じ版なら成功', () => {
  const d = readDoc(findingRel)
  externalEdit(findingRel, (t) => t.replace('## 再現手順', '## 再現手順\n\nObsidian で追記'))
  const err = expectStale(() => writeDoc(findingRel, { data: { target: 'a' }, baseVersion: d.version }))
  assert.notEqual(err.current.version, d.version)
  assert.deepEqual(err.conflicts, [{ file: true }])
  assert.equal(readDoc(findingRel).data.target, '')
  const ok = writeDoc(findingRel, { data: { target: 'a' }, baseVersion: err.current.version })
  assert.equal(ok.data.target, 'a')
  assert.notEqual(ok.version, err.current.version)
})

test('base を何も渡さなければ従来どおり後勝ち', () => {
  externalEdit(findingRel, (t) => t.replace(/^target: .*$/m, 'target: external'))
  assert.equal(writeDoc(findingRel, { data: { target: 'mine' } }).data.target, 'mine')
})

test('baseSections: 別の見出しだけが外で変わったときは衝突にせず適用する', () => {
  const d = readDoc(findingRel)
  externalEdit(findingRel, (t) => t.replace('## 対策\n', '## 対策\n\nMCP が追記した対策\n'))
  const out = writeDoc(findingRel, {
    sections: [{ heading: '再現手順', content: '1. 画面で書いた手順' }],
    baseVersion: d.version,
    baseSections: { 再現手順: d.sectionVersions['再現手順'] },
    baseFields: {},
  })
  assert.ok(out.sections.find((s) => s.heading === '再現手順').content.includes('画面で書いた手順'))
  assert.ok(out.sections.find((s) => s.heading === '対策').content.includes('MCP が追記した対策'))
})

test('baseSections: 同じ見出しが外で変わったときは conflicts に見出しを入れる', () => {
  const d = readDoc(findingRel)
  externalEdit(findingRel, (t) => t.replace('1. 画面で書いた手順', '1. Obsidian で直した手順'))
  const err = expectStale(() => writeDoc(findingRel, {
    sections: [{ heading: '再現手順', content: '1. 画面で書いた手順（続き）' }],
    baseSections: { 再現手順: d.sectionVersions['再現手順'] },
  }))
  assert.deepEqual(err.conflicts, [{ heading: '再現手順' }])
  assert.ok(err.current.body.includes('Obsidian で直した手順'))
  assert.ok(readDoc(findingRel).body.includes('Obsidian で直した手順'))
})

test('baseSections: 読んだときに無かった見出し（null）は、いまも無ければ追加できる', () => {
  const out = writeDoc(findingRel, { sections: [{ heading: '新しい見出し', content: 'x' }], baseSections: { 新しい見出し: null } })
  assert.equal(out.sections.find((s) => s.heading === '新しい見出し').content, 'x')
  expectStale(() => writeDoc(findingRel, { sections: [{ heading: '新しい見出し', content: 'y' }], baseSections: { 新しい見出し: null } }))
})

test('baseFields: 同じ欄の変更だけを衝突にする', () => {
  const d = readDoc(findingRel)
  externalEdit(findingRel, (t) => t.replace(/^wstg_id: .*$/m, 'wstg_id: WSTG-ATHZ-04'))
  const ok = writeDoc(findingRel, { data: { target: 'b' }, baseFields: { target: d.data.target } })
  assert.equal(ok.data.target, 'b')
  assert.equal(ok.data.wstg_id, 'WSTG-ATHZ-04')
  externalEdit(findingRel, (t) => t.replace(/^target: .*$/m, 'target: external-2'))
  const err = expectStale(() => writeDoc(findingRel, { data: { target: 'c' }, baseFields: { target: 'b' } }))
  assert.deepEqual(err.conflicts, [{ field: 'target' }])
})

test('baseFields: YAML の日付と ISO 形式の文字列は同じ値として比べる', () => {
  const scope = docPaths(EID).scope
  const d = readDoc(scope)
  assert.ok(d.data.period_from instanceof Date || typeof d.data.period_from === 'string')
  // ブラウザには JSON（ISO 形式）で届き、それが base として戻ってくる
  const base = JSON.parse(JSON.stringify(d.data.period_from))
  assert.equal(fieldKey(base), '2026-11-01')
  const out = writeDoc(scope, { data: { period_from: '2026-11-02' }, baseFields: { period_from: base } })
  assert.equal(fieldKey(out.data.period_from), '2026-11-02')
})

test('CRLF のファイルでも見出しを拾い、LF/CRLF の差だけでは版が変わらない', () => {
  const abs = resolveFile(findingRel)
  const lf = fs.readFileSync(abs, 'utf8')
  const vLf = readDoc(findingRel).version
  fs.writeFileSync(abs, '﻿' + lf.replace(/\n/g, '\r\n'))
  const d = readDoc(findingRel)
  assert.equal(d.version, vLf)
  assert.ok(d.sections.some((s) => s.heading === '再現手順'))
  assert.equal(d.sections.length, parseSections(lf.split(/^---\n[\s\S]*?\n---\n/m).pop()).length)
  // 書き戻すと LF にそろう
  writeDoc(findingRel, { data: { target: 'crlf' }, baseVersion: vLf })
  assert.equal(fs.readFileSync(abs, 'utf8').includes('\r'), false)
})

test('原子的な書き込み: 一時ファイルを残さず、expectVersion が違えば置き換えない', () => {
  const abs = resolveFile(findingRel)
  const dir = path.dirname(abs)
  const before = fs.readFileSync(abs, 'utf8')
  assert.throws(() => writeFileAtomic(abs, 'broken', { expectVersion: 'deadbeefdeadbeef' }), (e) => e.code === 'STALE_WRITE')
  assert.equal(fs.readFileSync(abs, 'utf8'), before)
  writeFileAtomic(abs, before, { expectVersion: fileVersion(before) })
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('secowl-tmp')), [])
})

test('チェックリスト: 文言が一致すれば切り替え、行がずれていたら同じ文言の項目を探し直す', () => {
  const rel = docPaths(EID).checklist
  const items = readDoc(rel).checklist
  const target = items.find((c, i) => items.findIndex((x) => x.text === c.text) === i && items.filter((x) => x.text === c.text).length === 1)
  const ok = toggleChecklist(rel, target.line, true, target.text)
  assert.equal(ok.checklist.find((c) => c.text === target.text).checked, true)
  // Obsidian で先頭に 1 行足して、行番号がずれる
  externalEdit(rel, (t) => t.replace(/\n## /, '\n- [ ] 先頭に足した項目\n\n## '))
  const shifted = toggleChecklist(rel, target.line, false, target.text)
  assert.equal(shifted.checklist.find((c) => c.text === target.text).checked, false)
  assert.equal(shifted.checklist.find((c) => c.text === '先頭に足した項目').checked, false)
})

test('チェックリスト: 文言が見つからなければ STALE_WRITE で、何も切り替えない', () => {
  const rel = docPaths(EID).checklist
  const before = fs.readFileSync(resolveFile(rel), 'utf8')
  const item = readDoc(rel).checklist[0]
  const err = expectStale(() => toggleChecklist(rel, item.line, true, 'この文言の項目はありません'))
  assert.ok(err.current.checklist.length > 0)
  assert.equal(fs.readFileSync(resolveFile(rel), 'utf8'), before)
})
