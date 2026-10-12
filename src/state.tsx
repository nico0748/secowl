import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import type { Engagement, Meta } from './types'

interface Store {
  meta: Meta | null
  engagements: Engagement[]
  current: Engagement | null
  setCurrentId: (id: string) => void
  reloadEngagements: () => Promise<void>
  reloadMeta: () => Promise<void>
  error: string | null
  toast: string | null
  notify: (msg: string) => void
  revision: number
  bump: () => void
}

const Ctx = createContext<Store | null>(null)
const KEY = 'secowl.engagement'

export function StoreProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [currentId, setCurrentIdState] = useState<string>(() => {
    try { return localStorage.getItem(KEY) || '' } catch { return '' }
  })
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const reloadMeta = useCallback(async () => {
    try {
      const m = await api.meta()
      setMeta(m)
      // デスクトップ版だけに効くスタイルを有効にします。
      if (m.desktop) document.documentElement.dataset.desktop = 'true'
      else delete document.documentElement.dataset.desktop
    } catch (e) {
      setError(String((e as Error).message))
    }
  }, [])

  const reloadEngagements = useCallback(async () => {
    try {
      const list = await api.engagements()
      setEngagements(list)
      setCurrentIdState((prev) => (prev && list.some((e) => e.id === prev) ? prev : list[0]?.id || ''))
    } catch (e) {
      setError(String((e as Error).message))
    }
  }, [])

  useEffect(() => { void reloadMeta(); void reloadEngagements() }, [reloadMeta, reloadEngagements])

  const setCurrentId = useCallback((id: string) => {
    setCurrentIdState(id)
    try { localStorage.setItem(KEY, id) } catch { /* 保存できない環境では記憶しません */ }
  }, [])

  const notify = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  const value = useMemo<Store>(() => ({
    meta,
    engagements,
    current: engagements.find((e) => e.id === currentId) || null,
    setCurrentId,
    reloadEngagements,
    reloadMeta,
    error,
    toast,
    notify,
    revision,
    bump: () => setRevision((n) => n + 1),
  }), [meta, engagements, currentId, setCurrentId, reloadEngagements, reloadMeta, error, toast, notify, revision])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('StoreProvider の内側で使ってください')
  return v
}

/** 非同期の取得を 1 行で書くための補助。revision が変わると再取得します。 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e) => { if (alive) setError(String((e as Error).message)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, error, loading, reload: () => setTick((n) => n + 1) }
}
