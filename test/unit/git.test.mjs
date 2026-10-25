// 保存先の Git 設定（.gitignore）。以前のバージョンで作った保存先でも、ツールの生の出力が追跡に乗らないことを確かめます。
// 保存先（SECOWL_DATA）は test/helpers/env.mjs が作る一時フォルダで、このファイルだけが使います。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createEngagement, engDir, secowlDir } from '../../server/lib/store.js'
import * as gitlib from '../../server/lib/git.js'

let hasGit = true
try { execFileSync('git', ['--version'], { stdio: 'ignore' }) } catch { hasGit = false }
const SKIP = hasGit ? false : 'git がありません'

const ROOT = () => process.env.SECOWL_DATA
const sh = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: ROOT(), encoding: 'utf8' })
const reset = () => {
  fs.rmSync(ROOT(), { recursive: true, force: true })
  fs.mkdirSync(ROOT(), { recursive: true })
}
const putRaw = (eid, { nested = false } = {}) => {
  const raw = path.join(engDir(eid), '20-調査', '取得データ')
  fs.mkdirSync(raw, { recursive: true })
  fs.writeFileSync(path.join(raw, 'run-1760000000000-0123abcd.xml'), '<nmaprun><!-- Cookie: sid=abcdef1234567890 --></nmaprun>')
  const run = path.join(secowlDir(eid), 'run', 'run-1760000000000-0123abcd')
  fs.mkdirSync(run, { recursive: true })
  fs.writeFileSync(path.join(run, 'job.json'), '{}')
  fs.writeFileSync(path.join(run, 'by-product.txt'), 'x')
  // 診断対象の中の .secowl/.gitignore に頼らず、保存先の .gitignore だけで防げることを見る
  if (!nested) fs.rmSync(path.join(secowlDir(eid), '.gitignore'), { force: true })
}
const tracked = () => sh('ls-files').split('\n').filter(Boolean)

const OLD_IGNORE = '# SecOwl — 保存先リポジトリ\n.DS_Store\n\n# 証跡\n*/evidence/\n'

test('P2-4: 新しく作る保存先は、生の出力と実行の作業場所を最初から除外する', { skip: SKIP }, async () => {
  reset()
  createEngagement({ name: 'fresh' })
  const st = await gitlib.init()
  assert.equal(st.isRepo, true)
  const gi = fs.readFileSync(path.join(ROOT(), '.gitignore'), 'utf8')
  assert.ok(gi.includes('*/20-調査/取得データ/') && gi.includes('*/.secowl/run/'))
  assert.deepEqual(st.ignoreMissing, [])
})

test('P2-4: 以前のバージョンで作った .gitignore にも、足りない行を追記する（利用者の行は残す・重ねない）', { skip: SKIP }, async () => {
  reset()
  createEngagement({ name: 'old' })
  sh('init', '-b', 'main')
  fs.writeFileSync(path.join(ROOT(), '.gitignore'), `${OLD_IGNORE}my-notes/`)
  putRaw('old')
  let st = await gitlib.status()
  assert.deepEqual(st.ignoreMissing, ['*/20-調査/取得データ/', '*/.secowl/run/'])

  st = await gitlib.init()
  const gi = fs.readFileSync(path.join(ROOT(), '.gitignore'), 'utf8')
  assert.ok(gi.startsWith(OLD_IGNORE), '利用者が書いた行はそのまま')
  assert.ok(gi.includes('my-notes/'))
  assert.deepEqual(st.ignoreMissing, [])
  // もう一度呼んでも重ならない
  await gitlib.init()
  assert.equal(fs.readFileSync(path.join(ROOT(), '.gitignore'), 'utf8'), gi)
  assert.equal((gi.match(/\*\/\.secowl\/run\//g) || []).length, 1)

  await gitlib.commit({ message: 'test' })
  const files = tracked()
  assert.equal(files.some((f) => f.includes('取得データ')), false, `生の出力が追跡されている: ${files}`)
  assert.equal(files.some((f) => f.includes('/run/')), false)
  assert.ok(files.includes('.gitignore'))
})

test('P2-4: init を通さずに commit しても、足りない行を足してから add -A する', { skip: SKIP }, async () => {
  reset()
  createEngagement({ name: 'selfinit' })
  sh('init', '-b', 'main') // 利用者が自分で git init した保存先（.gitignore なし）
  putRaw('selfinit')
  await gitlib.commit({ message: 'test' })
  const files = tracked()
  assert.equal(files.some((f) => f.includes('取得データ')), false, `生の出力が追跡されている: ${files}`)
  assert.equal(files.some((f) => f.includes('.secowl/run/')), false)
  assert.ok(files.some((f) => f.endsWith('engagement.json')), '通常のファイルは追跡される')
})

test('P2-4: すでに追跡されている生の出力は、状態に件数を出して知らせる', { skip: SKIP }, async () => {
  reset()
  createEngagement({ name: 'leaked' })
  sh('init', '-b', 'main')
  putRaw('leaked')
  sh('add', '-A', '-f')
  sh('commit', '-m', 'old')
  const st = await gitlib.status()
  assert.ok(st.rawTracked >= 2, `rawTracked=${st.rawTracked}`)
})

test('P2-4: 診断対象の .secowl/.gitignore に run/ が無ければ足す（ids/ だけだった以前の版）', () => {
  reset()
  createEngagement({ name: 'nested' })
  const gi = path.join(secowlDir('nested'), '.gitignore')
  fs.writeFileSync(gi, '# SecOwl\nids/\n')
  secowlDir('nested')
  const rules = fs.readFileSync(gi, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  assert.deepEqual(rules, ['ids/', 'run/'])
  secowlDir('nested')
  assert.deepEqual(fs.readFileSync(gi, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')), ['ids/', 'run/'])
})
