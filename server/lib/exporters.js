import fs from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'
import { dataRoot } from './config.js'
import { listSurfaces, listFindings, listToolLogs, readDoc, docPaths, getEngagement, resolveFile } from './store.js'
import { SEVERITIES, SEVERITY_META } from './severity.js'
import { readEvidenceDataUrl } from './evidence.js'
import { dashboard } from './stats.js'

marked.setOptions({ gfm: true })

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** Markdown 内の画像参照を data URL へ置き換えます。診断対象フォルダの外は置き換えません。 */
function inlineImages(md, eid, enabled) {
  if (!enabled) return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt) => `（画像: ${alt || '証跡'} — 共有バンドルでは省略）`)
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (whole, alt, src) => {
    const clean = String(src).split(' ')[0].replace(/^<|>$/g, '')
    if (/^(https?:|data:)/.test(clean)) return whole
    const candidates = [
      path.posix.join(eid, clean.replace(/^\.\//, '').replace(/^\.\.\//, '')),
      path.posix.join(eid, 'evidence', path.basename(clean)),
    ]
    for (const rel of candidates) {
      const url = readEvidenceDataUrl(rel)
      if (url) return `![${alt}](${url})`
    }
    return whole
  })
}

function render(md) {
  return marked.parse(md || '')
}

const BASE_CSS = `
:root{--sumi-900:#1a1a1c;--sumi-700:#626264;--sumi-600:#7f7f78;--sumi-300:#d8d8db;--sumi-200:#e8e8eb;--sumi-100:#f1f1f4;--sumi-50:#f8f8fb;--sea-800:#0017c1;--sea-50:#e8f1fe;--wood-700:#c87504;--wood-50:#f3eee5;
--sev-critical:#890101;--sev-high:#ec0000;--sev-medium:#cd820a;--sev-low:#264af4;--sev-info:#949497}
*{box-sizing:border-box}
body{margin:0;background:var(--sumi-100);color:var(--sumi-900);font-family:'Noto Sans JP','Hiragino Sans','Yu Gothic UI',Meiryo,system-ui,sans-serif;font-size:16px;line-height:1.8}
.wrap{max-width:980px;margin:0 auto;padding:32px 16px 80px}
.sheet{background:#fff;border:1px solid var(--sumi-300);border-radius:8px;padding:24px;margin-bottom:16px}
h1{font-size:24px;margin:0 0 8px}
h2{font-size:19px;margin:32px 0 12px;border-bottom:1px solid var(--sumi-300);padding-bottom:6px}
h3{font-size:17px;margin:24px 0 8px}
h4{font-size:15px;margin:16px 0 6px}
p,ul,ol{margin:8px 0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th,td{border:1px solid var(--sumi-300);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--sumi-50);font-weight:700;color:var(--sumi-700)}
pre{background:var(--sumi-50);border:1px solid var(--sumi-300);border-radius:6px;padding:12px;overflow-x:auto}
code{font-family:'SFMono-Regular','Noto Sans Mono',ui-monospace,monospace;font-size:13px}
blockquote{border-left:3px solid var(--sea-800);margin:12px 0;padding:0 14px;color:var(--sumi-700)}
img{max-width:100%;height:auto;border:1px solid var(--sumi-300);border-radius:4px}
.banner{border-left:4px solid var(--wood-700);background:var(--wood-50);padding:12px 16px;border-radius:6px;font-size:14px;margin-bottom:16px}
.meta{font-size:14px;color:var(--sumi-700)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;padding:1px 10px;border-radius:999px;color:#fff;white-space:nowrap}
.sevrow{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}
.sevbox{border:1px solid var(--sumi-300);border-radius:8px;padding:10px 16px;min-width:108px;text-align:center}
.sevbox .n{font-size:26px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums}
.sevbox .l{font-size:13px;font-weight:700;letter-spacing:.02em}
.stat{display:flex;gap:28px;flex-wrap:wrap;margin:8px 0 0}
.stat div span{display:block;font-size:13px;color:var(--sumi-700)}
.stat div b{font-size:24px;font-variant-numeric:tabular-nums}
.finding{border-top:3px solid var(--sumi-200);padding-top:16px;margin-top:28px}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.tag{font-size:13px;border:1px solid var(--sumi-300);border-radius:999px;padding:1px 10px;color:var(--sumi-700);background:var(--sumi-50)}
`

const PRINT_CSS = `
@page{size:A4;margin:18mm 16mm}
body{background:#fff;font-size:10.5pt;line-height:1.75}
.wrap{max-width:none;padding:0}
.sheet{border:0;border-radius:0;padding:0;margin:0}
.cover{height:235mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}
.cover h1{font-size:26pt;line-height:1.4}
.cover table{width:auto;min-width:120mm}
.toc{page-break-after:always}
h2{page-break-after:avoid}
h3,h4{page-break-after:avoid}
table,pre,blockquote,img{page-break-inside:avoid}
.finding{page-break-before:always;border-top:0;padding-top:0}
.no-print{display:none}
`

