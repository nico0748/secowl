// 実行ページの文言の回帰（レビューで直した 3 点）。画面そのものは test/e2e/runner.e2e.cjs（手動）で確かめます。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from '../helpers/seed.mjs'

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const run = read('src/pages/Run.tsx')
const exec = read('server/lib/exec.js')

test('「時間切れ 60 秒」のようなあいまいな表記を使わず、「60 秒で打ち切り」「実行時間の上限」と書く', () => {
  assert.doesNotMatch(run, /時間切れ\s*\{/)
  assert.doesNotMatch(run, /<dt>時間切れ<\/dt>/)
  assert.match(run, /秒で打ち切り/)
  assert.match(run, /<dt>実行時間の上限<\/dt>/)
})

test('実行できないときは、理由のあとに次の一手と「実行は押せない」ことを書く', () => {
  assert.match(run, /次にすること/)
  assert.match(run, /この対象も診断してよい場合は、契約の範囲を確かめたうえで、スコープ設定に追加してください/)
  assert.match(run, /「実行」のボタンは押せません/)
})

test('省略の文言は、行ではなく行の途中を省いたと正しく書く', () => {
  for (const src of [run, exec]) assert.doesNotMatch(src, /長すぎる行を省略しました/)
  assert.match(exec, /長すぎる行の途中を省略しました/)
})

test('使えない理由の出し分けは文字列の判定ではなく、サーバが返す種類（unavailableKind）で行う', () => {
  assert.doesNotMatch(run, /includes\('権限'\)/)
  assert.match(run, /unavailableKind === 'unsafe'/)
})
