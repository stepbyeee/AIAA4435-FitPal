import type { ReactNode } from 'react'
import bones from '../assets/bones/bones.json'
import { LM, type Landmark } from '../contract'

// The tracked body, drawn as the bones it stands for. The bones are cut from one rendered
// skeleton (see scripts/cut-bones.py); each is laid between the tracked joints at its two ends.

type Pt = { x: number; y: number }
type PieceName = keyof typeof bones.pieces
type JointName = keyof typeof bones.joints

const files = import.meta.glob<string>('../assets/bones/*.png', { eager: true, query: '?url', import: 'default' })
const fileOf = (name: PieceName) => files[`../assets/bones/${name}.png`]
const joint = (name: JointName): Pt => ({ x: bones.joints[name][0], y: bones.joints[name][1] })

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const len = (v: Pt) => Math.hypot(v.x, v.y)
const dist = (a: Pt, b: Pt) => len(sub(b, a))
const unit = (v: Pt): Pt => {
  const l = len(v) || 1
  return { x: v.x / l, y: v.y / l }
}
const turn = (v: Pt): Pt => ({ x: -v.y, y: v.x })
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** A pair of axes with a scale on each: `along` runs down the bone, `across` over its width. */
type Frame = { origin: Pt; along: Pt; across: Pt; sAlong: number; sAcross: number }

/**
 * The matrix that carries the source render onto the screen so that the source frame lands on the
 * target frame: source.origin on target.origin, each source axis on the matching target axis.
 */
function carry(source: { origin: Pt; along: Pt; across: Pt }, target: Frame): string {
  // M = [across_t * sAcross, along_t * sAlong] * [across_s, along_s]^T
  const ax = { x: target.across.x * target.sAcross, y: target.across.y * target.sAcross }
  const al = { x: target.along.x * target.sAlong, y: target.along.y * target.sAlong }
  const a = ax.x * source.across.x + al.x * source.along.x
  const b = ax.y * source.across.x + al.y * source.along.x
  const c = ax.x * source.across.y + al.x * source.along.y
  const d = ax.y * source.across.y + al.y * source.along.y
  const e = target.origin.x - (a * source.origin.x + c * source.origin.y)
  const f = target.origin.y - (b * source.origin.x + d * source.origin.y)
  return `matrix(${a} ${b} ${c} ${d} ${e} ${f})`
}

function Piece({ name, matrix }: { name: PieceName; matrix: string }) {
  const p = bones.pieces[name]
  return <image href={fileOf(name)} x={p.x} y={p.y} width={p.width} height={p.height} transform={matrix} />
}

// The render's own measurements.
const SOURCE = {
  neck: joint('neck'),
  pelvis: joint('pelvis'),
  torso: dist(joint('neck'), joint('pelvis')),
  shoulders: dist(joint('shoulderR'), joint('shoulderL')),
  hips: dist(joint('hipR'), joint('hipL')),
}
const SOURCE_SPINE = unit(sub(SOURCE.pelvis, SOURCE.neck))
const SOURCE_ACROSS = unit(sub(joint('shoulderL'), joint('shoulderR')))

type Props = {
  landmarks: Landmark[]
  /** Size of the camera frame the landmarks are normalised to. */
  frame: { width: number; height: number }
  /** 'slice' matches a video shown with object-fit: cover; 'meet' shows the whole frame. */
  fit?: 'meet' | 'slice'
  /** Mirror the overlay together with a mirrored video. */
  mirrored?: boolean
  /** Draw a skull. Off over real video, where it would cover the person's face. */
  skull?: boolean
  className?: string
  label: string
}

