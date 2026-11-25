// Fixed-frame acceptance for the isolated row lab. Uses the annotated side view of each source.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
const { values } = parseArgs({options:{holdout:{type:'boolean'},unseen:{type:'boolean'}}})
if (values.holdout && values.unseen) throw Error('Choose one fixture group')

const ui = fileURLToPath(new URL('../', import.meta.url))
const results = join(ui,'../docs/results')
const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex')
const manifest = join(results, values.unseen ? 'seated-row-unseen-sources.json' : values.holdout ? 'seated-row-holdout-sources.json' : 'seated-row-sources.json')
const clips = JSON.parse(await readFile(manifest,'utf8')).clips
const fps = 15
const url = new URL(process.env.FITPAL_URL || 'http://127.0.0.1:5190')
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw Error('Local Vite origin required')
const { chromium } = await import(process.env.FITPAL_PLAYWRIGHT ? pathToFileURL(resolve(process.env.FITPAL_PLAYWRIGHT)).href : 'playwright')
const browser = await chromium.launch({ executablePath: process.env.FITPAL_CHROME, headless: true })
const dir = await mkdtemp(join(tmpdir(),'fitpal-row-'))
const algorithm = join(ui,'src/perception/seatedRow.ts')
const report = { model:'MediaPipe Pose Landmarker Full', delegate:'CPU', browser: browser.version(), fps, maxDimension:640,
  sourceManifestSha256: await sha(manifest), analyzerSha256: await sha(algorithm), modelSha256: await sha(join(ui,'public/mediapipe/pose_landmarker_full.task')), runs:[] }
try {
  for (const clip of clips) {
    const video = join(ui,clip.appDemo ? 'public/demo' : '.benchmark-assets/video',clip.file)
    if (await sha(video) !== clip.sha256) throw Error('Unexpected source '+clip.file)
    const folder=join(dir,clip.id)
    await mkdir(folder)
    const filters=[clip.crop,'fps='+fps,'scale=640:640:force_original_aspect_ratio=decrease'].filter(Boolean)
    execFileSync('ffmpeg',['-v','error','-ss',String(clip.start),'-i',video,'-t',String(clip.duration),'-an','-vf',filters.join(','),join(folder,'%06d.png')])
    const files=(await readdir(folder)).sort()
    const page=await browser.newPage()
    try {
      await page.route(new URL('/__row_replay__',url).href, route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Row replay</title>'}))
      await page.goto(new URL('/__row_replay__',url).href)
      await page.evaluate(async () => {
        const { FilesetResolver, PoseLandmarker }=await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
        const { createSeatedRow }=await import('/src/perception/seatedRow.ts')
        const detector=await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/mediapipe/wasm'),{
          baseOptions:{modelAssetPath:'/mediapipe/pose_landmarker_full.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,
        })
        const engine=createSeatedRow(), events=[]
        let index=0,last=null
        window.consume=async (images,hz) => {
          for(const image of images) {
            const bitmap=await createImageBitmap(new Blob([Uint8Array.fromBase64(image)],{type:'image/png'}))
            try {
              const timestampMs=1000*index++/hz
              const landmarks=detector.detectForVideo(bitmap,timestampMs).landmarks[0] ?? null
              last=engine.accept({timestampMs,landmarks,width:bitmap.width,height:bitmap.height})
              if(last.count>events.length) events.push(+(timestampMs/1000).toFixed(3))
            } finally {bitmap.close()}
          }
        }
        window.finish=()=>{detector.close(); return {frames:index,coverage:last?.coverage || 0,events}}
      })
      for(let i=0;i<files.length;i+=12) {
        const images=await Promise.all(files.slice(i,i+12).map(file=>readFile(join(folder,file),'base64')))
        await page.evaluate(([batch,hz])=>window.consume(batch,hz),[images,fps])
      }
      const output=await page.evaluate(()=>window.finish())
      const unmatched=new Set(output.events)
      const matches=clip.returnWindows.map(([lo,hi])=>{
        const t=[...unmatched].find(e=>e>=lo && e<=hi)
        if(t !== undefined) unmatched.delete(t)
        return t ?? null
      })
      const run={clip:clip.id,sourceSha256:clip.sha256,...output,matches,missed:matches.filter(x=>x===null).length,extraTimes:[...unmatched]}
      report.runs.push(run)
      console.log(JSON.stringify(run))
    } finally {await page.close()}
  }
  if(report.analyzerSha256 !== await sha(algorithm)) throw Error('Analyzer changed during replay')
  await writeFile(join(results,values.unseen ? 'seated-row-unseen.json' : values.holdout ? 'seated-row-holdout.json' : 'seated-row-comparison.json'),JSON.stringify(report,null,2)+'\n')
} finally {
  await browser.close()
  await rm(dir,{recursive:true,force:true})
}
