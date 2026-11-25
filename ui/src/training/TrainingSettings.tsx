import { focusNames, normalizePlan, type TrainingPlan } from './plan'
import './training.css'

export function ReplaySpeed({ value, onChange }: { value: number; onChange: (speed: number) => void }) {
  return <label className="focus-select">录像分析速度
    <select value={value} onChange={e => onChange(Number(e.target.value))}>
      <option value="1">正常 · 1×</option><option value="0.5">慢速 · 0.5×</option><option value="0.25">精细 · 0.25×</option>
    </select>
    <small>处理较慢时可选择慢速。所有动作时长仍按原录像计时。</small>
  </label>
}

export function TrainingSettings({ plan, onChange, betweenSets = false }: { plan: TrainingPlan; onChange: (plan: TrainingPlan) => void; betweenSets?: boolean }) {
  const change = (patch: Partial<TrainingPlan>) => onChange(normalizePlan({ ...plan, ...patch }))
  return <details className="training-settings" open={betweenSets || undefined}>
    <summary>{betweenSets ? '下一组练什么' : '训练计划'} <span>{plan.sets} 组 × {plan.reps} 次 · {focusNames[plan.focus]}</span></summary>
    <div className="plan-fields">
      {!betweenSets && <><label>计划组数<input type="number" min="1" max="8" value={plan.sets} onChange={e => change({ sets: Number(e.target.value) })} /></label>
        <label>每组目标次数<input type="number" min="1" max="30" value={plan.reps} onChange={e => change({ reps: Number(e.target.value) })} /></label>
        <label>负重 · 自填 kg<input type="number" min="0" max="500" step="0.5" placeholder="可留空" value={plan.loadKg ?? ''} onChange={e => change({ loadKg: e.target.value === '' ? null : Number(e.target.value) })} /></label></>}
      <label>观察重点<select value={plan.focus} onChange={e => change({ focus: e.target.value as TrainingPlan['focus'] })}>
        {Object.entries(focusNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      {plan.focus === 'tempo' && <label>自选还原目标 · 秒<input type="number" min="0.5" max="10" step="0.25" value={plan.returnSeconds} onChange={e => change({ returnSeconds: Number(e.target.value) })} /></label>}
    </div>
    <p className="plan-focus-note">{plan.focus === 'coordination' ? '看两侧还原是否同步，需双侧全程入镜。' : plan.focus === 'tempo' ? '看拉到底或蹲到底后，还原用了多久。' : '看每一下是否达到自己的校准幅度。'} 不影响 EXP。</p>
  </details>
}
