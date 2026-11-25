import { expect, it } from 'vitest'
import { normalizePlan, DEFAULT_PLAN } from './plan'

it('keeps the established default training length', () => {
  expect(normalizePlan(null)).toEqual(DEFAULT_PLAN)
  expect(DEFAULT_PLAN).toMatchObject({ sets: 3, reps: 10, focus: 'range', loadKg: null })
})
it('accepts bounded personal choices and discards invalid values', () => {
  expect(normalizePlan({ sets: 4, reps: 12, focus: 'tempo', returnSeconds: 2.5, loadKg: 35 })).toMatchObject({ sets: 4, reps: 12, focus: 'tempo', returnSeconds: 2.5, loadKg: 35 })
  expect(normalizePlan({ sets: -1, reps: 10000, focus: 'made-up', returnSeconds: Infinity, loadKg: -4 })).toEqual(DEFAULT_PLAN)
})
