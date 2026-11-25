import type { Landmark } from '../contract'
import { inFrame, limbJoints, type Side } from './limbLandmarks'

const sides = ['left', 'right'] as const
const joints = limbJoints.arm
const hand = { left: [17, 19, 21], right: [18, 20, 22] } as const
const opposite = (side: Side): Side => side === 'left' ? 'right' : 'left'
type Arms<T> = Record<Side, T>
type Grip = { wrist: Arms<number>; shoulder: Arms<number> }
type Raster = Pick<ImageData, 'data' | 'width' | 'height'>

function arm(points: Landmark[], side: Side) {
  const [shoulder, elbow, wrist] = joints[side].map(i => points[i])
  return { shoulder, elbow, wrist }
}

/** Learn grip positions only from a clearly separated wide grip in a front/rear view. */
function wideGrip(points: Landmark[], aspect: number): Grip | null {
  const l = arm(points, 'left')
  const r = arm(points, 'right')
  if (![l.shoulder, l.elbow, l.wrist, r.shoulder, r.elbow, r.wrist].every(inFrame)) return null
  const wristSpan = r.wrist.x - l.wrist.x
  const shoulderSpan = r.shoulder.x - l.shoulder.x
  if (Math.abs(wristSpan) * aspect < 0.22 || Math.abs(shoulderSpan) * aspect < 0.055 ||
      wristSpan * shoulderSpan <= 0 || Math.abs(wristSpan) < 1.15 * Math.abs(shoulderSpan)) return null
  const direction = Math.sign(wristSpan)
  if ((l.wrist.x - l.shoulder.x) * direction > 0 || (r.wrist.x - r.shoulder.x) * direction < 0) return null
  return {
    wrist: { left: l.wrist.x, right: r.wrist.x },
    shoulder: { left: l.shoulder.x, right: r.shoulder.x },
  }
}

function rangeAt(raster: Raster, x: number, y: number) {
  const cx = Math.round(x * (raster.width - 1))
  const cy = Math.round(y * (raster.height - 1))
  const low = [255, 255, 255], high = [0, 0, 0]
  for (let yy = Math.max(0, cy - 2); yy <= Math.min(raster.height - 1, cy + 2); yy++) {
    for (let xx = Math.max(0, cx - 2); xx <= Math.min(raster.width - 1, cx + 2); xx++) {
      const base = 4 * (yy * raster.width + xx)
      for (let c = 0; c < 3; c++) {
        low[c] = Math.min(low[c], raster.data[base + c])
        high[c] = Math.max(high[c], raster.data[base + c])
      }
    }
  }
  return Math.max(...high.map((value, c) => value - low[c]))
}

/** Uniform pixels over the entire segment give very little support for drawing that bone. */
function featureless(a: Landmark, b: Landmark, raster: Raster | null) {
  if (!raster || !inFrame(a) || !inFrame(b)) return false
  return [0.2, 0.55, 0.9].every(t =>
    rangeAt(raster, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) <= 4)
}

function assignArm(points: Landmark[], grip: Grip, target: Side, span: number): Side | null {
  let best: Side | null = null
  let bestCost = Infinity
  for (const side of sides) {
    const { shoulder, elbow, wrist } = arm(points, side)
    if (![shoulder, elbow, wrist].every(inFrame)) continue
    const distance = Math.abs(wrist.x - grip.wrist[target]) / span
    if (distance > 0.32) continue
    const cost = distance + 0.4 * Math.abs(shoulder.x - grip.shoulder[target]) / span +
      0.12 * (1 - Math.min(elbow.visibility, wrist.visibility))
    if (cost < bestCost) {
      best = side
      bestCost = cost
    }
  }
  return best
}

function copyArm(output: Landmark[], points: Landmark[], target: Side, from: Side, upper: boolean, forearm: boolean) {
  for (const [index, sourceIndex] of joints[from].entries()) {
    const p = points[sourceIndex]
    const hidden = (index === 2 && !forearm) || (index === 1 && !upper)
    if (p) output[joints[target][index]] = hidden ? { ...p, visibility: 0 } : p
  }
  for (const [index, sourceIndex] of hand[from].entries()) {
    const p = points[sourceIndex]
    if (p) output[hand[target][index]] = forearm ? p : { ...p, visibility: 0 }
  }
}

