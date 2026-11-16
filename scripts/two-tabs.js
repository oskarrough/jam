// npm run two-tabs: two players in one browser (the local transport, no relay). Each takes a seat, one draws,
// the other must receive it on the next bar. Exits non-zero if they don't see each other or the edit.
import { serve, playwright, open, play } from './lib/browser.js'

const srv = await serve()
const browser = await playwright().chromium.launch()
let ok = true
try {
	// one context, so both pages share a BroadcastChannel like two tabs do
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
	const tab = async (name) => {
		const p = await ctx.newPage(); p.errors = []
		p.on('pageerror', (e) => p.errors.push(e.message))
		await p.goto(`${srv.url}/?ws=off&name=${name}`); await p.waitForFunction(() => window.jam)
		await p.waitForTimeout(800); return p
	}
	const a = await tab('ana'), b = await tab('ben')
	await a.click('#sound'); await b.click('#sound')
	const seats = await Promise.all([a, b].map((p) => p.evaluate(() => window.jam.me.seat)))
	const peers = await b.evaluate(() => window.jam.transport.peers.map((p) => p.name))
	const check = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); ok &&= c }
	check(seats[0] >= 0 && seats[1] >= 0 && seats[0] !== seats[1], `two seats (${seats})`)
	check(peers.includes('ana'), `ben sees ana (${peers})`)
	// ana draws on her sheet; ben should hold the same state for her seat within two bars
	await play(a, 'bass', { sheet: true })
	const r = await a.evaluate(() => window.jam.view.focus.sheet)
	await a.mouse.move(r.x + 10, r.y + r.h * 0.2); await a.mouse.down(); await a.mouse.move(r.x + r.w - 10, r.y + r.h * 0.8, { steps: 12 }); await a.mouse.up()
	const mine = await a.evaluate(() => JSON.stringify(window.jam.engine.seats[window.jam.me.seat].instance.state))
	const seat = seats[0]
	const got = await b.waitForFunction(({ seat, mine }) => JSON.stringify(window.jam.engine.seats[seat].instance.state) === mine, { seat, mine }, { timeout: 8000 }).then(() => true, () => false)
	check(got, "ben hears ana's drawing")
	const errs = [...a.errors, ...b.errors]
	check(!errs.length, 'no page errors' + errs.map((e) => '\n  ' + e).join(''))
} finally { await browser.close(); srv.close() }
process.exit(ok ? 0 : 1)
