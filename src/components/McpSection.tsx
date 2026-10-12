import { useState } from 'react'
import { api } from '../api'
import { useAsync, useStore } from '../state'

/** クリップボードへ写し、ボタンの表示を少しのあいだ切り替えます。 */
function CopyButton({ value, label = 'コピー' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn quiet"
      style={{ minHeight: 36 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          window.setTimeout(() => setDone(false), 1800)
        } catch {
          setDone(false)
        }
      }}
    >
      {done ? '写しました' : label}
    </button>
  )
}

export function McpSection() {
  const { revision, notify, meta } = useStore()
  const [readOnly, setReadOnly] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const { data, error } = useAsync(() => api.mcp(), [revision])

  if (error) return <div className="banner error">{error}</div>
  if (!data) return null

  const desktop = readOnly ? data.desktopConfigReadOnly : data.desktopConfig
  const code = readOnly ? data.codeCommandReadOnly : data.codeCommand
  const shown = readOnly ? data.tools.filter((t) => !t.write) : data.tools

  const pre: React.CSSProperties = {
    background: 'var(--sumi-50)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--sp-3)',
    fontSize: 13,
    fontFamily: "'SFMono-Regular', 'Noto Sans Mono', ui-monospace, monospace",
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    margin: 0,
  }

  return (
    <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
      <div className="card-head">
        <span className="card-title">MCP 連携</span>
        <span className="card-note">{shown.length} ツールを公開</span>
      </div>

      <p style={{ fontSize: 14, color: 'var(--text-sub)', marginTop: 0 }}>
        SecOwl の操作を MCP サーバとして公開します。Claude Desktop や Claude Code から、診断対象の作成・サーフェスの登録・
        ツール出力の取り込み・発見事項の起票・報告書の生成までを呼び出せます。サーバは保存先の Markdown を直接読み書きするため、
        このアプリが起動していなくても動きます。
      </p>

      {!data.exists && (
        <div className="banner error">MCP サーバのファイルが見つかりません: {data.serverPath}</div>
      )}

      <label className="check-item">
        <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
        <span>読み取り専用で登録する（書き込み系の {data.tools.filter((t) => t.write).length} ツールを公開しない）</span>
      </label>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 var(--sp-4)' }}>
        書き込みを許すと、相手のモデルが発見事項や報告書を直接書き換えられます。読ませるだけなら読み取り専用で登録してください。
      </p>

      <h3 style={{ fontSize: 15, marginBottom: 'var(--sp-2)' }}>Claude Desktop</h3>
      <p style={{ fontSize: 14, color: 'var(--text-sub)', margin: '0 0 var(--sp-2)' }}>
        次の内容を設定ファイルの <code>mcpServers</code> に追記し、Claude Desktop を再起動してください。
      </p>
      <pre style={pre}>{desktop}</pre>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', margin: 'var(--sp-2) 0 var(--sp-4)', flexWrap: 'wrap' }}>
        <CopyButton value={desktop} label="設定をコピー" />
        <CopyButton value={data.desktopConfigPath} label="設定ファイルのパスをコピー" />
        {meta?.desktop && (
          <button
            className="btn quiet"
            style={{ minHeight: 36 }}
            onClick={() => api.reveal(data.desktopConfigPath).catch(() => notify('設定ファイルを開けませんでした'))}
          >
            設定ファイルを開く
          </button>
        )}
        <code style={{ fontSize: 13, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{data.desktopConfigPath}</code>
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 'var(--sp-2)' }}>Claude Code</h3>
      <p style={{ fontSize: 14, color: 'var(--text-sub)', margin: '0 0 var(--sp-2)' }}>
        端末で次のコマンドを実行します。
      </p>
      <pre style={pre}>{code}</pre>
      <div style={{ margin: 'var(--sp-2) 0 var(--sp-4)' }}>
        <CopyButton value={code} label="コマンドをコピー" />
      </div>

      <button className="btn quiet" style={{ minHeight: 36 }} onClick={() => setShowTools(!showTools)}>
        {showTools ? '公開するツールを隠す' : `公開するツールを見る（${shown.length}）`}
      </button>

      {showTools && (
        <table className="table" style={{ marginTop: 'var(--sp-3)' }}>
          <thead>
            <tr><th scope="col">ツール</th><th scope="col">内容</th><th scope="col">種別</th></tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.name}>
                <td style={{ whiteSpace: 'nowrap' }}><code>{t.name}</code><br /><span style={{ color: 'var(--text-muted)' }}>{t.title}</span></td>
                <td>{t.description}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{t.write ? '書き込み' : '読み取り'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
