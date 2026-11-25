import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { JointTarget, PilotSurvey } from '../components/PilotTrial'
import { LocalCue } from '../components/LocalCue'
import { RepReview } from '../components/RepReview'
import type { RepReviewData } from '../perception/repReview'
import { createSquat } from '../perception/squat'
import { parseParticipant, parsePeriod } from '../study/assignment'
import { parseCondition, repCue, type TrialContext, type TrialEvent } from '../study/pilot'
import { cropBounds, focusLabels, parseFocus, type Focus } from '../tracking/focus'
import { parseSide, type SideSelection } from '../tracking/sideSelection'
import { describeFraming } from '../tracking/framing'
import { ArmTrails } from '../components/ArmTrails'
import { ElbowTelemetry } from '../components/ElbowTelemetry'
import { Figure } from '../components/Figure'
import { Skeleton } from '../components/Skeleton'
import { expOfResult, IN_RANGE, type FrameState, type PoseFrame, type SetResult, type SetSummary } from '../contract'
import type { Exercise } from '../data/exercises'
import { POINTS_PER_LEVEL, type GearId } from '../data/gear'
import { lastSessionOf, levelOf, saveSession, today, totalExp, type SessionRecord } from '../data/history'
import { withProgressLock } from '../data/progressLock'
import { keepSummaries } from '../data/privacy'
import { settle } from '../feedback/settle'
import { compareTrunkSets } from '../feedback/trunkRecheck'
import { createPulldown, type Calibration } from '../perception/pulldown'
import { useStageVideo } from '../tracking/useStageVideo'
import { initialSession, reduce } from '../session/session'
import { createMotionRecorder, type SetMotion } from '../analytics/motion'
import { DEFAULT_PLAN, focusNames, loadPlan, type TrainingPlan } from '../training/plan'
import { settleTraining } from '../training/policy'
import { LiveMetrics, MotionReview, TrainingCoach } from '../training/MotionPanels'
import { TrainingSettings } from '../training/TrainingSettings'
import { downloadReport, trainingReport } from '../training/report'

const CALIBRATION_REPS = 3
/** A visible top position held for this long ends a live set. */
const IDLE_END_MS = 5000
const phaseLabels: Record<FrameState['phase'], string> = { ready: '准备', pull: '下拉', bottom: '底部', return: '回程' }
type EndTrigger = 'manual' | 'idle' | 'video-ended'

type SettledSet = { summary: SetSummary; trigger: EndTrigger; review: RepReviewData; motion: SetMotion; plan: TrainingPlan }
const squatPhases: typeof phaseLabels = { ready: '站立', pull: '下蹲', bottom: '底部', return: '起身' }

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
  onRetry: () => void
  side: SideSelection
  onSide: (side: SideSelection) => void
  focus: Focus
  onFocus: (focus: Focus) => void
}

