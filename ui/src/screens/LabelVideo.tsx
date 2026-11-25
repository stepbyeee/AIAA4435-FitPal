import { useEffect, useRef, useState } from 'react'
import { appendLabel, endOf, makeLabelFile, readLabelFile, validClipId, type CycleStatus, type Exclusion, type LabelEntry, type LabelSession, type Rater } from '../study/videoLabels'
import './label-video.css'

const statuses:Record<CycleStatus,string> = {visible:'完整可见',short:'幅度偏短',uncertain:'无法确定'}
const reasons:Record<Exclusion,string> = {partial:'动作截断',occluded:'关键点被挡',cut:'切镜'}
const sec = (time:number) => time.toFixed(2) + ' 秒'
const errorText = (e:unknown) => e instanceof Error ? e.message : '操作未完成。'

export function LabelVideo() {
  const video = useRef<HTMLVideoElement>(null)
  const version = useRef(0)
  const [source,setSource] = useState<{url:string;extension:'mp4'|'webm'}|null>(null)
  const [hash,setHash] = useState('')
  const [duration,setDuration] = useState(0)
  const [time,setTime] = useState(0)
  const [playing,setPlaying] = useState(false)
  const [speed,setSpeed] = useState(1)
  const [id,setId] = useState('')
  const [exercise,setExercise] = useState<LabelSession['exercise']>('lat-pulldown')
  const [rater,setRater] = useState<Rater>('A')
  const [entries,setEntries] = useState<LabelEntry[]>([])
  const [marks,setMarks] = useState<number[]>([])
  const [mode,setMode] = useState<'cycle'|'excluded'>('cycle')
  const [status,setStatus] = useState<CycleStatus>('visible')
  const [reason,setReason] = useState<Exclusion>('partial')
  const [reviewed,setReviewed] = useState(false)
  const [dirty,setDirty] = useState(false)
  const [message,setMessage] = useState('')
  const ready = Boolean(source && duration > 0 && hash)
  const unsaved = dirty && (entries.length > 0 || marks.length > 0 || reviewed)
  const replacementAllowed = () => !unsaved || window.confirm('替换当前页尚未导出的标注？')
  useEffect(()=>()=>{ if(source) URL.revokeObjectURL(source.url) },[source])
  useEffect(()=>{
    if (!unsaved) return
    const leave = (e:BeforeUnloadEvent) => { e.preventDefault(); e.returnValue='' }
    const editingUrl = window.location.href
    let acceptedUrl = ''
    const changingRoute = (e:Event) => {
      const destination = window.location.href
      if (destination === editingUrl || destination === acceptedUrl) return
      if (window.confirm('离开并放弃尚未导出的标注？')) { acceptedUrl = destination; return }
      // Hash navigation has already advanced the history pointer but React has not unmounted yet.
      // Re-establish this entry without emitting another hashchange or dropping the in-memory marks.
      window.history.pushState(window.history.state, '', editingUrl)
      e.stopImmediatePropagation()
    }
    window.addEventListener('beforeunload',leave)
    window.addEventListener('popstate',changingRoute,true)
    window.addEventListener('hashchange',changingRoute,true)
    return ()=>{
      window.removeEventListener('beforeunload',leave)
      window.removeEventListener('popstate',changingRoute,true)
      window.removeEventListener('hashchange',changingRoute,true)
    }
  },[unsaved])

  async function openFile(file:File) {
    const ext = file.name.toLowerCase().split('.').at(-1)
    if (ext !== 'mp4' && ext !== 'webm') { setMessage('请选择 MP4 或 WebM。'); return }
    if (!replacementAllowed()) return
    const token=++version.current
    setSource({url:URL.createObjectURL(file),extension:ext})
    setHash(''); setDuration(0); setTime(0); setPlaying(false); setSpeed(1); setId('')
    setEntries([]); setMarks([]); setReviewed(false); setDirty(false); setMessage('正在核对视频内容…')
    try {
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
      if (token !== version.current) return
      setHash(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''))
      setMessage('')
    } catch { if (token === version.current) setMessage('无法在本机校验这个文件。请使用本机地址或 HTTPS 重试。') }
  }
  function seek(target:number) {
    if (!video.current || !Number.isFinite(target)) return
    video.current.pause()
    video.current.currentTime = Math.max(0,Math.min(duration,target))
    setTime(video.current.currentTime)
  }
  function mark() {
    if (!ready || !video.current) return
    video.current.pause()
    const t=Math.min(duration,Math.round(video.current.currentTime*1000)/1000)
    const previousEnd=entries.length ? endOf(entries[entries.length-1]) : 0
    if ((!marks.length && t < previousEnd) || (marks.length > 0 && t <= marks[marks.length-1])) {
      setMessage('请把视频移到上一标记之后，再标记当前位置。');return
    }
    const next=[...marks,t]
    setMessage('');setDirty(true);setReviewed(false)
    if (next.length < (mode === 'cycle' ? 3 : 2)) {setMarks(next);return}
    try {
      const entry:LabelEntry=mode === 'cycle'
        ? {kind:'cycle',startSec:next[0],bottomSec:next[1],topSec:next[2],status}
        : {kind:'excluded',startSec:next[0],endSec:next[1],reason}
      setEntries(appendLabel(entries,entry,duration));setMarks([])
    } catch(e){setMessage(errorText(e))}
  }
  async function importFile(file:File) {
    if (!ready || !replacementAllowed()) return
    const token=version.current
    try {
      const labels=readLabelFile(JSON.parse(await file.text()),hash,duration)
      if (token !== version.current) return
      setId(labels.id);setExercise(labels.exercise);setRater(labels.rater);setEntries(labels.entries)
      setMarks([]);setReviewed(labels.reviewed);setDirty(false);setMessage('已载入与这段视频匹配的标注。')
    } catch(e){if (token === version.current) setMessage(errorText(e))}
  }
  function download() {
    if (!source || !ready || marks.length) return
    try {
      const payload=makeLabelFile({id,extension:source.extension,durationSec:duration,sha256:hash,exercise,rater,reviewed,entries})
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}))
      const link=document.createElement('a')
      link.href=url;link.download=id+'-'+rater+'.json';link.click()
      setTimeout(()=>URL.revokeObjectURL(url),1000);setDirty(false);setMessage('标注已导出。')
    } catch(e){setMessage(errorText(e))}
  }
  const eligible = reviewed && entries.every(e=>e.kind === 'cycle' && e.status !== 'uncertain')
  return <main className="label-page">
    <header><h1>本地视频标注</h1><p>为同一动作标出起点、最低点和返回点。视频留在本机，离开此页前导出标注。</p></header>
    <div className="label-layout">
      <section className="label-player" aria-label="视频时间线">
        <label className="label-upload"><span>{source ? '更换本地视频 · '+source.extension.toUpperCase()+' 已打开' : '选择本地 MP4 或 WebM'}</span><input aria-label="本地视频" type="file" accept=".mp4,.webm,video/mp4,video/webm" onChange={e=>{
          const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file) void openFile(file)
        }}/></label>
        {source && <video key={source.url} ref={video} src={source.url} preload="auto" muted playsInline
          onDurationChange={e=>{const n=e.currentTarget.duration;setDuration(Number.isFinite(n) && n>0 ? n : 0)}}
          onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onSeeked={e=>setTime(e.currentTarget.currentTime)}
          onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}
          onError={()=>setMessage('浏览器无法解码这段视频，请检查文件或重新封装为 MP4。')} />}
        {source && !duration && <p>正在读取可定位的时长。如果录像缺少时间索引，可先在本机重新封装。</p>}
        {duration > 0 && <>
          <div className="label-time"><output>{sec(time)} / {sec(duration)}</output>
            <label>播放速度<select aria-label="播放速度" value={speed} onChange={e=>{
              const rate=Number(e.target.value);if(video.current) video.current.playbackRate=rate;setSpeed(rate)
            }}>{[0.25,0.5,1].map(n=><option key={n} value={n}>{n}×</option>)}</select></label>
          </div>
          <input aria-label="定位秒数" type="range" min="0" max={duration} step="0.001" value={time} onChange={e=>seek(Number(e.target.value))}/>
          <div className="label-controls">
            <button onClick={()=>seek((video.current?.currentTime ?? time)-0.04)}>−0.04 秒</button>
            <button onClick={()=>{if(playing) video.current?.pause();else video.current?.play().catch(()=>setMessage('无法播放这段视频。'))}}>{playing?'暂停':'播放'}</button>
            <button onClick={()=>seek((video.current?.currentTime ?? time)+0.04)}>+0.04 秒</button>
          </div>
        </>}
      </section>
      <section className="label-panel" aria-label="动作标记">
        <label>匿名片段编号<input placeholder="例如 P01-LP-01" value={id} onChange={e=>{setId(e.target.value);setDirty(true)}}/></label>
        <div className="label-fields">
          <label>动作<select aria-label="动作" value={exercise} onChange={e=>{setExercise(e.target.value === 'squat' ? 'squat' : 'lat-pulldown');setReviewed(false);setDirty(true)}}>
            <option value="lat-pulldown">高位下拉</option><option value="squat">深蹲</option></select></label>
          <label>标注者<select aria-label="标注者" value={rater} onChange={e=>{setRater(e.target.value as Rater);setDirty(true)}}>
            <option>A</option><option>B</option><option value="consensus">复核定稿</option></select></label>
        </div>
        <div className="label-fields">
          <label>标记类型<select aria-label="标记类型" value={mode} disabled={marks.length>0} onChange={e=>setMode(e.target.value === 'cycle' ? 'cycle' : 'excluded')}>
            <option value="cycle">一次动作</option><option value="excluded">排除区间</option></select></label>
          {mode === 'cycle' ? <label>这次动作<select aria-label="这次动作" value={status} onChange={e=>setStatus(e.target.value as CycleStatus)}>
            {Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
            : <label>排除原因<select aria-label="排除原因" value={reason} onChange={e=>setReason(e.target.value as Exclusion)}>{Object.entries(reasons).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
        </div>
        {marks.length>0 && <p>本条已标记　{marks.map(sec).join(' → ')}</p>}
        <div className="label-controls">
          <button className="pill" disabled={!ready} onClick={mark}>标记{(mode === 'cycle' ? ['起点','最低点','返回点'] : ['区间起点','区间终点'])[marks.length]}</button>
          <button disabled={!marks.length && !entries.length} onClick={()=>{
            if(marks.length) {
              setMarks(marks.slice(0,-1))
            } else {
              const last=entries[entries.length-1]
              setEntries(entries.slice(0,-1));setMode(last.kind)
              if (last.kind === 'cycle') {setMarks([last.startSec,last.bottomSec]);setStatus(last.status)}
              else {setMarks([last.startSec]);setReason(last.reason)}
            }
            setReviewed(false);setDirty(true);setMessage('')
          }}>撤销上一步</button>
        </div>
      </section>
    </div>
    <section className="label-list" aria-label="标注记录">
      <h2>标注记录 · {entries.length}</h2>
      {!!entries.length && <ol>{entries.map((entry,i)=><li key={i}>
        <button onClick={()=>seek(entry.kind === 'cycle' ? entry.bottomSec : entry.startSec)}>
          {entry.kind==='cycle' ? '动作' : '区间'} {i+1} · {[entry.startSec,...(entry.kind==='cycle'?[entry.bottomSec]:[]),endOf(entry)].map(sec).join(' → ')}
        </button>
        {entry.kind==='cycle' ? <select aria-label={'第 '+(i+1)+' 条状态'} value={entry.status} onChange={e=>{
          const next=[...entries];next[i]={...entry,status:e.target.value as CycleStatus};setEntries(next);setReviewed(false);setDirty(true)
        }}>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select> : <span>{reasons[entry.reason]}</span>}
      </li>)}</ol>}
      <label className="label-check"><input type="checkbox" disabled={!ready || marks.length>0} checked={reviewed} onChange={e=>{setReviewed(e.target.checked);setDirty(true)}}/>已看完整段并核对全部标记</label>
      <p>{eligible ? '可用于动作计数对照。' : '草稿、含排除区间或不确定动作的整段暂不参加计数评分。'}</p>
      <div className="label-fields">
        <button className="pill" disabled={!ready || !validClipId(id) || marks.length>0} onClick={download}>导出标注 JSON</button>
        <label className="label-upload"><span>载入已有标注</span><input aria-label="载入已有标注" disabled={!ready} type="file" accept=".json,application/json" onChange={e=>{
          const f=e.currentTarget.files?.[0];e.currentTarget.value='';if(f)void importFile(f)
        }}/></label>
      </div>
    </section>
    {message && <p role="status">{message}</p>}
  </main>
}