function severityBoxes(counts) {
  return `<div class="sevrow">${SEVERITIES.map((k) => {
    const m = SEVERITY_META[k]
    return `<div class="sevbox"><div class="l" style="color:${m.color}">${m.label}</div><div class="n">${counts[k] || 0}</div><div class="meta">${m.ja}</div></div>`
  }).join('')}</div>`
}

function findingRows(findings) {
  if (!findings.length) return '<p>発見事項はありません。</p>'
  return `<table><thead><tr><th>#</th><th>深刻度</th><th>脆弱性名称</th><th>識別子</th><th>CVSS</th><th>対象</th><th>状態</th></tr></thead><tbody>${findings
    .map((f) => {
      const m = SEVERITY_META[f.severity]
      return `<tr><td>${esc(f.finding_no)}</td><td><span class="pill" style="background:${m.color}">${m.label}・${m.ja}</span></td><td><a href="#${esc(f.id)}">${esc(f.vuln_name)}</a></td><td>${esc(f.identifier)}</td><td>${f.cvss_score ?? ''}</td><td>${esc(f.target)}</td><td>${esc(f.status)}</td></tr>`
    })
    .join('')}</tbody></table>`
}

function surfaceRows(surfaces) {
  if (!surfaces.length) return '<p>サーフェスは登録されていません。</p>'
  return `<table><thead><tr><th>ID</th><th>種別</th><th>値</th><th>ポート</th><th>サービス</th><th>製品・技術</th><th>状態</th><th>発見ツール</th></tr></thead><tbody>${surfaces
    .map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.kind_label)}</td><td>${esc(s.value)}</td><td>${s.port ?? ''}</td><td>${esc(s.service)}</td><td>${esc([s.product, ...s.tech].filter(Boolean).join(' / '))}</td><td>${esc(s.status)}</td><td>${esc(s.discovered_by.join(', '))}</td></tr>`)
    .join('')}</tbody></table>`
}

function collect(eid, { includeDraft }) {
  const eng = getEngagement(eid)
  if (!eng) throw new Error('診断対象が見つかりません')
  const all = listFindings(eid)
  const findings = (includeDraft ? all : all.filter((f) => f.status !== 'draft'))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || String(a.finding_no).localeCompare(String(b.finding_no)))
  const surfaces = listSurfaces(eid).filter((s) => s.in_scope)
  const counts = Object.fromEntries(SEVERITIES.map((k) => [k, findings.filter((f) => f.severity === k).length]))
  return { eng, findings, surfaces, counts, logs: listToolLogs(eid), stats: dashboard(eid), excluded: all.length - findings.length }
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 読み取り専用の共有バンドル（自己完結 HTML 1 ファイル）を組み立てます。 */
export function shareBundle(eid, { includeDraft = false, includeEvidence = true } = {}) {
  const { eng, findings, surfaces, counts, stats, excluded } = collect(eid, { includeDraft })

  const details = findings
    .map((f) => {
      const doc = readDoc(f.file)
      const m = SEVERITY_META[f.severity]
      const bodyMd = doc.body.replace(/^#\s+.*$/m, '')
      return `<section class="finding" id="${esc(f.id)}">
