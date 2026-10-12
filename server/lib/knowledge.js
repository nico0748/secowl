import fs from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from './config.js'
import { readMd } from './md.js'
import { resolveIcon } from './toolicons.js'

const KNOWLEDGE_DIR = path.join(APP_ROOT, 'knowledge')

let cache = null

function loadDir(sub) {
  const dir = path.join(KNOWLEDGE_DIR, sub)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, body } = readMd(path.join(dir, f))
      const slug = f.replace(/\.md$/, '')
      const icon = sub === 'tools' ? resolveIcon(slug) : null
      return {
        slug,
        name: data.name || f,
        category: data.category || '',
        tags: Array.isArray(data.tags) ? data.tags : [],
        url: data.url || '',
        license: data.license || '',
        phase: Array.isArray(data.phase) ? data.phase : [],
        authorization: data.authorization || '',
        summary: data.summary || '',
        tools: Array.isArray(data.tools) ? data.tools : [],
        icon: icon?.url || '',
        iconSource: icon?.source || '',
        body,
      }
    })
}

/** アイコンを取得したあとなど、読み直しが要るときに呼びます。 */
export function invalidate() { cache = null }

/** ツールリファレンスとユースケースを読み込みます。内容は起動中に変わらないため 1 度だけ読みます。 */
export function knowledge({ reload = false } = {}) {
  if (cache && !reload) return cache
  const tools = loadDir('tools')
  const usecases = loadDir('usecases')
  const categories = []
  for (const t of tools) if (t.category && !categories.includes(t.category)) categories.push(t.category)
  cache = { tools, usecases, categories }
  return cache
}

export function findTool(slug) {
  return knowledge().tools.find((t) => t.slug === slug || t.name === slug) || null
}

export function findUsecase(slug) {
  return knowledge().usecases.find((u) => u.slug === slug || u.name === slug) || null
}
