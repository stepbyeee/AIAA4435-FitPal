// From ui/: run against a frozen baseline and candidate Vite server. Only local files are read.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'

const {values:v} = parseArgs({options:{
  manifest:{type:'string',multiple:true},output:{type:'string'},before:{type:'string',default:'http://127.0.0.1:5240'},
  after:{type:'string',default:'http://127.0.0.1:5241'},clips:{type:'string'},media:{type:'string'},
  traces:{type:'string'},'baseline-only':{type:'boolean'},
}})
if(!v.manifest || !v.output) throw Error('Pass --manifest FILE --output FILE')
const origins=[v.before,v.after].map(x=>new URL(x))
if(origins.some(u=>!['localhost','127.0.0.1','[::1]'].includes(u.hostname))) throw Error('Use loopback servers')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const manifests = await Promise.all(v.manifest.map(path => readFile(path)))
const clips = manifests.flatMap(data => JSON.parse(data).clips).filter(c=>c.exercise==='lat-pulldown' && (!v.clips || v.clips.split(',').includes(c.file)))
if(!clips.length) throw Error('No matching high pulldown clips')
if(new Set(clips.map(c=>c.file)).size!==clips.length) throw Error('Duplicate clip id')
if(v.traces) await mkdir(v.traces,{recursive:true})
const temp=await mkdtemp(join(tmpdir(),'fitpal-pair-'))
const browser=await chromium.launch({executablePath:process.env.FITPAL_CHROME})
const report={protocol:{fps:15,maxDimension:640,delegate:'CPU',browser:browser.version(),manifestSha256:manifests.map(sha),
  modelSha256:sha(await readFile('public/mediapipe/pose_landmarker_full.task')),sources:{}},clips:[]}
