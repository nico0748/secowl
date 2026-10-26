// accept.sh（a・c・d）と reg.sh（B2〜B9・U7・U12・R1）のうち、文書の読み書きに関わるものの移植です。
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { seed, E, E2 } from '../helpers/seed.mjs'
import { startTestServer, client, raw, enc } from '../helpers/server.mjs'

let srv, api
const DATA = () => process.env.SECOWL_DATA
const findingFile = (no) => {
  const dir = path.join(DATA(), E, '30-トリアージ')
  const name = fs.readdirSync(dir).find((n) => n.startsWith(`fnd-${String(no).padStart(4, '0')}-`))
  return `${E}/30-トリアージ/${name}`
}
const abs = (rel) => path.join(DATA(), rel)

before(async () => { seed(); srv = await startTestServer(); api = client(srv.baseUrl) })
after(() => srv?.close())

test('a1〜a4 本文の HTML とスクリプト URL は共有バンドルで無害化される', async () => {
  const fx = (await api.post(`/api/engagements/${E}/findings`, { vuln_name: 'XSS テスト' })).json.file
  await api.put('/api/doc', {
    file: fx,
    sections: [{ heading: '発見場所', content: '<img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://a.example/"onmouseover="alert(1))' }],
    data: { status: 'confirmed' },
  })
  const h = (await api.get(`/api/engagements/${E}/share.html`)).text
  assert.equal(h.includes('<img src=x onerror'), false)
  assert.equal(h.includes('href="javascript:'), false)
  assert.ok(h.includes('&lt;img src=x onerror'))
  assert.equal(h.includes('" onmouseover="'), false)
})

test('c1 基本値 5.3 → medium、数値のまま', async () => {
  const r = await api.put('/api/doc', { file: findingFile(1), data: { cvss_score: 5.3 } })
  assert.equal(r.json.data.severity, 'medium')
  assert.equal(typeof r.json.data.cvss_score, 'number')
})

test('c2・d1 手動の深刻度は残り、変わるのは対象の行と表の行だけ', async () => {
  const f1 = findingFile(1)
  await api.put('/api/doc', { file: f1, data: { severity: 'high' } })
  const before = fs.readFileSync(abs(f1), 'utf8').split('\n')
  const r = await api.put('/api/doc', { file: f1, data: { target: 'x' } })
  assert.equal(r.json.data.severity, 'high')
  const after = fs.readFileSync(abs(f1), 'utf8').split('\n')
  assert.equal(after.length, before.length)
  assert.equal(after.filter((l, i) => l !== before[i]).length, 2)
})

test('c3 読んだ frontmatter をそのまま戻しても cvss のまま', async () => {
  const f9 = findingFile(9)
  const d = (await api.get(`/api/doc?file=${enc(f9)}`)).json
  const r = await api.put('/api/doc', { file: d.file, data: d.data })
  assert.equal(r.json.data.severity_source, 'cvss')
})

test('c4・c5 nuclei の取り込みは手動扱いにならず、基本値 9.1 で critical', async () => {
  const text = JSON.stringify({ 'template-id': 't1', info: { name: 'R3 nuclei テスト', severity: 'low' }, 'matched-at': 'https://r3.example.com/', host: 'r3.example.com' }) + '\n'
  await api.post(`/api/engagements/${E}/import`, { text })
  const dir = path.join(DATA(), E, '30-トリアージ')
  const name = fs.readdirSync(dir).find((n) => fs.readFileSync(path.join(dir, n), 'utf8').includes('R3 nuclei テスト'))
  const fn = `${E}/30-トリアージ/${name}`
  assert.equal(/severity_source: manual/.test(fs.readFileSync(abs(fn), 'utf8')), false)
  const r = await api.put('/api/doc', { file: fn, data: { cvss_score: 9.1 } })
  assert.equal(r.json.data.severity, 'critical')
})

