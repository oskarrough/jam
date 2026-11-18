// Bloom: the room's chord, held. Draw how open it is across the loop: low is a dark hum of the triad,
// high opens the filter, swells, and flowers the 7th, the 9th and a shimmer on top. Gaps are silent.
import { kit } from './lib/kit.js'
import { withPointer, absOf, view, theme, rgba, SLOTS, clamp, subSlots } from './lib/util.js'
import { line } from './lib/demo.js'

// [chord tone (0 root, 1 third, 2 fifth, 3 seventh, 4 ninth), octaves up, wave, opens at]
const VOICES = [
	[0, -1, 'sine', 0],
	[0, 0, 'sawtooth', 0],
	[2, 0, 'sawtooth', 0],
	[1, 1, 'sawtooth', 0],
	[3, 1, 'triangle', 0.3],
	[4, 1, 'triangle', 0.5],
	[2, 2, 'sine', 0.72],
]
const cutoffOf = (o) => 160 * Math.pow(2, o * 5.6)
// how far voice v has flowered at openness o
const bloomOf = (o, at) => (at === 0 ? 1 : clamp((o - at) / 0.18, 0, 1))

function gen() {
	// one slow breath or two over the loop, sometimes a rest
	const turns = 1 + Math.floor(Math.random() * 2),
		ph = Math.random() * 6,
		base = 0.35 + Math.random() * 0.3
	const ys = []
	for (let s = 0; s < SLOTS; s++) {
		const y = base - 0.3 * Math.sin((s / SLOTS) * Math.PI * 2 * turns + ph)
		ys.push(+clamp(y, 0.05, 0.95).toFixed(2))
	}
	if (Math.random() < 0.4) {
		const a = Math.floor(Math.random() * SLOTS)
		for (let k = 0; k < 10; k++) ys[(a + k) % SLOTS] = null
	}
	return { ys }
}

