// Two headless browsers, one with its clock skewed by +5s, over a server with simulated latency.
// Checks: presence, clock agreement on the shared beat, quantized edit landing on the same bar for both.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright') // global install ok, or npm i -D playwright

const PORT = 8799, LAG = Number(process.env.LAG ?? 40), SKEW = 5000
// BASE=http://localhost:8787 tests an already-running relay (e.g. `wrangler dev`) instead of spawning server.js.
const BASE = process.env.BASE || `http://localhost:${PORT}`
const server = process.env.BASE ? null : spawn('node', [new URL('server.js', import.meta.url).pathname], { env: { ...process.env, PORT, LAG }, stdio: 'inherit' })
await new Promise((r) => setTimeout(r, 400))

const browser = await chromium.launch()
const open = async (name, lane, skew = 0) => {
	const page = await (await browser.newContext()).newPage()
	if (skew) await page.addInitScript((s) => { const o = performance.timeOrigin + s; Object.defineProperty(performance, 'timeOrigin', { get: () => o }) }, skew)
	page.on('pageerror', (e) => console.error(name, e))
	await page.goto(`${BASE}/sync/?name=${name}&lane=${lane}&room=test${process.pid}`)
	return page
}
const a = await open('alice', 'bass')
const b = await open('bob', 'drums', SKEW)
await new Promise((r) => setTimeout(r, 2500))

const fails = []
const check = (ok, msg) => (console.log(ok ? 'ok  ' : 'FAIL', msg), ok || fails.push(msg))

const da = await a.evaluate(() => jam.debug()), db = await b.evaluate(() => jam.debug())
console.log('alice', da, '\nbob  ', db)
check(da.peers === 2 && db.peers === 2, 'both see 2 peers')
check(Math.abs(db.offset + SKEW - da.offset) < 15, `bob's offset recovers his ${SKEW}ms skew (Δ ${(db.offset + SKEW - da.offset).toFixed(1)}ms)`)

// Sample both clocks at the "same" wall instant: ask each for server-now relative to its own local reading.
// Bob's Date.now() is real but his timeOrigin is fake, so (estimated server now − real now) should match Alice's.
const [ta, tb] = await Promise.all([a, b].map((p) => p.evaluate(() => jam.clock.now() - Date.now())))
check(Math.abs(ta - tb) < 20, `server-clock estimate agrees across peers (Δ ${(ta - tb).toFixed(1)}ms)`)

const at = await a.evaluate(() => jam.edit('bass', [0, -1, 2, -1, 4, -1, 2, -1, 0, -1, 2, -1, 4, -1, 7, -1]))
const barCheck = await b.evaluate((at) => { const c = jam.clock, p = c.pos(at + 0.5); return { bar: p.beats / p.loop.beatsPerBar } }, at)
check(Math.abs(barCheck.bar - Math.round(barCheck.bar)) < 0.01, `edit 'at' is a bar boundary (bar ${barCheck.bar.toFixed(3)})`)
const before = await b.evaluate(() => jam.laneAt('bass'))
check(before === undefined, 'bob does not have the edit before the bar')
const wait = at - (await a.evaluate(() => jam.clock.now())) + 100
await new Promise((r) => setTimeout(r, wait))
const [la, lb] = await Promise.all([a, b].map((p) => p.evaluate(() => JSON.stringify(jam.laneAt('bass')))))
check(la === lb && la !== undefined, `both play the same bass pattern after the bar (waited ${wait.toFixed(0)}ms)`)

// Tempo change lands on the next loop boundary for both.
await a.evaluate(() => jam.setLoop({ bpm: 120 }))
await new Promise((r) => setTimeout(r, 500))
const loops = await Promise.all([a, b].map((p) => p.evaluate(() => { const c = jam.clock, f = c.nextLoop(c.now() + 20000); return c.loopAt(f).bpm })))
check(loops[0] === 120 && loops[1] === 120, 'tempo change scheduled on both')

// Late joiner gets state.
const c = await open('carol', 'lead')
await new Promise((r) => setTimeout(r, 800))
check((await c.evaluate(() => JSON.stringify(jam.laneAt('bass')))) === la, 'late joiner gets current lanes')

// The real jam page (repo root) on the network transport.
const wsUrl = BASE.replace(/^http/, 'ws')
const jamPage = async (name, path) => {
	const p = await (await browser.newContext()).newPage()
	p.on('pageerror', (e) => console.error(name, e))
	await p.goto(`${BASE}${path}?name=${name}`) // no ?ws: the page finds the same-origin relay itself
	return p
}
const peersText = (p) => p.evaluate(() => [document.getElementById('peers')?.textContent, document.getElementById('jamline')?.textContent])
const jam = `/j/t${process.pid}-jam`
const j1 = await jamPage('dora', jam), j2 = await jamPage('eli', jam), j3 = await jamPage('fay', '/')
await new Promise((r) => setTimeout(r, 2500))
const seen = await Promise.all([j1, j2, j3].map(peersText))
console.log('jam pages:', seen)
check(/eli/.test(seen[0][0]) && /you/.test(seen[0][0]) && /dora/.test(seen[1][0]) && /you/.test(seen[1][0]), `private jam ${jam} auto-joins the relay: dora and eli see each other`)
check(!/dora|eli/.test(seen[2][0] || '') && /open jam/.test(seen[2][1]), 'the open jam at / is a different room')
check(new RegExp(jam.slice(3)).test(seen[0][1]), 'jam line names the private jam')
const redirect = await fetch(`${BASE}${jam}/`, { redirect: 'manual' })
check(redirect.status === 301, '/j/<jam>/ redirects to /j/<jam>')
if (process.env.SHOT) await j2.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-jam.png') })

await b.screenshot({ path: process.env.SHOT || '/tmp/roughjam-sync.png' })
await browser.close()
server?.kill()
console.log(fails.length ? `\n${fails.length} failed` : '\nall passed')
process.exit(fails.length ? 1 : 0)
