import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { TrainingHistory } from './TrainingHistory'
import { DEFAULT_PLAN } from '../training/plan'
import { summarizeMotion } from '../analytics/motion'

it('shows a saved tempo target and measured history without claiming improvement from unmatched sessions', () => {
  const html = renderToStaticMarkup(<TrainingHistory preview history={[{ date: '2026-11-25', exerciseId: 'squat',
    sets: [{ verified: 3, quality: 0, fixed: 0, plan: { ...DEFAULT_PLAN, focus: 'tempo' }, motion: { ...summarizeMotion([], 1, null), measuredReps: 3, medianReturnMs: 2100 } }],
  }]} />)
  expect(html).toContain('2.10 s')
  expect(html).toContain('还原节奏')
  expect(html).toContain('不直接代表进步')
})

it('shows the saved trunk-swing feedback in the training history', () => {
  const html = renderToStaticMarkup(<TrainingHistory preview history={[{
    date: '2026-11-25',
    exerciseId: 'lat-pulldown',
    sets: [{ verified: 3, quality: 0, fixed: 0 }],
    lastSet: { depths: [1, 1, 1], issue: { id: 'trunk_swing', count: 2 } },
  }]} />)
  expect(html).toContain('2 下起拉时上身后摆')
})

it('uses whole-cycle time for the main history chart while keeping return timing separate', () => {
  const html = renderToStaticMarkup(<TrainingHistory preview history={[{ date: '2026-11-26', exerciseId: 'lat-pulldown',
    sets: [{ verified: 3, quality: 0, fixed: 0, motion: { ...summarizeMotion([], 1, null), measuredReps: 3, medianDurationMs: 4200, medianReturnMs: 2100 } }],
  }]} />)
  expect(html).toContain('最近训练组的整次动作时间')
  expect(html).toContain('整次 4.20 s')
  expect(html).toContain('还原 2.10 s')
})
