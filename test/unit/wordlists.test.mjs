// ワードリストの取得（S6）。本物の GitHub には触れず、手元の HTTP サーバと手元のリポジトリを相手にします。
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createJobRunner } from '../../server/lib/setup-job.js'
import { createWordlists } from '../../server/lib/wordlists.js'
import { FILES, SOURCE } from '../../server/lib/wordlist-catalog.js'

const SKIP = process.platform === 'win32' ? 'POSIX のみ' : false
const yes = async () => true
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

/** 表に書いたハッシュと長さに合う中身を作ります（本物の中身は要りません）。 */
function bodyFor(f) {
  // 表のハッシュに合う中身は作れないので、テストでは表の方をこの中身に合わせます。
  const text = `# ${f.id}\n${Array.from({ length: 20 }, (_, i) => `${f.id}-${i}`).join('\n')}\n`
  return Buffer.from(text)
}

/** 代役の取得元。/<commit>/<表の path> を返します。 */
function serve(bodies, { fail } = {}) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url || '').replace(`/${SOURCE.commit}/`, '')
    if (fail?.has(rel)) { res.writeHead(404); res.end('no'); return }
    const buf = bodies.get(rel)
    if (!buf) { res.writeHead(404); res.end('no'); return }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(buf)
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` })))
}

/** 表の sha256 を、代役の中身のものに置き換えた写しを作ります（本物の中身は持ちません）。 */
function catalogFor(bodies) {
  return FILES.map((f) => ({ ...f, sha256: sha256(bodies.get(f.path)) }))
}

function tmpHome() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-wl-')))
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 片付けの失敗は結果を変えません */ } })
  return dir
}

const finished = async (wlSvc, runner, ms = 15000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const j = runner.current()
    if (j && j.status !== 'running') return j
    await sleep(20)
  }
  throw new Error('終わりませんでした')
}

const lines = () => {
  const f = path.join(process.env.SECOWL_DATA, '.secowl', 'setup.jsonl')
  try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] }
}

/** 代役の取得元つきの一式。 */
async function make(over = {}) {
  const bodies = new Map(FILES.map((f) => [f.path, bodyFor(f)]))
  const { srv, base } = await serve(bodies, over)
  const home = tmpHome()
  const runner = createJobRunner({ killGraceMs: 200 })
  const catalog = over.catalog || catalogFor(bodies)
  const svc = createWordlists({ env: { HOME: home }, raw: base, runner, catalog, ...over.cfg })
  const close = () => { srv.closeAllConnections?.(); srv.close() }
  return { svc, runner, home, base, bodies, catalog, close }
}

test('まだ無いときは「ありません」、取ったあとは「あります」', { skip: SKIP }, async () => {
  const t = await make()
  try {
    const before = t.svc.report()
    assert.equal(before.dir, path.join(t.home, 'wordlists'))
    assert.equal(before.missing, FILES.length)
    assert.deepEqual(before.files.map((f) => f.state), FILES.map(() => 'missing'))
    assert.equal(before.full.present, false)
    assert.deepEqual(before.available, [])

    const p = t.svc.plan({ ids: FILES.map((f) => f.id) })
    assert.match(p.planId, /^wl-\d{13}-[0-9a-f]{8}$/)
    assert.equal(p.files.length, FILES.length)
    assert.ok(p.files[0].url.startsWith(t.base), '取得先は表から組み立てる')

    assert.equal((await t.svc.start(p.planId, { confirm: yes })).ok, true)
    const job = await finished(t.svc, t.runner)
    assert.equal(job.status, 'done')
    assert.equal(job.kind, 'setup.wordlists')

    const after = t.svc.report()
    assert.equal(after.missing, 0)
    assert.deepEqual(after.files.map((f) => f.state), FILES.map(() => 'ok'))
    // 実行の入力で選べる形でも返します
    assert.deepEqual(after.available.map((a) => a.name).sort(), FILES.map((f) => f.saveAs).sort())
    assert.equal(fs.readFileSync(path.join(t.home, 'wordlists', FILES[0].saveAs), 'utf8'), t.bodies.get(FILES[0].path).toString())
    assert.equal(lines().at(-1).event, 'setup.wordlists.end')
  } finally { t.close() }
})

test('中身が表と違えば保存しない', { skip: SKIP }, async () => {
  // 表のハッシュだけを変えて、取ったものと合わなくします
  const bogus = FILES.map((f, i) => ({ ...f, sha256: i === 0 ? 'f'.repeat(64) : 'e'.repeat(64) }))
  const t = await make({ catalog: bogus })
  try {
    const f = FILES[0]
    const p = t.svc.plan({ ids: [f.id] })
    await t.svc.start(p.planId, { confirm: yes })
    const job = await finished(t.svc, t.runner)
    assert.equal(job.status, 'failed')
    assert.match(job.steps[0].error, /中身が、表に書いたものと違います/)
    assert.equal(fs.existsSync(path.join(t.home, 'wordlists', f.saveAs)), false, '中途半端なファイルを残さない')
    assert.deepEqual(fs.readdirSync(path.join(t.home, 'wordlists')), [], '途中のファイルも残さない')
  } finally { t.close() }
})

test('取れなかったものがあっても、残りは取る', { skip: SKIP }, async () => {
  const t = await make({ fail: new Set([FILES[0].path]) })
  try {
    const p = t.svc.plan({ ids: FILES.map((f) => f.id) })
    await t.svc.start(p.planId, { confirm: yes })
    const job = await finished(t.svc, t.runner)
    assert.equal(job.status, 'failed')
    assert.equal(job.steps[0].status, 'failed')
    assert.match(job.steps[0].error, /404/)
    assert.deepEqual(job.steps.slice(1).map((s) => s.status), FILES.slice(1).map(() => 'done'))
    assert.equal(t.svc.report().missing, 1)
  } finally { t.close() }
})

test('確認で「いいえ」を選ぶと、何も取らない', { skip: SKIP }, async () => {
  const t = await make()
  try {
    const p = t.svc.plan({ ids: [FILES[0].id] })
    assert.deepEqual(await t.svc.start(p.planId, { confirm: async () => false }), { ok: false, cancelled: true })
    assert.equal(t.runner.current(), null)
    assert.equal(fs.existsSync(path.join(t.home, 'wordlists')), false, '置き場所も作らない')
    assert.equal(lines().at(-1).event, 'setup.wordlists.cancelled')
  } finally { t.close() }
})

test('表にないもの・空の指定・使い終わった計画は断る', { skip: SKIP }, async () => {
  const t = await make()
  try {
    assert.throws(() => t.svc.plan({ ids: ['../../etc/passwd'] }), /取得できるワードリストにありません/)
    assert.throws(() => t.svc.plan({ ids: [] }), /選んでください/)
    const p = t.svc.plan({ ids: [FILES[0].id] })
    await t.svc.start(p.planId, { confirm: yes })
    await finished(t.svc, t.runner)
    await assert.rejects(() => t.svc.start(p.planId, { confirm: yes }), /見つかりません/)
    await assert.rejects(() => t.svc.start('wl-0000000000000-0000ffff', { confirm: yes }), /見つかりません/)
    await assert.rejects(() => t.svc.start('../../etc/passwd', { confirm: yes }), /ありません/)
  } finally { t.close() }
})

test('SecLists 全体は git clone で取り、すでにあるときは断る', { skip: SKIP }, async () => {
  const t = await make()
  try {
    // 手元に、タグを打った小さなリポジトリを作って取得元にします（表に合わせて .git で終わる名前にします）
    const origin = path.join(t.home, 'origin.git')
    fs.mkdirSync(origin, { recursive: true })
    fs.writeFileSync(path.join(origin, 'README.md'), '# fake SecLists\n')
    const git = (...a) => execFileSync('git', a, { cwd: origin, stdio: 'pipe' })
    git('init', '-q', '-b', 'main')
    git('add', '-A')
    git('commit', '-q', '-m', 'first')
    git('tag', SOURCE.tag)

    // git は、権限の緩い場所（CI の /opt/homebrew/bin など）にあると動かさない決まりなので、
    // 本物に渡すだけの代役を、このテストの一時フォルダに置いて使います。
    const gitDir = path.join(t.home, 'gitbin')
    fs.mkdirSync(gitDir, { mode: 0o755 })
    const realGit = execFileSync('sh', ['-c', 'command -v git']).toString().trim()
    fs.writeFileSync(path.join(gitDir, 'git'), `#!/bin/sh\nexec ${realGit} "$@"\n`, { mode: 0o755 })
    fs.chmodSync(path.join(gitDir, 'git'), 0o755)

    t.svc.configure({ repo: origin.replace(/\.git$/, ''), gitPaths: [gitDir] })
    const p = t.svc.plan({ full: true })
    assert.equal(p.files.length, 0)
    assert.match(p.full.command, new RegExp(`^git clone --depth 1 --branch ${SOURCE.tag} `))
    assert.equal(p.full.dir, path.join(t.home, 'wordlists', 'SecLists'))

    await t.svc.start(p.planId, { confirm: yes })
    const job = await finished(t.svc, t.runner, 30000)
    assert.equal(job.status, 'done', job.output)
    assert.equal(fs.existsSync(path.join(t.home, 'wordlists', 'SecLists', 'README.md')), true)
    assert.equal(t.svc.report().full.present, true)

    // 2 度目は断ります（上書きしません）
    assert.throws(() => t.svc.plan({ full: true }), /すでにあります/)
  } finally { t.close() }
})

test('git が見つからなければ、全体の取得はしない', { skip: SKIP }, async () => {
  const t = await make()
  try {
    t.svc.configure({ gitPaths: [path.join(t.home, 'no-such')] })
    assert.throws(() => t.svc.plan({ full: true }), /git が見つかりません/)
  } finally { t.close() }
})

test('このPCにあるワードリストを、入力の候補として返す', { skip: SKIP }, async () => {
  const t = await make()
  try {
    const dir = path.join(t.home, 'wordlists', 'mine')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'own.txt'), 'a\nb\n')
    fs.writeFileSync(path.join(dir, 'own.lst'), 'c\n')
    fs.writeFileSync(path.join(dir, 'notes.md'), '# 対象外\n')
    fs.writeFileSync(path.join(t.home, 'wordlists', '.hidden.txt'), 'x\n')
    const got = t.svc.available()
    assert.deepEqual(got.map((g) => g.name).sort(), ['mine/own.lst', 'mine/own.txt'])
    assert.equal(got[0].path, path.join(dir, 'own.lst'))
  } finally { t.close() }
})
