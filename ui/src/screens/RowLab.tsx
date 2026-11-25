import { useEffect, useRef, useState } from 'react'
import { ArmTrails } from '../components/ArmTrails'
import { createSeatedRow, type RowState } from '../perception/seatedRow'
import { useStageVideo } from '../tracking/useStageVideo'
import './row-lab.css'

const demo = '/showcase/go4it-seated-row.mp4'
const phases = {
  'find-extension': '请先向前伸臂',
  extended: '向躯干拉回',
  contracted: '向前还原',
}
const initial: RowState = { count: 0, phase: 'find-extension', side: null, visible: false, angle: null, coverage: 0 }
type Input = { kind: 'camera' } | { kind: 'demo' } | { kind: 'file'; url: string }

function RowRun({ source, finish }: { source: Input; finish: (state: RowState) => void }) {
  const [engine] = useState(createSeatedRow)
  const current = useRef(initial)
  const [state,setState] = useState(initial)
  const camera = source.kind === 'camera'
  const video = useStageVideo({
    camera, live: true, file: source.kind === 'demo' ? demo : source.kind === 'file' ? source.url : null,
    onFrame(frame) {
      const sample = engine.accept(frame)
      current.current = sample
      setState(sample)
    },
    onEnded() { finish(current.current) },
  })
  const failed = video.status === 'unavailable' || video.status === 'tracking-error'
  const message = failed
    ? video.status === 'tracking-error' ? '姿态模型加载失败。请检查本地模型后重试。'
      : camera ? '摄像头不可用。请检查权限，也可以选择本地视频。' : '视频无法播放，请尝试浏览器支持的文件。'
    : video.status === 'starting' ? '正在准备画面和模型…'
    : !state.visible ? '未看清手臂，请让肩、肘、腕完整入镜。' : phases[state.phase]
  return <section className="row-run" aria-label="坐姿划船实时分析">
    <div className="row-lab-stage" style={video.frame ? { aspectRatio: video.frame.width+'/'+video.frame.height } : undefined}>
      {video.source && <video className={'stage-video stage-whole'+(camera ? ' stage-mirror' : '')} ref={video.ref}
        src={video.source.kind === 'file' ? video.source.src : undefined} preload="auto" muted playsInline />}
      {video.frame && <ArmTrails frame={video.frame} mirrored={camera} trails={video.motion.trails} />}
      <div className="row-lab-counter"><strong>{state.count}</strong> 次</div>
    </div>
    <p className="row-lab-cue" role="status">{message}</p>
    {state.visible && state.side && <p>{state.side === 'left' ? '左臂' : '右臂'}用于计数 · 肘角 {Math.round(state.angle!)}°</p>}
    <button type="button" className="pill" onClick={()=>finish(current.current)}>{failed ? '返回选择来源' : '结束本组'}</button>
  </section>
}

export function RowLab({ onExit }: { onExit: () => void }) {
  const [source,setSource]=useState<Input | null>(null)
  const [last,setLast]=useState<RowState | null>(null)
  useEffect(() => () => { if (source?.kind === 'file') URL.revokeObjectURL(source.url) },[source])
  const start=(input: Input) => { setLast(null); setSource(input) }
  const finish=(state: RowState) => { setLast(state); setSource(null) }
  return <main className="history-page row-lab">
    <button type="button" className="row-lab-back" onClick={onExit}>‹ 返回</button>
    <h1>坐姿划船 <small>实验版</small></h1>
    {source ? <RowRun source={source} finish={finish}/> : <>
      {last && <section className="row-lab-result" aria-label="本组结果">
        <h2>本组确认 {last.count} 次</h2>
        <p>可见帧 {Math.round(last.coverage*100)}% · 结束时尚未还原的动作不计入。</p>
      </section>}
      <p>把镜头固定在身体侧面，尽量只留一人入镜，露出肩、肘和手腕。先向前伸臂，再拉向躯干，最后向前还原，完成一次计数。</p>
      <div className="row-lab-inputs">
        <button type="button" className="pill" onClick={()=>start({kind:'camera'})}>打开摄像头</button>
        <button type="button" className="pill ghost" onClick={()=>start({kind:'demo'})}>播放真实划船示范</button>
        <label>选择本地视频<input type="file" accept="video/*" onChange={event=>{
          const file=event.target.files?.[0]
          if(file) start({kind:'file',url:URL.createObjectURL(file)})
        }}/></label>
      </div>
      <p className="row-lab-note">画面仅在当前设备分析。本页的计数供试用，结束后不写入训练历史或 EXP。</p>
    </>}
    {(source?.kind === 'demo' || !source) && <p className="row-lab-credit">示范来源 · 헬스티비 Health TV／Team GO4IT，第 47 集，CC BY 3.0，节选并静音。 <a href="/showcase/CREDITS.txt" target="_blank" rel="noreferrer">完整署名</a></p>}
  </main>
}
