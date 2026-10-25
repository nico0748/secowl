/**
 * 表示テーマ（ライト / ダーク / OS に合わせる）。
 * 既定は OS に合わせます。手動で選んだときだけ <html data-theme> を付け、localStorage に記憶します。
 * 最初の描画前の適用は index.html の小さなスクリプトが行います（ちらつき防止）。ここと同じ規則です。
 */
export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'secowl.theme'

declare global {
  interface Window {
    /** Electron 版の preload が公開する窓口。ブラウザ版では undefined。 */
    secowlDesktop?: { theme?: ThemePref; setTheme?: (pref: ThemePref) => void }
  }
}

const isPref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark'

// デスクトップ版はメインプロセスが記憶した値を正とします（サーバのポートが起動ごとに変わり、localStorage が引き継がれないため）。
let desktopPref: ThemePref | null = isPref(window.secowlDesktop?.theme) ? window.secowlDesktop!.theme! : null

export function readThemePref(): ThemePref {
  if (desktopPref) return desktopPref
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** <meta name="theme-color"> は media 付きの 2 本。手動で選んだときは両方を選んだ側の地の色にそろえます。 */
function syncThemeColorMeta(pref: ThemePref) {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach((m) => {
    const own = m.dataset.scheme === 'dark' ? 'dark' : 'light'
    const pick = pref === 'system' ? own : pref
    const value = document.querySelector<HTMLMetaElement>(`meta[name="theme-color"][data-scheme="${pick}"]`)?.dataset.color
    if (value) m.content = value
  })
}

export function applyThemePref(pref: ThemePref) {
  const root = document.documentElement
  if (pref === 'system') delete root.dataset.theme
  else root.dataset.theme = pref
  syncThemeColorMeta(pref)
  try { window.secowlDesktop?.setTheme?.(pref) } catch { /* デスクトップ版でなければ何もしません */ }
}

export function saveThemePref(pref: ThemePref) {
  if (desktopPref) desktopPref = pref
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch { /* 保存できない環境では、このページを開いている間だけ有効です */ }
  applyThemePref(pref)
}
