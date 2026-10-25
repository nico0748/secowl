import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './seed.mjs'

/**
 * コマンドランナーのテスト用の土台。本物のネットワークツールは一切起動せず、
 * test/helpers/fake-tool.cjs を呼ぶだけの実行ファイル（fakenmap など）を一時フォルダに作って使います。
 */
export const FAKE_PROGRAMS = ['fakenmap', 'fakehttpx']

export function makeBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-bin-'))
  fs.chmodSync(dir, 0o700)
  for (const name of FAKE_PROGRAMS) {
    const file = path.join(dir, name)
    fs.writeFileSync(file, `#!${process.execPath}\nrequire(${JSON.stringify(path.join(ROOT, 'test', 'helpers', 'fake-tool.cjs'))})\n`, { mode: 0o755 })
    fs.chmodSync(file, 0o755)
  }
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 片付けに失敗しても結果は変えません */ } })
  return dir
}

const cmd = (id, extra) => ({
  id, label: `テスト ${id}`, program: 'fakenmap', timeout_sec: 60,
  vars: [{ name: 'target', kind: 'target', required: true, label: '対象' }],
  ...extra,
})

/** parseCommands を通す前の素のテンプレート（フロントマターに書く形）。 */
export const RAW_COMMANDS = [
  cmd('echo', { args: ['--echo-env', '--secret', '-oX', '{{out}}', '{{target}}'], out: { format: 'nmap', ext: 'xml' } }),
  cmd('plain', { args: ['{{target}}'] }),
  cmd('slow', { args: ['--hold', '30', '--grandchild', '30', '{{target}}'] }),
  cmd('timeout', { args: ['--hold', '30', '--grandchild', '30', '{{target}}'], timeout_sec: 1 }),
  cmd('orphan', { args: ['--detached-grandchild', '10', '{{target}}'] }),
  cmd('stubborn', { args: ['--hold', '30', '--grandchild', '30', '--stubborn', '{{target}}'] }),
  cmd('noisy', { args: ['--noisy', '2600', '{{target}}'] }),
  cmd('splitsecret', { args: ['--splitsecret', '{{target}}'] }),
  cmd('longline', { args: ['--longline', '200000', '{{target}}'] }),
  cmd('cutjwt', { args: ['--cutjwt', '{{target}}'] }),
  cmd('fail', { args: ['--exit', '3', '{{target}}'] }),
  cmd('text', {
    args: ['--echo-env', '{{word}}', '{{target}}'],
    vars: [
      { name: 'target', kind: 'target', required: true },
      { name: 'word', kind: 'text', required: true, label: '語' },
    ],
  }),
  cmd('ports', {
    args: ['-p', '{{ports}}', '{{target}}'],
    vars: [
      { name: 'target', kind: 'target', required: true },
      { name: 'ports', kind: 'ports', required: true, default: '443' },
    ],
  }),
]
