import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Limb } from './limbLandmarks'
import { selectLandmarks, type SideSelection } from './sideSelection'
import type { Focus } from './focus'
import type { Landmark } from '../contract'
import { trackPose, type TrackedFrame } from './poseTracker'
import { advanceLiveMotion, emptyLiveMotion, type LiveMotion } from './liveMotion'

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
  motion: LiveMotion
  status: VideoStatus
}

/** The stage's video, either the user's camera or a recorded clip, with the body in it tracked. */
export function useStageVideo(options: {
  pulldown?: boolean
  side?: SideSelection
  focus?: Focus
  camera: boolean
  limb?: Limb
  file: string | null
  live: boolean
  onFrame: (frame: TrackedFrame) => void
  onEnded: () => void
}): StageVideo {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [frame, setFrame] = useState<StageVideo['frame']>(null)
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null)
  const [motion, setMotion] = useState(emptyLiveMotion)
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
    const clearMotion = () => setMotion(emptyLiveMotion)
    const measure = () => {
      clearMotion()
      if (video.videoWidth) setFrame({ width: video.videoWidth, height: video.videoHeight })
    }
    const ended = () => {
      stop()
      setStatus('ended')
      setLandmarks(null)
      clearMotion()
      onEnded()
    }
    const failed = () => {
      stop()
      for (const track of cameraTracks) track.stop()
      setStatus('unavailable')
      setLandmarks(null)
      clearMotion()
      video.pause()
    }
    measure()
    video.addEventListener('loadedmetadata', measure)
    video.addEventListener('resize', measure)
    video.addEventListener('waiting', clearMotion)
    video.addEventListener('pause', clearMotion)
    video.addEventListener('seeking', clearMotion)
    if (!stream) video.addEventListener('ended', ended)
    video.addEventListener('error', failed)
    for (const track of cameraTracks) {
      track.addEventListener('ended', failed)
      track.addEventListener('mute', clearMotion)
    }
    if (video.error || cameraTracks.some((track) => track.readyState === 'ended')) failed()
    else stop = trackPose(video, (measured) => {
      const sample = { ...measured, landmarks: selectLandmarks(measured.landmarks, options.limb ?? 'arm', options.side ?? 'both') }
      setStatus('tracking')
      setLandmarks(sample.landmarks)
      setMotion((previous) => advanceLiveMotion(previous, sample, options.limb))
      onFrame(sample)
    }, (error) => {
      console.warn('Pose tracking is unavailable. Run `npm run setup:pose` to fetch the model.', error)
      for (const track of cameraTracks) track.stop()
      setStatus('tracking-error')
      setLandmarks(null)
      clearMotion()
      video.pause()
    }, () => {
      video.play().catch(() => { if (!cancelled) failed() })
    }, options.focus, options.pulldown)
    return () => {
      cancelled = true
      stop()
      video.pause()
      video.removeEventListener('loadedmetadata', measure)
      video.removeEventListener('resize', measure)
      video.removeEventListener('waiting', clearMotion)
      video.removeEventListener('pause', clearMotion)
      video.removeEventListener('seeking', clearMotion)
      video.removeEventListener('ended', ended)
      video.removeEventListener('error', failed)
      for (const track of cameraTracks) {
        track.removeEventListener('ended', failed)
        track.removeEventListener('mute', clearMotion)
      }
      setLandmarks(null)
      setFrame(null)
      clearMotion()
    }
  }, [active, stream, options.focus, options.file, options.limb, options.side, options.pulldown])

  return { ref, source, frame, landmarks, motion, status }
}
