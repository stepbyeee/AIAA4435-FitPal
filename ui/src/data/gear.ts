import type { Half } from './exercises'

// Gear is what levels buy. Every level-up pays points; a half of the body opens its gear once
// that half has been trained, so the character shows where the work went.

export type GearId = 'headband' | 'tank' | 'wristbands' | 'gloves' | 'shorts' | 'kneeSleeves' | 'shoes'

export type GearItem = { id: GearId; name: string; half: Half; cost: number }

export const GEAR: GearItem[] = [
  { id: 'headband', name: '发带', half: 'upper', cost: 1 },
  { id: 'tank', name: '背心', half: 'upper', cost: 2 },
  { id: 'wristbands', name: '护腕', half: 'upper', cost: 1 },
  { id: 'gloves', name: '手套', half: 'upper', cost: 2 },
  { id: 'shorts', name: '短裤', half: 'lower', cost: 2 },
  { id: 'kneeSleeves', name: '护膝', half: 'lower', cost: 1 },
  { id: 'shoes', name: '跑鞋', half: 'lower', cost: 2 },
]

export const POINTS_PER_LEVEL = 2

/** Points paid by reaching a level. Level 1 is where everyone starts, so it pays nothing. */
export const pointsEarned = (level: number) => (level - 1) * POINTS_PER_LEVEL

export const pointsSpent = (owned: readonly GearId[]) => GEAR.filter((g) => owned.includes(g.id)).reduce((sum, g) => sum + g.cost, 0)

export const balanceOf = (level: number, owned: readonly GearId[]) => pointsEarned(level) - pointsSpent(owned)

export type GearState = 'owned' | 'locked' | 'short' | 'ok'

export function gearState(item: GearItem, owned: readonly GearId[], balance: number, trained: Record<Half, number>): GearState {
  if (owned.includes(item.id)) return 'owned'
  if (trained[item.half] <= 0) return 'locked'
  return balance >= item.cost ? 'ok' : 'short'
}

// Sample wardrobe to go with the sample history.
export const SAMPLE_GEAR: GearId[] = ['tank', 'headband']

const KEY = 'fitpal.gear.v1'

export function loadGear(): GearId[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as GearId[]
  } catch {
    // Storage can be unavailable; the sample still renders.
  }
  return SAMPLE_GEAR
}

export function saveGear(owned: GearId[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(owned))
  } catch {
    // Nothing to do: the purchase lasts for this visit only.
  }
}
