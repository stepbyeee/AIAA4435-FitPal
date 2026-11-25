import { LM, type Landmark, type PoseFrame } from '../contract'
import { inFrame } from './limbLandmarks'

const MAX_GAP_MS = 200
const STRONG_MOTION = 0.045
const legStart = LM.leftHip

/** Stabilize the on-screen pose. Each joint loses its history as soon as it leaves view. */
export function createPoseDisplay() {
  let previous: PoseFrame | null = null

  return {
    reset() { previous = null },
    update(frame: PoseFrame): Landmark[] | null {
      const last = previous
      const elapsed = last ? frame.timestampMs - last.timestampMs : 0
      const history = last && elapsed > 0 && elapsed <= MAX_GAP_MS
        && last.width === frame.width && last.height === frame.height ? last.landmarks : null
      const scale = Math.min(frame.width, frame.height)
      const landmarks = history && scale > 0
        ? frame.landmarks?.map((point, index) => {
            const anchor = history[index]
            if (!inFrame(point) || !inFrame(anchor)) return point

            const dx = point.x - anchor.x
            const dy = point.y - anchor.y
            const movement = Math.hypot(dx * frame.width, dy * frame.height) / scale
            const lowerBody = index >= legStart
            const deadband = lowerBody ? 0.006 : 0.0015
            if (movement >= STRONG_MOTION) return point
            if (movement <= deadband) return { ...point, x: anchor.x, y: anchor.y }

            const speed = movement / STRONG_MOTION
            const response = lowerBody ? 210 : 65
            const blend = 1 - Math.exp(-elapsed / (response * (1 - speed) + 12))
            return { ...point, x: anchor.x + dx * blend, y: anchor.y + dy * blend }
          }) ?? null
        : frame.landmarks
      previous = { ...frame, landmarks }
      return landmarks
    },
  }
}
