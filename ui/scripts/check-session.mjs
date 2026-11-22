// Exercises the rendered app with the real local model. Start Vite or its production preview first.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  artifacts: { type: 'string' }, repeat: { type: 'string', default: '1' },
  only: { type: 'string' }, camera: { type: 'string' }, fixtures: { type: 'boolean' },
} })
const browserModule = process.env.FITPAL_PLAYWRIGHT
const { chromium } = await import(browserModule ? pathToFileURL(resolve(browserModule)).href : 'playwright')
const origin = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190').origin
const output = values.artifacts && resolve(values.artifacts)
if (output) await mkdir(output, { recursive: true })
const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
if (values.camera) args.push('--use-file-for-fake-video-capture=' + resolve(values.camera))
const browser = await chromium.launch({ executablePath: process.env.FITPAL_CHROME, args })
const results = []

async function run(name, scenario) {
  if (values.only && !values.only.split(',').includes(name)) return
  const started = Date.now()
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true, reducedMotion: 'reduce' })
  if (values.fixtures) {
    for (const file of ['pulldown.webm','pulldown-mistakes.webm']) {
      await context.route(origin + '/demo/' + file, route => route.fulfill({
        path:resolve('public/demo',file),contentType:'video/webm',
      }))
    }
  }
  const page = await context.newPage()
  const faults = []
  page.on('pageerror', e => faults.push(e.message))
  await page.addInitScript(() => {
    window.fitpalTiming = []
    const nextFrame = HTMLVideoElement.prototype.requestVideoFrameCallback
    if (!nextFrame) return
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (cb) {
      return nextFrame.call(this, function(now, meta) {
        const start = performance.now()
        cb(now, meta)
        requestAnimationFrame(() => window.fitpalTiming.push(performance.now() - start))
      })
    }
  })
  try {
    await scenario(page)
    assert.deepEqual(faults, [])
    const timing = (await page.evaluate(() => window.fitpalTiming)).sort((a,b) => a-b)
    const entry = { name, pass: true, seconds: (Date.now()-started)/1000, frames: timing.length,
      callbackToNextAnimationFrameP95ms: timing.length ? Math.round(timing[Math.floor(timing.length*.95)] * 10)/10 : null }
    results.push(entry)
    console.log(JSON.stringify(entry))
  } catch (e) {
    const entry = { name, pass: false, error: String(e), faults, screen: (await page.locator('body').innerText()).slice(-650) }
    console.error(JSON.stringify(entry))
    results.push(entry)
  } finally { await context.close() }
}

