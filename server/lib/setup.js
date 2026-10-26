import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ALLOWED } from './command-templates.js'
import { dataRoot } from './config.js'
import { displayCommand, ExecError, lastLineOf } from './exec.js'
import { installRecipe } from './tool-install.js'

/**
 * ツールの導入の点検と、権限の修正（S6）。
 *
 * 点検（report）は読み取りだけです。修正（applyFix）はファイルの権限を変えるので、コマンドの実行と同じ拘束をかけます。
 *   - HTTP のルートは持たず、Electron のメインプロセスが IPC で受けたときだけ呼びます（ネイティブの確認つき）
 *   - 直す場所は画面から渡しません。点検で見つかった場所（許可したプログラムの置き場所）だけを、サーバ側で組み立てます
 *   - 自分が持ち主のもの、決めた場所の下にあるもの、シンボリックリンクでないものだけ。sudo は使いません
 *   - 直す直前にもう一度確かめ、確かめた実体そのものに fchmod します（確認と変更の間の差し替えを避けるため）
 */

const PLAN_TTL_MS = 2 * 60 * 1000
const MAX_PLANS = 20
const PLAN_ID_RE = /^fix-\d{13}-[0-9a-f]{8}$/

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const oct = (mode) => (mode & 0o7777).toString(8).padStart(3, '0')

/** 直してよい場所。この下にないものは、コマンドをお見せして手でやってもらいます。 */
export function defaultFixRoots(home = os.homedir()) {
  return [...new Set([path.resolve(home), '/opt', '/usr/local'])]
}

/**
 * @param {object} opts
 * @param {(program: string) => object} opts.resolve  実行ファイルの解決（createExec の resolveProgram）
 * @param {Set<string>} [opts.allowed]
 * @param {string[]} [opts.roots]   直してよい場所（既定は defaultFixRoots）
 * @param {number} [opts.uid]
 * @param {() => Date} [opts.now]
 */
