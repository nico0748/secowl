// コマンドランナー（S5）。本物のネットワークツールは起動せず、test/helpers/fake-tool.cjs を呼ぶだけの
// 実行ファイル（fakenmap）を allow-list に足した createExec の設定で動かします（テスト用の設定は configure で入れます。
// HTTP・環境変数からは届きません）。setHostBridge はモジュール内の単一の変数なので、実行系のテストはこの 1 ファイルにまとめます。
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { seed, E } from '../helpers/seed.mjs'
import { startTestServer, client, raw } from '../helpers/server.mjs'
import { makeBin, RAW_COMMANDS } from '../helpers/exec-fixture.mjs'

const SKIP = process.platform === 'win32' ? 'POSIX のみ' : false
const KEY = 'test-session-key-0123456789abcdef'

let srv, api, app, exec, bin
const fixedStart = new Date(2026, 9, 10, 12, 0, 0).getTime()
const offset = fixedStart - Date.now()
let clockShift = 0
const now = () => new Date(Date.now() + offset + clockShift)
const auth = { 'x-secowl-exec': KEY }
const DATA = () => process.env.SECOWL_DATA
const abs = (rel) => path.join(DATA(), rel)
const confirmYes = async () => true

const waitFor = async (cond, ms = 5000, what = '条件') => {
  const end = Date.now() + ms
  for (;;) {
    const v = await cond()
    if (v) return v
    if (Date.now() > end) throw new Error(`${what} が ${ms}ms 以内に満たされませんでした`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const scopeFile = () => `${E}/00-診断対象/スコープとRoE.md`
async function setScope(patch) {
  const r = await api.put('/api/doc', { file: scopeFile(), data: patch })
  assert.equal(r.status, 200, JSON.stringify(r.json))
}
const GOOD_SCOPE = {
  scope_targets: ['*.example.com', '198.51.100.0/24'], scope_allow: ['10.10.0.0/16'], scope_deny: ['payment.example.com'], scope_ports: [],
  agreed: true, agreed_at: '2026-09-29', agreed_by: '情報システム部 部長 鈴木', period_from: '2026-10-05', period_to: '2026-10-16',
}

const planReq = (cmdId, values, eid = E) => raw(srv.baseUrl, 'POST', `/api/engagements/${eid}/exec/plan`, { headers: auth, body: { slug: 'fake', cmdId, values } })
const plan = async (cmdId, values) => {
  const r = await planReq(cmdId, values)
  assert.equal(r.status, 200, r.text)
  return r.json
}
const launch = (p, confirm = confirmYes) => exec.launch(E, p.planId, { confirm })
const finished = async (jobId) => {
  const job = exec.getJob(E, jobId)
  await job.finished
  return job
}
const run = async (cmdId, values) => {
  const p = await plan(cmdId, values)
  const res = await launch(p)
  assert.equal(res.ok, true)
  return { p, job: await finished(res.jobId) }
}
const readLog = (job) => fs.readFileSync(abs(job.logFile), 'utf8')
const auditLines = () => fs.readFileSync(path.join(DATA(), E, '.secowl', 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const alive = (pgid) => { try { process.kill(-pgid, 0); return true } catch (e) { return e.code !== 'ESRCH' } }

before(async () => {
  seed()
  const m = await import('../../server/app.js')
  app = m
  exec = m.execService
  bin = makeBin()
  srv = await startTestServer()
  api = client(srv.baseUrl)
  await setScope(GOOD_SCOPE)
})
after(async () => {
  await exec?.killAll({ waitMs: 3000 })
  app?.setHostBridge(null)
  await srv?.close()
})

/* ---------------- ブラウザ運用では存在しない ---------------- */

test('ブラウザ運用（ホスト橋渡しなし）では、実行系のルートはすべて 404', { skip: SKIP }, async () => {
  app.setHostBridge(null)
  for (const [method, p] of [
    ['GET', '/api/exec/templates'],
    ['POST', `/api/engagements/${E}/exec/plan`],
    ['GET', `/api/engagements/${E}/exec`],
    ['GET', `/api/engagements/${E}/exec/audit`],
    ['GET', `/api/engagements/${E}/exec/run-1760000000000-0123abcd/stream`],
    ['POST', `/api/engagements/${E}/exec/run-1760000000000-0123abcd/stop`],
    ['POST', `/api/engagements/${E}/exec/run-1760000000000-0123abcd/import`],
  ]) {
    // 鍵を付けても付けなくても 404（存在を示さない）
    for (const headers of [{}, auth]) {
      const r = await raw(srv.baseUrl, method, p, { headers, body: method === 'POST' ? {} : undefined })
      assert.equal(r.status, 404, `${method} ${p}`)
      assert.deepEqual(r.json, { error: 'not found' })
    }
  }
})

/* ---------------- 認可と、起動ルートが HTTP に無いこと ---------------- */

test('セッション鍵が無い・誤りなら 403、正しければ通る。起動のルートは HTTP に無い', { skip: SKIP }, async () => {
  app.setHostBridge({ execSession: KEY })
  exec.configure({ allowed: new Set(['fakenmap', 'fakehttpx']), searchPaths: [bin], now, killGraceMs: 300, drainMs: 300, concurrency: 2,
    lookup: async () => [{ address: '198.51.100.7' }],
    templates: () => [{ slug: 'fake', name: 'fake', phase: ['survey'], commands: [] }] })
  const { parseCommands } = await import('../../server/lib/command-templates.js')
  const parsed = parseCommands(RAW_COMMANDS, { allowed: new Set(['fakenmap', 'fakehttpx']) })
  assert.deepEqual(parsed.errors, [])
  exec.configure({ templates: () => [{ slug: 'fake', name: 'フェイク', phase: ['survey'], commands: parsed.commands }] })

  assert.equal((await raw(srv.baseUrl, 'GET', '/api/exec/templates')).status, 403)
  assert.equal((await raw(srv.baseUrl, 'GET', '/api/exec/templates', { headers: { 'x-secowl-exec': 'wrong' } })).status, 403)
  assert.equal((await raw(srv.baseUrl, 'GET', '/api/exec/templates', { headers: { 'x-secowl-exec': KEY + 'x' } })).status, 403)
  assert.equal((await raw(srv.baseUrl, 'POST', `/api/engagements/${E}/exec/plan`, { body: {} })).status, 403)
  // 鍵は URL では受け付けない
  assert.equal((await raw(srv.baseUrl, 'GET', `/api/exec/templates?key=${KEY}&t=${KEY}`)).status, 403)
  const ok = await raw(srv.baseUrl, 'GET', '/api/exec/templates', { headers: auth })
  assert.equal(ok.status, 200)
  assert.equal(ok.json[0].slug, 'fake')
  assert.equal(ok.json[0].commands.find((c) => c.id === 'echo').available, true)
  // 起動を受ける HTTP ルートは作っていない
  for (const p of ['launch', 'run', 'start']) {
    for (const base of [`/api/engagements/${E}/exec/${p}`, `/api/exec/${p}`]) {
      const r = await raw(srv.baseUrl, 'POST', base, { headers: auth, body: { planId: 'x' } })
      assert.ok([404, 403].includes(r.status), `${base} → ${r.status}`)
      assert.equal(r.json?.jobId, undefined)
    }
  }
  assert.equal((await raw(srv.baseUrl, 'POST', `/api/engagements/no-such/exec/plan`, { headers: auth, body: {} })).status, 404)
  // CORS は入れない
  assert.equal(ok.headers['access-control-allow-origin'], undefined)
})

/* ---------------- 値の検査と正規化 ---------------- */

test('plan は判定値と引数に同じ正規化済みの対象を使い、危険な入力は 422', { skip: SKIP }, async () => {
  const rows = [
    ['app.example.com', 'app.example.com', 'in'],
    ['ＡＰＰ.example.com', 'app.example.com', 'in'],
    ['App.Example.COM.', 'app.example.com', 'in'],
    ['a.b.example.com', 'a.b.example.com', 'in'],
    ['198.51.100.9', '198.51.100.9', 'in'],
    ['http://[::ffff:198.51.100.1]/', 'http://198.51.100.1/', 'in'],
    ['payment.example.com', 'payment.example.com', 'deny'],
    ['ＰＡＹＭＥＮＴ.example.com', 'payment.example.com', 'deny'],
    ['payment.example.com.', 'payment.example.com', 'deny'],
    ['10.10.3.4', '10.10.3.4', 'allow'],
    ['evil.test', 'evil.test', 'out'],
    ['example.com', 'example.com', 'out'],
    ['h:443', 'h:443', 'out'],
  ]
  for (const [input, target, verdict] of rows) {
    const p = await plan('plain', { target: input })
    assert.equal(p.target, target, input)
    assert.equal(p.scopeVerdict, verdict, input)
    assert.deepEqual(p.argv, [target], `${input}: 引数に入る値が判定値と同じ`)
    assert.equal(p.blocked, verdict === 'out' || verdict === 'deny', input)
    assert.equal(p.inputTarget === null, input === target, input)
  }
  for (const bad of ['-oNx.example.com', '-iL', '010.0.0.1', '2130706433', '0x7f.1', 'a.example.com b.example.com', 'a.example.com,b.example.com',
    '198.51.100.0/24', '*.example.com', 'http://u:p@app.example.com/', 'a\nb.example.com', '', 'file:///etc/passwd']) {
    const r = await planReq('plain', { target: bad })
    assert.equal(r.status, 422, `${JSON.stringify(bad)} → ${r.status} ${r.text}`)
  }
  assert.equal((await planReq('plain', { target: ['app.example.com'] })).status, 422)
  assert.equal((await planReq('plain', { target: 'app.example.com', extra: '1' })).status, 422)
  assert.equal((await planReq('nope', { target: 'app.example.com' })).status, 404)
})

test('変数の値が - で始まるものは、種類を問わず拒否する（text・ports・target）', { skip: SKIP }, async () => {
  for (const word of ['-oX', '--script=x', '-', '--']) assert.equal((await planReq('text', { target: 'app.example.com', word })).status, 422, word)
  for (const word of ['a b', 'a;b', '$(id)', '`id`', 'a|b']) assert.equal((await planReq('text', { target: 'app.example.com', word })).status, 422, word)
  assert.equal((await planReq('ports', { target: 'app.example.com', ports: '-80' })).status, 422)
  assert.equal((await planReq('ports', { target: 'app.example.com', ports: '80,-1' })).status, 422)
  assert.equal((await planReq('ports', { target: 'app.example.com', ports: '80;id' })).status, 422)
  const ok = await plan('text', { target: 'app.example.com', word: 'common.txt' })
  assert.deepEqual(ok.argv, ['--echo-env', 'common.txt', 'app.example.com'])
})

/* ---------------- スコープ・承認・期間による拒否 ---------------- */

test('スコープ外・除外・承認なし・期間外・壊れたスコープは、plan が blocked で launch も拒否する', { skip: SKIP }, async () => {
  const refused = async (p, status = 403) => {
    assert.equal(p.blocked, true)
    await assert.rejects(launch(p), (e) => e.status === status)
  }
  // スコープ外 / 除外
  for (const t of ['evil.test', 'payment.example.com']) {
    const p = await plan('plain', { target: t })
    await refused(p)
    assert.ok(p.reason.length > 0)
  }
  // 承認がそろっていない
  await setScope({ agreed: false })
  let p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.scopeVerdict, 'in')
  assert.equal(p.agreed, false)
  assert.match(p.reason, /承認/)
  await refused(p)
  await setScope({ agreed: true, agreed_by: '' })
  p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.agreed, false)
  await setScope({ agreed_by: '情報システム部 部長 鈴木' })

  // 期間外（前・後）
  await setScope({ period_from: '2026-11-01', period_to: '2026-11-30' })
  p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.inPeriod, false)
  assert.match(p.reason, /診断期間/)
  await refused(p)
  await setScope({ period_from: '2026-09-01', period_to: '2026-09-30' })
  p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.inPeriod, false)
  await setScope({ period_from: '', period_to: '' })
  p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.inPeriod, false)
  await setScope({ period_from: '2026-10-05', period_to: '2026-10-16' })

  // 壊れたスコープ（解釈できないパターンが 1 つでもあれば全ブロック）
  await setScope({ scope_deny: ['payment.example.com', '-bad'] })
  p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.scopeVerdict, 'invalid')
  await refused(p)
  await setScope({ scope_deny: ['payment.example.com'] })

  // ポート条件
  await setScope({ scope_ports: [443] })
  p = await plan('ports', { target: 'app.example.com', ports: '80' })
  assert.equal(p.scopeVerdict, 'out')
  assert.match(p.reason, /ポート/)
  await refused(p)
  p = await plan('ports', { target: 'app.example.com', ports: '443' })
  assert.equal(p.scopeVerdict, 'in')
  assert.equal(p.blocked, false)
  await setScope({ scope_ports: [] })

  // 例外リストは警告つきで許可
  p = await plan('plain', { target: '10.10.3.4' })
  assert.equal(p.scopeVerdict, 'allow')
  assert.equal(p.blocked, false)
  assert.ok(p.warning)

  // 戻したら通る
  p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.blocked, false)
})