const openUrl = (page, params, id = 'lat-pulldown') => page.goto(origin + '/?' + params + '#/session/' + id)
const button = (page, name) => page.getByRole('button', { name, exact: true })
const expectVisible = (locator, timeout = 45000) => locator.waitFor({ state: 'visible', timeout })
const screenshot = async (page, filename) => { if (output) await page.screenshot({ path: join(output,filename) }) }
const noHistory = async page => assert.equal(await page.evaluate(() => localStorage.getItem('fitpal.history.v3')), null)
try {
  const repeat = Number(values.repeat)
  assert(Number.isInteger(repeat) && repeat > 0)
  for (let i=0; i<repeat; i++) {
    await run('overlay-side', async page => {
      await page.setViewportSize({width:390,height:844})
      await openUrl(page,'video=go4it-rear')
      const selector = page.getByLabel(/可用的身体侧/)
      await selector.selectOption('right')
      await button(page,'画中分析').click()
      await expectVisible(page.locator('.camera-stats .telemetry-chart'))
      await page.waitForFunction(() => document.querySelector('.arm-trail[data-side="right"]'))
      await expectVisible(page.getByText('已排除',{exact:true}))
      const observed = await page.evaluate(async () => {
        let left = 0, right = 0
        for(let n=0;n<24;n++){
          if(document.querySelector('.arm-trail[data-side="left"]')) left++
          if(document.querySelector('.arm-trail[data-side="right"]')) right++
          await new Promise(r=>setTimeout(r,100))
        }
        return {left,right, width:document.documentElement.scrollWidth}
      })
      assert.equal(observed.left,0)
      assert(observed.right>0)
      assert(observed.width<=390)
      await screenshot(page,'pulldown-mobile-overlay.png')
      await button(page,'训练').click()
      assert.equal(await page.locator('.camera-stats').count(),0)
    })
    await run('pulldown', async page => {
      await openUrl(page, 'video=pulldown')
      await expectVisible(page.getByRole('region', { name: '取景检查' }))
      await button(page,'训练').click()
      assert.equal(await page.getByRole('region', { name:'实时肘角' }).count(), 0)
      await button(page,'分析').click()
      await expectVisible(page.getByRole('region', { name:'实时肘角' }))
      await expectVisible(page.locator('.live-panel-heading h2', { hasText:'第 1 组' }))
      await screenshot(page,'pulldown-live.png')
      await expectVisible(page.getByText('这一组确认了 2 下。', { exact: true }))
      await button(page,'第 2 下，已达标').click()
      assert.match(await page.locator('.review-detail').innerText(), /第 2 下.*已达标/s)
      await page.getByText('查看这一组的动作依据').click()
      await screenshot(page,'pulldown-review.png')
      await noHistory(page)
    })
    await run('occlusion', async page => {
      await page.setViewportSize({ width:390, height:844 })
      await openUrl(page,'video=pulldown-mistakes')
      await expectVisible(page.locator(".arm-legend [data-side='right'][data-visible='true']"))
      await expectVisible(page.locator(".arm-legend [data-side='right'][data-visible='false']"))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),false)
      await expectVisible(page.getByText(/录像已结束。校准需要/))
      assert.equal(await page.locator('.rep-review').count(),0)
      await noHistory(page)
    })
    await run('local-import', async page => {
      await page.goto(origin)
      await page.getByText('录像回放', { exact:true }).click()
      await page.locator('input[type=file]').setInputFiles(resolve('public/demo/pulldown.webm'))
      await expectVisible(page.getByText('这一组确认了 2 下。'))
      assert.match(page.url(), /#\/review\/lat-pulldown$/)
      await noHistory(page)
      await button(page,'完成').click()
      await expectVisible(page.getByRole('heading', {name:'今天练什么'}))
      await page.goBack()
      await expectVisible(page.getByRole('heading', {name:'今天练什么'}))
      assert.equal(await page.locator('video').count(),0)
    })
    await run('exit-demo', async page => {
      for (const viaLogo of [false,true]) {
        await openUrl(page,'video=go4it-rear&focus=left&side=right')
        if (viaLogo) await page.getByRole('link',{name:'FitPal 首页'}).click()
        else await button(page,'返回首页').click()
        await expectVisible(page.getByRole('heading',{name:'今天练什么'}))
        for (const key of ['video','focus','side']) assert.equal(new URL(page.url()).searchParams.has(key),false)
        await page.getByRole('link',{name:'手动记录'}).first().click()
        assert(await button(page,'保存这一组').isEnabled())
        await page.getByRole('spinbutton').fill('7')
        await button(page,'保存这一组').click()
        await expectVisible(page.getByText('坐姿划船 · 7 下').first())
      }
    })
    await run('manual-history', async page => {
      await page.goto(origin)
      await page.getByRole('link',{name:'手动记录'}).first().click()
      await page.getByRole('spinbutton').fill('12')
      await button(page,'保存这一组').click()
      await expectVisible(page.getByText('坐姿划船 · 12 下'))
      await page.reload()
      await expectVisible(page.getByText('坐姿划船 · 12 下'))
      await noHistory(page)
    })
    await run('privacy', async page => {
      await page.goto(origin)
      await page.evaluate(() => {
        localStorage.setItem('fitpal.history.v2','[]')
        localStorage.setItem('fitpal.gear.v1','[]')
        localStorage.setItem('other-app','keep')
      })
      await page.getByRole('link',{name:'训练记录'}).click()
      await page.getByText('本机数据设置',{exact:true}).click()
      await page.getByRole('checkbox').uncheck()
      assert.equal(await page.evaluate(() => localStorage.getItem('fitpal.keep-summaries')),'off')
      await button(page,'清除本机进度').click()
      await button(page,'取消').click()
      assert.equal(await page.evaluate(() => localStorage.getItem('fitpal.history.v2')),'[]')
      await button(page,'清除本机进度').click()
      await Promise.all([page.waitForEvent('load'), button(page,'确认清除全部进度').click()])
      await page.waitForFunction(() => localStorage.getItem('fitpal.history.v2') === null)
      assert.equal(await page.evaluate(() => localStorage.getItem('other-app')),'keep')
      assert.equal(await page.evaluate(() => localStorage.getItem('fitpal.keep-summaries')),'off')
    })
    await run('label-back', async page => {
      await page.goto(origin + '/#/study')
      await page.getByRole('link', {name:'标注本地测试视频'}).click()
      await page.getByLabel('本地视频', {exact:true}).setInputFiles(resolve('public/demo/pulldown.webm'))
      await button(page, '标记起点').click()
      await expectVisible(button(page, '标记最低点'))
      const backWithPendingLabel = async (approve) => {
        const pending = page.waitForEvent('dialog', {timeout:5000})
        await page.evaluate(() => history.back())
        const dialog = await pending
        assert.equal(dialog.type(), 'confirm')
        if (approve) await dialog.accept()
        else await dialog.dismiss()
      }
      await backWithPendingLabel(false)
      await page.waitForURL(url => url.hash === '#/label')
      await expectVisible(page.getByText(/本条已标记/))
      await backWithPendingLabel(true)
      await expectVisible(page.getByRole('heading', {name:'课堂试测设置'}))
    })
    await run('camera-denied',async page => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Test denial','NotAllowedError'))
      })
      await page.goto(origin)
      await button(page,'开始深蹲').click()
      await expectVisible(page.getByText('摄像头未开启。开启权限后重试。'))
      await button(page,'重试').click()
      await expectVisible(page.getByText('摄像头未开启。开启权限后重试。'))
      await noHistory(page)
    })
    await run('pilot-summary', async page => {
      const records = ['rep-text','rep-card','set-card','set-text'].map((condition,index) => {
        const [timing,format] = condition.split('-')
        return {schema:1,source:'camera',exercise:'lat-pulldown',participant:1,period:index+1,growth:'visible',
          condition:{timing,format},cuesShown:1,ratings:{interruption:timing==='rep'?6:3,effort:4,clarity:5,motivation:6}}
      })
      await page.goto(origin + '/#/study')
      await page.getByText('汇总已导出的课堂评分',{exact:true}).click()
      await page.getByLabel('选择评分文件').setInputFiles([...records,{...records[0],source:'recording'}].map((row,i) =>
        ({name:'synthetic-'+i+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(row))})))
      await expectVisible(page.getByRole('heading',{name:'可比较的参与者 1 人'}))
      await expectVisible(page.getByText('-3.00',{exact:true}))
      await expectVisible(page.getByText(/录像预演 1 份/))
    })
    await run('facilitator', async page => {
      await page.goto(origin + '/#/study')
      await expectVisible(page.getByRole('heading',{name:'课堂试测设置'}))
      assert(await button(page,'开始第 1 轮').isDisabled())
      await page.getByLabel('匿名参与者编号').fill('2')
      await page.getByLabel('视频来源').selectOption('recording')
      await button(page,'开始第 1 轮').click()
      const params = new URL(page.url()).searchParams
      assert.equal(params.get('growth'),'hidden')
      await expectVisible(page.getByRole('heading',{name:'本轮体验'}), 65000)
      assert.equal(await page.getByText(/^\+\d+ EXP$/).count(),0)
      for (const select of await page.locator('.pilot-survey select').all()) await select.selectOption('5')
      const exported = page.waitForEvent('download')
      await button(page,'导出本轮记录').click()
      const saved = JSON.parse(await readFile(await (await exported).path(),'utf8'))
      assert.equal(saved.participant,2)
      assert.equal(saved.period,1)
      assert.equal(saved.growth,'hidden')
      assert(saved.attempts > 0)
      assert.equal(saved.events.length,saved.attempts)
      assert.equal(saved.cuesShown,saved.events.length)
      assert(saved.events.every(event => event.action === 'rep-cue'))
      assert.equal(saved.ratings.clarity,5)
      await noHistory(page)
    })
    for (const condition of ['rep-text','rep-card','set-text','set-card']) {
      await run(condition, async page => {
        await openUrl(page, 'video=pulldown&study=' + condition)
        const survey = page.getByRole('heading', {name:'本轮体验'})
        if (condition.startsWith('rep')) {
          await expectVisible(page.locator('.trial-cue'))
          assert.equal(await page.locator('.trial-cue .joint-target').count(),condition.endsWith('card') ? 1 : 0)
        }
        await expectVisible(survey)
        assert.equal(await page.locator('.joint-target').count(), condition === 'set-card' ? 1 : 0)
        assert.equal(await button(page,'导出本轮记录').isDisabled(), true)
        for (const select of await page.locator('.pilot-survey select').all()) await select.selectOption('4')
        const exported = page.waitForEvent('download')
        await button(page,'导出本轮记录').click()
        const report = JSON.parse(await readFile(await (await exported).path(),'utf8'))
        assert.equal(report.verified,2)
        assert.equal(report.cuesShown,condition.startsWith('rep') ? 2 : 1)
        assert.equal(report.source,'recording')
        await noHistory(page)
      })
    }
    if (values.camera) await run('opt-out', async page => {
      await page.goto(origin + '/#/history')
      await page.getByText('本机数据设置',{exact:true}).click()
      await page.getByRole('checkbox').uncheck()
      await page.getByRole('link',{name:'FitPal 首页'}).click()
      await button(page,'开始').click()
      await expectVisible(page.locator('.live-panel-heading h2',{hasText:'第 1 组'}))
      await page.waitForFunction(() => Number(document.querySelector('.count-now')?.textContent) > 0, null,{timeout:45000})
      await button(page,'结束这一组').click()
      await button(page,'结束本次训练').click()
      await expectVisible(page.getByRole('heading',{name:'今天练什么'}))
      await noHistory(page)
    })
    if (values.camera) await run('fake-camera', async page => {
      await page.addInitScript(() => {
        const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        window.testStreams = []
        navigator.mediaDevices.getUserMedia = async options => {
          const stream = await open(options)
          window.testStreams.push(stream)
          return stream
        }
      })
      await openUrl(page, '')
      for (let set=1; set<=3; set++) {
        await expectVisible(page.locator('.live-panel-heading h2', {hasText:`第 ${set} 组`}),65000)
        await page.waitForFunction(() => Number(document.querySelector('.count-now')?.textContent) > 0, null,{ timeout:55000 })
        if (set === 1) {
          const before = Number(await page.locator('.count-now').textContent())
          await button(page,'暂停训练').click()
          await expectVisible(page.getByText('摄像头已关闭'))
          await page.waitForFunction(() => window.testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))
          await button(page,'继续训练').click()
          await page.waitForFunction(() => window.testStreams.length >= 2 && window.testStreams.at(-1).active)
          assert.equal(Number(await page.locator('.count-now').textContent()),before)
        }
        await button(page,'结束这一组').click()
        await expectVisible(page.getByRole('region',{ name:'逐次动作回顾' }))
        assert(await page.evaluate(() => window.testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))))
        await page.waitForFunction(n => JSON.parse(localStorage.getItem('fitpal.history.v3'))?.at(-1).sets.length === n,set)
        if (set < 3) await button(page,`开始第 ${set+1} 组`).click()
      }
      await page.getByRole('combobox',{name:'选择训练组'}).selectOption('0')
      await expectVisible(page.getByRole('heading',{name:'第 1 组回顾'}))
      const history = await page.evaluate(() => JSON.parse(localStorage.getItem('fitpal.history.v3')))
      assert.equal(history.length,1)
      assert.equal(history[0].sets.length,3)
      assert(!/landmarks|samples|traces/.test(JSON.stringify(history)))
      await button(page,'完成').click()
      await page.getByRole('link',{name:'训练记录'}).click()
      await expectVisible(page.getByText(/3 组 · 共确认/))
    })
  }
} finally {
  await browser.close()
  if (output) await writeFile(join(output,'session-checks.json'), JSON.stringify(results,null,2) + '\n')
}
if (!results.length || results.some(r=>!r.pass)) process.exitCode=1
