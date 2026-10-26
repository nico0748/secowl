import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { dataRoot } from './config.js'

const run = promisify(execFile)

async function git(args, cwd) {
  try {
    const { stdout } = await run('git', ['-c', 'core.quotepath=false', ...args], { cwd, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const msg = String(err.stderr || err.message || err).trim()
    if (/ENOENT/.test(msg)) throw new Error('git が見つかりません。インストールして PATH を通してください。')
    throw new Error(msg)
  }
}

const GITIGNORE_BASE = `# SecOwl — 保存先リポジトリ

# OS が作るファイル
.DS_Store
Thumbs.db

# エディタの一時ファイル
*.swp
*~
.obsidian/workspace*
`

const GITIGNORE_EVIDENCE = `
# 証跡（画像にマスキング漏れが残る恐れがあるため既定で追跡しません）
*/evidence/
`

// アプリから実行したツールの生の出力と、実行の作業場所。伏せていない資格情報が入りうるため、証跡の扱いに関係なく追跡しません。
const RAW_RULES = ['*/20-調査/取得データ/', '*/.secowl/run/']
const GITIGNORE_RAW = `
# ツールの生の出力と実行の作業場所（Cookie やトークンを伏せていません）
${RAW_RULES.join('\n')}
`

function ignoreLines(cwd) {
  try { return fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()) } catch { return null }
}

/** 書かれていない、追跡させないための行。.gitignore が無ければすべて。 */
function missingRules(cwd) {
  const lines = ignoreLines(cwd)
  return lines ? RAW_RULES.filter((r) => !lines.includes(r)) : [...RAW_RULES]
}

/**
 * .gitignore が無ければ作り、あれば足りない行だけを末尾に足します（利用者が書いた行は触りません）。
 * 以前のバージョンで作った保存先や、自分で git init した保存先でも、生の出力が git add -A に乗らないようにするためです。
 */
function ensureIgnore(cwd, { trackEvidence = false } = {}) {
  // .gitignore を読めない・書けない保存先でも、init と commit 自体は進められるようにします。
  // 足りない行は status の ignoreMissing に出るので、設定画面から直せます。
  try {
    const file = path.join(cwd, '.gitignore')
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, GITIGNORE_BASE + (trackEvidence ? '' : GITIGNORE_EVIDENCE) + GITIGNORE_RAW, 'utf8')
      return
    }
    const missing = missingRules(cwd)
    if (!missing.length) return
    const cur = fs.readFileSync(file, 'utf8')
    fs.appendFileSync(file, `${cur === '' || cur.endsWith('\n') ? '' : '\n'}\n# ツールの生の出力と実行の作業場所（SecOwl が追記）\n${missing.join('\n')}\n`, 'utf8')
  } catch { /* 追記できなくても Git の操作は続けます */ }
}

export async function status() {
  const cwd = dataRoot()
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { isRepo: false, hasGitignore: fs.existsSync(path.join(cwd, '.gitignore')), root: cwd }
  }
  const [branchOut, statusOut] = await Promise.all([
    git(['symbolic-ref', '--short', 'HEAD'], cwd).catch(() => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).catch(() => '(不明)\n')),
    git(['status', '--porcelain=v1', '-uall'], cwd),
  ])
  const changes = statusOut
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2).trim() || '??', path: line.slice(3).replace(/^"|"$/g, '') }))
  // すでに追跡されている生の出力は、.gitignore を直しても追跡されたまま（履歴からは外さないと残る）
  const tracked = await git(['ls-files'], cwd).catch(() => '')
  const rawTracked = tracked.split('\n').filter((f) => /(^|\/)20-調査\/取得データ\/|(^|\/)\.secowl\/run\//.test(f)).length
  return {
    isRepo: true,
    root: cwd,
    branch: branchOut.trim(),
    changes,
    hasGitignore: fs.existsSync(path.join(cwd, '.gitignore')),
    ignoreMissing: missingRules(cwd),
    rawTracked,
  }
}

export async function init({ trackEvidence = false } = {}) {
  const cwd = dataRoot()
  if (!fs.existsSync(path.join(cwd, '.git'))) await git(['init', '-b', 'main'], cwd)
  ensureIgnore(cwd, { trackEvidence })
  return status()
}

export async function commit({ message }) {
  const cwd = dataRoot()
  if (!message || !message.trim()) throw new Error('コミットメッセージを入力してください')
  if (!fs.existsSync(path.join(cwd, '.git'))) throw new Error('保存先がまだ Git リポジトリではありません')
  ensureIgnore(cwd) // 生の出力を add -A に乗せないため、足りない行はここでも足す
  await git(['add', '-A'], cwd)
  const staged = await git(['diff', '--cached', '--name-only'], cwd)
  if (!staged.trim()) throw new Error('コミットする変更がありません')
  await git(['commit', '-m', message], cwd)
  return status()
}

export async function log(limit = 15) {
  const cwd = dataRoot()
  if (!fs.existsSync(path.join(cwd, '.git'))) return []
  const out = await git(['log', `-${Math.min(Math.max(limit, 1), 100)}`, '--pretty=format:%h\x1f%an\x1f%ad\x1f%s', '--date=short'], cwd)
    .catch(() => '')
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, subject] = line.split('\x1f')
      return { hash, author, date, subject }
    })
}
