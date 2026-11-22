// Run against the local Vite dev server and a loaded llama-server. No camera is opened.
import assert from 'node:assert/strict'
import { platform } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const origin = new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:5190')
if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw Error('Use a loopback FitPal URL')
const modulePath = process.env.FITPAL_PLAYWRIGHT
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright')
const executablePath = process.env.FITPAL_CHROME ?? (platform() === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
const browser = await chromium.launch({ executablePath, headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.goto(origin.origin)
  const rows = await page.evaluate(async () => {
    const { explainLocalCue } = await import('/src/feedback/localCoach.ts')
    const { settle } = await import('/src/feedback/settle.ts')
    const cases = [
      ['pulldown-one-short', 'lat-pulldown', [1, .72], 1, 'short_range'],
      ['squat-two-short', 'squat', [.69, .73, 1], .98, 'short_range'],
      ['occlusion-precedes-range', 'lat-pulldown', [.72, null], .85, 'out_of_view'],
      ['squat-no-visible-cycle', 'squat', [], .22, 'out_of_view'],
      ['clean-set', 'lat-pulldown', [.95, 1], 1, null],
    ]
    const rows = []
    for (const [name, exerciseId, depths, coverage, issue] of cases) {
      const reps = depths.map(depth => ({ status: depth === null ? 'cannot_verify' : 'verified', qMax: depth ?? 0, durationMs: 1500 }))
      const indexes = (test) => depths.flatMap((q, i) => test(q) ? [i] : [])
      const issues = [
        { id: 'short_range', repIndexes: indexes(q => q !== null && q < .85) },
        { id: 'out_of_view', repIndexes: indexes(q => q === null) },
      ].filter(item => item.repIndexes.length)
      const summary = { exerciseId, calibration: { thetaTop: 160, thetaBottom: 80 }, reps, coverage, issues }
      const result = settle(summary, null)
      const previous = JSON.stringify(result)
      const start = performance.now()
      let calls = 0
      let responseInfo
      const text = await explainLocalCue(summary, result, async (...args) => {
        calls++
        const response = await fetch(...args)
        const diagnostic = await response.clone().json()
        responseInfo = { status: response.status, output: diagnostic.choices?.[0]?.message, error: diagnostic.error }
        return response
      })
      const matched = (result.cue?.issueId ?? null) === issue && Boolean(text) === Boolean(issue)
        && calls === Number(Boolean(issue)) && JSON.stringify(result) === previous
      rows.push({ name, selectedIssue: issue, matched, calls, ...(matched ? {} : { responseInfo }), wallMs: Math.round(performance.now() - start), text })
    }
    return rows
  })
  let playback
  if (process.argv.includes('--blackout')) {
    let calls = 0
    const onRequest = req => {
      if (req.url() === 'http://127.0.0.1:5191/v1/chat/completions' && req.method() === 'POST') calls++
    }
    page.on('request', onRequest)
    await page.goto(origin.origin + '/?video=pulldown-test-blackout.mp4&coach=local#/session/lat-pulldown')
    const cue = page.locator('[data-cue-source="local-model"]')
    await cue.waitFor({ timeout: 60_000 })
    const missed = page.getByRole('button', { name: '第 1 下，未看清' })
    const clean = page.getByRole('button', { name: '第 2 下，已达标' })
    await missed.click()
    assert.equal(await page.locator('.review-bottom').count(), 0)
    const paths = await page.locator('.review-line').evaluateAll(lines => lines.map(line => line.getAttribute('d')))
    assert(paths.every(d => d.split('M').length >= 3), 'Both charts must break at occlusion')
    const text = await cue.innerText()
    assert.match(text, /没看清|中断/)
    if (process.env.FITPAL_COACH_SCREENSHOT) await page.screenshot({ path: process.env.FITPAL_COACH_SCREENSHOT })
    await clean.click()
    assert.equal(await page.locator('.review-bottom').count(), 2)
    assert.match(await page.locator('.gain').innerText(), /\+1\s*EXP/)
    assert.equal(calls, 1)
    assert.equal(await page.evaluate(() => localStorage.getItem('fitpal.history.v3')), null)
    playback = { source: 'original pulldown with 12.40–13.00s artificially blacked out',
      reviewOutcomes: ['cannot_verify', 'verified_in_range'], cuesRequested: calls, text, exp: 1, wroteHistory: false }
  }
  console.log(JSON.stringify({ fixture: 'synthetic post-set summaries', cases: rows, playback }, null, 2))
  if (rows.some(row => !row.matched)) process.exitCode = 1
} finally {
  await browser.close()
}
