import { useMemo, useState } from 'react'
import {
  V31_METRICS, V31_TEMPORAL, V31_ENVIRONMENTAL, V40_BASE,
  parseVector, buildVector31, buildVector40, score31, severityFromScore,
} from '../../shared/cvss.js'
import type { MetricDef } from '../../shared/cvss.js'

const SEV_COLOR: Record<string, string> = {
  critical: '#890101', high: '#ec0000', medium: '#cd820a', low: '#264af4', info: '#949497',
}
const SEV_JA: Record<string, string> = {
  critical: '緊急', high: '重要', medium: '警告', low: '注意', info: 'なし',
}

interface Props {
  initialVector?: string
  onApply: (result: { vector: string; score: number | '' }) => void
  onClose: () => void
}

export function CvssCalculator({ initialVector = '', onApply, onClose }: Props) {
  const [tab, setTab] = useState<'v31' | 'v40'>(initialVector.startsWith('CVSS:4.0') ? 'v40' : 'v31')
  const [m, setM] = useState<Record<string, string>>(() => parseVector(initialVector))
  const set = (id: string, v: string) => setM((prev) => ({ ...prev, [id]: prev[id] === v ? '' : v }))

  const result = useMemo(() => score31(m), [m])
  const vector31 = useMemo(() => (V31_METRICS.every((x: MetricDef) => m[x.id]) ? buildVector31(m) : ''), [m])
  const vector40 = useMemo(() => buildVector40(m), [m])

  const shown = result ? (result.environmental ?? result.base) : null
  const sev = shown === null ? null : severityFromScore(shown)

  const group = (title: string, defs: MetricDef[], note?: string) => (
    <section style={{ marginBottom: 'var(--sp-4)' }}>
      <h3 style={{ fontSize: 15, marginBottom: 'var(--sp-2)' }}>{title}</h3>
      {note && <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 var(--sp-2)' }}>{note}</p>}
      <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        {defs.map((d) => (
          <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '240px minmax(0,1fr)', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: 'var(--text-sub)' }}>{d.label}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {d.options.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${m[d.id] === v ? ' on' : ''}`}
                  style={{ minHeight: 32, padding: '2px 12px' }}
                  onClick={() => set(d.id, v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )

  return (
    <div>
      <div className="filters">
        <button className={`chip${tab === 'v31' ? ' on' : ''}`} onClick={() => setTab('v31')}>CVSS v3.1</button>
        <button className={`chip${tab === 'v40' ? ' on' : ''}`} onClick={() => setTab('v40')}>CVSS v4.0</button>
      </div>

      {tab === 'v31' ? (
        <>
          <div className="card" style={{ marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>基本値</div>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>{result ? result.base.toFixed(1) : '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>現状値</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{result ? result.temporal.toFixed(1) : '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>環境値</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{result ? result.environmental.toFixed(1) : '—'}</div>
            </div>
            {sev && (
              <span className="sev-pill" style={{ background: SEV_COLOR[sev] }}>
                {sev.toUpperCase()}・{SEV_JA[sev]}
              </span>
            )}
            <code style={{ fontSize: 13, color: 'var(--text-sub)', marginLeft: 'auto', wordBreak: 'break-all', maxWidth: 420 }}>
              {vector31 || '基本評価の 8 項目をすべて選ぶとベクタが決まります'}
            </code>
          </div>

          {group('基本評価基準 (Base)', V31_METRICS)}
          {group('現状評価基準 (Temporal)', V31_TEMPORAL, '未選択の項目は「未評価」として計算します。')}
          {group('環境評価基準 (Environmental)', V31_ENVIRONMENTAL, '診断対象の環境に合わせて基本評価を補正します。未選択なら基本評価の値を使います。')}

          <div className="dialog-actions">
            <button className="btn quiet" onClick={onClose}>閉じる</button>
            <button
              className="btn"
              disabled={!vector31 || !result}
              onClick={() => onApply({ vector: vector31, score: result ? result.base : '' })}
            >
              基本値を個票へ反映
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="banner warn">
            v4.0 のスコア計算は MacroVector の参照表を使います。本アプリは参照表を持たないため、ベクタ文字列の組み立てだけを行います。
            スコアは <a href="https://www.first.org/cvss/calculator/4.0" target="_blank" rel="noreferrer">FIRST の計算機</a>で算出し、個票へ手入力してください。
          </div>
          {group('基本評価基準 (Base)', V40_BASE)}
          <div className="card" style={{ marginBottom: 'var(--sp-3)' }}>
            <code style={{ fontSize: 13, wordBreak: 'break-all' }}>{vector40 || '全項目を選ぶとベクタが決まります'}</code>
          </div>
          <div className="dialog-actions">
            <button className="btn quiet" onClick={onClose}>閉じる</button>
            <button className="btn" disabled={!vector40} onClick={() => onApply({ vector: vector40, score: '' })}>
              ベクタを個票へ反映
            </button>
          </div>
        </>
      )}
    </div>
  )
}
