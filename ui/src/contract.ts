// The data that crosses between the three parts of FitPal.
// perception -> ui: FrameState (every frame)
// perception -> feedback: SetSummary (once per set)
// feedback -> ui: SetResult (once per set)

export type Phase = 'ready' | 'pull' | 'bottom' | 'return'

/** One pose landmark, normalised to the camera frame: x and y run 0 to 1 from the top left. */
export type Landmark = { x: number; y: number; visibility: number }

export type PoseFrame = {
  landmarks: Landmark[] | null
  width: number
  height: number
  timestampMs: number
}

/** Indices into FrameState.landmarks. The order is MediaPipe Pose's 33 landmarks. */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftFoot: 31,
  rightFoot: 32,
} as const

export const LANDMARK_COUNT = 33

export type FrameState = {
  phase: Phase
  /** Progress on the active measured signal, 0 at the top and 1 at the bottom. */
  q: number
  /** False when the joint cannot be seen clearly. No judgment is made then. */
  visible: boolean
  /** Verified reps so far in this set. */
  repCount: number
  /** The tracked body, for the bone overlay. Null when nobody is in view. */
  landmarks: Landmark[] | null
}

/** A rep counts as in range when its deepest q reaches this. */
export const IN_RANGE = 0.85

export type TrunkForm = {
  status: 'steady' | 'swing'
  changeDeg: number
  /** Peak relative to the arm-based pull phase trigger; may precede it. */
  atMs: number
  view: { side: 'left' | 'right'; direction: 1 | -1; hipX: number; hipY: number; scale: number }
}

export type RepResult = {
  status: 'verified' | 'cannot_verify'
  /** Null for a counted upper-arm cycle when wrist visibility prevented measuring elbow range. */
  qMax: number | null
  durationMs: number
  /** Present only when the side view supported a form assessment. */
  trunkForm?: TrunkForm
}

export type SetSummary = {
  exerciseId: string
  calibration: { thetaTop: number; thetaBottom: number; basis?: 'upper-arm' }
  reps: RepResult[]
  /** Share of frames in which the joint was visible, 0 to 1. */
  coverage: number
  /** The form detector was enabled. An assessed rep carries its own evidence. */
  assessesTrunkForm?: boolean
  issues: { id: string; repIndexes: number[] }[]
}

export type SetResult = {
  rewardReasons?: { quality: string; improvement: string }
  cue: { issueId: string; text: string } | null
  exp: { verifiedReps: number; qualityBonus: number; fixedBonus: number }
  /** True when there was an issue from the previous set to fix. */
  hadIssueToFix: boolean
}

export const expOfResult = (r: SetResult) => r.exp.verifiedReps + r.exp.qualityBonus + r.exp.fixedBonus
