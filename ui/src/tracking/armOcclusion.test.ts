import { describe, expect, it } from 'vitest'
import type { Landmark } from '../contract'
import { createArmAssociation } from './armOcclusion'

const point = (x:number, y:number, visibility=0.95): Landmark => ({x,y,visibility})

function overhead() {
  const pose = Array.from({length:33}, () => point(.5,.5))
  for (const [i,p] of [[11,point(.42,.52)], [13,point(.32,.39)], [15,point(.27,.15)],
    [12,point(.58,.51)], [14,point(.68,.40)], [16,point(.73,.14)]] as const) pose[i]=p
  return pose
}
function primed() {
  const association = createArmAssociation()
  const accept=(at:number,p:Landmark[]|null,raster=null as Parameters<typeof association.associate>[4]) =>
    association.associate(p,640,360,at,raster)
  for (const at of [0,100,200,300,400]) accept(at,overhead())
  return accept
}
describe('independent arm association',()=>{
  it('re-associates a transient detector label exchange without reflecting or inventing points',()=>{
    const accept=primed(), pose=overhead()
    for(const [l,r] of [[11,12],[13,14],[15,16]]) [pose[l],pose[r]]=[pose[r],pose[l]]
    const seen=accept(500,pose)!
    expect(seen[15]).toBe(pose[16])
    expect(seen[16]).toBe(pose[15])
  })
  it('drops a hand reported on the other arm; keeps the observed side and reacquires the returning arm',()=>{
    const accept=primed(), p=overhead()
    p[15]=point(.72,.18);p[13]=point(.62,.45)
    const seen=accept(500,p)!
    expect(seen[15].visibility).toBe(0)
    expect(seen[13].visibility).toBe(0)
    expect(seen[16]).toBe(p[16])
    expect(accept(545,overhead())![15].visibility).toBeGreaterThan(.6)
  })
  it('keeps measured upper arm when only its wrist leaves the frame',()=>{
    const accept=primed(), p=overhead()
    p[15]=point(.27,-.09)
    const seen=accept(500,p)!
    expect(seen[13]).toBe(p[13])
    expect(seen[15].visibility).toBe(0)
    expect(seen[16]).toBe(p[16])
  })
  it('preserves a measured wrist when its elbow crosses the bottom of the image', () => {
    const accept = primed(), p = overhead()
    p[13] = point(.30, 1.02)
    p[15] = point(.28, .65)
    const seen = accept(500, p)!
    expect(seen[15]).toBe(p[15])
    expect(seen[13]).toBe(p[13])
  })
  it('rejects a uniformly blank side in the absence of an established grip reference',()=>{
    const association=createArmAssociation(), width=100,height=64
    const data=new Uint8ClampedArray(width*height*4)
    for(let y=0;y<height;y++)for(let x=50;x<width;x++)data[(y*width+x)*4]=(x+y)%2*200
    const seen=association.associate(overhead(),640,360,0,{width,height,data})!
    expect(seen[15].visibility).toBe(0)
    expect(seen[16].visibility).toBeGreaterThan(.6)
  })
})
