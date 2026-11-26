import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { RepReview } from './RepReview'
import type { SetSummary } from '../contract'
import type { RepReviewData } from '../perception/repReview'
const summary: SetSummary = { exerciseId: 'lat-pulldown', calibration: { thetaTop: 160, thetaBottom: 60 }, coverage: 1, issues: [], reps: [{ status: 'verified', qMax: 1, durationMs: 1000 }] }
const review: RepReviewData = { side: 'left', traces: [{ repIndex: 0, samples: [{ ms: 0, angle: 160, x: 0, y: 0, breakBefore: false }, { ms: 500, angle: 60, x: 0, y: 1, breakBefore: false }], bottom: { ms: 500, angle: 60, x: 0, y: 1, breakBefore: false } }] }
it('does not restore rejected timing from the raw trace', () => {
  const html = renderToStaticMarkup(<RepReview summary={summary} review={review} metrics={[]} />)
  expect(html).toContain('连续画面不足，暂不显示分段时间')
  expect(html).not.toContain('底部至确认返回 0.5 秒')
})
it('keeps the original classroom timing when extended metrics are absent', () => {
  expect(renderToStaticMarkup(<RepReview summary={summary} review={review} />)).toContain('底部至确认返回 0.5 秒')
})

it('scales formal review bars by measured full-cycle time, independently of range', () => {
  const reps = [1000, 2000, 0].map((durationMs, i) => ({ ...summary.reps[0], durationMs, qMax: i === 0 ? 1 : .6 }))
  const metrics = reps.map((r, repIndex) => ({ repIndex, sourceStartMs: 0, durationMs: r.durationMs, verified: repIndex < 2, range: r.qMax, outboundMs: 500, returnMs: 500, bottomHoldMs: 0, minAngle: 60, maxAngle: 160, excursionDeg: 100, bilateralLagMs: null, bilateralReason: '', pairedCoverage: 0 }))
  const html = renderToStaticMarkup(<RepReview summary={{ ...summary, reps }} review={review} metrics={metrics} />)
  expect(html).toContain('柱高表示整次用时')
  expect(html).toContain('height:50%')
  expect(html).toContain('height:100%')
  expect(html).toContain('1.00 秒')
  expect(html).toContain('2.00 秒')
  expect(html).toContain('整次计时不足')
  expect(html).not.toContain('height:60%')
})
