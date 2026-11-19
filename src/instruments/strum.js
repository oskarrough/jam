// 07 Strum: six strings lying across the sheet, time running left to right. Swipe down or up across them
// and the strum lands where you swiped; it replays on the current chord, so a rhythm becomes a progression.
import { kit, mtof } from './lib/kit.js'
import {
	withPointer,
	view,
	absNow,
	absOf,
	theme,
	tint,
	flashes,
	subSlots,
	SLOTS,
	clamp,
} from './lib/util.js'
import { line } from './lib/demo.js'

const STRINGS = 6
const MAX_HITS = 96
// two inks, picked in the tool strip per strum: nylon is today's pluck, steel rings bright and long
const INKS = [
	['nylon', '<path d="M6 26C10 16 22 16 26 6" stroke-width="5"/>'],
	[
		'steel',
		'<path d="M6 26L26 6" stroke-width="1"/><path d="M6 20L20 6M12 26L26 12" stroke-width=".6"/>',
	],
]

function gen() {
	const hits = []
	;[0, 6, 12, 20, 24, 28, 36, 44, 48, 54, 60].forEach((s) => {
		if (Math.random() < 0.3) return
		const down = Math.random() < 0.6,
			steel = s >= 32
		for (let k = 0; k < STRINGS; k++) {
			const h = [s, down ? k : STRINGS - 1 - k, +(0.5 + Math.random() * 0.4).toFixed(2)]
			hits.push(steel ? [...h, 1] : h)
		}
	})
	return { hits }
}

