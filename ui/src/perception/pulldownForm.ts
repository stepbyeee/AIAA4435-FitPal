import { LM, type PoseFrame, type TrunkForm } from '../contract'
import { inFrame, type Side } from '../tracking/limbLandmarks'

const BASELINE_WINDOW_MS = 500
const MAX_BASELINE_AGE_MS = 430
const BASELINE_MAX_PROGRESS = 0.15
const BASELINE_PROGRESS_SPAN = 0.045
const MAX_SAMPLE_GAP_MS = 180
const EARLY_PULL_MS = 650
const EARLY_PULL_END = 0.9
const SWING_DEGREES = 15
const MIN_SWING_MS = 100
type TrunkSample = { tilt: number; view: TrunkForm['view'] }
type TimedTrunk = { time: number; sample: TrunkSample; progress: number }

/** Side-view projection. The nose-to-ear direction gives the sign of a rearward tilt. */
export function readTrunk({ landmarks, width, height }: PoseFrame, side: Side): TrunkSample | null {
  if (!landmarks || !(width > 0 && height > 0)) return null
  const left = side === 'left'
  const shoulder = landmarks[left ? LM.leftShoulder : LM.rightShoulder]
  const farShoulder = landmarks[left ? LM.rightShoulder : LM.leftShoulder]
  const hip = landmarks[left ? LM.leftHip : LM.rightHip]
  const ear = landmarks[left ? LM.leftEar : LM.rightEar]
  const nose = landmarks[LM.nose]
  if (!inFrame(shoulder) || !inFrame(hip) || !inFrame(ear) || !inFrame(nose)) return null
  const dy = (hip.y - shoulder.y) * height
  const dx = (shoulder.x - hip.x) * width
  const torso = Math.hypot(dx, dy)
  if (dy < height * 0.07 || Math.abs(dx) > dy) return null
  const headX = (nose.x - ear.x) * width
  const headY = (nose.y - ear.y) * height
  // A frontal or oblique view can turn lateral motion into apparent lean.
  if (Math.abs(headX) < torso * 0.09 || Math.abs(headX) < Math.abs(headY) * 0.75) return null
  if (inFrame(farShoulder) && Math.abs(farShoulder.x - shoulder.x) * width > torso * 0.53) return null
  const direction = headX > 0 ? 1 : -1
  return {
    tilt: -direction * Math.atan2(dx, dy) * 180 / Math.PI,
    view: { side, direction, hipX: hip.x, hipY: hip.y, scale: torso / height },
  }
}

export function comparableTrunkView(first: TrunkForm['view'], second: TrunkForm['view']) {
  return first.side === second.side && first.direction === second.direction
    && Math.abs(first.hipX - second.hipX) <= 0.08
    && Math.abs(first.hipY - second.hipY) <= 0.08
    && Math.abs(second.scale / first.scale - 1) <= 0.2
}

export function createPulldownForm() {
  let readySamples: TimedTrunk[] = []
  return {
    reset() { readySamples = [] },
    ready(time: number, sample: TrunkSample | null, progress = 0) {
      const last = readySamples.at(-1)
      if (!sample || (last && (time - last.time > MAX_SAMPLE_GAP_MS
        || !comparableTrunkView(last.sample.view, sample.view)))) readySamples = []
      if (sample) {
        readySamples = readySamples.filter(item => time - item.time <= BASELINE_WINDOW_MS)
        readySamples.push({ time, sample, progress })
      }
    },
    start(startedAt: number) {
      // The torso may move while the elbow is still overhead. Find the last stable
      // top window before that movement instead of redefining the baseline mid-swing.
      let baseline: number | undefined
      let reference: TimedTrunk | undefined
      for (let i = readySamples.length - 1; i >= 2; i--) {
        const anchor = readySamples[i]
        if (startedAt - anchor.time > MAX_BASELINE_AGE_MS) break
        if (anchor.progress > BASELINE_MAX_PROGRESS) continue
        const window = readySamples.slice(0, i + 1).filter(point => anchor.time - point.time <= 155)
        if (window.length < 3 || anchor.time - window[0].time < 65) continue
        const progress = window.map(point => point.progress)
        if (Math.max(...progress) > BASELINE_MAX_PROGRESS || Math.max(...progress) - Math.min(...progress) > BASELINE_PROGRESS_SPAN) continue
        const angles = window.map(point => point.sample.tilt).sort((a, b) => a - b)
        if (angles.at(-1)! - angles[0] > 7) continue
        baseline = angles[Math.floor(angles.length / 2)]
        reference = anchor
        break
      }
      const preceding = readySamples
      readySamples = []
      let valid = baseline !== undefined
      const view = reference?.sample.view
      let closed = false
      let lastTime = reference?.time ?? startedAt
      let points = 0
      let aboveSince: number | null = null
      let swing = false
      let changeDeg = 0
      let atMs = 0
      function observe(time: number, sample: TrunkSample | null, progress: number) {
        if (!valid || closed || baseline === undefined) return
        if (!sample || !view || time - lastTime > MAX_SAMPLE_GAP_MS
          || !comparableTrunkView(view, sample.view)) {
          valid = false
          return
        }
        lastTime = time
        points++
        const change = sample.tilt - baseline
        if (change > changeDeg + 0.01) {
          changeDeg = change
          atMs = time - startedAt
        }
        aboveSince = change >= SWING_DEGREES ? aboveSince ?? time : null
        if (aboveSince !== null && time - aboveSince >= MIN_SWING_MS) swing = true
        closed = progress >= EARLY_PULL_END || time - startedAt >= EARLY_PULL_MS
      }
      if (reference) {
        for (const point of preceding) {
          if (point.time > reference.time && point.time < startedAt) observe(point.time, point.sample, point.progress)
        }
      }
      return {
        observe,
        finish(): TrunkForm | null {
          if (!valid || !view || points < 4 || lastTime - startedAt < 100) return null
          return { status: swing ? 'swing' : 'steady', changeDeg: Math.round(changeDeg), atMs, view }
        },
      }
    },
  }
}
