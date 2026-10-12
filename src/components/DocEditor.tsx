import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { Doc } from '../types'
import { Markdown } from './Markdown'
import { useStore } from '../state'

interface FieldSpec {
  key: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select'
  options?: { value: string; label: string }[]
  hint?: string
}

interface Props {
  file: string
  fields?: FieldSpec[]
  /** 編集対象にする見出し。省略すると本文の全見出しを出します。 */
  sectionHeadings?: string[]
  onSaved?: (doc: Doc) => void
  /** 右側（プレビューの上）に差し込むパネル。insert で指定見出しの末尾へ追記できます。 */
  renderAside?: (api: { insert: (heading: string, text: string) => void }) => ReactNode
}

export function DocEditor({ file, fields = [], sectionHeadings, onSaved, renderAside }: Props) {
  const { notify, bump } = useStore()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [data, setData] = useState<Record<string, string>>({})
  const [sections, setSections] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api.doc(file)
      .then((d) => {
        if (!alive) return
        setDoc(d)
        setErr(null)
        const fd: Record<string, string> = {}
        for (const f of fields) fd[f.key] = d.data[f.key] === undefined || d.data[f.key] === null ? '' : String(d.data[f.key])
        setData(fd)
        const sd: Record<string, string> = {}
        for (const s of d.sections) if (s.heading) sd[s.heading] = s.content
        setSections(sd)
      })
      .catch((e) => alive && setErr(String((e as Error).message)))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  if (err) return <div className="banner error">{err}</div>
  if (!doc) return <div className="empty">読み込んでいます…</div>

  const headings = sectionHeadings ?? doc.sections.filter((s) => s.heading).map((s) => s.heading as string)

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.saveDoc({
        file,
        data,
        sections: headings.map((h) => ({ heading: h, content: sections[h] ?? '' })),
      })
      setDoc(saved)
      notify('Markdown に保存しました')
      bump()
      onSaved?.(saved)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="doc-layout">
      <div className="card">
        {fields.length > 0 && (
          <div className="grid-2" style={{ marginBottom: 'var(--sp-4)' }}>
            {fields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`fm-${f.key}`}>{f.label}</label>
                {f.type === 'select' ? (
                  <select id={`fm-${f.key}`} value={data[f.key] ?? ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })}>
                    <option value="">（未設定）</option>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    id={`fm-${f.key}`}
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    step={f.type === 'number' ? '0.1' : undefined}
                    value={data[f.key] ?? ''}
                    onChange={(e) => setData({ ...data, [f.key]: e.target.value })}
                  />
                )}
                {f.hint && <span className="hint">{f.hint}</span>}
              </div>
            ))}
          </div>
        )}

        {headings.map((h) => (
          <div className="doc-section" key={h}>
            <label htmlFor={`sec-${h}`}>{h}</label>
            <textarea id={`sec-${h}`} value={sections[h] ?? ''} onChange={(e) => setSections({ ...sections, [h]: e.target.value })} />
          </div>
        ))}

        <div className="dialog-actions">
          <span className="doc-path" style={{ marginRight: 'auto' }}>{file}</span>
          <button className="btn" onClick={save} disabled={saving}>{saving ? '保存しています…' : 'Markdown に保存'}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {renderAside?.({
          insert: (heading, text) => {
            setSections((prev) => ({ ...prev, [heading]: [prev[heading] ?? '', text].filter(Boolean).join('\n\n') }))
            notify(`「${heading}」に追記しました。保存すると Markdown に反映します。`)
          },
        })}
        <div className="card">
          <div className="card-head"><span className="card-title">プレビュー</span></div>
          <Markdown source={doc.body} />
        </div>
      </div>
    </div>
  )
}
