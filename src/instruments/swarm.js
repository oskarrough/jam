// 08 Swarm: fireflies fly fixed looping paths (same on every screen, from a seed).
// Draw wires across their paths; a firefly crossing one plays a note set by its height.
// Tap the dark to let a firefly go from under your finger; tap one to catch it.
import { rub } from './lib/erase.js'
import { kit, mtof } from './lib/kit.js'
import { SEAT_COLORS } from '../palette.js'
import {
	withPointer,
	view,
	theme,
	subSlots,
	SLOTS,
	clamp,
	rng,
	intersect,
	segDist,
	flashes,
	tint,
	isStrip,
	TAU,
} from './lib/util.js'
import { line } from './lib/demo.js'

const MAX_WIRES = 8
const MAX_FLIES = 24

function gen() {
	return {
		wires: Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => {
			const y = Math.random(),
				x = Math.random() * 0.6
			return [
				x,
				y,
				x + 0.2 + Math.random() * 0.3,
				clamp(y + (Math.random() - 0.5) * 0.3, 0, 1),
			].map((v) => +v.toFixed(3))
		}),
	}
}

const FORMS = ['circle', 'triangle', 'square']
const PIG = {
	violet: SEAT_COLORS[0],
	green: SEAT_COLORS[1],
	pink: SEAT_COLORS[2],
	blue: SEAT_COLORS[3],
	ochre: SEAT_COLORS[4],
	red: SEAT_COLORS[5],
}
const FORM_PIG = { circle: 'blue', triangle: 'ochre', square: 'red' }
const PLANES = [PIG.violet, PIG.blue, PIG.green, PIG.pink, PIG.red, PIG.ochre]

// seeded, so every peer derives the same swarm
export function makeFlies(seed, count) {
	const r = rng(seed * 7919)
	return Array.from({ length: count }, () => ({
		a: 1 + Math.floor(r() * 3),
		b: 1 + Math.floor(r() * 3),
		p: r() * TAU,
		q: r() * TAU,
		ax: 0.3 + r() * 0.16,
		ay: 0.3 + r() * 0.16,
	}))
}
// The swarm a state flies: its own list of [template, p, q] once anyone has released or caught a firefly,
// else (older parts, robots) the first `count` from the seed. Templates are the seed's flies, so a list
// made from the default swarm flies exactly as it did.
export function fliesOf(st, seed, count) {
	if (!Array.isArray(st?.flies)) return makeFlies(seed, count).map((f, k) => ({ ...f, k }))
	const T = makeFlies(seed, MAX_FLIES)
	return st.flies.map(([k, p, q]) => ({ ...T[k % MAX_FLIES], k, p, q }))
}
export const flyPos = (f, ph) => [
	0.5 + f.ax * Math.sin(TAU * f.a * ph + f.p),
	0.5 + f.ay * Math.sin(TAU * f.b * ph + f.q),
]

