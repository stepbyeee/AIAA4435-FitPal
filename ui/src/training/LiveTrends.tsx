import { IN_RANGE } from '../contract'
import { trendPath, type TrendSample } from '../analytics/liveTrends'
import type { RepMetrics } from '../analytics/motion'
import type { Limb } from '../tracking/limbLandmarks'
import type { TrainingPlan } from './plan'
import { RepTimingChart } from './RepTimingChart'
import './training.css'

function Trace({ title, samples, metric, active, min, max, unit, unavailable, target }: {
  title: string; samples: readonly TrendSample[]; metric: 'range' | 'tilt'; active: boolean; min: number; max: number; unit: string; unavailable: string; target?: number
}) {
  const current = active ? samples.at(-1)?.[metric] ?? null : null
  const format = (n: number) => `${Math.round(metric === 'range' ? n * 100 : n)}${unit}`
  const y = (value: number) => 8 + 62 * (1 - (value - min) / (max - min))
  return <section className="live-trend-card continuous-trend" data-metric={metric} aria-label={title}>
    <header><h3>{title}</h3><strong className="trend-current">{current === null ? '—' : format(current)}</strong></header>
    <svg viewBox="0 0 328 94" role="img" aria-label={`${title}最近六秒曲线，断线表示缺少连续观测`}>
      {[max, (max + min) / 2, min].map(tick => <g key={tick}><text x="0" y={y(tick) + 4}>{format(tick)}</text><line className="trend-grid" x1="36" x2="320" y1={y(tick)} y2={y(tick)} /></g>)}
      {target !== undefined && <line className="timing-target" x1="36" x2="320" y1={y(target)} y2={y(target)}><title>原有个人幅度目标 {format(target)}</title></line>}
      <g transform="translate(36 8)"><path data-series={metric} d={active ? trendPath(samples, metric, 284, 62, min, max) : ''} /></g>
      <text x="36" y="90">−6秒</text><text x="320" y="90" textAnchor="end">现在</text>
    </svg>
    <p className="trend-caption">{!active ? '等待清晰画面' : current === null ? unavailable : metric === 'range' ? '虚线：个人校准幅度的 85%' : '侧面观测 · 正数后倾，负数前倾'}</p>
  </section>
}

export function LiveTrends({ active, samples, reps, plan, limb, calibrated }: {
  active: boolean; samples: readonly TrendSample[]; reps: readonly RepMetrics[]; plan: TrainingPlan; limb: Limb; calibrated: boolean
}) {
  return <section className="motion-live live-trends" aria-label="训练指标">
    <Trace title="动作幅度" metric="range" samples={samples} active={active} min={0} max={1} unit="%" target={calibrated ? IN_RANGE : undefined}
      unavailable={calibrated ? '未获得个人幅度 · 仅计数时不推测' : '完成个人校准后显示'} />
    {limb === 'arm' && <Trace title="上身前后倾" metric="tilt" samples={samples} active={active} min={-45} max={45} unit="°" unavailable="需侧面固定机位，肩与髋清晰入镜" />}
    <RepTimingChart reps={reps} plan={plan} limb={limb} />
    {plan.loadKg !== null && <p className="motion-note">自填负重 {plan.loadKg} kg</p>}
  </section>
}
