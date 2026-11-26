import { useState } from 'react'
import { measuredTime, type RepMetrics, type TimingKey } from '../analytics/motion'
import type { Limb } from '../tracking/limbLandmarks'
import type { TrainingPlan } from './plan'

const detailKeys: TimingKey[] = ['outboundMs', 'returnMs', 'bottomHoldMs']
const seconds = (value: number | null) => value === null ? '—' : `${(value / 1000).toFixed(2)} s`

export function timingPath(reps: readonly RepMetrics[], key: TimingKey, width: number, height: number, max: number) {
  let drawing = false
  return reps.map((rep, i) => {
    const value = measuredTime(rep, key)
    if (value === null) { drawing = false; return '' }
    const command = drawing ? 'L' : 'M'
    drawing = true
    return `${command}${(width * (i + .5) / reps.length).toFixed(1)},${(height * (1 - value / max)).toFixed(1)}`
  }).filter(Boolean).join(' ')
}

export function RepTimingChart({ reps, plan, limb }: { reps: readonly RepMetrics[]; plan: TrainingPlan; limb: Limb }) {
  const [chosen, choose] = useState<number | null>(null)
  const recent = reps.slice(-12)
  const selected = recent.find(r => r.repIndex === chosen) ?? recent.at(-1)
  const labels: Record<TimingKey, string> = { durationMs: '整次用时', outboundMs: limb === 'arm' ? '下拉至最低点' : '下蹲至最低点', returnMs: limb === 'arm' ? '最低点后还原' : '最低点后起身', bottomHoldMs: '底部附近用时' }
  const max = Math.ceil(Math.max(1000, ...recent.map(r => measuredTime(r) ?? 0)) / 1000) * 1000
  const height = 76, width = 284, left = 36, top = 10
  const y = (value: number) => top + height * (1 - value / max)
  return <section className="live-trend-card rep-timing-chart" aria-label="逐次动作节奏">
    <header><h3>每一下用时</h3><span>{selected ? `第 ${selected.repIndex + 1} 下` : '完成后更新'}</span></header>
    <dl className="timing-total"><div><dt>整次用时</dt><dd>{seconds(measuredTime(selected))}</dd></div></dl>
    <svg viewBox="0 0 328 112" role="group" aria-label="整次用时曲线，横轴为动作次数，纵轴为秒">
      {[0, max / 2, max].map(tick => <g key={tick}><text x="0" y={y(tick) + 4}>{(tick / 1000).toFixed(tick % 1000 ? 1 : 0)}s</text><line className="trend-grid" x1={left} x2={left + width} y1={y(tick)} y2={y(tick)} /></g>)}
      <g transform={`translate(${left} ${top})`}><path data-series="durationMs" d={timingPath(recent, 'durationMs', width, height, max)} /></g>
      {recent.map((rep, i) => {
        const x = left + width * (i + .5) / recent.length, value = measuredTime(rep)
        return <g key={rep.repIndex} className="timing-rep" role="button" tabIndex={0} aria-label={`查看第 ${rep.repIndex + 1} 下用时${value === null ? '，计时不足' : ''}`} aria-pressed={selected?.repIndex === rep.repIndex}
          onClick={() => choose(rep.repIndex)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(rep.repIndex) } }}>
          <rect className="timing-hit" x={left + width * i / recent.length} y="5" width={width / recent.length} height="104" />
          {value !== null ? <circle data-series="durationMs" cx={x} cy={y(value)} r="3" /> : <text x={x} y={y(0) - 5} textAnchor="middle">×</text>}
          <text x={x} y="106" textAnchor="middle">{rep.repIndex + 1}</text>
        </g>
      })}
      {!recent.length && <text x="182" y="48" textAnchor="middle">完成一下后显示用时</text>}
    </svg>
    <p className="trend-caption">{limb === 'arm' ? '识别到下拉至确认返回' : '识别到下蹲至确认站回'} · 按画面识别计时{selected && measuredTime(selected) === null && ' · 这一下计时不足'}</p>
    <details className="timing-details"><summary>查看分段</summary>
      <dl className="timing-legend">{detailKeys.map(key => <div key={key} data-series={key}><dt>{labels[key]}</dt><dd>{seconds(measuredTime(selected, key))}</dd></div>)}</dl>
      <p className="trend-caption">底部附近用时已包含在整次用时中，指最低角附近 3°，不一定完全静止。{plan.focus === 'tempo' && `自选还原目标 ${plan.returnSeconds} 秒，仅比较还原段。`}</p>
    </details>
    {chosen !== null && <button className="timing-latest" onClick={() => choose(null)}>跟随最新一下</button>}
  </section>
}
