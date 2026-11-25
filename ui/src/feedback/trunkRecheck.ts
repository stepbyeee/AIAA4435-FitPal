import type { SetSummary, TrunkForm } from '../contract'
import { comparableTrunkView } from '../perception/pulldownForm'

function measurements(summary: SetSummary) {
  const verified = summary.reps.filter(rep => rep.status === 'verified')
  const observations = verified.flatMap(({ trunkForm, qMax }) =>
    trunkForm && qMax !== null ? [{ form: trunkForm, depth: qMax }] : [])
  return {
    observations, swings: observations.filter(item => item.form.status === 'swing').length,
    assessed: observations.length, verified: verified.length,
  }
}

export function compareTrunkSets(previousSet: SetSummary, currentSet: SetSummary) {
  const previous = measurements(previousSet)
  const current = measurements(currentSet)
  const enough = (set: typeof previous) => set.assessed >= 2 && set.assessed / set.verified >= 0.75
  const meanDepth = (set: typeof previous) => set.observations.reduce((sum, rep) => sum + rep.depth, 0) / set.assessed
  const matchesView = (view: TrunkForm['view']) => [...previous.observations, ...current.observations]
    .every(rep => comparableTrunkView(view, rep.form.view))
  let status: 'unavailable' | 'lower' | 'same' | 'higher' = 'unavailable'
  if (enough(previous) && enough(current) && currentSet.coverage >= 0.75 && previousSet.coverage >= 0.75
    && matchesView(previous.observations[0].form.view) && meanDepth(previous) - meanDepth(current) <= 0.1
    && !currentSet.issues.some(issue => issue.id === 'out_of_view')) {
    const difference = current.swings * previous.assessed - previous.swings * current.assessed
    status = difference < 0 ? 'lower' : difference > 0 ? 'higher' : 'same'
  }
  return { status, previous: { swings: previous.swings, assessed: previous.assessed },
    current: { swings: current.swings, assessed: current.assessed } }
}