test('名前解決の結果が除外の IP に当たるなら blocked、スコープの IP 範囲外なら警告', { skip: SKIP }, async () => {
  await setScope({ scope_deny: ['payment.example.com', '203.0.113.5'] })
  exec.configure({ lookup: async () => [{ address: '203.0.113.5' }] })
  let p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.blocked, true)
  assert.match(p.reason, /名前解決/)
  assert.deepEqual(p.dns.addresses, ['203.0.113.5'])
  exec.configure({ lookup: async () => [{ address: '192.0.2.77' }] })
  p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.blocked, false)
  assert.match(p.dns.warning, /192\.0\.2\.77/)
  exec.configure({ lookup: async () => { throw new Error('ENOTFOUND') } })
  p = await plan('plain', { target: 'app.example.com' })
  assert.equal(p.blocked, false)
  assert.equal(p.dns.addresses.length, 0)
  await setScope({ scope_deny: ['payment.example.com'] })
  exec.configure({ lookup: async () => [{ address: '198.51.100.7' }] })
})

/* ---------------- plan の照合 ---------------- */

test('plan のあとで条件が変わったら 409（確認後に変わった）。使い終えた plan・期限切れは使えない', { skip: SKIP }, async () => {
  // 判定が in → allow に変わる（ブロックはされないが、確認した内容とは違う）
  await setScope({ scope_targets: ['*.example.com'], scope_allow: ['198.51.100.0/24', '10.10.0.0/16'] })
  let p = await plan('plain', { target: '198.51.100.9' })
  assert.equal(p.scopeVerdict, 'allow')
  await setScope({ scope_targets: ['*.example.com', '198.51.100.0/24'], scope_allow: ['10.10.0.0/16'] })
  await assert.rejects(launch(p), (e) => e.status === 409 && e.code === 'PLAN_CHANGED' && /条件が変わりました/.test(e.message))

  // テンプレートの引数が差し替わった
  p = await plan('plain', { target: 'app.example.com' })
  const orig = exec
  const tpl = (await import('../../server/lib/command-templates.js'))
  const parsed = tpl.parseCommands(RAW_COMMANDS.map((c) => (c.id === 'plain' ? { ...c, args: ['--echo-env', '{{target}}'] } : c)), { allowed: new Set(['fakenmap']) })
  const saved = parsed.commands
  exec.configure({ templates: () => [{ slug: 'fake', name: 'フェイク', phase: ['survey'], commands: saved }] })
  await assert.rejects(launch(p), (e) => e.status === 409 && e.code === 'PLAN_CHANGED')
  exec.configure({ templates: () => [{ slug: 'fake', name: 'フェイク', phase: ['survey'], commands: tpl.parseCommands(RAW_COMMANDS, { allowed: new Set(['fakenmap']) }).commands }] })

  // argv は同じまま、時間切れの秒数や出力形式だけが変わった（テンプレートの指紋）
  p = await plan('plain', { target: 'app.example.com' })
  exec.configure({ templates: () => [{ slug: 'fake', name: 'フェイク', phase: ['survey'], commands: tpl.parseCommands(RAW_COMMANDS.map((c) => (c.id === 'plain' ? { ...c, timeout_sec: 600 } : c)), { allowed: new Set(['fakenmap']) }).commands }] })
  await assert.rejects(launch(p), (e) => e.status === 409 && e.code === 'PLAN_CHANGED', 'timeout_sec の変更を見逃した')
  exec.configure({ templates: () => [{ slug: 'fake', name: 'フェイク', phase: ['survey'], commands: tpl.parseCommands(RAW_COMMANDS, { allowed: new Set(['fakenmap']) }).commands }] })

  // 期限切れ（2 分）
  p = await plan('plain', { target: 'app.example.com' })
  clockShift = 3 * 60 * 1000
  await assert.rejects(launch(p), (e) => e.status === 409 && e.code === 'PLAN_EXPIRED')
  clockShift = 0
  // 別の診断対象の plan としては使えない
  p = await plan('plain', { target: 'app.example.com' })
  await assert.rejects(orig.launch('2026-09-example-bank-api', p.planId, { confirm: confirmYes }), (e) => e.code === 'PLAN_EXPIRED')
  // 確認を待つあいだにスコープが変わったら、起動しない
  p = await plan('plain', { target: 'app.example.com' })
  await assert.rejects(launch(p, async () => { await setScope({ scope_deny: ['payment.example.com', 'app.example.com'] }); return true }), (e) => e.status === 403 || e.status === 409)
  await setScope({ scope_deny: ['payment.example.com'] })
  // 確認がキャンセルされたら起動しない（枠も戻る）
  p = await plan('plain', { target: 'app.example.com' })
  const c = await launch(p, async () => false)
  assert.deepEqual(c, { ok: false, cancelled: true })
  assert.equal(exec._state().slots, 0)
  // confirm なしでは起動できない
  p = await plan('plain', { target: 'app.example.com' })
  await assert.rejects(exec.launch(E, p.planId), /confirm/)
  // 起動できたら、同じ plan はもう使えない
  const res = await launch(p)
  assert.equal(res.ok, true)
  await finished(res.jobId)
  await assert.rejects(launch(p), (e) => e.code === 'PLAN_EXPIRED')
})

