import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { TrainingSettings } from './TrainingSettings'
import { MotionReview } from './MotionPanels'
import { DEFAULT_PLAN } from './plan'
import { summarizeMotion } from '../analytics/motion'

it('exposes the complete plan without prescribing a load', () => {
  const html = renderToStaticMarkup(<TrainingSettings plan={DEFAULT_PLAN} onChange={() => {}} />)
  for (const label of ['计划组数', '每组目标次数', '观察重点', '负重', '左右配合观察']) expect(html).toContain(label)
})

it('shows missing evidence rather than invented set scores', () => {
  const html = renderToStaticMarkup(<MotionReview motion={{ reps: [], summary: summarizeMotion([], 0, null) }} plan={DEFAULT_PLAN} />)
  expect(html).toContain('暂无连续完整记录')
  expect(html).toContain('不评分')
})

it('shows the actual next set and its editable target rather than repeating the session total', () => {
  const html = renderToStaticMarkup(<TrainingSettings plan={DEFAULT_PLAN} onChange={() => {}} nextSet={2} exerciseName="高位下拉" />)
  expect(html).toContain('第 2 组')
  expect(html).toContain('高位下拉')
  expect(html).toContain('下一组目标次数')
  expect(html).not.toContain('3 组 × 10 次')
  expect(html).not.toContain('<details')
  expect(html).not.toContain('计划组数')
})

it('advances the next-set label without changing its exercise or selected target', () => {
  const html = renderToStaticMarkup(<TrainingSettings plan={{...DEFAULT_PLAN,reps:8}} onChange={() => {}} nextSet={3} exerciseName="深蹲" />)
  expect(html).toContain('第 3 组')
  expect(html).toContain('深蹲')
  expect(html).toContain('value="8"')
  expect(html).not.toContain('第 2 组')
})
