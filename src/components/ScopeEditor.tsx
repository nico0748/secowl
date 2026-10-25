import { useEffect, useMemo, useState } from 'react'
import { api, StaleWriteError } from '../api'
import { useStore } from '../state'
import type { Doc } from '../types'
import {
  ALLOW_NOTE, SCOPE_KEYS, canonicalTarget, evaluate, parsePattern, parsePortList, scopeWarnings, type Verdict,
} from '../../shared/scope.js'

type Key = 'scope_targets' | 'scope_deny' | 'scope_allow' | 'scope_ports'

const FIELDS: { key: Key; label: string; hint: string; placeholder: string }[] = [
  {
    key: 'scope_targets',
    label: 'スコープ対象（scope_targets）',
    hint: '診断してよい対象を 1 行に 1 つ書きます。*.example.com はサブドメイン（a.b.example.com のような多段も含む）に一致し、example.com 自身は含みません。',
    placeholder: 'app.example.com\n*.example.com\n198.51.100.0/24',
  },
  {
    key: 'scope_deny',
    label: '除外（scope_deny）',
    hint: 'ここに一致した対象は、ほかの設定にかかわらず実行しません。決済の本番系や外部の SaaS などを書きます。',
    placeholder: 'payment.example.com',
  },
  {
    key: 'scope_allow',
    label: '例外として許可（scope_allow）',
    hint: 'スコープ外でも実行を許す、自分の検証環境です。顧客の資産は書かないでください。',
    placeholder: '10.10.0.0/16',
  },
  {
    key: 'scope_ports',
    label: 'ポート（scope_ports）',
    hint: '空なら全ポートです。1 行に 1 つ、443 や 8000-8100 の形で書きます。',
    placeholder: '443\n8000-8100',
  },
]

const VERDICT_CLASS: Record<Verdict, string> = { in: 'ok', allow: 'warn', out: 'ng', deny: 'ng', invalid: 'ng' }

const toText = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).join('\n') : v === undefined || v === null || v === '' ? '' : String(v))
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)

function textsOf(doc: Doc): Record<Key, string> {
  return Object.fromEntries(FIELDS.map((f) => [f.key, toText(doc.data[f.key])])) as Record<Key, string>
}

/** 入力欄の文字列を、保存する値に変えます。ポートは数だけの行を数値にします。 */
function toData(texts: Record<Key, string>) {
  const out: Record<string, unknown> = {}
  for (const f of FIELDS) {
    const ls = lines(texts[f.key])
    out[f.key] = f.key === 'scope_ports' ? ls.map((l) => (/^\d+$/.test(l) ? Number(l) : l)) : ls
  }
  return out
}

/** 1 行ずつ解釈し、書き方の誤りを行番号つきで返します。 */
function lineErrors(key: Key, text: string): string[] {
  const out: string[] = []
  text.split('\n').forEach((raw, i) => {
    const l = raw.trim()
    if (!l) return
    const err = key === 'scope_ports' ? parsePortList(l).error : parsePattern(l).error
    if (err) out.push(`${i + 1} 行目「${l}」: ${err}`)
  })
  return out
}

/**
 * 機械可読スコープ（S4）。スコープ文書の frontmatter の scope_* を 1 行 1 値で編集し、
 * 対象を入れると、いまの入力内容でどう判定されるかを参考として表示します。
 */
