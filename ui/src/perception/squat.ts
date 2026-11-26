import { IN_RANGE, type FrameState, type Phase, type PoseFrame, type RepResult, type SetSummary } from '../contract'
import { visibleLimb, type Side } from '../tracking/limbLandmarks'
import { MAX_REVIEW_REPS, recordAttempt, type RepReviewData, type RepTrace } from './repReview'

export type LegSide = Side
export type SquatCalibration = SetSummary['calibration'] & { side: LegSide }
type Endpoints = SetSummary['calibration']
type Point = { x: number; y: number }
type LegSample = { angle: number; hipHeight: number; confidence: number; hip: Point; ankle: Point }
const CALIBRATION_CYCLES = 3
const MAX_GAP_MS = 500
const MIN_CYCLE_MS = 450
const MAX_CYCLE_MS = 14000
const MIN_STANDING_ANGLE = 148
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const fraction = (n: number) => Math.min(1, Math.max(0, n))

export function visibleLeg(frame: PoseFrame, side: LegSide): LegSample | null {
  const leg = visibleLimb(frame, side, 'leg')
  if (!leg) return null
  const { proximal: hip, joint: knee, distal: ankle, angle } = leg
  const shinLength = Math.hypot((knee.x - ankle.x) * frame.width, (knee.y - ankle.y) * frame.height)
  return {
    angle,
    ankle: { x: ankle.x, y: ankle.y },
    hip: { x: (hip.x - ankle.x) * frame.width / frame.height, y: hip.y - ankle.y },
    hipHeight: (ankle.y - hip.y) * frame.height / shinLength,
    confidence: Math.min(hip.visibility, knee.visibility, ankle.visibility),
  }
}

function legTrack(side: LegSide, fixed?: SquatCalibration) {
  const endpoints: Endpoints[] = []
  const reps: RepResult[] = []
  const traces: RepTrace[] = []
  const recent: LegSample[] = []
  let lastTime = -Infinity
  let top: { angle: number; hipHeight: number } | null = null
  let active: { started: number; bottom: number; lowestHip: number; descendingFrames: number; review?: ReturnType<typeof recordAttempt> } | null = null
  let phase: Phase = 'ready'
  let q = 0
  let confidence = 0
  let verified = 0
  let previousAnkle: Point | null = null
  let calibrationAnchor: Point | null = null

  function finishRep(rep: RepResult) {
    reps.push(rep)
    if (active?.review) {
      traces.push(active.review.finish(reps.length - 1, rep.status === 'verified'))
      if (traces.length > MAX_REVIEW_REPS) traces.shift()
    }
  }

  function reset() {
    top = null
    active = null
    recent.length = 0
    phase = 'ready'
    q = 0
  }

  function update(sample: LegSample | null, time: number) {
    const priorPosition = fixed ? previousAnkle : calibrationAnchor
    const cameraJump = sample && priorPosition && Math.hypot(
      sample.ankle.x - priorPosition.x, sample.ankle.y - priorPosition.y,
    ) > 0.15
    const gap = time - lastTime > MAX_GAP_MS || cameraJump
    if (cameraJump && !fixed) endpoints.length = 0
    if (!fixed && sample) calibrationAnchor = sample.ankle
    previousAnkle = sample?.ankle ?? null
    const swing = fixed ? fixed.thetaTop - fixed.thetaBottom : 65
    const minimumSwing = fixed ? Math.max(24, swing * 0.32) : 35
    if (gap || !sample || (active && time - active.started > MAX_CYCLE_MS)) {
      // Never stitch a descent on one side to a return on the other.
      if (fixed && active && top && top.angle - active.bottom >= minimumSwing) {
        finishRep({ status: 'cannot_verify', qMax: 0, durationMs: lastTime - active.started })
      }
      reset()
    }
    lastTime = time
    confidence = sample?.confidence ?? 0
    if (!sample) return
    recent.push(sample)
    if (recent.length > 3) recent.shift()
    if (recent.length < 3) return
    const angle = median(recent.map((s) => s.angle))
    const hipHeight = median(recent.map((s) => s.hipHeight))
    const atStand = angle >= (fixed ? fixed.thetaTop - Math.min(13, 0.16 * swing) : MIN_STANDING_ANGLE)
    if (!top) {
      if (atStand) top = { angle: fixed?.thetaTop ?? angle, hipHeight }
      return
    }
    if (!active && atStand && angle >= top.angle - 3) {
      top.angle = fixed?.thetaTop ?? Math.max(top.angle, angle)
      top.hipHeight = Math.max(top.hipHeight, hipHeight)
    }
    q = fraction((top.angle - angle) / swing)
    if (!active) {
      if (top.angle - angle >= Math.max(13, swing * 0.18)) {
        active = { started: time, bottom: angle, lowestHip: hipHeight, descendingFrames: 1, review: fixed ? recordAttempt(time) : undefined }
        active.review?.observe(time, angle, sample.hip, true)
        phase = 'pull'
      }
      return
    }
    active.review?.observe(time, angle, sample.hip, angle <= active.bottom)
    if (angle < active.bottom - 0.5) active.descendingFrames++
    active.bottom = Math.min(active.bottom, angle)
    active.lowestHip = Math.min(active.lowestHip, hipHeight)
    const excursion = top.angle - active.bottom
    const returning = angle >= active.bottom + 6
    phase = returning ? 'return' : q >= IN_RANGE ? 'bottom' : 'pull'
    if (!atStand || angle < top.angle - Math.min(13, swing * 0.16)) return

    const elapsed = time - active.started
    const hipDrop = top.hipHeight - active.lowestHip
    // A knee may straighten before the torso has returned to its standing height.
    if (excursion >= minimumSwing && top.hipHeight - hipHeight > Math.max(0.12, hipDrop * 0.30)) return
    // Hip displacement relative to the ankle rejects isolated knee flexion.
    if (excursion >= minimumSwing && hipDrop >= 0.12 &&
        returning && active.descendingFrames >= 2 && elapsed >= MIN_CYCLE_MS) {
      if (fixed) {
        finishRep({ status: 'verified', qMax: fraction(excursion / swing), durationMs: elapsed })
        verified++
      } else if (endpoints.length < CALIBRATION_CYCLES) {
        endpoints.push({ thetaTop: top.angle, thetaBottom: active.bottom })
      }
    }
    active = null
    top = { angle: fixed?.thetaTop ?? angle, hipHeight }
    phase = 'ready'
  }

  return {
    side, reps, traces, update,
    get count() { return fixed ? verified : endpoints.length },
    get confidence() { return confidence },
    get phase() { return phase },
    get q() { return q },
    calibration(): SquatCalibration | null {
      if (fixed) return fixed
      if (endpoints.length < CALIBRATION_CYCLES) return null
      return { side, thetaTop: median(endpoints.map((e) => e.thetaTop)), thetaBottom: median(endpoints.map((e) => e.thetaBottom)) }
    },
  }
}

