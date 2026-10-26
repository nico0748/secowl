import type { ExecAudit, ExecJob, ExecLaunchResult, ExecPlan, ExecStreamEvent, ExecTool, InstallJob, InstallPlan, InstallStartResult, SetupFixPlan, SetupFixResult, SetupReport, WriteConflict, ExcludedFinding, ReportCheck, SearchHit, Dashboard, Doc, Engagement, Evidence, Finding, GitCommit, GitStatus, ImportResult, Knowledge, McpInfo, Meta, PlaybookPhase, Progress, Surface, ToolLog } from './types'

/** 読み込んだあとで別の場所からファイルが更新されていたため、保存しなかったことを示します（409）。 */
export class StaleWriteError extends Error {
  readonly current: Doc | null
  readonly conflicts: WriteConflict[]
  constructor(message: string, current: Doc | null, conflicts: WriteConflict[]) {
    super(message)
    this.name = 'StaleWriteError'
    this.current = current
    this.conflicts = conflicts
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  // 呼び出し側が渡したヘッダは残し、本文があるときだけ Content-Type を足します。
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(url, { ...init, headers })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (res.status === 409 && json?.code === 'STALE_WRITE') {
    throw new StaleWriteError(json.error || '読み込んだあとで、このファイルが更新されています', json.current ?? null, json.conflicts ?? [])
  }
  if (!res.ok) throw new Error(json?.error || `通信に失敗しました（${res.status}）`)
  return json as T
}

export interface SaveDocPayload {
  file: string
  data?: Record<string, unknown>
  sections?: { heading: string | null; content: string }[]
  body?: string
  /** 読み込んだときのファイルの版（Doc.version） */
  baseVersion?: string
  /** 編集した見出しの、読み込んだときの版（無かった見出しは null） */
  baseSections?: Record<string, string | null>
  /** 編集した欄の、読み込んだときの値 */
  baseFields?: Record<string, unknown>
}

const body = (v: unknown) => JSON.stringify(v)

/* ---------------- コマンドランナー ---------------- */

// セッション鍵は IPC で受け取り、このモジュールのメモリの上にだけ置きます（URL・ログ・localStorage には出しません）。
let execKeyPromise: Promise<string> | null = null
function execKey(): Promise<string> {
  const d = window.secowlDesktop
  if (!d?.execSession) return Promise.reject(new Error('この機能はデスクトップ版でのみ使えます'))
  if (!execKeyPromise) {
    execKeyPromise = d.execSession().then((k) => {
      if (!k) throw new Error('実行の認可を取得できませんでした')
      return k
    }).catch((e) => { execKeyPromise = null; throw e })
  }
  return execKeyPromise
}
async function execCall<T>(url: string, init?: RequestInit): Promise<T> {
  return call<T>(url, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), 'X-Secowl-Exec': await execKey() } })
}
const eidPath = (eid: string) => `/api/engagements/${encodeURIComponent(eid)}/exec`

/**
 * 出力を 1 行 1 JSON（NDJSON）で受けます。EventSource は使わず、ヘッダで認可した fetch の本文を読みます。
 * 読み取りは行ごとに onEvent へ渡すだけで、ここでは溜めません（溜める側が上限を持ちます）。
 */
async function execStream(eid: string, jobId: string, opts: { after?: number; signal?: AbortSignal; onEvent: (e: ExecStreamEvent) => void }): Promise<void> {
  const key = await execKey()
  const res = await fetch(`${eidPath(eid)}/${encodeURIComponent(jobId)}/stream${opts.after ? `?after=${opts.after}` : ''}`, {
    headers: { 'X-Secowl-Exec': key }, signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    let msg = ''
    try { msg = JSON.parse(text).error } catch { /* JSON でなければ既定の文言 */ }
    throw new Error(msg || `出力を読み込めませんでした（${res.status}）`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line) continue
      try { opts.onEvent(JSON.parse(line) as ExecStreamEvent) } catch { /* 壊れた行は読み飛ばします */ }
    }
  }
}

