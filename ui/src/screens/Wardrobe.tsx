import { useEffect, useState } from 'react'
import { Figure } from '../components/Figure'
import { cosmetics, ticketTotals } from '../data/collection'
import type { useCollection } from '../data/collectionStore'
import type { GearId } from '../data/gear'
import { loadHistory, today } from '../data/history'
import './wardrobe.css'

type Props = { collection: ReturnType<typeof useCollection>; gear: readonly GearId[]; preview?: boolean }

export function Wardrobe({ collection, gear, preview = false }: Props) {
  const { state, ready, busy, error, change } = collection
  const [date, setDate] = useState(today)
  useEffect(() => {
    const refresh = () => setDate(today())
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  const { earned, available } = ticketTotals(state, loadHistory())
  const claimed = state.claimedDays.includes(date)
  const full = state.owned.length === cosmetics.length
  const disabled = !ready || busy || preview
  return <main className="session wardrobe">
    <header className="session-head"><a href="#/" className="back" aria-label="返回首页">‹</a><h1 className="title">角色收藏</h1></header>
    <section className="stage" aria-label="试穿角色"><Figure q={null} gear={gear} cosmetic={state.equipped} label="当前装扮" /></section>
    <aside className="panel"><div className="panel-body">
      <section>
        <h2>收藏券</h2>
        {ready ? <p className="note">可用 {available} 张 · 累计获得 {earned} 张</p> : !error && <p className="note">正在读取本地收藏…</p>}
        <p className="note">每天签到可领 1 张，完成一次有确认动作的摄像头训练再得 1 张。</p>
      </section>
      {preview && <p className="note">当前为角色预览。回到摄像头训练模式可领取和使用收藏券。</p>}
      {error && <p role="status">{error} <button className="pill" onClick={() => void collection.refresh()}>重新读取</button></p>}
      <div className="wardrobe-actions">
        <button className="pill" disabled={disabled || claimed} onClick={() => void change({type:'check-in'})}>
          {claimed ? '今天已签到' : '今日签到 · 领 1 张'}
        </button>
        <button className="pill" disabled={disabled || full || !available} onClick={() => void change({type:'draw'})}>
          {full ? '已集齐全部收藏' : '抽一件未拥有的装扮 · 1 张'}
        </button>
      </div>
      <section aria-label="收藏装扮" aria-live="polite"><h2>我的装扮 · {state.owned.length}/{cosmetics.length}</h2>
        <ul className="picker">{cosmetics.map(item => <li key={item.id} className="exercise">
          <span>{item.name}</span>
          {state.owned.includes(item.id)
            ? <button className="pill" disabled={disabled} aria-pressed={state.equipped === item.id}
                aria-label={(state.equipped === item.id ? '卸下' : '穿戴') + item.name}
                onClick={() => void change({ type:'equip', id:state.equipped === item.id ? null : item.id })}>
                {state.equipped === item.id ? '卸下' : '穿戴'}
              </button>
            : <span className="exercise-off">未解锁</span>}
        </li>)}</ul>
      </section>
    </div></aside>
  </main>
}
