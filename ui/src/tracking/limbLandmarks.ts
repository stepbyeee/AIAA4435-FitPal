import { LM, type Landmark, type PoseFrame } from '../contract'

export type Limb = 'arm' | 'leg'
export type Side = 'left' | 'right'

export const limbJoints = {
  arm: {
    left: [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
    right: [LM.rightShoulder, LM.rightElbow, LM.rightWrist],
  },
  leg: {
    left: [LM.leftHip, LM.leftKnee, LM.leftAnkle],
    right: [LM.rightHip, LM.rightKnee, LM.rightAnkle],
  },
} as const

export function inFrame(point: Landmark | undefined): point is Landmark {
  return Boolean(point && Number.isFinite(point.visibility) && point.visibility >= 0.6
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
}

/** Read a projected joint angle in pixels, with consistent gates for the overlay and counting. */
export function visibleLimb({ landmarks, width, height }: PoseFrame, side: Side, limb: Limb) {
  if (!landmarks || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const [proximal, joint, distal] = limbJoints[limb][side].map((index) => landmarks[index])
  if (!inFrame(proximal) || !inFrame(joint) || !inFrame(distal)) return null

  const x1 = (proximal.x - joint.x) * width
  const y1 = (proximal.y - joint.y) * height
  const x2 = (distal.x - joint.x) * width
  const y2 = (distal.y - joint.y) * height
  if (Math.min(Math.hypot(x1, y1), Math.hypot(x2, y2)) < Math.min(width, height) * 0.015) return null
  const angle = Math.atan2(Math.abs(x1 * y2 - y1 * x2), x1 * x2 + y1 * y2) * 180 / Math.PI
  return { proximal, joint, distal, angle }
}
