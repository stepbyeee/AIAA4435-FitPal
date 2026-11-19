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

export const initialSession = (totalSets: number): SessionState => ({
  stage: 'calibrating',
  setIndex: 0,
  totalSets,
  results: [],
  lastIssueId: null,
})

export function reduce(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'calibrated':
      return state.stage === 'calibrating' ? { ...state, stage: 'set' } : state
    case 'setEnded': {
      if (state.stage !== 'set') return state
      const results = [...state.results, event.result]
      return {
        ...state,
        results,
        lastIssueId: event.result.cue?.issueId ?? null,
        stage: results.length >= state.totalSets ? 'done' : 'rest',
      }
    }
    case 'nextSet':
      return state.stage === 'rest' ? { ...state, stage: 'set', setIndex: state.setIndex + 1 } : state
  }
}
