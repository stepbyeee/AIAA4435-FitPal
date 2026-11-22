import type { Landmark, PoseFrame } from '../contract'
import { visibleLimb, type Limb, type Side } from './limbLandmarks'

export type TrailPoint = { timestampMs: number; proximal: Landmark; joint: Landmark; distal: Landmark; angle: number }
export type ArmTrails = Record<Side, readonly TrailPoint[]>

const TRAIL_MS = 1200
const MAX_GAP_MS = 200
const MAX_JOINT_JUMP = 0.15

export const emptyArmTrails: ArmTrails = { left: [], right: [] }

const jump = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)

function append(trail: readonly TrailPoint[], frame: PoseFrame, side: Side, limb: Limb): readonly TrailPoint[] {
  const sample = visibleLimb(frame, side, limb)
  if (!sample) return emptyArmTrails[side]

  const { timestampMs } = frame
  const { proximal, joint, distal, angle } = sample
  const last = trail.at(-1)
  if (last && timestampMs <= last.timestampMs) return trail
  // Resume with a single point after a stalled stream or a sudden pose jump.
  const continuous = last && timestampMs - last.timestampMs <= MAX_GAP_MS
    && jump(last.joint, joint) <= MAX_JOINT_JUMP && jump(last.distal, distal) <= MAX_JOINT_JUMP
    && jump(last.proximal, proximal) <= MAX_JOINT_JUMP
  const point = { timestampMs, proximal, joint, distal, angle }
  return continuous ? [...trail.filter((p) => timestampMs - p.timestampMs <= TRAIL_MS), point] : [point]
}

export function advanceArmTrails(trails: ArmTrails, frame: PoseFrame, limb: Limb = 'arm'): ArmTrails {
  if (!frame.landmarks || !Number.isFinite(frame.timestampMs)) return emptyArmTrails
  return { left: append(trails.left, frame, 'left', limb), right: append(trails.right, frame, 'right', limb) }
}
