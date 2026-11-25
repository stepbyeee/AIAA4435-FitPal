import { assignmentFor, parseGrowth, type Period } from './assignment'
import { parseCondition, type Ratings } from './pilot'

type Row = {
  participant: number
  period: Period
  growth: 'visible' | 'hidden'
  timing: 'rep' | 'set'
  format: 'text' | 'card'
  ratings: Ratings
  cues: number
}
const questions = ['interruption', 'effort', 'clarity', 'motivation'] as const
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
function readRecord(input: unknown): Row | 'rehearsal' | 'invalid' {
  if (!isObject(input) || input.schema !== 1 || input.exercise !== 'lat-pulldown') return 'invalid'
  if (input.source === 'recording') return 'rehearsal'
  if (input.source !== 'camera' || !integer(input.participant, 1, 99) || !integer(input.period, 1, 4)
      || !isObject(input.condition) || !isObject(input.ratings) || !integer(input.cuesShown, 0, Number.MAX_SAFE_INTEGER)) return 'invalid'
  const condition = parseCondition(String(input.condition.timing) + '-' + String(input.condition.format))
  const growth = parseGrowth(typeof input.growth === 'string' ? input.growth : null)
  if (!condition || !growth) return 'invalid'
  const ratings = {} as Ratings
  for (const question of questions) {
    const score = input.ratings[question]
    if (!integer(score, 1, 7)) return 'invalid'
    ratings[question] = score
  }
  return { participant:input.participant, period:input.period as Period, growth, ...condition, ratings, cues:input.cuesShown }
}

export const average = (xs: number[]) => xs.length ? xs.reduce((a,b) => a+b, 0)/xs.length : null
export function summarize(input: readonly unknown[]) {
  let rehearsals = 0, invalid = 0, noCue = 0
  const people = new Map<number, Row[]>()
  for (const value of input) {
    const row = readRecord(value)
    if (row === 'rehearsal') { rehearsals++; continue }
    if (row === 'invalid') { invalid++; continue }
    if (row.cues === 0) noCue++
    const records = people.get(row.participant) ?? []
    records.push(row)
    people.set(row.participant, records)
  }
  const usable: {id:number; interruption:number; effort:number; clarity:number; motivation:number; growth:Row['growth']}[] = []
  const excluded: {id:number; reason:string}[] = []
  for (const [id, rows] of [...people].sort(([a],[b]) => a-b)) {
    const periods = new Set(rows.map(r => r.period))
    let reason = ''
    if (rows.length !== periods.size) reason = '轮次有重复，请选定正式记录'
    else if (periods.size !== 4) reason = '缺少轮次'
    else if (new Set(rows.map(r=>r.growth)).size !== 1) reason = '四轮 EXP 设置不同'
    else if (rows.some(r=>assignmentFor(id,r.period).condition !== r.timing + '-' + r.format)) reason = '条件与分配顺序不符'
    if (reason) { excluded.push({id,reason}); continue }
    const pair = (field:keyof Ratings, factor:'timing'|'format', a:string, b:string) =>
      average(rows.filter(r=>r[factor]===a).map(r=>r.ratings[field]))! - average(rows.filter(r=>r[factor]===b).map(r=>r.ratings[field]))!
    usable.push({id, growth:rows[0].growth, interruption:pair('interruption','timing','set','rep'),
      effort:pair('effort','format','card','text'), clarity:pair('clarity','format','card','text'),
      motivation:average(rows.map(r=>r.ratings.motivation))!})
  }
  return { usable, excluded, invalid, rehearsals, noCue }
}
