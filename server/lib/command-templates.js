import crypto from 'node:crypto'
import { canonicalTarget, parsePortList } from '../../shared/scope.js'

/**
 * コマンドテンプレート（knowledge/tools/*.md の frontmatter の commands:）の検査と、変数の値の検査です。
 * 自由な文章は解析せず、明示した形式だけを読み込みます。検査は読み込み時に 1 度行い、通らないものは一覧に出しません。
 *
 *   commands:
 *     - id: nmap-detail
 *       label: サービス/バージョン詳細（-sV -sC）
 *       program: nmap                      # allow-list のキー（絶対パスは不可）
 *       args: ["-sV", "-sC", "-p", "{{ports}}", "-oX", "{{out}}", "{{target}}"]
 *       out: { format: nmap, ext: xml }    # {{out}} を使うときだけ。format は取り込みの形式（省略可）
 *       vars:
 *         - { name: target, kind: target, required: true, accept: [host, ip] }
 *         - { name: ports,  kind: ports,  default: "80,443" }
 *       timeout_sec: 600
 *
 * 引数の 1 要素は「そのままの文字列」か「{{変数}} 1 つだけ」です（-p{{ports}} のような連結は認めません）。
 */

/** 実行を許すプログラム。sudo は入れません。curl は file:// や -K などで面が広いため入れません。 */
export const ALLOWED = Object.freeze(new Set([
  'nmap', 'httpx', 'nuclei', 'ffuf', 'gobuster', 'subfinder', 'amass', 'dnsx', 'naabu', 'whatweb', 'gau', 'katana',
]))

