// The character's joints. Arms are solved from where the hands are, so one number, q,
// poses the whole pull.

export type Pt = { x: number; y: number }
export type Side = -1 | 1
/** One value per side: [image left, image right]. */
export type Pair<T> = [T, T]

const UPPER = 88
const FORE = 82
const BAR_TOP = 42
const BAR_BOTTOM = 178

function solveArm(s: Pt, target: Pt, bend: 'down' | 'out', side: Side) {
  const angle = Math.atan2(target.y - s.y, target.x - s.x)
  const reach = Math.min(Math.max(Math.hypot(target.x - s.x, target.y - s.y), Math.abs(UPPER - FORE) + 1), UPPER + FORE - 1)
  const hand = { x: s.x + reach * Math.cos(angle), y: s.y + reach * Math.sin(angle) }
  const a = Math.acos((UPPER * UPPER + reach * reach - FORE * FORE) / (2 * UPPER * reach))
  const c1 = { x: s.x + UPPER * Math.cos(angle + a), y: s.y + UPPER * Math.sin(angle + a) }
  const c2 = { x: s.x + UPPER * Math.cos(angle - a), y: s.y + UPPER * Math.sin(angle - a) }
  const elbow = bend === 'down' ? (c1.y > c2.y ? c1 : c2) : (c1.x - s.x) * side > (c2.x - s.x) * side ? c1 : c2
  return { elbow, hand }
}

export type Joints = {
  head: Pt
  headRadius: number
  shoulder: Pair<Pt>
  elbow: Pair<Pt>
  hand: Pair<Pt>
  hip: Pair<Pt>
  knee: Pair<Pt>
  ankle: Pair<Pt>
  toe: Pair<Pt>
  /** Height of the bar while pulling, null at rest. */
  barY: number | null
}

const pair = <T>(f: (side: Side) => T): Pair<T> => [f(-1), f(1)]

/** q from 0 to 1 pulls the bar from the top of the range to the bottom; null stands at rest. */
export function jointsFor(q: number | null): Joints {
  const barY = q === null ? null : BAR_TOP + (BAR_BOTTOM - BAR_TOP) * q
  const shoulder = pair((side) => ({ x: 200 + side * 62, y: 200 }))
  const arms = pair((side) => {
    const s = shoulder[side === -1 ? 0 : 1]
    const target = barY === null ? { x: s.x + side * 34, y: s.y + 152 } : { x: 200 + side * 118, y: barY }
    return solveArm(s, target, barY === null ? 'out' : 'down', side)
  })
  return {
    head: { x: 200, y: 100 },
    headRadius: 52,
    shoulder,
    elbow: [arms[0].elbow, arms[1].elbow],
    hand: [arms[0].hand, arms[1].hand],
    hip: pair((side) => ({ x: 200 + side * 30, y: 384 })),
    knee: pair((side) => ({ x: 200 + side * 37.5, y: 486 })),
    ankle: pair((side) => ({ x: 200 + side * 40, y: 586 })),
    toe: pair((side) => ({ x: 200 + side * 64, y: 602 })),
    barY,
  }
}