test('B3 旧形式（severity_source なし）の手動の深刻度', async () => {
  const f9 = findingFile(9)
  const t = fs.readFileSync(abs(f9), 'utf8').replace(/^severity_source:.*\n/m, '').replace(/^severity: .*$/m, 'severity: high')
  fs.writeFileSync(abs(f9), t)
  const list = (await api.get(`/api/engagements/${E}/findings`)).json
  assert.equal(list.find((f) => f.id === 'fnd-0009').severity_source, 'manual')
  assert.equal((await api.put('/api/doc', { file: f9, data: { target: 'y' } })).json.data.severity, 'high')
})

test('B4 不正な深刻度と基本値は 400', async () => {
  const f9 = findingFile(9)
  assert.equal((await api.put('/api/doc', { file: f9, data: { severity: 'bogus' } })).status, 400)
  assert.equal((await api.put('/api/doc', { file: f9, data: { cvss_score: 11 } })).status, 400)
  assert.equal((await api.put('/api/doc', { file: f9, data: { cvss_score: true } })).status, 400)
  assert.equal((await api.put('/api/doc', { file: f9, data: { cvss_score: '' } })).status, 200)
  assert.equal((await api.put('/api/doc', { file: f9, data: { severity: '重要' } })).json.data.severity, 'high')
})

test('B7 API が返すパスは / 区切り', async () => {
  const list = (await api.get(`/api/engagements/${E}/findings`)).json
  assert.equal(list.filter((f) => f.file.includes('\\')).length, 0)
})

test('B9 保存先の外を指す ID は 400', async () => {
  const base = path.basename(DATA())
  assert.equal((await raw(srv.baseUrl, 'GET', `/api/engagements/..%2F${base}%2F${E}/search?q=IDOR`)).status, 400)
  assert.equal((await raw(srv.baseUrl, 'GET', '/api/engagements/..%2F..%2Fetc/findings')).status, 400)
  assert.equal((await api.put('/api/engagements/..%2Fx', { name: 'x' })).status, 400)
  assert.equal((await api.get(`/api/doc?file=${enc('../secowl.config.json')}`)).status, 400)
  assert.equal((await api.get(`/api/doc?file=${enc('../../etc/passwd.md')}`)).status, 400)
})

