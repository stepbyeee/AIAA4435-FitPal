import { useState } from 'react'
import { StorageSettings } from '../components/StorageSettings'
import { listManual } from '../data/manualLog'
import { exerciseById } from '../data/exercises'
import { sessionExp, sessionReps, type SessionRecord } from '../data/history'

export function TrainingHistory({ history, preview }: { history: SessionRecord[]; preview: boolean }) {
  const [manual] = useState(() => preview ? [] : listManual())
  return <main className="history-page">
    <h1>{preview ? '角色预览记录' : '训练记录'}</h1>
    {history.length === 0
      ? <div className="history-empty"><h2>还没有摄像头训练记录</h2><p>用摄像头完成训练后，可以在这里查看每组的次数和 EXP。</p></div>
      : <ol className="history-list">{[...history].reverse().map((entry, i) => <li key={i}>
        <header><div><time>{entry.date}</time><h2>{exerciseById(entry.exerciseId)?.name ?? entry.exerciseId}</h2></div>
          <strong>+{sessionExp(entry)} EXP</strong></header>
        <p>{entry.sets.length} 组 · 共确认 {sessionReps(entry)} 下</p>
        <dl>{entry.sets.map((set, index) => <div key={index}><dt>第 {index + 1} 组</dt><dd>{set.verified} 下</dd></div>)}</dl>
        {entry.lastSet && <p className="history-last">最后一组 · {entry.lastSet.issue?.id === 'short_range'
          ? `${entry.lastSet.issue.count} 下幅度偏短`
          : entry.lastSet.issue?.id === 'out_of_view' ? '镜头有遮挡' : '没有待改进提示'}</p>}
      </li>)}</ol>}
    {manual.length > 0 && <section className="manual-history"><h2>手动记录</h2><ol className="history-list">
      {manual.map(row => <li key={row.id}><time>{row.date}</time><p>{exerciseById(row.exerciseId)?.name} · {row.reps} 下</p></li>)}
    </ol></section>}
    {!preview && <StorageSettings />}
    <a href="#/">返回首页</a>
  </main>
}
