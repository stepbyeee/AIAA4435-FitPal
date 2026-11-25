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

function sideViewPulldowns(torso = 0.24) {
  const track = createPulldown(calibration, { assessForm: true })
  let timestampMs = 0
  function frame(angle: number, tilt: number, hipVisible = true) {
    const landmarks = pose(angle, 'left')
    const radians = tilt * Math.PI / 180
    const shoulder = {
      x: 0.5 - Math.sin(radians) * torso * HEIGHT / WIDTH,
      y: 0.86 - Math.cos(radians) * torso,
      visibility: 0.99,
    }
    const { x, y } = landmarks[LM.leftShoulder]
    for (const i of [LM.leftShoulder, LM.leftElbow, LM.leftWrist]) {
      landmarks[i].x += shoulder.x - x
      landmarks[i].y += shoulder.y - y
    }
    landmarks[LM.rightShoulder] = { ...shoulder, x: shoulder.x + 0.01 }
    landmarks[LM.leftHip] = { x: 0.5, y: 0.86, visibility: hipVisible ? 0.99 : 0 }
    landmarks[LM.leftEar] = { ...shoulder, y: shoulder.y - 0.08 }
    landmarks[LM.nose] = { x: shoulder.x + 0.06, y: shoulder.y - 0.07, visibility: 0.99 }
    timestampMs += 50
    track.accept({ landmarks, width: WIDTH, height: HEIGHT, timestampMs })
  }
  function finish(tilt: number) {
    for (const angle of [120, 110, 100, 90, 80, 80, 80, 80, 90, 100, 110, 120, 130, 140, 150, 160, 160, 160]) frame(angle, tilt)
    const { reps } = track.endSet()
    expect(reps).toHaveLength(1)
    expect(reps[0].status).toBe('verified')
    return reps[0]
  }
  return { frame, finish }
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
  it('does not use a pre-cut torso baseline to judge an otherwise verified pull', () => {
    const { frame, finish } = sideViewPulldowns(0.55)
    for (let i = 0; i < 7; i++) frame(160, -15)
    for (const angle of [160, 160, 150, 140, 130]) frame(angle, 30)
    expect(finish(30).trunkForm).toBeUndefined()
  })

  it('assesses a sustained rearward change that peaks before the arm triggers the pull phase', () => {
    const { frame, finish } = sideViewPulldowns()
    for (let i = 0; i < 6; i++) frame(160, 8)
    for (const [angle, tilt] of [[158, 9], [154, 16], [148, 24], [145, 27], [143, 26], [140, 25], [135, 22], [128, 15]]) frame(angle, tilt)
    expect(finish(8).trunkForm).toMatchObject({ status: 'swing', changeDeg: 19, atMs: -150 })
  })

  it('does not replace a stable baseline with a leaned pose reached while the arm is descending', () => {
    const { frame, finish } = sideViewPulldowns()
    for (let i = 0; i < 7; i++) frame(160, 8)
    for (const [angle, tilt] of [[158, 18], [156, 27], [154, 28], [152, 28], [150, 28], [148, 28], [134, 28], [126, 28]]) frame(angle, tilt)
    expect(finish(28).trunkForm).toMatchObject({ status: 'swing', changeDeg: 20 })
  })

  it('abstains when the hip disappears between the ready pose and the arm trigger', () => {
    const { frame, finish } = sideViewPulldowns()
    for (let i = 0; i < 6; i++) frame(160, 8)
    for (const [angle, tilt] of [[158, 9], [154, 16], [148, 23], [146, 24]]) frame(angle, tilt)
    frame(145, 25, false)
    frame(144, 25, false)
    for (const [angle, tilt] of [[139, 28], [136, 29], [131, 31], [127, 31]]) frame(angle, tilt)
    expect(finish(31).trunkForm).toBeUndefined()
  })

  it('reports a sustained loss before a rep without inventing a rep attempt', () => {
    const track = input(calibration)
    track.hold(160)
    for (let i = 0; i < 20; i++) track.frame(null)
    expect(track.cycle(160, 80).repCount).toBe(1)
    const result = track.endSet()
    expect(result.reps.map(rep => rep.status)).toEqual(['verified'])
    expect(result.issues).toEqual([{ id: 'out_of_view', repIndexes: [] }])
  })

  it('keeps brief visibility losses separate across a pause', () => {
    const track = createPulldown(calibration)
    for (const timestampMs of [0, 300, 600, 2400, 2700, 3000]) {
      track.accept({ landmarks: null, width: WIDTH, height: HEIGHT, timestampMs })
    }
    expect(track.endSet().issues).toEqual([])
  })

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

describe('in-session rep evidence', () => {
  it('ties each trace to the recorded attempt, including a camera gap', () => {
    const track = input(calibration)
    track.hold(160)
    track.move(160, 110)
    track.frame(null)
    track.hold(105)
    track.move(105, 160)
    track.hold(160)
    track.cycle(160, 104)
    track.move(160, 80) // A final incomplete descent has no recorded result.
    const { side, traces } = track.getRepReview()
    expect(side).toBe('left')
    expect(traces.map(trace => trace.repIndex)).toEqual([0, 1])
    expect(traces[0].samples.slice(1).some(sample => sample.breakBefore)).toBe(true)
    expect(traces[0].bottom).toBeNull()
    expect(traces[1].samples.slice(1).some(sample => sample.breakBefore)).toBe(false)
    expect(traces[1].bottom?.angle).toBeCloseTo(104, 4)
    expect(traces[1].samples.at(-1)?.ms).toBe(track.endSet().reps[1].durationMs)
    expect(JSON.stringify(track.endSet())).not.toContain('samples')
  })

  it('keeps only the last 32 detailed traces without renumbering or removing rep results', () => {
    const track = input(calibration)
    for (let i = 0; i < 35; i++) track.cycle(160, 80)
    expect(track.endSet().reps).toHaveLength(35)
    expect(track.getRepReview().traces).toHaveLength(32)
    expect(track.getRepReview().traces[0].repIndex).toBe(3)
    expect(track.getRepReview().traces.at(-1)?.repIndex).toBe(34)
  })
})

it('withholds a pull assembled across an abrupt change of shoulder location', () => {
  const track = input(calibration)
  track.hold(160)
  track.move(160, 80)
  track.hold(80)
  for (const angle of [82,90,104,124,144,158,160,160,160,160]) {
    track.frame(pose(angle,'left').map(p => ({ ...p, x:p.x + .22 })))
  }
  const rep = track.endSet().reps[0]
  expect(rep?.status).toBe('cannot_verify')
  expect(track.getRepReview().traces[0].samples.some(p => p.breakBefore)).toBe(true)
})

function croppedPose(elevation: number): Landmark[] {
  const p = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }))
  const radians = elevation * Math.PI / 180
  const shoulder = { x: 0.45, y: 0.30, visibility: 0.99 }
  const elbow = {
    x: shoulder.x + 0.23 * Math.sin(radians) * HEIGHT / WIDTH,
    y: shoulder.y + 0.23 * Math.cos(radians),
    visibility: 0.99,
  }
  p[LM.leftShoulder] = shoulder
  p[LM.leftElbow] = elbow
  p[LM.leftWrist] = { x: elbow.x + 0.06, y: elevation >= 115 ? -0.04 : elbow.y - 0.2, visibility: 0.97 }
  return p
}