<h3>発見事項 #${esc(f.finding_no)} — ${esc(f.vuln_name)} <span class="pill" style="background:${m.color}">${m.label}・${m.ja}</span></h3>
<table><tbody>
<tr><th>識別子</th><td>${esc(f.identifier) || '—'}</td></tr>
<tr><th>CVSS</th><td><code>${esc(f.cvss_vector) || '—'}</code> → ${f.cvss_score ?? '—'}</td></tr>
<tr><th>対象</th><td>${esc(f.target) || '—'}</td></tr>
<tr><th>関連サーフェス</th><td>${esc(f.surfaces.map((id) => surfaces.find((s) => s.id === id)?.value || id).join(' / ')) || '—'}</td></tr>
<tr><th>使用ツール</th><td>${esc(f.tools.join(' / ')) || '—'}</td></tr>
<tr><th>状態</th><td>${esc(f.status)}</td></tr>
</tbody></table>
${render(inlineImages(bodyMd, eid, includeEvidence))}
</section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(eng.name)} — 脆弱性調査の共有バンドル</title>
<style>${BASE_CSS}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.filters button{font:inherit;font-size:14px;min-height:36px;padding:4px 14px;border-radius:999px;border:1px solid var(--sumi-300);background:#fff;color:var(--sumi-700);cursor:pointer}
.filters button[aria-pressed="true"]{border-color:var(--sea-800);background:var(--sea-50);color:var(--sea-800);font-weight:700}
@media print{${PRINT_CSS}}
</style></head>
<body><div class="wrap">
<div class="sheet">
<div class="banner">本ファイルは脆弱性調査の結果を含みます。取扱いに注意し、共有範囲を限定してください。証跡のマスキング状態も確認してください。</div>
<h1>${esc(eng.name)}</h1>
<p class="meta">顧客: ${esc(eng.client) || '—'} ／ 対象: ${esc(eng.target_system) || '—'} ／ 期間: ${esc(eng.period_from)} 〜 ${esc(eng.period_to)}</p>
<p class="meta">書き出し日時: ${stamp()}${excluded > 0 ? ` ／ draft 状態の発見事項 ${excluded} 件は含めていません` : ''}</p>
<div class="stat">
<div><span>アタックサーフェス</span><b>${stats.totals.surfaces}</b></div>
<div><span>発見事項</span><b>${findings.length}</b></div>
<div><span>使用ツール</span><b>${stats.totals.tools}</b></div>
<div><span>ツール実行ログ</span><b>${stats.totals.logs}</b></div>
</div>
</div>

<div class="sheet">
<h2>深刻度別の件数</h2>
${severityBoxes(counts)}
<h2>発見事項一覧</h2>
<div class="filters no-print" id="filters">
<button data-sev="" aria-pressed="true">すべて</button>
${SEVERITIES.map((k) => `<button data-sev="${k}" aria-pressed="false">${SEVERITY_META[k].label}・${SEVERITY_META[k].ja}</button>`).join('')}
</div>
${findingRows(findings)}
</div>

<div class="sheet">
<h2>個別の脆弱性</h2>
${details || '<p>発見事項はありません。</p>'}
</div>

<div class="sheet">
<h2>アタックサーフェス一覧</h2>
${surfaceRows(surfaces)}
</div>
</div>
<script>
(function(){
  var sevById = ${JSON.stringify(Object.fromEntries(findings.map((f) => [f.id, f.severity])))};
  var btns = document.querySelectorAll('#filters button');
  btns.forEach(function(b){
    b.addEventListener('click', function(){
      btns.forEach(function(x){ x.setAttribute('aria-pressed', String(x === b)); });
      var sev = b.getAttribute('data-sev');
      document.querySelectorAll('.finding').forEach(function(el){
        el.style.display = (!sev || sevById[el.id] === sev) ? '' : 'none';
      });
      document.querySelectorAll('tbody tr').forEach(function(tr){
        var a = tr.querySelector('a[href^="#"]');
        if (!a) return;
        var id = a.getAttribute('href').slice(1);
        tr.style.display = (!sev || sevById[id] === sev) ? '' : 'none';
      });
    });
  });
})();
</script>
</body></html>`
}

/** 印刷して PDF にするための報告書 HTML を組み立てます。 */
export function printReport(eid, { includeEvidence = true } = {}) {
  const { eng, findings, counts } = collect(eid, { includeDraft: true })
  const reportDoc = readDoc(docPaths(eid).report)
  const md = reportDoc.body.replace(/^#\s+.*$/m, '')
  const html = render(inlineImages(md, eid, includeEvidence))

  // 見出しに id を振り、目次を作ります。
  const toc = []
  const withIds = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (whole, lv, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim()
    const id = 'sec-' + toc.length
    toc.push({ id, lv: Number(lv), text })
    return `<h${lv} id="${id}">${inner}</h${lv}>`
  })

  const highest = SEVERITIES.find((k) => counts[k] > 0) || 'info'

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(eng.name)} 脆弱性診断報告書</title>
<style>${BASE_CSS}
.toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid var(--sumi-300);padding:12px 16px;display:flex;gap:12px;align-items:center;font-size:14px;z-index:5}
.toolbar button{font:inherit;font-weight:700;font-size:14px;min-height:44px;padding:0 20px;border-radius:6px;border:1px solid var(--sea-800);background:var(--sea-800);color:#fff;cursor:pointer}
@media print{${PRINT_CSS}}
</style></head>
<body>
<div class="toolbar no-print">
<button onclick="window.print()">印刷して PDF に保存</button>
<span>ブラウザの印刷設定で「背景のグラフィック」を有効にし、「ヘッダーとフッター」を有効にするとページ番号が入ります。</span>
</div>
<div class="wrap"><div class="sheet">

<section class="cover">
<p class="meta">脆弱性診断報告書</p>
<h1>${esc(eng.name)}</h1>
<table><tbody>
<tr><th>提出先</th><td>${esc(eng.client) || ''}</td></tr>
<tr><th>診断対象</th><td>${esc(eng.target_system) || ''}</td></tr>
<tr><th>診断期間</th><td>${esc(eng.period_from)} 〜 ${esc(eng.period_to)}</td></tr>
<tr><th>総合リスク</th><td>${SEVERITY_META[highest].ja}</td></tr>
<tr><th>発見事項件数</th><td>${findings.length} 件</td></tr>
<tr><th>発行日</th><td>${stamp().slice(0, 10)}</td></tr>
</tbody></table>
<p class="banner">本書は機密文書です。取扱いには十分に注意してください。</p>
</section>

<section class="toc">
<h2>目次</h2>
<ol>${toc.filter((t) => t.lv === 2).map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol>
</section>

${withIds}
</div></div>
</body></html>`
}
