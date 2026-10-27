import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { APP_ROOT, readConfig } from './config.js'
import { READ_TOOLS, WRITE_TOOLS } from '../../mcp/tools.js'

/**
 * 配布した .app から起動しているかを返します。.app の中に node は入っていないうえ、
 * 受け取った人の Mac に node があるとも限りません。
 */
function insideAppBundle() {
  return Boolean(process.versions.electron) && APP_ROOT.includes('.app/Contents/Resources/')
}

/** MCP クライアントへ書く node のパスを決めます。見つからなければ 'node' を返します。 */
function resolveNode() {
  // .app の Electron 本体を ELECTRON_RUN_AS_NODE=1 で起動すると、同梱の Node.js として動きます。
  if (insideAppBundle()) return process.execPath
  // Electron から起動した場合、process.execPath は Electron 本体を指すため使えません。
  if (!process.versions.electron && process.execPath && /node(\.exe)?$/.test(process.execPath)) {
    return process.execPath
  }
  for (const cmd of [['which', 'node'], ['command', '-v', 'node']]) {
    try {
      const out = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8' }).trim().split('\n')[0]
      if (out && fs.existsSync(out)) return out
    } catch { /* 次の方法を試します */ }
  }
  return 'node'
}

/** 設定画面に出す MCP 連携の情報をまとめます。 */
export function mcpInfo() {
  const cfg = readConfig()
  const serverPath = path.join(APP_ROOT, 'mcp', 'server.js')
  const node = resolveNode()
  const asNode = insideAppBundle()

  const entry = (readOnly) => ({
    command: node,
    args: [serverPath],
    env: {
      ...(asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      SECOWL_DATA: cfg.dataRoot,
      ...(readOnly ? { SECOWL_MCP_READONLY: '1' } : {}),
    },
  })

  const desktopConfig = (readOnly) =>
    JSON.stringify({ mcpServers: { secowl: entry(readOnly) } }, null, 2)

  const codeCommand = (readOnly) => {
    const env = [...(asNode ? ['-e ELECTRON_RUN_AS_NODE=1'] : []), `-e SECOWL_DATA=${cfg.dataRoot}`, ...(readOnly ? ['-e SECOWL_MCP_READONLY=1'] : [])].join(' ')
    return `claude mcp add secowl ${env} -- ${node} ${serverPath}`
  }

  const tool = (t, write) => ({
    name: t.name,
    title: t.config.title || t.name,
    description: t.config.description || '',
    write,
  })

  return {
    serverPath,
    node,
    dataRoot: cfg.dataRoot,
    exists: fs.existsSync(serverPath),
    desktopConfig: desktopConfig(false),
    desktopConfigReadOnly: desktopConfig(true),
    codeCommand: codeCommand(false),
    codeCommandReadOnly: codeCommand(true),
    desktopConfigPath: process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
        : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
    tools: [...READ_TOOLS.map((t) => tool(t, false)), ...WRITE_TOOLS.map((t) => tool(t, true))],
  }
}
