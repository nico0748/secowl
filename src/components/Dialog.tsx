import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * ダイアログのフォーカス管理。Tab をダイアログの中で巡回させ、閉じたら開く前の要素へ戻します。
 */
export function useDialogFocus(ref: RefObject<HTMLElement>) {
  // 中の入力欄へフォーカスが移る前（最初の描画の時点）の要素を覚えておきます。
  const beforeRef = useRef<HTMLElement | null>(typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null)
  useEffect(() => {
    const before = beforeRef.current
    const onKey = (e: KeyboardEvent) => {
      const box = ref.current
      if (e.key !== 'Tab' || !box) return
      // 上に別のダイアログが重なっているときは、そちらに任せます。
      const dialogs = document.querySelectorAll('.dialog')
      if (dialogs[dialogs.length - 1] !== box) return
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!active || !box.contains(active)) { e.preventDefault(); first.focus(); return }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (before && document.contains(before)) before.focus?.()
    }
  }, [ref])
}

export function Dialog({ title, onClose, children, wide = false, className }: {
  title: string
  onClose: () => void
  children: ReactNode
  /** 広いダイアログ（2 列の入力欄など） */
  wide?: boolean
  /** ダイアログの中だけに効かせるスタイルのクラス */
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useDialogFocus(ref)

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className={`dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
