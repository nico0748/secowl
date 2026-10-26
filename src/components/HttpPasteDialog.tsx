import { useMemo, useState } from 'react'
import { Dialog } from './Dialog'
import { Markdown } from './Markdown'
import { fence, findLeaks, redactHttp } from '../../shared/redact.js'

const MAX_BODY_LINES = 200
const HIT_LABEL: Record<string, string> = {
  cookie: 'Cookie', authorization: 'Authorization', jwt: 'JWT', secret: 'API キー・トークン・パスワード',
  email: 'メールアドレス', term: '伏せる語句',
}

/** レスポンスの本文（ヘッダの後の空行より後ろ）が長すぎるときは、先頭の 200 行に切り詰めます。 */
function truncateBody(text: string): { text: string; omitted: number } {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blank = lines.findIndex((l) => l.trim() === '')
  const headEnd = blank === -1 ? 0 : blank + 1
  const body = lines.slice(headEnd)
  if (body.length <= MAX_BODY_LINES) return { text: lines.join('\n'), omitted: 0 }
  return { text: [...lines.slice(0, headEnd), ...body.slice(0, MAX_BODY_LINES)].join('\n'), omitted: body.length - MAX_BODY_LINES }
}

/**
 * リクエストとレスポンスを貼り付け、Cookie・Authorization・JWT を伏せてから
 * 「リクエスト / レスポンス」の見出しへコードブロックとして追記します。
 */
export function HttpPasteDialog({ onClose, onInsert }: { onClose: () => void; onInsert: (markdown: string) => void }) {
  const [req, setReq] = useState('')
  const [res, setRes] = useState('')
  const [opts, setOpts] = useState({ cookie: true, authorization: true, jwt: true, secret: true, email: true })
  const [terms, setTerms] = useState('')

  const result = useMemo(() => {
    const o = { ...opts, terms: terms.split('\n').map((t) => t.trim()).filter(Boolean) }
    const r1 = redactHttp(req.replace(/\r\n/g, '\n'), o)
    const r2 = redactHttp(res.replace(/\r\n/g, '\n'), o)
    const cut = truncateBody(r2.text)
    const hits = new Map<string, number>()
    for (const h of [...r1.hits, ...r2.hits]) hits.set(h.kind, (hits.get(h.kind) || 0) + h.count)
    const parts: string[] = []
    if (r1.text.trim()) parts.push('**リクエスト**', '', fence(r1.text, 'http'))
    if (cut.text.trim()) {
      if (parts.length) parts.push('')
      parts.push('**レスポンス**', '', fence(cut.text, 'http'))
      if (cut.omitted > 0) parts.push('', `（以下 ${cut.omitted} 行を省略）`)
    }
    const markdown = parts.join('\n')
    // 伏せた後の仕上がりにも点検をかけ、伏せ残しの疑いを知らせます。
    return { markdown, hits: [...hits.entries()], leaks: findLeaks(markdown) }
  }, [req, res, opts, terms])

  const toggle = (k: keyof typeof opts) => setOpts((p) => ({ ...p, [k]: !p[k] }))

  return (
    <Dialog title="HTTP を貼り付け" onClose={onClose} wide>
      <div className="http-paste">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="http-req">リクエスト</label>
            <textarea id="http-req" value={req} onChange={(e) => setReq(e.target.value)} placeholder={'GET /api/v1/orders/1002 HTTP/1.1\nHost: api.example.com\nCookie: …'} />
          </div>
          <div className="field">
            <label htmlFor="http-res">レスポンス</label>
            <textarea id="http-res" value={res} onChange={(e) => setRes(e.target.value)} placeholder={'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{ … }'} />
          </div>
        </div>
        <div className="http-paste-options">
          <label className="check-item"><input type="checkbox" checked={opts.cookie} onChange={() => toggle('cookie')} /><span>Cookie の値を伏せる</span></label>
          <label className="check-item"><input type="checkbox" checked={opts.authorization} onChange={() => toggle('authorization')} /><span>Authorization を伏せる</span></label>
          <label className="check-item"><input type="checkbox" checked={opts.jwt} onChange={() => toggle('jwt')} /><span>JWT を伏せる</span></label>
          <label className="check-item"><input type="checkbox" checked={opts.secret} onChange={() => toggle('secret')} /><span>API キー・トークン・パスワードを伏せる</span></label>
          <label className="check-item"><input type="checkbox" checked={opts.email} onChange={() => toggle('email')} /><span>メールアドレスを伏せる</span></label>
        </div>
        <div className="field">
          <label htmlFor="http-terms">伏せる語句（1 行に 1 つ）</label>
          <textarea id="http-terms" className="terms" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={'taro.yamada@corp.example\n090-0000-0000'} />
        </div>
        <div className="field">
          <span className="field-label">仕上がり</span>
          <div className="http-preview">
            {result.markdown
              ? <Markdown source={result.markdown} />
              : <p className="hint-text">リクエストかレスポンスを貼り付けると、ここに仕上がりが出ます。</p>}
          </div>
          {result.hits.length > 0 && (
            <p className="http-hits">伏せた値: {result.hits.map(([k, n]) => `${HIT_LABEL[k] ?? k} ${n} 件`).join('、')}</p>
          )}
          {result.leaks.length > 0 && (
            <div className="banner warn" role="alert">
              伏せ残しの疑いがあります: {result.leaks.map((l) => `${HIT_LABEL[l.kind] ?? l.kind} ${l.count} 件`).join('、')}。
              チェックを入れるか、「伏せる語句」に値を足してください。
            </div>
          )}
        </div>
      </div>
      <div className="dialog-actions sticky">
        <button className="btn quiet" onClick={onClose}>キャンセル</button>
        <button className="btn" disabled={!result.markdown} onClick={() => onInsert(result.markdown)}>挿入</button>
      </div>
    </Dialog>
  )
}
