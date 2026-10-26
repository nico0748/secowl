import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { StoreProvider } from './state'
import './styles/app.css'
import { applyThemePref, readThemePref } from './theme'

// index.html で付けたテーマを、theme-color とデスクトップ版のウィンドウにも反映します。
applyThemePref(readThemePref())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
