import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import dns from 'node:dns'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonicalTarget, evaluate, VERDICT_LABELS } from '../../shared/scope.js'
import { redactHttp } from '../../shared/redact.js'
import { readConfig } from './config.js'
import { parseToolOutput } from './importers.js'
import { ALLOWED, checkValue, startsWithDash, parseCommands } from './command-templates.js'
import { knowledge } from './knowledge.js'
import {
  DIRS, createToolLog, engDir, getEngagement, importIntoEngagement, readScope, secowlDir, toPosix,
} from './store.js'
import { dataRoot } from './config.js'

/**
 * アプリ内コマンドランナー（S5）。allow-list のプログラムを、テンプレートから作った引数の配列で
 * child_process.spawn（shell: false）に渡して起動します。シェルの文字列は一切作りません。
 *
 * 起動は 2 段階です。plan（検証して planId を発行）→ launch（planId を作り直して照合し、確認を経て起動）。
 * launch は HTTP のルートを持たず、Electron のメインプロセスが IPC で受けたときだけ呼びます。
 * 差し替え口（createExec の引数と configure）は、同じプロセスのコードからしか届きません。
 * HTTP や環境変数から実行ファイルの一覧・探索パス・テンプレートを変える手段は作りません。
 */

export class ExecError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    Object.assign(this, extra)
  }
}

export const JOB_ID_RE = /^run-\d{13}-[0-9a-f]{8}$/
const CAPTURE_DIR = '取得データ'
const PLAN_TTL_MS = 2 * 60 * 1000
const MAX_PLANS = 100
const MAX_IMPORT_BYTES = 50 * 1024 * 1024
const RING_MAX_BYTES = 1024 * 1024
const LOG_HEAD_BYTES = 100 * 1024
const LOG_TAIL_BYTES = 100 * 1024
const MAX_LINE_CHARS = 32 * 1024
const PARTIAL_FLUSH_CHARS = 4096
const KEEP_IN_MEMORY = 20
const MAX_SUBSCRIBERS = 4
const MAX_BACKLOG_BYTES = 256 * 1024
const BATCH_MS = 100
const HEARTBEAT_MS = 15000

const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g
const C0_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

