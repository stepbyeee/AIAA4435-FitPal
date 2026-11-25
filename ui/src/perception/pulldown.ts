import { IN_RANGE, type FrameState, type Phase, type PoseFrame, type RepResult, type SetSummary } from '../contract'
import { MAX_REVIEW_REPS, recordAttempt, type RepReviewData, type RepTrace } from './repReview'
import { createUpperArmTrack } from './pulldownUpperArm'
import { visibleArm, type ArmSide } from '../tracking/armLandmarks'

export type Calibration = SetSummary['calibration'] & { side: ArmSide }

type Side = Calibration['side']
type ArmPosition = { angle: number; lift: number; normalizedLift: number }
type ArmSample = ArmPosition & { shoulder: { x: number; y: number }; elbow: { x: number; y: number }; confidence: number; wrist: { x: number; y: number } }
type EndpointPair = Pick<Calibration, 'thetaTop' | 'thetaBottom'>
type Attempt = {
  review?: ReturnType<typeof recordAttempt>
  startedAt: number
  topAngle: number
  bottomAngle: number
  topHeight: number
  lowestHeight: number
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
const SUSTAINED_VISIBILITY_LOSS_MS = 1500
const ASSUMED_SWING = 50
const MIN_LIFT_TOLERANCE = 0.012
const LIFT_TOLERANCE_FRACTION = 0.18
const OVERHEAD_WRIST_HEIGHT = 0.65

const bounded = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function readArm(frame: PoseFrame, side: Side): ArmSample | null {
  const arm = visibleArm(frame, side)
  if (!arm) return null
  const { shoulder, elbow, wrist, angle } = arm
  const length = Math.hypot((shoulder.x - elbow.x) * frame.width, (shoulder.y - elbow.y) * frame.height)
    + Math.hypot((wrist.x - elbow.x) * frame.width, (wrist.y - elbow.y) * frame.height)
  const normalizedLift = (shoulder.y - wrist.y) * frame.height / length
  return {
    angle, shoulder, elbow, normalizedLift,
    lift: shoulder.y - wrist.y,
    wrist: { x: (wrist.x - shoulder.x) * frame.width / frame.height, y: wrist.y - shoulder.y },
    confidence: Math.min(shoulder.visibility, elbow.visibility, wrist.visibility),
  }
}

function createSideTrack(side: Side, fixed?: Calibration) {
  const endpoints: EndpointPair[] = []
  const reps: RepResult[] = []
  const traces: RepTrace[] = []
  const recent: ArmSample[] = []
  let topAngle: number | null = null
  let topPose: ArmPosition | null = null
  let topReady = false
  let attempt: Attempt | null = null
  let lastSampleTime: number | null = null
  let phase: Phase = 'ready'
  let q = 0
  let confidence = 0
  let verified = 0
  let previousArm: ArmSample | null = null
  let recentlyRaised: { arm: ArmSample; time: number } | null = null

  function loseTracking() {
    recent.length = 0
    if (attempt) {
      attempt.interrupted = true
      attempt.review?.gap()
    } else {
      topAngle = null
      topPose = null
      topReady = false
    }
  }

  function update(sample: ArmSample | null, timestampMs: number) {
    confidence = sample?.confidence ?? 0
    // A coherent jump of both anchors indicates a cut or change of tracked person.
    // Rotation about a stable elbow can move the shoulder during a genuine rep.
    if (previousArm && sample) {
      const sx = sample.shoulder.x - previousArm.shoulder.x
      const sy = sample.shoulder.y - previousArm.shoulder.y
      const ex = sample.elbow.x - previousArm.elbow.x
      const ey = sample.elbow.y - previousArm.elbow.y
      if (Math.hypot(sx, sy) > 0.15 && Math.hypot(ex, ey) > 0.15 && sx * ex + sy * ey > 0) loseTracking()
    }
    if (lastSampleTime !== null && timestampMs - lastSampleTime > MAX_FRAME_GAP_MS) loseTracking()
    // Calibration can re-arm from a directly observed top after a brief detector
    // dropout. The first returning frame must itself match the prior top on this
    // side. An active descent/return always follows the interrupted-attempt path.
    if (!sample && !fixed && !attempt && topPose && topReady && previousArm && lastSampleTime !== null
      && Math.abs(previousArm.angle - topPose.angle) <= 9) {
      recentlyRaised = { arm: previousArm, time: lastSampleTime }
    }
    previousArm = sample
    lastSampleTime = timestampMs
    if (!sample) {
      loseTracking()
      return
    }
    if (recentlyRaised) {
      const { arm, time } = recentlyRaised
      recentlyRaised = null
      if (timestampMs - time <= 170 && Math.abs(sample.angle - arm.angle) <= 9
        && Math.abs(sample.lift - arm.lift) <= 0.04
        && Math.hypot(sample.shoulder.x - arm.shoulder.x, sample.shoulder.y - arm.shoulder.y) <= 0.06) {
        topAngle = sample.angle
        topPose = { angle: sample.angle, lift: sample.lift, normalizedLift: sample.normalizedLift }
        topReady = true
      }
    }

    recent.push(sample)
    if (recent.length > 3) recent.shift()
    const angles = recent.map((position) => position.angle)
    const angle = recent.length === 3 ? median(angles) : sample.angle
    const lift = recent.length === 3 ? median(recent.map((position) => position.lift)) : sample.lift
    const normalizedLift = recent.length === 3 ? median(recent.map(position => position.normalizedLift)) : sample.normalizedLift
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
      // Two actual overhead observations can establish the starting pose during a
      // continuous set. Grip height and extension must agree on the same arm.
      if (!fixed && !topReady && recent.slice(-2).every(position =>
        position.normalizedLift >= OVERHEAD_WRIST_HEIGHT && position.angle >= 132)) {
        topAngle = angle
        topPose = { angle, lift, normalizedLift }
        topReady = true
      }
      q = bounded((topAngle - angle) / swing, 0, 1)
      if (angle >= topAngle - topTolerance) {
        if (fixed || (angle >= topAngle - 5 && Math.max(...angles) - Math.min(...angles) <= 7)) topReady = true
        if (topReady && (!topPose || angle > topPose.angle)) topPose = { angle, lift, normalizedLift }
      }

      if (!topPose || angle > topAngle - departure) return
      attempt = {
        review: fixed ? recordAttempt(timestampMs) : undefined,
        startedAt: timestampMs,
        topAngle,
        bottomAngle: angle,
        topLift: topPose.lift,
        topHeight: topPose.normalizedLift,
        lowestHeight: normalizedLift,
        furthestLift: lift,
        descentFrames: 1,
        interrupted: false,
        turn: null,
      }
      attempt.review?.observe(timestampMs, angle, sample.wrist, true)
      phase = 'pull'
      return
    }

    const current = attempt
    current.lowestHeight = Math.min(current.lowestHeight, normalizedLift)
    current.review?.observe(timestampMs, angle, sample.wrist, !current.turn)
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
    // A slow return may not recover the exact angle measured at the start.
    // Require most of this pull's excursion back at both the elbow and wrist.
    const returnTolerance = bounded(0.24 * excursion, 5, 26)
    if (angle < current.topAngle - returnTolerance || recent.length < 3) return

    // Elbow extension can precede the bar's return overhead. Confirm the wrist
    // also approached the observed starting height relative to the shoulder.
    const liftExcursion = current.furthestLift - current.topLift
    const liftTolerance = Math.max(MIN_LIFT_TOLERANCE, Math.abs(liftExcursion) * LIFT_TOLERANCE_FRACTION)
    // When framing changes, the same overhead grip moves fewer pixels. Confirm
    // the return against measured arm length only after a clear downward stroke.
    const heightSwing = current.topHeight - current.lowestHeight
    const returnedOverhead = current.topHeight >= OVERHEAD_WRIST_HEIGHT && heightSwing >= 0.35
      && normalizedLift >= Math.max(OVERHEAD_WRIST_HEIGHT, current.topHeight - LIFT_TOLERANCE_FRACTION * heightSwing)
    if ((lift - current.topLift) * Math.sign(liftExcursion) > liftTolerance && !returnedOverhead) return

    const durationMs = timestampMs - current.startedAt
    const returned = current.turn.frames >= 2 || current.interrupted
    if (excursion >= minimumPull && durationMs >= MIN_REP_MS && current.descentFrames >= 2 && returned) {
      if (fixed) {
        reps.push({
          status: current.interrupted ? 'cannot_verify' : 'verified',
          qMax: bounded(excursion / swing, 0, 1),
          durationMs,
        })
        if (current.review) {
          traces.push(current.review.finish(reps.length - 1, !current.interrupted))
          if (traces.length > MAX_REVIEW_REPS) traces.shift()
        }
        if (!current.interrupted) verified++
      } else if (!current.interrupted && endpoints.length < CALIBRATION_CYCLES) {
        endpoints.push({ thetaTop: current.topAngle, thetaBottom: current.bottomAngle })
      }
    }

    attempt = null
    // The angle can still extend after crossing the return threshold.
    topAngle = fixed?.thetaTop ?? angle
    // A verified return is itself evidence of a top pose. Continuous repetitions
    // can start the next descent without making a second stationary hold.
    topPose = { angle, lift, normalizedLift }
    topReady = true
    phase = 'ready'
  }

  return {
    side,
    reps,
    traces,
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
  const upperTracks = fixed
    ? (fixed.basis === 'upper-arm' ? [createUpperArmTrack(fixed.side, fixed)] : [])
    : [createUpperArmTrack('left'), createUpperArmTrack('right')]
  let upper = fixed?.basis === 'upper-arm' ? upperTracks[0] : null
  let active = tracks[0]
  let calibrated = fixed ?? null
  let frameCount = 0
  let visibleCount = 0
  let lastTime = -Infinity
  let invisibleSince: number | null = null
  let sustainedVisibilityLoss = false
  let frameState: FrameState = { phase: 'ready', q: 0, visible: false, repCount: 0, landmarks: null }

  return {
    accept(frame: PoseFrame): FrameState {
      if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= lastTime) return frameState
      if (frame.timestampMs - lastTime > MAX_FRAME_GAP_MS) invisibleSince = null
      lastTime = frame.timestampMs

      if (upper) {
        upper.update(frame)
      } else if (calibrated) {
        active.update(readArm(frame, active.side), frame.timestampMs)
      } else {
        for (const track of tracks) track.update(readArm(frame, track.side), frame.timestampMs)
        const other = tracks.find((track) => track !== active)!
        // Preserve each arm's own history. The visible leader supplies calibration progress.
        if (other.count > active.count || (other.count === active.count && other.confidence > active.confidence)) active = other
        calibrated = active.getCalibration()
        if (!calibrated) {
          for (const track of upperTracks) {
            track.update(frame)
            const candidate = track.getCalibration()
            if (candidate) {
              upper = track
              calibrated = candidate
              break
            }
          }
        }
      }

      frameCount++
      const visible = upper ? upper.visible : active.confidence > 0
      if (visible) visibleCount++
      // A paused or stalled camera cannot provide evidence of a continuous loss.
      if (visible || !(frame.width > 0 && frame.height > 0)) {
        invisibleSince = null
      } else if (fixed) {
        invisibleSince ??= frame.timestampMs
        if (frame.timestampMs - invisibleSince >= SUSTAINED_VISIBILITY_LOSS_MS) sustainedVisibilityLoss = true
      }
      frameState = {
        phase: upper?.phase ?? active.phase,
        q: upper?.q ?? active.q,
        visible,
        repCount: upper?.count ?? (calibrated ? active.count : Math.max(active.count, ...upperTracks.map(track => track.count))),
        landmarks: frame.landmarks,
      }
      return frameState
    },

    getCalibration(): Calibration | null {
      return calibrated && { ...calibrated }
    },

    getRepReview(): RepReviewData {
      return upper ? { side: upper.side, traces: [] } : { side: active.side, traces: [...active.traces] }
    },

    endSet(): SetSummary {
      const reps = (upper?.reps ?? active.reps).map((rep) => ({ ...rep }))
      const short = reps.flatMap((rep, i) => rep.status === 'verified' && rep.qMax !== null && rep.qMax < IN_RANGE ? [i] : [])
      const unseen = reps.flatMap((rep, i) => rep.status === 'cannot_verify' ? [i] : [])
      const issues: SetSummary['issues'] = []
      if (short.length) issues.push({ id: 'short_range', repIndexes: short })
      if (unseen.length || sustainedVisibilityLoss) issues.push({ id: 'out_of_view', repIndexes: unseen })
      return {
        exerciseId: 'lat-pulldown',
        calibration: {
          thetaTop: calibrated?.thetaTop ?? 0,
          thetaBottom: calibrated?.thetaBottom ?? 0,
          ...(calibrated?.basis ? { basis: calibrated.basis } : {}),
        },
        reps,
        coverage: frameCount ? visibleCount / frameCount : 0,
        issues,
      }
    },
  }
}
