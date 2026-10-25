import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Evidence } from '../types'
import { Dialog } from './Dialog'
import { MaskEditor } from './MaskEditor'
import { useStore } from '../state'
import { IS_MAC } from '../platform'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('ファイルを読めませんでした'))
    r.readAsDataURL(blob)
  })
}

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 挿入する Markdown。個票は 30-トリアージ/ にあるため、証跡は ../evidence/ で指します。 */
export const evidenceLink = (name: string) => `![証跡](../evidence/${name})`

export function EvidencePanel({ eid, prefix, onInsert, onPasted }: {
  eid: string
  prefix: string
  onInsert?: (markdown: string) => void
  /** 貼り付けた画像を保存した後に呼ばれます。挿入先の見出しは呼び出し側が決めます。 */
  onPasted?: (markdown: string) => void
}) {
  const { notify } = useStore()
  const [items, setItems] = useState<Evidence[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<Evidence | null>(null)
  const [over, setOver] = useState(false)
  // 既定ではこの票の証跡（名前が prefix- で始まるもの）だけを出し、別の票の画像を挿入しにくくします。
  const [showAll, setShowAll] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = () => api.evidence(eid).then(setItems).catch((e) => setErr(String((e as Error).message)))
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eid])

  const upload = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter((f) => IMAGE_TYPES.includes(f.type))
    if (!list.length) return
    try {
      for (const f of list) {
        await api.saveEvidence(eid, { name: `${prefix}-${f.name}`, dataUrl: await readAsDataUrl(f) })
      }
      notify('証跡を保存しました')
      reload()
    } catch (e) {
      setErr(String((e as Error).message))
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  // 個票を開いている間は、画像の貼り付け（⌘V / Ctrl+V）を証跡として受け付けます。
  const pastedRef = useRef(onPasted)
  pastedRef.current = onPasted
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      // ダイアログ（HTTP の貼り付けなど）を開いているあいだは、証跡として拾いません。
      if (document.querySelector('.dialog')) return
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'))
      if (!item) return // 画像以外の貼り付けは妨げません
      const blob = item.getAsFile()
      if (!blob) return
      e.preventDefault()
      try {
        const saved = await api.saveEvidence(eid, { name: `${prefix}-paste-${stamp()}.png`, dataUrl: await readAsDataUrl(blob) })
        reload()
        // 同名があると -02 などが付くため、要求した名前ではなく返り値の name を使います。
        pastedRef.current?.(evidenceLink(saved.name))
      } catch (x) {
        setErr(String((x as Error).message))
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid, prefix])

  const own = items.filter((e) => e.name.startsWith(`${prefix}-`))
  const others = items.length - own.length
  const shown = showAll ? items : own

  const url = (e: Evidence) => `/api/engagements/${encodeURIComponent(eid)}/evidence/${encodeURIComponent(e.name)}`

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">証跡</span>
        <span className="card-note">{own.length} 件</span>
      </div>
      {err && <div className="banner error">{err}</div>}
      <p className="evidence-note">
        診断対象フォルダの <code>evidence/</code> に保存します。公開前にマスキングを済ませてください。
      </p>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) }}
      >
        <p className="dropzone-text">画像を貼り付け（{IS_MAC ? '⌘V' : 'Ctrl+V'}）、またはここへドロップ</p>
        <button type="button" className="btn secondary small" onClick={() => fileRef.current?.click()}>画像を選ぶ</button>
        <input
          ref={fileRef}
          type="file"
          className="visually-hidden"
          tabIndex={-1}
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(e) => upload(e.target.files)}
          aria-label="証跡の画像を選ぶ"
        />
      </div>
      {others > 0 && (
        <label className="check-item evidence-toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          <span>ほかの票の証跡も表示（{others} 件）</span>
        </label>
      )}

      <div className="evidence-list">
        {shown.map((e) => (
          <div key={e.name} className="evidence-item">
            <img src={url(e)} alt={e.name} />
            <div className="evidence-meta">
              <span className="evidence-name">{e.name}</span>
              <span className="evidence-size">{Math.round(e.bytes / 1024)} KB</span>
            </div>
            <div className="evidence-actions">
              <button className="btn quiet small" onClick={() => setEditing(e)}>マスキング</button>
              {onInsert && (
                <button className="btn quiet small" onClick={() => onInsert(evidenceLink(e.name))}>
                  本文へ挿入
                </button>
              )}
              <button
                className="btn quiet small"
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
        {shown.length === 0 && <div className="empty">この票の証跡はまだありません。</div>}
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
