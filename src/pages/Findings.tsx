import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Dialog } from '../components/Dialog'
import { IconPlus } from '../components/Icons'
import { NoEngagement, SeverityPill, StatusTag } from './shared'
import { SevIcon } from '../components/Severity'
import type { SeverityKey, Surface } from '../types'
import { PhaseGuide } from '../components/PhaseGuide'
import { FilterBar } from '../components/FilterBar'

const ORDER: SeverityKey[] = ['critical', 'high', 'medium', 'low', 'info']

export function FindingsPage() {
  const { current, meta, revision, bump, notify } = useStore()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const severity = params.get('severity')
  const q = params.get('q') || ''
  // URL の status には、ファイルに保存されている値（英語の draft など）をそのまま入れます。
  const status = params.get('status')

  const { data, error, loading, reload } = useAsync(
    async () => {
      if (!current) return { findings: [], surfaces: [] as Surface[] }
      const [findings, surfaces] = await Promise.all([api.findings(current.id), api.surfaces(current.id)])
      return { findings, surfaces }
    },
    [current?.id, revision],
  )

  const rows = useMemo(() => {
    const list = data?.findings ?? []
    let filtered = severity ? list.filter((f) => f.severity === severity) : list
    if (status) filtered = filtered.filter((f) => f.status === status)
    const needle = q.trim().toLowerCase()
    if (needle) {
      filtered = filtered.filter((f) =>
        [f.vuln_name, f.id, f.identifier, f.target].some((v) => String(v ?? '').toLowerCase().includes(needle)))
    }
    return [...filtered].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
  }, [data, severity, status, q])

  if (!current) return <NoEngagement />

  const setParam = (key: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v === null) next.delete(key)
    else next.set(key, v)
    setParams(next, { replace: key === 'q' })
  }
  const setSeverity = (v: string | null) => setParam('severity', v)

  return (
    <>
      <div className="page-head">
        <h1>トリアージ</h1>
        <span className="tag">{rows.length} / {data?.findings.length ?? 0} 件</span>
        <div className="spacer" />
        <button className="btn" onClick={() => setOpen(true)}><IconPlus />発見事項を起票</button>
      </div>

      <PhaseGuide phase="triage" />

      <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
        検出を手動で裏取りし、False Positive を除いたうえで 1 脆弱性 1 票にします。確定した票は、報告書画面の『発見事項を反映』で報告書に入ります。
      </p>

      <FilterBar
        label="発見事項を絞り込む"
        query={q}
        onQuery={(v) => setParam('q', v.trim() ? v : null)}
        placeholder="脆弱性名称・ID・識別子・対象で絞り込む"
        chips={(meta?.findingStatuses ?? []).map((s) => ({ value: s.key, label: s.label }))}
        selected={status}
        onSelect={(v) => setParam('status', v)}
      >
        <div className="filters" role="group" aria-label="深刻度で絞り込む">
          <button type="button" className={`chip${!severity ? ' on' : ''}`} aria-pressed={!severity} onClick={() => setSeverity(null)}>すべての深刻度</button>
          {(meta?.severities ?? []).map((s) => (
            <button
              key={s.key}
              type="button"
              className={`chip${severity === s.key ? ' on' : ''}`}
              aria-pressed={severity === s.key}
              onClick={() => setSeverity(severity === s.key ? null : s.key)}
            >
              <SevIcon value={s.key} size={12} />{s.ja}
            </button>
          ))}
        </div>
      </FilterBar>

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="empty">読み込んでいます…</div>}
      {!loading && rows.length === 0 && <div className="empty">該当する発見事項がありません。</div>}

      {rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th><th scope="col">深刻度</th><th scope="col" className="col-name">脆弱性名称</th>
                <th scope="col">識別子</th><th scope="col">CVSS</th><th scope="col">対象</th>
                <th scope="col">関連サーフェス</th><th scope="col" className="col-status">状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td>{f.finding_no}</td>
                  <td><SeverityPill value={f.severity} /></td>
                  <td><Link to={`/findings/${f.id}`}>{f.vuln_name}</Link></td>
                  <td className="nowrap">{f.identifier}</td>
                  <td className="num">{f.cvss_score ?? ''}</td>
                  <td>{f.target}</td>
                  <td><SurfaceLinks ids={f.surfaces} surfaces={data?.surfaces ?? []} /></td>
                  <td className="col-status"><StatusTag value={f.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <FindingDialog
          surfaces={data?.surfaces ?? []}
          onClose={() => setOpen(false)}
          onCreate={async (input) => {
            await api.createFinding(current.id, input)
            setOpen(false)
            notify('発見事項個票の Markdown を生成しました')
            reload()
            bump()
          }}
        />
      )}
    </>
  )
}

