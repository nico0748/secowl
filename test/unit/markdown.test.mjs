// accept.sh a5 と reg.sh の md()（B1・B5・B10）の移植です。
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../../shared/markdown.js'
import { parseSections } from '../../server/lib/md.js'

const md = (s) => renderMarkdown(s)

test('a5: vs コメントは消え、外部リンクは別タブ・noopener', () => {
  assert.equal(md('<!-- vs:x -->\n[a](https://e.example)').trim(), '<p><a href="https://e.example" target="_blank" rel="noopener noreferrer">a</a></p>')
})

test('B1: コメントに挟まれた文字は残る', () => {
  assert.equal(md('<!-- a --> X <!-- b -->').split('\n').filter((l) => l.includes('X')).length, 1)
})

test('B1: コメントだけの行は空になる', () => {
  assert.equal(md('<!-- only -->').length, 0)
})

test('B5: 自動リンクの & は 1 回だけエスケープする', () => {
  assert.equal(/href="[^"]*"/.exec(md('<https://a.example/?x=1&y=2>'))[0], 'href="https://a.example/?x=1&amp;y=2"')
})

test('B5: title の & も 1 回だけ', () => {
  assert.equal(/title="[^"]*"/.exec(md('[a](https://a.example "A & B")'))[0], 'title="A &amp; B"')
})

test('B10: 外部画像は img にせずリンクにする', () => {
  const out = md('![x](https://evil.example/a.png)')
  assert.equal(out.includes('<img'), false)
  assert.ok(out.includes('外部画像'))
})

test('a: 生の HTML とスクリプト URL を無害化する', () => {
  const out = md('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://a.example/"onmouseover="alert(1))')
  assert.equal(out.includes('<img src=x onerror'), false)
  assert.equal(out.includes('href="javascript:'), false)
  assert.equal(out.includes('" onmouseover="'), false)
})

test('P3-16: parseSections は、長い囲みの中の ``` の行や ## を、囲みの終わりにも見出しにもしない', () => {
  const body = '## 出力\n\n````\nline1\n```\n## 偽の見出し\nline2\n````\n\n## 読み取ったこと\n本文'
  const sections = parseSections(body)
  assert.deepEqual(sections.map((s) => s.heading), ['出力', '読み取ったこと'])
  assert.ok(sections[0].content.includes('## 偽の見出し') && sections[0].content.includes('line2'))
  assert.equal(sections[1].content, '本文')
})

test('P3-16: parseSections は、同じ行で開いて閉じる ``` を囲みにせず、通常の 3 連の囲みと閉じていない囲みは従来どおり扱う', () => {
  assert.deepEqual(parseSections('## A\n```code```\n## B\n```bash\n## 中\n```\n## C').map((s) => s.heading), ['A', 'B', 'C'])
  // 閉じていない囲みは、そこから先を見出しにしない（従来と同じ）
  assert.deepEqual(parseSections('## A\n```\n## B').map((s) => s.heading), ['A'])
  // 短い囲みでは閉じない（4 連で開いたら 4 連以上で閉じる）
  assert.deepEqual(parseSections('## A\n````\n```\n## B\n```\n## C').map((s) => s.heading), ['A'])
})
