import { expect, it } from 'vitest'
import { trainingReport } from './report'
import { DEFAULT_PLAN } from './plan'
import { summarizeMotion } from '../analytics/motion'

it('exports measured evidence with explicit playback provenance and no video or body points', () => {
  const report = trainingReport('squat', true, [{ plan: DEFAULT_PLAN, motion: { reps: [], summary: summarizeMotion([], 0, null) },
    summary: { exerciseId: 'squat', calibration: { thetaTop: 170, thetaBottom: 80 }, reps: [], coverage: 0, issues: [] } }], [])
  expect(report.source).toBe('video-replay')
  expect(report.affectsProgress).toBe(false)
  expect(report.sets[0].plan).toEqual(DEFAULT_PLAN)
  expect(JSON.stringify(report)).not.toMatch(/blob:|landmarks|videoFile/)
})
