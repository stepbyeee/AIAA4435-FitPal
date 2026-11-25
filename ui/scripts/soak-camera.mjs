// Start a production preview. Run with a Y4M exercise recording as the simulated webcam.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  camera: { type:'string' }, sessions: { type:'string', default:'12' }, output: { type:'string' },
} })
const count = Number(values.sessions)
if (!values.camera || !values.output || !Number.isInteger(count) || count < 1) throw Error('Pass --camera FILE.y4m --output REPORT.json [--sessions N]')
const { chromium } = await import(process.env.FITPAL_PLAYWRIGHT ? pathToFileURL(resolve(process.env.FITPAL_PLAYWRIGHT)).href : 'playwright')
const origin = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190')
if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) throw Error('Use the local app preview')
const browser = await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:[
  '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
  '--use-file-for-fake-video-capture=' + resolve(values.camera),
]})
const report = {exercise:'lat-pulldown', source:'looped Y4M through Chromium simulated camera', browser:browser.version(),
  requestedSessions:count, startedAt:new Date().toISOString(), sessions:[], errors:[]}
const save = () => writeFile(values.output, JSON.stringify(report,null,2) + '\n')
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(60000)
  page.on('pageerror', error => report.errors.push(error.message))
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    window.streamOpens = 0
    window.tracksForSet = []
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints)
      window.streamOpens++
      window.tracksForSet.push(...stream.getTracks())
      return stream
    }
  })
  await page.goto(origin.href)
  const devtools = await context.newCDPSession(page)
  await devtools.send('Performance.enable')
  for (let session=1; session<=count; session++) {
    const sets = []
    await page.getByRole('button',{name:'开始',exact:true}).click()
    for (let set=1; set<=3; set++) {
      await page.locator('.live-panel-heading h2',{hasText:`第 ${set} 组`}).waitFor()
      await page.waitForFunction(() => Number(document.querySelector('.count-now')?.textContent) >= 1, null, {timeout:45000})
      sets.push(Number(await page.locator('.count-now').textContent()))
      await page.getByRole('button',{name:'结束这一组'}).click()
      await page.getByRole('region',{name:'训练回顾'}).waitFor()
      await page.waitForFunction(() => window.tracksForSet.every(t=>t.readyState==='ended'))
      await page.evaluate(() => { window.tracksForSet = [] })
      if (set < 3) await page.getByRole('button',{name:`开始第 ${set+1} 组`}).click()
    }
    await page.getByRole('button',{name:'完成',exact:true}).click()
    await page.getByRole('heading',{name:'今天练什么'}).waitFor()
    const stored = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('fitpal.history.v3'))
      return {rows:data.length, last:data.at(-1).sets.map(s=>s.verified), opens:window.streamOpens}
    })
    assert.equal(stored.rows,session)
    assert.deepEqual(stored.last,sets)
    assert.equal(stored.opens,session*3)
    assert.deepEqual(report.errors,[])
    const { metrics } = await devtools.send('Performance.getMetrics')
    report.sessions.push({session,sets, cameraOpens:stored.opens, endedAt:new Date().toISOString(),
      jsHeapMB:Math.round(metrics.find(m=>m.name==='JSHeapUsedSize').value / 1048576)})
    await save()
    console.log(`Session ${session}/${count}: ${sets.join(',')}, ${stored.opens} camera streams released`)
  }
} catch (error) {
  report.errors.push(String(error))
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await browser.close()
  await save()
}
