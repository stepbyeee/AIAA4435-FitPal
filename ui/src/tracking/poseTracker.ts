import type { Landmark } from '../contract'

// Pose landmarks from a playing video, for the bone overlay. This is the one piece of tracking
// the UI runs itself; counting reps and calibration belong to the perception module.
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

/** Calls back with the landmarks of each new video frame, or null when nobody is found. Returns a stop function. */
export function trackPose(video: HTMLVideoElement, onLandmarks: (landmarks: Landmark[] | null) => void, onError: (error: unknown) => void): () => void {
  let stopped = false
  let raf = 0
  let lastTime = -1

  load().then((landmarker) => {
    const tick = () => {
      if (stopped) return
      if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastTime) {
        lastTime = video.currentTime
        try {
          const found = landmarker.detectForVideo(video, performance.now()).landmarks[0]
          onLandmarks(found ? found.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 0 })) : null)
        } catch (error) {
          stopped = true
          onError(error)
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
  }, onError)

  return () => {
    stopped = true
    cancelAnimationFrame(raf)
  }
}
