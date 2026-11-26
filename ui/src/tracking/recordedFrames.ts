export type RecordingAnalysis = {
  onEnded: () => void
  onProgress: (seconds: number, duration: number) => void
  isPaused: () => boolean
}

/** Recorded files can wait for inference; a live camera cannot. Sample source time at 15 Hz. */
export async function analyzeRecording(
  video: HTMLVideoElement,
  sample: (timestampMs: number) => void,
  analysis: RecordingAnalysis,
  signal: AbortSignal,
) {
  const wait = (event: string | null, milliseconds: number) => new Promise<void>((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer)
      if (event) video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
    }
    const done = () => { clean(); resolve() }
    const failed = () => { clean(); reject(Error('Recording could not be decoded')) }
    const aborted = () => { clean(); reject(signal.reason) }
    const timer = setTimeout(event ? failed : done, milliseconds)
    if (event) video.addEventListener(event, done, { once: true })
    video.addEventListener('error', failed, { once: true })
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
  video.pause()
  if (video.readyState < 2) await wait('loadeddata', 15000)
  if (!Number.isFinite(video.duration) || video.duration <= 0) throw Error('Recording duration is unavailable')
  for (let index = 0; index / 15 < video.duration; index++) {
    while (analysis.isPaused() && !signal.aborted) await wait(null, 50)
    if (signal.aborted) return
    const seconds = index / 15
    if (video.seeking || Math.abs(video.currentTime - seconds) > 0.00001) {
      const decoded = wait('seeked', 15000)
      video.currentTime = seconds
      await decoded
    }
    while (analysis.isPaused() && !signal.aborted) await wait(null, 50)
    if (signal.aborted) return
    sample(index * 1000 / 15)
    if (signal.aborted) return
    analysis.onProgress(seconds, video.duration)
    // Yield for drawing and user input; processing speed must not skip source frames.
    await wait(null, 0)
  }
  if (!signal.aborted) {
    analysis.onProgress(video.duration, video.duration)
    analysis.onEnded()
  }
}
