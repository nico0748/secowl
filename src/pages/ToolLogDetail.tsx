import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { DocEditor } from '../components/DocEditor'
import { NoEngagement } from './shared'

export function ToolLogDetailPage() {
  const { id } = useParams()
  const { current, meta, revision } = useStore()
  const { data, error, loading } = useAsync(
    () => (current ? api.toolLogs(current.id) : Promise.resolve([])),
    [current?.id, revision],
  )

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  if (loading) return <div className="empty">読み込んでいます…</div>

  const log = (data ?? []).find((l) => l.id === id)
  if (!log) return <div className="empty">ログ {id} が見つかりません。</div>

  return (
    <>
      <div className="breadcrumb"><Link to="/survey">脆弱性調査</Link> / {log.id}</div>
      <div className="page-head">
        <h1>{log.title}</h1>
        <span className="tag">{log.tool}</span>
        <span className="tag">{log.phase_label}</span>
      </div>

      <DocEditor
        file={log.file}
        fields={[
          { key: 'tool', label: 'ツール' },
          { key: 'command', label: '実行コマンド' },
          { key: 'executed_at', label: '実行日時' },
          {
            key: 'phase', label: 'フェーズ', type: 'select',
            options: Object.entries(meta?.phases ?? {}).map(([value, label]) => ({ value, label })),
          },
        ]}
        sectionHeadings={['実行コマンド', '出力', '読み取ったこと', '次の手']}
      />
    </>
  )
}
