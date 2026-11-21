import { describe, expect, it } from 'vitest'
import { IN_RANGE, LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../contract'
import { createPulldown, type Calibration } from './pulldown'

const calibration: Calibration = { side: 'left', thetaTop: 160, thetaBottom: 80 }
const WIDTH = 1280
const HEIGHT = 720
const RADIUS = 120

function pose(angle: number, side: Calibration['side'], rotation = 0): Landmark[] {
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }))
  const point = (x: number, y: number) => ({ x: 0.5 + x / WIDTH, y: 0.5 + y / HEIGHT, visibility: 0.99 })
  const radians = (angle + rotation) * Math.PI / 180
  const shoulderRadians = rotation * Math.PI / 180
  landmarks[side === 'left' ? LM.leftShoulder : LM.rightShoulder] = point(
    RADIUS * Math.sin(shoulderRadians),
    -RADIUS * Math.cos(shoulderRadians),
  )
  landmarks[side === 'left' ? LM.leftElbow : LM.rightElbow] = point(0, 0)
  landmarks[side === 'left' ? LM.leftWrist : LM.rightWrist] = point(
    RADIUS * Math.sin(radians),
    -RADIUS * Math.cos(radians),
  )
  return landmarks
}

function input(initial?: Calibration) {
  const perception = createPulldown(initial)
  let timestampMs = 0
  function frame(landmarks: PoseFrame['landmarks']) {
    timestampMs += 100
    return perception.accept({ landmarks, width: WIDTH, height: HEIGHT, timestampMs })
  }
  function hold(angle: number, side: Calibration['side'] = 'left', rotation = 0) {
    return [1, 2, 3, 4].map(() => frame(pose(angle, side, rotation))).at(-1)!
  }
  function move(from: number, to: number, side: Calibration['side'] = 'left') {
    for (let step = 1; step <= 7; step++) frame(pose(from + (to - from) * step / 7, side))
  }
  function cycle(top: number, bottom: number, side: Calibration['side'] = 'left') {
    hold(top, side)
    move(top, bottom, side)
    hold(bottom, side)
    move(bottom, top, side)
    return hold(top, side)
  }
  return { ...perception, frame, hold, move, cycle }
}

describe('pulldown calibration', () => {
  it('measures a 2D elbow angle in camera pixels', () => {
    const track = input(calibration)
    const result = track.hold(120)
    expect(result.visible).toBe(true)
    expect(result.q).toBeCloseTo(0.5, 6)
  })

  it('calibrates the visible side from the median of three complete cycles', () => {
    const track = input()
    expect(track.cycle(150, 70, 'right').repCount).toBe(1)
    expect(track.cycle(156, 76, 'right').repCount).toBe(2)
    expect(track.getCalibration()).toBeNull()
    expect(track.cycle(162, 82, 'right').repCount).toBe(3)
    expect(track.getCalibration()?.side).toBe('right')
    expect(track.getCalibration()?.thetaTop).toBeCloseTo(156, 5)
    expect(track.getCalibration()?.thetaBottom).toBeCloseTo(76, 5)
  })

  it('does not let an isolated first-frame outlier set the calibration top', () => {
    const track = input()
    track.frame(pose(179, 'left'))
    expect(track.cycle(150, 70).repCount).toBe(1)
    expect(track.cycle(150, 70).repCount).toBe(2)
    expect(track.cycle(150, 70).repCount).toBe(3)
    expect(track.getCalibration()?.thetaTop).toBeCloseTo(150, 5)
  })

  it('keeps detecting one pull through a small elbow wobble near the top', () => {
    const track = input()
    track.hold(170)
    track.move(170, 151)
    track.move(151, 161)
    track.move(161, 70)
    track.hold(70)
    track.move(70, 170)
    expect(track.hold(170).repCount).toBe(1)
  })

  it('excludes an interrupted cycle from calibration progress', () => {
    const track = input()
    track.hold(160)
    track.move(160, 80)
    track.frame(null)
    track.hold(80)
    track.move(80, 160)
    expect(track.hold(160).repCount).toBe(0)
    expect(track.cycle(160, 80).repCount).toBe(1)
  })

  it('ignores a sub-rep swing and a cycle whose pull started offscreen', () => {
    const track = input()
    track.hold(80)
    track.move(80, 160)
    expect(track.hold(160).repCount).toBe(0)
    for (let i = 0; i < 3; i++) expect(track.cycle(160, 144).repCount).toBe(0)
    expect(track.getCalibration()).toBeNull()
  })
})

