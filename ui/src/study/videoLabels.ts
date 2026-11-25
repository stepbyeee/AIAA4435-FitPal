export type CycleStatus = 'visible' | 'short' | 'uncertain'
export type Exclusion = 'partial' | 'occluded' | 'cut'
export type Rater = 'A' | 'B' | 'consensus'
export type LabelEntry =
  | { kind:'cycle'; startSec:number; bottomSec:number; topSec:number; status:CycleStatus }
  | { kind:'excluded'; startSec:number; endSec:number; reason:Exclusion }
export type LabelSession = {
  id:string; extension:'mp4'|'webm'; exercise:'lat-pulldown'|'squat'; durationSec:number; sha256:string
  rater:Rater; reviewed:boolean; entries:LabelEntry[]
}
const schema = 'fitpal.manual-labels.v1'
export const validClipId = (id:string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(id)
export const endOf = (entry:LabelEntry) => entry.kind === 'cycle' ? entry.topSec : entry.endSec

function validEntry(entry:LabelEntry, previousEnd:number, duration:number) {
  const end = endOf(entry)
  if (![entry.startSec, end].every(Number.isFinite) || entry.startSec < previousEnd ||
    end <= entry.startSec || end > duration) throw Error('标记须按时间先后排列，位于片内，且不与上一段重叠。')
  if (entry.kind === 'cycle' && (!Number.isFinite(entry.bottomSec) || entry.bottomSec <= entry.startSec || entry.bottomSec >= end)) {
    throw Error('最低点须位于起点和返回点之间。')
  }
}

export function appendLabel(entries:LabelEntry[], entry:LabelEntry, duration:number): LabelEntry[] {
  validEntry(entry, entries.length ? endOf(entries[entries.length-1]) : 0, duration)
  return [...entries,entry]
}

export function makeLabelFile(s:LabelSession) {
  if (!validClipId(s.id)) throw Error('请填写由字母、数字、短横线或下划线组成的匿名编号。')
  if (!Number.isFinite(s.durationSec) || s.durationSec <= 0 || !/^[a-f0-9]{64}$/.test(s.sha256)) throw Error('视频尚未就绪。')
  let previousEnd = 0
  for (const e of s.entries) { validEntry(e, previousEnd, s.durationSec); previousEnd = endOf(e) }
  // The existing scorer assumes complete references and reserves its first three cycles for calibration.
  const eligible = s.reviewed && s.entries.every(e=>e.kind === 'cycle' && e.status !== 'uncertain')
  const windows = eligible ? s.entries.flatMap(e=>e.kind === 'cycle' ? [[e.bottomSec,e.topSec]] : []) : null
  return {
    schema, clips:[{file:s.id+'.'+s.extension, exercise:s.exercise, appDemo:false, sha256:s.sha256, durationSec:s.durationSec,
      rater:s.rater, reviewed:s.reviewed, annotations:s.entries, windows, visualCycles:windows?.length ?? null}],
  }
}

function object(value:unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('标注 JSON 结构不正确。')
  return value as Record<string,unknown>
}
function parseEntry(raw:unknown): LabelEntry {
  const e=object(raw)
  if (typeof e.startSec !== 'number') throw Error('缺少起点时间。')
  if (e.kind === 'cycle' && typeof e.bottomSec === 'number' && typeof e.topSec === 'number' &&
      (e.status === 'visible' || e.status === 'short' || e.status === 'uncertain')) {
    return {kind:e.kind,startSec:e.startSec,bottomSec:e.bottomSec,topSec:e.topSec,status:e.status}
  }
  if (e.kind === 'excluded' && typeof e.endSec === 'number' && (e.reason === 'partial' || e.reason === 'occluded' || e.reason === 'cut')) {
    return {kind:e.kind,startSec:e.startSec,endSec:e.endSec,reason:e.reason}
  }
  throw Error('发现未知的标记类型、状态或时间。')
}

export function readLabelFile(raw:unknown, digest:string, duration:number): LabelSession {
  const doc = object(raw)
  if (doc.schema !== schema || !Array.isArray(doc.clips) || doc.clips.length !== 1) throw Error('请选择 FitPal 导出的一段视频的标注 JSON。')
  const c=object(doc.clips[0])
  if (c.sha256 !== digest || typeof c.durationSec !== 'number' || Math.abs(c.durationSec-duration) > 0.05) throw Error('这份标注与当前视频的内容或时长不符。')
  const file = typeof c.file === 'string' && /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,47})\.(mp4|webm)$/.exec(c.file)
  if (!file || !Array.isArray(c.annotations) || typeof c.reviewed !== 'boolean' ||
    (c.exercise !== 'lat-pulldown' && c.exercise !== 'squat') || (c.rater !== 'A' && c.rater !== 'B' && c.rater !== 'consensus')) {
    throw Error('匿名编号、动作、标注者或标记列表不完整。')
  }
  const session:LabelSession = {id:file[1],extension:file[2] === 'webm' ? 'webm' : 'mp4',sha256:digest,durationSec:duration,
    exercise:c.exercise,rater:c.rater,reviewed:c.reviewed,entries:c.annotations.map(parseEntry)}
  makeLabelFile(session)
  return session
}
