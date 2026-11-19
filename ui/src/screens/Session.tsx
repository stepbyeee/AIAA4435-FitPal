import { useEffect, useReducer, useRef, useState } from 'react'
import { Figure, useDemoPull } from '../components/Figure'
import { Skeleton } from '../components/Skeleton'
import { expOfResult, IN_RANGE, type FrameState, type SetResult, type SetSummary } from '../contract'
import type { Exercise } from '../data/exercises'
import { POINTS_PER_LEVEL, type GearId } from '../data/gear'
import { levelOf, saveSession, today, totalExp, type SessionRecord } from '../data/history'
import { settle } from '../mock/feedback'
import { startMockSource, type Source } from '../mock/perception'
import { FRAME } from '../pose'
import { useStageVideo } from '../tracking/useStageVideo'
import { initialSession, reduce } from '../session/session'

const TARGET_REPS = 10
const CALIBRATION_REPS = 3
const TOTAL_SETS = 3
/** Back at the top and still for this long ends the set. Space ends it at once. */
const IDLE_END_MS = 5000

const REST: FrameState = { phase: 'ready', q: 0, visible: true, repCount: 0, landmarks: null }

type Props = {
  exercise: Exercise
  history: SessionRecord[]
  gear: readonly GearId[]
  useCamera: boolean
  /** A recorded clip to play on the stage instead of the camera. */
  videoFile: string | null
  onSaved: (history: SessionRecord[]) => void
  onExit: () => void
}

export function Session({ exercise, history, gear, useCamera, videoFile, onSaved, onExit }: Props) {
  const [state, dispatch] = useReducer(reduce, TOTAL_SETS, initialSession)
  const [frame, setFrame] = useState<FrameState>(REST)
  const [idleMs, setIdleMs] = useState(0)
  const sourceRef = useRef<Source | null>(null)
  const finishRef = useRef<() => void>(() => {})
  const lastIssueRef = useRef<string | null>(null)
  const lastSummaryRef = useRef<SetSummary | null>(null)
  // EXP before this session, so the result does not depend on when the save lands.
  const startExp = useRef(totalExp(history))
  lastIssueRef.current = state.lastIssueId

  const live = state.stage === 'calibrating' || state.stage === 'set'

  // Run the perception source while a set or the calibration is on.
  useEffect(() => {
    if (!live) return
    const calibrating = state.stage === 'calibrating'
    let over = false
    let idleSince: number | null = null

    const finish = () => {
      if (over) return
      over = true
      const summary = source.endSet()
      lastSummaryRef.current = summary
      source.stop()
      setIdleMs(0)
      dispatch({ type: 'setEnded', result: settle(summary, lastIssueRef.current) })
    }

    const source = startMockSource(
      { exerciseId: exercise.id, setIndex: state.setIndex, targetReps: calibrating ? CALIBRATION_REPS : TARGET_REPS, fullDepth: calibrating },
      (f) => {
        if (over) return
        setFrame(f)
        if (calibrating) {
          if (f.repCount >= CALIBRATION_REPS) {
            over = true
            source.stop()
            dispatch({ type: 'calibrated' })
          }
          return
        }
        if (f.phase === 'ready' && f.repCount > 0) {
          const now = performance.now()
          idleSince ??= now
          setIdleMs(now - idleSince)
          if (now - idleSince >= IDLE_END_MS) finish()
        } else if (idleSince !== null) {
          idleSince = null
          setIdleMs(0)
        }
      },
    )
    sourceRef.current = source
    finishRef.current = calibrating ? () => {} : finish
    setFrame(REST)
    return () => {
      over = true
      source.stop()
      sourceRef.current = null
      finishRef.current = () => {}
    }
  }, [live, state.stage, state.setIndex, exercise.id])

  // Space ends the set by hand. V hides the user from the stand-in camera, to show that state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLButtonElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        finishRef.current()
      } else if (e.code === 'KeyV') {
        sourceRef.current?.toggleVisible()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the session once it is done.
  const saved = useRef(false)
  useEffect(() => {
    if (state.stage !== 'done' || saved.current) return
    saved.current = true
    const last = lastSummaryRef.current
    const issue = last?.issues[0]
    onSaved(
      saveSession({
        date: today(),
        exerciseId: exercise.id,
        sets: state.results.map((r) => ({ verified: r.exp.verifiedReps, quality: r.exp.qualityBonus, fixed: r.exp.fixedBonus })),
        lastSet: last
          ? {
              depths: last.reps.map((r) => (r.status === 'verified' ? r.qMax : null)),
              issue: issue ? { id: issue.id, count: issue.repIndexes.length } : null,
            }
          : undefined,
      }),
    )
  }, [state.stage, state.results, exercise.id, onSaved])

  const video = useStageVideo({ camera: useCamera, file: videoFile })
  const lastResult = state.results[state.results.length - 1]
  // Between sets the character shows the target for a range cue: the full pull, against the same gauge.
  const showTarget = state.stage === 'rest' && lastResult?.cue?.issueId === 'short_range'
  const targetQ = useDemoPull(showTarget)
  const stageQ = live ? frame.q : targetQ
  // Over a video the bones come from tracking that video. The stand-in landmarks describe the
  // stand-in body, so they are only drawn when there is no video.
  const standIn = live && !video.source ? frame.landmarks : null

  return (
    <main className="session">
      <header className="session-head">
        <button className="back" onClick={onExit} aria-label="返回首页">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="title">{exercise.name}</h1>
      </header>

      <section className="stage" aria-label="镜头画面">
        {video.source?.kind === 'camera' && <video className="stage-video stage-mirror" ref={video.ref} autoPlay muted playsInline />}
        {video.source?.kind === 'file' && <video className="stage-video stage-whole" ref={video.ref} src={video.source.src} autoPlay muted loop playsInline />}
        {video.source && video.frame && video.landmarks && (
          <Skeleton
            className="stage-overlay"
            landmarks={video.landmarks}
            frame={video.frame}
            fit={video.source.kind === 'camera' ? 'slice' : 'meet'}
            mirrored={video.source.kind === 'camera'}
            label="追踪到的身体"
          />
        )}
        {standIn && <Skeleton className="figure" landmarks={standIn} frame={FRAME} skull label="追踪到的身体" />}
        {!video.source && !live && <Figure q={stageQ} gear={gear} label={showTarget ? '目标动作：把横杆拉到锁骨' : '你的角色'} />}

        {stageQ !== null && !video.source && (
          <div className="range" aria-hidden="true">
            <div className="range-fill" style={{ height: `${stageQ * 100}%` }} />
            <div className="range-target" style={{ top: `${IN_RANGE * 100}%` }} />
          </div>
        )}

        <div className="stage-foot">
          <span className="lost" role="status">
            {live && !frame.visible && '看不到你。往后站半步，让上半身入镜。'}
          </span>
          <span className="demo">{video.trackingFailed ? '追踪没有启动' : video.source ? '次数是演示数据' : '演示数据'}</span>
        </div>
      </section>

      <aside className="panel">
        {state.stage === 'calibrating' && (
          <div className="panel-body">
            <p className="say">先做 3 下，量一下你的活动范围。</p>
            <div className={frame.visible ? 'count num' : 'count count-dim num'} aria-live="polite">
              <span className="count-now">{frame.repCount}</span>
              <span className="count-of">/ {CALIBRATION_REPS}</span>
            </div>
          </div>
        )}

        {state.stage === 'set' && (
          <div className="panel-body">
            <SetMarks total={state.totalSets} index={state.setIndex} />
            <div className={frame.visible ? 'count num' : 'count count-dim num'} aria-live="polite">
              <span className="count-now">{frame.repCount}</span>
              <span className="count-of">/ {TARGET_REPS}</span>
            </div>
            <div className={idleMs > 600 ? 'idle idle-on' : 'idle'}>
              <div className="track">
                <div className="track-fill track-plain" style={{ width: `${Math.max(0, 1 - idleMs / IDLE_END_MS) * 100}%` }} />
              </div>
              <span className="num">{Math.ceil(Math.max(0, IDLE_END_MS - idleMs) / 1000)} 秒后结算这一组</span>
            </div>
          </div>
        )}

        {state.stage === 'rest' && lastResult && (
          <div className="panel-body">
            <SetMarks total={state.totalSets} index={state.setIndex} done />
            <p className="say">{cueText(lastResult)}</p>
            <Reward result={lastResult} />
            <button className="pill pill-wide" autoFocus onClick={() => dispatch({ type: 'nextSet' })}>
              开始第 {state.setIndex + 2} 组
            </button>
          </div>
        )}

        {state.stage === 'done' && lastResult && (
          <Done results={state.results} startExp={startExp.current} last={lastResult} onExit={onExit} />
        )}
      </aside>
    </main>
  )
}

