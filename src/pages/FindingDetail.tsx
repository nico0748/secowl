import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { DocEditor } from '../components/DocEditor'
import { Dialog } from '../components/Dialog'
import { CvssCalculator } from '../components/CvssCalculator'
import { EvidencePanel } from '../components/EvidencePanel'
import { NoEngagement, SeverityPill } from './shared'

const STATUS_OPTIONS = [
  { value: 'draft', label: 'draft — 起票直後' },
  { value: 'confirmed', label: 'confirmed — 手動で裏取り済' },
  { value: 'reported', label: 'reported — 報告書に収録' },
  { value: 'fixed', label: 'fixed — 修正確認済' },
  { value: 'reopened', label: 'reopened — 再発' },
]

export function FindingDetailPage() {
  const { id } = useParams()
  const { current, meta, revision, bump, notify } = useStore()
  const [calc, setCalc] = useState(false)
  const [editorKey, setEditorKey] = useState(0)

  const { data, error, loading, reload } = useAsync(
    () => (current ? api.findings(current.id) : Promise.resolve([])),
    [current?.id, revision],
  )

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  if (loading) return <div className="empty">読み込んでいます…</div>

  const finding = (data ?? []).find((f) => f.id === id)
  if (!finding) return <div className="empty">発見事項 {id} が見つかりません。</div>

  return (
    <>
      <div className="breadcrumb"><Link to="/findings">トリアージ</Link> / {finding.id}</div>
      <div className="page-head">
        <h1>#{finding.finding_no} {finding.vuln_name}</h1>
        <SeverityPill value={finding.severity} />
        <span className="tag">{finding.status}</span>
        <div className="spacer" />
        <button className="btn secondary" onClick={() => setCalc(true)}>CVSS 計算機</button>
      </div>

      <div className="banner warn">
        証跡の実トークンと個人情報はマスキングしてから保存してください。CVSS 基本値を入力すると、深刻度は FIRST の区分に沿って決まります。
      </div>

      <DocEditor
        key={`${finding.file}-${editorKey}`}
        file={finding.file}
        fields={[
          { key: 'vuln_name', label: '脆弱性名称' },
          { key: 'identifier', label: '識別子（CWE / CVE）' },
          { key: 'owasp', label: 'OWASP Top 10:2025', hint: 'A01 から A10' },
          { key: 'wstg_id', label: 'WSTG ID' },
          { key: 'target', label: '対象' },
          { key: 'required_role', label: '発見・悪用に必要な立場', hint: '未認証の外部利用者 / 一般利用者 / 管理者' },
          { key: 'reproducibility', label: '再現性', hint: '再現可 / 条件付き / 一度のみ' },
          { key: 'cvss_vector', label: 'CVSS ベクタ' },
          { key: 'cvss_score', label: 'CVSS 基本値', type: 'number', hint: '9.0 以上は緊急、7.0 以上は重要、4.0 以上は警告、0.1 以上は注意' },
          {
            key: 'severity', label: '深刻度（手動で上書きする場合）', type: 'select',
            options: (meta?.severities ?? []).map((s) => ({ value: s.key, label: `${s.label}・${s.ja}` })),
          },
          { key: 'status', label: '状態', type: 'select', options: STATUS_OPTIONS },
        ]}
        sectionHeadings={[
          '平易な説明',
          '発見場所',
          'リクエスト / レスポンス',
          '再現手順',
          '脆弱性があると判断した理由',
          '脆弱性の解説',
          'システム・ビジネスへの影響',
          '対策',
          '参考情報',
          'リテスト',
        ]}
        onSaved={() => { reload(); }}
        renderAside={({ insert }) => (
          <EvidencePanel
            eid={current.id}
            prefix={finding.id}
            onInsert={(md) => insert('発見場所', md)}
          />
        )}
      />

      {calc && (
        <Dialog title="CVSS 計算機" onClose={() => setCalc(false)}>
          <CvssCalculator
            initialVector={finding.cvss_vector}
            onClose={() => setCalc(false)}
            onApply={async ({ vector, score }) => {
              await api.saveDoc({ file: finding.file, data: { cvss_vector: vector, cvss_score: score } })
              notify('CVSS を個票へ反映しました')
              setCalc(false)
              setEditorKey((n) => n + 1)
              reload()
              bump()
            }}
          />
        </Dialog>
      )}
    </>
  )
}
