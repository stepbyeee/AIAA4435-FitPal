import { IN_RANGE, type RepResult, type SetSummary } from '../contract'

export type Condition = { timing: 'rep' | 'set'; format: 'card' | 'text' }
export type Ratings = { interruption: number; effort: number; motivation: number; clarity: number }

export function parseCondition(value: string | null): Condition | null {
  const [timing, format, extra] = (value ?? '').split('-')
  if (extra !== undefined || (timing !== 'rep' && timing !== 'set') || (format !== 'card' && format !== 'text')) return null
  return { timing, format }
}

export function repCue(rep: RepResult) {
  if (rep.status === 'cannot_verify') return '这一下未看清，请让计数侧留在画面内。'
  return rep.qMax >= IN_RANGE ? '这一下达到了你的校准目标。' : '这一下幅度偏短，下次试着达到你的校准目标。'
}

export type TrialEvent = { ms: number; action: 'rep-cue' | 'set-cue'; trigger: string }
export type TrialContext = { participant: number | null; period: number | null; growth: 'visible' | 'hidden' }
export function makeStudyRecord(condition: Condition, summary: SetSummary, source: 'camera' | 'recording', cuesShown: number, ratings: Ratings, context: TrialContext, events: readonly TrialEvent[]) {
  const verified = summary.reps.filter(rep => rep.status === 'verified')
  return {
    schema: 1, ...context, events, exercise: summary.exerciseId, condition, source, cuesShown,
    attempts: summary.reps.length, verified: verified.length,
    inRange: verified.filter(rep => rep.qMax >= IN_RANGE).length, coverage: summary.coverage, ratings,
  }
}
