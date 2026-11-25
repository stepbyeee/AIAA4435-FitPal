import type { MotionSummary } from '../analytics/motion'
import { normalizePlan, type TrainingPlan } from './plan'

const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
const nullable = (n: unknown, min: number, max: number) => n === null || finite(n, min, max)
export function readMotion(value: unknown, verified: number): MotionSummary | undefined {
  if (!value || typeof value !== 'object') return
  const v = value as MotionSummary
  if (!finite(v.measuredReps, 0, verified) || !Number.isInteger(v.measuredReps) || !finite(v.pairedReps, 0, v.measuredReps) || !Number.isInteger(v.pairedReps)
    || !finite(v.coverage, 0, 1) || !nullable(v.medianDurationMs, 0, 3600000) || !nullable(v.medianReturnMs, 0, 3600000)
    || !nullable(v.returnVariation, 0, 100) || !nullable(v.medianRange, 0, 1) || !nullable(v.medianLagMs, -3600000, 3600000)) return
  if ((v.measuredReps === 0 && [v.medianDurationMs, v.medianReturnMs, v.medianRange].some(n => n !== null))
    || (v.measuredReps > 0 && [v.medianDurationMs, v.medianReturnMs, v.medianRange].some(n => n === null))
    || (v.measuredReps < 3 && v.returnVariation !== null)
    || ((v.pairedReps === 0) !== (v.medianLagMs === null))
    || (v.medianDurationMs !== null && v.medianReturnMs !== null && v.medianReturnMs > v.medianDurationMs)) return
  const view = v.view
  if (view !== null && (!view || !finite(view.x, 0, 1) || !finite(view.y, 0, 1) || !finite(view.scale, .000001, 10)
    || (view.orientation !== undefined && !finite(view.orientation, 0, 20)))) return
  return { measuredReps: v.measuredReps, medianDurationMs: v.medianDurationMs, medianReturnMs: v.medianReturnMs,
    returnVariation: v.returnVariation, medianRange: v.medianRange, pairedReps: v.pairedReps, medianLagMs: v.medianLagMs, coverage: v.coverage,
    view: view ? { x: view.x, y: view.y, scale: view.scale, ...(view.orientation === undefined ? {} : { orientation: view.orientation }) } : null }
}
export function readPlan(value: unknown): TrainingPlan | undefined {
  if (!value || typeof value !== 'object') return
  const clean = normalizePlan(value)
  if (Object.entries(clean).some(([key, val]) => (value as Record<string, unknown>)[key] !== val)) return
  return clean
}
