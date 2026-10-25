import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useStore } from './state'
import { IconAlert, IconGear, IconHelp, IconHome, IconRadar, IconReport, IconSearch, IconToolbox } from './components/Icons'
import { LogoMark } from './components/Logo'
import { DashboardPage } from './pages/Dashboard'
import { SurfacesPage } from './pages/Surfaces'
import { ImportPage } from './pages/Import'
import { SurfaceDetailPage } from './pages/SurfaceDetail'
import { SurveyPage } from './pages/Survey'
import { ToolLogDetailPage } from './pages/ToolLogDetail'
import { FindingsPage } from './pages/Findings'
import { FindingDetailPage } from './pages/FindingDetail'
import { ReportPage } from './pages/Report'
import { SettingsPage } from './pages/Settings'
import { ToolsPage } from './pages/Tools'
import { PlaybookPage } from './pages/Playbook'
import { DocPage } from './pages/DocPage'
import { ScopePage } from './pages/Scope'
import { SearchButton } from './components/SearchDialog'

const NAV = [
  { to: '/', label: 'ホーム', icon: IconHome, end: true },
  { to: '/surfaces', label: '偵察', icon: IconRadar },
  { to: '/survey', label: '調査', icon: IconSearch },
  { to: '/findings', label: 'トリアージ', icon: IconAlert },
  { to: '/report', label: '報告書', icon: IconReport },
  { to: '/tools', label: 'ツール', icon: IconToolbox },
]

const TITLES: Record<string, string> = {
  '/': 'ダッシュボード',
  '/surfaces': '偵察・列挙',
  '/survey': '脆弱性調査',
  '/findings': 'トリアージ',
  '/report': '調査報告書',
  '/scope': '事前準備',
  '/settings': '設定',
  '/tools': 'ツール',
  '/playbook': '進め方',
  '/doc': '文書',
  '/import': 'ツール出力の取り込み',
}

export function App() {
  const { engagements, current, setCurrentId, toast } = useStore()
  const { pathname } = useLocation()
  const title = TITLES[pathname] || TITLES['/' + pathname.split('/')[1]] || 'SecOwl'

  return (
    <div className="app">
      <nav className="rail" aria-label="主要メニュー">
        <div className="rail-brand">
          <LogoMark />
          <span className="rail-name">SecOwl</span>
        </div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="rail-spacer" />
        <NavLink to="/settings" className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`}>
          <IconGear />
          <span>設定</span>
        </NavLink>
      </nav>

      <header className="header">
        <span className="header-title">{title}</span>
        <div className="header-right">
          <span className="eng-select">
            <label htmlFor="eng" style={{ color: 'var(--app-text-muted)' }}>診断対象</label>
            <select id="eng" value={current?.id ?? ''} onChange={(e) => setCurrentId(e.target.value)}>
              {engagements.length === 0 && <option value="">（診断対象なし）</option>}
              {engagements.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </span>
          <a className="rail-item" style={{ margin: 0, padding: 6 }} href="https://owasp.org/www-project-web-security-testing-guide/" target="_blank" rel="noreferrer" aria-label="OWASP WSTG を開く">
            <IconHelp />
          </a>
          <SearchButton />
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/surfaces" element={<SurfacesPage />} />
          <Route path="/surfaces/:id" element={<SurfaceDetailPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/survey" element={<SurveyPage />} />
          <Route path="/survey/logs/:id" element={<ToolLogDetailPage />} />
          <Route path="/findings" element={<FindingsPage />} />
          <Route path="/findings/:id" element={<FindingDetailPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/playbook" element={<PlaybookPage />} />
          <Route path="/doc" element={<DocPage />} />
          <Route path="/scope" element={<ScopePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
