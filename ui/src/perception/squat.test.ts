import { describe, expect, it } from 'vitest'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../contract'
import { createSquat, visibleLeg, type SquatCalibration, type LegSide } from './squat'

const fixed: SquatCalibration = { side: 'left', thetaTop: 170, thetaBottom: 90 }
const width = 1280
const height = 720
function pose(angle: number, side: LegSide = 'left', limbScale = 1): Landmark[] {
  const legs = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }))
  const point = (x: number, y: number) => ({ x: 0.5 + x / width, y: 0.85 + y / height, visibility: 0.99 })
  const bend = (180 - angle) / 2 * Math.PI / 180
  const reach = 135 * limbScale * Math.cos(bend)
  const indices = side === 'left' ? [LM.leftHip, LM.leftKnee, LM.leftAnkle] : [LM.rightHip, LM.rightKnee, LM.rightAnkle]
  legs[indices[0]] = point(0, -2 * reach)
  legs[indices[1]] = point(135 * limbScale * Math.sin(bend), -reach)
  legs[indices[2]] = point(0, 0)
  return legs
}

function harness(initial?: SquatCalibration, side: LegSide = 'left') {
  const detector = createSquat(initial)
  let timestampMs = 0
  const send = (landmarks: PoseFrame['landmarks'], dt = 80) => {
    timestampMs += dt
    return detector.accept({ landmarks, width, height, timestampMs })
  }
  const hold = (angle: number) => { for (let j = 0; j < 4; j++) send(pose(angle, side)) }
  const move = (a: number, b: number) => { for (let i = 1; i <= 8; i++) send(pose(a + (b - a) * i / 8, side)) }
  const cycle = (bottom = 90) => { hold(170); move(170, bottom); hold(bottom); move(bottom, 170); hold(170) }
  return { detector, send, hold, move, cycle }
}

describe('squat perception', () => {
  it.each([false, true])('does not combine calibration cycles across a camera cut (gap: %s)', gap => {
    const h=harness();h.cycle();h.cycle()
    if (gap) h.send(null)
    const cycle=()=>{for(const a of [170,170,170,170,155,140,125,110,95,80,80,80,95,110,125,140,155,170,170,170]){
      const p=pose(a);for(const point of p)point.x+=0.26;h.send(p)
    }}
    cycle();expect(h.detector.getCalibration()).toBeNull()
    cycle();expect(h.detector.getCalibration()).toBeNull()
    cycle();expect(h.detector.getCalibration()).not.toBeNull()
  })
  it('measures a pixel-correct knee angle and rejects out-of-frame or collapsed geometry', () => {
    const sample = (landmarks: Landmark[]) => visibleLeg({ landmarks, width, height, timestampMs: 0 }, 'left')
    const points = pose(115)
    expect(sample(points)?.angle).toBeCloseTo(115)
    points[LM.leftHip].x = 1.15
    expect(sample(points)).toBeNull()
    expect(sample(pose(90, 'left', 0.001))).toBeNull()
  })

  it('calibrates from three complete cycles on the same visible side', () => {
    const h = harness(undefined, 'right')
    h.hold(90); h.move(90, 170)
    h.cycle(80); h.cycle(90)
    expect(h.detector.getCalibration()).toBeNull()
    h.cycle(100)
    const result = h.detector.getCalibration()
    expect(result?.side).toBe('right')
    expect(result?.thetaTop).toBeCloseTo(170)
    expect(result?.thetaBottom).toBeCloseTo(90)
    expect(h.detector.endSet().reps).toEqual([])
  })

  it('requires a return to standing and distinguishes short, visible reps', () => {
    const h = harness(fixed)
    h.cycle(); h.cycle(120)
    h.move(170, 85); h.hold(85)
    const summary = h.detector.endSet()
    expect(summary.exerciseId).toBe('squat')
    expect(summary.reps.map((r) => r.status)).toEqual(['verified', 'verified'])
    expect(summary.reps[1].qMax).toBeCloseTo(0.625)
    expect(summary.issues).toEqual([{ id: 'short_range', repIndexes: [1] }])
  })

  it('abstains after occlusion or a dropped sequence without switching legs mid-rep', () => {
    const h = harness(fixed)
    h.hold(170); h.move(170, 90); h.send(pose(90, 'right')); h.move(90, 170); h.hold(170)
    h.move(170, 90); h.send(pose(90), 950); h.move(90, 170); h.hold(170)
    h.cycle()
    const summary = h.detector.endSet()
    expect(summary.reps.map((r) => r.status)).toEqual(['cannot_verify', 'cannot_verify', 'verified'])
    expect(summary.issues).toEqual([{ id: 'out_of_view', repIndexes: [0, 1] }])
    const { traces } = h.detector.getRepReview()
    expect(traces.map(t => t.repIndex)).toEqual([0, 1, 2])
    expect(traces.filter(t => t.bottom === null)).toHaveLength(2)
    expect(traces[2].bottom?.angle).toBeCloseTo(90)
    expect(traces[2].bottom?.y).toBeCloseTo(-2 * 135 * Math.cos(Math.PI / 4) / height, 4)
    expect(traces[0].samples.at(-1)!.ms).toBeLessThan(1800)
  })

  it('breaks an attempt across a camera cut even when both views contain valid legs', () => {
    const h = harness(fixed)
    h.hold(170); h.move(170, 90); h.hold(90)
    const changed = pose(170)
    for (const point of changed) point.x += 0.26
    h.send(changed); h.send(changed); h.send(changed)
    expect(h.detector.endSet().reps.map(r => r.status)).toEqual(['cannot_verify'])
    expect(h.detector.getRepReview().traces[0].bottom).toBeNull()
  })

  it('does not credit repeated bottom pulses or a stationary person', () => {
    const h = harness(fixed)
    h.hold(95)
    for (let i = 0; i < 4; i++) { h.move(95, 130); h.move(130, 95) }
    h.move(95, 170); h.hold(170)
    for (let i = 0; i < 5; i++) h.cycle(163)
    expect(h.detector.endSet().reps).toEqual([])
  })
})
