import type { SetResult, SetSummary } from '../contract'
import type { SetMotion } from '../analytics/motion'
import type { TrainingPlan } from './plan'

export function trainingReport(exerciseId: string, playback: boolean, sets: { summary: SetSummary; motion: SetMotion; plan: TrainingPlan }[], results: SetResult[]) {
  return { schemaVersion: 1, exerciseId, source: playback ? 'video-replay' : 'camera-session', affectsProgress: false,
    note: 'Read-only export. Importing or replaying this report does not award EXP. Bilateral timing is experimental.',
    sets: sets.map((s, i) => ({ plan: s.plan, calibration: s.summary.calibration, coverage: s.summary.coverage,
      reps: s.summary.reps, motion: s.motion, result: results[i] ?? null })) }
}
export function downloadReport(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
