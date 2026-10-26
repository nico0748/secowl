import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ALLOWED } from './command-templates.js'
import { displayCommand, ExecError, writablePart } from './exec.js'
import { appendSetupAudit } from './setup-audit.js'
import { createJobRunner } from './setup-job.js'
import { installRecipe } from './tool-install.js'

/**
 * ツールの導入の実行（S6）。`brew install …` と `go install …` をアプリから動かします。
 *
 * コマンドの実行と同じ拘束をかけています。
 *   - 動かすのは brew と go だけ。引数は tool-install.js の固定表から組み立て、画面からは「どのツールを」「どちらで」しか渡せません
 *   - シェルは使わず、引数の配列をそのまま渡します
 *   - HTTP のルートは持たず、Electron のメインプロセスが IPC で受けたときだけ始めます（ネイティブの確認つき）
 *   - brew と go 自身も、ほかのユーザーが書き換えられる場所にあるものは動かしません（実行と同じ writablePart の判定）
 *
 * 環境は作り直しますが、コマンドの実行より少し広く渡します。導入にはネットワークと、
 * git・curl などの土台が要るためです（プロキシの設定もそのまま渡します）。
 */

const PLAN_TTL_MS = 2 * 60 * 1000
const PLAN_ID_RE = /^ins-\d{13}-[0-9a-f]{8}$/
const STEP_TIMEOUT_MS = 20 * 60 * 1000
const MAX_PROGRAMS = 20

/** 導入に使えるもの。これ以外は動かしません。 */
export const INSTALLERS = Object.freeze(['brew', 'go'])
const VIA_LABEL = Object.freeze({ brew: 'Homebrew', go: 'Go' })

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']
// Go の取得元の設定。社内のプロキシを使っている場合に要ります。
const GO_KEYS = ['GOPROXY', 'GOSUMDB', 'GOPRIVATE', 'GONOSUMDB', 'GONOSUMCHECK']

/** brew と go を探す場所。実行ファイルの探索と違い、Go の既定の置き場所も見ます。 */
export function installerSearchPaths(env = process.env, home = os.homedir()) {
  const list = [
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/local/go/bin', path.join(home, 'go', 'bin'),
    ...String(env.PATH || '').split(path.delimiter),
    '/usr/bin', '/bin',
  ]
  return [...new Set(list.filter((p) => p && path.isAbsolute(p)))]
}

/**
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string[]} [opts.searchPaths]  brew・go を探す場所
 * @param {() => Date} [opts.now]
 * @param {number} [opts.stepTimeoutMs]
 * @param {Set<string>} [opts.allowed]   入れてよいツール（既定は実行を許可したもの）
 * @param {(program: string) => {brew: string|null, go: string|null}} [opts.recipe]  入れ方（テストの差し替え用）
 * @param {object} [opts.runner]  時間のかかる作業を動かす仕組み（ワードリストの取得と共有します）
 */
