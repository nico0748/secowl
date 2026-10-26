import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Dialog } from './Dialog'
import type { InstallPlan, SetupFixPlan, SetupInstaller, SetupJob, SetupProgram, SetupReport, SetupStepStatus, WordlistFile, WordlistPlan, WordlistReport } from '../types'

/** コマンドを 1 行で見せ、クリップボードへ写せるようにします。 */
function CommandLine({ value, note, children }: { value: string; note?: string; children?: React.ReactNode }) {
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
      {children}
    </div>
  )
}

const STATE_LABEL: Record<SetupProgram['state'], string> = { ok: '使える', missing: '入っていない', unsafe: '実行不可' }
const STATE_CLASS: Record<SetupProgram['state'], string> = { ok: 'ok', missing: '', unsafe: 'ng' }
const STEP_LABEL: Record<SetupStepStatus, string> = {
  pending: '待っています', running: '進めています', done: '終わりました', failed: '失敗しました', stopped: '中止しました', timeout: '時間切れ',
}
const STEP_CLASS: Record<SetupStepStatus, string> = { pending: '', running: '', done: 'ok', failed: 'ng', stopped: 'warn', timeout: 'warn' }

function ProgramRow({ p, onInstall, busy }: {
  p: SetupProgram
  onInstall: (program: string, via: 'brew' | 'go') => void
  busy: boolean
}) {
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
          {p.install.brew && (
            <CommandLine value={p.install.brew} note="Homebrew">
              <button className="btn small" onClick={() => onInstall(p.program, 'brew')} disabled={busy}>これを入れる</button>
            </CommandLine>
          )}
          {p.install.go && (
            <CommandLine value={p.install.go} note="Go">
              <button className="btn small" onClick={() => onInstall(p.program, 'go')} disabled={busy}>これを入れる</button>
            </CommandLine>
          )}
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

/** 入れる前の確認。押すと、さらにデスクトップ版のネイティブの確認が出ます。 */
function InstallDialog({ plan, onClose, onStarted }: {
  plan: InstallPlan
  onClose: () => void
  onStarted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }) }, [])

  const go = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await api.installStart(plan.planId)
      if (res.ok) { onStarted(); return }
      if (res.cancelled) { onClose(); return }
      setErr(res.error || '始められませんでした。')
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="入れる前の確認" onClose={onClose} wide>
      <p className="dialog-text">{`${plan.viaLabel} で ${plan.steps.length} 個のツールを入れます。次のコマンドを順に実行します。`}</p>
      <div className="setup-fix-list">
        {plan.steps.map((s) => <div key={s.program} className="setup-fix-row"><code>{s.command}</code></div>)}
      </div>
      <dl className="run-facts">
        <dt>実行ファイル</dt>
        <dd><code>{plan.installerPath}</code></dd>
        <dt>通信</dt>
        <dd>配布元からソフトウェアを取得します（診断対象には接続しません）。</dd>
      </dl>
      {err && <div className="banner error"><p className="banner-text">{err}</p></div>}
      <p className="hint-text">「入れる」を押すと、同じ内容がもう一度 OS の確認ダイアログに出ます。そこで許可するまで、何も始まりません。</p>
      <div className="dialog-actions">
        <button ref={cancelRef} className="btn quiet" onClick={onClose} disabled={busy}>キャンセル</button>
        <button className="btn" onClick={() => void go()} disabled={busy}>{busy ? '確認を待っています…' : '入れる'}</button>
      </div>
    </Dialog>
  )
}

