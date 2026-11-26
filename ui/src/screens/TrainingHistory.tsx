import { useState } from 'react'
import { StorageSettings } from '../components/StorageSettings'
import { listManual } from '../data/manualLog'
import { exerciseById } from '../data/exercises'
import { sessionExp, sessionReps, type SessionRecord } from '../data/history'
import { focusNames } from '../training/plan'
import { seconds } from '../training/MotionPanels'
import { downloadReport } from '../training/report'

export function TrainingHistory({ history, preview }: { history: SessionRecord[]; preview: boolean }) {
  const [manual] = useState(() => preview ? [] : listManual())
  const [exercise, setExercise] = useState(history.at(-1)?.exerciseId ?? 'lat-pulldown')
  const recent = history.filter(h => h.exerciseId === exercise).flatMap(h => h.sets.map((s, i) => ({ ...s, date: h.date, index: i }))).filter(s => s.motion?.medianDurationMs !== null && s.motion?.medianDurationMs !== undefined).slice(-12)
  return <main className="history-page">
    <h1>{preview ? '角色预览记录' : '训练记录'}</h1>
    {history.length > 0 && <section className="history-trends" aria-label="训练趋势">
      <h2>训练趋势</h2><label>查看动作 <select aria-label="历史趋势动作" value={exercise} onChange={e => setExercise(e.target.value)}>
        {[...new Set(history.map(h => h.exerciseId))].map(id => <option key={id} value={id}>{exerciseById(id)?.name ?? id}</option>)}
      </select></label>
      <p>最近 {recent.length} 组有计时记录。整次动作时间的变化不直接代表进步；需要同时考虑目标、幅度、负重和机位。</p>
      {recent.length > 0 && <svg viewBox="0 0 480 120" role="img" aria-label="最近训练组的整次动作时间">
        {recent.map((s, i) => {
          const value = s.motion!.medianDurationMs!, max = Math.max(...recent.map(r => r.motion!.medianDurationMs!), 1000)
          const x = 18 + (i + .5) * 440 / recent.length, y = 90 - value / max * 65
          return <g key={i}><line x1={x} x2={x} y1="90" y2={y} stroke="var(--accent)" strokeWidth={Math.min(18, 250 / recent.length)} />
            <text x={x} y={y - 8} textAnchor="middle" fill="currentColor" fontSize="11">{(value / 1000).toFixed(1)}s</text>
            <text x={x} y="110" textAnchor="middle" fill="currentColor" fontSize="9">{i + 1}</text>
            <title>{s.date} 第 {s.index + 1} 组：{seconds(value)}</title></g>
        })}
      </svg>}
      <button className="report-export" onClick={() => downloadReport({ schemaVersion: 1, source: 'local-history', history }, 'fitpal-training-history.json')}>导出训练历史</button>
    </section>}
    {history.length === 0
      ? <div className="history-empty"><h2>还没有摄像头训练记录</h2><p>用摄像头完成训练后，可以在这里查看每组的次数和 EXP。</p></div>
      : <ol className="history-list">{[...history].reverse().map((entry, i) => <li key={i}>
        <header><div><time>{entry.date}</time><h2>{exerciseById(entry.exerciseId)?.name ?? entry.exerciseId}</h2></div>
          <strong>+{sessionExp(entry)} EXP</strong></header>
        <p>{entry.sets.length} 组 · 共确认 {sessionReps(entry)} 下</p>
        <dl>{entry.sets.map((set, index) => <div key={index}><dt>第 {index + 1} 组</dt><dd>{set.verified} 下</dd></div>)}</dl>
        {entry.sets.map((set, index) => (set.plan || set.motion) && <p key={index} className="history-metrics">第 {index + 1} 组 · {set.plan ? `${focusNames[set.plan.focus]} · 目标 ${set.plan.reps} 次${set.plan.loadKg === null ? '' : ` · 自填 ${set.plan.loadKg} kg`}` : '未记录目标'}
          {set.motion && <> · 整次 {seconds(set.motion.medianDurationMs)} · 还原 {seconds(set.motion.medianReturnMs)} · 个人幅度 {set.motion.medianRange === null ? '—' : `${Math.round(set.motion.medianRange * 100)}%`} · {set.motion.measuredReps} 下有完整记录</>}</p>)}
        {entry.lastSet && <p className="history-last">最后一组 · {entry.lastSet.issue?.id === 'short_range'
          ? `${entry.lastSet.issue.count} 下幅度偏短`
          : entry.lastSet.issue?.id === 'trunk_swing' ? `${entry.lastSet.issue.count} 下起拉时上身后摆`
            : entry.lastSet.issue?.id === 'out_of_view' ? '镜头有遮挡' : '没有待改进提示'}</p>}
      </li>)}</ol>}
    {manual.length > 0 && <section className="manual-history"><h2>手动记录</h2><ol className="history-list">
      {manual.map(row => <li key={row.id}><time>{row.date}</time><p>{exerciseById(row.exerciseId)?.name} · {row.reps} 下</p></li>)}
    </ol></section>}
    {!preview && <StorageSettings />}
    <a href="#/">返回首页</a>
  </main>
}
