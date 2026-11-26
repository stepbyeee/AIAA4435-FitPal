import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { LiveTrends } from './LiveTrends'
import { RepTimingChart, timingPath } from './RepTimingChart'
import { DEFAULT_PLAN } from './plan'
import type { RepMetrics } from '../analytics/motion'

const rep: RepMetrics = {repIndex:0,sourceStartMs:0,durationMs:4000,verified:true,range:1,outboundMs:1000,returnMs:3000,bottomHoldMs:500,minAngle:60,maxAngle:160,excursionDeg:100,bilateralLagMs:null,bilateralReason:'',pairedCoverage:0}
it('replaces duplicated angle/rate tiles with separate live and completed-repetition charts',()=>{
 const html=renderToStaticMarkup(<LiveTrends active samples={[]} reps={[rep]} plan={DEFAULT_PLAN} limb="arm" calibrated />)
 for(const name of ['动作幅度','上身前后倾','每一下用时','整次用时','查看分段','下拉至最低点','最低点后还原','底部附近用时'])expect(html).toContain(name)
 for(const name of ['左侧关节角','右侧关节角','角度变化','最近一次还原'])expect(html).not.toContain(name)
 expect(html).toContain('已包含在整次');expect(html).not.toContain('<details open');expect(html).toContain('4.00');expect(html).toContain('3.00')
})
it('does not display stale continuous paths while preserving clearly completed timing',()=>{
 const html=renderToStaticMarkup(<LiveTrends active={false} samples={[{atMs:0,range:.73,tilt:12,rangeBreak:false,tiltBreak:false}]} reps={[rep]} plan={DEFAULT_PLAN} limb="arm" calibrated />)
 expect(html).toContain('等待清晰画面');expect(html).not.toContain('73%');expect(html).toContain('4.00')
})
it('leaves absent timing as a gap instead of zero or a connecting line',()=>{
 const reps=[rep,{...rep,repIndex:1,verified:false,outboundMs:null,returnMs:null,bottomHoldMs:null},{...rep,repIndex:2}]
 expect(timingPath(reps,'returnMs',300,80,5000).match(/M/g)?.length).toBe(2)
 const html=renderToStaticMarkup(<RepTimingChart reps={reps} plan={DEFAULT_PLAN} limb="arm" />)
 expect(html).toContain('第 2 下');expect(html).toContain('计时不足');expect(html).not.toMatch(/NaN|Infinity/)
})
it('does not create a timing value before a complete measured repetition or rename squats as pulldowns',()=>{
 const html=renderToStaticMarkup(<LiveTrends active samples={[]} reps={[]} plan={DEFAULT_PLAN} limb="leg" calibrated />)
 expect(html).toContain('完成一下后');expect(html).not.toContain('上身前后倾');expect(html).not.toContain('下拉至最低点')
 expect(html).toContain('下蹲至最低点')
})

it('keeps the primary curve about the whole repetition only',()=>{
 const html=renderToStaticMarkup(<RepTimingChart reps={[rep]} plan={DEFAULT_PLAN} limb="arm" />)
 const svg=html.slice(html.indexOf('<svg'),html.indexOf('</svg>'))
 expect(svg).toContain('data-series="durationMs"');expect(svg).not.toContain('data-series="returnMs"')
 expect(html).toContain('识别到下拉至确认返回');expect(html).toContain('4.00')
})
