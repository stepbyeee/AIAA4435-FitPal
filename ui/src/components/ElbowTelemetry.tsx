import { useMemo } from 'react'
import { ANGLE_WINDOW_MS, angleChartPath, type LiveMotion } from '../tracking/liveMotion'

import type { Limb } from '../tracking/limbLandmarks'

const sides = ['left', 'right'] as const
const ticks = [180, 90, 0]
const chart = { width: 304, height: 94, labelSpace: 31, top: 10 }

export function ElbowTelemetry({ motion, limb = 'arm' }: { motion: LiveMotion; limb?: Limb }) {
  const joint = limb === 'leg' ? '膝' : '肘'
  const labels = { left: '左' + joint, right: '右' + joint }
  const paths = useMemo(() => sides.map((side) => angleChartPath(motion.angles, side, chart.width, chart.height)), [motion.angles])

  return (
    <section className="elbow-telemetry" aria-label={'实时' + joint + '角'}>
      <div className="telemetry-title">
        <h2>{joint}角</h2>
        <span>二维投影 · 最近 {ANGLE_WINDOW_MS / 1000} 秒</span>
      </div>
      <div className="telemetry-values">
        {sides.map((side) => {
          const angle = motion.trails[side].at(-1)?.angle
          return (
            <div className="telemetry-value" key={side} data-side={side} data-visible={angle !== undefined}>
              <span>{labels[side]}</span>
              <strong className="num">{angle === undefined ? '—' : `${Math.round(angle)}°`}</strong>
            </div>
          )
        })}
      </div>
      <svg viewBox={`0 0 ${chart.width + chart.labelSpace} ${chart.height + 2 * chart.top}`} className="telemetry-chart" role="img" aria-label={'最近六秒的左右' + joint + '角曲线'}>
        {ticks.map((tick) => {
          const y = chart.top + chart.height * (1 - tick / 180)
          return (
            <g key={tick}>
              <text x="0" y={y + 4}>{tick}°</text>
              <line x1={chart.labelSpace} y1={y} x2={chart.labelSpace + chart.width} y2={y} />
            </g>
          )
        })}
        <g transform={`translate(${chart.labelSpace} ${chart.top})`}>
          {sides.map((side, index) => <path key={side} data-side={side} d={paths[index]} vectorEffect="non-scaling-stroke" />)}
        </g>
      </svg>
    </section>
  )
}
