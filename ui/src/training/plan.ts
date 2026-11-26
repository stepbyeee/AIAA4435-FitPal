import { keepSummaries } from '../data/privacy'

export type TrainingPlan = { sets: number; reps: number; focus: 'range' | 'tempo' | 'coordination'; returnSeconds: number; loadKg: number | null }
export const DEFAULT_PLAN: TrainingPlan = { sets: 3, reps: 10, focus: 'range', returnSeconds: 2, loadKg: null }
export const PLAN_KEY = 'fitpal.training-plan.v1'
export const focusNames = { range: '动作幅度', tempo: '还原节奏', coordination: '左右配合观察' }
const bounded = (v: unknown, low: number, high: number, fallback: number, integer = false) =>
  typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high && (!integer || Number.isInteger(v)) ? v : fallback
export function normalizePlan(value: unknown): TrainingPlan {
  const p = value && typeof value === 'object' ? value as Partial<TrainingPlan> : {}
  return {
    sets: bounded(p.sets, 1, 8, 3, true), reps: bounded(p.reps, 1, 30, 10, true),
    focus: p.focus === 'tempo' || p.focus === 'coordination' ? p.focus : 'range',
    returnSeconds: bounded(p.returnSeconds, .5, 10, 2),
    loadKg: typeof p.loadKg === 'number' && Number.isFinite(p.loadKg) && p.loadKg >= 0 && p.loadKg <= 500 ? p.loadKg : null,
  }
}
let temporaryPlan: TrainingPlan | null = null
export function loadPlan(): TrainingPlan {
  if (temporaryPlan) return { ...temporaryPlan }
  try { return keepSummaries() ? normalizePlan(JSON.parse(localStorage.getItem(PLAN_KEY) ?? 'null')) : { ...DEFAULT_PLAN } }
  catch { return { ...DEFAULT_PLAN } }
}
export function savePlan(plan: TrainingPlan) {
  temporaryPlan = normalizePlan(plan)
  try { if (keepSummaries()) localStorage.setItem(PLAN_KEY, JSON.stringify(temporaryPlan)) } catch { /* The choice remains available for this visit. */ }
}
export function clearPlan() { temporaryPlan = null }
