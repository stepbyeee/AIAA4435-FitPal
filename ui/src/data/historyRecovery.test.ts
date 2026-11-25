import { afterEach, expect, it, vi } from 'vitest'
import { loadHistory, totalExp } from './history'
import { loadGear } from './gear'
import { summarizeMotion } from '../analytics/motion'
import { DEFAULT_PLAN } from '../training/plan'

afterEach(() => vi.unstubAllGlobals())

it('keeps validated training summaries and discards corrupt new metadata without losing EXP', () => {
  const motion = summarizeMotion([], 1, null)
  const base = { date: '2026-11-25', exerciseId: 'squat' }
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([
    { ...base, sets: [{ verified: 3, quality: 0, fixed: 0, motion, plan: DEFAULT_PLAN }] },
    { ...base, sets: [{ verified: 4, quality: 0, fixed: 0, motion: { ...motion, medianReturnMs: 'wrong' }, plan: { sets: -2 } }] },
  ]) })
  const rows = loadHistory()
  expect(rows[0].sets[0].motion).toEqual(motion)
  expect(rows[0].sets[0].plan).toEqual(DEFAULT_PLAN)
  expect(rows[1].sets[0].motion).toBeUndefined()
  expect(rows[1].sets[0].plan).toBeUndefined()
  expect(totalExp(rows)).toBe(7)
})

it('reports a storage failure instead of returning unsaved progress as saved', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota') } })
  const { saveSession } = await import('./history')
  expect(() => saveSession({ date: '2026-11-25', exerciseId: 'squat', sets: [{ verified: 3, quality: 0, fixed: 0 }] })).toThrow('quota')
})

it('rejects contradictory measurements but retains the real count', () => {
  const empty = summarizeMotion([], 1, null)
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([{ date: '2026-11-25', exerciseId: 'squat', sets: [
    { verified: 1, quality: 0, fixed: 0, motion: { ...empty, medianReturnMs: 2000 } },
    { verified: 1, quality: 0, fixed: 0, motion: { ...empty, measuredReps: 5, medianReturnMs: 2000 } },
  ] }]) })
  const sets = loadHistory()[0].sets
  expect(sets.every(s => s.motion === undefined)).toBe(true)
  expect(sets.map(s => s.verified)).toEqual([1, 1])
})

it('opens an older valid session and skips unreadable rows without losing its EXP', () => {
  const entry = { date:'2026-10-10', exerciseId:'lat-pulldown', sets:[{ verified:3,quality:0,fixed:0 }], lastSet:{ depths:'broken' } }
  vi.stubGlobal('localStorage',{getItem:() => JSON.stringify([null,entry,{sets:[null]}])})
  const rows = loadHistory()
  expect(rows).toHaveLength(1)
  expect(rows[0].lastSet).toBeUndefined()
  expect(totalExp(rows)).toBe(3)
})

it('recovers from valid JSON of the wrong shape', () => {
  vi.stubGlobal('localStorage',{getItem:() => '{}'})
  expect(loadHistory()).toEqual([])
  expect(loadGear()).toEqual([])
})

it('ignores unrecognized and repeated gear IDs', () => {
  vi.stubGlobal('localStorage',{getItem:() => '["tank","old-item","tank"]'})
  expect(loadGear()).toEqual(['tank'])
})

it('keeps one session across set settlements and ignores a late older snapshot', async () => {
  let raw: string | null = null
  vi.stubGlobal('localStorage',{getItem:() => raw,setItem:(_key: string, s: string) => {raw=s}})
  const { saveSession } = await import('./history')
  const set = {verified:2,quality:0,fixed:0}
  const first = { id:'s1', date:'2026-11-22', exerciseId:'lat-pulldown', sets:[set] }
  saveSession(first)
  saveSession({...first, sets:[set,set]})
  saveSession(first)
  expect(loadHistory()).toHaveLength(1)
  expect(totalExp(loadHistory())).toBe(4)
})

it('retains counted repetitions whose range is missing without reclassifying older missing attempts', () => {
  const set = { verified: 2, quality: 0, fixed: 0 }
  const base = { date: '2026-11-23', exerciseId: 'lat-pulldown', sets: [set] }
  const lastSet = { depths: [1, null, null], issue: null }
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([
    { ...base, lastSet }, { ...base, lastSet: { ...lastSet, countOnly: [1, 1, 0, -1, 8] } },
  ]) })
  const [old, current] = loadHistory()
  expect(old.lastSet?.countOnly).toBeUndefined()
  expect(current.lastSet?.countOnly).toEqual([1])
})
