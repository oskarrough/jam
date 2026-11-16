// 09 Orbits: a solar system as a sequencer. A planet sounds each time it passes 12 o'clock.
// Inner orbits are faster (8, 6, 4, 3, 2, 1 laps per loop); big planets are low.
import { kit, mtof } from './lib/kit.js'
import {
	isStrip,
	withPointer,
	view,
	absNow,
	theme,
	subSlots,
	SLOTS,
	clamp,
	dist,
	flashes,
	TAU,
} from './lib/util.js'
import { tap, line, arc } from './lib/demo.js'

export const REVS = [8, 6, 4, 3, 2, 1]
const MAX = 10
export const lapsOf = (r) =>
	REVS[clamp(Math.floor(((r - 0.15) / 0.85) * REVS.length), 0, REVS.length - 1)]

function gen() {
	return {
		planets: Array.from({ length: 4 }, () => ({
			r: +(0.2 + Math.random() * 0.8).toFixed(3),
			a: Math.floor(Math.random() * 16) / 16,
			m: +Math.random().toFixed(3),
		})),
	}
}

export default {
	id: 'orbits',
	glyph:
		'<ellipse cx="16" cy="16" rx="12" ry="6" transform="rotate(-25 16 16)"/><circle class="f" cx="16" cy="16" r="2.4"/><circle class="f" cx="26.5" cy="11" r="2"/>',
	name: 'Orbits',
	playhead: false,
	how: 'Press to place a planet and drag outward to grow it (bigger is lower). Drag a planet to another orbit; tap it to remove.',
	demo: (shape, aspect) =>
		shape === 'ring'
			? [line(0.3, 0.5, 0.36, 0.35, 8), tap(0.6, 0.7)]
			: [
					line(
						...arc(0.5, 0.5, 0.25, 0.15, 0.15, aspect, 1)[0],
						...arc(0.5, 0.5, 0.36, 0.15, 0.15, aspect, 1)[0],
						10,
					),
					arc(0.5, 0.5, 0.36, 0.15, 0.4, aspect, 12),
				],
	params: {
		range: { value: 9, min: 3, max: 16, step: 1 },
		octave: { value: 0, min: -1, max: 2, step: 1 },
		snap: { value: false },
		decay: { value: 0.7, min: 0.1, max: 2, step: 0.01 },
	},
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { planets: [] } // {r, a, m}: radius 0..1, phase offset in turns, mass 0..1
		const fx = flashes()
		let drag = null

		const phaseNow = () => (((absNow(clock) / clock.steps) % 1) + 1) % 1
		const R = (w, h) => Math.min(w, h) * 0.46
		const where = (p, ph, w, h) => {
			const th0 = TAU * (p.a + lapsOf(p.r) * ph)
			return [w / 2 + Math.sin(th0) * p.r * R(w, h), h / 2 - Math.cos(th0) * p.r * R(w, h)]
		}
		const polar = (e) => {
			const dx = e.px - e.w / 2,
				dy = e.py - e.h / 2
			return {
				r: clamp(Math.hypot(dx, dy) / R(e.w, e.h), 0.15, 1),
				turns: (((Math.atan2(dx, -dy) / TAU) % 1) + 1) % 1,
			}
		}

		// unrolled: x is the loop, y the orbit (top = outer, slow). Press to place, drag to grow;
		// drag a dot to move that planet, tap a dot to remove it.
		const rOfY = (y) => clamp(1 - y * 0.85, 0.15, 1)
		const yOfR = (r) => (1 - r) / 0.85
		const crossings = (p) => {
			const n = lapsOf(p.r),
				out = []
			for (let c = Math.ceil(p.a); (c - p.a) / n < 1; c++) out.push((c - p.a) / n)
			return out
		}
		function stripPointer(e) {
			if (e.type === 'down') {
				const k = state.planets.findIndex((p) =>
					crossings(p).some(
						(ph) => dist(ph * e.w, yOfR(p.r) * e.h, e.px, e.py) < 10 + p.m * e.h * 0.3,
					),
				)
				if (k >= 0) drag = { k, grow: false, moved: 0, x0: e.px, y0: e.py, strip: true }
				else {
					const r = rOfY(e.y)
					if (state.planets.length >= MAX) state.planets.shift()
					state.planets.push({ r: +r.toFixed(3), a: +(-lapsOf(r) * e.x).toFixed(4), m: 0.3 })
					drag = {
						k: state.planets.length - 1,
						grow: true,
						moved: 0,
						x0: e.px,
						y0: e.py,
						strip: true,
					}
				}
			} else if (e.type === 'move' && drag?.strip) {
				const p = state.planets[drag.k]
				const d = dist(drag.x0, drag.y0, e.px, e.py)
				drag.moved = Math.max(drag.moved, d)
				if (drag.grow) p.m = +clamp(0.3 + d / (e.h * 3), 0, 1).toFixed(3)
				else {
					p.r = +rOfY(e.y).toFixed(3)
					p.a = +(-lapsOf(p.r) * e.x).toFixed(4)
				}
			} else if (e.type === 'up' && drag?.strip) {
				if (!drag.grow && drag.moved < 5) state.planets.splice(drag.k, 1)
				drag = null
			}
		}
		function frameStrip(g, w, h, t) {
			for (const n of REVS) {
				const r = 0.15 + (REVS.indexOf(n) + 0.5) * (0.85 / REVS.length)
				g.fillStyle = th.faint
				g.fillRect(0, Math.round(yOfR(r) * h), w, 1)
			}
			state.planets.forEach((p, k) => {
				const y = yOfR(p.r) * h
				const glow = fx.glow(k, t.now, 0.4)
				const size = 2 + p.m * h * 0.3
				crossings(p).forEach((ph) => {
					const near = Math.abs(((t.phase - ph + 1.5) % 1) - 0.5) < 0.02
					g.fillStyle = glow && near ? th.accent : th.fg
					g.beginPath()
					g.arc(ph * w, y, size * (glow && near ? 1.3 : 1), 0, TAU)
					g.fill()
				})
			})
			if (t.playing) {
				g.fillStyle = th.dim
				g.fillRect(Math.round(t.phase * w), 0, 1, h)
			}
		}

		return {
			state,
			pointer: withPointer(size, (e) => {
				if (isStrip(e.w, e.h, e.shape)) return stripPointer(e)
				const ph = phaseNow()
				if (e.type === 'down') {
					const k = state.planets.findIndex((p) => {
						const [x, y] = where(p, ph, e.w, e.h)
						return dist(x, y, e.px, e.py) < 8 + p.m * R(e.w, e.h) * 0.07
					})
					if (k >= 0) drag = { k, grow: false, moved: 0, x0: e.px, y0: e.py }
					else {
						const { r, turns } = polar(e)
						if (state.planets.length >= MAX) state.planets.shift()
						state.planets.push({ r: +r.toFixed(3), a: turns - lapsOf(r) * ph, m: 0.3 })
						drag = { k: state.planets.length - 1, grow: true, moved: 0, x0: e.px, y0: e.py }
					}
				} else if (e.type === 'move' && drag) {
					const p = state.planets[drag.k]
					const d = dist(drag.x0, drag.y0, e.px, e.py)
					drag.moved = Math.max(drag.moved, d)
					if (drag.grow) p.m = +clamp(0.3 + d / (R(e.w, e.h) * 0.5), 0, 1).toFixed(3)
					else {
						const { r, turns } = polar(e)
						p.r = +r.toFixed(3)
						p.a = turns - lapsOf(r) * ph
					}
				} else if (e.type === 'up' && drag) {
					if (!drag.grow && drag.moved < 5) state.planets.splice(drag.k, 1)
					drag = null
				}
			}),
			step(i, time, dur) {
				const slotDur = (dur * clock.steps) / SLOTS
				subSlots(i, time, dur, clock.steps, (s, t) => {
					const p0 = s / SLOTS,
						p1 = (s + 1) / SLOTS
					state.planets.forEach((p, k) => {
						const n = lapsOf(p.r)
						// crossings of the meridian: a + n*ph = integer
						for (let c = Math.ceil(p.a + n * p0); (c - p.a) / n < p1; c++) {
							let ph = (c - p.a) / n
							if (params.snap) ph = Math.round(ph * clock.steps) / clock.steps
							const tt = Math.max(t, t + (ph - p0) * SLOTS * slotDur)
							const deg = Math.round((1 - p.m) * params.range)
							engine.voices.marimba(out, {
								freq: mtof(engine.degree(deg, params.octave)),
								time: tt,
								gain: 0.12 + p.m * 0.12,
								d: params.decay,
							})
							fx.hit(k, tt)
						}
					})
				})
			},
			frame(g, w, h, clock, shape) {
				size[0] = w
				size[1] = h
				if (isStrip(w, h, shape)) return frameStrip(g, w, h, view(clock))
				const t = view(clock)
				const ph = ((t.phase % 1) + 1) % 1
				const RR = R(w, h)
				const cx = w / 2,
					cy = h / 2
				g.strokeStyle = th.dim
				g.beginPath()
				g.moveTo(cx, cy)
				g.lineTo(cx, cy - RR * 1.04)
				g.stroke()
				g.fillStyle = th.fg
				g.beginPath()
				g.arc(cx, cy, Math.max(3, RR * 0.03), 0, TAU)
				g.fill()
				state.planets.forEach((p, k) => {
					g.strokeStyle = th.faint
					g.beginPath()
					g.arc(cx, cy, p.r * RR, 0, TAU)
					g.stroke()
					const [x, y] = where(p, ph, w, h)
					const glow = fx.glow(k, t.now, 0.4)
					const size = 3 + p.m * RR * 0.07
					g.fillStyle = glow ? th.accent : th.fg
					g.beginPath()
					g.arc(x, y, size * (1 + glow * 0.3), 0, TAU)
					g.fill()
					g.fillStyle = th.dim
					g.font = `${Math.max(9, RR / 22)}px ${th.font}`
					g.fillText(String(lapsOf(p.r)), x + size + 3, y + 3)
				})
			},
			setState(s) {
				state.planets = s.planets.map((p) => ({ ...p }))
			},
			clear() {
				state.planets = []
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
		}
	},
}
