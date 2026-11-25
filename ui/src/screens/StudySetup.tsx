import { StudySummary } from '../components/StudySummary'
import { useState } from 'react'
import { assignmentFor, parseGrowth, parseParticipant, parsePeriod, trialPath, type ConditionId, type Growth, type Period, type TrialSource } from '../study/assignment'

const periods: Period[] = [1, 2, 3, 4]
const names: Record<ConditionId, string> = {
  'rep-card': '逐次 · 关节目标卡',
  'rep-text': '逐次 · 文字',
  'set-card': '组后 · 关节目标卡',
  'set-text': '组后 · 文字',
}

export function StudySetup() {
  const params = new URLSearchParams(window.location.search)
  const [id, setId] = useState(params.get('participant') ?? '')
  const [period, setPeriod] = useState<Period>(parsePeriod(params.get('period')) ?? 1)
  const [growthChoice, setGrowthChoice] = useState<Growth | 'auto'>(parseGrowth(params.get('growth')) ?? 'auto')
  const [source, setSource] = useState<TrialSource>(params.get('video') === 'go4it-rear' ? 'recording' : 'camera')
  const participant = parseParticipant(id)
  const assigned = participant === null ? null : assignmentFor(participant, period)
  const growth = growthChoice === 'auto' ? assigned?.growth : growthChoice
  return <main className="study-setup">
    <style>{`
      .study-setup { width: min(100%, 720px); margin: 0 auto; padding: clamp(16px, 4vh, 40px) 0; overflow: auto; }
      .study-setup h1 { margin: 12px 0 8px; font-size: clamp(26px, 4.5vw, 40px); }
      .study-setup form { display: grid; gap: 18px; background: var(--surface); border: 1px solid var(--rule); padding: clamp(16px, 3vw, 28px); border-radius: 18px; }
      .study-summary { margin: 16px 0; padding: 16px; border: 1px solid var(--rule); border-radius: 12px; }
      .study-summary summary { cursor: pointer; font-weight: 600; }
      .study-summary dd { margin: 2px 0 12px; font-variant-numeric: tabular-nums; }
      .study-setup header { margin-bottom: 20px; }
      .study-setup .study-back, .study-setup .study-help { color: var(--muted); font-size: 14px; }
      .study-setup .study-fields { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit,minmax(min(190px,100%),1fr)); }
      .study-setup label { display: grid; gap: 6px; color: var(--text); }
      .study-setup select, .study-setup input { min-width: 0; min-height: 40px; background: var(--raised); color: var(--text); border: 1px solid var(--rule); border-radius: 7px; padding: 8px; font: inherit; }
      .study-setup .study-order { padding: 0; list-style: none; display: grid; gap: 5px; }
      .study-setup .study-order li { padding: 7px 10px; border-radius: 7px; color: var(--muted); }
      .study-setup .study-order [aria-current] { color: var(--text); background: var(--raised); box-shadow: inset 3px 0 var(--accent); }
      .study-setup .pill:disabled { opacity: .45; cursor: default; }
    `}</style>
    <header>
      <a className="study-back" href={window.location.pathname + '#/'}>返回 FitPal</a>
      <h1>课堂试测设置</h1>
      <p className="study-help">主持人填写匿名编号，每位参与者完成四轮高位下拉。每轮结束后导出评分。</p>
    </header>
    <form onSubmit={event => {
      event.preventDefault()
      if (participant && growth) window.location.assign(trialPath(window.location.pathname, { participant, period, growth, source }))
    }}>
      <div className="study-fields">
        <label>匿名参与者编号
          <input type="text" inputMode="numeric" placeholder="1–99" required value={id}
            aria-invalid={id.length > 0 && !participant} onChange={e => { setId(e.target.value); setGrowthChoice('auto') }} />
        </label>
        <label>当前轮次
          <select value={period} onChange={e => setPeriod(parsePeriod(e.target.value) ?? 1)}>
            {periods.map(n => <option value={n} key={n}>第 {n} 轮</option>)}
          </select>
        </label>
        <label>视频来源
          <select value={source} onChange={e => setSource(e.target.value === 'recording' ? 'recording' : 'camera')}>
            <option value="camera">参与者的本地摄像头</option>
            <option value="recording">随项目的高位下拉录像 · 流程预演</option>
          </select>
        </label>
        <label>EXP 展示
          <select value={growthChoice} onChange={e => setGrowthChoice(parseGrowth(e.target.value) ?? 'auto')}>
            <option value="auto">按匿名编号分配</option><option value="visible">显示 EXP</option><option value="hidden">隐藏 EXP</option>
          </select>
        </label>
      </div>
      {participant && assigned && <section aria-label="本次分配" aria-live="polite">
        <p>编号 {participant} · {growth === 'visible' ? '显示 EXP' : '隐藏 EXP'}</p>
        <ol className="study-order">
          {periods.map(n => <li key={n} aria-current={period === n ? 'step' : undefined}>
            第 {n} 轮　{names[assignmentFor(participant, n).condition]}
          </li>)}
        </ol>
      </section>}
      {id.length > 0 && !participant && <p className="study-help" role="alert">请填写 1 到 99 的整数编号。</p>}
      <button type="submit" className="pill" disabled={!assigned}>开始第 {period} 轮</button>
    </form>
    <StudySummary />
    <p><a href="#/label">标注本地测试视频</a></p>
  </main>
}
