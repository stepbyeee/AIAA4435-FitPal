import { exerciseById } from './exercises'
import { today } from './history'

const prefix = 'fitpal.manual.v1.'
export type ManualEntry = { id: string; exerciseId: string; reps: number; date: string }

export function manualEntry(exerciseId: string, reps: number) {
  if (!exerciseById(exerciseId) || !Number.isInteger(reps) || reps < 1 || reps > 999) return null
  return { exerciseId, reps, date: today() }
}

export function listManual(storage?: Pick<Storage, 'length' | 'key' | 'getItem'>): ManualEntry[] {
  const entries: ManualEntry[] = []
  try {
    const store = storage ?? localStorage
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index)
      if (!key?.startsWith(prefix)) continue
      try {
        const value = JSON.parse(store.getItem(key) ?? 'null')
        if (value && manualEntry(value.exerciseId, value.reps) && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
          entries.push({ id:key.slice(prefix.length), exerciseId:value.exerciseId, reps:value.reps, date:value.date })
        }
      } catch { /* Skip an unreadable row; other entries can still be shown. */ }
    }
  } catch { return entries }
  return entries.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

export function saveManual(exerciseId: string, reps: number) {
  const row = manualEntry(exerciseId, reps)
  if (!row) return false
  try {
    localStorage.setItem(prefix + Date.now() + '-' + crypto.randomUUID(), JSON.stringify(row))
    return true
  } catch { return false }
}