/** 関連サーフェスは 1 件目だけを出し、残りは「+2」のように数で示します（全件は title に）。 */
function SurfaceLinks({ ids, surfaces }: { ids: string[]; surfaces: Surface[] }) {
  if (ids.length === 0) return null
  const name = (sid: string) => surfaces.find((x) => x.id === sid)?.value || sid
  const [first, ...rest] = ids
  return (
    <span className="surface-links" title={ids.map(name).join('\n')}>
      <Link to={`/surfaces/${first}`}>{name(first)}</Link>
      {rest.length > 0 && <span className="more">+{rest.length}</span>}
    </span>
  )
}

function FindingDialog({ surfaces, onClose, onCreate }: {
  surfaces: Surface[]
  onClose: () => void
  onCreate: (input: Record<string, unknown>) => Promise<void>
}) {
  const [f, setF] = useState({ vuln_name: '', identifier: '', wstg_id: '', target: '', cvss_vector: '', cvss_score: '', tools: '' })
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, v: string) => setF({ ...f, [k]: v })

  const submit = async () => {
    if (!f.vuln_name) { setErr('脆弱性名称を入力してください'); return }
    setBusy(true)
    try {
      await onCreate({
        ...f,
        cvss_score: f.cvss_score === '' ? '' : Number(f.cvss_score),
        surfaces: picked,
        tools: f.tools.split(',').map((s) => s.trim()).filter(Boolean),
      })
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="発見事項を起票" onClose={onClose}>
      {err && <div className="banner error">{err}</div>}
      <div className="field">
        <label htmlFor="f-name">脆弱性名称</label>
        <input id="f-name" type="text" value={f.vuln_name} onChange={(e) => set('vuln_name', e.target.value)} placeholder="反射型クロスサイトスクリプティング" />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="f-id">識別子（CWE / CVE）</label>
          <input id="f-id" type="text" value={f.identifier} onChange={(e) => set('identifier', e.target.value)} placeholder="CWE-79" />
        </div>
        <div className="field">
          <label htmlFor="f-wstg">WSTG ID</label>
          <input id="f-wstg" type="text" value={f.wstg_id} onChange={(e) => set('wstg_id', e.target.value)} placeholder="WSTG-INPV-01" />
        </div>
        <div className="field">
          <label htmlFor="f-target">対象</label>
          <input id="f-target" type="text" value={f.target} onChange={(e) => set('target', e.target.value)} placeholder="https://example.com/search" />
        </div>
        <div className="field">
          <label htmlFor="f-score">CVSS 基本値</label>
          <input id="f-score" type="number" step="0.1" value={f.cvss_score} onChange={(e) => set('cvss_score', e.target.value)} placeholder="6.1" />
          <span className="hint">入力すると深刻度が決まります。空欄なら「なし」で起票します。</span>
        </div>
        <div className="field">
          <label htmlFor="f-vec">CVSS ベクタ</label>
          <input id="f-vec" type="text" value={f.cvss_vector} onChange={(e) => set('cvss_vector', e.target.value)} placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N" />
        </div>
        <div className="field">
          <label htmlFor="f-tools">使用ツール（カンマ区切り）</label>
          <input id="f-tools" type="text" value={f.tools} onChange={(e) => set('tools', e.target.value)} placeholder="Burp Suite" />
        </div>
      </div>
      <div className="field">
        <label>関連サーフェス</label>
        <div className="filters" style={{ marginBottom: 0 }}>
          {surfaces.length === 0 && <span className="hint">先に偵察でサーフェスを登録すると、ここで紐づけられます。</span>}
          {surfaces.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${picked.includes(s.id) ? ' on' : ''}`}
              onClick={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}
            >
              {s.value || s.title}
            </button>
          ))}
        </div>
      </div>
      <div className="dialog-actions">
        <button className="btn quiet" onClick={onClose}>キャンセル</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? '作成しています…' : 'Markdown を生成'}</button>
      </div>
    </Dialog>
  )
}
