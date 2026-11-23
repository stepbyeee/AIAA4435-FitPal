import { useState } from 'react'
import { IN_RANGE, type SetSummary } from '../contract'
import { makeStudyRecord, type Condition, type Ratings, type TrialContext, type TrialEvent } from '../study/pilot'

/** A schematic in the same projected angle units as the personal range score. */
export function JointTarget({ calibration, exercise }: { calibration: SetSummary['calibration']; exercise: string }) {
  if (calibration.basis === 'upper-arm') return null
  const joint = exercise === 'squat' ? '膝' : '肘'
  const threshold = calibration.thetaTop - IN_RANGE * (calibration.thetaTop - calibration.thetaBottom)
  const angle = threshold * Math.PI / 180
  return <figure className="joint-target">
    <svg viewBox="0 0 130 85" role="img" aria-label={`校准目标，投影${joint}角 ${Math.round(threshold)} 度`}>
      <path d={`M16,64 L66,64 L${66 - 49 * Math.cos(angle)},${64 - 49 * Math.sin(angle)}`} fill="none" stroke="var(--arm-left)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="66" cy="64" r="6" fill="white" />
    </svg>
    <figcaption>个人幅度达标线<strong>投影{joint}角 {Math.round(threshold)}°</strong></figcaption>
  </figure>
}

const fields = [
  ['interruption', '提示打断节奏的程度', '完全没有', '非常明显'],
  ['effort', '理解提示花费的精力', '很少', '很多'],
  ['clarity', '动作目标有多清楚', '很模糊', '很清楚'],
  ['motivation', '继续练下一组的意愿', '很低', '很高'],
] as const

export function PilotSurvey({ condition, summary, playback, cuesShown, context, events, onExit }: {
  condition: Condition; summary: SetSummary; playback: boolean; cuesShown: number; context: TrialContext; events: readonly TrialEvent[]; onExit: () => void
}) {
  const [answers, setAnswers] = useState<Partial<Ratings>>({})
  const [exported, setExported] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const ready = fields.every(([key]) => answers[key] !== undefined)
  const download = () => {
    if (!ready) return
    const record = makeStudyRecord(condition, summary, playback ? 'recording' : 'camera', cuesShown, answers as Ratings, context, events)
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `fitpal-${condition.timing}-${condition.format}-${Date.now()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExported(true)
  }
  return <section className="pilot-survey">
    <h2>本轮体验</h2>
    <p>1 到 7 分。评分和训练摘要仅随本地下载保存。</p>
    {fields.map(([key, title, low, high]) => <label key={key}>
      <span>{title}</span>
      <select aria-label={title} value={answers[key] ?? ''} onChange={e => {
        setAnswers({ ...answers, [key]: e.target.value ? Number(e.target.value) : undefined })
        setExported(false)
      }}>
        <option value="">选择</option>
        {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}{n === 1 ? ' · ' + low : n === 7 ? ' · ' + high : ''}</option>)}
      </select>
    </label>)}
    <button className="pill" disabled={!ready} onClick={download}>{exported ? '再次导出' : '导出本轮记录'}</button>
    {exported ? <button className="pill pill-wide" onClick={onExit}>完成</button>
      : discarding ? <div className="discard-trial">
        <p>本轮评分还没有导出，退出后无法找回。</p>
        <button onClick={() => setDiscarding(false)}>返回评分</button>
        <button onClick={onExit}>放弃本轮记录</button>
      </div> : <button className="pause-action" onClick={() => setDiscarding(true)}>跳过并结束</button>}
  </section>
}
