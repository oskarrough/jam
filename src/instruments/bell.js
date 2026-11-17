// Bell: marbles. Tap for one bell. Press and drag up to drop a marble from higher: it lands where you
// pressed, then bounces, ringing the same bell on every bounce, each one quicker and quieter, off the grid.
//
// state = { marbles } 't,y,h;…' (a string, so the engine's loop-length resize leaves it alone)
//   t  where it first lands, 0..1 of the loop    y  pitch, 0 low .. 1 high    h  drop height, 0 (a tap) .. 1

import { voice as jukebox } from './lib/voices.js'
import { voiced } from './lib/voiced.js'
import { kit } from './lib/kit.js'
import {
	mtof,
	env,
	osc,
	val,
	rgba,
	clamp,
	withPointer,
	isStrip,
	flashes,
	dist,
} from './lib/util.js'
import { rub } from './lib/erase.js'
import { INK } from '../palette.js'

const MAX = 32
const RANGE = 9 // degrees from low to high
const E = 0.7 // each bounce's gap is this much of the last
const PAD = 0.03

export const parseMarbles = (s) =>
	(typeof s === 'string' ? s : '')
		.split(';')
		.filter(Boolean)
		.slice(0, MAX)
		.map((m) => {
			const [t, y, h] = m.split(',').map(Number)
			return { t: ((t % 1) + 1) % 1 || 0, y: clamp(y || 0, 0, 1), h: clamp(h || 0, 0, 1) }
		})
export const marblesOf = (list) =>
	list.map((m) => [+m.t.toFixed(4), +m.y.toFixed(3), +m.h.toFixed(3)].join(',')).join(';')

// every strike of one marble, in steps after its landing: { at, k bounce number, gap to the next }
export function strikes(m, steps) {
	const out = [{ at: 0, k: 0, gap: 0 }]
	let gap = m.h * Math.min(8, steps * 0.4),
		at = 0
	for (let k = 1; m.h > 0 && gap > 0.45 && k < 12; k++) {
		out[k - 1].gap = gap
		at += gap
		out.push({ at, k, gap: 0 })
		gap *= E
	}
	return out
}

function gen() {
	const list = []
	const n = 3 + Math.floor(Math.random() * 3)
	for (let k = 0; k < n; k++)
		list.push({
			t: Math.floor(Math.random() * 8) / 8,
			y: 0.2 + Math.random() * 0.7,
			h: Math.random() < 0.5 ? 0 : 0.3 + Math.random() * 0.7,
		})
	return { marbles: marblesOf(list) }
}
const SAMPLE = marblesOf([
	{ t: 0, y: 0.55, h: 0.7 },
	{ t: 0.375, y: 0.8, h: 0 },
	{ t: 0.5, y: 0.35, h: 0.45 },
	{ t: 0.8125, y: 0.65, h: 0.9 },
])

function fm({ audio: ac, out, params }, m, t, _d, vel = 0.7) {
	const f = mtof(m),
		g = ac.createGain(),
		mg = ac.createGain()
	env(g, t, 0.002, 0.17 * vel, 1.5)
	g.connect(out)
	const car = osc(ac, 'sine', f, t, 1.8, g)
	mg.gain.setValueAtTime(f * val(params.index) + 1, t)
	mg.gain.exponentialRampToValueAtTime(1, t + 0.7)
	osc(ac, 'sine', f * val(params.ratio), t, 1.8, mg)
	mg.connect(car.frequency)
}

const V = voiced(
	[
		['glock', jukebox('glock', -10.7)],
		['fm', fm],
		['marimba', jukebox('marimba', -7.2)],
		['celesta', jukebox('celesta', -12.0)],
		['music box', jukebox('musicbox', -12.0)],
	],
	{
		octave: { value: 0, min: -1, max: 1, step: 1 },
		ratio: { value: 3.5, min: 1, max: 8, step: 0.01 },
		index: { value: 2.2, min: 0, max: 8, step: 0.1 },
	},
)

