import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useStore } from '../state'
import type { SearchHit } from '../types'
import { IS_MAC } from '../platform'
import { useDialogFocus } from './Dialog'

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  surface: 'サーフェス', log: 'ツール実行ログ', finding: '発見事項', doc: '文書',
}

export function hitPath(h: SearchHit) {
  switch (h.kind) {
    case 'surface': return `/surfaces/${encodeURIComponent(h.id)}`
    case 'log': return `/survey/logs/${encodeURIComponent(h.id)}`
    case 'finding': return `/findings/${encodeURIComponent(h.id)}`
    default: return `/doc?file=${encodeURIComponent(h.file)}`
  }
}

/** 一致した部分を <mark> で囲みます。文字列を分割して React のノードにし、innerHTML は使いません。 */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: { s: string; hit: boolean }[] = []
  let i = 0
  while (i < text.length) {
    const j = lower.indexOf(needle, i)
    if (j === -1) { parts.push({ s: text.slice(i), hit: false }); break }
    if (j > i) parts.push({ s: text.slice(i, j), hit: false })
    parts.push({ s: text.slice(j, j + needle.length), hit: true })
    i = j + needle.length
  }
  return <>{parts.map((p, k) => (p.hit ? <mark key={k}>{p.s}</mark> : <Fragment key={k}>{p.s}</Fragment>))}</>
}


const isTyping = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)

/** ヘッダーの「検索」ボタンと、⌘K / Ctrl+K / 「/」で開く全体検索。 */
export function SearchButton() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogOpen = !!document.querySelector('.dialog')
      // Mac は ⌘K だけを見ます（テキスト欄の Ctrl+K「行末まで削除」を奪わないため）。
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if (dialogOpen) return // ほかのダイアログの上には重ねません
        e.preventDefault()
        setOpen(true)
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(document.activeElement) && !document.querySelector('.dialog')) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)} aria-keyshortcuts="Control+K Meta+K /">
        <span>検索</span>
        <kbd>{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  )
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { current } = useStore()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(0)
  const [searched, setSearched] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useDialogFocus(boxRef)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const term = q.trim()
    if (!current || !term) { setHits([]); setSearched(''); return }
    let alive = true
    const t = window.setTimeout(async () => {
      setBusy(true)
      try {
        const res = await api.search(current.id, term, 50)
        if (alive) { setHits(res); setSel(0); setSearched(term) }
      } catch {
        if (alive) { setHits([]); setSearched(term) }
      } finally {
        if (alive) setBusy(false)
      }
    }, 150)
    return () => { alive = false; window.clearTimeout(t) }
  }, [q, current])

  // 同じファイルの一致は 1 行にまとめ、最初に一致した順に種類のまとまりを並べます（先頭の結果が一番上に来ます）。
  const groups = useMemo(() => {
    const order: SearchHit['kind'][] = []
    const map = new Map<SearchHit['kind'], (SearchHit & { more: number })[]>()
    const byFile = new Map<string, SearchHit & { more: number }>()
    for (const h of hits) {
      const seen = byFile.get(h.file)
      if (seen) { seen.more++; continue }
      const row = { ...h, more: 0 }
      byFile.set(h.file, row)
      if (!map.has(h.kind)) { map.set(h.kind, []); order.push(h.kind) }
      map.get(h.kind)!.push(row)
    }
    return order.map((k) => ({ kind: k, items: map.get(k)! }))
  }, [hits])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  const go = (h: SearchHit | undefined) => {
    if (!h) return
    onClose()
    nav(hitPath(h))
  }

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((n) => Math.min(flat.length - 1, n + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((n) => Math.max(0, n - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[sel]) }
  }
  // Esc は、結果のボタンにフォーカスがあるときも閉じます。
  const onBoxKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  let index = -1
  return (
    <div className="dialog-backdrop search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={boxRef} className="dialog search-dialog" onKeyDown={onBoxKeyDown} role="dialog" aria-modal="true" aria-label="全体検索">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={current ? `${current.name} の記録を検索（ID・名前・本文）` : '診断対象を選んでください'}
          aria-label="検索語"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="search-results"
          aria-activedescendant={flat[sel] ? `search-hit-${sel}` : undefined}
        />
        <div className="search-results" id="search-results" role="listbox" ref={listRef}>
          {busy && hits.length === 0 && <p className="search-empty">検索しています…</p>}
          {!busy && searched && hits.length === 0 && <p className="search-empty">『{searched}』に一致する記録はありません</p>}
          {!searched && !busy && <p className="search-empty">ID・名前・本文から探します。</p>}
          {groups.map((g) => (
            <section key={g.kind} className="search-group">
              <h3 className="search-group-title">{KIND_LABEL[g.kind]} <span className="search-group-count">{g.items.length}</span></h3>
              {g.items.map((h) => {
                index++
                const i = index
                return (
                  <button
                    key={`${h.file}:${h.line}`}
                    id={`search-hit-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === sel}
                    className={`search-hit${i === sel ? ' selected' : ''}`}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(h)}
                  >
                    <span className="search-hit-title">
                      {h.kind !== 'doc' && <><span className="search-hit-id">{h.id}</span> </>}
                      <Highlight text={h.title} q={searched} />
                    </span>
                    <span className="search-hit-text">
                      <Highlight text={h.text} q={searched} />
                      {h.more > 0 && <span className="search-hit-more">ほか {h.more} 行</span>}
                    </span>
                  </button>
                )
              })}
            </section>
          ))}
        </div>
        <div className="search-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> 選ぶ</span>
          <span><kbd>Enter</kbd> 開く</span>
          <span><kbd>Esc</kbd> 閉じる</span>
          {flat.length > 0 && <span className="search-footer-count">{flat.length} 件</span>}
        </div>
      </div>
    </div>
  )
}
