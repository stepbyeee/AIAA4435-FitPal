import { useId, useState } from 'react'
import { IN_RANGE, type RepResult, type SetSummary } from '../contract'
import type { RepReviewData, RepTrace, ReviewSample } from '../perception/repReview'
import './rep-review.css'
import { SourceReview } from '../training/SourceReview'
import { measuredTime, type RepMetrics } from '../analytics/motion'

type Point = { x: number; y: number }
type Project = (sample: ReviewSample) => Point

function TraceLine({ trace, project }: { trace: RepTrace; project: Project }) {
  const segments = trace.samples.map((sample, i) => {
    const { x, y } = project(sample)
    return `${i === 0 || sample.breakBefore ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  })
  const bottom = trace.bottom && project(trace.bottom)
  return <>
    <path d={segments.join(' ')} className="review-line" />
    {trace.samples.filter((s, i) => i === 0 || s.breakBefore).map(s => {
      const p = project(s)
      return <circle key={s.ms} cx={p.x} cy={p.y} r="1.8" className="review-point" />
    })}
    {bottom && <circle cx={bottom.x} cy={bottom.y} r="3.4" className="review-bottom" />}
  </>
}

function Traces({ trace, calibration, duration, mirrored, squat }: {
  trace: RepTrace; calibration: SetSummary['calibration']; duration: number; mirrored: boolean; squat: boolean
}) {
  const joint = squat ? '膝' : '肘'
  const { samples } = trace
  const target = calibration.thetaTop - IN_RANGE * (calibration.thetaTop - calibration.thetaBottom)
  const high = Math.max(calibration.thetaTop, ...samples.map(s => s.angle))
  const low = Math.min(calibration.thetaBottom, ...samples.map(s => s.angle))
  const angleY = (angle: number) => 8 + (high - angle) / Math.max(high - low, 1) * 72
  const xs = samples.map(s => mirrored ? -s.x : s.x)
  const ys = samples.map(s => s.y)
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2
  const scale = 70 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.04)

  return <div className="review-plots">
    <figure>
      <figcaption>投影{joint}角</figcaption>
      <svg viewBox="0 0 190 88" role="img" aria-label={`${joint}角随时间变化，虚线为个人达标角度 ${Math.round(target)} 度`}>
        <line x1="4" x2="186" y1={angleY(target)} y2={angleY(target)} className="review-target" />
        <TraceLine trace={trace} project={s => ({ x: 5 + 180 * s.ms / Math.max(duration, 1), y: angleY(s.angle) })} />
      </svg>
      <span>白点 · 底部　虚线 · 达标角 {Math.round(target)}°</span>
    </figure>
    <figure>
      <figcaption>{squat ? '髋部轨迹' : '腕部轨迹'}</figcaption>
      <svg viewBox="0 0 88 88" role="img" aria-label={squat ? '相对同侧脚踝的髋部运动轨迹' : '相对同侧肩膀的手腕运动轨迹'}>
        <TraceLine trace={trace} project={s => ({
          x: 44 + ((mirrored ? -s.x : s.x) - cx) * scale,
          y: 44 + (s.y - cy) * scale,
        })} />
      </svg>
      <span>相对同侧{squat ? '脚踝' : '肩膀'}</span>
    </figure>
  </div>
}

const statusText = (rep: RepResult) => rep.status === 'cannot_verify'
  ? '未看清' : rep.qMax === null ? '已计数 · 幅度未评估' : rep.qMax < IN_RANGE ? '未达标' : '已达标'

export function RepReview({ summary, review, mirrored = false, videoFile, metrics }: {
  summary: SetSummary; review: RepReviewData; mirrored?: boolean; videoFile?: string | null; metrics?: RepMetrics[]
}) {
  const squat = summary.exerciseId === 'squat'
  const joint = squat ? '膝' : '肘'
  const [chosen, choose] = useState<number | null>(null)
  const detailId = useId()
  if (!summary.reps.length) return null
  const preferred = summary.issues.find(issue => issue.id === 'out_of_view')
    ?? summary.issues.find(issue => issue.id === 'trunk_swing')
    ?? summary.issues.find(issue => issue.id === 'short_range')
  const selected = chosen !== null && summary.reps[chosen] ? chosen : preferred?.repIndexes[0] ?? 0
  const rep = summary.reps[selected]
  const trace = review.traces.find(item => item.repIndex === selected)
  const verified = rep.status === 'verified'
  const timed = metrics !== undefined
  const maxTime = Math.max(1, ...(metrics ?? []).map(r => measuredTime(r) ?? 0))
  const selectedTime = timed ? measuredTime(metrics[selected]) : rep.durationMs
  const outboundMs = metrics ? metrics[selected]?.outboundMs ?? null : trace?.bottom?.ms ?? null
  const returnMs = metrics ? metrics[selected]?.returnMs ?? null : trace?.bottom ? rep.durationMs - trace.bottom.ms : null
  const rounded = rep.qMax === null ? null : Math.round(rep.qMax * 100)
  const percentage = rep.qMax !== null && rep.qMax < IN_RANGE && rounded === IN_RANGE * 100 ? `<${rounded}` : String(rounded)
  return <section className="rep-review" aria-label="逐次动作回顾" data-side={review.side} data-timed={timed}>
    <div className="review-heading"><h3>逐次回顾</h3><span>{summary.calibration.basis === 'upper-arm' ? '上臂计数' : `个人幅度目标 ${IN_RANGE * 100}%`}</span></div>
    {timed && <p className="review-key">柱高表示整次用时 · 点一下看详情</p>}
    <div className="review-choices" role="group" aria-label="选择要回顾的动作">
      {summary.reps.map((result, index) => {
        const duration = timed ? measuredTime(metrics[index]) : null
        return <button type="button" key={index}
        aria-pressed={index === selected} aria-controls={detailId}
        aria-label={`第 ${index + 1} 下，${statusText(result)}${timed ? duration === null ? '，整次计时不足' : `，整次 ${(duration / 1000).toFixed(2)} 秒` : ''}${result.trunkForm?.status === 'swing' ? '，起拉后摆' : ''}`}
        data-status={result.status === 'cannot_verify' ? 'gap' : result.qMax === null ? 'count-only' : result.qMax < IN_RANGE ? 'short' : 'met'}
        onClick={() => choose(index)}>
        <span className="review-meter" aria-hidden="true">
          {timed ? duration === null ? '—' : <i style={{ height: `${duration / maxTime * 100}%` }} /> : result.status === 'verified' && result.qMax !== null ? <i style={{ height: `${result.qMax * 100}%` }} /> : '—'}
        </span>
        <small>{index + 1}</small>
        {timed && <small className="review-seconds">{duration === null ? '—' : `${(duration / 1000).toFixed(2)}s`}</small>}
        {result.trunkForm?.status === 'swing' && <span className="form-mark" aria-hidden="true">后摆</span>}
      </button>})}
    </div>
    <div id={detailId} className="review-detail">
      <div className="review-heading">
        <strong>第 {selected + 1} 下 · {statusText(rep)}</strong>
        <span>{rep.qMax !== null && `${review.side === 'left' ? '左' : '右'}${joint} · `}{selectedTime === null ? '整次计时不足' : `${timed ? '整次 ' : ''}${(selectedTime / 1000).toFixed(2)} 秒`}</span>
      </div>
      <p>{verified && rep.qMax === null ? '上臂完成了一次下拉和还原。腕部证据不足，无法计算个人幅度。' : verified
        ? `达到个人校准幅度的 ${percentage}%${trace?.bottom ? `，底部${joint}角 ${Math.round(trace.bottom.angle)}°` : ''}。`
        : '动作中途丢失关键点。这一下不评幅度，也不计 EXP。'}</p>
      {summary.assessesTrunkForm && <p className="trunk-evidence" data-form={rep.trunkForm?.status ?? 'unavailable'}>
        {rep.trunkForm?.status === 'swing'
          ? `下拉阶段确认${rep.trunkForm.atMs < 0 ? '前' : '后'} ${(Math.abs(rep.trunkForm.atMs) / 1000).toFixed(2)} 秒，上身比稳定起点向后偏转约 ${rep.trunkForm.changeDeg}°（侧面投影）。`
          : rep.trunkForm ? '起拉阶段未检测到明显后摆。' : '起拉后摆未评估。需要侧面固定机位，并看清肩、髋和起拉动作。'}
      </p>}
      {verified && rep.qMax !== null && (timed
        ? <details className="timing-details"><summary>查看这一下一共怎样用时</summary><p className="rep-timing">{outboundMs !== null && returnMs !== null ? <>跟踪起点至底部 {(outboundMs / 1000).toFixed(2)} 秒 · 底部至确认返回 {(returnMs / 1000).toFixed(2)} 秒</> : '连续画面不足，暂不显示分段时间'}</p></details>
        : <p className="rep-timing">{outboundMs !== null && returnMs !== null && <>跟踪起点至底部 {(outboundMs / 1000).toFixed(1)} 秒 · 底部至确认返回 {(returnMs / 1000).toFixed(1)} 秒</>}</p>)}
      {summary.calibration.basis === 'upper-arm' || (verified && rep.qMax === null) ? null : trace
        ? <Traces trace={trace} calibration={summary.calibration} duration={rep.durationMs} mirrored={mirrored} squat={squat} />
        : <p>本组保留最近 32 下的详细轨迹。</p>}
      {metrics?.[selected] && <p>左右配合：{metrics[selected].bilateralLagMs === null ? metrics[selected].bilateralReason : `右侧相对左侧还原中点 ${metrics[selected].bilateralLagMs} 毫秒 · 实验观察，不评分`}</p>}
      {videoFile && trace && <SourceReview key={selected} source={videoFile} trace={trace} durationMs={rep.durationMs} />}
      {!videoFile && metrics && <p className="motion-note">摄像头画面未录制；本次只保留动作曲线，离开后不保留逐帧数据。</p>}
    </div>
  </section>
}
