import { LM, type Landmark, type PoseFrame } from '../contract'

const ARM_LANDMARKS = {
  left: [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
  right: [LM.rightShoulder, LM.rightElbow, LM.rightWrist],
} as const

export type ArmSide = keyof typeof ARM_LANDMARKS

function inFrame(point: Landmark | undefined): point is Landmark {
  return Boolean(point && Number.isFinite(point.visibility) && point.visibility >= 0.6
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
}

/** The same visibility and geometry checks gate motion visualization and rep judgment. */
export function visibleArm({ landmarks, width, height }: PoseFrame, side: ArmSide) {
  if (!landmarks || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  const [shoulder, elbow, wrist] = ARM_LANDMARKS[side].map((index) => landmarks[index])
  if (!inFrame(shoulder) || !inFrame(elbow) || !inFrame(wrist)) return null

  // Normalized x and y have different units on a non-square camera frame.
  const upperX = (shoulder.x - elbow.x) * width
  const upperY = (shoulder.y - elbow.y) * height
  const lowerX = (wrist.x - elbow.x) * width
  const lowerY = (wrist.y - elbow.y) * height
  const minLength = Math.min(width, height) * 0.015
  if (Math.min(Math.hypot(upperX, upperY), Math.hypot(lowerX, lowerY)) < minLength) return null

  return { shoulder, elbow, wrist, upperX, upperY, lowerX, lowerY }
}
