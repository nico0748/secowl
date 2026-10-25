import { useMemo } from 'react'
import { renderMarkdown } from '../../shared/markdown.js'

/** 証跡の参照（evidence/x.png と ../evidence/x.png）を、API の URL に解決します。 */
export function evidenceResolver(eid?: string) {
  return (src: string) => {
    if (!eid) return src
    const m = /^(?:\.\/)?(?:\.\.\/)?evidence\/([^/?#]+)$/.exec(String(src || '').trim())
    if (!m) return src
    let name: string
    try { name = decodeURIComponent(m[1]) } catch { return src }
    return `/api/engagements/${encodeURIComponent(eid)}/evidence/${encodeURIComponent(name)}`
  }
}

/**
 * Markdown をプレビュー表示します。
 * 生の HTML と、危険なスキームのリンク・画像は shared/markdown.js で取り除きます。
 */
export function Markdown({ source, eid }: { source: string; eid?: string }) {
  const html = useMemo(() => renderMarkdown(source || '', { resolveImage: evidenceResolver(eid) }), [source, eid])
  return <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
}
