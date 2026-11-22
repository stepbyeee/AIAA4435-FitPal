import { useMemo, useState } from 'react'
import { Figure, useDemoPull } from '../components/Figure'
import type { CosmeticId } from '../data/collection'
import { IN_RANGE } from '../contract'
import { EXERCISES, type Half } from '../data/exercises'
import { balanceOf, GEAR, gearState, type GearId, type GearItem } from '../data/gear'
import { lastSessionOf, levelOf, repsByExercise, repsByHalf, totalExp, type LastSet, type SessionRecord } from '../data/history'

type Props = {
  cosmetic: CosmeticId | null
  history: SessionRecord[]
  gear: readonly GearId[]
  onBuy: (id: GearId) => void
  onStart: (exerciseId: string, file?: File) => void
}

const LEFT_OVER: Record<string, (n: number) => string> = {
  short_range: (n) => `上次最后一组有 ${n} 下没到校准的目标范围。`,
  out_of_view: (n) => n > 0 ? `上次最后一组有 ${n} 下镜头没看清。` : '上次最后一组镜头没看清。',
}

function lastSetLine(last: LastSet | undefined) {
  if (!last) return '还没有上一次的记录。'
  if (!last.issue) {
    const verified = last.depths.filter((depth) => depth !== null).length
    return verified ? `上次最后一组确认了 ${verified} 下。` : '上次最后一组没有可确认的动作。'
  }
  return LEFT_OVER[last.issue.id]?.(last.issue.count) ?? '上次最后一组还有问题没改掉。'
}

export function Home({ cosmetic, history, gear, onBuy, onStart }: Props) {
  const [replayExercise, setReplayExercise] = useState('lat-pulldown')
  const [trying, setTrying] = useState<GearId | null>(null)
  const [pulling, setPulling] = useState(false)
  const reps = useMemo(() => repsByExercise(history), [history])
  const trained = useMemo(() => repsByHalf(history), [history])
  const { level, into, span, toNext } = levelOf(totalExp(history))
  const balance = balanceOf(level, gear)
  const q = useDemoPull(pulling)
  const worn = trying && !gear.includes(trying) ? [...gear, trying] : gear

  const today = EXERCISES.find((e) => e.available)
  const later = EXERCISES.filter((e) => e !== today).sort((a, b) => Number(b.available) - Number(a.available))
  const last = today ? lastSessionOf(history, today.id)?.lastSet : undefined

  const rack = (half: Half) => (
    <ul className={`gear gear-${half}`}>
      {trained[half] <= 0 && <li className="gear-note">{half === 'upper' ? '练过上半身才能换' : '练过下半身才能换'}</li>}
      {GEAR.filter((g) => g.half === half).map((g) => (
        <li key={g.id}>
          <GearButton item={g} state={gearState(g, gear, balance, trained)} onBuy={onBuy} onTry={setTrying} />
        </li>
      ))}
    </ul>
  )

  return (
    <main className="home">
      <section className="hero" aria-label="你的角色">
        <p className="points num">
          {balance}
          <small> 点可用</small>
        </p>
        <div className="hero-body">
          {rack('upper')}
          <Figure cosmetic={cosmetic} q={q} gear={worn} label={`你的角色，等级 ${level}`} />
          {rack('lower')}
        </div>
        <div className="level">
          <div className="level-line">
            <span className="level-now num">Lv {level}</span>
            <span className="level-next num">
              再 {toNext} EXP 到 Lv {level + 1}
            </span>
          </div>
          <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into}>
            <div className="track-fill" style={{ width: `${(into / span) * 100}%` }} />
          </div>
        </div>
      </section>

      <div className="side">
        <h1 className="title">今天练什么</h1>

        {today && (
          <section className="focus" onPointerEnter={() => setPulling(true)} onPointerLeave={() => setPulling(false)}>
            <h2 className="focus-name">{today.name}</h2>
            <p className="focus-say">{lastSetLine(last)}</p>
            {last && <Depths depths={last.depths} />}
            <div className="focus-foot">
              <span className="focus-reps num">
                {reps[today.id] ?? 0}
                <small> 次</small>
              </span>
              <button className="pill pill-big" onClick={() => onStart(today.id)} onFocus={() => setPulling(true)} onBlur={() => setPulling(false)}>
                开始
              </button>
            </div>
          </section>
        )}

        <ul className="picker">
          {later.map((e) => (
            <li key={e.id} className="exercise">
              <span className="exercise-name">{e.name}</span>
              {e.id === 'seated-row' && !new URLSearchParams(window.location.search).has('study') &&
                <a className="row-lab-link" href="#/lab/seated-row">侧面计数 · 实验</a>}
              {e.available
                ? <button className="start-exercise" onClick={() => onStart(e.id)} aria-label={`开始${e.name}`}>开始训练 <span aria-hidden="true">↗</span></button>
                : <a className="manual-start" href={`#/manual/${e.id}`}>手动记录</a>}
            </li>
          ))}
        </ul>
        <details className="replay-library">
          <summary>录像回放</summary>
          <div>
            <p>选一段有连续动作的录像。前三次用于校准，视频只在本机播放。</p>
            <label>录像中的动作
              <select value={replayExercise} onChange={e => setReplayExercise(e.target.value)}>
                {EXERCISES.filter(e => e.available).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label>选择本地录像<input type="file" accept="video/*" onChange={e => {
              const file = e.target.files?.[0]
              if (file) onStart(replayExercise, file)
            }} /></label>
            <div className="demo-links">
              <a href="?video=go4it-rear#/session/lat-pulldown">高位下拉示范 ↗</a>
              <a href="?video=goblet-squat#/session/squat">深蹲示范 ↗</a>
            </div>
          </div>
        </details>
      </div>
    </main>
  )
}

function GearButton({ item, state, onBuy, onTry }: { item: GearItem; state: ReturnType<typeof gearState>; onBuy: (id: GearId) => void; onTry: (id: GearId | null) => void }) {
  const canBuy = state === 'ok'
  return (
    <button
      className="gear-item"
      data-state={state}
      disabled={!canBuy}
      aria-label={state === 'owned' ? `${item.name}，已穿上` : `${item.name}，${item.cost} 点`}
      onClick={() => onBuy(item.id)}
      onPointerEnter={() => canBuy && onTry(item.id)}
      onPointerLeave={() => onTry(null)}
      onFocus={() => canBuy && onTry(item.id)}
      onBlur={() => onTry(null)}
    >
      <span>{item.name}</span>
      {state === 'owned' ? (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        state !== 'locked' && <span className="gear-cost num">{item.cost} 点</span>
      )}
    </button>
  )
}

/** How deep each rep of a set went, against the line a rep has to reach. */
function Depths({ depths }: { depths: (number | null)[] }) {
  const short = depths.filter((d) => d !== null && d < IN_RANGE).length
  const unseen = depths.filter((d) => d === null).length
  return (
    <div className="depths" role="img" aria-label={`${depths.length} 下：${short} 下没到位，${unseen} 下没看清`}>
      {depths.map((d, i) =>
        d === null ? <i key={i} className="depth-unseen" /> : <i key={i} className={d < IN_RANGE ? 'depth-short' : undefined} style={{ height: `${d * 100}%` }} />,
      )}
      <span className="depths-target" style={{ bottom: `${IN_RANGE * 100}%` }} />
    </div>
  )
}
