import { useEffect, useRef, useState } from 'react'
import type { Landmark } from '../contract'
import { trackPose } from './poseTracker'

export type StageVideo = {
  /** Attach to the <video> element. */
  ref: React.RefObject<HTMLVideoElement | null>
  /** What the element should play: the camera, a file, or nothing. */
  source: { kind: 'camera'; stream: MediaStream } | { kind: 'file'; src: string } | null
  /** Pixel size of the video frame, once known. */
  frame: { width: number; height: number } | null
  /** The tracked body in the current frame. */
  landmarks: Landmark[] | null
  /** True once tracking has failed to start, so the stage can say so. */
  trackingFailed: boolean
}

/** The stage's video, either the user's camera or a recorded clip, with the body in it tracked. */
export function useStageVideo(options: { camera: boolean; file: string | null }): StageVideo {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [frame, setFrame] = useState<StageVideo['frame']>(null)
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null)
  const [trackingFailed, setTrackingFailed] = useState(false)
  const wantCamera = options.camera && !options.file

  useEffect(() => {
    if (!wantCamera || !navigator.mediaDevices?.getUserMedia) return
    let cancelled = false
    let current: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        current = s
        setStream(s)
      })
      .catch(() => {
        // No camera or no permission: the stage shows the stand-in body instead.
      })
    return () => {
      cancelled = true
      current?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [wantCamera])

  const source: StageVideo['source'] = options.file ? { kind: 'file', src: options.file } : stream ? { kind: 'camera', stream } : null
  const active = source !== null

  useEffect(() => {
    const video = ref.current
    if (!video || !active) return
    if (stream) video.srcObject = stream
    const measure = () => {
      if (video.videoWidth) setFrame({ width: video.videoWidth, height: video.videoHeight })
    }
    measure()
    video.addEventListener('loadedmetadata', measure)
    video.addEventListener('resize', measure)
    // Autoplay can be refused; the clip is muted, so asking again is allowed.
    video.play().catch(() => {})
    const stop = trackPose(video, setLandmarks, (error) => {
      console.warn('Pose tracking is unavailable. Run `npm run setup:pose` to fetch the model.', error)
      setTrackingFailed(true)
    })
    return () => {
      stop()
      video.removeEventListener('loadedmetadata', measure)
      video.removeEventListener('resize', measure)
      setLandmarks(null)
      setFrame(null)
    }
  }, [active, stream])

  return { ref, source, frame, landmarks, trackingFailed }
}
