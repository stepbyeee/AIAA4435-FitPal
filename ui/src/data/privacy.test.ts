import { describe, expect, it } from 'vitest'
import { progressKey, keepSummaries } from './privacy'
describe('on-device workout data', () => {
  it('scopes deletion to the current actual summary, manual records, and wardrobe', () => {
    expect(['fitpal.history.v3','fitpal.manual.v1.a','fitpal.gear.v2','fitpal.history.v2','fitpal.gear.v1'].every(progressKey)).toBe(true)
    expect(['fitpal.keep-summaries','other-site','another-fitpal.history.v3','fitpal.gear.preview'].some(progressKey)).toBe(false)
  })
  it('respects explicit opt-out', () => {
    expect(keepSummaries({ getItem: () => 'off' })).toBe(false)
    expect(keepSummaries({ getItem: () => null })).toBe(true)
  })
})
