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
    <p className="plan-purpose">设置这一轮的训练目标，供训练中提醒和结束后回顾。这里的数值不是训练建议。</p>
    <div className="plan-fields">
      {!betweenSets && <><label>计划组数<input type="number" min="1" max="8" value={plan.sets} onChange={e => change({ sets: Number(e.target.value) })} /></label>
        <label>每组目标次数<input type="number" min="1" max="30" value={plan.reps} onChange={e => change({ reps: Number(e.target.value) })} /></label>
        <label>负重 · 自填 kg<input type="number" min="0" max="500" step="0.5" placeholder="可留空" value={plan.loadKg ?? ''} onChange={e => change({ loadKg: e.target.value === '' ? null : Number(e.target.value) })} /></label></>}
      <label>这一组主要想观察什么<select value={plan.focus} onChange={e => change({ focus: e.target.value as TrainingPlan['focus'] })}>
        {Object.entries(focusNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      {plan.focus === 'tempo' && <label>自选还原目标 · 秒<input type="number" min="0.5" max="10" step="0.25" value={plan.returnSeconds} onChange={e => change({ returnSeconds: Number(e.target.value) })} /></label>}
    </div>
    <p className="plan-focus-note">{plan.focus === 'coordination' ? '观察左右两侧返回中间位置的时间差。需要固定正面或背面机位、双侧全程可见；不能据此判断力量不平衡，也不按时间差奖励 EXP。' : plan.focus === 'tempo' ? '观察从动作底部到确认返回用了几秒，并与自己设定的目标比较；不是整次动作的总时长，也不是系统推荐的速度。' : '先用 3 次动作建立个人参照，再观察每一下是否达到自己的动作幅度；不是统一的合格角度，也不代表安全评估。'}</p>
    <p className="plan-limits">观察重点只影响显示和建议，不影响 EXP。次数是目标，可提前结束；负重可留空，由你记录，镜头不会验证重量。</p>
  </details>
}
