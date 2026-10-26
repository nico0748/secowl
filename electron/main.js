/**
 * Electron のメインプロセス。
 * Express サーバを同じプロセスで立ち上げ、その URL をウィンドウへ読み込ませます。
 * React 側のコードはブラウザで動かすときと同じものです。
 */
import { app as electronApp, BrowserWindow, Menu, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const PACKAGED = electronApp.isPackaged

// サーバを読み込む前に、書き込める場所を指すよう環境変数を決めます。
const userData = electronApp.getPath('userData')
// メニューと「SecOwl について」に表示する名前です。名前を変えると設定の保存先も変わるため、
// 先に今の保存先を固定してから変えます。
electronApp.setPath('userData', userData)
electronApp.setName('SecOwl')
process.env.SECOWL_CONFIG ||= path.join(userData, 'secowl.config.json')
process.env.SECOWL_DEFAULT_DATA ||= PACKAGED
  ? path.join(electronApp.getPath('documents'), 'SecOwl')
  : path.join(APP_ROOT, 'data')

const { startServer, setHostBridge, execService, setupService, installService, wordlistService, setupJobs } = await import('../server/app.js')

const STATE_FILE = path.join(userData, 'window-state.json')
const THEME_FILE = path.join(userData, 'theme.json')
const PRELOAD = path.join(__dirname, 'preload.cjs')
let mainWindow = null
let serverUrl = ''

function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s
  } catch { /* 初回は既定値を使います */ }
  return { width: 1440, height: 940 }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return
  const b = win.getNormalBounds()
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized: win.isMaximized() }, null, 2), 'utf8')
  } catch { /* 保存できなくても起動には影響しません */ }
}

// ---------- 表示テーマ ----------
// ウィンドウの地の色は src/styles/tokens.css の --app-bg と同じ値です（読み込み前のちらつきを防ぎます）。
const WINDOW_BG = { light: '#EFEDF1', dark: '#0D0E11' }
const THEME_PREFS = ['system', 'light', 'dark']

/** 画面で選んだテーマ（system / light / dark）。次回の起動でも最初のウィンドウから反映するため、ここにも記憶します。 */
function readThemePref() {
  try {
    const t = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8')).theme
    if (THEME_PREFS.includes(t)) return t
  } catch { /* 初回は OS に合わせます */ }
  return 'system'
}

function saveThemePref(theme) {
  try {
    fs.mkdirSync(path.dirname(THEME_FILE), { recursive: true })
    fs.writeFileSync(THEME_FILE, JSON.stringify({ theme }, null, 2), 'utf8')
  } catch { /* 保存できなくても表示には影響しません */ }
}

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light
}

function applyWindowBackground() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setBackgroundColor(windowBackground())
  }
}

/** 画面（preload.cjs）が最初の描画の前に読む、記憶済みのテーマ。 */
ipcMain.on('secowl:theme-get', (event) => {
  event.returnValue = THEME_PREFS.includes(nativeTheme.themeSource) ? nativeTheme.themeSource : 'system'
})

/** 画面（preload.cjs）からのテーマ変更。アプリのサーバから開いたページの依頼だけを受け付けます。 */
ipcMain.on('secowl:theme', (event, theme) => {
  if (!THEME_PREFS.includes(theme) || !isAppUrl(event.senderFrame?.url ?? '')) return
  if (nativeTheme.themeSource !== theme) {
    nativeTheme.themeSource = theme
    saveThemePref(theme)
  }
  applyWindowBackground()
})

// ---------- コマンドランナー ----------
// 画面（レンダラー）には、実行系の API を呼ぶためのセッション鍵を IPC で渡します。鍵はこのプロセスの
// 起動ごとに 1 本作り（終了まで同じ鍵。時間では失効しません）、メモリの上にだけ置きます（ファイル・URL・ログには出しません）。
// 起動そのもの（secowl:exec-launch）は HTTP では受けず、ここで最後の確認（ネイティブのダイアログ）を
// 経てから、同じプロセスの中でサーバの launch を呼びます。画面のスクリプトが乗っ取られても、
// ネイティブのダイアログの手前で止まります。
const execSession = crypto.randomBytes(32).toString('hex')
let confirming = false

