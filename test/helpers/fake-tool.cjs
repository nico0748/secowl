/**
 * コマンドランナーのテスト用の「ツールの代役」です。ネットワークには一切触れません。
 * test/helpers/exec-fixture.mjs が、これを呼ぶだけの実行ファイルを一時フォルダに作ります。
 *
 *   --secret            資格情報らしい行（Authorization・Cookie・JWT・メール・端末の色指定）を出す
 *   --noisy N           JWT を含む長い行を N 行出す（保存ログの切り詰めの確認用）
 *   --oX FILE | -o FILE   fixtures の nmap.xml をそこへコピーする（structured 出力の代役）
 *   --hold SEC          SEC 秒待つ（停止・時間切れの確認用）
 *   --grandchild SEC    出力を握ったまま SEC 秒生きる孫（sleep）を作る
 *   --stubborn          孫を SIGTERM を無視するものにする（SIGKILL までの段階の確認用）
 *   --trickle N         N 行を 350ms おきに出す（ライブ出力の確認用）
 *   --splitsecret       4KB を超える行の途中で read が分かれる位置に、JWT / Cookie を置いて出す（強制フラッシュの境界の確認用）
 *   --longline N        N 文字の 1 行を 20000 文字ずつ書く（行の上限の確認用）
 *   --cutjwt            行の上限ちょうどの位置に JWT がかかる 1 行を出す
 *   --html              HTML らしい文字列を出す（画面がテキストとして描くことの確認用）
 *   --exit N            終了コード
 *   --echo-env          環境変数の名前の一覧を出す
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const val = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

process.stdout.write(`ARGV:${JSON.stringify(args)}\n`)
if (flag('--echo-env')) process.stdout.write(`ENV:${JSON.stringify(Object.keys(process.env).sort())}\nPATH:${process.env.PATH}\nCWD:${process.cwd()}\n`)
if (flag('--secret')) {
  process.stdout.write('\u001b[31mred line\u001b[0m\n')
  process.stdout.write('progress 10%\rprogress 100%\n')
  process.stdout.write('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl\n')
  process.stdout.write('Cookie: sid=abcdef123456; theme=dark\n')
  process.stdout.write('token seen eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl in body, contact admin@corp.test\n')
  process.stderr.write('stderr line\n')
}
if (val('--noisy')) {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl'
  for (let i = 0; i < Number(val('--noisy')); i++) process.stdout.write(`line-${String(i).padStart(5, '0')} ${jwt} ${'x'.repeat(80)}\n`)
}
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function longOutputs() {
  if (flag('--splitsecret')) {
    process.stdout.write(`${'x'.repeat(4100)} jwt=${JWT.slice(0, 20)}`)
    await sleep(300)
    process.stdout.write(`${JWT.slice(20)} end-of-jwt-line\n`)
    process.stdout.write(`Cookie: pad=${'y'.repeat(4100)}; sid=abcdef1234`)
    await sleep(300)
    process.stdout.write('56789; theme=dark end-of-cookie-line\n')
  }
  if (val('--longline')) {
    const n = Number(val('--longline'))
    process.stdout.write('start-of-long-line ')
    for (let left = n; left > 0; left -= 20000) { process.stdout.write('z'.repeat(Math.min(20000, left))); await sleep(5) }
    process.stdout.write('\nafter-long-line\n')
  }
  if (flag('--cutjwt')) {
    process.stdout.write(`${'x'.repeat(32 * 1024 - 20)}${JWT}`)
    await sleep(100)
    process.stdout.write(' tail-of-cut-line\nafter-cut-line\n')
  }
}
if (flag('--html')) process.stdout.write('<img src=x onerror="window.__xss=1"><script>window.__xss=1</script> <b>bold?</b>\n')
const outFile = val('-oX') || val('-o')
if (outFile) fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'nmap.xml'), outFile)
if (val('--grandchild')) {
  const sec = String(Number(val('--grandchild')))
  // exec で置き換えても、無視にした SIGTERM の扱いは引き継がれます
  if (flag('--stubborn')) spawn('/bin/sh', ['-c', `trap '' TERM; exec /bin/sleep ${sec}`], { stdio: 'inherit' }).unref()
  else spawn('/bin/sleep', [sec], { stdio: 'inherit' }).unref()
}
// process.exit() だと、パイプに書きかけの出力が途中で切れることがあるため、自然に終わらせます
const trickle = Number(val('--trickle') || 0)
if (trickle) {
  let n = 0
  const iv = setInterval(() => {
    process.stdout.write(`[${++n}/${trickle}] ${n % 2 ? 'Discovered open port' : 'Scanning'} 198.51.100.${n}\n`)
    if (n >= trickle) clearInterval(iv)
  }, 350)
}
const done = () => { process.exitCode = Number(val('--exit') || 0) }
longOutputs().then(() => {
  if (val('--hold')) setTimeout(done, Number(val('--hold')) * 1000)
  else done()
})
