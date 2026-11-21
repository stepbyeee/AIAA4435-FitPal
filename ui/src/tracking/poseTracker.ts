import type { Landmark, PoseFrame } from '../contract'

// One stream feeds both the bone overlay and the perception module.
// Frames are read on the device and never leave the page.

const WASM = '/mediapipe/wasm'
const MODEL = '/mediapipe/pose_landmarker_full.task'

type Landmarker = { detectForVideo(video: HTMLVideoElement, timestampMs: number): { landmarks: { x: number; y: number; visibility?: number }[][] } }

let loading: Promise<Landmarker> | null = null

function load(): Promise<Landmarker> {
  loading ??= (async () => {
    // Loaded on demand: the model and runtime are large and only this screen needs them.
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM)
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1 })
    try {
      return await make('GPU')
    } catch {
      return await make('CPU')
    }
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

export type TrackedFrame = PoseFrame & { inferenceMs: number }

/** Sample each newly presented frame and preserve its timestamp in the source video. */
export function trackPose(
  video: HTMLVideoElement,
  onFrame: (frame: TrackedFrame) => void,
  onError: (error: unknown) => void,
  onReady?: () => void,
): () => void {
  let stopped = false
  let callback = 0
  let lastTime = -1
  let warmUp: (() => void) | null = null
  const useVideoCallback = typeof video.requestVideoFrameCallback === 'function'

  load().then((landmarker) => {
    if (stopped) return
    const schedule = () => {
      callback = useVideoCallback
        ? video.requestVideoFrameCallback((_now, metadata) => tick(metadata.mediaTime))
        : requestAnimationFrame(() => tick(video.currentTime))
    }
    const tick = (mediaTime: number) => {
      if (stopped) return
      const width = video.videoWidth
      const height = video.videoHeight
      if (video.readyState >= 2 && width > 0 && height > 0 && mediaTime > lastTime) {
        lastTime = mediaTime
        try {
          const started = performance.now()
          const found = landmarker.detectForVideo(video, started).landmarks[0]
          const landmarks: Landmark[] | null = found?.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 0 })) ?? null
          onFrame({ landmarks, width, height, timestampMs: mediaTime * 1000, inferenceMs: performance.now() - started })
        } catch (error) {
          stopped = true
          onError(error)
          return
        }
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
          landmarker.detectForVideo(video, performance.now())
          start()
        } catch (error) {
          onError(error)
        }
      }
      if (video.readyState >= 2) warmUp()
      else video.addEventListener('loadeddata', warmUp, { once: true })
    }
  }, (error) => { if (!stopped) onError(error) })

  return () => {
    stopped = true
    if (warmUp) video.removeEventListener('loadeddata', warmUp)
    if (useVideoCallback) video.cancelVideoFrameCallback(callback)
    else cancelAnimationFrame(callback)
  }
}
