import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { execAvailable } from '../platform'
import { useAsync, useStore } from '../state'
import { Dialog } from '../components/Dialog'
import { SetupPanel } from '../components/SetupPanel'
import { NoEngagement } from './shared'
import type { ExecAudit, ExecCommand, ExecJob, ExecPlan, ExecStatus, ExecTool, ImportResult } from '../types'

// 画面に持つ出力の上限。超えたぶんは古い出力から捨てます（ツール実行ログには先頭と末尾を保存します）。
const MAX_VIEW_CHARS = 400_000
const MAX_RECONNECTS = 20

const STATUS_LABEL: Record<ExecStatus, string> = {
  running: '実行中', done: '完了', failed: '失敗', stopped: '停止', timeout: '時間切れ', interrupted: '中断',
}
const VERDICT_CLASS: Record<string, string> = { in: 'ok', allow: 'warn', out: 'ng', deny: 'ng', invalid: 'ng' }

const fmtTime = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const fmtDuration = (ms: number | null) => {
  if (ms === null || ms === undefined) return ''
  const s = Math.round(ms / 100) / 10
  if (s < 60) return `${s.toFixed(1)} 秒`
  return `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`
}

export function RunPage() {
  const { current } = useStore()
  if (!current) return <NoEngagement />
  if (!execAvailable()) {
    return (
      <>
        <div className="page-head"><h1>実行</h1></div>
        <div className="card">
          <p className="dialog-text"><b>この機能はデスクトップ版でのみ使えます。</b></p>
          <p className="hint-text">コマンドの実行は、SecOwl のデスクトップ版（Electron）から、実行前にネイティブの確認ダイアログを経て行います。ブラウザで開いた画面からは実行できません。</p>
        </div>
      </>
    )
  }
  return <RunInner eid={current.id} />
}

function StatusTag({ status }: { status: ExecStatus }) {
  const cls = status === 'failed' || status === 'interrupted' ? 'run-failed' : status === 'timeout' || status === 'stopped' ? 'warn' : status === 'running' ? 'run-running' : ''
  return <span className={`tag status-pill run-status ${cls}`}>{STATUS_LABEL[status] ?? status}</span>
}

