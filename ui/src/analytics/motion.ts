import { LM, type PoseFrame, type RepResult, type SetSummary } from '../contract'
import type { RepReviewData, RepTrace } from '../perception/repReview'
import { inFrame, visibleLimb, type Limb } from '../tracking/limbLandmarks'

export type ViewSignature = { x: number; y: number; scale: number; orientation?: number }
export type MotionSample = { atMs: number; left: number | null; right: number | null; frontal: boolean; view: ViewSignature | null }
export type RepMetrics = {
  repIndex: number; sourceStartMs: number | null; durationMs: number; verified: boolean; range: number | null
  outboundMs: number | null; returnMs: number | null; bottomHoldMs: number | null
  minAngle: number | null; maxAngle: number | null; excursionDeg: number | null
  bilateralLagMs: number | null; bilateralReason: string; pairedCoverage: number
}
export type MotionSummary = {
  measuredReps: number; medianDurationMs: number | null; medianReturnMs: number | null
  returnVariation: number | null; medianRange: number | null; pairedReps: number; medianLagMs: number | null
  coverage: number; view: ViewSignature | null
}
export type SetMotion = { reps: RepMetrics[]; summary: MotionSummary }
export const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
export type TimingKey = 'durationMs' | 'outboundMs' | 'returnMs' | 'bottomHoldMs'
export const measuredTime = (rep: RepMetrics | undefined, key: TimingKey = 'durationMs') => {
  const value = rep?.[key]
  return rep?.verified && typeof value === 'number' && Number.isFinite(value) && (key === 'durationMs' ? value > 0 : value >= 0) ? value : null
}
export function wholeCycleStats(reps: readonly RepMetrics[]) {
  const measured = reps.filter(r => measuredTime(r) !== null)
  const durations = measured.map(r => r.durationMs)
  const typical = median(durations)
  const shortest = measured.reduce<RepMetrics | null>((best, r) => !best || r.durationMs < best.durationMs ? r : best, null)
  const longest = measured.reduce<RepMetrics | null>((best, r) => !best || r.durationMs > best.durationMs ? r : best, null)
  return { count: measured.length, typical, shortest, longest,
    variation: measured.length >= 3 && typical !== null ? median(durations.map(n => Math.abs(n - typical)))! / typical : null }
}
const numbers = (values: (number | null)[]) => values.filter((n): n is number => n !== null && Number.isFinite(n))
const round = (n: number) => Math.round(n)
export function sameView(a: ViewSignature | null, b: ViewSignature | null) {
  return Boolean(a && b && a.scale > 0 && Math.abs(a.x - b.x) <= .08 && Math.abs(a.y - b.y) <= .08 && Math.abs(b.scale / a.scale - 1) <= .2
    && ((a.orientation === undefined && b.orientation === undefined)
      || (a.orientation !== undefined && b.orientation !== undefined && Math.abs(a.orientation - b.orientation) <= .15)))
}

function crossing(samples: MotionSample[], side: 'left' | 'right'): number | null {
  const values = numbers(samples.map(s => s[side]))
  const high = Math.max(...values), low = Math.min(...values)
  if (high - low < 24) return null
  const threshold = (high + low) / 2
  const bottom = samples.findIndex(s => s[side] === low)
  let down = false
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1][side], after = samples[i][side]
    if (before === null || after === null || samples[i].atMs - samples[i - 1].atMs > 250) continue
    if (before >= threshold && after < threshold) down = true
    // A noisy recrossing on the outbound phase is not a return event.
    if (down && i > bottom && before <= threshold && after > threshold) {
      return samples[i - 1].atMs + (threshold - before) / (after - before) * (samples[i].atMs - samples[i - 1].atMs)
    }
  }
  return null
}

