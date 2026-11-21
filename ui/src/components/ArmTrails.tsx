import type { ArmTrails as Trails } from '../tracking/armTrails'

type FrameSize = { width: number; height: number }

const sides = ['left', 'right'] as const
const armNames = { left: '左臂', right: '右臂' }
const joints = ['elbow', 'wrist'] as const

export function ArmTrails({ trails, frame, mirrored }: { trails: Trails; frame: FrameSize; mirrored: boolean }) {
  const { width, height } = frame
  const markerSize = Math.min(width, height) * 0.009
  const labelScale = Math.min(width, height) / 540

  return (
    <>
      <svg className={`stage-overlay arm-trails${mirrored ? ' stage-mirror' : ''}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {sides.map((side) => {
          const points = trails[side]
          const latest = points.at(-1)
          if (!latest) return null
          const split = points.findIndex((point) => point.timestampMs >= latest.timestampMs - 420)
          const labelX = Math.min(width - 27 * labelScale, Math.max(27 * labelScale,
            latest.elbow.x * width + (side === 'left' ? -43 : 43) * labelScale))
          const labelY = Math.max(17 * labelScale, latest.elbow.y * height - 21 * labelScale)
          return (
            <g key={side} className="arm-trail" data-side={side}>
              <polyline
                className="arm-segments"
                points={[latest.shoulder, latest.elbow, latest.wrist].map((point) => `${point.x * width},${point.y * height}`).join(' ')}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {joints.map((joint) => {
                const stroke = joint === 'wrist' ? 4 : 2.5
                const trace = (start: number, end?: number) => points.slice(start, end)
                  .map((point) => `${point[joint].x * width},${point[joint].y * height}`).join(' ')
                const recent = trace(split)
                return (
                  <g key={joint}>
                    {split > 0 && <polyline className="arm-tail" points={trace(0, split + 1)} strokeWidth={stroke} opacity="0.42" vectorEffect="non-scaling-stroke" />}
                    {split < points.length - 1 && <polyline className="arm-tail" points={recent} strokeWidth={stroke} vectorEffect="non-scaling-stroke" />}
                    <circle cx={latest[joint].x * width} cy={latest[joint].y * height} r={markerSize} className={`arm-marker arm-marker-${joint}`} />
                  </g>
                )
              })}
              <g className="arm-angle-label" transform={`translate(${labelX} ${labelY}) scale(${mirrored ? -labelScale : labelScale} ${labelScale})`}>
                <rect x="-25" y="-14" width="50" height="28" rx="8" />
                <text textAnchor="middle" dominantBaseline="central">{Math.round(latest.angle)}°</text>
              </g>
            </g>
          )
        })}
      </svg>
      <div className="arm-legend" aria-label="手腕和手肘的动作轨迹">
        {sides.map((side) => (
          <span key={side} data-side={side} data-visible={trails[side].length > 0}>
            <span className="arm-legend-dot" aria-hidden="true" />
            {armNames[side]}
            <span className="arm-legend-state">{trails[side].length > 0 ? '清晰' : '未看清'}</span>
          </span>
        ))}
      </div>
    </>
  )
}
