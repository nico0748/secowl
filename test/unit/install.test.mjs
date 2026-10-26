// 導入の実行（S6）。本物の Homebrew や Go は動かさず、同じ名前の代役を一時フォルダに作って確かめます。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInstall } from '../../server/lib/install.js'
import { createJobRunner } from '../../server/lib/setup-job.js'

const SKIP = process.platform === 'win32' ? 'POSIX のみ' : false
const yes = async () => true
const no = async () => false
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * brew の代役。`install <名前>` を受け、名前に応じてふるまいを変えます。
 *   ok-*     すぐ終わる        ng-*  終了コード 3   slow-*  10 秒待つ
 */
const BREW = `#!${process.execPath}
const what = process.argv[3] || ''
process.stdout.write('==> Fetching ' + what + '\\n')
process.stdout.write('\\u001b[32m==> Pouring\\u001b[0m 10%\\r==> Pouring 100%\\n')
if (what.startsWith('ng')) { process.stderr.write('Error: No available formula\\n'); process.exit(3) }
if (what.startsWith('slow')) { setTimeout(() => process.exit(0), 10000); return }
process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n')
process.stdout.write('PATH:' + process.env.PATH + '\\n')
process.stdout.write('GOBIN:' + (process.env.GOBIN || '') + '\\n')
process.stdout.write('ENV:' + JSON.stringify(Object.keys(process.env).sort()) + '\\n')
process.exit(0)
`

/** brew だけを置いた一時フォルダ（go はわざと置きません）。 */
function bin() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-install-')))
  fs.mkdirSync(path.join(dir, 'bin'), { mode: 0o755 })
  const file = path.join(dir, 'bin', 'brew')
  fs.writeFileSync(file, BREW, { mode: 0o755 })
  fs.chmodSync(file, 0o755)
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 片付けの失敗は結果を変えません */ } })
  return { root: dir, bin: path.join(dir, 'bin') }
}

/**
 * 代役だけを見る導入。ffuf と nmap を入れてよいことにします（入れ方の表はそのまま使います）。
 * 作業を動かす仕組みはワードリストの取得と共有するものなので、ここでもテスト用に 1 つ作って渡し、
 * 進み具合（current）と中止（stop）はそちらを見ます。
 */
function make(t, over = {}) {
  const { killGraceMs, ...rest } = over
  const runner = createJobRunner({ killGraceMs })
  const ins = createInstall({ searchPaths: [t.bin], allowed: new Set(['ffuf', 'nmap', 'whatweb']), env: { ...process.env, PATH: t.bin }, runner, ...rest })
  return { ...ins, current: runner.current, stop: runner.stop }
}

const finished = async (ins, ms = 15000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const j = ins.current()
    if (j && j.status !== 'running') return j
    await sleep(20)
  }
  throw new Error('終わりませんでした')
}

const lines = () => {
  const f = path.join(process.env.SECOWL_DATA, '.secowl', 'setup.jsonl')
  try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] }
}

test('入っているものと入っていないものを分け、入っていない方には入れ方を出す', { skip: SKIP }, () => {
  const t = bin()
  const list = make(t).installers()
  const brew = list.find((i) => i.name === 'brew')
  const go = list.find((i) => i.name === 'go')
  assert.equal(brew.state, 'ok')
  assert.equal(brew.path, path.join(t.bin, 'brew'))
  assert.equal(go.state, 'missing')
  assert.match(go.hint, /go\.dev/)
})

test('ほかのユーザーが書き換えられる場所にある brew は動かさず、直す場所として返す', { skip: SKIP }, async () => {
  const t = bin()
  fs.chmodSync(t.bin, 0o775)
  const ins = make(t)
  const brew = ins.installers().find((i) => i.name === 'brew')
  assert.equal(brew.state, 'unsafe')
  assert.equal(brew.unsafeAt, t.bin)
  assert.deepEqual(ins.unsafePaths(), [t.bin])
  assert.throws(() => ins.plan({ programs: ['ffuf'], via: 'brew' }), /書き換えられる/)
  fs.chmodSync(t.bin, 0o755)
})

