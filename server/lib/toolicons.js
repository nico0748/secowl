/**
 * ツールのアイコンを扱います。
 *
 * 画像は public/tool-icons/<slug>.<ext> に置いた固定ファイルだけを使います。
 * アプリは実行中に外部へ取得しにいきません。差し替えは scripts/fetch-tool-icons.js で
 * 一度だけ行い、生成されたファイルをそのままリポジトリに含めて運用します。
 */
import fs from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from './config.js'

export const ICON_DIR = path.join(APP_ROOT, 'public', 'tool-icons')
const MANIFEST = path.join(ICON_DIR, 'manifest.json')
export const EXTS = ['.svg', '.png', '.webp', '.jpg', '.ico', '.gif']

let index = null

function manifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) } catch { return {} }
}

function build() {
  const map = new Map()
  if (!fs.existsSync(ICON_DIR)) return map
  const m = manifest()
  for (const f of fs.readdirSync(ICON_DIR)) {
    const ext = path.extname(f).toLowerCase()
    if (!EXTS.includes(ext)) continue
    const slug = f.slice(0, -ext.length)
    const prev = map.get(slug)
    // 同じ slug で複数の拡張子があるときは、EXTS の並び順で先にあるものを使います。
    if (prev && EXTS.indexOf(path.extname(prev.file).toLowerCase()) <= EXTS.indexOf(ext)) continue
    map.set(slug, { file: f, url: `/tool-icons/${f}`, source: m[slug]?.source || 'tile' })
  }
  return map
}

/** 一覧を読み直します。アイコンを差し替えたあとに呼びます。 */
export function invalidate() { index = null }

/** 表示に使う URL を返します。無ければ null を返します。 */
export function resolveIcon(slug) {
  if (!index) index = build()
  return index.get(String(slug)) || null
}
