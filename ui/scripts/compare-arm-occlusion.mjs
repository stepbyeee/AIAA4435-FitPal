// Fixed-frame paired overlay evaluation. Run against a local Vite dev server from ui/.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
const {values}=parseArgs({options:{output:{type:'string'},movie:{type:'string'}}})
if (!values.output) throw Error('Supply --output FILE.json and optionally --movie FILE.mp4')
const base=new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190')
if (!['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw Error('Use a local dev server')
const file=resolve('public/showcase/go4it-rear.mp4')
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex')
const temp=await mkdtemp(join(tmpdir(),'fitpal-arm-eval-'))
const fps=15, start=13, end=34
const movies=join(temp,'movies')
const refs=[{start:17,end:22},{start:27,end:32}]
const variants=['control','gray','wall']
const report={method:'Same decoded 640px 15 Hz PNG frames, CPU Full, one fresh tracker per condition, same raw detections for before/after. Source seconds 13–34, gray covers left then right as in original UI test. Wall uses opaque textured wall crops from a decoded source frame, on the opposite sides. Interior excludes 0.4 s at each end. Controlled transformations of one person. Wrist-match proxy uses the same image time in the clear control, with both wrists distinct; success requires the visible wrist within 10% of image height. Boundary delay uses two consecutive observations of a gap or recovery; null means not observed before the next boundary or 2 s after mask removal.',source:'public/showcase/go4it-rear.mp4',sha256:await hash(file),filterSha256:await hash('src/tracking/armOcclusion.ts'),fps,variants:[]}
let browser
try{
  execFileSync('ffmpeg',['-v','error','-ss',String(start),'-i',file,'-t',String(end-start),'-vf','fps=15,scale=640:-2','-an',join(temp,'%05d.png')])
  const frames=(await readdir(temp)).filter(n=>n.endsWith('.png')).sort()
  await mkdir(movies)
  browser=await chromium.launch({executablePath:process.env.FITPAL_CHROME})
  let filmIndex=0
  let reference=[]
  for(const variant of variants){
    const windows=refs.map((w,i)=>({...w,side:(i===0)===(variant!=='wall')?'left':'right'}))
    const page=await browser.newPage()
    const url=new URL('/__arm_benchmark__',base).href
    await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Arm test</title>'}))
    await page.goto(url)
    await page.evaluate(async()=>{
      const {FilesetResolver,PoseLandmarker}=await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
      const detector=await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/mediapipe/wasm'),{
        baseOptions:{modelAssetPath:'/mediapipe/pose_landmarker_full.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1})
      const {createArmOcclusionFilter}=await import('/src/tracking/armOcclusion.ts')
      const {advanceArmTrails,emptyArmTrails}=await import('/src/tracking/armTrails.ts')
      const filter=createArmOcclusionFilter()
      const sides=['left','right'], versions=['before','after'], rows=[]
      const trails={before:emptyArmTrails,after:emptyArmTrails}
      const image=document.createElement('canvas'),ctx=image.getContext('2d',{willReadFrequently:true})
      const wall=document.createElement('canvas')
      const film=document.createElement('canvas');film.width=1280;film.height=448
      const fc=film.getContext('2d')
      function render(time,window){
        fc.fillStyle='#12191e';fc.fillRect(0,0,1280,448)
        fc.font='600 21px sans-serif';fc.fillStyle='white';fc.fillText('FitPal  /  One-arm obstruction',16,29)
        fc.font='16px sans-serif';fc.fillText('Source '+time.toFixed(2)+' s    '+(window?'Obstruction: '+window.side:'Clear view'),740,28)
        for(const [i,v] of versions.entries()){
          const x=i*640
          fc.drawImage(image,x,42,640,360)
          fc.lineWidth=3
          for(const side of sides){
            const samples=trails[v][side]
            const last=samples.at(-1)
            if(!last)continue
            fc.strokeStyle=side==='left'?'#5ce2c4':'#ffc15b';fc.fillStyle=fc.strokeStyle
            const pos=p=>[x+p.x*640,42+p.y*360]
            fc.beginPath();fc.moveTo(...pos(last.proximal));fc.lineTo(...pos(last.joint));fc.lineTo(...pos(last.distal));fc.stroke()
            fc.beginPath();samples.forEach((p,j)=>j?fc.lineTo(...pos(p.distal)):fc.moveTo(...pos(p.distal)));fc.stroke()
            for(const p of [last.joint,last.distal]){fc.beginPath();fc.arc(...pos(p),4.5,0,2*Math.PI);fc.fill()}
          }
          const status=sides.map(s=>s[0].toUpperCase()+' '+(trails[v][s].length?'tracked':'gap')).join('   ')
          fc.fillStyle='white';fc.font='600 16px sans-serif'
          fc.fillText((v==='before'?'Previous':'Automatic arm filter')+'   ·   '+status,x+12,423)
        }
        fc.fillStyle='#adbac2';fc.font='12px sans-serif';fc.fillText('Footage: Health TV / Team GO4IT #47, CC BY 3.0  ·  commons.wikimedia.org/?curid=61802622  ·  Added obstruction, traces, labels',12,442)
        return film.toDataURL('image/jpeg',0.88).split(',')[1]
      }
      window.runBatch=async({images,index,fps,start,windows,variant,makeFilm})=>{
        const filmFrames=[]
        for(const [j,png] of images.entries()){
          const original=await createImageBitmap(new Blob([Uint8Array.fromBase64(png)],{type:'image/png'}))
          if(!image.width || index+j===0){ image.width=original.width;image.height=original.height;wall.width=original.width;wall.height=original.height;wall.getContext('2d').drawImage(original,0,0) }
          const {width,height}=image, t=start+(index+j)/fps, stamp=(index+j)*1000/fps
          ctx.drawImage(original,0,0);original.close()
          const active=windows.find(w=>t>=w.start&&t<w.end)
          if(active && variant!=='control'){
            const x=Math.round((active.side==='left'?.18:.53)*width),w=Math.round(.29*width),h=Math.round(.72*height)
            if(variant==='gray'){ctx.fillStyle='#808080';ctx.fillRect(x,0,w,h)}
            else ctx.drawImage(wall,0,0,Math.round(.16*width),h,x,0,w,h)
          }
          const raw=detector.detectForVideo(image,stamp).landmarks[0]?.map(p=>({x:p.x,y:p.y,visibility:p.visibility??0}))??null
          const tick=performance.now()
          const filtered=filter.filter(raw,image,width,height,stamp)
          const filterMs=performance.now()-tick
          const row={t:+t.toFixed(3),filterMs,wrist:{}}
          for(const v of versions){
            trails[v]=advanceArmTrails(trails[v],{landmarks:v==='before'?raw:filtered,width,height,timestampMs:stamp})
            row[v]=Object.fromEntries(sides.map(s=>[s,trails[v][s].length>0]))
            row.wrist[v]=Object.fromEntries(sides.map(s=>{
              const p=trails[v][s].at(-1)?.distal
              return [s,p?[p.x*width/height,p.y]:null]
            }))
          }
          rows.push(row)
          if(makeFilm && ((t>=16&&t<23)||(t>=26&&t<33))) filmFrames.push(render(t,active))
        }
        return filmFrames
      }
      window.finish=()=>{detector.close();return rows}
    })
    for(let i=0;i<frames.length;i+=16){
      const images=await Promise.all(frames.slice(i,i+16).map(async n=>(await readFile(join(temp,n))).toString('base64')))
      const filmFrames=await page.evaluate(args=>window.runBatch(args),{images,index:i,fps,start,windows,variant,makeFilm:variant==='gray'&&Boolean(values.movie)})
      for(const jpg of filmFrames) await writeFile(join(movies,String(filmIndex++).padStart(5,'0')+'.jpg'),Buffer.from(jpg,'base64'))
    }
    const rows=await page.evaluate(()=>window.finish())
    await page.close()
    const sections=windows.map(w=>({...w,rows:rows.filter(row=>row.t>=w.start+.4&&row.t<w.end-.4)}))
    const clean=rows.filter(row=>windows.every(w=>row.t<w.start-.4||row.t>=w.end+.4))
    function rates(list){
      const result={frames:list.length}
      for(const v of ['before','after'])result[v]=Object.fromEntries(['left','right'].map(s=>[s,list.filter(row=>row[v][s]).length]))
      return result
    }
    if(variant==='control') {
      // This rear-view clip's anatomical left is on screen left. The unmodified
      // detector is only a proxy, and ambiguous/collapsed control wrists are omitted.
      reference=rows.map(row=>{
        const hands=Object.values(row.wrist.before)
        if(hands.some(p=>!p) || Math.abs(hands[0][0]-hands[1][0])<.25) return null
        hands.sort((a,b)=>a[0]-b[0])
        return {left:hands[0],right:hands[1]}
      })
    }
    function visibleWristMatch(w) {
      const side=w.side==='left'?'right':'left'
      const result={referenceFrames:0,before:0,after:0}
      rows.forEach((r,index)=>{
        const ref=reference[index]?.[side]
        if(!ref || r.t<w.start+.4 || r.t>=w.end-.4) return
        result.referenceFrames++
        for(const v of ['before','after']){
          const p=r.wrist[v][side]
          if(p && Math.hypot(p[0]-ref[0],p[1]-ref[1])<=.1) result[v]++
        }
      })
      return result
    }
    function boundary(w,version) {
      function delay(start,end,visible){
        const candidates=rows.filter(row=>row.t>=start&&row.t<end)
        const first=candidates.find((r,i)=>r[version][w.side]===visible && candidates[i+1]?.[version][w.side]===visible)
        return first?+(first.t-start).toFixed(3):null
      }
      return {breakSec:delay(w.start,w.end,false),reacquireSec:delay(w.end,w.end+2,true)}
    }
    const times=rows.map(r=>r.filterMs).sort((a,b)=>a-b)
    report.variants.push({variant,frames:rows.length,clear:rates(clean),filterP95ms:+times[Math.floor(.95*times.length)].toFixed(2),windows:sections.map(({rows,...w})=>({...w,interior:rates(rows),visibleWristWithin10pctHeight:visibleWristMatch(w),transitionDelay:variant==='control'?null:{before:boundary(w,'before'),after:boundary(w,'after')}}))})
    console.log(JSON.stringify(report.variants.at(-1)))
    await writeFile(values.output,JSON.stringify(report,null,2)+'\n')
  }
  if(values.movie) execFileSync('ffmpeg',['-v','error','-y','-framerate',String(fps),'-i',join(movies,'%05d.jpg'),'-c:v','libx264','-crf','18','-vf','format=yuv420p','-movflags','+faststart',values.movie])
}finally{await browser?.close();await rm(temp,{recursive:true,force:true})}
