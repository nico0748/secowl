// 導入の点検と権限の修正（S6）。本物の Homebrew は触らず、一時フォルダに同じ形の置き場所を作って確かめます。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createExec } from '../../server/lib/exec.js'
import { createSetup } from '../../server/lib/setup.js'

const SKIP = process.platform === 'win32' ? 'POSIX のみ' : false
const ONE = new Set(['faketool'])
const yes = async () => true
const mode = (p) => (fs.lstatSync(p).mode & 0o7777).toString(8).padStart(3, '0')

/** Homebrew と同じ形（bin のリンク → Cellar の実体）を作ります。 */
function tree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-setup-')))
  const cellar = path.join(root, 'prefix', 'Cellar')
  const cellarBin = path.join(cellar, 'faketool', '1.0', 'bin')
  fs.mkdirSync(cellarBin, { recursive: true })
  const real = path.join(cellarBin, 'faketool')
  fs.writeFileSync(real, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const bin = path.join(root, 'prefix', 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.symlinkSync(real, path.join(bin, 'faketool'))
  process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 片付けの失敗は結果を変えません */ } })
  return { root, bin, real, cellar }
}

/** 一時フォルダの faketool だけを見る点検。roots を一時フォルダに閉じ込めます。 */
function make(t, over = {}) {
  const exec = createExec({ allowed: ONE, searchPaths: [t.bin] })
  return createSetup({ resolve: exec.resolveProgram, allowed: ONE, roots: [t.root], ...over })
}

const lines = () => {
  const f = path.join(process.env.SECOWL_DATA, '.secowl', 'setup.jsonl')
  try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] }
}

test('ほかのユーザーが書き換えられる置き場所を見つけ、確認を経て直す', { skip: SKIP }, async () => {
  const t = tree()
  fs.chmodSync(t.cellar, 0o775)
  const setup = make(t)

  const before = setup.report()
  assert.equal(before.counts.unsafe, 1)
  assert.equal(before.programs[0].state, 'unsafe')
  assert.equal(before.programs[0].unsafeAt, t.cellar)
  assert.equal(before.fixable, 1)
  assert.equal(before.fixes[0].can, true)
  assert.equal(before.fixes[0].mode, '775')
  assert.equal(before.fixes[0].nextMode, '755')
  assert.match(before.fixes[0].command, /^chmod go-w /)

  const plan = setup.planFix()
  assert.match(plan.planId, /^fix-\d{13}-[0-9a-f]{8}$/)
  assert.deepEqual(plan.paths.map((p) => p.path), [t.cellar])

  const res = await setup.applyFix(plan.planId, { confirm: yes })
  assert.equal(res.ok, true)
  assert.deepEqual(res.failed, [])
  assert.deepEqual(res.changed, [{ path: t.cellar, from: '775', to: '755' }])
  assert.equal(mode(t.cellar), '755')

  const after = setup.report()
  assert.equal(after.programs[0].state, 'ok')
  assert.equal(after.programs[0].path, t.real)
  assert.equal(after.fixes.length, 0)
})

test('確認で「いいえ」を選ぶと、何も変えない', { skip: SKIP }, async () => {
  const t = tree()
  fs.chmodSync(t.cellar, 0o775)
  const setup = make(t)
  const plan = setup.planFix()
  const res = await setup.applyFix(plan.planId, { confirm: async () => false })
  assert.deepEqual(res, { ok: false, cancelled: true })
  assert.equal(mode(t.cellar), '775')
  assert.equal(lines().at(-1).event, 'setup.fix.cancelled')
})

