import type { PoseFrame } from '../contract'
import type { Side, Limb } from './limbLandmarks'
import { advanceArmTrails, emptyArmTrails, type ArmTrails } from './armTrails'

type AngleSample = Record<Side, number | null> & {
  timestampMs: number
  breaks: Record<Side, boolean>
}

export type LiveMotion = { trails: ArmTrails; angles: readonly AngleSample[] }

export const ANGLE_WINDOW_MS = 6000
const SAMPLE_INTERVAL_MS = 90
const sides = ['left', 'right'] as const

export const emptyLiveMotion: LiveMotion = { trails: emptyArmTrails, angles: [] }

export function advanceLiveMotion(previous: LiveMotion, frame: PoseFrame, limb: Limb = 'arm'): LiveMotion {
  const { timestampMs } = frame
  const last = previous.angles.at(-1)
  if (!Number.isFinite(timestampMs)) return emptyLiveMotion
  if (last && timestampMs <= last.timestampMs) return previous

  const trails = advanceArmTrails(previous.trails, frame, limb)
  const breaks = {
    left: previous.trails.left.length > 0 && trails.left.length === 1,
    right: previous.trails.right.length > 0 && trails.right.length === 1,
  }
  const sample: AngleSample = {
    timestampMs,
    left: trails.left.at(-1)?.angle ?? null,
    right: trails.right.at(-1)?.angle ?? null,
    breaks,
  }
  const visibilityChanged = last && sides.some((side) => (last[side] === null) !== (sample[side] === null))
  const due = !last || timestampMs - last.timestampMs >= SAMPLE_INTERVAL_MS
  const angles = due || visibilityChanged || breaks.left || breaks.right
    ? [...previous.angles.filter((point) => timestampMs - point.timestampMs <= ANGLE_WINDOW_MS), sample]
    : previous.angles
  return { trails, angles }
}

/** A null or discontinuity starts a separate SVG subpath for this arm only. */
export function angleChartPath(angles: LiveMotion['angles'], side: Side, width: number, height: number): string {
  const end = angles.at(-1)?.timestampMs ?? 0
  let drawing = false
  const result: string[] = []
  for (const sample of angles) {
    const angle = sample[side]
    if (angle === null) {
      drawing = false
      continue
    }
    const x = width * (1 - (end - sample.timestampMs) / ANGLE_WINDOW_MS)
    const y = height * (1 - angle / 180)
    result.push(`${drawing && !sample.breaks[side] ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
    drawing = true
  }
  return result.join(' ')
}
