import { useEffect, useState } from 'react'
import { compareMotion, wholeCycleStats, type SetMotion } from '../analytics/motion'
import type { SetResult, SetSummary } from '../contract'
import { focusNames, type TrainingPlan } from './plan'
import { answerTrainingQuestion, questionNames, type TrainingQuestion } from './policy'
import './training.css'
import { RepTimingChart } from './RepTimingChart'
import type { Limb } from '../tracking/limbLandmarks'

export const seconds = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`
function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="motion-metric"><dt>{label}</dt><dd>{value}</dd>{note && <small>{note}</small>}</div>
}
export function MotionReview({ motion, plan, previous, limb = 'arm' }: { motion: SetMotion; plan: TrainingPlan; limb?: Limb; previous?: { motion: SetMotion; plan: TrainingPlan } }) {
  const m = motion.summary
  const timing = wholeCycleStats(motion.reps)
  const comparison = previous && compareMotion(previous.motion.summary, m)
  const matching = previous?.plan.focus === plan.focus && previous.plan.returnSeconds === plan.returnSeconds && previous.plan.loadKg === plan.loadKg
  return <section className="motion-review" aria-label="本组训练趋势">
    <div className="motion-heading"><h3>这一组的表现</h3><span>{focusNames[plan.focus]}</span></div>
    <dl className="motion-grid">
      <Metric label="通常完成一下" value={seconds(timing.typical)} note={`${timing.count} 下有完整计时 · 下拉/下蹲到返回`} />
      <Metric label="整次用时范围" value={timing.shortest && timing.longest ? `${(timing.shortest.durationMs / 1000).toFixed(2)}–${(timing.longest.durationMs / 1000).toFixed(2)} s` : '—'} />
      <Metric label="整次节奏波动" value={timing.variation === null ? '—' : `${Math.round(timing.variation * 100)}%`} note="至少 3 下；典型偏差，需结合曲线看" />
      <Metric label="典型个人幅度" value={m.medianRange === null ? '—' : `${Math.round(m.medianRange * 100)}%`} />
      <Metric label="左右还原时间差" value={m.medianLagMs === null ? '—' : `${m.medianLagMs > 0 ? '+' : ''}${m.medianLagMs} ms`} note={`实验观察 · ${m.pairedReps} 下可比较 · 不评分`} />
      <Metric label="计数侧可见率" value={`${Math.round(m.coverage * 100)}%`} note="按已处理画面计算" />
    </dl>
    {!m.measuredReps && <p>暂无连续完整记录。遮挡或仅上臂计数时，不推测还原时间和动作角度。</p>}
    {m.pairedReps > 0 && <p className="motion-note">正数表示右侧到达自身还原中点较晚，负数表示左侧较晚。只描述时序，不推断力量差异。</p>}
    {previous && <p className="motion-comparison">{matching && comparison?.comparable && previous.motion.summary.medianDurationMs !== null && timing.typical !== null
      ? `与上一组比较：整次用时${timing.typical >= previous.motion.summary.medianDurationMs ? '增加' : '减少'} ${seconds(Math.abs(timing.typical - previous.motion.summary.medianDurationMs))}。是否更好取决于你的目标。`
      : '暂不直接比较上一组：需要相同目标、负重、相近机位、足够完整动作和相近幅度。'}</p>}
    <RepTimingChart reps={motion.reps} plan={plan} limb={limb} />
  </section>
}

export function TrainingCoach({ summary, motion, plan, result }: { summary: SetSummary; motion: SetMotion; plan: TrainingPlan; result: SetResult }) {
  const [question, ask] = useState<TrainingQuestion>('improve')
  const [speechError, setSpeechError] = useState(false)
  const answer = answerTrainingQuestion(question, summary, motion, plan, result)
  useEffect(() => () => { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel() }, [])
  return <section className="training-coach" aria-label="训练教练问答">
    <h3>问问训练教练</h3><p className="motion-note">根据这一组的动作，找到下一组值得改进的地方。</p>
    <div className="coach-questions">{Object.entries(questionNames).map(([id, name]) => <button key={id} aria-pressed={question === id} onClick={() => { ask(id as TrainingQuestion); if ('speechSynthesis' in window) window.speechSynthesis.cancel() }}>{name}</button>)}</div>
    <p className="coach-answer" aria-live="polite">{answer}</p>
    <button className="pause-action" onClick={() => {
      if (!('speechSynthesis' in window)) { setSpeechError(true); return }
      const utterance = new SpeechSynthesisUtterance(answer)
      utterance.lang = 'zh-CN'
      const local = window.speechSynthesis.getVoices().find(v => v.localService && v.lang.startsWith('zh'))
      if (!local) { setSpeechError(true); return }
      utterance.voice = local; utterance.onerror = () => setSpeechError(true)
      setSpeechError(false); window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance)
    }}>朗读这条建议</button>
    {speechError && <p role="status">当前设备没有可用的本地中文语音，请阅读文字建议。</p>}
  </section>
}