async function makePage(origin,mode) {
  const page=await browser.newPage()
  await page.route(origin.origin+'/__pulldown_pair__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>FitPal paired replay</title>'}))
  await page.route('https://**/*',r=>r.abort())
  await page.goto(origin.origin+'/__pulldown_pair__')
  const sourceTexts=await page.evaluate(async({mode})=>{
    const sources=['perception/pulldown','tracking/armLandmarks','tracking/limbLandmarks','tracking/armTrails','perception/repReview','contract']
    if(mode==='after') {
      sources.push('perception/pulldownUpperArm','tracking/armOcclusion')
    }
    const raw={}
    for(const name of sources) raw[name]=(await import('/src/'+name+'.ts?raw')).default
    const {FilesetResolver,PoseLandmarker}=await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
    const detector=await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/mediapipe/wasm'),{
      baseOptions:{modelAssetPath:'/mediapipe/pose_landmarker_full.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1})
    const {createPulldown}=await import('/src/perception/pulldown.ts')
    const {advanceArmTrails,emptyArmTrails}=await import('/src/tracking/armTrails.ts')
    const filter=mode==='after'?(await import('/src/tracking/armOcclusion.ts')).createArmOcclusionFilter():null
    let engine=createPulldown(), calibration=null, i=0, trails=emptyArmTrails, lastCal=0
    const cal=[], verified=[], timing=[], trace=[]
    const visible={left:0,right:0}
    window.batch=async({images,tracing})=>{
      for(const png of images) {
        const bitmap=await createImageBitmap(new Blob([Uint8Array.fromBase64(png)],{type:'image/png'}))
        try {
          const {width,height}=bitmap, timestampMs=i*1000/15, t=performance.now()
          const poses=detector.detectForVideo(bitmap,timestampMs).landmarks.map(points=>points.map(p=>({x:p.x,y:p.y,visibility:p.visibility??0})))
          const target=poses[0]??null
          const landmarks=filter?filter.filter(target,bitmap,width,height,timestampMs):target
          const frame={landmarks,width,height,timestampMs}
          const state=engine.accept(frame)
          trails=advanceArmTrails(trails,frame,'arm')
          timing.push(performance.now()-t)
          for(const side of ['left','right']) if(trails[side].length) visible[side]++
          const sec=+(timestampMs/1000).toFixed(3)
          if(!calibration) {
            if(state.repCount>lastCal) {lastCal=state.repCount;cal.push(sec)}
            calibration=engine.getCalibration()
            if(calibration){engine=createPulldown(calibration); engine.accept(frame)}
          } else if(state.repCount>verified.length) verified.push(sec)
          if(tracing) {
            const arms={}
            for(const s of ['left','right']) {
              const p=trails[s].at(-1)
              if(p) arms[s]=[p.proximal,p.joint,p.distal].map(a=>[+a.x.toFixed(4),+a.y.toFixed(4)])
              if(p && trails[s].length===1) arms[s+'Break']=true
            }
            trace.push({sec,cal:Math.min(3,lastCal),count:verified.length,phase:state.phase,arms})
          }
          i++
        } finally {bitmap.close()}
      }
    }
    window.finishPair=()=>{
      detector.close()
      const warm=timing.slice(1).sort((a,b)=>a-b)
      return {run:{frames:i,calibrationEvents:cal,verifiedEvents:verified,calibration,attempts:engine.endSet().reps,
        visibleFrames:visible,p95ProcessingMs:+warm[Math.floor(warm.length*0.95)].toFixed(2)},trace}
    }
    return raw
  },{mode})
  const hashes=Object.fromEntries(Object.entries(sourceTexts).map(([k,s])=>[k,sha(s)]))
  if(report.protocol.sources[mode] && JSON.stringify(hashes)!==JSON.stringify(report.protocol.sources[mode])) throw Error(mode+' changed during replay')
  report.protocol.sources[mode]=hashes
  return page
}
try {
  for(const clip of clips) {
    if(basename(clip.file)!==clip.file || basename(clip.asset??clip.file)!==(clip.asset??clip.file)) throw Error('Invalid asset name')
    const input=resolve(v.media??(clip.appDemo?'public/demo':'.benchmark-assets/video'),clip.asset??clip.file)
    if(sha(await readFile(input))!==clip.sha256) throw Error('Source checksum mismatch: '+clip.file)
    const frames=join(temp,clip.file); await mkdir(frames)
    const argv=clip.startSec===undefined?[]:['-ss',String(clip.startSec)]
    const duration=clip.startSec===undefined?[]:['-t',String(clip.durationSec)]
    execFileSync('ffmpeg',['-v','error',...argv,'-i',input,...duration,'-an','-vf','fps=15,scale=640:640:force_original_aspect_ratio=decrease',join(frames,'%06d.png')])
    const names=(await readdir(frames)).sort()
    const pages=[await makePage(origins[0],'before')]
    if(!v['baseline-only']) pages.push(await makePage(origins[1],'after'))
    const digest=createHash('sha256')
    for(let i=0;i<names.length;i+=12) {
      const buffers=await Promise.all(names.slice(i,i+12).map(n=>readFile(join(frames,n))))
      for(const b of buffers) digest.update(b)
      const batch={images:buffers.map(b=>b.toString('base64')),tracing:!!v.traces}
      // Sequential timings avoid running the two pose detectors simultaneously.
      for(const page of pages) await page.evaluate(batch=>window.batch(batch),batch)
    }
    const row={file:clip.file,sourceSha256:clip.sha256,windows:clip.windows,visualCycles:clip.visualCycles,decodedPngsSha256:digest.digest('hex')}
    const tracks={}
    for(const [j,page] of pages.entries()) {
      const name=j===0?'before':'after'
      const {run,trace}=await page.evaluate(()=>window.finishPair())
      row[name]=run;tracks[name]=trace
      await page.close()
    }
    if(v.traces) await writeFile(join(v.traces,clip.file+'.json'),JSON.stringify(tracks))
    report.clips.push(row)
    await writeFile(v.output,JSON.stringify(report,null,2)+'\n')
    console.log(clip.file,JSON.stringify([row.before,row.after].filter(Boolean).map(s=>[s.calibrationEvents,s.verifiedEvents])))
    await rm(frames,{recursive:true})
  }
}finally{await browser.close();await rm(temp,{recursive:true,force:true})}
