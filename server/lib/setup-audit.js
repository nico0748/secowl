import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { dataRoot } from './config.js'
import { lastLineOf } from './exec.js'

/**
 * 環境構築（権限の修正と導入の実行）の記録。
 *
 * 実行の記録（診断対象ごとの audit.jsonl）と同じく、各行に前の行の SHA-256 を持たせます。
 * 権限の修正と導入の実行の両方がここへ書くため、つながりが崩れないよう書き手をこの 1 か所にまとめています。
 */

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

/** 保存先の直下の .secowl/（診断対象の一覧には出ません）。 */
export function setupDir() {
  const dir = path.join(dataRoot(), '.secowl')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function setupAuditFile() {
  return path.join(setupDir(), 'setup.jsonl')
}

/** 追記専用の記録。 */
export function appendSetupAudit(event, entry = {}, at = new Date()) {
  const file = setupAuditFile()
  const last = lastLineOf(file)
  const prev = last ? sha256(last) : ''
  const line = JSON.stringify({ ts: at.toISOString(), event, source: 'ui', ...entry, prev })
  fs.appendFileSync(file, `${line}\n`, { mode: 0o600 })
  return JSON.parse(line)
}

export function readSetupAudit(limit = 20) {
  let lines = []
  try { lines = fs.readFileSync(setupAuditFile(), 'utf8').split('\n').filter(Boolean) } catch { /* まだありません */ }
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
