import { useRef, useState } from 'react'
import type { RepTrace } from '../perception/repReview'

/** A separate, inference-free player: seeking must never alter a live counter. */
export function SourceReview({ source, trace, durationMs }: { source: string; trace: RepTrace; durationMs: number }) {
  const video = useRef<HTMLVideoElement>(null)
  const start = trace.startedAtMs
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState(false)
  if (start === undefined) return <p>这条记录没有对应录像时间。</p>
  const seek = (ms: number) => {
    const bounded = Math.max(0, Math.min(durationMs, ms))
    setOffset(bounded)
    if (video.current?.readyState) { video.current.pause(); video.current.currentTime = (start + bounded) / 1000 }
  }
  const nearest = trace.samples.reduce<typeof trace.samples[number] | undefined>((best, sample) => !best || Math.abs(sample.ms - offset) < Math.abs(best.ms - offset) ? sample : best, undefined)
  const angle = nearest && Math.abs(nearest.ms - offset) <= 150 && !nearest.breakBefore ? nearest.angle : null
  return <section className="source-review" aria-label="录像证据">
    <h4>录像证据 · 第 {trace.repIndex + 1} 下</h4>
    <video ref={video} src={source} muted playsInline controls preload="metadata"
      onLoadedMetadata={() => seek(0)} onError={() => setError(true)}
      onTimeUpdate={() => {
        const node = video.current
        if (!node) return
        const ms = node.currentTime * 1000 - start
        setOffset(Math.max(0, Math.min(durationMs, ms)))
        if (ms > durationMs + 100 || ms < -100) { node.pause(); node.currentTime = (start + Math.max(0, Math.min(durationMs, ms))) / 1000 }
      }} />
    <label>这一下的第几秒 · {(offset / 1000).toFixed(2)} / {(durationMs / 1000).toFixed(2)} s
      <input aria-label="回顾时间" type="range" min="0" max={durationMs} step="20" value={offset} onChange={e => seek(Number(e.target.value))} />
    </label>
    <p>录像位置 {((start + offset) / 1000).toFixed(2)} s · 对应投影角 {angle === null ? '暂无可靠样本' : `${Math.round(angle)}°`}</p>
    {trace.bottom && <button onClick={() => seek(trace.bottom!.ms)}>查看最低点</button>}
    {error && <p role="alert">原录像目前无法播放，已有动作摘要仍可查看。</p>}
  </section>
}
