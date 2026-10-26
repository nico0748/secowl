import express from 'express'
import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { readConfig, writeConfig, dataRoot, APP_ROOT } from './lib/config.js'
import {
  listEngagements, createEngagement, getEngagement, updateEngagement,
  listSurfaces, createSurface, listFindings, createFinding,
  listToolLogs, createToolLog, readDoc, writeDoc, toggleChecklist, docPaths, ensureDocs,
  SURFACE_KINDS, PHASES,
} from './lib/store.js'
import { dashboard } from './lib/stats.js'
import { buildReport, findingBlock } from './lib/report.js'
import { SEVERITY_META, SEVERITIES, FINDING_STATUS } from './lib/severity.js'
import { parseToolOutput, IMPORT_FORMATS } from './lib/importers.js'
import { importIntoEngagement } from './lib/store.js'
import { listEvidence, saveEvidence, deleteEvidence, evidenceDir, evidenceMime } from './lib/evidence.js'
import * as gitlib from './lib/git.js'
import { shareBundle, printReport } from './lib/exporters.js'
import { reportDocx } from './lib/docx.js'
import { mcpInfo } from './lib/mcpinfo.js'
import { knowledge } from './lib/knowledge.js'
import { playbookIndex, findPhase } from './lib/playbook.js'
import { progress } from './lib/progress.js'
import { localOnly } from './lib/guard.js'
import { checkReport } from './lib/reportable.js'
import { searchDocs } from './lib/search.js'
import { createExec, ExecError, JOB_ID_RE } from './lib/exec.js'
import { createInstall } from './lib/install.js'
import { createSetup } from './lib/setup.js'

export const app = express()
// 最初に登録し、静的ファイルを含むすべての要求に効かせます。
app.use(localOnly)

// 画面（HTML・JS・CSS）には、自分のオリジンのスクリプトだけを許す CSP を付けます。API の応答には付けません
// （共有バンドルなどは書き出し側で独自の CSP を持ちます）。Vite の開発サーバ経由のときはこのヘッダは付きません。
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) res.setHeader('Content-Security-Policy', APP_CSP)
  next()
})

app.use(express.json({ limit: '8mb' }))

/**
 * デスクトップ版だけが使える機能の差し込み口です。
 * Electron のメインプロセスが起動時に登録します。ブラウザ運用では null のままです。
 */
let host = null
export function setHostBridge(bridge) { host = bridge }

/**
 * コマンドランナー。ブラウザ運用（host がない）ではルートが存在しないものとして 404 を返します。
 * デスクトップ版では、メインプロセスが IPC で画面に渡すセッション鍵（アプリを起動するたびに 1 本作り、終了まで使います）（host.execSession）を
 * X-Secowl-Exec ヘッダで要求します。鍵は URL にも、ログにも、localStorage にも出しません。
 * 起動（launch）は HTTP のルートを持たず、メインプロセスが IPC で受けて直接呼びます。
 */