export default {
	id: 'strum',
	glyph:
		'<path d="M4 9h24M4 13h24M4 17h24M4 21h24" stroke-width="1"/><path d="M9 26L23 5" stroke-width="2.2"/>',
	name: 'Strum',
	trim: 3,
	how: 'Swipe down or up across the strings: the strum plays where you swiped, harder the faster you go. Shift or the eraser rubs it out.',
	demo: () => [line(0.2, 0.04, 0.21, 0.96, 10), line(0.6, 0.96, 0.61, 0.04, 10)],
	params: {
		record: { value: true },
		decay: { value: 0.995, min: 0.98, max: 0.9995, step: 0.0005 },
		bright: { value: 0.55, min: 0, max: 1, step: 0.01 },
		octave: { value: 0, min: -1, max: 1, step: 1 },
		level: { value: 0.5, min: 0, max: 1, step: 0.01 },
	},
	inks: INKS,
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { hits: [] } // [slot, string, velocity, 1 if steel]
		let ink = 'nylon'
		const ring = Array.from({ length: STRINGS }, () => ({ t: -1, v: 0 }))
		let lastY = null,
			lastT = 0,
			cur = null // the strum this swipe is writing: { s, dir, fresh }
		const lit = flashes() // keyed by slot (the whole strum) and slot*8+string (one knot)

		const yOf = (j) => (j + 0.5) / STRINGS
		const slotAt = (x) => clamp(Math.floor(x * SLOTS), 0, SLOTS - 1)
		function notes(abs) {
			const c = engine.chord(abs, clock.steps)
			const [r, third, fifth] = c.notes.map((n) => n + 12 * params.octave)
			return [r - 12, fifth - 12, r, third, fifth, r + 12]
		}
		function pluck(j, vel, time, abs, steel) {
			const freq = mtof(notes(abs)[j])
			if (!steel)
				engine.voices.pluck(out, {
					freq,
					time,
					gain: params.level * vel,
					damp: params.decay,
					bright: params.bright,
					pan: (j - 2.5) * 0.12,
				})
			// steel: bright, long, and doubled a hair sharp so it shimmers
			else
				for (const c of [1, 1.004])
					engine.voices.pluck(out, {
						freq: freq * c,
						time: time + (c > 1 ? 0.004 : 0),
						gain: params.level * vel * 0.6,
						damp: 0.9985,
						bright: 0.97,
						pan: (j - 2.5) * 0.12 * (c > 1 ? -1 : 1),
					})
			ring[j] = { t: time, v: vel }
		}
		// you hear every string as you cross it; the strum is written at the x of the swipe, not at the playhead
		function liveHit(j, vel) {
			const now = audio.currentTime
			const steel = ink === 'steel'
			pluck(j, vel, now, Math.floor(absNow(clock)), steel)
			if (!params.record || !cur) return
			if (cur.fresh) {
				state.hits = state.hits.filter((h) => h[0] !== cur.s) // a new strum replaces the one at its spot
				cur.fresh = false
			}
			state.hits.push(steel ? [cur.s, j, +vel.toFixed(2), 1] : [cur.s, j, +vel.toFixed(2)])
			lit.hit(cur.s * 8 + j, now)
			if (state.hits.length > MAX_HITS) state.hits.shift()
		}

		// hits that share a slot are one strum, in the order they were played
		function strums() {
			const by = new Map()
			for (const [s, j, v, k] of state.hits) {
				const key = s + (k ? 0.5 : 0) // a nylon and a steel strum on one slot stay two strums
				if (!by.has(key)) by.set(key, [])
				by.get(key).push([j, v])
			}
			return [...by].map(([key, hs]) => ({
				s: Math.floor(key),
				steel: key % 1 > 0,
				hs,
				v: Math.max(...hs.map((h) => h[1])),
				dir: hs.length > 1 && hs.at(-1)[0] < hs[0][0] ? -1 : 1,
			}))
		}
		// round the ring: time runs along it, the six strings are six lanes across it, each strum a short stroke
		function ring_(g, w, h, t, all) {
			const lane = (j) => ((j + 0.5) / STRINGS) * h
			g.fillStyle = th.faint
			for (let j = 0; j < STRINGS; j++) g.fillRect(0, lane(j) - 0.5, w, 1)
			g.lineCap = 'round'
			for (const st of all) {
				const x = (st.s / SLOTS) * w,
					f = lit.glow(st.s, t.now, 0.6),
					js = st.hs.map((p) => p[0])
				g.strokeStyle = st.steel ? th.fg : th.accent
				g.lineWidth = st.steel ? 1 + f * 2 : 3 + 2 * st.v + 3 * f
				g.beginPath()
				g.moveTo(x, lane(Math.min(...js)))
				g.lineTo(x + 0.01, lane(Math.max(...js)))
				g.stroke()
				g.fillStyle = th.fg
				for (const j of js) g.fillRect(x - 1.5, lane(j) - 1.5, 3, 3)
			}
			g.lineCap = 'butt'
			g.lineWidth = 1
		}

		function rub(e) {
			const rx = Math.max(1.5, ((Math.min(e.w, e.h) * 0.04) / e.w) * SLOTS)
			state.hits = state.hits.filter(
				([s, j]) => Math.abs(e.y - yOf(j)) > 0.5 / STRINGS || Math.abs(e.x * SLOTS - s) > rx,
			)
		}

		return {
			state,
			get ink() {
				return ink
			},
			set ink(v) {
				ink = v
			},
			pointer: withPointer(size, (e) => {
				if (e.alt) {
					if (e.type === 'down' || (e.type === 'move' && e.pressed)) rub(e)
					lastY = null
					return
				}
				const now = performance.now()
				if (e.type === 'down') {
					cur = { s: slotAt(e.x), dir: 0, fresh: true }
					const j = clamp(Math.round(e.y * STRINGS - 0.5), 0, STRINGS - 1)
					// a press on a string plucks it; the swipe that follows doesn't pluck it twice
					if (Math.abs(e.y - yOf(j)) < 0.04) liveHit(j, 0.6), (cur.plucked = j)
					lastY = e.y
					lastT = now
				} else if (e.type === 'move' && e.pressed && lastY !== null) {
					const a = Math.min(lastY, e.y),
						b = Math.max(lastY, e.y)
					const speed = Math.abs(e.y - lastY) / Math.max(1, now - lastT) // sheet-heights per ms
					const vel = clamp(0.4 + speed * 120, 0.4, 1)
					const dir = e.y > lastY ? 1 : -1
					const crossed = []
					for (let j = 0; j < STRINGS; j++) if (yOf(j) > a && yOf(j) <= b) crossed.push(j)
					if (dir < 0) crossed.reverse()
					if (crossed.length && cur) {
						// turning back starts the next strum, where the hand is now (a slot on if it hasn't moved)
						if (cur.dir && dir !== cur.dir && !cur.fresh) {
							let s = slotAt(e.x)
							if (s === cur.s) s = (s + 1) % SLOTS
							cur = { s, dir: 0, fresh: true }
						}
						cur.dir = dir
					}
					crossed.forEach((j) => j !== cur?.plucked && liveHit(j, vel))
					if (cur && crossed.length) cur.plucked = -1
					lastY = e.y
					lastT = now
				} else if (e.type === 'up') lastY = cur = null
			}),
			step(i, time, dur) {
				const abs = absOf(clock, time)
				subSlots(i, time, dur, clock.steps, (s, t) => {
					let k = 0
					for (const [hs, j, v, steel] of state.hits)
						if (hs === s) {
							pluck(j, v, t + 0.011 * k, abs, steel)
							lit.hit(s * 8 + j, t + 0.011 * k++)
						}
					if (k) lit.hit(s, t)
				})
			},
			frame(g, w, h, clock, shape) {
				size[0] = w
				size[1] = h
				const t = view(clock)
				notes(Math.floor(t.abs))
				const all = strums()
				if (shape === 'ring') return ring_(g, w, h, t, all)
				// a strum you placed is a pick holding its strings pulled aside; the playhead lets go,
				// they spring straight and ring, then slowly draw taut again for the next time round
				const gap = h / STRINGS,
					pull = Math.min(gap * 0.2, 20),
					spread = Math.min(w * 0.05, gap * 0.6),
					held = (s) => {
						if (!t.playing) return 1
						const d = (((t.phase - s / SLOTS) % 1) + 1) % 1
						const c = clamp((d - 0.03) / 0.35, 0, 1)
						return c * c * (3 - 2 * c)
					}
				const bumps = Array.from({ length: STRINGS }, () => [])
				for (const st of all) {
					st.x = (st.s / SLOTS) * w
					st.k = held(st.s)
					for (const [j, v] of st.hs)
						bumps[j].push([st.x, pull * st.dir * st.k * (0.45 + 0.55 * v)])
				}
				const off = (j, x) => {
					let d = 0
					for (const [bx, a] of bumps[j]) d += a * Math.max(0, 1 - Math.abs(x - bx) / spread)
					return clamp(d, -gap * 0.45, gap * 0.45)
				}
				for (let j = 0; j < STRINGS; j++) {
					const y = yOf(j) * h
					const age = t.now - ring[j].t
					const amp = ring[j].t >= 0 && age >= 0 ? ring[j].v * Math.exp(-age * 3.5) * h * 0.012 : 0
					const xs = []
					for (let x = 0; x <= w; x += 8) xs.push(x)
					for (const [bx] of bumps[j]) xs.push(bx - spread, bx, bx + spread)
					xs.sort((p, q) => p - q)
					g.strokeStyle = amp > h * 0.003 ? th.accent : th.dim
					g.lineWidth = 1 + (STRINGS - j) * 0.3
					g.beginPath()
					xs.forEach((x, n) => {
						if (x < 0 || x > w) return
						const dy = amp * Math.sin((x / w) * Math.PI) * Math.sin(t.now * 90 + j) + off(j, x)
						n ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)
					})
					g.stroke()
				}
				const knot = Math.min(Math.max(gap * 0.06, 4), 8)
				g.lineCap = g.lineJoin = 'round'
				for (const st of all) {
					const pts = st.hs.map(([j, v]) => [
						st.x,
						yOf(j) * h + off(j, st.x),
						v,
						lit.glow(st.s * 8 + j, t.now, 0.5),
					])
					const f = lit.glow(st.s, t.now, 0.6)
					if (st.steel) {
						// steel: one taut bright wire through its strings, small hard knots, a flare when it rings
						if (pts.length > 1) {
							g.lineCap = g.lineJoin = 'miter'
							g.strokeStyle = th.fg
							g.lineWidth = 1 + f
							g.shadowColor = th.fg
							g.shadowBlur = 4 + 14 * f
							g.beginPath()
							pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)))
							g.stroke()
							g.shadowBlur = 0
							g.lineCap = g.lineJoin = 'round'
						}
						for (const [x, y, , k] of pts) {
							const r = 2 + 3 * k
							g.fillStyle = th.fg
							g.fillRect(x - r, y - 0.75, r * 2, 1.5)
							g.fillRect(x - 0.75, y - r, 1.5, r * 2)
						}
						continue
					}
					// the stroke itself: thick where the swipe began, thinning the way it went
					if (pts.length > 1) {
						if (f > 0) {
							g.strokeStyle = tint(th.accent, 0.25 * f)
							g.lineWidth = knot * 4
							g.beginPath()
							pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)))
							g.stroke()
						}
						g.strokeStyle = th.accent
						for (let n = 1; n < pts.length; n++) {
							g.lineWidth = knot * (0.5 + 0.5 * st.v) * (1.5 - (0.9 * n) / pts.length) + f * 3
							g.beginPath()
							g.moveTo(pts[n - 1][0], pts[n - 1][1])
							g.lineTo(pts[n][0], pts[n][1])
							g.stroke()
						}
					}
					for (const [x, y, v, k] of pts) {
						const r = knot * (0.7 + 0.4 * v) * (1 + 0.6 * k)
						g.fillStyle = th.accent
						g.beginPath()
						g.arc(x, y, r + 2, 0, Math.PI * 2)
						g.fill()
						g.fillStyle = k > 0 ? th.accent : th.fg
						g.beginPath()
						g.arc(x, y, r * (1 - 0.5 * k), 0, Math.PI * 2)
						g.fill()
					}
				}
				g.lineWidth = 1
				g.lineCap = g.lineJoin = 'butt'
			},
			setState(s) {
				state.hits = s.hits.map((x) => x.slice())
			},
			clear() {
				state.hits = []
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
		}
	},
}
