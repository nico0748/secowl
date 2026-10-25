export type SeverityKey = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface SeverityMeta {
  key: SeverityKey
  label: string
  ja: string
  range: string
}

export interface Meta {
  /** Electron 版で true。ネイティブのフォルダ選択などを使えます。 */
  desktop: boolean
  dataRoot: string
  dataRootSource: 'env' | 'config' | 'default'
  surfaceKinds: Record<string, string>
  phases: Record<string, string>
  severities: SeverityMeta[]
  /** 発見事項の状態。保存する値（key）は英語、表示（label）は日本語 */
  findingStatuses: FindingStatusMeta[]
}

export interface FindingStatusMeta { key: string; label: string; hint: string }

export interface Engagement {
  id: string
  name: string
  client: string
  target_system: string
  period_from: string
  period_to: string
  created: string
  docs?: EngagementDocs
}

export interface EngagementDocs {
  scope: string
  guide: string
  surfaceMap: string
  checklist: string
  negative: string
  report: string
}

export type PhaseKey = 'preparation' | 'recon' | 'survey' | 'triage' | 'report'

export interface PlaybookStep {
  title: string
  detail: string
  tools: { slug: string; name: string }[]
  doc: string
}

export interface PlaybookPhase {
  slug: string
  phase: PhaseKey
  order: number
  label: string
  title: string
  goal: string
  summary: string
  steps: PlaybookStep[]
  done: string[]
  pitfalls: string[]
  body?: string
}

export interface ProgressPhase extends Omit<PlaybookPhase, 'slug' | 'order' | 'summary' | 'steps' | 'pitfalls' | 'body'> {
  state: 'todo' | 'doing' | 'done'
  metrics: { label: string; value: string }[]
  next: string
}

export interface Progress {
  phases: ProgressPhase[]
  current: string
  nextAction: string
}

export interface Surface {
  id: string
  file: string
  title: string
  kind: string
  kind_label: string
  value: string
  host: string
  port: number | null
  protocol: string
  service: string
  product: string
  tech: string[]
  status: string
  in_scope: boolean
  discovered_by: string[]
  discovered_at: string
  updated: string
}

export interface Finding {
  id: string
  file: string
  finding_no: string
  title: string
  vuln_name: string
  identifier: string
  severity: SeverityKey
  severity_label: string
  /** cvss: 基本値から決める（キーがない場合も含む） / manual: 手で決めた */
  severity_source: 'cvss' | 'manual'
  cvss_vector: string
  cvss_score: number | null
  wstg_id: string
  target: string
  surfaces: string[]
  tools: string[]
  status: string
  retest_result: string
  updated: string
}

export interface ToolLog {
  id: string
  file: string
  title: string
  tool: string
  phase: string
  phase_label: string
  command: string
  surfaces: string[]
  findings: string[]
  executed_at: string
  updated: string
}

export interface Dashboard {
  totals: { surfaces: number; surfacesAll: number; findings: number; tools: number; logs: number }
  kindCounts: { kind: string; label: string; count: number }[]
  ports: { port: number; count: number; service: string; surfaceIds: string[] }[]
  severity: (SeverityMeta & { count: number })[]
  tools: { tool: string; count: number; lastUsed: string }[]
  technology: { name: string; count: number }[]
  statusCounts: { status: string; count: number }[]
}

export interface DocSection {
  level: number
  heading: string | null
  content: string
}

export interface ChecklistItem {
  line: number
  group: string
  checked: boolean
  text: string
}

export interface Doc {
  file: string
  /** ファイル全体の版。保存時に baseVersion として送り返します。 */
  version: string
  /** 見出しごとの版。保存時に、編集した見出しの分を baseSections として送り返します。 */
  sectionVersions: Record<string, string>
  data: Record<string, unknown>
  body: string
  raw: string
  sections: DocSection[]
  checklist: ChecklistItem[]
}

export interface Evidence {
  name: string
  rel: string
  bytes: number
  mtime: number
}

export interface GitChange { code: string; path: string }

export interface GitStatus {
  isRepo: boolean
  root: string
  branch?: string
  changes?: GitChange[]
  hasGitignore: boolean
}

export interface GitCommit { hash: string; author: string; date: string; subject: string }

export interface ImportResult {
  format: string
  formatLabel: string
  dryRun: boolean
  surfaces: {
    created: { value: string; kind: string; kind_label: string }[]
    updated: { id: string; value: string; kind: string }[]
    unchanged: number
  }
  findings: {
    created: { vuln_name: string; target: string; severity: string }[]
    skipped: { vuln_name: string; target: string; reason: string }[]
  }
}

export interface McpTool {
  name: string
  title: string
  description: string
  write: boolean
}

export interface McpInfo {
  serverPath: string
  node: string
  dataRoot: string
  exists: boolean
  desktopConfig: string
  desktopConfigReadOnly: string
  codeCommand: string
  codeCommandReadOnly: string
  desktopConfigPath: string
  tools: McpTool[]
}

export interface KnowledgeItem {
  slug: string
  name: string
  category: string
  tags: string[]
  url: string
  license: string
  phase: string[]
  authorization: string
  summary: string
  tools: string[]
  icon: string
  iconSource: '' | 'icon' | 'cover' | 'tile'
  body: string
}

export interface Knowledge {
  tools: KnowledgeItem[]
  usecases: KnowledgeItem[]
  categories: string[]
}

/** 報告書に含めなかった発見事項（下書き） */
export interface ExcludedFinding { id: string; vuln_name: string }

/** 共有・書き出しの前の点検結果 */
export interface ReportCheck {
  included: number
  checked: number
  includeDraft: boolean
  excluded: ExcludedFinding[]
  leaks: { id: string; vuln_name: string; file: string; kinds: string[] }[]
}

/** 全体検索の 1 行 */
export interface SearchHit {
  file: string
  line: number
  text: string
  kind: 'surface' | 'log' | 'finding' | 'doc'
  id: string
  title: string
}

/** 保存しようとした内容と、読み込んだあとの変更がぶつかった箇所 */
export interface WriteConflict {
  heading?: string
  field?: string
  file?: boolean
  checklist?: string
}