/** Timing describes observed angle extrema, not anatomical contraction phases. */
export function analyzeRep(rep: RepResult, trace: RepTrace | undefined, observations: readonly MotionSample[]): RepMetrics {
  const valid = rep.status === 'verified' && rep.qMax !== null && Boolean(trace?.bottom)
    && !trace!.samples.some(s => s.breakBefore)
    && trace!.samples.length >= 3 && trace!.samples.every((s, i) => !i || s.ms - trace!.samples[i - 1].ms <= 250)
  const samples = trace?.samples ?? []
  const angles = samples.map(s => s.angle).filter(Number.isFinite)
  const bottomMs = valid ? trace!.bottom!.ms : null
  const sourceStartMs = trace?.startedAtMs ?? null
  const paired = sourceStartMs === null ? [] : observations.filter(s => s.atMs >= sourceStartMs && s.atMs <= sourceStartMs + rep.durationMs)
  const visible = paired.filter(s => s.left !== null && s.right !== null && s.frontal)
  const pairedCoverage = paired.length ? visible.length / paired.length : 0
  const continuous = paired.length >= 6 && paired.every((s, i) => !i || s.atMs - paired[i - 1].atMs <= 250)
    && sourceStartMs !== null && paired[0].atMs - sourceStartMs <= 150
    && sourceStartMs + rep.durationMs - paired.at(-1)!.atMs <= 150
    && visible.length === paired.length
    && sameView(paired[0].view, paired.at(-1)!.view)
    && paired.every((s, i) => {
      const first = paired[0].view?.orientation, current = s.view?.orientation
      const orientationMatches = first === undefined && current === undefined
        || first !== undefined && current !== undefined && Math.abs(first - current) <= .15
      return orientationMatches && (!i || sameView(paired[i - 1].view, s.view))
    })
  let bilateralLagMs: number | null = null
  let bilateralReason = '需要两侧全程清晰、正面或背面固定机位'
  if (valid && continuous) {
    const left = crossing(paired, 'left'), right = crossing(paired, 'right')
    if (left !== null && right !== null) { bilateralLagMs = round(right - left); bilateralReason = '右侧减左侧的还原中点时间；实验观察值，不用于评分' }
    else bilateralReason = '未观察到两侧足够完整的角度变化'
  }
  let bottomHoldMs: number | null = null
  if (valid && trace?.bottom) {
    const pivot = samples.reduce((best, s, i) => Math.abs(s.ms - trace.bottom!.ms) < Math.abs(samples[best].ms - trace.bottom!.ms) ? i : best, 0)
    let first = pivot, last = pivot
    while (first > 0 && samples[first - 1].angle <= trace.bottom.angle + 3 && samples[first].ms - samples[first - 1].ms <= 250) first--
    while (last + 1 < samples.length && samples[last + 1].angle <= trace.bottom.angle + 3 && samples[last + 1].ms - samples[last].ms <= 250) last++
    bottomHoldMs = samples[last].ms - samples[first].ms
  }
  return {
    repIndex: trace?.repIndex ?? -1, sourceStartMs, durationMs: rep.durationMs, verified: valid, range: valid ? rep.qMax : null,
    outboundMs: bottomMs, returnMs: bottomMs !== null ? Math.max(0, rep.durationMs - bottomMs) : null, bottomHoldMs,
    minAngle: valid && angles.length ? Math.min(...angles) : null,
    maxAngle: valid && angles.length ? Math.max(...angles) : null,
    excursionDeg: valid && angles.length ? Math.max(...angles) - Math.min(...angles) : null,
    bilateralLagMs, bilateralReason, pairedCoverage,
  }
}

export function summarizeMotion(reps: RepMetrics[], coverage: number, view: ViewSignature | null): MotionSummary {
  const measured = reps.filter(r => r.verified && r.returnMs !== null)
  const returns = numbers(measured.map(r => r.returnMs)), typical = median(returns)
  return {
    measuredReps: measured.length, medianDurationMs: median(measured.map(r => r.durationMs)), medianReturnMs: typical,
    returnVariation: returns.length >= 3 && typical && typical > 0 ? median(returns.map(n => Math.abs(n - typical)))! / typical : null,
    medianRange: median(numbers(measured.map(r => r.range))),
    pairedReps: reps.filter(r => r.bilateralLagMs !== null).length,
    medianLagMs: median(numbers(reps.map(r => r.bilateralLagMs))), coverage, view,
  }
}

