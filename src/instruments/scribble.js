// 06 Scribble: scribble anywhere; it replays in stroke order once per loop.
// x picks the vowel (oo, ah, ee), y the pitch, and the stroke's speed its grain: fast scribbles crackle fine, slow ones swell.
import { kit, mtof } from './lib/kit.js'
import {
	withPointer,
	view,
	theme,
	subSlots,
	SLOTS,
	clamp,
	dist,
	flashes,
	TAU,
	tint,
} from './lib/util.js'

const MAX_PTS = 400
const SRC_SECONDS = 3
const F0 = 110
// grain length from stroke speed, in sheet-widths a second: a slow drag swells, a fast scribble crackles
const SLOW = 0.1,
	FAST = 1.6,
	COARSE = 0.32,
	FINE = 0.022
export function grainOf(speed) {
	const u = clamp(Math.log(Math.max(speed, 1e-3) / SLOW) / Math.log(FAST / SLOW), 0, 1)
	return +(COARSE * (FINE / COARSE) ** u).toFixed(3)
}

function vowelBuffer(audio) {
	const sr = audio.sampleRate
	const len = Math.floor(sr * SRC_SECONDS)
	const buf = audio.createBuffer(1, len, sr)
	const d = buf.getChannelData(0)
	const F = [
		[300, 870],
		[730, 1090],
		[270, 2290],
	] // oo, ah, ee
	const lerp = (a, b, t) => a + (b - a) * t
	const formants = (u) => {
		const seg = u < 0.5 ? 0 : 1
		const t = u < 0.5 ? u * 2 : (u - 0.5) * 2
		return [lerp(F[seg][0], F[seg + 1][0], t), lerp(F[seg][1], F[seg + 1][1], t)]
	}
	const H = 36
	const phase = new Float64Array(H)
	let peak = 0
	for (let i = 0; i < len; i++) {
		const u = i / len
		const [f1, f2] = formants(u)
		let v = 0
		const vib = 1 + 0.004 * Math.sin((TAU * 5.2 * i) / sr)
		for (let h = 1; h <= H; h++) {
			const f = F0 * h
			const a =
				Math.exp(-(((f - f1) / 120) ** 2)) + 0.6 * Math.exp(-(((f - f2) / 180) ** 2)) + 0.02 / h
			phase[h - 1] += (TAU * f * vib) / sr
			v += a * Math.sin(phase[h - 1])
		}
		v += (Math.random() * 2 - 1) * 0.02
		d[i] = v
		peak = Math.max(peak, Math.abs(v))
	}
	for (let i = 0; i < len; i++) d[i] /= peak
	return buf
}

function gen() {
	const pts = []
	let x = Math.random(),
		y = Math.random(),
		a = Math.random() * TAU
	for (let k = 0; k < 120; k++) {
		a += (Math.random() - 0.5) * 1.2
		x = clamp(x + Math.cos(a) * 0.03, 0, 1)
		y = clamp(y + Math.sin(a) * 0.03, 0, 1)
		pts.push([+x.toFixed(3), +y.toFixed(3), k === 0 ? 1 : 0])
	}
	return { pts }
}