export default {
	id: 'swarm',
	glyph:
		'<circle class="f" cx="8" cy="9" r="1.6"/><circle class="f" cx="22" cy="7" r="1.6"/><circle class="f" cx="13" cy="21" r="1.6"/><circle class="f" cx="25" cy="19" r="1.6"/><circle class="f" cx="17" cy="13" r="1.6"/><path d="M4 27L28 12"/>',
	name: 'Swarm',
	playhead: false,
	how: 'Drag to string a wire across the fireflies’ paths; tap a wire to cut it. Tap the dark to let a firefly go, tap one to catch it.',
	demo: () => [line(0.15, 0.3, 0.75, 0.62, 14)],
	params: {
		count: { value: 9, min: 1, max: 24, step: 1 },
		seed: { value: 7, min: 1, max: 99, step: 1 },
		range: { value: 10, min: 4, max: 16, step: 1 },
		poly: { value: 3, min: 1, max: 6, step: 1 },
		decay: { value: 0.35, min: 0.05, max: 1.5, step: 0.01 },
		trails: { value: true },
	},
	optional: ['flies'],
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		// wires [x1, y1, x2, y2]; flies [template, p, q] or null for the seed's default swarm
		const state = { wires: [], flies: null }
		const fx = flashes()
		let flies = []
		let flyKey = ''
		let draft = null
		const puffs = [] // { x, y, t, out }: a firefly let go (out) or caught

		function ensureFlies() {
			const k = `${params.seed}:${params.count}:${JSON.stringify(state.flies)}`
			if (k === flyKey) return
			flyKey = k
			flies = fliesOf(state, params.seed, params.count)
		}
		const pos = flyPos
		// where the flies are on screen: the clock the sheet was last drawn with, which runs at the ear, not the scheduler
		let seen = clock
		const phaseNow = () => view(seen).phase

		// the phase that puts sin(TAU*n*ph + p) at v, picking either crossing so flies leave both ways
		const through = (v, n, ph) => {
			const a = Math.asin(clamp(v, -1, 1))
			return +(((Math.random() < 0.5 ? a : Math.PI - a) - TAU * n * ph + TAU * 8) % TAU).toFixed(3)
		}
		function tapFly(e) {
			ensureFlies()
			const ph = phaseNow()
			const m = Math.min(e.w, e.h)
			let best = -1,
				bd = Math.max(18, m * 0.05)
			// they're quick, so a tap on the head or the near end of its tail counts
			flies.forEach((f, i) => {
				for (let k = 0; k <= 5; k++) {
					const [x, y] = pos(f, ph - k * 0.005)
					const d = Math.hypot(x * e.w - e.px, y * e.h - e.py)
					if (d < bd) {
						bd = d
						best = i
					}
				}
			})
			const list = flies.map((f) => [f.k, +f.p.toFixed(3), +f.q.toFixed(3)])
			if (best >= 0) {
				const [x, y] = pos(flies[best], ph)
				puffs.push({ x, y, t: performance.now(), out: false })
				list.splice(best, 1)
				state.flies = list
				return true
			}
			if (wireAt(e) >= 0) return false
			if (list.length >= MAX_FLIES) return true
			const used = new Set(list.map((f) => f[0]))
			let k = 0
			while (used.has(k) && k < MAX_FLIES - 1) k++
			const T = makeFlies(params.seed, MAX_FLIES)[k]
			const x = clamp(e.x, 0, 1),
				y = clamp(e.y, 0, 1)
			list.push([k, through((x - 0.5) / T.ax, T.a, ph), through((y - 0.5) / T.ay, T.b, ph)])
			puffs.push({ x, y, t: performance.now(), out: true })
			state.flies = list
			return true
		}
		const wireAt = (e) =>
			state.wires.findIndex(
				([a, b, c, d]) => segDist(e.px, e.py, a * e.w, b * e.h, c * e.w, d * e.h) < 12,
			)

		return {
			state,
			pointer: withPointer(size, (e) => {
				if (e.alt) {
					draft = null
					rub(e, state.wires, ([a, b, c, d]) =>
						segDist(e.px, e.py, a * e.w, b * e.h, c * e.w, d * e.h),
					)
					return
				}
				if (e.type === 'down') draft = { x1: e.x, y1: e.y, x2: e.x, y2: e.y, px: e.px, py: e.py }
				else if (e.type === 'move' && draft) {
					draft.x2 = clamp(e.x, 0, 1)
					draft.y2 = clamp(e.y, 0, 1)
				} else if (e.type === 'up' && draft) {
					const len = Math.hypot((draft.x2 - draft.x1) * e.w, (draft.y2 - draft.y1) * e.h)
					if (len < 8) {
						if (!tapFly(e)) state.wires.splice(wireAt(e), 1)
					} else {
						state.wires.push([draft.x1, draft.y1, draft.x2, draft.y2].map((v) => +v.toFixed(4)))
						if (state.wires.length > MAX_WIRES) state.wires.shift()
					}
					draft = null
				}
			}),
			step(i, time, dur) {
				ensureFlies()
				subSlots(i, time, dur, clock.steps, (s, t) => {
					const p0 = s / SLOTS,
						p1 = (s + 1) / SLOTS
					let n = 0
					flies.forEach((f) => {
						const [ax, ay] = pos(f, p0),
							[bx, by] = pos(f, p1)
						state.wires.forEach((wr, wi) => {
							if (n >= params.poly) return
							const u = intersect(ax, ay, bx, by, wr[0], wr[1], wr[2], wr[3])
							if (u === null) return
							const ym = (wr[1] + wr[3]) / 2
							const deg = Math.round((1 - ym) * params.range) + (f.k % 3 === 0 ? 2 : 0)
							const tt = t + (u * (dur * clock.steps)) / SLOTS
							const freq = mtof(engine.degree(deg, 0))
							const form = FORMS[f.k % FORMS.length]
							if (form === 'circle') {
								engine.voices.tone(out, {
									freq,
									time: tt,
									gain: 0.12,
									type: 'sine',
									d: params.decay * 1.4,
								})
								engine.voices.tone(out, {
									freq: freq * 2,
									time: tt,
									gain: 0.035,
									d: params.decay * 0.5,
								})
							} else if (form === 'triangle') {
								engine.voices.tone(out, {
									freq: freq * 2,
									time: tt,
									gain: 0.07,
									type: 'triangle',
									d: params.decay * 0.45,
									a: 0.001,
								})
								engine.voices.tone(out, { freq: freq * 6, time: tt, gain: 0.02, d: 0.04, a: 0.001 })
							} else {
								engine.voices.tone(out, {
									freq,
									time: tt,
									gain: 0.05,
									type: 'square',
									d: params.decay * 0.8,
									a: 0.01,
								})
								engine.voices.tone(out, {
									freq: freq / 2,
									time: tt,
									gain: 0.05,
									type: 'sine',
									d: params.decay,
								})
							}
							fx.hit(`w${wi}`, tt)
							fx.hit(`f${f.k}`, tt)
							n++
						})
					})
				})
			},
			frame(g, w, h, clock, shape) {
				size[0] = w
				size[1] = h
				ensureFlies()
				seen = clock
				const t = view(clock)
				const sheet = (shape || (isStrip(w, h) ? 'ring' : 'sheet')) === 'sheet'
				const ink = th.fg // the dark sheet inverts the seat canvas, so ink stays ink
				const m = Math.min(w, h)
				const U = sheet ? m : h // unit for sizes; on the thin ring everything shrinks to the strip
				g.lineCap = 'round'
				g.lineJoin = 'round'

				if (sheet) {
					const r = rng(params.seed * 31)
					const cx = (0.25 + r() * 0.5) * w,
						cy = (0.25 + r() * 0.5) * h,
						R = m * (0.22 + r() * 0.1)
					g.fillStyle = tint(PIG.blue, 0.1)
					g.beginPath()
					g.arc(cx, cy, R, 0, TAU)
					g.fill()
					g.strokeStyle = tint(ink, 0.18)
					g.lineWidth = 1
					g.beginPath()
					g.arc(cx, cy, R * 1.18, 0, TAU)
					g.stroke()
					g.fillStyle = tint(PIG.ochre, 0.12)
					g.beginPath()
					g.arc(cx + R * 0.35, cy - R * 0.2, R * 0.38, 0, TAU)
					g.fill()
				}

				state.wires.forEach(([a, b, c, d], wi) => {
					const x1 = a * w,
						y1 = b * h,
						x2 = c * w,
						y2 = d * h
					const len = Math.hypot(x2 - x1, y2 - y1) || 1
					const glow = fx.glow(`w${wi}`, t.now)
					const ym = (b + d) / 2
					const pig = PLANES[Math.round((1 - ym) * (PLANES.length - 1))]
					const ang = Math.atan2(y2 - y1, x2 - x1)
					g.fillStyle = tint(pig, 0.13 + glow * 0.18)
					g.beginPath()
					g.arc((x1 + x2) / 2, (y1 + y2) / 2, len / 2, ang, ang + Math.PI)
					g.fill()
					const wt = Math.max(1.5, U * (sheet ? 0.012 : 0.05)) * (1 + glow * 0.8)
					const nx = -(y2 - y1) / len,
						ny = (x2 - x1) / len
					g.fillStyle = glow ? pig : ink
					g.beginPath()
					g.moveTo(x1 + nx * wt, y1 + ny * wt)
					g.lineTo(x2 + nx * 0.4, y2 + ny * 0.4)
					g.lineTo(x2 - nx * 0.4, y2 - ny * 0.4)
					g.lineTo(x1 - nx * wt, y1 - ny * wt)
					g.closePath()
					g.fill()
					g.beginPath()
					g.arc(x1, y1, wt, 0, TAU)
					g.fill()
				})
				if (draft) {
					g.strokeStyle = ink
					g.lineWidth = 1
					g.setLineDash([4, 4])
					g.beginPath()
					g.moveTo(draft.x1 * w, draft.y1 * h)
					g.lineTo(draft.x2 * w, draft.y2 * h)
					g.stroke()
					g.setLineDash([])
				}

				// a firefly let go blooms out of your finger; a caught one folds into it
				const nowMs = performance.now()
				for (let k = puffs.length - 1; k >= 0; k--) {
					const p = puffs[k],
						u = (nowMs - p.t) / 600
					if (u >= 1) puffs.splice(k, 1)
					if (u >= 1 || !sheet) continue
					const e = 1 - (1 - u) ** 2,
						r = m * 0.08 * (p.out ? e : 1 - e) + 3
					g.strokeStyle = tint(ink, 0.8 * (1 - u))
					g.lineWidth = 2.5
					g.beginPath()
					g.arc(p.x * w, p.y * h, r, 0, TAU)
					g.stroke()
					g.fillStyle = tint(ink, 0.9 * (1 - u))
					for (let j = 0; j < 8; j++) {
						const a = (j / 8) * TAU + u * (p.out ? 1 : -1),
							R = r * 1.35
						g.beginPath()
						g.arc(p.x * w + Math.cos(a) * R, p.y * h + Math.sin(a) * R, 2, 0, TAU)
						g.fill()
					}
				}

				flies.forEach((f) => {
					const form = FORMS[f.k % FORMS.length],
						pig = PIG[FORM_PIG[form]]
					const [x, y] = pos(f, t.phase)
					const glow = fx.glow(`f${f.k}`, t.now, 0.6)
					const s0 = Math.max(2, U * (sheet ? 0.018 : 0.11)) * (0.8 + (f.k % 4) * 0.15)
					const sz = s0 * (1 + glow * 0.7)
					if (params.trails) {
						for (let k = 0; k < 16; k++) {
							const [ax, ay] = pos(f, t.phase - k * 0.005),
								[bx, by] = pos(f, t.phase - (k + 1) * 0.005)
							g.strokeStyle = tint(ink, 0.35 * (1 - k / 16))
							g.lineWidth = Math.max(0.5, (sheet ? 2.2 : 1.2) * (1 - k / 16))
							g.beginPath()
							g.moveTo(ax * w, ay * h)
							g.lineTo(bx * w, by * h)
							g.stroke()
						}
					}
					if (glow && sheet) {
						g.strokeStyle = tint(pig, glow * 0.8)
						g.lineWidth = 1.5
						g.beginPath()
						g.arc(x * w, y * h, sz + (1 - glow) * s0 * 4, 0, TAU)
						g.stroke()
					}
					g.save()
					g.translate(x * w, y * h)
					g.rotate(t.phase * TAU * (f.k % 2 ? 1 : -1) * (form === 'circle' ? 0 : 1) + f.k)
					g.beginPath()
					if (form === 'circle') g.arc(0, 0, sz, 0, TAU)
					else if (form === 'triangle') {
						g.moveTo(0, -sz * 1.25)
						g.lineTo(sz * 1.05, sz * 0.75)
						g.lineTo(-sz * 1.05, sz * 0.75)
						g.closePath()
					} else g.rect(-sz * 0.8, -sz * 0.8, sz * 1.6, sz * 1.6)
					g.fillStyle = glow ? pig : tint(pig, 0.85)
					g.fill()
					g.strokeStyle = ink
					g.lineWidth = sheet ? 1.3 : 0.9
					g.stroke()
					if (form === 'circle' && sz > 4) {
						g.fillStyle = tint(PIG.ochre, 0.95)
						g.beginPath()
						g.arc(sz * 0.18, -sz * 0.12, sz * 0.45, 0, TAU)
						g.fill()
						g.fillStyle = ink
						g.beginPath()
						g.arc(sz * 0.18, -sz * 0.12, sz * 0.15, 0, TAU)
						g.fill()
					}
					g.restore()
				})
			},
			setState(s) {
				state.wires = s.wires.map((x) => x.slice())
				state.flies = Array.isArray(s.flies)
					? s.flies.slice(0, MAX_FLIES).map((f) => f.slice())
					: null
			},
			clear() {
				state.wires = []
				state.flies = null
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
		}
	},
}
