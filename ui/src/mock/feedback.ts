import { IN_RANGE, type SetResult, type SetSummary } from '../contract'

// Stand-in for decision + language + reward: picks one cue and settles EXP by the README's table.
// The real module replaces `settle`; the UI only reads SetResult.

const CUES: Record<string, (n: number) => string> = {
  short_range: (n) => `最后 ${n} 下没拉到底。下一组把横杆拉到锁骨，再放回去。`,
  out_of_view: (n) => `有 ${n} 下镜头没看清。往后站半步，让手肘一直在画面里。`,
}

export function settle(summary: SetSummary, lastIssueId: string | null): SetResult {
  const verified = summary.reps.filter((r) => r.status === 'verified')
  const inRange = verified.filter((r) => r.qMax >= IN_RANGE).length
  const issue = summary.issues[0] ?? null
  const fixed = lastIssueId !== null && !summary.issues.some((i) => i.id === lastIssueId)
  return {
    cue: issue ? { issueId: issue.id, text: CUES[issue.id]?.(issue.repIndexes.length) ?? '' } : null,
    exp: {
      verifiedReps: verified.length,
      qualityBonus: summary.reps.length > 0 && inRange / summary.reps.length >= 0.8 ? 5 : 0,
      fixedBonus: fixed ? 5 : 0,
    },
    hadIssueToFix: lastIssueId !== null,
  }
}
