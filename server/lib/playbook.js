/**
 * 標準手順書（進め方）を扱います。
 *
 * knowledge/playbook/*.md が原本です。frontmatter に手順・完了条件・落とし穴を書き、
 * 本文に詳しい解説を書きます。アプリは各フェーズの画面でこれを読み出して表示します。
 */
import fs from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from './config.js'
import { readMd } from './md.js'
import { knowledge } from './knowledge.js'

const DIR = path.join(APP_ROOT, 'knowledge', 'playbook')

let cache = null

function arr(v) { return Array.isArray(v) ? v : [] }

function toolName(slug) {
  const hit = knowledge().tools.find((t) => t.slug === slug)
  if (!hit) return slug
  // 括弧の中は補足なので、チップには手前までを出します。
  return hit.name.split(/[（(]/)[0].trim() || hit.name
}

function load() {
  if (!fs.existsSync(DIR)) return []
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, body } = readMd(path.join(DIR, f))
      return {
        slug: f.replace(/\.md$/, ''),
        phase: data.phase || '',
        order: Number(data.order || 0),
        label: data.label || '',
        title: data.title || '',
        goal: data.goal || '',
        summary: data.summary || '',
        steps: arr(data.steps).map((s) => ({
          title: s.title || '',
          detail: s.detail || '',
          // 表示名はツールリファレンスから引きます。見つからない場合は slug のまま出します。
          tools: arr(s.tools).map((slug) => ({ slug, name: toolName(slug) })),
          doc: s.doc || '',
        })),
        done: arr(data.done),
        pitfalls: arr(data.pitfalls),
        body,
      }
    })
    .sort((a, b) => a.order - b.order)
}

/** 読み直しが要るときに呼びます。 */
export function invalidate() { cache = null }

/** 全フェーズを順番どおりに返します。 */
export function playbook({ reload = false } = {}) {
  if (!cache || reload) cache = load()
  return cache
}

/** 1 フェーズだけ返します。phase と slug のどちらでも引けます。 */
export function findPhase(key) {
  return playbook().find((p) => p.phase === key || p.slug === key) || null
}

/** 本文を落とした軽い一覧を返します。各フェーズの画面で使います。 */
export function playbookIndex() {
  return playbook().map(({ body, ...rest }) => rest)
}