function RunInner({ eid }: { eid: string }) {
  const { notify, bump, revision } = useStore()
  const [params, setParams] = useSearchParams()
  // 権限を直したあとは使えるコマンドが変わるので、revision で読み直します。
  const { data: tools, error: toolsError, loading } = useAsync(() => api.execTemplates(), [revision])
  const { data: surfaces } = useAsync(() => api.surfaces(eid), [eid, revision])
  const { data: history, reload: reloadHistory } = useAsync(() => api.execJobs(eid), [eid, revision])

  const all = useMemo(() => (tools ?? []).flatMap((t) => t.commands.map((c) => ({ tool: t, cmd: c }))), [tools])
  const slug = params.get('slug') || ''
  const cmdId = params.get('cmd') || ''
  const picked = all.find((x) => x.tool.slug === slug && x.cmd.id === cmdId) ?? all.find((x) => x.cmd.available) ?? all[0] ?? null

  const [values, setValues] = useState<Record<string, string>>({})
  const [formErr, setFormErr] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState<ExecPlan | null>(null)

  // コマンドを切り替えたら、入力を既定値と URL の target から作り直します。
  const pickedKey = picked ? `${picked.tool.slug}/${picked.cmd.id}` : ''
  useEffect(() => {
    if (!picked) return
    const init: Record<string, string> = {}
    for (const v of picked.cmd.vars) {
      init[v.name] = v.kind === 'target' ? params.get('target') || '' : v.default ?? ''
    }
    setValues(init)
    setFormErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey])

  const choose = (t: ExecTool, c: ExecCommand) => {
    const next = new URLSearchParams(params)
    next.set('slug', t.slug)
    next.set('cmd', c.id)
    setParams(next, { replace: true })
  }

  /* ---------------- 出力（fetch のストリーム） ---------------- */

  const [active, setActive] = useState<ExecJob | null>(null)
  const [starting, setStarting] = useState(false)
  const [streamErr, setStreamErr] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const buf = useRef<string[]>([])
  const chars = useRef(0)
  const dropped = useRef(0)
  const lastSeq = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const timer = useRef<number | null>(null)

  const redraw = () => {
    if (timer.current !== null) return
    timer.current = window.setTimeout(() => { timer.current = null; setTick((n) => n + 1) }, 100)
  }
  const push = (text: string) => {
    buf.current.push(text)
    chars.current += text.length
    while (chars.current > MAX_VIEW_CHARS && buf.current.length > 1) {
      chars.current -= buf.current.shift()!.length
      dropped.current += 1
    }
    redraw()
  }

  const attach = useCallback(async (jobId: string) => {
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    buf.current = []; chars.current = 0; dropped.current = 0; lastSeq.current = 0
    setStreamErr(null)
    setActive(null)
    let reconnects = 0
    for (;;) {
      let ended = false
      try {
        await api.execStream(eid, jobId, {
          after: lastSeq.current,
          signal: ac.signal,
          onEvent: (e) => {
            if (e.t === 'start') setActive(e.job)
            else if (e.t === 'c') { push(e.x); lastSeq.current = e.seq }
            else if (e.t === 'gap') push('[出力の一部は、読み込みが追いつかず省略されました]\n')
            else if (e.t === 'end') { ended = true; setActive(e.job) }
          },
        })
      } catch (err) {
        if (ac.signal.aborted) return
        if (++reconnects > MAX_RECONNECTS) { setStreamErr(String((err as Error).message)); break }
        await new Promise((r) => setTimeout(r, 800))
        continue
      }
      if (ac.signal.aborted) return
      if (ended) break
      if (++reconnects > MAX_RECONNECTS) { setStreamErr('出力の読み込みが途中で切れました'); break }
      await new Promise((r) => setTimeout(r, 300))
    }
    setTick((n) => n + 1)
    reloadHistory()
    bump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid])

  useEffect(() => () => { abort.current?.abort(); if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  // 診断対象を切り替えたら、前の対象の出力は閉じます。
  useEffect(() => { abort.current?.abort(); setActive(null); buf.current = []; chars.current = 0; dropped.current = 0 }, [eid])

  /* ---------------- 実行前の確認 ---------------- */

  const startPlan = async () => {
    if (!picked) return
    setFormErr(null)
    for (const v of picked.cmd.vars) {
      if (!(values[v.name] ?? '').trim() && !v.default) { setFormErr(`「${v.label || v.name}」を入力してください`); return }
    }
    setPlanning(true)
    try {
      const res = await api.execPlan(eid, { slug: picked.tool.slug, cmdId: picked.cmd.id, values })
      setPlan(res)
    } catch (e) {
      setFormErr(String((e as Error).message))
    } finally {
      setPlanning(false)
    }
  }

  const launch = async (p: ExecPlan): Promise<string | null> => {
    const r = await api.execLaunch(eid, p.planId)
    if (r.ok) {
      setPlan(null)
      setStarting(true)
      void attach(r.jobId).finally(() => setStarting(false))
      reloadHistory() // 実行中の行も、履歴にすぐ出す
      notify(`${p.program} を実行しました`)
      return null
    }
    if (r.cancelled) { setPlan(null); notify('キャンセルしました。実行していません'); return null }
    return r.error || '起動できませんでした'
  }

  const stop = async () => {
    if (!active) return
    try { await api.execStop(eid, active.id) } catch (e) { notify(String((e as Error).message)) }
  }

  /* ---------------- 取り込み ---------------- */

  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importErr, setImportErr] = useState<string | null>(null)
  useEffect(() => { setPreview(null); setImportErr(null) }, [active?.id])

  const runImport = async (dryRun: boolean) => {
    if (!active) return
    setImportBusy(true)
    setImportErr(null)
    try {
      const res = await api.execImport(eid, active.id, { dryRun })
      setPreview(res)
      if (!dryRun) {
        notify(`取り込みました（サーフェス ${res.surfaces.created.length} 件を追加）`)
        bump()
        const job = await api.execJobs(eid).then((l) => l.find((j) => j.id === active.id))
        if (job) setActive(job)
      }
    } catch (e) {
      setImportErr(String((e as Error).message))
    } finally {
      setImportBusy(false)
    }
  }

  /* ---------------- 実行の記録（監査）の検証 ---------------- */

  const [audit, setAudit] = useState<ExecAudit | null>(null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditErr, setAuditErr] = useState<string | null>(null)
  useEffect(() => { setAudit(null); setAuditErr(null) }, [eid])
  const verifyAudit = async () => {
    setAuditBusy(true)
    setAuditErr(null)
    try { setAudit(await api.execAudit(eid)) } catch (e) { setAuditErr(String((e as Error).message)) } finally { setAuditBusy(false) }
  }

  /* ---------------- 経過時間 ---------------- */

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (active?.status !== 'running') return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active?.status])

  if (toolsError) return <div className="banner error">{toolsError}</div>
  if (loading || !tools) return <div className="empty">読み込んでいます…</div>

  const live = active?.status === 'running'
  const text = (dropped.current ? '[表示の上限を超えたため、先頭の出力を省略しました。ツール実行ログには、先頭と末尾（それぞれ約 100KB）を保存します]\n' : '') + buf.current.join('')
  const surfaceValues = [...new Set((surfaces ?? []).map((s) => s.value).filter(Boolean))].slice(0, 200)

  return (
    <>
      <div className="page-head">
        <h1>実行</h1>
        <span className="tag">{all.length} コマンド</span>
        <div className="spacer" />
        <Link className="btn quiet" to="/scope">スコープ設定</Link>
      </div>
      <p className="run-lead">{'用意したコマンドのテンプレートから、許可したプログラムだけを起動します。実行の前に、対象がスコープの内側か、書面の承認と診断期間がそろっているかを確認し、引数を 1 つずつお見せします。実行した内容は、ツール実行ログと実行の記録（監査）に残ります。'}</p>

      <SetupPanel />

      <div className="run-layout">
        <div className="card run-pick">
          <div className="card-head"><span className="card-title">コマンド</span></div>
          {tools.length === 0 ? <div className="empty">実行できるテンプレートがありません。</div> : tools.map((t) => (
            <div key={t.slug} className="run-group">
              <h3>{t.name}</h3>
              {t.commands.map((c) => {
                const on = picked?.tool.slug === t.slug && picked.cmd.id === c.id
                return (
                  <button key={c.id} type="button" className={`run-cmd${on ? ' on' : ''}`} aria-pressed={on} onClick={() => choose(t, c)}>
                    <span className="run-cmd-label">{c.label}</span>
                    <span className="run-cmd-sub">
                      <code>{c.program}</code>
                      {!c.available && <span className="tag run-missing">{c.unavailableKind === 'unsafe' ? '実行不可' : '未インストール'}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="card">
          {!picked ? <div className="empty">コマンドを選んでください。</div> : (
            <>
              <div className="card-head">
                <span className="card-title">{picked.tool.name} — 条件</span>
                <span className="card-note">{`${picked.cmd.timeout_sec} 秒で打ち切り`}</span>
              </div>
              <p className="run-cmd-title">{picked.cmd.label}</p>
              {!picked.cmd.available && (
                <div className="banner warn"><p className="banner-text">{picked.cmd.unavailableReason}</p></div>
              )}
              {formErr && <div className="banner error"><p className="banner-text">{formErr}</p></div>}
              <form onSubmit={(e) => { e.preventDefault(); void startPlan() }}>
                {picked.cmd.vars.map((v) => (
                  <div className="field" key={v.name}>
                    <label htmlFor={`rv-${v.name}`}>{v.label || v.name}{v.required && <span className="req">（必須）</span>}</label>
                    <input
                      id={`rv-${v.name}`}
                      type="text"
                      value={values[v.name] ?? ''}
                      onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
                      list={v.kind === 'target' ? 'run-targets' : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={v.kind === 'target' ? 'app.example.com' : v.kind === 'ports' ? '80,443,8000-8100' : ''}
                    />
                    {v.hint && <span className="hint">{v.hint}</span>}
                  </div>
                ))}
                <datalist id="run-targets">{surfaceValues.map((s) => <option key={s} value={s} />)}</datalist>
                <div className="dialog-actions">
                  <button className="btn" type="submit" disabled={planning || !picked.cmd.available || starting || live}>
                    {planning ? '確認しています…' : '実行前の確認'}
                  </button>
                </div>
                <p className="run-note">{'生の出力ファイル（取得データ/ の中）は伏せ字にしていません。Cookie やトークンが含まれることがあるため、Git では追跡しません。ツール実行ログに保存する本文だけを、伏せ字にしてから書きます。'}</p>
              </form>
            </>
          )}
        </div>
      </div>

      {(active || starting) && (
        <div className="card run-live">
          <div className="card-head">
            <span className="card-title">出力</span>
            {active && <StatusTag status={active.status} />}
            {active && <span className="run-cmdline"><code>{active.program}</code> → <code>{active.target}</code></span>}
            <span className="card-note">
              {active ? (live ? `経過 ${fmtDuration(Math.max(0, now - new Date(active.startedAt).getTime()))}` : fmtDuration(active.durationMs)) : ''}
            </span>
            {live && <button className="btn quiet small" onClick={stop}>停止</button>}
          </div>
          {streamErr && <div className="banner error"><p className="banner-text">{streamErr}</p></div>}
          <OutputView text={text} follow={!!live} empty={starting && !active ? '起動しています…' : live ? '出力を待っています…' : active?.logId ? '画面に残っている出力はありません。保存した本文は、ツール実行ログで確認できます。' : '出力はありませんでした。'} />
          {active && !live && (
            <div className="run-done">
              <p className="run-done-line">
                {active.status === 'done' && '完了しました。'}
                {active.status === 'failed' && `失敗しました（終了コード ${active.exitCode ?? active.signal ?? '不明'}）。`}
                {active.status === 'stopped' && '停止しました。'}
                {active.status === 'timeout' && `時間切れ（${active.timeoutSec} 秒）で止めました。`}
                {active.status === 'interrupted' && 'アプリが終了したため、途中で中断されています。'}
                {active.logId
                  ? <> <Link to={`/survey/logs/${active.logId}`}>ツール実行ログを開く</Link>（伏せ字にして保存済み）</>
                  : ` ツール実行ログを作れませんでした${active.logError ? `（${active.logError}）` : ''}。`}
              </p>
              {active.outFormat && active.outFile && (
                <div className="run-import">
                  {active.imported ? (
                    <p className="run-done-line">取り込み済みです（サーフェス {active.imported.surfaces} 件・発見事項 {active.imported.findings} 件を追加）。</p>
                  ) : (
                    <>
                      <button className="btn secondary" onClick={() => runImport(true)} disabled={importBusy}>取り込みをプレビュー</button>
                      <span className="hint">出力ファイルを、既存のツール出力の取り込みと同じ処理で読みます。確認するまで書き込みません。</span>
                    </>
                  )}
                  {importErr && <div className="banner error"><p className="banner-text">{importErr}</p></div>}
                  {preview && !active.imported && (
                    <div className="run-preview">
                      <p>
                        形式: <b>{preview.formatLabel}</b>　サーフェス 新規 {preview.surfaces.created.length} 件・更新 {preview.surfaces.updated.length} 件・変更なし {preview.surfaces.unchanged} 件
                        発見事項 新規 {preview.findings.created.length} 件
                      </p>
                      {preview.surfaces.created.length > 0 && (
                        <ul>{preview.surfaces.created.slice(0, 8).map((s) => <li key={s.value}>{s.kind_label}: {s.value}</li>)}{preview.surfaces.created.length > 8 && <li>ほか {preview.surfaces.created.length - 8} 件</li>}</ul>
                      )}
                      {preview.dryRun && <button className="btn" onClick={() => runImport(false)} disabled={importBusy}>取り込む</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">実行の履歴</span>
          <div className="run-head-actions">
            <span className="card-note">{history?.length ?? 0} 件</span>
            <button className="btn quiet small" onClick={() => void verifyAudit()} disabled={auditBusy}>{auditBusy ? '確認しています…' : '実行の記録を検証'}</button>
          </div>
        </div>
        {audit && (audit.ok ? (
          <p className="run-note">{audit.lines === 0 ? '実行の記録はまだありません。' : `実行の記録 ${audit.lines} 行は、前の行とのつながりが切れていません。`}</p>
        ) : (
          <div className="banner error"><p className="banner-text">{`実行の記録（audit.jsonl）の ${audit.brokenAt} 行目で、つながりが切れています。記録が書き換えられたか、途中が失われた可能性があります。`}</p></div>
        ))}
        {auditErr && <div className="banner error"><p className="banner-text">{auditErr}</p></div>}
        {!history || history.length === 0 ? <div className="empty">まだ実行していません。</div> : (
          <table className="table">
            <thead>
              <tr><th scope="col">コマンド</th><th scope="col">対象</th><th scope="col">開始</th><th scope="col">所要時間</th><th scope="col">終了コード</th><th scope="col">状態</th><th scope="col"><span className="visually-hidden">操作</span></th></tr>
            </thead>
            <tbody>
              {history.map((j) => (
                <tr key={j.id}>
                  <td><b>{j.toolName || j.program}</b><br /><span className="run-sub">{j.label}</span></td>
                  <td><code>{j.target}</code></td>
                  <td className="nowrap">{fmtTime(j.startedAt)}</td>
                  <td className="nowrap">{fmtDuration(j.durationMs)}</td>
                  <td className="nowrap">{j.exitCode ?? (j.signal || '')}</td>
                  <td className="col-status"><StatusTag status={j.status} /></td>
                  <td className="nowrap">
                    <div className="run-row-actions">
                      <button className="btn quiet small" onClick={() => void attach(j.id)}>出力</button>
                      {j.logId && <Link className="btn quiet small" to={`/survey/logs/${j.logId}`}>ログ</Link>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {plan && picked && (
        <ConfirmDialog
          plan={plan}
          onClose={() => setPlan(null)}
          onLaunch={launch}
          onReplan={async () => { setPlan(null); await startPlan() }}
        />
      )}
    </>
  )
}

/** 出力は、ページの HTML としては解釈せず、テキストとして置きます。 */
function OutputView({ text, follow, empty }: { text: string; follow: boolean; empty: string }) {
  const ref = useRef<HTMLPreElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && follow && stick.current) el.scrollTop = el.scrollHeight
  })
  return (
    <pre
      ref={ref}
      className="run-output"
      tabIndex={0}
      aria-label="コマンドの出力"
      aria-live="off"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
    >
      {text || <span className="run-output-empty">{empty}</span>}
    </pre>
  )
}

/** 実行できない理由ごとの、次の一手。理由の文だけで終わらせない。 */
function nextSteps(p: ExecPlan): string[] {
  const out: string[] = []
  if (p.scopeVerdict === 'deny') out.push('除外リスト（scope_deny）に入っている対象です。除外した理由を確かめてください。スコープを書き換えて回避することはしないでください。')
  else if (p.scopeVerdict === 'invalid') out.push('スコープ文書を読めていません。スコープ設定で、内容を直してください。')
  else if (p.scopeVerdict === 'out') out.push('この対象も診断してよい場合は、契約の範囲を確かめたうえで、スコープ設定に追加してください。')
  if (p.dns.blocked && p.scopeVerdict !== 'deny') out.push('名前解決の結果が除外の範囲に入っています。対象のホスト名が指す先を確かめてください。')
  if (!p.agreed) out.push('スコープ設定で、書面の承認（承認印・承認日・承認者）を記入してください。')
  if (!p.inPeriod) out.push('診断期間を確かめてください。期間外は実行できません。期間の入力が誤っているときは、スコープ設定で直せます。')
  if (p.programIssue === 'missing') out.push(`${p.program} をインストールしたあと、もう一度、実行前の確認を開いてください。`)
  if (p.programIssue === 'unsafe') out.push('理由に書かれた場所の権限を、自分だけが書き換えられる状態（chmod go-w）に直すか、別の場所に入れ直してください。')
  return out
}

function ConfirmDialog({ plan, onClose, onLaunch, onReplan }: {
  plan: ExecPlan
  onClose: () => void
  onLaunch: (p: ExecPlan) => Promise<string | null>
  onReplan: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const changed = !!err && /条件が変わりました|古くなりました/.test(err)
  const steps = plan.blocked ? nextSteps(plan) : []
  // 既定のフォーカスはキャンセル。autoFocus だと、背の高い確認で下までスクロールされ、上の理由の帯が見えなくなる。
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }) }, [])

  const go = async () => {
    setBusy(true)
    setErr(null)
    try {
      setErr(await onLaunch(plan))
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="実行前の確認" onClose={onClose} wide>
      {plan.blocked ? (
        <div className="banner error">
          <div>
            <p className="banner-text"><b>実行できません。</b>「実行」のボタンは押せません。{plan.reasons.length > 1 ? '次の理由があります。' : plan.reason}</p>
            {plan.reasons.length > 1 && <ul className="banner-list">{plan.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            {steps.length > 0 && (
              <>
                <p className="banner-text run-next"><b>次にすること</b></p>
                <ul className="banner-list">{steps.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </>
            )}
            <div className="banner-actions"><Link className="btn quiet small" to="/scope" onClick={onClose}>スコープ設定を開く</Link></div>
          </div>
        </div>
      ) : plan.warning || plan.dns.warning ? (
        <div className="banner warn"><div>
          {plan.warning && <p className="banner-text">{plan.warning}</p>}
          {plan.dns.warning && <p className="banner-text">{plan.dns.warning}</p>}
        </div></div>
      ) : null}
      {err && (
        <div className="banner error">
          <div>
            <p className="banner-text">{err}</p>
            {changed && <div className="banner-actions"><button className="btn quiet small" onClick={() => void onReplan()}>もう一度、確認する</button></div>}
          </div>
        </div>
      )}

      <dl className="run-facts">
        <dt>実行ファイル</dt>
        <dd>{plan.programPath ? <code>{plan.programPath}</code> : <span className="hint">見つかりません</span>}</dd>

        <dt>引数（{plan.argv.length} 個）</dt>
        <dd>
          <ol className="argv-list" aria-label="引数を 1 つずつ">
            {plan.argv.map((a, i) => (
              <li key={i}><span className="argv-n" aria-hidden="true">{i + 1}</span><code>{a}</code></li>
            ))}
          </ol>
          <span className="hint">1 行が 1 つの引数です。シェルを通さず、この並びのまま渡します。</span>
        </dd>

        <dt>対象</dt>
        <dd>
          <code>{plan.target}</code>
          {plan.inputTarget && <span className="hint">　入力した <code>{plan.inputTarget}</code> を、この形に直しました</span>}
        </dd>

        <dt>スコープの判定</dt>
        <dd>
          <span className={`tag verdict ${VERDICT_CLASS[plan.scopeVerdict] ?? 'ng'}`}>{plan.verdictLabel}</span>
          {plan.matched && <span className="run-matched">一致したパターン: <code>{plan.matched}</code></span>}
          <span className="hint run-reason">{plan.scopeReason}</span>
        </dd>

        <dt>名前解決</dt>
        <dd>
          {plan.dns.skipped ? <span className="hint">IP アドレスで指定されているため不要です</span>
            : plan.dns.addresses.length ? <code>{plan.dns.addresses.join('  ')}</code>
              : <span className="hint">解決できませんでした{plan.dns.error ? `（${plan.dns.error}）` : ''}</span>}
        </dd>

        <dt>書面の承認</dt>
        <dd><span className={`tag verdict ${plan.agreed ? 'ok' : 'ng'}`}>{plan.agreed ? '承認済み' : '承認がそろっていません'}</span></dd>

        <dt>診断期間</dt>
        <dd><span className={`tag verdict ${plan.inPeriod ? 'ok' : 'ng'}`}>{plan.inPeriod ? '期間内' : '期間外'}</span><span className="hint run-reason">{plan.periodReason}</span></dd>

        <dt>実行時間の上限</dt>
        <dd>{`${plan.timeoutSec} 秒（過ぎたら止めます）`}</dd>

        <dt>出力ファイル</dt>
        <dd>{plan.outPath ? <code>{plan.outPath}</code> : <span className="hint">ファイルには出力しません（画面とツール実行ログだけ）</span>}</dd>
      </dl>

      <div className="dialog-actions">
        <button ref={cancelRef} className="btn quiet" onClick={onClose}>キャンセル</button>
        <button className="btn" onClick={go} disabled={plan.blocked || busy || !plan.programPath}>
          {busy ? '確認を待っています…' : `${plan.program} を実行`}
        </button>
      </div>
      <p className="hint run-confirm-note">
        {plan.blocked
          ? '上の理由が残っているあいだ、「実行」は押せません。'
          : '「実行」を押すと、この画面とは別に、アプリ本体からもう一度だけ短い確認が出ます。'}
      </p>
    </Dialog>
  )
}
