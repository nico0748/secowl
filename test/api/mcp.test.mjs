// accept.sh の「mcp check-mcp.mjs」の移植です。stdio の MCP サーバを一時データに対して起動します。
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { seed, ROOT } from '../helpers/seed.mjs'

before(() => seed())

test('scripts/check-mcp.mjs がすべて通る', async () => {
  const out = await new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'scripts', 'check-mcp.mjs')], { env: process.env, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr })
    })
  })
  assert.equal(out.code, 0, out.stdout + out.stderr)
  assert.equal(/^FAIL/m.test(out.stdout), false, out.stdout)
})
