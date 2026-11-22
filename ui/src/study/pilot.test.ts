import { describe, it, expect } from 'vitest'
import { parseCondition, repCue, makeStudyRecord } from './pilot'
import type { SetSummary } from '../contract'
const summary: SetSummary = { exerciseId: 'lat-pulldown', calibration: { thetaTop: 140, thetaBottom: 75 }, reps: [{ status: 'verified', qMax: .6, durationMs: 1400 }], coverage: .97, issues: [{ id: 'short_range', repIndexes: [0] }] }
describe('pilot conditions', () => {
  it('only opts in to the four named conditions', () => {
    expect(parseCondition('rep-card')).toEqual({ timing: 'rep', format: 'card' })
    expect(parseCondition('set-text')).toEqual({ timing: 'set', format: 'text' })
    expect(parseCondition(null)).toBeNull()
    expect(parseCondition('rep')).toBeNull()
  })
  it('abstains on missing observations', () => {
    expect(repCue({ ...summary.reps[0], status: 'cannot_verify' })).toMatch(/未看清/)
    expect(repCue(summary.reps[0])).toMatch(/目标/)
  })
  it('exports a versioned anonymous result with exposure count and ratings', () => {
    const record = makeStudyRecord(parseCondition('set-card')!, summary, 'recording', 1, { interruption: 1, effort: 3, motivation: 6, clarity: 5 }, { participant: 7, period: 2, growth: 'hidden' }, [{ ms: 1230, action: 'set-cue', trigger: 'short_range' }])
    expect(record).toMatchObject({ schema: 1, source: 'recording', verified: 1, inRange: 0, cuesShown: 1, growth: 'hidden', participant: 7, period: 2, ratings: { motivation: 6 } })
    expect(record).not.toHaveProperty('landmarks')
    expect(record).not.toHaveProperty('reps')
  })
})
