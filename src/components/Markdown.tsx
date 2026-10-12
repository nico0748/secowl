import { useMemo } from 'react'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

/** Markdown をプレビュー表示します。表示先はローカルで生成した内容だけに限定してください。 */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => marked.parse(source || '') as string, [source])
  return <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
}