describe('repeated overhead wrist crop', () => {
  const cycle = [145, 145, 145, 120, 90, 65, 48, 48, 48, 68, 95, 118, 135, 145, 145]
  const consume = (track: ReturnType<typeof input>, elevations: number[]) => {
    for (const angle of elevations) track.frame(croppedPose(angle))
  }
  const upper: Calibration = { side: 'left', basis: 'upper-arm', thetaTop: 145, thetaBottom: 48 }

  it('calibrates with observed upper-arm elevation and counts without producing an elbow ROM grade', () => {
    const calibrating = input()
    for (let i = 0; i < 3; i++) consume(calibrating, cycle)
    const calibration = calibrating.getCalibration()!
    expect(calibration).toMatchObject({ side: 'left', basis: 'upper-arm' })
    expect(calibration.thetaTop).toBeCloseTo(145)
    expect(calibration.thetaBottom).toBeCloseTo(48)
    const live = input(calibration)
    consume(live, cycle)
    expect(live.endSet()).toMatchObject({ calibration: { basis: 'upper-arm' }, issues: [],
      reps: [{ status: 'verified', qMax: null }] })
  })

  it('cannot complete a crop-mode rep across a bilateral tracking gap or a suppressed upper arm', () => {
    for (const gap of [null, croppedPose(48)]) {
      if (gap) gap[LM.leftElbow].visibility = 0
      const live = input(upper)
      consume(live, cycle.slice(0, 9))
      expect(live.frame(gap).visible).toBe(false)
      consume(live, cycle.slice(9))
      expect(live.endSet().reps).toHaveLength(0)
      consume(live, cycle)
      expect(live.endSet().reps).toHaveLength(1)
    }
  })

  it('requires a directly observed flexed wrist on the lowered side', () => {
    const live = input(upper)
    for (const angle of cycle) {
      const p = croppedPose(angle)
      if (angle < 115) p[LM.leftWrist].visibility = 0
      live.frame(p)
    }
    expect(live.endSet().reps).toHaveLength(0)
  })

  it('ignores a partial return and an unfinished last descent', () => {
    const live = input(upper)
    consume(live, [...cycle.slice(0, 10), 96, 102, 102, 96, 70, 50])
    expect(live.endSet().reps).toHaveLength(0)
  })
})