export default {
	id: 'bloom',
	name: 'Bloom',
	how: "Holds the room's chord. Draw across the loop: higher opens it up and lets the 7th and 9th flower. Shift-drag erases to silence.",
	glyph:
		'<path d="M16 27V15"/><path d="M16 15c-6 0-8-5-8-9 4 0 8 3 8 9zM16 15c6 0 8-5 8-9-4 0-8 3-8 9z"/><path d="M5 27h22" stroke-dasharray="1 2"/>',
	demo: () => [line(0.06, 0.85, 0.94, 0.12, 22)],
	params: {
		level: { value: 0.09, min: 0, max: 0.25, step: 0.005 },
		rest: { value: 0.25, min: 0, max: 0.6, step: 0.01 },
		detune: { value: 7, min: 0, max: 30, step: 1 },
		octave: { value: -1, min: -2, max: 1, step: 1 },
	},
	generate: (steps, params) => gen(steps, params),
	sample: (steps) => gen(steps),
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { ys: Array(SLOTS).fill(null) }

		const filt = audio.createBiquadFilter()
		filt.type = 'lowpass'
		filt.Q.value = 0.9
		filt.frequency.value = cutoffOf(params.rest)
		const amp = audio.createGain()
		amp.gain.value = 0
		filt.connect(amp).connect(out)
		const voices = VOICES.map(([tone, oct, type, at]) => {
			const g = audio.createGain()
			g.gain.value = at === 0 ? 1 : 0
			g.connect(filt)
			const oscs = (type === 'sawtooth' ? [-1, 1] : [0]).map((d) => {
				const o = audio.createOscillator()
				o.type = type
				o.detune.value = d * params.detune
				o.connect(g)
				o.start()
				return { o, d }
			})
			// saws are bright and doubled; keep them under the sines
			return {
				tone,
				oct,
				at,
				g,
				oscs,
				trim: type === 'sawtooth' ? 0.32 : type === 'sine' ? 0.7 : 0.4,
			}
		})

		let chordKey = ''
		let changedAt = -1
		let open = params.rest // what the ear hears now, for drawing
		let lastSlot = null

		function retune(abs, time, glide) {
			const ch = engine.chord(abs)
			const key = ch.tones.join()
			if (key === chordKey) return
			const fresh = chordKey !== ''
			chordKey = key
			for (const v of voices) {
				const f = 440 * Math.pow(2, (ch.tones[v.tone] + 12 * (v.oct + params.octave) - 69) / 12)
				for (const { o, d } of v.oscs) {
					if (glide) o.frequency.setTargetAtTime(f, time, 0.05)
					else o.frequency.setValueAtTime(f, time)
					o.detune.setTargetAtTime(d * params.detune, time, 0.2)
				}
			}
			// a new chord takes a breath: dip, then swell back in, so a scrub on the eye is heard at once
			if (fresh && drawnAt(abs)) {
				const lv = levelOf(openAt(abs))
				amp.gain.cancelScheduledValues(time)
				amp.gain.setTargetAtTime(lv * 0.35, time, 0.03)
				amp.gain.setTargetAtTime(lv * 1.15, time + 0.08, 0.12)
				changedAt = time
			}
		}
		const slotAt = (abs) =>
			Math.floor((((abs % clock.steps) + clock.steps) % clock.steps) * (SLOTS / clock.steps))
		const drawnAt = (abs) => state.ys[slotAt(abs)] != null
		const openAt = (abs) => (drawnAt(abs) ? 1 - state.ys[slotAt(abs)] : params.rest)
		const levelOf = (o) => params.level * (0.45 + 0.75 * o)

		// an undrawn slot is silent, like every other empty ring
		function shape(o, t, tc, drawn) {
			filt.frequency.setTargetAtTime(cutoffOf(o), t, tc)
			amp.gain.setTargetAtTime(drawn ? levelOf(o) : 0, t, tc * 1.5)
			for (const v of voices) v.g.gain.setTargetAtTime(bloomOf(o, v.at) * v.trim, t, tc * 2)
		}

		function paint(x, y, erase) {
			const s = clamp(Math.floor(x * SLOTS), 0, SLOTS - 1)
			const from = lastSlot ?? s
			const a = Math.min(from, s),
				b = Math.max(from, s)
			for (let i = a; i <= b; i++) state.ys[i] = erase ? null : +clamp(y, 0, 1).toFixed(2)
			lastSlot = s
		}

		retune(0, audio.currentTime, false)
		for (const v of voices) v.g.gain.value = bloomOf(params.rest, v.at) * v.trim

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
				const abs = absOf(clock, time)
				retune(abs, time, true)
				subSlots(i, time, dur, clock.steps, (s, t) => {
					const y = state.ys[s]
					const o = y == null ? params.rest : 1 - y
					if (t - changedAt < 0.25) {
						filt.frequency.setTargetAtTime(cutoffOf(o), t, dur * 0.8)
						return
					}
					shape(o, t, dur * 0.8, y != null)
				})
			},
			frame(g, w, h, clk, shp) {
				size[0] = w
				size[1] = h
				const t = view(clk)
				const sheet = shp === 'sheet'
				const sw = w / SLOTS
				const now = Math.floor(t.phase * SLOTS) % SLOTS
				const y0 = state.ys[now]
				open += ((y0 == null ? params.rest : 1 - y0) - open) * 0.12
				// the voices as threads: each lights as it flowers
				if (sheet)
					for (const v of voices) {
						if (!v.at) continue
						const y = (1 - v.at) * h
						g.fillStyle = rgba(th.accent, 0.08 + 0.5 * bloomOf(open, v.at))
						g.fillRect(0, y, w, 1)
					}
				// the colour: on the sheet it fills under the line; round the dial it's a band that glows where it's open
				const restY = (1 - params.rest) * h
				for (let s = 0; s < SLOTS; s++) {
					const y = state.ys[s]
					const o = y == null ? params.rest : 1 - y
					const top = sheet ? (y == null ? restY : y * h) : 0
					g.fillStyle = rgba(th.accent, (y == null ? 0.05 : 0.1) + (sheet ? 0.35 : 0.6) * o * o)
					g.fillRect(s * sw, top, sw + 0.5, h - top)
				}
				g.strokeStyle = th.fg
				g.lineWidth = Math.max(1, Math.min(w, h * 4) / 300)
				g.beginPath()
				let pen = false
				state.ys.forEach((y, s) => {
					if (y == null) return (pen = false)
					const x = (s + 0.5) * sw
					pen ? g.lineTo(x, y * h) : g.moveTo(x, y * h)
					pen = true
				})
				g.stroke()
				// a glow at the playhead, as wide as the chord is open; it gasps when the chord changes
				const gasp = Math.max(0, 1 - (t.now - changedAt) / 0.6)
				if (t.playing) {
					const r = (sheet ? Math.min(w, h) * 0.04 : h * 0.4) * (0.5 + open) * (1 + gasp)
					g.fillStyle = rgba(th.accent, 0.35 + 0.4 * gasp)
					g.beginPath()
					g.arc(t.phase * w, (1 - open) * h, r, 0, Math.PI * 2)
					g.fill()
				}
			},
			setState(s) {
				state.ys = s.ys.map((y) => (y == null ? null : clamp(+y, 0, 1)))
			},
			clear() {
				state.ys.fill(null)
				amp.gain.cancelScheduledValues(audio.currentTime)
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.05)
			},
			randomize() {
				this.setState(gen(clock.steps, params))
			},
			dispose() {
				amp.gain.cancelScheduledValues(audio.currentTime)
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.08)
				for (const v of voices) for (const { o } of v.oscs) o.stop(audio.currentTime + 0.6)
			},
		}
	},
}
