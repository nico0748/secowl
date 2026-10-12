/**
 * CVSS v3.1 の計算と、v4.0 のベクタ組み立て。
 * v3.1 の式は FIRST の仕様書 (CVSS v3.1 Specification Document, Section 7) に従います。
 * v4.0 はスコア計算に MacroVector の参照表が必要なため、本モジュールはベクタ文字列の組み立てだけを担当します。
 */

export const V31_METRICS = [
  { id: 'AV', label: '攻撃元区分 (Attack Vector)', options: [['N', 'ネットワーク'], ['A', '隣接'], ['L', 'ローカル'], ['P', '物理']] },
  { id: 'AC', label: '攻撃条件の複雑さ (Attack Complexity)', options: [['L', '低'], ['H', '高']] },
  { id: 'PR', label: '必要な特権レベル (Privileges Required)', options: [['N', '不要'], ['L', '低'], ['H', '高']] },
  { id: 'UI', label: '利用者の関与 (User Interaction)', options: [['N', '不要'], ['R', '要']] },
  { id: 'S', label: 'スコープ (Scope)', options: [['U', '変更なし'], ['C', '変更あり']] },
  { id: 'C', label: '機密性への影響 (Confidentiality)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'I', label: '完全性への影響 (Integrity)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'A', label: '可用性への影響 (Availability)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
]

export const V31_TEMPORAL = [
  { id: 'E', label: '攻撃される可能性 (Exploit Code Maturity)', options: [['X', '未評価'], ['H', '容易'], ['F', '攻撃コードあり'], ['P', '実証可能'], ['U', '未実証']] },
  { id: 'RL', label: '利用可能な対策レベル (Remediation Level)', options: [['X', '未評価'], ['U', '対策なし'], ['W', '非公式'], ['T', '暫定'], ['O', '正式']] },
  { id: 'RC', label: '脆弱性情報の信頼性 (Report Confidence)', options: [['X', '未評価'], ['C', '確認済'], ['R', '未確認'], ['U', '未証明']] },
]

export const V31_ENVIRONMENTAL = [
  { id: 'CR', label: '機密性の要求度', options: [['X', '未評価'], ['H', '高'], ['M', '中'], ['L', '低']] },
  { id: 'IR', label: '完全性の要求度', options: [['X', '未評価'], ['H', '高'], ['M', '中'], ['L', '低']] },
  { id: 'AR', label: '可用性の要求度', options: [['X', '未評価'], ['H', '高'], ['M', '中'], ['L', '低']] },
  { id: 'MAV', label: '環境での攻撃元区分', options: [['X', '未評価'], ['N', 'ネットワーク'], ['A', '隣接'], ['L', 'ローカル'], ['P', '物理']] },
  { id: 'MAC', label: '環境での攻撃条件の複雑さ', options: [['X', '未評価'], ['L', '低'], ['H', '高']] },
  { id: 'MPR', label: '環境での必要な特権レベル', options: [['X', '未評価'], ['N', '不要'], ['L', '低'], ['H', '高']] },
  { id: 'MUI', label: '環境での利用者の関与', options: [['X', '未評価'], ['N', '不要'], ['R', '要']] },
  { id: 'MS', label: '環境でのスコープ', options: [['X', '未評価'], ['U', '変更なし'], ['C', '変更あり']] },
  { id: 'MC', label: '環境での機密性への影響', options: [['X', '未評価'], ['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'MI', label: '環境での完全性への影響', options: [['X', '未評価'], ['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'MA', label: '環境での可用性への影響', options: [['X', '未評価'], ['H', '高'], ['L', '低'], ['N', 'なし']] },
]

const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR_U: { N: 0.85, L: 0.62, H: 0.27 },
  PR_C: { N: 0.85, L: 0.68, H: 0.5 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
  E: { X: 1, H: 1, F: 0.97, P: 0.94, U: 0.91 },
  RL: { X: 1, U: 1, W: 0.97, T: 0.96, O: 0.95 },
  RC: { X: 1, C: 1, R: 0.96, U: 0.92 },
  REQ: { X: 1, H: 1.5, M: 1, L: 0.5 },
}

/** 仕様書 7.1 の Roundup。小数第1位へ切り上げます。 */
function roundup(x) {
  const i = Math.round(x * 100000)
  if (i % 10000 === 0) return i / 100000
  return (Math.floor(i / 10000) + 1) / 10
}

export function parseVector(vector) {
  const out = {}
  for (const part of String(vector || '').split('/')) {
    const [k, v] = part.split(':')
    if (k && v) out[k.trim()] = v.trim()
  }
  return out
}

export function buildVector31(m) {
  const base = V31_METRICS.map((x) => `${x.id}:${m[x.id] || ''}`).join('/')
  const extra = [...V31_TEMPORAL, ...V31_ENVIRONMENTAL]
    .filter((x) => m[x.id] && m[x.id] !== 'X')
    .map((x) => `${x.id}:${m[x.id]}`)
  return ['CVSS:3.1', base, ...extra].join('/')
}

/**
 * v3.1 のスコアを返します。基本評価の 8 項目がすべて埋まっていないと null を返します。
 * 返り値: { base, temporal, environmental }
 */
export function score31(m) {
  if (V31_METRICS.some((x) => !m[x.id])) return null

  const scopeChanged = m.S === 'C'
  const iss = 1 - (1 - W.CIA[m.C]) * (1 - W.CIA[m.I]) * (1 - W.CIA[m.A])
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss
  const exploitability = 8.22 * W.AV[m.AV] * W.AC[m.AC] * (scopeChanged ? W.PR_C : W.PR_U)[m.PR] * W.UI[m.UI]
  const base = impact <= 0 ? 0 : roundup(Math.min((scopeChanged ? 1.08 : 1) * (impact + exploitability), 10))

  const tmul = W.E[m.E || 'X'] * W.RL[m.RL || 'X'] * W.RC[m.RC || 'X']
  const temporal = roundup(base * tmul)

  const pick = (mod, orig) => (!m[mod] || m[mod] === 'X' ? m[orig] : m[mod])
  const mScopeChanged = pick('MS', 'S') === 'C'
  const cr = W.REQ[m.CR || 'X'], ir = W.REQ[m.IR || 'X'], ar = W.REQ[m.AR || 'X']
  const miss = Math.min(
    1 - (1 - W.CIA[pick('MC', 'C')] * cr) * (1 - W.CIA[pick('MI', 'I')] * ir) * (1 - W.CIA[pick('MA', 'A')] * ar),
    0.915,
  )
  const mImpact = mScopeChanged
    ? 7.52 * (miss - 0.029) - 3.25 * Math.pow(miss * 0.9731 - 0.02, 13)
    : 6.42 * miss
  const mExploit = 8.22 * W.AV[pick('MAV', 'AV')] * W.AC[pick('MAC', 'AC')] *
    (mScopeChanged ? W.PR_C : W.PR_U)[pick('MPR', 'PR')] * W.UI[pick('MUI', 'UI')]
  const environmental = mImpact <= 0
    ? 0
    : roundup(roundup(Math.min((mScopeChanged ? 1.08 : 1) * (mImpact + mExploit), 10)) * tmul)

  return { base, temporal, environmental }
}

/* ---------------- CVSS v4.0 のベクタ組み立て ---------------- */

export const V40_BASE = [
  { id: 'AV', label: '攻撃元区分 (Attack Vector)', options: [['N', 'ネットワーク'], ['A', '隣接'], ['L', 'ローカル'], ['P', '物理']] },
  { id: 'AC', label: '攻撃条件の複雑さ (Attack Complexity)', options: [['L', '低'], ['H', '高']] },
  { id: 'AT', label: '攻撃の前提条件 (Attack Requirements)', options: [['N', 'なし'], ['P', 'あり']] },
  { id: 'PR', label: '必要な特権レベル (Privileges Required)', options: [['N', '不要'], ['L', '低'], ['H', '高']] },
  { id: 'UI', label: '利用者の関与 (User Interaction)', options: [['N', '不要'], ['P', '受動'], ['A', '能動']] },
  { id: 'VC', label: '脆弱なシステムの機密性 (Vulnerable System C)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'VI', label: '脆弱なシステムの完全性 (Vulnerable System I)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'VA', label: '脆弱なシステムの可用性 (Vulnerable System A)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'SC', label: '後続システムの機密性 (Subsequent System C)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'SI', label: '後続システムの完全性 (Subsequent System I)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
  { id: 'SA', label: '後続システムの可用性 (Subsequent System A)', options: [['H', '高'], ['L', '低'], ['N', 'なし']] },
]

export function buildVector40(m) {
  if (V40_BASE.some((x) => !m[x.id])) return ''
  return ['CVSS:4.0', ...V40_BASE.map((x) => `${x.id}:${m[x.id]}`)].join('/')
}

export function severityFromScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n >= 9.0) return 'critical'
  if (n >= 7.0) return 'high'
  if (n >= 4.0) return 'medium'
  if (n > 0) return 'low'
  return 'info'
}
