import { useState } from 'react'
import { average, summarize } from '../study/summarize'

const show = (x:number|null) => x === null ? '—' : x.toFixed(2)

export function StudySummary() {
  const [report, setReport] = useState<ReturnType<typeof summarize> | null>(null)
  async function run(files: FileList | null) {
    if (!files?.length) return
    const records = await Promise.all(Array.from(files, async file => {
      try { return JSON.parse(await file.text()) as unknown } catch { return null }
    }))
    setReport(summarize(records))
  }
  return <details className="study-summary">
    <summary>汇总已导出的课堂评分</summary>
    <p>一次选择本次试测的全部 JSON 文件。结果仅显示在本页，按参与者配对计算。</p>
    <label>选择评分文件<input type="file" multiple accept=".json,application/json" onChange={e=>void run(e.target.files)} /></label>
    {report && <section aria-live="polite"><h3>可比较的参与者 {report.usable.length} 人</h3>
      <p>录像预演 {report.rehearsals} 份 · 无效文件 {report.invalid} 份 · 摄像头记录中实际提示为零 {report.noCue} 份</p>
      {report.excluded.map(p=><p key={p.id}>编号 {p.id} 未纳入 · {p.reason}</p>)}
      {report.usable.length > 0 && <>
        <dl>
          <dt>打断感差值 · 组后减逐次</dt><dd>{show(average(report.usable.map(p=>p.interruption)))}</dd>
          <dt>目标清晰度差值 · 关节卡减文字</dt><dd>{show(average(report.usable.map(p=>p.clarity)))}</dd>
          <dt>理解所需精力差值 · 关节卡减文字</dt><dd>{show(average(report.usable.map(p=>p.effort)))}</dd>
          {(['visible','hidden'] as const).map(arm=>{
            const people = report.usable.filter(p=>p.growth===arm)
            return <div key={arm}><dt>继续训练意愿 · {arm === 'visible' ? '显示' : '隐藏'} EXP（{people.length} 人）</dt>
              <dd>{show(average(people.map(p=>p.motivation)))}</dd></div>
          })}
        </dl>
        <p>分数来自 1–7 分量表，每人权重相同。打断感差值为负，表示组后提示的平均打断感较低。</p>
      </>}
    </section>}
  </details>
}
