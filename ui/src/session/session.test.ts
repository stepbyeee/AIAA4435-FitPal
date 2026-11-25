import { describe, expect, it } from 'vitest'
import type { SetResult, SetSummary } from '../contract'
import { expOfResult } from '../contract'
import { IN_RANGE } from '../contract'
import { balanceOf, GEAR, gearState, pointsEarned, SAMPLE_GEAR } from '../data/gear'
import { levelOf, repsByHalf, SAMPLE_HISTORY, sessionExp, threshold, totalExp } from '../data/history'
import { settle } from '../feedback/settle'
import { initialSession, reduce } from './session'

const result = (issueId: string | null): SetResult => ({
  cue: issueId ? { issueId, text: 'x' } : null,
  exp: { verifiedReps: 10, qualityBonus: 0, fixedBonus: 0 },
  hadIssueToFix: false,
})

describe('session flow', () => {
  it('runs calibrate, three sets with rests, then done', () => {
    let s = initialSession(3)
    s = reduce(s, { type: 'calibrated' })
    expect(s.stage).toBe('set')
    s = reduce(s, { type: 'setEnded', result: result('short_range') })
    expect(s.stage).toBe('rest')
    expect(s.lastIssueId).toBe('short_range')
    s = reduce(s, { type: 'nextSet' })
    expect([s.stage, s.setIndex]).toEqual(['set', 1])
    s = reduce(s, { type: 'setEnded', result: result(null) })
    s = reduce(s, { type: 'nextSet' })
    s = reduce(s, { type: 'setEnded', result: result(null) })
    expect(s.stage).toBe('done')
    expect(s.results).toHaveLength(3)
  })

  it('ignores events that do not belong to the current stage', () => {
    const s = initialSession(3)
    expect(reduce(s, { type: 'nextSet' })).toBe(s)
    expect(reduce(s, { type: 'setEnded', result: result(null) })).toBe(s)
  })

  it('remembers a form issue through an inconclusive set or framing cue', () => {
    const active = reduce(initialSession(3, 'short_range'), { type: 'calibrated' })
    expect(reduce(active, { type: 'setEnded', result: result(null) }).lastIssueId).toBe('short_range')
    expect(reduce(active, { type: 'setEnded', result: result('out_of_view') }).lastIssueId).toBe('short_range')
    const fixed = result(null)
    fixed.exp.fixedBonus = 5
    expect(reduce(active, { type: 'setEnded', result: fixed }).lastIssueId).toBeNull()
  })
})

describe('reward', () => {
  const summary = (depths: number[], issues: SetSummary['issues'] = []): SetSummary => ({
    exerciseId: 'lat-pulldown',
    calibration: { thetaTop: 149, thetaBottom: 116 },
    reps: depths.map((qMax) => ({ status: 'verified', qMax, durationMs: 2600 })),
    coverage: 1,
    issues,
  })

  it('pays 1 per verified rep, 5 for eight of ten in range, 5 for a fixed issue', () => {
    const tired = settle(summary([1, 1, 1, 1, 1, 1, 1, 0.8, 0.7, 0.7], [{ id: 'short_range', repIndexes: [7, 8, 9] }]), null)
    expect(expOfResult(tired)).toBe(10)
    const fixed = settle(summary([1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8]), 'short_range')
    expect(fixed.exp).toEqual({ verifiedReps: 10, qualityBonus: 5, fixedBonus: 5 })
  })

  it('never pays for reps the camera could not verify', () => {
    const s = summary([1, 1, 1])
    s.reps[1].status = 'cannot_verify'
    expect(settle(s, null).exp.verifiedReps).toBe(2)
  })
})

describe('level', () => {
  it('adds up from the sessions and lands inside the level it reports', () => {
    const exp = totalExp(SAMPLE_HISTORY)
    expect(exp).toBe(SAMPLE_HISTORY.map(sessionExp).reduce((a, b) => a + b, 0))
    const { level, into, span, toNext } = levelOf(exp)
    expect(threshold(level) + into).toBe(exp)
    expect(into + toNext).toBe(span)
    expect(exp).toBeLessThan(threshold(level + 1))
  })
})

describe('gear', () => {
  const level = levelOf(totalExp(SAMPLE_HISTORY)).level
  const trained = repsByHalf(SAMPLE_HISTORY)
  const balance = balanceOf(level, SAMPLE_GEAR)
  const state = (id: string) => gearState(GEAR.find((g) => g.id === id)!, SAMPLE_GEAR, balance, trained)

  it('pays two points per level and never lets the balance go below zero', () => {
    expect(pointsEarned(1)).toBe(0)
    expect(pointsEarned(level)).toBe((level - 1) * 2)
    expect(balance).toBeGreaterThanOrEqual(0)
  })

  it('opens a half of the body only once that half has been trained', () => {
    expect(trained.lower).toBe(0)
    for (const g of GEAR.filter((g) => g.half === 'lower')) expect(state(g.id)).toBe('locked')
    expect(state('tank')).toBe('owned')
  })

  it('sells only what the balance covers', () => {
    expect(balance).toBe(1)
    expect(state('wristbands')).toBe('ok')
    expect(state('gloves')).toBe('short')
  })
})

describe('last set', () => {
  it('agrees with the set it was taken from', () => {
    const session = SAMPLE_HISTORY[SAMPLE_HISTORY.length - 1]
    const last = session.lastSet!
    const seen = last.depths.filter((d): d is number => d !== null)
    expect(seen).toHaveLength(session.sets[session.sets.length - 1].verified)
    expect(seen.filter((d) => d < IN_RANGE)).toHaveLength(last.issue!.count)
  })
})
