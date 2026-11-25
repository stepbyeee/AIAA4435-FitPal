import type { Condition } from './pilot'

export type Period = 1 | 2 | 3 | 4
export type Growth = 'visible' | 'hidden'
export type ConditionId = `${Condition['timing']}-${Condition['format']}`
export type TrialSource = 'camera' | 'recording'

const orders: readonly (readonly ConditionId[])[] = [
  ['rep-text', 'rep-card', 'set-card', 'set-text'],
  ['rep-card', 'set-text', 'rep-text', 'set-card'],
  ['set-text', 'set-card', 'rep-card', 'rep-text'],
  ['set-card', 'rep-text', 'set-text', 'rep-card'],
]

export function parseParticipant(value: string | null): number | null {
  return value && /^\d{1,2}$/.test(value) && Number(value) > 0 ? Number(value) : null
}

export function parsePeriod(value: string | null): Period | null {
  return value && /^[1-4]$/.test(value) ? Number(value) as Period : null
}

export function parseGrowth(value: string | null): Growth | null {
  return value === 'hidden' || value === 'visible' ? value : null
}

/** A four-order Williams design. Each directed pair occurs once per full block. */
export function assignmentFor(participant: number, period: Period): { condition: ConditionId; growth: Growth } {
  if (!Number.isInteger(participant) || participant < 1 || participant > 99) throw new RangeError('Participant must be 1–99.')
  if (!Number.isInteger(period) || period < 1 || period > 4) throw new RangeError('Period must be 1–4.')
  const index = participant - 1
  const order = orders[index % 4]
  // Keep the growth arm between subjects and reverse it for each order in the next block.
  const growth = (index % 2 + Math.floor(index / 4)) % 2 === 0 ? 'visible' : 'hidden'
  return { condition: order[period - 1], growth }
}

export function trialPath(pathname: string, trial: { participant: number; period: Period; growth: Growth; source: TrialSource }) {
  const allocation = assignmentFor(trial.participant, trial.period)
  const query = new URLSearchParams({
    participant: String(trial.participant), period: String(trial.period),
    growth: trial.growth, study: allocation.condition,
  })
  if (trial.source === 'recording') query.set('video', 'go4it-rear')
  return pathname + '?' + query.toString() + '#/session/lat-pulldown'
}
