// Compare the optional displayed-frame crop through the ordinary UI on a known two-person scene.
import { execFileSync } from 'node:child_process'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
const { values } = parseArgs({options:{output:{type:'string'},asset:{type:'string'},pair:{type:'boolean'}}})
const manifest = JSON.parse(await readFile('../docs/results/replay-sources.json'))
const clip = manifest.clips.find(c => c.file === (values.pair ? 'pulldown.webm' : 'go4it-coach.webm'))
const folder = await mkdtemp(join(tmpdir(),'fitpal-focus-'))
const input = resolve(values.asset ?? (values.pair ? join('public/demo',clip.file) : join('.benchmark-assets/video',clip.asset)))
const excerpt = join(folder,'coach.mp4')
const { chromium } = await import(process.env.FITPAL_PLAYWRIGHT ? pathToFileURL(resolve(process.env.FITPAL_PLAYWRIGHT)).href : 'playwright')
const base = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190').origin
const report = { clip:clip.file, variant:values.pair ? 'static copy at left, real source moving at right' : 'trainer and athlete in one original shot', reference:clip.windows, protocol:'Selected after observing the multi-person failure; same Full model and rules throughout. Real-time browser playback, left/right halves or central 60% of the displayed frame. Observer times use displayed media clock.',runs:[] }
let browser
try {
  const source = values.pair ? ['-i', input, '-filter_complex',
    '[0:v]scale=360:640,split=2[l][r];[l]trim=end_frame=1,tpad=stop_mode=clone:stop_duration=19[f];[f][r]hstack=shortest=1'] :
    ['-ss',String(clip.startSec),'-i',input]
  execFileSync('ffmpeg',['-v','error',...source,'-t',String(clip.durationSec),'-an','-c:v','libx264','-crf','15','-movflags','+faststart',excerpt])
  browser = await chromium.launch({executablePath:process.env.FITPAL_CHROME})
  for (const focus of (values.pair ? ['left','right'] : ['full','center','left'])) {
    const page = await browser.newPage()
    await page.route(base + '/demo/coach-probe.mp4',route=>route.fulfill({path:excerpt,contentType:'video/mp4'}))
    await page.goto(base + '/?video=coach-probe.mp4#/session/lat-pulldown')
    const selector = page.locator('.focus-select select')
    await selector.waitFor({timeout:20000})
    if (focus !== 'full') {
      await selector.selectOption(focus)
      await page.locator('.focus-outline').waitFor()
    }
    await page.evaluate(() => {
      window.cycles = {calibration:[],set:[]}
      let priorCount = 0, prevStage = ''
      window.watch = new MutationObserver(() => {
        const video = document.querySelector('video')
        const heading = document.querySelector('.live-panel-heading h2')?.textContent
        if (!video || !heading) return
        const stage = heading === '个人校准' ? 'calibration' : 'set'
        if (stage !== prevStage) {
          if (prevStage === 'calibration' && stage === 'set' && window.cycles.calibration.length === 2)
            window.cycles.calibration.push(+video.currentTime.toFixed(2))
          priorCount=0
          prevStage=stage
        }
        const count = Number(document.querySelector('.count-now')?.textContent)
        if (count > priorCount) window.cycles[stage].push(+video.currentTime.toFixed(2))
        priorCount = count
      })
      window.watch.observe(document.body,{subtree:true,childList:true,characterData:true})
    })
    await page.waitForFunction(() => !!document.querySelector('.set-review-stage') || document.body.innerText.includes('录像已结束。校准需要'),null,{timeout:70000})
    const observed = await page.evaluate(() => {
      window.watch.disconnect()
      return {cycles:window.cycles,status:document.querySelector('.say')?.textContent ?? document.querySelector('.live-instruction')?.textContent}
    })
    report.runs.push({focus,...observed})
    console.log(JSON.stringify(report.runs.at(-1)))
    await page.close()
  }
  if (values.output) await writeFile(values.output, JSON.stringify(report,null,2)+'\n')
} finally {
  await browser?.close()
  await rm(folder,{force:true,recursive:true})
}
