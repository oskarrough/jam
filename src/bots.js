// Bots: they sit in empty seats. Every few loops one sweeps a cursor round its ring,
// then a freshly generated part lands. Only one tab in the room (the lowest id) drives them.

export const botName = (i) => `Robot ${String.fromCharCode(65 + i)}`

export function createBots(engine, { seated, view }) {
	const { lanes, transport } = engine
	const opts = { on: true, minLoops: 2, maxLoops: 5, sweepMs: 1600 }
	const bots = new Map() // lane index -> {nextAt, sweep}

	const leader = () => {
		const ids = [transport.id, ...transport.peers.map((p) => p.id)].filter(Boolean).sort()
		return ids[0] === transport.id
	}
	const loopMs = () => transport.clock.loopMs(transport.clock.loopAt())

	function tick() {
		const now = performance.now()
		const lead = opts.on && leader()
		lanes.forEach((L, i) => {
			const active = lead && !seated(i) && L.module.generate
			let b = bots.get(i)
			if (!active) { bots.delete(i); return }
			if (!b) bots.set(i, (b = { nextAt: now + 800 + Math.random() * loopMs() * 1.5, sweep: null }))
			if (!b.sweep && now > b.nextAt) b.sweep = { t0: now, y: 0.5, mod: L.module, target: L.module.generate(engine.steps(), L.params) }
			if (b.sweep && b.sweep.mod !== L.module) b.sweep = null // lane changed instrument mid-sweep
			if (b.sweep) {
				const f = (now - b.sweep.t0) / opts.sweepMs
				b.sweep.y = Math.max(0.05, Math.min(0.95, b.sweep.y + (Math.random() - 0.5) * 0.15))
				const x = (b.sweep.x0 ??= Math.floor(Math.random() * 4) / 4)
				const cx = (x + Math.min(1, f)) % 1
				view.showCursor('bot' + i, i, cx, b.sweep.y, botName(i))
				transport.cursor(cx, b.sweep.y, true, L.id, botName(i))
				if (f >= 1) {
					L.instance.setState(b.sweep.target)
					engine.push(L)
					b.sweep = null
					b.nextAt = now + loopMs() * (opts.minLoops + Math.random() * (opts.maxLoops - opts.minLoops))
				}
			}
		})
	}
	setInterval(tick, 60)
	return { opts, get count() { return bots.size }, get leading() { return leader() } }
}
