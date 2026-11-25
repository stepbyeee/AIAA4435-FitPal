import { describe, expect, it } from 'vitest'
import { LANDMARK_COUNT, LM, type PoseFrame } from '../contract'
import { advanceLiveMotion, emptyLiveMotion } from './liveMotion'
import { createPoseDisplay } from './poseDisplay'

function frame(timestampMs: number, knee = 0.5, wrist = 0.32, visibility = 1): PoseFrame {
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, visibility: 0 }))
  landmarks[LM.leftKnee] = { x: knee, y: 0.68, visibility: 1 }
  landmarks[LM.leftShoulder] = { x: 0.52, y: 0.27, visibility: 1 }
  landmarks[LM.leftElbow] = { x: 0.42, y: 0.35, visibility: 1 }
  landmarks[LM.leftWrist] = { x: wrist, y: 0.45, visibility }
  return { timestampMs, width: 640, height: 640, landmarks }
}

describe('live pose display', () => {
  it('holds a planted knee through small landmark fluctuations without changing the input', () => {
    const display = createPoseDisplay()
    display.update(frame(0))
    for (let i = 1; i <= 20; i++) {
      const knee = 0.5 + (i % 2 === 0 ? -0.005 : 0.005)
      const sample = frame(i * 33, knee)
      expect(display.update(sample)![LM.leftKnee].x).toBe(0.5)
      expect(sample.landmarks![LM.leftKnee].x).toBe(knee)
    }
  })

  it('follows deliberate motion on both an arm and a leg', () => {
    const display = createPoseDisplay()
    display.update(frame(0))
    const points = display.update(frame(33, 0.56, 0.39))!
    expect(points[LM.leftWrist].x).toBeGreaterThan(0.376)
    expect(points[LM.leftKnee].x).toBeGreaterThan(0.548)
  })

  it('boots from the fresh landmark after occlusion, a cut, or a seek', () => {
    const display = createPoseDisplay()
    display.update(frame(0))
    expect(display.update(frame(33, 0.5, 0.35, 0.2))![LM.leftWrist].visibility).toBe(0.2)
    expect(display.update(frame(66, 0.5, 0.35))![LM.leftWrist].x).toBe(0.35)
    expect(display.update(frame(400, 0.505, 0.36))![LM.leftKnee].x).toBe(0.505)
    expect(display.update(frame(33, 0.51))![LM.leftKnee].x).toBe(0.51)
    display.reset()
    expect(display.update(frame(66, 0.509))![LM.leftKnee].x).toBe(0.509)
  })

  it('draws the filtered trail while preserving the raw angle and breaking immediately on loss or a jump', () => {
    const display = createPoseDisplay()
    const first = frame(0)
    const previous = advanceLiveMotion(emptyLiveMotion, first, 'arm', display.update(first))
    const sample = frame(33, 0.51, 0.326)
    const motion = advanceLiveMotion(previous, sample, 'arm', display.update(sample))
    const point = motion.trails.left.at(-1)!
    const raw = advanceLiveMotion(previous, sample).trails.left.at(-1)!
    expect(point.draw?.distal.x).toBeLessThan(raw.distal.x)
    expect(point.angle).toBe(raw.angle)
    const hidden = frame(66, 0.51, 0.33, 0.4)
    expect(advanceLiveMotion(motion, hidden, 'arm', display.update(hidden)).trails.left).toHaveLength(0)
    const jump = frame(66, 0.51, 0.7)
    expect(advanceLiveMotion(motion, jump, 'arm', display.update(jump)).trails.left).toHaveLength(1)
  })
})
