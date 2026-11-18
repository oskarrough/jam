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
// the filter ink: sweep's cutoff, y = 0 bright
const sweepOf = (y) => 60 * Math.pow(2, (1 - y) * 7.5)
// two inks, like brushes: glow is today's bloom, filter is a hand on sweep's cutoff over the same chord
// [name, 32×32 svg for its brush in the tool strip]; the first is the default
const INKS = [
	[
		'glow',
		'<circle class="f" cx="16" cy="16" r="12" opacity=".15"/><circle class="f" cx="16" cy="16" r="9" opacity=".25"/><circle class="f" cx="16" cy="16" r="6" opacity=".45"/><circle class="f" cx="16" cy="16" r="3"/>',
	],
	['filter', '<path d="M3 13h15c3 0 4-5 5-5s2 16 6 16" stroke-width="1.2"/>'],
]
// how far voice v has flowered at openness o
const bloomOf = (o, at) => (at === 0 ? 1 : clamp((o - at) / 0.18, 0, 1))

function gen(withFilter) {
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
	// and sometimes a filter line over part of it, a quicker wobble
	const fs = Array(SLOTS).fill(null)
	if (withFilter || Math.random() < 0.5) {
		const a = Math.floor(Math.random() * SLOTS),
			n = Math.floor(SLOTS * 0.4)
		for (let k = 0; k < n; k++)
			fs[(a + k) % SLOTS] = +clamp(
				0.5 - 0.35 * Math.sin((k / n) * Math.PI * 3),
				0.05,
				0.95,
			).toFixed(2)
	}
	return { ys, fs }
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
		res: { value: 7, min: 0.5, max: 18, step: 0.5 },
		pump: { value: 0.35, min: 0, max: 1, step: 0.01 },
		rest: { value: 0.25, min: 0, max: 0.6, step: 0.01 },
		detune: { value: 7, min: 0, max: 30, step: 1 },
		octave: { value: -1, min: -2, max: 1, step: 1 },
	},
	generate: () => gen(),
	sample: () => gen(true),
	optional: ['fs'],
	inks: INKS,
	create(ctx) {
		const { audio, out, params, clock } = ctx
		const engine = kit(audio)
		const th = theme(ctx)
		const size = [1, 1]
		const state = { ys: Array(SLOTS).fill(null), fs: Array(SLOTS).fill(null) }
		let ink = 'glow'
		let live = null // the filter ink under your hand, heard at once

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

		// the filter ink's pad: the triad in doubled saws through a resonant lowpass, pumped on the beat
		const fFilt = audio.createBiquadFilter()
		fFilt.type = 'lowpass'
		fFilt.frequency.value = 400
		fFilt.Q.value = params.res
		const fPump = audio.createGain()
		const fAmp = audio.createGain()
		fAmp.gain.value = 0
		fFilt.connect(fPump).connect(fAmp).connect(out)
		const fOscs = []
		for (let n = 0; n < 3; n++)
			for (const d of [-1, 1]) {
				const o = audio.createOscillator()
				o.type = 'sawtooth'
				o.connect(fFilt)
				o.start()
				fOscs.push({ o, n, d })
			}
		const fLevel = () => params.level * 1.2

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
			for (const { o, n, d } of fOscs) {
				const f = 440 * Math.pow(2, (ch.tones[n] + 12 * params.octave - 69) / 12)
				if (glide) o.frequency.setTargetAtTime(f, time, 0.04)
				else o.frequency.setValueAtTime(f, time)
				o.detune.setTargetAtTime(d * (params.detune + 2), time, 0.1)
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

		// a stroke paints in the ink you picked; the eraser rubs out both
		function paint(x, y, erase) {
			const s = clamp(Math.floor(x * SLOTS), 0, SLOTS - 1)
			const from = lastSlot ?? s
			const a = Math.min(from, s),
				b = Math.max(from, s)
			const v = +clamp(y, 0, 1).toFixed(2)
			for (let i = a; i <= b; i++) {
				if (erase) state.ys[i] = state.fs[i] = null
				else (ink === 'glow' ? state.ys : state.fs)[i] = v
			}
			lastSlot = s
			if (ink === 'filter' && !erase) {
				live = y
				const now = audio.currentTime
				fAmp.gain.setTargetAtTime(fLevel(), now, 0.03)
				fFilt.frequency.setTargetAtTime(sweepOf(y), now, 0.015)
			}
		}

		retune(0, audio.currentTime, false)
		for (const v of voices) v.g.gain.value = bloomOf(params.rest, v.at) * v.trim

		return {
			state,
			get ink() {
				return ink
			},
			set ink(v) {
				ink = v
			},
			pointer: withPointer(size, (e) => {
				if (e.type === 'down') {
					lastSlot = null
					paint(e.x, e.y, e.alt)
				} else if (e.type === 'move' && e.pressed) paint(e.x, e.y, e.alt)
				else if (e.type === 'up' || e.type === 'cancel') {
					lastSlot = null
					live = null
				}
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
				// the filter ink, unless your hand is on it right now
				fFilt.Q.setTargetAtTime(params.res, time, 0.05)
				if (i % 4 === 0 && params.pump > 0) {
					fPump.gain.setValueAtTime(1 - params.pump, time)
					fPump.gain.setTargetAtTime(1, time + 0.01, dur * 0.9)
				}
				if (live != null) return
				subSlots(i, time, dur, clock.steps, (s, t) => {
					const y = state.fs[s]
					fAmp.gain.setTargetAtTime(y == null ? 0 : fLevel(), t, 0.03)
					if (y != null) fFilt.frequency.setTargetAtTime(sweepOf(y), t, 0.02)
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
				const trace = (ys) => {
					g.beginPath()
					let pen = false
					ys.forEach((y, s) => {
						if (y == null) return (pen = false)
						const x = (s + 0.5) * sw
						pen ? g.lineTo(x, y * h) : g.moveTo(x, y * h)
						pen = true
					})
				}
				const base = Math.max(1, Math.min(w, h * 4) / 300)
				g.lineCap = g.lineJoin = 'round'
				// glow: soft and wide, a few translucent passes from broad to narrow
				trace(state.ys)
				for (const [k, a] of [
					[3.6, 0.06],
					[2.2, 0.12],
					[1.3, 0.24],
					[0.6, 0.6],
				]) {
					g.strokeStyle = rgba(th.accent, sheet ? a : Math.min(1, a * 1.8))
					g.lineWidth = Math.max(1, base * k * (sheet ? 1.6 : 1.8))
					g.stroke()
				}
				// filter: one hairline, crisp, with a tick under every slot like a resonant edge
				trace(state.fs)
				g.strokeStyle = th.fg
				g.lineWidth = sheet ? 1.5 : 1
				g.lineCap = g.lineJoin = 'miter'
				g.stroke()
				if (sheet) {
					g.fillStyle = th.fg
					state.fs.forEach((y, s) => {
						if (y != null) g.fillRect((s + 0.5) * sw - 0.5, y * h + 3, 1, 5)
					})
					// the filter's cutoff where the ear is, a thin level line while it sounds
					const fy = clamp(1 - Math.log2(fFilt.frequency.value / 60) / 7.5, 0, 1) * h
					if (fAmp.gain.value > 0.002) {
						g.strokeStyle = rgba(th.fg, 0.35)
						g.lineWidth = 1
						g.beginPath()
						g.moveTo(0, fy)
						g.lineTo(w, fy)
						g.stroke()
					}
				}
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
				const norm = (ys) => (ys || []).map((y) => (y == null ? null : clamp(+y, 0, 1)))
				state.ys = norm(s.ys)
				state.fs = s.fs ? norm(s.fs) : Array(state.ys.length).fill(null)
			},
			clear() {
				state.ys.fill(null)
				state.fs.fill(null)
				fAmp.gain.setTargetAtTime(0, audio.currentTime, 0.05)
				amp.gain.cancelScheduledValues(audio.currentTime)
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.05)
			},
			randomize() {
				this.setState(gen())
			},
			dispose() {
				amp.gain.cancelScheduledValues(audio.currentTime)
				amp.gain.setTargetAtTime(0, audio.currentTime, 0.08)
				fAmp.gain.setTargetAtTime(0, audio.currentTime, 0.05)
				for (const v of voices) for (const { o } of v.oscs) o.stop(audio.currentTime + 0.6)
				for (const { o } of fOscs) o.stop(audio.currentTime + 0.6)
			},
		}
	},
}
