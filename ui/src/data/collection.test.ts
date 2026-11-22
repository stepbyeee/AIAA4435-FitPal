import { describe, expect, it } from 'vitest'
import { applyChoice, cosmetics, emptyCollection, normalizeCollection, ticketTotals } from './collection'
import type { SessionRecord } from './history'

const real: SessionRecord = { date: '2026-11-22', exerciseId: 'squat', sets: [{ verified: 3, quality: 0, fixed: 0 }] }
const zero: SessionRecord = { ...real, sets: [{ verified: 0, quality: 5, fixed: 5 }] }
const day = '2026-11-22'
const first = () => 0

describe('collection tickets', () => {
  it('gives exactly one ticket for each local date and verified session', () => {
    const a = applyChoice(emptyCollection(), { type: 'check-in' }, day, [real, zero], first)
    const repeated = applyChoice(a, { type: 'check-in' }, day, [real], first)
    expect(repeated).toEqual(a)
    expect(ticketTotals(repeated, [real, zero])).toEqual({ earned: 2, spent: 0, available: 2 })
    const tomorrow = applyChoice(a, { type: 'check-in' }, '2026-11-23', [], first)
    expect(ticketTotals(tomorrow, [])).toEqual({ earned: 2, spent: 0, available: 2 })
  })

  it('awards no collection items without tickets and no duplicate or extra charge at completion', () => {
    const initial = emptyCollection()
    expect(applyChoice(initial, { type: 'draw' }, day, [], first)).toEqual(initial)
    const sessions = Array.from({length: cosmetics.length + 2}, () => real)
    let s = initial
    for (let n = 0; n < cosmetics.length + 2; n++) s = applyChoice(s, { type: 'draw' }, day, sessions, first)
    expect(new Set(s.owned).size).toBe(cosmetics.length)
    expect(ticketTotals(s, sessions).available).toBe(2)
    expect(s.equipped).toBeNull()
  })

  it('equips only owned pieces, keeps them through unequip, and validates object-store data', () => {
    let state = emptyCollection()
    expect(applyChoice(state, { type: 'equip', id: 'cap' }, day, [], first)).toEqual(state)
    state = applyChoice(state, { type: 'draw' }, day, [real], first)
    state = applyChoice(state, { type: 'equip', id: 'cap' }, day, [real], first)
    expect(state.equipped).toBe('cap')
    expect(applyChoice(state, {type:'equip',id:null}, day, [real], first).owned).toEqual(['cap'])
    expect(normalizeCollection({claimedDays:[day, day, '2026-02-31'],owned:['bag','bag','other'],equipped:'cap'}))
      .toEqual({claimedDays:[day],owned:['bag'],equipped:null})
    expect(normalizeCollection(null)).toEqual(emptyCollection())
  })
})