export const api = {
  meta: () => call<Meta>('/api/meta'),
  setDataRoot: (dataRoot: string) =>
    call<{ dataRoot: string }>('/api/meta/data-root', { method: 'PUT', body: body({ dataRoot }) }),

  engagements: () => call<Engagement[]>('/api/engagements'),
  createEngagement: (input: Partial<Engagement>) =>
    call<Engagement>('/api/engagements', { method: 'POST', body: body(input) }),
  updateEngagement: (eid: string, patch: Partial<Pick<Engagement, 'name' | 'client' | 'target_system' | 'period_from' | 'period_to'>>) =>
    call<Engagement & { synced: string[] }>(`/api/engagements/${encodeURIComponent(eid)}`, { method: 'PUT', body: body(patch) }),
  engagement: (eid: string) => call<Engagement>(`/api/engagements/${encodeURIComponent(eid)}`),

  dashboard: (eid: string) => call<Dashboard>(`/api/engagements/${encodeURIComponent(eid)}/dashboard`),

  surfaces: (eid: string) => call<Surface[]>(`/api/engagements/${encodeURIComponent(eid)}/surfaces`),
  createSurface: (eid: string, input: Record<string, unknown>) =>
    call<{ id: string; file: string }>(`/api/engagements/${encodeURIComponent(eid)}/surfaces`, { method: 'POST', body: body(input) }),

  findings: (eid: string) => call<Finding[]>(`/api/engagements/${encodeURIComponent(eid)}/findings`),
  findingMarkdown: async (eid: string, id: string) => {
    const res = await fetch(`/api/engagements/${encodeURIComponent(eid)}/findings/${encodeURIComponent(id)}/markdown`)
    const text = await res.text()
    if (!res.ok) throw new Error((() => { try { return JSON.parse(text).error } catch { return '' } })() || `通信に失敗しました（${res.status}）`)
    return text
  },
  createFinding: (eid: string, input: Record<string, unknown>) =>
    call<{ id: string; file: string }>(`/api/engagements/${encodeURIComponent(eid)}/findings`, { method: 'POST', body: body(input) }),

  toolLogs: (eid: string) => call<ToolLog[]>(`/api/engagements/${encodeURIComponent(eid)}/toollogs`),
  createToolLog: (eid: string, input: Record<string, unknown>) =>
    call<{ id: string; file: string }>(`/api/engagements/${encodeURIComponent(eid)}/toollogs`, { method: 'POST', body: body(input) }),

  buildReport: (eid: string) =>
    call<Doc & { included: number; excluded: ExcludedFinding[] }>(`/api/engagements/${encodeURIComponent(eid)}/report/build`, { method: 'POST', body: body({}) }),

  search: (eid: string, q: string, limit = 50) =>
    call<SearchHit[]>(`/api/engagements/${encodeURIComponent(eid)}/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  reportCheck: (eid: string, includeDraft = false) =>
    call<ReportCheck>(`/api/engagements/${encodeURIComponent(eid)}/report/check${includeDraft ? '?draft=1' : ''}`),

  doc: (file: string) => call<Doc>(`/api/doc?file=${encodeURIComponent(file)}`),
  saveDoc: (payload: SaveDocPayload) =>
    call<Doc>('/api/doc', { method: 'PUT', body: body(payload) }),
  /** text は切り替える項目の文言。行がずれていたら、サーバが文言で探し直します。 */
  toggleCheck: (file: string, line: number, checked: boolean, text: string) =>
    call<Doc>('/api/doc/checklist', { method: 'POST', body: body({ file, line, checked, text }) }),

  pickFolder: (current: string) =>
    call<{ path: string }>('/api/desktop/pick-folder', { method: 'POST', body: body({ current }) }),
  reveal: (p: string) => call<{ ok: boolean }>('/api/desktop/reveal', { method: 'POST', body: body({ path: p }) }),

  importFormats: () => call<Record<string, string>>('/api/import/formats'),
  importToolOutput: (eid: string, payload: { text: string; format?: string; dryRun?: boolean; importFindings?: boolean }) =>
    call<ImportResult>(`/api/engagements/${encodeURIComponent(eid)}/import`, { method: 'POST', body: body(payload) }),

  evidence: (eid: string) => call<Evidence[]>(`/api/engagements/${encodeURIComponent(eid)}/evidence`),
  saveEvidence: (eid: string, payload: { name: string; dataUrl: string; overwrite?: boolean }) =>
    call<Evidence>(`/api/engagements/${encodeURIComponent(eid)}/evidence`, { method: 'POST', body: body(payload) }),
  deleteEvidence: (eid: string, name: string) =>
    call<{ deleted: string }>(`/api/engagements/${encodeURIComponent(eid)}/evidence/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  knowledge: (reload = false) => call<Knowledge>(`/api/knowledge${reload ? '?reload=1' : ''}`),

  playbook: () => call<PlaybookPhase[]>('/api/playbook'),
  playbookPhase: (phase: string) => call<PlaybookPhase>(`/api/playbook/${encodeURIComponent(phase)}`),
  progress: (eid: string) => call<Progress>(`/api/engagements/${encodeURIComponent(eid)}/progress`),
  ensureDocs: (eid: string) =>
    call<{ added: string[] }>(`/api/engagements/${encodeURIComponent(eid)}/docs/ensure`, { method: 'POST' }),

  mcp: () => call<McpInfo>('/api/mcp'),

  gitStatus: () => call<GitStatus>('/api/git'),
  gitLog: (limit = 15) => call<GitCommit[]>(`/api/git/log?limit=${limit}`),
  gitInit: (trackEvidence: boolean) => call<GitStatus>('/api/git/init', { method: 'POST', body: body({ trackEvidence }) }),
  gitCommit: (message: string) => call<GitStatus>('/api/git/commit', { method: 'POST', body: body({ message }) }),

  shareUrl: (eid: string, opts: { draft: boolean; evidence: boolean; download?: boolean }) =>
    `/api/engagements/${encodeURIComponent(eid)}/share.html?draft=${opts.draft ? 1 : 0}&evidence=${opts.evidence ? 1 : 0}${opts.download ? '&download=1' : ''}`,
  printUrl: (eid: string) => `/api/engagements/${encodeURIComponent(eid)}/report/print.html`,
  execTemplates: () => execCall<ExecTool[]>('/api/exec/templates'),
  execPlan: (eid: string, input: { slug: string; cmdId: string; values: Record<string, string> }) =>
    execCall<ExecPlan>(`${eidPath(eid)}/plan`, { method: 'POST', body: body(input) }),
  execJobs: (eid: string) => execCall<ExecJob[]>(eidPath(eid)),
  execAudit: (eid: string) => execCall<ExecAudit>(`${eidPath(eid)}/audit`),
  execStop: (eid: string, jobId: string) =>
    execCall<ExecJob>(`${eidPath(eid)}/${encodeURIComponent(jobId)}/stop`, { method: 'POST', body: body({}) }),
  execImport: (eid: string, jobId: string, opts: { dryRun: boolean }) =>
    execCall<ImportResult>(`${eidPath(eid)}/${encodeURIComponent(jobId)}/import`, { method: 'POST', body: body(opts) }),
  execStream,
  setupReport: () => execCall<SetupReport>('/api/exec/setup'),
  setupFixPlan: () => execCall<SetupFixPlan>('/api/exec/setup/fix-plan', { method: 'POST', body: body({}) }),
  /** 権限の修正の依頼。起動と同じく、メインプロセスの IPC（ネイティブの確認つき）に渡します。 */
  setupFix: async (planId: string): Promise<SetupFixResult> => {
    const d = window.secowlDesktop
    if (!d?.setupFix) throw new Error('この機能はデスクトップ版でのみ使えます')
    return d.setupFix({ planId })
  },
  installPlan: (input: { programs: string[]; via: 'brew' | 'go' }) =>
    execCall<InstallPlan>('/api/exec/setup/install-plan', { method: 'POST', body: body(input) }),
  installJob: () => execCall<InstallJob | null>('/api/exec/setup/install'),
  installStop: (jobId: string) =>
    execCall<InstallJob>('/api/exec/setup/install/stop', { method: 'POST', body: body({ jobId }) }),
  /** 導入を始める依頼。権限の修正と同じく、メインプロセスの IPC（ネイティブの確認つき）に渡します。 */
  installStart: async (planId: string): Promise<InstallStartResult> => {
    const d = window.secowlDesktop
    if (!d?.setupInstall) throw new Error('この機能はデスクトップ版でのみ使えます')
    return d.setupInstall({ planId })
  },
  /** 起動の依頼。HTTP では受けず、メインプロセスの IPC（ネイティブの確認つき）に渡します。 */
  execLaunch: async (eid: string, planId: string): Promise<ExecLaunchResult> => {
    const d = window.secowlDesktop
    if (!d?.execLaunch) throw new Error('この機能はデスクトップ版でのみ使えます')
    return d.execLaunch({ eid, planId })
  },

  docxUrl: (eid: string) => `/api/engagements/${encodeURIComponent(eid)}/report.docx`,
}
