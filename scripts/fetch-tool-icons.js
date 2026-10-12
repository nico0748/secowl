#!/usr/bin/env node
/**
 * ツールのアイコンを公式サイトから一度だけ取得し、public/tool-icons/ に保存します。
 *
 * これは保守用のスクリプトです。アプリ本体は実行中に外部へ取得しにいきません。
 * ここで保存したファイルをそのままリポジトリに含め、以後はそれを恒久的に使います。
 *
 *   node scripts/fetch-tool-icons.js              まだ取得していないツールだけ
 *   node scripts/fetch-tool-icons.js --force      すべて取り直す
 *   node scripts/fetch-tool-icons.js --only nmap,httpx
 *
 * 取得の順序は「アイコン → ホームのカバー画像」です。
 *   apple-touch-icon → icon / shortcut icon → /favicon.ico → og:image / twitter:image
 * どれも取得できないツールは、同梱の既定タイル（<slug>.png）がそのまま残ります。
 */
import fs from 'node:fs'
import path from 'node:path'
import { knowledge } from '../server/lib/knowledge.js'
import { ICON_DIR, EXTS } from '../server/lib/toolicons.js'

const MANIFEST = path.join(ICON_DIR, 'manifest.json')
const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/gif': '.gif',
}
const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT = 12000
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const TILE_DIR = path.join(ICON_DIR, 'tiles')

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) } catch { return {} }
}

function writeManifest(m) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n', 'utf8')
}

async function get(url, accept) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

/** HTML から、アイコンとカバー画像の候補を優先度順に取り出します。 */
function candidatesFromHtml(html, baseUrl) {
  const out = []
  const push = (href, kind, size = 0) => {
    if (!href) return
    try { out.push({ url: new URL(href, baseUrl).href, kind, size }) } catch { /* 不正な URL は捨てます */ }
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (/\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '').toLowerCase()
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    const sizes = /\bsizes\s*=\s*["'](\d+)x\d+["']/i.exec(tag)?.[1]
    const size = sizes ? Number(sizes) : 0
    if (/apple-touch-icon/.test(rel)) push(href, 'apple-touch-icon', size || 180)
    else if (/\bicon\b/.test(rel) || /shortcut icon/.test(rel)) push(href, 'icon', size)
  }

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (/\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '').toLowerCase()
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (key === 'og:image' || key === 'og:image:url') push(content, 'og:image', 1)
    else if (key === 'twitter:image' || key === 'twitter:image:src') push(content, 'twitter:image', 0)
  }

  const rank = { 'apple-touch-icon': 0, icon: 1, 'og:image': 2, 'twitter:image': 3 }
  return out
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.size - a.size)
    .filter((v, i, arr) => arr.findIndex((x) => x.url === v.url) === i)
}

async function download(url) {
  const res = await get(url, 'image/*,*/*')
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const ext = MIME_EXT[type]
  if (!ext) throw new Error(`画像ではありません（${type || '不明'}）`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) throw new Error('中身が空です')
  if (buf.length > MAX_BYTES) throw new Error(`大きすぎます（${Math.round(buf.length / 1024)} KB）`)
  return { buf, ext }
}

/** 差し替える前に、同梱の既定タイルを tiles/ へ退避します。 */
function keepTile(slug) {
  const tile = path.join(ICON_DIR, slug + '.png')
  if (!fs.existsSync(tile)) return
  fs.mkdirSync(TILE_DIR, { recursive: true })
  const kept = path.join(TILE_DIR, slug + '.png')
  if (!fs.existsSync(kept)) fs.copyFileSync(tile, kept)
}

async function fetchIcon(tool) {
  const slug = tool.slug
  if (!tool.url) return { slug, ok: false, reason: '公式サイトの URL がありません' }

  const candidates = []
  try {
    const res = await get(tool.url, 'text/html,*/*')
    const html = (await res.text()).slice(0, 400000)
    candidates.push(...candidatesFromHtml(html, res.url || tool.url))
  } catch {
    // ページを取れなくても /favicon.ico は試します。
  }
  try {
    const fav = new URL('/favicon.ico', tool.url).href
    if (!candidates.some((c) => c.url === fav)) candidates.push({ url: fav, kind: 'favicon.ico', size: 0 })
  } catch { /* URL が不正な場合は飛ばします */ }

  const cover = (k) => (k === 'og:image' || k === 'twitter:image' ? 1 : 0)
  const order = [...candidates].sort((a, b) => cover(a.kind) - cover(b.kind))

  for (const c of order) {
    try {
      const { buf, ext } = await download(c.url)
      keepTile(slug)
      for (const e of EXTS) {
        const old = path.join(ICON_DIR, slug + e)
        if (fs.existsSync(old)) fs.unlinkSync(old)
      }
      fs.writeFileSync(path.join(ICON_DIR, slug + ext), buf)
      const source = cover(c.kind) ? 'cover' : 'icon'
      const m = readManifest()
      m[slug] = { source, from: c.url, kind: c.kind, bytes: buf.length, at: new Date().toISOString() }
      writeManifest(m)
      return { slug, ok: true, source, from: c.url, bytes: buf.length }
    } catch {
      // 次の候補へ進みます。
    }
  }
  return { slug, ok: false, reason: 'アイコンもカバー画像も取得できませんでした' }
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const onlyArg = args.find((a) => a.startsWith('--only'))
const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1] || '').split(',').filter(Boolean) : null

fs.mkdirSync(ICON_DIR, { recursive: true })
const manifest = readManifest()
const all = knowledge().tools
const targets = all
  .filter((t) => (only ? only.includes(t.slug) : true))
  .filter((t) => force || !manifest[t.slug])

if (!targets.length) {
  console.log('取得するものはありません。--force を付けると取り直します。')
  process.exit(0)
}

console.log(`${targets.length} 件を取得します（保存先: ${ICON_DIR}）`)
const queue = [...targets]
const results = []
await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
  while (queue.length) {
    const t = queue.shift()
    const r = await fetchIcon(t)
    results.push(r)
    console.log(r.ok ? `  ok   ${r.slug}  ${r.source}  ${r.from}` : `  skip ${r.slug}  ${r.reason}`)
  }
}))

const ok = results.filter((r) => r.ok)
console.log(`\n取得 ${ok.length} / ${results.length} 件`)
console.log(`  公式アイコン ${ok.filter((r) => r.source === 'icon').length} 件 / カバー画像 ${ok.filter((r) => r.source === 'cover').length} 件`)
console.log(`取得できなかったツールは、同梱の既定タイルをそのまま使います。`)
console.log(`public/tool-icons/ をリポジトリにコミットすると、以後は取得なしで表示されます。`)
