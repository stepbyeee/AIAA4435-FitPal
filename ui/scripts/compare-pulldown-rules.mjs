// Compare only the counting rules, independently of detector and occlusion-filter changes.
import { build } from 'vite'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  baseline: { type: 'string' },
  candidate: { type: 'string' },
  frames: { type: 'string' },
  manifest: { type: 'string', multiple: true },
  output: { type: 'string' },
} })
if (!values.baseline || !values.frames || !values.manifest?.length || !values.output) {
  throw Error('Use --baseline OLD_UI_DIR --frames CACHE_DIR --manifest MANIFEST [--manifest ANOTHER] --output PATH')
}

const ui = fileURLToPath(new URL('../', import.meta.url))
const sha = buffer => createHash('sha256').update(buffer).digest('hex')

async function rules(dir) {
  const root = resolve(dir)
  const entry = join(root, 'src/perception/pulldown.ts')
  const built = await build({
    root, configFile: false, publicDir: false, logLevel: 'error',
    build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'analysis' } },
  })
  const [{ code, modules }] = (Array.isArray(built) ? built[0] : built).output
  const files = Object.keys(modules).filter(file => file.startsWith(root + '/'))
  const hashes = Object.fromEntries(await Promise.all(files.map(async file => [
    file.slice(root.length + 1), sha(await readFile(file)),
  ])))
  const { createPulldown } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  return { create: createPulldown, hashes }
}

function evaluate(frames, create) {
  let engine = create()
  let calibration = null
  let calCount = 0
  const calibrationEvents = []
  const verifiedEvents = []
  for (const frame of frames) {
    const { repCount } = engine.accept(frame)
    const seconds = Math.round(frame.timestampMs) / 1000
    if (calibration) {
      if (repCount > verifiedEvents.length) verifiedEvents.push(seconds)
      continue
    }
    if (repCount > calCount) {
      calCount = repCount
      calibrationEvents.push(seconds)
    }
    calibration = engine.getCalibration()
    if (calibration) {
      engine = create(calibration)
      engine.accept(frame)
    }
  }
  return { calibration, calibrationEvents, verifiedEvents, attempts: calibration ? engine.endSet().reps : [] }
}

const old = await rules(values.baseline)
const candidate = await rules(values.candidate ?? ui)
const modelSha256 = sha(await readFile(join(ui, 'public/mediapipe/pose_landmarker_full.task')))
const report = {
  protocol: 'Raw Pose Landmarker Full frames at 15 Hz. Compare rule changes on identical input. Scored by score-replay.py.',
  modelSha256, baselineSources: old.hashes, candidateSources: candidate.hashes, clips: [],
}
const temp = await mkdtemp(join(tmpdir(), 'fitpal-score-'))
try {
  for (const manifestPath of values.manifest) {
    const manifest = JSON.parse(await readFile(manifestPath))
    const clips = manifest.clips.filter(clip => clip.exercise === 'lat-pulldown')
    const rows = []
    const runs = []
    for (const clip of clips) {
      if (basename(clip.file) !== clip.file || report.clips.some(c => c.file === clip.file)) {
        throw Error('Invalid or duplicate clip: ' + clip.file)
      }
      const raw = await readFile(join(values.frames, 'full-' + clip.file + '.json'))
      const data = JSON.parse(raw)
      if (data.clip !== clip.file || data.model !== 'full' || data.modelSha256 !== modelSha256
        || data.fps !== 15 || data.sourceSha256 !== clip.sha256 || data.startSec !== (clip.startSec ?? 0)) {
        throw Error('Cache and reference disagree for ' + clip.file)
      }
      const row = {
        file: clip.file, frames: data.frames.length, sourceSha256: clip.sha256,
        inputSha256: sha(raw), reference: clip.windows,
        baseline: evaluate(data.frames, old.create), candidate: evaluate(data.frames, candidate.create),
      }
      for (const label of ['baseline', 'candidate']) {
        runs.push({ clip: clip.file, model: label, sourceSha256: clip.sha256, ...row[label] })
      }
      rows.push(row)
      report.clips.push(row)
    }
    const results = join(temp, 'events.json')
    await writeFile(results, JSON.stringify({ runs }))
    const { scores, matching } = JSON.parse(execFileSync('python3', [
      join(ui, 'scripts/score-replay.py'), '--manifest', manifestPath, results,
    ], { encoding: 'utf8' }))
    report.matching = matching
    for (const { clip, model, ...score } of scores) {
      rows.find(row => row.file === clip)[model].scoring = score
    }
  }
  await writeFile(values.output, JSON.stringify(report, null, 2) + '\n')
} finally {
  await rm(temp, { recursive: true, force: true })
}
for (const row of report.clips) {
  const counts = run => run.calibrationEvents.length + '+' + run.verifiedEvents.length
  console.log(row.file, counts(row.baseline), '→', counts(row.candidate))
}
