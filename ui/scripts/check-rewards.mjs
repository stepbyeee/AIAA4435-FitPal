// Run from ui/, with a local app and the same FITPAL_* browser variables as check-session.mjs.
// To recreate the 24.28-s input locally from the original 25 fps branch fixture:
// ffmpeg -i public/demo/pulldown.webm -vf scale=360:640,tpad=stop_mode=clone:stop_duration=6 -pix_fmt yuv420p -f yuv4mpegpipe /tmp/rewards-source.y4m
// node scripts/check-rewards.mjs --camera /tmp/rewards-source.y4m --output /tmp/rewards-result.json
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile,mkdtemp,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
const { values }=parseArgs({options:{camera:{type:'string'},output:{type:'string'}}})
if (!values.camera || !values.output) throw Error('Use --camera ORIGINAL_Y4M --output REPORT.json')
const work=await mkdtemp(join(tmpdir(),'fitpal-rewards-'))
const fixture=join(work,'loop.y4m')
const input=resolve(values.camera)
const N=457, fps=25, side=12
const originalSeconds=Number(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=duration','-of','csv=p=0',input],{encoding:'utf8'}).trim())
assert(Math.abs(originalSeconds-24.28)<.02,'Expected the 24.28 s original camera fixture with an appended still.')
execFileSync('ffmpeg',['-v','error','-i',input,'-frames:v',String(N),'-pix_fmt','yuv420p','-f','yuv4mpegpipe',fixture])
const reference=execFileSync('ffmpeg',['-v','error','-i',fixture,'-vf',`scale=${side}:${side}:flags=area`,'-pix_fmt','gray','-f','rawvideo','-'])
assert.equal(reference.length,N*side*side)
const report={fixture:'Existing pulldown Y4M, 360×640 at 25 fps. First 457 frames kept byte-for-byte in YUV, removing only the appended 6 s still that ends a normal set after 5 s. Chrome loops the 18.28 s movement sequence.',sourceSha256:createHash('sha256').update(await readFile(input)).digest('hex'),
 loopSha256:createHash('sha256').update(await readFile(fixture)).digest('hex'),scope:'Simulated-camera reward and purchase regression on a repeated known demonstrator.',startedAt:new Date().toISOString(),sets:[],errors:[]}
const save=()=>writeFile(resolve(values.output),JSON.stringify(report,null,2)+'\n')
const module=process.env.FITPAL_PLAYWRIGHT
const { chromium }=await import(module ? pathToFileURL(resolve(module)).href : 'playwright')
const browser=await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+fixture]})
report.browser=browser.version()
const origin=process.env.FITPAL_URL ?? 'http://127.0.0.1:5190'
const started=Date.now()
const elapsed=()=>Math.round((Date.now()-started)/100)/10
let activePage
// Align camera media time to the reference independently of the rep output,
// by matching tiny grayscale thumbnails over a complete stream. Emit times, never pixels.
function align(frames,events){
  if(!frames.length) return {status:'no frames'}
  const scores=Array.from({length:N},(_,offset)=>{
    let sum=0
    for(const f of frames){
      const ref=((Math.round(f.t*fps)+offset)%N)*side*side
      for(let j=0;j<f.p.length;j++){const diff=f.p[j]-reference[ref+j];sum+=diff*diff}
    }
    return {offset,mse:sum/(frames.length*side*side)}
  }).sort((a,b)=>a.mse-b.mse)
  const best=scores[0]
  const windows=[[2.15,4.10],[5.88,7.60],[9.25,11],[12.72,14.70],[16.32,18.27]]
  const known=[]
  for(let k=-1;k<8;k++)for(const [i,[bottom,top]] of windows.entries())known.push({id:k*5+i,lo:k*N/fps+bottom,hi:k*N/fps+top+.35})
  const used=new Set()
  const matches=events.map(time=>{
    const t=time+best.offset/fps
    const found=known.find(w=>!used.has(w.id)&&w.lo<=t&&t<=w.hi)
    if(found)used.add(found.id)
    return {cameraTimeSec:+time.toFixed(2),sourceLoopSec:+(t%(N/fps)).toFixed(2),referenceCycle:found?.id ?? null}
  })
  const ids=matches.map(e=>e.referenceCycle).filter(v=>v!==null)
  return {thumbnailCount:frames.length,offsetSec:best.offset/fps,thumbnailMeanSquaredError:+best.mse.toFixed(1),matches,
    unmatchedCompletions:events.length-ids.length,skippedReferenceCyclesBetweenFirstAndLast:ids.length ? ids.at(-1)-ids[0]+1-ids.length : null}
}
try {
  const context=await browser.newContext()
  const page=await context.newPage()
  activePage=page
  report.origin=new URL(origin).origin
  report.navigation=[]
  page.on('framenavigated',f=>{if(f===page.mainFrame())report.navigation.push({elapsed:elapsed(),route:new URL(f.url()).hash})})
  page.setDefaultTimeout(30000)
  page.on('pageerror',e=>report.errors.push(e.message))
  await page.addInitScript(({side})=>{
    const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    window.rewardStreams=[]
    navigator.mediaDevices.getUserMedia=async constraints=>{
      const stream=await get(constraints);window.rewardStreams.push({stream,frames:[],events:[]});return stream
    }
    const canvas=document.createElement('canvas');canvas.width=side;canvas.height=side
    const ctx=canvas.getContext('2d',{willReadFrequently:true})
    let previousStage='',lastCount=0,lastSample=-1
    setInterval(()=>{
      const video=document.querySelector('video')
      const track=window.rewardStreams.at(-1)
      if (!video||!track||!video.videoWidth||video.readyState<2)return
      const t=video.currentTime
      if(Math.abs(t-lastSample)>=.4 || t<lastSample){
        ctx.drawImage(video,0,0,side,side)
        const rgba=ctx.getImageData(0,0,side,side).data,p=[]
        for(let i=0;i<rgba.length;i+=4)p.push(Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]))
        track.frames.push({t,p});lastSample=t
      }
      const stage=document.querySelector('.live-panel-heading h2')?.textContent ?? ''
      const n=Number(document.querySelector('.count-now')?.textContent??0)
      if(stage!==previousStage)lastCount=0
      if(/^第 \d+ 组$/.test(stage) && n>lastCount)track.events.push(t)
      previousStage=stage;lastCount=n
    },40)
  },{side})
  await page.goto(origin)
  const button=(name)=>page.getByRole('button',{name,exact:true})
  await button('开始').click()
  async function set(n,target,measure=true){
    await page.locator('.live-panel-heading h2',{hasText:'第 '+n+' 组'}).waitFor({timeout:50000})
    const began=elapsed()
    await page.waitForFunction(k=>Number(document.querySelector('.count-now')?.textContent)>=k,target,{timeout:80000})
    await page.waitForFunction(k=>window.rewardStreams.at(-1).events.length>=k,target,{timeout:1500})
    await button('结束这一组').click()
    await page.getByRole('region',{name:'训练回顾'}).waitFor()
    const statuses=await page.locator('.review-choices button').evaluateAll(bs=>bs.map(b=>b.dataset.status))
    const stream=await page.evaluate(()=>{
      const s=window.rewardStreams.at(-1);return {events:s.events,frames:s.frames,ended:s.stream.getTracks().every(t=>t.readyState==='ended')}
    })
    assert(stream.ended)
    const result={set:n,confirmed:statuses.filter(v=>v!=='gap').length,inRange:statuses.filter(v=>v==='met').length,
      uncertain:statuses.filter(v=>v==='gap').length,short:statuses.filter(v=>v==='short').length,seconds:+(elapsed()-began).toFixed(1),released:stream.ended}
    if(measure)result.repeatCheck=align(stream.frames,stream.events)
    console.log(JSON.stringify({set:n,target,...result,repeatCheck:result.repeatCheck?.unmatchedCompletions}))
    result.reviewHeading=await page.locator('.set-review-stage h2').innerText()
    return result
  }
  for(let n=1;n<=3;n++){
    report.sets.push(await set(n,10));await save()
    if(n<3)await button('开始第 '+(n+1)+' 组').click()
  }
  await button('完成').click()
  const balance=async()=>Number((await page.locator('.points').innerText()).match(/\d+/)?.[0])
  const history=async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('fitpal.history.v3')))
  const original=await history()
  assert.equal(original.length,1)
  report.summary=original[0].sets
  assert.deepEqual(report.summary.map(s=>s.verified),report.sets.map(s=>s.confirmed))
  assert(report.summary.every(s=>s.quality===5))
  report.totalExp=report.summary.reduce((n,s)=>n+s.verified+s.quality+s.fixed,0)
  report.level=await page.locator('.level-now').innerText()
  report.beforePurchase=await balance()
  assert.match(report.level,/Lv 2/);assert.equal(report.beforePurchase,2)
  await button('发带，1 点').click()
  await button('发带，已穿上').waitFor()
  report.afterPurchase=await balance();assert.equal(report.afterPurchase,1)
  await page.reload()
  await button('发带，已穿上').waitFor()
  report.afterReload=await balance();assert.equal(report.afterReload,1)
  report.gear=await page.evaluate(()=>JSON.parse(localStorage.getItem('fitpal.gear.v2')))
  assert.deepEqual(report.gear,['headband'])
  await page.getByRole('link',{name:'衣橱'}).click()
  await page.getByText('可用 1 张 · 累计获得 1 张').waitFor()
  await page.getByRole('button',{name:/抽一件/}).click()
  await page.getByText('可用 0 张 · 累计获得 1 张').waitFor()
  report.workoutTicket={earned:1,afterDraw:0,dailyClaimUsed:false,item:await page.getByRole('button',{name:/^穿戴/}).getAttribute('aria-label')}
  await page.getByRole('link',{name:'训练记录'}).click()
  await page.getByText('本机数据设置',{exact:true}).click()
  await page.getByRole('checkbox',{name:'保存今后的摄像头训练摘要'}).uncheck()
  await page.getByRole('link',{name:'FitPal 首页'}).click()
  await button('开始').click()
  const privateSets=[]
  for(let n=1;n<=3;n++){
    privateSets.push(await set(n,1,false))
    if(n<3)await button('开始第 '+(n+1)+' 组').click()
  }
  await button('完成').click()
  assert.deepEqual(await history(),original)
  await page.getByRole('link',{name:'衣橱'}).click()
  await page.getByText('可用 0 张 · 累计获得 1 张').waitFor()
  report.optOut={verified:privateSets.map(s=>s.confirmed),newHistoryRows:0,newTickets:0,previousRows:original.length}
  assert.deepEqual(report.errors,[])
  assert(report.sets.every(s=>s.inRange>=10))
  assert(report.sets.every(s=>s.repeatCheck.unmatchedCompletions===0 && s.repeatCheck.skippedReferenceCyclesBetweenFirstAndLast===0))
  report.pass=true
} catch(e) {
  report.errors.push(String(e));report.pass=false;process.exitCode=1
  report.failureScreen=await activePage?.locator('body').innerText().catch(()=>null)
}
finally {report.wallSeconds=elapsed();await save();await browser.close();await rm(work,{recursive:true,force:true})}
