/**
 * 実機確認（test/e2e/runner.e2e.cjs）専用の起動口。本番の electron/main.js はそのまま読み込み、その前に
 * 実行ファイルの一覧・探索パス・テンプレートを、テスト用の代役（fakenmap）に差し替えます。
 * アプリ本体には、環境変数や HTTP でこの差し替えを受ける口はありません（同じプロセスのコードだけが configure を呼べます）。
 */
import fs from 'node:fs'
import { execService, setupService } from '../../server/app.js'

const cfg = JSON.parse(fs.readFileSync(process.env.SECOWL_E2E_CONFIG, 'utf8'))
execService.configure({
  allowed: new Set(cfg.allowed),
  searchPaths: cfg.searchPaths,
  templates: () => cfg.templates,
  lookup: async () => [{ address: '198.51.100.7' }],
  killGraceMs: 500,
  drainMs: 500,
})
// 導入の点検も、本物のツールではなく代役だけを見るようにします。
setupService.configure({ allowed: new Set(cfg.allowed) })
globalThis.__secowlTest = { execService, setupService, confirms: [] }
await import('../../electron/main.js')