/** 依頼元がアプリ本体のウィンドウの最上位フレーム（アプリのサーバのページ）かどうか。 */
function trustedSender(event) {
  const wc = mainWindow?.webContents
  const frame = event.senderFrame
  return !!wc && !wc.isDestroyed() && event.sender === wc && !!frame && frame === wc.mainFrame && isAppUrl(frame.url)
}

ipcMain.handle('secowl:exec-session', (event) => (trustedSender(event) ? execSession : null))

/** 実行前の最後の確認。詳しい内容（引数 1 要素ずつ）は画面のダイアログで確認済みなので、ここは短くします。 */
async function confirmNative(plan) {
  const lines = [
    `対象: ${plan.target}`,
    `判定: ${plan.verdictLabel}${plan.matched ? `（${plan.matched}）` : ''}`,
    `実行ファイル: ${plan.programPath}`,
    `引数 ${plan.argv.length} 個 / 時間切れ ${plan.timeoutSec} 秒`,
  ]
  if (plan.warning) lines.push('', plan.warning)
  const res = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'warning',
    title: 'SecOwl',
    message: `${plan.program} を実行します`,
    detail: lines.join('\n'),
    buttons: ['キャンセル', `${plan.program} を実行`],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return res.response === 1
}

ipcMain.handle('secowl:exec-launch', async (event, req) => {
  if (!trustedSender(event)) return { ok: false, status: 403, error: 'この画面からは実行できません' }
  if (confirming) return { ok: false, status: 409, error: '別の実行の確認を待っています' }
  confirming = true
  try {
    const res = await execService.launch(String(req?.eid ?? ''), String(req?.planId ?? ''), { confirm: confirmNative })
    return res.ok ? { ok: true, jobId: res.jobId } : { ok: false, cancelled: true }
  } catch (err) {
    return { ok: false, status: err?.status || 400, code: err?.code, error: String(err?.message || err) }
  } finally {
    confirming = false
  }
})

/** 権限の修正の最後の確認。直す場所をそのまま見せます（場所は画面ではなくサーバ側が決めています）。 */
async function confirmFix(req) {
  const head = req.paths.slice(0, 8)
  const more = req.paths.length - head.length
  const res = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'warning',
    title: 'SecOwl',
    message: `${req.count} 個の場所の権限を変えます`,
    detail: [
      'ほかのユーザーが書き換えられないようにします（chmod go-w）。',
      '',
      ...head,
      ...(more > 0 ? [`ほか ${more} 件`] : []),
    ].join('\n'),
    buttons: ['キャンセル', '権限を変える'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return res.response === 1
}

ipcMain.handle('secowl:setup-fix', async (event, req) => {
  if (!trustedSender(event)) return { ok: false, status: 403, error: 'この画面からは実行できません' }
  if (confirming) return { ok: false, status: 409, error: '別の確認を待っています' }
  confirming = true
  try {
    const res = await setupService.applyFix(String(req?.planId ?? ''), { confirm: confirmFix })
    return res.ok ? { ok: true, changed: res.changed, failed: res.failed } : { ok: false, cancelled: true }
  } catch (err) {
    return { ok: false, status: err?.status || 400, code: err?.code, error: String(err?.message || err) }
  } finally {
    confirming = false
  }
})

/** 導入の最後の確認。動かす実行ファイルの絶対パスと、コマンドをそのまま見せます。 */
async function confirmInstall(req) {
  const head = req.commands.slice(0, 12)
  const more = req.commands.length - head.length
  const res = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'warning',
    title: 'SecOwl',
    message: `${req.viaLabel} で ${req.commands.length} 個のツールを入れます`,
    detail: [
      `実行ファイル: ${req.installerPath}`,
      '',
      ...head,
      ...(more > 0 ? [`ほか ${more} 件`] : []),
      '',
      'ネットワークに接続し、配布元からソフトウェアを取得します。',
    ].join('\n'),
    buttons: ['キャンセル', '入れる'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return res.response === 1
}

ipcMain.handle('secowl:setup-install', async (event, req) => {
  if (!trustedSender(event)) return { ok: false, status: 403, error: 'この画面からは実行できません' }
  if (confirming) return { ok: false, status: 409, error: '別の確認を待っています' }
  confirming = true
  try {
    return await installService.start(String(req?.planId ?? ''), { confirm: confirmInstall })
  } catch (err) {
    return { ok: false, status: err?.status || 400, code: err?.code, error: String(err?.message || err) }
  } finally {
    confirming = false
  }
})

/** ワードリストの取得の最後の確認。取得先と置き場所をそのまま見せます。 */
async function confirmWordlists(req) {
  const head = req.urls.slice(0, 8)
  const more = req.urls.length - head.length
  const detail = [`置き場所: ${req.dir}`, '']
  if (head.length) detail.push(...head, ...(more > 0 ? [`ほか ${more} 件`] : []), '')
  if (req.full) detail.push(`${req.repo}（タグ ${req.tag}）を ${req.fullDir} に取ります。1GB 以上になります。`, '')
  detail.push('ネットワークに接続し、配布元からファイルを取得します。')
  const res = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'warning',
    title: 'SecOwl',
    message: req.full ? 'SecLists 全体を取得します' : `${req.urls.length} 本のワードリストを取得します`,
    detail: detail.join('\n'),
    buttons: ['キャンセル', '取得する'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return res.response === 1
}

ipcMain.handle('secowl:setup-wordlists', async (event, req) => {
  if (!trustedSender(event)) return { ok: false, status: 403, error: 'この画面からは実行できません' }
  if (confirming) return { ok: false, status: 409, error: '別の確認を待っています' }
  confirming = true
  try {
    return await wordlistService.start(String(req?.planId ?? ''), { confirm: confirmWordlists })
  } catch (err) {
    return { ok: false, status: err?.status || 400, code: err?.code, error: String(err?.message || err) }
  } finally {
    confirming = false
  }
})

/** 同じサーバ（オリジンが一致する URL）かどうか。前方一致では 1234 と 12345 を取り違えるため、origin で比べます。 */
function isAppUrl(url) {
  try {
    return !!serverUrl && new URL(url).origin === new URL(serverUrl).origin
  } catch {
    return false
  }
}

/** 既定のブラウザへ渡すのは http: と https: だけにします。 */
function openExternalSafe(url) {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url)
  } catch { /* 解釈できない URL は開きません */ }
}

/** アプリのウィンドウが外部サイトへ移らないよう、外部への遷移は既定のブラウザへ回します。 */
function guardNavigation(win) {
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault()
      openExternalSafe(url)
    }
  })
}

