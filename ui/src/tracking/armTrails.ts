import type { Landmark, PoseFrame } from '../contract'
import { visibleArm, type ArmSide } from './armLandmarks'

export type TrailPoint = { timestampMs: number; shoulder: Landmark; elbow: Landmark; wrist: Landmark; angle: number }
export type ArmTrails = Record<ArmSide, readonly TrailPoint[]>

const TRAIL_MS = 1200
const MAX_GAP_MS = 200
const MAX_JOINT_JUMP = 0.15

export const emptyArmTrails: ArmTrails = { left: [], right: [] }

const jump = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)

function append(trail: readonly TrailPoint[], frame: PoseFrame, side: ArmSide): readonly TrailPoint[] {
  const arm = visibleArm(frame, side)
  if (!arm) return emptyArmTrails[side]

  const { timestampMs } = frame
  const { shoulder, elbow, wrist, angle } = arm
  const last = trail.at(-1)
  if (last && timestampMs <= last.timestampMs) return trail
  // Resume with a single point after a stalled stream or a sudden pose jump.
  const continuous = last && timestampMs - last.timestampMs <= MAX_GAP_MS
    && jump(last.elbow, elbow) <= MAX_JOINT_JUMP && jump(last.wrist, wrist) <= MAX_JOINT_JUMP
  const point = { timestampMs, shoulder, elbow, wrist, angle }
  return continuous ? [...trail.filter((p) => timestampMs - p.timestampMs <= TRAIL_MS), point] : [point]
}

export function advanceArmTrails(trails: ArmTrails, frame: PoseFrame): ArmTrails {
  if (!frame.landmarks || !Number.isFinite(frame.timestampMs)) return emptyArmTrails
  return { left: append(trails.left, frame, 'left'), right: append(trails.right, frame, 'right') }
}
