import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Evidence } from '../types'
import { Dialog } from './Dialog'
import { MaskEditor } from './MaskEditor'
import { useStore } from '../state'

export function EvidencePanel({ eid, prefix, onInsert }: {
  eid: string
  prefix: string
  onInsert?: (markdown: string) => void
}) {
  const { notify } = useStore()
  const [items, setItems] = useState<Evidence[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<Evidence | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = () => api.evidence(eid).then(setItems).catch((e) => setErr(String((e as Error).message)))
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eid])

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      for (const f of Array.from(files)) {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(new Error('ファイルを読めませんでした'))
          r.readAsDataURL(f)
        })
        await api.saveEvidence(eid, { name: `${prefix}-${f.name}`, dataUrl })
      }
      notify('証跡を保存しました')
      reload()
    } catch (e) {
      setErr(String((e as Error).message))
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const url = (e: Evidence) => `/api/engagements/${encodeURIComponent(eid)}/evidence/${encodeURIComponent(e.name)}`

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">証跡</span>
        <span className="card-note">{items.length} 件</span>
      </div>
      {err && <div className="banner error">{err}</div>}
      <p style={{ fontSize: 14, color: 'var(--text-sub)', marginTop: 0 }}>
        診断対象フォルダの <code>evidence/</code> に保存します。公開前にマスキングを済ませてください。
      </p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => upload(e.target.files)} style={{ fontSize: 14 }} />

      <div style={{ display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
        {items.map((e) => (
          <div key={e.name} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-2)' }}>
            <img src={url(e)} alt={e.name} style={{ width: '100%', borderRadius: 4, display: 'block' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, wordBreak: 'break-all', flex: 1 }}>{e.name}</span>
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{Math.round(e.bytes / 1024)} KB</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <button className="btn quiet" style={{ minHeight: 36 }} onClick={() => setEditing(e)}>マスキング</button>
              {onInsert && (
                <button className="btn quiet" style={{ minHeight: 36 }} onClick={() => onInsert(`![証跡](evidence/${e.name})`)}>
                  本文へ挿入
                </button>
              )}
              <button
                className="btn quiet"
                style={{ minHeight: 36 }}
                onClick={async () => {
                  if (!window.confirm(`${e.name} を削除します。元に戻せません。`)) return
                  try { await api.deleteEvidence(eid, e.name); notify('証跡を削除しました'); reload() }
                  catch (x) { setErr(String((x as Error).message)) }
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="empty">証跡はまだありません。</div>}
      </div>

      {editing && (
        <Dialog title={`マスキング — ${editing.name}`} onClose={() => setEditing(null)}>
          <MaskEditor
            src={url(editing) + `?t=${Date.now()}`}
            onClose={() => setEditing(null)}
            onSave={async (dataUrl) => {
              await api.saveEvidence(eid, { name: editing.name, dataUrl, overwrite: true })
              notify('マスキングした画像で上書きしました')
              setEditing(null)
              reload()
            }}
          />
        </Dialog>
      )}
    </div>
  )
}
