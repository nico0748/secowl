import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { displayCommand, ExecError, writablePart } from './exec.js'
import { appendSetupAudit } from './setup-audit.js'
import { createJobRunner } from './setup-job.js'
import { DIR_NAME, FILES, FULL_DIR_NAME, SOURCE } from './wordlist-catalog.js'

/**
 * 探索用ワードリストの取得（S6）。
 *
 * ホームフォルダの `wordlists/` に置きます（ffuf・gobuster が受け付ける場所です）。
 * 取得するものと取得先は `wordlist-catalog.js` の固定表だけで、画面からは「どれを」しか渡せません。
 *
 *   - 取ったファイルは SHA-256 を照合してから置きます。合わなければ捨てます
 *   - 置くのは一時ファイルに書いてから付け替えるので、途中で止めても中途半端なものが残りません
 *   - SecLists 全体は `git clone --depth 1 --branch <タグ>` で取ります（git が中身のハッシュを確かめます）
 *   - 始めるのは Electron の IPC からだけです（ネイティブの確認つき）
 */

const PLAN_TTL_MS = 2 * 60 * 1000
const PLAN_ID_RE = /^wl-\d{13}-[0-9a-f]{8}$/
const FETCH_TIMEOUT_MS = 120 * 1000
const CLONE_TIMEOUT_MS = 30 * 60 * 1000
/** 画面に出す一覧の上限（置き場所に大量に置かれていても、画面が重くならないように）。 */
const MAX_LIST = 300
const LIST_EXT = new Set(['.txt', '.lst'])

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/**
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {() => Date} [opts.now]
 * @param {object} [opts.runner]        時間のかかる作業を動かす仕組み（導入と共有します）
 * @param {string} [opts.raw]           取得元（テストの差し替え用）
 * @param {string} [opts.repo]          SecLists 全体の取得元（テストの差し替え用）
 * @param {string[]} [opts.gitPaths]    git を探す場所
 * @param {typeof fetch} [opts.fetch]
 * @param {object[]} [opts.catalog]    取得するものの表（テストの差し替え用）
 */
