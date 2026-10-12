import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { DocEditor } from '../components/DocEditor'
import { NoEngagement, SeverityPill } from './shared'

const STATUS_OPTIONS = ['未調査', '調査中', '調査済', '対象外'].map((v) => ({ value: v, label: v }))

export function SurfaceDetailPage() {
  const { id } = useParams()
  const { current, revision } = useStore()
  const { data, error, loading } = useAsync(
    async () => {
      if (!current) return null
      const [surfaces, findings, logs] = await Promise.all([
        api.surfaces(current.id), api.findings(current.id), api.toolLogs(current.id),
      ])
      return { surfaces, findings, logs }
    },
    [current?.id, revision],
  )

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  if (loading || !data) return <div className="empty">読み込んでいます…</div>

  const surface = data.surfaces.find((s) => s.id === id)
  if (!surface) return <div className="empty">サーフェス {id} が見つかりません。</div>

  const relatedFindings = data.findings.filter((f) => f.surfaces.includes(surface.id))
  const relatedLogs = data.logs.filter((l) => l.surfaces.includes(surface.id))

  return (
    <>
      <div className="breadcrumb"><Link to="/surfaces">偵察・列挙</Link> / {surface.id}</div>
      <div className="page-head">
        <h1>{surface.value || surface.title}</h1>
        <span className="tag">{surface.kind_label}</span>
        <span className="tag">{surface.status}</span>
      </div>

      <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="card-head"><span className="card-title">関連する記録</span></div>
        <div className="grid-2">
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 'var(--sp-2)' }}>ツール実行ログ（{relatedLogs.length}）</h3>
            {relatedLogs.length === 0 ? <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>まだありません。</p> : (
              <ul style={{ fontSize: 14, paddingLeft: '1.2em', margin: 0 }}>
                {relatedLogs.map((l) => (
                  <li key={l.id}><Link to={`/survey/logs/${l.id}`}>{l.tool} — {l.title}</Link></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 'var(--sp-2)' }}>発見事項（{relatedFindings.length}）</h3>
            {relatedFindings.length === 0 ? <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>まだありません。</p> : (
              <ul style={{ fontSize: 14, paddingLeft: '1.2em', margin: 0, display: 'grid', gap: 4 }}>
                {relatedFindings.map((f) => (
                  <li key={f.id}>
                    <SeverityPill value={f.severity} />{' '}
                    <Link to={`/findings/${f.id}`}>{f.vuln_name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <DocEditor
        file={surface.file}
        fields={[
          { key: 'value', label: '値' },
          { key: 'host', label: 'ホスト' },
          { key: 'port', label: 'ポート', type: 'number' },
          { key: 'protocol', label: 'プロトコル' },
          { key: 'service', label: 'サービス' },
          { key: 'product', label: '製品・バージョン' },
          { key: 'status', label: '状態', type: 'select', options: STATUS_OPTIONS },
          { key: 'discovered_at', label: '発見日', type: 'date' },
        ]}
        sectionHeadings={['発見の経緯', '観測した応答', '着眼点', '調査メモ']}
      />
    </>
  )
}
