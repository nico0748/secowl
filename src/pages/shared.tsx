import { Link } from 'react-router-dom'
import type { SeverityKey } from '../types'

const SEV_COLOR: Record<SeverityKey, string> = {
  critical: '#890101',
  high: '#ec0000',
  medium: '#cd820a',
  low: '#264af4',
  info: '#949497',
}
const SEV_JA: Record<SeverityKey, string> = {
  critical: '緊急', high: '重要', medium: '警告', low: '注意', info: 'なし',
}

export function SeverityPill({ value }: { value: SeverityKey }) {
  return (
    <span className="sev-pill" style={{ background: SEV_COLOR[value] }}>
      {value.toUpperCase()}・{SEV_JA[value]}
    </span>
  )
}

export function NoEngagement() {
  return (
    <div className="empty">
      <p>診断対象がまだありません。</p>
      <p><Link to="/settings">設定</Link>から診断対象を作ると、各フェーズの Markdown が保存先に生成されます。</p>
    </div>
  )
}
