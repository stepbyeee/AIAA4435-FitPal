import { describe, expect, it, vi } from 'vitest'
import { settle } from './settle'
import { explainLocalCue, localCoachEnabled } from './localCoach'
import type { SetSummary } from '../contract'

const summary: SetSummary = {
  exerciseId: 'lat-pulldown', calibration: { thetaTop: 160, thetaBottom: 80 }, coverage: 1,
  reps: [{ status: 'verified', qMax: 0.7, durationMs: 1500 }], issues: [{ id: 'short_range', repIndexes: [0] }],
}

describe('optional on-device cue wording', () => {
  it('requires an explicit opt-in on a loopback page', () => {
    expect(localCoachEnabled(new URL('http://127.0.0.1:5190/?coach=local'))).toBe(true)
    expect(localCoachEnabled(new URL('http://127.0.0.1:5190/'))).toBe(false)
    expect(localCoachEnabled(new URL('https://example.com/?coach=local'))).toBe(false)
  })
  it('only accepts a complete grounded observation and an allowed action', async () => {
    const fetcher: typeof fetch = async (url, options) => {
      expect(String(url)).toBe('http://127.0.0.1:5191/v1/chat/completions')
      expect(options?.redirect).toBe('error')
      const body = JSON.parse(String(options?.body))
      const choices = body.response_format.json_schema.schema.properties
      const observation = choices.observation.enum.find((line: string) => line.includes('70%'))
      const action = choices.action.enum[0]
      expect(observation).toContain('第 1 下')
      expect(String(options?.body)).not.toMatch(/landmarks|durationMs|thetaBottom|qMax|wrist|EXP/)
      return Response.json({ choices: [{ message: { content: JSON.stringify({ observation, action }) } }] })
    }
    expect(await explainLocalCue(summary, settle(summary, null), fetcher)).toMatch(/70%.*下一组/)
  })
  it('rejects invented facts, extra fields and network failures', async () => {
    for (const content of ['invalid JSON', '{"observation":"动作完美","action":"加重"}',
      '{"observation":"!","action":"!","score":99}']) {
      const fetcher = async () => Response.json({ choices: [{ message: { content } }] })
      expect(await explainLocalCue(summary, settle(summary, null), fetcher)).toBeNull()
    }
    expect(await explainLocalCue(summary, settle(summary, null), async () => { throw Error('offline') })).toBeNull()
  })
  it('rejects extra fields even alongside two grounded fields', async () => {
    const fetcher: typeof fetch = async (_url, options) => {
      const fields = JSON.parse(String(options?.body)).response_format.json_schema.schema.properties
      const content = { observation: fields.observation.enum[0], action: fields.action.enum[0], exp: 999 }
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] })
    }
    expect(await explainLocalCue(summary, settle(summary, null), fetcher)).toBeNull()
  })

  it('aborts a stalled local request after the deadline', async () => {
    vi.useFakeTimers()
    try {
      const stalled: typeof fetch = (_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true })
      })
      const request = explainLocalCue(summary, settle(summary, null), stalled)
      await vi.advanceTimersByTimeAsync(3500)
      expect(await request).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never requests a model judgment when the policy chose silence', async () => {
    const clean: SetSummary = { ...summary, issues: [], reps: [{ ...summary.reps[0], qMax: 1 }] }
    const fetcher = vi.fn()
    expect(await explainLocalCue(clean, settle(clean, null), fetcher)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
