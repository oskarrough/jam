// 02 Steps: a pocket step sequencer. Tap a step to toggle it, drag to draw a value across steps.
// Each note has a tail, piano-roll style: pull its knob sideways to hold the note for more steps.
// Chips under the sheet pick what a drag draws: pitch, loud or chance; drag the bracket to shorten the pattern (polymeter).
//
// state: { v: 2, len, s: [step x16] }, step = 0 (off) or [pitch 0..14, length 1..len steps, loud 0..9, chance 0..9]
// Mono: a note that sounds cuts the tail it lands on. Parts without v (length 0..9) are migrated on load.
// Chance rolls are seeded by the absolute step, so every peer hears the same notes.
import { kit } from './lib/kit.js'
import { withPointer, absNow, absOf, clamp, flashes, tint, mtof, isStrip, TAU } from './lib/util.js'
import { INK, SANS } from '../palette.js'
import { tap, line } from './lib/demo.js'
import { voice as jukebox } from './lib/voices.js'

// Inks, one per note, picked under the sheet. pluck is today's sound (the wave knob); keys a Rhodes,
// organ holds flat for the whole tail, reed breathes in and wavers. A note's ink is step[4], absent = pluck.
const INKS = [
	['pluck', '<path d="M6 24c3-14 5-16 7-16s3 10 15 14" stroke-width="1.6"/>'],
	['keys', '<circle cx="16" cy="16" r="6"/><circle cx="16" cy="16" r="11" opacity=".45"/>'],
	['organ', '<rect class="f" x="5" y="11" width="22" height="10" rx="2"/>'],
	['reed', '<path d="M4 16c3-5 5 5 8 0s5 5 8 0 5 5 8 0" stroke-width="1.8"/>'],
]
const inkOf = (st) => (st && st[4]) | 0
const rhodes = jukebox('rhodes', -8),
	organ = jukebox('organ', -7)

const N = 16
const PMAX = 14
const PARAMS = ['pitch', 'loud', 'chance']
const MAXOF = { pitch: PMAX, loud: 9, chance: 9 }
const IDX = { pitch: 0, loud: 2, chance: 3 }
const fresh = (p = 7) => [p, 1, 7, 9]
// version 1 kept length as 0..9, a pluck's decay; roughly the steps that pluck was heard for
const oldLen = (d) => clamp(Math.round(d / 2), 1, 5)

// a stable 0..1 roll per absolute step, the same on every machine
const roll = (abs, k) =>
	((Math.imul((abs * 2654435761) ^ (k * 40503), 2246822519) >>> 0) % 10007) / 10007

function gen() {
	const len = [16, 16, 16, 12, 8, 6][Math.floor(Math.random() * 6)]
	const s = Array(N).fill(0)
	let p = 5 + Math.floor(Math.random() * 5)
	for (let k = 0; k < len; k++) {
		const strong = k % 4 === 0
		if (Math.random() > (strong ? 0.85 : 0.4)) continue
		p = clamp(p + Math.round((Math.random() - 0.5) * 5), 0, PMAX)
		s[k] = [
			p,
			strong ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 1.6),
			strong ? 8 : 5 + Math.floor(Math.random() * 3),
			strong || Math.random() < 0.6 ? 9 : 4 + Math.floor(Math.random() * 4),
		]
	}
	return { v: 2, len, s }
}

function blob(g, x, y, rx, ry, seed) {
	g.beginPath()
	for (let k = 0; k <= 18; k++) {
		const a = (k / 18) * TAU
		const n = 1 + 0.06 * Math.sin(a * 3 + seed * 1.7) + 0.04 * Math.sin(a * 5 + seed)
		const px = x + Math.cos(a) * rx * n,
			py = y + Math.sin(a) * ry * n
		k ? g.lineTo(px, py) : g.moveTo(px, py)
	}
	g.closePath()
}

