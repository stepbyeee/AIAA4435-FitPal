import { expect, it } from 'vitest'
import { createLiveTrends, trendPath } from './liveTrends'
import { LM, type PoseFrame, type FrameState } from '../contract'

const calibration = { side: 'right' as const, thetaTop: 160, thetaBottom: 60 }
const state: FrameState = { phase: 'pull', q: .6, visible: true, repCount: 0, landmarks: null }
function profile(atMs: number, tilt = 12): PoseFrame {
  const landmarks = Array.from({length:33},()=>({x:0,y:0,visibility:0}))
  const dx = Math.sin(tilt*Math.PI/180)*.24*720/1280, sy=.66-Math.cos(tilt*Math.PI/180)*.24
  const place=(index:number,x:number,y:number)=>{landmarks[index]={x,y,visibility:.99}}
  place(LM.rightHip,.5,.66);place(LM.rightShoulder,.5-dx,sy);place(LM.leftShoulder,.51-dx,sy)
  place(LM.rightEar,.5-dx,sy-.09);place(LM.nose,.543-dx,sy-.07)
  return {timestampMs:atMs,width:1280,height:720,landmarks}
}
it('plots existing calibrated amplitude and the gated side-view torso angle',()=>{
  const r=createLiveTrends('arm',calibration);r.observe(profile(0),state);r.observe(profile(100,18),{...state,q:.9})
  expect(r.samples.at(-1)).toMatchObject({atMs:100,range:.9});expect(r.samples.at(-1)?.tilt).toBeCloseTo(18)
})
it('does not invent personal amplitude before calibration or from upper-arm-only counting',()=>{
  for(const c of [undefined,{...calibration,basis:'upper-arm' as const}]){
    const r=createLiveTrends('arm',c);r.observe(profile(0),state);expect(r.samples.at(-1)?.range).toBeNull()
  }
})
it('withholds torso tilt for frontal, cropped and leg views',()=>{
  const front=profile(0);front.landmarks![LM.leftShoulder].x=.8
  const crop=profile(100);crop.landmarks![LM.rightHip].visibility=.1
  const r=createLiveTrends('arm',calibration);r.observe(front,state);r.observe(crop,state)
  expect(r.samples.every(s=>s.tilt===null)).toBe(true)
  const squat=createLiveTrends('leg',calibration);squat.observe(profile(0),state);expect(squat.samples[0].tilt).toBeNull()
})
it('breaks curves at occlusion, long source gaps and changed camera position',()=>{
  const r=createLiveTrends('arm',calibration)
  r.observe(profile(0),state);r.observe(profile(100),state)
  r.observe({...profile(150),landmarks:null},{...state,visible:false});r.observe(profile(200),state)
  r.observe(profile(600),state)
  const moved=profile(700);moved.landmarks![LM.rightHip].x+=.1;r.observe(moved,state)
  const path=trendPath(r.samples,'range',300,60,0,1)
  expect(path.match(/M/g)?.length).toBe(3)
  expect(trendPath(r.samples,'tilt',300,60,-45,45).match(/M/g)!.length).toBeGreaterThanOrEqual(3)
})
it('retains a bounded six-second window and ignores duplicate frames',()=>{
  const r=createLiveTrends('arm',calibration)
  for(let t=0;t<=30000;t+=10)r.observe(profile(t),state)
  const before=r.samples.length;r.observe(profile(30000),state)
  expect(r.samples.length).toBe(before);expect(before).toBeLessThanOrEqual(128)
  expect(r.samples[0].atMs).toBeGreaterThanOrEqual(24000)
  expect(trendPath(r.samples,'range',300,60,0,1)).not.toMatch(/NaN|Infinity/)
})
