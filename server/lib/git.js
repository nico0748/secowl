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
  return {
    isRepo: true,
    root: cwd,
    branch: branchOut.trim(),
    changes,
    hasGitignore: fs.existsSync(path.join(cwd, '.gitignore')),
  }
}

export async function init({ trackEvidence = false } = {}) {
  const cwd = dataRoot()
  if (!fs.existsSync(path.join(cwd, '.git'))) await git(['init', '-b', 'main'], cwd)
  const file = path.join(cwd, '.gitignore')
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, GITIGNORE_BASE + (trackEvidence ? '' : GITIGNORE_EVIDENCE), 'utf8')
  }
  return status()
}

export async function commit({ message }) {
  const cwd = dataRoot()
  if (!message || !message.trim()) throw new Error('コミットメッセージを入力してください')
  if (!fs.existsSync(path.join(cwd, '.git'))) throw new Error('保存先がまだ Git リポジトリではありません')
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
