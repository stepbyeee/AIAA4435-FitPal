import type { FrameState, PoseFrame } from '../contract'
import type { Calibration } from '../perception/pulldown'
import { comparableTrunkView, readTrunk } from '../perception/pulldownForm'
import type { Limb } from '../tracking/limbLandmarks'

export const TREND_WINDOW_MS = 6000
export type TrendSample = { atMs: number; range: number | null; tilt: number | null; rangeBreak: boolean; tiltBreak: boolean }

/** Display-only histories; neither the counter nor the reward policy consumes these samples. */
export function createLiveTrends(limb: Limb, calibration?: Calibration) {
  let samples: TrendSample[] = []
  let lastSeen = -Infinity
  let previousTrunk: ReturnType<typeof readTrunk> = null
  return {
    get samples(): readonly TrendSample[] { return samples },
    observe(frame: PoseFrame, state: FrameState) {
      const atMs = frame.timestampMs
      if (!Number.isFinite(atMs) || atMs <= lastSeen) return
      lastSeen = atMs
      const previous = samples.at(-1)
      const range = calibration && calibration.basis !== 'upper-arm' && state.visible && Number.isFinite(state.q)
        ? Math.max(0, Math.min(1, state.q)) : null
      const trunk = limb === 'arm' && calibration && state.visible && Number.isFinite(frame.width) && Number.isFinite(frame.height)
        ? readTrunk(frame, calibration.side) : null
      const tilt = trunk && Number.isFinite(trunk.tilt) ? trunk.tilt : null
      const gap = Boolean(previous && atMs - previous.atMs > 250)
      const tiltBreak = gap || Boolean(trunk && previousTrunk && !comparableTrunkView(previousTrunk.view, trunk.view))
      const visibilityChanged = previous && ((range === null) !== (previous.range === null) || (tilt === null) !== (previous.tilt === null))
      if (previous && atMs - previous.atMs < 100 && !visibilityChanged && !tiltBreak) return
      samples = [...samples.filter(s => atMs - s.atMs <= TREND_WINDOW_MS), { atMs, range, tilt, rangeBreak: gap, tiltBreak }].slice(-128)
      previousTrunk = trunk
    },
  }
}

export function trendPath(samples: readonly TrendSample[], key: 'range' | 'tilt', width: number, height: number, min: number, max: number) {
  const end = samples.at(-1)?.atMs ?? 0
  let drawing = false
  return samples.map(sample => {
    const value = sample[key]
    if (value === null || !Number.isFinite(value)) { drawing = false; return '' }
    const x = width * (1 - (end - sample.atMs) / TREND_WINDOW_MS)
    const y = height * (1 - (Math.max(min, Math.min(max, value)) - min) / (max - min))
    const command = drawing && !sample[key === 'range' ? 'rangeBreak' : 'tiltBreak'] ? 'L' : 'M'
    drawing = true
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`
  }).filter(Boolean).join(' ')
}
