// Run from ui/ against a local Vite dev server. See docs/model-comparison.md.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { cpus, platform, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { loadMoveNet } from './movenet-adapter.mjs'

const { values } = parseArgs({ options: {
  models: { type: 'string', default: 'lite,full,heavy' },
  'movenet-score': { type: 'string', default: '0.6' },
  clip: { type: 'string' },
  'frame-cache': { type: 'string' },
  manifest: { type: 'string' },
  'video-dir': { type: 'string' },
  supplementary: { type: 'boolean' },
  output: { type: 'string' },
} })
const ui = fileURLToPath(new URL('../', import.meta.url))
if (values.manifest && values.supplementary) throw Error('Choose either --manifest or --supplementary')
const manifestPath = values.manifest ? resolve(values.manifest) : join(ui, '../docs/results', values.supplementary ? 'squat-supplement-sources.json' : 'replay-sources.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (!Array.isArray(manifest.clips) || manifest.clips.some(c => !c || typeof c.file !== 'string' ||
  !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(mp4|webm)$/.test(c.file) || !['squat','lat-pulldown'].includes(c.exercise))) throw Error('Invalid clip filename or exercise')
if (new Set(manifest.clips.map(c=>c.file)).size !== manifest.clips.length) throw Error('Duplicate clip name')
const selected = values.clip?.split(',')
const clips = manifest.clips.filter((c) => !selected || selected.includes(c.file))
if (selected?.some(name => !clips.some(clip => clip.file === name))) throw Error('Unknown clip')
const models = values.models.split(',')
const moveNetScore = Number(values['movenet-score'])
if (!(moveNetScore > 0 && moveNetScore < 1)) throw Error('Use a MoveNet point score between 0 and 1')
if (!clips.length || models.some((m) => !['lite', 'full', 'heavy', 'movenet'].includes(m))) throw Error('Unknown clip or model')
const url = new URL(process.env.FITPAL_URL || 'http://127.0.0.1:5190')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Use a local Vite origin')
const { chromium } = await import(process.env.FITPAL_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.FITPAL_PLAYWRIGHT)).href : 'playwright')
const hash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
const work = await mkdtemp(join(tmpdir(), 'fitpal-benchmark-'))
const fps = 15
const browser = await chromium.launch({ executablePath: process.env.FITPAL_CHROME, headless: true })
const report = { protocol: { fps, maxDimension: 640, format: 'PNG', delegate: 'CPU', browser: browser.version(),
  ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0],
  platform: platform(), cpu: cpus()[0]?.model, runtime: JSON.parse(await readFile(join(ui, 'node_modules/@mediapipe/tasks-vision/package.json'))).version,
  manifestSha256: await hash(manifestPath), modelSha256: {} }, runs: [] }
const coreFiles = ['src/perception/pulldown.ts', 'src/perception/pulldownUpperArm.ts', 'src/perception/squat.ts', 'src/tracking/limbLandmarks.ts',
  'src/tracking/armLandmarks.ts', 'src/perception/repReview.ts', 'src/contract.ts']
