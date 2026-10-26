import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { api, StaleWriteError, type SaveDocPayload } from '../api'
import type { Doc, WriteConflict } from '../types'
import { Dialog } from './Dialog'
import { Markdown } from './Markdown'
import { useStore } from '../state'
import { syncFindingBody, isFindingDoc } from '../../shared/finding-table.js'
import { IS_MAC } from '../platform'

export interface FieldSpec {
  key: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox'
  options?: { value: string; label: string }[]
  /** select の空の選択肢の表示。既定は「（未設定）」 */
  emptyLabel?: string
  /** 欄の下に出す補足。関数なら、いまの値に応じて変えます。 */
  hint?: string | ((value: string) => string)
  /** 欄の横に添える補足（タグなど） */
  extra?: ReactNode
  /** frontmatter から欄の初期値を作る。省略すると値を文字列にしたものを使います。 */
  fromData?: (data: Record<string, unknown>) => string
}

export interface DocEditorHandle {
  /**
   * 外部（CVSS 計算機など）で保存した値を、編集中の内容を消さずに欄へ反映します。
   * saved（保存後の Doc）を渡すと、版と、編集していない見出しも保存後の内容にそろえます（自分の保存で 409 にしないため）。
   */
  applyExternal: (data: Record<string, unknown>, version?: string, saved?: Doc) => void
  /** 指定した欄について、読み込んだときの版と値を返します。外から saveDoc するときに base として送ります。 */
  baseFor: (keys: string[]) => Pick<SaveDocPayload, 'baseVersion' | 'baseFields'>
  /** 見出しの末尾に追記します。target が 'focused' なら、入力中の見出しを優先します。 */
  insert: (heading: string, text: string, opts?: { target?: 'focused'; silent?: boolean }) => string
}

interface Props {
  file: string
  fields?: FieldSpec[]
  /** 編集対象にする見出し。省略すると本文の全見出しを出します。 */
  sectionHeadings?: string[]
  onSaved?: (doc: Doc) => void
  /** 右側（プレビューの上）に差し込むパネル。insert で指定見出しの末尾へ追記できます。 */
  renderAside?: (api: { insert: DocEditorHandle['insert'] }) => ReactNode
  /** 見出しのラベルの横に置くボタンなど */
  sectionActions?: Record<string, ReactNode>
  /** 編集中の本文（全見出しを連結したもの）が変わるたびに呼ばれます。 */
  onChange?: (text: string) => void
  /** 保存の前に呼びます。文を返すと保存せず、その文を警告として出します。 */
  validate?: (data: Record<string, string>) => string | null
}

const toStr = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'boolean' ? String(v) : String(v))

function fieldValues(fields: FieldSpec[], data: Record<string, unknown>) {
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = f.fromData ? f.fromData(data) : toStr(data[f.key])
    // YAML が日付として読んだ値は ISO 形式で届くため、日付の欄では YYYY-MM-DD にそろえます。
    out[f.key] = f.type === 'date' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v
  }
  return out
}