/** 時間のかかる作業（導入・ワードリストの取得）の進み具合と出力。 */
function JobProgress({ job, onStop, onClose }: { job: SetupJob; onStop: () => void; onClose: () => void }) {
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight }, [job.output])
  const running = job.status === 'running'
  const okCount = job.steps.filter((s) => s.status === 'done').length
  const ngCount = job.steps.filter((s) => s.status === 'failed' || s.status === 'timeout').length

  return (
    <div className="setup-install">
      <div className="setup-row-head">
        <span className="setup-name">{running ? job.title : job.title.replace(/しています$/, 'しました')}</span>
        <span className="tag verdict ok">{`終わりました ${okCount}`}</span>
        {ngCount > 0 && <span className="tag verdict ng">{`失敗 ${ngCount}`}</span>}
        <div className="run-head-actions">
          {running
            ? <button className="btn quiet small" onClick={onStop}>中止する</button>
            : <button className="btn quiet small" onClick={onClose}>閉じる</button>}
        </div>
      </div>
      <div className="setup-steps">
        {job.steps.map((s) => (
          <div key={s.key} className="setup-step">
            <code>{s.command ?? s.label}</code>
            <span className={`tag verdict ${STEP_CLASS[s.status]}`}>{STEP_LABEL[s.status]}</span>
            {s.error && <span className="setup-cmd-note">{s.error}</span>}
          </div>
        ))}
      </div>
      <pre className="run-output" ref={box} aria-label="作業の出力">{job.output || '出力を待っています…'}</pre>
    </div>
  )
}