export function compareMotion(previous: MotionSummary, current: MotionSummary) {
  const comparable = previous.measuredReps >= 3 && current.measuredReps >= 3
    && previous.coverage >= .9 && current.coverage >= .9 && sameView(previous.view, current.view)
    && previous.medianRange !== null && current.medianRange !== null && previous.medianRange - current.medianRange <= .1
  return { comparable, returnDifferenceMs: comparable && previous.medianReturnMs !== null && current.medianReturnMs !== null
    ? current.medianReturnMs - previous.medianReturnMs : null }
}

export function createMotionRecorder(limb: Limb) {
  let samples: MotionSample[] = []
  const captured: RepMetrics[] = []
  let neutralView: ViewSignature | null = null
  let viewChanged = false
  let lastTime = -Infinity
  let live = { left: null as number | null, right: null as number | null, leftSpeed: null as number | null, rightSpeed: null as number | null, frontal: false }
  function observe(frame: PoseFrame, neutral = false) {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= lastTime) return
    lastTime = frame.timestampMs
    const previous = samples.at(-1)
    const left = visibleLimb(frame, 'left', limb), right = visibleLimb(frame, 'right', limb)
    const p = frame.landmarks
    const shoulder = p?.[LM.leftShoulder], other = p?.[LM.rightShoulder], hip = p?.[LM.leftHip]
    const torso = inFrame(shoulder) && inFrame(hip) ? Math.hypot((shoulder.x - hip.x) * frame.width / frame.height, shoulder.y - hip.y) : 0
    const orientation = torso > .08 && inFrame(shoulder) && inFrame(other) ? Math.abs(shoulder.x - other.x) * frame.width / frame.height / torso : undefined
    const frontal = orientation !== undefined && orientation > .5
    const view = torso > 0 && shoulder && hip && orientation !== undefined ? { x: (shoulder.x + hip.x) / 2, y: (shoulder.y + hip.y) / 2, scale: torso, orientation } : null
    if (neutral && view) {
      if (neutralView && !sameView(neutralView, view)) viewChanged = true
      neutralView ??= view
    }
    const sample: MotionSample = { atMs: frame.timestampMs, left: left?.angle ?? null, right: right?.angle ?? null, frontal, view }
    const dt = previous ? sample.atMs - previous.atMs : 0
    const speed = (side: 'left' | 'right') => previous && dt >= 50 && dt <= 200 && previous[side] !== null && sample[side] !== null
      ? round((sample[side]! - previous[side]!) * 1000 / dt) : null
    if (previous && dt < 50 && (previous.left === null) === (sample.left === null) && (previous.right === null) === (sample.right === null)) return
    live = { left: sample.left, right: sample.right, leftSpeed: speed('left'), rightSpeed: speed('right'), frontal }
    samples.push(sample)
    if (samples.length > 9600) samples = samples.slice(-9600)
  }
  const capture = (summary: SetSummary, review: RepReviewData) => {
    for (let i = captured.length; i < summary.reps.length; i++) captured.push({
      ...analyzeRep(summary.reps[i], review.traces.find(t => t.repIndex === i), samples), repIndex: i,
    })
  }
  return {
    observe, capture, get reps(): readonly RepMetrics[] { return captured }, get latest() { return captured.at(-1) ?? null }, get samples() { return samples }, get live() { return live },
    finish(summary: SetSummary, review: RepReviewData): SetMotion {
      capture(summary, review)
      const reps = [...captured]
      const view = viewChanged ? null : neutralView
      return { reps, summary: summarizeMotion(reps, summary.coverage, view) }
    },
  }
}
