import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { TrainingHistory } from './TrainingHistory'

it('shows the saved trunk-swing feedback in the training history', () => {
  const html = renderToStaticMarkup(<TrainingHistory preview history={[{
    date: '2026-11-25',
    exerciseId: 'lat-pulldown',
    sets: [{ verified: 3, quality: 0, fixed: 0 }],
    lastSet: { depths: [1, 1, 1], issue: { id: 'trunk_swing', count: 2 } },
  }]} />)
  expect(html).toContain('2 下起拉时上身后摆')
})
