/**
 * 書き出し（共有バンドル HTML・印刷用 HTML・docx）の配色。
 * 書き出しは紙と他人の画面で読まれるため、アプリのテーマに関係なく常にライトです。
 * 値は src/styles/tokens.css の Light の値（--app-* / --md-sys-color-*）と同じです。tokens.css を作り直したら合わせてください。
 */
export const EXPORT_COLORS = {
  bg: '#EFEDF1', // --app-bg
  card: '#FFFFFF', // --app-card
  cardSub: '#F5F3F7', // --app-card-sub
  text: '#1B1B1F', // --app-text
  textSub: '#45464F', // --app-text-sub
  textMuted: '#696A73', // --app-text-muted
  border: '#C5C6D0', // --app-border（outline-variant）
  borderStrong: '#757680', // --app-border-strong（outline）
  primary: '#3158BA', // --app-primary
  onPrimary: '#FFFFFF', // --app-on-primary
  selectedBg: '#DDE1F9', // --app-selected-bg
  selectedText: '#414659', // --app-selected-text
  warning: '#9D6E00', // --app-status-warning
}

/** 深刻度。signal（面）・on（面の上の文字）・text（色付きの文字）・border（枠） */
export const EXPORT_SEV = {
  critical: { signal: '#75003C', on: '#FFFFFF', text: '#C3216D', border: '#75003C' },
  high: { signal: '#B52700', on: '#FFFFFF', text: '#C3310B', border: '#B52700' },
  medium: { signal: '#D87900', on: '#2E1500', text: '#9D5600', border: '#D87900' },
  low: { signal: '#00627A', on: '#FFFFFF', text: '#00718E', border: '#00627A' },
  info: { signal: '#87868A', on: '#1B1B1F', text: '#68686B', border: '#757680' },
}

/** 色以外の手がかり（アプリの Severity.tsx と同じ形）。docx では記号の文字で代用します。 */
export const SEV_GLYPH = { critical: '■', high: '▲', medium: '◆', low: '●', info: '○' }
const SEV_LETTER = { critical: 'C', high: 'H', medium: 'M', low: 'L', info: 'I' }
const SEV_SHAPE = {
  critical: '<rect x="1.5" y="1.5" width="19" height="19" rx="2"/>',
  high: '<path d="M11 1.5 21.2 20H.8z"/>',
  medium: '<path d="M11 .8 21.2 11 11 21.2.8 11z"/>',
  low: '<circle cx="11" cy="11" r="9.6"/>',
  info: '<circle cx="11" cy="11" r="8.6" fill="none" stroke-width="2.4"/>',
}

/** ピルの中に置く形（文字色で塗る）。Info は輪を info の色で描く。 */
export function sevIconSvg(key, size = 11) {
  const c = EXPORT_SEV[key] || EXPORT_SEV.info
  const fill = key === 'info' ? `fill="none" stroke="${c.signal}"` : 'fill="currentColor"'
  return `<svg width="${size}" height="${size}" viewBox="0 0 22 22" aria-hidden="true" style="flex:none"><g ${fill}>${SEV_SHAPE[key] || SEV_SHAPE.info}</g></svg>`
}

/** 形 ＋ 頭文字のバッジ（件数の箱）。 */
export function sevBadgeSvg(key, size = 22) {
  const c = EXPORT_SEV[key] || EXPORT_SEV.info
  const shape = key === 'info' ? `<g fill="none" stroke="${c.signal}">${SEV_SHAPE.info}</g>` : `<g fill="${c.signal}">${SEV_SHAPE[key]}</g>`
  const y = key === 'high' ? 13.4 : 11.5
  const fs = { critical: 12, high: 10, medium: 10, low: 12, info: 11 }[key] || 11
  const letterColor = key === 'info' ? EXPORT_COLORS.text : c.on
  return `<svg width="${size}" height="${size}" viewBox="0 0 22 22" aria-hidden="true">${shape}<text x="11" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="700" fill="${letterColor}">${SEV_LETTER[key] || 'I'}</text></svg>`
}

/** 塗りのピル（Info だけ枠のみ）。 */
export function sevPillHtml(key, label) {
  const cls = key === 'info' ? 'pill info' : 'pill'
  const c = EXPORT_SEV[key] || EXPORT_SEV.info
  const style = key === 'info' ? '' : ` style="background:${c.signal};border-color:${c.signal};color:${c.on}"`
  return `<span class="${cls}"${style}>${sevIconSvg(key)}${label}</span>`
}

/** 絞り込みボタンに置く形（signal 色。白い面の上で輪郭を付けてコントラストを保つ）。 */
export function sevChipIcon(key, size = 12) {
  const c = EXPORT_SEV[key] || EXPORT_SEV.info
  const g = key === 'info'
    ? `<g fill="none" stroke="${c.border}">${SEV_SHAPE.info}</g>`
    : `<g fill="${c.signal}" stroke="${EXPORT_COLORS.textSub}" stroke-width="1.6" paint-order="stroke">${SEV_SHAPE[key]}</g>`
  return `<svg width="${size}" height="${size}" viewBox="0 0 22 22" aria-hidden="true" style="flex:none;overflow:visible">${g}</svg>`
}