export default {
	id: 'steps',
	// columns are pattern steps, not loop phase, so the host playhead would lie; the playing step glows
	playhead: false,
	glyph:
		'<path class="f" d="M5 20h4v6H5zM11 12h4v14h-4zM17 17h4v9h-4z"/><path d="M23 9h4v17h-4z" stroke-dasharray="1.5 2"/><path d="M4 6h24" stroke-dasharray="1 3"/>',
	name: 'Steps',
	how: 'Tap a step for a note. Pull the knob on its tail right to hold it longer. Drag across steps to draw pitch, loud or chance (pick one under the sheet); drag the bracket to shorten the pattern.',
	optional: ['v'],
	inks: INKS,
	modes: PARAMS,
	demo: () => [tap(0.03, 0.45), line(0.06, 0.47, 0.3, 0.47, 10), tap(0.34, 0.45), tap(0.47, 0.45)],
	params: {
		wave: { value: 'square', options: ['square', 'triangle', 'sawtooth', 'bell'] },
		octave: { value: 0, min: -2, max: 1, step: 1 },
		tone: { value: 0.55, min: 0, max: 1, step: 0.01 },
		swing: { value: 0, min: 0, max: 0.5, step: 0.01 },
	},
	generate: () => gen(),
	// a sample with every ink in it, so the difference shows at once
	sample: () => {
		const g = gen()
		let n = 0
		g.s.forEach((st) => st && (st[4] = n++ % INKS.length))
		return g
	},
	create(ctx) {
		const { params, out, audio, clock } = ctx
		const engine = kit(audio)
		const size = [1, 1]
		let shape = 'ring'
		const state = { v: 2, len: N, s: Array(N).fill(0) }
		const fx = flashes()
		const ui = { param: 'pitch', pull: -1 } // what a drag draws, and the tail being pulled; local to this player
		let press = null
		let held = null // the note still sounding, so the next one can cut it
		let ink = 0 // the brush in your hand; local, but every note keeps its own

		// steps until the next note in the pattern, round the loop
		function gap(k) {
			for (let j = 1; j < state.len; j++) if (state.s[(k + j) % state.len]) return j
			return state.len
		}
		const lenOf = (st) => clamp(st[1], 1, state.len)
		// how long it really sounds, cut by the next note (mono)
		const heard = (k, st) => Math.min(lenOf(st), gap(k))

		function cut(at) {
			if (!held || at >= held.off + 0.2) return
			const { g, o } = held
			g.gain.cancelScheduledValues(at)
			g.gain.setTargetAtTime(0, at, 0.008)
			for (const x of [].concat(o))
				try {
					x.stop(at + 0.08)
				} catch {}
			held = null
		}

		function voice(st, time, dur, k) {
			const [p, , v] = st
			const steps = lenOf(st)
			const midi = engine.degree(p, params.octave + 1)
			const f = mtof(midi)
			// a held note: full steps, a short release; a one-step note stays a snappy blip
			const hold = steps === 1 ? dur * 0.55 : steps * dur - 0.03
			const gain = 0.03 + (v / 9) * 0.16
			cut(time)
			const kind = INKS[inkOf(st)]?.[0]
			// keys and organ come from the jukebox; mono still holds, so they stop where the next note starts
			if (kind === 'keys' || kind === 'organ') {
				const d = Math.min(steps, k == null ? steps : gap(k)) * dur - 0.02
				return (kind === 'keys' ? rhodes : organ)(
					ctx,
					midi,
					time,
					Math.max(0.08, d),
					0.35 + (v / 9) * 0.6,
				)
			}
			if (kind === 'reed') {
				const off = time + Math.max(dur * 0.8, steps * dur - 0.03)
				const g = audio.createGain(),
					bp = audio.createBiquadFilter(),
					lp = audio.createBiquadFilter()
				bp.type = 'bandpass'
				bp.frequency.value = Math.min(f * 3, 3000)
				bp.Q.value = 0.9
				lp.type = 'lowpass'
				lp.frequency.value = 1800 + params.tone * 2500
				const a = audio.createOscillator(),
					b = audio.createOscillator(),
					lfo = audio.createOscillator(),
					lg = audio.createGain()
				a.type = 'sawtooth'
				b.type = 'square'
				a.frequency.value = f
				b.frequency.value = f * 1.003
				lfo.frequency.value = 5.2
				lg.gain.value = 9 // cents of waver, after it has breathed in
				lg.gain.setValueAtTime(0, time)
				lg.gain.linearRampToValueAtTime(9, time + 0.25)
				lfo.connect(lg)
				lg.connect(a.detune)
				lg.connect(b.detune)
				const mix = audio.createGain()
				mix.gain.value = 0.5
				a.connect(mix)
				b.connect(mix)
				mix.connect(bp).connect(lp).connect(g).connect(out)
				g.gain.setValueAtTime(0.0001, time)
				g.gain.linearRampToValueAtTime(gain * 2.4, time + 0.045)
				g.gain.setTargetAtTime(gain * 2, time + 0.045, 0.2)
				g.gain.setTargetAtTime(0, off, 0.03)
				for (const o of [a, b, lfo]) {
					o.start(time)
					o.stop(off + 0.25)
				}
				held = { g, o: [a, b, lfo], off }
				return
			}
			if (params.wave === 'bell')
				return engine.voices.bell(out, {
					freq: f,
					time,
					gain: gain * 0.9,
					d: hold + 0.2,
					ratio: 3.5,
					index: 1.4,
				})
			const o = audio.createOscillator(),
				lp = audio.createBiquadFilter(),
				g = audio.createGain()
			o.type = params.wave
			o.frequency.value = f
			lp.type = 'lowpass'
			lp.Q.value = 3
			const top = f * (1.5 + params.tone * 14)
			lp.frequency.setValueAtTime(top, time)
			lp.frequency.setTargetAtTime(Math.max(120, f * (1.2 + params.tone * 4)), time + 0.005, 0.07)
			const off = time + hold
			g.gain.setValueAtTime(0.0001, time)
			g.gain.exponentialRampToValueAtTime(gain, time + 0.004)
			g.gain.setTargetAtTime(gain * 0.7, time + 0.004, 0.08)
			g.gain.setTargetAtTime(0, off, 0.025)
			o.connect(lp).connect(g).connect(out)
			o.start(time)
			o.stop(off + 0.2)
			held = { g, o, off }
		}

		const loopStart = () => Math.floor(absNow(clock) / clock.steps) * clock.steps
		const inked = (st) => {
			if (ink) st[4] = ink
			else st.length = Math.min(st.length, 4)
			return st
		}
		const ensure = (k) => (state.s[k] ||= fresh())
		function paint(k, y, erase) {
			if (erase) {
				state.s[k] = 0
				return
			}
			const st = inked(ensure(k))
			const max = MAXOF[ui.param]
			st[IDX[ui.param]] = clamp(Math.round((1 - y) * max), ui.param === 'chance' ? 1 : 0, max)
		}

		const BAND = 0.9 // under it, the bottom edge belongs to the bracket alone
		const colOf = (x) => clamp(Math.floor(x * N), 0, N - 1)
		const noteY = (p, top) => (1 - p / PMAX) * top * 0.86 + top * 0.07
		// where a tail ends, in columns: past the pattern's end it wraps to the start
		const tailEnd = (k, L) => (k + L > state.len ? k + L - state.len : k + L)
		const knobX = (k, L, cw) => (tailEnd(k, L) - 0.1) * cw

		// the knob nearest a press, if a thumb could mean it
		function knobAt(px, py, w, h) {
			const cw = w / N,
				top = h * BAND
			const rx = Math.max(16, cw * 0.45),
				ry = Math.max(20, top * 0.05)
			let best = null,
				bd = 1
			for (let k = 0; k < state.len; k++) {
				const st = state.s[k]
				if (!st) continue
				const dx = (px - knobX(k, lenOf(st), cw)) / rx,
					dy = (py - noteY(st[0], top)) / ry
				const d = dx * dx + dy * dy
				if (d < bd) {
					bd = d
					best = k
				}
			}
			return best
		}

		function sheetPointer(e) {
			const yy = clamp(e.y / BAND, 0, 1)
			const cw = e.w / N
			if (e.type === 'down') {
				const knob = e.alt || e.y > BAND ? null : knobAt(e.px, e.py, e.w, e.h)
				const reach = e.y > BAND ? 1 : 0.6
				if (knob == null && Math.abs(e.x * N - state.len) < reach) {
					press = { kind: 'len' }
					return
				}
				if (e.y > BAND) {
					press = null
					return
				}
				press = {
					kind: 'step',
					k: colOf(e.x),
					x0: e.px,
					y0: e.py,
					moved: false,
					last: colOf(e.x),
					erase: e.alt,
					knob,
					L0: knob == null ? 0 : lenOf(state.s[knob]),
				}
			} else if (e.type === 'move' && press) {
				if (press.kind === 'len') {
					state.len = clamp(Math.round(e.x * N), 1, N)
					return
				}
				const dx = e.px - press.x0,
					dy = e.py - press.y0
				if (!press.moved && Math.hypot(dx, dy) < 6) return
				// sideways off a knob pulls the tail; anything else draws across steps
				if (!press.moved && press.knob != null && Math.abs(dx) >= Math.abs(dy)) {
					press.kind = 'tail'
					ui.pull = press.knob
				}
				if (press.kind === 'tail') {
					press.moved = true
					const st = state.s[press.knob]
					if (st) st[1] = clamp(press.L0 + Math.round(dx / cw), 1, state.len)
					return
				}
				if (!press.moved) {
					press.moved = true
					paint(press.k, yy, press.erase)
				}
				const k = colOf(e.x)
				const a = Math.min(k, press.last),
					b = Math.max(k, press.last)
				for (let j = a; j <= b; j++) paint(j, yy, press.erase)
				press.last = k
			} else if (e.type === 'up' && press) {
				if (press.kind === 'step' && !press.moved)
					state.s[press.k] = press.erase
						? 0
						: state.s[press.k]
							? 0
							: inked(fresh(ui.param === 'pitch' ? Math.round((1 - yy) * PMAX) : 7))
				press = null
				ui.pull = -1
			}
		}

		// ring: x is the loop; drag draws pitch
		function ringPointer(e) {
			const kAt = (x) =>
				(loopStart() + clamp(Math.floor(x * clock.steps), 0, clock.steps - 1)) % state.len
			if (e.type === 'down') press = { k: kAt(e.x), x0: e.px, y0: e.py, moved: false, erase: e.alt }
			else if (e.type === 'move' && press) {
				if (!press.moved && Math.hypot(e.px - press.x0, e.py - press.y0) < 6) return
				press.moved = true
				const k = kAt(e.x)
				if (press.erase) state.s[k] = 0
				else ensure(k)[0] = clamp(Math.round((1 - e.y) * PMAX), 0, PMAX)
			} else if (e.type === 'up' && press) {
				if (!press.moved)
					state.s[press.k] =
						press.erase || state.s[press.k] ? 0 : inked(fresh(Math.round((1 - e.y) * PMAX)))
				press = null
			}
		}

		// a fat rounded bar from x0 to x1 at y
		function bar(g, x0, x1, y, th) {
			g.lineWidth = th
			g.beginPath()
			g.moveTo(x0, y)
			g.lineTo(Math.max(x0 + 0.1, x1), y)
			g.stroke()
		}

		function drawSheet(g, w, h, t) {
			const cw = w / N,
				top = h * BAND
			const ink = ctx.theme?.sheet?.ink || INK,
				col = ctx.color || '#c08419'
			const k0 = Math.floor(t.abs) % state.len
			const rOf = (v) => Math.max(3, Math.min(cw * 0.32, top * 0.06) * (0.55 + (v / 9) * 0.6))
			const th = Math.max(6, Math.min(cw * 0.34, top * 0.05))
			g.lineCap = 'round'
			g.lineJoin = 'round'
			if (ui.param !== 'pitch') {
				g.strokeStyle = tint(ink, 0.35)
				g.lineWidth = 1.2
				g.beginPath()
				let pen = false
				for (let k = 0; k < N; k++) {
					const st = state.s[k]
					if (!st) {
						pen = false
						continue
					}
					const y = (1 - st[IDX[ui.param]] / MAXOF[ui.param]) * top * 0.92 + top * 0.04
					pen ? g.lineTo((k + 0.5) * cw, y) : g.moveTo((k + 0.5) * cw, y)
					pen = true
				}
				g.stroke()
			}
			// the grid and the playing step's glow
			for (let k = 0; k < N; k++) {
				const x = (k + 0.5) * cw,
					inPat = k < state.len
				if (t.playing && k === k0) {
					g.fillStyle = tint(col, 0.16)
					blob(g, x, top / 2, cw * 0.46, top * 0.5, k)
					g.fill()
				}
				g.strokeStyle = tint(ink, !inPat ? 0.08 : k % 4 === 0 ? 0.3 : 0.16)
				g.lineWidth = 1
				g.setLineDash([1, 4])
				g.beginPath()
				g.moveTo(x, top * 0.04)
				g.lineTo(x, top * 0.96)
				g.stroke()
				g.setLineDash([])
				g.strokeStyle = tint(ink, inPat ? 0.6 : 0.2)
				g.lineWidth = 1.2
				g.beginPath()
				if (k % 4 === 0)
					for (let u = 0; u <= 1.001; u += 0.2) {
						const px = x - cw * 0.25 + u * cw * 0.5,
							py = top + 4 + Math.sin(u * 9 + k) * 1.5
						u ? g.lineTo(px, py) : g.moveTo(px, py)
					}
				else {
					g.moveTo(x, top + 2)
					g.lineTo(x, top + 6)
				}
				g.stroke()
			}
			// tails: solid while the note sounds, a thin dotted run where the next note has cut it
			for (let k = 0; k < state.len; k++) {
				const st = state.s[k]
				if (!st) continue
				const y = noteY(st[0], top),
					L = lenOf(st),
					hl = heard(k, st)
				const run = (a, b, solid) => {
					// a..b in columns from k's centre; wraps past the pattern's end
					const x0 = k + a,
						x1 = k + b
					const kind = INKS[inkOf(st)][0]
					const seg = (u0, u1) => {
						if (solid && kind === 'reed') {
							// reed: a breathing wave along the tail
							g.strokeStyle = tint(col, 0.9)
							g.lineWidth = 2.5
							g.beginPath()
							for (let x = u0 * cw; x <= u1 * cw - 4; x += 3) {
								const yy = y + Math.sin(x / 5) * th * 0.35
								x === u0 * cw ? g.moveTo(x, yy) : g.lineTo(x, yy)
							}
							g.stroke()
						} else if (solid && kind === 'organ') {
							// organ: flat and full, no fade, square-ended
							g.lineCap = 'butt'
							g.strokeStyle = tint(col, 0.95)
							bar(g, u0 * cw, u1 * cw - 4, y, th * 1.1)
							g.lineCap = 'round'
						} else if (solid && kind === 'keys') {
							// keys: a thinner tail that fades the way a Rhodes does
							const gr = g.createLinearGradient(u0 * cw, 0, u1 * cw, 0)
							gr.addColorStop(0, tint(col, 0.7))
							gr.addColorStop(1, tint(col, 0.08))
							g.strokeStyle = gr
							bar(g, u0 * cw, u1 * cw - th / 2, y, th * 0.55)
						} else if (solid) {
							g.strokeStyle = tint(col, 0.55)
							bar(g, u0 * cw, u1 * cw - th / 2, y, th) // the round cap ends at the knob
						} else {
							g.strokeStyle = tint(col, 0.6)
							g.setLineDash([2, 5])
							bar(g, u0 * cw, u1 * cw, y, 2)
							g.setLineDash([])
						}
					}
					if (x1 <= state.len) seg(x0, x1)
					else {
						if (x0 < state.len) seg(x0, state.len - 0.05)
						seg(Math.max(0.05, x0 - state.len), x1 - state.len)
					}
				}
				run(0.5, hl - 0.1, true)
				if (L > hl) run(hl - 0.1, L - 0.1, false)
			}
			for (let k = 0; k < N; k++) {
				const st = state.s[k]
				if (!st) continue
				const inPat = k < state.len,
					x = (k + 0.5) * cw
				const [p, , v, c] = st
				const y = noteY(p, top)
				const r = rOf(v)
				const glow = fx.glow(k, t.now, 0.3)
				const kind = INKS[inkOf(st)][0],
					rr = r * (1 + glow * 0.35)
				if (kind === 'keys') {
					g.strokeStyle = tint(col, inPat ? 0.6 : 0.2)
					g.lineWidth = 1.5
					g.beginPath()
					g.arc(x, y, rr * 1.7, 0, TAU)
					g.stroke()
				}
				if (kind === 'organ') {
					g.beginPath()
					g.roundRect(x - rr, y - rr * 0.8, rr * 2, rr * 1.6, 2)
				} else if (kind === 'reed') {
					g.beginPath()
					g.moveTo(x, y - rr * 1.25)
					g.lineTo(x + rr * 1.1, y)
					g.lineTo(x, y + rr * 1.25)
					g.lineTo(x - rr * 1.1, y)
					g.closePath()
				} else blob(g, x, y, rr, rr, k + 3)
				g.fillStyle = glow ? ink : tint(col, inPat ? 1 : 0.35)
				g.fill()
				g.strokeStyle = tint(ink, inPat ? 0.9 : 0.3)
				g.lineWidth = 1.2
				g.setLineDash(c < 9 ? [1.5, 2.5 + (9 - c) * 0.6] : [])
				g.stroke()
				g.setLineDash([])
				if (c < 9) {
					g.fillStyle = tint(ink, 0.55)
					g.font = `${Math.max(9, Math.min(13, cw * 0.28))}px ${SANS}`
					g.textAlign = 'center'
					g.textBaseline = 'top'
					g.fillText(`${(c + 1) * 10}%`, x, top * 0.94)
				}
			}
			// knobs on top, so they read as the thing to grab
			const kr = Math.max(7, Math.min(cw * 0.2, 10))
			for (let k = 0; k < state.len; k++) {
				const st = state.s[k]
				if (!st) continue
				const L = lenOf(st),
					x = knobX(k, L, cw),
					y = noteY(st[0], top),
					pulled = ui.pull === k
				// an upright capsule, like the trim handle on a clip
				const kw = kr * (pulled ? 1.3 : 1),
					kh = Math.max(kr * 2.4, th + 8) * (pulled ? 1.15 : 1)
				g.beginPath()
				g.roundRect(x - kw / 2, y - kh / 2, kw, kh, kw / 2)
				g.fillStyle = pulled ? col : '#fff'
				g.fill()
				g.strokeStyle = ink
				g.lineWidth = 1.6
				g.stroke()
				if (pulled) {
					g.fillStyle = ink
					g.font = `600 ${Math.max(11, Math.min(15, cw * 0.4))}px ${SANS}`
					g.textAlign = 'center'
					g.textBaseline = 'bottom'
					g.fillText(`${L}`, x, y - kh / 2 - 4)
				}
			}
			const bx = state.len * cw
			g.strokeStyle = ink
			g.lineWidth = 2
			g.beginPath()
			g.moveTo(bx - 6, 3)
			g.lineTo(bx, 3)
			g.lineTo(bx, top - 3)
			g.lineTo(bx - 6, top - 3)
			g.stroke()
			// the pattern's length sits under its bracket
			g.font = `600 ${Math.max(11, Math.min(15, h * 0.045))}px ${SANS}`
			g.textBaseline = 'middle'
			g.textAlign = 'center'
			const lw = g.measureText(`${state.len}`).width
			g.fillStyle = tint(ink, 0.6)
			g.fillText(`${state.len}`, clamp(bx, lw / 2 + 4, w - lw / 2 - 4), top + (h - top) * 0.62)
		}

		// ring: a note is a dot, a held note an arc round the dial as long as it sounds
		function drawRing(g, w, h, t) {
			const n = clock.steps,
				cw = w / n,
				base = Math.floor(t.abs / n) * n
			const col = ctx.color || '#c08419'
			g.lineCap = 'round'
			for (let s = -N; s < n; s++) {
				const k = (((base + s) % state.len) + state.len) % state.len,
					st = state.s[k],
					x = (s + 0.5) * cw
				if (s >= 0 && k === 0 && state.len !== n) {
					g.fillStyle = tint(INK, 0.25)
					g.fillRect(s * cw, 1, 1, h - 2)
				} // pattern restarts here
				if (!st) continue
				const hl = heard(k, st)
				if (s < 0 && s + hl <= 0) continue
				const [p, , v, c] = st
				const y = (1 - p / PMAX) * h * 0.8 + h * 0.1
				const r = Math.max(1.8, Math.min(h * 0.09, cw * 0.35) * (0.6 + (v / 9) * 0.5))
				if (hl > 1) {
					g.strokeStyle = tint(col, 0.75)
					bar(g, x, x + (hl - 1.3) * cw, y, Math.max(2, r * 1.3))
				}
				if (s < 0) continue
				const glow = fx.glow(`a${(base + s) % 256}`, t.now, 0.3)
				const kind = INKS[inkOf(st)][0],
					rr = r * (1 + glow * 0.4)
				g.beginPath()
				if (kind === 'organ') g.rect(x - rr, y - rr * 0.8, rr * 2, rr * 1.6)
				else if (kind === 'reed') {
					g.moveTo(x, y - rr * 1.3)
					g.lineTo(x + rr, y)
					g.lineTo(x, y + rr * 1.3)
					g.lineTo(x - rr, y)
					g.closePath()
				} else g.arc(x, y, kind === 'keys' ? rr * 0.75 : rr, 0, TAU)
				g.fillStyle = glow ? INK : col
				g.fill()
				g.strokeStyle = INK
				g.lineWidth = 1
				g.setLineDash(c < 9 ? [1.2, 2] : [])
				g.stroke()
				g.setLineDash([])
			}
		}

		return {
			get state() {
				return state
			},
			// what a drag draws: a tool from the row under the sheet, not a place on it
			get mode() {
				return ui.param
			},
			set mode(v) {
				if (PARAMS.includes(v)) ui.param = v
			},
			get ink() {
				return INKS[ink][0]
			},
			set ink(v) {
				ink = Math.max(
					0,
					INKS.findIndex((i) => i[0] === v),
				)
			},
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
				voice(st, t, dur, k)
				fx.hit(k, t)
				fx.hit(`a${abs % 256}`, t)
			},
			frame(g, w, h, clk, sh) {
				size[0] = w
				size[1] = h
				shape = sh || (isStrip(w, h) ? 'ring' : 'sheet')
				const t = { abs: absNow(clk), now: clk.now(), playing: clk.playing ?? true }
				return shape === 'sheet' ? drawSheet(g, w, h, t) : drawRing(g, w, h, t)
			},
			setState(s) {
				const old = !(s.v >= 2)
				state.len = clamp(s.len | 0 || N, 1, N)
				state.s = Array.from({ length: N }, (_, k) => {
					if (!Array.isArray(s.s[k])) return 0
					const st = s.s[k].slice(0, 5).map((v) => v | 0)
					if (st.length > 4 && !(st[4] > 0 && st[4] < INKS.length)) st.length = 4
					st[1] = clamp(old ? oldLen(st[1]) : st[1], 1, N)
					return st
				})
			},
			clear() {
				state.s = Array(N).fill(0)
				state.len = N
			},
			randomize() {
				this.setState(gen())
			},
			dispose() {
				held = null
			},
		}
	},
}
