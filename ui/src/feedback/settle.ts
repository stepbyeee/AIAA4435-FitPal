import { IN_RANGE, type SetResult, type SetSummary } from '../contract'

const MIN_COVERAGE = 0.9

export function settle(summary: SetSummary, lastIssueId: string | null): SetResult {
  const verified = summary.reps.filter((rep) => rep.status === 'verified')
  const unverifiedCount = summary.reps.length - verified.length
  const inRangeCount = verified.filter((rep) => rep.qMax !== null && rep.qMax >= IN_RANGE).length
  const hasCoverage = summary.coverage >= MIN_COVERAGE
  const outOfView = summary.issues.find((issue) => issue.id === 'out_of_view')
  const shortRange = summary.issues.find((issue) => issue.id === 'short_range')

  const squat = summary.exerciseId === 'squat'
  let cue: SetResult['cue'] = null
  if (outOfView || (verified.length === 0 && !hasCoverage)) {
    const count = outOfView?.repIndexes.length ?? unverifiedCount
    const observation = count > 0 ? `有 ${count} 下镜头没看清。` : '这组镜头没看清。'
    cue = { issueId: 'out_of_view', text: `${observation}下一组调整镜头，让${squat ? '髋、膝和脚踝' : '手肘'}始终在画面里。` }
  } else if (shortRange) {
    cue = {
      issueId: 'short_range',
      text: `有 ${shortRange.repIndexes.length} 下没到校准的目标范围。下一组试着${squat ? '蹲到校准时的目标位置，再起身' : '拉到校准时的目标位置，再慢慢还原'}。`,
    }
  }

  const meetsQualityTarget = inRangeCount >= 8 && inRangeCount / summary.reps.length >= 0.8
  const issueCleared = (lastIssueId === 'short_range' && !shortRange) || lastIssueId === 'out_of_view'
  const fixed = issueCleared && hasCoverage && !outOfView && verified.length > 0 && unverifiedCount === 0 && verified.every(rep => rep.qMax !== null)

  return {
    cue,
    exp: {
      verifiedReps: verified.length,
      qualityBonus: meetsQualityTarget ? 5 : 0,
      fixedBonus: fixed ? 5 : 0,
    },
    hadIssueToFix: lastIssueId !== null,
  }
}
