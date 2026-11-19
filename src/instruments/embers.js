// 10 Embers: tap the dark to throw a spark; it pops on the next step as a tuned crackle.
// Sparks keep popping each loop until they burn out. Blow on the fire (a fast upward drag)
// and the sparks near your stroke flare up and live again.
import { rub } from './lib/erase.js'
import { kit, mtof } from './lib/kit.js'
import {
	withPointer,
	view,
	absNow,
	absOf,
	theme,
	SLOTS,
	clamp,
	dist,
	TAU,
	tint,
	isStrip,
} from './lib/util.js'
import { tap, line } from './lib/demo.js'

const MAX = 48
const FLIGHT = 0.45 // seconds a spark takes to rise

// born null = lit just now; setState stamps it
function gen(steps = 16) {
	const per = SLOTS / steps
	return {
		sparks: Array.from({ length: 7 }, () => ({
			s: Math.floor(Math.random() * steps) * per,
			x: +(0.15 + Math.random() * 0.7).toFixed(3),
			y: +(0.1 + Math.random() * 0.7).toFixed(3),
			born: null,
		})),
	}
}

export default {
	id: 'embers',
	glyph:
		'<path class="f" d="M16 22l2 3-2 3-2-3zM10 13l1.5 2.2L10 17.5 8.5 15.2zM21 7l1.5 2.2L21 11.5 19.5 9.2z"/><path d="M11 28c3-2 7-2 10 0"/>',
	name: 'Embers',
	trim: 14,
	how: 'Tap or drag in the dark above the fire to throw sparks. Each one pops on the grid and fades after a few loops; flick upward fast to blow on them and bring them back.',
	playhead: false, // across is where a spark flies, not when it pops
	demo: () => [tap(0.3, 0.3), tap(0.62, 0.5), tap(0.45, 0.18), line(0.2, 0.6, 0.7, 0.4, 8)],
	params: {
		life: { value: 4, min: 0, max: 16, step: 1 },
		range: { value: 10, min: 3, max: 16, step: 1 },
		crackle: { value: 0.35, min: 0, max: 1, step: 0.01 },
		tone: { value: 0.5, min: 0, max: 1, step: 0.01 },
	},
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { sparks: [] } // {s: slot, x, y, born: loop}
		let lastThrow = null,
			lastMove = null,
			gust = -1 // gust: audio time of the last blow

		function pop(sp, time) {
			const deg = Math.round((1 - sp.y) * params.range)
			const pan = (sp.x - 0.5) * 1.6
			engine.voices.noise(out, {
				time,
				freq: 300 + (1 - sp.y) * 6000,
				q: 2.5,
				gain: 0.35,
				d: 0.03 + sp.y * 0.08,
				pan,
			})
			if (params.tone > 0) {
				engine.voices.tone(out, {
					freq: mtof(engine.degree(deg, 1)),
					time,
					gain: 0.1 * params.tone,
					d: 0.12,
					type: 'sine',
				})
			}
		}

		function throwAt(x, y) {
			const stepsPerSlot = SLOTS / clock.steps
			// the first step boundary at least FLIGHT/2 ahead
			const a = absNow(clock) + FLIGHT / 2 / clock.stepDur
			const target = Math.ceil(a)
			const sp = {
				s: (((target % clock.steps) + clock.steps) % clock.steps) * stepsPerSlot,
				x: +clamp(x, 0, 1).toFixed(3),
				y: +clamp(y, 0, 0.85).toFixed(3),
				born: Math.floor(target / clock.steps),
			}
			if (clock.playing ?? true) pop(sp, clock.startTime + target * clock.stepDur)
			state.sparks.push(sp)
			if (state.sparks.length > MAX) state.sparks.shift()
		}

		// sparks within reach of the stroke, or all of them under it, flare and start a fresh life
		function blow(x, y) {
			const loop = Math.floor(absNow(clock) / clock.steps)
			let any = false
			for (const sp of state.sparks)
				if (Math.abs(sp.x - x) < 0.3 && sp.y < y + 0.2 && sp.born < loop - 1) {
					sp.born = loop - 1
					any = true
				}
			const now = audio.currentTime
			if (now - gust > 0.35) {
				gust = now
				engine.voices.noise(out, {
					time: now,
					freq: 500 + (1 - y) * 900,
					q: 0.7,
					gain: any ? 0.22 : 0.12,
					d: 0.45,
					pan: (x - 0.5) * 1.2,
				})
			}
		}

		return {
			state,
			pointer: withPointer(size, (e) => {
				if (e.alt) {
					lastThrow = lastMove = null
					rub(e, state.sparks, (sp) => dist(sp.x * e.w, sp.y * e.h, e.px, e.py))
					return
				}
				const t = performance.now()
				if (e.type === 'down') {
					throwAt(e.x, e.y)
					lastThrow = [e.px, e.py]
					lastMove = { px: e.px, py: e.py, t, blowing: false }
				} else if (e.type === 'move' && e.pressed && lastThrow) {
					// fast and mostly upward: a blow, not a throw
					const m = Math.min(e.w, e.h),
						dt = Math.max(1, t - lastMove.t),
						up = (((lastMove.py - e.py) / dt) * 1000) / m
					if (up > 1.6 && Math.abs(e.px - lastMove.px) < (lastMove.py - e.py) * 1.2) {
						blow(e.x, e.y)
						lastMove.blowing = true
					} else if (!lastMove.blowing && dist(lastThrow[0], lastThrow[1], e.px, e.py) > m * 0.08) {
						throwAt(e.x, e.y)
						lastThrow = [e.px, e.py]
					}
					lastMove = { ...lastMove, px: e.px, py: e.py, t }
				} else if (e.type === 'up') {
					lastThrow = null
					lastMove = null
				}
			}),
			step(i, time) {
				const abs = absOf(clock, time)
				const loop = Math.floor(abs / clock.steps)
				if (params.life > 0)
					state.sparks = state.sparks.filter((sp) => loop - sp.born <= params.life)
				const per = SLOTS / clock.steps
				for (const sp of state.sparks) {
					if (sp.born >= loop) continue // already popped live this loop
					if (Math.floor(sp.s / per) !== i) continue
					pop(sp, time)
				}
				const heat = Math.min(1, state.sparks.length / 12)
				if (Math.random() < params.crackle * (0.15 + heat * 0.6)) {
					engine.voices.noise(out, {
						time: time + Math.random() * 0.05,
						freq: 2500 + Math.random() * 4000,
						q: 4,
						gain: 0.08 * params.crackle,
						d: 0.012,
						pan: (Math.random() - 0.5) * 0.4,
					})
				}
			},
			frame(g, w, h, clock, shape) {
				size[0] = w
				size[1] = h
				const t = view(clock)
				const loopDur = clock.stepDur * clock.steps
				// everything scales with the sheet, so sparks read as sparks when zoomed in
				const k = clamp(Math.min(w, h) / 150, 1, 4)
				const strip = isStrip(w, h, shape)
				const fx = w / 2,
					fy = h * 0.96
				const heat = Math.min(1, state.sparks.length / 12)
				const flare = gust >= 0 ? Math.max(0, 1 - (audio.currentTime - gust) / 0.8) : 0
				g.lineCap = 'round'
				const tongues = strip ? 7 : 11
				for (let j = 0; j < tongues; j++) {
					const off = (j - (tongues - 1) / 2) * Math.min(w, h) * (strip ? 0.02 : 0.016)
					const hh =
						h *
						(0.07 + heat * 0.15 + flare * 0.2) *
						(0.6 + 0.4 * Math.sin(t.now * (7 + j) + j * 1.7))
					const sway = Math.sin(t.now * 5 + j) * 4 * k
					g.lineWidth = (j % 3 ? 1 : 1.6) * k
					g.strokeStyle = j % 3 ? th.dim : th.accent
					g.beginPath()
					g.moveTo(fx + off, fy)
					g.quadraticCurveTo(fx + off * 0.5 + sway, fy - hh * 0.6, fx + off * 0.2, fy - hh)
					g.stroke()
				}
				g.lineWidth = k
				g.strokeStyle = th.dim
				g.beginPath()
				g.moveTo(fx - w * 0.09, fy + k)
				g.lineTo(fx + w * 0.09, fy + k)
				g.stroke()
				const loop = Math.floor(t.abs / t.steps)
				for (const sp of state.sparks) {
					const life = params.life > 0 ? 1 - Math.max(0, loop - sp.born) / (params.life + 1) : 1
					const tx = sp.x * w,
						ty = sp.y * h
					// seconds since this spark popped, wrapped
					let since = ((((t.phase - sp.s / SLOTS) % 1) + 1) % 1) * loopDur
					if (loop < sp.born || (loop === sp.born && t.phase < sp.s / SLOTS)) since = -1
					const until = loopDur - since
					if (t.playing && since >= 0 && until < FLIGHT && until > 0) {
						const u = 1 - until / FLIGHT
						const x = fx + (tx - fx) * u + Math.sin(u * 9 + sp.x * 20) * 4 * k * (1 - u)
						const y = fy + (ty - fy) * (1 - (1 - u) * (1 - u))
						g.fillStyle = th.accent
						g.beginPath()
						g.arc(x, y, 2.5 * k, 0, TAU)
						g.fill()
					}
					if (t.playing && since >= 0 && since < 0.5) {
						const u = since / 0.5
						g.strokeStyle = tint(th.accent, (1 - u) * life)
						g.lineWidth = 1.2 * k
						for (let j = 0; j < 6; j++) {
							const a = (j / 6) * TAU + sp.x * 10
							const r1 = (3 + u * 16) * k,
								r2 = r1 + 4 * k
							g.beginPath()
							g.moveTo(tx + Math.cos(a) * r1, ty + Math.sin(a) * r1)
							g.lineTo(tx + Math.cos(a) * r2, ty + Math.sin(a) * r2)
							g.stroke()
						}
					}
					// a live spark is a coal: accent heart, ink rim; it greys and shrinks as it dies
					const r = (1.4 + life * 2.2) * k
					g.fillStyle = life > 0.5 ? th.accent : tint(th.fg, 0.25 + 0.5 * life)
					g.beginPath()
					g.arc(tx, ty, r, 0, TAU)
					g.fill()
					g.strokeStyle = tint(th.fg, 0.3 + 0.6 * life)
					g.lineWidth = Math.max(1, k * 0.6)
					g.stroke()
				}
			},
			setState(s) {
				const loop = Math.floor(absNow(clock) / clock.steps)
				state.sparks = s.sparks.map((p) => ({ ...p, born: p.born ?? loop - 1 }))
			},
			clear() {
				state.sparks = []
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
		}
	},
}
