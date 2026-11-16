// 02 Grid: a pocket step sequencer. Tap a step to toggle it, drag to draw a value across steps.
// Words along the bottom pick pitch, length, loud or chance; drag the bracket to shorten the pattern (polymeter).
//
// state: { len, s: [step x16] }, step = 0 (off) or [pitch 0..14, length 0..9, loud 0..9, chance 0..9]
// Chance rolls are seeded by the absolute step, so every peer hears the same notes.
import { kit } from './lib/kit.js'
import { withPointer, absNow, absOf, clamp, flashes, tint, mtof, isStrip, TAU } from './lib/util.js'
import { INK, SANS } from '../palette.js'
import { tap, line } from './lib/demo.js'

const N = 16
const PMAX = 14
const PARAMS = ['pitch', 'length', 'loud', 'chance']
const MAXOF = { pitch: PMAX, length: 9, loud: 9, chance: 9 }
const IDX = { pitch: 0, length: 1, loud: 2, chance: 3 }
const fresh = (p = 7) => [p, 4, 7, 9]

// a stable 0..1 roll per absolute step, the same on every machine
const roll = (abs, k) => ((Math.imul((abs * 2654435761) ^ (k * 40503), 2246822519) >>> 0) % 10007) / 10007

function gen() {
	const len = [16, 16, 16, 12, 8, 6][Math.floor(Math.random() * 6)]
	const s = Array(N).fill(0)
	let p = 5 + Math.floor(Math.random() * 5)
	for (let k = 0; k < len; k++) {
		const strong = k % 4 === 0
		if (Math.random() > (strong ? 0.85 : 0.4)) continue
		p = clamp(p + Math.round((Math.random() - 0.5) * 5), 0, PMAX)
		s[k] = [p, strong ? 5 : 2 + Math.floor(Math.random() * 3), strong ? 8 : 5 + Math.floor(Math.random() * 3), strong || Math.random() < 0.6 ? 9 : 4 + Math.floor(Math.random() * 4)]
	}
	return { len, s }
}

function blob(g, x, y, rx, ry, seed) {
	g.beginPath()
	for (let k = 0; k <= 18; k++) {
		const a = (k / 18) * TAU
		const n = 1 + 0.06 * Math.sin(a * 3 + seed * 1.7) + 0.04 * Math.sin(a * 5 + seed)
		const px = x + Math.cos(a) * rx * n, py = y + Math.sin(a) * ry * n
		k ? g.lineTo(px, py) : g.moveTo(px, py)
	}
	g.closePath()
}

