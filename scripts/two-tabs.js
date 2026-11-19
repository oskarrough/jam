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
	// the bracket on the sheet's right edge: each notch left halves the loop, down to one bar
	await play(a, 'tide', { sheet: true })
	const t = await a.evaluate(() => window.jam.view.focus.sheet)
	await a.mouse.move(t.x + t.w - 4, t.y + t.h / 2)
	await a.mouse.down()
	await a.mouse.move(t.x + t.w - 4 - 4 * Math.max(40, Math.min(110, t.w * 0.16)), t.y + t.h / 2, {
		steps: 8,
	})
	await a.mouse.up()
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
	check(len, "ben's copy of ana's tide loops one bar")
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
	// ana presses the key under the eye, slides four rows up and one mood left: C♯ dorian, for ben too
	const kt = await a.evaluate(() => {
		const k = [...document.querySelectorAll('span')].find((s) =>
			/^[A-G][♯♭]? (major|mixolydian|dorian|minor)$/.test(s.textContent),
		)
		const r = k.getBoundingClientRect()
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
	})
	await a.mouse.move(kt.x, kt.y)
	await a.mouse.down()
	await a.mouse.move(kt.x - 44, kt.y - 96, { steps: 6 })
	await a.mouse.up()
	const keyed = await b
		.waitForFunction(
			() => {
				const l = window.jam.transport.clock.loopAt()
				return l.root === 'C#' && l.scale === 'dorian pent'
			},
			null,
			{
				timeout: 8000,
			},
		)
		.then(
			() => true,
			() => false,
		)
	check(keyed, 'ben plays in the key ana picked (C♯ dorian)')
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
		k && mix.level > 0.9 && mix.tone < 0.5 && mixed,
		`ben hears ana's mix (${JSON.stringify(mix)})`,
	)
	// ana taps her dot without moving it: her seat goes quiet for ben too
	const own = await a.evaluate(() => window.jam.view.mixer()?.dot)
	if (own) await a.mouse.click(own.x, own.y)
	const muted = await b
		.waitForFunction((seat) => window.jam.engine.seats[seat].mix.mute, seat, { timeout: 8000 })
		.then(
			() => true,
			() => false,
		)
	check(
		own && muted && (await a.evaluate((seat) => window.jam.engine.seats[seat].mix.mute, seat)),
		"ben hears ana's mute",
	)
	// unmute straight after a level change: the level's edit lands on the next bar, and must not bring the mute back
	await a.evaluate((seat) => {
		const { engine } = window.jam
		engine.setMix(engine.seats[seat], { level: 0.8 })
		engine.setMute(engine.seats[seat], false)
	}, seat)
	await a.waitForTimeout(6000)
	const kept = await b.evaluate((seat) => window.jam.engine.seats[seat].mix, seat)
	check(
		!kept.mute && kept.level === 0.8,
		`an unmute right after a level change sticks (${JSON.stringify(kept)})`,
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
	// four seats, five players: the fifth listens and waits; one stands up and the fifth sits down in their place
	const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 860 } })
	const five = []
	for (const n of ['p1', 'p2', 'p3', 'p4', 'p5']) {
		const p = await ctx3.newPage()
		p.errors = []
		p.on('pageerror', (e) => p.errors.push(e.message))
		await p.goto(`${srv.url}/j/two-tabs-seats?ws=off&name=${n}`)
		await p.waitForFunction(() => window.jam)
		await p.waitForTimeout(800)
		five.push(p)
	}
	// seats every tab agrees on: a tab that sat on a taken seat in its first moments has to get up first
	const seated = () => Promise.all(five.map((p) => p.evaluate(() => window.jam.me.seat)))
	const settled = async (ok) => {
		let v
		for (let t = 0; t < 50; t++) {
			if (ok((v = await seated()))) return v
			await five[0].waitForTimeout(100)
		}
		return v
	}
	const fourAndOne = (v) =>
		new Set(v.slice(0, 4)).size === 4 && !v.slice(0, 4).includes(-1) && v[4] === -1
	const sat = await settled(fourAndOne)
	check(
		new Set(sat.slice(0, 4)).size === 4 && !sat.slice(0, 4).includes(-1) && sat[4] === -1,
		`four seated, the fifth listens (${sat})`,
	)
	const dots = await five[4].evaluate(() => window.jam.presence.audience().length)
	check(dots === 5, `five dots round the rim (${dots})`)
	// a fast loop so the candles burn in seconds: nobody draws, a seat burns out, the fifth takes it
	await five[0].evaluate(() => window.jam.transport.setLoop({ bpm: 300, beatsPerBar: 4, bars: 1 }))
	const took = await five[4]
		.waitForFunction(() => window.jam.me.seat >= 0, null, { timeout: 15000 })
		.then(
			() => true,
			() => false,
		)
	const handed = (v) => v[4] >= 0 && v.filter((x) => x < 0).length === 1 && new Set(v).size === 5
	const after = await settled(handed)
	check(took && handed(after), `an idle seat burns out and the fifth sits (${after})`)
	const errs = [
		...a.errors,
		...b.errors,
		...c2.errors,
		...d.errors,
		...five.flatMap((p) => p.errors),
	]
	check(!errs.length, 'no page errors' + errs.map((e) => '\n  ' + e).join(''))
} finally {
	await browser.close()
	srv.close()
}
process.exit(ok ? 0 : 1)