export function createWordlists(opts = {}) {
  const cfg = {
    env: opts.env || process.env,
    now: opts.now || (() => new Date()),
    raw: opts.raw || SOURCE.raw,
    repo: opts.repo || SOURCE.repo,
    gitPaths: opts.gitPaths || null,
    fetch: opts.fetch || ((...a) => fetch(...a)),
    fetchTimeoutMs: opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS,
    catalog: opts.catalog || FILES,
  }
  const runner = opts.runner || createJobRunner({ now: cfg.now })
  const plans = new Map()

  const home = () => cfg.env.HOME || os.homedir()
  /** 置き場所（ホームフォルダ/wordlists）。 */
  const dir = () => path.join(home(), DIR_NAME)
  const fullDir = () => path.join(dir(), FULL_DIR_NAME)
  const gitPaths = () => cfg.gitPaths || ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

  function requirePosix() {
    if (process.platform === 'win32') throw new ExecError(501, 'UNSUPPORTED', 'ワードリストの取得は macOS / Linux の版でだけ使えます')
  }

  /* ---------------- いまの状態 ---------------- */

  /** 1 つのファイルの状態。あるなら中身のハッシュも照合します。 */
  function inspect(f) {
    const at = path.join(dir(), f.saveAs)
    const base = { id: f.id, name: f.name, use: f.use, saveAs: f.saveAs, path: at, bytes: f.bytes, lines: f.lines }
    let st
    try { st = fs.lstatSync(at) } catch { return { ...base, state: 'missing' } }
    if (!st.isFile()) return { ...base, state: 'other', reason: 'ファイルではないものが同じ名前で置かれています' }
    try {
      const got = sha256(fs.readFileSync(at))
      if (got !== f.sha256) return { ...base, state: 'changed', reason: '中身が、取得したときのものと違います' }
    } catch (e) {
      return { ...base, state: 'other', reason: String(e?.message || e) }
    }
    return { ...base, state: 'ok' }
  }

  /** このPCにあるワードリスト（実行の入力で選べるもの）。 */
  function available() {
    const root = dir()
    const out = []
    const walk = (at, depth) => {
      if (out.length >= MAX_LIST || depth > 3) return
      let items = []
      try { items = fs.readdirSync(at, { withFileTypes: true }) } catch { return }
      for (const e of items.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= MAX_LIST) return
        if (e.name.startsWith('.')) continue
        const full = path.join(at, e.name)
        if (e.isDirectory()) walk(full, depth + 1)
        else if (e.isFile() && LIST_EXT.has(path.extname(e.name).toLowerCase())) {
          let bytes = 0
          try { bytes = fs.statSync(full).size } catch { continue }
          out.push({ path: full, name: path.relative(root, full), bytes })
        }
      }
    }
    walk(root, 0)
    return out
  }

  /** ワードリストのまとまり全体の状態。 */
  function report() {
    requirePosix()
    let fullPresent = false
    try { fullPresent = fs.statSync(path.join(fullDir(), '.git')).isDirectory() } catch { /* ありません */ }
    const files = cfg.catalog.map(inspect)
    return {
      dir: dir(),
      source: { name: SOURCE.name, repo: SOURCE.repo, license: SOURCE.license, tag: SOURCE.tag },
      files,
      missing: files.filter((f) => f.state !== 'ok').length,
      full: { dir: fullDir(), present: fullPresent, command: displayCommand('git', ['clone', '--depth', '1', '--branch', SOURCE.tag, `${cfg.repo}.git`, fullDir()]) },
      available: available(),
    }
  }

  /* ---------------- git を探す ---------------- */

  function resolveGit() {
    for (const d of gitPaths()) {
      try {
        const candidate = path.join(d, 'git')
        const real = fs.realpathSync(candidate)
        if (!fs.statSync(real).isFile()) continue
        fs.accessSync(real, fs.constants.X_OK)
        const bad = writablePart(candidate) || writablePart(real)
        if (bad) return { found: true, path: real, unsafe: `git の置き場所をたどった途中の ${bad} が、ほかのユーザーも書き換えられる権限になっているため動かしません` }
        return { found: true, path: real }
      } catch { /* この場所には無い */ }
    }
    return { found: false, error: 'git が見つかりません' }
  }

  /* ---------------- 計画 ---------------- */

  /**
   * 取得する計画を立てます。どれを取るかだけを受け取り、取得先はこちらで決めます。
   * @param {{ ids?: string[], full?: boolean }} input
   */
  function plan(input = {}) {
    requirePosix()
    const full = input.full === true
    const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map(String))]
    if (!full && !ids.length) throw new ExecError(400, 'NO_FILE', '取得するワードリストを選んでください')

    const items = ids.map((id) => {
      const f = cfg.catalog.find((c) => c.id === id) || null
      if (!f) throw new ExecError(404, 'NO_FILE', `${id} は取得できるワードリストにありません`)
      return f
    })

    let git = null
    if (full) {
      const r = resolveGit()
      if (!r.found) throw new ExecError(409, 'NO_GIT', 'git が見つかりません。Xcode のコマンドラインツール（macOS）を入れてください')
      if (r.unsafe) throw new ExecError(409, 'UNSAFE_GIT', r.unsafe)
      let exists = false
      try { exists = fs.existsSync(fullDir()) } catch { /* 見られないときは作りにいきます */ }
      if (exists) throw new ExecError(409, 'EXISTS', `${fullDir()} はすでにあります。入れ直す場合は、先にそのフォルダを消してください`)
      git = r.path
    }

    const at = cfg.now().getTime()
    const planId = `wl-${String(at).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`
    for (const [id, p] of plans) if (p.at < at - PLAN_TTL_MS) plans.delete(id)
    plans.set(planId, { planId, at, items, full, git })
    return {
      planId,
      expiresAt: new Date(at + PLAN_TTL_MS).toISOString(),
      dir: dir(),
      source: { name: SOURCE.name, repo: SOURCE.repo, tag: SOURCE.tag },
      files: items.map((f) => ({ id: f.id, name: f.name, saveAs: f.saveAs, bytes: f.bytes, url: `${cfg.raw}/${SOURCE.commit}/${f.path}` })),
      full: full ? { dir: fullDir(), command: displayCommand('git', ['clone', '--depth', '1', '--branch', SOURCE.tag, `${cfg.repo}.git`, fullDir()]) } : null,
    }
  }

  /* ---------------- 取得 ---------------- */

  /** 置き場所を作ります。ほかのユーザーから書き換えられないようにしておきます。 */
  function ensureDir() {
    fs.mkdirSync(dir(), { recursive: true, mode: 0o755 })
    const bad = writablePart(dir())
    if (bad) throw new ExecError(409, 'UNSAFE_DIR', `置き場所の ${bad} が、ほかのユーザーも書き換えられる権限になっています。先に「権限を直す」をお試しください`)
  }

  /** 1 本を取って、ハッシュを確かめてから置きます。合わなければ置きません。 */
  async function fetchOne(f, ctx) {
    const url = `${cfg.raw}/${SOURCE.commit}/${f.path}`
    ctx.append(`取得しています: ${url}\n`)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), cfg.fetchTimeoutMs)
    let buf
    try {
      const res = await cfg.fetch(url, { signal: ac.signal, redirect: 'error' })
      if (!res.ok) throw new Error(`取得できませんでした（${res.status}）`)
      buf = Buffer.from(await res.arrayBuffer())
    } finally {
      clearTimeout(timer)
    }
    const got = sha256(buf)
    if (got !== f.sha256) throw new Error(`中身が、表に書いたものと違います（${got.slice(0, 12)}…）。保存しません`)
    const at = path.join(dir(), f.saveAs)
    const tmp = `${at}.part-${crypto.randomBytes(4).toString('hex')}`
    fs.writeFileSync(tmp, buf, { mode: 0o644 })
    fs.renameSync(tmp, at)
    ctx.append(`置きました: ${at}（${buf.length.toLocaleString('en-US')} バイト）\n`)
  }

  /**
   * 取得を始めます。デスクトップ版のメインプロセスからだけ呼びます。
   * confirm はネイティブの確認（省略すると確認なしで進むため、呼ぶ側が必ず渡します）。
   */
  async function start(planId, { confirm } = {}) {
    requirePosix()
    const id = String(planId || '')
    if (!PLAN_ID_RE.test(id)) throw new ExecError(404, 'NO_PLAN', 'その取得の計画はありません')
    const p = plans.get(id)
    plans.delete(id)
    if (!p) throw new ExecError(410, 'NO_PLAN', '取得の計画が見つかりません（時間が経ちました）。もう一度お試しください')
    if (p.at < cfg.now().getTime() - PLAN_TTL_MS) throw new ExecError(410, 'PLAN_EXPIRED', '取得の計画の期限が切れました。もう一度お試しください')
    if (runner.busy()) throw new ExecError(409, 'BUSY', 'いま別の作業が動いています')

    const urls = p.items.map((f) => `${cfg.raw}/${SOURCE.commit}/${f.path}`)
    if (confirm && !(await confirm({
      dir: dir(), urls, full: p.full, fullDir: p.full ? fullDir() : null, repo: cfg.repo, tag: SOURCE.tag,
    }))) {
      appendSetupAudit('setup.wordlists.cancelled', { ids: p.items.map((f) => f.id), full: p.full }, cfg.now())
      return { ok: false, cancelled: true }
    }

    ensureDir()
    const steps = p.items.map((f) => ({
      key: f.id,
      label: f.name,
      run: (ctx) => fetchOne(f, ctx),
    }))
    if (p.full) {
      const argv = ['clone', '--depth', '1', '--branch', SOURCE.tag, `${cfg.repo}.git`, fullDir()]
      steps.push({
        key: 'full',
        label: `${SOURCE.name} 全体`,
        command: displayCommand('git', argv),
        spawn: {
          program: p.git,
          argv,
          cwd: dir(),
          env: cloneEnv(),
          timeoutMs: CLONE_TIMEOUT_MS,
        },
      })
    }

    return runner.start({
      jobId: id,
      kind: 'setup.wordlists',
      title: 'ワードリストを取得しています',
      audit: { dir: dir(), ids: p.items.map((f) => f.id), full: p.full, commit: SOURCE.commit },
      steps,
    })
  }

  /** git clone のときの環境。ネットワークが要るので、プロキシの設定はそのまま渡します。 */
  function cloneEnv() {
    const base = cfg.env
    const env = {
      PATH: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter),
      HOME: home(),
      LANG: base.LANG || 'en_US.UTF-8',
      TERM: 'dumb',
      TMPDIR: base.TMPDIR || os.tmpdir(),
      GIT_TERMINAL_PROMPT: '0',
    }
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) if (base[k]) env[k] = base[k]
    return env
  }

  function configure(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in cfg)) throw new Error(`未知の設定です: ${k}`)
      cfg[k] = v
    }
  }

  return { report, available, plan, start, configure, resolveGit }
}
