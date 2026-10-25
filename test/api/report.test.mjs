// accept.sh（r21〜r25）と reg.sh（B2・B10・U8・U9・R3）のうち、報告書・検索・書き出しの移植です。
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { seed, E, E2 } from '../helpers/seed.mjs'
import { startTestServer, client } from '../helpers/server.mjs'
import { unzipEntry } from '../helpers/zip.mjs'

let srv, api
const DATA = () => process.env.SECOWL_DATA

before(async () => { seed(); srv = await startTestServer(); api = client(srv.baseUrl) })
after(() => srv?.close())

test('r21-1 反映すると 12 件を含め、下書き 3 件を除く', async () => {
  const r = (await api.post(`/api/engagements/${E}/report/build`, {})).json
  assert.equal(`${r.included} ${r.excluded.length}`, '12 3')
})

test('r21-2 発見事項一覧に下書きがなく、深刻度順', () => {
  const b = fs.readFileSync(path.join(DATA(), E, '40-報告', '診断報告書.md'), 'utf8')
  const t = /<!-- vs:finding-table -->([\s\S]*?)<!-- \/vs:finding-table -->/.exec(b)[1]
  const nos = t.split('\n').filter((l) => /^\| \d/.test(l)).map((l) => Number(l.split('|')[1]))
  assert.equal(t.includes('管理コンソールが公開'), false)
  assert.deepEqual(nos, [1, 2, 4, 5, 3, 6, 7, 8, 9, 10, 12, 15])
})

test('r21-3 印刷用 HTML の件数', async () => {
  const h = (await api.get(`/api/engagements/${E}/report/print.html`)).text
  assert.match(h, /発見事項件数<\/th><td>12 件/)
})

test('r21-4 docx の表紙の件数', async () => {
  const res = await fetch(`${srv.baseUrl}/api/engagements/${E}/report.docx`)
  const xml = unzipEntry(Buffer.from(await res.arrayBuffer()), 'word/document.xml')
  assert.equal((xml.match(/発見事項件数<\/w:t>.{0,400}12 件/g) || []).length, 1)
})

test('R3 docx の表の列幅は中身に合わせて配分する', async () => {
  const res = await fetch(`${srv.baseUrl}/api/engagements/${E}/report.docx`)
  const xml = unzipEntry(Buffer.from(await res.arrayBuffer()), 'word/document.xml')
  const grids = [...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)]
    .map((m) => [...m[1].matchAll(/w:w="(\d+)"/g)].map((a) => a[1]))
    .filter((c) => c.length >= 6)
  assert.ok(grids.length > 0)
  assert.ok(grids.every((c) => new Set(c).size > 2))
})

test('r25 Markdown でコピーと状態の数', async () => {
  const md = (await api.get(`/api/engagements/${E}/findings/fnd-0001/markdown`)).text
  assert.equal(md.split('\n')[0], '## 発見事項 #1 — 注文 API における水平権限昇格（IDOR）')
  assert.equal((await api.get('/api/meta')).json.findingStatuses.length, 5)
})

test('r22 報告前チェックのキーと、シードに誤検出がないこと', async () => {
  assert.equal(Object.keys((await api.get(`/api/engagements/${E}/report/check`)).json).join(), 'included,checked,includeDraft,excluded,leaks')
  for (const e of [E, E2]) assert.equal((await api.get(`/api/engagements/${e}/report/check`)).json.leaks.length, 0)
})

test('r22 Cookie と JWT を書くと 2 種の漏れ', async () => {
  const f2 = (await api.get(`/api/engagements/${E}/findings`)).json.find((f) => f.id === 'fnd-0002').file
  await api.put('/api/doc', { file: f2, sections: [{ heading: '参考情報', content: 'Cookie: sid=a1b2c3d4e5f6\nX-Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl' }] })
  const leaks = (await api.get(`/api/engagements/${E}/report/check`)).json.leaks
  assert.equal(leaks.find((l) => l.id === 'fnd-0002').kinds.length, 2)
})

test('B2 下書きは既定で調べず、draft=1 で調べる。報告書の本文も調べる', async () => {
  const f11 = (await api.get(`/api/engagements/${E}/findings`)).json.find((f) => f.id === 'fnd-0011').file
  await api.put('/api/doc', { file: f11, sections: [{ heading: '発見場所', content: 'Cookie: SESSID=a1b2c3d4e5f6g7h8i9' }] })
  assert.equal((await api.get(`/api/engagements/${E}/report/check`)).json.leaks.filter((l) => l.id === 'fnd-0011').length, 0)
  const d = (await api.get(`/api/engagements/${E}/report/check?draft=1`)).json.leaks.filter((l) => l.id === 'fnd-0011')
  assert.equal(d.map((l) => l.kinds.join()).join(), 'cookie')
  await api.put('/api/doc', { file: `${E}/40-報告/診断報告書.md`, sections: [{ heading: '1.3 総評', content: '確認用: X-Api-Key: sk_live_abcdef123456' }] })
  const rep = (await api.get(`/api/engagements/${E}/report/check`)).json.leaks.filter((l) => l.id === 'report')
  assert.equal(rep.map((l) => l.kinds.join()).join(), 'secret')
})

test('B10 共有バンドルと印刷用 HTML の CSP', async () => {
  assert.ok((await api.get(`/api/engagements/${E}/share.html`)).text.includes(`Content-Security-Policy" content="default-src 'none'; img-src data:`))
  assert.ok((await api.get(`/api/engagements/${E}/report/print.html`)).text.includes('http-equiv="Content-Security-Policy"'))
})

test('R3 書き出しの一覧で状態・識別子を折り返さない', async () => {
  const sh = (await api.get(`/api/engagements/${E}/share.html`)).text
  // grep -c と同じく、行の数で数えます
  assert.equal(sh.split('\n').filter((l) => l.includes('<td class="nowrap">確定</td>')).length, 1)
  assert.ok(sh.includes('<td class="nowrap">CWE-639</td>'))
  assert.ok((await api.get(`/api/engagements/${E}/report/print.html`)).text.includes('<td class="nowrap">CWE-639</td>'))
})

test('r23 検索', async () => {
  assert.equal((await api.get(`/api/engagements/${E}/search?q=fnd-0003`)).json[0].id, 'fnd-0003')
  assert.ok(Array.isArray((await api.get(`/api/engagements/${E}/search?q=%3Cimg`)).json))
})

test('U8 進捗の文言に英語の状態名を出さない', async () => {
  assert.equal(/draft 以外|draft のまま/.test((await api.get(`/api/engagements/${E}/progress`)).text), false)
})

test('U9 検索結果の文書名・frontmatter・表のセル', async () => {
  const hits = (await api.get(`/api/engagements/${E}/search?q=example&limit=50`)).json
  assert.equal([...new Set(hits.filter((h) => h.kind === 'doc').map((h) => h.title))].join(), 'スコープとRoE,進め方')
  assert.equal(hits.filter((h) => /^[a-z_]+: /.test(h.text)).length, 0)
  const r = (await api.get(`/api/engagements/${E}/search?q=SameSite&limit=50`)).json
  assert.ok(r.some((h) => h.text === '脆弱性名称／セッション Cookie の SameSite 属性が未設定'))
  assert.equal(r.filter((h) => h.text.startsWith('|')).length, 0)
})
