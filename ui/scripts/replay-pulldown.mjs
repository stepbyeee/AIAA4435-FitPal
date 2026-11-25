import { access, writeFile } from 'node:fs/promises'
import { cpus, arch, platform, release } from 'node:os'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixtures = {
  pulldown: {
    durationSec: 18.320,
    sourceFrames: 457,
    firstThreeEndSec: 11.16,
    cycles: [
      { startSec: 0.04, bottomSec: 2.15, endSec: 4.10 },
      { startSec: 4.10, bottomSec: 5.88, endSec: 7.60 },
      { startSec: 7.60, bottomSec: 9.25, endSec: 11.00 },
      { startSec: 11.00, bottomSec: 12.72, endSec: 14.70 },
      { startSec: 14.70, bottomSec: 16.32, endSec: 18.27 },
    ],
    segments: [[0, 11.16, 'calibration'], [11.16, 18.32, 'held out']],
    note: 'Fixed side profile with a clear near arm and substantial far-arm occlusion. The last two cycles are temporal holdout from the same clip and performer.',
  },
  'pulldown-mistakes': {
    durationSec: 10.944,
    sourceFrames: 652,
    firstThreeEndSec: null,
    cycles: [{ startSec: 7.90, bottomSec: 9.40, endSec: 10.86 }],
    segments: [
      [0, 1.835, 'rear, bottom of pull'],
      [1.835, 3.987, 'side, bottom of pull'],
      [3.987, 6.390, 'rear, bottom of pull'],
      [6.390, 7.90, 'rear oblique, partial return'],
      [7.90, 10.944, 'rear oblique, full cycle'],
    ],
    note: 'Three hard cuts and joint overlays. The final cycle demonstrates the corrected movement and starts after a cut-in partial return. Only one full cycle is present.',
  },
}

const annotationMarginSec = 0.25
const minVisibility = 0.6
const minSegmentFraction = 0.015
const { values } = parseArgs({
  options: {
    check: { type: 'boolean' },
    help: { type: 'boolean' },
    trace: { type: 'string' },
    video: { type: 'string' },
  },
})

if (values.help) {
  console.log(`Usage: node scripts/replay-pulldown.mjs [--video pulldown|pulldown-mistakes] [--trace FILE] [--check]
Run a local Vite server with both original WebMs in public/demo and the model installed.
FITPAL_URL defaults to http://127.0.0.1:5190.
FITPAL_PLAYWRIGHT may be an absolute ES module path for playwright or playwright-core.
FITPAL_CHROME may override the Chromium executable.
Summary JSON goes to stdout. --trace adds per-frame diagnostics to FILE.
Use --check for a nonzero exit status if the recorded assertions fail.`)
  process.exit(0)
}

const names = values.video ? [values.video] : Object.keys(fixtures)
if (names.some((name) => !Object.hasOwn(fixtures, name))) {
  throw new Error('Use --video pulldown or --video pulldown-mistakes')
}

const origin = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190').origin
const playwright = process.env.FITPAL_PLAYWRIGHT
const { chromium } = await import(playwright ? pathToFileURL(resolve(playwright)).href : 'playwright')
const chromeOnMac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const executablePath = process.env.FITPAL_CHROME
  ?? (platform() === 'darwin' && await access(chromeOnMac).then(() => true, () => false) ? chromeOnMac : undefined)

