// pnpm perf [-- --zoom] [--desktop] [--quick]: main-thread JS per frame on a phone viewport, split by loop (view = dial, heart = splats).
// Headless draws WebGL in software, so frame rate here says little; the JS cost per frame is what taps wait behind.
import { serve, playwright } from './lib/browser.js'

const zoom = process.argv.includes('--zoom'),
	desktop = process.argv.includes('--desktop'),
	[warm, sample] = process.argv.includes('--quick') ? [1500, 2000] : [6000, 4000]
const srv = await serve()
const pw = playwright()
const browser = await pw.chromium.launch()
try {
	const ctx = await browser.newContext(
		desktop ? { viewport: { width: 1280, height: 860 } } : { ...pw.devices['iPhone 13'] },
	)
	await ctx.addInitScript(() => {
		const raf = window.requestAnimationFrame.bind(window),
			ms = (window.__ms = {}),
			names = new WeakMap()
		window.requestAnimationFrame = (cb) => {
			if (!names.has(cb)) {
				const src = cb.toString()
				names.set(
					cb,
					src.includes('introTick')
						? 'view'
						: src.includes('geom()')
							? 'heart'
							: src.includes('previewTick')
								? 'preview'
								: null,
				)
			}
			const k = names.get(cb)
			if (!k) return raf(cb)
			return raf((t) => {
				const a = performance.now()
				cb(t)
				;(ms[k] ||= []).push(performance.now() - a)
			})
		}
	})
	const page = await ctx.newPage()
	await page.goto(`${srv.url}/?ws=off`)
	await page.waitForFunction(() => window.jam)
	await page.click('#sound')
	await page.evaluate((zoom) => {
		const { engine, registry, view } = window.jam
		for (const [i, id] of ['tide', 'bass', 'bell', 'drums'].entries())
			engine.setInstrument(engine.seats[i], id, { state: registry.get(id).sample(engine.steps()) })
		if (zoom) view.setFocus(0)
	}, zoom)
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