export function createSquat(calibration?: SquatCalibration) {
  const tracks = calibration ? [legTrack(calibration.side, calibration)] : [legTrack('left'), legTrack('right')]
  let leader = tracks[0]
  let calibrated = calibration ?? null
  let lastTime = -Infinity
  let frames = 0
  let visibleFrames = 0
  let state: FrameState = { phase: 'ready', q: 0, repCount: 0, visible: false, landmarks: null }

  return {
    accept(frame: PoseFrame): FrameState {
      if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= lastTime) return state
      lastTime = frame.timestampMs
      for (const track of calibrated ? [leader] : tracks) {
        track.update(visibleLeg(frame, track.side), frame.timestampMs)
        if (track.count > leader.count || (track.count === leader.count && track.confidence > leader.confidence)) leader = track
      }
      calibrated ??= leader.calibration()
      frames++
      const visible = leader.confidence > 0
      if (visible) visibleFrames++
      state = { phase: leader.phase, q: leader.q, visible, repCount: leader.count, landmarks: frame.landmarks }
      return state
    },
    getCalibration: () => calibrated && { ...calibrated },
    getRepReview(): RepReviewData { return { side: leader.side, traces: [...leader.traces] } },
    endSet(): SetSummary {
      const reps = leader.reps.map((r) => ({ ...r }))
      const short = reps.flatMap((r, i) => r.status === 'verified' && r.qMax !== null && r.qMax < IN_RANGE ? [i] : [])
      const unseen = reps.flatMap((r, i) => r.status === 'cannot_verify' ? [i] : [])
      const issues: SetSummary['issues'] = []
      if (short.length) issues.push({ id: 'short_range', repIndexes: short })
      if (unseen.length) issues.push({ id: 'out_of_view', repIndexes: unseen })
      return { exerciseId: 'squat', calibration: { thetaTop: calibrated?.thetaTop ?? 0, thetaBottom: calibrated?.thetaBottom ?? 0 },
        reps, coverage: frames ? visibleFrames / frames : 0, issues }
    },
  }
}