const REDACT_ALL = { cookie: true, authorization: true, jwt: true, secret: true, email: true }
const REDACT_ARGV = { cookie: true, authorization: true, jwt: true, secret: true }
const FORBIDDEN_ENV = /^(ELECTRON_|NODE_OPTIONS$|NODE_PATH$|SECOWL_|AWS_|GCP_|GOOGLE_|AZURE_)|(_TOKEN|_KEY|_SECRET|_PASSWORD|_PASSWD)$/i
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const ymd = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 引数を表示用の 1 行にします（実行にはこの文字列を使いません。ログと画面の表示専用）。 */
export function displayCommand(program, argv) {
  const q = (a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
  return [program, ...argv].map(q).join(' ').replace(/`/g, '%60')
}

/** 端末の制御列と、改行・タブ以外の制御文字を取り除き、\r の進捗の上書きを最後の表示に畳みます。 */
export function cleanLine(line) {
  const segs = String(line).replace(ANSI_RE, '').split('\r')
  let last = ''
  for (const s of segs) if (s !== '') last = s
  return last.replace(C0_RE, '')
}

/** 探索パスの既定。Finder から起動したアプリの PATH は /usr/bin:/bin:/usr/sbin:/sbin だけなので、よくある場所を足します。 */
export function defaultSearchPaths(env = process.env, home = os.homedir()) {
  const list = [
    '/opt/homebrew/bin', '/usr/local/bin', path.join(home, 'go', 'bin'), path.join(home, '.local', 'bin'),
    ...String(env.PATH || '').split(path.delimiter),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ]
  return [...new Set(list.filter((p) => p && path.isAbsolute(p)))]
}

/** ファイルの最後の 1 行。全体を読まず、末尾から必要なぶんだけ読みます（長期の案件で毎回遅くならないように）。 */
export function lastLineOf(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    let chunk = 16 * 1024
    for (;;) {
      const len = Math.min(chunk, size)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
      const text = buf.toString('utf8').replace(/\n+$/, '')
      const at = text.lastIndexOf('\n')
      if (at !== -1) return text.slice(at + 1)
      if (len >= size) return text // ファイル全体が 1 行
      chunk *= 4
    }
  } catch { return '' } finally { if (fd !== undefined) try { fs.closeSync(fd) } catch { /* 閉じられなくても続けます */ } }
}

/**
 * ルートから 1 要素ずつたどり、ほかのユーザーが書き換えられる（mode & 0o022）ディレクトリやファイルを探します。
 * シンボリックリンクはリンク先も同じ基準でたどるので、書き換えられる場所に置かれたリンクの差し替えも見つかります。
 * 全員が書けても sticky（/tmp など）で、中身が自分か root のものなら、他人には差し替えられないため通します。
 * 見つけた場所を返します（問題なければ null）。
 */
export function writablePart(file, depth = 0) {
  if (depth > 16) return file
  const uid = process.getuid?.()
  const parts = file.split(path.sep).filter(Boolean)
  let dir = path.sep
  for (let i = 0; i < parts.length; i++) {
    const next = path.join(dir, parts[i])
    let dirSt
    let st
    try { dirSt = fs.lstatSync(dir); st = fs.lstatSync(next) } catch { return next }
    if (dirSt.mode & 0o022) {
      const sticky = (dirSt.mode & 0o1000) !== 0 && (st.uid === 0 || st.uid === uid)
      if (!sticky) return dir
    }
    if (st.isSymbolicLink()) {
      let dest
      try { dest = path.resolve(dir, fs.readlinkSync(next)) } catch { return next }
      return writablePart(path.join(dest, ...parts.slice(i + 1)), depth + 1)
    }
    if (i === parts.length - 1 && st.mode & 0o022) return next
    dir = next
  }
  return null
}

/**
 * 出力の取り込み先（取得データ/）。シンボリックリンクで保存先の外へ出ていないことを確かめます。
 * フォルダを作る前に、まだ無いときは存在する一番近い親の実体を確かめるので、外を指すリンクの先に空のフォルダを作ることもありません。
 */
function captureDir(eid, { create }) {
  const base = engDir(eid)
  const dir = path.join(base, DIRS.survey, CAPTURE_DIR)
  const realBase = fs.realpathSync(base)
  const inside = (real) => real === realBase || real.startsWith(realBase + path.sep)
  const outside = () => new ExecError(403, 'OUTSIDE', '出力先が診断対象のフォルダの外を指しています')
  let probe = dir
  for (;;) {
    try { fs.lstatSync(probe); break } catch { if (probe === base) break; probe = path.dirname(probe) }
  }
  let realProbe
  try { realProbe = fs.realpathSync(probe) } catch { throw outside() } // 行き先のないリンクは、作った先が外になりうる
  if (!inside(realProbe)) throw outside()
  if (create) fs.mkdirSync(dir, { recursive: true })
  if (fs.existsSync(dir)) {
    const real = fs.realpathSync(dir)
    if (!real.startsWith(realBase + path.sep)) throw outside()
  }
  return dir
}

const OMIT_NOTE = (n) => `[長すぎる行の途中を省略しました（${n} 文字）]`
// 行を途中で切るとき、秘匿値の一部だけが残らないように、直前の区切りまで戻します。
const CUT_BOUNDARY_RE = /[\s"'`,;:=&?<>()[\]{}|\\]/
const CUT_BACK_CHARS = 8192
const ESC_HEAD_RE = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/

export function trimToBoundary(s) {
  const floor = Math.max(0, s.length - CUT_BACK_CHARS)
  for (let i = s.length - 1; i >= floor; i--) if (CUT_BOUNDARY_RE.test(s[i])) return s.slice(0, i + 1)
  return s.slice(0, floor)
}

/** 末尾が途中で切れた端末の制御列なら、その手前の位置を返します（次の読み取りに回すため）。 */
function incompleteEscapeStart(s) {
  const i = s.lastIndexOf('\x1b')
  if (i === -1 || s.length - i > 64) return s.length
  return ESC_HEAD_RE.test(s.slice(i)) ? s.length : i
}

/** 1 つの断片から端末の制御列を除きます。\r で行頭に戻って上書きされた場合は overwrite を立てます。 */
function cleanFragment(raw) {
  const segs = String(raw).replace(ANSI_RE, '').split('\r')
  let at = -1
  for (let i = 0; i < segs.length; i++) if (segs[i] !== '') at = i
  return { text: (at === -1 ? '' : segs[at]).replace(C0_RE, ''), overwrite: at > 0 }
}

const newLogical = () => ({ parts: [], kept: 0, total: 0, shown: 0, open: false })

export class Collector {
  constructor() {
    this.pending = { out: '', err: '' } // 改行を待っている文字列
    this.logical = { out: newLogical(), err: newLogical() } // 保存用に組み立て中の 1 行（強制フラッシュした断片をつなぐ）
    this.ring = []
    this.ringBytes = 0
    this.nextSeq = 1
    this.head = []
    this.headBytes = 0
    this.headFull = false
    this.tail = []
    this.tailBytes = 0
    this.droppedLines = 0
    this.totalBytes = 0
    this.lines = 0
    this.listeners = new Set()
  }

  push(stream, text) {
    let buf = this.pending[stream] + text
    let i
    while ((i = buf.indexOf('\n')) !== -1) {
      this.addFragment(stream, buf.slice(0, i), true)
      buf = buf.slice(i + 1)
    }
    if (buf.length > PARTIAL_FLUSH_CHARS) {
      const keep = incompleteEscapeStart(buf)
      this.addFragment(stream, buf.slice(0, keep), false)
      buf = buf.slice(keep)
    }
    this.pending[stream] = buf
  }

  flush() {
    for (const s of ['out', 'err']) {
      if (this.pending[s] || this.logical[s].open) this.addFragment(s, this.pending[s], true)
      this.pending[s] = ''
    }
  }

  /**
   * 画面には断片をそのまま流し、保存用には「改行で終わる 1 行」になるまで断片をつないでから確定します。
   * 断片を行として確定すると、境界をまたいだ JWT や Cookie が伏せ字から漏れるためです。
   */
  addFragment(stream, raw, final) {
    const st = this.logical[stream]
    const { text, overwrite } = cleanFragment(raw)
    if (!final && text === '') return
    if (overwrite) Object.assign(st, newLogical(), { shown: st.shown, open: st.open })
    this.totalBytes += Buffer.byteLength(text) + (final ? 1 : 0)

    // 保存用: 1 行の先頭 MAX_LINE_CHARS 文字だけを持ち、超えた分は数えるだけにする
    st.total += text.length
    if (st.kept < MAX_LINE_CHARS) {
      const piece = text.length > MAX_LINE_CHARS - st.kept ? text.slice(0, MAX_LINE_CHARS - st.kept) : text
      st.parts.push(piece)
      st.kept += piece.length
    }

    // 画面用: 上限を超える行は、先頭だけ見せて省略の印を 1 回だけ出す
    let shown = text
    if (st.shown > MAX_LINE_CHARS) shown = ''
    else if (st.shown + text.length > MAX_LINE_CHARS) {
      shown = `${text.slice(0, MAX_LINE_CHARS - st.shown)} [長すぎる行の途中を省略しました]`
      st.shown = MAX_LINE_CHARS + 1
    } else st.shown += text.length
    st.open = !final
    if (final || shown) this.pushChunk(stream, final ? `${shown}\n` : shown)

    if (final) {
      let line = st.parts.join('')
      if (st.total > st.kept) {
        line = trimToBoundary(line)
        line += `${line ? ' ' : ''}${OMIT_NOTE(st.total - line.length)}`
      }
      Object.assign(st, newLogical())
      this.commit(`${line}\n`)
    }
    for (const fn of this.listeners) fn()
  }

  pushChunk(stream, x) {
    const bytes = Buffer.byteLength(x)
    this.ring.push({ seq: this.nextSeq++, s: stream, x, b: bytes })
    this.ringBytes += bytes
    while (this.ringBytes > RING_MAX_BYTES && this.ring.length > 1) this.ringBytes -= this.ring.shift().b
  }

  commit(piece) {
    const bytes = Buffer.byteLength(piece)
    this.lines++
    if (!this.headFull) {
      this.head.push(piece)
      this.headBytes += bytes
      if (this.headBytes >= LOG_HEAD_BYTES) this.headFull = true
    } else {
      this.tail.push({ piece, bytes })
      this.tailBytes += bytes
      while (this.tailBytes > LOG_TAIL_BYTES && this.tail.length > 1) {
        this.tailBytes -= this.tail.shift().bytes
        this.droppedLines++
      }
    }
  }

  /** 保存用の本文。先頭 100KB と末尾 100KB を行の境界で切り、間を省略したことを書き添えます。 */
  logText() {
    const head = this.head.join('')
    if (!this.tail.length) return { text: head, omitted: 0 }
    const note = this.droppedLines ? `\n[中略: ${this.droppedLines} 行を省略しました。全体 ${Math.round(this.totalBytes / 1024)} KB]\n\n` : ''
    return { text: head + note + this.tail.map((t) => t.piece).join(''), omitted: this.droppedLines }
  }

  releaseLogBuffers() { this.head = []; this.tail = [] }
}

/**
 * @param {object} [opts]
 * @param {Set<string>} [opts.allowed]          実行を許すプログラム名
 * @param {string[]} [opts.searchPaths]         実行ファイルを探す場所（絶対パスだけ）
 * @param {object} [opts.env]                   子プロセスの環境を作る元（既定は process.env）
 * @param {() => Date} [opts.now]
 * @param {() => Array} [opts.templates]        [{ slug, name, phase, commands }]。既定は同梱の knowledge/ だけ
 * @param {(host: string) => Promise<{address: string}[]>} [opts.lookup]
 */
export function createExec(opts = {}) {
  const cfg = {
    allowed: opts.allowed || ALLOWED,
    searchPaths: opts.searchPaths || null,
    env: opts.env || process.env,
    now: opts.now || (() => new Date()),
    templates: opts.templates || null,
    lookup: opts.lookup || ((host) => dns.promises.lookup(host, { all: true })),
    concurrency: opts.concurrency || null,
    drainMs: opts.drainMs ?? 2000,
    killGraceMs: opts.killGraceMs ?? 3000,
    dnsTimeoutMs: opts.dnsTimeoutMs ?? 2000,
    passProxy: opts.passProxy ?? null,
  }

  const plans = new Map()
  const jobs = new Map() // jobId -> job（直近 KEEP_IN_MEMORY 件の完了分と、実行中のもの）
  let slots = 0

  const searchPaths = () => cfg.searchPaths || defaultSearchPaths(cfg.env)
  const todayStr = () => ymd(cfg.now())

  /* ---------------- テンプレート ---------------- */

  function toolEntries() {
    if (cfg.templates) return cfg.templates()
    return knowledge().tools.filter((t) => t.commands?.length).map((t) => ({ slug: t.slug, name: t.name, phase: t.phase, icon: t.icon, commands: t.commands }))
  }

  function findCommand(slug, cmdId) {
    const tool = toolEntries().find((t) => t.slug === slug)
    const cmd = tool?.commands.find((c) => c.id === cmdId)
    if (!tool || !cmd) throw new ExecError(404, 'NO_COMMAND', 'そのコマンドのテンプレートはありません')
    if (!cfg.allowed.has(cmd.program) || cmd.program.includes('/')) throw new ExecError(403, 'NOT_ALLOWED', `${cmd.program} は実行を許可したプログラムではありません`)
    return { tool, cmd }
  }

  /* ---------------- プログラムの解決 ---------------- */

  function resolveProgram(name) {
    if (!cfg.allowed.has(name) || name.includes('/')) return { found: false, error: `${name} は実行を許可したプログラムではありません` }
    for (const dir of searchPaths()) {
      try {
        const candidate = path.join(dir, name)
        const real = fs.realpathSync(candidate)
        if (!fs.statSync(real).isFile()) continue
        fs.accessSync(real, fs.constants.X_OK)
        // 探した場所（リンクが置かれているディレクトリ）と、実体までの道筋の両方を見る
        const bad = writablePart(candidate) || writablePart(real)
        if (bad) {
          return {
            found: true, path: real, unsafeAt: bad,
            unsafe: `${name} の置き場所をたどった途中の ${bad} が、ほかのユーザーも書き換えられる権限になっているため実行しません（chmod go-w ${bad} で直せます）`,
          }
        }
        return { found: true, path: real }
      } catch { /* この場所には無い */ }
    }
    return { found: false, error: `${name} が見つかりません（探した場所: ${searchPaths().join(', ')}）` }
  }

  function minimalEnv() {
    const base = cfg.env
    const pass = cfg.passProxy ?? readConfig().execPassProxy === true
    const env = {
      PATH: searchPaths().join(path.delimiter),
      HOME: base.HOME || os.homedir(),
      LANG: base.LANG || 'en_US.UTF-8',
      LC_ALL: base.LC_ALL || base.LANG || 'en_US.UTF-8',
      TERM: 'dumb',
      TMPDIR: base.TMPDIR || os.tmpdir(),
    }
    if (pass) for (const k of PROXY_KEYS) if (base[k]) env[k] = base[k]
    for (const k of Object.keys(env)) if (FORBIDDEN_ENV.test(k)) delete env[k]
    return env
  }

  /* ---------------- 監査記録 ---------------- */

  function auditFile(eid) { return path.join(secowlDir(eid), 'audit.jsonl') }

  /** 追記専用の実行記録。各行に前の行の SHA-256 を持たせ、あとから書き換えるとつながりが切れて分かります。 */
  function audit(eid, event, entry = {}) {
    const file = auditFile(eid)
    const last = lastLineOf(file)
    const prev = last ? sha256(last) : ''
    const clean = Object.fromEntries(Object.entries({ ts: cfg.now().toISOString(), event, source: 'ui', eid, ...entry }).filter(([, v]) => v !== undefined))
    if (Array.isArray(clean.argv)) clean.argv = clean.argv.map((a) => redactHttp(a, REDACT_ARGV).text)
    const line = JSON.stringify({ ...clean, prev })
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 })
    return JSON.parse(line)
  }

  function verifyAudit(eid) {
    let lines = []
    try { lines = fs.readFileSync(auditFile(eid), 'utf8').split('\n').filter(Boolean) } catch { /* 無い */ }
    let prev = ''
    for (let i = 0; i < lines.length; i++) {
      let obj
      try { obj = JSON.parse(lines[i]) } catch { return { ok: false, lines: lines.length, brokenAt: i + 1 } }
      if (obj.prev !== prev) return { ok: false, lines: lines.length, brokenAt: i + 1 }
      prev = sha256(lines[i])
    }
    return { ok: true, lines: lines.length, brokenAt: null }
  }

  /* ---------------- plan ---------------- */

  /** 検証して、引数の配列と判定をまとめます（同期。DNS は別に引きます）。 */
  function compute(eid, input, jobId) {
    if (process.platform === 'win32') throw new ExecError(501, 'UNSUPPORTED', 'コマンドの実行は macOS / Linux の版でだけ使えます')
    if (!getEngagement(eid)) throw new ExecError(404, 'NO_ENGAGEMENT', '診断対象が見つかりません')
    const { tool, cmd } = findCommand(String(input.slug || ''), String(input.cmdId || ''))
    const given = input.values && typeof input.values === 'object' && !Array.isArray(input.values) ? input.values : {}
    for (const k of Object.keys(given)) if (!cmd.vars.some((v) => v.name === k)) throw new ExecError(422, 'INVALID_VALUE', `未知の変数です: ${k}`)

    const values = {}
    let canon = null
    const portRanges = []
    for (const def of cmd.vars) {
      let raw = given[def.name]
      if (raw === undefined || raw === null || raw === '') raw = def.default
      if (raw === undefined || raw === null || raw === '') throw new ExecError(422, 'INVALID_VALUE', `「${def.label || def.name}」を入力してください`)
      const r = checkValue(def, raw)
      if (r.error) throw new ExecError(422, 'INVALID_VALUE', r.error)
      if (startsWithDash(r.value)) throw new ExecError(422, 'INVALID_VALUE', `「${def.label || def.name}」は - で始められません（コマンドのオプションとして解釈されるため）`)
      values[def.name] = r.value
      if (def.kind === 'target') canon = r.canon
      if (def.kind === 'ports') portRanges.push(...r.ranges)
    }

    const outRel = cmd.out ? `${jobId}.${cmd.out.ext}` : null
    const outAbs = outRel ? path.join(captureDir(eid, { create: false }), outRel) : null
    const argv = cmd.args.map((tok) => {
      const m = /^\{\{([a-z_]+)\}\}$/.exec(tok)
      if (!m) return tok
      if (m[1] === 'out') return outAbs
      return values[m[1]]
    })

    const reasons = []
    const prog = resolveProgram(cmd.program)
    if (!prog.found) reasons.push(prog.error)
    else if (prog.unsafe) reasons.push(prog.unsafe)

    const scope = readScope(eid, { on: todayStr() })
    let verdict
    if (scope.scope) verdict = evaluate(canon, scope.scope, { ports: portRanges.length ? portRanges : undefined })
    else verdict = { verdict: 'invalid', label: VERDICT_LABELS.invalid, blocked: true, matched: null, reason: scope.error || 'スコープを読めません' }
    if (verdict.blocked) reasons.push(verdict.reason)
    const agreed = scope.approved === true
    if (!agreed) reasons.push('スコープ文書の書面の承認（承認印・承認日・承認者）がそろっていません。')
    const period = scope.period || { ok: false, reason: '診断期間を確認できません。' }
    if (!period.ok) reasons.push(period.reason)

    const plan = {
      eid, jobId, slug: tool.slug, toolName: tool.name, phase: tool.phase?.[0] || 'survey',
      cmdId: cmd.id, label: cmd.label, program: cmd.program,
      programPath: prog.found ? prog.path : null,
      programIssue: !prog.found ? 'missing' : prog.unsafe ? 'unsafe' : null,
      argv,
      command: displayCommand(prog.found ? prog.path : cmd.program, argv),
      target: canon.value, targetKind: canon.kind,
      inputTarget: typeof given.target === 'string' && given.target !== canon.value ? given.target : null,
      scopeVerdict: verdict.verdict, verdictLabel: verdict.label, matched: verdict.matched,
      scopeReason: verdict.reason, warning: verdict.warning || null,
      agreed, inPeriod: period.ok, periodReason: period.reason,
      blocked: reasons.length > 0, reason: reasons.join(' '), reasons,
      outPath: outAbs, outFormat: cmd.out?.format || null,
      timeoutSec: cmd.timeout_sec, templateHash: cmd.hash || null,
      scopeVersion: scope.version || null, scopeFile: scope.file,
      vars: values,
    }
    // 条件が変わったかを見る指紋。DNS の応答やスコープ文書の無関係な部分は入れません。
    const hash = sha256(JSON.stringify({
      argv, programPath: plan.programPath, target: plan.target, verdict: plan.scopeVerdict,
      agreed, inPeriod: plan.inPeriod, unsafe: !!prog.unsafe, found: prog.found,
      templateHash: plan.templateHash, // argv が同じでも、時間切れの秒数や出力形式が変わったら別物として扱う
    }))
    return { plan, hash, canon, cmd, tool }
  }

  async function resolveDns(plan, canon, scopeData) {
    if (canon.kind === 'ip') return { addresses: [], skipped: true, blocked: false, warning: null }
    let list
    try {
      list = await Promise.race([
        cfg.lookup(canon.host),
        new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('時間切れ')), cfg.dnsTimeoutMs); t.unref?.() }),
      ])
    } catch (err) {
      return { addresses: [], error: String(err?.message || err), blocked: false, warning: null }
    }
    const addresses = [...new Set(list.map((a) => a.address))]
    const scope = readScope(plan.eid, { on: todayStr() })
    let blocked = false
    let warning = null
    let reason = null
    if (scope.scope) {
      const hasIpPatterns = scope.scope.targets.some((p) => p.kind === 'ip' || p.kind === 'cidr')
      for (const addr of addresses) {
        const c = canonicalTarget(addr)
        if (c.error) continue
        const ev = evaluate(c, scope.scope, {})
        if (ev.verdict === 'deny') { blocked = true; reason = `名前解決の結果（${addr}）が除外リスト（scope_deny）の「${ev.matched}」に一致します。`; break }
        if (ev.verdict === 'out' && hasIpPatterns && !warning) warning = `名前解決の結果（${addr}）が、スコープに登録した IP の範囲に入っていません。第三者のサービスを指していないか確認してください。`
      }
    }
    return { addresses, blocked, warning, reason }
  }

  /** 期限切れと、多すぎる分を捨てます。確認を待っているあいだの plan（launching）は、時間が過ぎても捨てません。 */
  function prunePlans() {
    const t = cfg.now().getTime()
    for (const [id, p] of plans) if (!p.launching && p.expires < t) plans.delete(id)
    for (const [id, p] of plans) {
      if (plans.size < MAX_PLANS) break
      if (!p.launching) plans.delete(id)
    }
  }

  const publicPlan = (planId, plan, dnsInfo, expires) => ({ planId, ...plan, vars: undefined, dns: dnsInfo, expiresAt: new Date(expires).toISOString() })

  /** 検証だけを行い、planId を発行します（起動はしません）。 */
  async function plan(eid, input = {}) {
    prunePlans()
    const jobId = `run-${cfg.now().getTime()}-${crypto.randomBytes(4).toString('hex')}`
    const { plan: p, hash, canon } = compute(eid, input, jobId)
    const dnsInfo = await resolveDns(p, canon)
    if (dnsInfo.blocked) { p.blocked = true; p.reasons.push(dnsInfo.reason); p.reason = p.reasons.join(' ') }
    const planId = crypto.randomBytes(16).toString('hex')
    const expires = cfg.now().getTime() + PLAN_TTL_MS
    plans.set(planId, { planId, eid, jobId, hash, expires, input: { slug: input.slug, cmdId: input.cmdId, values: input.values }, blocked: p.blocked })
    audit(eid, p.blocked ? 'blocked' : 'plan', auditFields(p, { reason: p.blocked ? p.reason : undefined }))
    return publicPlan(planId, p, dnsInfo, expires)
  }

  function auditFields(p, extra = {}) {
    return {
      jobId: p.jobId, target: p.target, program: p.program, programPath: p.programPath, argv: p.argv,
      scopeVerdict: p.scopeVerdict, agreed: p.agreed, inPeriod: p.inPeriod,
      templateHash: p.templateHash, scopeVersion: p.scopeVersion, ...extra,
    }
  }

  /* ---------------- 起動 ---------------- */

  const concurrency = () => cfg.concurrency || Math.max(1, Math.min(8, Number(readConfig().execConcurrency) || 2))
  const busyError = () => new ExecError(409, 'BUSY', `同時に実行できるのは ${concurrency()} 件までです。終わるのを待つか、停止してください。`)

  /**
   * plan を作り直して照合し、confirm（Electron のネイティブ確認）で承認されたときだけ起動します。
   * confirm は必須です。確認の手段を持たない呼び出しからは起動できません。
   */
  async function launch(eid, planId, { confirm } = {}) {
    if (typeof confirm !== 'function') throw new Error('launch には確認の手段（confirm）が必要です')
    const rec = plans.get(String(planId))
    const expired = () => new ExecError(409, 'PLAN_EXPIRED', '実行前の確認が古くなりました。もう一度、実行前の確認から進めてください。')
    if (!rec || rec.eid !== eid) throw expired()
    if (rec.launching) throw new ExecError(409, 'PLAN_BUSY', 'この実行は、いま確認の最中です。表示されている確認に答えてください。')
    if (rec.expires < cfg.now().getTime()) { plans.delete(rec.planId); throw expired() }
    if (slots >= concurrency()) throw busyError()
    slots++ // 確認を待つあいだも枠を押さえる
    rec.launching = true // 待っているあいだに、ほかの plan の整理で消されないようにする
    let released = false
    const release = () => { if (!released) { released = true; slots-- } }
    try {
      const recheck = () => {
        const r = compute(eid, rec.input, rec.jobId)
        if (r.hash !== rec.hash) throw new ExecError(409, 'PLAN_CHANGED', '確認したあとで条件が変わりました。もう一度、実行前の確認から進めてください。')
        if (r.plan.blocked) {
          audit(eid, 'blocked', auditFields(r.plan, { reason: r.plan.reason, stage: 'launch' }))
          throw new ExecError(403, 'BLOCKED', r.plan.reason, { plan: r.plan })
        }
        return r
      }
      const first = recheck()
      const dnsInfo = await resolveDns(first.plan, first.canon)
      if (dnsInfo.blocked) {
        audit(eid, 'blocked', auditFields(first.plan, { reason: dnsInfo.reason, stage: 'launch' }))
        throw new ExecError(403, 'BLOCKED', dnsInfo.reason)
      }
      const ok = await confirm(publicPlan(rec.planId, first.plan, dnsInfo, rec.expires))
      if (!ok) {
        audit(eid, 'cancelled', auditFields(first.plan))
        rec.launching = false
        release()
        return { ok: false, cancelled: true }
      }
      if (!plans.has(rec.planId)) throw expired()
      const second = recheck() // 確認を待つあいだに、スコープ・承認・期間が変わっていないか
      plans.delete(rec.planId)
      const job = start(eid, second, release)
      return { ok: true, jobId: job.id, job: publicJob(job) }
    } catch (err) {
      rec.launching = false
      release()
      throw err
    }
  }

  function start(eid, { plan: p, cmd }, release) {
    const runDir = path.join(secowlDir(eid), 'run', p.jobId)
    fs.mkdirSync(runDir, { recursive: true })
    if (p.outPath) captureDir(eid, { create: true })
    const job = {
      id: p.jobId, eid, slug: p.slug, cmdId: p.cmdId, label: p.label, toolName: p.toolName, phase: p.phase,
      program: p.program, programPath: p.programPath, argv: p.argv, target: p.target,
      scopeVerdict: p.scopeVerdict, agreed: p.agreed, inPeriod: p.inPeriod, templateHash: p.templateHash, scopeVersion: p.scopeVersion,
      outFormat: p.outFormat, outExt: cmd.out?.ext || null, timeoutSec: p.timeoutSec,
      status: 'running', startedAt: cfg.now().toISOString(), endedAt: null, durationMs: null, exitCode: null, signal: null,
      logId: null, logFile: null, outFile: null, outBytes: null, outputSha256: null, imported: null,
      // 以下は保存しない
      collector: new Collector(), child: null, stopRequested: false, timedOut: false, finalized: false,
      timers: {}, release, subscribers: new Set(),
    }
    job.finished = new Promise((resolve) => { job.resolveFinished = resolve })
    jobs.set(job.id, job)
    persist(job)
    audit(eid, 'launch', auditFields(p, { timeoutSec: p.timeoutSec }))

    let child
    try {
      child = spawn(p.programPath, p.argv, {
        shell: false, detached: true, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'], cwd: runDir, env: minimalEnv(),
      })
    } catch (err) {
      onSpawnError(job, err)
      return job
    }
    job.child = child
    child.on('error', (err) => onSpawnError(job, err))
    for (const [stream, name] of [[child.stdout, 'out'], [child.stderr, 'err']]) {
      stream.setEncoding('utf8')
      stream.on('data', (text) => job.collector.push(name, text))
      stream.on('error', () => { /* destroy 後の読み取りエラーは無視します */ })
    }
    child.on('exit', (code, signal) => onExit(job, code, signal))
    child.on('close', () => finalize(job))
    job.timers.timeout = setTimeout(() => {
      if (job.finalized || job.exited) return
      job.timedOut = true
      audit(eid, 'timeout', { jobId: job.id, timeoutSec: job.timeoutSec })
      terminate(job)
    }, job.timeoutSec * 1000)
    job.collector.listeners.add(() => notify(job))
    return job
  }

  /**
   * プロセスグループに信号を送ります。グループが空になった（ESRCH）と分かったら reaped を立て、以後は送りません。
   * pid は空になったあとで別のプロセスに再利用されうるため、終わったと分かったグループには撃ちません。
   */
  function killGroup(job, sig) {
    const pid = job.child?.pid
    if (!pid || job.reaped) return
    try { process.kill(-pid, sig) } catch (err) { if (err?.code === 'ESRCH') job.reaped = true }
  }

  /** SIGTERM を送り、猶予のあとにまだ動いていれば SIGKILL（どちらもプロセスグループごと）。 */
  function terminate(job) {
    killGroup(job, 'SIGTERM')
    clearTimeout(job.timers.kill)
    job.timers.kill = setTimeout(() => { if (!job.finalized) killGroup(job, 'SIGKILL') }, cfg.killGraceMs)
    job.timers.kill.unref?.()
  }

  function onSpawnError(job, err) {
    if (job.finalized) return
    job.spawnError = String(err?.message || err)
    job.collector.push('err', `${job.spawnError}\n`)
    audit(job.eid, 'spawn_error', { jobId: job.id, program: job.program, programPath: job.programPath, reason: job.spawnError })
    job.exited = true
    job.release()
    finalize(job)
  }

  function onExit(job, code, signal) {
    job.exited = true
    job.exitCode = code
    job.signal = signal
    clearTimeout(job.timers.timeout)
    job.release() // 枠は close ではなく先頭プロセスの exit で返す（孫が出力を握っていても詰まらせない）
    killGroup(job, 'SIGTERM')
    job.timers.drain = setTimeout(() => {
      job.child.stdout?.destroy()
      job.child.stderr?.destroy()
      killGroup(job, 'SIGKILL')
      finalize(job)
    }, cfg.drainMs)
  }

  async function finalize(job) {
    if (job.finalized) return
    job.finalized = true
    for (const t of Object.values(job.timers)) clearTimeout(t)
    killGroup(job, 'SIGKILL')
    job.reaped = true // 片付けたあとは、このグループには何も送らない
    job.release()
    job.collector.flush()
    job.endedAt = cfg.now().toISOString()
    job.durationMs = Math.max(0, new Date(job.endedAt) - new Date(job.startedAt))
    job.status = job.spawnError ? 'failed'
      : job.stopRequested ? 'stopped'
        : job.timedOut ? 'timeout'
          : job.exitCode === 0 ? 'done' : 'failed'

    try {
      // 出力ファイルの記録（サイズと SHA-256）
      if (job.outExt) {
        const abs = outAbsOf(job)
        if (abs && fs.existsSync(abs)) {
          const st = fs.statSync(abs)
          job.outFile = toPosix(path.relative(dataRoot(), abs))
          job.outBytes = st.size
          job.outputSha256 = await fileSha256(abs)
        }
      }
      // 保存するログは、端末の制御列を除いたあと、伏せ字にしてから書く
      const { text } = job.collector.logText()
      const redacted = redactHttp(text, REDACT_ALL)
      const notes = []
      if (job.outFile) notes.push(`生の出力ファイル: ${job.outFile}（伏せ字にしていません）`)
      if (redacted.hits.length) notes.push(`伏せ字にした項目: ${redacted.hits.map((h) => `${h.kind} ${h.count}`).join('、')}`)
      const log = createToolLog(job.eid, {
        tool: job.program,
        title: `${job.program} — ${job.label}`,
        phase: job.phase,
        command: publicJob(job).command,
        executed_at: stamp(job.startedAt),
        target: job.target,
        exit_code: job.exitCode === null ? (job.signal || '（なし）') : job.exitCode,
        duration_ms: job.durationMs,
        run_note: [STATUS_JA[job.status], ...notes].join(' / '),
        stdout: redacted.text,
      })
      job.logFile = log.file
      job.logId = log.id
    } catch (err) {
      job.logError = String(err?.message || err).slice(0, 300)
    }
    job.collector.releaseLogBuffers()
    persist(job)
    audit(job.eid, job.status === 'done' ? 'done' : 'failed', {
      jobId: job.id, target: job.target, program: job.program, status: job.status,
      exitCode: job.exitCode, signal: job.signal || undefined, durationMs: job.durationMs, outputSha256: job.outputSha256 || undefined,
      logFile: job.logFile || undefined,
    })
    job.settled = true
    notify(job, true)
    job.resolveFinished()
    evict()
  }

  const STATUS_JA = { done: '完了', failed: '失敗', stopped: '停止', timeout: '時間切れ' }

  function stamp(iso) {
    const d = new Date(iso)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  function fileSha256(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256')
      fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')))
    })
  }

  function evict() {
    const finished = [...jobs.values()].filter((j) => j.finalized)
    for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_IN_MEMORY))) jobs.delete(j.id)
  }

  /** 出力ファイルの場所は、記録された値ではなく jobId と拡張子から作り直します。 */
  function outAbsOf(job) {
    if (!JOB_ID_RE.test(job.id) || !job.outExt || !/^[a-z0-9]{1,8}$/.test(job.outExt)) return null
    return path.join(captureDir(job.eid, { create: false }), `${job.id}.${job.outExt}`)
  }

  /* ---------------- 記録と一覧 ---------------- */

  const PUBLIC_KEYS = [
    'id', 'eid', 'slug', 'cmdId', 'label', 'toolName', 'program', 'programPath', 'argv', 'command', 'target',
    'scopeVerdict', 'agreed', 'inPeriod', 'outFormat', 'outExt', 'timeoutSec', 'status', 'startedAt', 'endedAt',
    'durationMs', 'exitCode', 'signal', 'logId', 'logFile', 'outFile', 'outBytes', 'outputSha256', 'imported', 'logError',
  ]

  /**
   * 画面・job.json・ツール実行ログに出す形。argv は伏せ字にし、command も伏せ字済みの argv から作り直します
   * （command だけ元の文字列のままだと、同じ値が別の欄に平文で残るため）。
   */
  function publicJob(job) {
    const o = {}
    for (const k of PUBLIC_KEYS) o[k] = job[k] ?? null
    o.argv = Array.isArray(job.argv) ? job.argv.map((a) => redactHttp(a, REDACT_ARGV).text) : []
    o.command = displayCommand(job.programPath || job.program, o.argv)
    return o
  }

  function persist(job) {
    try {
      const dir = path.join(secowlDir(job.eid), 'run', job.id)
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'job.json')
      const tmp = `${file}.tmp-${process.pid}`
      fs.writeFileSync(tmp, JSON.stringify(publicJob(job), null, 2), { mode: 0o600 })
      fs.renameSync(tmp, file)
    } catch { /* 履歴を書けなくても実行そのものには影響させません */ }
  }

  function readJob(eid, jobId) {
    if (!JOB_ID_RE.test(jobId)) return null
    try {
      const j = JSON.parse(fs.readFileSync(path.join(secowlDir(eid), 'run', jobId, 'job.json'), 'utf8'))
      if (j && j.id === jobId && j.eid === eid) {
        // 実行中のまま残っていて、いまのプロセスに存在しない記録は、アプリが落ちたあとの残りです。
        if (j.status === 'running' && !jobs.has(jobId)) return { ...j, status: 'interrupted' }
        return j
      }
    } catch { /* 無い・壊れている */ }
    return null
  }

  function getJob(eid, jobId) {
    if (!JOB_ID_RE.test(jobId)) throw new ExecError(404, 'NO_JOB', 'その実行の記録はありません')
    const live = jobs.get(jobId)
    if (live && live.eid === eid) return live
    const saved = readJob(eid, jobId)
    if (!saved) throw new ExecError(404, 'NO_JOB', 'その実行の記録はありません')
    return saved
  }

  function list(eid) {
    const dir = path.join(secowlDir(eid), 'run')
    const out = new Map()
    try {
      for (const name of fs.readdirSync(dir)) {
        const j = readJob(eid, name)
        if (j) out.set(j.id, j)
      }
    } catch { /* まだ実行していない */ }
    for (const j of jobs.values()) if (j.eid === eid) out.set(j.id, publicJob(j))
    return [...out.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 100)
  }

  /* ---------------- 停止・終了 ---------------- */

  function stop(eid, jobId) {
    const job = jobs.get(jobId)
    if (!job || job.eid !== eid) {
      getJob(eid, jobId) // 記録があれば「すでに終了」、なければ 404
      throw new ExecError(409, 'NOT_RUNNING', 'この実行はすでに終わっています')
    }
    if (job.finalized) throw new ExecError(409, 'NOT_RUNNING', 'この実行はすでに終わっています')
    if (!job.stopRequested) {
      job.stopRequested = true
      audit(eid, 'stop', { jobId: job.id, target: job.target, program: job.program })
    }
    terminate(job)
    return publicJob(job)
  }

  /** アプリの終了時。実行中のものを止め、終わるのを待ってから返します（待つのは最長 waitMs）。 */
  async function killAll({ waitMs = 5000 } = {}) {
    const live = [...jobs.values()].filter((j) => !j.finalized)
    for (const j of live) {
      if (!j.stopRequested) { j.stopRequested = true; audit(j.eid, 'stop', { jobId: j.id, target: j.target, program: j.program, reason: 'アプリの終了' }) }
      terminate(j)
    }
    if (!live.length) return { stopped: 0 }
    await Promise.race([Promise.all(live.map((j) => j.finished)), new Promise((r) => { const t = setTimeout(r, waitMs); t.unref?.() })])
    for (const j of live) if (!j.finalized) { killGroup(j, 'SIGKILL'); j.child?.stdout?.destroy(); j.child?.stderr?.destroy(); finalize(j) }
    await Promise.race([Promise.all(live.map((j) => j.finished)), new Promise((r) => { const t = setTimeout(r, 1000); t.unref?.() })])
    return { stopped: live.length }
  }

  /** 同期の最後の手段（プロセスの exit 時）。実行中のものすべてのグループに SIGKILL を送ります。 */
  function killNow() {
    for (const j of jobs.values()) if (!j.finalized) killGroup(j, 'SIGKILL')
  }

  /* ---------------- ライブ出力（NDJSON のストリーム） ---------------- */

  function notify(job, ended = false) {
    for (const sub of job.subscribers) sub.schedule(ended)
  }

  /**
   * 出力を 1 行 1 JSON で res に流します。チャンクには通し番号が付き、after 以降だけを送ります（再接続用）。
   * 書き込みが詰まったら drain まで止め、未送信が 256KB を超えたら切ります（クライアントは after を付けて再接続）。
   */
  function stream(eid, jobId, req, res, { after = 0 } = {}) {
    const job = getJob(eid, jobId)
    const live = jobs.get(jobId)
    if (live && live.subscribers.size >= MAX_SUBSCRIBERS) throw new ExecError(409, 'TOO_MANY', 'このジョブを同時に見られるのは 4 つまでです')
    res.status(200)
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.flushHeaders?.()
    const send = (obj) => res.write(`${JSON.stringify(obj)}\n`)
    if (!live) { send({ t: 'start', job: publicJobAny(job) }); send({ t: 'end', job: publicJobAny(job) }); return res.end() }

    let last = Number(after) || 0
    let waiting = false
    let timer = null
    let closed = false
    send({ t: 'start', job: publicJob(live) })

    const sub = {
      schedule: (ended) => {
        if (closed) return
        if (ended) { clearTimeout(timer); timer = null; flush(); return }
        if (!timer) timer = setTimeout(flush, BATCH_MS)
      },
    }
    function close() {
      if (closed) return
      closed = true
      clearTimeout(timer)
      clearInterval(hb)
      live.subscribers.delete(sub)
    }
    function flush() {
      timer = null
      if (closed) return
      const { ring } = live.collector
      const fresh = ring.filter((c) => c.seq > last)
      if (waiting) {
        const backlog = fresh.reduce((n, c) => n + c.b, 0)
        if (backlog > MAX_BACKLOG_BYTES) { send({ t: 'overflow', after: last }); close(); res.end() }
        return
      }
      let ok = true
      if (fresh.length && fresh[0].seq > last + 1 && ring.length) send({ t: 'gap', from: last + 1, to: fresh[0].seq - 1 })
      for (const c of fresh) {
        ok = res.write(`${JSON.stringify({ t: 'c', seq: c.seq, s: c.s, x: c.x })}\n`)
        last = c.seq
      }
      if (live.settled && last >= live.collector.nextSeq - 1) {
        send({ t: 'end', job: publicJob(live) })
        close()
        res.end()
        return
      }
      if (!ok) { waiting = true; res.once('drain', () => { waiting = false; flush() }) }
    }
    const hb = setInterval(() => { if (!closed && !waiting) send({ t: 'hb' }) }, HEARTBEAT_MS)
    hb.unref?.()
    live.subscribers.add(sub)
    req.on('close', close)
    res.on('error', close)
    flush()
    if (live.settled) flush()
  }

  const publicJobAny = (j) => (j.collector ? publicJob(j) : j)

  /* ---------------- 取り込み ---------------- */

  function importJob(eid, jobId, { dryRun = true, importFindings = true } = {}) {
    const job = getJob(eid, jobId)
    if (job.status === 'running') throw new ExecError(409, 'RUNNING', 'まだ実行中です。終わってから取り込んでください')
    if (!job.outFormat || !job.outExt) throw new ExecError(422, 'NO_OUTPUT', 'このコマンドには取り込める出力がありません')
    const abs = outAbsOf(job)
    if (!abs || !fs.existsSync(abs)) throw new ExecError(404, 'NO_OUTPUT_FILE', '出力ファイルがありません')
    const real = fs.realpathSync(abs)
    if (!real.startsWith(fs.realpathSync(engDir(eid)) + path.sep)) throw new ExecError(403, 'OUTSIDE', '出力先が診断対象のフォルダの外を指しています')
    const st = fs.statSync(real)
    if (st.size > MAX_IMPORT_BYTES) throw new ExecError(413, 'TOO_LARGE', '出力が大きすぎて取り込めません（50MB まで）')
    const parsed = parseToolOutput(fs.readFileSync(real, 'utf8'), job.outFormat)
    const result = importIntoEngagement(eid, parsed, { dryRun, importFindings })
    if (!dryRun) {
      audit(eid, 'import', {
        jobId, target: job.target, program: job.program,
        surfaces: result.surfaces.created.length, findings: result.findings.created.length,
      })
      const live = jobs.get(jobId)
      if (live) { live.imported = { at: cfg.now().toISOString(), surfaces: result.surfaces.created.length, findings: result.findings.created.length }; persist(live) }
      else {
        try {
          const f = path.join(secowlDir(eid), 'run', jobId, 'job.json')
          const j = JSON.parse(fs.readFileSync(f, 'utf8'))
          j.imported = { at: cfg.now().toISOString(), surfaces: result.surfaces.created.length, findings: result.findings.created.length }
          fs.writeFileSync(f, JSON.stringify(j, null, 2), { mode: 0o600 })
        } catch { /* 記録できなくても取り込み自体は済んでいます */ }
      }
    }
    return result
  }

  /* ---------------- テンプレートの一覧 ---------------- */

  function listTemplates() {
    return toolEntries().map((t) => ({
      slug: t.slug, name: t.name, icon: t.icon || '', phase: t.phase || [],
      commands: t.commands.map((c) => {
        const p = cfg.allowed.has(c.program) ? resolveProgram(c.program) : { found: false }
        return {
          ...c, available: !!(p.found && !p.unsafe), programPath: p.found ? p.path : null,
          unavailableKind: p.found ? (p.unsafe ? 'unsafe' : null) : 'missing',
          unavailableReason: p.found ? p.unsafe || null : p.error || null,
        }
      }),
    }))
  }

  /** テスト用の差し替え口。同じプロセスのコードからだけ呼べます（HTTP・環境変数からは届きません）。 */
  function configure(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in cfg)) throw new Error(`未知の設定です: ${k}`)
      cfg[k] = v
    }
    if (patch.templates !== undefined && patch.templates === null) cfg.templates = null
  }

  return {
    plan, launch, stop, stream, list, getJob, importJob, listTemplates, killAll, killNow, audit, verifyAudit, configure,
    resolveProgram, minimalEnv, publicJob,
    /** テスト用 */
    _state: () => ({ slots, jobs: jobs.size, plans: plans.size }),
  }
}

export { parseCommands }
