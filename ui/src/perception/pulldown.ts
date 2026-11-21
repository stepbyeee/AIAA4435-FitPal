import { IN_RANGE, type FrameState, type Phase, type PoseFrame, type RepResult, type SetSummary } from '../contract'
import { visibleArm, type ArmSide } from '../tracking/armLandmarks'

export type Calibration = SetSummary['calibration'] & { side: ArmSide }

type Side = Calibration['side']
type ArmPosition = { angle: number; lift: number }
type ArmSample = ArmPosition & { confidence: number }
type EndpointPair = Pick<Calibration, 'thetaTop' | 'thetaBottom'>
type Attempt = {
  startedAt: number
  topAngle: number
  bottomAngle: number
  topLift: number
  furthestLift: number
  descentFrames: number
  interrupted: boolean
  turn: { startedAt: number; highestAngle: number; frames: number } | null
}

const CALIBRATION_CYCLES = 3
const MIN_CALIBRATION_SWING = 24
const MIN_REP_MS = 550
const MAX_REP_MS = 12_000
const MAX_FRAME_GAP_MS = 500
const ASSUMED_SWING = 50
const MIN_LIFT_TOLERANCE = 0.012
const LIFT_TOLERANCE_FRACTION = 0.1

const bounded = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function readArm(frame: PoseFrame, side: Side): ArmSample | null {
  const arm = visibleArm(frame, side)
  if (!arm) return null
  const { shoulder, elbow, wrist, angle } = arm
  return {
    angle,
    lift: shoulder.y - wrist.y,
    confidence: Math.min(shoulder.visibility, elbow.visibility, wrist.visibility),
  }
}

function createSideTrack(side: Side, fixed?: Calibration) {
  const endpoints: EndpointPair[] = []
  const reps: RepResult[] = []
  const recent: ArmPosition[] = []
  let topAngle: number | null = null
  let topPose: ArmPosition | null = null
  let topReady = false
  let attempt: Attempt | null = null
  let lastSampleTime: number | null = null
  let phase: Phase = 'ready'
  let q = 0
  let confidence = 0
  let verified = 0

  function loseTracking() {
    recent.length = 0
    if (attempt) {
      attempt.interrupted = true
    } else {
      topAngle = null
      topPose = null
      topReady = false
    }
  }

  function update(sample: ArmSample | null, timestampMs: number) {
    confidence = sample?.confidence ?? 0
    if (lastSampleTime !== null && timestampMs - lastSampleTime > MAX_FRAME_GAP_MS) loseTracking()
    lastSampleTime = timestampMs
    if (!sample) {
      loseTracking()
      return
    }

    recent.push(sample)
    if (recent.length > 3) recent.shift()
    const angles = recent.map((position) => position.angle)
    const angle = recent.length === 3 ? median(angles) : sample.angle
    const lift = recent.length === 3 ? median(recent.map((position) => position.lift)) : sample.lift
    const calibrationSwing = endpoints.length
      ? median(endpoints.map((cycle) => cycle.thetaTop - cycle.thetaBottom))
      : ASSUMED_SWING
    const swing = fixed ? fixed.thetaTop - fixed.thetaBottom : calibrationSwing
    const topTolerance = bounded(0.18 * swing, 5, 14)
    const departure = Math.max(topTolerance + 2, fixed ? 0.22 * swing : 10)
    const minimumPull = fixed ? Math.max(0.33 * swing, 8) : MIN_CALIBRATION_SWING
    const reversal = bounded(0.08 * swing, 3, 7)

    if (attempt && timestampMs - attempt.startedAt > MAX_REP_MS) {
      attempt = null
      topAngle = null
      topPose = null
      topReady = false
    }

    if (!attempt) {
      phase = 'ready'
      if (recent.length < 3) {
        q = fixed ? bounded((fixed.thetaTop - angle) / swing, 0, 1) : 0
        return
      }

      topAngle = fixed?.thetaTop ?? Math.max(topAngle ?? angle, angle)
      q = bounded((topAngle - angle) / swing, 0, 1)
      if (angle >= topAngle - topTolerance) {
        if (fixed || (angle >= topAngle - 5 && Math.max(...angles) - Math.min(...angles) <= 7)) topReady = true
        if (topReady && (!topPose || angle > topPose.angle)) topPose = { angle, lift }
      }

      if (!topPose || angle > topAngle - departure) return
      attempt = {
        startedAt: timestampMs,
        topAngle,
        bottomAngle: angle,
        topLift: topPose.lift,
        furthestLift: lift,
        descentFrames: 1,
        interrupted: false,
        turn: null,
      }
      phase = 'pull'
      return
    }

    const current = attempt
    q = bounded((current.topAngle - angle) / swing, 0, 1)
    if (current.turn) {
      if (angle < current.turn.highestAngle - departure) {
        // A second descent before returning to the top cannot complete the prior cycle.
        attempt = null
        topAngle = null
        topPose = null
        topReady = false
        phase = 'ready'
        return
      }
      if (angle > current.turn.highestAngle + 0.5) current.turn.frames++
      current.turn.highestAngle = Math.max(current.turn.highestAngle, angle)
    } else {
      if (angle < current.bottomAngle - 0.5) current.descentFrames++
      current.bottomAngle = Math.min(current.bottomAngle, angle)
      if (Math.abs(lift - current.topLift) > Math.abs(current.furthestLift - current.topLift)) current.furthestLift = lift
      const meaningful = current.topAngle - current.bottomAngle >= minimumPull
      if (meaningful && angle >= current.bottomAngle + reversal) {
        current.turn = { startedAt: timestampMs, highestAngle: angle, frames: 1 }
      } else if (!meaningful && angle >= current.topAngle - topTolerance && recent.length === 3) {
        // A small wobble is ignored until the arm is clearly back in the top band.
        attempt = null
        phase = 'ready'
        return
      }
    }

    const excursion = current.topAngle - current.bottomAngle
    if (!current.turn) {
      phase = fixed && q >= IN_RANGE ? 'bottom' : 'pull'
      return
    }

    phase = timestampMs - current.turn.startedAt < 120 ? 'bottom' : 'return'
    const returnTolerance = fixed ? topTolerance : bounded(0.2 * excursion, 5, 12)
    if (angle < current.topAngle - returnTolerance || recent.length < 3) return

    // Elbow extension can precede the bar's return overhead. Confirm the wrist
    // also approached the observed starting height relative to the shoulder.
    const liftExcursion = current.furthestLift - current.topLift
    const liftTolerance = Math.max(MIN_LIFT_TOLERANCE, Math.abs(liftExcursion) * LIFT_TOLERANCE_FRACTION)
    if ((lift - current.topLift) * Math.sign(liftExcursion) > liftTolerance) return

    const durationMs = timestampMs - current.startedAt
    const returned = current.turn.frames >= 2 || current.interrupted
    if (excursion >= minimumPull && durationMs >= MIN_REP_MS && current.descentFrames >= 2 && returned) {
      if (fixed) {
        reps.push({
          status: current.interrupted ? 'cannot_verify' : 'verified',
          qMax: bounded(excursion / swing, 0, 1),
          durationMs,
        })
        if (!current.interrupted) verified++
      } else if (!current.interrupted && endpoints.length < CALIBRATION_CYCLES) {
        endpoints.push({ thetaTop: current.topAngle, thetaBottom: current.bottomAngle })
      }
    }

    attempt = null
    // The angle can still extend after crossing the return threshold.
    topAngle = fixed?.thetaTop ?? angle
    topPose = fixed ? { angle, lift } : null
    topReady = Boolean(fixed)
    phase = 'ready'
  }

  return {
    side,
    reps,
    update,
    get confidence() { return confidence },
    get phase() { return phase },
    get q() { return q },
    get count() { return fixed ? verified : endpoints.length },
    getCalibration(): Calibration | null {
      if (fixed) return { ...fixed }
      if (endpoints.length !== CALIBRATION_CYCLES) return null
      const thetaTop = median(endpoints.map((cycle) => cycle.thetaTop))
      const thetaBottom = median(endpoints.map((cycle) => cycle.thetaBottom))
      return thetaTop - thetaBottom >= MIN_CALIBRATION_SWING ? { side, thetaTop, thetaBottom } : null
    },
  }
}

