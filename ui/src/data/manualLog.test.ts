import { describe, it, expect } from 'vitest'
import { manualEntry, listManual } from './manualLog'
const rows = new Map<string, string>()
const storage = {
  get length() { return rows.size },
  key: (i: number) => [...rows.keys()][i] ?? null,
  getItem: (key: string) => rows.get(key) ?? null,
}
describe('manual logs', () => {
  it('accepts whole reps for known exercises only', () => {
    expect(manualEntry('seated-row',8)).toMatchObject({ reps:8, exerciseId:'seated-row' })
    expect(manualEntry('wrong',12)).toBeNull()
    expect(manualEntry('shoulder-press',0)).toBeNull()
    expect(manualEntry('shoulder-press',2.3)).toBeNull()
  })
  it('skips other FitPal keys and invalid entries', () => {
    rows.set('fitpal.history.v3','[]')
    rows.set('fitpal.manual.v1.bad','{')
    rows.set('fitpal.manual.v1.s1',JSON.stringify({exerciseId:'seated-row',reps:8,date:'2026-11-23'}))
    expect(listManual(storage)).toEqual([{ id:'s1', exerciseId:'seated-row',reps:8,date:'2026-11-23' }])
  })
})
