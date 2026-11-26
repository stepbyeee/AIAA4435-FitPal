import { expect, it } from 'vitest'
import { settleTraining, answerTrainingQuestion, tempoHits, questionNames } from './policy'
import { DEFAULT_PLAN } from './plan'
import { summarizeMotion, type SetMotion, type RepMetrics } from '../analytics/motion'
import type { SetSummary } from '../contract'
import { initialSession, reduce } from '../session/session'

function fixture(returnMs = 2000, count = 10) {
  const metrics: RepMetrics[] = Array.from({ length: count }, (_, i) => ({ repIndex: i, sourceStartMs: i * 3000, durationMs: 3000, verified: true, range: 1, outboundMs: 1000, returnMs, bottomHoldMs: 0, minAngle: 60, maxAngle: 160, excursionDeg: 100, bilateralLagMs: 150, bilateralReason: 'experimental', pairedCoverage: 1 }))
  const motion: SetMotion = { reps: metrics, summary: summarizeMotion(metrics, 1, { x: .5, y: .4, scale: .3 }) }
  const summary: SetSummary = { exerciseId: 'lat-pulldown', calibration: { thetaTop: 160, thetaBottom: 60 }, coverage: 1, issues: [], reps: metrics.map(() => ({ status: 'verified', qMax: 1, durationMs: 3000 })) }
  return { motion, summary }
}
it('preserves the original rewards for every observation focus and timing target', () => {
  const { summary, motion } = fixture(700, 30)
  for (const focus of ['range', 'tempo', 'coordination'] as const) {
    for (const returnSeconds of [.5, 2, 10]) {
      const plan = { ...DEFAULT_PLAN, focus, returnSeconds }
      const result = settleTraining(summary, null)
      expect(result.exp).toEqual({ verifiedReps: 30, qualityBonus: 5, fixedBonus: 0 })
      expect(result.rewardReasons?.quality).toContain('观察重点不影响 EXP')
      expect(plan.focus).toBe(focus)
    }
  }
})
it('does not reward experimental bilateral measurements', () => {
  const { summary, motion } = fixture()
  const result = settleTraining(summary, null)
  expect(result.exp.qualityBonus).toBe(5)
  expect(motion.summary.pairedReps).toBe(10)
})
it('does not award extra EXP when a personal timing target improves', () => {
  const before = fixture(700), after = fixture(2000), plan = { ...DEFAULT_PLAN, focus: 'tempo' as const }
  expect(tempoHits(before.motion, plan)).toBe(0)
  expect(tempoHits(after.motion, plan)).toBe(10)
  expect(settleTraining(after.summary, null).exp)
    .toEqual({ verifiedReps: 10, qualityBonus: 5, fixedBonus: 0 })
})
it('keeps original range rewards when timing measurements are unavailable', () => {
  const { summary, motion } = fixture(), plan = { ...DEFAULT_PLAN, focus: 'tempo' as const }
  motion.reps.forEach(r => { r.returnMs = null })
  expect(tempoHits(motion, plan)).toBe(0)
  expect(settleTraining(summary, null).exp.qualityBonus).toBe(5)
})
it('keeps an unresolved range issue even if timing improves', () => {
  const after = fixture(2000)
  for (const i of [8, 9]) { after.motion.reps[i].range = .7; after.summary.reps[i].qMax = .7 }
  after.summary.issues = [{ id: 'short_range', repIndexes: [8, 9] }, { id: 'trunk_swing', repIndexes: [0, 1] }]
  const result = settleTraining(after.summary, 'short_range')
  expect(result.exp.fixedBonus).toBe(0)
  const state = reduce(initialSession(3, 'short_range'), { type: 'calibrated' })
  expect(reduce(state, { type: 'setEnded', result }).lastIssueId).toBe('short_range')
})
it('still rewards resolution of an original range issue', () => {
  const { summary } = fixture(700)
  expect(settleTraining(summary, 'short_range').exp.fixedBonus).toBe(5)
})

it('does not present an unselected timing target as a personal choice', () => {
  const { summary, motion } = fixture()
  expect(answerTrainingQuestion('tempo', summary, motion, DEFAULT_PLAN, settleTraining(summary, null))).not.toContain('自选')
  expect(answerTrainingQuestion('tempo', summary, motion, { ...DEFAULT_PLAN, focus: 'tempo' }, settleTraining(summary, null))).toContain('自选 2 秒')
})

it('offers actionable questions rather than reward or bilateral explanations', () => {
  expect(Object.values(questionNames)).toEqual(['这组哪里可以改进？', '每一下的节奏稳定吗？', '下一组先做什么？', '怎么确认有进步？'])
})
it('describes full-cycle rhythm, not just the return phase', () => {
  const {summary, motion} = fixture()
  motion.reps.forEach((r,i)=>{ r.durationMs = i === 9 ? 6000 : 3000 })
  const answer = answerTrainingQuestion('tempo', summary, motion, DEFAULT_PLAN, settleTraining(summary,null))
  expect(answer).toContain('整次')
  expect(answer).toContain('3.00–6.00 秒')
  expect(answer).toContain('第 10 下')
  expect(answer).not.toContain('疲劳')
})
it('grounds improvement and recheck in specific short-range reps', () => {
  const {summary,motion}=fixture()
  summary.reps[2].qMax=.6;summary.issues=[{id:'short_range',repIndexes:[2]}]
  const result=settleTraining(summary,null)
  expect(answerTrainingQuestion('improve',summary,motion,DEFAULT_PLAN,result)).toContain('第 3 下')
  expect(answerTrainingQuestion('improve',summary,motion,DEFAULT_PLAN,result)).toContain('幅度')
  expect(answerTrainingQuestion('check',summary,motion,DEFAULT_PLAN,result)).toContain('同一机位')
})
it('prioritizes missing evidence and never calls an unobserved set perfect', () => {
  const {summary,motion}=fixture()
  summary.reps[0].status='cannot_verify';summary.issues=[{id:'out_of_view',repIndexes:[0]}]
  motion.reps.forEach(r=>r.verified=false)
  const answer=answerTrainingQuestion('improve',summary,motion,DEFAULT_PLAN,settleTraining(summary,null))
  expect(answer).toContain('第 1 下');expect(answer).toContain('看清')
  expect(answerTrainingQuestion('tempo',summary,motion,DEFAULT_PLAN,settleTraining(summary,null))).toContain('不足')
})
