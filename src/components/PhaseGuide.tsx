import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Markdown } from '../components/Markdown'
import type { PhaseKey } from '../types'

const KEY = (phase: string) => `secowl.guide.${phase}`

function readOpen(phase: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(KEY(phase))
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/**
 * 各フェーズの画面の先頭に出す手順パネルです。
 * 内容は knowledge/playbook/*.md が原本で、開閉の状態だけ端末に覚えさせます。
 */
export function PhaseGuide({ phase, defaultOpen = false }: {
  phase: PhaseKey
  defaultOpen?: boolean
}) {
  const { current, revision } = useStore()
  const [open, setOpen] = useState(() => readOpen(phase, defaultOpen))
  const [detail, setDetail] = useState(false)
  const { data } = useAsync(() => api.playbookPhase(phase), [phase])
  const { data: prog } = useAsync(
    () => (current ? api.progress(current.id) : Promise.resolve(null)),
    [current?.id, revision],
  )
  const nextAction = prog?.phases.find((p) => p.phase === phase)?.next || ''

  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(KEY(phase), next ? '1' : '0') } catch { /* 保存できなくても動きます */ }
  }

  if (!data) return null

  return (
    <section className="guide">
      <button className="guide-head" onClick={toggle} aria-expanded={open}>
        <span className="guide-badge">{data.label}</span>
        <span className="guide-title">進め方 — {data.title}</span>
        <span className="guide-goal">{data.goal}</span>
        <span className="guide-caret" aria-hidden="true">{open ? '閉じる' : '開く'}</span>
      </button>

      {nextAction && (
        <p className="guide-next"><b>次の一手</b>　{nextAction}</p>
      )}

      {open && (
        <div className="guide-body">
          <p className="guide-summary">{data.summary}</p>

          <h3 className="guide-h">着手順</h3>
          <ol className="guide-steps">
            {data.steps.map((s, i) => (
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
              <ul className="guide-list">
                {data.done.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="guide-h">つまずきやすい点</h3>
              <ul className="guide-list warn">
                {data.pitfalls.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          </div>

          <div className="guide-actions">
            <button className="btn quiet" style={{ minHeight: 36 }} onClick={() => setDetail((v) => !v)}>
              {detail ? '詳しい手順を閉じる' : '詳しい手順を読む'}
            </button>
            <Link className="btn quiet" style={{ minHeight: 36 }} to="/playbook">全フェーズの手順書</Link>
          </div>

          {detail && <div className="guide-detail"><Markdown source={data.body || ''} /></div>}
        </div>
      )}
    </section>
  )
}
