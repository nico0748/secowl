import { api } from '../api'
import { useAsync, useStore } from '../state'
import { DocEditor } from '../components/DocEditor'
import { ScopeEditor } from '../components/ScopeEditor'
import { PhaseGuide } from '../components/PhaseGuide'
import { EngagementInfoCard, useSaveEngagement } from '../components/EngagementInfo'
import { NoEngagement } from './shared'
import type { Engagement } from '../types'

const COPY_KEYS: { key: 'client' | 'target_system' | 'period_from' | 'period_to'; label: string }[] = [
  { key: 'client', label: '顧客' },
  { key: 'target_system', label: '対象システム' },
  { key: 'period_from', label: '開始日' },
  { key: 'period_to', label: '終了日' },
]

/** YAML が日付として読んだ値（ISO 形式）も YYYY-MM-DD にそろえて比べます。 */
function norm(v: unknown) {
  if (v === undefined || v === null) return ''
  const s = String(v).trim()
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s
}

interface Mismatch { doc: string; label: string; inDoc: string; inMeta: string }

function mismatches(docLabel: string, data: Record<string, unknown> | undefined, eng: Engagement): Mismatch[] {
  if (!data) return []
  return COPY_KEYS
    .filter(({ key }) => norm(data[key]) !== norm(eng[key]))
    .map(({ key, label }) => ({ doc: docLabel, label, inDoc: norm(data[key]), inMeta: norm(eng[key]) }))
}

/**
 * E0 事前準備。スコープ文書の承認（agreed / agreed_at / agreed_by）を記録します。
 * 顧客・対象・期間は engagement.json が正で、文書の frontmatter は写しです。
 */
export function ScopePage() {
  const { current, revision } = useStore()
  const save = useSaveEngagement()
  const { data, error } = useAsync(
    async () => {
      if (!current) return null
      const e = await api.engagement(current.id)
      let scopeError: string | null = null
      const [scope, report] = await Promise.all([
        api.doc(e.docs!.scope).catch((err: Error) => { scopeError = err.message; return null }),
        api.doc(e.docs!.report).catch(() => null),
      ])
      return { e, scope, report, scopeError: scopeError as string | null }
    },
    [current?.id, revision],
  )

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  if (!data) return <div className="empty">読み込んでいます…</div>

  const diffs = [
    ...mismatches('スコープ文書', data.scope?.data, current),
    ...mismatches('報告書', data.report?.data, current),
  ]

  return (
    <>
      <div className="page-head">
        <h1>事前準備</h1>
      </div>

      <PhaseGuide phase="preparation" />

      <EngagementInfoCard engagement={current} />

      {diffs.length > 0 && (
        <div className="banner warn" role="status">
          {diffs.map((d) => (
            <p key={`${d.doc}-${d.label}`} className="banner-text">
              {d.doc}の『{d.label}』が診断対象の設定と異なります（文書: {d.inDoc || '未記入'} ／ 設定: {d.inMeta || '未記入'}）
            </p>
          ))}
          <div className="banner-actions">
            <button
              className="btn secondary small"
              onClick={() => save(current.id, {
                client: current.client, target_system: current.target_system,
                period_from: current.period_from, period_to: current.period_to,
              })}
            >
              設定の値に揃える
            </button>
          </div>
        </div>
      )}

      {data.scope && <ScopeEditor key={data.scope.file} doc={data.scope} />}

      {data.scope ? (
        <DocEditor
          key={data.scope.file}
          file={data.scope.file}
          fields={[
            { key: 'agreed', label: '書面の承認を得た', type: 'checkbox', hint: '承認を得るまで診断を開始しないでください。印を付けたら、承認日と承認者も記録します。' },
            { key: 'agreed_at', label: '承認日', type: 'date' },
            { key: 'agreed_by', label: '承認者（氏名・役職）' },
          ]}
          validate={(d) => {
            if (d.agreed !== 'true') return null
            const missing = [!d.agreed_at?.trim() && '承認日', !d.agreed_by?.trim() && '承認者'].filter(Boolean)
            return missing.length
              ? `「書面の承認を得た」に印を付けたときは、${missing.join('と')}も記録してください。保存していません。`
              : null
          }}
        />
      ) : data.scopeError && !/見つかりません|ENOENT|no such file/i.test(data.scopeError) ? (
        <div className="banner error" role="alert">
          <p className="banner-text">
            スコープ文書の frontmatter を読めません。Obsidian で編集したときは、* で始まる値を引用符で囲んでいるか（'*.example.com'）を確かめてください。
            読めるようになるまで、この診断対象ではコマンドを実行できません。
          </p>
          <p className="banner-text">{data.scopeError}</p>
        </div>
      ) : (
        <div className="empty">スコープ文書が見つかりません。設定の「テンプレートを補う」を試してください。</div>
      )}
    </>
  )
}
