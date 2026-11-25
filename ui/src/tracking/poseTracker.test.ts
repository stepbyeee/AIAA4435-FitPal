import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { trackPose } from './poseTracker'

const model = vi.hoisted(() => ({ detectForVideo: vi.fn((_image: unknown, _timestamp: number) => ({ landmarks: [] })), close: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: { createFromOptions: async () => model },
}))

class RecordedVideo extends EventTarget {
  srcObject = null
  readyState = 2
  videoWidth = 640
  videoHeight = 360
  duration = 0.2
  paused = true
  seeking = false
  error = null
  time = 0
  autoSeek = true
  get currentTime() { return this.time }
  set currentTime(value: number) {
    this.time = value
    this.seeking = true
    this.dispatchEvent(new Event('seeking'))
    if (this.autoSeek) setTimeout(() => { this.seeking = false; this.dispatchEvent(new Event('seeked')) }, 1)
  }
  pause() { this.paused = true }
  requestVideoFrameCallback = vi.fn(() => 1)
  cancelVideoFrameCallback = vi.fn()
}
let stop = () => {}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) }) }); model.detectForVideo.mockClear(); model.close.mockClear() })
afterEach(() => { stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('analyzes all scheduled recording frames using source time even when inference is slow', async () => {
  const video = new RecordedVideo()
  const frames: number[] = [], ended = vi.fn(), error = vi.fn()
  model.detectForVideo.mockImplementation(() => { vi.setSystemTime(Date.now() + 350); return { landmarks: [] } })
  stop = trackPose(video as unknown as HTMLVideoElement, f => frames.push(f.timestampMs), error, undefined, 'full', false,
    { onEnded: ended, onProgress: () => {}, isPaused: () => false })
  await vi.advanceTimersByTimeAsync(1000)
  expect(frames).toEqual([0, 1000 / 15, 2000 / 15])
  expect(model.detectForVideo.mock.calls.map(args => args[1])).toEqual(frames)
  expect(ended).toHaveBeenCalledTimes(1)
  expect(error).not.toHaveBeenCalled()
})

it('holds recording analysis while paused and resumes without skipping source time', async () => {
  const video = new RecordedVideo()
  let paused = false
  const frames: number[] = []
  stop = trackPose(video as unknown as HTMLVideoElement, f => { frames.push(f.timestampMs); paused = true }, vi.fn(), undefined, 'full', false,
    { onEnded: vi.fn(), onProgress: () => {}, isPaused: () => paused })
  await vi.advanceTimersByTimeAsync(1000)
  expect(frames).toEqual([0])
  paused = false
  await vi.advanceTimersByTimeAsync(1000)
  expect(frames).toEqual([0, 1000 / 15])
})

it('cancels a pending seek without publishing more frames or completing the recording', async () => {
  const video = new RecordedVideo(); video.autoSeek = false
  const frames: number[] = [], ended = vi.fn()
  stop = trackPose(video as unknown as HTMLVideoElement, f => frames.push(f.timestampMs), vi.fn(), undefined, 'full', false,
    { onEnded: ended, onProgress: () => {}, isPaused: () => false })
  await vi.advanceTimersByTimeAsync(20)
  expect(frames).toEqual([0])
  stop()
  video.dispatchEvent(new Event('seeked'))
  await vi.advanceTimersByTimeAsync(1000)
  expect(frames).toEqual([0])
  expect(ended).not.toHaveBeenCalled()
  expect(model.close).toHaveBeenCalledTimes(1)
})

it('reports a seek timeout once and releases the model without completing', async () => {
  const video = new RecordedVideo(); video.autoSeek = false
  const failed = vi.fn(), ended = vi.fn()
  stop = trackPose(video as unknown as HTMLVideoElement, vi.fn(), failed, undefined, 'full', false,
    { onEnded: ended, onProgress: () => {}, isPaused: () => false })
  await vi.advanceTimersByTimeAsync(16000)
  expect(failed).toHaveBeenCalledTimes(1)
  expect(model.close).toHaveBeenCalledTimes(1)
  expect(ended).not.toHaveBeenCalled()
})

it('stops on model failure without publishing a frame or completion', async () => {
  const video = new RecordedVideo()
  const failed = vi.fn(), ended = vi.fn(), frame = vi.fn()
  model.detectForVideo.mockImplementationOnce(() => { throw Error('Inference failed') })
  stop = trackPose(video as unknown as HTMLVideoElement, frame, failed, undefined, 'full', false,
    { onEnded: ended, onProgress: () => {}, isPaused: () => false })
  await vi.advanceTimersByTimeAsync(1000)
  expect(failed).toHaveBeenCalledTimes(1)
  expect(model.close).toHaveBeenCalledTimes(1)
  expect(frame).not.toHaveBeenCalled()
  expect(ended).not.toHaveBeenCalled()
})
