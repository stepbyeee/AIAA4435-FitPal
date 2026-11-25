import type { Landmark, PoseFrame } from '../contract'
import { visibleLimb, type Side } from '../tracking/limbLandmarks'

export type RowState = {
  count: number
  phase: 'find-extension' | 'extended' | 'contracted'
  side: Side | null
  visible: boolean
  angle: number | null
  coverage: number
}

function arm(frame: PoseFrame, side: Side) {
  const joints = visibleLimb(frame, side, 'arm')
  if (!joints) return null
  const { proximal: shoulder, joint: elbow, distal: wrist, angle } = joints
  const dx = (wrist.x - shoulder.x) * frame.width
  const dy = (wrist.y - shoulder.y) * frame.height
  const distance = (a: Landmark, b: Landmark) => Math.hypot((a.x-b.x)*frame.width,(a.y-b.y)*frame.height)
  const length = distance(shoulder,elbow) + distance(elbow,wrist)
  const elbowForward = (elbow.x - shoulder.x) * frame.width / length
  return { side, shoulder, angle, elbowForward, wristBelowShoulder: dy / length, reach: Math.abs(dx)/length, direction: Math.sign(dx),
    extended: angle >= 140 && Math.abs(dx)/length >= .55 && dy/length >= -.16,
    confidence: Math.min(shoulder.visibility,elbow.visibility,wrist.visibility) }
}

/** Side-view experiment. Lock one observed arm from forward reach to pull and return. */
export function createSeatedRow() {
  let count = 0, frames = 0, visibleFrames = 0
  let side: Side | null = null, phase: RowState['phase'] = 'find-extension'
  let previousMs = -Infinity, previousShoulder: Landmark | null = null
  let reach = 0, direction = 0, openedAt = 0, holdingSince: number | null = null
  const clear = () => {
    side = null
    phase = 'find-extension'
    holdingSince = null
    previousShoulder = null
  }
  const held = (condition: boolean, now: number) => {
    if (!condition) { holdingSince = null; return false }
    holdingSince ??= now
    return now-holdingSince >= 60
  }
  return {
    accept(frame: PoseFrame): RowState {
      const now = frame.timestampMs
      const state = (angle: number | null): RowState => ({ count, phase, side, angle, visible: angle !== null, coverage: frames ? visibleFrames/frames : 0 })
      if (!Number.isFinite(now) || now <= previousMs) { clear(); return state(null) }
      if (now-previousMs > 320) clear()
      previousMs = now
      frames++
      // Until extension is established, prefer an arm actually showing the start pose.
      const arms = side ? [arm(frame,side)] : [arm(frame,'left'),arm(frame,'right')]
      const options = arms.filter(a => a !== null)
      const observation = options.sort((a,b) => Number(b.extended)-Number(a.extended) || b.confidence-a.confidence)[0]
      if (!observation) { clear(); return state(null) }
      visibleFrames++
      const { shoulder, angle } = observation
      if (previousShoulder && Math.hypot(shoulder.x-previousShoulder.x,shoulder.y-previousShoulder.y) > .14) clear()
      previousShoulder = shoulder
      if (phase === 'find-extension') {
        if (observation.extended) side = observation.side
        else side = null
        if (held(observation.extended,now)) {
          reach = observation.reach
          direction = observation.direction
          phase = 'extended'
          openedAt = now
          holdingSince = null
        }
      } else if (phase === 'extended') {
        if (observation.extended && observation.direction === direction) {
          reach = Math.max(reach,observation.reach)
          openedAt = now
        }
        // A horizontal row finishes beside the trunk. A high cable curl can produce
        // the same elbow angle and wrist travel while the upper arm stays in front.
        const atTrunk = observation.elbowForward * direction <= .16 && observation.wristBelowShoulder >= .08
        if (held(atTrunk && angle <= 105 && reach - observation.reach >= .22,now)) {
          phase = 'contracted'
          holdingSince = null
        }
      } else if (now - openedAt > 12000) clear()
      else if (held(observation.extended && direction === observation.direction && observation.reach >= reach-.18,now)) {
        if (now-openedAt >= 500) count++
        clear()
        // The return is also the next repetition's initial forward reach.
        phase = 'extended'
        side = observation.side
        previousShoulder = shoulder
        reach = observation.reach
        direction = observation.direction
        openedAt = now
      }
      return state(angle)
    },
  }
}
