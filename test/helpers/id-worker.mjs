/**
 * ids.multiproc.test.mjs が fork するワーカーです。親と同じ SECOWL_DATA（一時フォルダ）に対して、
 * 合図（'go'）を受けたら createSurface と createFinding を続けて呼び、作った id を親へ返します。
 * execArgv: [] で起動されるので env.mjs は読み込まず、親が渡した環境変数をそのまま使います。
 */
const { createSurface, createFinding, readDoc } = await import('../../server/lib/store.js')

const eid = process.env.SECOWL_TEST_EID
const count = Number(process.env.SECOWL_TEST_COUNT || 10)
const tag = process.env.SECOWL_TEST_WORKER || String(process.pid)

process.on('message', (msg) => {
  if (msg !== 'go') return
  const surfaces = []
  const findings = []
  try {
    for (let i = 0; i < count; i++) {
      surfaces.push(createSurface(eid, { kind: 'endpoint', value: `https://w${tag}-${i}.example.com/` }).id)
      const f = createFinding(eid, { vuln_name: `並行 ${tag}-${i}` })
      findings.push({ id: f.id, file: f.file, finding_no: String(readDoc(f.file).data.finding_no) })
    }
    process.send({ ok: true, surfaces, findings }, () => process.exit(0))
  } catch (err) {
    process.send({ ok: false, error: String(err?.stack || err) }, () => process.exit(1))
  }
})
process.send('ready')
