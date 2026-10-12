/**
 * 診断対象ごとの進み具合を、フェーズ単位で判定します。
 *
 * 判定はデータから機械的に導きます。手で状態を切り替える欄は作りません。
 * 「次の一手」は、完了条件のうち最初に満たしていないものを指します。
 */
import { listSurfaces, listFindings, listToolLogs, readDoc, docPaths } from './store.js'
import { playbookIndex } from './playbook.js'

function safeDoc(rel) {
  try { return readDoc(rel) } catch { return null }
}

function checklistRate(doc) {
  const items = doc?.checklist || []
  if (!items.length) return { total: 0, checked: 0 }
  return { total: items.length, checked: items.filter((i) => i.checked).length }
}

/** 診断対象の進み具合を返します。 */
export function progress(eid) {
  const paths = docPaths(eid)
  const scope = safeDoc(paths.scope)
  const checklist = safeDoc(paths.checklist)
  const surfaces = listSurfaces(eid)
  const findings = listFindings(eid)
  const logs = listToolLogs(eid)

  const inScope = surfaces.filter((s) => s.in_scope)
  const investigated = inScope.filter((s) => s.status === '調査済')
  const cl = checklistRate(checklist)
  const triaged = findings.filter((f) => f.status && f.status !== 'draft')
  const scored = findings.filter((f) => f.cvss_vector && f.cvss_score !== '' && f.cvss_score !== null)
  const agreed = scope?.data?.agreed === true

  const state = (done, started) => (done ? 'done' : started ? 'doing' : 'todo')

  const phases = {
    preparation: {
      state: state(agreed, !!scope),
      metrics: [{ label: '承認', value: agreed ? '取得済み' : '未取得' }],
      next: agreed ? '' : 'スコープと RoE に承認を記録してください',
    },
    recon: {
      state: state(inScope.length > 0 && investigated.length === inScope.length, inScope.length > 0 || logs.length > 0),
      metrics: [
        { label: 'サーフェス', value: `${inScope.length} 件` },
        { label: '調査済', value: `${investigated.length} / ${inScope.length}` },
      ],
      next: inScope.length === 0
        ? 'サーフェスを登録して攻撃面の一覧を作ってください'
        : investigated.length < inScope.length
          ? `未調査のサーフェスが ${inScope.length - investigated.length} 件あります`
          : '',
    },
    survey: {
      state: state(cl.total > 0 && cl.checked === cl.total, cl.checked > 0 || logs.length > 0),
      metrics: [
        { label: 'チェックリスト', value: cl.total ? `${cl.checked} / ${cl.total}` : '未作成' },
        { label: 'ツール実行ログ', value: `${logs.length} 件` },
      ],
      next: cl.total === 0
        ? 'チェックリストを作ってください'
        : cl.checked < cl.total
          ? `未検証の項目が ${cl.total - cl.checked} 件あります`
          : '',
    },
    triage: {
      state: state(findings.length > 0 && triaged.length === findings.length && scored.length === findings.length, findings.length > 0),
      metrics: [
        { label: '発見事項', value: `${findings.length} 件` },
        { label: 'draft 以外', value: `${triaged.length} / ${findings.length}` },
        { label: 'CVSS 記入済', value: `${scored.length} / ${findings.length}` },
      ],
      next: findings.length === 0
        ? '検出したものを発見事項として起票してください'
        : scored.length < findings.length
          ? `CVSS が未記入の発見事項が ${findings.length - scored.length} 件あります`
          : triaged.length < findings.length
            ? `draft のままの発見事項が ${findings.length - triaged.length} 件あります`
            : '',
    },
    report: {
      state: 'todo',
      metrics: [],
      next: '',
    },
  }

  const report = safeDoc(paths.report)
  // 自動生成ブロックに中身が入っているかで判定します。
  const block = /<!--\s*vs:finding-table\s*-->([\s\S]*?)<!--\s*\/vs:finding-table\s*-->/.exec(report?.raw || '')
  const built = !!block && block[1].trim().length > 0
  phases.report = {
    state: state(built && findings.length > 0 && triaged.length === findings.length, !!report),
    metrics: [{ label: '自動生成ブロック', value: built ? '反映済み' : '未反映' }],
    next: !built
      ? '「発見事項を反映」を押して、件数と一覧を最新にしてください'
      : triaged.length < findings.length
        ? `draft のままの発見事項が ${findings.length - triaged.length} 件あります。確定してから反映し直してください`
        : '',
  }

  const steps = playbookIndex().map((p) => ({
    phase: p.phase,
    label: p.label,
    title: p.title,
    goal: p.goal,
    done: p.done,
    ...(phases[p.phase] || { state: 'todo', metrics: [], next: '' }),
  }))

  const current = steps.find((s) => s.state !== 'done') || steps[steps.length - 1] || null

  return { phases: steps, current: current?.phase || '', nextAction: current?.next || '' }
}