function cueText(r: SetResult) {
  if (r.cue) return r.cue.text
  return r.exp.fixedBonus > 0 ? '上一组的问题改掉了。' : '这一组很干净。'
}

function SetMarks({ total, index, done = false }: { total: number; index: number; done?: boolean }) {
  return (
    <div className="sets" role="img" aria-label={`第 ${index + 1} 组，共 ${total} 组`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < index || (done && i === index) ? 'set set-done' : i === index ? 'set set-now' : 'set'} />
      ))}
    </div>
  )
}

function Reward({ result }: { result: SetResult }) {
  const { verifiedReps, qualityBonus, fixedBonus } = result.exp
  return (
    <dl className="reward">
      <div>
        <dt>看清的 {verifiedReps} 下</dt>
        <dd className="num">+{verifiedReps}</dd>
      </div>
      <div className={qualityBonus ? undefined : 'reward-zero'}>
        <dt>八成以上拉到位</dt>
        <dd className="num">+{qualityBonus}</dd>
      </div>
      <div className={fixedBonus ? undefined : 'reward-zero'}>
        <dt>改掉上一组的问题</dt>
        <dd className="num">{result.hadIssueToFix ? `+${fixedBonus}` : '—'}</dd>
      </div>
      <div className="reward-total">
        <dt>这一组</dt>
        <dd className="num">
          +{expOfResult(result)}
          <small> EXP</small>
        </dd>
      </div>
    </dl>
  )
}

function Done({ results, startExp, last, onExit }: { results: SetResult[]; startExp: number; last: SetResult; onExit: () => void }) {
  const gained = results.reduce((sum, r) => sum + expOfResult(r), 0)
  const { level, into, span, toNext } = levelOf(startExp + gained)
  const levelsUp = level - levelOf(startExp).level
  return (
    <div className="panel-body">
      <SetMarks total={results.length} index={results.length - 1} done />
      <p className="say">{cueText(last)}</p>
      <div className="gain num">
        +{gained}
        <small> EXP</small>
      </div>
      {levelsUp > 0 && (
        <p className="note">
          升到 Lv {level}，多了 {levelsUp * POINTS_PER_LEVEL} 点可以换装备。
        </p>
      )}
      <div className="level">
        <div className="level-line">
          <span className="level-now num">Lv {level}</span>
          <span className="level-next num">
            再 {toNext} EXP 到 Lv {level + 1}
          </span>
        </div>
        <div className="track">
          <div className="track-fill" style={{ width: `${(into / span) * 100}%` }} />
        </div>
      </div>
      <button className="pill pill-wide" autoFocus onClick={onExit}>
        完成
      </button>
    </div>
  )
}
