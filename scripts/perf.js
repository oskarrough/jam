// pnpm perf [-- --zoom] [--quick]: main-thread JS per frame on a phone viewport, split by loop (view = dial, heart = splats).
// Headless draws WebGL in software, so frame rate here says little; the JS cost per frame is what taps wait behind.
import { serve, playwright } from './lib/browser.js'

const zoom = process.argv.includes('--zoom'),
	[warm, sample] = process.argv.includes('--quick') ? [1500, 2000] : [6000, 4000]
const srv = await serve()
const pw = playwright()
const browser = await pw.chromium.launch()
try {
	const ctx = await browser.newContext({ ...pw.devices['iPhone 13'] })
	await ctx.addInitScript(() => {
		const raf = window.requestAnimationFrame.bind(window),
			ms = (window.__ms = {})
		window.requestAnimationFrame = (cb) =>
			raf((t) => {
				const a = performance.now()
				cb(t)
				const src = cb.toString(),
					k = src.includes('introTick') ? 'view' : src.includes('geom()') ? 'heart' : null
				if (k) (ms[k] ||= []).push(performance.now() - a)
			})
	})
	const page = await ctx.newPage()
	await page.goto(`${srv.url}/?ws=off`)
	await page.waitForFunction(() => window.jam)
	await page.touchscreen.tap(30, 30)
	if (zoom) await page.evaluate(() => window.jam.view.setFocus(Math.max(0, window.jam.me.seat)))
	await page.waitForTimeout(warm)
	await page.evaluate(() => Object.keys(window.__ms).forEach((k) => (window.__ms[k] = [])))
	await page.waitForTimeout(sample)
	const out = await page.evaluate(() =>
		Object.entries(window.__ms).map(([k, a]) => {
			a.sort((x, y) => x - y)
			const q = (p) => a[Math.floor(a.length * p)].toFixed(1)
			return `${k.padEnd(6)} median ${q(0.5)} ms  p90 ${q(0.9)} ms  (${a.length} frames)`
		}),
	)
	console.log(out.join('\n'))
} finally {
	await browser.close()
	srv.close()
}
