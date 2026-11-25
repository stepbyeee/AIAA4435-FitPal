import { describe, expect, it } from 'vitest'
import type { SetSummary } from '../contract'
import { settle } from './settle'

function summary(
  depths: (number | null)[],
  issues: SetSummary['issues'] = [],
  coverage = 1,
): SetSummary {
  return {
    exerciseId: 'lat-pulldown',
    calibration: { thetaTop: 149, thetaBottom: 116 },
    reps: depths.map((depth) => ({
      status: depth === null ? 'cannot_verify' : 'verified',
      qMax: depth ?? 0,
      durationMs: 2600,
    })),
    coverage,
    issues,
  }
}

const shortRange = { id: 'short_range', repIndexes: [0, 2] }
const outOfView = { id: 'out_of_view', repIndexes: [1] }

describe('post-set feedback', () => {
  it('prioritizes a single framing cue regardless of the order of issues', () => {
    const first = settle(summary([0.6, null, 0.7], [shortRange, outOfView], 0.8), null)
    expect(first.cue?.issueId).toBe('out_of_view')
    expect(first.cue?.text).toContain('1 下')
    expect(settle(summary([0.6, null, 0.7], [outOfView, shortRange], 0.8), null)).toEqual(first)
  })

  it('describes nonconsecutive short reps using the calibrated range', () => {
    const result = settle(summary([0.6, 1, 0.7, 1], [shortRange]), null)
    expect(result.cue?.issueId).toBe('short_range')
    expect(result.cue?.text).toContain('2 下')
    expect(result.cue?.text).toContain('校准')
    expect(result.cue?.text).not.toContain('最后')
  })

  it('uses a framing cue for poor visibility without inventing uncounted reps', () => {
    const result = settle(summary([], [], 0.3), null)
    expect(result.cue?.issueId).toBe('out_of_view')
    expect(result.cue?.text).not.toMatch(/\d+ 下/)
  })

  it('describes a tracking gap without estimating how many reps it hid', () => {
    const result = settle(summary([1], [{ id: 'out_of_view', repIndexes: [] }]), 'out_of_view')
    expect(result.cue?.text).toBe('这组有一段画面没看清。下一组调整镜头，让手肘始终在画面里。')
    expect(result.exp).toEqual({ verifiedReps: 1, qualityBonus: 0, fixedBonus: 0 })
  })

  it('returns no cue for an unsupported issue', () => {
    expect(settle(summary([1], [{ id: 'unknown', repIndexes: [0] }]), null).cue).toBeNull()
  })
})

describe('post-set EXP', () => {
  it('counts only verified reps and awards quality for eight of ten attempts', () => {
    const result = settle(summary([0.85, 1, 1, 1, 1, 1, 1, 1, 0.7, null]), null)
    expect(result.exp).toEqual({ verifiedReps: 9, qualityBonus: 5, fixedBonus: 0 })
  })

  it.each([
    { depths: [1, 1, 1, 1, 1, 1, 1], reason: 'fewer than eight in-range reps' },
    { depths: [1, 1, 1, 1, 1, 1, 1, 1, 0.7, null, null], reason: 'below 80% of attempts' },
  ])('withholds the quality bonus for $reason', ({ depths }) => {
    expect(settle(summary(depths), null).exp.qualityBonus).toBe(0)
  })

  it('awards improvement when a previous issue clears on fully verified reps', () => {
    const result = settle(summary([1]), 'short_range')
    expect(result.hadIssueToFix).toBe(true)
    expect(result.exp.fixedBonus).toBe(5)
  })

  it.each([
    { set: summary([]), reason: 'an empty set' },
    { set: summary([1, null]), reason: 'an unverifiable rep' },
    { set: summary([1], [], 0.6), reason: 'poor coverage' },
    { set: summary([0.6, 1, 0.7], [shortRange]), reason: 'the issue persisting' },
  ])('withholds the improvement bonus for $reason', ({ set }) => {
    expect(settle(set, 'short_range').exp.fixedBonus).toBe(0)
  })
})

it('grounds the squat cue in the hip, knee and ankle observations', () => {
  const lost = settle({ ...summary([null], [outOfView], 0.5), exerciseId: 'squat' }, null)
  const short = settle({ ...summary([0.6], [{ id: 'short_range', repIndexes: [0] }]), exerciseId: 'squat' }, null)
  expect(lost.cue?.text).toContain('髋、膝和脚踝')
  expect(lost.exp.verifiedReps).toBe(0)
  expect(short.cue?.text).toContain('蹲到校准时的目标位置')
  expect(short.exp.verifiedReps).toBe(1)
})

it('awards a counted wrist-cropped cycle one rep without a quality or improvement claim', () => {
  const set = summary([])
  set.calibration = { thetaTop: 135, thetaBottom: 66, basis: 'upper-arm' }
  set.reps = Array.from({ length: 8 }, () => ({ status: 'verified', durationMs: 1700, qMax: null }))
  expect(settle(set, 'short_range')).toMatchObject({
    cue: null, exp: { verifiedReps: 8, qualityBonus: 0, fixedBonus: 0 },
  })
})
