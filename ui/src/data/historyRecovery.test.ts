import { afterEach, expect, it, vi } from 'vitest'
import { loadHistory, totalExp } from './history'
import { loadGear } from './gear'

afterEach(() => vi.unstubAllGlobals())

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
