// Measure the visible UI's independent trails against known obstructions on real exercise footage.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values } = parseArgs({options:{output:{type:'string'}}})
if (!values.output) throw Error('Pass --output REPORT.json')
const origin = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190')
if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) throw Error('Use a local FitPal origin')
const original = resolve('public/showcase/go4it-rear.mp4')
const temp = await mkdtemp(join(tmpdir(),'fitpal-arm-block-'))
const masked = join(temp,'obstruction.mp4')
const windows = [{side:'left',start:17,end:22,x:0.18},{side:'right',start:27,end:32,x:0.53}]
const edits = windows.map(w => "drawbox=x=iw*"+w.x+":y=0:w=iw*0.29:h=ih*0.72:color=gray:t=fill:enable='between(t,"+w.start+","+w.end+")'")
const report = {source:'go4it-rear.mp4',model:'MediaPipe Full, normal browser session',
  method:'Two five-second gray boxes cover one arm at a time on a rear-view recording. Status is the arm group actually drawn, sampled in media-time bins of 0.2s. Fractions use sampled bins, omit 0.4s at both mask boundaries. Control re-encodes the same frames. This measures display under artificial masks on one source.',windows,runs:[]}
const browser = await chromium.launch({executablePath:process.env.FITPAL_CHROME})
try {
  for (const variant of ['control','masked']) {
    execFileSync('ffmpeg',['-v','error','-y','-i',original,'-an','-vf',variant==='masked'?edits.join(','):'null',
      '-pix_fmt','yuv420p','-c:v','libx264','-crf','17',masked])
    const page = await browser.newPage()
    await page.route('**/demo/arm-block.mp4',route=>route.fulfill({path:masked,contentType:'video/mp4'}))
    await page.goto(origin.origin+'/?video=arm-block.mp4#/session/lat-pulldown')
    const samples = await page.evaluate(async () => {
      const data = []
      const start = performance.now()
      let lastBin = -1
      while(performance.now()-start<65000) {
        const video = document.querySelector('video')
        if (video && !video.paused) {
          const t = video.currentTime, bin = Math.floor(t*5)
          if(bin!==lastBin) {
            lastBin=bin
            data.push({t,left:!!document.querySelector('.arm-trail[data-side="left"]'),right:!!document.querySelector('.arm-trail[data-side="right"]')})
          }
          if(t>33) return data
        }
        await new Promise(r=>setTimeout(r,50))
      }
      throw Error('Timed out sampling the video')
    })
    report.runs.push({variant,windows:windows.map(w=>{
      const rows=samples.filter(s=>s.t>=w.start+0.4 && s.t<w.end-0.4)
      if(rows.length<15) throw Error('Too few display samples')
      return {obstructedSide: w.side,samples:rows.length,leftDrawn:rows.filter(s=>s.left).length,rightDrawn:rows.filter(s=>s.right).length}
    })})
    await page.close()
  }
  await writeFile(values.output,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report.runs))
} finally { await browser.close(); await rm(temp,{recursive:true,force:true}) }
