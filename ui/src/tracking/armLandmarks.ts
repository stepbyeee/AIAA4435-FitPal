import type { PoseFrame } from '../contract'
import { visibleLimb, type Side } from './limbLandmarks'

export type ArmSide = Side

export function visibleArm(frame: PoseFrame, side: ArmSide) {
  const limb = visibleLimb(frame, side, 'arm')
  return limb && { shoulder: limb.proximal, elbow: limb.joint, wrist: limb.distal, angle: limb.angle }
}
