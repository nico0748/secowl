import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Markdown } from '../components/Markdown'

const STATE_LABEL: Record<string, string> = { todo: '未着手', doing: '進行中', done: '完了' }

/** 標準手順書の全文です。各フェーズの画面からも、ホームの「進め方」からも開けます。 */
export function PlaybookPage() {
  const { current, revision } = useStore()
  const [params, setParams] = useSearchParams()
  const phaseKey = params.get('phase') || ''
  const { data, error, loading } = useAsync(() => api.playbook(), [])
  const { data: full } = useAsync(
    () => api.playbookPhase(phaseKey || 'preparation'),
    [phaseKey],
  )
  const { data: prog } = useAsync(
    () => (current ? api.progress(current.id) : Promise.resolve(null)),
    [current?.id, revision],
  )

  if (error) return <div className="banner error">{error}</div>
  if (loading || !data) return <div className="empty">読み込んでいます…</div>

  const selected = data.find((p) => p.phase === params.get('phase')) || data[0]
  const state = prog?.phases.find((p) => p.phase === selected.phase)

  return (
    <>
      <div className="page-head">
        <h1>進め方</h1>
        <span className="tag">E0 事前準備 → E4 報告</span>
      </div>

      <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
        OWASP WSTG v4.2・OWASP Top 10:2025・CVSS v3.1 に沿った標準手順書です。内容は{' '}
        <code>knowledge/playbook/</code> の Markdown なので、手元で書き足せます。
      </p>

      <div className="filters">
        {data.map((p) => {
          const st = prog?.phases.find((x) => x.phase === p.phase)?.state
          return (
            <button
              key={p.phase}
              className={`chip${selected.phase === p.phase ? ' on' : ''}`}
              onClick={() => { const n = new URLSearchParams(params); n.set('phase', p.phase); setParams(n) }}
            >
              {p.label} {p.title}
              {st && <span style={{ marginLeft: 6, color: 'var(--app-text-muted)' }}>{STATE_LABEL[st]}</span>}
            </button>
          )
        })}
      </div>

      <article className="card">
        <div className="card-head">
          <span className="card-title">{selected.label} {selected.title}</span>
          {state?.next && <span className="card-note">次の一手: {state.next}</span>}
        </div>

        <p style={{ marginTop: 0 }}><b>目標</b>　{selected.goal}</p>
        <p style={{ color: 'var(--app-text-sub)' }}>{selected.summary}</p>

        <h3 className="guide-h">着手順</h3>
        <ol className="guide-steps">
          {selected.steps.map((s, i) => (
            <li key={i}>
              <b>{s.title}</b>
              <span>{s.detail}</span>
              {s.tools.length > 0 && (
                <span className="guide-tools">
                  {s.tools.map((t) => (
                    <Link key={t.slug} className="chip" to={`/tools?item=${encodeURIComponent(t.slug)}`}>{t.name}</Link>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>

        <div className="guide-cols">
          <div>
            <h3 className="guide-h">完了条件</h3>
            <ul className="guide-list">{selected.done.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
          <div>
            <h3 className="guide-h">つまずきやすい点</h3>
            <ul className="guide-list warn">{selected.pitfalls.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
        </div>

        <h3 className="guide-h">詳しい手順</h3>
        {full && full.phase === selected.phase
          ? <Markdown source={full.body || ''} />
          : <p style={{ color: 'var(--app-text-muted)' }}>読み込んでいます…</p>}

        <p className="doc-path" style={{ marginTop: 'var(--sp-4)' }}>knowledge/playbook/{selected.slug}.md</p>
      </article>
    </>
  )
}
