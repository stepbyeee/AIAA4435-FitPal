import { IN_RANGE, type FrameState, type Phase, type RepResult, type SetSummary } from '../contract'
import { jointsFor, landmarksFor } from '../pose'

// Stand-in for the perception module: replays a plausible set as FrameState, so the UI can be
// built and shown before pose tracking exists. Swap this file's export for the real source.

export type Source = {
  stop(): void
  endSet(): SetSummary
  /** Demo only: hide the user from the camera, or show them again. */
  toggleVisible(): void
}

type Options = {
  exerciseId: string
  setIndex: number
  targetReps: number
  /** Calibration: every rep reaches the bottom of the range, and reps go on until the caller stops. */
  fullDepth?: boolean
}

const LEAD_MS = 1200
const REP_MS = 2600

// How deep each rep goes in each set. Set 1 tires at the end, set 2 fixes it.
const DEPTHS = [
  [1, 1, 0.97, 0.95, 0.96, 0.93, 0.9, 0.8, 0.76, 0.72],
  [1, 1, 0.98, 0.97, 0.96, 0.95, 0.93, 0.92, 0.9, 0.83],
  [1, 0.99, 0.98, 0.97, 0.95, 0.94, 0.92, 0.9, 0.88, 0.86],
]

const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2

export function startMockSource(opts: Options, onFrame: (f: FrameState) => void): Source {
  const depths = DEPTHS[opts.setIndex % DEPTHS.length]
  const depthOf = (i: number) => (opts.fullDepth ? 1 : depths[i % depths.length])
  const reps: RepResult[] = []
  let visible = true
  let repSeen = true
  let frames = 0
  let seenFrames = 0
  let raf = 0
  let stopped = false
  const cap = opts.fullDepth ? Infinity : opts.targetReps
  const t0 = performance.now()

  const tick = (now: number) => {
    if (stopped) return
    const t = now - t0 - LEAD_MS
    const index = Math.floor(t / REP_MS)
    let phase: Phase = 'ready'
    let q = 0

    // Close every rep whose time has passed.
    while (reps.length < Math.min(Math.max(index, 0), cap)) {
      reps.push({ status: repSeen ? 'verified' : 'cannot_verify', qMax: depthOf(reps.length), durationMs: REP_MS })
      repSeen = visible
    }

    if (t >= 0 && index < cap) {
      const u = (t % REP_MS) / REP_MS
      const depth = depthOf(index)
      if (u < 0.42) { phase = 'pull'; q = ease(u / 0.42) * depth }
      else if (u < 0.52) { phase = 'bottom'; q = depth }
      else if (u < 0.94) { phase = 'return'; q = depth * (1 - ease((u - 0.52) / 0.42)) }
      if (!visible) repSeen = false
    }

    frames++
    if (visible) seenFrames++
    onFrame({
      phase,
      q,
      visible,
      repCount: reps.filter((r) => r.status === 'verified').length,
      landmarks: visible ? landmarksFor(jointsFor(q)) : null,
    })
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
    },
    toggleVisible() {
      visible = !visible
    },
    endSet() {
      const shallow = reps.flatMap((r, i) => (r.status === 'verified' && r.qMax < IN_RANGE ? [i] : []))
      const unseen = reps.flatMap((r, i) => (r.status === 'cannot_verify' ? [i] : []))
      const issues: SetSummary['issues'] = []
      if (shallow.length >= 2) issues.push({ id: 'short_range', repIndexes: shallow })
      if (unseen.length >= 3) issues.push({ id: 'out_of_view', repIndexes: unseen })
      return {
        exerciseId: opts.exerciseId,
        calibration: { thetaTop: 149, thetaBottom: 116 },
        reps: [...reps],
        coverage: frames ? seenFrames / frames : 1,
        issues,
      }
    },
  }
}
