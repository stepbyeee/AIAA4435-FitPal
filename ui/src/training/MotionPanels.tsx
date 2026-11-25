import { useEffect, useState } from 'react'
import { compareMotion, type SetMotion, type RepMetrics, type createMotionRecorder } from '../analytics/motion'
import type { SetResult, SetSummary } from '../contract'
import { focusNames, type TrainingPlan } from './plan'
import { answerTrainingQuestion, questionNames, type TrainingQuestion } from './policy'
import './training.css'

export const seconds = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`
const degrees = (n: number | null) => n === null ? '—' : `${Math.round(n)}°`
function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="motion-metric"><dt>{label}</dt><dd>{value}</dd>{note && <small>{note}</small>}</div>
}
export function LiveMetrics({ active, live, latest, plan }: {
  active: boolean; live: ReturnType<typeof createMotionRecorder>['live']; latest: RepMetrics | null; plan: TrainingPlan
}) {
  return <section className="motion-live" aria-label="训练指标">
    <div className="motion-heading"><h3>{focusNames[plan.focus]}</h3><span>{active ? '画面观测' : '等待清晰画面'}</span></div>
    <dl className="motion-grid">
      <Metric label="左侧关节角" value={degrees(active ? live.left : null)} />
      <Metric label="右侧关节角" value={degrees(active ? live.right : null)} />
      <Metric label="左侧角度变化" value={active && live.leftSpeed !== null ? `${live.leftSpeed}°/s` : '—'} note="画面角度变化，非重量速度" />
      <Metric label="右侧角度变化" value={active && live.rightSpeed !== null ? `${live.rightSpeed}°/s` : '—'} />
      <Metric label="最近一次还原" value={seconds(latest?.returnMs ?? null)} />
      <Metric label="最近一次底部停留" value={seconds(latest?.bottomHoldMs ?? null)} note="最低角附近 3° 范围" />
    </dl>
    {plan.loadKg !== null && <p className="motion-note">自填负重 {plan.loadKg} kg · 未经镜头验证</p>}
  </section>
}

export function MotionReview({ motion, plan, previous }: { motion: SetMotion; plan: TrainingPlan; previous?: { motion: SetMotion; plan: TrainingPlan } }) {
  const m = motion.summary
  const comparison = previous && compareMotion(previous.motion.summary, m)
  const matching = previous?.plan.focus === plan.focus && previous.plan.returnSeconds === plan.returnSeconds && previous.plan.loadKg === plan.loadKg
  return <section className="motion-review" aria-label="本组训练趋势">
    <div className="motion-heading"><h3>这一组的表现</h3><span>{focusNames[plan.focus]}</span></div>
    <dl className="motion-grid">
      <Metric label="典型动作时间" value={seconds(m.medianDurationMs)} note={`${m.measuredReps} 下有完整计时`} />
      <Metric label="典型还原时间" value={seconds(m.medianReturnMs)} />
      <Metric label="还原时间波动" value={m.returnVariation === null ? '—' : `${Math.round(m.returnVariation * 100)}%`} note="中位偏差比；越低越一致" />
      <Metric label="典型个人幅度" value={m.medianRange === null ? '—' : `${Math.round(m.medianRange * 100)}%`} />
      <Metric label="左右还原时间差" value={m.medianLagMs === null ? '—' : `${m.medianLagMs > 0 ? '+' : ''}${m.medianLagMs} ms`} note={`实验观察 · ${m.pairedReps} 下可比较 · 不评分`} />
      <Metric label="计数侧可见率" value={`${Math.round(m.coverage * 100)}%`} note="按已处理画面计算" />
    </dl>
    {!m.measuredReps && <p>暂无连续完整记录。遮挡或仅上臂计数时，不推测还原时间和动作角度。</p>}
    {m.pairedReps > 0 && <p className="motion-note">正数表示右侧到达自身还原中点较晚，负数表示左侧较晚。只描述时序，不推断力量差异。</p>}
    {previous && <p className="motion-comparison">{matching && comparison?.comparable && comparison.returnDifferenceMs !== null
      ? `与上一组比较：典型还原${comparison.returnDifferenceMs >= 0 ? '增加' : '减少'} ${seconds(Math.abs(comparison.returnDifferenceMs))}。是否更好取决于你的目标。`
      : '暂不直接比较上一组：需要相同目标、负重、相近机位、足够完整动作和相近幅度。'}</p>}
    {m.measuredReps > 0 && <figure className="tempo-chart"><figcaption>每一下的还原时间{plan.focus === 'tempo' && ` · 虚线为自选目标 ${plan.returnSeconds} 秒`}</figcaption>
      <svg viewBox="0 0 420 100" role="img" aria-label="逐次还原时间趋势，断点表示没有可靠计时">
        {(() => {
          const max = Math.max(plan.returnSeconds * 1000 * 1.25, ...motion.reps.map(r => r.returnMs ?? 0), 1000)
          const y = (v: number) => 85 - 70 * v / max
          return <>{plan.focus === 'tempo' && <line x1="8" x2="412" y1={y(plan.returnSeconds * 1000)} y2={y(plan.returnSeconds * 1000)} stroke="currentColor" strokeDasharray="4 4" opacity=".4" />}
            {motion.reps.map((r, i) => r.returnMs === null ? <text key={i} x={10 + 400 * (i + .5) / motion.reps.length} y="90" fill="currentColor" fontSize="10">×</text>
              : <g key={i}><line x1={10 + 400 * (i + .5) / motion.reps.length} x2={10 + 400 * (i + .5) / motion.reps.length} y1="85" y2={y(r.returnMs)} stroke="var(--accent)" strokeWidth={Math.min(14, 300 / motion.reps.length)} /><title>第 {i + 1} 下：{seconds(r.returnMs)}</title></g>)}</>
        })()}
      </svg></figure>}
  </section>
}

export function TrainingCoach({ summary, motion, plan, result }: { summary: SetSummary; motion: SetMotion; plan: TrainingPlan; result: SetResult }) {
  const [question, ask] = useState<TrainingQuestion>('next')
  const [speechError, setSpeechError] = useState(false)
  const answer = answerTrainingQuestion(question, summary, motion, plan, result)
  useEffect(() => () => { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel() }, [])
  return <section className="training-coach" aria-label="训练教练问答">
    <h3>问问训练教练</h3><p className="motion-note">只解释本组测量与既定奖励规则。</p>
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