export function createPulldown(calibration?: Calibration) {
  const fixed = calibration && { ...calibration }
  const tracks = fixed ? [createSideTrack(fixed.side, fixed)] : [createSideTrack('left'), createSideTrack('right')]
  let active = tracks[0]
  let calibrated = fixed ?? null
  let frameCount = 0
  let visibleCount = 0
  let lastTime = -Infinity
  let frameState: FrameState = { phase: 'ready', q: 0, visible: false, repCount: 0, landmarks: null }

  return {
    accept(frame: PoseFrame): FrameState {
      if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= lastTime) return frameState
      lastTime = frame.timestampMs

      if (calibrated) {
        active.update(readArm(frame, active.side), frame.timestampMs)
      } else {
        for (const track of tracks) track.update(readArm(frame, track.side), frame.timestampMs)
        const other = tracks.find((track) => track !== active)!
        // Preserve each arm's own history. The visible leader supplies calibration progress.
        if (other.count > active.count || (other.count === active.count && other.confidence > active.confidence)) active = other
        calibrated = active.getCalibration()
      }

      frameCount++
      const visible = active.confidence > 0
      if (visible) visibleCount++
      frameState = {
        phase: active.phase,
        q: active.q,
        visible,
        repCount: active.count,
        landmarks: frame.landmarks,
      }
      return frameState
    },

    getCalibration(): Calibration | null {
      return calibrated && { ...calibrated }
    },

    endSet(): SetSummary {
      const reps = active.reps.map((rep) => ({ ...rep }))
      const short = reps.flatMap((rep, i) => rep.status === 'verified' && rep.qMax < IN_RANGE ? [i] : [])
      const unseen = reps.flatMap((rep, i) => rep.status === 'cannot_verify' ? [i] : [])
      const issues: SetSummary['issues'] = []
      if (short.length) issues.push({ id: 'short_range', repIndexes: short })
      if (unseen.length) issues.push({ id: 'out_of_view', repIndexes: unseen })
      return {
        exerciseId: 'lat-pulldown',
        calibration: { thetaTop: calibrated?.thetaTop ?? 0, thetaBottom: calibrated?.thetaBottom ?? 0 },
        reps,
        coverage: frameCount ? visibleCount / frameCount : 0,
        issues,
      }
    },
  }
}
