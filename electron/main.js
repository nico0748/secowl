/**
 * Electron のメインプロセス。
 * Express サーバを同じプロセスで立ち上げ、その URL をウィンドウへ読み込ませます。
 * React 側のコードはブラウザで動かすときと同じものです。
 */
import { app as electronApp, BrowserWindow, Menu, dialog, nativeImage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const PACKAGED = electronApp.isPackaged

// サーバを読み込む前に、書き込める場所を指すよう環境変数を決めます。
const userData = electronApp.getPath('userData')
process.env.SECOWL_CONFIG ||= path.join(userData, 'secowl.config.json')
process.env.SECOWL_DEFAULT_DATA ||= PACKAGED
  ? path.join(electronApp.getPath('documents'), 'SecOwl')
  : path.join(APP_ROOT, 'data')

const { startServer, setHostBridge } = await import('../server/app.js')

const STATE_FILE = path.join(userData, 'window-state.json')
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

/** 同じサーバの URL は新しいウィンドウで開き、それ以外は既定のブラウザへ渡します。 */
function attachWindowOpenHandler(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (serverUrl && url.startsWith(serverUrl)) {
      const child = new BrowserWindow({
        width: 1100,
        height: 900,
        title: 'SecOwl',
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })
      child.loadURL(url)
      attachWindowOpenHandler(child)
      return { action: 'deny' }
    }
    shell.openExternal(url)
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
    backgroundColor: '#f1f1f4',
    titleBarStyle: 'hiddenInset',
    webPreferences: { nodeIntegration: false, contextIsolation: true, spellcheck: false },
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
