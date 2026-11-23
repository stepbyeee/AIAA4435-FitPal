import { EXERCISES, type Half } from './exercises'

export type SetRecord = { verified: number; quality: number; fixed: number }

/** The last set of a session, kept so the next visit can open on what was left to fix. */
export type LastSet = {
  /** Deepest q of each rep; null when depth was unavailable. */
  depths: (number | null)[]
  /** Indices of verified reps whose range could not be measured. */
  countOnly?: number[]
  issue: { id: string; count: number } | null
}

export type SessionRecord = {
  id?: string
  date: string
  exerciseId: string
  sets: SetRecord[]
  lastSet?: LastSet
  outstandingIssueId?: string | null
}

// Sample history for the explicit character preview.
export const SAMPLE_HISTORY: SessionRecord[] = [
  { date: '2026-11-08', exerciseId: 'lat-pulldown', sets: [{ verified: 8, quality: 0, fixed: 0 }, { verified: 9, quality: 0, fixed: 0 }, { verified: 8, quality: 0, fixed: 0 }] },
  { date: '2026-11-10', exerciseId: 'lat-pulldown', sets: [{ verified: 9, quality: 0, fixed: 0 }, { verified: 10, quality: 5, fixed: 0 }, { verified: 8, quality: 0, fixed: 0 }] },
  { date: '2026-11-12', exerciseId: 'lat-pulldown', sets: [{ verified: 10, quality: 5, fixed: 5 }, { verified: 10, quality: 5, fixed: 0 }, { verified: 9, quality: 0, fixed: 0 }] },
  { date: '2026-11-14', exerciseId: 'lat-pulldown', sets: [{ verified: 10, quality: 5, fixed: 0 }, { verified: 10, quality: 5, fixed: 5 }, { verified: 10, quality: 5, fixed: 0 }] },
  {
    date: '2026-11-17',
    exerciseId: 'lat-pulldown',
    sets: [{ verified: 10, quality: 5, fixed: 0 }, { verified: 10, quality: 5, fixed: 0 }, { verified: 9, quality: 0, fixed: 0 }],
    lastSet: { depths: [1, 1, 0.97, 0.95, 0.96, 0.93, 0.9, 0.8, null, 0.72], issue: { id: 'short_range', count: 2 } },
  },
]

// The UI shell used v2 for simulated sets. Real sessions begin in a new store.
const KEY = 'fitpal.history.v3'

export function loadHistory(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows)) return []
    const validCount = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
    const valid: SessionRecord[] = []
    for (const row of rows) {
      if (!row || typeof row.date !== 'string' || typeof row.exerciseId !== 'string' || !Array.isArray(row.sets)) continue
      if (!row.sets.every((set: SetRecord | null) => set && [set.verified, set.quality, set.fixed].every(validCount))) continue
      const { lastSet, outstandingIssueId } = row
      const record: SessionRecord = { date: row.date, exerciseId: row.exerciseId, sets: row.sets }
      if (typeof row.id === 'string') record.id = row.id
      if (lastSet && Array.isArray(lastSet.depths) && lastSet.depths.every((d: unknown) =>
        d === null || (typeof d === 'number' && Number.isFinite(d) && d >= 0 && d <= 1)
      ) && (lastSet.issue === null || (typeof lastSet.issue?.id === 'string' && validCount(lastSet.issue.count)))) {
        record.lastSet = { depths: lastSet.depths, issue: lastSet.issue }
        if (Array.isArray(lastSet.countOnly)) {
          record.lastSet.countOnly = [...new Set<number>(lastSet.countOnly.filter((i: number) =>
            validCount(i) && i < lastSet.depths.length && lastSet.depths[i] === null))]
        }
      }
      if (outstandingIssueId === null || typeof outstandingIssueId === 'string') record.outstandingIssueId = outstandingIssueId
      valid.push(record)
    }
    return valid
  } catch {
    // Storage can be unavailable. The session can still run.
  }
  return []
}

export function saveSession(record: SessionRecord): SessionRecord[] {
  const next = loadHistory()
  const index = record.id ? next.findIndex(s => s.id === record.id) : -1
  if (index < 0) next.push(record)
  else if (record.sets.length >= next[index].sets.length) next[index] = record
  else return next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Nothing to do: the session is simply not kept.
  }
  return next
}

export const setExp = (s: SetRecord) => s.verified + s.quality + s.fixed
export const sessionExp = (s: SessionRecord) => s.sets.reduce((sum, set) => sum + setExp(set), 0)
export const sessionReps = (s: SessionRecord) => s.sets.reduce((sum, set) => sum + set.verified, 0)
export const totalExp = (h: SessionRecord[]) => h.reduce((sum, s) => sum + sessionExp(s), 0)

/** EXP needed to reach a level. Level 1 starts at 0; each level costs 40 more than the last. */
export const threshold = (level: number) => 20 * level * (level - 1)

export function levelOf(exp: number) {
  let level = 1
  while (exp >= threshold(level + 1)) level++
  const into = exp - threshold(level)
  const span = threshold(level + 1) - threshold(level)
  return { level, into, span, toNext: span - into }
}

export function repsByExercise(h: SessionRecord[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of h) out[s.exerciseId] = (out[s.exerciseId] ?? 0) + sessionReps(s)
  return out
}

/** Verified reps on each half of the body. */
export function repsByHalf(h: SessionRecord[]): Record<Half, number> {
  const reps = repsByExercise(h)
  const out: Record<Half, number> = { upper: 0, lower: 0 }
  for (const e of EXERCISES) out[e.half] += reps[e.id] ?? 0
  return out
}

export const lastSessionOf = (h: SessionRecord[], exerciseId: string) => [...h].reverse().find((s) => s.exerciseId === exerciseId)

export function today() {
  const d = new Date()
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