export function Session({ exercise, history, gear, useCamera, videoFile, onSaved, onExit, onRetry, focus, onFocus, side, onSide }: Props) {
  const squat = exercise.id === 'squat'
  const limb = squat ? 'leg' : 'arm'
  const sideName = (side: string) => (side === 'left' ? '左' : '右') + (squat ? '腿' : '臂')
  const [trial] = useState(() => parseCondition(new URLSearchParams(window.location.search).get('study')))
  const [plan, setPlan] = useState(() => {
    const selected = trial ? { ...DEFAULT_PLAN } : loadPlan()
    return videoFile || trial ? { ...selected, sets: 1 } : selected
  })
  const planRef = useRef(plan)
  planRef.current = plan
  const recorder = useRef(createMotionRecorder(limb))
  const [trialCue, setTrialCue] = useState<{ text: string; target: boolean } | null>(null)
  const [trialContext] = useState<TrialContext>(() => {
    const params = new URLSearchParams(window.location.search)
    return { participant: parseParticipant(params.get('participant')), period: parsePeriod(params.get('period')), growth: params.get('growth') === 'hidden' ? 'hidden' : 'visible' }
  })
  const studyEvents = useRef<TrialEvent[]>([])
  const cuesShown = useRef(0)
  const [state, dispatch] = useReducer(reduce, null, () => {
    const previous = !videoFile && !trial ? lastSessionOf(history, exercise.id) : undefined
    const issueId = previous?.outstandingIssueId === undefined
      ? previous?.lastSet?.issue?.id
      : previous.outstandingIssueId
    return initialSession(videoFile || trial ? 1 : plan.sets, issueId)
  })
  const [frame, setFrame] = useState<FrameState>(REST)
  const [paused, setPaused] = useState(false)
  const [idleMs, setIdleMs] = useState(0)
  const [analysis, setAnalysis] = useState(Boolean(videoFile) && !trial)
  const [overlay, setOverlay] = useState(false)
  const [showBones, setShowBones] = useState(false)
  const consume = useRef<(frame: PoseFrame) => void>(() => {})
  const finishRef = useRef<(trigger: EndTrigger) => void>(() => {})
  const calibrationRef = useRef<Calibration | null>(null)
  const topFrameRef = useRef<PoseFrame | null>(null)
  const [completed, setCompleted] = useState<SettledSet[]>([])
  const settled = completed.at(-1) ?? null
  const [chosenSet, chooseSet] = useState<number | null>(null)
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
    const setCalibration = calibrating ? undefined : calibrated ?? undefined
    const perception = squat ? createSquat(setCalibration) : createPulldown(setCalibration, { assessForm: !trial && focus === 'full' })
    const motionRecorder = createMotionRecorder(limb)
    recorder.current = motionRecorder
    const activePlan = { ...planRef.current }
    let previousPhase: FrameState['phase'] = 'ready'
    let previousAttempts = 0
    let firstTime: number | null = null
    const logCue = (action: TrialEvent['action'], trigger: string, now: number | null) => {
      cuesShown.current++
      if (studyEvents.current.length < 256) studyEvents.current.push({ ms: Math.round((now ?? 0) - (firstTime ?? 0)), action, trigger })
    }
    let cueTimer: ReturnType<typeof setTimeout> | undefined
    let over = false
    let idleSince: number | null = null
    let lastFrameTime: number | null = null

    const finish = (trigger: EndTrigger) => {
      if (over || calibrating) return
      over = true
      const summary = perception.endSet()
      const review = perception.getRepReview()
      const motion = motionRecorder.finish(summary, review)
      const current = { summary, trigger, review, motion, plan: activePlan }
      const result = trial ? settle(summary, state.lastIssueId) : settleTraining(summary, state.lastIssueId)
      setCompleted(sets => [...sets, current])
      chooseSet(null)
      if (trial?.timing === 'set') logCue('set-cue', result.cue?.issueId ?? 'set_summary', lastFrameTime)
      setIdleMs(0)
      setPaused(false)
      dispatch({ type: 'setEnded', result })
    }

    consume.current = (sample) => {
      if (over) return
      const result = perception.accept(sample)
      if (!trial) motionRecorder.observe(sample, result.visible && result.phase === 'ready' && result.q <= .18)
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

      firstTime ??= sample.timestampMs
      if (!trial && previousPhase !== 'ready' && result.phase === 'ready') motionRecorder.capture(perception.endSet(), perception.getRepReview())
      if (trial?.timing === 'rep' && previousPhase !== 'ready' && result.phase === 'ready') {
        const reps = perception.endSet().reps
        if (reps.length > previousAttempts) {
          const rep = reps[reps.length - 1]
          setTrialCue({ text: repCue(rep), target: rep.status === 'verified' && rep.qMax !== null })
          logCue('rep-cue', rep.status === 'cannot_verify' ? 'out_of_view' : rep.qMax === null ? 'count_only' : rep.qMax < IN_RANGE ? 'short_range' : 'in_range', sample.timestampMs)
          previousAttempts = reps.length
          clearTimeout(cueTimer)
          cueTimer = setTimeout(() => setTrialCue(null), 2000)
        }
      }
      previousPhase = result.phase
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
    if (anchor && !calibrating && !trial) motionRecorder.observe(anchor, true)
    setFrame(anchor ? perception.accept(anchor) : REST)
    return () => {
      clearTimeout(cueTimer)
      over = true
      consume.current = () => {}
      finishRef.current = () => {}
    }
  }, [live, preview, state.stage, state.setIndex, state.lastIssueId, videoFile, squat, limb, trial, focus])

  // The space bar is available when the user is standing at the machine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.stage !== 'set' || e.repeat || e.defaultPrevented || e.code !== 'Space') return
      if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea, summary, [contenteditable=true]')) return
      e.preventDefault()
      finishRef.current('manual')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.stage])

  // Save each settled set, so leaving during rest retains the earned result.
  const [sessionId] = useState(() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
  const saved = useRef(0)
  const [saveError, setSaveError] = useState(false)
  const [saveRetry, retrySave] = useState(0)
  useEffect(() => {
    if (state.stage !== 'done' && state.stage !== 'rest') return
    if (saved.current >= state.results.length || videoFile || trial || !keepSummaries() || !state.results.some(r => r.exp.verifiedReps > 0)) return
    saved.current = state.results.length
    const last = settled?.summary
    const issueId = state.results.at(-1)?.cue?.issueId
    const issue = last?.issues.find((candidate) => candidate.id === issueId)
    void Promise.resolve().then(() => withProgressLock(() => saveSession({
        id: sessionId, date: today(),
        exerciseId: exercise.id,
        outstandingIssueId: state.lastIssueId,
        sets: state.results.map((r, i) => ({ verified: r.exp.verifiedReps, quality: r.exp.qualityBonus, fixed: r.exp.fixedBonus,
          motion: completed[i]?.motion.summary, plan: completed[i]?.plan })),
        lastSet: last
          ? {
              depths: last.reps.map((r) => (r.status === 'verified' ? r.qMax : null)),
              countOnly: last.reps.flatMap((r, i) => r.status === 'verified' && r.qMax === null ? [i] : []),
              issue: issueId ? { id: issueId, count: issue?.repIndexes.length ?? 0 } : null,
            }
          : undefined,
      }))).then(rows => { setSaveError(false); onSaved(rows) }).catch(() => { saved.current = 0; setSaveError(true) })
  }, [state.stage, state.results, state.lastIssueId, exercise.id, onSaved, settled, completed, videoFile, trial, sessionId, saveRetry])

  const video = useStageVideo({
    camera: useCamera,
    focus, side: squat ? side : 'both', pulldown: !squat,
    limb,
    file: videoFile,
    analyzeFile: !trial,
    live: live && !paused,
    onFrame: (sample) => {
      if (!paused) consume.current(videoFile ? sample : { ...sample, timestampMs: performance.now() })
    },
    onEnded: () => finishRef.current('video-ended'),
  })
  const togglePause = () => {
    if (!paused) {
      consume.current({ landmarks: null, width: 0, height: 0, timestampMs: performance.now() })
      setIdleMs(0)
    }
    setPaused(!paused)
  }
  const lastResult = state.results[state.results.length - 1]
  const cameraHint = !calibrating && video.status === 'tracking' && !frame.visible
    ? (squat ? '计数侧未看清，请让髋、膝和脚踝入镜。' : '计数侧未看清，请让肩、肘和腕入镜。')
    : null

  const framing = video.frame && describeFraming({ ...video.frame, landmarks: video.landmarks, timestampMs: 0 }, limb)
  const bounds = video.frame && cropBounds(focus, video.frame.width, false)
  const selectedSide = sideName(calibrationRef.current?.side ?? 'left')
  const reviewIndex = chosenSet ?? completed.length - 1
  const reviewing = !live && !trial ? completed[reviewIndex] : null
  return (
    <main className={analysis ? (overlay ? 'session analysis-view overlay-view' : 'session analysis-view') : 'session training-view'}>
      <header className="session-head">
        <button className="back" onClick={onExit} aria-label="返回首页">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="title">{exercise.name}</h1>
        {live && !preview && !trial && <div className="view-switch" role="group" aria-label="镜头视图">
          <button aria-pressed={!analysis} onClick={() => setAnalysis(false)}>训练</button>
          <button aria-pressed={analysis && !overlay} onClick={() => { setAnalysis(true); setOverlay(false) }}>分析</button>
          <button aria-pressed={analysis && overlay} onClick={() => { setAnalysis(true); setOverlay(true) }}>画中分析</button>
        </div>}
      </header>

      <section className="stage" aria-label="镜头画面">
        {paused && <div className="pause-screen"><strong>训练已暂停</strong><span>摄像头已关闭</span></div>}
        {!paused && live && video.source?.kind === 'camera' && <video className="stage-video stage-whole stage-mirror" ref={video.ref} muted playsInline />}
        {live && video.source?.kind === 'file' && <video className="stage-video stage-whole" ref={video.ref} src={video.source.src} preload="auto" muted playsInline />}
        {!paused && live && focus !== 'full' && bounds && video.frame && (
          <svg className="stage-overlay focus-mask" viewBox={`0 0 ${video.frame.width} ${video.frame.height}`} aria-label="选中的人物区域" role="img">
            <rect x="0" y="0" width={bounds.x} height={video.frame.height} />
            <rect x={bounds.x + bounds.width} y="0" width={video.frame.width - bounds.x - bounds.width} height={video.frame.height} />
            <rect className="focus-outline" x={bounds.x} y="0" width={bounds.width} height={video.frame.height} />
          </svg>
        )}
        {!paused && analysis && showBones && live && video.source && video.frame && video.displayLandmarks && (
          <Skeleton
            className="stage-overlay"
            landmarks={video.displayLandmarks}
            frame={video.frame}
            fit="meet"
            mirrored={video.source.kind === 'camera'}
            label="追踪到的身体"
          />
        )}
        {!paused && live && video.source && video.frame && video.status === 'tracking' && (
          <>
            <ArmTrails limb={limb} trails={video.motion.trails} selection={squat ? side : 'both'} frame={video.frame} mirrored={video.source.kind === 'camera'} />
            {analysis && <button className="bone-toggle" aria-pressed={showBones} onClick={() => setShowBones((visible) => !visible)}>骨架</button>}
          </>
        )}
        {!paused && live && analysis && overlay && <div className="camera-stats" data-landscape={Boolean(video.frame && video.frame.width / video.frame.height >= 1.3)} aria-label="画中分析数据">
          <div className="camera-count"><span>{calibrating ? '个人校准' : '已确认'}</span>
            <strong>{frame.repCount}<small>{calibrating ? ' / 3' : ' 下'}</small></strong>
            {!calibrating && calibrationRef.current?.basis === 'upper-arm' && <span>上臂计数 · 幅度未评估</span>}
            {!calibrating && calibrationRef.current?.basis !== 'upper-arm' && <span>当前幅度 <b>{video.fresh && frame.visible ? Math.round(frame.q * 100) + '%' : '—'}</b></span>}
          </div>
          <ElbowTelemetry limb={limb} motion={video.motion} />
          {!trial && <LiveMetrics active={video.fresh && video.status === 'tracking' && frame.visible} live={recorder.current.live} latest={recorder.current.latest} plan={plan} />}
        </div>}
        {reviewing && <section className="set-review-stage" aria-label="训练回顾">
          <header><h2>第 {reviewIndex + 1} 组回顾</h2>
            {completed.length > 1 && <select aria-label="选择训练组" value={reviewIndex} onChange={e => chooseSet(Number(e.target.value))}>
              {completed.map((_, i) => <option key={i} value={i}>第 {i + 1} 组</option>)}
            </select>}
          </header>
          {reviewing.summary.reps.length > 0
            ? <RepReview key={reviewIndex} summary={reviewing.summary} review={reviewing.review} mirrored={!videoFile} videoFile={videoFile} metrics={reviewing.motion.reps} />
            : <p>这一组没有可回顾的完整动作。</p>}
          {reviewIndex > 0 && state.results[reviewIndex - 1]?.cue?.issueId === 'trunk_swing' &&
            <TrunkRecheck previous={completed[reviewIndex - 1].summary} current={reviewing.summary} />}
          <SetEvidence summary={reviewing.summary} trigger={reviewing.trigger} />
          <MotionReview motion={reviewing.motion} plan={reviewing.plan} previous={completed[reviewIndex - 1]} />
          <TrainingCoach key={`coach-${reviewIndex}`} summary={reviewing.summary} motion={reviewing.motion} plan={reviewing.plan} result={state.results[reviewIndex]} />
          <button className="report-export" onClick={() => downloadReport(trainingReport(exercise.id, Boolean(videoFile), completed, state.results), `fitpal-${exercise.id}-report.json`)}>导出本次训练报告</button>
        </section>}
        {(preview || (!live && !reviewing)) && <Figure q={null} gear={gear} label="你的角色" />}

        <div className="stage-foot">
          <span className="lost" role="status">
            {live && !paused && !preview && cameraHint}
          </span>
          {videoFile === '/showcase/go4it-rear.mp4' && <a className="clip-credit" href="/showcase/CREDITS.txt" target="_blank" rel="noreferrer">헬스티비 · CC BY 3.0</a>}
          {videoFile === '/showcase/goblet-squat.mp4' && <a className="clip-credit" href="/showcase/CREDITS.txt" target="_blank" rel="noreferrer">YMove</a>}
          <span className="demo">
            {preview ? '角色预览' : videoFile ? '录像分析 · 按原片计时' : !paused && live && video.status === 'tracking' ? '本地姿态追踪' : null}
          </span>
        </div>
      </section>

      <aside className={live && !preview ? 'panel panel-live' : 'panel'}>
        {saveError && <div className="panel-body" role="alert"><p>本组记录未保存。请先导出本次报告，或重试保存。</p><button className="pause-action" onClick={() => retrySave(n => n + 1)}>重试保存记录</button></div>}
        {live && (
          <div className="panel-body live-panel">
            {!preview && (
              <>
                <div className="live-panel-heading">
                  <h2>{calibrating ? '个人校准' : `第 ${state.setIndex + 1} 组`}</h2>
                  <span className="live-phase" data-ready={!paused && video.status === 'tracking' && frame.visible}>
                    {!paused && video.status === 'tracking' && frame.visible ? (squat ? squatPhases : phaseLabels)[frame.phase] : paused ? '暂停' : '等待关键点'}
                  </span>
                </div>
                <div className="live-count num" aria-live="polite">
                  <span className="count-now">{frame.repCount}</span>
                  <span className="count-of">/ {calibrating ? CALIBRATION_REPS : plan.reps} 次</span>
                </div>
              </>
            )}
            {!paused && calibrating && <p className={preview ? 'say' : 'live-instruction'}>{calibrationPrompt(video.status, preview, Boolean(videoFile), squat)}</p>}
            {videoFile && !trial && <div className="recording-progress" aria-label="录像分析进度">
              <span>逐帧分析 · {Math.floor(video.recording.seconds)} / {Math.ceil(video.recording.duration)} 秒</span>
              <button className="pause-action" disabled={video.status !== 'tracking'} onClick={video.toggleRecordingPause}>{video.recording.paused ? '继续分析' : '暂停分析'}</button>
            </div>}
            {!paused && calibrating && !preview && video.status === 'tracking' && framing && (
              <section className="framing" aria-label="取景检查">
                <h3>取景检查</h3>
                <p>{squat ? '侧对镜头，站直和蹲下时，让同侧髋、膝和脚踝完整入镜。' : '双臂分别自动追踪。手举到最高时，尽量让肩、肘、腕留在画面内。'}</p>
                  {!trial && <p>{plan.focus === 'coordination' ? '观察左右配合时，使用固定正面或背面机位，让两侧关节全程可见。' : !squat ? '用侧面固定机位并让肩、髋入镜，可评估起拉时上身是否后摆。' : '保持同一侧面机位，方便下一组比较。'}</p>}
                <dl>{(['left', 'right'] as const).map(side => <div key={side} data-ready={framing[side] === '可用于校准'}>
                  <dt>{sideName(side)}</dt><dd>{framing[side]}</dd>
                </div>)}</dl>
                {!trial && analysis && squat && <label className="focus-select">可用的身体侧
                  <select value={side} onChange={e=>onSide(parseSide(e.target.value))}>
                    <option value="both">自动 · 左右分开追踪</option>
                    <option value="left">仅左侧 · 右侧被遮挡</option><option value="right">仅右侧 · 左侧被遮挡</option>
                  </select>
                  <small>器械持续遮挡一侧时，选择清楚的一侧重新校准。</small>
                </label>}
                {!trial && <label className="focus-select">取景区域（实验）
                  <select value={focus} onChange={e => onFocus(parseFocus(e.target.value))}>
                    {Object.entries(focusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                  </select>
                  <small>旁人入镜时可缩小区域，更改后重新校准。</small>
                </label>}
              </section>
            )}
            {!calibrating && !preview && <p className="count-side">本组按{selectedSide}计数{calibrationRef.current?.basis === 'upper-arm' && ' · 腕部出画，仅记录次数'}</p>}
            {!trial && !preview && <p className="plan-current">第 {state.setIndex + 1} / {state.totalSets} 组 · 目标 {plan.reps} 次 · {focusNames[plan.focus]}{plan.focus === 'tempo' ? ` · 自选还原 ${plan.returnSeconds} 秒` : ''}{plan.loadKg !== null ? ` · 自填 ${plan.loadKg} kg` : ''}</p>}
            {trialCue && !calibrating && trial && <div className="trial-cue" role="status">
              {trialCue.text}
              {trialCue.target && calibrationRef.current && <TrialTarget format={trial.format} calibration={calibrationRef.current} exercise={exercise.id} />}
            </div>}
            {!paused && !preview && analysis && !overlay && <ElbowTelemetry limb={limb} motion={video.motion} />}
            {!trial && !preview && analysis && !overlay && <LiveMetrics active={!paused && video.fresh && video.status === 'tracking' && frame.visible} live={recorder.current.live} latest={recorder.current.latest} plan={plan} />}
            {!videoFile && !preview && !trial && (paused || video.status === 'tracking') && (
              <button className="pause-action" onClick={togglePause}>{paused ? '继续训练' : '暂停训练'}</button>
            )}
            {calibrating && !preview && !videoFile && !trial && (video.status === 'unavailable' || video.status === 'tracking-error') &&
              <a className="manual-start" href={`#/manual/${exercise.id}`}>改用手动记录</a>}
            {calibrating ? (
              (video.status === 'ended' || video.status === 'unavailable' || video.status === 'tracking-error') && (
                <button className="pill pill-wide" onClick={onRetry}>重试</button>
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
            {completed.length > 1 && <p className="count-side">第 {completed.length} 组反馈</p>}
            <LocalCue summary={settled?.summary} result={lastResult} fallback={cueText(lastResult)} />
            <Reward result={lastResult} />
            <TrainingSettings nextSet={state.setIndex + 2} exerciseName={exercise.name} plan={plan} onChange={setPlan} />
            <button className="pill pill-wide" autoFocus onClick={() => dispatch({ type: 'nextSet' })}>
              开始第 {state.setIndex + 2} 组
            </button>
            <button className="pause-action" onClick={onExit}>结束本次训练</button>
          </div>
        )}

        {state.stage === 'done' && lastResult && (
          trial && settled ? <div className="panel-body">
            <p className="pilot-label">课堂试测 · 本轮独立结算</p>
            <p className="say">{trial.timing === 'set' ? cueText(lastResult) : '这一组已结束。'}</p>
            {trial.timing === 'set' && lastResult.exp.verifiedReps > 0 && lastResult.cue?.issueId !== 'out_of_view' &&
              <TrialTarget format={trial.format} calibration={settled.summary.calibration} exercise={exercise.id} />}
            {trialContext.growth === 'visible' && <strong className="num">+{expOfResult(lastResult)} EXP</strong>}
            <PilotSurvey condition={trial} summary={settled.summary} playback={Boolean(videoFile)} onExit={onExit} cuesShown={cuesShown.current} events={studyEvents.current} context={trialContext} />
          </div> : <Done summary={settled?.summary} results={state.results} startExp={startExp.current} last={lastResult} playback={Boolean(videoFile)} keeping={keepSummaries()} saveFailed={saveError} onExit={onExit} />
        )}
      </aside>
    </main>
  )
}

function TrialTarget({ format, calibration, exercise }: { format: 'text' | 'card'; calibration: SetSummary['calibration']; exercise: string }) {
  if (calibration.basis === 'upper-arm') return <p className="note">已根据上臂动作计数。手腕全程入镜时才能校准肘角幅度。</p>
  if (format === 'card') return <JointTarget calibration={calibration} exercise={exercise} />
  const target = calibration.thetaTop - IN_RANGE * (calibration.thetaTop - calibration.thetaBottom)
  return <p className="note">个人幅度达标线 · 投影{exercise === 'squat' ? '膝' : '肘'}角 {Math.round(target)}°</p>
}

function cueText(r: SetResult) {
  if (r.cue) return r.cue.text
  if (r.exp.fixedBonus > 0) return '这一组看清的动作里，上一组的问题已经改善。'
  return r.exp.verifiedReps ? `这一组确认了 ${r.exp.verifiedReps} 下。` : '这一组没有可确认的动作。'
}

function TrunkRecheck({ previous, current }: { previous: SetSummary; current: SetSummary }) {
  const check = compareTrunkSets(previous, current)
  const observation = check.status === 'lower' ? '这组明显后摆的比例下降。'
    : check.status === 'higher' ? '这组明显后摆的比例上升。'
      : '两组明显后摆的比例相同。'
  return <section className="trunk-recheck" aria-label="起拉后摆复查" data-comparison={check.status}>
    <h3>起拉后摆复查</h3>
    <p>上组 {check.previous.swings}/{check.previous.assessed || '—'} · 本组 {check.current.swings}/{check.current.assessed || '—'}（后摆／可评估）</p>
    <p>{check.status === 'unavailable' ? '两组的取景、可用动作或下拉幅度不足以直接比较。' : observation}</p>
  </section>
}

function calibrationPrompt(status: ReturnType<typeof useStageVideo>['status'], preview: boolean, playback: boolean, squat: boolean) {
  if (preview) return '角色预览。开启摄像头即可开始训练。'
  if (status === 'ended') return `录像已结束。校准需要 3 次清晰的完整${squat ? '深蹲' : '下拉'}。`
  if (status === 'unavailable') return playback ? '录像未能播放。' : '摄像头未开启。开启权限后重试。'
  if (status === 'tracking-error') return '姿态模型未能启动。'
  if (status === 'starting') return '正在启动姿态追踪。'
  if (playback) return '正在用录像中的 3 次完整动作校准。校准完成后开始计数。'
  const direction = squat ? '先站直，再做 3 次完整深蹲。' : '先伸展手臂，再做 3 次完整下拉。'
  return `${direction}校准完成后开始计数。`
}

const SET_END_LABELS: Record<EndTrigger, string> = { manual: '手动结束', idle: '顶端停留 5 秒', 'video-ended': '录像结束' }

function SetEvidence({ summary, trigger }: { summary: SetSummary; trigger: EndTrigger }) {
  const { calibration, coverage } = summary
  return (
    <details className="evidence">
      <summary>查看这一组的动作依据</summary>
      <p>画面可用率 {Math.round(coverage * 100)}% · {SET_END_LABELS[trigger]}</p>
      <p>校准时的{calibration.basis === 'upper-arm' ? '上臂相对竖直向下的角度' : summary.exerciseId === 'squat' ? '投影膝角' : '投影肘角'} {Math.round(calibration.thetaTop)}° → {Math.round(calibration.thetaBottom)}°</p>
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

function Done({ results, startExp, last, playback, summary, keeping, saveFailed, onExit }: {
  summary?: SetSummary
  keeping: boolean
  saveFailed: boolean
  results: SetResult[]
  startExp: number
  last: SetResult
  playback: boolean
  onExit: () => void
}) {
  const gained = results.reduce((sum, r) => sum + expOfResult(r), 0)
  const { level, into, span, toNext } = levelOf(startExp + gained)
  const levelsUp = level - levelOf(startExp).level
  return (
    <div className="panel-body">
      <SetMarks total={results.length} index={results.length - 1} done />
      {results.length > 1 && <p className="count-side">第 {results.length} 组反馈 · 下方为本次训练总 EXP</p>}
      <LocalCue summary={summary} result={last} fallback={cueText(last)} />
      <div className="gain num">
        +{gained}
        <small> EXP</small>
      </div>
      {playback && <p className="note">回放结算，不计入你的训练记录。</p>}
      {!playback && !keeping && <p className="note">已关闭本地记录。EXP 仅作本组预览。</p>}
      {!playback && saveFailed && <p className="note">本次 EXP 尚未保存，请重试保存或导出报告。</p>}
      {!playback && keeping && !saveFailed && levelsUp > 0 && (
        <p className="note">
          升到 Lv {level}，多了 {levelsUp * POINTS_PER_LEVEL} 点可以换装备。
        </p>
      )}
      {!playback && keeping && !saveFailed && <div className="level">
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
