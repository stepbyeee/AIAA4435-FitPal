import { IN_RANGE, type SetResult, type SetSummary } from '../contract'
import { wholeCycleStats, type SetMotion } from '../analytics/motion'
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

export type TrainingQuestion = 'improve' | 'tempo' | 'next' | 'check'
export const questionNames: Record<TrainingQuestion, string> = {
  improve: '这组哪里可以改进？', tempo: '每一下的节奏稳定吗？', next: '下一组先做什么？', check: '怎么确认有进步？',
}
const repNames = (indexes: number[]) => `第 ${indexes.slice(0, 6).map(i => i + 1).join('、')} 下${indexes.length > 6 ? '等动作' : ''}`
export function answerTrainingQuestion(question: TrainingQuestion, summary: SetSummary, motion: SetMotion, plan: TrainingPlan, _result: SetResult) {
  const stats = wholeCycleStats(motion.reps)
  const unseen = summary.reps.flatMap((r, i) => r.status === 'cannot_verify' ? [i] : [])
  const short = summary.reps.flatMap((r, i) => r.status === 'verified' && r.qMax !== null && r.qMax < IN_RANGE ? [i] : [])
  const swing = summary.reps.flatMap((r, i) => r.trunkForm?.status === 'swing' ? [i] : [])
  const viewTip = summary.exerciseId === 'squat' ? '让髋、膝、脚踝全程入镜' : '让肩、肘、腕全程入镜'
  if (!summary.reps.length) return '还没有记录到完整动作。先完成校准，再做一组连续动作，结束后才能指出具体改进位置。'
  if (question === 'tempo') {
    if (!stats.count) return '完整计时不足，暂时无法判断每一下的节奏。先保持关节在镜头内，不能把缺失的时间当成零秒。'
    const base = `可测的 ${stats.count} 下，整次动作通常用时 ${(stats.typical! / 1000).toFixed(2)} 秒，范围 ${(stats.shortest!.durationMs / 1000).toFixed(2)}–${(stats.longest!.durationMs / 1000).toFixed(2)} 秒。整次包括${summary.exerciseId === 'squat' ? '下蹲和站回' : '下拉和返回'}。`
    const evidence = stats.count < 3 ? '目前不足 3 下，先不判断节奏稳定性。' : stats.longest!.durationMs === stats.shortest!.durationMs ? '可测动作的用时相同；仍需结合幅度一起看。' : `${repNames([stats.shortest!.repIndex])}用时最短，${repNames([stats.longest!.repIndex])}用时最长，可以先回看这两下。快慢本身不代表好坏。`
    return base + evidence + (plan.focus === 'tempo' ? `自选 ${plan.returnSeconds} 秒目标只针对还原段，不是整次目标；${tempoHits(motion, plan)} 下同时满足还原目标和个人幅度。` : '')
  }
  if (question === 'check') {
    const condition = '下一组保持同一机位、相同负重和同一个人幅度目标，完成后再比较。'
    if (unseen.length) return condition + '先检查未看清的动作是否减少；看清之前不判断动作质量变好了。'
    if (short.length) return condition + `本组 ${repNames(short)}幅度不足，下一组检查达到个人幅度目标的比例是否提高，不能只看总次数。`
    if (swing.length) return condition + '继续使用固定侧面机位，检查起拉后摆是否减少；看不清肩和髋时无法复查。'
    return condition + '先看幅度是否保持，再比较整次用时曲线是否更接近你想保持的节奏。每组至少有 3 下完整计时才讨论一致性，不能把更快或更慢直接当作进步。左右比较还需要两侧全程清晰。'
  }
  if (unseen.length) return `${repNames(unseen)}没有看清，先改善取景：${viewTip}。回看这些动作的断线位置，调整遮挡后再做下一组；现在不能据此判断动作做得不好。`
  if (short.length) return `${repNames(short)}没有达到个人幅度目标。先点开这些动作，比较它们与校准时的活动范围；下一组尽量保持已校准的幅度，不要为了追次数或速度缩短动作。`
  if (swing.length) return `${repNames(swing)}在起拉时观察到上身后摆。先点开对应动作的后摆说明，下一组保持起始坐姿和同一侧面机位，再检查后摆是否减少。这里只描述画面中的变化。`
  if (question === 'next' && plan.focus === 'coordination') return motion.summary.pairedReps
    ? '下一组保持正面或背面固定机位和相同幅度，回看同一下左右到达还原中点的先后；时间差不能说明哪侧力量更弱，也不改变奖励。'
    : '下一组先固定正面或背面机位，让两侧关节全程可见。本组双侧完整证据不足，先改善取景，再讨论左右配合。'
  if (stats.count < 3) return `本组只有 ${stats.count} 下可完整计时，还不足以判断节奏是否稳定。下一组先保持清晰、连续的画面和已校准的幅度，完成至少 3 下后再比较。`
  if (stats.longest!.durationMs > stats.shortest!.durationMs) return `本组未记录到明确的幅度不足或起拉后摆。可先回看用时最短的${repNames([stats.shortest!.repIndex])}和最长的${repNames([stats.longest!.repIndex])}，确认是否是你有意改变节奏，再决定下一组保持怎样的速度。未记录到问题不代表所有动作细节都已评估。`
  return '本组可测动作的用时一致，未记录到明确的幅度不足或起拉后摆。下一组继续保持已校准的幅度和节奏；这些观察不能覆盖所有动作细节。'
}
