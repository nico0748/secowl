import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Dialog } from '../components/Dialog'
import { IconPlus } from '../components/Icons'
import { NoEngagement } from './shared'
import { PhaseGuide } from '../components/PhaseGuide'

const STATUSES = ['未調査', '調査中', '調査済', '対象外']

export function SurfacesPage() {
  const { current, meta, revision, bump, notify } = useStore()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const { data, error, loading, reload } = useAsync(
    () => (current ? api.surfaces(current.id) : Promise.resolve([])),
    [current?.id, revision],
  )
  const { data: eng } = useAsync(
    () => (current ? api.engagement(current.id) : Promise.resolve(null)),
    [current?.id, revision],
  )

  const port = params.get('port')
  const tech = params.get('tech')
  const kind = params.get('kind')

  const rows = useMemo(() => {
    let list = data ?? []
    if (port) list = list.filter((s) => String(s.port ?? '') === port)
    if (tech) list = list.filter((s) => s.product === tech || s.tech.includes(tech))
    if (kind) list = list.filter((s) => s.kind === kind)
    return list
  }, [data, port, tech, kind])

  if (!current) return <NoEngagement />

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next)
  }

  return (
    <>
      <div className="page-head">
        <h1>偵察・列挙</h1>
        <span className="tag">{rows.length} / {data?.length ?? 0} 件</span>
        <div className="spacer" />
        {eng?.docs && (
          <Link className="btn quiet" to={`/doc?file=${encodeURIComponent(eng.docs.surfaceMap)}`}>攻撃面マップ</Link>
        )}
        <button className="btn secondary" onClick={() => nav('/import')}>ツール出力を取り込む</button>
        <button className="btn" onClick={() => setOpen(true)}><IconPlus />サーフェスを追加</button>
      </div>

      <PhaseGuide phase="recon" />

      <p style={{ fontSize: 14, color: 'var(--text-sub)', marginTop: 0 }}>
        サブドメイン・ホスト・ポート・エンドポイントを 1 件 1 ファイルで記録します。行を開くと、そのサーフェスの調査記録を編集できます。
      </p>

      <div className="filters">
        <button className={`chip${!kind ? ' on' : ''}`} onClick={() => setFilter('kind', null)}>すべての種別</button>
        {Object.entries(meta?.surfaceKinds ?? {}).map(([k, label]) => (
          <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setFilter('kind', k)}>{label}</button>
        ))}
        {port && <button className="chip on" onClick={() => setFilter('port', null)}>ポート {port} ✕</button>}
        {tech && <button className="chip on" onClick={() => setFilter('tech', null)}>{tech} ✕</button>}
      </div>

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="empty">読み込んでいます…</div>}

      {!loading && rows.length === 0 && (
        <div className="empty">該当するサーフェスがありません。</div>
      )}

      {rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">ID</th><th scope="col">種別</th><th scope="col">値</th>
                <th scope="col">ポート</th><th scope="col">サービス</th><th scope="col">製品・技術</th>
                <th scope="col">状態</th><th scope="col">発見ツール</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/surfaces/${s.id}`}>{s.id}</Link></td>
                  <td>{s.kind_label}</td>
                  <td><Link to={`/surfaces/${s.id}`}>{s.value || s.title}</Link></td>
                  <td className="num">{s.port ?? ''}</td>
                  <td>{s.service}</td>
                  <td>{[s.product, ...s.tech].filter(Boolean).join(' / ')}</td>
                  <td>{s.status}</td>
                  <td>{s.discovered_by.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <SurfaceDialog
          kinds={meta?.surfaceKinds ?? {}}
          onClose={() => setOpen(false)}
          onCreate={async (input) => {
            await api.createSurface(current.id, input)
            setOpen(false)
            notify('サーフェスの Markdown を生成しました')
            reload()
            bump()
          }}
        />
      )}
    </>
  )
}

function SurfaceDialog({ kinds, onClose, onCreate }: {
  kinds: Record<string, string>
  onClose: () => void
  onCreate: (input: Record<string, unknown>) => Promise<void>
}) {
  const [f, setF] = useState({
    kind: 'subdomain', value: '', host: '', port: '', protocol: 'tcp',
    service: '', product: '', tech: '', discovered_by: '', status: '未調査',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, v: string) => setF({ ...f, [k]: v })

  const submit = async () => {
    if (!f.value && !f.host) { setErr('値かホストのどちらかを入力してください'); return }
    setBusy(true)
    try {
      await onCreate({
        ...f,
        port: f.port === '' ? '' : Number(f.port),
        tech: f.tech.split(',').map((s) => s.trim()).filter(Boolean),
        discovered_by: f.discovered_by.split(',').map((s) => s.trim()).filter(Boolean),
      })
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="サーフェスを追加" onClose={onClose}>
      {err && <div className="banner error">{err}</div>}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="s-kind">種別</label>
          <select id="s-kind" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {Object.entries(kinds).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-value">値</label>
          <input id="s-value" type="text" value={f.value} onChange={(e) => set('value', e.target.value)} placeholder="admin.example.com / https://example.com/api/v1/users" />
        </div>
        <div className="field">
          <label htmlFor="s-host">ホスト</label>
          <input id="s-host" type="text" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="203.0.113.10" />
        </div>
        <div className="field">
          <label htmlFor="s-port">ポート</label>
          <input id="s-port" type="number" value={f.port} onChange={(e) => set('port', e.target.value)} placeholder="443" />
          <span className="hint">ホーム画面の「ポート番号」一覧は、この値で集計します。</span>
        </div>
        <div className="field">
          <label htmlFor="s-proto">プロトコル</label>
          <input id="s-proto" type="text" value={f.protocol} onChange={(e) => set('protocol', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-service">サービス</label>
          <input id="s-service" type="text" value={f.service} onChange={(e) => set('service', e.target.value)} placeholder="https" />
        </div>
        <div className="field">
          <label htmlFor="s-product">製品・バージョン</label>
          <input id="s-product" type="text" value={f.product} onChange={(e) => set('product', e.target.value)} placeholder="nginx 1.24.0" />
          <span className="hint">「テクノロジー」の内訳に反映します。</span>
        </div>
        <div className="field">
          <label htmlFor="s-tech">技術（カンマ区切り）</label>
          <input id="s-tech" type="text" value={f.tech} onChange={(e) => set('tech', e.target.value)} placeholder="Cloudflare, HSTS" />
        </div>
        <div className="field">
          <label htmlFor="s-by">発見ツール（カンマ区切り）</label>
          <input id="s-by" type="text" value={f.discovered_by} onChange={(e) => set('discovered_by', e.target.value)} placeholder="nmap, amass" />
        </div>
        <div className="field">
          <label htmlFor="s-status">状態</label>
          <select id="s-status" value={f.status} onChange={(e) => set('status', e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="dialog-actions">
        <button className="btn quiet" onClick={onClose}>キャンセル</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? '作成しています…' : 'Markdown を生成'}</button>
      </div>
    </Dialog>
  )
}
