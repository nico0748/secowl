import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

/** Markdown ファイルを frontmatter と本文に分けて読む。 */
export function readMd(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = matter(raw)
  return { data: parsed.data || {}, body: parsed.content || '', raw, file }
}

/** YAML が Date に解釈した値を YYYY-MM-DD の文字列へ戻す。 */
function normalizeData(data) {
  const out = {}
  for (const [k, v] of Object.entries(data || {})) {
    if (v instanceof Date) {
      const p = (n) => String(n).padStart(2, '0')
      out[k] = `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`
    } else {
      out[k] = v
    }
  }
  return out
}

/** frontmatter と本文を 1 ファイルに書き戻す。 */
export function writeMd(file, data, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const out = matter.stringify(body.replace(/^\n+/, '\n'), normalizeData(data))
  fs.writeFileSync(file, out, 'utf8')
  return out
}

/** frontmatter の一部だけを差し替える。未知のキーは保持する。 */
export function patchFrontmatter(file, patch) {
  const { data, body } = readMd(file)
  const next = { ...data, ...patch, updated: today() }
  writeMd(file, next, body)
  return { data: next, body }
}

/**
 * 本文を `## 見出し` 単位に分解する。
 * 返り値の要素は { level, heading, content }。見出し前の文章は heading: null で先頭に入る。
 */
export function parseSections(body) {
  const lines = body.split('\n')
  const sections = []
  let current = { level: 0, heading: null, lines: [] }
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence
    const m = !inFence && /^(#{2,4})\s+(.*)$/.exec(line)
    if (m) {
      sections.push(current)
      current = { level: m[1].length, heading: m[2].trim(), lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  sections.push(current)
  return sections
    .filter((s, i) => i > 0 || s.lines.join('').trim() !== '' || s.heading)
    .map((s) => ({ level: s.level, heading: s.heading, content: s.lines.join('\n').replace(/^\n+|\n+$/g, '') }))
}

/** parseSections の逆変換。 */
export function stringifySections(sections) {
  return sections
    .map((s) => {
      const head = s.heading ? `${'#'.repeat(s.level || 2)} ${s.heading}\n\n` : ''
      return head + (s.content ? s.content + '\n' : '')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** 指定見出しの中身だけを差し替える。見出しが無ければ末尾に追加する。 */
export function replaceSection(body, heading, content) {
  const sections = parseSections(body)
  const hit = sections.find((s) => s.heading === heading)
  if (hit) hit.content = content
  else sections.push({ level: 2, heading, content })
  return stringifySections(sections)
}

export function getSection(body, heading) {
  const hit = parseSections(body).find((s) => s.heading === heading)
  return hit ? hit.content : ''
}

/** `<!-- vs:name -->` 〜 `<!-- /vs:name -->` の間を置き換える。報告書の自動生成に使う。 */
export function replaceMarker(body, name, content) {
  const re = new RegExp(`<!--\\s*vs:${name}\\s*-->[\\s\\S]*?<!--\\s*/vs:${name}\\s*-->`, 'g')
  const block = `<!-- vs:${name} -->\n${content}\n<!-- /vs:${name} -->`
  if (re.test(body)) return body.replace(re, block)
  return body + '\n\n' + block
}

/** `- [ ] 項目` / `- [x] 項目` を抽出する。直前の `## 見出し` をグループ名にする。 */
export function parseChecklist(body) {
  const lines = body.split('\n')
  const items = []
  let group = ''
  lines.forEach((line, index) => {
    const h = /^#{2,4}\s+(.*)$/.exec(line)
    if (h) {
      group = h[1].trim()
      return
    }
    const m = /^(\s*)- \[([ xX])\]\s+(.*)$/.exec(line)
    if (m) items.push({ line: index, group, checked: m[2].toLowerCase() === 'x', text: m[3].trim() })
  })
  return items
}

export function setChecklistItem(body, lineIndex, checked) {
  const lines = body.split('\n')
  const line = lines[lineIndex]
  if (!line) return body
  lines[lineIndex] = line.replace(/- \[[ xX]\]/, `- [${checked ? 'x' : ' '}]`)
  return lines.join('\n')
}

export function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** ファイル名に使える文字列へ変換する。日本語はそのまま残す。 */
export function slug(s, max = 48) {
  return String(s || '')
    .trim()
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max) || 'untitled'
}

/** YAML の二重引用符つきスカラへ埋め込める形に直す。 */
function yamlEscape(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')
}

/**
 * テンプレートの {{key}} を置換する。未指定のキーは空文字にする。
 * frontmatter の中では YAML として壊れない形に直す。本文はそのまま入れる。
 */
export function fillTemplate(text, vars) {
  const sub = (s, escape) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = vars[k]
      if (v === undefined || v === null) return ''
      return escape ? yamlEscape(v) : String(v)
    })

  const m = /^---\n[\s\S]*?\n---\n/.exec(text)
  if (!m) return sub(text, false)
  return sub(m[0], true) + sub(text.slice(m[0].length), false)
}

export function listMd(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(dir, e.name))
    .sort()
}
