import { syncFindingBody } from '../../shared/finding-table.js'
import fs from 'node:fs'
import path from 'node:path'
import { renderMarkdown } from '../../shared/markdown.js'
import { dataRoot } from './config.js'
import { listSurfaces, listToolLogs, readDoc, docPaths, getEngagement } from './store.js'
import { reportableFindings } from './reportable.js'
import { SEVERITIES, SEVERITY_META, findingStatusLabel } from './severity.js'
import { EXPORT_COLORS as C, EXPORT_SEV, sevBadgeSvg, sevChipIcon, sevPillHtml } from './export-colors.js'
import { readEvidenceDataUrl } from './evidence.js'
import { dashboard } from './stats.js'

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

/**
 * 表のセルの折り返しを整えます。空白のない短い値（CWE-639、9.6、確定など）は折り返さず、
 * URL は文字の途中でも折り返して、ほかの列の幅を奪わないようにします。
 */
export function tidyTableCells(html) {
  return html
    .replace(/<td>([^<\s]{1,14})<\/td>/g, '<td class="nowrap">$1</td>')
    .replace(/<td>((?:<a [^>]*>)?https?:\/\/)/g, '<td class="url">$1')
}

function render(md) {
  return tidyTableCells(renderMarkdown(md || ''))
}

/** <script> の中に埋め込む JSON。</script> で外へ出ないよう < を逃がします。 */
function scriptJson(x) {
  return JSON.stringify(x).replace(/</g, '\\u003c')
}

/** 書き出した HTML から外部へ要求が飛ばないようにします（画像は data: だけ）。 */
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`

// 書き出しは常にライト（export-colors.js）。状態のお知らせは面を塗らず、4px の線 ＋ アイコンで示す。
const BASE_CSS = `
:root{color-scheme:light;--bg:${C.bg};--card:${C.card};--card-sub:${C.cardSub};--text:${C.text};--text-sub:${C.textSub};--text-muted:${C.textMuted};
--border:${C.border};--border-strong:${C.borderStrong};--primary:${C.primary};--on-primary:${C.onPrimary};--selected-bg:${C.selectedBg};--selected-text:${C.selectedText};--warning:${C.warning}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Noto Sans JP','Hiragino Sans','Yu Gothic UI',Meiryo,system-ui,sans-serif;font-size:16px;line-height:1.8}
.wrap{max-width:980px;margin:0 auto;padding:32px 16px 80px}
.sheet{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:24px;margin-bottom:16px}
h1{font-size:24px;margin:0 0 8px}
h2{font-size:19px;margin:32px 0 12px;border-bottom:1px solid var(--border);padding-bottom:6px}
h3{font-size:17px;margin:24px 0 8px}
h4{font-size:15px;margin:16px 0 6px}
p,ul,ol{margin:8px 0}
a{color:var(--primary)}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th,td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--card-sub);font-weight:700;color:var(--text-sub);white-space:nowrap}
td.nowrap{white-space:nowrap}
td.name{min-width:14em}
td.url{word-break:break-all;min-width:12em}
pre{background:var(--card-sub);border:1px solid var(--border);border-radius:6px;padding:12px;overflow-x:auto}
code{font-family:'SFMono-Regular','Noto Sans Mono',ui-monospace,monospace;font-size:13px}
blockquote{border-left:3px solid var(--primary);margin:12px 0;padding:0 14px;color:var(--text-sub)}
img{max-width:100%;height:auto;border:1px solid var(--border);border-radius:4px}
.banner{position:relative;background:var(--card);border:1px solid var(--border);border-left:4px solid var(--warning);padding:12px 16px 12px 44px;border-radius:6px;font-size:14px;margin-bottom:16px}
.banner::before{content:'!';position:absolute;left:14px;top:16px;width:16px;height:16px;background:var(--warning);color:var(--card);clip-path:polygon(50% 0,100% 100%,0 100%);font:700 11px/19px system-ui,sans-serif;text-align:center}
.meta{font-size:14px;color:var(--text-sub)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;padding:0 10px;border:1.5px solid transparent;border-radius:999px;white-space:nowrap;vertical-align:middle;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pill.info{background:transparent;border-color:${EXPORT_SEV.info.border};color:var(--text)}
.sevrow{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}
.sevbox{border:1px solid var(--border);border-radius:8px;padding:10px 16px;min-width:108px;text-align:center;display:grid;justify-items:center;gap:2px}
.sevbox svg{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sevbox .n{font-size:26px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums}
.sevbox .l{font-size:13px;font-weight:700;letter-spacing:.02em}
.stat{display:flex;gap:28px;flex-wrap:wrap;margin:8px 0 0}
.stat div span{display:block;font-size:13px;color:var(--text-sub)}
.stat div b{font-size:24px;font-variant-numeric:tabular-nums}
.finding{border-top:3px solid var(--border);padding-top:16px;margin-top:28px}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.tag{font-size:13px;border:1px solid var(--border);border-radius:999px;padding:1px 10px;color:var(--text-sub);background:var(--card-sub)}
.tag.draft{border-style:dashed;font-weight:700;vertical-align:middle}
`

const PRINT_CSS = `
@page{size:A4;margin:18mm 16mm}
body{background:var(--card);font-size:10.5pt;line-height:1.75}
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
    return `<div class="sevbox">${sevBadgeSvg(k)}<div class="l" style="color:${EXPORT_SEV[k].text}">${m.label}</div><div class="n">${counts[k] || 0}</div><div class="meta">${m.ja}</div></div>`
  }).join('')}</div>`
}

function findingRows(findings) {
  if (!findings.length) return '<p>発見事項はありません。</p>'
  return `<table><thead><tr><th>#</th><th>深刻度</th><th>脆弱性名称</th><th>識別子</th><th>CVSS</th><th>対象</th><th>状態</th></tr></thead><tbody>${findings
    .map((f) => {
      const m = SEVERITY_META[f.severity]
      return `<tr><td class="nowrap">${esc(f.finding_no)}</td><td class="nowrap">${sevPillHtml(f.severity, `${m.label}・${m.ja}`)}</td><td class="name"><a href="#${esc(f.id)}">${esc(f.vuln_name)}</a></td><td class="nowrap">${esc(f.identifier)}</td><td class="nowrap">${f.cvss_score ?? ''}</td><td class="url">${esc(f.target)}</td><td class="nowrap">${esc(findingStatusLabel(f.status))}</td></tr>`
    })
    .join('')}</tbody></table>`
}

function surfaceRows(surfaces) {
  if (!surfaces.length) return '<p>サーフェスは登録されていません。</p>'
  return `<table><thead><tr><th>ID</th><th>種別</th><th>値</th><th>ポート</th><th>サービス</th><th>製品・技術</th><th>状態</th><th>発見ツール</th></tr></thead><tbody>${surfaces
    .map((s) => `<tr><td class="nowrap">${esc(s.id)}</td><td class="nowrap">${esc(s.kind_label)}</td><td class="url">${esc(s.value)}</td><td class="nowrap">${s.port ?? ''}</td><td>${esc(s.service)}</td><td>${esc([s.product, ...s.tech].filter(Boolean).join(' / '))}</td><td class="nowrap">${esc(s.status)}</td><td>${esc(s.discovered_by.join(', '))}</td></tr>`)
    .join('')}</tbody></table>`
}

function collect(eid, { includeDraft }) {
  const eng = getEngagement(eid)
  if (!eng) throw new Error('診断対象が見つかりません')
  const { findings, excluded } = reportableFindings(eid, { includeDraft })
  const surfaces = listSurfaces(eid).filter((s) => s.in_scope)
  const counts = Object.fromEntries(SEVERITIES.map((k) => [k, findings.filter((f) => f.severity === k).length]))
  return { eng, findings, surfaces, counts, logs: listToolLogs(eid), stats: dashboard(eid), excluded: excluded.length }
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
      const bodyMd = syncFindingBody(doc.body, doc.data).replace(/^#\s+.*$/m, '')
      return `<section class="finding" id="${esc(f.id)}">
