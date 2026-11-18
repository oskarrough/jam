// Bots: off by default; the `robots` token on the loop turns them on for the whole jam. They sit in empty seats; every few loops one
// sweeps a cursor round its ring, then a new part lands. Only the lowest-id tab drives them.
// Riffs: drag your badge onto a robot's to hand it your motif (src/phrase.js); it rides in seat data as `riff`.

import { toPhrase, fromPhrase, vary, canPhrase } from './phrase.js'
import { instruments } from './instruments/index.js'

export const botName = (i) => `Robot ${String.fromCharCode(65 + i)}`

export function createBots(engine, { seated, view }) {
	const { seats, transport } = engine
	const opts = { on: false, minLoops: 2, maxLoops: 5, sweepMs: 1600, riffSweepMs: 900 }
	const bots = new Map()

	const leader = () => {
		const ids = [transport.id, ...transport.peers.map((p) => p.id)].filter(Boolean).sort()
		return ids[0] === transport.id
	}
	const loopMs = () => transport.clock.loopMs(transport.clock.loopAt())
	const canRiff = (L) => !!(L.riff?.motif && canPhrase(L.module.id))

	function riffTurn(L) {
		const r = L.riff
		const v = vary(r.motif, r.turn || 0, r.last)
		const state = fromPhrase(v.phrase, L, engine.steps(L))
		return state && { state, riff: { ...r, turn: (r.turn || 0) + 1, last: v.move, label: v.label } }
	}

	function tick() {
		const now = performance.now()
		const lead = opts.on && leader()
		seats.forEach((L, i) => {
			// a robot sitting down at a bare ring (a blank jam) picks itself an instrument first
			if (lead && !seated(i) && L.module.hidden) {
				const pool = instruments.filter((m) => m.generate && !seats.some((S) => S.module === m))
				const mod = pool[Math.floor(Math.random() * pool.length)]
				if (mod) {
					engine.setInstrument(L, mod.id)
					L.instance.setState(mod.generate(engine.steps(L), L.params))
					engine.push(L)
				}
			}
			const riffing = canRiff(L)
			const active = lead && !seated(i) && (L.module.generate || riffing)
			let b = bots.get(i)
			if (!active) {
				bots.delete(i)
				return
			}
			if (!b) bots.set(i, (b = { nextAt: now + 800 + Math.random() * loopMs() * 1.5, sweep: null }))
			if (riffing && b.riffId !== L.riff.id) {
				b.riffId = L.riff.id
				b.sweep = null
				b.nextAt = now
			}
			if (!riffing) b.riffId = null
			if (!b.sweep && now > b.nextAt) {
				const turn = riffing ? riffTurn(L) : null
				const target = turn ? turn.state : L.module.generate?.(engine.steps(L), L.params)
				if (target)
					b.sweep = {
						t0: now,
						y: 0.5,
						mod: L.module,
						target,
						riff: turn?.riff,
						ms: turn ? opts.riffSweepMs : opts.sweepMs,
					}
				else b.nextAt = now + loopMs()
			}
			if (b.sweep && b.sweep.mod !== L.module) b.sweep = null
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
					b.nextAt =
						now +
						loopMs() *
							(b.sweep.riff
								? 1 + ((L.riff.turn || 0) % 2)
								: opts.minLoops + Math.random() * (opts.maxLoops - opts.minLoops))
					b.sweep = null
				}
			}
		})
	}
	setInterval(tick, 60)

	function hand(from, to, { by } = {}) {
		const A = seats[from],
			B = seats[to]
		if (!A || !B || from === to || seated(to) || !canPhrase(A.module.id) || !canPhrase(B.module.id))
			return false
		const motif = toPhrase(A, engine.steps(A))
		if (!motif?.notes.length) return false
		B.riff = {
			id: Math.random().toString(36).slice(2, 10),
			from: by ?? transport.id,
			fromSeat: from,
			color: A.color,
			motif,
			turn: 0,
			last: null,
			label: 'echoes',
		}
		engine.push(B)
		return true
	}
	function release(i) {
		const L = seats[i]
		if (!L?.riff) return
		L.riff = null
		engine.push(L)
	}

	return {
		opts,
		hand,
		release,
		get count() {
			return bots.size
		},
		get leading() {
			return leader()
		},
	}
}
