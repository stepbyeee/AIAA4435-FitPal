// Run the same shipped demos in isolated browser engines. All sources and models are local.
import { chromium, firefox, webkit } from 'playwright'
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
const {values} = parseArgs({options:{engines:{type:'string',default:'webkit,firefox'},output:{type:'string'}}})
if (!values.output) throw Error('Supply --output REPORT.json')
const base = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190')
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw Error('Use the local FitPal site')
const engines = { chromium, firefox, webkit }
const report = {method:'Ordinary 1× browser playback of both bundled files with real local Pose Landmarker Full. Separate pages, no webcam and no user history. A count mismatch is retained. Playwright WebKit is not the Safari application.',runs:[]}
for (const key of values.engines.split(',')) {
  if (!(key in engines)) throw Error('Unsupported engine: '+key)
  const record = {engine:key,cases:[]}
  report.runs.push(record)
  let browser
  try {
    browser = await engines[key].launch(key==='chromium' ? {executablePath:process.env.FITPAL_CHROME} : {})
    record.version=browser.version()
    for(const test of [{clip:'goblet-squat',exercise:'squat',reference:2},{clip:'go4it-rear',exercise:'lat-pulldown',reference:4}]) {
      const page = await browser.newPage()
      const errors=[], externalRequests=[]
      await page.addInitScript(() => {
        window.blockedByApp = new Set()
        window.addEventListener('securitypolicyviolation', event => {
          if(event.effectiveDirective === 'connect-src') window.blockedByApp.add(event.blockedURI)
        })
      })
      await page.route(/^https?:/, route => {
        if(new URL(route.request().url()).origin === base.origin) return route.continue()
        externalRequests.push(route.request().url())
        return route.abort()
      })
      page.on('pageerror',e=>errors.push(e.message))
      page.on('console',msg=>{ if(msg.type()==='warning' && msg.text().includes('Pose tracking is unavailable')) errors.push(msg.text().slice(0,240)) })
      try {
        await page.goto(base.origin+'/?video='+test.clip+'#/session/'+test.exercise)
        await page.waitForFunction(()=>Boolean(document.querySelector('.set-review-stage')) ||
          document.body.innerText.includes('录像已结束。校准需要') || document.querySelector('.live-instruction')?.textContent.includes('失败'),null,{timeout:65000})
        const observed=await page.evaluate(()=>({
          attempted:document.querySelectorAll('.review-choices button').length,
          verified:document.querySelectorAll('.review-choices button[data-status="met"], .review-choices button[data-status="short"]').length,
          outcome:document.querySelector('.say')?.textContent ?? document.querySelector('.live-instruction')?.textContent,
          persistentHistory:localStorage.getItem('fitpal.history.v3')!==null,
          blockedByApp:[...window.blockedByApp],
        }))
        record.cases.push({...test,...observed,errors,externalRequests})
      }catch(e) {
        const text=await page.locator('body').innerText({timeout:3000}).catch(()=>null)
        record.cases.push({...test,error:String(e),message:text?.slice(-420),errors})
      }finally {await page.close()}
      await writeFile(values.output,JSON.stringify(report,null,2)+'\n')
      console.log(key,JSON.stringify(record.cases.at(-1)))
    }
  }catch(e){ record.error=String(e).slice(0,400); console.error(key,record.error) }
  finally {await browser?.close();await writeFile(values.output,JSON.stringify(report,null,2)+'\n')}
}
if(report.runs.some(r=>r.error || r.cases.some(t=>t.error || !t.verified || t.persistentHistory || t.externalRequests?.length))) process.exitCode=1
