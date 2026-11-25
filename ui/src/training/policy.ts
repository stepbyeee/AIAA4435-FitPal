import { IN_RANGE, type SetResult, type SetSummary } from '../contract'
import { type SetMotion } from '../analytics/motion'
import { settle } from '../feedback/settle'
import type { TrainingPlan } from './plan'

export function tempoHits(motion: SetMotion, plan: TrainingPlan) {
  return motion.reps.filter(r => r.verified && r.range !== null && r.range >= IN_RANGE && r.returnMs !== null
    && Math.abs(r.returnMs - plan.returnSeconds * 1000) <= plan.returnSeconds * 250).length
}
export function settleTraining(summary: SetSummary, lastIssue: string | null): SetResult {
  const result = settle(summary, lastIssue)
  result.rewardReasons = { quality: '至少 8 下且八成动作达到个人幅度目标；观察重点不影响 EXP。', improvement: result.exp.fixedBonus > 0
    ? '上一组的幅度或取景问题已确认消除。' : '需要确认消除上一组的幅度或取景问题，才能获得改进奖励。' }
  return result
}

export type TrainingQuestion = 'next' | 'tempo' | 'coordination' | 'reward'
export const questionNames: Record<TrainingQuestion, string> = { next: '下一组先做什么？', tempo: '我的节奏怎么样？', coordination: '左右配合说明了什么？', reward: '为什么得到这些 EXP？' }
export function answerTrainingQuestion(question: TrainingQuestion, summary: SetSummary, motion: SetMotion, plan: TrainingPlan, result: SetResult) {
  const m = motion.summary
  if (question === 'reward') return `确认 ${result.exp.verifiedReps} 下，基础 ${result.exp.verifiedReps} EXP；质量奖励 ${result.exp.qualityBonus} EXP，改进奖励 ${result.exp.fixedBonus} EXP。质量条件：${result.rewardReasons?.quality ?? '至少 8 下且八成动作达到幅度目标。'}${result.exp.fixedBonus > 0 ? `改进依据：${result.rewardReasons?.improvement ?? '上一组的问题已经消除。'}` : '本组没有获得改进奖励。'}每组质量和改进各最多 5 EXP，同一动作不会因多个指标重复加质量分。`
  if (question === 'coordination') return m.medianLagMs === null
    ? '本组没有足够的双侧完整证据。固定正面或背面机位，让两侧关节全程可见再观察。这项实验观察不用于评分或判断身体失衡。'
    : `有 ${m.pairedReps} 下可观察双侧还原中点；右侧相对左侧的典型时间差为 ${m.medianLagMs} 毫秒。正数代表右侧较晚，负数代表左侧较晚；这不等于力量差异，不用于评分或诊断。`
  if (question === 'tempo') return m.medianReturnMs === null ? '本组没有连续完整的角度记录，暂时无法比较节奏。先保持关节在镜头内。'
    : `可测的 ${m.measuredReps} 下，从底部到确认返回通常用时 ${(m.medianReturnMs / 1000).toFixed(2)} 秒；${plan.focus === 'tempo' ? `${tempoHits(motion, plan)} 下同时满足个人幅度与自选 ${plan.returnSeconds} 秒目标。` : '本组未选择节奏目标，只描述实际用时。'}计时范围以画面中的动作阶段为准，不能代替肌肉发力测量。`
  if (result.cue) return result.cue.text
  if (!summary.reps.length) return '还没有完整动作。先完成校准，再做一组连续动作。'
  return plan.focus === 'tempo' ? `下一组继续使用同一机位和 ${plan.returnSeconds} 秒还原目标，再查看满足条件的次数；不要为了追时间缩短幅度。`
    : plan.focus === 'coordination' ? '下一组固定正面或背面机位，先保证两侧关节全程可见，再回看同一下动作。左右观察暂不改变奖励。'
      : '下一组继续保持校准时的动作范围；完成后点选每一下，查看幅度和还原过程。'
}