async function capture(page, name) {
  // Use the app origin for Vite modules and assets, in a page with just the replay video.
  const replayUrl = `${origin}/__fitpal_replay__`
  await page.route(replayUrl, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>FitPal replay</title>' }))
  await page.goto(replayUrl)

  return page.evaluate(async ({ path, minVisibility, minSegmentFraction, includeTrace }) => {
    const { LM } = await import('/src/contract.ts')
    const { trackPose } = await import('/src/tracking/poseTracker.ts')
    const { createPulldown } = await import('/src/perception/pulldown.ts')

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    document.body.append(video)

    let engine = createPulldown()
    let calibratedAtSec = null
    let calibration = null
    let calibrationCycles = 0
    let verifiedReps = 0
    const calibrationCycleTimesSec = []
    const verifiedRepTimesSec = []
    const frames = []
    const trackingStarted = performance.now()
    let setupMs = null
    let playingStarted = null

    function sideVisibility(frame, shoulder, elbow, wrist) {
      const joints = [shoulder, elbow, wrist].map((joint) => frame.landmarks?.[joint])
      const inFrame = joints.every((joint) => joint && Number.isFinite(joint.x) && Number.isFinite(joint.y)
        && joint.x >= 0 && joint.x <= 1 && joint.y >= 0 && joint.y <= 1 && Number.isFinite(joint.visibility))
      const visibility = inFrame ? Math.min(...joints.map((joint) => joint.visibility)) : null
      if (!inFrame) return { minVisibility: visibility, usable: false, angleDeg: null }
      const [s, e, w] = joints
      const upperX = (s.x - e.x) * frame.width
      const upperY = (s.y - e.y) * frame.height
      const lowerX = (w.x - e.x) * frame.width
      const lowerY = (w.y - e.y) * frame.height
      const minLength = minSegmentFraction * Math.min(frame.width, frame.height)
      const longEnough = Math.min(Math.hypot(upperX, upperY), Math.hypot(lowerX, lowerY)) >= minLength
      const cross = upperX * lowerY - upperY * lowerX
      const dot = upperX * lowerX + upperY * lowerY
      const angleDeg = longEnough ? Math.atan2(Math.abs(cross), dot) * 180 / Math.PI : null
      return { minVisibility: visibility, usable: longEnough && visibility >= minVisibility, angleDeg }
    }

    await new Promise((done, reject) => {
      const timeoutId = setTimeout(() => fail(new Error(`Replay timed out for ${path}`)), 90_000)
      let stopTracking = () => {}
      function finish() {
        clearTimeout(timeoutId)
        stopTracking()
        video.pause()
      }
      function fail(error) {
        finish()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      video.addEventListener('error', () => fail(new Error(`Cannot decode ${path} (media error ${video.error?.code})`)), { once: true })
      video.addEventListener('ended', () => {
        finish()
        done()
      }, { once: true })

      stopTracking = trackPose(video, (frame) => {
        try {
          const timeSec = frame.timestampMs / 1000
          const wasCalibrated = calibration !== null
          const state = engine.accept(frame)
          if (wasCalibrated) {
            while (verifiedReps < state.repCount) {
              verifiedReps += 1
              verifiedRepTimesSec.push(timeSec)
            }
          } else {
            calibration = engine.getCalibration()
            while (calibrationCycles < state.repCount) {
              calibrationCycles += 1
              calibrationCycleTimesSec.push(timeSec)
            }
            if (calibration) {
              calibratedAtSec = timeSec
              engine = createPulldown(calibration)
              engine.accept(frame)
            }
          }

          const left = sideVisibility(frame, LM.leftShoulder, LM.leftElbow, LM.leftWrist)
          const right = sideVisibility(frame, LM.rightShoulder, LM.rightElbow, LM.rightWrist)
          frames.push({
            timeSec, inferenceMs: frame.inferenceMs, poseFound: frame.landmarks !== null,
            engineVisible: state.visible, left, right,
            phase: state.phase, q: state.q, calibrationCycles, verifiedReps,
            ...(includeTrace && {
              armLandmarks: frame.landmarks?.slice(LM.leftShoulder, LM.rightWrist + 1) ?? null,
            }),
          })
        } catch (error) {
          fail(error)
        }
      }, fail, () => {
        playingStarted = performance.now()
        setupMs = playingStarted - trackingStarted
        video.play().catch(fail)
      })
      video.src = path
    })

    if (!frames.length) throw new Error(`Replay ended without inference frames for ${path}`)
    const { totalVideoFrames, droppedVideoFrames } = video.getVideoPlaybackQuality()
    return {
      video: {
        durationSec: video.duration, width: video.videoWidth, height: video.videoHeight,
        totalVideoFrames, droppedVideoFrames,
        playbackWallMs: performance.now() - playingStarted,
      },
      setupMs, calibration, calibratedAtSec, calibrationCycleTimesSec, verifiedRepTimesSec,
      setSummary: calibration ? engine.endSet() : null,
      frames,
    }
  }, { path: `/demo/${name}.webm`, minVisibility, minSegmentFraction, includeTrace: Boolean(values.trace) })
}

function distribution(samples) {
  const sorted = samples.filter(Number.isFinite).toSorted((a, b) => a - b)
  if (!sorted.length) return { samples: 0, p50: null, p95: null, max: null }
  const percentile = (q) => Number(sorted[Math.ceil(sorted.length * q) - 1].toFixed(2))
  return { samples: sorted.length, p50: percentile(0.50), p95: percentile(0.95), max: percentile(1) }
}

function frameMetrics(frames) {
  const coverage = (isUsable) => frames.length
    ? Number((frames.filter(isUsable).length / frames.length).toFixed(4))
    : null
  return {
    processedFrames: frames.length,
    firstFrameSec: frames[0]?.timeSec ?? null,
    lastFrameSec: frames.at(-1)?.timeSec ?? null,
    maxFrameGapMs: frames.length < 2 ? null : Number(Math.max(...frames.slice(1).map((frame, index) => (
      1000 * (frame.timeSec - frames[index].timeSec)
    ))).toFixed(2)),
    poseFound: coverage((frame) => frame.poseFound),
    engineVisible: coverage((frame) => frame.engineVisible),
    leftUsable: coverage((frame) => frame.left.usable),
    rightUsable: coverage((frame) => frame.right.usable),
    eitherUsable: coverage((frame) => frame.left.usable || frame.right.usable),
    inferenceMs: distribution(frames.map((frame) => frame.inferenceMs)),
  }
}

function matchCycles(cycles, observedSec) {
  const unmatchedSec = [...observedSec]
  const matched = []
  const missedSec = []
  for (const cycle of cycles) {
    // The engine may count as soon as it reaches its upper band, before visible full extension.
    const earliest = cycle.bottomSec
    const latest = cycle.endSec + annotationMarginSec
    const matchingIndex = unmatchedSec.findIndex((observed) => observed >= earliest && observed <= latest)
    if (matchingIndex < 0) missedSec.push(cycle.endSec)
    else {
      const [observed] = unmatchedSec.splice(matchingIndex, 1)
      matched.push({
        expectedSec: cycle.endSec,
        observedSec: observed,
        offsetFromAnnotatedTopSec: Number((observed - cycle.endSec).toFixed(3)),
      })
    }
  }
  return { matched, missedSec, unmatchedSec }
}

function scoreHoldout(annotations, captureResult) {
  const boundary = annotations.firstThreeEndSec
  if (boundary === null) {
    return {
      scoreable: false,
      reason: 'Only one visually complete cycle is present, so the clip cannot supply three calibration cycles and a holdout.',
      calibrationMatch: matchCycles(annotations.cycles, captureResult.calibrationCycleTimesSec),
    }
  }
  const cycles = annotations.cycles.filter((cycle) => cycle.endSec >= boundary)
  const expectedSec = cycles.map((cycle) => cycle.endSec)
  const observedSec = captureResult.verifiedRepTimesSec.filter((sec) => sec >= boundary)
  const calibrationMatch = matchCycles(
    annotations.cycles.filter((cycle) => cycle.endSec < boundary),
    captureResult.calibrationCycleTimesSec.filter((sec) => sec < boundary),
  )
  if (captureResult.calibratedAtSec === null || captureResult.calibratedAtSec >= boundary) {
    return {
      scoreable: false,
      reason: 'Calibration did not finish by the independently annotated first-three boundary.',
      expectedSec, observedSec, calibrationMatch,
    }
  }
  if (calibrationMatch.missedSec.length || calibrationMatch.unmatchedSec.length) {
    return {
      scoreable: false,
      reason: 'The accepted calibration events did not match the three annotated cycles.',
      expectedSec, observedSec, calibrationMatch,
    }
  }
  const matching = matchCycles(cycles, observedSec)
  return {
    scoreable: true, expectedSec, observedSec, calibrationMatch,
    ...matching, countError: observedSec.length - expectedSec.length,
  }
}

const browser = await chromium.launch({ headless: true, executablePath })
try {
  const clips = []
  const traces = []
  for (const name of names) {
    const page = await browser.newPage()
    try {
      const result = await capture(page, name)
      const annotations = fixtures[name]
      if (Math.abs(result.video.durationSec - annotations.durationSec) > 0.04) {
        throw new Error(`${name}.webm duration does not match the annotated source`)
      }
      const { frames, ...outcomes } = result
      const segments = annotations.segments.map(([startSec, endSec, label]) => ({
        label, startSec, endSec, ...frameMetrics(frames.filter((frame) => frame.timeSec >= startSec && frame.timeSec < endSec)),
      }))
      const holdout = scoreHoldout(annotations, result)
      const assertions = annotations.firstThreeEndSec === null
        ? { insufficientCyclesLeaveCalibrationIncomplete: result.calibration === null && result.verifiedRepTimesSec.length === 0 }
        : {
            firstThreeCyclesCalibrate: holdout.scoreable,
            bothHoldoutCyclesCounted: holdout.scoreable
              ? holdout.matched.length === 2 && holdout.unmatchedSec.length === 0 && holdout.missedSec.length === 0
              : null,
          }
      clips.push({
        name, annotations, ...outcomes, ...frameMetrics(frames),
        firstInferenceMs: frames[0].inferenceMs,
        processedFractionOfSource: Number((frames.length / annotations.sourceFrames).toFixed(4)),
        segments, holdout, assertions,
      })
      if (values.trace) traces.push({ name, frames })
    } finally {
      await page.close()
    }
  }
  const report = {
    environment: { browser: browser.version(), platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, origin },
    measurement: {
      annotations: 'Human inspection of source frames. Endpoint timestamps are approximate.',
      playback: 'Original WebMs, one pass at 1× with a fresh page, tracker and calibration per clip.',
      setupMs: 'Wall time from starting the tracker until it signals playback ready, including file loading and paused-frame warm-up.',
      inferenceMs: 'Synchronous detectForVideo and landmark mapping wall time reported on delivered playback frames; excludes tracker setup, warm-up, video decode, rendering and rep-state processing.',
      coverage: 'Fractions of delivered inference frames. Side diagnostics check shoulder/elbow/wrist in frame with confidence ≥0.60 and both segment lengths ≥1.5% of the shorter image dimension, before any temporal smoothing.',
      matching: 'One-to-one matching from each manually annotated bottom through 0.25 seconds after its near-full-extension frame. Offset is separately reported; negative values mean early completion relative to visual extension.',
      scope: 'Both clips were used during tuning. The temporal holdout excludes those cycles from the calibration sequence, but these clips cannot provide independent validation of accuracy.',
    },
    clips,
  }
  if (values.trace) await writeFile(values.trace, JSON.stringify({ ...report, traces }, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (values.check && clips.some((clip) => Object.values(clip.assertions).includes(false))) process.exitCode = 1
} finally {
  await browser.close()
}
