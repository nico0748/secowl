import { spawn } from 'node:child_process'
import { cleanLine, ExecError } from './exec.js'
import { appendSetupAudit } from './setup-audit.js'

/**
 * 環境構築の、時間のかかる作業を 1 本ずつ動かす仕組み（S6）。
 *
 * ツールの導入（brew / go install）とワードリストの取得が、どちらもこれを使います。
 * 同時に動くのは 1 件だけで、画面は `current()` を少しずつ見に来ます。
 *
 * 1 つの手順は、どちらかの形です。
 *   - `spawn`: 実行ファイルを引数の配列で動かす（シェルは使いません）
 *   - `run`:   こちらのコードでやる仕事（ファイルの取得など）
 */

const MAX_OUTPUT_CHARS = 300 * 1024
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000
const KILL_GRACE_MS = 3000
export const JOB_ID_RE = /^(ins|wl)-\d{13}-[0-9a-f]{8}$/

export function createJobRunner(opts = {}) {
  const cfg = {
    now: opts.now || (() => new Date()),
    killGraceMs: opts.killGraceMs ?? KILL_GRACE_MS,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
  let job = null // 直近の 1 件だけ持ちます
  let child = null

  const busy = () => job?.status === 'running'

  function append(text) {
    if (!job) return
    job.output += text
    if (job.output.length > MAX_OUTPUT_CHARS) {
      job.dropped = true
      job.output = job.output.slice(job.output.length - MAX_OUTPUT_CHARS)
    }
  }

  /** 出力を 1 行ずつ整えて溜めます（端末の制御列と、\r の進捗の上書きを畳みます）。 */
  function reader(stream) {
    let rest = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      const parts = (rest + chunk).split('\n')
      rest = parts.pop() ?? ''
      for (const line of parts) append(`${cleanLine(line)}\n`)
      // 進捗の 1 行（改行が来ないもの）は、溜まりすぎないうちに畳んで出します
      if (rest.length > 4096) { append(`${cleanLine(rest)}\n`); rest = '' }
    })
    stream.on('end', () => { if (rest) append(`${cleanLine(rest)}\n`) })
  }

  /** プロセスの集まり（グループ）に終了を頼み、残っていたら止めます。 */
  function stopChild(proc) {
    const pgid = proc.pid
    const signal = (sig) => { try { process.kill(-pgid, sig) } catch { try { proc.kill(sig) } catch { /* もう終わっています */ } } }
    signal('SIGTERM')
    setTimeout(() => { if (!proc.killed && proc.exitCode === null) signal('SIGKILL') }, cfg.killGraceMs).unref?.()
  }

  /** 実行ファイルを動かし、終わるまで待ちます。 */
  function runSpawn(s) {
    const { program, argv, env, cwd } = s.spawn
    const timeoutMs = s.spawn.timeoutMs ?? cfg.timeoutMs
    return new Promise((resolve) => {
      let timer = null
      let killed = false
      const proc = spawn(program, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: true })
      child = proc
      reader(proc.stdout)
      reader(proc.stderr)
      const done = (patch) => {
        if (timer) clearTimeout(timer)
        child = null
        Object.assign(s, patch)
        resolve()
      }
      timer = setTimeout(() => {
        killed = true
        append(`\n[${Math.round(timeoutMs / 60000)} 分を過ぎたので止めます]\n`)
        stopChild(proc)
      }, timeoutMs)
      proc.on('error', (err) => done({ status: 'failed', error: String(err?.message || err) }))
      proc.on('close', (code, signal) => {
        if (killed) return done({ status: 'timeout', exitCode: code, error: '時間切れで止めました' })
        if (job?.stopping) return done({ status: 'stopped', exitCode: code, error: '中止しました' })
        if (code === 0) return done({ status: 'done', exitCode: 0 })
        done({ status: 'failed', exitCode: code, error: signal ? `${signal} で終わりました` : `終了コード ${code}` })
      })
    })
  }

  /** こちらのコードでやる仕事。中止を見られるよう、ctx を渡します。 */
  async function runWork(s) {
    try {
      await s.run({ append, stopping: () => !!job?.stopping })
      Object.assign(s, job?.stopping ? { status: 'stopped', error: '中止しました' } : { status: 'done' })
    } catch (err) {
      Object.assign(s, { status: 'failed', error: String(err?.message || err) })
    }
  }

  /**
   * 作業を始めます。待たずに返すので、呼ぶ側は current() を見に来ます。
   * @param {{ jobId: string, kind: string, title: string, steps: object[], audit?: object }} input
   */
  function start(input) {
    if (busy()) throw new ExecError(409, 'BUSY', 'いま別の作業が動いています')
    job = {
      jobId: input.jobId,
      kind: input.kind,
      title: input.title,
      steps: input.steps.map((s) => ({ ...s, status: 'pending', exitCode: null, error: null })),
      status: 'running',
      startedAt: cfg.now().toISOString(),
      endedAt: null,
      output: '',
      dropped: false,
      stopping: false,
    }
    appendSetupAudit(`${input.kind}.start`, { jobId: job.jobId, ...(input.audit || {}) }, cfg.now())

    void (async () => {
      for (const s of job.steps) {
        if (job.stopping) { s.status = 'stopped'; s.error = '中止しました'; continue }
        s.status = 'running'
        if (s.command) append(`\n$ ${s.command}\n`)
        if (s.spawn) await runSpawn(s)
        else await runWork(s)
      }
      job.status = job.stopping ? 'stopped' : job.steps.every((s) => s.status === 'done') ? 'done' : 'failed'
      job.endedAt = cfg.now().toISOString()
      appendSetupAudit(`${input.kind}.end`, {
        jobId: job.jobId, status: job.status,
        results: job.steps.map((s) => ({ key: s.key, status: s.status, exitCode: s.exitCode })),
      }, cfg.now())
    })()

    return { ok: true, jobId: job.jobId }
  }

  /** 中止。残りの手順も動かしません。 */
  function stop(jobId) {
    const id = String(jobId || '')
    if (!JOB_ID_RE.test(id) || !job || job.jobId !== id) throw new ExecError(404, 'NO_JOB', 'その作業はありません')
    if (job.status !== 'running') return current()
    job.stopping = true
    if (child) stopChild(child)
    return current()
  }

  /** 画面に見せる形。 */
  function current() {
    if (!job) return null
    return {
      jobId: job.jobId,
      kind: job.kind,
      title: job.title,
      status: job.status,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      steps: job.steps.map((s) => ({ key: s.key, label: s.label, command: s.command ?? null, status: s.status, exitCode: s.exitCode, error: s.error })),
      output: (job.dropped ? '[表示の上限を超えたため、先頭の出力を省略しました]\n' : '') + job.output,
    }
  }

  /** 終了時の後始末。動いているものがあれば止めます。 */
  async function killAll() {
    if (busy()) { job.stopping = true; if (child) stopChild(child) }
  }

  function configure(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in cfg)) throw new Error(`未知の設定です: ${k}`)
      cfg[k] = v
    }
  }

  return { start, stop, current, busy, killAll, configure }
}
