/** Mac（と iPad など）では ⌘、それ以外では Ctrl を修飾キーとして案内します。 */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+'
