import { useEffect, useRef, useState } from 'react'

interface Rect { x: number; y: number; w: number; h: number }

/** 塗りつぶしの色。画素に焼き込むため、テーマに関係なく tokens.css の --app-mask-fill（固定値）を使います。 */
function maskFill(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--app-mask-fill').trim()
}

/**
 * 画像の一部を塗りつぶして保存する編集画面です。
 * 塗りつぶしは画素を上書きします。元の画素は残らないため、保存後は元に戻せません。
 */
export function MaskEditor({ src, onSave, onClose }: {
  src: string
  onSave: (dataUrl: string) => Promise<void>
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [rects, setRects] = useState<Rect[]>([])
  const [drag, setDrag] = useState<Rect | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { imgRef.current = img; setReady(true) }
    img.onerror = () => setErr('画像を読み込めませんでした')
    img.src = src
  }, [src])

  useEffect(() => {
    const c = canvasRef.current
    const img = imgRef.current
    if (!c || !img || !ready) return
    const maxW = 860
    const scale = Math.min(1, maxW / img.naturalWidth)
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    c.style.width = `${Math.round(img.naturalWidth * scale)}px`
    c.style.height = `${Math.round(img.naturalHeight * scale)}px`
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    ctx.fillStyle = maskFill()
    for (const r of [...rects, ...(drag ? [drag] : [])]) ctx.fillRect(r.x, r.y, r.w, r.h)
  }, [ready, rects, drag])

  const toImageCoords = (e: React.MouseEvent) => {
    const c = canvasRef.current!
    const box = c.getBoundingClientRect()
    return { x: ((e.clientX - box.left) / box.width) * c.width, y: ((e.clientY - box.top) / box.height) * c.height }
  }

  const save = async () => {
    if (!canvasRef.current) return
    setBusy(true)
    try {
      await onSave(canvasRef.current.toDataURL('image/png'))
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {err && <div className="banner error">{err}</div>}
      <p style={{ fontSize: 14, color: 'var(--app-text-sub)', marginTop: 0 }}>
        画像の上をドラッグすると、その範囲を塗りつぶします。保存すると画素を上書きするため、塗りつぶした内容は元に戻せません。
      </p>
      <div style={{ overflow: 'auto', background: 'var(--app-card-sub)', padding: 'var(--sp-2)', borderRadius: 'var(--radius-sm)' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', cursor: 'crosshair', background: 'var(--app-canvas-paper)' }}
          onMouseDown={(e) => { const p = toImageCoords(e); setDrag({ x: p.x, y: p.y, w: 0, h: 0 }) }}
          onMouseMove={(e) => {
            if (!drag) return
            const p = toImageCoords(e)
            setDrag({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) })
          }}
          onMouseUp={() => {
            if (drag && drag.w > 3 && drag.h > 3) setRects((r) => [...r, drag])
            setDrag(null)
          }}
          onMouseLeave={() => setDrag(null)}
        />
      </div>
      <div className="dialog-actions">
        <span style={{ marginRight: 'auto', fontSize: 14, color: 'var(--app-text-muted)' }}>塗りつぶし {rects.length} 箇所</span>
        <button className="btn quiet" onClick={() => setRects([])} disabled={rects.length === 0}>やり直す</button>
        <button className="btn quiet" onClick={onClose}>閉じる</button>
        <button className="btn" onClick={save} disabled={busy || rects.length === 0}>{busy ? '保存しています…' : '上書き保存'}</button>
      </div>
    </div>
  )
}