export function createArmAssociation() {
  let grip: Grip | null = null
  let pending: Grip | null = null
  let pendingSince = 0, lastTime = -Infinity, lastFound = -Infinity
  const hidden: Arms<boolean> = { left: false, right: false }

  function reset() {
    grip = pending = null
    for (const side of sides) {
      hidden[side] = false
    }
  }

  function learnGrip(candidate: Grip | null, time: number) {
    if (!candidate) { pending = null; return }
    const span = Math.abs(candidate.wrist.left - candidate.wrist.right)
    if (!pending || sides.some(s => Math.abs(pending!.wrist[s] - candidate.wrist[s]) >= 0.25 * span)) {
      pending = candidate
      pendingSince = time
    }
    // A camera move can replace the reference. A temporary swap of model labels cannot.
    const moved = !grip || sides.every(s =>
      sides.every(d => Math.abs(grip!.wrist[s] - candidate.wrist[d]) > 0.45 * span))
    if (moved && time - pendingSince >= 350) grip = candidate
  }

  function associate(points: Landmark[] | null, width: number, height: number, time: number, raster: Raster | null) {
    if (time < lastTime || time - lastFound > 900) reset()
    lastTime = time
    if (!points || sides.some(s => joints[s].some(i => !points[i])) || width <= 0 || height <= 0) return points
    lastFound = time
    learnGrip(wideGrip(points, width / height), time)

    const selected: Arms<Side | null> = { left: 'left', right: 'right' }
    const span = grip ? Math.abs(grip.wrist.right - grip.wrist.left) : 0
    if (grip) for (const side of sides) selected[side] = assignArm(points, grip, side, span)

    const output = points.slice()
    for (const side of sides) {
      const assigned = selected[side]
      let from = assigned ?? side
      if (!assigned && grip && selected[opposite(side)] === from) from = opposite(from)
      const { shoulder, elbow, wrist } = arm(points, from)
      let upper = inFrame(shoulder) && inFrame(elbow) && !featureless(shoulder, elbow, raster)
      // A measured shoulder/elbow may still support counting when a wrist leaves the picture.
      if (!assigned && grip && upper) {
        const direction = Math.sign(grip.wrist[side] - grip.wrist[opposite(side)])
        const center = (grip.shoulder.left + grip.shoulder.right) / 2
        upper = (elbow.x - center) * direction > 0.12 * span && Math.abs(shoulder.x - grip.shoulder[side]) < 0.35 * span
      }
      const wristInLane = !grip || Math.abs(wrist.x - grip.wrist[side]) <= 0.32 * span
      // An image border can split a measured arm. Keep the individual observations:
      // the overlay already requires all three joints inside the picture to draw a trail.
      const overheadCrop = upper && wrist.y < 0 && wrist.visibility >= 0.6
      const elbowBelow = elbow.y >= 1 && elbow.visibility >= 0.6 && inFrame(shoulder) &&
        inFrame(wrist) && wristInLane && (!raster || rangeAt(raster, wrist.x, wrist.y) > 4)
      if (elbowBelow || overheadCrop) {
        hidden[side] = false
        copyArm(output, points, side, from, upper || elbowBelow, elbowBelow)
        continue
      }
      const supported = Boolean(assigned && upper && inFrame(wrist) && !featureless(elbow, wrist, raster))
      hidden[side] = !supported
      copyArm(output, points, side, from, upper, supported)
    }

    if (grip && selected.left && selected.right && !hidden.left && !hidden.right) {
      for (const side of sides) {
        const measured = arm(points, selected[side]!)
        grip.wrist[side] += 0.04 * (measured.wrist.x - grip.wrist[side])
        grip.shoulder[side] += 0.04 * (measured.shoulder.x - grip.shoulder[side])
      }
    }
    return output
  }
  return { associate }
}

/** One instance per camera or clip. The live tracker and fixed-frame replay share this entry point. */
export function createArmOcclusionFilter() {
  const association = createArmAssociation()
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null
  function filter(points: Landmark[] | null, image: CanvasImageSource, width: number, height: number, timeMs: number) {
    let raster: ImageData | null = null
    if (points && width > 0 && height > 0) {
      if (!canvas) {
        canvas = document.createElement('canvas')
        context = canvas.getContext('2d', { willReadFrequently: true })
      }
      if (context) {
        const scale = Math.min(1, 192 / Math.max(width, height))
        const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale))
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
        context.drawImage(image, 0, 0, w, h)
        raster = context.getImageData(0, 0, w, h)
      }
    }
    return association.associate(points, width, height, timeMs, raster)
  }
  return { filter }
}
