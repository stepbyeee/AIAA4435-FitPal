import type { SessionRecord } from './history'

export const cosmetics = [
  { id: 'cap', name: '紫罗兰球帽' },
  { id: 'bag', name: '琥珀腰包' },
  { id: 'headphones', name: '冰蓝耳机' },
  { id: 'patch', name: '星形徽章' },
] as const
export type CosmeticId = typeof cosmetics[number]['id']
export type Collection = { claimedDays: string[]; owned: CosmeticId[]; equipped: CosmeticId | null }
export type CollectionChoice = { type: 'check-in' } | { type: 'draw' } | { type: 'equip'; id: CosmeticId | null }

export const emptyCollection = (): Collection => ({ claimedDays: [], owned: [], equipped: null })
const isItem = (value: unknown): value is CosmeticId => cosmetics.some(item => item.id === value)

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false
  const parsed = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function normalizeCollection(value: unknown): Collection {
  if (!value || typeof value !== 'object') return emptyCollection()
  const item = value as Partial<Collection>
  const owned = Array.isArray(item.owned) ? [...new Set(item.owned.filter(isItem))] : []
  return {
    claimedDays: Array.isArray(item.claimedDays) ? [...new Set(item.claimedDays.filter(isDate))] : [],
    owned, equipped: isItem(item.equipped) && owned.includes(item.equipped) ? item.equipped : null,
  }
}

export function ticketTotals(state: Collection, history: SessionRecord[]) {
  // The v3 history contains finished camera sessions. Demos and classroom trials do not write to it.
  const training = Array.isArray(history) ? history.filter(session =>
    Array.isArray(session?.sets) && session.sets.some(s => Number.isInteger(s?.verified) && s.verified > 0),
  ).length : 0
  const earned = state.claimedDays.length + training
  return { earned, spent: state.owned.length, available: Math.max(0, earned - state.owned.length) }
}

export function applyChoice(state: Collection, choice: CollectionChoice, date: string, history: SessionRecord[], random = Math.random): Collection {
  switch (choice.type) {
    case 'check-in':
      return isDate(date) && !state.claimedDays.includes(date) ? { ...state, claimedDays: [...state.claimedDays, date] } : state
    case 'equip':
      return choice.id === null || state.owned.includes(choice.id) ? { ...state, equipped: choice.id } : state
    case 'draw': {
      const available = cosmetics.filter(item => !state.owned.includes(item.id))
      if (!available.length || ticketTotals(state, history).available === 0) return state
      const item = available[Math.floor(random() * available.length)]
      return { ...state, owned: [...state.owned, item.id] }
    }
  }
}
