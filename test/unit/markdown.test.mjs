// accept.sh a5 と reg.sh の md()（B1・B5・B10）の移植です。
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../../shared/markdown.js'

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
