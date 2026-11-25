import { IN_RANGE, type SetResult, type SetSummary } from '../contract'

const endpoint = 'http://127.0.0.1:5191/v1/chat/completions'
const deadlineMs = 3500

export function localCoachEnabled(url: URL) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.searchParams.get('coach') === 'local'
}

/** The policy supplies the issue. Each available observation is independently true of this set. */
function wording(summary: SetSummary, issue: string | undefined) {
  if (!['lat-pulldown', 'squat'].includes(summary.exerciseId)) return null
  const squat = summary.exerciseId === 'squat'
  if (issue === 'out_of_view') {
    const unseen = summary.reps.filter(rep => rep.status === 'cannot_verify').length
    if (!unseen && (summary.reps.some(rep => rep.status === 'verified') || summary.coverage >= 0.9)) return null
    const observation = unseen ? [
      `这组有 ${unseen} 下没看清，幅度无法确认。`,
      `镜头中断了 ${unseen} 下的动作记录。`,
    ] : ['这组的画面不足以确认完整动作。', '这组没能看清一次完整动作。']
    const joints = squat ? '髋、膝和脚踝' : '肩、肘和手腕'
    return { observation, action: [
      `下一组调整取景，让同一侧的${joints}全程入镜。`,
      `下一组先检查${joints}在起点和底部都能看清。`,
    ] }
  }
  if (issue !== 'short_range') return null
  const short = summary.reps.flatMap((rep, index) => rep.status === 'verified' && rep.qMax !== null && rep.qMax < IN_RANGE ? [{ index, depth: rep.qMax }] : [])
  if (!short.length) return null
  const { index, depth } = short[0]
  const pct = Math.round(depth * 100)
  const target = IN_RANGE * 100
  const observation = [`这组有 ${short.length} 下低于个人幅度目标 ${target}%。`]
  if (pct < target) observation.push(`第 ${index + 1} 下约为校准幅度的 ${pct}%，目标是 ${target}%。`)
  const move = squat ? '下蹲' : '下拉'
  return { observation, action: [
    `下一组${move}时，对照个人校准时的底部位置。`,
    `下一组试着${move}到校准时的位置，再${squat ? '起身' : '还原'}。`,
  ] }
}

/** A null result leaves the original policy cue in place. The model has no write path to the result. */
export async function explainLocalCue(summary: SetSummary, result: SetResult, fetcher: typeof fetch = fetch): Promise<string | null> {
  const words = wording(summary, result.cue?.issueId)
  if (!words) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)
  try {
    const response = await fetcher(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({
        model: 'fitpal-qwen', temperature: 0, max_tokens: 150, stream: false,
        messages: [
          { role: 'system', content: '你在写一条组后训练提示。从候选中各选一句原文组成自然的中文提示。只有一下问题时优先用具体动作，多下问题时优先概括全组。用 JSON 返回 observation 与 action。' },
          { role: 'user', content: JSON.stringify(words) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'set_explanation', strict: true, schema: {
          type: 'object', properties: {
            observation: { type: 'string', enum: words.observation },
            action: { type: 'string', enum: words.action },
          }, required: ['observation', 'action'], additionalProperties: false,
        } } },
      }),
    })
    if (!response.ok) return null
    const body = await response.json()
    const choice = JSON.parse(body.choices[0].message.content)
    if (Object.keys(choice).length !== 2 || !words.observation.includes(choice.observation) || !words.action.includes(choice.action)) return null
    return choice.observation + choice.action
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
