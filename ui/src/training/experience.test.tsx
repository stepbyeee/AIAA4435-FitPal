import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { TrainingSettings } from './TrainingSettings'
import { LiveMetrics, MotionReview } from './MotionPanels'
import { DEFAULT_PLAN } from './plan'
import { summarizeMotion } from '../analytics/motion'

it('exposes the complete plan without prescribing a load', () => {
  const html = renderToStaticMarkup(<TrainingSettings plan={DEFAULT_PLAN} onChange={() => {}} />)
  for (const label of ['计划组数', '每组目标次数', '观察重点', '负重', '左右配合观察']) expect(html).toContain(label)
})

it('clears live measurements when tracking is inactive', () => {
  const html = renderToStaticMarkup(<LiveMetrics active={false} live={{ left: 111, right: 112, leftSpeed: 113, rightSpeed: 114, frontal: true }} latest={null} plan={DEFAULT_PLAN} />)
  expect(html).not.toContain('111')
  expect(html).not.toContain('113')
  expect(html).toContain('等待清晰画面')
})
it('shows missing evidence rather than invented set scores', () => {
  const html = renderToStaticMarkup(<MotionReview motion={{ reps: [], summary: summarizeMotion([], 0, null) }} plan={DEFAULT_PLAN} />)
  expect(html).toContain('暂无连续完整记录')
  expect(html).toContain('不评分')
})
