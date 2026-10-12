// 一部の依存パッケージは開発用の tsconfig.json を同梱したまま公開されており、
// エディタの TypeScript サーバがそれを拾って node_modules 内に大量のエラーを出す。
// - express-rate-limit: 未インストールの "@express-rate-limit/tsconfig" を extends している
// - fast-uri: include 指定なしで checkJs が有効なため、node_modules 全体を型検査してしまう
// どちらも実行時には使われないので削除する（npm install のたびに postinstall で実行）。
import { rmSync } from 'node:fs'

const targets = [
  'node_modules/express-rate-limit/tsconfig.json',
  'node_modules/fast-uri/tsconfig.json',
]

for (const file of targets) rmSync(file, { force: true })
