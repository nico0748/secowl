/**
 * 画面に公開する最小限の窓口です。いまはテーマの切り替え（ウィンドウの地の色とネイティブ部品の配色）だけです。
 * contextIsolation が有効なので、ページから Node や ipcRenderer そのものには触れません。
 */
const { contextBridge, ipcRenderer } = require('electron')

// サーバのポートは起動のたびに変わる（オリジンが変わり localStorage が引き継がれない）ため、
// デスクトップ版ではメインプロセスが記憶したテーマを正とし、最初の描画の前に渡します。
let theme = 'system'
try { theme = ipcRenderer.sendSync('secowl:theme-get') } catch { /* 取れなければ OS に合わせます */ }

contextBridge.exposeInMainWorld('secowlDesktop', {
  theme,
  setTheme: (theme) => {
    if (theme === 'system' || theme === 'light' || theme === 'dark') ipcRenderer.send('secowl:theme', theme)
  },
})
