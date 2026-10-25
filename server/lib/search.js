/**
 * 診断対象フォルダの Markdown を検索します。アプリの全体検索と MCP の search で共通に使います。
 *
 * 返り値の各行は { file, line, text, kind, id, title }。
 * frontmatter の id と title の一致を先に、本文の一致を後に並べます。
 * 途中で打ち切ると 30-トリアージ に届かないことがあるため、すべてのファイルを走査してから limit で切ります。
 */
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { dataRoot } from './config.js'
import { engDir, toPosix } from './store.js'

const BODY_HITS_PER_FILE = 5

function kindOf(rel) {
  const parts = rel.split(/[\\/]/)
  const dir = parts[1] || ''
  const name = parts[parts.length - 1]
  if (dir === '30-トリアージ' && name.startsWith('fnd-')) return 'finding'
  if (dir === '20-調査' && parts[2] === 'logs' && name.startsWith('log-')) return 'log'
  if (dir === '10-偵察' && name.startsWith('srf-')) return 'surface'
  return 'doc'
}

/** 一致した行を、記法を外して読める形にします（frontmatter のキー、表の区切り、見出しの #）。 */
export function cleanLine(line, inFrontmatter) {
  let t = line.trim()
  if (inFrontmatter) {
    const m = /^[\w-]+:\s*(.*)$/.exec(t)
    if (m) t = m[1]
    t = t.replace(/^- /, '').replace(/^(['"])(.*)\1$/, '$2')
    return t
  }
  if (/^\|.*\|$/.test(t)) {
    if (/^\|[\s:|-]+\|$/.test(t)) return ''
    return t.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim()).filter(Boolean).join('／')
  }
  return t.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '')
}

/** 文書（個票やサーフェス以外）の題名。どの診断対象でも同じ title になりがちなので、ファイル名を使います。 */
function docTitle(full) {
  return path.basename(full, '.md').replace(/^\d+-/, '')
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

export function searchDocs(eid, query, limit = 60) {
  const root = engDir(eid)
  const needle = String(query || '').toLowerCase()
  if (!needle || !fs.existsSync(root)) return []
  const metaHits = []
  const bodyHits = []

  for (const full of walk(root).sort()) {
    const raw = fs.readFileSync(full, 'utf8')
    const file = toPosix(path.relative(dataRoot(), full))
    let data = {}
    try { data = matter(raw).data || {} } catch { data = {} }
    const kind = kindOf(file)
    const id = String(data.id || path.basename(full, '.md').split('-').slice(0, 2).join('-'))
    const metaTitle = String(data.title || data.vuln_name || path.basename(full, '.md'))
    const title = kind === 'doc' ? docTitle(full) : metaTitle
    const lines = raw.split('\n')
    const base = { kind, id, title }
    // frontmatter の終わりの行（0 始まり）。ない場合は -1。
    const fmEnd = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1

    let metaLine = 0
    const idHit = id.toLowerCase().includes(needle)
    if (idHit || title.toLowerCase().includes(needle)) {
      const field = idHit ? 'id' : kind === 'doc' ? '' : 'title'
      const idx = field ? lines.findIndex((l) => l.startsWith(`${field}:`)) : -1
      metaLine = idx === -1 ? 1 : idx + 1
      const text = idx === -1 ? title : cleanLine(lines[idx], true)
      metaHits.push({ file, line: metaLine, text: text.slice(0, 300), ...base })
    }

    let n = 0
    for (let i = 0; i < lines.length && n < BODY_HITS_PER_FILE; i++) {
      if (i + 1 === metaLine) continue
      if (lines[i].toLowerCase().includes(needle)) {
        const text = cleanLine(lines[i], i > 0 && i < fmEnd)
        if (!text) continue
        bodyHits.push({ file, line: i + 1, text: text.slice(0, 300), ...base })
        n++
      }
    }
  }
  return [...metaHits, ...bodyHits].slice(0, limit)
}