describe('calibrated pulldowns', () => {
  it('count the rep only after returning to the top', () => {
    const track = input(calibration)
    expect(track.hold(160).phase).toBe('ready')
    track.move(160, 80)
    expect(track.hold(80).repCount).toBe(0)
    track.move(80, 160)
    const finished = track.hold(160)
    expect(finished.phase).toBe('ready')
    expect(finished.repCount).toBe(1)
    expect(track.endSet().reps).toEqual([{
      status: 'verified', qMax: 1, durationMs: expect.any(Number),
    }])
  })

  it('waits for the wrist to approach its starting height after the elbow opens', () => {
    const track = input(calibration)
    track.hold(160)
    track.move(160, 80)
    track.hold(80)
    for (const angle of [95, 110, 125, 140, 150]) track.frame(pose(angle, 'left', 90))
    const elbowOpen = track.hold(160, 'left', 90)
    expect(elbowOpen.q).toBeCloseTo(0, 6)
    expect(elbowOpen.repCount).toBe(0)
    expect(track.hold(160).repCount).toBe(1)
  })

  it('record a visible short range separately from in-range reps', () => {
    const track = input(calibration)
    track.cycle(160, 80)
    expect(track.cycle(160, 104).repCount).toBe(2)
    const result = track.endSet()
    expect(result.reps[0].qMax).toBeGreaterThanOrEqual(IN_RANGE)
    expect(result.reps[1].qMax).toBeCloseTo(0.7, 6)
    expect(result.issues).toEqual([{ id: 'short_range', repIndexes: [1] }])
    expect(result.coverage).toBe(1)
  })

  it('invalidates a cycle with unseen frames at the turnaround', () => {
    const track = input(calibration)
    track.hold(160)
    track.move(160, 110)
    const invisible = track.frame(null)
    expect(invisible.visible).toBe(false)
    expect(invisible.repCount).toBe(0)
    track.hold(105)
    track.move(105, 160)
    expect(track.hold(160).repCount).toBe(0)
    expect(track.cycle(160, 80).repCount).toBe(1)
    const result = track.endSet()
    expect(result.reps.map((rep) => rep.status)).toEqual(['cannot_verify', 'verified'])
    expect(result.issues).toEqual([{ id: 'out_of_view', repIndexes: [0] }])
    expect(result.coverage).toBeCloseTo(52 / 53, 6)
  })

  it('keeps a visibly started attempt unverifiable if the entire return is obscured', () => {
    const track = input(calibration)
    track.hold(160)
    track.move(160, 95)
    track.hold(95)
    track.frame(null)
    track.frame(null)
    track.frame(null)
    expect(track.hold(160).repCount).toBe(0)
    expect(track.endSet().reps).toMatchObject([{ status: 'cannot_verify' }])
  })

  it('never turns idle tracking loss or a visibly unfinished pull into a rep', () => {
    const track = input(calibration)
    track.hold(160)
    track.frame(null)
    expect(track.hold(160).repCount).toBe(0)
    track.move(160, 80)
    expect(track.hold(80).repCount).toBe(0)
    track.frame(null)
    expect(track.endSet().reps).toEqual([])
    expect(track.endSet().issues).toEqual([])
  })

  it('rejects low visibility and degenerate selected arm geometry', () => {
    const track = input(calibration)
    const low = pose(160, 'left')
    low[LM.leftWrist].visibility = 0.1
    const coincident = pose(160, 'left')
    coincident[LM.leftWrist] = coincident[LM.leftElbow]
    expect(track.frame(low).visible).toBe(false)
    expect(track.frame(coincident).visible).toBe(false)
    expect(track.frame(pose(160, 'right')).visible).toBe(false)
    expect(track.endSet().coverage).toBe(0)
  })
})
