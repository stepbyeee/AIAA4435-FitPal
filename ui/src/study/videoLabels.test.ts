import { describe, expect, it } from 'vitest'
import { appendLabel, makeLabelFile, readLabelFile, validClipId, type LabelSession, type LabelEntry } from './videoLabels'
const hash = 'a'.repeat(64)
const sample: LabelSession = { id:'P01-LP-01',extension:'webm',durationSec:12,sha256:hash,exercise:'lat-pulldown',rater:'A',reviewed:true,entries:[] }
const rep: LabelEntry = { kind:'cycle',startSec:0,bottomSec:1,topSec:2,status:'visible' }

describe('private manual video annotations', () => {
  it('exports compatible ordered bottom-return windows including visible short reps, bound to an anonymous filename and digest', () => {
    const entries = appendLabel([rep], {...rep,startSec:2,bottomSec:3,topSec:4,status:'short'}, 12)
    const result=makeLabelFile({...sample,entries})
    expect(result.clips[0]).toMatchObject({file:'P01-LP-01.webm',sha256:hash,windows:[[1,2],[3,4]],visualCycles:2})
    expect(readLabelFile(JSON.parse(JSON.stringify(result)),hash,12)).toEqual({...sample,entries})
    expect(validClipId('person/name')).toBe(false)
    expect(validClipId('')).toBe(false)
  })
  it('keeps drafts, uncertainty and excluded intervals out of event scoring and permits a reviewed zero-motion reference', () => {
    for(const session of [{...sample,reviewed:false}, {...sample,entries:[{...rep,status:'uncertain'}]}, {...sample,entries:[{kind:'excluded',startSec:0,endSec:1,reason:'occluded'}]}] as LabelSession[]){
      expect(makeLabelFile(session).clips[0].windows).toBeNull()
    }
    expect(makeLabelFile(sample).clips[0].windows).toEqual([])
    expect(makeLabelFile(sample).clips[0].visualCycles).toBe(0)
  })
  it('rejects wrong clips, invalid timings, overlapping entries, reordered markers and malformed statuses', () => {
    expect(()=>appendLabel([rep],rep,12)).toThrow()
    expect(()=>appendLabel([],{...rep,bottomSec:0},12)).toThrow()
    expect(()=>appendLabel([],{...rep,topSec:13},12)).toThrow()
    expect(()=>appendLabel([],{...rep,startSec:NaN},12)).toThrow()
    const file=makeLabelFile({...sample,entries:[rep]})
    expect(()=>readLabelFile(file,'b'.repeat(64),12)).toThrow()
    expect(()=>readLabelFile(file,hash,10)).toThrow()
    const invalid=structuredClone(file)
    Object.assign(invalid.clips[0].annotations[0],{status:'other'})
    expect(()=>readLabelFile(invalid,hash,12)).toThrow()
  })
})
