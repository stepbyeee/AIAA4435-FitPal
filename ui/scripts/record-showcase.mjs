// Record the actual event timing, controls and model overlays visible in a FitPal browser session.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const { values } = parseArgs({options:{ exercise:{type:'string'}, output:{type:'string'} }})
const row = values.exercise === 'seated-row'
const examples = {
  'seated-row': {count:8,credit:'Footage by 헬스티비 · GO4IT #47 · CC BY 3.0 · commons.wikimedia.org/?curid=61802622 · FitPal excerpt and overlays'},
  'lat-pulldown': {clip:'go4it-rear', count:4, credit:'Footage by 헬스티비 · GO4IT #47 · CC BY 3.0 · commons.wikimedia.org/?curid=61802622 · FitPal excerpt and overlays'},
  squat: {clip:'goblet-squat', count:2, credit:'Footage by YMove · Dumbbell Goblet Squat · ymove.app/free-exercise-videos · FitPal overlays'},
}
const example = examples[values.exercise]
if (!example || !values.output) throw Error('Use --exercise squat|lat-pulldown|seated-row --output FILE.mp4')
const origin = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190')
if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) throw Error('Use the local FitPal preview')
const dest = resolve(values.output)
const temp = await mkdtemp(join(tmpdir(),'fitpal-showcase-'))
const browser = await chromium.launch({executablePath:process.env.FITPAL_CHROME})
try {
  const page = await browser.newPage({viewport:{ width:1200,height:880 }, reducedMotion:'reduce'})
  await page.goto(origin.origin)
  if (row) {
    await page.getByRole('link',{name:'侧面计数 · 实验'}).click()
    await page.getByRole('button',{name:'播放真实划船示范'}).click()
  } else {
    await page.getByText('录像回放',{exact:true}).click()
    await page.locator('a[href*="' + example.clip + '"]').click()
    await page.getByRole('button',{name:'画中分析',exact:true}).click()
  }
  await page.waitForFunction(() => {const v=document.querySelector('video');return v && !v.paused && v.currentTime>0})
  await page.evaluate(credit => {
    document.querySelector('.app').style.height='calc(100dvh - 36px)'
    const el = document.createElement('footer')
    el.style.cssText='position:fixed;bottom:0;left:0;right:0;height:36px;background:#131717;color:white;display:grid;align-items:center;padding:0 16px;font:14px system-ui;z-index:100'
    el.textContent=credit
    document.body.appendChild(el)
  },example.credit)
  const frames = []
  const start = performance.now()
  let reviewed = false, selected = false, reviewStart = 0, observed = 0
  while (performance.now()-start < 80000) {
    const t = performance.now()
    const choices = page.locator('.review-choices button')
    if (!reviewed && (row ? await page.locator('.row-lab-result').count() : await choices.count())) { reviewed=true; reviewStart=t }
    if (reviewed && !selected && t-reviewStart>1200) {
      observed = row ? Number((await page.locator('.row-lab-result h2').textContent()).match(/\d+/)?.[0]) : await choices.count()
      if (observed !== example.count) console.warn('Scored attempts differ from visual reference:', observed, 'of', example.count)
      if (!row) await choices.last().click()
      selected=true
    }
    const file = String(frames.length).padStart(5,'0')+'.jpg'
    await page.screenshot({path:join(temp,file),type:'jpeg',quality:86})
    frames.push({file,t})
    if (selected && t-reviewStart>3600) break
    await delay(Math.max(1,120-(performance.now()-t)))
  }
  if (!selected) throw Error('Rep review did not complete')
  const list = frames.map((f,i) => "file '"+f.file+"'\nduration "+((frames[i+1]?.t??f.t+120)-f.t)/1000).join('\n')
  await writeFile(join(temp,'capture.ffconcat'),list+"\nfile '"+frames.at(-1).file+"'\n")
  execFileSync('ffmpeg',['-loglevel','error','-y','-f','concat','-safe','0','-i',join(temp,'capture.ffconcat'),
    '-vf','fps=24,format=yuv420p','-c:v','libx264','-crf','19','-preset','fast','-movflags','+faststart',
    '-metadata','comment='+example.credit,dest])
  console.log(JSON.stringify({file:dest,frames:frames.length,reviewed:observed,reference:example.count}))
} finally {
  await browser.close()
  await rm(temp,{recursive:true,force:true})
}
