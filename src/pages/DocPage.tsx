import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { DocEditor } from '../components/DocEditor'
import { Markdown } from '../components/Markdown'
import { NoEngagement } from './shared'

/**
 * 診断対象フォルダの Markdown を 1 つ開きます。
 * 進め方・攻撃面マップ・未検出記録のように、専用画面を持たない文書に使います。
 */
export function DocPage() {
  const { current, revision } = useStore()
  const [params] = useSearchParams()
  const file = params.get('file') || ''
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const { data, error, loading } = useAsync(
    () => (file ? api.doc(file) : Promise.resolve(null)),
    [file, revision],
  )

  if (!current) return <NoEngagement />
  if (!file) return <div className="empty">開くファイルが指定されていません。</div>
  if (error) return <div className="banner error">{error}</div>
  if (loading || !data) return <div className="empty">読み込んでいます…</div>

  return (
    <>
      <div className="page-head">
        <h1>{String(data.data.title || file)}</h1>
        <div className="spacer" />
        <button className="btn secondary" onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}>
          {mode === 'preview' ? '本文を編集' : 'プレビューに戻る'}
        </button>
      </div>

      {mode === 'preview' ? (
        <div className="card">
          <Markdown source={data.body} eid={file.split(/[\\/]/)[0]} />
          <p className="doc-path" style={{ marginTop: 'var(--sp-4)' }}>{file}</p>
        </div>
      ) : (
        <DocEditor file={file} sectionHeadings={data.sections.map((s) => s.heading).filter((h): h is string => !!h)} />
      )}
    </>
  )
}
