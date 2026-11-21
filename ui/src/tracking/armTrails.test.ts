import { describe, expect, it } from 'vitest'
import { LANDMARK_COUNT, LM, type Landmark } from '../contract'
import { advanceArmTrails, emptyArmTrails } from './armTrails'

function pose(timestampMs: number, leftX = 0.25, rightX = 0.65, leftVisibility = 0.99) {
  const landmarks: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }))
  landmarks[LM.leftShoulder] = { x: 0.28, y: 0.5, visibility: 0.99 }
  landmarks[LM.leftElbow] = { x: 0.22, y: 0.62, visibility: 0.99 }
  landmarks[LM.leftWrist] = { x: leftX, y: 0.36, visibility: leftVisibility }
  landmarks[LM.rightShoulder] = { x: 0.61, y: 0.5, visibility: 0.99 }
  landmarks[LM.rightElbow] = { x: 0.69, y: 0.62, visibility: 0.99 }
  landmarks[LM.rightWrist] = { x: rightX, y: 0.36, visibility: 0.99 }
  return { landmarks, width: 1280, height: 720, timestampMs }
}

describe('live arm trails', () => {
  it('drops only the obscured side and starts it afresh on reacquisition', () => {
    const first = advanceArmTrails(emptyArmTrails, pose(100))
    const visible = advanceArmTrails(first, pose(140, 0.27, 0.67))
    expect(visible.left.map((point) => point.wrist.x)).toEqual([0.25, 0.27])
    expect(visible.right.map((point) => point.wrist.x)).toEqual([0.65, 0.67])

    const obscured = advanceArmTrails(visible, pose(180, 0.29, 0.69, 0.4))
    expect(obscured.left).toEqual([])
    expect(obscured.right.map((point) => point.wrist.x)).toEqual([0.65, 0.67, 0.69])

    const reacquired = advanceArmTrails(obscured, pose(220, 0.31, 0.71))
    expect(reacquired.left.map((point) => point.wrist.x)).toEqual([0.31])
    expect(reacquired.right).toHaveLength(4)
  })

  it('clears both trails when no body is detected', () => {
    const first = advanceArmTrails(emptyArmTrails, pose(100))
    expect(advanceArmTrails(first, { ...pose(140), landmarks: null })).toEqual(emptyArmTrails)
  })

  it('does not join a trail over a dropped frame interval or abrupt position change', () => {
    const first = advanceArmTrails(emptyArmTrails, pose(100))
    const afterGap = advanceArmTrails(first, pose(400))
    expect(afterGap.left.map((point) => point.timestampMs)).toEqual([400])
    const afterJump = advanceArmTrails(afterGap, pose(440, 0.56))
    expect(afterJump.left.map((point) => point.timestampMs)).toEqual([440])
    expect(afterJump.right.map((point) => point.timestampMs)).toEqual([400, 440])
  })

  it('keeps only a short rolling history', () => {
    let trails = emptyArmTrails
    for (let time = 0; time <= 2000; time += 40) trails = advanceArmTrails(trails, pose(time))
    expect(trails.left[0].timestampMs).toBeGreaterThanOrEqual(800)
    expect(trails.right.at(-1)?.timestampMs).toBe(2000)
  })
})
