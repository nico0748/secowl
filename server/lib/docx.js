import fs from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'
import { dataRoot } from './config.js'
import { getEngagement, listFindings, readDoc, docPaths } from './store.js'
import { SEVERITIES, SEVERITY_META } from './severity.js'

const FONT = 'Yu Gothic'
const MONO = 'Consolas'
const HEAD = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]

/** PNG / JPEG のヘッダから画素数を読みます。読めないときは既定値を返します。 */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  return { w: 1200, h: 800 }
}

function inline(tokens, opts = {}) {
  const runs = []
  const walk = (list, state) => {
    for (const t of list || []) {
      switch (t.type) {
        case 'strong': walk(t.tokens, { ...state, bold: true }); break
        case 'em': walk(t.tokens, { ...state, italics: true }); break
        case 'del': walk(t.tokens, { ...state, strike: true }); break
        case 'link': walk(t.tokens, { ...state, color: '0017C1' }); break
        case 'codespan':
          runs.push(new TextRun({ text: t.text, font: MONO, size: 19, shading: { type: ShadingType.CLEAR, fill: 'F1F1F4' }, ...state }))
          break
        case 'br': runs.push(new TextRun({ text: '', break: 1 })); break
        case 'image': runs.push(new TextRun({ text: `［画像: ${t.text || t.href}］`, italics: true, color: '626264' })); break
        default:
          if (t.tokens) walk(t.tokens, state)
          else runs.push(new TextRun({ text: t.text ?? t.raw ?? '', font: FONT, size: opts.size ?? 21, ...state }))
      }
    }
  }
  walk(tokens, {})
  return runs.length ? runs : [new TextRun({ text: '', font: FONT })]
}

function codeParagraphs(text) {
  return text.split('\n').map((line, i, arr) =>
    new Paragraph({
      children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })],
      shading: { type: ShadingType.CLEAR, fill: 'F8F8FB' },
      spacing: { before: i === 0 ? 120 : 0, after: i === arr.length - 1 ? 120 : 0 },
      border: {
        left: { style: BorderStyle.SINGLE, size: 12, color: 'D8D8DB', space: 6 },
      },
    }),
  )
}

