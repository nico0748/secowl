import { useState } from 'react'
import { readThemePref, saveThemePref, type ThemePref } from '../theme'

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'OS に合わせる' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

/** 設定画面の「表示」。ライト / ダーク / OS に合わせる、の 3 択です。 */
export function ThemeSection() {
  const [pref, setPref] = useState<ThemePref>(() => readThemePref())
  const choose = (v: ThemePref) => {
    setPref(v)
    saveThemePref(v)
  }
  return (
    <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
      <div className="card-head"><span className="card-title" id="theme-title">表示</span></div>
      <p className="hint-text">画面の配色を選びます。この端末のこのアプリにだけ記憶します（レポートの出力は常にライトです）。</p>
      <div className="segmented" role="radiogroup" aria-labelledby="theme-title">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={pref === o.value}
            className={pref === o.value ? 'on' : ''}
            onClick={() => choose(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  )
}
