// 診断対象の ZIP での受け渡し（書き出し・確認・取り込み）と、受け取った ZIP の検証です。
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { seed, E } from '../helpers/seed.mjs'
import { startTestServer, enc } from '../helpers/server.mjs'

let srv
const DATA = () => process.env.SECOWL_DATA
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

before(async () => {
  seed()
  // 書き出してはいけない作業ファイル（生の出力・監査記録）を置いておきます。
  const run = path.join(DATA(), E, '.secowl', 'run', 'job-1')
  fs.mkdirSync(run, { recursive: true })
  fs.writeFileSync(path.join(run, 'stdout.txt'), 'Cookie: session=SECRET\n')
  fs.writeFileSync(path.join(DATA(), E, '.secowl', 'audit.jsonl'), '{"program":"/Users/someone/go/bin/ffuf"}\n')
  fs.writeFileSync(path.join(DATA(), E, '.DS_Store'), 'x')
  srv = await startTestServer()
})
after(() => srv?.close())

async function exportZip(eid = E, query = '') {
  const res = await fetch(`${srv.baseUrl}/api/engagements/${enc(eid)}/export.zip${query}`)
  assert.equal(res.status, 200)
  return { res, buf: Buffer.from(await res.arrayBuffer()) }
}

async function send(kind, buf, query = '') {
  const res = await fetch(`${srv.baseUrl}/api/transfer/${kind}${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: buf,
  })
  return { status: res.status, json: await res.json() }
}

/** 目録を自分で組み立てた ZIP を作ります（files は 相対パス → 中身）。 */
function craft(id, files, { manifestFiles, extra = {} } = {}) {
  const entries = {}
  const list = []
  for (const [rel, text] of Object.entries(files)) {
    const data = strToU8(text)
    entries[`${id}/${rel}`] = data
    list.push({ path: rel, bytes: data.length, sha256: sha(data) })
  }
  const manifest = { format: 'secowl-engagement', version: 1, engagement: { id, name: id }, files: manifestFiles || list }
  return Buffer.from(zipSync({ ...entries, ...extra, 'secowl-export.json': strToU8(JSON.stringify(manifest)) }))
}

const engagementJson = (id) => JSON.stringify({ id, name: id })
const leftovers = () => fs.readdirSync(DATA()).filter((n) => n.startsWith('.secowl-import-'))

test('書き出した ZIP は目録と診断対象のファイルを持ち、作業用のファイルを含まない', async () => {
  const { res, buf } = await exportZip()
  assert.match(res.headers.get('content-disposition'), /SecOwl-2026-10-example-shop-\d{4}-\d{2}-\d{2}\.zip/)
  const z = unzipSync(new Uint8Array(buf))
  const manifest = JSON.parse(strFromU8(z['secowl-export.json']))
  assert.equal(manifest.format, 'secowl-engagement')
  assert.equal(manifest.engagement.id, E)
  const names = Object.keys(z)
  assert.ok(names.includes(`${E}/engagement.json`))
  assert.ok(names.some((n) => n.startsWith(`${E}/30-トリアージ/fnd-0001`)))
  assert.ok(names.some((n) => n.startsWith(`${E}/evidence/`)))
  assert.equal(names.some((n) => n.includes('/.secowl/') || n.endsWith('.DS_Store')), false)
  assert.equal(manifest.files.length, names.length - 1)
  for (const f of manifest.files) assert.equal(sha(z[`${E}/${f.path}`]), f.sha256)
})

test('evidence=0 では証跡を含めない', async () => {
  const { buf } = await exportZip(E, '?evidence=0')
  const names = Object.keys(unzipSync(new Uint8Array(buf)))
  assert.equal(names.some((n) => n.startsWith(`${E}/evidence/`)), false)
})

test('確認は書き込みをせず、同じ ID があることと空いている ID を返す', async () => {
  const { buf } = await exportZip()
  const before = fs.readdirSync(DATA()).sort()
  const r = await send('preview', buf)
  assert.equal(r.status, 200)
  assert.equal(r.json.id, E)
  assert.equal(r.json.exists, true)
  assert.equal(r.json.suggestedId, `${E}-2`)
  assert.equal(r.json.findings, 15)
  assert.ok(r.json.evidence > 0)
  assert.deepEqual(fs.readdirSync(DATA()).sort(), before)
})

test('同じ ID があるときは上書きせず 409 を返す', async () => {
  const { buf } = await exportZip()
  const r = await send('import', buf)
  assert.equal(r.status, 409)
  assert.equal(r.json.code, 'EXISTS')
  assert.deepEqual(leftovers(), [])
})

test('別の ID を指定すると、同じ中身の新しい診断対象として取り込み、engagement.json の id を直す', async () => {
  const { buf } = await exportZip()
  const id = `${E}-copy`
  const r = await send('import', buf, `?id=${enc(id)}`)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.id, id)
  assert.equal(r.json.renamed, true)
  const meta = JSON.parse(fs.readFileSync(path.join(DATA(), id, 'engagement.json'), 'utf8'))
  assert.equal(meta.id, id)
  const rel = path.join('30-トリアージ', fs.readdirSync(path.join(DATA(), E, '30-トリアージ')).find((n) => n.startsWith('fnd-0001')))
  assert.equal(fs.readFileSync(path.join(DATA(), id, rel), 'utf8'), fs.readFileSync(path.join(DATA(), E, rel), 'utf8'))
  assert.equal(fs.existsSync(path.join(DATA(), id, '.secowl', 'run')), false)
  assert.ok(fs.existsSync(path.join(DATA(), id, '.secowl', '.gitignore')))
  assert.deepEqual(leftovers(), [])

  const list = await (await fetch(`${srv.baseUrl}/api/engagements`)).json()
  assert.ok(list.some((e) => e.id === id))
  const findings = await (await fetch(`${srv.baseUrl}/api/engagements/${enc(id)}/findings`)).json()
  assert.equal(findings.length, 15)
})

test('元の診断対象がない PC では、そのままの ID で取り込む', async () => {
  const id = 'fresh-one'
  const buf = craft(id, { 'engagement.json': engagementJson(id), '30-トリアージ/fnd-0001-x.md': '# x\n' })
  const r = await send('import', buf)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.renamed, false)
  assert.ok(fs.existsSync(path.join(DATA(), id, '30-トリアージ', 'fnd-0001-x.md')))
})

test('SecOwl の目録がない ZIP は拒否する', async () => {
  const buf = Buffer.from(zipSync({ 'a/engagement.json': strToU8('{}') }))
  const r = await send('preview', buf)
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'NO_MANIFEST')
})

test('壊れたファイルは ZIP として拒否する', async () => {
  const r = await send('preview', Buffer.from('not a zip at all'))
  assert.equal(r.status, 400)
})

test('展開先の外を指すパスは拒否し、何も書かない（zip slip）', async () => {
  const outside = path.join(path.dirname(DATA()), 'evil.md')
  for (const bad of ['../evil.md', '../../evil.md', '/etc/evil.md', 'a\\..\\..\\evil.md', '.secowl/run/x', 'a/.git/config', 'a//b.md']) {
    const id = 'slip'
    const buf = craft(id, { 'engagement.json': engagementJson(id), [bad]: 'pwned' })
    const r = await send('import', buf)
    assert.equal(r.status, 400, bad)
    assert.equal(r.json.code, 'BAD_PATH', bad)
  }
  assert.equal(fs.existsSync(outside), false)
  assert.equal(fs.existsSync(path.join(DATA(), 'slip')), false)
  assert.deepEqual(leftovers(), [])
})

test('ZIP の中で ID が隠しフォルダや区切り文字を含むものは拒否する', async () => {
  for (const id of ['../x', '.hidden', 'a/b']) {
    const manifest = { format: 'secowl-engagement', version: 1, engagement: { id }, files: [] }
    const buf = Buffer.from(zipSync({ 'secowl-export.json': strToU8(JSON.stringify(manifest)) }))
    const r = await send('preview', buf)
    assert.equal(r.status, 400, id)
    assert.equal(r.json.code, 'BAD_ID', id)
  }
  const r = await send('import', craft('ok-id', { 'engagement.json': engagementJson('ok-id') }), `?id=${enc('../escape')}`)
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'BAD_ID')
})

test('目録にないファイルを含む ZIP は拒否する', async () => {
  const id = 'extra'
  const buf = craft(id, { 'engagement.json': engagementJson(id) }, { extra: { [`${id}/hidden.sh`]: strToU8('echo hi') } })
  const r = await send('import', buf)
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'MISMATCH')
  assert.equal(fs.existsSync(path.join(DATA(), id)), false)
})

test('中身が目録のハッシュと合わない ZIP は拒否する', async () => {
  const id = 'tampered'
  const good = strToU8(engagementJson(id))
  const fake = strToU8(engagementJson(id).replace(id, id.toUpperCase()))
  const list = [{ path: 'engagement.json', bytes: fake.length, sha256: sha(good) }]
  const buf = craft(id, { 'engagement.json': strFromU8(fake) }, { manifestFiles: list })
  const r = await send('import', buf)
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'MISMATCH')
  assert.equal(fs.existsSync(path.join(DATA(), id)), false)
})

test('大文字と小文字だけが違う同じ場所のパスは拒否する', async () => {
  const id = 'casefold'
  const buf = craft(id, { 'engagement.json': engagementJson(id), 'a.md': '1', 'A.md': '2' })
  const r = await send('preview', buf)
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'BAD_PATH')
})

test('目録の大きさが上限を超えると展開せずに拒否する（zip bomb）', async () => {
  const id = 'bomb'
  const list = [
    { path: 'engagement.json', bytes: 10, sha256: '0'.repeat(64) },
    { path: 'big.bin', bytes: 300 * 1024 * 1024, sha256: '0'.repeat(64) },
  ]
  const buf = craft(id, { 'engagement.json': engagementJson(id) }, { manifestFiles: list })
  const r = await send('preview', buf)
  assert.equal(r.status, 413)
  assert.equal(r.json.code, 'TOO_LARGE')
})

test('別のサイトからの取り込みは拒否する', async () => {
  const { buf } = await exportZip()
  const res = await fetch(`${srv.baseUrl}/api/transfer/import?id=cross`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip', Origin: 'http://evil.example' }, body: buf,
  })
  assert.equal(res.status, 403)
  assert.equal(fs.existsSync(path.join(DATA(), 'cross')), false)
})
