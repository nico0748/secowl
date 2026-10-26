// 最初の描画の前にテーマを決めます（ちらつき防止）。規則は src/theme.ts と同じです。
// 画面の CSP（script-src 'self'）に合わせて、インラインの <script> ではなくこのファイルから読み込みます。
try {
  // デスクトップ版は preload が渡す値を正とします（起動ごとにポートが変わり localStorage が引き継がれないため）
  var d = window.secowlDesktop && window.secowlDesktop.theme
  var t = d || localStorage.getItem('secowl.theme')
  if (t === 'light' || t === 'dark') {
    document.documentElement.dataset.theme = t
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.content = t === 'dark' ? '#0D0E11' : '#EFEDF1'
    })
    document.querySelector('meta[name="color-scheme"]').content = t
  }
} catch (e) { /* 読めない環境では OS に合わせます */ }
