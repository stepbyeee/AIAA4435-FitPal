import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { ArmTrails } from '../components/ArmTrails'
import { ElbowTelemetry } from '../components/ElbowTelemetry'
import { Figure, useDemoPull } from '../components/Figure'
import { Skeleton } from '../components/Skeleton'
import { expOfResult, IN_RANGE, type FrameState, type PoseFrame, type SetResult, type SetSummary } from '../contract'
import type { Exercise } from '../data/exercises'
import { POINTS_PER_LEVEL, type GearId } from '../data/gear'
import { lastSessionOf, levelOf, saveSession, today, totalExp, type SessionRecord } from '../data/history'
import { settle } from '../feedback/settle'
import { createPulldown, type Calibration } from '../perception/pulldown'
import { useStageVideo } from '../tracking/useStageVideo'
import { initialSession, reduce } from '../session/session'

const TARGET_REPS = 10
const CALIBRATION_REPS = 3
const TOTAL_SETS = 3
/** A visible top position held for this long ends a live set. */
const IDLE_END_MS = 5000
const phaseLabels: Record<FrameState['phase'], string> = { ready: '准备', pull: '下拉', bottom: '底部', return: '回程' }
type EndTrigger = 'manual' | 'idle' | 'video-ended'

const REST: FrameState = { phase: 'ready', q: 0, visible: false, repCount: 0, landmarks: null }

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
  const [state, dispatch] = useReducer(reduce, null, () => {
    const previous = !videoFile ? lastSessionOf(history, exercise.id) : undefined
    const issueId = previous?.outstandingIssueId === undefined
      ? previous?.lastSet?.issue?.id
      : previous.outstandingIssueId
    return initialSession(videoFile ? 1 : TOTAL_SETS, issueId)
  })
  const [frame, setFrame] = useState<FrameState>(REST)
  const [idleMs, setIdleMs] = useState(0)
  const [showBones, setShowBones] = useState(false)
  const consume = useRef<(frame: PoseFrame) => void>(() => {})
  const finishRef = useRef<(trigger: EndTrigger) => void>(() => {})
  const calibrationRef = useRef<Calibration | null>(null)
  const topFrameRef = useRef<PoseFrame | null>(null)
  const [settled, setSettled] = useState<{ summary: SetSummary; trigger: EndTrigger } | null>(null)
  // EXP before this session, so the result does not depend on when the save lands.
  const startExp = useRef(totalExp(history))
  const live = state.stage === 'calibrating' || state.stage === 'set'
  const calibrating = state.stage === 'calibrating'
  const preview = !useCamera && !videoFile

  useLayoutEffect(() => {
    if (!live || preview) return
    const calibrating = state.stage === 'calibrating'
    const calibrated = calibrationRef.current
    if (!calibrating && !calibrated) return
    const perception = createPulldown(calibrating ? undefined : calibrated ?? undefined)
    let over = false
    let idleSince: number | null = null
    let lastFrameTime: number | null = null

    const finish = (trigger: EndTrigger) => {
      if (over || calibrating) return
      over = true
      const summary = perception.endSet()
      setSettled({ summary, trigger })
      setIdleMs(0)
      dispatch({ type: 'setEnded', result: settle(summary, state.lastIssueId) })
    }

    consume.current = (sample) => {
      if (over) return
      const result = perception.accept(sample)
      setFrame(result)
      if (calibrating) {
        const calibration = perception.getCalibration()
        if (calibration) {
          over = true
          calibrationRef.current = calibration
          topFrameRef.current = sample
          dispatch({ type: 'calibrated' })
        }
        return
      }

      const now = sample.timestampMs
      const stalled = lastFrameTime !== null && now - lastFrameTime > 500
      lastFrameTime = now
      if (!videoFile && result.visible && result.phase === 'ready' && result.q <= 0.18 && result.repCount > 0) {
        if (stalled) idleSince = null
        idleSince ??= now
        setIdleMs(now - idleSince)
        if (now - idleSince >= IDLE_END_MS) finish('idle')
      } else if (idleSince !== null) {
        idleSince = null
        setIdleMs(0)
      }
    }
    finishRef.current = finish
    const anchor = topFrameRef.current
    topFrameRef.current = null
    setFrame(anchor ? perception.accept(anchor) : REST)
    return () => {
      over = true
      consume.current = () => {}
      finishRef.current = () => {}
    }
  }, [live, preview, state.stage, state.setIndex, state.lastIssueId, videoFile])

  // The space bar is available when the user is standing at the machine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.stage !== 'set' || e.repeat || e.target instanceof HTMLButtonElement || e.code !== 'Space') return
      e.preventDefault()
      finishRef.current('manual')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.stage])

  // Keep the session once it is done.
  const saved = useRef(false)
  useEffect(() => {
    if (state.stage !== 'done' || saved.current || videoFile || !state.results.some((r) => r.exp.verifiedReps > 0)) return
    saved.current = true
    const last = settled?.summary
    const issueId = state.results.at(-1)?.cue?.issueId
    const issue = last?.issues.find((candidate) => candidate.id === issueId)
    onSaved(
      saveSession({
        date: today(),
        exerciseId: exercise.id,
        outstandingIssueId: state.lastIssueId,
        sets: state.results.map((r) => ({ verified: r.exp.verifiedReps, quality: r.exp.qualityBonus, fixed: r.exp.fixedBonus })),
        lastSet: last
          ? {
              depths: last.reps.map((r) => (r.status === 'verified' ? r.qMax : null)),
              issue: issueId ? { id: issueId, count: issue?.repIndexes.length ?? 0 } : null,
            }
          : undefined,
      }),
    )
  }, [state.stage, state.results, state.lastIssueId, exercise.id, onSaved, settled, videoFile])

  const video = useStageVideo({
    camera: useCamera,
    file: videoFile,
    live,
    onFrame: (sample) => consume.current(sample),
    onEnded: () => finishRef.current('video-ended'),
  })
  const lastResult = state.results[state.results.length - 1]
  // Between sets the character shows the target for a range cue: the full pull, against the same gauge.
  const showTarget = !live && lastResult?.cue?.issueId === 'short_range'
  const targetQ = useDemoPull(showTarget)
  const rangeVisible = showTarget && targetQ !== null
  const cameraHint = video.status === 'tracking' && !frame.visible
    ? '让肩膀、手肘和手腕完整入镜。'
    : null

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
        {live && video.source?.kind === 'camera' && <video className="stage-video stage-whole stage-mirror" ref={video.ref} muted playsInline />}
        {live && video.source?.kind === 'file' && <video className="stage-video stage-whole" ref={video.ref} src={video.source.src} preload="auto" muted playsInline />}
        {showBones && live && video.source && video.frame && video.landmarks && (
          <Skeleton
            className="stage-overlay"
            landmarks={video.landmarks}
            frame={video.frame}
            fit="meet"
            mirrored={video.source.kind === 'camera'}
            label="追踪到的身体"
          />
        )}
        {live && video.source && video.frame && video.status === 'tracking' && (
          <>
            <ArmTrails trails={video.motion.trails} frame={video.frame} mirrored={video.source.kind === 'camera'} />
            <button className="bone-toggle" aria-pressed={showBones} onClick={() => setShowBones((visible) => !visible)}>骨架</button>
          </>
        )}
        {(preview || !live) && <Figure q={targetQ} gear={gear} label={showTarget ? '动作示意：达到已校准的下拉范围' : '你的角色'} />}

        {rangeVisible && (
          <div className="range" aria-hidden="true">
            <div className="range-fill" style={{ height: `${targetQ * 100}%` }} />
            <div className="range-target" style={{ bottom: `${IN_RANGE * 100}%` }} />
          </div>
        )}

        <div className="stage-foot">
          <span className="lost" role="status">
            {live && !preview && cameraHint}
          </span>
          <span className="demo">
            {preview ? '角色预览' : videoFile ? '录像回放' : live && video.status === 'tracking' ? '本地姿态追踪' : null}
          </span>
        </div>
      </section>

      <aside className={live && !preview ? 'panel panel-live' : 'panel'}>
        {live && (
          <div className="panel-body live-panel">
            {!preview && (
              <>
                <div className="live-panel-heading">
                  <h2>{calibrating ? '个人校准' : `第 ${state.setIndex + 1} 组`}</h2>
                  <span className="live-phase" data-ready={video.status === 'tracking' && frame.visible}>
                    {video.status === 'tracking' && frame.visible ? phaseLabels[frame.phase] : '等待关键点'}
                  </span>
                </div>
                <div className="live-count num" aria-live="polite">
                  <span className="count-now">{frame.repCount}</span>
                  <span className="count-of">/ {calibrating ? CALIBRATION_REPS : TARGET_REPS} 次</span>
                </div>
              </>
            )}
            {calibrating && <p className={preview ? 'say' : 'live-instruction'}>{calibrationPrompt(video.status, preview, Boolean(videoFile))}</p>}
            {!preview && <ElbowTelemetry motion={video.motion} />}
            {calibrating ? (
              (video.status === 'ended' || video.status === 'unavailable' || video.status === 'tracking-error') && (
                <button className="pill pill-wide" onClick={() => window.location.reload()}>重试</button>
              )
            ) : (
              <div className="live-set-controls">
                <SetMarks total={state.totalSets} index={state.setIndex} />
                {idleMs > 600 && (
                  <div className="idle">
                    <div className="track">
                      <div className="track-fill track-plain" style={{ width: `${Math.max(0, 1 - idleMs / IDLE_END_MS) * 100}%` }} />
                    </div>
                    <span className="num">{Math.ceil(Math.max(0, IDLE_END_MS - idleMs) / 1000)} 秒后结算这一组</span>
                  </div>
                )}
                {(video.status === 'unavailable' || video.status === 'tracking-error') && <p className="note" role="status">追踪已中断。本组仅结算已确认的动作。</p>}
                <button className="pill pill-wide" onClick={() => finishRef.current('manual')}>结束这一组</button>
              </div>
            )}
          </div>
        )}

        {state.stage === 'rest' && lastResult && (
          <div className="panel-body">
            <SetMarks total={state.totalSets} index={state.setIndex} done />
            <p className="say">{cueText(lastResult)}</p>
            <Reward result={lastResult} />
            {settled && <SetEvidence {...settled} />}
            <button className="pill pill-wide" autoFocus onClick={() => dispatch({ type: 'nextSet' })}>
              开始第 {state.setIndex + 2} 组
            </button>
          </div>
        )}

        {state.stage === 'done' && lastResult && (
          <Done results={state.results} startExp={startExp.current} last={lastResult} settled={settled} playback={Boolean(videoFile)} onExit={onExit} />
        )}
      </aside>
    </main>
  )
}

