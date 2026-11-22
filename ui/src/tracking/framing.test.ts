import { describe, expect, it } from 'vitest'
import { LM, type PoseFrame } from '../contract'
import { describeFraming } from './framing'

const point = (x: number, y: number) => ({ x, y, visibility: 1 })
const sample = (): PoseFrame => {
  const landmarks = Array.from({ length: 33 }, () => point(.5, .5))
  for (const wrist of [LM.leftWrist, LM.rightWrist]) landmarks[wrist] = point(.45, .2)
  for (const shoulder of [LM.leftShoulder, LM.rightShoulder]) landmarks[shoulder] = point(.55, .7)
  return { landmarks, width: 640, height: 480, timestampMs: 0 }
}
describe('camera framing guidance', () => {
  it('accepts one usable side and names a wrist outside the top edge', () => {
    const frame = sample()
    frame.landmarks![LM.rightWrist].y = -.12
    expect(describeFraming(frame)).toEqual({ left: '可用于校准', right: '手腕出框' })
  })
  it('distinguishes a low confidence elbow, a missing person and overlapping joints', () => {
    const frame = sample()
    frame.landmarks![LM.leftElbow].visibility = .2
    frame.landmarks![LM.rightWrist] = point(.5, .5)
    expect(describeFraming(frame)).toEqual({ left: '手肘未看清', right: '关节投影重叠' })
    expect(describeFraming({ ...frame, landmarks: null })).toEqual({ left: '等待入镜', right: '等待入镜' })
  })
})
