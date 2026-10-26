import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, StaleWriteError } from '../api'
import { useAsync, useStore } from '../state'
import { DocEditor, type DocEditorHandle } from '../components/DocEditor'
import { Dialog } from '../components/Dialog'
import { CvssCalculator } from '../components/CvssCalculator'
import { EvidencePanel } from '../components/EvidencePanel'
import { HttpPasteDialog } from '../components/HttpPasteDialog'
import { NoEngagement, SeverityPill, StatusTag } from './shared'
import { findLeaks, type Leak } from '../../shared/redact.js'

const LEAK_LABEL: Record<string, string> = {
  cookie: 'Cookie', authorization: 'Authorization', jwt: 'JWT', email: 'メールアドレス', secret: 'API キー・トークン・パスワード',
}

/**
 * 取得してからクリップボードへ書きます。Safari は await をはさむとユーザー操作の扱いが切れるため、
 * ClipboardItem に Promise を渡して、クリックと同じ流れの中で書き込みを始めます。
 */
async function copyText(load: () => Promise<string>) {
  const pending = load()
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = pending.then((t) => new Blob([t], { type: 'text/plain' }))
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return
    } catch { /* 対応していなければ writeText に回します */ }
  }
  await navigator.clipboard.writeText(await pending)
}

export function FindingDetailPage() {
  const { id } = useParams()
  const { current, meta, revision, bump, notify } = useStore()
  const [calc, setCalc] = useState(false)
  const [httpOpen, setHttpOpen] = useState(false)
  const [leaks, setLeaks] = useState<Leak[]>([])
  const editor = useRef<DocEditorHandle>(null)

  const { data, error, loading, reload } = useAsync(
    () => (current ? api.findings(current.id) : Promise.resolve([])),
    [current?.id, revision],
  )

  if (!current) return <NoEngagement />
  if (error) return <div className="banner error">{error}</div>
  // 再取得中も編集中の内容を消さないよう、初回だけ読み込み中の表示にします。
  if (loading && !data) return <div className="empty">読み込んでいます…</div>

  const finding = (data ?? []).find((f) => f.id === id)
  if (!finding) return <div className="empty">発見事項 {id} が見つかりません。</div>

  const sevJa = meta?.severities.find((s) => s.key === finding.severity)?.ja ?? finding.severity_label
  const provisional = finding.severity_source === 'manual'
    ? null
    : finding.cvss_score === null
      ? <span className="tag" title="基本値が未記入のため、仮の深刻度です">現在: {sevJa}（仮）</span>
      : <span className="tag" title="CVSS 基本値から決めた深刻度です">現在: {sevJa}（基本値から）</span>

  const statusOptions = (meta?.findingStatuses ?? []).map((s) => ({ value: s.key, label: s.label }))
  const statusHint = (v: string) => meta?.findingStatuses.find((s) => s.key === v)?.hint ?? ''

  const copyMarkdown = async () => {
    try {
      await copyText(() => api.findingMarkdown(current.id, finding.id))
      notify(`発見事項 #${finding.finding_no} を Markdown でコピーしました`)
    } catch (e) {
      notify(`コピーできませんでした: ${(e as Error).message}`)
    }
  }

  return (
    <>
      <div className="breadcrumb"><Link to="/findings">トリアージ</Link> / {finding.id}</div>
      <div className="page-head">
        <h1>#{finding.finding_no} {finding.vuln_name}</h1>
        <SeverityPill value={finding.severity} />
        <StatusTag value={finding.status} />
        <div className="spacer" />
        <button className="btn quiet" onClick={copyMarkdown}>Markdown でコピー</button>
        <button className="btn secondary" onClick={() => setCalc(true)}>CVSS 計算機</button>
      </div>

      <div className="banner warn">
        証跡の実トークンと個人情報はマスキングしてから保存してください。CVSS 基本値を入力すると、深刻度は FIRST の区分に沿って決まります。
      </div>

      {leaks.length > 0 && (
        <div className="banner warn" role="alert">
          マスキング漏れの疑いがあります: {leaks.map((l) => `${LEAK_LABEL[l.kind] ?? l.kind} ${l.count} 件`).join('、')}。証跡と本文の該当箇所を伏せてから共有してください。
        </div>
      )}

      <DocEditor
        key={finding.file}
        ref={editor}
        file={finding.file}
        fields={[
          { key: 'vuln_name', label: '脆弱性名称' },
          { key: 'identifier', label: '識別子（CWE / CVE）' },
          { key: 'owasp', label: 'OWASP Top 10:2025', hint: 'A01 から A10' },
          { key: 'wstg_id', label: 'WSTG ID' },
          { key: 'target', label: '対象' },
          { key: 'required_role', label: '発見・悪用に必要な立場', hint: '未認証の外部利用者 / 一般利用者 / 管理者' },
          { key: 'reproducibility', label: '再現性', hint: '再現可 / 条件付き / 一度のみ' },
          { key: 'cvss_vector', label: 'CVSS ベクタ' },
          { key: 'cvss_score', label: 'CVSS 基本値', type: 'number', hint: '9.0 以上は緊急、7.0 以上は重要、4.0 以上は警告、0.1 以上は注意' },
          {
            key: 'severity', label: '深刻度', type: 'select',
            emptyLabel: 'CVSS 基本値から決める',
            options: (meta?.severities ?? []).map((s) => ({ value: s.key, label: `${s.label}・${s.ja}` })),
            // 手で決めた深刻度のときだけ選択肢に値を入れます。それ以外は「CVSS 基本値から決める」。
            // severity_source のない旧形式の個票は、一覧が返す実際の決め方（食い違えば manual）に従います。
            fromData: (d) => ((d.severity_source ?? finding.severity_source) === 'manual' ? String(d.severity ?? '') : ''),
            extra: provisional,
            hint: '基本値が未記入のあいだは、選んだ深刻度を仮の値として使います',
          },
          { key: 'status', label: '状態', type: 'select', options: statusOptions, hint: statusHint },
        ]}
        sectionHeadings={[
          '平易な説明',
          '発見場所',
          'リクエスト / レスポンス',
          '再現手順',
          '脆弱性があると判断した理由',
          '脆弱性の解説',
          'システム・ビジネスへの影響',
          '対策',
          '参考情報',
          'リテスト',
        ]}
        onSaved={() => { reload(); }}
        onChange={(text) => setLeaks(findLeaks(text))}
        sectionActions={{
          'リクエスト / レスポンス': (
            <button type="button" className="btn quiet small" onClick={() => setHttpOpen(true)}>HTTP を貼り付け</button>
          ),
        }}
        renderAside={({ insert }) => (
          <EvidencePanel
            eid={current.id}
            prefix={finding.id}
            onInsert={(md) => insert('発見場所', md)}
            onPasted={(md) => {
              const heading = insert('発見場所', md, { target: 'focused', silent: true })
              notify(`貼り付けた画像を証跡として保存し、『${heading}』に挿入しました。保存すると Markdown に反映します。`)
            }}
          />
        )}
      />

      {httpOpen && (
        <HttpPasteDialog
          onClose={() => setHttpOpen(false)}
          onInsert={(md) => {
            editor.current?.insert('リクエスト / レスポンス', md)
            setHttpOpen(false)
          }}
        />
      )}

      {calc && (
        <Dialog title="CVSS 計算機" className="cvss-legacy" onClose={() => setCalc(false)}>
          <CvssCalculator
            initialVector={finding.cvss_vector}
            onClose={() => setCalc(false)}
            onApply={async ({ vector, score }) => {
              // 読み込んだときの CVSS の値を base として送り、ほかの場所で同じ欄が変わっていたら上書きしません。
              const base = editor.current?.baseFor(['cvss_vector', 'cvss_score']) ?? {}
              let saved
              try {
                saved = await api.saveDoc({ file: finding.file, data: { cvss_vector: vector, cvss_score: score }, ...base })
              } catch (e) {
                if (e instanceof StaleWriteError) {
                  notify('CVSS の欄がほかの場所で更新されていたため、反映していません。個票を開き直してから、もう一度反映してください')
                  return
                }
                throw e
              }
              // 編集中の内容を残したまま、反映した欄だけを更新します。版も引き継ぎ、次の保存で誤って競合にしません。
              editor.current?.applyExternal({
                cvss_vector: saved.data.cvss_vector,
                cvss_score: saved.data.cvss_score,
                severity: saved.data.severity,
                severity_source: saved.data.severity_source,
              }, saved.version, saved)
              if (saved.data.severity_source === 'manual') notify('CVSS を反映しました。深刻度は手動で決めた値のままです')
              else if (score === '') notify('CVSS 4.0 のベクタを反映しました。基本値を手で入力すると深刻度が決まります')
              else notify('CVSS を個票へ反映しました')
              setCalc(false)
              reload()
              bump()
            }}
          />
        </Dialog>
      )}
    </>
  )
}
