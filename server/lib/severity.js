export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']

// 色はここに持たない。画面は tokens.css の --app-sev-*、書き出しは export-colors.js が決める。
export const SEVERITY_META = {
  critical: { key: 'critical', label: 'CRITICAL', ja: '緊急', range: '9.0 – 10.0' },
  high: { key: 'high', label: 'HIGH', ja: '重要', range: '7.0 – 8.9' },
  medium: { key: 'medium', label: 'MEDIUM', ja: '警告', range: '4.0 – 6.9' },
  low: { key: 'low', label: 'LOW', ja: '注意', range: '0.1 – 3.9' },
  info: { key: 'info', label: 'INFO', ja: 'なし', range: '0' },
}

/** CVSS 基本値から深刻度を決める。FIRST の区分に合わせる。 */
export function severityFromScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n >= 9.0) return 'critical'
  if (n >= 7.0) return 'high'
  if (n >= 4.0) return 'medium'
  if (n > 0) return 'low'
  return 'info'
}

export function normalizeSeverity(value) {
  if (!value) return 'info'
  const v = String(value).trim().toLowerCase()
  if (SEVERITIES.includes(v)) return v
  const jaMap = { 緊急: 'critical', 重要: 'high', 警告: 'medium', 注意: 'low', なし: 'info' }
  return jaMap[String(value).trim()] || 'info'
}

export function severityLabelJa(key) {
  return (SEVERITY_META[normalizeSeverity(key)] || SEVERITY_META.info).ja
}

/** 深刻度の値として読めるか。読めなければ null（未知の値を info に化けさせないため）。 */
export function parseSeverity(value) {
  if (value === undefined || value === null) return null
  const v = String(value).trim()
  if (SEVERITIES.includes(v.toLowerCase())) return v.toLowerCase()
  const jaMap = { 緊急: 'critical', 重要: 'high', 警告: 'medium', 注意: 'low', なし: 'info' }
  return jaMap[v] || null
}

/** CVSS 基本値として受け付けるか。空文字・null、または 0〜10 の数値（数値の文字列を含む）。 */
export function isValidScore(value) {
  if (value === '' || value === null) return true
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 10
  if (typeof value === 'string') {
    if (!/^\s*\d+(\.\d+)?\s*$/.test(value)) return false
    const n = Number(value)
    return n >= 0 && n <= 10
  }
  return false
}

/**
 * 実際の深刻度の決め方。severity_source があればそれに従います。
 * ない旧形式の個票では、深刻度が基本値から導いた値と食い違えば、手で決めたもの（manual）とみなします。
 */
export function effectiveSeveritySource(data = {}) {
  if (data.severity_source === 'manual') return 'manual'
  if (data.severity_source === 'cvss') return 'cvss'
  const derived = derivedSeverity(data.cvss_score)
  if (data.severity && derived && normalizeSeverity(data.severity) !== derived) return 'manual'
  return 'cvss'
}

/** 基本値から導いた深刻度。基本値が空・未記入・数値でなければ null。 */
export function derivedSeverity(score) {
  if (score === '' || score === null || score === undefined) return null
  if (typeof score === 'string' && score.trim() === '') return null
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  return severityFromScore(n)
}

/**
 * 保存後の深刻度と、その決め方（severity_source）を決めます。
 *
 * @param current 保存前の frontmatter にある { severity, severity_source }
 * @param sent    送られた severity。キーがなければ undefined、空文字は「基本値から決める」
 * @param score   保存後に有効になる cvss_score
 *
 * manual になるのは「数値の基本値があり、送られた深刻度が基本値から導いた値と異なる」ときだけです。
 * 読み込んだ値をそのまま送り返しても manual にはなりません。
 */
export function resolveSeverity({ current = {}, sent, score }) {
  const derived = derivedSeverity(score)
  const curSev = current.severity ? normalizeSeverity(current.severity) : null
  const curSource = effectiveSeveritySource(current)

  if (sent === undefined || sent === null) {
    if (curSource === 'manual' && curSev) return { severity: curSev, severity_source: 'manual' }
    if (derived) return { severity: derived, severity_source: curSource }
    return { severity: curSev || 'info', severity_source: curSource }
  }
  if (String(sent).trim() === '') {
    return { severity: derived || curSev || 'info', severity_source: 'cvss' }
  }
  const v = normalizeSeverity(sent)
  if (derived && derived !== v) return { severity: v, severity_source: 'manual' }
  return { severity: v, severity_source: 'cvss' }
}

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

/** 深刻度の順、次に通し番号（finding_no）の順。番号が数値でないものは最後に回します。 */
export function compareFindings(a, b) {
  const s = (SEV_ORDER[normalizeSeverity(a.severity)] ?? 9) - (SEV_ORDER[normalizeSeverity(b.severity)] ?? 9)
  if (s) return s
  const na = Number(a.finding_no)
  const nb = Number(b.finding_no)
  const fa = a.finding_no !== '' && a.finding_no !== null && a.finding_no !== undefined && Number.isFinite(na)
  const fb = b.finding_no !== '' && b.finding_no !== null && b.finding_no !== undefined && Number.isFinite(nb)
  if (fa && fb) return na - nb
  if (fa !== fb) return fa ? -1 : 1
  return String(a.finding_no ?? '').localeCompare(String(b.finding_no ?? ''))
}

/** 発見事項の状態。保存する値は英語のまま、表示だけを日本語にします。 */
export const FINDING_STATUS = [
  { key: 'draft', label: '下書き', hint: '起票した直後。裏取りが済んでいない' },
  { key: 'confirmed', label: '確定', hint: '手動で裏取りした' },
  { key: 'reported', label: '報告済', hint: '報告書に収めた' },
  { key: 'fixed', label: '修正済', hint: '修正を確認した' },
  { key: 'reopened', label: '再発', hint: '修正後に再び確認した' },
]

export function findingStatusLabel(key) {
  return FINDING_STATUS.find((s) => s.key === key)?.label || String(key ?? '')
}
