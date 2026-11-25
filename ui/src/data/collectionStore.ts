import { useCallback, useEffect, useRef, useState } from 'react'
import { applyChoice, emptyCollection, normalizeCollection, type Collection, type CollectionChoice } from './collection'
import { loadHistory, today } from './history'

const STORE = 'closet'
const KEY = 'current'
const CHANNEL = 'fitpal-collection'

// A single read/write transaction serializes claims and draws across open tabs.
export async function accessCollection(choice?: CollectionChoice): Promise<Collection> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('fitpal-collection-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<Collection>((resolve, reject) => {
      const tx = db.transaction(STORE, choice ? 'readwrite' : 'readonly')
      const store = tx.objectStore(STORE)
      const query = store.get(KEY)
      let state = emptyCollection()
      query.onsuccess = () => {
        state = normalizeCollection(query.result)
        if (!choice) return
        const next = applyChoice(state, choice, today(), loadHistory())
        if (next !== state) store.put(next, KEY)
        state = next
      }
      tx.oncomplete = () => resolve(state)
      tx.onabort = () => reject(tx.error ?? new Error('Collection transaction aborted.'))
    })
  } finally { db.close() }
}

export function useCollection() {
  const [state, setState] = useState(emptyCollection)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  const pending = useRef(false)
  const version = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++version.current
    try {
      const result = await accessCollection()
      if (request === version.current) { setState(result); setReady(true); setError(null) }
    } catch {
      if (request === version.current) {
        setReady(false)
        setError('无法读取本地收藏。请检查浏览器的本地存储权限。')
      }
    }
  }, [])
  useEffect(() => {
    void refresh()
    window.addEventListener('focus', refresh)
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel.current = new BroadcastChannel(CHANNEL)
        channel.current.onmessage = refresh
      }
    } catch {
      // A restricted browser can still refresh from IndexedDB when the tab gains focus.
    }
    return () => {
      version.current++
      window.removeEventListener('focus', refresh)
      channel.current?.close()
      channel.current = null
    }
  }, [refresh])
  const change = async (choice: CollectionChoice) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const next = await accessCollection(choice)
      version.current++
      setState(next)
      setReady(true)
      setError(null)
      channel.current?.postMessage('changed')
    } catch {
      setError('收藏未能保存，请检查本地存储后重试。')
    } finally { pending.current = false; setBusy(false) }
  }
  return { state, ready, busy, error, change, refresh }
}
