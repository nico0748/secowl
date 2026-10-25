import { useMemo, useState } from 'react'

export interface DonutSlice {
  key: string
  label: string
  value: number
  color: string
}

interface Props {
  slices: DonutSlice[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string | number
  onSelect?: (key: string) => void
  emptyText?: string
}

/**
 * ドーナツ図。隣り合う扇形の間に 2px の余白を入れて境界を見せます。
 * 色だけで識別させないため、凡例と数値を必ず並べて表示してください。
 */
export function Donut({ slices, size = 160, thickness = 26, centerLabel, centerValue, onSelect, emptyText = 'データなし' }: Props) {
  const [hover, setHover] = useState<string | null>(null)
  const total = slices.reduce((a, s) => a + s.value, 0)
  const r = (size - thickness) / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r

  const arcs = useMemo(() => {
    if (total <= 0) return []
    let offset = 0
    return slices
      .filter((s) => s.value > 0)
      .map((s) => {
        const frac = s.value / total
        const len = circumference * frac
        const gap = Math.min(2, len / 3)
        const arc = { ...s, dash: Math.max(len - gap, 0.5), offset, frac }
        offset += len
        return arc
      })
  }, [slices, total, circumference])

  if (total <= 0) {
    return (
      <div style={{ width: size, height: size, display: 'grid', placeItems: 'center', color: 'var(--app-text-muted)', fontSize: 14 }}>
        {emptyText}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel ? `${centerLabel}の内訳` : '内訳'}>
        <g transform={`rotate(-90 ${c} ${c})`}>
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              strokeWidth={hover === a.key ? thickness + 4 : thickness}
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={-a.offset}
              style={{ stroke: a.color, cursor: onSelect ? 'pointer' : 'default', transition: 'stroke-width 120ms' }}
              onMouseEnter={() => setHover(a.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(a.key)}
            />
          ))}
        </g>
      </svg>
      <div
        style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          textAlign: 'center', pointerEvents: 'none', lineHeight: 1.3,
        }}
      >
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {hover ? slices.find((s) => s.key === hover)?.value : (centerValue ?? total)}
          </div>
          <div style={{ fontSize: 14, color: 'var(--app-text-muted)', maxWidth: size - thickness * 2, margin: '0 auto' }}>
            {hover ? slices.find((s) => s.key === hover)?.label : centerLabel}
          </div>
        </div>
      </div>
    </div>
  )
}
