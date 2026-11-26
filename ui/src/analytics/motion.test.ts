import { expect, it } from 'vitest'
import { analyzeRep, summarizeMotion, compareMotion, createMotionRecorder, type MotionSample } from './motion'
import { recordAttempt, type RepTrace } from '../perception/repReview'
import { LM, type RepResult } from '../contract'

const rep: RepResult = { status: 'verified', qMax: 1, durationMs: 2000 }
function evidence(start = 5000): RepTrace {
  const recorder = recordAttempt(start)
  for (let i = 0; i <= 20; i++) recorder.observe(start + i * 100, 160 - 10 * Math.min(i, 20 - i), { x: 0, y: i / 100 }, i <= 10)
  return recorder.finish(0, true)
}
function pair(delay = 0): MotionSample[] {
  return Array.from({ length: 21 }, (_, i) => {
    const atMs = 5000 + i * 100
    const angle = (time: number) => 160 - Math.max(0, 100 - Math.abs(time - 6000) / 10)
    return { atMs, left: angle(atMs), right: angle(atMs - delay), frontal: true, view: { x: .5, y: .4, scale: .3 } }
  })
}

it('preserves source timestamps and measures observed timing and excursion', () => {
  const trace = evidence()
  expect(trace.startedAtMs).toBe(5000)
  expect(analyzeRep(rep, trace, pair())).toMatchObject({ repIndex: 0, sourceStartMs: 5000, durationMs: 2000, outboundMs: 1000, returnMs: 1000, minAngle: 60, maxAngle: 160, excursionDeg: 100, bilateralLagMs: 0 })
})

it('measures a paired delay without inventing a quality grade', () => {
  const result = analyzeRep(rep, evidence(), pair(200))
  expect(result.bilateralLagMs).toBeCloseTo(200, 0)
  expect(result).not.toHaveProperty('score')
})

it('withholds timing across a gap and bilateral comparison through occlusion', () => {
  const trace = evidence()
  const samples = trace.samples.map((s, i) => ({ ...s, breakBefore: i === 8 }))
  expect(analyzeRep({ ...rep, status: 'cannot_verify' }, { ...trace, samples }, pair()).returnMs).toBeNull()
  const occluded = pair().map((s, i) => ({ ...s, right: i > 4 && i < 13 ? null : s.right }))
  expect(analyzeRep(rep, trace, occluded).bilateralLagMs).toBeNull()
})

it('does not compare a side view or nearly stationary limbs', () => {
  expect(analyzeRep(rep, evidence(), pair().map(s => ({ ...s, frontal: false }))).bilateralLagMs).toBeNull()
  expect(analyzeRep(rep, evidence(), pair().map(s => ({ ...s, right: 150 }))).bilateralLagMs).toBeNull()
})

it('withholds a turn-and-return even when the start and end view match', () => {
  const turning = pair().map((s, i) => ({ ...s, view: { ...s.view!, orientation: i > 5 && i < 15 ? 1.2 : .6 } }))
  expect(analyzeRep(rep, evidence(), turning).bilateralLagMs).toBeNull()
})

it('does not mistake a noisy outbound midpoint recrossing for the return', () => {
  const trace = recordAttempt(5000)
  const observations = Array.from({ length: 361 }, (_, i) => {
    const ms = i * 6000 / 360
    const angle = 160 - 100 * (1 - Math.abs(ms - 3000) / 3000)
    const left = i === 92 ? 111 : angle
    trace.observe(5000 + ms, left, { x: 0, y: left / 180 }, ms <= 3000)
    return { atMs: 5000 + ms, left, right: angle, frontal: true, view: { x: .5, y: .4, scale: .3, orientation: .8 } }
  })
  const result = analyzeRep({ ...rep, durationMs: 6000 }, trace.finish(0, true), observations)
  expect(result.bilateralLagMs).toBe(0)
})

it('does not connect a long sample gap even when other samples are visible', () => {
  expect(analyzeRep(rep, evidence(), pair().filter(s => s.atMs < 5500 || s.atMs > 5900)).bilateralLagMs).toBeNull()
})

