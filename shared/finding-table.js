/**
 * 発見事項個票の「基本情報」表と CVSS の行を、frontmatter の値にそろえます。
 * 画面で編集するのは frontmatter の欄なので、表は欄から作り直します。
 * 欄が空のときは、テンプレートの穴埋め（「CWE / CVE」「A__」など）だけを空にし、手で書いた値は残します。
 */

const ROWS = [
  ['通し番号', 'finding_no'],
  ['脆弱性名称', 'vuln_name'],
  ['識別子', 'identifier', ['CWE / CVE']],
  ['OWASP Top 10:2025', 'owasp', ['A__']],
  ['WSTG 項目', 'wstg_id', ['WSTG-____-__', 'WSTG-__-']],
  ['深刻度', 'severity_label'],
  ['対象', 'target'],
  ['発見・悪用に必要な立場', 'required_role', ['未認証の外部利用者 / 一般利用者 / 管理者']],
  ['再現性', 'reproducibility', ['再現可 / 条件付き / 一度のみ']],
]

const PLACEHOLDER_RE = /\{\{[^}]*\}\}/

function cell(v) {
  if (v === undefined || v === null) return ''
  if (Array.isArray(v)) return v.map(cell).join(', ')
  return String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/** `| a | b | c |` を区切ります。`\|` は区切りとして扱いません。 */
function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map((s) => s.trim())
}

/**
 * @param {string} body 本文（frontmatter を除く）
 * @param {Record<string, unknown>} data frontmatter
 * @returns {string}
 */
export function syncFindingBody(body, data) {
  if (!body || !data) return body
  const lines = body.split('\n')
  let section = ''
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) continue
    const h = /^#{2,4}\s+(.*)$/.exec(line)
    if (h) { section = h[1].trim(); continue }
    if (!/^\s*\|/.test(line)) continue
    const cols = splitRow(line)
    if (section === '基本情報' && cols.length >= 2) {
      const row = ROWS.find(([label]) => label === cols[0])
      if (!row) continue
      const [label, key, placeholders = []] = row
      const value = cell(data[key])
      const now = cols[1]
      let next = now
      if (value) next = value
      else if (placeholders.includes(now) || PLACEHOLDER_RE.test(now)) next = ''
      if (next !== now) lines[i] = `| ${label} | ${next} |`
    } else if (section.startsWith('リスク評価') && cols.length >= 2 && cols[0] === '基本評価基準 (Base)') {
      const vector = cell(data.cvss_vector)
      const score = cell(data.cvss_score)
      const next = vector ? `\`${vector}\` → ${score}` : score
      if (next !== cols[1]) lines[i] = `| ${[cols[0], next, ...cols.slice(2)].join(' | ')} |`
    }
  }
  return lines.join('\n')
}

/** 個票かどうか（frontmatter の type で判断します）。 */
export function isFindingDoc(data) {
  return !!data && data.type === 'vs-finding'
}

/** 書面の承認が、印・承認日・承認者の 3 つともそろっているか。 */
export function approvalComplete(data) {
  if (!data || data.agreed !== true) return false
  const s = (v) => (v === undefined || v === null ? '' : String(v).trim())
  return s(data.agreed_at) !== '' && s(data.agreed_by) !== ''
}

/**
 * スコープ文書の「承認」表のクライアントの行を、frontmatter の承認欄にそろえます。
 * 承認者が空のときは、手で書いた行をそのまま残します。
 */
export function syncScopeBody(body, data) {
  if (!body || !data) return body
  const lines = body.split('\n')
  let section = ''
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{2,4}\s+(.*)$/.exec(lines[i])
    if (h) { section = h[1].trim(); continue }
    if (!/承認$/.test(section) || !/^\s*\|/.test(lines[i])) continue
    const cols = splitRow(lines[i])
    if (cols[0] !== 'クライアント' || cols.length < 4) continue
    const by = cell(data.agreed_by)
    const at = cell(typeof data.agreed_at === 'object' && data.agreed_at ? new Date(data.agreed_at).toISOString().slice(0, 10) : data.agreed_at)
    const mark = data.agreed === true ? '☑' : '☐'
    const next = [cols[0], by || cols[1], at || cols[2], mark, ...cols.slice(4)]
    lines[i] = `| ${next.join(' | ')} |`
  }
  return lines.join('\n')
}
