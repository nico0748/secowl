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
  /** .gitignore に書かれていない、生の出力などを追跡させないための行 */
  ignoreMissing?: string[]
  /** すでに追跡されている生の出力・作業場所のファイル数 */
  rawTracked?: number
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
  /** 実行できるコマンドのテンプレート（knowledge/tools の commands:）。ツールのページだけが持つ。 */
  commands?: CommandTemplate[]
  body: string
}

/* ---------------- コマンドランナー ---------------- */

export interface CommandVar {
  name: string
  kind: 'target' | 'ports' | 'text'
  required: boolean
  default?: string
  label?: string
  hint?: string
  accept?: string[]
  pattern?: string
}

export interface CommandTemplate {
  id: string
  label: string
  program: string
  args: string[]
  out: { format?: string; ext: string } | null
  vars: CommandVar[]
  timeout_sec: number
  hash?: string
}

export interface ExecCommand extends CommandTemplate {
  /** このPCに実行ファイルがあり、実行してよい権限か */
  available: boolean
  programPath: string | null
  /** 使えない理由の種類: missing = 見つからない、unsafe = 他のユーザーが書き換えられる場所にある */
  unavailableKind: 'missing' | 'unsafe' | null
  unavailableReason: string | null
}

export interface ExecTool {
  slug: string
  name: string
  icon: string
  phase: string[]
  commands: ExecCommand[]
}

export interface ExecPlan {
  planId: string
  expiresAt: string
  slug: string
  toolName: string
  cmdId: string
  label: string
  program: string
  programPath: string | null
  programIssue: 'missing' | 'unsafe' | null
  /** 実行ファイルに渡す引数（1 要素ずつ。シェルの文字列にはしない） */
  argv: string[]
  command: string
  /** 判定にも引数にも使う、正規化済みの対象 */
  target: string
  targetKind: string
  /** 入力した値が正規化で変わったときだけ入る */
  inputTarget: string | null
  scopeVerdict: 'in' | 'allow' | 'out' | 'deny' | 'invalid'
  verdictLabel: string
  matched: string | null
  scopeReason: string
  warning: string | null
  agreed: boolean
  inPeriod: boolean
  periodReason: string
  blocked: boolean
  reason: string
  reasons: string[]
  outPath: string | null
  outFormat: string | null
  timeoutSec: number
  dns: { addresses: string[]; error?: string; skipped?: boolean; warning: string | null; blocked: boolean }
}

export type ExecStatus = 'running' | 'done' | 'failed' | 'stopped' | 'timeout' | 'interrupted'

export interface ExecJob {
  id: string
  eid: string
  slug: string
  cmdId: string
  label: string
  toolName: string
  program: string
  programPath: string | null
  argv: string[]
  command: string
  target: string
  scopeVerdict: string
  agreed: boolean | null
  inPeriod: boolean | null
  outFormat: string | null
  outExt: string | null
  timeoutSec: number
  status: ExecStatus
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  exitCode: number | null
  signal: string | null
  logId: string | null
  logFile: string | null
  outFile: string | null
  outBytes: number | null
  imported: { at: string; surfaces: number; findings: number } | null
  /** ツール実行ログを書けなかったときの理由 */
  logError?: string | null
}

/** 実行の記録（監査）のつながりの検証結果 */
export interface ExecAudit { ok: boolean; lines: number; brokenAt: number | null }

export type ExecStreamEvent =
  | { t: 'start'; job: ExecJob }
  | { t: 'c'; seq: number; s: 'out' | 'err'; x: string }
  | { t: 'gap'; from: number; to: number }
  | { t: 'hb' }
  | { t: 'overflow'; after: number }
  | { t: 'end'; job: ExecJob }

/* ---------------- 導入の点検と権限の修正 ---------------- */

/** 1 つのプログラムの状態。ok = 使える / missing = 入っていない / unsafe = ほかのユーザーが書き換えられる場所にある */
export interface SetupProgram {
  program: string
  state: 'ok' | 'missing' | 'unsafe'
  path: string | null
  /** unsafe のとき、書き換えられてしまう場所 */
  unsafeAt: string | null
  reason: string | null
  /** 入れ方（固定の表。無い手段は null） */
  install: { brew: string | null; go: string | null }
}

/** 直す必要のある場所 1 件。can が false のときは command を手でお使いいただきます。 */
export interface SetupFix {
  path: string
  command: string
  can: boolean
  why: string | null
  mode?: string
  nextMode?: string
}

export interface SetupReport {
  os: string
  counts: { ok: number; missing: number; unsafe: number }
  programs: SetupProgram[]
  fixes: SetupFix[]
  /** アプリから直せる件数 */
  fixable: number
}

export interface SetupFixPlan {
  planId: string
  expiresAt: string
  paths: SetupFix[]
  blocked: SetupFix[]
}

export type SetupFixResult =
  | { ok: true; changed: { path: string; from: string; to: string }[]; failed: { path: string; error: string }[] }
  | { ok: false; cancelled?: boolean; status?: number; code?: string; error?: string }

export type ExecLaunchResult =
  | { ok: true; jobId: string }
  | { ok: false; cancelled?: boolean; status?: number; code?: string; error?: string }

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
