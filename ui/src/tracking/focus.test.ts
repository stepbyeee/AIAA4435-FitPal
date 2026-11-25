import { describe, expect, it } from 'vitest'
import { cropBounds, mapLandmarks, parseFocus } from './focus'
describe('subject selection', () => {
  it('uses displayed left and right for mirrored camera views', () => {
    expect(cropBounds('left',1000,false)).toEqual({ x:0, width:500 })
    expect(cropBounds('left',1000,true)).toEqual({ x:500, width:500 })
    expect(cropBounds('right',1000,true)).toEqual({ x:0, width:500 })
    expect(cropBounds('center',1000,true)).toEqual({ x:200, width:600 })
    expect(cropBounds('full',1000,false)).toEqual({ x:0, width:1000 })
    expect(parseFocus('other')).toBe('full')
  })
  it('maps a crop coordinate back to the original frame and rejects a joint outside the crop', () => {
    const points = mapLandmarks([{x:.5,y:.1,visibility:.99},{x:-.1,y:.1,visibility:.99}],{x:400,width:600},1000)
    expect(points[0]).toEqual({x:.7,y:.1,visibility:.99})
    expect(points[1].x).toBeCloseTo(.34)
    expect(points[1].visibility).toBe(0)
  })
})
