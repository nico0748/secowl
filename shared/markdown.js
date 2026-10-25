/**
 * Markdown を安全な HTML に変換します。アプリのプレビューと、共有バンドル・印刷用 HTML の両方で使います。
 *
 * - 生の HTML は描画せず、文字として出します（HTML コメントだけは空にします）
 * - リンクは http: / https: / mailto: / #… / 相対パスだけを許します
 * - 画像は http(s): / data:image/(png|jpeg|webp);base64, / 相対パスだけを許します
 * - 属性に入れる値は & < > " ' をすべてエスケープします
 */
import { Marked } from 'marked'

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** スキームを判定するために、制御文字と空白を取り除いた小文字の文字列を返します。 */
function normalizeUrl(u) {
  // eslint-disable-next-line no-control-regex
  return String(u ?? '').replace(/[\u0000- \u007f-\u009f]/g, '')
}

function schemeOf(u) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(u)
  return m ? m[1].toLowerCase() : ''
}

export function isSafeLink(href) {
  const u = normalizeUrl(href)
  if (!u) return false
  if (u.startsWith('#')) return true
  const s = schemeOf(u)
  if (!s) return !u.startsWith('//') // 相対パス（プロトコル相対は外部へ出るので除く）
  return s === 'http' || s === 'https' || s === 'mailto'
}

export function isSafeImage(src) {
  const u = normalizeUrl(src)
  if (!u) return false
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(u)) return true
  const s = schemeOf(u)
  if (!s) return !u.startsWith('//')
  return s === 'http' || s === 'https'
}

function unescapeHtml(s) {
  return String(s ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]))
}

/** HTML コメントだけを取り除きます。コメントに挟まれた本文は残します。 */
function stripComments(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '')
}

function makeMarked(resolveImage, externalImages) {
  const md = new Marked({ gfm: true })
  md.use({
    renderer: {
      html(token) {
        const rest = stripComments(token.text)
        if (!rest.trim()) return ''
        return escapeHtml(rest)
      },
      link(token) {
        const inner = this.parser.parseInline(token.tokens)
        // marked は自動リンクの href と title をエスケープ済みで渡すため、戻してからエスケープし直します。
        const raw = unescapeHtml(token.href)
        if (!isSafeLink(raw)) return inner
        const href = normalizeUrl(raw)
        const title = token.title ? ` title="${escapeHtml(unescapeHtml(token.title))}"` : ''
        const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''
        return `<a href="${escapeHtml(href)}"${title}${external}>${inner}</a>`
      },
      image(token) {
        // marked は画像の代替テキストを一度エスケープして渡すため、戻してからエスケープし直します。
        const alt = unescapeHtml(token.text || '')
        const raw = unescapeHtml(token.href)
        const resolved = resolveImage ? resolveImage(raw) : raw
        if (!isSafeImage(resolved)) return `［画像: ${escapeHtml(alt)}］`
        // 外部の画像は読み込まず（開いただけで外部へ要求が飛ぶため）、リンクとして示します。
        if (!externalImages && /^https?:/i.test(normalizeUrl(resolved))) {
          return `<a href="${escapeHtml(normalizeUrl(resolved))}" target="_blank" rel="noopener noreferrer">［外部画像: ${escapeHtml(alt || normalizeUrl(resolved))}］</a>`
        }
        const title = token.title ? ` title="${escapeHtml(unescapeHtml(token.title))}"` : ''
        return `<img src="${escapeHtml(normalizeUrl(resolved))}" alt="${escapeHtml(alt)}"${title}>`
      },
    },
  })
  return md
}

/** 画像の解決を伴わない共通のインスタンス。docx の字句解析にも使います。 */
export const md = makeMarked(null, false)

/**
 * Markdown を HTML にします。resolveImage を渡すと、画像の参照先を差し替えてから検査します。
 * externalImages を true にしない限り、http(s) の画像は読み込まずリンクとして示します。
 */
export function renderMarkdown(src, { resolveImage, externalImages = false } = {}) {
  const inst = resolveImage || externalImages ? makeMarked(resolveImage, externalImages) : md
  return inst.parse(String(src ?? ''), { async: false })
}
