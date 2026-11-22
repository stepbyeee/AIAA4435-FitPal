import { describe, expect, it } from 'vitest'
import { assignmentFor, parseGrowth, parseParticipant, parsePeriod, trialPath, type Period } from './assignment'
const periods: Period[] = [1, 2, 3, 4]

describe('pilot allocation', () => {
  it('uses all four conditions per person and once per period in a block of four', () => {
    const orders = [1, 2, 3, 4].map(id => periods.map(period => assignmentFor(id, period).condition))
    for (const order of orders) expect(new Set(order).size).toBe(4)
    for (let i = 0; i < 4; i++) expect(new Set(orders.map(row => row[i])).size).toBe(4)
    const transitions = orders.flatMap(row => row.slice(1).map((value, i) => [row[i], value].join('>')))
    expect(new Set(transitions).size).toBe(12)
  })

  it('balances visible/hidden growth for every order in a block of eight, holding it fixed across periods', () => {
    for (let id = 1; id <= 4; id++) {
      const first = periods.map(p => assignmentFor(id, p))
      const second = periods.map(p => assignmentFor(id + 4, p))
      expect(first.map(v => v.condition)).toEqual(second.map(v => v.condition))
      expect(new Set(first.map(v => v.growth)).size).toBe(1)
      expect(first[0].growth).not.toBe(second[0].growth)
    }
  })

  it('accepts bounded anonymous numbers only', () => {
    expect(parseParticipant('01')).toBe(1)
    expect(parseParticipant('99')).toBe(99)
    for (const value of [null, '', ' 1', '0', '100', '1e1', '-2', '1.1', '4x']) expect(parseParticipant(value)).toBeNull()
    expect(parsePeriod('4')).toBe(4)
    for (const value of ['0', '5', '02', '1e0', null]) expect(parsePeriod(value)).toBeNull()
    expect(parseGrowth('hidden')).toBe('hidden')
    expect(parseGrowth('other')).toBeNull()
    expect(() => assignmentFor(0, 1)).toThrow()
    expect(() => assignmentFor(1, 0 as Period)).toThrow()
  })

  it('writes an explicit round with the requested source, condition, actual growth and project base path', () => {
    for (const source of ['camera', 'recording'] as const) {
      const href = trialPath('/fitpal/', { participant: 9, period: 3, growth: 'hidden', source })
      const url = new URL(href, 'https://fitpal.example')
      expect(url.pathname).toBe('/fitpal/')
      expect(url.hash).toBe('#/session/lat-pulldown')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        participant: '9', period: '3', growth: 'hidden', study: assignmentFor(9, 3).condition,
        ...(source === 'recording' ? { video: 'go4it-rear' } : {}),
      })
    }
  })
})
