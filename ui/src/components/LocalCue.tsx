import { useEffect, useState } from 'react'
import type { SetResult, SetSummary } from '../contract'
import { explainLocalCue, localCoachEnabled } from '../feedback/localCoach'

const requests = new WeakMap<SetSummary, Promise<string | null>>()

export function LocalCue({ summary, result, fallback, enabled = true }: {
  summary?: SetSummary; result: SetResult; fallback: string; enabled?: boolean
}) {
  const run = enabled && !!result.cue && localCoachEnabled(new URL(window.location.href))
  const [resolved, setResolved] = useState<{ summary: SetSummary; text: string | null } | null>(null)
  useEffect(() => {
    if (!run || !summary) return
    let current = true
    let request = requests.get(summary)
    if (!request) {
      request = explainLocalCue(summary, result)
      requests.set(summary, request)
    }
    request.then(text => { if (current) setResolved({ summary, text }) })
    return () => { current = false }
  }, [summary, result, run])

  const pending = run && summary && resolved?.summary !== summary
  const modelText = run && resolved?.summary === summary ? resolved?.text : null
  return <p className="say" aria-live="polite" aria-busy={!!pending} data-cue-source={pending ? 'pending' : modelText ? 'local-model' : 'rules'}>
    {pending ? '正在整理这组的提示…' : modelText || fallback}
  </p>
}
