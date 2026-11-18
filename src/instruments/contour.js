// 01 Contour: draw a melody line across the loop. x is time, y is pitch.
// One gliding voice follows it; gaps are rests.
import { kit } from './lib/kit.js'
import { withPointer, view, theme, SLOTS, clamp, subSlots } from './lib/util.js'
import { wave } from './lib/demo.js'

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
	how: 'Draw a line left to right; height is pitch. Shift-drag erases.',
	demo: () => [wave(0.08, 0.62, 0.5, 0.22, 1.2, 26)],
	params: {
		range: { value: 12, min: 5, max: 20, step: 1 },
		octave: { value: 0, min: -2, max: 1, step: 1 },
		glide: { value: 0.05, min: 0, max: 0.4, step: 0.01 },
		wave: { value: 'triangle', options: ['sine', 'triangle', 'sawtooth', 'square'] },
		cutoff: { value: 2400, min: 200, max: 9000, step: 10 },
		articulate: { value: true },
	},
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { ys: Array(SLOTS).fill(null) }

		const osc = audio.createOscillator()
		const filt = audio.createBiquadFilter()
		const amp = audio.createGain()
		filt.type = 'lowpass'
		amp.gain.value = 0
		osc.connect(filt).connect(amp).connect(out)
		osc.start()

		const toDeg = (y) => Math.round((1 - y) * params.range)
		const toMidi = (y) => engine.degree(toDeg(y), params.octave)
		let last = null
		let lastSlot = null

		function paint(x, y, erase) {
			const s = clamp(Math.floor(x * SLOTS), 0, SLOTS - 1)
			const from = lastSlot ?? s
			const a = Math.min(from, s),
				b = Math.max(from, s)
			for (let i = a; i <= b; i++) state.ys[i] = erase ? null : clamp(y, 0, 1)
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
				osc.type = params.wave
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
					if (last === null) {
						osc.frequency.setValueAtTime(f, t)
						amp.gain.setTargetAtTime(0.28, t, 0.01)
					} else if (m !== last) {
						if (params.glide > 0) osc.frequency.setTargetAtTime(f, t, params.glide / 3)
						else osc.frequency.setValueAtTime(f, t)
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
				g.strokeStyle = th.fg
				g.lineWidth = Math.max(1, w / 400)
				g.beginPath()
				let pen = false
				state.ys.forEach((y, s) => {
					if (y === null) {
						pen = false
						return
					}
					const x = (s + 0.5) * sw
					pen ? g.lineTo(x, y * h) : g.moveTo(x, y * h)
					pen = true
				})
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
			setState(s) {
				state.ys = s.ys.slice()
			},
			clear() {
				state.ys.fill(null)
				amp.gain.cancelScheduledValues(audio.currentTime)
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.02)
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
			dispose() {
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.02)
				osc.stop(audio.currentTime + 0.2)
			},
		}
	},
}
