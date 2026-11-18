// 04 Sweep: a held chord pad you play only through its filter.
// Height is cutoff, left/right is resonance; the gesture records and loops.
import { kit } from './lib/kit.js'
import { withPointer, absOf, theme, SLOTS, clamp, subSlots } from './lib/util.js'

const cutoffOf = (y) => 60 * Math.pow(2, (1 - y) * 7.5)
const qOf = (x) => 0.4 + x * 16

function gen() {
	const a = Math.random(),
		b = Math.floor(Math.random() * 3) + 1
	const auto = []
	for (let s = 0; s < SLOTS; s++)
		auto.push([
			+(0.5 + 0.4 * Math.sin((s / SLOTS) * Math.PI * 2 * b + a * 6)).toFixed(3),
			+(Math.random() * 0.5).toFixed(3),
		])
	return { auto }
}

export default {
	id: 'sweep',
	glyph:
		'<path d="M5 25A13 13 0 0 1 27 12"/><path d="M23 9l4 3-3 4"/><path d="M8 19h4M11 14h4" stroke-dasharray="1 2"/>',
	name: 'Sweep',
	how: 'Hold and move to sweep the filter: up is brighter, right is more resonant. It records as you play; the eraser or Shift rubs it out.',
	demo: () => [
		Array.from({ length: 24 }, (_, k) => [
			0.2 + k * 0.025,
			0.75 - 0.5 * Math.sin((k / 23) * Math.PI),
		]),
	],
	params: {
		record: { value: true },
		detune: { value: 9, min: 0, max: 40, step: 1 },
		pump: { value: 0.45, min: 0, max: 1, step: 0.01 },
		octave: { value: -1, min: -2, max: 1, step: 1 },
		level: { value: 0.11, min: 0, max: 0.3, step: 0.005 },
	},
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { auto: Array(SLOTS).fill(null) }
		const filt = audio.createBiquadFilter()
		filt.type = 'lowpass'
		filt.frequency.value = 400
		filt.Q.value = 2
		const pump = audio.createGain()
		const amp = audio.createGain()
		amp.gain.value = 0
		filt.connect(pump).connect(amp).connect(out)
		const oscs = []
		for (let n = 0; n < 3; n++) {
			for (let d = 0; d < 2; d++) {
				const o = audio.createOscillator()
				o.type = 'sawtooth'
				o.start()
				o.connect(filt)
				oscs.push({ o, n, d })
			}
		}
		let live = null
		let lastRec = null
		let chordName = ''

		function retune(abs, time) {
			const ch = engine.chord(abs, clock.steps)
			chordName = ch.name
			for (const { o, n, d } of oscs) {
				const f = 440 * Math.pow(2, (ch.notes[n] + 12 * params.octave - 69) / 12)
				o.frequency.setTargetAtTime(f, time, 0.04)
				o.detune.setTargetAtTime(d ? params.detune : -params.detune, time, 0.1)
			}
		}
		retune(0, audio.currentTime)

		function applyLive(e) {
			live = { x: clamp(e.x, 0, 1), y: clamp(e.y, 0, 1) }
			const now = audio.currentTime
			amp.gain.setTargetAtTime(params.level, now, 0.03)
			filt.frequency.setTargetAtTime(cutoffOf(live.y), now, 0.015)
			filt.Q.setTargetAtTime(qOf(live.x), now, 0.03)
			if (params.record && clock.playing) {
				const s = Math.floor((clock.pos() / clock.steps) * SLOTS) % SLOTS
				const from = lastRec ?? s
				let i = from
				for (let guard = 0; guard < SLOTS; guard++) {
					state.auto[i] = [live.y, live.x]
					if (i === s) break
					i = (i + 1) % SLOTS
				}
				lastRec = s
			}
		}

		let lastRub = null
		function rub(e) {
			const s = clamp(Math.floor(e.x * SLOTS), 0, SLOTS - 1)
			const a = Math.min(lastRub ?? s, s),
				b = Math.max(lastRub ?? s, s)
			for (let i = a; i <= b; i++) state.auto[i] = null
			lastRub = s
		}

		return {
			state,
			pointer: withPointer(size, (e) => {
				if (e.alt) {
					if (e.type === 'down') {
						lastRub = null
						rub(e)
					} else if (e.type === 'move' && e.pressed) rub(e)
					else if (e.type === 'up') lastRub = null
					return
				}
				if (e.type === 'down') {
					lastRec = null
					applyLive(e)
				} else if (e.type === 'move' && e.pressed) applyLive(e)
				else if (e.type === 'up') {
					live = null
					lastRec = null
				}
			}),
			step(i, time, dur) {
				const abs = absOf(clock, time)
				// an empty sweep is silent: the pad only sounds while you play it or it has moves to replay
				amp.gain.setTargetAtTime(live || state.auto.some(Boolean) ? params.level : 0, time, 0.05)
				if (i % engine.barSteps() === 0) retune(abs, time)
				if (i % 4 === 0 && params.pump > 0) {
					pump.gain.setValueAtTime(1 - params.pump, time)
					pump.gain.setTargetAtTime(1, time + 0.01, dur * 0.9)
				}
				if (live) return
				subSlots(i, time, dur, clock.steps, (s, t) => {
					const a = state.auto[s]
					if (!a) return
					filt.frequency.setTargetAtTime(cutoffOf(a[0]), t, 0.02)
					filt.Q.setTargetAtTime(qOf(a[1]), t, 0.03)
				})
			},
			frame(g, w, h, clock) {
				size[0] = w
				size[1] = h
				const sw = w / SLOTS
				state.auto.forEach((a, s) => {
					if (!a) return
					const y = a[0] * h
					g.fillStyle = th.faint
					g.fillRect(s * sw, y, sw - 1, h - y)
					g.fillStyle = th.dim
					g.fillRect(s * sw, y - 1, sw - 1, 2 + a[1] * 8)
				})
				const fy = clamp(1 - Math.log2(filt.frequency.value / 60) / 7.5, 0, 1) * h
				g.strokeStyle = live ? th.accent : th.fg
				g.lineWidth = 1 + filt.Q.value / 4
				g.beginPath()
				g.moveTo(0, fy)
				g.lineTo(w, fy)
				g.stroke()
				g.lineWidth = 1
				if (live) {
					g.strokeStyle = th.accent
					g.beginPath()
					g.arc(live.x * w, live.y * h, 10, 0, Math.PI * 2)
					g.stroke()
				}
				g.fillStyle = th.dim
				g.font = `${Math.max(10, h / 30)}px ${th.font}`
				g.fillText(chordName, 8, h - 8)
			},
			setState(s) {
				state.auto = s.auto.map((a) => (a ? a.slice() : null))
			},
			clear() {
				state.auto.fill(null)
				if (!live) amp.gain.setTargetAtTime(0, audio.currentTime, 0.05)
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
			dispose() {
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.05)
				oscs.forEach(({ o }) => o.stop(audio.currentTime + 0.4))
			},
		}
	},
}
