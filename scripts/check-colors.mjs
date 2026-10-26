// 色の直書きが残っていないかを調べます。画面の色は src/styles/tokens.css の --app-* だけを使います。
// 例外: tokens.css（値の定義）、書き出し（server/lib/export-colors.js・exporters.js・docx.js。常にライト）、
//       ウィンドウの地の色（electron/main.js・index.html。tokens.css の --app-bg と同じ値）、
//       CVSS 計算機とホームのテクノロジーの以前の版の色（src/styles/cvss-legacy.css・dashboard-legacy.css）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALLOW = new Set([
  'src/styles/tokens.css',
  'src/styles/cvss-legacy.css', // CVSS 計算機だけを以前の版の色で描く
  'src/styles/dashboard-legacy.css', // ホームのテクノロジーだけを以前の版の色で描く
  'server/lib/export-colors.js', 'server/lib/exporters.js', 'server/lib/docx.js',
  'electron/main.js', 'index.html',
])
// 旧名: 2025 年までの名前（接頭辞なし・デジタル庁の旧カラー名）と、Material You 版の中間層・使わなくなった --app-* の名前
const LEGACY = /var\(--(bg|surface|surface-sub|border|border-strong|text|text-sub|text-muted|primary|primary-hover|primary-bg|focus-ring|shadow|sev-(critical|high|medium|low|info)|cat-[0-9a-z]+|(sumi|sea|wood|sun|forest)-\d+|md-sys-color-[a-z-]+|md-state-[a-z-]+|app-cat-[0-9a-z]+|app-(on-)?sev-[a-z]+-container)\)/
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(white|black)(?![-\w])/
const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) walk(rel)
    else if (/\.(tsx?|css|js|cjs|html)$/.test(e.name)) files.push(rel)
  }
}
for (const d of ['src', 'server', 'electron']) walk(d)
files.push('index.html')
const bad = []
for (const f of files) {
  if (ALLOW.has(f)) continue
  fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
    // 文字列中の HTTP ステータスなどの誤検出を避けるため、色らしい文脈だけを見ます
    const code = line.replace(/\/\/.*$/, '')
    if (LEGACY.test(code) || (LITERAL.test(code) && /color|background|fill|stroke|border|shadow|style|#[0-9a-fA-F]{6}\b/i.test(code))) bad.push(`${f}:${i + 1}: ${line.trim()}`)
  })
}
if (bad.length) {
  console.error('色の直書き、または旧名のトークンが残っています:\n' + bad.join('\n'))
  process.exit(1)
}
console.log(`OK: ${files.length} ファイルに色の直書きはありません（例外 ${ALLOW.size} ファイル）`)
