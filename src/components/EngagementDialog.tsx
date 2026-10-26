import { useState } from 'react'
import { Dialog } from './Dialog'
import type { Engagement } from '../types'

export type EngagementInput = Pick<Engagement, 'name' | 'client' | 'target_system' | 'period_from' | 'period_to'>

/**
 * 診断対象の作成と編集で兼用するダイアログです。
 * 編集では、保存すると engagement.json を更新し、スコープ文書と報告書の写しも同期します。
 */
export function EngagementDialog({ initial, onClose, onSubmit }: {
  /** 渡すと編集、省略すると作成 */
  initial?: Engagement
  onClose: () => void
  onSubmit: (input: EngagementInput) => Promise<void>
}) {
  const editing = !!initial
  const [f, setF] = useState<EngagementInput>({
    name: initial?.name ?? '',
    client: initial?.client ?? '',
    target_system: initial?.target_system ?? '',
    period_from: initial?.period_from ?? '',
    period_to: initial?.period_to ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof EngagementInput, v: string) => setF({ ...f, [k]: v })

  const submit = async () => {
    if (!f.name.trim()) { setErr('診断対象名を入力してください'); return }
    setBusy(true)
    try {
      await onSubmit(f)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={editing ? '診断対象の情報を編集' : '診断対象を作る'} onClose={onClose}>
      {err && <div className="banner error">{err}</div>}
      <div className="field">
        <label htmlFor="e-name">診断対象名</label>
        <input id="e-name" type="text" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="2026-10-example-corp" />
        <span className="hint">
          {editing ? `表示名だけが変わります。フォルダ名（${initial!.id}）は変わりません。` : 'この名前でフォルダを作ります。'}
        </span>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="e-client">顧客</label>
          <input id="e-client" type="text" value={f.client} onChange={(e) => set('client', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="e-target">対象システム</label>
          <input id="e-target" type="text" value={f.target_system} onChange={(e) => set('target_system', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="e-from">開始日</label>
          <input id="e-from" type="date" value={f.period_from} onChange={(e) => set('period_from', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="e-to">終了日</label>
          <input id="e-to" type="date" value={f.period_to} onChange={(e) => set('period_to', e.target.value)} />
        </div>
      </div>
      {editing && (
        <p className="hint-text">顧客・対象システム・期間は、スコープ文書と報告書の frontmatter にも反映します。</p>
      )}
      <div className="dialog-actions">
        <button className="btn quiet" onClick={onClose}>キャンセル</button>
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? '保存しています…' : editing ? '保存' : '診断対象を作る'}
        </button>
      </div>
    </Dialog>
  )
}
