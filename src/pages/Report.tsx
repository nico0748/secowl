import { useState } from 'react'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Markdown } from '../components/Markdown'
import { DocEditor } from '../components/DocEditor'
import { Dialog } from '../components/Dialog'
import { NoEngagement } from './shared'
import { PhaseGuide } from '../components/PhaseGuide'

export function ReportPage() {
  const { current, revision, bump, notify } = useStore()
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [busy, setBusy] = useState(false)
  const [share, setShare] = useState(false)

  const { data, error, loading, reload } = useAsync(
    async () => {
      if (!current) return null
      const e = await api.engagement(current.id)
      const [doc, findings] = await Promise.all([api.doc(e.docs!.report), api.findings(current.id)])
      return { doc, findings }
    },
    [current?.id, revision],
  )

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  if (loading || !data) return <div className="empty">読み込んでいます…</div>

  const drafts = data.findings.filter((f) => f.status === 'draft').length

  const build = async () => {
    setBusy(true)
    try {
      await api.buildReport(current.id)
      notify('発見事項とサーフェスを報告書に反映しました')
      reload()
      bump()
    } catch (e) {
      notify(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const downloadMd = () => {
    const blob = new Blob([data.doc.raw], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${current.id}-診断報告書.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="page-head">
        <h1>調査報告書</h1>
        <div className="spacer" />
        <button className="btn secondary" onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}>
          {mode === 'preview' ? '本文を編集' : 'プレビューに戻る'}
        </button>
        <button className="btn secondary" onClick={() => setShare(true)}>共有・書き出し</button>
        <button className="btn" onClick={build} disabled={busy}>{busy ? '反映しています…' : '発見事項を反映'}</button>
      </div>

      <PhaseGuide phase="report" />

      <div className="banner">
        「発見事項を反映」を押すと、件数内訳・発見事項一覧・個別の脆弱性の章を現在のデータで書き換えます。手書きした章はそのまま残ります。
      </div>

      {mode === 'preview' ? (
        <div className="card"><Markdown source={data.doc.body} /></div>
      ) : (
        <DocEditor
          file={data.doc.file}
          fields={[
            { key: 'client', label: '顧客' },
            { key: 'target_system', label: '対象システム' },
            { key: 'report_no', label: '報告書番号' },
            { key: 'report_version', label: '版数' },
            { key: 'period_from', label: '開始日', type: 'date' },
            { key: 'period_to', label: '終了日', type: 'date' },
          ]}
          sectionHeadings={[
            '1.1 調査の目的と背景',
            '1.3 総評',
            '1.5 特に注意すべき発見',
            '1.6 推奨する対応の優先順位',
            '2.2.2 ホスティング構成',
            '2.4 調査期間・体制・手法',
            '2.6 制限事項',
            '3.2 横断的に確認された事項',
            '5.1 総括',
            '5.2 構成に起因する所見',
            '5.3 改善ロードマップ',
            '6.1 検証したが脆弱性に至らなかった観点',
            '6.2 深掘りしたが不発に終わった試行',
          ]}
        />
      )}

      {share && <ShareDialog eid={current.id} drafts={drafts} onClose={() => setShare(false)} onMd={downloadMd} />}
    </>
  )
}

function ShareDialog({ eid, drafts, onClose, onMd }: { eid: string; drafts: number; onClose: () => void; onMd: () => void }) {
  const [includeDraft, setIncludeDraft] = useState(false)
  const [includeEvidence, setIncludeEvidence] = useState(true)

  return (
    <Dialog title="共有・書き出し" onClose={onClose}>
      <section style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 style={{ fontSize: 15 }}>共有バンドル（HTML 1 ファイル）</h3>
        <p style={{ fontSize: 14, color: 'var(--text-sub)', marginTop: 4 }}>
          診断対象のスナップショットを自己完結の HTML にします。相手はブラウザで開くだけで読めます。書き込みはできません。
        </p>
        <label className="check-item">
          <input type="checkbox" checked={includeDraft} onChange={(e) => setIncludeDraft(e.target.checked)} />
          <span>draft 状態の発見事項も含める{drafts > 0 ? `（現在 ${drafts} 件）` : ''}</span>
        </label>
        <label className="check-item">
          <input type="checkbox" checked={includeEvidence} onChange={(e) => setIncludeEvidence(e.target.checked)} />
          <span>証跡画像を埋め込む（ファイルサイズが増えます）</span>
        </label>
        <div className="banner warn" style={{ marginTop: 'var(--sp-2)' }}>
          共有バンドルは機密情報を含みます。渡す前に証跡のマスキングを確認してください。
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
          <a className="btn secondary" href={api.shareUrl(eid, { draft: includeDraft, evidence: includeEvidence })} target="_blank" rel="noreferrer">
            内容を確認
          </a>
          <a className="btn" href={api.shareUrl(eid, { draft: includeDraft, evidence: includeEvidence, download: true })}>
            HTML を書き出す
          </a>
        </div>
      </section>

      <section style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 style={{ fontSize: 15 }}>報告書の納品形式</h3>
        <p style={{ fontSize: 14, color: 'var(--text-sub)', marginTop: 4 }}>
          印刷用レイアウトは表紙と目次を付けた状態で開きます。ブラウザの印刷設定で「ヘッダーとフッター」を有効にすると、ページ番号が入ります。
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <a className="btn secondary" href={api.printUrl(eid)} target="_blank" rel="noreferrer">印刷用レイアウトを開く</a>
          <a className="btn secondary" href={api.docxUrl(eid)}>Word (.docx) を書き出す</a>
          <button className="btn quiet" onClick={onMd}>Markdown を書き出す</button>
        </div>
      </section>

      <div className="dialog-actions">
        <button className="btn quiet" onClick={onClose}>閉じる</button>
      </div>
    </Dialog>
  )
}
