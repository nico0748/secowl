import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import type { ImportResult } from '../types'
import { NoEngagement } from './shared'

const HINTS: Record<string, string> = {
  nmap: 'nmap -sV -oX scan.xml <対象> で出力した XML を貼り付けます。開いているポートとサービスをサーフェスにします。',
  httpx: 'httpx -json の各行を貼り付けます。URL・技術スタック・Web サーバをサーフェスにします。',
  nuclei: 'nuclei -jsonl の各行を貼り付けます。検出をサーフェスと発見事項（draft）にします。',
  subdomains: 'subfinder / amass の JSON、または 1 行 1 ドメインのテキストを貼り付けます。',
  ffuf: 'ffuf -o result.json -of json の中身を貼り付けます。',
  gobuster: 'gobuster dir の標準出力をそのまま貼り付けます。',
}

export function ImportPage() {
  const { current, bump, notify } = useStore()
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [format, setFormat] = useState('auto')
  const [importFindings, setImportFindings] = useState(true)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: formats } = useAsync(() => api.importFormats(), [])

  const options = useMemo(
    () => [['auto', '自動判定'], ...Object.entries(formats ?? {})] as [string, string][],
    [formats],
  )

  if (!current) return <NoEngagement />

  const run = async (dryRun: boolean) => {
    if (!text.trim()) { setErr('取り込む内容を貼り付けてください'); return }
    setBusy(true)
    setErr(null)
    try {
      const res = await api.importToolOutput(current.id, { text, format, dryRun, importFindings })
      setPreview(res)
      if (!dryRun) {
        notify(`取り込みました（サーフェス ${res.surfaces.created.length} 件を追加）`)
        bump()
      }
    } catch (e) {
      setErr(String((e as Error).message))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const readFile = async (f: File | undefined) => {
    if (!f) return
    setText(await f.text())
    setPreview(null)
  }

  return (
    <>
      <div className="page-head">
        <h1>ツール出力の取り込み</h1>
        <div className="spacer" />
        <button className="btn quiet" onClick={() => nav('/surfaces')}>偵察に戻る</button>
      </div>

      <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
        出力を貼り付けると、サーフェスと発見事項の Markdown を生成します。同じ値のサーフェスがある場合は、発見ツールと技術の欄に追記します。
      </p>

      {err && <div className="banner error">{err}</div>}

      <div className="doc-layout">
        <div className="card">
          <div className="grid-2">
            <div className="field">
              <label htmlFor="imp-fmt">形式</label>
              <select id="imp-fmt" value={format} onChange={(e) => { setFormat(e.target.value); setPreview(null) }}>
                {options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              {format !== 'auto' && HINTS[format] && <span className="hint">{HINTS[format]}</span>}
            </div>
            <div className="field">
              <label htmlFor="imp-file">ファイルから読み込む</label>
              <input id="imp-file" ref={fileRef} type="file" accept=".xml,.json,.jsonl,.txt,.log" style={{ fontSize: 14 }} onChange={(e) => readFile(e.target.files?.[0])} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="imp-text">出力の内容</label>
            <textarea
              id="imp-text"
              value={text}
              onChange={(e) => { setText(e.target.value); setPreview(null) }}
              style={{ minHeight: 280 }}
              placeholder={'<?xml version="1.0"?>\n<nmaprun ...'}
            />
          </div>

          <label className="check-item">
            <input type="checkbox" checked={importFindings} onChange={(e) => { setImportFindings(e.target.checked); setPreview(null) }} />
            <span>検出を発見事項（draft）として起票する（nuclei のみ該当）</span>
          </label>

          <div className="dialog-actions">
            <button className="btn quiet" onClick={() => run(true)} disabled={busy}>内容を確認</button>
            <button className="btn" onClick={() => run(false)} disabled={busy || !preview}>取り込む</button>
          </div>
          {!preview && <p className="hint" style={{ textAlign: 'right', color: 'var(--app-text-muted)' }}>先に「内容を確認」を押してください。</p>}
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">取り込みの内容</span></div>
          {!preview ? (
            <div className="empty">確認を押すと、追加されるサーフェスと発見事項の一覧が出ます。</div>
          ) : (
            <>
              <p style={{ fontSize: 14 }}>
                判定した形式: <b>{preview.formatLabel}</b>
                {preview.dryRun ? '（まだ書き込んでいません）' : '（書き込みました）'}
              </p>
              <h3 style={{ fontSize: 15, marginTop: 'var(--sp-3)' }}>サーフェス</h3>
              <p style={{ fontSize: 14, color: 'var(--app-text-sub)', margin: '4px 0' }}>
                新規 {preview.surfaces.created.length} 件 ／ 更新 {preview.surfaces.updated.length} 件 ／ 変更なし {preview.surfaces.unchanged} 件
              </p>
              <ul style={{ fontSize: 14, paddingLeft: '1.2em', margin: 0 }}>
                {preview.surfaces.created.slice(0, 40).map((s) => <li key={s.value}>{s.kind_label}: {s.value}</li>)}
                {preview.surfaces.created.length > 40 && <li>ほか {preview.surfaces.created.length - 40} 件</li>}
              </ul>
              <h3 style={{ fontSize: 15, marginTop: 'var(--sp-3)' }}>発見事項</h3>
              <p style={{ fontSize: 14, color: 'var(--app-text-sub)', margin: '4px 0' }}>
                新規 {preview.findings.created.length} 件 ／ 重複で見送り {preview.findings.skipped.length} 件
              </p>
              <ul style={{ fontSize: 14, paddingLeft: '1.2em', margin: 0 }}>
                {preview.findings.created.slice(0, 30).map((f, i) => <li key={i}>[{f.severity}] {f.vuln_name}</li>)}
              </ul>
              {preview.findings.created.length > 0 && (
                <p className="banner warn" style={{ marginTop: 'var(--sp-3)' }}>
                  自動検出の結果です。手動で裏取りし、False Positive を除いてから confirmed にしてください。
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
