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
