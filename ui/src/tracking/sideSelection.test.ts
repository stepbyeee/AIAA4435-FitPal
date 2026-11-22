import { expect, it } from 'vitest'
import { selectLandmarks, parseSide } from './sideSelection'
import { limbJoints } from './limbLandmarks'

it('overrides only the excluded side for this exercise and leaves the detector results unchanged', () => {
  const points = Array.from({length:33},()=>({x:.5,y:.5,visibility:.95}))
  for (const limb of ['arm','leg'] as const) {
    const filtered = selectLandmarks(points,limb,'right')!
    expect(limbJoints[limb].left.map(i=>filtered[i].visibility)).toEqual([0,0,0])
    expect(limbJoints[limb].right.every(i=>filtered[i]===points[i])).toBe(true)
  }
  expect(points.every(p=>p.visibility===.95)).toBe(true)
  expect(selectLandmarks(points,'arm',parseSide(null))).toBe(points)
})
