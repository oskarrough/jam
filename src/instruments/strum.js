// 07 Strum: six strings standing upright. Swipe across them to strum.
// Strums are recorded in loop time and replay on the current chord, so a rhythm becomes a progression.
import { kit, mtof } from './lib/kit.js'
import { withPointer, view, absNow, absOf, theme, tint, flashes, subSlots, SLOTS, clamp } from './lib/util.js'
import { line } from './lib/demo.js'

const STRINGS = 6
const MAX_HITS = 96

function gen() {
	const hits = []
	;[0, 6, 12, 20, 24, 28, 36, 44, 48, 54, 60].forEach((s) => {
		if (Math.random() < 0.3) return
		const down = Math.random() < 0.6
		for (let k = 0; k < STRINGS; k++)
			hits.push([s, down ? k : STRINGS - 1 - k, +(0.5 + Math.random() * 0.4).toFixed(2)])
	})
	return { hits }
}

export default {
	id: 'strum',
	glyph:
		'<path d="M4 9h24M4 13h24M4 17h24M4 21h24" stroke-width="1"/><path d="M9 26L23 5" stroke-width="2.2"/>',
	name: 'Strum',
	playhead: 'y',
	how: 'Swipe sideways across the strings. Fast swipes are loud. Strums record into the loop; the eraser or Shift rubs them out.',
	demo: () => [line(0.04, 0.25, 0.96, 0.28, 10), line(0.96, 0.55, 0.04, 0.58, 10)],
	params: {
		record: { value: true },
		decay: { value: 0.995, min: 0.98, max: 0.9995, step: 0.0005 },
		bright: { value: 0.55, min: 0, max: 1, step: 0.01 },
		octave: { value: 0, min: -1, max: 1, step: 1 },
		level: { value: 0.5, min: 0, max: 1, step: 0.01 },
	},
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { hits: [] } // [slot, string, velocity]
		const ring = Array.from({ length: STRINGS }, () => ({ t: -1, v: 0 }))
		let lastX = null,
			lastT = 0
		let chordName = ''
		const lit = flashes() // keyed by slot (the whole strum) and slot*8+string (one knot)

		const xOf = (j) => (j + 0.5) / STRINGS
		function notes(abs) {
			const c = engine.chord(abs, clock.steps)
			chordName = c.name
			const [r, third, fifth] = c.notes.map((n) => n + 12 * params.octave)
			return [r - 12, fifth - 12, r, third, fifth, r + 12]
		}
		function pluck(j, vel, time, abs) {
			engine.voices.pluck(out, {
				freq: mtof(notes(abs)[j]),
				time,
				gain: params.level * vel,
				damp: params.decay,
				bright: params.bright,
				pan: (j - 2.5) * 0.12,
			})
			ring[j] = { t: time, v: vel }
		}
		function liveHit(j, vel) {
			const now = audio.currentTime
			pluck(j, vel, now, Math.floor(absNow(clock)))
			if (params.record && (clock.playing ?? true)) {
				const s = Math.floor((clock.pos() / clock.steps) * SLOTS) % SLOTS
				state.hits.push([s, j, +vel.toFixed(2)])
				if (state.hits.length > MAX_HITS) state.hits.shift()
			}
		}

		// hits that share a slot are one strum, in the order they were played
		function strums() {
			const by = new Map()
			for (const [s, j, v] of state.hits) {
				if (!by.has(s)) by.set(s, [])
				by.get(s).push([j, v])
			}
			return [...by].map(([s, hs]) => ({
				s,
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
				g.strokeStyle = th.accent
				g.lineWidth = 3 + 2 * st.v + 3 * f
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
			const ry = Math.max(1.5, ((Math.min(e.w, e.h) * 0.04) / e.h) * SLOTS)
			state.hits = state.hits.filter(
				([s, j]) => Math.abs(e.x - xOf(j)) > 0.5 / STRINGS || Math.abs(e.y * SLOTS - s) > ry,
			)
		}

		return {
			state,
			pointer: withPointer(size, (e) => {
				if (e.alt) {
					if (e.type === 'down' || (e.type === 'move' && e.pressed)) rub(e)
					lastX = null
					return
				}
				const now = performance.now()
				if (e.type === 'down') {
					const j = clamp(Math.round(e.x * STRINGS - 0.5), 0, STRINGS - 1)
					if (Math.abs(e.x - xOf(j)) < 0.04) liveHit(j, 0.6)
					lastX = e.x
					lastT = now
				} else if (e.type === 'move' && e.pressed && lastX !== null) {
					const a = Math.min(lastX, e.x),
						b = Math.max(lastX, e.x)
					const speed = Math.abs(e.x - lastX) / Math.max(1, now - lastT) // screen-widths per ms
					const vel = clamp(0.25 + speed * 120, 0.25, 1)
					const dir = e.x > lastX ? 1 : -1
					const crossed = []
					for (let j = 0; j < STRINGS; j++) if (xOf(j) > a && xOf(j) <= b) crossed.push(j)
					if (dir < 0) crossed.reverse()
					crossed.forEach((j) => liveHit(j, vel))
					lastX = e.x
					lastT = now
				} else if (e.type === 'up') lastX = null
			}),
			step(i, time, dur) {
				const abs = absOf(clock, time)
				subSlots(i, time, dur, clock.steps, (s, t) => {
					let k = 0
					for (const [hs, j, v] of state.hits)
						if (hs === s) {
							pluck(j, v, t + 0.011 * k, abs)
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
				const gap = w / STRINGS,
					pull = Math.min(gap * 0.2, 20),
					spread = Math.min(h * 0.05, gap * 0.6),
					held = (s) => {
						if (!t.playing) return 1
						const d = (((t.phase - s / SLOTS) % 1) + 1) % 1
						const c = clamp((d - 0.03) / 0.35, 0, 1)
						return c * c * (3 - 2 * c)
					}
				const bumps = Array.from({ length: STRINGS }, () => [])
				for (const st of all) {
					st.y = (st.s / SLOTS) * h
					st.k = held(st.s)
					for (const [j, v] of st.hs) bumps[j].push([st.y, pull * st.dir * st.k * (0.45 + 0.55 * v)])
				}
				const off = (j, y) => {
					let d = 0
					for (const [by, a] of bumps[j]) d += a * Math.max(0, 1 - Math.abs(y - by) / spread)
					return clamp(d, -gap * 0.45, gap * 0.45)
				}
				for (let j = 0; j < STRINGS; j++) {
					const x = xOf(j) * w
					const age = t.now - ring[j].t
					const amp = ring[j].t >= 0 && age >= 0 ? ring[j].v * Math.exp(-age * 3.5) * w * 0.012 : 0
					const ys = []
					for (let y = 0; y <= h; y += 8) ys.push(y)
					for (const [by] of bumps[j]) ys.push(by - spread, by, by + spread)
					ys.sort((p, q) => p - q)
					g.strokeStyle = amp > w * 0.003 ? th.accent : th.dim
					g.lineWidth = 1 + (STRINGS - j) * 0.3
					g.beginPath()
					ys.forEach((y, n) => {
						if (y < 0 || y > h) return
						const dx = amp * Math.sin((y / h) * Math.PI) * Math.sin(t.now * 90 + j) + off(j, y)
						n ? g.lineTo(x + dx, y) : g.moveTo(x + dx, y)
					})
					g.stroke()
				}
				const knot = Math.min(Math.max(gap * 0.06, 4), 8)
				g.lineCap = g.lineJoin = 'round'
				for (const st of all) {
					const pts = st.hs.map(([j, v]) => [xOf(j) * w + off(j, st.y), st.y, v, lit.glow(st.s * 8 + j, t.now, 0.5)])
					const f = lit.glow(st.s, t.now, 0.6)
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
				g.fillStyle = th.dim
				g.font = `${Math.max(10, h / 30)}px ${th.font}`
				g.fillText(chordName, 8, h - 8)
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