export const execService = createExec()
/** ツールの導入の点検と権限の修正。修正そのものは HTTP では受けず、メインプロセスが IPC で受けて呼びます。 */
export const installService = createInstall()
export const setupService = createSetup({
  resolve: (program) => execService.resolveProgram(program),
  // brew・go 自身の置き場所も、権限を直す対象に入れます（直すまで導入を動かせないため）
  extraUnsafe: () => installService.unsafePaths(),
})

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest()
function safeEq(a, b) {
  if (typeof a !== 'string' || !a || typeof b !== 'string' || !b) return false
  return crypto.timingSafeEqual(sha(a), sha(b))
}
function requireExec(req, res, next) {
  if (!host || !host.execSession) return res.status(404).json({ error: 'not found' })
  if (!safeEq(req.headers['x-secowl-exec'], host.execSession)) return res.status(403).json({ error: '実行の認可がありません' })
  next()
}
function requireEngagement(req, res, next) {
  if (!getEngagement(req.params.eid)) return res.status(404).json({ error: '診断対象が見つかりません' })
  next()
}
const execWrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res)
    if (out !== undefined) res.json(out)
  } catch (err) {
    if (res.headersSent) return res.end()
    if (err instanceof ExecError) return res.status(err.status).json({ error: err.message, code: err.code })
    res.status(400).json({ error: String(err?.message || err) })
  }
}
const jobParam = (req) => {
  if (!JOB_ID_RE.test(req.params.job)) throw new ExecError(404, 'NO_JOB', 'その実行の記録はありません')
  return req.params.job
}
const execRouter = express.Router({ caseSensitive: true, strict: true })
execRouter.use('/exec', requireExec)
execRouter.use('/engagements/:eid/exec', requireExec, requireEngagement)
execRouter.get('/exec/templates', execWrap(() => execService.listTemplates()))
// 導入の点検（読み取りだけ）と、権限を直す計画。実際に直すのは IPC からだけです。
execRouter.get('/exec/setup', execWrap(() => ({ ...setupService.report(), installers: installService.installers() })))
execRouter.post('/exec/setup/fix-plan', execWrap(() => setupService.planFix()))
// 導入の計画と、いま動いている導入の状態。実際に始めるのは IPC からだけです。
execRouter.post('/exec/setup/install-plan', execWrap((req) => installService.plan(req.body || {})))
execRouter.get('/exec/setup/install', execWrap(() => installService.current()))
execRouter.post('/exec/setup/install/stop', execWrap((req) => installService.stop(req.body?.jobId)))
execRouter.post('/engagements/:eid/exec/plan', execWrap((req) => execService.plan(req.params.eid, req.body || {})))
execRouter.get('/engagements/:eid/exec', execWrap((req) => execService.list(req.params.eid)))
// 実行の記録（監査）のつながりを確かめる。書き換えや削除があると、切れた行の番号を返す
execRouter.get('/engagements/:eid/exec/audit', execWrap((req) => execService.verifyAudit(req.params.eid)))
execRouter.get('/engagements/:eid/exec/:job', execWrap((req) => execService.publicJob(execService.getJob(req.params.eid, jobParam(req)))))
execRouter.get('/engagements/:eid/exec/:job/stream', execWrap((req, res) => {
  const after = Number(req.headers['last-seq'] ?? req.query.after) || 0
  execService.stream(req.params.eid, jobParam(req), req, res, { after })
}))
execRouter.post('/engagements/:eid/exec/:job/stop', execWrap((req) => execService.stop(req.params.eid, jobParam(req))))
execRouter.post('/engagements/:eid/exec/:job/import', execWrap((req) => execService.importJob(req.params.eid, jobParam(req), {
  dryRun: req.body?.dryRun !== false,
  importFindings: req.body?.importFindings !== false,
})))
app.use('/api', execRouter)

const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res)
    if (out !== undefined) res.json(out)
  } catch (err) {
    // 読み込んだあとで別の場所から更新されていたときは 409 と、いまの内容・衝突した見出しを返します。
    if (err?.code === 'STALE_WRITE') {
      return res.status(409).json({ error: String(err.message), code: 'STALE_WRITE', conflicts: err.conflicts || [], current: err.current ?? null })
    }
    res.status(400).json({ error: String(err.message || err) })
  }
}

app.get('/api/meta', wrap(() => {
  const cfg = readConfig()
  return {
    desktop: !!host,
    dataRoot: cfg.dataRoot,
    dataRootSource: cfg.dataRootSource,
    surfaceKinds: SURFACE_KINDS,
    phases: PHASES,
    severities: SEVERITIES.map((k) => SEVERITY_META[k]),
    findingStatuses: FINDING_STATUS,
  }
}))

app.put('/api/meta/data-root', wrap((req) => {
  const next = String(req.body?.dataRoot || '').trim()
  if (!next) throw new Error('保存先のパスを入力してください')
  const cfg = writeConfig({ dataRoot: next })
  fs.mkdirSync(cfg.dataRoot, { recursive: true })
  return { dataRoot: cfg.dataRoot }
}))

