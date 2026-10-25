/** Mac（と iPad など）では ⌘、それ以外では Ctrl を修飾キーとして案内します。 */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+'

/**
 * コマンドの実行はデスクトップ版（Electron）だけで使えます。ブラウザ版ではサーバ側のルートも存在しません。
 * 画面の項目の出し分けに使います（判定の正はサーバ側です）。
 */
// Windows ではサーバ側が 501 を返す（macOS / Linux の版でだけ使える）ので、項目も出さない。
const IS_WINDOWS = typeof navigator !== 'undefined' && /^Win/i.test(navigator.platform)
export const execAvailable = () => !IS_WINDOWS && typeof window !== 'undefined' && typeof window.secowlDesktop?.execLaunch === 'function'
