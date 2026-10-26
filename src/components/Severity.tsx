import type { SeverityKey } from '../types'

/**
 * 深刻度の表示部品。色だけに頼らず、形（■▲◆●○）と頭文字でも区別できるようにします。
 * 形は 22×22 の viewBox。色は .sev-* クラスが --sev-bg（面）と --sev-on（文字）を組で当てます。
 */
export const SEV_JA: Record<SeverityKey, string> = {
  critical: '緊急', high: '重要', medium: '警告', low: '注意', info: 'なし',
}

const LETTER: Record<SeverityKey, string> = { critical: 'C', high: 'H', medium: 'M', low: 'L', info: 'I' }
// 三角形は重心が下にあるため、頭文字を少し下げます。
const LETTER_Y: Record<SeverityKey, number> = { critical: 11.5, high: 13.4, medium: 11.5, low: 11.5, info: 11.5 }
// 三角形とひし形は内側が狭いので、頭文字を小さくします。
const LETTER_SIZE: Record<SeverityKey, number> = { critical: 12, high: 10, medium: 10, low: 12, info: 11 }

function Shape({ value }: { value: SeverityKey }) {
  switch (value) {
    case 'critical': return <rect className="sev-shape" x="1.5" y="1.5" width="19" height="19" rx="2" />
    case 'high': return <path className="sev-shape" d="M11 1.5 21.2 20H.8z" />
    case 'medium': return <path className="sev-shape" d="M11 .8 21.2 11 11 21.2.8 11z" />
    case 'low': return <circle className="sev-shape" cx="11" cy="11" r="9.6" />
    default: return <circle className="sev-shape ring" cx="11" cy="11" r="8.6" strokeWidth="2.4" />
  }
}

/** 形だけの小さなアイコン（ピル・チップ用。頭文字は入れない） */
export function SevIcon({ value, size = 11 }: { value: SeverityKey; size?: number }) {
  return (
    <svg className={`sev-icon sev-${value}`} width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      <Shape value={value} />
    </svg>
  )
}

/** 形 ＋ 頭文字のバッジ（件数カードなど。22px） */
export function SeverityBadge({ value, size = 22 }: { value: SeverityKey; size?: number }) {
  return (
    <svg className={`sev-badge sev-${value}`} width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      <Shape value={value} />
      <text x="11" y={LETTER_Y[value]} fontSize={LETTER_SIZE[value]} textAnchor="middle" dominantBaseline="central">{LETTER[value]}</text>
    </svg>
  )
}

/** 塗りのピル。Info だけは枠のみ（面なし）。 */
export function SeverityPill({ value }: { value: SeverityKey }) {
  return (
    <span className={`sev-pill sev-${value}`}>
      <SevIcon value={value} />
      {value.toUpperCase()}・{SEV_JA[value]}
    </span>
  )
}
