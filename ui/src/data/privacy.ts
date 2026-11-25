const preference = 'fitpal.keep-summaries'

export function keepSummaries(store?: Pick<Storage, 'getItem'>) {
  try { return (store ?? localStorage).getItem(preference) !== 'off' }
  catch { return false }
}

export function setKeepSummaries(keep: boolean) {
  try { localStorage.setItem(preference, keep ? 'on' : 'off'); return true }
  catch { return false }
}

export function progressKey(key: string) {
  return ['fitpal.history.v3', 'fitpal.history.v2', 'fitpal.gear.v2', 'fitpal.gear.v1'].includes(key) || key.startsWith('fitpal.manual.v1.')
}

/** Invoked only from the confirmed reset action in the history screen. */
export async function clearLocalProgress() {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
  for (const key of keys) if (key && progressKey(key)) localStorage.removeItem(key)
  if (typeof indexedDB !== 'undefined') await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('fitpal-collection-v1')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