async function coreHashes() {
  return Object.fromEntries(await Promise.all(coreFiles.map(async file => [file, await hash(join(ui, file))])))
}
report.protocol.perceptionSha256 = await coreHashes()
try {
  const modelPath = (m) => join(ui, m === 'full' ? 'public/mediapipe' : '.benchmark-assets/models', `pose_landmarker_${m}.task`)
  const moveNetDir = join(ui, '.benchmark-assets/movenet')
  if (models.every(model => model === 'movenet')) report.protocol.runtime = 'TensorFlow.js 4.22.0'
  for (const model of models) {
    if (model === 'movenet') {
      report.protocol.moveNet = { runtime: 'TFJS 4.22.0 CPU WASM, one thread', adapter: 'pose-detection 2.1.3', model: 'MoveNet singlepose-lightning tfJs v4, 192x192', keypointScoreThreshold: moveNetScore }
      report.protocol.modelSha256.movenet = Object.fromEntries(await Promise.all(
        ['model.json', 'group1-shard1of2.bin', 'group1-shard2of2.bin'].map(async name => [name, await hash(join(moveNetDir, name))])))
    } else {
      report.protocol.modelSha256[model] = await hash(modelPath(model))
    }
  }
  for (const clip of clips) {
    const folderOfVideo = values['video-dir'] ? resolve(values['video-dir']) : join(ui, clip.appDemo ? 'public/demo' : '.benchmark-assets/video')
    const path = join(folderOfVideo, basename(clip.asset ?? clip.file))
    if (await hash(path) !== clip.sha256) throw Error(`Source hash mismatch for ${clip.file}`)
    const folder = join(work, clip.file)
    await mkdir(folder)
    const windowArgs = clip.startSec === undefined ? [] : ['-ss', String(clip.startSec)]
    const durationArgs = clip.startSec === undefined ? [] : ['-t', String(clip.durationSec)]
    execFileSync('ffmpeg', ['-v', 'error', ...windowArgs, '-i', path, ...durationArgs, '-an',
      '-vf', `fps=${fps},scale=640:640:force_original_aspect_ratio=decrease`, join(folder, '%06d.png')])
    const files = (await readdir(folder)).sort()
    if (!files.length) throw Error(`No frames for ${clip.file}`)
    for (const model of models) {
      const page = await browser.newPage()
      try {
        const urlPath = new URL('/__fixed_frame_replay__', url).href
        await page.route(urlPath, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline benchmark</title>' }))
        if (model !== 'movenet') await page.route(new URL('/benchmark.task', url).href, (route) => route.fulfill({ path: modelPath(model) }))
        await page.goto(urlPath)
        if (model === 'movenet') await loadMoveNet(page, moveNetDir, moveNetScore)
        await page.evaluate(async ({ exercise, model, cache }) => {
          const recordedFrames = []
          window.cachedFrames = () => recordedFrames
          const { visibleLimb } = await import('/src/tracking/limbLandmarks.ts')
          const create = exercise === 'squat' ? (await import('/src/perception/squat.ts')).createSquat
            : (await import('/src/perception/pulldown.ts')).createPulldown
          let detector = null
          if (model !== 'movenet') {
            const { FilesetResolver, PoseLandmarker } = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
            detector = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/mediapipe/wasm'), {
              baseOptions: { modelAssetPath: '/benchmark.task', delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1,
            })
          }
          let engine = create(), calibration = null, calCount = 0
          const calibrationEvents = [], verifiedEvents = [], ms = []
          const visible = { left: 0, right: 0, either: 0, engine: 0 }
          let i = 0
          window.consumeFrames = async (batch, fps) => {
            for (const encoded of batch) {
              const bitmap = await createImageBitmap(new Blob([Uint8Array.fromBase64(encoded)], { type: 'image/png' }))
              try {
                const width = bitmap.width, height = bitmap.height, timestampMs = i * 1000 / fps
                const t = performance.now()
                let landmarks
                if (detector) {
                  const pts = detector.detectForVideo(bitmap, timestampMs).landmarks[0]
                  landmarks = pts?.map(({ x, y, visibility }) => ({ x, y, visibility: visibility ?? 0 })) ?? null
                } else {
                  landmarks = await window.estimateMoveNet(bitmap, timestampMs)
                }
                ms.push(performance.now() - t)
                const frame = { width, height, landmarks, timestampMs }
                if (cache) recordedFrames.push(frame)
                const limb = exercise === 'squat' ? 'leg' : 'arm'
                const left = Boolean(visibleLimb(frame, 'left', limb)), right = Boolean(visibleLimb(frame, 'right', limb))
                visible.left += left; visible.right += right; visible.either += left || right
                const state = engine.accept(frame)
                visible.engine += state.visible
                if (calibration) {
                  if (state.repCount > verifiedEvents.length) verifiedEvents.push(+(timestampMs / 1000).toFixed(3))
                } else {
                  if (state.repCount > calCount) {
                    calCount = state.repCount
                    calibrationEvents.push(+(timestampMs / 1000).toFixed(3))
                  }
                  calibration = engine.getCalibration()
                  if (calibration) { engine = create(calibration); engine.accept(frame) }
                }
                i++
              } finally { bitmap.close() }
            }
          }
          window.report = () => {
            const sorted = ms.slice(1).sort((a,b) => a-b)
            const quantile = (p) => +(sorted[Math.ceil(sorted.length * p) - 1] ?? 0).toFixed(2)
            const result = { frames: i, coverage: Object.fromEntries(Object.entries(visible).map(([k,v]) => [k, +(v/i).toFixed(4)])),
              calibrationEvents, verifiedEvents, chosenSide: calibration?.side ?? null, warmInferenceMs: { p50: quantile(.5), p95: quantile(.95) },
              firstInferenceMs: +ms[0].toFixed(2), attempts: calibration ? engine.endSet().reps : [] }
            if (detector) detector.close()
            else window.closeMoveNet()
            return result
          }
        }, { exercise: clip.exercise, model, cache: Boolean(values['frame-cache']) })
        for (let i = 0; i < files.length; i += 12) {
          const batch = await Promise.all(files.slice(i, i + 12).map((file) => readFile(join(folder,file), 'base64')))
          await page.evaluate(([images,hz]) => window.consumeFrames(images,hz), [batch,fps])
        }
        const run = { clip: clip.file, sourceSha256: clip.sha256, startSec: clip.startSec ?? 0, durationSec: clip.durationSec, model, ...await page.evaluate(() => window.report()) }
        if (values['frame-cache']) {
          await mkdir(values['frame-cache'], { recursive: true })
          await writeFile(join(values['frame-cache'], model + '-' + clip.file + '.json'), JSON.stringify({
            clip: clip.file, startSec: run.startSec, fps, sourceSha256: run.sourceSha256, model,
            modelSha256: report.protocol.modelSha256[model], frames: await page.evaluate(() => window.cachedFrames()),
          }))
        }
        report.runs.push(run)
        console.error(`${clip.file} ${model}: ${run.frames} frames, ${run.calibrationEvents.length} cal + ${run.verifiedEvents.length} reps, p95 ${run.warmInferenceMs.p95}ms`)
        if (values.output) await writeFile(values.output, JSON.stringify(report,null,2) + '\n')
      } finally { await page.close() }
    }
    await rm(folder, { recursive:true })
  }
  if (JSON.stringify(await coreHashes()) !== JSON.stringify(report.protocol.perceptionSha256)) {
    throw Error('Perception changed during replay. Rerun against one revision.')
  }
  if (!values.output) console.log(JSON.stringify(report,null,2))
} finally {
  await browser.close()
  await rm(work,{ recursive:true, force:true })
}
