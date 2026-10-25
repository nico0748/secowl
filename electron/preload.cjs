/**
 * 画面に公開する最小限の窓口です。テーマの切り替え（ウィンドウの地の色とネイティブ部品の配色）と、コマンドランナーの窓口です。
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
  // コマンドランナー。どちらもメインプロセスが「アプリ本体のウィンドウの最上位フレーム」からの依頼だけを受けます。
  // execSession はコマンドの計画・出力・停止・取り込みの API に付ける、アプリの起動ごとの鍵（画面のメモリの上にだけ置き、
  // URL・ログ・localStorage には出さない）。execLaunch は起動の依頼で、メインプロセスのネイティブの確認を経てから起動します。
  execSession: () => ipcRenderer.invoke('secowl:exec-session'),
  execLaunch: (req) => ipcRenderer.invoke('secowl:exec-launch', { eid: String(req && req.eid || ''), planId: String(req && req.planId || '') }),
})
