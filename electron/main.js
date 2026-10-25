/**
 * Electron のメインプロセス。
 * Express サーバを同じプロセスで立ち上げ、その URL をウィンドウへ読み込ませます。
 * React 側のコードはブラウザで動かすときと同じものです。
 */
import { app as electronApp, BrowserWindow, Menu, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
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

const { startServer, setHostBridge } = await import('../server/app.js')

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
      const child = new BrowserWindow({
        width: 1100,
        height: 900,
        title: 'SecOwl',
        backgroundColor: windowBackground(),
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: PRELOAD },
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

  electronApp.on('window-all-closed', () => {
    if (process.platform !== 'darwin') electronApp.quit()
  })
}
