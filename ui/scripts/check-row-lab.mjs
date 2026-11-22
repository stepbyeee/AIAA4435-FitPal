// Real UI lifecycle test; optional attribution-bearing recording of the built-in GO4IT excerpt.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
const { values } = parseArgs({options:{record:{type:'string'},output:{type:'string'}}})
const origin = new URL(process.env.FITPAL_URL || 'http://127.0.0.1:5190')
if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) throw Error('Local Vite server required')
const { chromium } = await import(process.env.FITPAL_PLAYWRIGHT ? pathToFileURL(resolve(process.env.FITPAL_PLAYWRIGHT)).href : 'playwright')
const browser = await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']})
const folder=await mkdtemp(join(tmpdir(),'fitpal-row-ui-'))
try {
  const page=await browser.newPage({viewport:{width:900,height:770},permissions:['camera'],reducedMotion:'reduce'})
  const errors=[]
  page.on('pageerror',err=>errors.push(err.message))
  await page.addInitScript(()=>{
    window.revoked=[]
    const revoke=URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL=url=>{window.revoked.push(url);revoke(url)}
  })
  await page.goto(origin.href)
  const storage=()=>page.evaluate(()=>Object.entries(localStorage).sort())
  const before=await storage()
  await page.getByRole('link',{name:'侧面计数 · 实验'}).click()
  await page.getByRole('button',{name:'播放真实划船示范'}).click()
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v && !v.paused && v.currentTime>0})
  const credit='Footage: Health TV / GO4IT #47 / CC BY 3.0 / commons.wikimedia.org/?curid=61802622 / FitPal excerpt and overlays'
  if(values.record) await page.evaluate(text=>{
    const footer=document.createElement('footer')
    footer.style.cssText='position:fixed;bottom:0;left:0;right:0;padding:7px;background:#10181d;color:white;font:12px system-ui;z-index:200'
    footer.textContent=text
    document.body.appendChild(footer)
  },credit)
  const frames=[],events=[]
  let sawBoth=false
  const started=performance.now()
  while(performance.now()-started<65000) {
    const t=performance.now()
    const snapshot=await page.evaluate(()=>({
      count:Number(document.querySelector('.row-lab-counter strong')?.textContent || 0),
      time:document.querySelector('video')?.currentTime ?? null,
      sides:document.querySelectorAll('g.arm-trail').length,
      result:document.querySelector('.row-lab-result h2')?.textContent ?? null,
    }))
    if(snapshot.sides===2) sawBoth=true
    if(snapshot.count>events.length && snapshot.time !== null) events.push(+snapshot.time.toFixed(2))
    if(values.record) {
      const file=String(frames.length).padStart(5,'0')+'.jpg'
      await page.screenshot({type:'jpeg',quality:85,path:join(folder,file)})
      frames.push({t,file})
    }
    if(snapshot.result) break
    await delay(Math.max(1,160-(performance.now()-t)))
  }
  const result=await page.locator('.row-lab-result h2').innerText()
  const demoCount=Number(result.match(/\d+/)?.[0])
  assert(demoCount>0 && demoCount<=8 && sawBoth,'GO4IT playback and bilateral overlays')
  if(values.record){
    const duration=(i)=>((frames[i+1]?.t ?? frames[i].t+1900)-frames[i].t)/1000
    const lines=frames.map((frame,i)=>"file '"+frame.file+"'\nduration "+duration(i)).join('\n')
    await writeFile(join(folder,'capture.ffconcat'),lines+"\nfile '"+frames.at(-1).file+"'\n")
    execFileSync('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',join(folder,'capture.ffconcat'),'-vf','fps=24,format=yuv420p','-c:v','libx264','-crf','20','-movflags','+faststart','-metadata','comment='+credit,resolve(values.record)])
  }
  await page.locator('input[type=file]').setInputFiles(resolve('.benchmark-assets/video/ymove-seated-row.mp4'))
  await page.getByRole('button',{name:'结束本组'}).waitFor()
  await page.locator('.row-lab-result').waitFor({timeout:30000})
  const localResult=await page.locator('.row-lab-result h2').innerText()
  const localCount=Number(localResult.match(/\d+/)?.[0])
  assert(localCount>0 && localCount<=2,'Local file counts the visible example')
  const localUrlRevoked=await page.evaluate(()=>window.revoked.some(s=>s.startsWith('blob:')))
  assert(localUrlRevoked)
  await page.getByRole('button',{name:'打开摄像头'}).click()
  await page.waitForFunction(()=>{const s=document.querySelector('video')?.srcObject;if(!s)return false;window.rowTrack=s.getVideoTracks()[0];return window.rowTrack.readyState==='live'})
  await page.getByRole('button',{name:'‹ 返回'}).click()
  await page.getByRole('heading',{name:'今天练什么'}).waitFor()
  await page.waitForFunction(()=>window.rowTrack.readyState==='ended',null,{timeout:3000})
  const fakeCameraReleased=await page.evaluate(()=>window.rowTrack.readyState==='ended')
  assert(fakeCameraReleased)
  await page.goto(new URL('/#/manual/seated-row',origin).href)
  await page.getByRole('button',{name:'保存这一组'}).waitFor()
  await page.getByRole('link',{name:'试用侧面摄像头计数'}).click()
  await page.getByRole('button',{name:'播放真实划船示范'}).waitFor()
  await page.goto(new URL('/?study=rep-baseline#/lab/seated-row',origin).href)
  await page.getByRole('heading',{name:'今天练什么'}).waitFor()
  assert.equal(await page.getByRole('link',{name:'侧面计数 · 实验'}).count(),0)
  assert.deepEqual(await storage(),before)
  assert.deepEqual(errors,[])
  const report={browser:browser.version(),demo:{count:demoCount,observedTimes:events,observedBothArms:sawBoth},localFile:{count:localCount,blobUrlRevoked:localUrlRevoked},fakeCameraReleased,manualRoutePreserved:true,studyExcluded:true,storageUnchanged:true,pageErrors:errors}
  console.log(JSON.stringify(report))
  if(values.output) await writeFile(values.output,JSON.stringify(report,null,2)+'\n')
} finally { await browser.close(); await rm(folder,{force:true,recursive:true}) }
