import type { Dashboard, Doc, Engagement, Evidence, Finding, GitCommit, GitStatus, ImportResult, Knowledge, McpInfo, Meta, PlaybookPhase, Progress, Surface, ToolLog } from './types'

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(json?.error || `通信に失敗しました（${res.status}）`)
  return json as T
}

const body = (v: unknown) => JSON.stringify(v)

export const api = {
  meta: () => call<Meta>('/api/meta'),
  setDataRoot: (dataRoot: string) =>
    call<{ dataRoot: string }>('/api/meta/data-root', { method: 'PUT', body: body({ dataRoot }) }),

  engagements: () => call<Engagement[]>('/api/engagements'),
  createEngagement: (input: Partial<Engagement>) =>
    call<Engagement>('/api/engagements', { method: 'POST', body: body(input) }),
  engagement: (eid: string) => call<Engagement>(`/api/engagements/${encodeURIComponent(eid)}`),

  dashboard: (eid: string) => call<Dashboard>(`/api/engagements/${encodeURIComponent(eid)}/dashboard`),

  surfaces: (eid: string) => call<Surface[]>(`/api/engagements/${encodeURIComponent(eid)}/surfaces`),
  createSurface: (eid: string, input: Record<string, unknown>) =>
    call<{ id: string; file: string }>(`/api/engagements/${encodeURIComponent(eid)}/surfaces`, { method: 'POST', body: body(input) }),

  findings: (eid: string) => call<Finding[]>(`/api/engagements/${encodeURIComponent(eid)}/findings`),
  createFinding: (eid: string, input: Record<string, unknown>) =>
    call<{ id: string; file: string }>(`/api/engagements/${encodeURIComponent(eid)}/findings`, { method: 'POST', body: body(input) }),

  toolLogs: (eid: string) => call<ToolLog[]>(`/api/engagements/${encodeURIComponent(eid)}/toollogs`),
  createToolLog: (eid: string, input: Record<string, unknown>) =>
    call<{ id: string; file: string }>(`/api/engagements/${encodeURIComponent(eid)}/toollogs`, { method: 'POST', body: body(input) }),

  buildReport: (eid: string) =>
    call<Doc>(`/api/engagements/${encodeURIComponent(eid)}/report/build`, { method: 'POST', body: body({}) }),

  doc: (file: string) => call<Doc>(`/api/doc?file=${encodeURIComponent(file)}`),
  saveDoc: (payload: { file: string; data?: Record<string, unknown>; sections?: { heading: string | null; content: string }[]; body?: string }) =>
    call<Doc>('/api/doc', { method: 'PUT', body: body(payload) }),
  toggleCheck: (file: string, line: number, checked: boolean) =>
    call<Doc>('/api/doc/checklist', { method: 'POST', body: body({ file, line, checked }) }),

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
  docxUrl: (eid: string) => `/api/engagements/${encodeURIComponent(eid)}/report.docx`,
}
