import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Dialog } from './Dialog'
import type { SetupFixPlan, SetupProgram, SetupReport } from '../types'

/** コマンドを 1 行で見せ、クリップボードへ写せるようにします。 */
function CommandLine({ value, note }: { value: string; note?: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="setup-cmd">
      <code>{value}</code>
      {note && <span className="setup-cmd-note">{note}</span>}
      <button
        type="button"
        className="btn quiet small"
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
        {done ? '写しました' : 'コピー'}
      </button>
    </div>
  )
}

const STATE_LABEL: Record<SetupProgram['state'], string> = { ok: '使える', missing: '入っていない', unsafe: '実行不可' }
const STATE_CLASS: Record<SetupProgram['state'], string> = { ok: 'ok', missing: '', unsafe: 'ng' }

function ProgramRow({ p }: { p: SetupProgram }) {
  return (
    <div className="setup-row">
      <div className="setup-row-head">
        <code className="setup-name">{p.program}</code>
        <span className={`tag verdict ${STATE_CLASS[p.state]}`}>{STATE_LABEL[p.state]}</span>
        {p.state === 'ok' && p.path && <span className="setup-path">{p.path}</span>}
      </div>
      {p.state === 'unsafe' && (
        <p className="setup-why">{`ほかのユーザーが書き換えられる場所にあるため、起動しません。${p.unsafeAt ? `問題のある場所: ${p.unsafeAt}` : ''}`}</p>
      )}
      {p.state === 'missing' && (
        <>
          {p.install.brew && <CommandLine value={p.install.brew} note="Homebrew" />}
          {p.install.go && <CommandLine value={p.install.go} note="Go" />}
          {!p.install.brew && !p.install.go && <p className="setup-why">配布元の手順で入れてください（ナレッジの「ツール」に案内があります）。</p>}
        </>
      )}
    </div>
  )
}

/** 権限を直す前の確認。押すと、さらにデスクトップ版のネイティブの確認が出ます。 */
function FixDialog({ plan, onClose, onDone }: {
  plan: SetupFixPlan
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 既定のフォーカスはキャンセル（起動の確認と同じ）。
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }) }, [])

  const go = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await api.setupFix(plan.planId)
      if (res.ok) {
        const failed = res.failed.length
        onDone(failed > 0
          ? `${res.changed.length} 件を直し、${failed} 件は直せませんでした。`
          : `${res.changed.length} 件の権限を直しました。`)
        return
      }
      if (res.cancelled) { onClose(); return }
      setErr(res.error || '権限を直せませんでした。')
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="権限を直す前の確認" onClose={onClose} wide>
      <p className="dialog-text">{`次の ${plan.paths.length} 件から、ほかのユーザーの書き込みの許可を外します（chmod go-w）。読み取りと実行の許可はそのままです。`}</p>
      <div className="setup-fix-list">
        {plan.paths.map((f) => (
          <div key={f.path} className="setup-fix-row">
            <code>{f.path}</code>
            <span className="setup-fix-mode">{f.mode} → {f.nextMode}</span>
          </div>
        ))}
      </div>
      {plan.blocked.length > 0 && (
        <div className="banner warn">
          <div>
            <p className="banner-text">{`次の ${plan.blocked.length} 件は、アプリからは直しません。ターミナルで実行してください。`}</p>
            {plan.blocked.map((f) => <CommandLine key={f.path} value={f.command} note={f.why ?? undefined} />)}
          </div>
        </div>
      )}
      {err && <div className="banner error"><p className="banner-text">{err}</p></div>}
      <p className="hint-text">「続ける」を押すと、変える場所の一覧がもう一度 OS の確認ダイアログに出ます。そこで許可するまで、何も変わりません。</p>
      <div className="dialog-actions">
        <button ref={cancelRef} className="btn quiet" onClick={onClose} disabled={busy}>キャンセル</button>
        <button className="btn" onClick={() => void go()} disabled={busy}>{busy ? '確認を待っています…' : '続ける'}</button>
      </div>
    </Dialog>
  )
}

/**
 * このPCの導入状況。入っていないもの、権限のために起動できないものを並べ、直し方をお見せします。
 * 権限の修正は、起動と同じようにメインプロセスのネイティブの確認を経てから行います。
 */
export function SetupPanel() {
  const { notify, bump } = useStore()
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<SetupFixPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const { data, error, loading } = useAsync<SetupReport>(() => api.setupReport(), [tick])

  const reload = () => setTick((n) => n + 1)

  const startFix = async () => {
    setPlanning(true)
    try {
      setPlan(await api.setupFixPlan())
    } catch (e) {
      notify(String((e as Error).message))
    } finally {
      setPlanning(false)
    }
  }

  if (error) return <div className="card run-setup"><div className="banner error"><p className="banner-text">{error}</p></div></div>
  if (!data) return <div className="card run-setup"><div className="empty">{loading ? 'このPCの状態を調べています…' : ''}</div></div>

  const { ok, missing, unsafe } = data.counts
  const shown = open ? data.programs : data.programs.filter((p) => p.state !== 'ok')

  return (
    <div className="card run-setup">
      <div className="card-head">
        <span className="card-title">このPCの状態</span>
        <div className="run-head-actions">
          <span className="tag verdict ok">{`使える ${ok}`}</span>
          {missing > 0 && <span className="tag verdict">{`入っていない ${missing}`}</span>}
          {unsafe > 0 && <span className="tag verdict ng">{`実行不可 ${unsafe}`}</span>}
          <button className="btn quiet small" onClick={reload} disabled={loading}>もう一度調べる</button>
        </div>
      </div>

      {unsafe > 0 && (
        <div className="banner warn">
          <div>
            <p className="banner-text">
              <b>{`${unsafe} 個のコマンドが、ほかのユーザーも書き換えられる場所にあります。`}</b>
              {' 置き換えられた中身をそのまま実行してしまわないように、SecOwl は起動しません。'}
              {data.fixable > 0 ? `アプリから ${data.fixable} 件の権限を直せます。` : '直し方は下のコマンドをお使いください。'}
            </p>
            {data.fixable > 0 && (
              <div className="banner-actions">
                <button className="btn small" onClick={() => void startFix()} disabled={planning}>{planning ? '調べています…' : '権限を直す'}</button>
              </div>
            )}
            {data.fixes.filter((f) => !f.can).map((f) => <CommandLine key={f.path} value={f.command} note={f.why ?? undefined} />)}
          </div>
        </div>
      )}

      {missing + unsafe === 0 ? (
        <p className="setup-lead">{`${ok} 個のコマンドがすべて使えます。`}</p>
      ) : (
        <p className="setup-lead">入れ方は次のとおりです。ターミナルに写して実行し、「もう一度調べる」を押してください。Homebrew が無い場合は、Go の行でも入ります。</p>
      )}

      <div className="setup-list">{shown.map((p) => <ProgramRow key={p.program} p={p} />)}</div>

      {ok > 0 && (
        <button className="btn quiet small setup-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '使えるものを隠す' : `使えるもの（${ok} 件）も見る`}
        </button>
      )}

      {plan && (
        <FixDialog
          plan={plan}
          onClose={() => setPlan(null)}
          onDone={(msg) => { setPlan(null); notify(msg); reload(); bump() }}
        />
      )}
    </div>
  )
}
