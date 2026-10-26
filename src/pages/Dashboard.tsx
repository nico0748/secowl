import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAsync, useStore } from '../state'
import { Donut } from '../components/Donut'
import { SeverityBadge } from '../components/Severity'
import { NoEngagement } from './shared'
import type { Progress } from '../types'

const PHASE_ROUTE: Record<string, string> = {
  preparation: '/scope', recon: '/surfaces', survey: '/survey', triage: '/findings', report: '/report',
}
const STATE_LABEL: Record<string, string> = { todo: '未着手', doing: '進行中', done: '完了' }

// 技術スタックのカテゴリ色。深刻度の色と色覚多様性の条件で近いものがあるため、
// カテゴリと深刻度を同じグラフ・同じ凡例に並べないこと（loop/r2-color.md §7）。
const CAT_COLORS = ['var(--app-cat-1)', 'var(--app-cat-2)', 'var(--app-cat-3)', 'var(--app-cat-4)', 'var(--app-cat-5)']

export function DashboardPage() {
  const { current, revision } = useStore()
  const nav = useNavigate()
  const { data, error, loading } = useAsync(
    () => (current ? api.dashboard(current.id) : Promise.resolve(null)),
    [current?.id, revision],
  )
  const { data: prog } = useAsync(
    () => (current ? api.progress(current.id) : Promise.resolve(null)),
    [current?.id, revision],
  )

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  if (loading || !data) return <div className="empty">読み込んでいます…</div>

  const tech = data.technology
  const topTech = tech.slice(0, 5)
  const restCount = tech.slice(5).reduce((a, t) => a + t.count, 0)
  const techSlices = [
    ...topTech.map((t, i) => ({ key: t.name, label: t.name, value: t.count, color: CAT_COLORS[i] })),
    ...(restCount > 0 ? [{ key: '__other', label: `その他 ${tech.length - 5} 件`, value: restCount, color: 'var(--app-cat-other)' }] : []),
  ]
  const sevSlices = data.severity.map((s) => ({ key: s.key, label: s.ja, value: s.count, color: `var(--app-sev-${s.key})` }))

  return (
    <>
      {prog && <ProgressPanel progress={prog} />}
      <div className="dash">
      <div className="dash-col">
        <section className="card">
          <div className="card-head">
            <span className="card-title">サーフェス</span>
            <Link className="card-note" to="/surfaces">一覧</Link>
          </div>
          <div className="stat-total">
            <span className="stat-label">合計</span>
          </div>
          <div className="stat-value">{data.totals.surfaces}</div>
          <div className="kind-list">
            {data.kindCounts.map((k) => (
              <div className="kind-row" key={k.kind}>
                <span>{k.label}</span>
                <b>{k.count}</b>
              </div>
            ))}
          </div>
          <div className="kind-row" style={{ borderTop: '1px solid var(--app-border)', marginTop: 'var(--sp-2)', paddingTop: 'var(--sp-2)' }}>
            <span>調査済</span>
            <b>{data.statusCounts.find((s) => s.status === '調査済')?.count ?? 0}</b>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><span className="card-title">ポート番号</span></div>
          {data.ports.length === 0 ? (
            <p className="hint" style={{ color: 'var(--app-text-muted)', fontSize: 14 }}>ポート種別のサーフェスを登録すると、ここに一覧が出ます。</p>
          ) : (
            <table className="port-table">
              <thead>
                <tr><th scope="col">番号</th><th scope="col">件数</th></tr>
              </thead>
              <tbody>
                {data.ports.map((p) => (
                  <tr
                    key={p.port}
                    className="port-row"
                    tabIndex={0}
                    onClick={() => nav(`/surfaces?port=${p.port}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') nav(`/surfaces?port=${p.port}`) }}
                  >
                    <td>{p.port}{p.service ? <span style={{ color: 'var(--app-text-muted)', fontWeight: 400 }}>　{p.service}</span> : null}</td>
                    <td><span className="port-count">{p.count}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="dash-col">
        <section className="card">
          <div className="card-head">
            <span className="card-title">連携数</span>
            <Link className="card-note" to="/survey">ツールごとの記録数（実行ログ＋発見事項）・計 {data.totals.logs} ログ</Link>
          </div>
          {data.tools.length === 0 ? (
            <p style={{ color: 'var(--app-text-muted)', fontSize: 14, margin: 0 }}>nmap や Burp Suite の実行ログを登録すると、ツール別の件数が出ます。</p>
          ) : (
            <div className="tool-grid">
              {data.tools.map((t) => (
                <button key={t.tool} className="tool-item" onClick={() => nav(`/survey?tool=${encodeURIComponent(t.tool)}`)}>
                  <span className="tool-name">{t.tool}</span>
                  <span className="tool-count">{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <span className="card-title">脆弱性スコア</span>
            <Link className="card-note" to="/findings">発見事項 {data.totals.findings} 件</Link>
          </div>
          <div className="sev-layout">
            <Donut
              slices={sevSlices}
              centerLabel="発見事項"
              onSelect={(key) => nav(`/findings?severity=${key}`)}
              emptyText="発見事項なし"
            />
            <div className="sev-cards">
              {data.severity.map((s) => (
                <button key={s.key} className="sev-card" onClick={() => nav(`/findings?severity=${s.key}`)}>
                  <SeverityBadge value={s.key} />
                  <span className="sev-name">{s.label}</span>
                  <span className="sev-count">{s.count}</span>
                  <span style={{ fontSize: 14, color: 'var(--app-text-muted)' }}>{s.ja}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <span className="card-title">テクノロジー</span>
            <span className="card-note">サーフェスに記録した製品・技術</span>
          </div>
          <div className="tech-layout">
            <Donut slices={techSlices} centerLabel="検出" onSelect={(key) => key !== '__other' && nav(`/surfaces?tech=${encodeURIComponent(key)}`)} emptyText="未登録" />
            <div className="legend">
              {techSlices.length === 0 && <span style={{ color: 'var(--app-text-muted)' }}>サーフェスに製品名や技術を記録すると、内訳が出ます。</span>}
              {techSlices.map((t) => (
                <div className="legend-row" key={t.key}>
                  <span className="legend-swatch" style={{ background: t.color }} />
                  <span className="legend-name">{t.label}</span>
                  <span className="legend-val">{t.value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      </div>
    </>
  )
}

/** 偵察から報告書までの進み具合を、フェーズ単位で示します。 */
function ProgressPanel({ progress }: { progress: Progress }) {
  return (
    <section className="card flow">
      <div className="card-head">
        <span className="card-title">進め方</span>
        <Link className="card-note" to="/playbook">標準手順書を開く</Link>
      </div>
      {progress.nextAction && <p className="flow-next"><b>次の一手</b>　{progress.nextAction}</p>}
      <ol className="flow-steps">
        {progress.phases.map((p) => (
          <li
            key={p.phase}
            className={`flow-step ${p.state}${progress.current === p.phase ? ' current' : ''}`}
            aria-current={progress.current === p.phase ? 'step' : undefined}
          >
            {progress.current === p.phase && <span className="flow-here">現在地</span>}
            <Link to={PHASE_ROUTE[p.phase] || '/playbook'} className="flow-link">
              <span className="flow-badge">{p.label}</span>
              <span className="flow-title">{p.title}</span>
              <span className="flow-state">{STATE_LABEL[p.state]}</span>
            </Link>
            <p className="flow-goal">{p.goal}</p>
            <div className="flow-metrics">
              {p.metrics.map((m) => (
                <span key={m.label}><i>{m.label}</i>{m.value}</span>
              ))}
            </div>
            <Link className="flow-guide" to={`/playbook?phase=${p.phase}`}>手順を見る</Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
