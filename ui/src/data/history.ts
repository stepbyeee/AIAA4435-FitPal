import { EXERCISES, type Half } from './exercises'

export type SetRecord = { verified: number; quality: number; fixed: number }

/** The last set of a session, kept so the next visit can open on what was left to fix. */
export type LastSet = {
  /** Deepest q of each rep; null for a rep the camera could not verify. */
  depths: (number | null)[]
  issue: { id: string; count: number } | null
}

export type SessionRecord = { date: string; exerciseId: string; sets: SetRecord[]; lastSet?: LastSet }

// Sample history so the home screen is seen with data. Replaced by real sessions as they are saved.
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

const KEY = 'fitpal.history.v2'

export function loadHistory(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as SessionRecord[]
  } catch {
    // Storage can be unavailable; the sample still renders.
  }
  return SAMPLE_HISTORY
}

export function saveSession(record: SessionRecord): SessionRecord[] {
  const next = [...loadHistory(), record]
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
