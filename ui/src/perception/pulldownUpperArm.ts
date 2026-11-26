import type { Phase, PoseFrame, RepResult } from '../contract'
import { inFrame, limbJoints, type Side } from '../tracking/limbLandmarks'
import type { Calibration } from './pulldown'

const RAISED = 110
const LOWERED = 72
const MIN_SWING = 45
const HOLD_MS = 55
const MAX_GAP_MS = 400
const CALIBRATION_CYCLES = 3

function middle(values: number[]) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
}

type Cycle = {
  top: number
  bottom: number
  wristLimited: boolean
  start: number
  reachedBottom: boolean
  observedFlexion: boolean
}

function begin(angle: number, wristLimited: boolean, start: number): Cycle {
  return { top: angle, bottom: angle, wristLimited, start, reachedBottom: false, observedFlexion: false }
}

/** Count a directly observed shoulder/elbow cycle when wrist observations are repeatedly unavailable.
 * Upper-arm elevation is not elbow flexion. These reps therefore have no elbow ROM measurement. */
export function createUpperArmTrack(side: Side, fixed?: Calibration) {
  const calibration: Cycle[] = []
  const reps: RepResult[] = []
  const [shoulderIndex, elbowIndex, wristIndex] = limbJoints.arm[side]
  let current: Cycle | null = null
  let previousTime = -Infinity
  let lastElbow = -Infinity
  let highSince: number | null = null
  let lowSince: number | null = null
  let lastShoulder: { x: number; y: number } | null = null
  let calibrationAnchor: { x: number; y: number } | null = null
  let available = false
  let angle = 0
  let phase: Phase = 'ready'

  function restart() {
    current = null
    highSince = null
    lowSince = null
    lastShoulder = null
    phase = 'ready'
  }

  function update({ landmarks, width, height, timestampMs: t }: PoseFrame) {
    const shoulder = landmarks?.[shoulderIndex]
    const elbow = landmarks?.[elbowIndex]
    const wrist = landmarks?.[wristIndex]
    available = false
    if (t - previousTime > MAX_GAP_MS) restart()
    previousTime = t
    if (!inFrame(shoulder) || !elbow || !wrist || !(width > 0 && height > 0)) {
      restart()
      return
    }
    const priorPosition = fixed ? lastShoulder : calibrationAnchor
    if (priorPosition && Math.hypot(shoulder.x - priorPosition.x, shoulder.y - priorPosition.y) > 0.15) {
      if (!fixed) calibration.length = 0
      restart()
    }
    if (!fixed) calibrationAnchor = shoulder
    lastShoulder = shoulder
    const wristVisible = Boolean(inFrame(wrist))
    if (!Boolean(inFrame(elbow))) {
      // An elbow may briefly cross the bottom border after we see it lowered.
      // The wrist must remain directly visible on the same side near shoulder height.
      if (current?.reachedBottom && wristVisible && elbow.y >= 1 && elbow.visibility >= 0.6
        && wrist.y > shoulder.y - 0.05 && t - lastElbow <= MAX_GAP_MS) return
      restart()
      return
    }
    lastElbow = t
    // Keep the independently observed upper arm. A missing wrist cannot supply
    // flexion evidence: the lowered bend must still be directly visible.
    const dx = (elbow.x - shoulder.x) * width
    const dy = (elbow.y - shoulder.y) * height
    if (Math.hypot(dx, dy) < 0.045 * Math.min(width, height)) {
      restart()
      return
    }
    angle = Math.atan2(Math.abs(dx), dy) * 180 / Math.PI
    available = true
    if (current && t - current.start > 12_000) restart()
    const high = angle >= RAISED
    const low = angle <= LOWERED
    highSince = high ? (highSince ?? t) : null
    lowSince = low ? (lowSince ?? t) : null
    if (!current) {
      if (highSince !== null && t - highSince >= HOLD_MS) current = begin(angle, !wristVisible, t)
      return
    }

    current.wristLimited ||= !wristVisible
    current.bottom = Math.min(current.bottom, angle)
    if (!current.reachedBottom) {
      phase = high ? 'ready' : 'pull'
      current.top = Math.max(current.top, angle)
      if (low && wristVisible) {
        const wx = (wrist.x - elbow.x) * width
        const wy = (wrist.y - elbow.y) * height
        const flexion = Math.atan2(Math.abs(-dx * wy + dy * wx), -dx * wx - dy * wy) * 180 / Math.PI
        if (Math.hypot(wx, wy) > 0.025 * Math.min(width, height) && flexion < 135) current.observedFlexion = true
      }
      if (lowSince !== null && t - lowSince >= HOLD_MS && current.top - current.bottom >= MIN_SWING
        && current.observedFlexion) current.reachedBottom = true
      return
    }
    phase = angle > current.bottom + 12 ? 'return' : 'bottom'
    if (highSince === null || t - highSince < HOLD_MS || t - current.start < 550 || angle < current.top - 24) return

    if (fixed) {
      reps.push({ status: 'verified', qMax: null, durationMs: t - current.start })
    } else {
      calibration.push(current)
      if (calibration.length > CALIBRATION_CYCLES) calibration.shift()
    }
    current = begin(angle, !wristVisible, t)
    lowSince = null
    phase = 'ready'
  }

  function wristLimitedCycles() { return calibration.filter(cycle => cycle.wristLimited).length }

  function getCalibration(): Calibration | null {
    if (fixed) return fixed
    if (calibration.length !== CALIBRATION_CYCLES || wristLimitedCycles() < 2) return null
    return {
      basis: 'upper-arm', side,
      thetaTop: middle(calibration.map(cycle => cycle.top)), thetaBottom: middle(calibration.map(cycle => cycle.bottom)),
    }
  }
  return {
    update, getCalibration, reps, side,
    get count() { return fixed ? reps.length : getCalibration() ? CALIBRATION_CYCLES : wristLimitedCycles() },
    get visible() { return available },
    get phase() { return phase },
    get q() {
      if (!fixed || !available) return 0
      return Math.min(1, Math.max(0, (fixed.thetaTop - angle) / (fixed.thetaTop - fixed.thetaBottom)))
    },
  }
}
