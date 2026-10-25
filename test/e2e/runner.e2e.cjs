/**
 * コマンドランナーの Electron 実機確認（手動）。npm test には含めません（Playwright は依存に入れていません）。
 *
 *   xvfb-run -a node test/e2e/runner.e2e.cjs [出力フォルダ]
 *
 * 一時フォルダに data/ の写しを作り、HOME・設定・保存先をそこへ向けて Electron を起動します（data/ には書き込みません）。
 * 本物のネットワークツールは使わず、test/helpers/fake-tool.cjs を呼ぶだけの実行ファイル（fakenmap）を、メインプロセスの中から
 * allow-list に足して動かします。「実行」ページを操作し、ライト・ダークそれぞれで画面を保存します。
 */
const { _electron } = require('/opt/node22/lib/node_modules/playwright')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')

const ROOT = path.resolve(__dirname, '..', '..')
const SHOTS = path.resolve(process.argv[2] || '/home/claude/loop2/shots-runner')
const EID = '2026-10-example-shop'
fs.mkdirSync(SHOTS, { recursive: true })

const log = (...a) => console.log('[e2e]', ...a)
const alive = (pgid) => { try { process.kill(-pgid, 0); return true } catch (e) { return e.code !== 'ESRCH' } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secowl-e2e-'))
  const data = path.join(tmp, 'd')
  fs.cpSync(path.join(ROOT, 'data'), data, { recursive: true })

  // 以前のバージョンで作った Git の保存先（生の出力を除外する行がない .gitignore）
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: data })
  fs.writeFileSync(path.join(data, '.gitignore'), '# SecOwl — 保存先リポジトリ\n.DS_Store\n*/evidence/\n')

  // 代役の実行ファイル
  const bin = path.join(tmp, 'bin')
  fs.mkdirSync(bin, { mode: 0o700 })
  fs.writeFileSync(path.join(bin, 'fakenmap'), `#!${process.execPath}\nrequire(${JSON.stringify(path.join(ROOT, 'test', 'helpers', 'fake-tool.cjs'))})\n`, { mode: 0o755 })
  fs.chmodSync(path.join(bin, 'fakenmap'), 0o755)
  // 書き換えられる探索パス（グループが書ける）に置いたリンク → 「実行不可」
  const wbin = path.join(tmp, 'wbin')
  fs.mkdirSync(wbin)
  fs.chmodSync(wbin, 0o775)
  fs.symlinkSync(path.join(bin, 'fakenmap'), path.join(wbin, 'fakeunsafe'))

  // 一時フォルダのスコープ文書を、今日を含む期間・スコープ・承認済みにそろえる
  const env = {
    ...process.env, HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, 'cfg'), SECOWL_DATA: data,
    SECOWL_DEFAULT_DATA: path.join(tmp, 'data'), SECOWL_CONFIG: path.join(tmp, 'secowl.config.json'),
  }
  const today = new Date()
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const from = new Date(today.getTime() - 7 * 864e5)
  const to = new Date(today.getTime() + 7 * 864e5)
  const prep = `
    const { writeDoc, docPaths } = await import(${JSON.stringify(path.join(ROOT, 'server/lib/store.js'))})
    writeDoc(docPaths(${JSON.stringify(EID)}).scope, { data: {
      scope_targets: ['*.example.com', '198.51.100.0/24'], scope_deny: ['payment.example.com'], scope_allow: [], scope_ports: [],
      agreed: true, agreed_at: '2026-09-29', agreed_by: '情報システム部 部長 鈴木', period_from: ${JSON.stringify(ymd(from))}, period_to: ${JSON.stringify(ymd(to))},
    } })`
  execFileSync(process.execPath, ['--input-type=module', '-e', prep], { env, stdio: 'inherit' })

  // 代役の設定を渡す起動口（本番の electron/main.js をそのまま読み込む）
  const templates = [{
    slug: 'nmap', name: 'nmap', phase: ['recon'], commands: [
      { id: 'detail', label: 'ポートを指定して、サービスとバージョンを調べる（-sV -sC）', program: 'fakenmap', args: ['--trickle', '9', '--html', '-oX', '{{out}}', '{{target}}'], out: { format: 'nmap', ext: 'xml' },
        vars: [{ name: 'target', kind: 'target', required: true, label: '対象のホスト', hint: 'ホスト名か IP アドレスを 1 つ', accept: ['host', 'ip'] }], timeout_sec: 60, hash: 'e2e-1' },
      { id: 'missing', label: 'インストールされていないツール', program: 'fakemissing', args: ['{{target}}'],
        vars: [{ name: 'target', kind: 'target', required: true, label: '対象のホスト', accept: ['host', 'ip'] }], timeout_sec: 60, hash: 'e2e-3' },
      { id: 'unsafe', label: '置き場所の権限が緩いツール', program: 'fakeunsafe', args: ['{{target}}'],
        vars: [{ name: 'target', kind: 'target', required: true, label: '対象のホスト', accept: ['host', 'ip'] }], timeout_sec: 60, hash: 'e2e-4' },
      { id: 'slow', label: '長く動くコマンド（停止と終了の確認用）', program: 'fakenmap', args: ['--hold', '60', '--grandchild', '60', '{{target}}'],
        vars: [{ name: 'target', kind: 'target', required: true, label: '対象のホスト', accept: ['host', 'ip'] }], timeout_sec: 120, hash: 'e2e-2' },
    ],
  }]
  const cfgFile = path.join(tmp, 'e2e-config.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ allowed: ['fakenmap', 'fakemissing', 'fakeunsafe'], searchPaths: [bin, wbin], templates }))
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: [path.join(ROOT, 'test/e2e/main-e2e.mjs'), '--no-sandbox'], env: { ...env, SECOWL_E2E_CONFIG: cfgFile }, cwd: ROOT, timeout: 60000,
  })
  const win = await app.firstWindow()
  const consoleErrors = []
  win.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleErrors.push(m.text()) })
  win.on('pageerror', (e) => consoleErrors.push(String(e)))
  await win.waitForSelector('.rail', { timeout: 30000 })
  await win.setViewportSize({ width: 1440, height: 940 }).catch(() => {})

  // メインプロセス: ネイティブの確認を記録して、自動で「実行」を返す
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (...args) => { globalThis.__secowlTest.confirms.push(args.at(-1)); return { response: 1 } }
  })

  const shot = async (name) => { await sleep(250); await win.screenshot({ path: path.join(SHOTS, `${name}.png`) }); log('screenshot', name) }
  const setTheme = (t) => win.evaluate((t) => { const r = document.documentElement; if (t === 'light') r.dataset.theme = 'light'; else r.dataset.theme = 'dark' }, t)

  // 実行ページへ
  await win.getByRole('link', { name: '実行' }).first().click()
  await win.waitForSelector('.run-layout')

  // 1) ページ自体の確認: 鍵なしの直接呼び出しは 403、鍵と launch は画面の外に露出しない
  const direct = await win.evaluate(async () => (await fetch('/api/exec/templates')).status)
  assert.equal(direct, 403, '鍵なしの API 呼び出しは 403')
  const keys = await win.evaluate(() => Object.keys(window.secowlDesktop).sort())
  assert.deepEqual(keys, ['execLaunch', 'execSession', 'setTheme', 'theme'])
  assert.equal(await win.evaluate(() => JSON.stringify(Object.keys(localStorage)).includes('exec')), false, 'localStorage に鍵を置かない')

  for (const theme of ['light', 'dark']) {
    await setTheme(theme)
    log('--- theme', theme)
    await win.getByRole('button', { name: /ポートを指定して/ }).click()
    assert.match(await win.locator('.card-note').first().innerText(), /60 秒で打ち切り/)
    assert.doesNotMatch(await win.locator('.run-layout').innerText(), /時間切れ 60 秒/)
    await shot(`${theme}-01-run-page`)

    // 2) スコープ外 → 実行前の確認で実行ボタンが無効
    await win.fill('#rv-target', 'evil.test')
    await win.getByRole('button', { name: '実行前の確認' }).click()
    await win.waitForSelector('.dialog [aria-label="引数を 1 つずつ"]')
    assert.equal(await win.getByRole('button', { name: 'fakenmap を実行' }).isDisabled(), true, 'スコープ外は実行ボタン無効')
    const refused = await win.locator('.dialog').innerText()
    assert.match(refused, /スコープ外/)
    assert.match(refused, /次にすること/)
    assert.match(refused, /この対象も診断してよい場合は、契約の範囲を確かめたうえで、スコープ設定に追加してください/)
    assert.match(refused, /「実行」のボタンは押せません/)
    await shot(`${theme}-03-refused`)
    await win.getByRole('button', { name: 'キャンセル' }).click()

    // 3) スコープ内: 確認ダイアログ（入力は全角・末尾ドットで、正規化された値が引数に入る）
    await win.fill('#rv-target', 'ＡＰＰ.example.com.')
    await win.getByRole('button', { name: '実行前の確認' }).click()
    await win.waitForSelector('.dialog [aria-label="引数を 1 つずつ"]')
    const items = await win.locator('.argv-list li code').allInnerTexts()
    assert.equal(items.at(-1), 'app.example.com', '引数には正規化した対象が入る')
    assert.ok(items.some((x) => x.endsWith('.xml')))
    assert.equal(await win.evaluate(() => document.activeElement?.textContent), 'キャンセル', '既定のフォーカスはキャンセル')
    const okText = await win.locator('.dialog').innerText()
    assert.match(okText, /スコープ内/)
    assert.match(okText, /実行時間の上限\s*60 秒（過ぎたら止めます）/)
    assert.doesNotMatch(okText, /時間切れ/)
    await shot(`${theme}-02-confirm`)

    // 4) 実行: ネイティブの確認（短い）を経て起動し、出力が流れる
    const before = await app.evaluate(() => globalThis.__secowlTest.confirms.length)
    await win.getByRole('button', { name: 'fakenmap を実行' }).click()
    await win.waitForSelector('.run-output')
    await win.waitForFunction(() => /Discovered open port/.test(document.querySelector('.run-output')?.textContent || ''), null, { timeout: 15000 })
    // 実行中でも、履歴に行が出ている（0 件のままにしない）
    await win.waitForFunction(() => /実行の履歴[\s\S]*?[1-9]\d* 件/.test(document.querySelector('.run-live ~ .card')?.textContent || ''), null, { timeout: 5000 })
    assert.match(await win.locator('.run-live ~ .card').innerText(), /実行中/)
    await shot(`${theme}-04-live`)
    const confirms = await app.evaluate(() => globalThis.__secowlTest.confirms)
    assert.equal(confirms.length, before + 1, 'ネイティブの確認が 1 回出る')
    const last = confirms.at(-1)
    assert.equal(last.defaultId, 0)
    assert.equal(last.buttons[0], 'キャンセル')
    assert.match(last.detail, /対象: app\.example\.com/)

    // 5) 出力は HTML として解釈しない
    assert.equal(await win.evaluate(() => window.__xss), undefined, '出力中のスクリプトが実行された')
    assert.equal(await win.locator('.run-output img, .run-output script, .run-output b').count(), 0)
    assert.match(await win.locator('.run-output').innerText(), /<img src=x onerror=/)

    // 6) 完了 → 取り込みのプレビュー
    await win.waitForFunction(() => /完了しました/.test(document.querySelector('.run-done')?.textContent || ''), null, { timeout: 20000 })
    await win.getByRole('button', { name: '取り込みをプレビュー' }).click()
    await win.waitForSelector('.run-preview')
    await win.locator('.run-preview').scrollIntoViewIfNeeded()
    await shot(`${theme}-05-finished`)
    await win.getByRole('button', { name: '実行の記録を検証' }).click()
    await win.waitForFunction(() => /つながりが切れていません/.test(document.body.textContent || ''), null, { timeout: 5000 })
    await win.locator('.run-live ~ .card').scrollIntoViewIfNeeded()
    await shot(`${theme}-06-history-audit`)
    if (theme === 'dark') {
      await win.getByRole('button', { name: '取り込む' }).click()
      await win.waitForFunction(() => /取り込み済み/.test(document.querySelector('.run-done')?.textContent || ''), null, { timeout: 10000 })
    }
  }

  // 6b) 使えないコマンドは、見つからない場合と権限が緩い場合を分けて見せる
  await setTheme('light')
  const rail = await win.locator('.run-pick').innerText()
  assert.match(rail, /インストールされていないツール[\s\S]*?未インストール/)
  assert.match(rail, /置き場所の権限が緩いツール[\s\S]*?実行不可/)
  await win.getByRole('button', { name: /置き場所の権限が緩い/ }).click()
  await win.waitForSelector('.run-layout .banner.warn')
  assert.match(await win.locator('.run-layout .banner.warn').innerText(), /書き換えられる権限/)
  await win.locator('.page-head').scrollIntoViewIfNeeded()
  await shot('light-07-unsafe-program')
  await win.getByRole('button', { name: /ポートを指定して/ }).click()

  // 6c) 設定画面の Git: 生の出力を除外する行が無い保存先は警告し、ボタンで追記できる
  await win.getByRole('link', { name: '設定' }).first().click()
  await win.waitForSelector('text=Git（保存先の版管理）')
  await win.waitForSelector('text=.gitignore に追記する')
  assert.match(await win.locator('section.card', { hasText: 'Git（保存先の版管理）' }).innerText(), /\*\/\.secowl\/run\//)
  await shot('light-08-git-warning')
  await setTheme('dark')
  await shot('dark-08-git-warning')
  await win.getByRole('button', { name: '.gitignore に追記する' }).click()
  await win.waitForFunction(() => !/\.gitignore に追記する/.test(document.body.textContent || ''), null, { timeout: 8000 })
  const gi = fs.readFileSync(path.join(data, '.gitignore'), 'utf8')
  assert.ok(gi.includes('*/20-調査/取得データ/') && gi.includes('*/.secowl/run/') && gi.includes('.DS_Store'), gi)
  await win.getByRole('link', { name: '実行' }).first().click()
  await win.waitForSelector('.run-layout')

  // 7) CSP に違反するものが無い（インラインのスクリプト・外部読み込み）
  const csp = consoleErrors.filter((m) => /Content Security Policy|Refused to/.test(m))
  assert.deepEqual(csp, [], `CSP 違反: ${csp.join(' | ')}`)

  // 8) 子ウィンドウ（共有バンドル）には secowlDesktop が無い
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.evaluate((eid) => { window.open(`/api/engagements/${eid}/share.html`) }, EID),
  ])
  await child.waitForLoadState('domcontentloaded')
  assert.equal(await child.evaluate(() => typeof window.secowlDesktop), 'undefined', '子ウィンドウに窓口が無い')
  await child.close()

  // 9) 履歴・監査記録
  const audit = fs.readFileSync(path.join(data, EID, '.secowl', 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const events = audit.map((a) => a.event)
  assert.ok(events.includes('plan') && events.includes('blocked') && events.includes('launch') && events.includes('done') && events.includes('import'), events.join())

  // 10) 実行中にアプリを閉じると、プロセスグループごと止まる
  await win.getByRole('button', { name: /長く動くコマンド/ }).click()
  await win.fill('#rv-target', 'app.example.com')
  await win.getByRole('button', { name: '実行前の確認' }).click()
  await win.waitForSelector('.dialog [aria-label="引数を 1 つずつ"]')
  await win.getByRole('button', { name: 'fakenmap を実行' }).click()
  await win.waitForFunction(() => /ARGV/.test(document.querySelector('.run-output')?.textContent || ''), null, { timeout: 15000 })
  const pid = await app.evaluate(() => {
    const { execService } = globalThis.__secowlTest
    const list = execService.list('2026-10-example-shop').filter((j) => j.status === 'running')
    return execService.getJob('2026-10-example-shop', list[0].id).child.pid
  })
  assert.ok(alive(pid), '起動した')
  const closing = app.close()
  await closing
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(100)
  assert.equal(alive(pid), false, 'アプリの終了で子プロセス（孫まで）も止まる')
  const after = fs.readFileSync(path.join(data, EID, '.secowl', 'audit.jsonl'), 'utf8')
  assert.match(after, /アプリの終了/)

  log('OK 完了。画面:', SHOTS)
  fs.rmSync(tmp, { recursive: true, force: true })
}

main().catch((e) => { console.error('[e2e] 失敗:', e); process.exit(1) })
