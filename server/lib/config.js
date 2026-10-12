import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = path.resolve(__dirname, '..', '..')
export const TEMPLATE_DIR = path.join(APP_ROOT, 'templates')

/**
 * 設定ファイルと既定の保存先は環境変数で差し替えられます。
 * Electron から起動するときは、書き込めるユーザーフォルダを指すように上書きします。
 */
export const CONFIG_PATH = process.env.SECOWL_CONFIG
  ? path.resolve(process.env.SECOWL_CONFIG)
  : path.join(APP_ROOT, 'secowl.config.json')

const DEFAULT_DATA_ROOT = process.env.SECOWL_DEFAULT_DATA || path.join(APP_ROOT, 'data')

function expandHome(p) {
  if (!p) return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function readConfig() {
  let cfg = {}
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    } catch {
      cfg = {}
    }
  }
  const fromEnv = process.env.SECOWL_DATA
  const raw = fromEnv || cfg.dataRoot || DEFAULT_DATA_ROOT
  return {
    ...cfg,
    dataRoot: path.resolve(expandHome(raw)),
    dataRootSource: fromEnv ? 'env' : cfg.dataRoot ? 'config' : 'default',
    port: Number(process.env.PORT || cfg.port || 5174),
  }
}

export function writeConfig(patch) {
  let cfg = {}
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    } catch {
      cfg = {}
    }
  }
  const next = { ...cfg, ...patch }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return readConfig()
}

export function dataRoot() {
  const root = readConfig().dataRoot
  fs.mkdirSync(root, { recursive: true })
  return root
}