function cueText(r: SetResult) {
  if (r.cue) return r.cue.text
  if (r.exp.fixedBonus > 0) return '这一组看清的动作里，上一组的问题已经改善。'
  return r.exp.verifiedReps ? `这一组确认了 ${r.exp.verifiedReps} 下。` : '这一组没有可确认的动作。'
}

function calibrationPrompt(status: ReturnType<typeof useStageVideo>['status'], preview: boolean, playback: boolean) {
  if (preview) return '角色预览。开启摄像头即可开始训练。'
  if (status === 'ended') return '录像已结束。校准需要 3 次清晰的完整下拉。'
  if (status === 'unavailable') return playback ? '录像未能播放。' : '摄像头未开启。开启权限后重试。'
  if (status === 'tracking-error') return '姿态模型未能启动。'
  if (status === 'starting') return '正在启动姿态追踪。'
  return playback ? '正在用录像中的 3 次完整动作校准。' : '先伸展手臂，再做 3 次完整下拉。'
}

const SET_END_LABELS: Record<EndTrigger, string> = { manual: '手动结束', idle: '顶端停留 5 秒', 'video-ended': '录像结束' }

function SetEvidence({ summary, trigger }: { summary: SetSummary; trigger: EndTrigger }) {
  const { calibration, coverage, reps } = summary
  return (
    <details className="evidence">
      <summary>查看这一组的动作依据</summary>
      <p>画面可用率 {Math.round(coverage * 100)}% · {SET_END_LABELS[trigger]}</p>
      <p>校准时的投影肘角 {Math.round(calibration.thetaTop)}° → {Math.round(calibration.thetaBottom)}°</p>
      {reps.length > 0 && (
        <ol className="rep-depths" aria-label="每次动作占校准幅度的比例">
          {reps.map((rep, index) => (
            <li key={index} className={rep.status === 'verified' && rep.qMax >= IN_RANGE ? 'in-range' : undefined}>
              {rep.status === 'verified' ? `${Math.round(rep.qMax * 100)}%` : '未看清'}
            </li>
          ))}
        </ol>
      )}
    </details>
  )
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
        <dt>至少 8 下达到目标幅度，且占八成</dt>
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

function Done({ results, startExp, last, settled, playback, onExit }: {
  results: SetResult[]
  startExp: number
  last: SetResult
  settled: { summary: SetSummary; trigger: EndTrigger } | null
  playback: boolean
  onExit: () => void
}) {
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
      {playback && <p className="note">回放结算，不计入你的训练记录。</p>}
      {settled && <SetEvidence {...settled} />}
      {!playback && levelsUp > 0 && (
        <p className="note">
          升到 Lv {level}，多了 {levelsUp * POINTS_PER_LEVEL} 点可以换装备。
        </p>
      )}
      {!playback && <div className="level">
        <div className="level-line">
          <span className="level-now num">Lv {level}</span>
          <span className="level-next num">
            再 {toNext} EXP 到 Lv {level + 1}
          </span>
        </div>
        <div className="track">
          <div className="track-fill" style={{ width: `${(into / span) * 100}%` }} />
        </div>
      </div>}
      <button className="pill pill-wide" autoFocus onClick={onExit}>
        完成
      </button>
    </div>
  )
}