test('計画からコマンドを組み立て、確認を経て順に入れる', { skip: SKIP }, async () => {
  const t = bin()
  const ins = make(t)
  const p = ins.plan({ programs: ['ffuf', 'nmap'], via: 'brew' })
  assert.match(p.planId, /^ins-\d{13}-[0-9a-f]{8}$/)
  assert.deepEqual(p.steps.map((s) => s.command), ['brew install ffuf', 'brew install nmap'])
  assert.equal(p.installerPath, path.join(t.bin, 'brew'))

  let asked = null
  const res = await ins.start(p.planId, { confirm: async (req) => { asked = req; return true } })
  assert.equal(res.ok, true)
  assert.deepEqual(asked.commands, ['brew install ffuf', 'brew install nmap'])
  assert.equal(asked.installerPath, path.join(t.bin, 'brew'))

  const job = await finished(ins)
  assert.equal(job.status, 'done')
  assert.deepEqual(job.steps.map((s) => s.status), ['done', 'done'])
  // 画面に出る形: コマンドの行と、整えた出力
  assert.match(job.output, /\$ brew install ffuf/)
  assert.match(job.output, /==> Fetching ffuf/)
  // 端末の色指定は落とし、\r の進捗は最後の表示だけにする
  assert.doesNotMatch(job.output, /\u001b\[/)
  assert.match(job.output, /==> Pouring 100%/)
  assert.doesNotMatch(job.output, /Pouring 10%/)
  // 引数は固定表から組み立てる（画面からは渡らない）
  assert.match(job.output, /ARGV:\["install","ffuf"\]/)
  // 入れたものが実行ファイルの探索先に入るよう、置き場所を決めて渡す
  assert.match(job.output, new RegExp(`GOBIN:${path.join(os.homedir(), 'go', 'bin')}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('確認で「いいえ」を選ぶと、何も動かさない', { skip: SKIP }, async () => {
  const t = bin()
  const ins = make(t)
  const p = ins.plan({ programs: ['ffuf'], via: 'brew' })
  assert.deepEqual(await ins.start(p.planId, { confirm: no }), { ok: false, cancelled: true })
  assert.equal(ins.current(), null)
  assert.equal(lines().at(-1).event, 'setup.install.cancelled')
})

test('入れ方の表にないもの・許していないものは、計画を作らない', { skip: SKIP }, () => {
  const t = bin()
  const ins = make(t)
  // whatweb は Homebrew の formula が無い
  assert.throws(() => ins.plan({ programs: ['whatweb'], via: 'brew' }), /Homebrew では入れられません/)
  // 実行を許可していないプログラム
  assert.throws(() => ins.plan({ programs: ['curl'], via: 'brew' }), /実行を許可した/)
  // 入れ方は brew か go だけ
  assert.throws(() => ins.plan({ programs: ['ffuf'], via: 'pip' }), /Homebrew か Go/)
  assert.throws(() => ins.plan({ programs: [], via: 'brew' }), /選んでください/)
  // go は入っていない
  assert.throws(() => ins.plan({ programs: ['ffuf'], via: 'go' }), /見つかりません/)
})

test('計画は 1 度だけ使え、知らない planId は断る', { skip: SKIP }, async () => {
  const t = bin()
  const ins = make(t)
  const p = ins.plan({ programs: ['ffuf'], via: 'brew' })
  assert.equal((await ins.start(p.planId, { confirm: yes })).ok, true)
  await finished(ins)
  await assert.rejects(() => ins.start(p.planId, { confirm: yes }), /見つかりません/)
  await assert.rejects(() => ins.start('ins-0000000000000-0000ffff', { confirm: yes }), /見つかりません/)
  await assert.rejects(() => ins.start('../../etc/passwd', { confirm: yes }), /ありません/)
})

test('途中で失敗しても残りは続け、どれが失敗したかを返す', { skip: SKIP }, async () => {
  const t = bin()
  // ng- で始まる名前にするため、入れ方の表の代わりに nmap → ng を返す代役を使います
  const ins = make(t)
  const p = ins.plan({ programs: ['ffuf'], via: 'brew' })
  // ffuf の引数を直接差し替えることはできないので、代役側で失敗する名前を使います
  fs.writeFileSync(path.join(t.bin, 'brew'), BREW.replace("process.argv[3] || ''", "'ng-' + (process.argv[3] || '')"), { mode: 0o755 })
  fs.chmodSync(path.join(t.bin, 'brew'), 0o755)
  await ins.start(p.planId, { confirm: yes })
  const job = await finished(ins)
  assert.equal(job.status, 'failed')
  assert.equal(job.steps[0].status, 'failed')
  assert.equal(job.steps[0].exitCode, 3)
  assert.match(job.output, /No available formula/)
  assert.equal(lines().at(-1).event, 'setup.install.end')
  assert.equal(lines().at(-1).status, 'failed')
})

test('中止すると、動いているものを止めて残りも動かさない', { skip: SKIP }, async () => {
  const t = bin()
  fs.writeFileSync(path.join(t.bin, 'brew'), BREW.replace("process.argv[3] || ''", "'slow-' + (process.argv[3] || '')"), { mode: 0o755 })
  fs.chmodSync(path.join(t.bin, 'brew'), 0o755)
  const ins = make(t, { killGraceMs: 200 })
  const p = ins.plan({ programs: ['ffuf', 'nmap'], via: 'brew' })
  await ins.start(p.planId, { confirm: yes })
  await sleep(300)
  assert.equal(ins.current().status, 'running')
  ins.stop(p.planId)
  const job = await finished(ins)
  assert.equal(job.status, 'stopped')
  assert.equal(job.steps[1].status, 'stopped')
  assert.throws(() => ins.stop('ins-0000000000000-0000ffff'), /ありません/)
})

test('時間切れになったら止める', { skip: SKIP }, async () => {
  const t = bin()
  fs.writeFileSync(path.join(t.bin, 'brew'), BREW.replace("process.argv[3] || ''", "'slow-' + (process.argv[3] || '')"), { mode: 0o755 })
  fs.chmodSync(path.join(t.bin, 'brew'), 0o755)
  const ins = make(t, { stepTimeoutMs: 400, killGraceMs: 200 })
  const p = ins.plan({ programs: ['ffuf'], via: 'brew' })
  await ins.start(p.planId, { confirm: yes })
  const job = await finished(ins)
  assert.equal(job.status, 'failed')
  assert.equal(job.steps[0].status, 'timeout')
  assert.match(job.output, /過ぎたので止めます/)
})
