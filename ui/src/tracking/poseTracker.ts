import { analyzeRecording, type RecordingAnalysis } from './recordedFrames'
import { createArmOcclusionFilter } from './armOcclusion'
import { cropBounds, mapLandmarks, type Focus } from './focus'
import type { Landmark, PoseFrame } from '../contract'

// One stream feeds both the bone overlay and the perception module.
// Frames are read on the device and never leave the page.

const WASM = '/mediapipe/wasm'
const MODEL = '/mediapipe/pose_landmarker_full.task'

async function prepareRuntime() {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  return { fileset: await FilesetResolver.forVisionTasks(WASM), PoseLandmarker }
}
let runtime: ReturnType<typeof prepareRuntime> | null = null

async function createTracker(cancelled: () => boolean) {
  runtime ??= prepareRuntime().catch(error => { runtime = null; throw error })
  const { fileset, PoseLandmarker } = await runtime
  if (cancelled()) return null
  const make = (delegate: 'GPU' | 'CPU') => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1,
  })
  try { return await make('GPU') }
  catch (error) {
    if (cancelled()) return null
    return make('CPU')
  }
}

export type TrackedFrame = PoseFrame & { inferenceMs: number }

/** Sample each newly presented frame and preserve its timestamp in the source video. */
export function trackPose(
  video: HTMLVideoElement,
  onFrame: (frame: TrackedFrame) => void,
  onError: (error: unknown) => void,
  onReady?: () => void,
  focus: Focus = 'full',
  pulldown = false,
  recording?: RecordingAnalysis,
): () => void {
  const armFilter = pulldown ? createArmOcclusionFilter() : null
  let stopped = false
  const cropCanvas = focus === 'full' && !recording ? null : document.createElement('canvas')
  const ctx = cropCanvas?.getContext('2d', { alpha: false })
  const input = () => {
    if (!cropCanvas) return video
    if (!ctx) throw Error('Camera crop canvas unavailable')
    const crop = cropBounds(focus, video.videoWidth, Boolean(video.srcObject))
    if (cropCanvas.width !== crop.width) cropCanvas.width = crop.width
    if (cropCanvas.height !== video.videoHeight) cropCanvas.height = video.videoHeight
    ctx.drawImage(video, crop.x, 0, crop.width, video.videoHeight, 0, 0, crop.width, video.videoHeight)
    return cropCanvas
  }
  const abort = new AbortController()
  let callback = 0
  let lastTime = -1
  let warmUp: (() => void) | null = null
  const useVideoCallback = typeof video.requestVideoFrameCallback === 'function'

  // A new clip, camera stream or crop needs a fresh temporal tracker. Only the runtime is shared.
  let release: (() => void) | null = null
  const fail = (error: unknown) => {
    stopped = true
    abort.abort()
    release?.()
    release = null
    onError(error)
  }
  createTracker(() => stopped).then((landmarker) => {
    if (!landmarker) return
    if (stopped) { landmarker.close(); return }
    release = () => landmarker.close()
    const schedule = () => {
      callback = useVideoCallback
        ? video.requestVideoFrameCallback((_now, metadata) => tick(metadata.mediaTime))
        : requestAnimationFrame(() => tick(video.currentTime))
    }
    const sample = (timestampMs: number, modelTimeMs: number) => {
      const width = video.videoWidth, height = video.videoHeight
      const started = performance.now()
      const image = input()
      let found = landmarker.detectForVideo(image, modelTimeMs).landmarks[0]
      // A paused recording keeps these exact pixels; retry an empty result once,
      // preserving source time. Live video cannot promise the same image.
      if (!found && recording && !video.srcObject) {
        found = landmarker.detectForVideo(image, modelTimeMs + 1).landmarks[0]
      }
      let landmarks: Landmark[] | null = null
      if (found) {
        landmarks = found.map(p => ({ x: p.x, y: p.y, visibility: p.visibility ?? 0 }))
        if (armFilter) landmarks = armFilter.filter(landmarks, image, cropCanvas?.width ?? width, height, timestampMs)
        if (cropCanvas && landmarks) landmarks = mapLandmarks(landmarks, cropBounds(focus, width, Boolean(video.srcObject)), width)
      }
      onFrame({ landmarks, width, height, timestampMs, inferenceMs: performance.now() - started })
    }
    if (recording && !video.srcObject) {
      void analyzeRecording(video, ms => sample(ms, ms), recording, abort.signal)
        .catch(error => { if (!stopped) fail(error) })
      return
    }
    const tick = (mediaTime: number) => {
      if (stopped) return
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && mediaTime > lastTime) {
        lastTime = mediaTime
        try { sample(mediaTime * 1000, performance.now()) }
        catch (error) { fail(error); return }
      }
      if (!stopped) schedule()
    }
    const start = () => {
      if (stopped) return
      schedule()
      onReady?.()
    }

    if (video.srcObject) {
      start()
    } else {
      // The first inference may initialize GPU shaders. Warm the full model on a paused
      // file so the beginning of the recording cannot play through that startup cost.
      warmUp = () => {
        if (stopped) return
        try {
          landmarker.detectForVideo(input(), performance.now())
          start()
        } catch (error) {
          fail(error)
        }
      }
      if (video.readyState >= 2) warmUp()
      else video.addEventListener('loadeddata', warmUp, { once: true })
    }
  }, (error) => { if (!stopped) onError(error) })

  return () => {
    stopped = true
    abort.abort()
    release?.()
    release = null
    if (warmUp) video.removeEventListener('loadeddata', warmUp)
    if (useVideoCallback) video.cancelVideoFrameCallback(callback)
    else cancelAnimationFrame(callback)
  }
}