app.get('/api/engagements', wrap(() => listEngagements()))
app.post('/api/engagements', wrap((req) => {
  if (!req.body?.name) throw new Error('診断対象名を入力してください')
  return createEngagement(req.body)
}))
app.get('/api/engagements/:eid', wrap((req) => {
  const e = getEngagement(req.params.eid)
  if (!e) throw new Error('診断対象が見つかりません')
  return { ...e, docs: docPaths(req.params.eid) }
}))

app.put('/api/engagements/:eid', wrap((req) => {
  if (!getEngagement(req.params.eid)) throw new Error('診断対象が見つかりません')
  return updateEngagement(req.params.eid, req.body || {})
}))

app.get('/api/engagements/:eid/dashboard', wrap((req) => dashboard(req.params.eid)))

app.get('/api/engagements/:eid/surfaces', wrap((req) => listSurfaces(req.params.eid)))
app.post('/api/engagements/:eid/surfaces', wrap((req) => createSurface(req.params.eid, req.body || {})))

app.get('/api/engagements/:eid/findings', wrap((req) => listFindings(req.params.eid)))
app.post('/api/engagements/:eid/findings', wrap((req) => createFinding(req.params.eid, req.body || {})))

/** 発見事項 1 件を、報告書の詳細ブロックと同じ形の Markdown で返します（「Markdown でコピー」用）。 */
app.get('/api/engagements/:eid/findings/:id/markdown', (req, res) => {
  try {
    const f = listFindings(req.params.eid).find((x) => x.id === req.params.id)
    if (!f) return res.status(404).json({ error: `発見事項が見つかりません: ${req.params.id}` })
    res.type('text/markdown; charset=utf-8')
    res.send(findingBlock(f, readDoc(f.file), { depth: 2, forCopy: true }) + '\n')
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

app.get('/api/engagements/:eid/toollogs', wrap((req) => listToolLogs(req.params.eid)))
app.post('/api/engagements/:eid/toollogs', wrap((req) => createToolLog(req.params.eid, req.body || {})))

app.post('/api/engagements/:eid/docs/ensure', wrap((req) => ensureDocs(req.params.eid)))

app.get('/api/engagements/:eid/search', wrap((req) => {
  if (!getEngagement(req.params.eid)) throw new Error('診断対象が見つかりません')
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  return searchDocs(req.params.eid, String(req.query.q || ''), limit)
}))

app.get('/api/engagements/:eid/progress', wrap((req) => progress(req.params.eid)))

app.get('/api/engagements/:eid/report/check', wrap((req) => checkReport(req.params.eid, { includeDraft: req.query.draft === '1' })))

app.post('/api/engagements/:eid/report/build', wrap((req) => buildReport(req.params.eid)))

app.get('/api/doc', wrap((req) => readDoc(String(req.query.file || ''))))
app.put('/api/doc', wrap((req) => writeDoc(String(req.body?.file || ''), req.body || {})))
app.post('/api/doc/checklist', wrap((req) => {
  const text = req.body?.text
  if (text !== undefined && typeof text !== 'string') throw new Error('text は文字列で指定してください')
  return toggleChecklist(String(req.body?.file || ''), Number(req.body?.line), !!req.body?.checked, text)
}))

/* ---------------- ツールリファレンス ---------------- */

app.get('/api/knowledge', wrap((req) => knowledge({ reload: req.query.reload === '1' })))

/* ---------------- 進め方（標準手順書） ---------------- */

app.get('/api/playbook', wrap(() => playbookIndex()))

app.get('/api/playbook/:phase', wrap((req) => {
  const hit = findPhase(req.params.phase)
  if (!hit) throw new Error(`そのフェーズはありません: ${req.params.phase}`)
  return hit
}))

/* ---------------- MCP 連携 ---------------- */

app.get('/api/mcp', wrap(() => mcpInfo()))

/* ---------------- デスクトップ版の機能 ---------------- */

app.post('/api/desktop/pick-folder', wrap(async (req) => {
  if (!host?.pickFolder) throw new Error('この機能はデスクトップ版でのみ使えます')
  return { path: await host.pickFolder(String(req.body?.current || '')) }
}))

app.post('/api/desktop/reveal', wrap(async (req) => {
  if (!host?.reveal) throw new Error('この機能はデスクトップ版でのみ使えます')
  await host.reveal(String(req.body?.path || ''))
  return { ok: true }
}))

/* ---------------- ツール出力の取り込み ---------------- */

app.get('/api/import/formats', wrap(() => IMPORT_FORMATS))

app.post('/api/engagements/:eid/import', wrap((req) => {
  const text = String(req.body?.text || '')
  if (!text.trim()) throw new Error('取り込む内容が空です')
  const parsed = parseToolOutput(text, req.body?.format)
  return importIntoEngagement(req.params.eid, parsed, {
    dryRun: !!req.body?.dryRun,
    importFindings: req.body?.importFindings !== false,
  })
}))

/* ---------------- 証跡 ---------------- */

app.get('/api/engagements/:eid/evidence', wrap((req) => listEvidence(req.params.eid)))
app.post('/api/engagements/:eid/evidence', wrap((req) => saveEvidence(req.params.eid, req.body || {})))
app.delete('/api/engagements/:eid/evidence/:name', wrap((req) => deleteEvidence(req.params.eid, req.params.name)))

app.get('/api/engagements/:eid/evidence/:name', (req, res) => {
  try {
    const file = path.join(evidenceDir(req.params.eid), path.basename(req.params.name))
    if (!fs.existsSync(file)) return res.status(404).end()
    res.type(evidenceMime(file))
    res.setHeader('Cache-Control', 'no-store')
    fs.createReadStream(file).pipe(res)
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

/* ---------------- Git ---------------- */

app.get('/api/git', wrap(() => gitlib.status()))
app.get('/api/git/log', wrap((req) => gitlib.log(Number(req.query.limit) || 15)))
app.post('/api/git/init', wrap((req) => gitlib.init({ trackEvidence: !!req.body?.trackEvidence })))
app.post('/api/git/commit', wrap((req) => gitlib.commit({ message: String(req.body?.message || '') })))

/* ---------------- 書き出し ---------------- */

function sendHtml(res, html, filename) {
  res.type('html')
  if (filename) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.send(html)
}

app.get('/api/engagements/:eid/share.html', (req, res) => {
  try {
    const html = shareBundle(req.params.eid, {
      includeDraft: req.query.draft === '1',
      includeEvidence: req.query.evidence !== '0',
    })
    sendHtml(res, html, req.query.download === '1' ? `${req.params.eid}-共有バンドル.html` : null)
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

app.get('/api/engagements/:eid/report/print.html', (req, res) => {
  try {
    sendHtml(res, printReport(req.params.eid, { includeEvidence: req.query.evidence !== '0' }))
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

app.get('/api/engagements/:eid/report.docx', async (req, res) => {
  try {
    const buf = await reportDocx(req.params.eid)
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(req.params.eid + '-診断報告書.docx')}`)
    res.send(buf)
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

const dist = path.join(APP_ROOT, 'dist')
if (fs.existsSync(dist)) {
  // theme-init.js だけはファイル名にハッシュが付かないので、更新したときに古いものが使われないよう毎回確かめさせる
  app.use(express.static(dist, {
    setHeaders: (res, file) => { if (path.basename(file) === 'theme-init.js') res.setHeader('Cache-Control', 'no-cache') },
  }))
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' })
    res.sendFile(path.join(dist, 'index.html'))
  })
}

/**
 * サーバを起動します。port に 0 を渡すと空いているポートを OS が選びます。
 * 返り値の url をそのままウィンドウに読み込ませてください。
 */
export function startServer({ port, bindHost = '127.0.0.1' } = {}) {
  const chosen = port === undefined ? readConfig().port : port
  return new Promise((resolve, reject) => {
    // Host ヘッダのない要求も Node に 400 で落とさせず、localOnly で 403 を返します。
    const server = http.createServer({ requireHostHeader: false }, app)
    server.listen(chosen, bindHost, () => {
      const actual = server.address().port
      resolve({ server, port: actual, url: `http://${bindHost}:${actual}`, dataRoot: dataRoot() })
    })
    server.on('error', reject)
  })
}