test('確認を待っている plan は、ほかの plan の整理（期限切れ・件数の上限）で消されず、確認が二重に出ない（P3-3）', { skip: SKIP }, async () => {
  const p = await plan('plain', { target: 'app.example.com' })
  let answer
  let asked = 0
  const pending = launch(p, () => { asked++; return new Promise((resolve) => { answer = resolve }) })
  await waitFor(() => asked === 1, 3000, '確認の呼び出し')
  // 同じ plan をもう一度起動しようとしても、確認は増えない
  await assert.rejects(launch(p, async () => { asked++; return true }), (e) => e.status === 409 && e.code === 'PLAN_BUSY')
  assert.equal(asked, 1)
  // 確認に時間がかかり（期限の 2 分を過ぎ）、そのあいだにほかの plan が上限を超えて作られても、この plan は残る
  clockShift = 3 * 60 * 1000
  for (let i = 0; i < 105; i++) await plan('plain', { target: 'app.example.com' })
  assert.ok(exec._state().plans <= 101, `plan が多すぎる: ${exec._state().plans}`)
  clockShift = 0
  answer(true)
  const res = await pending
  assert.equal(res.ok, true, '確認中の plan が整理で消えて PLAN_EXPIRED になった')
  await finished(res.jobId)
  assert.equal(exec._state().slots, 0)
  // 起動前に期限が過ぎた plan は、これまでどおり使えない
  const old = await plan('plain', { target: 'app.example.com' })
  clockShift = 3 * 60 * 1000
  await assert.rejects(launch(old), (e) => e.code === 'PLAN_EXPIRED')
  clockShift = 0
})

/* ---------------- 起動の中身 ---------------- */