test('直す範囲の外・シンボリックリンク・持ち主が違うものは、コマンドをお見せするだけ', { skip: SKIP }, async () => {
  const t = tree()
  fs.chmodSync(t.cellar, 0o775)
  // roots を Cellar の外に置くと、Cellar は「範囲の外」になります
  const setup = make(t, { roots: [path.join(t.root, 'other')] })
  const r = setup.report()
  assert.equal(r.fixable, 0)
  assert.equal(r.fixes[0].can, false)
  assert.match(r.fixes[0].why, /範囲/)
  assert.throws(() => setup.planFix(), /直せる場所はありません/)

  // 持ち主が自分でないものは sudo つきのコマンドを出します（uid を偽って確かめます）
  const notMine = make(t, { uid: (process.getuid?.() ?? 0) + 1000 })
  const f = notMine.report().fixes[0]
  assert.equal(f.can, false)
  assert.match(f.why, /持ち主/)
  assert.match(f.command, /^sudo chmod go-w /)
  assert.equal(mode(t.cellar), '775')
})

test('計画を作ったあとに置き場所が差し替わっていたら、直さない', { skip: SKIP }, async () => {
  const t = tree()
  fs.chmodSync(t.cellar, 0o775)
  const setup = make(t)
  const plan = setup.planFix()
  // 計画のあとで、同じ名前をシンボリックリンクに差し替える
  const moved = path.join(t.root, 'moved')
  fs.renameSync(t.cellar, moved)
  fs.symlinkSync(moved, t.cellar)
  await assert.rejects(() => setup.applyFix(plan.planId, { confirm: yes }), /直せる場所がなくなりました/)
  assert.equal(mode(moved), '775')
})

test('計画は 1 度だけ使え、知らない planId は断る', { skip: SKIP }, async () => {
  const t = tree()
  fs.chmodSync(t.cellar, 0o775)
  const setup = make(t)
  const plan = setup.planFix()
  assert.equal((await setup.applyFix(plan.planId, { confirm: yes })).ok, true)
  await assert.rejects(() => setup.applyFix(plan.planId, { confirm: yes }), /見つかりません/)
  await assert.rejects(() => setup.applyFix('fix-0000000000000-0000ffff', { confirm: yes }), /見つかりません/)
  await assert.rejects(() => setup.applyFix('../../etc/passwd', { confirm: yes }), /ありません/)
})

test('期限が切れた計画は使えない', { skip: SKIP }, async () => {
  const t = tree()
  fs.chmodSync(t.cellar, 0o775)
  let shift = 0
  const setup = make(t, { now: () => new Date(Date.now() + shift) })
  const plan = setup.planFix()
  shift = 3 * 60 * 1000
  await assert.rejects(() => setup.applyFix(plan.planId, { confirm: yes }), /期限/)
  assert.equal(mode(t.cellar), '775')
})

test('入っていないツールには、入れ方を出す', { skip: SKIP }, () => {
  const t = tree()
  fs.rmSync(path.join(t.bin, 'faketool'))
  const r = make(t).report()
  assert.equal(r.programs[0].state, 'missing')
  assert.equal(r.counts.missing, 1)
  // faketool は入れ方の表に無いので、どちらの手段も出しません
  assert.deepEqual(r.programs[0].install, { brew: null, go: null })

  // 本物の表は、許可したプログラムに対してコマンドを返します
  const real = createSetup({ resolve: () => ({ found: false, error: 'ありません' }) }).report()
  const ffuf = real.programs.find((p) => p.program === 'ffuf')
  assert.equal(ffuf.install.brew, 'brew install ffuf')
  assert.match(ffuf.install.go, /^go install github\.com\/ffuf\/ffuf/)
  assert.equal(real.programs.find((p) => p.program === 'whatweb').install.brew, null)
})

test('修正の記録が、前の行につながった形で残る', { skip: SKIP }, async () => {
  const t = tree()
  fs.chmodSync(t.cellar, 0o775)
  const setup = make(t)
  const before = lines().length
  await setup.applyFix(setup.planFix().planId, { confirm: yes })
  const all = lines()
  assert.equal(all.length, before + 1)
  const last = all.at(-1)
  assert.equal(last.event, 'setup.fix')
  assert.equal(last.changed[0].path, t.cellar)
  assert.equal(typeof last.prev, 'string')
  assert.equal(setup.history(1)[0].event, 'setup.fix')
})
