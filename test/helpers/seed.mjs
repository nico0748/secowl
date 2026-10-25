import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const E = '2026-10-example-shop'
export const E2 = '2026-09-example-bank-api'

/** 現在の SECOWL_DATA（env.mjs が作った一時フォルダ）にサンプルの診断対象を作り直します。 */
export function seed() {
  if (!process.env.SECOWL_TEST_TMP || !process.env.SECOWL_DATA?.startsWith(process.env.SECOWL_TEST_TMP)) {
    throw new Error('テスト用の一時フォルダが設定されていません（test/helpers/env.mjs を --import してください）')
  }
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-mock.js'), '--reset'], { env: process.env, stdio: 'ignore' })
}