export function ScopeEditor({ doc }: { doc: Doc }) {
  const { notify, bump } = useStore()
  const [base, setBase] = useState<Doc>(doc)
  const [texts, setTexts] = useState<Record<Key, string>>(() => textsOf(doc))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null)
  const [stale, setStale] = useState<Doc | null>(null)
  const [ackWarnings, setAckWarnings] = useState(false)
  const [probe, setProbe] = useState('')

  const initial = useMemo(() => textsOf(base), [base])
  const dirty = FIELDS.some((f) => lines(texts[f.key]).join('\n') !== lines(initial[f.key]).join('\n'))

  // ほかの欄の保存などで文書が読み直されたら、編集していないときだけ表示を新しくします。
  useEffect(() => {
    if (doc.version === base.version) return
    if (!dirty) {
      setBase(doc)
      setTexts(textsOf(doc))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.version])

  const errors = Object.fromEntries(FIELDS.map((f) => [f.key, lineErrors(f.key, texts[f.key])])) as Record<Key, string[]>
  const errorCount = FIELDS.reduce((n, f) => n + errors[f.key].length, 0)
  const data = toData(texts)
  const warnings = scopeWarnings(data)

  const result = useMemo(() => {
    if (!probe.trim()) return null
    const canon = canonicalTarget(probe)
    return { canon, ev: evaluate(canon, data) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe, JSON.stringify(data)])

  const save = async () => {
    if (saving) return
    if (errorCount) {
      setMessage({ kind: 'error', text: `書き方に誤りがある行が ${errorCount} 件あります。直してから保存してください。保存していません。` })
      return
    }
    if (warnings.length && !ackWarnings) {
      setAckWarnings(true)
      setMessage({ kind: 'warn', text: `${warnings.map((w) => w.message).join(' ')} よければ、もう一度「このまま保存」を押してください。` })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const saved = await api.saveDoc({
        file: base.file,
        data,
        baseVersion: base.version,
        baseFields: Object.fromEntries(SCOPE_KEYS.map((k) => [k, base.data[k] ?? null])),
      })
      setBase(saved)
      setTexts(textsOf(saved))
      setAckWarnings(false)
      notify('スコープを保存しました')
      bump()
    } catch (e) {
      if (e instanceof StaleWriteError && e.current) {
        setStale(e.current)
        setMessage({ kind: 'error', text: '開いたあとで、スコープの欄がほかの場所で更新されています。保存していません。保存されている内容を読み込んでから、もう一度編集してください。' })
      } else {
        setMessage({ kind: 'error', text: String((e as Error).message) })
      }
    } finally {
      setSaving(false)
    }
  }

  const loadStale = () => {
    if (!stale) return
    setBase(stale)
    setTexts(textsOf(stale))
    setStale(null)
    setMessage(null)
    setAckWarnings(false)
  }

  const showCanon = result && !('error' in result.canon) && result.canon.value !== probe.trim()

  return (
    <section className="card scope-card" aria-labelledby="scope-machine-title">
      <div className="card-head">
        <h2 className="card-title" id="scope-machine-title">機械可読スコープ</h2>
        <span className="card-note">アプリからコマンドを実行するときの判定に使います</span>
      </div>
      <p className="hint-text">
        1 行に 1 つ書きます。IP は 198.51.100.7 や 198.51.100.0/24、IPv6 は 2001:db8::/32 の形です。
        どれかの行を解釈できないときは、この診断対象ではコマンドを実行できません。
      </p>

      <div className="grid-2 scope-fields">
        {FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`scope-${f.key}`}>{f.label}</label>
            <textarea
              id={`scope-${f.key}`}
              className="scope-lines"
              value={texts[f.key]}
              placeholder={f.placeholder}
              spellCheck={false}
              aria-invalid={errors[f.key].length > 0}
              aria-describedby={`scope-${f.key}-hint`}
              onChange={(e) => { setTexts({ ...texts, [f.key]: e.target.value }); setAckWarnings(false); if (!stale) setMessage(null) }}
            />
            <span className="hint" id={`scope-${f.key}-hint`}>{f.hint}</span>
            {errors[f.key].length > 0 && (
              <ul className="scope-errors" role="alert">
                {errors[f.key].map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      {warnings.length > 0 && !message && (
        <div className="banner warn" role="status">
          <p className="banner-text">{warnings.map((w) => w.message).join(' ')}</p>
        </div>
      )}
      {message && (
        <div className={`banner ${message.kind}`} role="alert">
          <p className="banner-text">{message.text}</p>
          {stale && (
            <div className="banner-actions">
              <button className="btn secondary small" onClick={loadStale}>保存されている内容を読み込む（編集中の内容は破棄）</button>
            </div>
          )}
        </div>
      )}

      <div className="scope-savebar">
        <span className={`doc-dirty${dirty ? ' on' : ''}`} aria-live="polite">{dirty ? '未保存の変更があります' : '保存済み'}</span>
        <button className="btn" onClick={save} disabled={saving || !!stale}>
          {saving ? '保存しています…' : warnings.length && ackWarnings ? 'このまま保存' : 'スコープを保存'}
        </button>
      </div>

      <div className="scope-probe">
        <label htmlFor="scope-probe-input">判定を試す</label>
        <input
          id="scope-probe-input"
          type="text"
          value={probe}
          placeholder="api.example.com、https://app.example.com/login、198.51.100.7:443 など"
          spellCheck={false}
          onChange={(e) => setProbe(e.target.value)}
        />
        <span className="hint">いまの入力内容（未保存を含む）で判定した参考表示です。実行するときの判定はサーバが行います。</span>
        {result && (
          <div className="scope-result" role="status" aria-live="polite">
            <span className={`tag verdict ${VERDICT_CLASS[result.ev.verdict]}`}>{result.ev.label}</span>
            <div className="scope-result-text">
              {showCanon && 'value' in result.canon && (
                <p>判定に使う値: <code>{result.canon.value}</code></p>
              )}
              <p>{result.ev.reason}</p>
              {result.ev.verdict === 'allow' && <p className="scope-allow-note">{ALLOW_NOTE}</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
