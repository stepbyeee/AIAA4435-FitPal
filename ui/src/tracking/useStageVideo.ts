import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Landmark } from '../contract'
import { trackPose, type TrackedFrame } from './poseTracker'

type VideoStatus = 'starting' | 'tracking' | 'ended' | 'unavailable' | 'tracking-error'

export type StageVideo = {
  /** Attach to the <video> element. */
  ref: React.RefObject<HTMLVideoElement | null>
  /** What the element should play: the camera, a file, or nothing. */
  source: { kind: 'camera'; stream: MediaStream } | { kind: 'file'; src: string } | null
  /** Pixel size of the video frame, once known. */
  frame: { width: number; height: number } | null
  /** The tracked body in the current frame. */
  landmarks: Landmark[] | null
  status: VideoStatus
}

/** The stage's video, either the user's camera or a recorded clip, with the body in it tracked. */
export function useStageVideo(options: {
  camera: boolean
  file: string | null
  live: boolean
  onFrame: (frame: TrackedFrame) => void
  onEnded: () => void
}): StageVideo {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [frame, setFrame] = useState<StageVideo['frame']>(null)
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null)
  const [status, setStatus] = useState<VideoStatus>('starting')
  const wantCamera = options.camera && !options.file && options.live
  const onFrame = useEffectEvent(options.onFrame)
  const onEnded = useEffectEvent(options.onEnded)

  useEffect(() => {
    if (!wantCamera) return
    setStatus('starting')
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable')
      return
    }
    let cancelled = false
    let current: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        current = s
        setStream(s)
      })
      .catch(() => { if (!cancelled) setStatus('unavailable') })
    return () => {
      cancelled = true
      current?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [wantCamera])

  const source: StageVideo['source'] = options.file ? { kind: 'file', src: options.file } : stream ? { kind: 'camera', stream } : null
  const active = source !== null && options.live

  useEffect(() => {
    const video = ref.current
    if (!video || !active) return
    let cancelled = false
    let stop = () => {}
    if (stream) video.srcObject = stream
    const cameraTracks = stream?.getVideoTracks() ?? []
    setStatus('starting')
    const measure = () => {
      if (video.videoWidth) setFrame({ width: video.videoWidth, height: video.videoHeight })
    }
    const ended = () => {
      stop()
      setStatus('ended')
      setLandmarks(null)
      onEnded()
    }
    const failed = () => {
      stop()
      for (const track of cameraTracks) track.stop()
      setStatus('unavailable')
      setLandmarks(null)
      video.pause()
    }
    measure()
    video.addEventListener('loadedmetadata', measure)
    video.addEventListener('resize', measure)
    if (!stream) video.addEventListener('ended', ended)
    video.addEventListener('error', failed)
    for (const track of cameraTracks) track.addEventListener('ended', failed)
    if (video.error || cameraTracks.some((track) => track.readyState === 'ended')) failed()
    else stop = trackPose(video, (sample) => {
      setStatus('tracking')
      setLandmarks(sample.landmarks)
      onFrame(sample)
    }, (error) => {
      console.warn('Pose tracking is unavailable. Run `npm run setup:pose` to fetch the model.', error)
      for (const track of cameraTracks) track.stop()
      setStatus('tracking-error')
      setLandmarks(null)
      video.pause()
    }, () => {
      video.play().catch(() => { if (!cancelled) failed() })
    })
    return () => {
      cancelled = true
      stop()
      video.pause()
      video.removeEventListener('loadedmetadata', measure)
      video.removeEventListener('resize', measure)
      video.removeEventListener('ended', ended)
      video.removeEventListener('error', failed)
      for (const track of cameraTracks) track.removeEventListener('ended', failed)
      setLandmarks(null)
      setFrame(null)
    }
  }, [active, stream, options.file])

  return { ref, source, frame, landmarks, status }
}