describe('top recovery', () => {
  function reacquire(firstVisibleAngle: number) {
    const track = createPulldown()
    let timestampMs = 0
    for (const angle of [160, 160, 160, 160, null, firstVisibleAngle, 142, 130, 112, 96,
      80, 80, 80, 84, 94, 114, 135, 148, 156, 160, 160]) {
      timestampMs += 1000 / 15
      track.accept({ landmarks: angle === null ? null : pose(angle, 'left'), timestampMs, width: WIDTH, height: HEIGHT })
    }
    return track
  }

  it('re-arms only when the same top is directly visible again after a brief idle gap', () => {
    const recovered = reacquire(156)
    const phase = recovered.accept({ landmarks: pose(160, 'left'), timestampMs: 1550, width: WIDTH, height: HEIGHT })
    expect(phase.repCount).toBe(1)
    const displaced = reacquire(142)
    const rejected = displaced.accept({ landmarks: pose(160, 'left'), timestampMs: 1550, width: WIDTH, height: HEIGHT })
    expect(rejected.repCount).toBe(0)
  })

  it('accepts modest visible endpoint variation and rejects an incomplete return below that band', () => {
    const track = input(calibration)
    track.hold(160)
    track.move(160, 80)
    track.hold(80)
    track.move(80, 135)
    expect(track.hold(135).repCount).toBe(0)
    track.move(135, 145)
    expect(track.hold(145).repCount).toBe(1)
  })
})

/** A projected arm with shoulder fixed and forearm bending toward the athlete on descent. */
function overheadPose(flexion: number, zoom = 1): Landmark[] {
  const p = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }))
  const shoulder = { x: 0.45, y: 0.58, visibility: 0.99 }
  const elevation = 50 + 0.95 * (flexion - 65)
  const segment = (start: Landmark, heading: number): Landmark => {
    const radians = heading * Math.PI / 180
    const length = 0.14 * zoom
    return { x: start.x + length * Math.sin(radians) * HEIGHT / WIDTH,
      y: start.y + length * Math.cos(radians), visibility: 0.99 }
  }
  const elbow = segment(shoulder, elevation)
  p[LM.leftShoulder] = shoulder
  p[LM.leftElbow] = elbow
  p[LM.leftWrist] = segment(elbow, elevation + 180 - flexion)
  return p
}

describe('pulldown with continuously moving overhead turns', () => {
  const stroke = [139, 115, 92, 74, 62, 71, 92, 119, 144, 156]

  it('calibrates on physically raised extended arms without stationary top holds', () => {
    const track = input()
    for (const angle of [80, 95, 116, 137, 151, 156, ...stroke, ...stroke, ...stroke]) {
      track.frame(overheadPose(angle))
    }
    expect(track.getCalibration()?.side).toBe('left')
    expect(track.getCalibration()?.thetaBottom).toBeLessThan(90)
  })

  it('confirms a full return when camera zoom changes projected arm length', () => {
    const track = input(calibration)
    for (const angle of [160, 160, 160, 160, 140, 119, 94, 80, 70]) track.frame(overheadPose(angle, 1.3))
    for (const angle of [73, 82, 96, 115, 135, 150, 158, 158, 158]) track.frame(overheadPose(angle, 0.75))
    expect(track.endSet().reps).toMatchObject([{ status: 'verified', qMax: 1 }])
  })

  it('ignores overhead grip adjustments and consecutive low half-pulls', () => {
    const track = input(calibration)
    for (const angle of [158, 154, 160, 154, 159, 151, 158, 153, 160, 140, 120, 95, 72,
      82, 96, 112, 119, 104, 83, 70, 81, 96, 115, 118]) track.frame(overheadPose(angle))
    expect(track.endSet().reps).toHaveLength(0)
  })

  it('never assembles an overhead return across a missing person', () => {
    const track = input(calibration)
    for (const angle of [160, 160, 160, 155, 138, 116, 97, 78, 68]) track.frame(overheadPose(angle))
    track.frame(null)
    for (const angle of [82, 98, 119, 138, 154, 160, 160]) track.frame(overheadPose(angle))
    expect(track.endSet().reps.filter(rep => rep.status === 'verified')).toHaveLength(0)
  })
})
