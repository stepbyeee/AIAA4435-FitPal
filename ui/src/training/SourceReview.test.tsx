import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { SourceReview } from './SourceReview'
it('offers isolated playback only when a source timestamp exists', () => {
  expect(renderToStaticMarkup(<SourceReview source="/example.mp4" trace={{ repIndex: 0, samples: [], bottom: null }} durationMs={2000} />)).toContain('没有对应录像时间')
  const html = renderToStaticMarkup(<SourceReview source="/example.mp4" trace={{ repIndex: 0, startedAtMs: 5000, samples: [], bottom: null }} durationMs={2000} />)
  expect(html).toContain('录像证据')
  expect(html).toContain('第几秒')
  expect(html).toContain('video')
})
