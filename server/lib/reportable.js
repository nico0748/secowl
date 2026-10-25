/**
 * 報告書・印刷・Word・共有バンドルに載せる発見事項を、一か所で決めます。
 * 下書き（draft）は既定で含めません。並びは深刻度の順、次に通し番号の順です。
 */
import { listFindings, readDoc, docPaths } from './store.js'
import { findLeaks } from '../../shared/redact.js'
import { compareFindings } from './severity.js'

export function reportableFindings(eid, { includeDraft = false } = {}) {
  const all = listFindings(eid)
  const findings = (includeDraft ? all : all.filter((f) => f.status !== 'draft')).sort(compareFindings)
  const excluded = includeDraft
    ? []
    : all.filter((f) => f.status === 'draft').sort(compareFindings).map((f) => ({ id: f.id, vuln_name: f.vuln_name }))
  return { findings, excluded }
}

/**
 * 共有・書き出しの前の点検。載せる各個票の本文と、報告書の手書きの章に findLeaks をかけ、
 * 伏せていない可能性がある Cookie・トークン・メールアドレスを持つものを返します。
 * includeDraft は共有バンドルで下書きを含めるときに true にします。
 */
export function checkReport(eid, { includeDraft = false } = {}) {
  const { findings, excluded } = reportableFindings(eid, { includeDraft })
  const leaks = []
  for (const f of findings) {
    const hits = findLeaks(readDoc(f.file).body)
    if (hits.length) leaks.push({ id: f.id, vuln_name: f.vuln_name, file: f.file, kinds: hits.map((h) => h.kind) })
  }
  // 印刷と Word は報告書の本文をそのまま出すため、手書きの章も点検します。
  // 自動生成の区間は個票から作るので、上の点検と重ならないよう外します。
  try {
    const rel = docPaths(eid).report
    const body = readDoc(rel).body.replace(/<!--\s*vs:([\w-]+)\s*-->[\s\S]*?<!--\s*\/vs:\1\s*-->/g, '')
    const hits = findLeaks(body)
    if (hits.length) leaks.push({ id: 'report', vuln_name: '診断報告書（手書きの章）', file: rel, kinds: hits.map((h) => h.kind) })
  } catch { /* 報告書がなければ点検しません */ }
  return { included: findings.length, checked: findings.length, includeDraft, excluded, leaks }
}
