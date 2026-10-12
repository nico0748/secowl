export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']

export const SEVERITY_META = {
  critical: { key: 'critical', label: 'CRITICAL', ja: '緊急', range: '9.0 – 10.0', color: '#890101' },
  high: { key: 'high', label: 'HIGH', ja: '重要', range: '7.0 – 8.9', color: '#ec0000' },
  medium: { key: 'medium', label: 'MEDIUM', ja: '警告', range: '4.0 – 6.9', color: '#cd820a' },
  low: { key: 'low', label: 'LOW', ja: '注意', range: '0.1 – 3.9', color: '#264af4' },
  info: { key: 'info', label: 'INFO', ja: 'なし', range: '0', color: '#949497' },
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