/** 同じサーバの URL は新しいウィンドウで開き、それ以外は既定のブラウザへ渡します。 */
function attachWindowOpenHandler(win) {
  guardNavigation(win)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      // /api/ 配下（共有バンドル・印刷用の報告書など、サーバが組み立てた HTML）には preload を付けません。
      // 付けると、そのページの中のスクリプトから secowlDesktop（実行系の窓口）に触れてしまうためです。
      let isApiPage = false
      try { isApiPage = new URL(url).pathname.startsWith('/api/') } catch { /* 解釈できなければ付けません */ isApiPage = true }
      const child = new BrowserWindow({
        width: 1100,
        height: 900,
        title: 'SecOwl',
        backgroundColor: windowBackground(),
        webPreferences: { nodeIntegration: false, contextIsolation: true, ...(isApiPage ? {} : { preload: PRELOAD }) },
      })
      child.loadURL(url)
      attachWindowOpenHandler(child)
      return { action: 'deny' }
    }
    openExternalSafe(url)
    return { action: 'deny' }
  })
}

function createWindow() {
  const state = readWindowState()
  mainWindow = new BrowserWindow({
    icon: path.join(APP_ROOT, 'build', 'icon.png'),
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 640,
    title: 'SecOwl',
    backgroundColor: windowBackground(),
    titleBarStyle: 'hiddenInset',
    webPreferences: { nodeIntegration: false, contextIsolation: true, spellcheck: false, preload: PRELOAD },
  })
  if (state.maximized) mainWindow.maximize()
  mainWindow.loadURL(serverUrl)
  attachWindowOpenHandler(mainWindow)

  for (const ev of ['resize', 'move', 'close']) mainWindow.on(ev, () => saveWindowState(mainWindow))
  mainWindow.on('closed', () => { mainWindow = null })
}