export default {
	id: 'bell',
	glyph:
		'<path d="M4 26h24"/><path d="M6 6v4M6 13q4 -9 8 0q3 -6 6 0q2 -3 4 0q1-2 2 0" stroke-width="1.6"/><circle class="f" cx="6" cy="11" r="2.4"/>',
	name: 'Bell',
	how: 'Tap for a bell; higher is a higher note. Press and drag up to drop a marble from higher: it bounces, ringing on every bounce. Tap a marble to take it away; drag it to move it. Shift-drag erases.',
	voices: V.voices,
	params: V.params,
	optional: ['marbles'],
	demo: () => [Array.from({ length: 12 }, (_, k) => [0.2, 0.7 - k * 0.035]), [[0.62, 0.45]]],
	generate: () => gen(),
	sample: () => ({ marbles: SAMPLE }),
	create(ctx) {
		const { clock } = ctx
		const harmony = kit(ctx.audio)
		const size = [1, 1]
		const fx = flashes()
		let list = parseMarbles(SAMPLE)
		let g = null
		const midi = (m) => harmony.degree(Math.round(m.y * RANGE), 1 + val(ctx.params.octave))
		const geo = (w, h, strip) => {
			const iw = w * (1 - 2 * PAD)
			return {
				X: (steps) => w * PAD + (steps / clock.steps) * iw,
				Y: (y) => (strip ? (1 - y) * h * 0.8 + h * 0.1 : (1 - y) * h * 0.78 + h * 0.17),
				up: strip ? h * 0.3 : h * 0.3, // how high a full drop starts, in px
			}
		}
		const near = (e, m) => {
			const { X, Y } = geo(e.w, e.h, isStrip(e.w, e.h, e.shape))
			return dist(X(m.t * clock.steps), Y(m.y), e.px, e.py)
		}

		function pointer(e) {
			if (e.alt) {
				g = null
				rub(e, list, (m) => near(e, m))
				return
			}
			const x = clamp((e.x - PAD) / (1 - 2 * PAD), 0, 0.9999)
			const { up } = geo(e.w, e.h, isStrip(e.w, e.h, e.shape))
			const yOf = (py) =>
				clamp(1 - (py / e.h - (isStrip(e.w, e.h, e.shape) ? 0.1 : 0.17)) / 0.78, 0, 1)
			if (e.type === 'down') {
				const k = list.findIndex((m) => near(e, m) < 18)
				if (k >= 0) return (g = { mode: 'grab', k, x0: e.px, y0: e.py, moved: 0 })
				if (list.length >= MAX) list.shift()
				list.push({ t: Math.round(x * clock.steps) / clock.steps, y: yOf(e.py), h: 0 })
				g = { mode: 'drop', k: list.length - 1, y0: e.py }
				return
			}
			if (!g) return
			const m = list[g.k]
			if (e.type === 'up' || e.type === 'cancel') {
				if (g.mode === 'grab' && g.moved < 6 && e.type === 'up') list.splice(g.k, 1)
				g = null
				return
			}
			if (e.type !== 'move' || !m) return
			if (g.mode === 'drop') m.h = clamp((g.y0 - e.py) / up, 0, 1)
			else {
				g.moved = Math.max(g.moved, dist(g.x0, g.y0, e.px, e.py))
				if (g.moved >= 6) {
					m.t = Math.round(x * clock.steps) / clock.steps
					m.y = yOf(e.py)
				}
			}
		}

		return {
			get state() {
				return { marbles: marblesOf(list) }
			},
			setState(s) {
				if (typeof s?.marbles === 'string') list = parseMarbles(s.marbles)
				else if (Array.isArray(s?.notes)) {
					// a part saved by the old line-drawing bell: each note a tap
					const n = s.notes.length
					list = s.notes
						.flatMap((v, i) => (v >= 0 ? [{ t: i / n, y: clamp(v / 7, 0, 1), h: 0 }] : []))
						.slice(0, MAX)
				} else list = []
			},
			clear() {
				list = []
			},
			pointer: withPointer(size, pointer),
			step(i, time, dur) {
				const steps = clock.steps,
					fn = V.play(ctx)
				list.forEach((m, j) => {
					const t0 = m.t * steps
					for (const s of strikes(m, steps)) {
						// where this strike falls in the loop, wrapped
						const at = (((t0 + s.at - i) % steps) + steps) % steps
						if (at >= 1) continue
						const when = time + at * dur
						fn(ctx, midi(m), when, Math.max(1, s.gap || 2) * dur, 0.75 * Math.pow(0.74, s.k))
						fx.hit(j * 100 + s.k, when)
					}
				})
			},
			frame(gx, w, h, clock, shape) {
				size[0] = w
				size[1] = h
				const strip = isStrip(w, h, shape)
				const { X, Y, up } = geo(w, h, strip)
				const steps = clock.steps,
					pos = clock.pos(),
					now = clock.now()
				const color = ctx.color
				const lw = Math.max(1.2, Math.min(3, h * 0.035))
				gx.lineCap = 'round'
				gx.lineJoin = 'round'
				const r0 = Math.max(2.4, Math.min(8, h * 0.06))
				list.forEach((m, j) => {
					const t0 = m.t * steps,
						fy = Y(m.y),
						ss = strikes(m, steps)
					const g0 = ss[0].gap || 1
					// the path: a fall from its height, then shrinking hops, drawn once more a loop
					// earlier so hops that wrap past the end come round at the start
					for (const off of [0, -steps]) {
						const x0 = X(t0 + off)
						if (X(t0 + off + (ss.at(-1).at || 0)) < 0) continue
						for (const pass of [0, 1]) {
							gx.beginPath()
							if (m.h > 0) {
								gx.moveTo(x0, fy - m.h * up)
								gx.lineTo(x0, fy)
							}
							for (const s of ss) {
								if (!s.gap) continue
								const a = X(t0 + off + s.at),
									b = X(t0 + off + s.at + s.gap),
									peak = m.h * up * (s.gap / g0) ** 2
								gx.moveTo(a, fy)
								gx.quadraticCurveTo((a + b) / 2, fy - peak * 2, b, fy)
							}
							gx.strokeStyle = pass ? rgba(color, 0.8) : INK
							gx.lineWidth = pass ? lw : lw + 2
							gx.stroke()
						}
					}
					// strikes: a dot where each bounce rings, smaller as they go
					gx.lineWidth = 1.1
					for (const s of ss) {
						const x = X((t0 + s.at) % steps)
						const glow = fx.glow(j * 100 + s.k, now, 0.4)
						const r = r0 * Math.pow(0.86, s.k)
						if (glow && !strip) {
							gx.strokeStyle = rgba(INK, 0.6 * glow)
							gx.beginPath()
							gx.arc(x, fy, r + 3 + (1 - glow) * 8, 0, 6.283)
							gx.stroke()
						}
						gx.fillStyle = glow > 0.3 ? INK : color
						gx.strokeStyle = INK
						gx.beginPath()
						gx.arc(x, fy, r + glow * 2, 0, 6.283)
						gx.fill()
						gx.stroke()
					}
					// the marble, in flight
					if (m.h <= 0 || strip) return
					const d = (((pos - t0) % steps) + steps) % steps
					const last = ss.at(-1).at
					const F = Math.min(2, Math.max(0.5, steps - last - 1)) // steps it takes to fall
					let bx = X(t0),
						by = fy - m.h * up,
						a = 1
					if (d >= steps - F) {
						const f = (d - (steps - F)) / F
						by = fy - m.h * up * (1 - f * f)
					} else if (d <= last) {
						const s = ss.findLast((s) => s.at <= d) || ss[0]
						const f = s.gap ? (d - s.at) / s.gap : 0,
							peak = m.h * up * ((s.gap || 0) / g0) ** 2
						bx = X((t0 + s.at + (s.gap || 0) * f) % steps)
						by = fy - peak * 4 * f * (1 - f)
					} else a = 0.35 // waiting up high for the next drop
					gx.globalAlpha = a
					gx.fillStyle = PAPERISH
					gx.strokeStyle = INK
					gx.lineWidth = 1.6
					gx.beginPath()
					gx.arc(bx, by, r0 * 1.05, 0, 6.283)
					gx.fill()
					gx.stroke()
					gx.globalAlpha = 1
				})
			},
			dispose() {},
		}
	},
}

const PAPERISH = '#efe6f7'
