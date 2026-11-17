// Shared by the check, shots and two-tabs scripts: a static server over the repo root and a headless Chromium.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { extname, join, normalize } from 'node:path'

export const ROOT = new URL('../..', import.meta.url).pathname
const TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.json': 'application/json',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json',
}

export function serve() {
	const server = createServer(async (req, res) => {
		let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
		if (p.endsWith('/')) p += 'index.html'
		try {
			res
				.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' })
				.end(await readFile(join(ROOT, p)))
		} catch {
			if (/^\/[jr]\//.test(p))
				return res
					.writeHead(200, { 'content-type': 'text/html' })
					.end(await readFile(join(ROOT, 'index.html')))
			res.writeHead(404).end()
		}
	})
	return new Promise((ok) =>
		server.listen(0, '127.0.0.1', () =>
			ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }),
		),
	)
}

export function playwright() {
	const req = createRequire(import.meta.url)
	try {
		return req('playwright')
	} catch {}
	try {
		return createRequire(join(execSync('npm root -g').toString().trim(), 'x'))('playwright')
	} catch {}
	console.error('needs Playwright: npm i -g playwright && npx playwright install chromium')
	process.exit(2)
}

// A page that records every uncaught error and console.error. Relay 404s are expected with ?ws=off.
// ready: wait for window.jam (the jam page); pass false for pages without it, like the lab.
export async function open(browser, url, { phone = false, ready = true, small = false, at = 0 } = {}) {
	const ctx = await browser.newContext(
		phone
			? { ...playwright().devices['iPhone 13'] }
			: { viewport: small ? { width: 720, height: 520 } : { width: 1280, height: 860 } },
	)
	// at: jump the page clock forward by this many ms (rAF timestamps and performance.now) to catch timed effects.
	if (at)
		await ctx.addInitScript((at) => {
			const raf = window.requestAnimationFrame.bind(window),
				now = performance.now.bind(performance)
			window.requestAnimationFrame = (cb) => raf((t) => cb(t + at))
			performance.now = () => now() + at
		}, at)
	const page = await ctx.newPage()
	page.errors = []
	page.on('pageerror', (e) => page.errors.push(e.stack || e.message))
	page.on('console', (m) => {
		if (m.type() === 'error' && !/404|WebSocket/.test(m.text())) page.errors.push(m.text())
	})
	await page.goto(url)
	if (ready) await page.waitForFunction(() => window.jam, null, { timeout: 10000 }).catch(() => {})
	return page
}

export async function play(page, id, { sheet = false } = {}) {
	await page.evaluate(
		({ id, sheet }) => {
			const { engine, registry, me, view } = window.jam
			if (me.seat < 0) me.seat = 0
			const L = engine.seats[me.seat],
				m = registry.get(id)
			engine.setInstrument(L, id, { state: (m.sample || m.generate)?.(engine.steps(), L.params) })
			view.setFocus(sheet ? me.seat : -1)
		},
		{ id, sheet },
	)
	await page
		.waitForFunction(
			(sheet) => {
				const v = window.jam.view
				return !v.moving && (sheet ? v.sheetShift === 0 : v.sheetShift === Infinity)
			},
			sheet,
			{ timeout: 5000 },
		)
		.catch(() => {})
	await page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	)
}
