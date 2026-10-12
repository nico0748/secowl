/**
 * ブラウザで使うときの起動口です。
 *   npm start   → ビルドしてからこのファイルを実行します
 *   npm run dev → Vite の開発サーバと並行して動かします
 */
import { startServer } from './app.js'

const { url, dataRoot } = await startServer()
console.log(`SecOwl サーバを起動しました: ${url}`)
console.log(`調査データの保存先: ${dataRoot}`)
