import { Link } from 'react-router-dom'
import { useStore } from '../state'

export { SeverityPill } from '../components/Severity'

/** 発見事項の状態の表示名（保存されている値は英語のまま） */
export function useStatusLabel() {
  const { meta } = useStore()
  return (key: string) => meta?.findingStatuses?.find((s) => s.key === key)?.label ?? key
}

/** 発見事項の状態を日本語のタグで出します。色は .tag.status-* でトークンから当てます。 */
export function StatusTag({ value }: { value: string }) {
  const label = useStatusLabel()
  const safe = /^[a-z]+$/.test(value) ? value : 'unknown'
  return <span className={`tag status-${safe}`}>{label(value)}</span>
}

export function NoEngagement() {
  return (
    <div className="empty">
      <p>診断対象がまだありません。</p>
      <p><Link to="/settings">設定</Link>から診断対象を作ると、各フェーズの Markdown が保存先に生成されます。</p>
    </div>
  )
}