function tableFrom(token) {
  const cell = (tokens, header) =>
    new TableCell({
      children: [new Paragraph({ children: inline(tokens, { size: 19 }).map((r) => r) })],
      shading: header ? { type: ShadingType.CLEAR, fill: 'F1F1F4' } : undefined,
    })
  const rows = [
    new TableRow({ tableHeader: true, children: token.header.map((h) => cell(h.tokens, true)) }),
    ...token.rows.map((r) => new TableRow({ children: r.map((c) => cell(c.tokens, false)) })),
  ]
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

function imageParagraph(href, eid) {
  const clean = String(href).split(' ')[0].replace(/^<|>$/g, '')
  if (/^(https?:|data:)/.test(clean)) return null
  const root = dataRoot()
  for (const rel of [path.join(eid, clean.replace(/^\.\//, '').replace(/^\.\.\//, '')), path.join(eid, 'evidence', path.basename(clean))]) {
    const abs = path.resolve(root, rel)
    if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) continue
    const buf = fs.readFileSync(abs)
    const { w, h } = imageSize(buf)
    const maxW = 560
    const scale = Math.min(1, maxW / w)
    const type = path.extname(abs).toLowerCase() === '.png' ? 'png' : path.extname(abs).toLowerCase() === '.webp' ? 'png' : 'jpg'
    return new Paragraph({
      children: [new ImageRun({ type, data: buf, transformation: { width: Math.round(w * scale), height: Math.round(h * scale) } })],
      spacing: { before: 120, after: 120 },
    })
  }
  return null
}

/** Markdown のトークン列を docx の段落・表へ変換します。 */
function blocks(tokens, eid, depthOffset = 0) {
  const out = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
        out.push(new Paragraph({
          children: inline(t.tokens, { size: 21 }),
          heading: HEAD[Math.min(t.depth - 1 + depthOffset, 5)],
          spacing: { before: 240, after: 120 },
        }))
        break
      case 'paragraph': {
        const img = t.tokens?.length === 1 && t.tokens[0].type === 'image' ? imageParagraph(t.tokens[0].href, eid) : null
        out.push(img || new Paragraph({ children: inline(t.tokens), spacing: { after: 120 } }))
        break
      }
      case 'list':
        t.items.forEach((item, i) => {
          const itemTokens = item.tokens?.[0]?.tokens || item.tokens || [{ type: 'text', text: item.text }]
          const children = t.ordered
            ? [new TextRun({ text: `${(t.start || 1) + i}. `, font: FONT, size: 21 }), ...inline(itemTokens)]
            : inline(itemTokens)
          out.push(new Paragraph({
            children,
            bullet: t.ordered ? undefined : { level: 0 },
            indent: t.ordered ? { left: 360 } : undefined,
            spacing: { after: 40 },
          }))
        })
        break
      case 'code':
        out.push(...codeParagraphs(t.text))
        break
      case 'table':
        out.push(tableFrom(t))
        out.push(new Paragraph({ text: '', spacing: { after: 120 } }))
        break
      case 'blockquote':
        for (const p of blocks(t.tokens, eid, depthOffset)) {
          if (p instanceof Paragraph) out.push(p)
        }
        break
      case 'hr':
        out.push(new Paragraph({ text: '', border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D8D8DB', space: 1 } }, spacing: { after: 160 } }))
        break
      case 'space':
      case 'html':
        break
      default:
        if (t.tokens) out.push(...blocks(t.tokens, eid, depthOffset))
        else if (t.text) out.push(new Paragraph({ children: inline([t]) }))
    }
  }
  return out
}

/** 報告書 Markdown を .docx のバッファへ変換します。 */
export async function reportDocx(eid) {
  const eng = getEngagement(eid)
  if (!eng) throw new Error('診断対象が見つかりません')
  const report = readDoc(docPaths(eid).report)
  const findings = listFindings(eid)
  const counts = Object.fromEntries(SEVERITIES.map((k) => [k, findings.filter((f) => f.severity === k).length]))
  const highest = SEVERITIES.find((k) => counts[k] > 0) || 'info'

  const cover = [
    new Paragraph({ text: '', spacing: { after: 2400 } }),
    new Paragraph({ children: [new TextRun({ text: '脆弱性診断報告書', font: FONT, size: 24, color: '626264' })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: eng.name, font: FONT, size: 48, bold: true })], alignment: AlignmentType.CENTER, spacing: { after: 600 } }),
    new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      rows: [
        ['提出先', eng.client || ''],
        ['診断対象', eng.target_system || ''],
        ['診断期間', `${eng.period_from} 〜 ${eng.period_to}`],
        ['総合リスク', SEVERITY_META[highest].ja],
        ['発見事項件数', `${findings.length} 件`],
      ].map(([k, v]) => new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: k, font: FONT, size: 20, bold: true })] })], shading: { type: ShadingType.CLEAR, fill: 'F1F1F4' } }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: v, font: FONT, size: 20 })] })] }),
        ],
      })),
    }),
    new Paragraph({
      children: [new TextRun({ text: '本書は機密文書です。取扱いには十分に注意してください。', font: FONT, size: 20 })],
      spacing: { before: 600 },
      shading: { type: ShadingType.CLEAR, fill: 'F3EEE5' },
    }),
    new Paragraph({ text: '', pageBreakBefore: true }),
  ]

  const body = blocks(marked.lexer(report.body.replace(/^#\s+.*$/m, '')), eid)

  const doc = new Document({
    creator: 'SecOwl',
    title: `${eng.name} 脆弱性診断報告書`,
    styles: {
      default: {
        document: { run: { font: FONT, size: 21 } },
        heading1: { run: { font: FONT, size: 32, bold: true, color: '1A1A1C' } },
        heading2: { run: { font: FONT, size: 26, bold: true, color: '1A1A1C' } },
        heading3: { run: { font: FONT, size: 23, bold: true, color: '1A1A1C' } },
        heading4: { run: { font: FONT, size: 21, bold: true, color: '414143' } },
      },
    },
    sections: [{ properties: {}, children: [...cover, ...body] }],
  })
  return Packer.toBuffer(doc)
}
