import { useEffect, useState } from 'react'
import { focusNames, normalizePlan, type TrainingPlan } from './plan'
import './training.css'

function PlanNumber({ value, onChange, min, max, step = 1, optional = false, id, label }: {
  value: number | null; onChange: (value: number | null) => void; min: number; max: number;
  step?: number; optional?: boolean; id?: string; label?: string;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])
  return <input id={id} aria-label={label} type="number" min={min} max={max} step={step}
    placeholder={optional ? '可留空' : undefined} value={draft}
    onChange={event => {
      const text = event.target.value
      setDraft(text)
      if (text === '') { if (optional) onChange(null); return }
      const number = Number(text)
      if (Number.isFinite(number) && number >= min && number <= max && (step !== 1 || Number.isInteger(number))) onChange(number)
    }}
    onBlur={() => setDraft(value === null ? '' : String(value))} />
}

export function TrainingSettings({ plan, onChange, nextSet, exerciseName }: { plan: TrainingPlan; onChange: (plan: TrainingPlan) => void; nextSet?: number; exerciseName?: string }) {
  const change = (patch: Partial<TrainingPlan>) => onChange(normalizePlan({ ...plan, ...patch }))
  if (nextSet !== undefined) return <section className="next-set-settings" aria-label="下一组设置">
    <div><span>下一组</span><strong>{`第 ${nextSet} 组`}</strong></div>
    <div><span>练什么</span><strong>{exerciseName}</strong></div>
    <div><label htmlFor="next-reps">目标次数</label><span><PlanNumber id="next-reps" label="下一组目标次数" min={1} max={30} value={plan.reps} onChange={n => change({ reps: n ?? plan.reps })} /> 次</span></div>
    <div><label htmlFor="next-focus">观察重点</label><select id="next-focus" value={plan.focus} onChange={e => change({ focus: e.target.value as TrainingPlan['focus'] })}>
      {Object.entries(focusNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select></div>
    {plan.focus === 'tempo' && <div><label htmlFor="next-return">还原目标</label><span><PlanNumber id="next-return" label="下一组还原目标" min={0.5} max={10} step={0.25} value={plan.returnSeconds} onChange={n => change({ returnSeconds: n ?? plan.returnSeconds })} /> 秒</span></div>}
  </section>
  return <details className="training-settings">
    <summary>训练计划 <span>{plan.sets} 组 × {plan.reps} 次 · {focusNames[plan.focus]}</span></summary>
    <div className="plan-fields">
      <><label>计划组数<PlanNumber min={1} max={8} value={plan.sets} onChange={n => change({ sets: n ?? plan.sets })} /></label>
        <label>每组目标次数<PlanNumber min={1} max={30} value={plan.reps} onChange={n => change({ reps: n ?? plan.reps })} /></label>
        <label>负重 · 自填 kg<PlanNumber min={0} max={500} step={0.5} optional value={plan.loadKg} onChange={n => change({ loadKg: n })} /></label></>
      <label>观察重点<select value={plan.focus} onChange={e => change({ focus: e.target.value as TrainingPlan['focus'] })}>
        {Object.entries(focusNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      {plan.focus === 'tempo' && <label>自选还原目标 · 秒<PlanNumber min={0.5} max={10} step={0.25} value={plan.returnSeconds} onChange={n => change({ returnSeconds: n ?? plan.returnSeconds })} /></label>}
    </div>
    <p className="plan-focus-note">{plan.focus === 'coordination' ? '看两侧还原是否同步，需双侧全程入镜。' : plan.focus === 'tempo' ? '看拉到底或蹲到底后，还原用了多久。' : '看每一下是否达到自己的校准幅度。'} 不影响 EXP。</p>
  </details>
}