export default {
	id: 'scribble',
	glyph: '<path d="M4 21c3-11 6 6 8-5s4 11 7 0 3 9 9-7"/>',
	name: 'Scribble',
	playhead: false,
	how: 'Scribble anywhere. The drawing replays once per loop in stroke order; left is oo, right is ee, height is pitch, and a fast scribble crackles where a slow one swells. The eraser or Shift rubs it out.',
	demo: () => [
		Array.from({ length: 30 }, (_, k) => [
			0.15 + k * 0.022 + 0.06 * Math.sin(k * 0.9),
			0.5 + 0.2 * Math.sin(k * 0.55) * Math.cos(k * 0.21),
		]),
	],
	params: {
		range: { value: 10, min: 3, max: 16, step: 1 },
		octave: { value: 0, min: -2, max: 1, step: 1 },
		density: { value: 2, min: 1, max: 4, step: 1 },
		grain: { value: 0.09, min: 0.02, max: 0.4, step: 0.005 },
		jitter: { value: 0.02, min: 0, max: 0.3, step: 0.005 },
		level: { value: 0.22, min: 0, max: 0.6, step: 0.01 },
	},
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { pts: [] } // [x, y, strokeStart, grain]: a stroke's first point carries its grain; older ones lack it and use params.grain
		const src = vowelBuffer(audio)
		const fx = flashes()
		let last = null
		let stroke = null // the stroke being drawn: { head, dist, t0 }

		// each point's grain: its stroke head's, else the d knob
		function grains() {
			let gr = params.grain
			return state.pts.map((p) => (p[2] ? (gr = p[3] ?? params.grain) : gr))
		}
		// a stroke's speed so far sets its grain, written on its first point
		function pace(head, d, t0) {
			const s = (performance.now() - t0) / 1000
			if (s > 0.05) head[3] = grainOf(d / s)
		}

		// a gap starts a new stroke, which keeps the grain it was cut from
		function rub(e) {
			const r = Math.min(e.w, e.h) * 0.045
			const gs = grains()
			let cut = false
			state.pts = state.pts.filter((p, k) => {
				if (dist(p[0] * e.w, p[1] * e.h, e.px, e.py) < r) return !(cut = true)
				if (cut) {
					p[2] = 1
					if (gs[k] !== params.grain || p[3] !== undefined) p[3] = gs[k]
					cut = false
				}
				return true
			})
		}

		function grain(x, y, time, d) {
			const s = audio.createBufferSource()
			s.buffer = src
			const deg = Math.round((1 - y) * params.range)
			s.playbackRate.value = mtof(engine.degree(deg, params.octave)) / F0
			const g = audio.createGain()
			g.gain.setValueAtTime(0, time)
			g.gain.linearRampToValueAtTime(params.level, time + d * 0.4)
			g.gain.linearRampToValueAtTime(0, time + d)
			s.connect(g).connect(out)
			const off = clamp(x + (Math.random() - 0.5) * params.jitter, 0, 0.98) * SRC_SECONDS
			s.start(time, off)
			s.stop(time + d + 0.01)
		}

		return {
			state,
			pointer: withPointer(size, (e) => {
				if (e.alt) {
					if (e.type === 'down' || (e.type === 'move' && e.pressed)) rub(e)
					last = null
					return
				}
				if (e.type === 'down') {
					last = [e.px, e.py]
					const head = [clamp(e.x, 0, 1), clamp(e.y, 0, 1), 1, grainOf(SLOW)]
					stroke = { head, d: 0, t0: performance.now() }
					state.pts.push(head)
				} else if (e.type === 'move' && e.pressed && last) {
					const step = dist(last[0], last[1], e.px, e.py)
					if (step < Math.min(e.w, e.h) * 0.012) return
					last = [e.px, e.py]
					state.pts.push([clamp(e.x, 0, 1), clamp(e.y, 0, 1), 0])
					if (stroke) {
						stroke.d += step / Math.max(e.w, e.h)
						pace(stroke.head, stroke.d, stroke.t0)
					}
				} else if (e.type === 'up') last = stroke = null
				if (state.pts.length > MAX_PTS) {
					const gs = grains()
					const cut = state.pts.length - MAX_PTS
					state.pts.splice(0, cut)
					state.pts[0][2] = 1
					state.pts[0][3] = gs[cut]
				}
			}),
			step(i, time, dur) {
				const N = state.pts.length
				if (!N) return
				const gs = grains()
				subSlots(i, time, dur, clock.steps, (s, t) => {
					const a = Math.ceil((s * N) / SLOTS),
						b = Math.ceil(((s + 1) * N) / SLOTS)
					const span = b - a
					if (span <= 0) return
					const n = Math.min(params.density, span)
					for (let k = 0; k < n; k++) {
						const idx = a + Math.floor((k * span) / n)
						const p = state.pts[idx]
						const tt = t + (k * dur) / (SLOTS / clock.steps) / n
						grain(p[0], p[1], tt, gs[idx])
						fx.hit(idx, tt)
					}
				})
			},
			frame(g, w, h, clock) {
				size[0] = w
				size[1] = h
				const t = view(clock)
				const N = state.pts.length
				// the vowels along the bottom, as mouths: a pursed oo, an open ah, a wide ee
				g.strokeStyle = th.faint
				g.lineWidth = 1.4
				const m0 = Math.max(4, h / 50)
				for (const [x, rx, ry] of [
					[14, m0 * 0.7, m0 * 0.7],
					[w / 2, m0, m0 * 1.3],
					[w - 14 - m0 * 1.5, m0 * 1.5, m0 * 0.35],
				]) {
					g.beginPath()
					g.ellipse(x, h - 10 - m0, rx, ry, 0, 0, Math.PI * 2)
					g.stroke()
				}
				// coarse grains draw a fat soft line, fine ones a thin bright one
				const gs = grains()
				const m = Math.min(w, h)
				g.lineCap = 'round'
				g.lineJoin = 'round'
				let k = 0
				while (k < N) {
					let j = k + 1
					while (j < N && !state.pts[j][2]) j++
					const u = clamp((gs[k] - FINE) / (COARSE - FINE), 0, 1)
					g.strokeStyle = tint(th.fg, 0.75 - u * 0.5)
					g.lineWidth = Math.max(0.6, m * (0.002 + u * 0.016))
					g.beginPath()
					g.moveTo(state.pts[k][0] * w, state.pts[k][1] * h)
					for (let i = k + 1; i < j; i++) g.lineTo(state.pts[i][0] * w, state.pts[i][1] * h)
					if (j === k + 1) g.lineTo(state.pts[k][0] * w + 0.1, state.pts[k][1] * h)
					g.stroke()
					k = j
				}
				for (let k = 0; k < N; k++) {
					const glow = fx.glow(k, t.now, 0.5)
					if (!glow) continue
					const [x, y] = state.pts[k]
					g.fillStyle = tint(th.accent, glow)
					g.beginPath()
					g.arc(x * w, y * h, 2 + (1 - glow) * Math.min(w, h) * 0.03, 0, TAU)
					g.fill()
				}
				if (N && t.playing) {
					const [x, y] = state.pts[Math.min(N - 1, Math.floor(t.phase * N))]
					g.fillStyle = th.fg
					g.beginPath()
					g.arc(x * w, y * h, 3, 0, TAU)
					g.fill()
				}
			},
			setState(s) {
				state.pts = s.pts.map((p) => p.slice())
			},
			clear() {
				state.pts = []
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
		}
	},
}
