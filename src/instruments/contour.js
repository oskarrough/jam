// 01 Contour: draw a melody line across the loop. x is time, y is pitch.
// One gliding voice follows it; gaps are rests. Each stroke is inked in a wave (sine, triangle, saw, square)
// and drawn as that wave, so a line can go from a hum to a buzz mid-phrase.
import { kit } from './lib/kit.js'
import { withPointer, view, theme, SLOTS, clamp, subSlots } from './lib/util.js'
import { wave } from './lib/demo.js'

const WAVES = ['sine', 'triangle', 'sawtooth', 'square']
const INKS = [
	['sine', '<path d="M3 16C7 4 11 4 16 16S25 28 29 16"/>'],
	['triangle', '<path d="M3 16L9.5 6L22.5 26L29 16"/>'],
	['sawtooth', '<path d="M3 24L15 8V24L27 8V24"/>'],
	['square', '<path d="M3 24V8H16V24H29V8"/>'],
]
// the wave's shape over one period, -1..1, for drawing the line as that wave
const SHAPE = {
	sine: (u) => Math.sin(u * Math.PI * 2),
	triangle: (u) => 1 - 4 * Math.abs(((u + 0.25) % 1) - 0.5),
	sawtooth: (u) => 1 - 2 * (u % 1),
	square: (u) => (u % 1 < 0.5 ? 1 : -1),
}

function gen() {
	const ys = []
	let y = Math.random()
	for (let s = 0; s < SLOTS; s++) {
		if (s % 4 === 0) y = clamp(y + (Math.random() - 0.5) * 0.5, 0.05, 0.95)
		ys.push(Math.random() < 0.85 ? +y.toFixed(3) : null)
	}
	return { ys }
}