const WL_LABEL: Record<WordlistFile['state'], string> = { ok: 'あります', missing: 'ありません', changed: '中身が違います', other: '確かめられません' }
const WL_CLASS: Record<WordlistFile['state'], string> = { ok: 'ok', missing: '', changed: 'warn', other: 'warn' }
const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('ja-JP')} KB`

/** 取得する前の確認。押すと、さらにデスクトップ版のネイティブの確認が出ます。 */
function WordlistDialog({ plan, onClose, onStarted }: {
  plan: WordlistPlan
  onClose: () => void
  onStarted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }) }, [])

  const go = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await api.wordlistStart(plan.planId)
      if (res.ok) { onStarted(); return }
      if (res.cancelled) { onClose(); return }
      setErr(res.error || '始められませんでした。')
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="取得する前の確認" onClose={onClose} wide>
      <p className="dialog-text">
        {plan.full
          ? `${plan.source.name}（タグ ${plan.source.tag}）の全体を取得します。1GB 以上になります。`
          : `${plan.files.length} 本のワードリストを取得します。取ったあとに中身のハッシュを照合し、合わなければ保存しません。`}
      </p>
      <div className="setup-fix-list">
        {plan.files.map((f) => <div key={f.id} className="setup-fix-row"><code>{f.url}</code><span className="setup-fix-mode">{kb(f.bytes)}</span></div>)}
        {plan.full && <div className="setup-fix-row"><code>{plan.full.command}</code></div>}
      </div>
      <dl className="run-facts">
        <dt>置き場所</dt>
        <dd><code>{plan.full ? plan.full.dir : plan.dir}</code></dd>
        <dt>出どころ</dt>
        <dd>{plan.source.name}（{plan.source.repo}、タグ {plan.source.tag}）</dd>
      </dl>
      {err && <div className="banner error"><p className="banner-text">{err}</p></div>}
      <p className="hint-text">「取得する」を押すと、同じ内容がもう一度 OS の確認ダイアログに出ます。そこで許可するまで、何も始まりません。</p>
      <div className="dialog-actions">
        <button ref={cancelRef} className="btn quiet" onClick={onClose} disabled={busy}>キャンセル</button>
        <button className="btn" onClick={() => void go()} disabled={busy}>{busy ? '確認を待っています…' : '取得する'}</button>
      </div>
    </Dialog>
  )
}

/** 探索用ワードリスト。ホームフォルダの wordlists/ に置きます。 */
function WordlistSection({ data, busy, onGet }: {
  data: WordlistReport
  busy: boolean
  onGet: (input: { ids?: string[]; full?: boolean }) => void
}) {
  const need = data.files.filter((f) => f.state !== 'ok').map((f) => f.id)
  return (
    <div className="setup-wordlists">
      <div className="setup-row-head">
        <span className="setup-name">ワードリスト</span>
        {need.length === 0
          ? <span className="tag verdict ok">そろっています</span>
          : <span className="tag verdict">{`ありません ${need.length}`}</span>}
        <span className="setup-path">{data.dir}</span>
        <div className="run-head-actions">
          {need.length > 0 && (
            <button className="btn small" onClick={() => onGet({ ids: need })} disabled={busy}>{`${need.length} 本を取得する`}</button>
          )}
          {!data.full.present && (
            <button className="btn quiet small" onClick={() => onGet({ full: true })} disabled={busy}>SecLists 全体も取得する</button>
          )}
        </div>
      </div>
      <p className="setup-why">
        {`${data.source.name}（${data.source.license}、タグ ${data.source.tag}）から取ります。取ったあとに中身のハッシュを照合します。`}
        {data.full.present ? ` 全体は ${data.full.dir} にあります。` : ' 全体（1GB 以上）は、必要になってからで十分です。'}
      </p>
      <div className="setup-steps">
        {data.files.map((f) => (
          <div key={f.id} className="setup-step">
            <code>{f.saveAs}</code>
            <span className={`tag verdict ${WL_CLASS[f.state]}`}>{WL_LABEL[f.state]}</span>
            <span className="setup-cmd-note">{`${f.name}・${f.lines.toLocaleString('ja-JP')} 行・${f.use}`}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function InstallerRow({ i }: { i: SetupInstaller }) {
  return (
    <div className="setup-row">
      <div className="setup-row-head">
        <code className="setup-name">{i.label}</code>
        <span className={`tag verdict ${STATE_CLASS[i.state]}`}>{STATE_LABEL[i.state]}</span>
        {i.state === 'ok' && i.path && <span className="setup-path">{i.path}</span>}
      </div>
      {i.state !== 'ok' && <p className="setup-why">{i.hint ?? i.reason}</p>}
    </div>
  )
}

/**
 * このPCの導入状況。入っていないもの、権限のために起動できないものを並べ、入れ方をお見せします。
 * 権限の修正と導入の実行は、起動と同じようにメインプロセスのネイティブの確認を経てから行います。
 */
export function SetupPanel() {
  const { notify, bump } = useStore()
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState(false)
  const [fixPlan, setFixPlan] = useState<SetupFixPlan | null>(null)
  const [insPlan, setInsPlan] = useState<InstallPlan | null>(null)
  const [wlPlan, setWlPlan] = useState<WordlistPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [job, setJob] = useState<SetupJob | null>(null)
  const { data, error, loading } = useAsync<SetupReport>(() => api.setupReport(), [tick])
  const { data: wl } = useAsync<WordlistReport>(() => api.wordlists(), [tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])

  // 画面を開き直したあとも、動いている導入を拾えるようにします。
  useEffect(() => { void api.setupJob().then(setJob).catch(() => { /* まだありません */ }) }, [])

  // 動いているあいだだけ、少しずつ状態を見に行きます。
  const running = job?.status === 'running'
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => {
      void api.setupJob().then((j) => {
        setJob(j)
        if (j && j.status !== 'running') {
          const ok = j.steps.filter((s) => s.status === 'done').length
          const ng = j.steps.length - ok
          const what = j.kind === 'setup.wordlists' ? 'ワードリスト' : 'ツール'
          notify(ng > 0 ? `${ok} 件の${what}を取り終え、${ng} 件は失敗しました。` : `${ok} 件の${what}を用意しました。`)
          reload()
          bump()
        }
      }).catch(() => { /* 次の回で拾います */ })
    }, 800)
    return () => window.clearInterval(t)
  }, [running, notify, reload, bump])

  const startFix = async () => {
    setPlanning(true)
    try {
      setFixPlan(await api.setupFixPlan())
    } catch (e) {
      notify(String((e as Error).message))
    } finally {
      setPlanning(false)
    }
  }

  const startInstall = async (programs: string[], via: 'brew' | 'go') => {
    setPlanning(true)
    try {
      setInsPlan(await api.installPlan({ programs, via }))
    } catch (e) {
      notify(String((e as Error).message))
    } finally {
      setPlanning(false)
    }
  }

  const startWordlists = async (input: { ids?: string[]; full?: boolean }) => {
    setPlanning(true)
    try {
      setWlPlan(await api.wordlistPlan(input))
    } catch (e) {
      notify(String((e as Error).message))
    } finally {
      setPlanning(false)
    }
  }

  const stop = async () => {
    try {
      setJob(await api.setupJobStop(job!.jobId))
    } catch (e) {
      notify(String((e as Error).message))
    }
  }

  if (error) return <div className="card run-setup"><div className="banner error"><p className="banner-text">{error}</p></div></div>
  if (!data) return <div className="card run-setup"><div className="empty">{loading ? 'このPCの状態を調べています…' : ''}</div></div>

  const { ok, missing, unsafe } = data.counts
  const shown = open ? data.programs : data.programs.filter((p) => p.state !== 'ok')
  const byVia = (via: 'brew' | 'go') => data.programs.filter((p) => p.state === 'missing' && p.install[via]).map((p) => p.program)
  const usable = (via: 'brew' | 'go') => data.installers.find((i) => i.name === via)?.state === 'ok'
  const busy = planning || running

  return (
    <div className="card run-setup">
      <div className="card-head">
        <span className="card-title">このPCの状態</span>
        <div className="run-head-actions">
          <span className="tag verdict ok">{`使える ${ok}`}</span>
          {missing > 0 && <span className="tag verdict">{`入っていない ${missing}`}</span>}
          {unsafe > 0 && <span className="tag verdict ng">{`実行不可 ${unsafe}`}</span>}
          <button className="btn quiet small" onClick={reload} disabled={loading || running}>もう一度調べる</button>
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
                <button className="btn small" onClick={() => void startFix()} disabled={busy}>{planning ? '調べています…' : '権限を直す'}</button>
              </div>
            )}
            {data.fixes.filter((f) => !f.can).map((f) => <CommandLine key={f.path} value={f.command} note={f.why ?? undefined} />)}
          </div>
        </div>
      )}

      {job && <JobProgress job={job} onStop={() => void stop()} onClose={() => setJob(null)} />}

      {missing + unsafe === 0 ? (
        <p className="setup-lead">{`${ok} 個のコマンドがすべて使えます。`}</p>
      ) : (
        <>
          <p className="setup-lead">
            入っていないものは、SecOwl から入れられます。入れる前に、実行するコマンドと実行ファイルの場所をお見せします。
            ターミナルで入れたい場合は、下のコマンドをお使いください。
          </p>
          {(usable('brew') || usable('go')) && (
            <div className="setup-actions">
              {usable('brew') && byVia('brew').length > 0 && (
                <button className="btn" onClick={() => void startInstall(byVia('brew'), 'brew')} disabled={busy}>
                  {`Homebrew でまとめて入れる（${byVia('brew').length} 件）`}
                </button>
              )}
              {usable('go') && byVia('go').length > 0 && (
                <button className="btn quiet" onClick={() => void startInstall(byVia('go'), 'go')} disabled={busy}>
                  {`Go でまとめて入れる（${byVia('go').length} 件）`}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <div className="setup-list">
        {shown.map((p) => (
          <ProgramRow key={p.program} p={p} busy={busy} onInstall={(program, via) => void startInstall([program], via)} />
        ))}
      </div>

      {wl && <WordlistSection data={wl} busy={busy} onGet={(input) => void startWordlists(input)} />}

      <div className="setup-foot">
        {ok > 0 && (
          <button className="btn quiet small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? '使えるものを隠す' : `使えるもの（${ok} 件）も見る`}
          </button>
        )}
      </div>

      {open && <div className="setup-list setup-installers">{data.installers.map((i) => <InstallerRow key={i.name} i={i} />)}</div>}

      {fixPlan && (
        <FixDialog
          plan={fixPlan}
          onClose={() => setFixPlan(null)}
          onDone={(msg) => { setFixPlan(null); notify(msg); reload(); bump() }}
        />
      )}
      {wlPlan && (
        <WordlistDialog
          plan={wlPlan}
          onClose={() => setWlPlan(null)}
          onStarted={() => { setWlPlan(null); void api.setupJob().then(setJob).catch(() => { /* 次の回で拾います */ }) }}
        />
      )}
      {insPlan && (
        <InstallDialog
          plan={insPlan}
          onClose={() => setInsPlan(null)}
          onStarted={() => { setInsPlan(null); void api.setupJob().then(setJob).catch(() => { /* 次の回で拾います */ }) }}
        />
      )}
    </div>
  )
}
