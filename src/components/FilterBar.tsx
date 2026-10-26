import { useEffect, useState, type ReactNode } from 'react'

export interface Chip { value: string; label: string }

/**
 * 一覧画面の検索欄と状態のチップ。条件は呼び出し側が URL のクエリに残します。
 */
export function FilterBar({ query, onQuery, placeholder, chips, selected, onSelect, allLabel = 'すべての状態', label, children }: {
  query: string
  onQuery: (q: string) => void
  placeholder: string
  chips: Chip[]
  selected: string | null
  onSelect: (value: string | null) => void
  allLabel?: string
  label: string
  /** 状態のチップと同じ段に、区切り線をはさんで並べるもの（深刻度のチップなど） */
  children?: ReactNode
}) {
  // 入力のたびに URL を書き換えると履歴が増えるため、少し待ってから反映します。
  const [text, setText] = useState(query)
  useEffect(() => { setText(query) }, [query])
  useEffect(() => {
    if (text === query) return
    const t = window.setTimeout(() => onQuery(text), 200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <div className="filter-bar">
      <input
        type="search"
        className="filter-search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      <div className="filter-row">
      <div className="filters" role="group" aria-label="状態で絞り込む">
        <button type="button" className={`chip${!selected ? ' on' : ''}`} aria-pressed={!selected} onClick={() => onSelect(null)}>{allLabel}</button>
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`chip${selected === c.value ? ' on' : ''}`}
            aria-pressed={selected === c.value}
            onClick={() => onSelect(selected === c.value ? null : c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {children && <><span className="filter-divider" aria-hidden="true" />{children}</>}
      </div>
    </div>
  )
}
