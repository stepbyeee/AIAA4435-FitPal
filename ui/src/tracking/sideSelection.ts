import type { Landmark } from '../contract'
import { limbJoints, type Limb, type Side } from './limbLandmarks'

export type SideSelection = Side | 'both'
export function parseSide(value: string | null): SideSelection {
  return value === 'left' || value === 'right' ? value : 'both'
}

/** A user-specified fixed obstruction should apply to both the displayed trail and the rep counter. */
export function selectLandmarks(points: Landmark[] | null, limb: Limb, selection: SideSelection): Landmark[] | null {
  if (!points || selection === 'both') return points
  const next = points.slice()
  for (const index of limbJoints[limb][selection === 'left' ? 'right' : 'left']) {
    if (next[index]) next[index] = { ...next[index], visibility: 0 }
  }
  return next
}
