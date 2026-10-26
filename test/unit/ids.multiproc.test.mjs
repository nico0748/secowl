// S2: 別のプロセス（アプリのサーバと MCP など）が同時に採番しても、id と通し番号が重ならないこと。
// 同じプロセスの中では store の関数が同期なので並行にならず、競合は起きません。そのため fork した
// ワーカーを 8 つ用意し、全員の準備ができてから一斉に合図して、同じ保存先へ同時に書かせます。
import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEngagement, createSurface, engDir, listSurfaces, listFindings } from '../../server/lib/store.js'

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'id-worker.mjs')
const N = 8
const COUNT = 10

function startWorker(eid, i) {
  const child = fork(WORKER, [], {
    execArgv: [],
    env: { ...process.env, SECOWL_TEST_EID: eid, SECOWL_TEST_COUNT: String(COUNT), SECOWL_TEST_WORKER: String(i) },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let stderr = ''
  child.stderr.on('data', (c) => { stderr += c })
  const ready = new Promise((resolve, reject) => {
    child.once('message', (m) => (m === 'ready' ? resolve() : reject(new Error(String(m)))))
    child.once('error', reject)
  })
  const done = new Promise((resolve, reject) => {
    child.on('message', (m) => { if (m && typeof m === 'object') resolve(m) })
    child.once('exit', (code) => { if (code) reject(new Error(`worker ${i} exit ${code}: ${stderr}`)) })
  })
  return { child, ready, done }
}

test('8 プロセスが同時に createSurface / createFinding を 10 回ずつ呼んでも、id と finding_no はすべて一意', { timeout: 60000 }, async () => {
  const eid = 'multiproc'
  createEngagement({ name: eid })
  const workers = Array.from({ length: N }, (_, i) => startWorker(eid, i))
  await Promise.all(workers.map((w) => w.ready))
  for (const w of workers) w.child.send('go') // スタートバリア: 全員の準備ができてから一斉に始める
  const results = await Promise.all(workers.map((w) => w.done))
  for (const r of results) assert.equal(r.ok, true, r.error)

  const srf = results.flatMap((r) => r.surfaces)
  const fnd = results.flatMap((r) => r.findings)
  assert.equal(srf.length, N * COUNT)
  assert.equal(new Set(srf).size, srf.length, 'サーフェスの id が重複しています')
  assert.equal(new Set(fnd.map((f) => f.id)).size, fnd.length, '発見事項の id が重複しています')
  assert.equal(new Set(fnd.map((f) => f.finding_no)).size, fnd.length, '発見事項の通し番号が重複しています')

  // ファイルも上書きされずに全件残っている
  assert.equal(listSurfaces(eid).filter((s) => s.id.startsWith('srf-')).length, N * COUNT)
  assert.equal(listFindings(eid).filter((f) => f.id.startsWith('fnd-')).length, N * COUNT)

  // 予約の記録（.secowl/ids/）の数が、作った件数と一致する
  const ids = fs.readdirSync(path.join(engDir(eid), '.secowl', 'ids'))
  assert.equal(ids.filter((n) => n.startsWith('srf-')).length, N * COUNT)
  assert.equal(ids.filter((n) => n.startsWith('fnd-')).length, N * COUNT)
  assert.equal(ids.filter((n) => n.startsWith('fno-')).length, N * COUNT)
  assert.ok(ids.every((n) => /^(srf|fnd|fno|log)-\d{4}$/.test(n)), ids.join(','))
})

test('予約の記録だけ srf-0003 まで先にあるとき、次は srf-0004 以上', () => {
  const eid = 'marker-ahead'
  createEngagement({ name: eid })
  const dir = path.join(engDir(eid), '.secowl', 'ids')
  fs.mkdirSync(dir, { recursive: true })
  for (const n of ['srf-0001', 'srf-0002', 'srf-0003']) fs.writeFileSync(path.join(dir, n), '')
  const { id } = createSurface(eid, { kind: 'host', value: 'a.example.com' })
  assert.ok(Number(id.slice(4)) >= 4, id)
})

test('予約の記録がない既存データでも、Markdown の最大番号の次から採番する', () => {
  const eid = 'legacy-ids'
  createEngagement({ name: eid })
  const recon = path.join(engDir(eid), '10-偵察')
  fs.writeFileSync(path.join(recon, 'srf-0041-old.md'), '---\nid: srf-0041\nkind: host\nvalue: old.example.com\n---\n')
  fs.rmSync(path.join(engDir(eid), '.secowl'), { recursive: true, force: true })
  assert.equal(createSurface(eid, { kind: 'host', value: 'b.example.com' }).id, 'srf-0042')
})

test('.secowl/.gitignore は ids/ と run/ を無視し、audit.jsonl は無視しない', () => {
  const gi = fs.readFileSync(path.join(engDir('multiproc'), '.secowl', '.gitignore'), 'utf8')
  const rules = gi.split('\n').filter((l) => l && !l.startsWith('#'))
  assert.deepEqual(rules, ['ids/', 'run/'])
})
