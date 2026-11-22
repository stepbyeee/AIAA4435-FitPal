import { useState } from 'react'
import { saveManual } from '../data/manualLog'
import type { Exercise } from '../data/exercises'

export function ManualSet({ exercise, preview }: { exercise: Exercise; preview: boolean }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  return <main className="history-page manual-page">
    <a href="#/">‹ 返回首页</a>
    <h1>{exercise.name}</h1>
    {exercise.id === 'seated-row' && !preview && <p><a className="row-lab-link" href="#/lab/seated-row">试用侧面摄像头计数</a></p>}
    <form onSubmit={event => {
      event.preventDefault()
      if (preview || !saveManual(exercise.id, Number(value))) { setError(true); return }
      window.location.hash = '/history'
    }}>
      <h2>手动记录一组</h2>
      <p>保存今天的动作和次数。只有摄像头确认的训练会获得 EXP。</p>
      <label>这组做了几次<input type="number" inputMode="numeric" min="1" max="999" step="1" required value={value} onChange={e => setValue(e.target.value)} /></label>
      {preview && <p>从训练首页打开手动记录即可保存这一组。</p>}
      {error && <p role="alert">保存失败，请检查次数和浏览器的本地存储设置。</p>}
      <button className="pill" disabled={preview}>保存这一组</button>
    </form>
  </main>
}
