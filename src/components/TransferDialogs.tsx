import { useRef, useState } from 'react'
import { api } from '../api'
import { Dialog } from './Dialog'
import type { Engagement, TransferPreview } from '../types'

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/**
 * 診断対象を ZIP に書き出すダイアログです。受け取った人は「ZIP から取り込む」で同じ診断対象を開けます。
 */
export function ExportZipDialog({ engagement, onClose }: { engagement: Engagement; onClose: () => void }) {
  const [evidence, setEvidence] = useState(true)
  return (
    <Dialog title="ZIP に書き出す" onClose={onClose}>
      <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
        「{engagement.name}」のフォルダを 1 つの ZIP にまとめます。受け取った人は、設定画面の「ZIP から取り込む」で同じ状態から作業を続けられます。
      </p>
      <label className="check-item">
        <input type="checkbox" checked={evidence} onChange={(e) => setEvidence(e.target.checked)} />
        <span>証跡（evidence/）を含める</span>
      </label>
      <p className="hint-text">
        コマンド実行の生の出力と実行の記録（.secowl/）、Git の履歴は含めません。
      </p>
      <div className="banner warn">
        ZIP には調査の記録がそのまま入ります。暗号化はしないため、渡す相手と経路（社内のストレージや暗号化した共有など）を選び、証跡のマスキングを済ませてから渡してください。
      </div>
      <div className="dialog-actions">
        <button className="btn quiet" onClick={onClose}>閉じる</button>
        <a className="btn" href={api.exportZipUrl(engagement.id, { evidence })} onClick={() => window.setTimeout(onClose, 300)}>
          ZIP を書き出す
        </a>
      </div>
    </Dialog>
  )
}

/**
 * ZIP を選んで中身を確かめ、新しい診断対象として取り込むダイアログです。既存の診断対象は上書きしません。
 */
export function ImportZipDialog({ onClose, onImported }: { onClose: () => void; onImported: (id: string, name: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<TransferPreview | null>(null)
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pick = async (f: File | undefined) => {
    setErr(null)
    setPreview(null)
    setFile(f ?? null)
    if (!f) return
    setBusy(true)
    try {
      const p = await api.transferPreview(f)
      setPreview(p)
      setId(p.suggestedId)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!file || !preview) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.transferImport(file, id.trim() || undefined)
      onImported(r.id, r.name)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="ZIP から取り込む" onClose={onClose}>
      {err && <div className="banner error">{err}</div>}
      <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
        SecOwl の「ZIP に書き出す」で作った ZIP を、新しい診断対象として保存先に展開します。中身は目録のハッシュと照合してから展開します。
      </p>
      <div className="field">
        <label htmlFor="zip-file">ZIP ファイル</label>
        <input id="zip-file" ref={fileRef} type="file" accept=".zip,application/zip" style={{ fontSize: 14 }} onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {busy && !preview && <p className="hint-text">中身を確かめています…</p>}
      {preview && (
        <>
          <table className="table" style={{ marginBottom: 'var(--sp-3)' }}>
            <tbody>
              <tr><th scope="row">診断対象</th><td>{preview.name}</td></tr>
              {preview.client && <tr><th scope="row">顧客</th><td>{preview.client}</td></tr>}
              {(preview.period_from || preview.period_to) && <tr><th scope="row">期間</th><td>{preview.period_from} 〜 {preview.period_to}</td></tr>}
              <tr><th scope="row">中身</th><td>発見事項 {preview.findings} 件・サーフェス {preview.surfaces} 件・証跡 {preview.evidence} 件（全 {preview.files} ファイル、{mb(preview.bytes)}）</td></tr>
              {preview.exported_at && <tr><th scope="row">書き出した日時</th><td>{new Date(preview.exported_at).toLocaleString('ja-JP')}{preview.app_version ? `（SecOwl ${preview.app_version}）` : ''}</td></tr>}
            </tbody>
          </table>
          {preview.exists && (
            <div className="banner warn">
              同じ ID（{preview.id}）の診断対象がすでにあります。上書きはしないため、別の ID で取り込みます。今あるものと入れ替えたいときは、先に今あるフォルダを移すか消してから取り込んでください。
            </div>
          )}
          <div className="field">
            <label htmlFor="zip-id">取り込み先の ID（フォルダ名）</label>
            <input id="zip-id" type="text" value={id} onChange={(e) => setId(e.target.value)} />
          </div>
        </>
      )}
      <div className="dialog-actions">
        <button className="btn quiet" onClick={onClose}>閉じる</button>
        <button className="btn" disabled={busy || !preview || !id.trim()} onClick={submit}>
          {busy && preview ? '取り込んでいます…' : '取り込む'}
        </button>
      </div>
    </Dialog>
  )
}
