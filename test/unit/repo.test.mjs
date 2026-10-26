// reg.sh R7 の移植です。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { ROOT } from '../helpers/seed.mjs'

test('R7 コンパイル済みの Python をリポジトリに入れていない', (t) => {
  let files
  try { files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }) } catch { return t.skip('git がありません') }
  assert.equal(files.split('\n').filter((f) => f.endsWith('.pyc')).length, 0)
})
