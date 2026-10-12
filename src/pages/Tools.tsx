import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Markdown } from '../components/Markdown'
import { Dialog } from '../components/Dialog'
import type { KnowledgeItem } from '../types'

const PHASE_LABEL: Record<string, string> = {
  recon: '偵察・列挙', survey: '脆弱性調査', triage: 'トリアージ', report: '報告',
}

export function ToolsPage() {
  const { current, notify, bump } = useStore()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [logFor, setLogFor] = useState<KnowledgeItem | null>(null)

  const tab = params.get('tab') === 'usecases' ? 'usecases' : 'tools'
  const category = params.get('category') || ''
  const slug = params.get('item') || ''

  const { data, error, loading } = useAsync(() => api.knowledge(), [])

  const items = useMemo(() => {
    if (!data) return []
    const source = tab === 'tools' ? data.tools : data.usecases
    const q = query.trim().toLowerCase()
    return source.filter((it) => {
      if (tab === 'tools' && category && it.category !== category) return false
      if (!q) return true
      return (
        it.name.toLowerCase().includes(q) ||
        it.slug.includes(q) ||
        it.tags.some((t) => t.toLowerCase().includes(q)) ||
        it.body.toLowerCase().includes(q)
      )
    })
  }, [data, tab, category, query])

  const selected = items.find((i) => i.slug === slug) || items[0] || null

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
    if (key === 'tab' || key === 'category') next.delete('item')
    setParams(next)
  }

  if (error) return <div className="banner error">{error}</div>
  if (loading || !data) return <div className="empty">読み込んでいます…</div>

  return (
    <>
      <div className="page-head">
        <h1>ツール</h1>
        <span className="tag">{data.tools.length} ツール</span>
        <span className="tag">{data.usecases.length} ユースケース</span>
      </div>

      <p style={{ fontSize: 14, color: 'var(--text-sub)', marginTop: 0 }}>
        診断で使うツールの要点と、使う順番をまとめた手引きです。内容は <code>knowledge/</code> の Markdown なので、
        手元で書き足せます。
      </p>

      <div className="filters">
        <button className={`chip${tab === 'tools' ? ' on' : ''}`} onClick={() => setParam('tab', 'tools')}>ツール</button>
        <button className={`chip${tab === 'usecases' ? ' on' : ''}`} onClick={() => setParam('tab', 'usecases')}>ユースケース</button>
      </div>

      <div className="filters">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ツール名・用途・コマンドで検索"
          style={{ maxWidth: 360 }}
          aria-label="検索"
        />
        {tab === 'tools' && (
          <>
            <button className={`chip${!category ? ' on' : ''}`} onClick={() => setParam('category', null)}>すべて</button>
            {data.categories.map((c) => (
              <button key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setParam('category', c)}>{c}</button>
            ))}
          </>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty">該当する項目がありません。</div>
      ) : (
        <div className="kb-layout">
          <nav className="card" style={{ padding: 'var(--sp-2)', maxHeight: '72vh', overflowY: 'auto' }} aria-label="項目の一覧">
            {items.map((it) => (
              <button
                key={it.slug}
                className={`kb-item${selected?.slug === it.slug ? ' on' : ''}`}
                style={tab === 'usecases' ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}
                onClick={() => setParam('item', it.slug)}
              >
                {tab === 'tools' && it.icon && (
                  <img src={it.icon} alt="" loading="lazy" />
                )}
                <span className="kb-name">{it.name}</span>
                {tab === 'tools'
                  ? <span className="kb-sub">{it.category}</span>
                  : <span className="kb-sub">{it.summary}</span>}
              </button>
            ))}
          </nav>

          <article className="card">
            {selected && (
              <>
                <div className="card-head" style={{ alignItems: 'center' }}>
                  {tab === 'tools' && selected.icon && (
                    <img className="kb-head-icon" src={selected.icon} alt="" />
                  )}
                  <h2 style={{ fontSize: 20 }}>{selected.name}</h2>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)' }}>
                    {selected.url && (
                      <a className="btn quiet" style={{ minHeight: 36 }} href={selected.url} target="_blank" rel="noreferrer">
                        公式サイト
                      </a>
                    )}
                    {tab === 'tools' && current && (
                      <button className="btn secondary" style={{ minHeight: 36 }} onClick={() => setLogFor(selected)}>
                        実行ログに記録
                      </button>
                    )}
                  </div>
                </div>

                <div className="filters" style={{ marginBottom: 'var(--sp-3)' }}>
                  {selected.category && <span className="tag">{selected.category}</span>}
                  {selected.license && <span className="tag">{selected.license}</span>}
                  {selected.phase.map((p) => <span key={p} className="tag">{PHASE_LABEL[p] || p}</span>)}
                  {selected.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                  {selected.authorization && (
                    <span className="sev-pill" style={{ background: 'var(--wood-700)' }}>承認 {selected.authorization}</span>
                  )}
                </div>

                <Markdown source={selected.body} />
                <p className="doc-path" style={{ marginTop: 'var(--sp-4)' }}>
                  knowledge/{tab}/{selected.slug}.md
                </p>
              </>
            )}
          </article>
        </div>
      )}

      {logFor && current && (
        <LogDialog
          tool={logFor}
          onClose={() => setLogFor(null)}
          onCreate={async (input) => {
            await api.createToolLog(current.id, input)
            setLogFor(null)
            notify('ツール実行ログを作りました')
            bump()
          }}
        />
      )}
    </>
  )
}

/** 選んだツールの名前を入れた状態で実行ログを起票します。 */
function LogDialog({ tool, onClose, onCreate }: {
  tool: KnowledgeItem
  onClose: () => void
  onCreate: (input: Record<string, unknown>) => Promise<void>
}) {
  // 本文から ``` で囲まれたコマンドを拾い、候補として出します。
  const samples = useMemo(() => {
    const out: string[] = []
    const re = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g
    let m: RegExpExecArray | null
    while ((m = re.exec(tool.body))) {
      for (const line of m[1].split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#') || t.startsWith('//')) continue
        if (out.length < 12 && !out.includes(t)) out.push(t)
      }
    }
    return out
  }, [tool.body])

  const [command, setCommand] = useState(samples[0] || '')
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState(tool.phase[0] || 'survey')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog title={`実行ログに記録 — ${tool.name}`} onClose={onClose}>
      <div className="field">
        <label htmlFor="l-title">見出し</label>
        <input id="l-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="省略すると日時が入ります" />
      </div>
      <div className="field">
        <label htmlFor="l-cmd">実行コマンド</label>
        <input id="l-cmd" type="text" value={command} onChange={(e) => setCommand(e.target.value)} />
      </div>
      {samples.length > 0 && (
        <div className="field">
          <label>このページのコマンド例</label>
          <div style={{ display: 'grid', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
            {samples.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                style={{ textAlign: 'left', fontFamily: "'SFMono-Regular', ui-monospace, monospace", fontSize: 13, borderRadius: 'var(--radius-sm)' }}
                onClick={() => setCommand(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="l-phase">フェーズ</label>
        <select id="l-phase" value={phase} onChange={(e) => setPhase(e.target.value)}>
          {Object.entries(PHASE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="dialog-actions">
        <button className="btn quiet" onClick={onClose}>キャンセル</button>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try { await onCreate({ tool: tool.name, title, command, phase }) } finally { setBusy(false) }
          }}
        >
          Markdown を生成
        </button>
      </div>
    </Dialog>
  )
}
