import { useState } from 'react'
import { api } from '../api'
import { useStore } from '../state'
import type { Engagement } from '../types'
import { EngagementDialog, type EngagementInput } from './EngagementDialog'

/** 診断対象の情報を保存し、同期の結果をトーストで知らせます。 */
export function useSaveEngagement() {
  const { reloadEngagements, notify, bump } = useStore()
  return async (eid: string, patch: Partial<EngagementInput>) => {
    const res = await api.updateEngagement(eid, patch)
    await reloadEngagements()
    bump()
    notify(res.synced.length
      ? '診断対象の情報を保存しました。スコープ文書と報告書にも反映しました'
      : '診断対象の情報を保存しました')
    return res
  }
}

/** 診断対象の情報（表示だけ）と「診断対象の情報を編集」ボタン。正は engagement.json です。 */
export function EngagementInfoCard({ engagement, title = '診断対象の情報' }: { engagement: Engagement; title?: string }) {
  const [open, setOpen] = useState(false)
  const save = useSaveEngagement()
  const v = (s: string) => s || '未記入'
  return (
    <section className="card eng-info">
      <div className="card-head">
        <span className="card-title">{title}</span>
        <button className="btn secondary small card-head-action" onClick={() => setOpen(true)}>診断対象の情報を編集</button>
      </div>
      <dl className="eng-info-list">
        <div><dt>診断対象名</dt><dd>{engagement.name}</dd></div>
        <div><dt>顧客</dt><dd>{v(engagement.client)}</dd></div>
        <div><dt>対象システム</dt><dd>{v(engagement.target_system)}</dd></div>
        <div><dt>期間</dt><dd>{engagement.period_from || engagement.period_to ? `${engagement.period_from || '未記入'} 〜 ${engagement.period_to || '未記入'}` : '未記入'}</dd></div>
      </dl>
      {open && (
        <EngagementDialog
          initial={engagement}
          onClose={() => setOpen(false)}
          onSubmit={async (input) => { await save(engagement.id, input); setOpen(false) }}
        />
      )}
    </section>
  )
}
