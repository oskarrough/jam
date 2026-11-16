// Bots: they sit in empty seats. Every few loops one sweeps a cursor round its ring,
// then a freshly generated part lands. Only one tab in the room (the lowest id) drives them.
//
// Riffs: a player can hand a robot their motif (drag your seat badge onto the robot's).
// The robot then plays it back in its own instrument and improvises on it every loop or
// two: theme, two variations, a call-and-response, again (see src/phrase.js). The motif
// travels in the seat data as `riff`, so every tab sees it and any tab can take over driving.

import { toPhrase, fromPhrase, vary, canPhrase } from './phrase.js'

export const botName = (i) => `Robot ${String.fromCharCode(65 + i)}`

export function createBots(engine, { seated, view }) {
	const { seats, transport } = engine
	const opts = { on: true, minLoops: 2, maxLoops: 5, sweepMs: 1600, riffSweepMs: 900 }
	const bots = new Map() // seat index -> {nextAt, sweep, riffId}

	const leader = () => {
		const ids = [transport.id, ...transport.peers.map((p) => p.id)].filter(Boolean).sort()
		return ids[0] === transport.id
	}
	const loopMs = () => transport.clock.loopMs(transport.clock.loopAt())
	const canRiff = (L) => !!(L.riff?.motif && canPhrase(L.module.id))

	// the next turn of a riff: { state, riff } with the riff's turn advanced
	function riffTurn(L) {
		const r = L.riff
		const v = vary(r.motif, r.turn || 0, r.last)
		const state = fromPhrase(v.phrase, L, engine.steps())
		return state && { state, riff: { ...r, turn: (r.turn || 0) + 1, last: v.move, label: v.label } }
	}

	function tick() {
		const now = performance.now()
		const lead = opts.on && leader()
		seats.forEach((L, i) => {
			const riffing = canRiff(L)
			const active = lead && !seated(i) && (L.module.generate || riffing)
			let b = bots.get(i)
			if (!active) { bots.delete(i); return }
			if (!b) bots.set(i, (b = { nextAt: now + 800 + Math.random() * loopMs() * 1.5, sweep: null }))
			// a freshly handed motif: answer it straight away
			if (riffing && b.riffId !== L.riff.id) { b.riffId = L.riff.id; b.sweep = null; b.nextAt = now }
			if (!riffing) b.riffId = null
			if (!b.sweep && now > b.nextAt) {
				const turn = riffing ? riffTurn(L) : null
				const target = turn ? turn.state : L.module.generate?.(engine.steps(), L.params)
				if (target) b.sweep = { t0: now, y: 0.5, mod: L.module, target, riff: turn?.riff, ms: turn ? opts.riffSweepMs : opts.sweepMs }
				else b.nextAt = now + loopMs()
			}
			if (b.sweep && b.sweep.mod !== L.module) b.sweep = null // seat changed instrument mid-sweep
			if (b.sweep) {
				const f = (now - b.sweep.t0) / b.sweep.ms
				b.sweep.y = Math.max(0.05, Math.min(0.95, b.sweep.y + (Math.random() - 0.5) * 0.15))
				const x = (b.sweep.x0 ??= Math.floor(Math.random() * 4) / 4)
				const cx = (x + Math.min(1, f)) % 1
				view.showCursor('bot' + i, i, cx, b.sweep.y, botName(i))
				transport.cursor(cx, b.sweep.y, true, L.id, botName(i))
				if (f >= 1) {
					L.instance.setState(b.sweep.target)
					if (b.sweep.riff) L.riff = b.sweep.riff
					engine.push(L)
					// riffs move every loop or two, so you hear the conversation; plain bots drift slower
					b.nextAt = now + loopMs() * (b.sweep.riff ? 1 + ((L.riff.turn || 0) % 2) : opts.minLoops + Math.random() * (opts.maxLoops - opts.minLoops))
					b.sweep = null
				}
			}
		})
	}
	setInterval(tick, 60)

	// hand seat `from`'s part to the robot at seat `to`; returns false if either side can't phrase
	function hand(from, to, { by } = {}) {
		const A = seats[from], B = seats[to]
		if (!A || !B || from === to || seated(to) || !canPhrase(A.module.id) || !canPhrase(B.module.id)) return false
		const motif = toPhrase(A, engine.steps())
		if (!motif?.notes.length) return false
		B.riff = { id: Math.random().toString(36).slice(2, 10), from: by ?? transport.id, fromSeat: from, color: A.color, motif, turn: 0, last: null, label: 'echoes' }
		engine.push(B)
		return true
	}
	// let a robot go back to its own ideas
	function release(i) {
		const L = seats[i]
		if (!L?.riff) return
		L.riff = null
		engine.push(L)
	}

	return { opts, hand, release, get count() { return bots.size }, get leading() { return leader() } }
}