async function currentDataRoot() {
  const res = await fetch(`${serverUrl}/api/meta`)
  return (await res.json()).dataRoot
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{
      label: 'SecOwl',
      submenu: [
        { role: 'about', label: 'SecOwl について' },
        { type: 'separator' },
        { role: 'hide', label: 'SecOwl を隠す' },
        { role: 'hideOthers', label: 'ほかを隠す' },
        { role: 'unhide', label: 'すべてを表示' },
        { type: 'separator' },
        { role: 'quit', label: 'SecOwl を終了' },
      ],
    }] : []),
    {
      label: 'ファイル',
      submenu: [
        {
          label: '保存先フォルダを開く',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => { shell.openPath(await currentDataRoot()) },
        },
        {
          label: '印刷 / PDF に保存',
          accelerator: 'CmdOrCtrl+P',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.print({}),
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'ウィンドウを閉じる' } : { role: 'quit', label: '終了' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '取り消す' },
        { role: 'redo', label: 'やり直す' },
        { type: 'separator' },
        { role: 'cut', label: 'カット' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: 'ペースト' },
        { role: 'selectAll', label: 'すべてを選択' },
      ],
    },
    {
      label: '表示',
      submenu: [
        { role: 'reload', label: '再読み込み' },
        { role: 'forceReload', label: 'キャッシュを無視して再読み込み' },
        { type: 'separator' },
        { role: 'resetZoom', label: '実際のサイズ' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'フルスクリーン' },
        { role: 'toggleDevTools', label: '開発者ツール' },
      ],
    },
    {
      label: 'ウィンドウ',
      submenu: [
        { role: 'minimize', label: 'しまう' },
        { role: 'zoom', label: '拡大/縮小' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'すべてを手前に移動' }] : []),
      ],
    },
    {
      label: 'ヘルプ',
      submenu: [
        { label: 'OWASP WSTG を開く', click: () => shell.openExternal('https://owasp.org/www-project-web-security-testing-guide/') },
        { label: 'CVSS v4.0 計算機を開く', click: () => shell.openExternal('https://www.first.org/cvss/calculator/4.0') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

if (!electronApp.requestSingleInstanceLock()) {
  electronApp.quit()
} else {
  electronApp.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  electronApp.whenReady().then(async () => {
    nativeTheme.themeSource = readThemePref()
    nativeTheme.on('updated', applyWindowBackground)
    setHostBridge({
      pickFolder: async (current) => {
        const res = await dialog.showOpenDialog(mainWindow ?? undefined, {
          title: '調査データの保存先を選ぶ',
          defaultPath: current || electronApp.getPath('documents'),
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'このフォルダを使う',
        })
        return res.canceled ? '' : res.filePaths[0]
      },
      reveal: async (target) => { await shell.openPath(target) },
      execSession,
    })

    try {
      // ポート 0 を渡すと、空いているポートを OS が選びます。
      const started = await startServer({ port: 0 })
      serverUrl = started.url
      console.log(`SecOwl: ${serverUrl}  データ: ${started.dataRoot}`)
    } catch (err) {
      dialog.showErrorBox('起動できませんでした', String(err?.message || err))
      electronApp.quit()
      return
    }

    // ソースから起動したときは Dock のアイコンが既定のままになるため、明示的に差し替えます。
    // .app から起動したときはパッケージ側のアイコンが使われるので何もしません。
    if (!PACKAGED && process.platform === 'darwin') {
      try {
        const image = nativeImage.createFromPath(path.join(APP_ROOT, 'build', 'icon.png'))
        if (!image.isEmpty()) electronApp.dock?.setIcon(image)
      } catch { /* アイコンを置けなくても起動には影響しません */ }
    }

    buildMenu()
    createWindow()

    electronApp.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // 終了前に、実行中のコマンドをプロセスグループごと止め、終わるのを待ってから抜けます。
  // （待たずに抜けると、子プロセスが残って出力や監査記録を書き終えられません）
  let quitting = false
  electronApp.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    Promise.allSettled([execService.killAll({ waitMs: 5000 }), setupJobs.killAll()]).finally(() => electronApp.quit())
  })
  // 異常終了のときの最後の手段（同期）。待たずに残りのグループへ SIGKILL を送ります。
  process.on('exit', () => { try { execService.killNow() } catch { /* 終了中なので何もしません */ } })

  electronApp.on('window-all-closed', () => {
    if (process.platform !== 'darwin') electronApp.quit()
  })
}