export default {
	id: 'grid',
	// columns are pattern steps, not loop phase, so the host playhead would lie; the playing step glows
	playhead: false,
	glyph: '<path class="f" d="M5 20h4v6H5zM11 12h4v14h-4zM17 17h4v9h-4z"/><path d="M23 9h4v17h-4z" stroke-dasharray="1.5 2"/><path d="M4 6h24" stroke-dasharray="1 3"/>',
	name: 'Grid',
	how: 'Tap a step to switch it. Drag to draw pitch, length, loud or chance (pick one along the bottom). Drag the bracket to shorten the pattern.',
	demo: () => [tap(0.03, 0.45), tap(0.28, 0.45), tap(0.53, 0.45), line(0.03, 0.3, 0.6, 0.6, 14)],
	params: {
		wave: { value: 'square', options: ['square', 'triangle', 'sawtooth', 'bell'] },
		octave: { value: 0, min: -2, max: 1, step: 1 },
		tone: { value: 0.55, min: 0, max: 1, step: 0.01 },
		swing: { value: 0, min: 0, max: 0.5, step: 0.01 },
	},
	generate: () => gen(),
	sample: () => gen(),
	create(ctx) {
		const { params, out, audio, clock } = ctx
		const engine = kit(audio)
		const size = [1, 1]
		let shape = 'ring'
		const state = { len: N, s: Array(N).fill(0) }
		const fx = flashes()
		const ui = { param: 'pitch' } // what a drag draws; local to this player
		let press = null

		function voice(st, time, dur) {
			const [p, d, v] = st
			const f = mtof(engine.degree(p, params.octave + 1))
			const len = 0.04 + (d / 9) ** 1.6 * 1.4
			const gain = 0.03 + (v / 9) * 0.16
			if (params.wave === 'bell') return engine.voices.bell(out, { freq: f, time, gain: gain * 0.9, d: len + 0.2, ratio: 3.5, index: 1.4 })
			const o = audio.createOscillator(), lp = audio.createBiquadFilter(), g = audio.createGain()
			o.type = params.wave
			o.frequency.value = f
			lp.type = 'lowpass'
			lp.Q.value = 3
			const top = f * (1.5 + params.tone * 14)
			lp.frequency.setValueAtTime(top, time)
			lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 0.9), time + len * 0.9)
			g.gain.setValueAtTime(0.0001, time)
			g.gain.exponentialRampToValueAtTime(gain, time + 0.004)
			g.gain.exponentialRampToValueAtTime(0.0001, time + len)
			o.connect(lp).connect(g).connect(out)
			o.start(time)
			o.stop(time + len + 0.05)
		}

		const loopStart = () => Math.floor(absNow(clock) / clock.steps) * clock.steps
		const ensure = (k) => (state.s[k] ||= fresh())
		function paint(k, y, erase) {
			if (erase) { state.s[k] = 0; return }
			const st = ensure(k)
			const max = MAXOF[ui.param]
			st[IDX[ui.param]] = clamp(Math.round((1 - y) * max), ui.param === 'chance' ? 1 : 0, max)
		}

		const BAND = 0.84
		const colOf = (x) => clamp(Math.floor(x * N), 0, N - 1)
		const tokenAt = (x) => PARAMS[clamp(Math.floor(x * PARAMS.length), 0, PARAMS.length - 1)]

		function sheetPointer(e) {
			const yy = clamp(e.y / BAND, 0, 1)
			if (e.type === 'down') {
				if (Math.abs(e.x * N - state.len) < 0.6) { press = { kind: 'len' }; return }
				if (e.y > BAND) { ui.param = tokenAt(e.x); press = null; return }
				press = { kind: 'step', k: colOf(e.x), x0: e.px, y0: e.py, moved: false, last: colOf(e.x), erase: e.alt }
			} else if (e.type === 'move' && press) {
				if (press.kind === 'len') { state.len = clamp(Math.round(e.x * N), 1, N); return }
				if (!press.moved && Math.hypot(e.px - press.x0, e.py - press.y0) < 6) return
				if (!press.moved) { press.moved = true; paint(press.k, yy, press.erase) }
				const k = colOf(e.x)
				const a = Math.min(k, press.last), b = Math.max(k, press.last)
				for (let j = a; j <= b; j++) paint(j, yy, press.erase)
				press.last = k
			} else if (e.type === 'up' && press) {
				if (press.kind === 'step' && !press.moved) state.s[press.k] = press.erase ? 0 : state.s[press.k] ? 0 : fresh(ui.param === 'pitch' ? Math.round((1 - yy) * PMAX) : 7)
				press = null
			}
		}

		// ring: x is the loop; drag draws pitch
		function ringPointer(e) {
			const kAt = (x) => (loopStart() + clamp(Math.floor(x * clock.steps), 0, clock.steps - 1)) % state.len
			if (e.type === 'down') press = { k: kAt(e.x), x0: e.px, y0: e.py, moved: false, erase: e.alt }
			else if (e.type === 'move' && press) {
				if (!press.moved && Math.hypot(e.px - press.x0, e.py - press.y0) < 6) return
				press.moved = true
				const k = kAt(e.x)
				if (press.erase) state.s[k] = 0
				else ensure(k)[0] = clamp(Math.round((1 - e.y) * PMAX), 0, PMAX)
			} else if (e.type === 'up' && press) {
				if (!press.moved) state.s[press.k] = press.erase || state.s[press.k] ? 0 : fresh(Math.round((1 - e.y) * PMAX))
				press = null
			}
		}

		function drawSheet(g, w, h, t) {
			const cw = w / N, top = h * BAND
			const ink = ctx.theme?.sheet?.ink || INK, col = ctx.color || '#c08419'
			const k0 = Math.floor(t.abs) % state.len
			g.lineCap = 'round'; g.lineJoin = 'round'
			if (ui.param !== 'pitch') {
				g.strokeStyle = tint(ink, 0.35); g.lineWidth = 1.2
				g.beginPath()
				let pen = false
				for (let k = 0; k < N; k++) {
					const st = state.s[k]
					if (!st) { pen = false; continue }
					const y = (1 - st[IDX[ui.param]] / MAXOF[ui.param]) * top * 0.92 + top * 0.04
					pen ? g.lineTo((k + 0.5) * cw, y) : g.moveTo((k + 0.5) * cw, y)
					pen = true
				}
				g.stroke()
			}
			for (let k = 0; k < N; k++) {
				const x = (k + 0.5) * cw, st = state.s[k], inPat = k < state.len
				const now = t.playing && k === k0
				if (now) { g.fillStyle = tint(col, 0.16); blob(g, x, top / 2, cw * 0.46, top * 0.5, k); g.fill() }
				g.strokeStyle = tint(ink, !inPat ? 0.08 : k % 4 === 0 ? 0.3 : 0.16)
				g.lineWidth = 1
				g.setLineDash([1, 4])
				g.beginPath(); g.moveTo(x, top * 0.04); g.lineTo(x, top * 0.96); g.stroke()
				g.setLineDash([])
				g.strokeStyle = tint(ink, inPat ? 0.6 : 0.2); g.lineWidth = 1.2
				g.beginPath()
				if (k % 4 === 0) for (let u = 0; u <= 1.001; u += 0.2) { const px = x - cw * 0.25 + u * cw * 0.5, py = top + 4 + Math.sin(u * 9 + k) * 1.5; u ? g.lineTo(px, py) : g.moveTo(px, py) }
				else { g.moveTo(x, top + 2); g.lineTo(x, top + 6) }
				g.stroke()
				if (!st) continue
				const [p, d, v, c] = st
				const y = (1 - p / PMAX) * top * 0.86 + top * 0.07
				const r = Math.max(3, Math.min(cw * 0.36, top * 0.06) * (0.55 + (v / 9) * 0.6))
				const glow = fx.glow(k, t.now, 0.3)
				g.strokeStyle = tint(col, inPat ? 0.9 : 0.3); g.lineWidth = Math.max(1.5, r * 0.45)
				g.beginPath(); g.moveTo(x, y); g.lineTo(x + (d / 9) * cw * 0.9 + 1, y); g.stroke()
				blob(g, x, y, r * (1 + glow * 0.35), r * (1 + glow * 0.35), k + 3)
				g.fillStyle = glow ? ink : tint(col, inPat ? 1 : 0.35)
				g.fill()
				g.strokeStyle = tint(ink, inPat ? 0.9 : 0.3); g.lineWidth = 1.2
				g.setLineDash(c < 9 ? [1.5, 2.5 + (9 - c) * 0.6] : [])
				g.stroke()
				g.setLineDash([])
				if (c < 9) {
					g.fillStyle = tint(ink, 0.55)
					g.font = `${Math.max(9, Math.min(13, cw * 0.28))}px ${SANS}`
					g.textAlign = 'center'; g.textBaseline = 'top'
					g.fillText(`${(c + 1) * 10}%`, x, top * 0.94)
				}
			}
			const bx = state.len * cw
			g.strokeStyle = ink; g.lineWidth = 2
			g.beginPath(); g.moveTo(bx - 6, 3); g.lineTo(bx, 3); g.lineTo(bx, top - 3); g.lineTo(bx - 6, top - 3); g.stroke()
			g.font = `600 ${Math.max(11, Math.min(16, h * 0.05))}px ${SANS}`
			g.textAlign = 'center'; g.textBaseline = 'middle'
			PARAMS.forEach((name, i) => {
				const x = ((i + 0.5) / PARAMS.length) * w, y = top + (h - top) / 2
				const on = name === ui.param
				g.fillStyle = tint(ink, on ? 1 : 0.45)
				g.fillText(name, x, y)
				if (on) {
					const tw = g.measureText(name).width
					g.strokeStyle = col; g.lineWidth = 2
					g.beginPath()
					for (let u = 0; u <= 1.001; u += 0.1) { const px = x - tw / 2 + u * tw, py = y + 10 + Math.sin(u * 14) * 1.6; u ? g.lineTo(px, py) : g.moveTo(px, py) }
					g.stroke()
				}
			})
			g.fillStyle = tint(ink, 0.45)
			g.textAlign = 'right'
			g.fillText(`${state.len}`, w - 4, top + (h - top) / 2)
		}

		function drawRing(g, w, h, t) {
			const n = clock.steps, cw = w / n, base = Math.floor(t.abs / n) * n
			const col = ctx.color || '#c08419'
			for (let s = 0; s < n; s++) {
				const k = (base + s) % state.len, st = state.s[k], x = (s + 0.5) * cw
				if (k === 0 && state.len !== n) { g.fillStyle = tint(INK, 0.25); g.fillRect(s * cw, 1, 1, h - 2) } // pattern restarts here
				if (!st) continue
				const [p, d, v, c] = st
				const y = (1 - p / PMAX) * h * 0.8 + h * 0.1
				const r = Math.max(1.8, Math.min(h * 0.09, cw * 0.35) * (0.6 + (v / 9) * 0.5))
				const glow = fx.glow(`a${(base + s) % 256}`, t.now, 0.3)
				g.strokeStyle = tint(col, 0.85); g.lineWidth = Math.max(1, r * 0.5); g.lineCap = 'round'
				g.beginPath(); g.moveTo(x, y); g.lineTo(x + (d / 9) * cw * 0.9, y); g.stroke()
				g.beginPath(); g.arc(x, y, r * (1 + glow * 0.4), 0, TAU)
				g.fillStyle = glow ? INK : col
				g.fill()
				g.strokeStyle = INK; g.lineWidth = 1
				g.setLineDash(c < 9 ? [1.2, 2] : [])
				g.stroke(); g.setLineDash([])
			}
		}

		return {
			get state() { return state },
			pointer: withPointer(size, (e) => {
				shape = e.shape || (isStrip(e.w, e.h) ? 'ring' : 'sheet')
				return shape === 'sheet' ? sheetPointer(e) : ringPointer(e)
			}),
			step(i, time, dur) {
				const abs = absOf(clock, time)
				const k = ((abs % state.len) + state.len) % state.len
				const st = state.s[k]
				if (!st) return
				if (st[3] < 9 && roll(abs, k) > (st[3] + 1) / 10) return
				const t = time + (abs % 2 ? params.swing * dur : 0)
				voice(st, t, dur)
				fx.hit(k, t)
				fx.hit(`a${abs % 256}`, t)
			},
			frame(g, w, h, clk, sh) {
				size[0] = w; size[1] = h
				shape = sh || (isStrip(w, h) ? 'ring' : 'sheet')
				const t = { abs: absNow(clk), now: clk.now(), playing: clk.playing ?? true }
				return shape === 'sheet' ? drawSheet(g, w, h, t) : drawRing(g, w, h, t)
			},
			setState(s) {
				state.len = clamp(s.len | 0 || N, 1, N)
				state.s = Array.from({ length: N }, (_, k) => (Array.isArray(s.s[k]) ? s.s[k].slice(0, 4).map((v) => v | 0) : 0))
			},
			clear() { state.s = Array(N).fill(0); state.len = N },
			randomize() { this.setState(gen()) },
			dispose() {},
		}
	},
}