export const VAR_KINDS = ['target', 'ports', 'text']
export const TARGET_ACCEPT = ['host', 'ip', 'url', 'hostport']
export const OUT_FORMATS = ['nmap', 'httpx', 'nuclei', 'subdomains', 'ffuf', 'gobuster']
export const DEFAULT_TIMEOUT_SEC = 300
export const MAX_TIMEOUT_SEC = 1800

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const VAR_RE = /^[a-z_]{1,32}$/
const EXT_RE = /^[a-z0-9]{1,8}$/
const TOKEN_VAR = /^\{\{([a-z_]{1,32})\}\}$/
// text 型の既定の禁止: 空白・改行、シェルのメタ文字、引用符、バックスラッシュ、ワイルドカード。
const TEXT_FORBIDDEN = /[\s;|&$`(){}<>"'\\*?!]/
const CTRL = /[\u0000-\u001f\u007f-\u009f]/

const KEYS = {
  command: ['id', 'label', 'program', 'args', 'out', 'vars', 'timeout_sec'],
  out: ['format', 'ext'],
  var: ['name', 'kind', 'required', 'default', 'pattern', 'label', 'hint', 'accept'],
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** 変数の値を検査して、引数に入れる文字列にします。→ { value } か { error } */
export function checkValue(def, raw) {
  if (raw === undefined || raw === null || raw === '') {
    if (def.required) return { error: `「${def.label || def.name}」を入力してください` }
    return { value: '' }
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') return { error: `「${def.label || def.name}」は文字列で指定してください` }
  const text = String(raw)
  if (text.length > 2048) return { error: `「${def.label || def.name}」は 2048 文字までです` }
  if (CTRL.test(text)) return { error: `「${def.label || def.name}」に制御文字は使えません` }
  let out
  if (def.kind === 'target') {
    const c = canonicalTarget(text)
    if (c.error) return { error: c.error }
    const accept = def.accept || TARGET_ACCEPT
    const form = (c.kind === 'host' || c.kind === 'ip') && c.portExplicit ? 'hostport' : c.kind
    if (!accept.includes(form)) {
      const names = { host: 'ホスト名', ip: 'IP アドレス', url: 'URL', hostport: 'ホスト:ポート' }
      return { error: `このコマンドで使える対象の形は ${accept.map((a) => names[a]).join('・')} です` }
    }
    return { value: c.value, canon: c }
  }
  if (def.kind === 'ports') {
    const p = parsePortList(text)
    if (p.error) return { error: p.error }
    if (!p.ranges.length) return { error: `「${def.label || def.name}」を入力してください` }
    if (p.ranges.length > 64) return { error: 'ポートの指定が多すぎます（64 件まで）' }
    out = p.ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(',')
    return { value: out, ranges: p.ranges }
  }
  // text
  const s = text.normalize('NFKC')
  if (TEXT_FORBIDDEN.test(s)) return { error: `「${def.label || def.name}」に使えない文字（空白・; | & $ ( ) { } < > 引用符など）が含まれています` }
  if (def.pattern && !new RegExp(`^(?:${def.pattern})$`).test(s)) return { error: `「${def.label || def.name}」の形式が正しくありません` }
  return { value: s }
}

/** 変数の値が - で始まっていないか（コマンドのオプションとして解釈されるため、種類を問わず拒否します）。 */
export function startsWithDash(value) {
  return typeof value === 'string' && value.startsWith('-')
}

function validateVar(v, idx, errors) {
  const where = `vars[${idx}]`
  if (!isObj(v)) { errors.push(`${where}: オブジェクトで書いてください`); return null }
  for (const k of Object.keys(v)) if (!KEYS.var.includes(k)) errors.push(`${where}: 未知のキー ${k}`)
  if (typeof v.name !== 'string' || !VAR_RE.test(v.name)) errors.push(`${where}: name は ^[a-z_]{1,32}$ にしてください`)
  else if (v.name === 'out') errors.push(`${where}: out は予約名です`)
  if (!VAR_KINDS.includes(v.kind)) errors.push(`${where}: kind は ${VAR_KINDS.join(' / ')} のどれかにしてください`)
  if (v.required !== undefined && typeof v.required !== 'boolean') errors.push(`${where}: required は true / false にしてください`)
  // 引数は 1 トークン = 1 変数なので、空のまま省くことができない。既定値で埋まらない任意の変数は書けない。
  if (v.required === false && v.default === undefined) errors.push(`${where}: 任意の変数（required: false）には default が必要です（空のまま引数を省く書き方はありません）`)
  if (v.pattern !== undefined) {
    if (v.kind !== 'text') errors.push(`${where}: pattern は text 型だけで使えます`)
    else { try { new RegExp(`^(?:${v.pattern})$`) } catch { errors.push(`${where}: pattern が正規表現として正しくありません`) } }
  }
  if (v.accept !== undefined) {
    if (v.kind !== 'target') errors.push(`${where}: accept は target 型だけで使えます`)
    else if (!Array.isArray(v.accept) || !v.accept.length || v.accept.some((a) => !TARGET_ACCEPT.includes(a))) errors.push(`${where}: accept は ${TARGET_ACCEPT.join(' / ')} の一覧にしてください`)
  }
  for (const k of ['label', 'hint']) if (v[k] !== undefined && typeof v[k] !== 'string') errors.push(`${where}: ${k} は文字列にしてください`)
  if (v.default !== undefined && v.kind === 'target') errors.push(`${where}: target に既定値は付けられません`)
  if (v.default !== undefined && v.kind !== 'target' && !errors.some((e) => e.startsWith(where))) {
    const def = { ...v, required: true }
    const r = checkValue(def, typeof v.default === 'number' ? String(v.default) : v.default)
    if (r.error) errors.push(`${where}: default が検査を通りません（${r.error}）`)
    else if (startsWithDash(r.value)) errors.push(`${where}: default は - で始められません`)
  }
  return v
}

/**
 * 1 つのコマンドを検査します。→ { ok, errors, command }
 * command は検査済みの正規形（hash はこの形から作ります）。allowed は許可するプログラム名の Set。
 */
export function validateCommand(raw, { allowed = ALLOWED } = {}) {
  const errors = []
  if (!isObj(raw)) return { ok: false, errors: ['コマンドはオブジェクトで書いてください'], command: null }
  for (const k of Object.keys(raw)) if (!KEYS.command.includes(k)) errors.push(`未知のキー ${k}`)

  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) errors.push('id は英小文字・数字・ハイフンで 64 文字までにしてください')
  if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 120) errors.push('label は 1〜120 文字の文字列にしてください')
  if (typeof raw.program !== 'string' || !allowed.has(raw.program)) errors.push(`program「${raw.program}」は実行を許可したプログラムではありません`)

  const timeout = raw.timeout_sec === undefined ? DEFAULT_TIMEOUT_SEC : raw.timeout_sec
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_SEC) errors.push(`timeout_sec は 1〜${MAX_TIMEOUT_SEC} の整数にしてください`)

  let out = null
  if (raw.out !== undefined) {
    if (!isObj(raw.out)) errors.push('out はオブジェクトで書いてください')
    else {
      for (const k of Object.keys(raw.out)) if (!KEYS.out.includes(k)) errors.push(`out: 未知のキー ${k}`)
      if (typeof raw.out.ext !== 'string' || !EXT_RE.test(raw.out.ext)) errors.push('out.ext は ^[a-z0-9]{1,8}$ にしてください')
      if (raw.out.format !== undefined && !OUT_FORMATS.includes(raw.out.format)) errors.push(`out.format は ${OUT_FORMATS.join(' / ')} のどれかにしてください`)
      out = { ...(raw.out.format ? { format: raw.out.format } : {}), ext: raw.out.ext }
    }
  }

  const vars = []
  if (!Array.isArray(raw.vars)) errors.push('vars は一覧で書いてください（対象の変数が必要です）')
  else {
    raw.vars.forEach((v, i) => { const ok = validateVar(v, i, errors); if (ok) vars.push(ok) })
    const names = vars.map((v) => v.name)
    if (new Set(names).size !== names.length) errors.push('vars の name が重複しています')
    const targets = vars.filter((v) => v.kind === 'target')
    if (targets.length !== 1) errors.push('kind: target の変数がちょうど 1 つ必要です（スコープの判定に使います）')
    else if (targets[0].required !== true) errors.push('target の変数は required: true にしてください')
  }

  const args = []
  let outCount = 0
  const used = new Set()
  if (!Array.isArray(raw.args) || raw.args.length === 0) errors.push('args は 1 つ以上の文字列の一覧にしてください')
  else {
    raw.args.forEach((tok, i) => {
      const where = `args[${i}]`
      if (typeof tok !== 'string' || tok === '') { errors.push(`${where}: 空でない文字列にしてください`); return }
      args.push(tok)
      const m = TOKEN_VAR.exec(tok)
      if (m) {
        if (m[1] === 'out') outCount++
        else if (!vars.some((v) => v.name === m[1])) errors.push(`${where}: {{${m[1]}}} が vars に定義されていません`)
        else used.add(m[1])
        return
      }
      if (tok.includes('{{') || tok.includes('}}')) errors.push(`${where}: {{変数}} は 1 要素に単独で書いてください（連結は不可）`)
      if (tok.includes('\0')) errors.push(`${where}: NUL は使えません`)
      if (tok.startsWith('/') || /^[A-Za-z]:[\\/]/.test(tok)) errors.push(`${where}: 絶対パスは書けません`)
      if (tok.split(/[\\/]/).includes('..')) errors.push(`${where}: .. は書けません`)
    })
  }
  if (outCount > 1) errors.push('{{out}} は 1 回だけ使えます')
  if (outCount === 1 && !out) errors.push('{{out}} を使うときは out: { ext } が必要です')
  if (outCount === 0 && out) errors.push('out を書いたときは args に {{out}} が必要です')
  for (const v of vars) if (!used.has(v.name)) errors.push(`変数 ${v.name} が args で使われていません`)

  const command = errors.length ? null : {
    id: raw.id,
    label: raw.label.trim(),
    program: raw.program,
    args,
    out,
    vars: vars.map((v) => ({
      name: v.name, kind: v.kind, required: v.required === true || v.default === undefined,
      ...(v.default !== undefined ? { default: String(v.default) } : {}),
      ...(v.pattern ? { pattern: v.pattern } : {}),
      ...(v.label ? { label: v.label } : {}),
      ...(v.hint ? { hint: v.hint } : {}),
      ...(v.accept ? { accept: [...v.accept] } : {}),
    })),
    timeout_sec: timeout,
  }
  return { ok: errors.length === 0, errors, command }
}

/** 1 つのページの commands を検査します。通ったものだけ返し、通らなかった理由は errors に残します。 */
export function parseCommands(raw, { allowed = ALLOWED } = {}) {
  if (raw === undefined || raw === null) return { commands: [], errors: [] }
  if (!Array.isArray(raw)) return { commands: [], errors: ['commands は一覧で書いてください'] }
  const commands = []
  const errors = []
  const seen = new Set()
  raw.forEach((item, i) => {
    const r = validateCommand(item, { allowed })
    const id = isObj(item) && typeof item.id === 'string' ? item.id : `#${i + 1}`
    if (r.ok && seen.has(r.command.id)) { errors.push(`${id}: id が重複しています`); return }
    if (!r.ok) { for (const e of r.errors) errors.push(`${id}: ${e}`); return }
    seen.add(r.command.id)
    commands.push({ ...r.command, hash: templateHash(r.command) })
  })
  return { commands, errors }
}

/** テンプレートの内容の指紋。plan に結び付け、起動前に差し替えられていないことを確かめます。 */
export function templateHash(command) {
  const { hash: _ignored, ...rest } = command
  return crypto.createHash('sha256').update(JSON.stringify(rest), 'utf8').digest('hex').slice(0, 16)
}