test('起動: 引数は配列のまま spawn に渡り、環境は最小限で、出力は保存される', { skip: SKIP }, async () => {
  const { p, job } = await run('echo', { target: 'app.example.com' })
  assert.equal(job.status, 'done')
  assert.equal(job.exitCode, 0)
  assert.ok(path.isAbsolute(p.programPath) && p.programPath.startsWith(fs.realpathSync(bin)), '実行ファイルは絶対パスに解決される')
  assert.deepEqual(p.argv.slice(0, 3), ['--echo-env', '--secret', '-oX'])
  assert.equal(p.argv.at(-1), 'app.example.com')
  assert.match(p.outPath, new RegExp(`${E}/20-調査/取得データ/${job.id}\\.xml$`))
  const log = readLog(job)
  const envLine = /ENV:(\[.*\])/.exec(log)
  assert.ok(envLine, '子プロセスの環境変数の一覧がログにある')
  const keys = JSON.parse(envLine[1])
  assert.deepEqual(keys.sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TERM', 'TMPDIR'].sort())
  assert.equal(keys.some((k) => /^SECOWL_|TOKEN|_KEY|^ELECTRON_|^NODE_/.test(k)), false)
  assert.match(log, new RegExp(`PATH:${fs.realpathSync(bin) === bin ? bin : '.*'}`))
  // 作業フォルダは取得データ/ ではなく .secowl/run/<jobId>/
  assert.match(log, new RegExp(`CWD:.*\\.secowl/run/${job.id}`))
  // 出力ファイルは取得データ/ の中に、ジョブ ID の名前で
  assert.equal(job.outFile, `${E}/20-調査/取得データ/${job.id}.xml`)
  assert.ok(fs.existsSync(abs(job.outFile)))
  assert.match(job.outputSha256, /^[0-9a-f]{64}$/)
  // 履歴が job.json に残る
  const saved = JSON.parse(fs.readFileSync(path.join(DATA(), E, '.secowl', 'run', job.id, 'job.json'), 'utf8'))
  assert.equal(saved.status, 'done')
  assert.equal(saved.collector, undefined)
  assert.equal(exec.list(E)[0].id, job.id)
  assert.equal(exec._state().slots, 0)
})

test('保存するログは伏せ字にし、端末の制御列を除く。生の出力ファイルは伏せない', { skip: SKIP }, async () => {
  const { job } = await run('echo', { target: 'app.example.com' })
  const log = readLog(job)
  assert.equal(log.includes('eyJhbGci'), false, 'JWT が残っている')
  assert.equal(log.includes('abcdef123456'), false, 'Cookie の値が残っている')
  assert.equal(log.includes('admin@corp.test'), false, 'メールアドレスが残っている')
  assert.match(log, /Authorization: Bearer \[REDACTED\]/)
  assert.match(log, /sid=\[REDACTED\]/)
  assert.ok(log.includes('red line') && !log.includes('\u001b['), '色指定の制御列が除かれている')
  assert.ok(log.includes('progress 100%') && !log.includes('progress 10%'), '\\r の進捗は最後の表示に畳まれる')
  assert.ok(log.includes('stderr line'))
  assert.match(log, /\| 対象 \| app\.example\.com \|/)
  assert.match(log, /\| 終了コード \| 0 \|/)
  assert.match(log, /伏せ字にした項目/)
  assert.match(log, /生の出力ファイル:.*伏せ字にしていません/)
  assert.match(log, /```bash\n.*fakenmap.*app\.example\.com\n```/s)
})

test('保存ログの切り詰めは行の境界で、先頭と末尾を残す（JWT を途中で切らない）', { skip: SKIP }, async () => {
  const { job } = await run('noisy', { target: 'app.example.com' })
  const log = readLog(job)
  assert.equal(log.includes('eyJ'), false)
  assert.match(log, /\[中略: \d+ 行を省略しました/)
  assert.ok(log.includes('line-00000') && log.includes('line-02599'), '先頭と末尾が残っている')
  assert.ok(!log.includes('line-01300'), '中ほどは省略されている')
  assert.ok(Buffer.byteLength(log) < 260 * 1024)
  // どの行も途中で切れていない
  for (const l of log.split('\n').filter((x) => x.startsWith('line-'))) assert.match(l, /^line-\d{5} \[REDACTED\] x{80}$/)
})

test('command も argv と同じく伏せ字: 画面・job.json・ツール実行ログ・監査に秘匿値を平文で残さない（P2-1）', { skip: SKIP }, async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.c2VjcmV0c2lnbmF0dXJl'
  const p = await plan('text', { target: 'app.example.com', word: jwt })
  assert.ok(p.argv.includes(jwt), '確認の画面には、渡す引数をそのまま見せる')
  const res = await launch(p)
  const job = await finished(res.jobId)
  const pub = exec.publicJob(job)
  assert.equal(pub.command.includes('eyJ'), false)
  assert.equal(pub.argv.includes(jwt), false)
  assert.match(pub.command, /fakenmap --echo-env '\[REDACTED\]' app\.example\.com$/)
  const saved = fs.readFileSync(path.join(DATA(), E, '.secowl', 'run', job.id, 'job.json'), 'utf8')
  assert.equal(saved.includes('eyJ'), false, 'job.json')
  const log = readLog(job)
  assert.equal(log.includes('eyJ'), false, 'ツール実行ログ（frontmatter・bash ブロック・出力）')
  // frontmatter を読んで確かめます。command は長いと YAML が複数行に折るため、1 行として照合できません。
  const fm = matter(log).data
  assert.ok(String(fm.command).includes('[REDACTED]'), `frontmatter の command が伏せ字: ${fm.command}`)
  assert.equal(String(fm.command).includes('eyJ'), false, 'frontmatter の command')
  assert.equal(fs.readFileSync(path.join(DATA(), E, '.secowl', 'audit.jsonl'), 'utf8').includes('eyJ'), false, '監査')
  const stream = await raw(srv.baseUrl, 'GET', `/api/engagements/${E}/exec/${job.id}`, { headers: auth })
  assert.equal(stream.text.includes('eyJ'), false, 'API の応答')
})

test('URL の対象に | や [[ ]] があっても、ツール実行ログの表が壊れず、ウィキリンクも生えない（P2-2）', { skip: SKIP }, async () => {
  const target = 'http://app.example.com/?x=|y&a=[[wiki]]&q=`z`'
  const { p, job } = await run('plain', { target })
  assert.ok(p.target.includes('|y') && p.target.includes('[[wiki]]'), 'ここでは正規化後の対象をそのまま持つ')
  const log = readLog(job)
  const row = log.split('\n').find((l) => l.startsWith('| 対象 |'))
  assert.match(row, /^\| 対象 \| [^|]+ \|$/, `表の 1 行が 2 マスのまま: ${row}`)
  assert.ok(row.includes('?x=%7Cy&a=[%5Bwiki]]&q=%60z%60'), row)
  assert.equal(log.split('## 実行条件')[1].split('## 出力')[0].includes('[[wiki'), false, 'ウィキリンクになる [[ が残っていない')
  // 表の列数: すべての行が 2 マス
  const table = log.split('\n').filter((l) => /^\| /.test(l) && !l.startsWith('| 項目'))
  for (const l of table) assert.equal(l.replace(/^\||\|$/g, '').split('|').length, 2, l)
  // frontmatter は壊れない（アプリの読み取りで開ける）
  const doc = await api.get(`/api/doc?file=${encodeURIComponent(job.logFile)}`)
  assert.equal(doc.status, 200)
  assert.equal(doc.json.data.type, 'vs-toollog')
})

test('4KB を超える行が途中の read で分かれても、境界をまたぐ JWT・Cookie が伏せ字になる（P1-1）', { skip: SKIP }, async () => {
  const { job } = await run('splitsecret', { target: 'app.example.com' })
  const log = readLog(job)
  const body = log.split('## 出力')[1]
  assert.equal(body.includes('eyJhbGciOiJIUzI1NiJ9'), false, 'JWT の前半が残っている')
  assert.equal(body.includes('c2lnbmF0dXJl'), false, 'JWT の後半が残っている')
  assert.equal(body.includes('abcdef1234'), false, 'Cookie の前半が残っている')
  assert.equal(body.includes('56789'), false, 'Cookie の後半が残っている')
  assert.match(body, /jwt=\[REDACTED\] end-of-jwt-line/)
  assert.match(body, /pad=\[REDACTED\]; sid=\[REDACTED\]; theme=\[REDACTED\] end-of-cookie-line/)
  // 行は分断されず、4100 文字の x が 1 行のまま残る
  assert.ok(body.split('\n').some((l) => l.startsWith('x'.repeat(4100) + ' jwt=')), '断片が 1 行に戻っている')
  // 「伏せ字にした項目」の注記が出る（秘匿値が無かったように見せない）
  assert.match(log, /伏せ字にした項目:.*(jwt|cookie)/)
})

test('32KB を超える 1 行は、先頭を読める形で残し、事実どおりの注記を付ける（P1-2）', { skip: SKIP }, async () => {
  const { job } = await run('longline', { target: 'app.example.com' })
  const body = readLog(job).split('## 出力')[1]
  assert.ok(body.includes('start-of-long-line zzzz'), '先頭が読める')
  assert.ok(body.includes('after-long-line'), '次の行は残る')
  assert.match(body, /\[長すぎる行の途中を省略しました（\d+ 文字）\]/)
  assert.equal(body.includes('長すぎる行を省略しました'), false, '古い文言は使わない')
  // 省略の文字数は、残した文字数と合わせて元の長さ（200019 文字）になる
  const m = /^(start-of-long-line z+) \[長すぎる行の途中を省略しました（(\d+) 文字）\]$/m.exec(body)
  assert.ok(m, '1 行にまとまっている')
  const kept = m[1].length
  assert.equal(kept + Number(m[2]), 'start-of-long-line '.length + 200000)
  assert.ok(Buffer.byteLength(body) < 40 * 1024, '全部を残してはいない')
})

test('行の上限にかかった JWT は、断片も残さない（P1-2）', { skip: SKIP }, async () => {
  const { job } = await run('cutjwt', { target: 'app.example.com' })
  const body = readLog(job).split('## 出力')[1]
  assert.equal(body.includes('eyJ'), false, 'JWT の先頭が残っている')
  assert.equal(body.includes('c2lnbmF0dXJl'), false)
  assert.match(body, /\[長すぎる行の途中を省略しました（\d+ 文字）\]/)
  assert.ok(body.includes('after-cut-line'))
})

test('画面向けの出力も、長い行は上限で打ち切って省略の印を 1 回だけ出す', { skip: SKIP }, async () => {
  const { job } = await run('longline', { target: 'app.example.com' })
  const live = job.collector.ring.map((c) => c.x).join('')
  assert.equal((live.match(/長すぎる行の途中を省略しました/g) || []).length, 1)
  assert.ok(live.length < 40 * 1024)
  assert.ok(live.includes('after-long-line'))
})

test('ツール実行ログを書けなかったときは、理由が画面に渡る（P3-10）', { skip: SKIP }, async () => {
  const logs = path.join(DATA(), E, '20-調査', 'logs')
  const moved = `${logs}.moved`
  fs.renameSync(logs, moved)
  fs.writeFileSync(logs, 'ディレクトリのあるべき場所にファイルがある') // mkdir が失敗する
  try {
    const { job } = await run('plain', { target: 'app.example.com' })
    assert.equal(job.status, 'done')
    assert.equal(job.logId, null)
    assert.ok(job.logError && job.logError.length <= 300, String(job.logError))
    const pub = exec.publicJob(job)
    assert.equal(pub.logError, job.logError)
    const saved = JSON.parse(fs.readFileSync(path.join(DATA(), E, '.secowl', 'run', job.id, 'job.json'), 'utf8'))
    assert.equal(saved.logError, job.logError)
  } finally {
    fs.rmSync(logs, { force: true })
    fs.renameSync(moved, logs)
  }
})

test('失敗（終了コード 0 以外）は failed、ログにも終了コードが残る', { skip: SKIP }, async () => {
  const { job } = await run('fail', { target: 'app.example.com' })
  assert.equal(job.status, 'failed')
  assert.equal(job.exitCode, 3)
  assert.match(readLog(job), /\| 終了コード \| 3 \|/)
})

/* ---------------- 停止・時間切れ・枠 ---------------- */

test('停止: プロセスグループごと終了し（孫まで）、枠が戻る', { skip: SKIP }, async () => {
  const p = await plan('slow', { target: 'app.example.com' })
  const res = await launch(p)
  const job = exec.getJob(E, res.jobId)
  const pgid = job.child.pid
  await waitFor(() => /ARGV/.test(job.collector.ring.map((c) => c.x).join('')), 3000, '出力')
  assert.equal(alive(pgid), true)
  assert.equal(exec._state().slots, 1)
  const r = await raw(srv.baseUrl, 'POST', `/api/engagements/${E}/exec/${res.jobId}/stop`, { headers: auth, body: {} })
  assert.equal(r.status, 200)
  await job.finished
  assert.equal(job.status, 'stopped')
  await waitFor(() => !alive(pgid), 5000, 'プロセスグループの終了')
  assert.throws(() => process.kill(-pgid, 0), { code: 'ESRCH' })
  assert.equal(exec._state().slots, 0)
  // 終わったものを止めようとすると 409
  const again = await raw(srv.baseUrl, 'POST', `/api/engagements/${E}/exec/${res.jobId}/stop`, { headers: auth, body: {} })
  assert.equal(again.status, 409)
  assert.equal((await raw(srv.baseUrl, 'POST', `/api/engagements/${E}/exec/not-a-job/stop`, { headers: auth, body: {} })).status, 404)
})

test('グループが空と分かったら、以後その pgid には信号を送らない（pid の再利用に備える）（P3-11）', { skip: SKIP }, async () => {
  const sent = []
  const origKill = process.kill
  process.kill = (pid, sig) => {
    if (pid < 0) sent.push([pid, sig])
    return origKill.call(process, pid, sig)
  }
  let job
  try {
    const r = await run('plain', { target: 'app.example.com' })
    job = r.job
    const pgid = -job.child.pid
    assert.equal(job.reaped, true, 'グループが空になったことを覚えている')
    const before = sent.filter(([pid]) => pid === pgid).length
    assert.ok(before >= 1)
    // 終わったあとに kill 系が呼ばれても、撃たない
    await new Promise((resolve) => setTimeout(resolve, 600)) // drainMs（テストでは 300ms）より長く待つ
    exec.killNow()
    assert.equal(sent.filter(([pid]) => pid === pgid).length, before)
  } finally {
    process.kill = origKill
  }
  // 孫が出力を握ったまま残っていても、片付けたあと（finalize）は撃たない
  const { job: j2 } = await run('orphan', { target: 'app.example.com' })
  assert.equal(j2.reaped, true)
  await waitFor(() => !alive(j2.child.pid), 3000, '孫の終了')
})

test('停止: SIGTERM を無視する孫も、猶予のあとの SIGKILL でグループごと終わる', { skip: SKIP }, async () => {
  const res = await launch(await plan('stubborn', { target: 'app.example.com' }))
  const job = exec.getJob(E, res.jobId)
  const pgid = job.child.pid
  await waitFor(() => job.collector.ring.length > 0, 3000, '出力')
  exec.stop(E, res.jobId)
  await job.finished
  await waitFor(() => !alive(pgid), 5000, 'プロセスグループの終了')
  assert.equal(job.status, 'stopped')
})

test('時間切れ: timeout_sec を超えたら止めて timeout にする（孫まで）', { skip: SKIP }, async () => {
  const p = await plan('timeout', { target: 'app.example.com' })
  const res = await launch(p)
  const job = exec.getJob(E, res.jobId)
  const pgid = job.child.pid
  const t0 = Date.now()
  await job.finished
  assert.ok(Date.now() - t0 < 5000)
  assert.equal(job.status, 'timeout')
  await waitFor(() => !alive(pgid), 5000, 'プロセスグループの終了')
  assert.ok(auditLines().some((l) => l.event === 'timeout' && l.jobId === job.id))
  assert.match(readLog(job), /時間切れ/)
})

test('同時実行の上限。枠は close ではなく先頭プロセスの exit で戻る', { skip: SKIP }, async () => {
  exec.configure({ concurrency: 1, drainMs: 1500 })
  try {
    // 先頭プロセスはすぐ終わるが、別のプロセスグループに作った孫が出力を握り続ける
    const a = await launch(await plan('orphan', { target: 'app.example.com' }))
    const jobA = exec.getJob(E, a.jobId)
    await waitFor(() => jobA.exited, 3000, '先頭プロセスの終了')
    assert.equal(jobA.finalized, false, '孫が出力を握っているので close はまだ来ない')
    assert.equal(exec._state().slots, 0, 'それでも枠は戻っている')
    // 長く動くものを 1 件入れると、2 件目は断られる
    const b = await launch(await plan('slow', { target: 'app.example.com' }))
    const jobB = exec.getJob(E, b.jobId)
    const pb = await plan('plain', { target: 'app.example.com' })
    await assert.rejects(launch(pb), (e) => e.status === 409 && e.code === 'BUSY' && /同時に実行できるのは 1 件まで/.test(e.message))
    exec.stop(E, b.jobId)
    await jobB.finished
    await jobA.finished
    assert.equal(exec._state().slots, 0)
    await waitFor(() => !alive(jobA.child.pid), 5000, 'プロセスグループの終了')
    const c = await launch(await plan('plain', { target: 'app.example.com' }))
    await finished(c.jobId)
  } finally {
    exec.configure({ concurrency: 2, drainMs: 300 })
  }
})

test('アプリの終了: killAll は実行中のものを止め、終わるのを待つ', { skip: SKIP }, async () => {
  const a = await launch(await plan('slow', { target: 'app.example.com' }))
  const b = await launch(await plan('slow', { target: 'app.example.com' }))
  const pids = [exec.getJob(E, a.jobId).child.pid, exec.getJob(E, b.jobId).child.pid]
  const r = await exec.killAll({ waitMs: 5000 })
  assert.equal(r.stopped, 2)
  for (const pid of pids) assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' })
  assert.equal(exec.getJob(E, a.jobId).finalized, true)
  assert.equal(exec._state().slots, 0)
})

/* ---------------- 出力先の閉じ込め ---------------- */

test('取得データ/ がシンボリックリンクで保存先の外を指していたら、出力先にしない', { skip: SKIP }, async () => {
  const dir = path.join(DATA(), E, '20-調査')
  const target = path.join(dir, '取得データ')
  const outside = fs.mkdtempSync(path.join(path.dirname(DATA()), 'outside-'))
  const hadDir = fs.existsSync(target)
  if (hadDir) fs.renameSync(target, `${target}.bak`)
  fs.symlinkSync(outside, target)
  try {
    const r = await planReq('echo', { target: 'app.example.com' })
    assert.equal(r.status, 403)
    assert.deepEqual(fs.readdirSync(outside), [])
  } finally {
    fs.unlinkSync(target)
    if (hadDir) fs.renameSync(`${target}.bak`, target)
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('20-調査 が保存先の外を指すリンクなら、plan で止め、外に空のフォルダも作らない（P3-1）', { skip: SKIP }, async () => {
  const survey = path.join(DATA(), E, '20-調査')
  const outside = fs.mkdtempSync(path.join(path.dirname(DATA()), 'outside-'))
  fs.renameSync(survey, `${survey}.bak`)
  fs.symlinkSync(outside, survey)
  try {
    // plan の時点で止まる（確認の画面まで進んでから launch で落ちない）
    const r = await planReq('echo', { target: 'app.example.com' })
    assert.equal(r.status, 403, r.text)
    assert.match(r.json.error, /診断対象のフォルダの外/)
    assert.deepEqual(fs.readdirSync(outside), [], '外に何も作らない')
    // 行き先のないリンクでも同じ
    fs.unlinkSync(survey)
    fs.symlinkSync(path.join(outside, 'nowhere', 'deeper'), survey)
    assert.equal((await planReq('echo', { target: 'app.example.com' })).status, 403)
    assert.deepEqual(fs.readdirSync(outside), [])
    // 出力ファイルのないコマンドは影響を受けない
    assert.equal((await planReq('plain', { target: 'app.example.com' })).status, 200)
  } finally {
    fs.unlinkSync(survey)
    fs.renameSync(`${survey}.bak`, survey)
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('プログラムが使えないとき、plan と一覧は理由の種類（missing / unsafe）を返し、実行は止まる', { skip: SKIP }, async () => {
  const empty = fs.mkdtempSync(path.join(path.dirname(DATA()), 'emptybin-'))
  const wbin = fs.mkdtempSync(path.join(path.dirname(DATA()), 'wbin-'))
  fs.chmodSync(wbin, 0o775)
  fs.symlinkSync(path.join(bin, 'fakenmap'), path.join(wbin, 'fakenmap'))
  const kindOf = () => exec.listTemplates().flatMap((t) => t.commands).find((c) => c.id === 'plain')
  try {
    exec.configure({ searchPaths: [empty] })
    let p = await plan('plain', { target: 'app.example.com' })
    assert.equal(p.blocked, true)
    assert.equal(p.programIssue, 'missing')
    assert.equal(p.programPath, null)
    assert.deepEqual([kindOf().available, kindOf().unavailableKind], [false, 'missing'])
    await assert.rejects(launch(p), (e) => e.status === 403)

    exec.configure({ searchPaths: [wbin] })
    p = await plan('plain', { target: 'app.example.com' })
    assert.equal(p.blocked, true)
    assert.equal(p.programIssue, 'unsafe')
    assert.ok(p.programPath, '見つかってはいる')
    assert.match(p.reason, /書き換えられる/)
    assert.deepEqual([kindOf().available, kindOf().unavailableKind], [false, 'unsafe'])
    await assert.rejects(launch(p), (e) => e.status === 403)

    exec.configure({ searchPaths: [bin] })
    p = await plan('plain', { target: 'app.example.com' })
    assert.equal(p.programIssue, null)
    assert.deepEqual([kindOf().available, kindOf().unavailableKind], [true, null])
  } finally {
    exec.configure({ searchPaths: [bin] })
    fs.rmSync(empty, { recursive: true, force: true })
    fs.rmSync(wbin, { recursive: true, force: true })
  }
  assert.equal(exec._state().slots, 0)
})

test('job は形式が決まっていて、パラメータからパスを組み立てない', { skip: SKIP }, async () => {
  for (const j of ['..', '../x', 'run-1-2', encodeURIComponent('../../etc/passwd'), 'run-1760000000000-0123ABCD']) {
    const r = await raw(srv.baseUrl, 'GET', `/api/engagements/${E}/exec/${j}/stream`, { headers: auth })
    assert.equal(r.status, 404, j)
  }
  assert.equal((await raw(srv.baseUrl, 'GET', `/api/engagements/${E}/exec/run-1760000000000-0123abcd`, { headers: auth })).status, 404)
})

/* ---------------- 取り込み ---------------- */

test('取り込み: 出力ファイルは記録から決まり、リクエストの outPath は使わない', { skip: SKIP }, async () => {
  const { job } = await run('echo', { target: 'app.example.com' })
  const dry = await raw(srv.baseUrl, 'POST', `/api/engagements/${E}/exec/${job.id}/import`, { headers: auth, body: { dryRun: true, outPath: '/etc/passwd', path: '/etc/hosts', file: '/etc/hosts', format: 'nuclei' } })
  assert.equal(dry.status, 200, dry.text)
  assert.equal(dry.json.format, 'nmap')
  assert.equal(dry.json.dryRun, true)
  assert.ok(dry.json.surfaces.created.length > 0)
  const before = (await api.get(`/api/engagements/${E}/surfaces`)).json.length
  const real = await raw(srv.baseUrl, 'POST', `/api/engagements/${E}/exec/${job.id}/import`, { headers: auth, body: { dryRun: false } })
  assert.equal(real.status, 200, real.text)
  const after = (await api.get(`/api/engagements/${E}/surfaces`)).json.length
  assert.equal(after - before, real.json.surfaces.created.length)
  assert.ok(real.json.surfaces.created.length > 0)
  assert.ok(auditLines().some((l) => l.event === 'import' && l.jobId === job.id))
  assert.ok(exec.getJob(E, job.id).imported)
  // 出力のないコマンドは取り込めない
  const { job: plainJob } = await run('plain', { target: 'app.example.com' })
  assert.equal((await raw(srv.baseUrl, 'POST', `/api/engagements/${E}/exec/${plainJob.id}/import`, { headers: auth, body: {} })).status, 422)
})

/* ---------------- 実行記録（追記専用・つながり） ---------------- */

test('監査記録: plan → launch → done が追記され、引数は伏せ字、前の行のハッシュでつながる', { skip: SKIP }, async () => {
  const secretWord = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl'
  const p = await plan('text', { target: 'app.example.com', word: secretWord })
  const res = await launch(p)
  const job = await finished(res.jobId)
  assert.equal(job.argv.includes(secretWord), true, '実際の引数は伏せない')
  const lines = auditLines()
  const mine = lines.filter((l) => l.jobId === job.id)
  assert.deepEqual(mine.map((l) => l.event), ['plan', 'launch', 'done'])
  for (const l of mine) {
    assert.equal(JSON.stringify(l).includes('eyJhbGci'), false, '監査記録に JWT が残っている')
    assert.equal(l.source, 'ui')
    assert.equal(l.target, 'app.example.com')
  }
  const launchLine = mine[1]
  assert.equal(launchLine.scopeVerdict, 'in')
  assert.equal(launchLine.agreed, true)
  assert.equal(launchLine.inPeriod, true)
  assert.match(launchLine.templateHash, /^[0-9a-f]{16}$/)
  assert.match(launchLine.scopeVersion, /^[0-9a-f]{16}$/)
  assert.ok(launchLine.argv.includes('[REDACTED]'))
  assert.equal(mine[2].exitCode, 0)
  // ブロックされた plan も記録される
  await plan('plain', { target: 'evil.test' })
  assert.ok(auditLines().some((l) => l.event === 'blocked' && l.target === 'evil.test'))
  // 追記専用: ハッシュのつながりを検証できる。書き換えると切れる
  assert.deepEqual(exec.verifyAudit(E), { ok: true, lines: auditLines().length, brokenAt: null })
  const file = path.join(DATA(), E, '.secowl', 'audit.jsonl')
  const text = fs.readFileSync(file, 'utf8')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  fs.writeFileSync(file, text.replace('"event":"plan"', '"event":"plam"'))
  const broken = exec.verifyAudit(E)
  assert.equal(broken.ok, false)
  fs.writeFileSync(file, text)
  assert.equal(exec.verifyAudit(E).ok, true)
})

/* ---------------- ストリーミング ---------------- */

async function readNdjson(res, until = () => false) {
  const out = []
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (line) out.push(JSON.parse(line))
    }
    if (out.length && until(out)) { await reader.cancel(); break }
  }
  return out
}

test('監査の検証: API で つながりを確かめられ、書き換えると切れた行を返す。鍵なしは 403（P3-5）', { skip: SKIP }, async () => {
  const url = `/api/engagements/${E}/exec/audit`
  assert.equal((await raw(srv.baseUrl, 'GET', url)).status, 403)
  const ok = await raw(srv.baseUrl, 'GET', url, { headers: auth })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.json, { ok: true, lines: auditLines().length, brokenAt: null })
  assert.ok(ok.json.lines > 0)
  // 2 行目を書き換える → 次の行（3 行目）でつながりが切れる
  const file = path.join(DATA(), E, '.secowl', 'audit.jsonl')
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines[1] = lines[1].replace('"event":"', '"event":"x-')
  fs.writeFileSync(file, lines.join('\n'))
  try {
    const bad = await raw(srv.baseUrl, 'GET', url, { headers: auth })
    assert.equal(bad.status, 200)
    assert.equal(bad.json.ok, false)
    assert.equal(bad.json.brokenAt, 3)
  } finally {
    fs.writeFileSync(file, text)
  }
  assert.equal((await raw(srv.baseUrl, 'GET', url, { headers: auth })).json.ok, true)
  // 別の診断対象の記録とは混ざらない（記録が無ければ lines 0 で ok）
  const other = await raw(srv.baseUrl, 'GET', '/api/engagements/2026-09-example-bank-api/exec/audit', { headers: auth })
  assert.equal(other.status, 200)
  assert.equal(other.json.lines, 0)
})

test('監査: 最後の行が長くても、多バイトの文字が読み取りの境目にかかっても、ハッシュのつながりは切れない（P3-4）', { skip: SKIP }, async () => {
  const before = exec.verifyAudit(E)
  assert.equal(before.ok, true)
  for (const reason of ['x'.repeat(50000), 'あ'.repeat(30000), 'y', '']) {
    const line = exec.audit(E, 'note', { jobId: 'run-1760000000000-0123abcd', reason })
    assert.equal(line.event, 'note')
  }
  const v = exec.verifyAudit(E)
  assert.deepEqual(v, { ok: true, lines: before.lines + 4, brokenAt: null })
  // 末尾に空行があっても最後の行を使う
  const file = path.join(DATA(), E, '.secowl', 'audit.jsonl')
  fs.appendFileSync(file, '\n\n')
  exec.audit(E, 'note', { jobId: 'run-1760000000000-0123abcd', reason: 'after blank' })
  assert.equal(exec.verifyAudit(E).ok, true)
  // 追記のたびにファイル全体を読み直さない（件数に比例して遅くならない）
  const origRead = fs.readFileSync
  const reads = []
  fs.readFileSync = (f, ...rest) => { if (String(f) === file) reads.push(f); return origRead(f, ...rest) }
  try { exec.audit(E, 'note', { jobId: 'run-1760000000000-0123abcd', reason: 'no full read' }) } finally { fs.readFileSync = origRead }
  assert.deepEqual(reads, [], '監査記録の全体を読んだ')
  assert.equal(exec.verifyAudit(E).ok, true)
})

test('ストリーム: ヘッダ認可の fetch で、出力が NDJSON で流れて end で閉じる。鍵なしは 403', { skip: SKIP }, async () => {
  const res = await launch(await plan('echo', { target: 'app.example.com' }))
  const noKey = await fetch(`${srv.baseUrl}/api/engagements/${E}/exec/${res.jobId}/stream`)
  assert.equal(noKey.status, 403)
  await noKey.text()
  const r = await fetch(`${srv.baseUrl}/api/engagements/${E}/exec/${res.jobId}/stream`, { headers: auth })
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /ndjson/)
  assert.equal(new URL(r.url).search, '', 'URL に鍵は載らない')
  const events = await readNdjson(r)
  assert.equal(events[0].t, 'start')
  assert.equal(events.at(-1).t, 'end')
  assert.equal(events.at(-1).job.status, 'done')
  assert.ok(events.at(-1).job.logId, 'end にはツールログの ID が入る')
  const text = events.filter((e) => e.t === 'c').map((e) => e.x).join('')
  assert.match(text, /ARGV:/)
  assert.match(text, /Authorization: Bearer eyJ/, 'ライブ表示は伏せない（保存ログだけを伏せる）')
  assert.equal(text.includes('\u001b['), false)
  // 再接続: after 以降だけを送る
  const seqs = events.filter((e) => e.t === 'c').map((e) => e.seq)
  const r2 = await fetch(`${srv.baseUrl}/api/engagements/${E}/exec/${res.jobId}/stream?after=${seqs[1]}`, { headers: auth })
  const ev2 = await readNdjson(r2)
  assert.deepEqual(ev2.filter((e) => e.t === 'c').map((e) => e.seq), seqs.filter((s) => s > seqs[1]))
})

test('ストリーム: 実行中のものはライブで流れ、切断で購読が外れる', { skip: SKIP }, async () => {
  const res = await launch(await plan('slow', { target: 'app.example.com' }))
  const job = exec.getJob(E, res.jobId)
  const ac = new AbortController()
  const r = await fetch(`${srv.baseUrl}/api/engagements/${E}/exec/${res.jobId}/stream`, { headers: auth, signal: ac.signal })
  const events = await readNdjson(r, (ev) => ev.some((e) => e.t === 'c'))
  assert.equal(events[0].job.status, 'running')
  assert.ok(events.some((e) => e.t === 'c' && /ARGV/.test(e.x)))
  assert.equal(job.subscribers.size, 1)
  ac.abort()
  await waitFor(() => job.subscribers.size === 0, 3000, '購読の解除')
  exec.stop(E, res.jobId)
  await job.finished
})

/* ---------------- 画面を配る応答 ---------------- */

test('画面の HTML には CSP（script-src self）が付き、API の応答には付かない', { skip: SKIP }, async () => {
  const meta = await raw(srv.baseUrl, 'GET', '/api/meta')
  assert.equal(meta.headers['content-security-policy'], undefined)
  const dist = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'dist', 'index.html')
  if (!fs.existsSync(dist)) return
  const page = await raw(srv.baseUrl, 'GET', '/')
  assert.match(page.headers['content-security-policy'], /script-src 'self'(;|$)/)
  assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-inline.*script|script-src[^;]*unsafe/)
  // ハッシュの付かない theme-init.js は、更新が古いキャッシュに隠れないよう毎回確かめさせる（ハッシュ付きの assets/ はそのまま）
  if (fs.existsSync(path.join(path.dirname(dist), 'theme-init.js'))) {
    const init = await raw(srv.baseUrl, 'GET', '/theme-init.js')
    assert.equal(init.status, 200)
    assert.equal(init.headers['cache-control'], 'no-cache')
    assert.match(init.headers['content-security-policy'], /script-src 'self'/)
  }
})
