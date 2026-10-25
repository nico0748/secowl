import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, StaleWriteError } from '../api'
import { useAsync, useStore } from '../state'
import { Dialog } from '../components/Dialog'
import { IconPlus } from '../components/Icons'
import { NoEngagement } from './shared'
import type { Doc, Surface } from '../types'
import { PhaseGuide } from '../components/PhaseGuide'

const TOOL_SUGGESTIONS = ['nmap', 'Burp Suite', 'OWASP ZAP', 'Wireshark', 'gobuster', 'ffuf', 'sqlmap', 'amass', 'nuclei', 'curl']

export function SurveyPage() {
  const { current, meta, revision, bump, notify } = useStore()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const tool = params.get('tool')

  const { data, error, loading, reload } = useAsync(
    async () => {
      if (!current) return null
      const e = await api.engagement(current.id)
      const [logs, surfaces, checklist] = await Promise.all([
        api.toolLogs(current.id), api.surfaces(current.id), api.doc(e.docs!.checklist),
      ])
      return { logs, surfaces, checklist, docs: e.docs! }
    },
    [current?.id, revision],
  )

  const logs = useMemo(() => {
    const list = data?.logs ?? []
    return tool ? list.filter((l) => l.tool === tool) : list
  }, [data, tool])

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  if (loading || !data) return <div className="empty">読み込んでいます…</div>

  const done = data.checklist.checklist.filter((c) => c.checked).length
  const total = data.checklist.checklist.length

  return (
    <>
      <div className="page-head">
        <h1>脆弱性調査</h1>
        <span className="tag">チェックリスト {done} / {total}</span>
        <span className="tag">ツール実行ログ {data.logs.length} 件</span>
        <div className="spacer" />
        <Link className="btn quiet" to={`/doc?file=${encodeURIComponent(data.docs.negative)}`}>未検出記録</Link>
        <button className="btn" onClick={() => setOpen(true)}><IconPlus />ツール実行ログを追加</button>
      </div>

      <PhaseGuide phase="survey" />

      <div className="doc-layout">
        <div className="card">
          <div className="card-head">
            <span className="card-title">ツール実行ログ</span>
            {tool && <button className="chip on" onClick={() => { const n = new URLSearchParams(params); n.delete('tool'); setParams(n) }}>{tool} ✕</button>}
            <span className="card-note">{logs.length} 件</span>
          </div>
          {logs.length === 0 ? (
            <div className="empty">ログがまだありません。実行したコマンドを記録すると、ホーム画面の「連携数」に反映されます。</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th scope="col">ツール</th><th scope="col">内容</th><th scope="col">フェーズ</th><th scope="col">実行日時</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{l.tool}</td>
                    <td><Link to={`/survey/logs/${l.id}`}>{l.title}</Link><br /><code style={{ fontSize: 13, color: 'var(--app-text-muted)' }}>{l.command}</code></td>
                    <td>{l.phase_label}</td>
                    <td>{l.executed_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <ChecklistCard doc={data.checklist} />
      </div>

      {open && (
        <ToolLogDialog
          surfaces={data.surfaces}
          phases={meta?.phases ?? {}}
          onClose={() => setOpen(false)}
          onCreate={async (input) => {
            await api.createToolLog(current.id, input)
            setOpen(false)
            notify('ツール実行ログの Markdown を生成しました')
            reload()
            bump()
          }}
        />
      )}
    </>
  )
}

function ChecklistCard({ doc }: { doc: Doc }) {
  const { notify } = useStore()
  const [items, setItems] = useState(doc.checklist)
  const groups = useMemo(() => {
    const map = new Map<string, typeof items>()
    for (const c of items) {
      const arr = map.get(c.group) || []
      arr.push(c)
      map.set(c.group, arr)
    }
    return [...map.entries()]
  }, [items])

  const toggle = async (line: number, checked: boolean) => {
    const text = items.find((c) => c.line === line)?.text ?? ''
    setItems((prev) => prev.map((c) => (c.line === line ? { ...c, checked } : c)))
    try {
      const next = await api.toggleCheck(doc.file, line, checked, text)
      setItems(next.checklist)
    } catch (e) {
      if (e instanceof StaleWriteError && e.current) {
        // 行がずれて項目を特定できなかったときは、切り替えずに最新の内容を出します。
        setItems(e.current.checklist)
        notify('チェックリストがほかの場所で更新されていたため、切り替えていません。最新の内容を表示しました。')
        return
      }
      setItems((prev) => prev.map((c) => (c.line === line ? { ...c, checked: !checked } : c)))
      notify('チェックリストを保存できませんでした')
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">診断チェックリスト</span>
        <span className="card-note">{items.filter((c) => c.checked).length} / {items.length}</span>
      </div>
      <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
        切り替えると Markdown のチェックボックスをその場で書き換えます。
      </p>
      {groups.map(([group, list]) => (
        <div className="check-group" key={group}>
          <h3>{group}</h3>
          {list.map((c) => (
            <label className="check-item" key={c.line}>
              <input type="checkbox" checked={c.checked} onChange={(e) => toggle(c.line, e.target.checked)} />
              <span>{c.text}</span>
            </label>
          ))}
        </div>
      ))}
      <p className="doc-path">{doc.file}</p>
    </div>
  )
}

function ToolLogDialog({ surfaces, phases, onClose, onCreate }: {
  surfaces: Surface[]
  phases: Record<string, string>
  onClose: () => void
  onCreate: (input: Record<string, unknown>) => Promise<void>
}) {
  const [f, setF] = useState({ tool: '', title: '', command: '', phase: 'survey' })
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, v: string) => setF({ ...f, [k]: v })

  const submit = async () => {
    if (!f.tool) { setErr('ツール名を入力してください'); return }
    setBusy(true)
    try {
      await onCreate({ ...f, surfaces: picked })
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="ツール実行ログを追加" onClose={onClose}>
      {err && <div className="banner error">{err}</div>}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="t-tool">ツール</label>
          <input id="t-tool" type="text" list="tool-list" value={f.tool} onChange={(e) => set('tool', e.target.value)} placeholder="nmap" />
          <datalist id="tool-list">{TOOL_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
          <span className="hint">ホーム画面の「連携数」は、ここで入力した名前ごとに集計します。</span>
        </div>
        <div className="field">
          <label htmlFor="t-phase">フェーズ</label>
          <select id="t-phase" value={f.phase} onChange={(e) => set('phase', e.target.value)}>
            {Object.entries(phases).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="t-title">見出し</label>
        <input id="t-title" type="text" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="全ポートスキャン（省略すると日時が入ります）" />
      </div>
      <div className="field">
        <label htmlFor="t-cmd">実行コマンド</label>
        <input id="t-cmd" type="text" value={f.command} onChange={(e) => set('command', e.target.value)} placeholder="nmap -sV -p- 203.0.113.10" />
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