export function createInstall(opts = {}) {
  const cfg = {
    env: opts.env || process.env,
    searchPaths: opts.searchPaths || null,
    now: opts.now || (() => new Date()),
    stepTimeoutMs: opts.stepTimeoutMs ?? STEP_TIMEOUT_MS,
    allowed: opts.allowed || ALLOWED,
    recipe: opts.recipe || installRecipe,
  }
  // 作業を動かす仕組みは、ワードリストの取得と 1 つを分け合います（同時に動くのは 1 件）。
  const runner = opts.runner || createJobRunner({ now: cfg.now, killGraceMs: opts.killGraceMs })
  const plans = new Map()

  const searchPaths = () => cfg.searchPaths || installerSearchPaths(cfg.env)
  const home = () => cfg.env.HOME || os.homedir()

  function requirePosix() {
    if (process.platform === 'win32') throw new ExecError(501, 'UNSUPPORTED', '導入の実行は macOS / Linux の版でだけ使えます')
  }

  /* ---------------- brew・go を探す ---------------- */

  /** 実行ファイルの解決。コマンドの実行と同じ基準で、書き換えられる場所にあるものは断ります。 */
  function resolveInstaller(name) {
    if (!INSTALLERS.includes(name)) return { found: false, error: `${name} は導入に使えません` }
    for (const dir of searchPaths()) {
      try {
        const candidate = path.join(dir, name)
        const real = fs.realpathSync(candidate)
        if (!fs.statSync(real).isFile()) continue
        fs.accessSync(real, fs.constants.X_OK)
        const bad = writablePart(candidate) || writablePart(real)
        if (bad) {
          return {
            found: true, path: real, unsafeAt: bad,
            unsafe: `${name} の置き場所をたどった途中の ${bad} が、ほかのユーザーも書き換えられる権限になっているため動かしません`,
          }
        }
        return { found: true, path: real }
      } catch { /* この場所には無い */ }
    }
    return { found: false, error: `${name} が見つかりません` }
  }

  const HINT = Object.freeze({
    brew: 'https://brew.sh の手順で入れてください（SecOwl からは入れられません）',
    go: 'brew install go、または https://go.dev/dl/ から入れてください',
  })

  /** brew と go の状態。画面の「このPCの状態」に並べます。 */
  function installers() {
    return INSTALLERS.map((name) => {
      const r = resolveInstaller(name)
      const state = !r.found ? 'missing' : r.unsafe ? 'unsafe' : 'ok'
      return { name, label: VIA_LABEL[name], state, path: r.found ? r.path : null, unsafeAt: r.unsafeAt || null, reason: state === 'ok' ? null : r.unsafe || r.error || null, hint: state === 'missing' ? HINT[name] : null }
    })
  }

  /** 導入に使うものの置き場所のうち、権限を直す必要のあるもの（setup の修正の対象に足します）。 */
  function unsafePaths() {
    return installers().filter((i) => i.state === 'unsafe' && i.unsafeAt).map((i) => i.unsafeAt)
  }

  /* ---------------- 計画 ---------------- */

  /** 1 つのツールを、どちらで入れるか。引数は固定表からだけ組み立てます。 */
  function step(program, via) {
    if (!cfg.allowed.has(program)) throw new ExecError(403, 'NOT_ALLOWED', `${program} は実行を許可したプログラムではありません`)
    const recipe = cfg.recipe(program)
    const arg = recipe[via]
    if (!arg) throw new ExecError(409, 'NO_RECIPE', `${program} は ${VIA_LABEL[via]} では入れられません`)
    const argv = ['install', arg]
    return { program, via, argv, command: displayCommand(via, argv), status: 'pending', exitCode: null, error: null }
  }

  /**
   * 入れる計画を立てます。どのツールをどちらで入れるかだけを受け取り、コマンドはこちらで組み立てます。
   * @param {{ programs: string[], via: 'brew'|'go' }} input
   */
  function plan(input = {}) {
    requirePosix()
    const via = String(input.via || '')
    if (!INSTALLERS.includes(via)) throw new ExecError(400, 'BAD_VIA', '入れ方は Homebrew か Go のどちらかです')
    const programs = [...new Set((Array.isArray(input.programs) ? input.programs : []).map(String))]
    if (!programs.length) throw new ExecError(400, 'NO_PROGRAM', '入れるツールを選んでください')
    if (programs.length > MAX_PROGRAMS) throw new ExecError(400, 'TOO_MANY', '一度に入れられるのは 20 個までです')

    const r = resolveInstaller(via)
    if (!r.found) throw new ExecError(409, 'NO_INSTALLER', `${VIA_LABEL[via]} が見つかりません。${HINT[via]}`)
    if (r.unsafe) throw new ExecError(409, 'UNSAFE_INSTALLER', r.unsafe)

    const steps = programs.map((p) => step(p, via))
    const at = cfg.now().getTime()
    const planId = `ins-${String(at).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`
    // 期限の切れた計画は残しません（同時に 1 つしか動かさないので、数は増えません）。
    for (const [id, p] of plans) if (p.at < at - PLAN_TTL_MS) plans.delete(id)
    plans.set(planId, { planId, at, via, installerPath: r.path, steps })
    return { planId, expiresAt: new Date(at + PLAN_TTL_MS).toISOString(), via, viaLabel: VIA_LABEL[via], installerPath: r.path, steps: steps.map((s) => ({ program: s.program, command: s.command })) }
  }

  /* ---------------- 実行 ---------------- */

  /** 導入のときの環境。実行より少し広く、ネットワークとプロキシの設定を渡します。 */
  function installEnv(installerPath) {
    const base = cfg.env
    const h = home()
    const dirs = [path.dirname(installerPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/local/go/bin', path.join(h, 'go', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    const env = {
      PATH: [...new Set(dirs)].join(path.delimiter),
      HOME: h,
      LANG: base.LANG || 'en_US.UTF-8',
      LC_ALL: base.LC_ALL || base.LANG || 'en_US.UTF-8',
      TERM: 'dumb',
      TMPDIR: base.TMPDIR || os.tmpdir(),
      // 入れたものが実行ファイルの探索先に入るように、置き場所を決めておきます
      GOBIN: path.join(h, 'go', 'bin'),
      HOMEBREW_NO_ANALYTICS: '1',
      HOMEBREW_NO_COLOR: '1',
      HOMEBREW_NO_ENV_HINTS: '1',
    }
    for (const k of [...PROXY_KEYS, ...GO_KEYS]) if (base[k]) env[k] = base[k]
    return env
  }

  /**
   * 導入を始めます。デスクトップ版のメインプロセスからだけ呼びます。
   * confirm はネイティブの確認（省略すると確認なしで進むため、呼ぶ側が必ず渡します）。
   */
  async function start(planId, { confirm } = {}) {
    requirePosix()
    const id = String(planId || '')
    if (!PLAN_ID_RE.test(id)) throw new ExecError(404, 'NO_PLAN', 'その導入の計画はありません')
    const p = plans.get(id)
    plans.delete(id)
    if (!p) throw new ExecError(410, 'NO_PLAN', '導入の計画が見つかりません（時間が経ちました）。もう一度お試しください')
    if (p.at < cfg.now().getTime() - PLAN_TTL_MS) throw new ExecError(410, 'PLAN_EXPIRED', '導入の計画の期限が切れました。もう一度お試しください')
    if (runner.busy()) throw new ExecError(409, 'BUSY', 'いま別の作業が動いています')

    // 計画を作ってから、置き場所が差し替わっていないか見ます。
    const fresh = resolveInstaller(p.via)
    if (!fresh.found || fresh.unsafe || fresh.path !== p.installerPath) {
      throw new ExecError(409, 'CHANGED', `${VIA_LABEL[p.via]} の置き場所が変わりました。もう一度お試しください`)
    }
    if (confirm && !(await confirm({ via: p.via, viaLabel: VIA_LABEL[p.via], installerPath: p.installerPath, commands: p.steps.map((s) => s.command) }))) {
      appendSetupAudit('setup.install.cancelled', { via: p.via, programs: p.steps.map((s) => s.program) }, cfg.now())
      return { ok: false, cancelled: true }
    }

    const env = installEnv(p.installerPath)
    return runner.start({
      jobId: id,
      kind: 'setup.install',
      title: `${VIA_LABEL[p.via]} で入れています`,
      audit: { via: p.via, installerPath: p.installerPath, commands: p.steps.map((s) => s.command) },
      steps: p.steps.map((s) => ({
        key: s.program,
        label: s.program,
        command: s.command,
        spawn: { program: p.installerPath, argv: s.argv, env, cwd: home(), timeoutMs: cfg.stepTimeoutMs },
      })),
    })
  }

  /** テスト用の差し替え口。同じプロセスのコードからだけ呼べます。 */
  function configure(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in cfg)) throw new Error(`未知の設定です: ${k}`)
      cfg[k] = v
    }
  }

  return { installers, unsafePaths, plan, start, configure, resolveInstaller }
}
