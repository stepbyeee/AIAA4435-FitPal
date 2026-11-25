import { describe, expect, it } from 'vitest'
import type { SetSummary, TrunkForm } from '../contract'
import { compareTrunkSets } from './trunkRecheck'
import { settle } from './settle'

function group(statuses: (TrunkForm['status'] | null)[], depth = 0.94, hipX = 0.5): SetSummary {
  return {
    exerciseId: 'lat-pulldown', calibration: { thetaTop: 160, thetaBottom: 70 },
    coverage: 1, assessesTrunkForm: true, issues: [],
    reps: statuses.map(status => ({ status: 'verified', qMax: depth, durationMs: 1000,
      ...(status && { trunkForm: { status, changeDeg: status === 'swing' ? 21 : 5, atMs: 150,
        view: { side: 'right', direction: 1, hipX, hipY: 0.6, scale: 0.2 } } }),
    })),
  }
}

describe('pulldown form feedback', () => {
  const first = group(['swing', 'steady', 'swing'])
  it('keeps counting separate from a cue with exact rep indices', () => {
    const result = settle({ ...first, issues: [{ id: 'trunk_swing', repIndexes: [0, 2] }] }, null)
    expect(result.exp.verifiedReps).toBe(3)
    expect(result.cue).toMatchObject({ issueId: 'trunk_swing', text: expect.stringContaining('第 1、3 下') })
  })
  it('prioritizes framing over form, and repeated form findings over a short-range cue', () => {
    const form = { id: 'trunk_swing', repIndexes: [0, 2] }
    const range = { id: 'short_range', repIndexes: [1] }
    expect(settle({ ...first, issues: [range, form] }, null).cue?.issueId).toBe('trunk_swing')
    expect(settle({ ...first, issues: [range, form, { id: 'out_of_view', repIndexes: [] }] }, null).cue?.issueId).toBe('out_of_view')
  })
  it('reports both denominators and does not claim improvement when the rate rises', () => {
    const second = group(['swing', 'swing', 'swing'])
    expect(compareTrunkSets(first, second)).toMatchObject({
      status: 'higher', previous: { swings: 2, assessed: 3 }, current: { swings: 3, assessed: 3 },
    })
  })
  it('reports improvement on comparable repeats with similar range', () => {
    expect(compareTrunkSets(first, group(['steady', 'steady', 'swing']))).toMatchObject({ status: 'lower' })
  })
  it.each([group(['steady', null, null]), group(['steady', 'steady'], 0.65), group(['steady', 'steady'], 0.92, 0.68)])(
    'leaves the comparison open when evidence, range or framing differs', second => {
      expect(compareTrunkSets(first, second).status).toBe('unavailable')
    },
  )
})
