import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Markdown } from '../components/Markdown'
import { DocEditor } from '../components/DocEditor'
import { Dialog } from '../components/Dialog'
import { NoEngagement } from './shared'
import { PhaseGuide } from '../components/PhaseGuide'
import type { ExcludedFinding } from '../types'
import { EngagementInfoCard } from '../components/EngagementInfo'

export function ReportPage() {
  const { current, revision, bump, notify } = useStore()
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [busy, setBusy] = useState(false)
  const [share, setShare] = useState(false)

  const { data, error, loading, reload } = useAsync(
    async () => {
      if (!current) return null
      const e = await api.engagement(current.id)
      const [doc, findings, check] = await Promise.all([api.doc(e.docs!.report), api.findings(current.id), api.reportCheck(current.id)])
      return { doc, findings, check }
    },
    [current?.id, revision],
  )

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  if (loading || !data) return <div className="empty">読み込んでいます…</div>

  const drafts = data.findings.filter((f) => f.status === 'draft').length
  // 除外した下書きは、反映した直後だけでなく、開き直しても出します。
  const excluded: ExcludedFinding[] = data.check.excluded

  const build = async () => {
    setBusy(true)
    try {
      const res = await api.buildReport(current.id)
      notify(res.excluded.length
        ? `${res.included} 件を反映しました。下書きの ${res.excluded.length} 件は含めていません`
        : `${res.included} 件を反映しました`)
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

      {excluded.length > 0 && (
        <div className="banner warn">
          <p className="banner-text">次の発見事項は下書きのため、報告書に含めていません。裏取りが済んだら状態を『確定』にして、もう一度反映してください。</p>
          <ul className="banner-list">
            {excluded.map((f) => (
              <li key={f.id}><Link to={`/findings/${f.id}`}>{f.id} {f.vuln_name}</Link></li>
            ))}
          </ul>
        </div>
      )}

      <div className="banner">
        「発見事項を反映」を押すと、件数内訳・発見事項一覧・個別の脆弱性の章を現在のデータで書き換えます。手書きした章はそのまま残ります。
      </div>

      <EngagementInfoCard engagement={current} title="表紙に載せる診断対象の情報" />

      {mode === 'preview' ? (
        <div className="card"><Markdown source={data.doc.body} eid={current.id} /></div>
      ) : (
        <DocEditor
          file={data.doc.file}
          fields={[
            { key: 'report_no', label: '報告書番号' },
            { key: 'report_version', label: '版数' },
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

const LEAK_LABEL: Record<string, string> = {
  cookie: 'Cookie', authorization: 'Authorization', jwt: 'JWT', email: 'メールアドレス', secret: 'API キー・トークン・パスワード',
}

function ShareDialog({ eid, drafts, onClose, onMd }: { eid: string; drafts: number; onClose: () => void; onMd: () => void }) {
  const [includeDraft, setIncludeDraft] = useState(false)
  const [includeEvidence, setIncludeEvidence] = useState(true)
  // 下書きを含めるかどうかで点検の範囲も変えます。
  const { data: check, loading: checking } = useAsync(() => api.reportCheck(eid, includeDraft), [eid, includeDraft])

  return (
    <Dialog title="共有・書き出し" onClose={onClose}>
      <section style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 style={{ fontSize: 15 }}>共有バンドル（HTML 1 ファイル）</h3>
        <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 4 }}>
          診断対象のスナップショットを自己完結の HTML にします。相手はブラウザで開くだけで読めます。書き込みはできません。
        </p>
        <label className="check-item">
          <input type="checkbox" checked={includeDraft} onChange={(e) => setIncludeDraft(e.target.checked)} />
          <span>下書きの発見事項も含める{drafts > 0 ? `（現在 ${drafts} 件）` : ''}</span>
        </label>
        <label className="check-item">
          <input type="checkbox" checked={includeEvidence} onChange={(e) => setIncludeEvidence(e.target.checked)} />
          <span>証跡画像を埋め込む（ファイルサイズが増えます）</span>
        </label>
        {checking && !check && <p className="hint-text">マスキング漏れを点検しています…</p>}
        {check && check.leaks.length > 0 && (
          <div className="banner warn share-leaks" role="alert">
            <p className="banner-text">次の記録に、伏せていない Cookie・トークン・メールアドレスが残っている可能性があります。</p>
            <ul className="banner-list">
              {check.leaks.map((l) => (
                <li key={l.id}>
                  <Link to={l.id === 'report' ? '/report' : `/findings/${l.id}`} onClick={onClose}>
                    {l.id === 'report' ? l.vuln_name : `${l.id} ${l.vuln_name}`}
                  </Link>
                  （{l.kinds.map((k) => LEAK_LABEL[k] ?? k).join('・')}）
                </li>
              ))}
            </ul>
          </div>
        )}
        {check && check.leaks.length === 0 && (
          <p className="share-check-ok" role="status">
            マスキング漏れの点検: 該当なし（発見事項 {check.checked} 件{check.includeDraft ? '（下書きを含む）' : ''}と報告書の手書きの章を点検）
          </p>
        )}
        <div className="banner warn share-note">
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
        <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 4 }}>
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