export function createSetup(opts = {}) {
  const cfg = {
    resolve: opts.resolve,
    allowed: opts.allowed || ALLOWED,
    roots: opts.roots || null,
    uid: opts.uid ?? process.getuid?.() ?? -1,
    now: opts.now || (() => new Date()),
  }
  const plans = new Map()
  const roots = () => cfg.roots || defaultFixRoots()

  function requirePosix() {
    if (process.platform === 'win32') throw new ExecError(501, 'UNSUPPORTED', '導入の点検は macOS / Linux の版でだけ使えます')
  }

  /* ---------------- 点検 ---------------- */

  /** 1 つの場所を見て、アプリから直せるかどうかを決めます。 */
  function inspect(target) {
    const at = { path: target, command: displayCommand('chmod', ['go-w', target]) }
    let st
    try { st = fs.lstatSync(target) } catch { return { ...at, can: false, why: '見つかりません' } }
    if (st.isSymbolicLink()) return { ...at, can: false, why: 'シンボリックリンクです。リンク先を直してください' }
    const mode = st.mode & 0o7777
    if (!(mode & 0o022)) return { ...at, can: false, why: 'すでに直っています', mode: oct(mode) }
    const inRoot = roots().some((r) => target === r || target.startsWith(r + path.sep))
    if (!inRoot) return { ...at, can: false, why: `アプリから直す範囲（${roots().join('・')}）の外です`, mode: oct(mode) }
    if (st.uid !== cfg.uid) {
      return { ...at, can: false, why: '持ち主が自分ではありません（sudo が要るので、アプリからは直しません）', mode: oct(mode), command: displayCommand('sudo', ['chmod', 'go-w', target]) }
    }
    return { ...at, can: true, why: null, mode: oct(mode), nextMode: oct(mode & ~0o022) }
  }

  /**
   * 許可したプログラムそれぞれの状態と、直す必要のある場所の一覧。
   * state: ok = 使える / missing = 見つからない / unsafe = ほかのユーザーが書き換えられる場所にある
   */
  function report() {
    requirePosix()
    const programs = [...cfg.allowed].sort().map((program) => {
      const r = cfg.resolve(program) || { found: false }
      const state = !r.found ? 'missing' : r.unsafe ? 'unsafe' : 'ok'
      const { brew, go } = installRecipe(program)
      return {
        program,
        state,
        path: r.found ? r.path : null,
        unsafeAt: r.unsafeAt || null,
        reason: state === 'ok' ? null : r.unsafe || r.error || null,
        install: {
          brew: brew ? displayCommand('brew', ['install', brew]) : null,
          go: go ? displayCommand('go', ['install', go]) : null,
        },
      }
    })
    const seen = new Set()
    const fixes = []
    for (const p of programs) {
      if (p.state !== 'unsafe' || !p.unsafeAt || seen.has(p.unsafeAt)) continue
      seen.add(p.unsafeAt)
      fixes.push(inspect(p.unsafeAt))
    }
    const counts = { ok: 0, missing: 0, unsafe: 0 }
    for (const p of programs) counts[p.state]++
    return { os: process.platform, counts, programs, fixes, fixable: fixes.filter((f) => f.can).length }
  }

  /* ---------------- 修正 ---------------- */

  function prune() {
    const limit = cfg.now().getTime() - PLAN_TTL_MS
    for (const [id, p] of plans) if (p.at < limit) plans.delete(id)
    while (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value)
  }

  /** 直す場所を決めて planId を発行します。場所は画面からは渡せません。 */
  function planFix() {
    requirePosix()
    const r = report()
    const can = r.fixes.filter((f) => f.can)
    if (!can.length) throw new ExecError(409, 'NO_FIX', 'アプリから直せる場所はありません')
    prune()
    const at = cfg.now().getTime()
    const planId = `fix-${String(at).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`
    plans.set(planId, { planId, at, paths: can.map((f) => f.path) })
    return {
      planId,
      expiresAt: new Date(at + PLAN_TTL_MS).toISOString(),
      paths: can,
      blocked: r.fixes.filter((f) => !f.can),
    }
  }

  /** 確かめた実体そのものに fchmod します（開いてから見て、同じ fd に当てます）。 */
  function chmodChecked(target) {
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      const st = fs.fstatSync(fd)
      if (st.uid !== cfg.uid) throw new Error('持ち主が変わっています')
      const from = st.mode & 0o7777
      const to = from & ~0o022
      if (from !== to) fs.fchmodSync(fd, to)
      return { path: target, from: oct(from), to: oct(to) }
    } finally {
      try { fs.closeSync(fd) } catch { /* 閉じられなくても結果は変わりません */ }
    }
  }

  /**
   * 権限を直します。デスクトップ版のメインプロセスからだけ呼びます。
   * confirm はネイティブの確認（省略すると確認なしで進むため、呼ぶ側が必ず渡します）。
   */
  async function applyFix(planId, { confirm } = {}) {
    requirePosix()
    const id = String(planId || '')
    if (!PLAN_ID_RE.test(id)) throw new ExecError(404, 'NO_PLAN', 'その修正の計画はありません')
    const p = plans.get(id)
    plans.delete(id)
    if (!p) throw new ExecError(410, 'NO_PLAN', '修正の計画が見つかりません（時間が経ちました）。もう一度点検してください')
    if (p.at < cfg.now().getTime() - PLAN_TTL_MS) throw new ExecError(410, 'PLAN_EXPIRED', '修正の計画の期限が切れました。もう一度点検してください')

    // 計画を作ってから変わっていないか、直前にもう一度見ます。
    const fresh = p.paths.map((t) => inspect(t))
    const can = fresh.filter((f) => f.can)
    if (!can.length) throw new ExecError(409, 'NO_FIX', '直せる場所がなくなりました。もう一度点検してください')
    if (confirm && !(await confirm({ count: can.length, paths: can.map((f) => f.path) }))) {
      audit('setup.fix.cancelled', { paths: can.map((f) => f.path) })
      return { ok: false, cancelled: true }
    }
    const changed = []
    const failed = []
    for (const f of can) {
      try { changed.push(chmodChecked(f.path)) } catch (e) { failed.push({ path: f.path, error: String(e?.message || e) }) }
    }
    audit('setup.fix', { changed, failed, skipped: fresh.filter((f) => !f.can).map((f) => ({ path: f.path, why: f.why })) })
    return { ok: true, changed, failed }
  }

  /* ---------------- 記録 ---------------- */

  /** 保存先の直下の .secowl/（診断対象の一覧には出ません）。 */
  function setupDir() {
    const dir = path.join(dataRoot(), '.secowl')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  function auditFile() { return path.join(setupDir(), 'setup.jsonl') }

  /** 追記専用の記録。実行の記録と同じく、各行に前の行の SHA-256 を持たせます。 */
  function audit(event, entry = {}) {
    const file = auditFile()
    const last = lastLineOf(file)
    const prev = last ? sha256(last) : ''
    const line = JSON.stringify({ ts: cfg.now().toISOString(), event, source: 'ui', ...entry, prev })
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 })
    return JSON.parse(line)
  }

  function history(limit = 20) {
    let lines = []
    try { lines = fs.readFileSync(auditFile(), 'utf8').split('\n').filter(Boolean) } catch { /* まだありません */ }
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  }

  /** テスト用の差し替え口。同じプロセスのコードからだけ呼べます。 */
  function configure(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in cfg)) throw new Error(`未知の設定です: ${k}`)
      cfg[k] = v
    }
  }

  return { report, planFix, applyFix, history, configure, _inspect: inspect }
}