<h3>発見事項 #${esc(f.finding_no)} — ${esc(f.vuln_name)} ${sevPillHtml(f.severity, `${m.label}・${m.ja}`)}${f.status === 'draft' ? ' <span class="tag draft">下書き</span>' : ''}</h3>
<table><tbody>
<tr><th>識別子</th><td>${esc(f.identifier) || '—'}</td></tr>
<tr><th>CVSS</th><td><code>${esc(f.cvss_vector) || '—'}</code> → ${f.cvss_score ?? '—'}</td></tr>
<tr><th>対象</th><td>${esc(f.target) || '—'}</td></tr>
<tr><th>関連サーフェス</th><td>${esc(f.surfaces.map((id) => surfaces.find((s) => s.id === id)?.value || id).join(' / ')) || '—'}</td></tr>
<tr><th>使用ツール</th><td>${esc(f.tools.join(' / ')) || '—'}</td></tr>
<tr><th>状態</th><td>${esc(findingStatusLabel(f.status))}</td></tr>
</tbody></table>
${render(inlineImages(bodyMd, eid, includeEvidence))}
</section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${CSP_META}
<title>${esc(eng.name)} — 脆弱性調査の共有バンドル</title>
<style>${BASE_CSS}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.filters button{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:14px;min-height:36px;padding:4px 14px;border-radius:999px;border:1px solid var(--border-strong);background:var(--card);color:var(--text-sub);cursor:pointer}
.filters button[aria-pressed="true"]{border-color:var(--selected-bg);background:var(--selected-bg);color:var(--selected-text);font-weight:700}
.filters button[aria-pressed="true"]::before{content:'✓ '}
@media print{${PRINT_CSS}}
</style></head>
<body><div class="wrap">
<div class="sheet">
<div class="banner">本ファイルは脆弱性調査の結果を含みます。取扱いに注意し、共有範囲を限定してください。証跡のマスキング状態も確認してください。</div>
<h1>${esc(eng.name)}</h1>
<p class="meta">顧客: ${esc(eng.client) || '—'} ／ 対象: ${esc(eng.target_system) || '—'} ／ 期間: ${esc(eng.period_from)} 〜 ${esc(eng.period_to)}</p>
<p class="meta">書き出し日時: ${stamp()}${excluded > 0 ? ` ／ 下書きの発見事項 ${excluded} 件は含めていません` : ''}</p>
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
${SEVERITIES.map((k) => `<button data-sev="${k}" aria-pressed="false">${sevChipIcon(k)}${SEVERITY_META[k].label}・${SEVERITY_META[k].ja}</button>`).join('')}
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
  var sevById = ${scriptJson(Object.fromEntries(findings.map((f) => [f.id, f.severity])))};
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
  const { eng, findings, counts } = collect(eid, { includeDraft: false })
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
${CSP_META}
<title>${esc(eng.name)} 脆弱性診断報告書</title>
<style>${BASE_CSS}
.toolbar{position:sticky;top:0;background:var(--card);border-bottom:1px solid var(--border);padding:12px 16px;display:flex;gap:12px;align-items:center;font-size:14px;z-index:5}
.toolbar button{font:inherit;font-weight:700;font-size:14px;min-height:44px;padding:0 20px;border-radius:6px;border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);cursor:pointer}
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
<tr><th>総合リスク</th><td>${sevPillHtml(highest, `${SEVERITY_META[highest].label}・${SEVERITY_META[highest].ja}`)}</td></tr>
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
