// Analytic trajectories test the measurement math, not pose-model or human accuracy.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { analyzeRep } = await server.ssrLoadModule('/src/analytics/motion.ts')
  const { recordAttempt } = await server.ssrLoadModule('/src/perception/repReview.ts')
  let seed = 4435
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296 }
  const scenarios = []
  for (const fps of [15, 30, 60]) for (const duration of [2400, 4000, 6000]) for (const delay of [-300, -150, 0, 150, 300]) {
    for (const noise of [0, 1, 3]) for (const missing of [false, true]) {
      const trace = recordAttempt(10000), observations = []
      const angle = ms => 160 - 100 * Math.max(0, 1 - Math.abs(ms - duration / 2) / (duration / 2))
      const frames = Math.round(duration * fps / 1000)
      for (let i = 0; i <= frames; i++) {
        const ms = duration * i / frames
        const left = angle(ms) + (random() - .5) * 2 * noise
        const right = angle(ms - delay) + (random() - .5) * 2 * noise
        trace.observe(10000 + ms, left, { x: 0, y: left / 180 }, ms <= duration / 2)
        observations.push({ atMs: 10000 + ms, left, right: missing && i === Math.floor(frames / 2) ? null : right,
          frontal: true, view: { x: .5, y: .4, scale: .3, orientation: .8 } })
      }
      const result = analyzeRep({ status: 'verified', qMax: 1, durationMs: duration }, trace.finish(0, true), observations)
      if (missing) assert.equal(result.bilateralLagMs, null, 'One missing side must withhold bilateral timing')
      if (!missing && noise === 0) {
        assert(result.bilateralLagMs !== null, 'Clean complete cycles should be measurable')
        assert(Math.abs(result.bilateralLagMs - delay) <= 1000 / fps + 1, 'Clean delay error exceeds one source frame')
      }
      scenarios.push({ fps, durationMs: duration, trueDelayMs: delay, noiseDeg: noise, missing,
        observedDelayMs: result.bilateralLagMs, errorMs: result.bilateralLagMs === null ? null : Math.abs(result.bilateralLagMs - delay) })
    }
  }
  const groups = [0, 1, 3].map(noise => {
    const rows = scenarios.filter(s => !s.missing && s.noiseDeg === noise)
    const measured = rows.filter(s => s.errorMs !== null), errors = measured.map(s => s.errorMs).sort((a, b) => a - b)
    return { noiseDeg: noise, cases: rows.length, measured: measured.length, meanAbsoluteErrorMs: errors.reduce((a,b)=>a+b,0)/errors.length,
      p95AbsoluteErrorMs: errors[Math.floor(errors.length * .95)], maxAbsoluteErrorMs: errors.at(-1) }
  })
  const report = { schemaVersion: 1, experiment: 'analytic-bilateral-timing', seed: 4435, cases: scenarios.length,
    note: 'Synthetic angle inputs; excludes pose estimation, occlusion detection accuracy, real users and clinical validity. Missing evidence is injected explicitly.',
    algorithmSha256: createHash('sha256').update(await readFile('src/analytics/motion.ts')).digest('hex'),
    groups, occludedCases: scenarios.filter(s=>s.missing).length, occludedWithheld: scenarios.filter(s=>s.missing && s.observedDelayMs===null).length, scenarios }
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), JSON.stringify(report, null, 2)+'\n')
  console.log(JSON.stringify({ ...report, scenarios: undefined }, null, 2))
} finally { await server.close() }
