import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { IconPlus } from '../components/Icons'
import { McpSection } from '../components/McpSection'
import { ThemeSection } from '../components/ThemeSection'
import { EngagementDialog } from '../components/EngagementDialog'
import { useSaveEngagement } from '../components/EngagementInfo'
import type { Engagement } from '../types'

export function SettingsPage() {
  const { meta, engagements, current, setCurrentId, reloadEngagements, reloadMeta, notify, bump } = useStore()
  const [root, setRoot] = useState(meta?.dataRoot ?? '')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Engagement | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const saveEngagement = useSaveEngagement()

  const saveRoot = async () => {
    try {
      const res = await api.setDataRoot(root)
      setRoot(res.dataRoot)
      await reloadMeta()
      await reloadEngagements()
      notify('保存先を変更しました')
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }

  return (
    <>
      <div className="page-head"><h1>設定</h1></div>
      {err && <div className="banner error">{err}</div>}

      <section className="card" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="card-head"><span className="card-title">調査データの保存先</span></div>
        <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
          診断対象ごとのフォルダと Markdown はこのパスの下に作られます。Obsidian で開くときは、このフォルダを vault として指定してください。
        </p>
        <div className="field">
          <label htmlFor="root">パス</label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <input id="root" type="text" value={root} onChange={(e) => setRoot(e.target.value)} placeholder="~/secowl-data" />
            {meta?.desktop && (
              <button
                className="btn quiet"
                style={{ whiteSpace: 'nowrap' }}
                onClick={async () => {
                  try {
                    const res = await api.pickFolder(root)
                    if (res.path) setRoot(res.path)
                  } catch (e) { setErr(String((e as Error).message)) }
                }}
              >
                参照…
              </button>
            )}
          </div>
          <span className="hint">
            現在の設定元: {meta?.dataRootSource === 'env' ? '環境変数 SECOWL_DATA' : meta?.dataRootSource === 'config' ? 'secowl.config.json' : '既定値（アプリ内 data/）'}
          </span>
        </div>
        <div className="dialog-actions">
          {meta?.desktop && (
            <button className="btn quiet" onClick={() => api.reveal(meta.dataRoot).catch((e) => setErr(String((e as Error).message)))}>
              Finder で開く
            </button>
          )}
          <button className="btn" onClick={saveRoot}>保存先を変更</button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">診断対象</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)' }}>
            {current && (
              <button
                className="btn quiet"
                onClick={async () => {
                  try {
                    const r = await api.ensureDocs(current.id)
                    notify(r.added.length ? `不足していた ${r.added.length} 件の Markdown を補いました` : 'テンプレートはすべてそろっています')
                    bump()
                  } catch (e) { setErr(String((e as Error).message)) }
                }}
              >
                テンプレートを補う
              </button>
            )}
            <button className="btn" onClick={() => setOpen(true)}><IconPlus />診断対象を作る</button>
          </div>
        </div>
        {engagements.length === 0 ? (
          <div className="empty">
            診断対象がありません。診断対象を作ると、スコープと RoE・進め方・攻撃面マップ・チェックリスト・未検出記録・報告書の Markdown が同時に生成されます。
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th scope="col">診断対象</th><th scope="col">顧客</th><th scope="col">対象</th><th scope="col">期間</th><th scope="col">作成日</th><th scope="col"></th></tr>
            </thead>
            <tbody>
              {engagements.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}{current?.id === e.id && <span className="tag" style={{ marginLeft: 8 }}>選択中</span>}</td>
                  <td>{e.client}</td>
                  <td>{e.target_system}</td>
                  <td><span className="nowrap">{e.period_from}</span> 〜 <span className="nowrap">{e.period_to}</span></td>
                  <td className="nowrap">{e.created}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div className="row-actions">
                      <Link className="btn quiet small" to="/playbook">進め方</Link>
                      <Link className="btn quiet small" to="/scope" onClick={() => setCurrentId(e.id)}>事前準備</Link>
                      <button className="btn quiet small" onClick={() => setEditing(e)}>編集</button>
                      <button className="btn quiet small" onClick={() => setCurrentId(e.id)}>切り替える</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <GitSection />

      <McpSection />

      <ThemeSection />

      {open && (
        <EngagementDialog
          onClose={() => setOpen(false)}
          onSubmit={async (input) => {
            const created = await api.createEngagement(input)
            await reloadEngagements()
            setCurrentId(created.id)
            setOpen(false)
            notify('診断対象フォルダと 6 種類の Markdown を生成しました。ホームの「進め方」から着手できます')
          }}
        />
      )}

      {editing && (
        <EngagementDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await saveEngagement(editing.id, input)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function GitSection() {
  const { notify, revision } = useStore()
  const [message, setMessage] = useState('')
  const [trackEvidence, setTrackEvidence] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data, reload } = useAsync(
    async () => {
      const status = await api.gitStatus()
      const log = status.isRepo ? await api.gitLog(10) : []
      return { status, log }
    },
    [revision],
  )

  if (!data) return null
  const { status, log } = data

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setErr(null)
    try { await fn(); notify(done); reload() }
    catch (e) { setErr(String((e as Error).message)) }
    finally { setBusy(false) }
  }

  return (
    <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
      <div className="card-head">
        <span className="card-title">Git（保存先の版管理）</span>
        {status.isRepo && <span className="card-note">ブランチ: {status.branch}</span>}
      </div>
      {err && <div className="banner error">{err}</div>}

      {!status.isRepo ? (
        <>
          <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
            保存先はまだ Git リポジトリではありません。初期化すると、この場で履歴を残せます。
          </p>
          <label className="check-item">
            <input type="checkbox" checked={trackEvidence} onChange={(e) => setTrackEvidence(e.target.checked)} />
            <span>証跡画像も追跡対象にする（既定では .gitignore で除外します）</span>
          </label>
          <div className="banner warn">
            証跡にはマスキング漏れが残る恐れがあります。履歴に入れると後から完全には消せません。除外したままの運用をおすすめします。
          </div>
          <div className="dialog-actions">
            <button className="btn" disabled={busy} onClick={() => act(() => api.gitInit(trackEvidence), 'リポジトリを初期化しました')}>
              リポジトリを初期化
            </button>
          </div>
        </>
      ) : (
        <>
          {(status.ignoreMissing?.length ?? 0) > 0 && (
            <div className="banner warn">
              <div>
                <p className="banner-text">
                  コマンド実行の生の出力は Cookie やトークンを伏せていないため、Git の履歴には入れないでください。次の行が .gitignore にまだありません。
                </p>
                <ul className="banner-list">{status.ignoreMissing!.map((r) => <li key={r}><code>{r}</code></li>)}</ul>
                <div className="banner-actions">
                  <button className="btn small" disabled={busy} onClick={() => act(() => api.gitInit(false), '.gitignore に追記しました')}>.gitignore に追記する</button>
                </div>
              </div>
            </div>
          )}
          {(status.rawTracked ?? 0) > 0 && (
            <div className="banner error">
              <p className="banner-text">
                生の出力や作業ファイルが、すでに Git の追跡対象になっています（{status.rawTracked} 件）。
                .gitignore に書いても、追跡中のファイルは外れません。公開や共有の前に、ターミナルで <code>git rm -r --cached</code> を使って追跡から外してください。履歴に残ったものは、履歴ごと書き換える必要があります。
              </p>
            </div>
          )}
          <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
            未コミットの変更: {status.changes?.length ?? 0} 件
          </p>
          {(status.changes?.length ?? 0) > 0 && (
            <ul style={{ fontSize: 14, paddingLeft: '1.2em', margin: '0 0 var(--sp-3)', maxHeight: 180, overflowY: 'auto' }}>
              {status.changes!.slice(0, 50).map((c) => (
                <li key={c.path}><code style={{ color: 'var(--app-text-muted)' }}>{c.code}</code> {c.path}</li>
              ))}
              {status.changes!.length > 50 && <li>ほか {status.changes!.length - 50} 件</li>}
            </ul>
          )}
          <div className="field">
            <label htmlFor="git-msg">コミットメッセージ</label>
            <input id="git-msg" type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="偵察: サブドメイン 12 件を追加" />
          </div>
          <div className="dialog-actions">
            <button
              className="btn"
              disabled={busy || !message.trim() || (status.changes?.length ?? 0) === 0}
              onClick={() => act(async () => { await api.gitCommit(message); setMessage('') }, 'コミットしました')}
            >
              すべての変更をコミット
            </button>
          </div>
          {log.length > 0 && (
            <>
              <h3 style={{ fontSize: 15, marginTop: 'var(--sp-4)' }}>最近のコミット</h3>
              <table className="table">
                <thead><tr><th scope="col">日付</th><th scope="col">内容</th><th scope="col">作成者</th><th scope="col">ハッシュ</th></tr></thead>
                <tbody>
                  {log.map((c) => (
                    <tr key={c.hash}>
                      <td>{c.date}</td><td>{c.subject}</td><td>{c.author}</td><td><code>{c.hash}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  )
}
