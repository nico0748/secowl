/**
 * SecOwl の MCP ツール定義。
 * アプリの画面からできる操作を、そのままツールとして公開します。
 * 実体は server/lib/* をそのまま呼ぶため、アプリが起動していなくても使えます。
 */
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

import { readConfig, writeConfig, dataRoot } from '../server/lib/config.js'
import {
  listEngagements, createEngagement, getEngagement, updateEngagement, engDir,
  listSurfaces, createSurface, listFindings, createFinding,
  listToolLogs, createToolLog, readDoc, writeDoc, toggleChecklist, resolveFile,
  docPaths, ensureDocs, importIntoEngagement, SURFACE_KINDS, PHASES,
} from '../server/lib/store.js'
import { dashboard } from '../server/lib/stats.js'
import { buildReport } from '../server/lib/report.js'
import { parseToolOutput, IMPORT_FORMATS } from '../server/lib/importers.js'
import { listEvidence, saveEvidence, deleteEvidence } from '../server/lib/evidence.js'
import * as gitlib from '../server/lib/git.js'
import { shareBundle, printReport } from '../server/lib/exporters.js'
import { reportDocx } from '../server/lib/docx.js'
import { SEVERITIES, SEVERITY_META } from '../server/lib/severity.js'
import { parseVector, buildVector31, score31, V31_METRICS } from '../shared/cvss.js'
import { knowledge, findTool, findUsecase } from '../server/lib/knowledge.js'
import { playbookIndex, findPhase } from '../server/lib/playbook.js'
import { progress } from '../server/lib/progress.js'
import { checkReport } from '../server/lib/reportable.js'
import { searchDocs } from '../server/lib/search.js'

const json = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
const text = (value) => ({ content: [{ type: 'text', text: String(value) }] })

const ENGAGEMENT = z.string().describe('診断対象 ID。list_engagements が返す id を指定します')

/**
 * スコープ文書の「関門」にあたるキー。コマンド実行の可否（スコープ判定と書面の承認）を決めるため、
 * MCP からは書き換えさせません（ツール出力に仕込まれた指示でエージェントが関門を開けないように）。
 * 画面か Obsidian で、人が編集します。
 */
const GATE_KEYS = new Set(['agreed', 'agreed_at', 'agreed_by'])
const isGateKey = (k) => GATE_KEYS.has(k) || /^scope_/i.test(k)

function isScopeDoc(file, currentData) {
  if (currentData?.type === 'vs-scope') return true
  const parts = String(file).split(/[\\/]+/)
  return parts.at(-1) === 'スコープとRoE.md' && ['00-診断対象', '00-案件'].includes(parts.at(-2))
}

/** update_doc の前に、スコープ文書の関門のキーを書き換えようとしていないかを確かめます。 */
export function assertNoGateWrite(file, data) {
  if (!data || typeof data !== 'object') return
  let current = null
  try { current = readDoc(file).data } catch { current = null }
  const scopeDoc = isScopeDoc(file, current) || data.type === 'vs-scope'
  if (!scopeDoc) return
  const blocked = Object.keys(data).filter(isGateKey)
  if (current?.type === 'vs-scope' && Object.prototype.hasOwnProperty.call(data, 'type') && data.type !== 'vs-scope') blocked.push('type')
  if (blocked.length) {
    throw new Error(`スコープ文書の ${blocked.join(', ')} は MCP からは変更できません。スコープと承認は、SecOwl の「事前準備」画面か Obsidian で人が編集してください。`)
  }
}

/** export_report の書き出し先を確かめます。保存先の Markdown（スコープ文書など）を上書きさせません。 */
function checkExportPath(file, ext) {
  const abs = path.resolve(file)
  if (path.extname(abs).toLowerCase() !== `.${ext}`) throw new Error(`書き出し先の拡張子は .${ext} にしてください`)
  const parts = abs.split(path.sep)
  if (parts.includes('00-診断対象') || parts.includes('00-案件') || path.basename(abs) === 'スコープとRoE.md') {
    throw new Error('スコープ文書のフォルダには書き出せません')
  }
  const root = dataRoot()
  if (abs.startsWith(root + path.sep) && !parts.includes('exports')) {
    throw new Error('保存先の中に書き出すときは、診断対象の 40-報告/exports/ を指定してください')
  }
  return abs
}