export function Skeleton({ landmarks, frame, fit = 'meet', mirrored = false, skull = false, className, label }: Props) {
  const at = (index: number, atLeast = 0.5): Pt | null => {
    const lm = landmarks[index]
    return lm && lm.visibility > atLeast ? { x: lm.x * frame.width, y: lm.y * frame.height } : null
  }
  // Seated at a machine the legs are often hidden, and a guessed leg is worse than none.
  const LEG = 0.75
  const sides = [
    { s: 'R', shoulder: at(LM.rightShoulder), elbow: at(LM.rightElbow), wrist: at(LM.rightWrist), index: at(LM.rightIndex), hip: at(LM.rightHip), knee: at(LM.rightKnee, LEG), ankle: at(LM.rightAnkle, LEG), toe: at(LM.rightFoot, LEG) },
    { s: 'L', shoulder: at(LM.leftShoulder), elbow: at(LM.leftElbow), wrist: at(LM.leftWrist), index: at(LM.leftIndex), hip: at(LM.leftHip), knee: at(LM.leftKnee, LEG), ankle: at(LM.leftAnkle, LEG), toe: at(LM.leftFoot, LEG) },
  ] as const
  const [right, left] = sides
  const parts: ReactNode[] = []
  let ring = 0

  if (right.shoulder && left.shoulder) {
    const neck = mid(right.shoulder, left.shoulder)
    const hips = right.hip && left.hip ? mid(right.hip, left.hip) : null
    const shoulderSpan = dist(right.shoulder, left.shoulder)
    // How large this body is drawn, against the render. The torso length is the steadier measure:
    // seen from the side the shoulders line up and their span collapses.
    const body = hips ? dist(neck, hips) / SOURCE.torso : shoulderSpan / SOURCE.shoulders
    ring = Math.max(shoulderSpan, 0.62 * body * SOURCE.torso) * 0.1

    /** Lays a bone from joint to joint. Its width follows the body, so a foreshortened bone does not turn into a thread. */
    const limb = (name: PieceName, from: JointName, to: JointName, p: Pt | null, q: Pt | null) => {
      if (!p || !q) return
      const sa = joint(from)
      const sb = joint(to)
      const sAlong = dist(p, q) / dist(sa, sb)
      const along = unit(sub(q, p))
      parts.push(
        <Piece
          key={name}
          name={name}
          matrix={carry({ origin: sa, along: unit(sub(sb, sa)), across: turn(unit(sub(sb, sa))) }, { origin: p, along, across: turn(along), sAlong, sAcross: clamp(sAlong, 0.8 * body, 1.2 * body) })}
        />,
      )
    }

    if (hips) {
      const spine = unit(sub(hips, neck))
      // Which way the body faces decides which way the ribs go: across, from its right to its left.
      const sideways = (from: Pt, to: Pt) => {
        const w = sub(to, from)
        const flat = sub(w, { x: spine.x * dot(w, spine), y: spine.y * dot(w, spine) })
        return len(flat) > 1 ? unit(flat) : turn(spine)
      }
      const across = sideways(right.shoulder, left.shoulder)
      const chest: Frame = { origin: neck, along: spine, across, sAlong: body, sAcross: clamp(shoulderSpan / SOURCE.shoulders, 0.6 * body, 1.25 * body) }
      const torso = carry({ origin: SOURCE.neck, along: SOURCE_SPINE, across: SOURCE_ACROSS }, chest)
      parts.push(<Piece key="torso" name="torso" matrix={torso} />)

      const hipScale = clamp(dist(right.hip!, left.hip!) / SOURCE.hips, 0.8 * body, 1.25 * body)
      parts.push(
        <Piece
          key="pelvis"
          name="pelvis"
          matrix={carry({ origin: SOURCE.pelvis, along: SOURCE_SPINE, across: SOURCE_ACROSS }, { origin: hips, along: spine, across: sideways(right.hip!, left.hip!), sAlong: hipScale, sAcross: hipScale })}
        />,
      )
      // The skull rides on the backbone rather than on the face landmarks, which keeps it steady.
      if (skull) parts.push(<Piece key="skull" name="skull" matrix={carry({ origin: SOURCE.neck, along: SOURCE_SPINE, across: SOURCE_ACROSS }, { ...chest, sAcross: body })} />)
    }

    for (const side of sides) {
      const s = side.s
      limb(`femur${s}`, `hip${s}`, `knee${s}`, side.hip, side.knee)
      limb(`shin${s}`, `knee${s}`, `ankle${s}`, side.knee, side.ankle)
      limb(`foot${s}`, `ankle${s}`, `toe${s}`, side.ankle, side.toe)
    }
    for (const side of sides) {
      const s = side.s
      limb(`humerus${s}`, `shoulder${s}`, `elbow${s}`, side.shoulder, side.elbow)
      limb(`forearm${s}`, `elbow${s}`, `wrist${s}`, side.elbow, side.wrist)
      limb(`hand${s}`, `wrist${s}`, `index${s}`, side.wrist, side.index)
    }
  }

  return (
    <svg
      className={className ? `bones ${className}` : 'bones'}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      preserveAspectRatio={fit === 'slice' ? 'xMidYMid slice' : 'xMidYMid meet'}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
      role="img"
      aria-label={label}
    >
      {parts}
      {/* The elbow is the joint being measured. */}
      {sides.map((side) => side.elbow && <circle key={side.s} cx={side.elbow.x} cy={side.elbow.y} r={ring} fill="none" stroke="var(--accent)" strokeWidth={Math.max(2, ring * 0.3)} />)}
    </svg>
  )
}
