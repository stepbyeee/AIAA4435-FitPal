import type { Landmark } from '../contract'

export type Focus = 'full' | 'left' | 'center' | 'right'
export const focusLabels: Record<Focus, string> = { full: '完整画面', left: '画面左侧', center: '画面中间', right: '画面右侧' }

export function parseFocus(value: string | null): Focus {
  return value === 'left' || value === 'center' || value === 'right' ? value : 'full'
}

/** Bounds are in source pixels. The selector uses the displayed (possibly mirrored) view. */
export function cropBounds(focus: Focus, frameWidth: number, mirrored: boolean) {
  const width = focus === 'full' ? frameWidth : Math.max(1, Math.round(frameWidth * (focus === 'center' ? 0.6 : 0.5)))
  const spare = frameWidth - width
  const x = focus === 'center' ? Math.round(spare / 2) : (focus === 'left') === mirrored ? spare : 0
  return { x, width }
}

export function mapLandmarks(points: { x: number; y: number; visibility?: number }[], crop: { x: number; width: number }, frameWidth: number): Landmark[] {
  return points.map(p => ({
    x: (crop.x + p.x * crop.width) / frameWidth, y: p.y,
    visibility: p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? p.visibility ?? 0 : 0,
  }))
}
