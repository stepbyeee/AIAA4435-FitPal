import { describe, expect, it } from 'vitest'
import { LM, type PoseFrame } from '../contract'
import { createSeatedRow } from './seatedRow'

function sample(timestampMs: number, posture: 'far' | 'close' | 'overhead' | 'hidden' | 'high-curl', mirror = false, shift = 0): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
  const points = posture === 'far' ? [[.25,.48],[.35,.52],[.48,.54]]
    : posture === 'high-curl' ? [[.25,.48],[.41,.48],[.32,.42]]
    : posture === 'overhead' ? [[.25,.48],[.25,.37],[.25,.24]] : [[.25,.48],[.19,.58],[.31,.57]]
  for (const [i,joint] of [LM.leftShoulder,LM.leftElbow,LM.leftWrist].entries()) {
    landmarks[joint] = { x: (mirror ? 1-points[i][0] : points[i][0]) +shift, y: points[i][1], visibility: posture === 'hidden' ? 0 : .98 }
  }
  return { landmarks, width: 400, height: 400, timestampMs }
}

describe('seated row experiment', () => {
  for (const mirror of [false,true]) it('requires extension, a horizontal pull, and return in either facing direction', () => {
    const e=createSeatedRow()
    const positions = ['far','far','far','close','close','close','far','far','far'] as const
    const counts = positions.map((p,i)=>e.accept(sample(120*i,p,mirror)).count)
    expect(counts.slice(0,6)).toEqual([0,0,0,0,0,0])
    expect(counts.at(-1)).toBe(1)
  })
  it('withholds a return across occlusion, a time gap or a camera cut', () => {
    for(const interruption of ['hidden','gap','cut']){
      const e=createSeatedRow()
      for(const [i,p] of (['far','far','close','close'] as const).entries()) e.accept(sample(i*150,p))
      if(interruption==='hidden') e.accept(sample(500,'hidden'))
      for(let j=0;j<4;j++) expect(e.accept(sample(600+(interruption==='gap'?800:0)+100*j,'far',false,interruption==='cut' ? .3 : 0)).count).toBe(0)
    }
  })
  it('rejects hands curling to the face with the elbows fixed in front', () => {
    const e=createSeatedRow()
    for(const [i,p] of (['far','far','high-curl','high-curl','high-curl','far','far'] as const).entries())
      expect(e.accept(sample(i*150,p)).count).toBe(0)
  })
  it('rejects vertical pulls and a clip starting contracted', () => {
    for (const posture of ['overhead','close'] as const) {
      const e=createSeatedRow()
      for(const [i,p] of ([posture,posture,'close','close','far','far'] as const).entries()) expect(e.accept(sample(i*150,p)).count).toBe(0)
    }
  })
})
