import { describe, expect, it } from 'vitest'
import { createPulldownForm, readTrunk } from './pulldownForm'
import { LANDMARK_COUNT, LM, type PoseFrame } from '../contract'

function profile(tilt: number, direction: 1 | -1 = 1): PoseFrame {
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }))
  const place = (i: number, x: number, y: number) => { landmarks[i] = { x, y, visibility: 0.99 } }
  const radians = tilt * Math.PI / 180
  const dx = Math.sin(radians) * 0.24 * 720 / 1280
  const shoulderY = 0.66 - Math.cos(radians) * 0.24
  place(LM.rightHip, 0.50, 0.66)
  place(LM.rightShoulder, 0.50 - direction * dx, shoulderY)
  place(LM.leftShoulder, 0.51 - direction * dx, shoulderY)
  place(LM.rightEar, 0.50 - direction * dx, shoulderY - 0.09)
  place(LM.nose, 0.50 - direction * dx + direction * 0.043, shoulderY - 0.07)
  return { landmarks, timestampMs: 0, width: 1280, height: 720 }
}
function evaluate(angles: (number | null)[], startingAngle = 8, direction: 1 | -1 = 1) {
  const form = createPulldownForm()
  for (const time of [0, 50, 100, 150]) form.ready(time, readTrunk(profile(startingAngle, direction), 'right'))
  const rep = form.start(200)
  angles.forEach((angle, i) => rep.observe(200 + 50 * i, angle === null ? null : readTrunk(profile(angle, direction), 'right'), i * 0.12))
  return rep.finish()
}
describe('early pulldown trunk movement', () => {
  it('detects a sustained rearward change in a fixed side view', () => {
    expect(evaluate([11, 18, 24, 26, 26, 24, 23])).toMatchObject({ status: 'swing', changeDeg: 18, atMs: 150 })
  })
  it('makes the same assessment when horizontally mirrored', () => {
    expect(evaluate([11, 18, 24, 26, 26, 24, 23], 8, -1)?.status).toBe('swing')
  })
  it('accepts a steady leaned start and ignores an isolated pose spike', () => {
    expect(evaluate([23, 24, 43, 24, 23, 23, 24], 22)?.status).toBe('steady')
  })
  it('abstains when the hip is occluded during the departure', () => {
    expect(evaluate([11, 18, null, 26, 26, 24, 23])).toBeNull()
  })
  it('retains the stable top before visible torso movement triggers the arm counter', () => {
    const form = createPulldownForm()
    for (const [time, tilt] of [[0, 8], [67, 8], [134, 8], [201, 8], [268, 16], [335, 24]]) {
      form.ready(time, readTrunk(profile(tilt), 'right'))
    }
    const rep = form.start(402)
    for (const [time, tilt, progress] of [[402, 28, 0.25], [469, 32, 0.65], [536, 31, 0.83], [603, 31, 0.91]]) {
      rep.observe(time, readTrunk(profile(tilt), 'right'), progress)
    }
    expect(rep.finish()).toMatchObject({ status: 'swing', changeDeg: 24 })
  })
  it('rejects a front-facing frame even when the torso is visible', () => {
    const frame = profile(0)
    frame.landmarks![LM.leftShoulder].x = 0.66
    expect(readTrunk(frame, 'right')).toBeNull()
  })
  it('ignores a guessed far shoulder when the near side is clear', () => {
    const frame = profile(0)
    frame.landmarks![LM.leftShoulder] = { x: 0.66, y: 0.4, visibility: 0.03 }
    expect(readTrunk(frame, 'right')?.tilt).toBeCloseTo(0)
  })
})