/** 編集中の見出しを差し込んだ本文。プレビュー用で、サーバーの replaceSection と同じ形に組み立てます。 */
function previewBody(doc: Doc, sections: Record<string, string>) {
  return doc.sections
    .map((s) => {
      const content = s.heading && Object.prototype.hasOwnProperty.call(sections, s.heading) ? sections[s.heading] : s.content
      const head = s.heading ? `${'#'.repeat(s.level || 2)} ${s.heading}\n\n` : ''
      return head + (content ? content + '\n' : '')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function sectionValues(doc: Doc) {
  const out: Record<string, string> = {}
  for (const s of doc.sections) if (s.heading) out[s.heading] = s.content
  return out
}

/** fields に載せたキーだけ、送る前に型を戻します。 */
function convert(f: FieldSpec | undefined, v: string): unknown {
  if (f?.type === 'number') return v === '' ? '' : Number(v)
  if (f?.type === 'checkbox') return v === 'true'
  return v
}

export const DocEditor = forwardRef<DocEditorHandle, Props>(function DocEditor(
  { file, fields = [], sectionHeadings, onSaved, renderAside, sectionActions, onChange, validate },
  ref,
) {
  const { notify, bump } = useStore()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [initial, setInitial] = useState<Record<string, string>>({})
  const [data, setData] = useState<Record<string, string>>({})
  const [initialSections, setInitialSections] = useState<Record<string, string>>({})
  const [sections, setSections] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const focused = useRef<string | null>(null)
  const saveRef = useRef<() => void>(() => {})
  // 読み込んだときの状態。保存時に送り返し、サーバがほかの場所での変更と衝突していないかを確かめます。
  const baseVersion = useRef('')
  const baseSections = useRef<Record<string, string>>({})
  const baseFields = useRef<Record<string, unknown>>({})
  const [conflict, setConflict] = useState<{ current: Doc; conflicts: WriteConflict[] } | null>(null)
  const [resolving, setResolving] = useState(false)

  const reset = (d: Doc) => {
    baseVersion.current = d.version
    baseSections.current = { ...(d.sectionVersions || {}) }
    baseFields.current = { ...d.data }
    setDoc(d)
    const fv = fieldValues(fields, d.data)
    setInitial(fv)
    setData(fv)
    const sv = sectionValues(d)
    setInitialSections(sv)
    setSections(sv)
  }

  useEffect(() => {
    let alive = true
    api.doc(file)
      .then((d) => {
        if (!alive) return
        setErr(null)
        reset(d)
      })
      .catch((e) => alive && setErr(String((e as Error).message)))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const headings = doc
    ? sectionHeadings ?? doc.sections.filter((s) => s.heading).map((s) => s.heading as string)
    : []

  useEffect(() => {
    if (!doc || !onChange) return
    onChange(headings.map((h) => sections[h] ?? '').join('\n'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, doc])

  const insert: DocEditorHandle['insert'] = (heading, text, opts) => {
    let target = heading
    if (opts?.target === 'focused') {
      const active = document.activeElement as HTMLElement | null
      const h = active?.dataset?.heading
      if (h && headings.includes(h)) target = h
      else if (focused.current && headings.includes(focused.current) && active?.tagName === 'TEXTAREA') target = focused.current
    }
    setSections((prev) => ({ ...prev, [target]: [prev[target] ?? '', text].filter(Boolean).join('\n\n') }))
    if (!opts?.silent) notify(`「${target}」に追記しました。保存すると Markdown に反映します。`)
    return target
  }

  useImperativeHandle(ref, () => ({
    applyExternal: (next, version, saved) => {
      const fv = fieldValues(fields.filter((f) => Object.prototype.hasOwnProperty.call(next, f.key)), next)
      setData((prev) => ({ ...prev, ...fv }))
      setInitial((prev) => ({ ...prev, ...fv }))
      // 欄の base も保存後の値にそろえます。ただし編集中の欄（今回反映しないもの）は、読み込んだときの値のまま残します。
      const editing = new Set(fields.filter((f) => !Object.prototype.hasOwnProperty.call(next, f.key) && (data[f.key] ?? '') !== (initial[f.key] ?? '')).map((f) => f.key))
      for (const [k, v] of Object.entries(saved ? saved.data : next)) if (!editing.has(k)) baseFields.current[k] = v
      if (version) baseVersion.current = version
      if (saved) {
        // 編集していない見出しは保存後の内容に置き換えます。編集中の見出しは、版も中身もそのまま残します。
        const sv = sectionValues(saved)
        const untouched = Object.keys(sv).filter((h) => (sections[h] ?? '') === (initialSections[h] ?? ''))
        for (const h of untouched) baseSections.current[h] = saved.sectionVersions?.[h] ?? baseSections.current[h]
        const pick = Object.fromEntries(untouched.map((h) => [h, sv[h]]))
        setSections((prev) => ({ ...prev, ...pick }))
        setInitialSections((prev) => ({ ...prev, ...pick }))
        setDoc(saved)
      }
    },
    baseFor: (keys) => ({
      baseVersion: baseVersion.current,
      baseFields: Object.fromEntries(keys.map((k) => [k, baseFields.current[k] ?? null])),
    }),
    insert,
  }))

  const dirtyFields = fields.filter((f) => (data[f.key] ?? '') !== (initial[f.key] ?? ''))
  const dirtySections = headings.filter((h) => (sections[h] ?? '') !== (initialSections[h] ?? ''))
  const dirty = dirtyFields.length + dirtySections.length > 0

  // ⌘S / Ctrl+S で保存します。閉じる前には、未保存の変更があることを知らせます。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        if (document.querySelector('.dialog')) return
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  if (err) return <div className="banner error">{err}</div>
  if (!doc) return <div className="empty">読み込んでいます…</div>

  /** 編集した欄と見出しを、base（読み込んだときの版と値）付きの保存内容にまとめます。 */
  const buildPayload = (base: { version: string; sections: Record<string, string>; fields: Record<string, unknown> }): SaveDocPayload | null => {
    const changed: Record<string, unknown> = {}
    for (const f of dirtyFields) changed[f.key] = convert(f, data[f.key] ?? '')
    const changedSections = dirtySections.map((h) => ({ heading: h, content: sections[h] ?? '' }))
    if (Object.keys(changed).length === 0 && changedSections.length === 0) return null
    return {
      file,
      ...(Object.keys(changed).length ? { data: changed } : {}),
      ...(changedSections.length ? { sections: changedSections } : {}),
      baseVersion: base.version,
      baseSections: Object.fromEntries(dirtySections.map((h) => [h, base.sections[h] ?? null])),
      baseFields: Object.fromEntries(dirtyFields.map((f) => [f.key, base.fields[f.key] ?? null])),
    }
  }

  const finishSave = (saved: Doc) => {
    reset(saved)
    notify('Markdown に保存しました')
    bump()
    onSaved?.(saved)
  }

  const save = async () => {
    if (saving || conflict) return
    const payload = buildPayload({ version: baseVersion.current, sections: baseSections.current, fields: baseFields.current })
    if (!payload) {
      notify('変更はありません')
      return
    }
    const problem = validate?.(data) ?? null
    if (problem) {
      setSaveErr(problem)
      return
    }
    setSaveErr(null)
    setSaving(true)
    try {
      finishSave(await api.saveDoc(payload))
    } catch (e) {
      if (e instanceof StaleWriteError && e.current) {
        // ほかの場所での変更とぶつかりました。どちらを残すかを選んでもらいます（編集中の内容はそのまま）。
        setConflict({ current: e.current, conflicts: e.conflicts })
      } else {
        // 編集中の内容を残したまま、保存できなかった理由を出します。
        setSaveErr(String((e as Error).message))
      }
    } finally {
      setSaving(false)
    }
  }
  saveRef.current = save

  /** 保存されている内容を読み込みます。編集中の内容は破棄します。 */
  const loadCurrent = () => {
    if (!conflict) return
    reset(conflict.current)
    setConflict(null)
    setSaveErr(null)
    notify('保存されている内容を読み込みました')
    bump()
  }

  /** いま保存されている内容を基準にして、編集した見出しと欄だけをもう一度保存します。 */
  const overwriteEdited = async () => {
    if (!conflict) return
    const cur = conflict.current
    const payload = buildPayload({ version: cur.version, sections: cur.sectionVersions || {}, fields: cur.data })
    if (!payload) { setConflict(null); return }
    setResolving(true)
    try {
      const saved = await api.saveDoc(payload)
      setConflict(null)
      finishSave(saved)
    } catch (e) {
      if (e instanceof StaleWriteError && e.current) setConflict({ current: e.current, conflicts: e.conflicts })
      else { setConflict(null); setSaveErr(String((e as Error).message)) }
    } finally {
      setResolving(false)
    }
  }

  /** 破棄する前に退避できるよう、編集中の見出しと欄を Markdown にしてコピーします。 */
  const copyEdited = async () => {
    const parts: string[] = []
    for (const f of dirtyFields) parts.push(`${f.label}: ${data[f.key] ?? ''}`)
    for (const h of dirtySections) parts.push(`## ${h}\n\n${sections[h] ?? ''}`)
    try {
      await navigator.clipboard.writeText(parts.join('\n\n'))
      notify('編集中の内容をコピーしました')
    } catch {
      notify('コピーできませんでした。テキストを選んでコピーしてください')
    }
  }

  const fieldLabel = (key: string) => fields.find((f) => f.key === key)?.label ?? key
  const conflictNames = (conflict?.conflicts ?? [])
    .map((c) => (c.heading ? `見出し「${c.heading}」` : c.field ? `欄「${fieldLabel(c.field)}」` : null))
    .filter((v): v is string => !!v)
  const overwriteLabel = dirtySections.length && dirtyFields.length
    ? '編集した見出しと欄だけ上書きする'
    : dirtyFields.length ? '編集した欄だけ上書きする' : '編集した見出しだけ上書きする'

  // プレビューは保存前の内容から描きます。個票は「基本情報」表も欄の値にそろえます。
  const previewData: Record<string, unknown> = { ...doc.data }
  for (const f of fields) previewData[f.key] = convert(f, data[f.key] ?? '')
  const preview = isFindingDoc(doc.data)
    ? syncFindingBody(previewBody(doc, sections), previewData)
    : previewBody(doc, sections)

  return (
    <div className="doc-layout">
      <div className="card">
        {fields.length > 0 && (
          <div className="grid-2 doc-fields">
            {fields.map((f) => (
              <div className="field" key={f.key}>
                {f.type === 'checkbox' ? (
                  <label className="check-item" htmlFor={`fm-${f.key}`}>
                    <input
                      id={`fm-${f.key}`}
                      type="checkbox"
                      checked={data[f.key] === 'true'}
                      onChange={(e) => setData({ ...data, [f.key]: String(e.target.checked) })}
                    />
                    <span>{f.label}</span>
                  </label>
                ) : (
                  <>
                    <label htmlFor={`fm-${f.key}`}>{f.label}</label>
                    <div className="field-row">
                      {f.type === 'select' ? (
                        <select id={`fm-${f.key}`} value={data[f.key] ?? ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })}>
                          <option value="">{f.emptyLabel ?? '（未設定）'}</option>
                          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input
                          id={`fm-${f.key}`}
                          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                          step={f.type === 'number' ? '0.1' : undefined}
                          value={data[f.key] ?? ''}
                          onChange={(e) => setData({ ...data, [f.key]: e.target.value })}
                        />
                      )}
                      {f.extra}
                    </div>
                  </>
                )}
                {f.hint && <span className="hint">{typeof f.hint === 'function' ? f.hint(data[f.key] ?? '') : f.hint}</span>}
              </div>
            ))}
          </div>
        )}

        {headings.map((h) => (
          <div className="doc-section" key={h}>
            <div className="doc-section-head">
              <label htmlFor={`sec-${h}`}>{h}</label>
              {sectionActions?.[h]}
            </div>
            <textarea
              id={`sec-${h}`}
              data-heading={h}
              value={sections[h] ?? ''}
              onFocus={() => { focused.current = h }}
              onChange={(e) => setSections({ ...sections, [h]: e.target.value })}
            />
          </div>
        ))}

        <div className="doc-savebar" role="region" aria-label="保存">
          {saveErr && <div className="banner warn doc-save-error" role="alert">{saveErr}</div>}
          <span className="doc-path doc-path-grow" title={file}>{file}</span>
          <span className={`doc-dirty${dirty ? ' on' : ''}`} aria-live="polite">
            {dirty ? `未保存の変更があります（${dirtyFields.length + dirtySections.length} か所）` : '保存済み'}
          </span>
          <button className="btn" onClick={save} disabled={saving} title={`${IS_MAC ? '⌘S' : 'Ctrl+S'} でも保存できます`}>
            {saving ? '保存しています…' : 'Markdown に保存'}
          </button>
        </div>
      </div>

      {conflict && (
        <Dialog title="開いたあとで、このファイルが更新されています" onClose={() => setConflict(null)}>
          <p className="dialog-text">
            Obsidian や Claude（MCP）など、ほかの場所で保存された内容があります。どちらを残すか選んでください。
          </p>
          {conflictNames.length > 0 && (
            <div className="banner warn conflict-where">
              <p className="banner-text">あなたが編集した箇所のうち、ほかの場所でも変更されていたところ:</p>
              <ul className="banner-list">{conflictNames.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
          <div className="conflict-choices">
            <button className="btn" autoFocus onClick={loadCurrent} disabled={resolving}>
              保存されている内容を読み込む（編集中の内容は破棄）
            </button>
            <button className="btn secondary" onClick={overwriteEdited} disabled={resolving}>
              {resolving ? '保存しています…' : overwriteLabel}
            </button>
            <p className="hint-text">上書きしても、編集していない見出しと欄は保存されている内容のまま残ります。</p>
            <button className="btn quiet" onClick={copyEdited}>編集中の内容をコピー</button>
          </div>
        </Dialog>
      )}

      <div className="doc-aside">
        {renderAside?.({ insert })}
        <div className="card">
          <div className="card-head">
            <span className="card-title">プレビュー</span>
            {dirty && <span className="hint">保存前の内容を表示しています</span>}
          </div>
          <Markdown source={preview} eid={file.split(/[\\/]/)[0]} />
        </div>
      </div>
    </div>
  )
})
