/**
 * `node --import ./test/helpers/env.mjs --test ...` で、各テストファイルのプロセスの最初に読み込まれます。
 *
 * server/lib/config.js は import した時点で SECOWL_CONFIG / SECOWL_DEFAULT_DATA を確定するため、
 * テスト本体の静的 import より前に、保存先と設定ファイルを一時フォルダへ向けておきます。
 * これで data/ と secowl.config.json には一切書き込みません。
 *
 * - node --test の子プロセス（NODE_TEST_CONTEXT が付く）は、ファイルごとに新しい一時フォルダを作ります。
 * - テストが fork したワーカーなどが明示的にこのファイルを読み込んだときは、親が作った一時フォルダ
 *   （SECOWL_TEST_TMP）をそのまま使います。利用者のシェルにある SECOWL_DATA は使いません。
 * - git のコミットに使う名前とメールも、ここで決めます。開発機には ~/.gitconfig がありますが、
 *   CI の実行環境には無く、git commit が「Author identity unknown」で失敗するためです。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const inherited = process.env.SECOWL_TEST_TMP
const reuse = inherited && !process.env.NODE_TEST_CONTEXT && fs.existsSync(inherited)

if (!reuse) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-test-'))
  process.env.SECOWL_TEST_TMP = tmp
  process.env.SECOWL_DATA = path.join(tmp, 'data')
  process.env.SECOWL_CONFIG = path.join(tmp, 'secowl.config.json')
  process.env.SECOWL_DEFAULT_DATA = path.join(tmp, 'default-data')
  fs.mkdirSync(process.env.SECOWL_DATA, { recursive: true })
  process.on('exit', () => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 片付けに失敗しても結果は変えません */ }
  })
}

// 保存先の git を触るテストのため。すでに指定されていればそれを使います（fork した子にも環境として渡ります）。
process.env.GIT_AUTHOR_NAME ||= 'SecOwl test'
process.env.GIT_AUTHOR_EMAIL ||= 'test@example.invalid'
process.env.GIT_COMMITTER_NAME ||= process.env.GIT_AUTHOR_NAME
process.env.GIT_COMMITTER_EMAIL ||= process.env.GIT_AUTHOR_EMAIL
