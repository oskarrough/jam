// Two headless browsers, one with its clock skewed by +5s, over a server with simulated latency.
// Checks: presence, clock agreement on the shared beat, quantized edit landing on the same bar for both.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright') // global install ok, or npm i -D playwright

const PORT = 8799, LAG = Number(process.env.LAG ?? 40), SKEW = 5000
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT, LAG }, stdio: 'inherit' })
await new Promise((r) => setTimeout(r, 400))

const browser = await chromium.launch()
const open = async (name, lane, skew = 0) => {
	const page = await (await browser.newContext()).newPage()
	if (skew) await page.addInitScript((s) => { const o = performance.timeOrigin + s; Object.defineProperty(performance, 'timeOrigin', { get: () => o }) }, skew)
	page.on('pageerror', (e) => console.error(name, e))
	await page.goto(`http://localhost:${PORT}/?name=${name}&lane=${lane}`)
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

await b.screenshot({ path: process.env.SHOT || '/tmp/roughjam-sync.png' })
await browser.close()
server.kill()
console.log(fails.length ? `\n${fails.length} failed` : '\nall passed')
process.exit(fails.length ? 1 : 0)