it('withholds timing when a counted rep has too few temporal observations', () => {
  const trace = evidence()
  expect(analyzeRep(rep, { ...trace, samples: trace.samples.filter((_, i) => i % 5 === 0) }, pair()).returnMs).toBeNull()
})

it('summarizes only measured reps and refuses noncomparable views', () => {
  const metric = analyzeRep(rep, evidence(), pair())
  const first = summarizeMotion([metric, metric, metric], 1, { x: .5, y: .4, scale: .3 })
  expect(first.measuredReps).toBe(3)
  expect(first.returnVariation).toBe(0)
  expect(compareMotion(first, { ...first, view: { x: .7, y: .4, scale: .3 } }).comparable).toBe(false)
  expect(compareMotion(first, { ...first, coverage: .4 }).comparable).toBe(false)
  expect(compareMotion(first, first).comparable).toBe(true)
})

it('keeps the recorder bounded and ignores duplicate timestamps', () => {
  const recorder = createMotionRecorder('arm')
  for (let timestampMs = 0; timestampMs <= 1000000; timestampMs += 100) recorder.observe({ timestampMs, width: 640, height: 480, landmarks: null })
  const before = recorder.samples.length
  recorder.observe({ timestampMs: 1000000, width: 640, height: 480, landmarks: null })
  expect(recorder.samples.length).toBe(before)
  expect(before).toBeLessThanOrEqual(9600)
})

it('holds the last angular-rate sample between display updates and clears it on occlusion', () => {
  const recorder = createMotionRecorder('arm')
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }))
  landmarks[LM.leftShoulder] = { x: .3, y: .3, visibility: 1 }
  landmarks[LM.leftElbow] = { x: .3, y: .5, visibility: 1 }
  landmarks[LM.leftWrist] = { x: .5, y: .5, visibility: 1 }
  const frame = (timestampMs: number) => ({ landmarks, width: 640, height: 480, timestampMs })
  recorder.observe(frame(0)); recorder.observe(frame(100))
  expect(recorder.live.leftSpeed).toBe(0)
  recorder.observe(frame(120))
  expect(recorder.live.leftSpeed).toBe(0)
  recorder.observe({ ...frame(130), landmarks: null })
  expect(recorder.live.leftSpeed).toBeNull()
})

it('retains compact metrics when older detailed traces have been evicted', () => {
  const recorder = createMotionRecorder('arm')
  const summary = { exerciseId: 'lat-pulldown', calibration: { thetaTop: 160, thetaBottom: 60 }, reps: [rep], coverage: 1, issues: [] }
  recorder.capture(summary, { side: 'left', traces: [evidence()] })
  expect(recorder.finish(summary, { side: 'left', traces: [] }).summary.measuredReps).toBe(1)
})

it('compares views at neutral frames and rejects a changed orientation', () => {
  const recorder = createMotionRecorder('leg')
  const frame = (timestampMs: number, lowered: number) => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }))
    landmarks[LM.leftShoulder] = { x: .4, y: .2 + lowered, visibility: 1 }
    landmarks[LM.rightShoulder] = { x: .6, y: .2 + lowered, visibility: 1 }
    landmarks[LM.leftHip] = { x: .4, y: .5 + lowered, visibility: 1 }
    return { landmarks, width: 640, height: 480, timestampMs }
  }
  recorder.observe(frame(0, 0), true)
  recorder.observe(frame(1000, .25), false)
  recorder.observe(frame(2000, 0), true)
  const summary = { exerciseId: 'squat', calibration: { thetaTop: 160, thetaBottom: 60 }, reps: [rep], coverage: 1, issues: [] }
  expect(recorder.finish(summary, { side: 'left', traces: [] }).summary.view).not.toBeNull()
  const metric = analyzeRep(rep, evidence(), pair())
  const base = summarizeMotion([metric, metric, metric], 1, { x: .5, y: .4, scale: .3, orientation: .8 })
  expect(compareMotion(base, { ...base, view: { x: .5, y: .4, scale: .3, orientation: .1 } }).comparable).toBe(false)
})
