import type { Side } from '../tracking/limbLandmarks'

/** Local to the set review. These points never enter SetSummary or session history. */
export type ReviewSample = {
  ms: number
  angle: number
  /** Tracked joint relative to its anchor (wrist/shoulder or hip/ankle), in frame heights. */
  x: number
  y: number
  breakBefore: boolean
}

export type RepTrace = {
  repIndex: number
  samples: readonly ReviewSample[]
  bottom: ReviewSample | null
}

export type RepReviewData = { side: Side; traces: readonly RepTrace[] }

export const MAX_REVIEW_REPS = 32
const BIN_MS = 100

export function recordAttempt(startedAt: number) {
  const samples: ReviewSample[] = []
  let bottom: ReviewSample | null = null
  let last: ReviewSample | null = null
  let interrupted = false

  return {
    gap() { interrupted = true },
    observe(time: number, angle: number, position: { x: number; y: number }, descending: boolean) {
      const point: ReviewSample = { ms: time - startedAt, angle, ...position, breakBefore: interrupted }
      const previous = samples.at(-1)
      if (!previous || Math.floor(previous.ms / BIN_MS) !== Math.floor(point.ms / BIN_MS)) {
        samples.push(point)
      } else if (interrupted || angle < previous.angle) {
        // Keep the angle extremum in each 100-ms bin. If tracking restarted in
        // this bin, retain only its latest segment, never bridging unseen motion.
        samples[samples.length - 1] = { ...point, breakBefore: interrupted || previous.breakBefore }
      }
      if (descending && (!bottom || angle < bottom.angle)) bottom = point
      last = point
      interrupted = false
    },
    finish(repIndex: number, verified: boolean): RepTrace {
      if (last && samples.at(-1)?.ms !== last.ms) samples.push(last)
      return { repIndex, samples, bottom: verified ? bottom : null }
    },
  }
}
