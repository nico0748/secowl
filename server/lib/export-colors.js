/**
 * 書き出し（共有バンドル HTML・印刷用 HTML・docx）の配色。
 * 書き出しは紙と他人の画面で読まれるため、アプリのテーマに関係なく常にライトです。
 * 値は src/styles/tokens.css の Light の値（--app-*）と同じです。tokens.css を作り直したら合わせてください。
 */
export const EXPORT_COLORS = {
  bg: '#E6E6E6', // --app-bg（Solid Gray 100）
  card: '#FFFFFF', // --app-card
  cardSub: '#F2F2F2', // --app-card-sub（Solid Gray 50）
  text: '#1A1A1A', // --app-text（Solid Gray 900）
  textSub: '#4D4D4D', // --app-text-sub（Solid Gray 700）
  textMuted: '#666666', // --app-text-muted（Solid Gray 600）
  border: '#CCCCCC', // --app-border（Solid Gray 200）
  borderStrong: '#7F7F7F', // --app-border-strong（Solid Gray 500）
  primary: '#0017C1', // --app-primary（Blue 900。キーカラー）
  onPrimary: '#FFFFFF', // --app-on-primary
  selectedBg: '#E8F1FE', // --app-selected-bg（Blue 50）
  selectedText: '#00118F', // --app-selected-text（Blue 1000）
  warning: '#AC3E00', // --app-status-warning（Orange 900）
}

/** 深刻度。signal（面）・on（面の上の文字）・text（色付きの文字）・border（枠） */
export const EXPORT_SEV = {
  critical: { signal: '#850000', on: '#FFFFFF', text: '#850000', border: '#850000' }, // Red 1100
  high: { signal: '#CE0000', on: '#FFFFFF', text: '#CE0000', border: '#CE0000' }, // Red 900
  medium: { signal: '#B78F00', on: '#1A1A1A', text: '#806300', border: '#927200' }, // Yellow 700 / 1000 / 900
  low: { signal: '#264AF4', on: '#FFFFFF', text: '#0031D8', border: '#0031D8' }, // Blue 700 / 800
  info: { signal: '#666666', on: '#FFFFFF', text: '#666666', border: '#666666' }, // Solid Gray 600
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
  const fill = key === 'info' ? `fill="none" stroke="${c.border}"` : 'fill="currentColor"'
  return `<svg width="${size}" height="${size}" viewBox="0 0 22 22" aria-hidden="true" style="flex:none"><g ${fill}>${SEV_SHAPE[key] || SEV_SHAPE.info}</g></svg>`
}

/** 形 ＋ 頭文字のバッジ（件数の箱）。 */
export function sevBadgeSvg(key, size = 22) {
  const c = EXPORT_SEV[key] || EXPORT_SEV.info
  const shape = key === 'info'
    ? `<g fill="none" stroke="${c.border}">${SEV_SHAPE.info}</g>`
    : `<g fill="${c.signal}" stroke="${c.border}" stroke-width="1.2" paint-order="stroke">${SEV_SHAPE[key]}</g>`
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

/** 絞り込みボタンに置く形（signal 色。枠色の輪郭を付けて、淡い段でも白い面から浮かせる）。 */
export function sevChipIcon(key, size = 12) {
  const c = EXPORT_SEV[key] || EXPORT_SEV.info
  const g = key === 'info'
    ? `<g fill="none" stroke="${c.border}">${SEV_SHAPE.info}</g>`
    : `<g fill="${c.signal}" stroke="${c.border}" stroke-width="1.2" paint-order="stroke">${SEV_SHAPE[key]}</g>`
  return `<svg width="${size}" height="${size}" viewBox="0 0 22 22" aria-hidden="true" style="flex:none;overflow:visible">${g}</svg>`
}