test('U7 新しい個票の基本情報表に記入例が残らない', async () => {
  const fn = (await api.post(`/api/engagements/${E}/findings`, { vuln_name: '表テスト', identifier: 'CWE-79' })).json.file
  const text = () => fs.readFileSync(abs(fn), 'utf8')
  assert.equal(/\| (CWE \/ CVE|A__|WSTG-____-__|未認証の外部利用者 \/ 一般利用者 \/ 管理者) \|/.test(text()), false)
  assert.match(text(), /^\| 識別子 \| CWE-79 \|$/m)
  await api.put('/api/doc', { file: fn, data: { owasp: 'A05', cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', cvss_score: 6.1 } })
  assert.match(text(), /^\| OWASP Top 10:2025 \| A05 \|$/m)
  assert.ok(text().includes('| 基本評価基準 (Base) | `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N` → 6.1 |'))
  assert.match(text(), /^\| 深刻度 \| 警告 \|$/m)
  assert.equal((await api.get(`/api/engagements/${E}/share.html?draft=1`)).text.includes('CWE / CVE'), false)
})

test('U12 承認の記録と承認表', async () => {
  for (const e of [E, E2]) {
    const r = (await api.get(`/api/engagements/${e}/progress`)).json
    assert.equal(`${r.phases[0].metrics[0].value}/${r.phases[0].state}`, '取得済み/done')
  }
  const sc = `${E}/00-診断対象/スコープとRoE.md`
  assert.match(fs.readFileSync(abs(sc), 'utf8'), /^\| クライアント \| 情報システム部 部長 鈴木 \| 2026-09-29 \| ☑ \|$/m)
  await api.put('/api/doc', { file: sc, data: { agreed_by: '' } })
  const r = (await api.get(`/api/engagements/${E}/progress`)).json
  assert.equal(`${r.phases[0].metrics[0].value}/${r.phases[0].state}`, '記録が不足/doing')
})

test('R1 新しい診断対象のスコープ文書は engagement.json と一致する', async () => {
  const ne = (await api.post('/api/engagements', { name: 'r1-test', client: '株式会社"引用"', target_system: '会員サイト', period_from: '2026-11-01', period_to: '2026-11-10' })).json.id
  const d = (await api.get(`/api/doc?file=${enc(`${ne}/00-診断対象/スコープとRoE.md`)}`)).json.data
  assert.equal([d.client, d.target_system, String(d.period_from).slice(0, 10), String(d.period_to).slice(0, 10)].join('|'), '株式会社"引用"|会員サイト|2026-11-01|2026-11-10')
})

test('r24 診断対象の更新はスコープ文書と報告書の写しを同期し、ID は変えない', async () => {
  const r = await api.put(`/api/engagements/${E}`, { client: '株式会社テスト' })
  assert.equal(r.json.synced.length, 2)
  for (const rel of [`${E}/00-診断対象/スコープとRoE.md`, `${E}/40-報告/診断報告書.md`]) {
    assert.match(fs.readFileSync(abs(rel), 'utf8'), /^client: 株式会社テスト$/m)
  }
  assert.equal((await api.put(`/api/engagements/${E}`, { id: 'x', name: '変更後' })).json.id, E)
})

/* ---------------- S1: 書き込みの競合（409） ---------------- */

test('S1 古い baseVersion の PUT は 409（code・conflicts・current）、正しい版は 200', async () => {
  const f = findingFile(3)
  const d = (await api.get(`/api/doc?file=${enc(f)}`)).json
  assert.match(d.version, /^[0-9a-f]{16}$/)
  const bad = await api.put('/api/doc', { file: f, data: { target: 'stale' }, baseVersion: '0000000000000000' })
  assert.equal(bad.status, 409)
  assert.equal(bad.json.code, 'STALE_WRITE')
  assert.deepEqual(bad.json.conflicts, [{ file: true }])
  assert.equal(bad.json.current.version, d.version)
  assert.equal(bad.json.current.file, f)
  const good = await api.put('/api/doc', { file: f, data: { target: 'fresh' }, baseVersion: d.version })
  assert.equal(good.status, 200)
  assert.equal(good.json.data.target, 'fresh')
})

test('S1 見出し単位: 別の見出しの外部変更は 200、同じ見出しは 409 と見出し名', async () => {
  const f = findingFile(4)
  const d = (await api.get(`/api/doc?file=${enc(f)}`)).json
  const file = abs(f)
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## 対策\n', '## 対策\n\n外で追記\n'))
  const ok = await api.put('/api/doc', {
    file: f, sections: [{ heading: '再現手順', content: '画面の手順' }],
    baseVersion: d.version, baseSections: { 再現手順: d.sectionVersions['再現手順'] }, baseFields: {},
  })
  assert.equal(ok.status, 200)
  const ng = await api.put('/api/doc', {
    file: f, sections: [{ heading: '再現手順', content: '画面の手順 2' }],
    baseVersion: d.version, baseSections: { 再現手順: d.sectionVersions['再現手順'] }, baseFields: {},
  })
  assert.equal(ng.status, 409)
  assert.deepEqual(ng.json.conflicts, [{ heading: '再現手順' }])
  assert.equal(ng.json.current.sections.find((s) => s.heading === '再現手順').content, '画面の手順')
})

test('S1 チェックリスト: 文言が違えば 409、一致すれば 200', async () => {
  const f = `${E}/20-調査/チェックリスト.md`
  const d = (await api.get(`/api/doc?file=${enc(f)}`)).json
  const item = d.checklist.find((c) => d.checklist.filter((x) => x.text === c.text).length === 1)
  const ng = await api.post('/api/doc/checklist', { file: f, line: item.line, checked: !item.checked, text: '別の項目の文言' })
  assert.equal(ng.status, 409)
  assert.equal(ng.json.code, 'STALE_WRITE')
  const ok = await api.post('/api/doc/checklist', { file: f, line: item.line, checked: !item.checked, text: item.text })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.checklist.find((c) => c.line === item.line).checked, !item.checked)
})
