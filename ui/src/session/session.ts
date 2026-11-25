import type { SetResult } from '../contract'

// The flow of one session: calibrate, then sets with a rest and one cue between them.

export type Stage = 'calibrating' | 'set' | 'rest' | 'done'

export type SessionState = {
  stage: Stage
  setIndex: number
  totalSets: number
  results: SetResult[]
  /** The issue the next set is checked against. */
  lastIssueId: string | null
}

export type SessionEvent =
  | { type: 'calibrated' }
  | { type: 'setEnded'; result: SetResult }
  | { type: 'nextSet' }

export const initialSession = (totalSets: number, lastIssueId: string | null = null): SessionState => ({
  stage: 'calibrating',
  setIndex: 0,
  totalSets,
  results: [],
  lastIssueId,
})

export function reduce(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'calibrated':
      return state.stage === 'calibrating' ? { ...state, stage: 'set' } : state
    case 'setEnded': {
      if (state.stage !== 'set') return state
      const results = [...state.results, event.result]
      const issue = event.result.cue?.issueId
      return {
        ...state,
        results,
        lastIssueId: state.lastIssueId && event.result.exp.fixedBonus === 0
          ? state.lastIssueId
          : issue === 'trunk_swing' ? null : issue ?? null,
        stage: results.length >= state.totalSets ? 'done' : 'rest',
      }
    }
    case 'nextSet':
      return state.stage === 'rest' ? { ...state, stage: 'set', setIndex: state.setIndex + 1 } : state
  }
}
