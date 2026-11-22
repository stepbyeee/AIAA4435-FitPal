// Generate controlled video edits and replay through the real local-file picker.
// Run from ui/. Start the app and configure FITPAL_URL, FITPAL_PLAYWRIGHT and FITPAL_CHROME as for check-session.mjs.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  generate: { type: 'boolean' }, repeat: { type: 'string', default: '1' }, output: { type:'string' },
  cases: { type:'string' }, check: { type:'boolean' },
  'public-demo': { type:'boolean' },
} })
const count = Number(values.repeat)
if (!Number.isInteger(count) || count < 1) throw new Error('repeat must be a positive integer')
const sourceDir = resolve('public/demo')
const dir = values['public-demo'] ? sourceDir : resolve('.benchmark-assets/stress')
await mkdir(dir,{recursive:true})
const input = join(sourceDir, 'pulldown.webm')
const standard = ['met','met']
const fixtures = [
  {
    name:'short', expected:['short','met'],
    description:'Keep 0–12.32s inclusive. Hold the partial pull for 240ms. Reverse frames 307..275 back to the top, then append original frames 368..end for the last full rep.',
    graph:'[0:v]split=3[a][b][c];[a]trim=end_frame=309,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.24[a1];[b]trim=start_frame=275:end_frame=308,reverse,setpts=PTS-STARTPTS[b1];[c]trim=start_frame=368,setpts=PTS-STARTPTS[c1];[a1][b1][c1]concat=n=3:v=1:a=0[out]',
  },
  {name:'mirror',expected:standard,description:'Horizontal reflection of all frames.',filter:'hflip'},
  {name:'hold',expected:[],description:'After three calibration cycles, hold the same upper position (source frame 284, 11.36s) exactly for another 8s.',
    filter:'trim=end_frame=285,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=8'},
  {name:'small',expected:standard,description:'Downsample full clip to 224×398 with area averaging.',filter:'scale=224:398:flags=area,setsar=1'},
  {name:'fast',expected:standard,description:'Play the full movement 1.5× faster, resampling at 25 frames per second.',filter:'setpts=PTS/1.5,fps=25'},
]
const selected = values.cases?.split(',') ?? fixtures.map(f=>f.name)
if (selected.some(name => !fixtures.some(f => f.name === name))) throw new Error('Unknown case')
const cases = fixtures.filter(test=>selected.includes(test.name))
const file = name => join(dir, 'stress-pulldown-' + name + '.mp4')
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex')
for (const test of cases) {
  // Each generated name belongs to this harness; original footage is always opened read-only.
  const edit = test.graph ? ['-filter_complex', test.graph, '-map', '[out]'] : ['-vf', test.filter]
  // Fixed-quantizer intra frames ensure the hold decodes to identical pixels even after compression.
  const quality = test.name === 'hold' ? ['-g','1','-qp','18','-x264-params','aq-mode=0:mbtree=0:psy=0:scenecut=0'] : ['-crf','16']
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',input,...edit,'-an','-r','25',
    '-c:v','libx264',...quality,'-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart', file(test.name)])
  if (test.name === 'hold') {
    const decoded = execFileSync('ffmpeg',['-v','error','-i',file('hold'),'-vf','trim=start_frame=284','-f','framemd5','-'],{encoding:'utf8'})
    const rows = decoded.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim())
    if (rows.length !== 201 || new Set(rows).size !== 1) throw new Error('Static hold must contain 201 pixel-identical decoded frames')
  }
}
if (values.generate) process.exit(0)
const module = process.env.FITPAL_PLAYWRIGHT
const { chromium } = await import(module ? pathToFileURL(resolve(module)).href : 'playwright')
const origin = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190').origin
const browser = await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:['--autoplay-policy=no-user-gesture-required']})
const report = {
  protocol:'Controlled transformations of the same previously used demonstration; the five variants are not independent recordings. Expected depth labels are relative to the original personal calibration. Source for choosing the partial turn was the existing tuning-clip trace. Chrome runs each variant through the local-file input at native media speed with the app default Full model.',
  model:'MediaPipe Pose Landmarker Full', modelSha256:await sha(resolve('public/mediapipe/pose_landmarker_full.task')),
  source:'pulldown.webm', inputSha256:await sha(input), ffmpeg:execFileSync('ffmpeg',['-version'],{encoding:'utf8'}).split('\n')[0],
  browser:browser.version(), cases:[],
}

async function playback(test) {
  const context = await browser.newContext({ viewport:{width:1280,height:820},reducedMotion:'reduce' })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', e=>pageErrors.push(e.message))
  try {
    await page.goto(origin)
    await page.getByText('录像回放',{exact:true}).click()
    await page.locator('input[type=file]').setInputFiles(file(test.name))
    await page.waitForFunction(() => Boolean(document.querySelector('.set-review-stage')) ||
      /录像已结束。校准需要/.test(document.querySelector('.live-instruction')?.textContent ?? ''), null, {timeout:90000})
    const calibrated = await page.locator('.set-review-stage').count() > 0
    const statuses = await page.locator('.review-choices button').evaluateAll(buttons=>buttons.map(b=>b.dataset.status))
    const details = []
    for (const button of await page.locator('.review-choices button').all()) {
      await button.click()
      details.push(await page.locator('.review-detail p').first().innerText())
    }
    const cue = calibrated ? await page.locator('.panel .say').innerText() : await page.locator('.live-instruction').innerText()
    const coverageText = calibrated ? await page.locator('details.evidence').textContent() : null
    const coveragePct = Number(coverageText?.match(/画面可用率\s*(\d+)%/)?.[1] ?? NaN)
    const trackedSide = await page.locator('.rep-review').getAttribute('data-side', {timeout:250}).catch(()=>null)
    const emptyHistory = await page.evaluate(()=>localStorage.getItem('fitpal.history.v3') === null)
    const verified = statuses.filter(status=>status === 'met' || status === 'short').length
    return {
      calibrated, verified, statuses, details, cue, coveragePct:Number.isFinite(coveragePct) ? coveragePct : null,
      trackedSide, emptyHistory, pageErrors,
      match:calibrated && JSON.stringify(statuses) === JSON.stringify(test.expected) && emptyHistory && !pageErrors.length,
    }
  } catch (error) {
    return {match:false, error:String(error), pageErrors, screen:(await page.locator('body').innerText()).slice(-450)}
  } finally { await context.close() }
}
try {
  for(const test of cases) {
    const row = {name:test.name,description:test.description,expectedCalibrated:true,expectedStatuses:test.expected,
      asset:'stress-pulldown-'+test.name+'.mp4',assetSha256:await sha(file(test.name)),runs:[]}
    for(let i=0;i<count;i++) {
      const result = await playback(test)
      row.runs.push(result)
      console.log(JSON.stringify({case:test.name,run:i+1,...result}))
    }
    report.cases.push(row)
  }
} finally {
  await browser.close()
  if (values.output) {
    const target = resolve(values.output)
    await mkdir(resolve(target,'..'),{recursive:true})
    await writeFile(target,JSON.stringify(report,null,2)+'\n')
  }
}
if(values.check && report.cases.some(row=>row.runs.some(run=>!run.match))) process.exitCode=1
