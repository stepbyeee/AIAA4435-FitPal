import { expect, it } from 'vitest'
import { assignmentFor, type Period } from './assignment'
import { summarize } from './summarize'

const rows = ([1,2,3,4] as Period[]).map(period => {
  const {condition,growth} = assignmentFor(1,period)
  const [timing,format] = condition.split('-')
  return {schema:1, source:'camera', exercise:'lat-pulldown', participant:1, period, growth, condition:{timing,format},
    cuesShown:period===2?0:1, ratings:{interruption:timing==='rep'?6:3, clarity:format==='card'?6:4, effort:3, motivation:period+2}}
})

it('compares complete camera trials within each participant and excludes rehearsals', () => {
  const result = summarize([...rows, {...rows[0],source:'recording'},null,{...rows[0],ratings:{}}])
  expect(result.usable).toEqual([{id:1,growth:'visible',interruption:-3,clarity:2,effort:0,motivation:4.5}])
  expect([result.invalid,result.rehearsals,result.noCue]).toEqual([2,1,1])
})
it('keeps problematic groups visible without selecting a replacement or scoring missing periods', () => {
  for (const input of [rows.slice(1), [...rows,rows[0]], rows.map((r,i)=>i? r:{...r,growth:'hidden'}),
    rows.map((r,i)=>i?r:{...r,condition:rows[1].condition})]) {
    const result = summarize(input)
    expect(result.usable).toEqual([])
    expect(result.excluded[0].id).toBe(1)
  }
})