function requireEngagement(eid) {
  const e = getEngagement(eid)
  if (!e) throw new Error(`診断対象が見つかりません: ${eid}。list_engagements で確認してください。`)
  return e
}

const READ_TOOLS = [
  {
    name: 'list_engagements',
    config: {
      title: '診断対象の一覧',
      description: '保存先にある診断対象をすべて返します。ほかのツールに渡す診断対象 ID はここで調べます。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler: () => json(listEngagements()),
  },
  {
    name: 'get_engagement',
    config: {
      title: '診断対象の詳細',
      description: '診断対象のメタ情報と、スコープ・チェックリスト・報告書のファイルパスを返します。',
      inputSchema: { engagement: ENGAGEMENT },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement }) => json({ ...requireEngagement(engagement), docs: docPaths(engagement) }),
  },
  {
    name: 'get_dashboard',
    config: {
      title: '調査状況の集計',
      description: 'アタックサーフェス数・ポート別件数・ツール別の記録数・深刻度別の発見事項件数・技術スタックの内訳を返します。アプリのホーム画面と同じ集計です。',
      inputSchema: { engagement: ENGAGEMENT },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement }) => { requireEngagement(engagement); return json(dashboard(engagement)) },
  },
  {
    name: 'list_surfaces',
    config: {
      title: 'アタックサーフェスの一覧',
      description: '偵察・列挙で登録したサブドメイン・ホスト・ポート・エンドポイントを返します。種別・状態・ポート番号で絞り込めます。',
      inputSchema: {
        engagement: ENGAGEMENT,
        kind: z.enum(['subdomain', 'host', 'port', 'endpoint', 'service']).optional().describe('種別で絞り込む'),
        status: z.string().optional().describe('状態で絞り込む（未調査 / 調査中 / 調査済 / 対象外）'),
        port: z.number().int().optional().describe('ポート番号で絞り込む'),
        in_scope_only: z.boolean().optional().describe('true なら対象外のサーフェスを除く'),
      },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement, kind, status, port, in_scope_only }) => {
      requireEngagement(engagement)
      let rows = listSurfaces(engagement)
      if (kind) rows = rows.filter((s) => s.kind === kind)
      if (status) rows = rows.filter((s) => s.status === status)
      if (port !== undefined) rows = rows.filter((s) => s.port === port)
      if (in_scope_only) rows = rows.filter((s) => s.in_scope)
      return json(rows)
    },
  },
  {
    name: 'list_tool_logs',
    config: {
      title: 'ツール実行ログの一覧',
      description: 'nmap や Burp Suite などの実行記録を返します。ツール名やフェーズで絞り込めます。',
      inputSchema: {
        engagement: ENGAGEMENT,
        tool: z.string().optional().describe('ツール名で絞り込む'),
        phase: z.enum(['recon', 'survey', 'triage', 'report']).optional().describe('フェーズで絞り込む'),
      },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement, tool, phase }) => {
      requireEngagement(engagement)
      let rows = listToolLogs(engagement)
      if (tool) rows = rows.filter((l) => l.tool === tool)
      if (phase) rows = rows.filter((l) => l.phase === phase)
      return json(rows)
    },
  },
  {
    name: 'list_findings',
    config: {
      title: '発見事項の一覧',
      description: 'トリアージ済みの発見事項個票を返します。深刻度と状態で絞り込めます。深刻度は critical / high / medium / low / info です。',
      inputSchema: {
        engagement: ENGAGEMENT,
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
        status: z.enum(['draft', 'confirmed', 'reported', 'fixed', 'reopened']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement, severity, status }) => {
      requireEngagement(engagement)
      let rows = listFindings(engagement)
      if (severity) rows = rows.filter((f) => f.severity === severity)
      if (status) rows = rows.filter((f) => f.status === status)
      return json(rows)
    },
  },
  {
    name: 'get_checklist',
    config: {
      title: '診断チェックリスト',
      description: 'OWASP WSTG に沿ったチェックリストの項目と、検証済みかどうかを返します。',
      inputSchema: { engagement: ENGAGEMENT },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement }) => {
      requireEngagement(engagement)
      const doc = readDoc(docPaths(engagement).checklist)
      return json({
        file: doc.file,
        done: doc.checklist.filter((c) => c.checked).length,
        total: doc.checklist.length,
        items: doc.checklist,
      })
    },
  },
  {
    name: 'list_evidence',
    config: {
      title: '証跡の一覧',
      description: '診断対象の evidence/ に保存した証跡画像を返します。画像そのものは返しません。',
      inputSchema: { engagement: ENGAGEMENT },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement }) => { requireEngagement(engagement); return json(listEvidence(engagement)) },
  },
  {
    name: 'read_doc',
    config: {
      title: 'Markdown を読む',
      description: '保存先の Markdown を 1 ファイル読みます。frontmatter・本文・見出しごとの中身を返します。file には list_* が返す file の値を渡します。',
      inputSchema: { file: z.string().describe('保存先からの相対パス。例: 2026-10-example-shop/30-トリアージ/fnd-0001-....md') },
      annotations: { readOnlyHint: true },
    },
    handler: ({ file }) => json(readDoc(file)),
  },
  {
    name: 'search',
    config: {
      title: '診断対象内を検索',
      description: '診断対象フォルダの Markdown を全文検索し、一致した行をファイルと行番号つきで返します。id と title の一致を先に、本文の一致を後に並べます。各行には kind（surface / log / finding / doc）・id・title も付きます。',
      inputSchema: {
        engagement: ENGAGEMENT,
        query: z.string().min(1).describe('検索語。大文字小文字は区別しません'),
        limit: z.number().int().min(1).max(200).optional().describe('返す行数の上限（既定 60）'),
      },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement, query, limit }) => {
      requireEngagement(engagement)
      return json(searchDocs(engagement, query, limit ?? 60))
    },
  },
  {
    name: 'get_report',
    config: {
      title: '報告書を読む',
      description: '診断報告書の本文を Markdown のまま返します。最新の集計を反映したい場合は先に build_report を実行してください。',
      inputSchema: { engagement: ENGAGEMENT },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement }) => {
      requireEngagement(engagement)
      const doc = readDoc(docPaths(engagement).report)
      return text(doc.raw)
    },
  },
  {
    name: 'check_report',
    config: {
      title: '共有前の点検',
      description: '報告書に載せる発見事項（既定では下書きを除く）の本文と、報告書の手書きの章を点検し、伏せていない可能性がある Cookie・Authorization・JWT・メールアドレスを含む個票を返します。included は報告書に載せる件数、excluded は除外した下書き、leaks は該当した個票と種類です。ファイルは変更しません。',
      inputSchema: {
        engagement: ENGAGEMENT,
        include_draft: z.boolean().optional().describe('true なら下書きも点検します（下書きを含めて共有バンドルを書き出すとき）'),
      },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement, include_draft }) => {
      requireEngagement(engagement)
      return json(checkReport(engagement, { includeDraft: !!include_draft }))
    },
  },
  {
    name: 'get_settings',
    config: {
      title: '設定を読む',
      description: '調査データの保存先と、その決定元（環境変数 / 設定ファイル / 既定値）を返します。選べる種別やフェーズの一覧も含みます。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler: () => {
      const cfg = readConfig()
      return json({
        dataRoot: cfg.dataRoot,
        dataRootSource: cfg.dataRootSource,
        readOnly: process.env.SECOWL_MCP_READONLY === '1',
        surfaceKinds: SURFACE_KINDS,
        phases: PHASES,
        severities: SEVERITIES.map((k) => SEVERITY_META[k]),
        importFormats: IMPORT_FORMATS,
      })
    },
  },
  {
    name: 'git_status',
    config: {
      title: 'Git の状態',
      description: '保存先リポジトリのブランチと未コミットの変更を返します。リポジトリでない場合は isRepo が false になります。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler: async () => json(await gitlib.status()),
  },
  {
    name: 'git_log',
    config: {
      title: 'Git の履歴',
      description: '保存先リポジトリの直近のコミットを返します。',
      inputSchema: { limit: z.number().int().min(1).max(100).optional().describe('件数（既定 15）') },
      annotations: { readOnlyHint: true },
    },
    handler: async ({ limit }) => json(await gitlib.log(limit ?? 15)),
  },
  {
    name: 'list_reference_tools',
    config: {
      title: 'ツールリファレンスの一覧',
      description: '診断で使うツールの手引きを一覧で返します。本文は含めません。カテゴリや語句で絞り込めます。詳細は get_reference_tool で取ります。',
      inputSchema: {
        category: z.string().optional().describe('カテゴリ名で絞り込む。例: ポートスキャン'),
        query: z.string().optional().describe('名前・タグ・本文に含まれる語で絞り込む'),
      },
      annotations: { readOnlyHint: true },
    },
    handler: ({ category, query }) => {
      const kb = knowledge()
      const q = (query || '').toLowerCase()
      const rows = kb.tools
        .filter((t) => (!category || t.category === category))
        .filter((t) => !q || t.name.toLowerCase().includes(q) || t.slug.includes(q)
          || t.tags.some((x) => x.toLowerCase().includes(q)) || t.body.toLowerCase().includes(q))
        .map(({ body, ...rest }) => rest)
      return json({ categories: kb.categories, tools: rows })
    },
  },
  {
    name: 'get_reference_tool',
    config: {
      title: 'ツールの手引きを読む',
      description: '1 つのツールの手引きを Markdown で返します。使いどころ、コマンド例、注意点が含まれます。',
      inputSchema: { slug: z.string().describe('list_reference_tools が返す slug、または名前') },
      annotations: { readOnlyHint: true },
    },
    handler: ({ slug }) => {
      const t = findTool(slug)
      if (!t) throw new Error(`そのツールは見つかりません: ${slug}`)
      return text(`# ${t.name}\n\nカテゴリ: ${t.category} / ライセンス: ${t.license} / 入手先: ${t.url}\n${t.body}`)
    },
  },
  {
    name: 'list_usecases',
    config: {
      title: 'ユースケースの一覧',
      description: '「ログイン機能を診断する」「API の認可を検証する」など、使う順番つきの手引きを一覧で返します。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler: () => json(knowledge().usecases.map(({ body, ...rest }) => rest)),
  },
  {
    name: 'get_usecase',
    config: {
      title: 'ユースケースを読む',
      description: '1 つのユースケースの手順を Markdown で返します。使うツールと順番、記録すべき内容が含まれます。',
      inputSchema: { slug: z.string().describe('list_usecases が返す slug、または名前') },
      annotations: { readOnlyHint: true },
    },
    handler: ({ slug }) => {
      const u = findUsecase(slug)
      if (!u) throw new Error(`そのユースケースは見つかりません: ${slug}`)
      return text(`# ${u.name}\n\n${u.summary}\n${u.body}`)
    },
  },
  {
    name: 'calculate_cvss',
    config: {
      title: 'CVSS v3.1 を計算',
      description: 'CVSS v3.1 の基本値・現状値・環境値を計算し、ベクタ文字列と深刻度の区分を返します。vector か metrics のどちらかを渡します。ファイルは変更しません。',
      inputSchema: {
        vector: z.string().optional().describe('ベクタ文字列。例: CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N'),
        metrics: z.record(z.string(), z.string()).optional().describe('メトリクスの連想配列。例: { "AV": "N", "AC": "L", ... }'),
      },
      annotations: { readOnlyHint: true },
    },
    handler: ({ vector, metrics }) => {
      const m = vector ? parseVector(vector) : (metrics || {})
      const missing = V31_METRICS.filter((x) => !m[x.id]).map((x) => x.id)
      if (missing.length) throw new Error(`基本評価の項目が足りません: ${missing.join(', ')}`)
      const s = score31(m)
      const sev = s.base >= 9 ? 'critical' : s.base >= 7 ? 'high' : s.base >= 4 ? 'medium' : s.base > 0 ? 'low' : 'info'
      return json({ vector: buildVector31(m), base: s.base, temporal: s.temporal, environmental: s.environmental, severity: sev, severity_ja: SEVERITY_META[sev].ja })
    },
  },
  {
    name: 'list_playbook',
    config: {
      title: '標準手順書の一覧',
      description: 'E0 事前準備から E4 報告までの各フェーズについて、目標・着手順・完了条件・つまずきやすい点を返します。本文は含みません。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handler: () => json(playbookIndex()),
  },
  {
    name: 'get_playbook',
    config: {
      title: '標準手順書を読む',
      description: '1 フェーズ分の手順書を Markdown で返します。技法の詳細・判定基準・コマンド例を含みます。',
      inputSchema: {
        phase: z.enum(['preparation', 'recon', 'survey', 'triage', 'report']).describe('フェーズ。preparation / recon / survey / triage / report'),
      },
      annotations: { readOnlyHint: true },
    },
    handler: ({ phase }) => {
      const p = findPhase(phase)
      if (!p) throw new Error(`そのフェーズはありません: ${phase}`)
      const steps = p.steps.map((s, i) => `${i + 1}. ${s.title}\n   ${s.detail}${s.tools.length ? `\n   使うツール: ${s.tools.map((t) => t.name).join(', ')}` : ''}`).join('\n')
      return text([
        `# ${p.label} ${p.title}`,
        '',
        `目標: ${p.goal}`,
        p.summary,
        '',
        '## 着手順',
        steps,
        '',
        '## 完了条件',
        p.done.map((d) => `- ${d}`).join('\n'),
        '',
        '## つまずきやすい点',
        p.pitfalls.map((d) => `- ${d}`).join('\n'),
        '',
        p.body,
      ].join('\n'))
    },
  },
  {
    name: 'get_progress',
    config: {
      title: '進み具合を見る',
      description: 'フェーズごとの状態（未着手・進行中・完了）と、完了条件に対する不足を返します。次に何をすべきかの判断に使います。',
      inputSchema: { engagement: ENGAGEMENT },
      annotations: { readOnlyHint: true },
    },
    handler: ({ engagement }) => {
      requireEngagement(engagement)
      return json(progress(engagement))
    },
  },
]

const WRITE_TOOLS = [
  {
    name: 'create_engagement',
    config: {
      title: '診断対象を作る',
      description: '診断対象フォルダを作り、スコープと RoE・診断チェックリスト・診断報告書の Markdown を同時に生成します。',
      inputSchema: {
        name: z.string().min(1).describe('診断対象名。そのままフォルダ名になります。例: 2026-10-example-shop'),
        client: z.string().optional(),
        target_system: z.string().optional(),
        period_from: z.string().optional().describe('YYYY-MM-DD'),
        period_to: z.string().optional().describe('YYYY-MM-DD'),
      },
    },
    handler: (input) => json(createEngagement(input)),
  },
  {
    name: 'update_engagement',
    config: {
      title: '診断対象の情報を更新',
      description: '診断対象の名前・顧客・対象システム・期間を engagement.json に保存し、スコープ文書と報告書の frontmatter にある写し（client / target_system / period_from / period_to）を同期します。渡したキーだけを変えます。id とフォルダ名は変わりません。返り値の synced は同期した文書です。',
      inputSchema: {
        engagement: ENGAGEMENT,
        name: z.string().min(1).optional(),
        client: z.string().optional(),
        target_system: z.string().optional(),
        period_from: z.string().optional().describe('YYYY-MM-DD'),
        period_to: z.string().optional().describe('YYYY-MM-DD'),
      },
    },
    handler: ({ engagement, ...patch }) => { requireEngagement(engagement); return json(updateEngagement(engagement, patch)) },
  },
  {
    name: 'create_surface',
    config: {
      title: 'サーフェスを追加',
      description: '攻撃面を 1 件登録し、Markdown を生成します。ポート種別で登録した値がホーム画面のポート一覧に集計されます。',
      inputSchema: {
        engagement: ENGAGEMENT,
        kind: z.enum(['subdomain', 'host', 'port', 'endpoint', 'service']),
        value: z.string().min(1).describe('サブドメイン名・URL・ホスト:ポート など'),
        host: z.string().optional(),
        port: z.number().int().optional(),
        protocol: z.string().optional(),
        service: z.string().optional(),
        product: z.string().optional().describe('製品とバージョン。技術スタックの内訳に反映されます'),
        tech: z.array(z.string()).optional(),
        discovered_by: z.array(z.string()).optional().describe('発見に使ったツール名'),
        status: z.enum(['未調査', '調査中', '調査済', '対象外']).optional(),
      },
    },
    handler: ({ engagement, ...input }) => { requireEngagement(engagement); return json(createSurface(engagement, input)) },
  },
  {
    name: 'create_tool_log',
    config: {
      title: 'ツール実行ログを追加',
      description: '実行したコマンドを記録します。ツール名ごとの件数がホーム画面の「連携数」に反映されます。',
      inputSchema: {
        engagement: ENGAGEMENT,
        tool: z.string().min(1).describe('ツール名。例: nmap, Burp Suite, Wireshark'),
        title: z.string().optional().describe('省略すると日時が入ります'),
        command: z.string().optional(),
        phase: z.enum(['recon', 'survey', 'triage', 'report']).optional(),
        surfaces: z.array(z.string()).optional().describe('関連するサーフェスの ID'),
        executed_at: z.string().optional(),
      },
    },
    handler: ({ engagement, ...input }) => { requireEngagement(engagement); return json(createToolLog(engagement, input)) },
  },
  {
    name: 'create_finding',
    config: {
      title: '発見事項を起票',
      description: '発見事項個票を 1 件作ります。cvss_score を渡すと深刻度が FIRST の区分で決まります。自動検出を取り込んだ場合は status を draft のままにし、手動で裏取りしてから confirmed にしてください。',
      inputSchema: {
        engagement: ENGAGEMENT,
        vuln_name: z.string().min(1),
        identifier: z.string().optional().describe('CWE-79 や CVE-2023-1234 など'),
        wstg_id: z.string().optional(),
        target: z.string().optional(),
        cvss_score: z.number().min(0).max(10).optional(),
        cvss_vector: z.string().optional(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional().describe('cvss_score がないあいだは仮の深刻度として使います。cvss_score から導いた値と異なる場合は手動の深刻度になります'),
        surfaces: z.array(z.string()).optional(),
        tools: z.array(z.string()).optional(),
        status: z.enum(['draft', 'confirmed', 'reported', 'fixed', 'reopened']).optional(),
      },
    },
    handler: ({ engagement, ...input }) => { requireEngagement(engagement); return json(createFinding(engagement, input)) },
  },
  {
    name: 'update_doc',
    config: {
      title: 'Markdown を更新',
      description: 'frontmatter のキーと、指定した見出しの中身だけを書き換えます。渡さなかったキーと見出しはそのまま残ります。発見事項・サーフェス・ツールログ・報告書のどれにも使えます。発見事項の `severity` に基本値と異なる値を渡すと手動の深刻度になります。空文字を渡すと CVSS 基本値から決める方式に戻ります。read_doc が返す version を base_version に渡すと安全です: 読んだあとで人や画面が同じファイルを更新していたら書き込まずにエラーを返すので、read_doc で読み直してから反映してください。スコープ文書（type: vs-scope）の scope_* と承認（agreed / agreed_at / agreed_by）は変更できません。',
      inputSchema: {
        file: z.string().describe('保存先からの相対パス'),
        base_version: z.string().optional().describe('read_doc が返した version。渡すと、読んだあとの更新を上書きしません'),
        data: z.record(z.string(), z.any()).optional().describe('frontmatter に差し込む値'),
        sections: z.array(z.object({
          heading: z.string().describe('## の見出し文字列'),
          content: z.string().describe('その見出しの中身。Markdown で書きます'),
        })).optional(),
      },
    },
    handler: ({ file, data, sections, base_version }) => {
      assertNoGateWrite(file, data)
      try {
        return json(writeDoc(file, { data, sections, ...(base_version ? { baseVersion: base_version } : {}) }))
      } catch (err) {
        if (err?.code !== 'STALE_WRITE') throw err
        const where = (err.conflicts || []).map((c) => c.heading || c.field).filter(Boolean)
        throw new Error([
          'read_doc のあとで、このファイルが更新されています。書き込んでいません。',
          `最新の version: ${err.current?.version ?? '不明'}`,
          where.length ? `衝突した見出し・欄: ${where.join(', ')}` : '',
          'read_doc で読み直し、最新の内容に変更を反映してから、新しい version を base_version に渡してください。',
        ].filter(Boolean).join('\n'))
      }
    },
  },
  {
    name: 'set_checklist_item',
    config: {
      title: 'チェックリストを切り替え',
      description: 'チェックリストの項目を検証済み・未検証に切り替えます。項目は本文の文言（text）で指定します。line を渡すときも text を一緒に渡してください。行がずれていても文言で項目を確かめ、別の項目を切り替えないようにします。',
      inputSchema: {
        engagement: ENGAGEMENT,
        text: z.string().optional().describe('項目の文言。line がなければ部分一致で探します（複数に一致したらエラー）。line があれば、その行の文言と完全一致するかを確かめます'),
        line: z.number().int().optional().describe('get_checklist が返す line。text と一緒に渡します'),
        checked: z.boolean(),
      },
    },
    handler: ({ engagement, text: needle, line, checked }) => {
      requireEngagement(engagement)
      const file = docPaths(engagement).checklist
      if (!needle) throw new Error('text（項目の文言）を指定してください。line だけでは、行がずれたときに別の項目を切り替えてしまいます')
      let target = line
      let expect = needle
      if (target === undefined) {
        const doc = readDoc(file)
        const exact = doc.checklist.filter((c) => c.text === needle.trim())
        const hits = exact.length ? exact : doc.checklist.filter((c) => c.text.includes(needle))
        if (!hits.length) throw new Error(`該当する項目がありません: ${needle}`)
        if (hits.length > 1) throw new Error(`複数の項目に一致します（${hits.length} 件）。文言をもっと詳しく指定してください: ${hits.slice(0, 5).map((h) => h.text).join(' / ')}`)
        target = hits[0].line
        expect = hits[0].text
      }
      try {
        return json(toggleChecklist(file, target, checked, expect))
      } catch (err) {
        if (err?.code !== 'STALE_WRITE') throw err
        throw new Error(`${err.message}。get_checklist で読み直してください。`)
      }
    },
  },
  {
    name: 'import_tool_output',
    config: {
      title: 'ツール出力を取り込む',
      description: 'nmap XML / httpx JSONL / nuclei JSONL / サブドメイン一覧 / ffuf JSON / gobuster 標準出力 を解析し、サーフェスと発見事項を一括登録します。形式は内容から判定します。先に dry_run を true で実行し、件数を確認してから書き込んでください。',
      inputSchema: {
        engagement: ENGAGEMENT,
        content: z.string().min(1).describe('ツールの出力そのもの'),
        format: z.enum(['auto', 'nmap', 'httpx', 'nuclei', 'subdomains', 'ffuf', 'gobuster']).optional(),
        dry_run: z.boolean().optional().describe('true ならファイルを書かずに結果だけ返します'),
        import_findings: z.boolean().optional().describe('false にすると発見事項を起票しません（nuclei のみ該当）'),
      },
    },
    handler: ({ engagement, content, format, dry_run, import_findings }) => {
      requireEngagement(engagement)
      const parsed = parseToolOutput(content, format)
      return json(importIntoEngagement(engagement, parsed, {
        dryRun: !!dry_run,
        importFindings: import_findings !== false,
      }))
    },
  },
  {
    name: 'add_evidence',
    config: {
      title: '証跡を追加',
      description: '画像を診断対象の evidence/ に保存します。保存前にマスキングを済ませてください。本文から参照するには update_doc で ![証跡](evidence/<ファイル名>) を書き込みます。',
      inputSchema: {
        engagement: ENGAGEMENT,
        name: z.string().min(1).describe('保存するファイル名。例: fnd-0001-request.png'),
        data_url: z.string().min(1).describe('data:image/png;base64,... 形式の文字列'),
        overwrite: z.boolean().optional(),
      },
    },
    handler: ({ engagement, name, data_url, overwrite }) => {
      requireEngagement(engagement)
      return json(saveEvidence(engagement, { name, dataUrl: data_url, overwrite }))
    },
  },
  {
    name: 'delete_evidence',
    config: {
      title: '証跡を削除',
      description: '証跡画像を 1 件削除します。元に戻せません。',
      inputSchema: { engagement: ENGAGEMENT, name: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    handler: ({ engagement, name }) => { requireEngagement(engagement); return json(deleteEvidence(engagement, name)) },
  },
  {
    name: 'build_report',
    config: {
      title: '報告書に発見事項を反映',
      description: '件数内訳・診断対象別評価・発見事項一覧・個別の脆弱性の章を、現在のデータで書き換えます。手書きした章はそのまま残ります。下書き（draft）の発見事項は報告書に含めません。返り値の included は含めた件数、excluded は除外した下書きです。',
      inputSchema: { engagement: ENGAGEMENT },
    },
    handler: ({ engagement }) => {
      requireEngagement(engagement)
      const doc = buildReport(engagement)
      return json({ file: doc.file, updated: doc.data.updated, overall_severity: doc.data.overall_severity, included: doc.included, excluded: doc.excluded })
    },
  },
  {
    name: 'export_report',
    config: {
      title: '報告書を書き出す',
      description: '報告書や共有バンドルをファイルに書き出し、保存したパスを返します。docx は納品用、share_html は読み取り専用の共有バンドル、print_html は印刷して PDF にする用です。',
      inputSchema: {
        engagement: ENGAGEMENT,
        format: z.enum(['docx', 'share_html', 'print_html', 'markdown']),
        include_draft: z.boolean().optional().describe('share_html のみ。既定では draft の発見事項を除きます'),
        include_evidence: z.boolean().optional().describe('証跡画像を埋め込むか（既定 true）'),
        out_path: z.string().optional().describe('書き出し先の絶対パス。省略すると診断対象の 40-報告/exports/ に置きます'),
      },
    },
    handler: async ({ engagement, format, include_draft, include_evidence, out_path }) => {
      requireEngagement(engagement)
      const dir = path.join(engDir(engagement), '40-報告', 'exports')
      const ext = { docx: 'docx', share_html: 'html', print_html: 'html', markdown: 'md' }[format]
      const file = out_path ? checkExportPath(out_path, ext) : path.join(dir, `${engagement}-${format}.${ext}`)
      fs.mkdirSync(path.dirname(file), { recursive: true })

      if (format === 'docx') {
        fs.writeFileSync(file, await reportDocx(engagement))
      } else if (format === 'share_html') {
        fs.writeFileSync(file, shareBundle(engagement, {
          includeDraft: !!include_draft,
          includeEvidence: include_evidence !== false,
        }), 'utf8')
      } else if (format === 'print_html') {
        fs.writeFileSync(file, printReport(engagement, { includeEvidence: include_evidence !== false }), 'utf8')
      } else {
        fs.writeFileSync(file, readDoc(docPaths(engagement).report).raw, 'utf8')
      }
      return json({ path: file, bytes: fs.statSync(file).size })
    },
  },
  {
    name: 'set_data_root',
    config: {
      title: '保存先を変更',
      description: '調査データの保存先を変更し、設定ファイルに書き込みます。環境変数 SECOWL_DATA が設定されている場合はそちらが優先されます。',
      inputSchema: { path: z.string().min(1).describe('絶対パス、または ~ から始まるパス') },
    },
    handler: ({ path: next }) => {
      const cfg = writeConfig({ dataRoot: next })
      fs.mkdirSync(cfg.dataRoot, { recursive: true })
      return json({ dataRoot: cfg.dataRoot })
    },
  },
  {
    name: 'ensure_docs',
    config: {
      title: 'テンプレートを補う',
      description: '進め方・攻撃面マップ・未検出記録のうち、まだ無いものを診断対象フォルダに作ります。既にあるファイルは変更しません。',
      inputSchema: { engagement: ENGAGEMENT },
    },
    handler: ({ engagement }) => {
      requireEngagement(engagement)
      return json(ensureDocs(engagement))
    },
  },
  {
    name: 'git_init',
    config: {
      title: 'Git リポジトリを初期化',
      description: '保存先フォルダを Git リポジトリにし、.gitignore を作ります。証跡はマスキング漏れが履歴に残るため既定で除外します。',
      inputSchema: { track_evidence: z.boolean().optional().describe('true にすると証跡も追跡対象にします') },
    },
    handler: async ({ track_evidence }) => json(await gitlib.init({ trackEvidence: !!track_evidence })),
  },
  {
    name: 'git_commit',
    config: {
      title: 'Git にコミット',
      description: '保存先の変更をすべてステージしてコミットします。push は行いません。',
      inputSchema: { message: z.string().min(1) },
    },
    handler: async ({ message }) => json(await gitlib.commit({ message })),
  },
]

export const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS]
export { READ_TOOLS, WRITE_TOOLS }
