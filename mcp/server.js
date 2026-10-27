#!/usr/bin/env node
/**
 * SecOwl の MCP サーバ（stdio）。
 *
 *   node mcp/server.js
 *
 * 環境変数
 *   SECOWL_DATA           調査データの保存先。省略するとアプリの設定か既定値を使います
 *   SECOWL_CONFIG         設定ファイルのパス
 *   SECOWL_MCP_READONLY   1 にすると読み取り専用のツールだけを公開します
 *
 * アプリが起動していなくても動きます。保存先の Markdown を直接読み書きします。
 */
import fs from 'node:fs'
import path from 'node:path'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { READ_TOOLS, WRITE_TOOLS } from './tools.js'
import { dataRoot, readConfig } from '../server/lib/config.js'
import { listEngagements, listFindings, listSurfaces, readDoc, docPaths } from '../server/lib/store.js'
import { dashboard } from '../server/lib/stats.js'

const READONLY = process.env.SECOWL_MCP_READONLY === '1'

const server = new McpServer(
  { name: 'secowl', version: '0.4.0' },
  {
    instructions: [
      'SecOwl は脆弱性診断の記録を Markdown で管理するアプリです。',
      '作業の流れは E0 事前準備 → E1 偵察・列挙 → E2 脆弱性調査 → E3 検証・トリアージ → E4 報告 です。',
      '',
      'まず list_engagements で診断対象 ID を調べ、以降のツールにその ID を渡してください。',
      '状況を把握するときは get_dashboard と get_progress、個別の内容を読むときは read_doc か search を使います。',
      '何をすべきか迷ったときは get_progress で不足を確かめ、get_playbook でそのフェーズの手順を読んでください。',
      '',
      '守ってほしいこと:',
      '- 自動検出の結果をそのまま confirmed にしないでください。手動で裏取りしてから状態を変えます。',
      '- 証跡や本文に実トークン・個人情報を書かないでください。マスキングしてから保存します。',
      '- 報告書を読む前に build_report を実行すると、最新の発見事項が反映されます。',
      READONLY ? '- このサーバは読み取り専用で起動しています。書き込み系のツールは公開していません。' : '',
    ].filter(Boolean).join('\n'),
  },
)

/* ---------------- ツール ---------------- */

const tools = READONLY ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS]
for (const t of tools) {
  server.registerTool(t.name, t.config, async (args) => {
    try {
      return await t.handler(args ?? {})
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `エラー: ${err?.message || err}` }] }
    }
  })
}

/* ---------------- リソース ---------------- */

server.registerResource(
  'engagements',
  'secowl://engagements',
  {
    title: '診断対象の一覧',
    description: '保存先にあるすべての診断対象。診断対象 ID と顧客・対象・期間を含みます。',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify({ dataRoot: dataRoot(), engagements: listEngagements() }, null, 2),
    }],
  }),
)

server.registerResource(
  'engagement-summary',
  new ResourceTemplate('secowl://{engagement}/summary', {
    list: async () => ({
      resources: listEngagements().map((e) => ({
        uri: `secowl://${e.id}/summary`,
        name: `${e.name} の概要`,
        mimeType: 'application/json',
      })),
    }),
  }),
  {
    title: '診断対象の概要',
    description: '集計・サーフェス・発見事項をまとめた 1 件分のスナップショット。',
    mimeType: 'application/json',
  },
  async (uri, { engagement }) => {
    const eid = Array.isArray(engagement) ? engagement[0] : engagement
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          dashboard: dashboard(eid),
          surfaces: listSurfaces(eid),
          findings: listFindings(eid),
        }, null, 2),
      }],
    }
  },
)

server.registerResource(
  'report',
  new ResourceTemplate('secowl://{engagement}/report', {
    list: async () => ({
      resources: listEngagements().map((e) => ({
        uri: `secowl://${e.id}/report`,
        name: `${e.name} の診断報告書`,
        mimeType: 'text/markdown',
      })),
    }),
  }),
  { title: '診断報告書', description: '報告書の Markdown そのもの。', mimeType: 'text/markdown' },
  async (uri, { engagement }) => {
    const eid = Array.isArray(engagement) ? engagement[0] : engagement
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readDoc(docPaths(eid).report).raw }] }
  },
)

/* ---------------- プロンプト ---------------- */

server.registerPrompt(
  'triage_findings',
  {
    title: '発見事項をトリアージする',
    description: 'draft 状態の発見事項を読み、False Positive の有無・深刻度の妥当性・不足している記載を点検します。',
    argsSchema: { engagement: z.string().describe('診断対象 ID') },
  },
  ({ engagement }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `診断対象 ${engagement} のトリアージを手伝ってください。`,
          '',
          '手順:',
          '1. list_findings で status が draft の発見事項を取り出す',
          '2. 各発見事項を read_doc で読み、再現手順と証跡が第三者に再現できる粒度かを確認する',
          '3. False Positive の疑いがあるものを挙げ、追加で確認すべき操作を示す',
          '4. CVSS ベクタが記載と整合しているかを calculate_cvss で検算する',
          '5. 「対策」の章が、どの入力を・どの層で・どう処理するかまで書けているかを点検する',
          '',
          '判断は示しますが、状態の変更（confirmed への更新）は私の確認を待ってください。',
        ].join('\n'),
      },
    }],
  }),
)

server.registerPrompt(
  'write_executive_summary',
  {
    title: '報告書の総評を書く',
    description: '発見事項の一覧から、非技術者向けの総評の下書きを作ります。',
    argsSchema: { engagement: z.string().describe('診断対象 ID') },
  },
  ({ engagement }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `診断対象 ${engagement} の報告書の総評（3.1.2）を書いてください。`,
          '',
          '条件:',
          '- get_dashboard と list_findings の内容だけを根拠にする',
          '- 読み手は非技術者。技術的影響ではなく事業への影響に翻訳する',
          '- 優先して対処すべき発見事項を名指しし、その理由を 1 文で示す',
          '- 複数の発見事項に共通する原因があれば指摘する',
          '- 曖昧な形容は使わず、件数と深刻度で裏づける',
          '',
          '書けたら update_doc で報告書の「3.1.2 総評」に書き込んでよいか確認してください。',
        ].join('\n'),
      },
    }],
  }),
)

server.registerPrompt(
  'plan_recon',
  {
    title: '偵察の次の一手を決める',
    description: '登録済みのサーフェスとツールログから、まだ手をつけていない領域を洗い出します。',
    argsSchema: { engagement: z.string().describe('診断対象 ID') },
  },
  ({ engagement }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `診断対象 ${engagement} の偵察の抜けを洗い出してください。`,
          '',
          '手順:',
          '1. list_surfaces で登録済みの攻撃面を把握する',
          '2. list_tool_logs でどのツールをどこに当てたかを確認する',
          '3. get_checklist で未検証の項目を確認する',
          '4. 「まだ確認していない面」と「確認したが記録が残っていない面」を分けて示す',
          '5. 次に実行すべきコマンドを、対象を具体的に埋めた形で提案する',
          '',
          'スコープ外（in_scope が false）のサーフェスには触れないでください。',
        ].join('\n'),
      },
    }],
  }),
)

/* ---------------- 起動 ---------------- */

const cfg = readConfig()
// stdout は JSON-RPC が使うため、ログは stderr へ出します。
process.stderr.write(`SecOwl MCP サーバ: 保存先 ${cfg.dataRoot}${READONLY ? '（読み取り専用）' : ''}\n`)
if (!fs.existsSync(cfg.dataRoot)) fs.mkdirSync(cfg.dataRoot, { recursive: true })

await server.connect(new StdioServerTransport())
