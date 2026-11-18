// pnpm two-tabs: two players in one browser (the local transport, no relay). Each takes a seat, one draws,
// the other must receive it on the next bar. Exits non-zero if they don't see each other or the edit.
import { serve, playwright, play } from './lib/browser.js'

const srv = await serve()
const browser = await playwright().chromium.launch()
let ok = true
try {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
	const tab = async (name) => {
		const p = await ctx.newPage()
		p.errors = []
		p.on('pageerror', (e) => p.errors.push(e.message))
		await p.goto(`${srv.url}/?ws=off&name=${name}`)
		await p.waitForFunction(() => window.jam)
		await p.waitForTimeout(800)
		return p
	}
	const a = await tab('ana'),
		b = await tab('ben')
	await a.click('#sound')
	await b.click('#sound')
	const seats = await Promise.all([a, b].map((p) => p.evaluate(() => window.jam.me.seat)))
	const peers = await b.evaluate(() => window.jam.transport.peers.map((p) => p.name))
	const check = (c, msg) => {
		console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`)
		ok &&= c
	}
	check(seats[0] >= 0 && seats[1] >= 0 && seats[0] !== seats[1], `two seats (${seats})`)
	check(peers.includes('ana'), `ben sees ana (${peers})`)
	await play(a, 'bass', { sheet: true })
	const r = await a.evaluate(() => window.jam.view.focus.sheet)
	await a.mouse.move(r.x + 10, r.y + r.h * 0.2)
	await a.mouse.down()
	await a.mouse.move(r.x + r.w - 10, r.y + r.h * 0.8, { steps: 12 })
	await a.mouse.up()
	const mine = await a.evaluate(() =>
		JSON.stringify(window.jam.engine.seats[window.jam.me.seat].instance.state),
	)
	const seat = seats[0]
	const got = await b
		.waitForFunction(
			({ seat, mine }) => JSON.stringify(window.jam.engine.seats[seat].instance.state) === mine,
			{ seat, mine },
			{ timeout: 8000 },
		)
		.then(
			() => true,
			() => false,
		)
	check(got, "ben hears ana's drawing")
	await a.click('.loops button:text-is("1")')
	const len = await b
		.waitForFunction(
			(seat) => {
				const L = window.jam.engine.seats[seat]
				return L.len === 16 && L.clock.steps === 16
			},
			seat,
			{ timeout: 8000 },
		)
		.then(
			() => true,
			() => false,
		)
	check(len, "ben's copy of ana's bass loops one bar")
	// the eye holds the chords: ana taps it, ben's loop rolls the same bar on
	await a.mouse.click(5, 5)
	await a.waitForFunction(() => !window.jam.view.focus.on && !window.jam.view.moving)
	const c = await a.evaluate(() => window.jam.view.center())
	await a.mouse.click(c.x + c.r * 0.4, c.y - c.r * 0.4)
	const want = await a.evaluate(() =>
		JSON.stringify(window.jam.transport.clock.pending().at(-1)?.chords),
	)
	const rolled = await b
		.waitForFunction(
			(w) => JSON.stringify(window.jam.transport.clock.loopAt().chords) === w,
			want,
			{
				timeout: 8000,
			},
		)
		.then(
			() => true,
			() => false,
		)
	check(want && rolled, `ben plays ana's chords (${want})`)
	// ana presses the key under the eye and slides two rungs up: ben's loop changes key too
	const kt = await a.evaluate(() => {
		const k = [...document.querySelectorAll('span')].find((s) =>
			/^[A-G] (minor|major)$/.test(s.textContent),
		)
		const r = k.getBoundingClientRect()
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
	})
	await a.mouse.move(kt.x, kt.y)
	await a.mouse.down()
	await a.mouse.move(kt.x, kt.y - 56, { steps: 6 })
	await a.mouse.up()
	const keyed = await b
		.waitForFunction(() => window.jam.transport.clock.loopAt().root === 'C', null, {
			timeout: 8000,
		})
		.then(
			() => true,
			() => false,
		)
	check(keyed, 'ben plays in the key ana picked (C)')
	// ana opens the mixer and drags her dot up and to the left: louder and darker, for ben too
	const b0 = await a.evaluate(() => window.jam.view.mixer()?.button)
	if (b0) await a.mouse.click(b0.x, b0.y)
	await a.waitForTimeout(300)
	const k = await a.evaluate(() => window.jam.view.mixer()?.dot)
	if (k) {
		await a.mouse.move(k.x, k.y)
		await a.mouse.down()
		await a.mouse.move(k.x - 60, k.y - 30, { steps: 8 })
		await a.mouse.up()
	}
	const mix = await a.evaluate((seat) => window.jam.engine.seats[seat].mix, seat)
	const mixed = await b
		.waitForFunction(
			({ seat, mix }) => {
				const m = window.jam.engine.seats[seat].mix
				return m.level === mix.level && m.tone === mix.tone
			},
			{ seat, mix },
			{ timeout: 8000 },
		)
		.then(
			() => true,
			() => false,
		)
	check(
		k && mix.level > 0.9 && mix.tone < 1 && mixed,
		`ben hears ana's mix (${JSON.stringify(mix)})`,
	)
	// a jam of your own starts blank: cat gets an instrument, the rest are bare; dan sits at a bare ring and picks
	const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } })
	const join = async (name) => {
		const p = await ctx2.newPage()
		p.errors = []
		p.on('pageerror', (e) => p.errors.push(e.message))
		await p.goto(`${srv.url}/j/two-tabs-blank?ws=off&name=${name}`)
		await p.waitForFunction(() => window.jam)
		await p.waitForTimeout(800)
		return p
	}
	const c2 = await join('cat'),
		d = await join('dan')
	const lineup = await d.evaluate(() =>
		window.jam.engine.seats.map((L) => L.module.id + (L.instance.state ? '' : '·')),
	)
	const cs = await c2.evaluate(() => window.jam.me.seat)
	check(
		lineup.filter((x) => x.startsWith('empty')).length === 2 && !lineup[cs].startsWith('empty'),
		`a blank jam: two bare rings, cat dealt one (${lineup})`,
	)
	const bare = await d.evaluate(() => {
		const { engine, transport } = window.jam
		return engine.seats.findIndex(
			(L) => L.module.hidden && !transport.peers.some((p) => p.seat === L.id),
		)
	})
	const at = await d.evaluate((i) => window.jam.view.seatAt(i), bare)
	await d.mouse.click(at.x, at.y)
	await d.waitForFunction(() => window.jam.view.focus.on && !window.jam.view.moving)
	await d.click('.glyph[data-id="bell"]')
	const picked = await c2
		.waitForFunction((i) => window.jam.engine.seats[i].module.id === 'bell', bare, {
			timeout: 8000,
		})
		.then(
			() => true,
			() => false,
		)
	check(
		picked && (await d.evaluate(() => window.jam.me.seat)) === bare,
		`dan sits at bare seat ${bare}, picks bell, cat hears it`,
	)
	const errs = [...a.errors, ...b.errors, ...c2.errors, ...d.errors]
	check(!errs.length, 'no page errors' + errs.map((e) => '\n  ' + e).join(''))
} finally {
	await browser.close()
	srv.close()
}
process.exit(ok ? 0 : 1)