export default {
	id: 'contour',
	glyph: '<path d="M3 22l5-7 4 3 6-11 5 7 6-4"/>',
	name: 'Contour',
	how: 'Draw a line left to right; height is pitch. Each ink under the sheet is a wave, from a soft sine to a buzzing square. Shift-drag erases.',
	demo: () => [wave(0.08, 0.62, 0.5, 0.22, 1.2, 26)],
	params: {
		range: { value: 12, min: 5, max: 20, step: 1 },
		octave: { value: 0, min: -2, max: 1, step: 1 },
		glide: { value: 0.05, min: 0, max: 0.4, step: 0.01 },
		wave: { value: 'triangle', options: ['sine', 'triangle', 'sawtooth', 'square'] },
		cutoff: { value: 2400, min: 200, max: 9000, step: 10 },
		articulate: { value: true },
	},
	inks: INKS,
	optional: ['w'], // older parts have no per-slot wave; they play params.wave
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { ys: Array(SLOTS).fill(null), w: Array(SLOTS).fill(null) } // w: wave index per slot, null = params.wave
		let ink = WAVES.includes(params.wave) ? params.wave : 'triangle'

		// one oscillator per wave, all on one pitch; the slot's wave gets the gain, so a switch lands on time
		const filt = audio.createBiquadFilter()
		const amp = audio.createGain()
		filt.type = 'lowpass'
		amp.gain.value = 0
		filt.connect(amp).connect(out)
		const oscs = WAVES.map((type) => {
			const o = audio.createOscillator()
			const g = audio.createGain()
			o.type = type
			g.gain.value = 0
			o.connect(g).connect(filt)
			o.start()
			return { o, g }
		})
		// square and saw are loud next to sine; even them out
		const TRIM = [1, 0.9, 0.55, 0.5]
		const waveAt = (s) => {
			const k = state.w[s]
			return k == null ? Math.max(0, WAVES.indexOf(params.wave)) : k
		}
		let lastWave = -1

		const toDeg = (y) => Math.round((1 - y) * params.range)
		const toMidi = (y) => engine.degree(toDeg(y), params.octave)
		let last = null
		let lastSlot = null

		function paint(x, y, erase) {
			const s = clamp(Math.floor(x * SLOTS), 0, SLOTS - 1)
			const from = lastSlot ?? s
			const a = Math.min(from, s),
				b = Math.max(from, s)
			for (let i = a; i <= b; i++) {
				state.ys[i] = erase ? null : clamp(y, 0, 1)
				state.w[i] = erase ? null : WAVES.indexOf(ink)
			}
			lastSlot = s
		}

		return {
			state,
			pointer: withPointer(size, (e) => {
				if (e.type === 'down') {
					lastSlot = null
					paint(e.x, e.y, e.alt)
				} else if (e.type === 'move' && e.pressed) paint(e.x, e.y, e.alt)
				else if (e.type === 'up') lastSlot = null
			}),
			step(i, time, dur) {
				filt.frequency.setTargetAtTime(params.cutoff, time, 0.05)
				subSlots(i, time, dur, clock.steps, (s, t) => {
					const y = state.ys[s]
					if (y === null) {
						if (last !== null) amp.gain.setTargetAtTime(0, t, 0.03)
						last = null
						return
					}
					const m = toMidi(y)
					const f = 440 * Math.pow(2, (m - 69) / 12)
					const wv = waveAt(s)
					if (wv !== lastWave)
						oscs.forEach(({ g }, k) => g.gain.setTargetAtTime(k === wv ? TRIM[k] : 0, t, 0.006))
					lastWave = wv
					if (last === null) {
						oscs.forEach(({ o }) => o.frequency.setValueAtTime(f, t))
						amp.gain.setTargetAtTime(0.28, t, 0.01)
					} else if (m !== last) {
						oscs.forEach(({ o }) =>
							params.glide > 0
								? o.frequency.setTargetAtTime(f, t, params.glide / 3)
								: o.frequency.setValueAtTime(f, t),
						)
						if (params.articulate) {
							amp.gain.setTargetAtTime(0.08, t, 0.005)
							amp.gain.setTargetAtTime(0.28, t + 0.02, 0.015)
						}
					}
					last = m
				})
			},
			frame(g, w, h, clock) {
				size[0] = w
				size[1] = h
				const t = view(clock)
				g.strokeStyle = th.faint
				g.lineWidth = 1
				for (let d = 0; d <= params.range; d++) {
					const y = Math.round((1 - d / params.range) * (h - 1)) + 0.5
					g.beginPath()
					g.moveTo(0, y)
					g.lineTo(w, y)
					g.stroke()
				}
				g.fillStyle = th.dim
				const sw = w / SLOTS
				state.ys.forEach((y, s) => {
					if (y === null) return
					const qy = (1 - toDeg(y) / params.range) * h
					g.fillRect(s * sw, qy - 1.5, sw + 0.5, 3)
				})
				// the line is drawn as its wave: a ripple riding the contour, one period every few slots
				g.strokeStyle = th.fg
				g.lineWidth = Math.max(1, w / 400)
				g.lineJoin = 'round'
				const amp_ = Math.min(h * 0.025, sw * 0.9, 9)
				const period = sw * 3
				g.beginPath()
				let pen = false
				for (let s = 0; s < SLOTS; s++) {
					const y = state.ys[s]
					if (y === null) {
						pen = false
						continue
					}
					const next = state.ys[s + 1]
					const x0 = (s + 0.5) * sw
					const shape = SHAPE[WAVES[waveAt(s)]]
					if (!pen) g.moveTo(x0, y * h - shape(x0 / period) * amp_)
					pen = true
					if (next == null) continue
					const n = Math.max(2, Math.ceil(sw / 2))
					for (let j = 1; j <= n; j++) {
						const x = x0 + (j / n) * sw
						const yy = y + ((next - y) * j) / n
						g.lineTo(x, yy * h - shape(x / period) * amp_)
					}
				}
				g.stroke()
				const px = t.phase * w // host draws the playhead; we mark the note under it
				const y = state.ys[Math.floor(t.phase * SLOTS)]
				if (y !== null && t.playing) {
					g.fillStyle = th.accent
					g.beginPath()
					g.arc(px, (1 - toDeg(y) / params.range) * h, Math.max(2, w / 120), 0, Math.PI * 2)
					g.fill()
				}
			},
			get ink() {
				return ink
			},
			set ink(v) {
				ink = v
			},
			setState(s) {
				state.ys = s.ys.slice()
				state.w = Array.from({ length: SLOTS }, (_, i) => s.w?.[i] ?? null)
			},
			clear() {
				state.ys.fill(null)
				state.w.fill(null)
				amp.gain.cancelScheduledValues(audio.currentTime)
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.02)
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
			dispose() {
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.02)
				oscs.forEach(({ o }) => o.stop(audio.currentTime + 0.2))
			},
		}
	},
}
