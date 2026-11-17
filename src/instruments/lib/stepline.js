// Stepline: draw a line across the seat, one note per step, height = pitch.
// Factory used by the bass, keys and bell instruments; they differ only in voice and range.
// `voices` ([[name, fn], …]) adds a synced `voice` param; the first is the default.
//
// state = { notes, hold, stack }
//   notes[s]  degree 0..7, or -1 for rest
//   hold[s]   steps the note sounds (1 = one step); cut short by the next note
//   stack[s]  more degrees on the same step, for chords (up to `chords - 1` of them)
// Tap a note to lift it off; drag right from a note to hold it; drag up or down from it to move it.
// With `chords` > 1, tapping another height on a step that has a note adds it to the chord.

import { fit, val, rgba, clamp } from './util.js'
import { kit } from './kit.js'
import { wave } from './demo.js'
import { INK } from '../../palette.js'

// side inset (fraction of the width) so a note on the first or last step is not clipped by the panel
const PAD = 0.03
const ones = (n) => new Array(n).fill(1)
const empties = (n) => Array.from({ length: n }, () => [])
const part = (notes, extra = {}) => ({
	notes,
	hold: extra.hold || ones(notes.length),
	stack: extra.stack || empties(notes.length),
})

export function stepline({
	id,
	name,
	how,
	glyph,
	base,
	voice,
	voices,
	params = {},
	generate,
	sample,
	chords = 1,
}) {
	const byName = voices && new Map(voices)
	if (voices)
		params = { voice: { value: voices[0][0], options: voices.map(([n]) => n) }, ...params }
	const play = (ctx) => byName?.get(ctx.params.voice) || voice || voices[0][1]
	return {
		id,
		name,
		how,
		demo: () => [wave(0.06, 0.6, 0.55, 0.25, 1, 20)],
		glyph,
		voices: voices ? voices.map(([n]) => n) : null,
		params: { octave: { value: 0, min: -1, max: 1, step: 1 }, ...params },
		chords,
		optional: ['hold', 'stack'],
		generate: (steps) => {
			const g = generate()
			if (Array.isArray(g)) return part(fit(g, steps, -1))
			const notes = fit(g.notes, steps, -1)
			return part(notes, {
				hold: g.hold && fit(g.hold, steps, 1),
				stack: g.stack && fit(g.stack, steps, []).map((x) => x.slice()),
			})
		},
		sample: (steps) => part(fit(sample, steps, -1)),
		create(ctx) {
			const { clock } = ctx
			const harmony = kit(ctx.audio)
			const oct = Math.round((base - 57) / 12) // base is a midi note in A; the shared key moves it
			let notes = new Array(clock.steps).fill(-1),
				hold = ones(clock.steps),
				stack = empties(clock.steps)
			let g = null // the gesture in progress
			const ensure = () => {
				if (notes.length === clock.steps) return
				notes = fit(notes, clock.steps, -1)
				hold = fit(hold, clock.steps, 1)
				stack = fit(stack, clock.steps, []).map((x) => x.slice())
			}
			const put = (s, v, erase) => {
				notes[s] = erase ? -1 : v
				hold[s] = 1
				stack[s] = []
			}
			// lift one note off a step; the chord's next note becomes the root
			const lift = (s, v) => {
				if (notes[s] === v) {
					notes[s] = stack[s].length ? stack[s].shift() : -1
					if (notes[s] < 0) hold[s] = 1
				} else stack[s] = stack[s].filter((x) => x !== v)
			}
			// steps until the next note, so a held note never rings over the one after it
			const room = (s) => {
				const n = notes.length
				for (let k = 1; k < n; k++) if (notes[(s + k) % n] >= 0) return k
				return n
			}
			const span = (s) => Math.max(1, Math.min(hold[s] || 1, room(s)))

			return {
				get state() {
					return { notes, hold, stack }
				},
				setState(s) {
					notes = s?.notes ? s.notes.slice() : new Array(clock.steps).fill(-1)
					hold =
						Array.isArray(s?.hold) && s.hold.length === notes.length
							? s.hold.map((x) => clamp(Math.round(x) || 1, 1, notes.length))
							: ones(notes.length)
					stack =
						Array.isArray(s?.stack) && s.stack.length === notes.length
							? s.stack.map((x) =>
									Array.isArray(x) ? x.filter((v) => v >= 0 && v <= 7).slice(0, chords - 1) : [],
								)
							: empties(notes.length)
				},
				clear() {
					notes = new Array(clock.steps).fill(-1)
					hold = ones(clock.steps)
					stack = empties(clock.steps)
				},
				pointer(e) {
					ensure()
					const n = clock.steps
					e = { ...e, x: Math.max(0, Math.min(0.9999, (e.x - PAD) / (1 - 2 * PAD))) }
					const s = Math.min(n - 1, Math.floor(e.x * n))
					const v = Math.max(0, Math.min(7, Math.floor((1 - e.y) * 8)))
					const erase = e.alt || e.button === 2
					if (e.type === 'down') {
						if (erase) {
							put(s, v, true)
							g = { mode: 'draw', s, v, erase }
							return
						}
						const has = notes[s] === v || stack[s].includes(v)
						if (has) g = { mode: 'note', s, v, x0: e.x }
						else if (notes[s] >= 0 && chords > 1) g = { mode: 'chord', s, v }
						else {
							put(s, v)
							g = { mode: 'draw', s, v }
						}
						return
					}
					if (e.type === 'up') {
						if (g?.mode === 'note') lift(g.s, g.v)
						else if (g?.mode === 'chord') {
							if (stack[g.s].length >= chords - 1) stack[g.s].pop()
							stack[g.s].push(g.v)
							stack[g.s].sort((a, b) => a - b)
						}
						g = null
						return
					}
					if (e.type !== 'move' || !g) return
					if (g.mode === 'note') {
						// which way it goes decides: right holds, up or down moves the note
						const dx = (e.x - g.x0) * n
						if (dx >= 0.6) g.mode = 'hold'
						else if (v !== g.v && dx > -0.6) g.mode = 'move'
						else if (dx <= -0.6) {
							put(g.s, g.v)
							g.mode = 'draw'
						}
					}
					if (g.mode === 'chord' && s !== g.s) {
						put(g.s, g.v)
						g.mode = 'draw'
					}
					if (g.mode === 'hold') {
						const d = (s - g.s + n) % n
						hold[g.s] = clamp(d + 1, 1, n)
						return
					}
					if (g.mode === 'move') {
						if (notes[g.s] === g.v) notes[g.s] = v
						else
							stack[g.s] = [...stack[g.s].filter((x) => x !== g.v && x !== v), v].sort(
								(a, b) => a - b,
							)
						g.v = v
						return
					}
					if (g.mode !== 'draw') return
					let d = s - g.s
					if (d > n / 2) d -= n
					if (d < -n / 2) d += n
					const k = Math.abs(d)
					for (let j = 1; j <= k; j++)
						put((g.s + Math.sign(d) * j + n) % n, Math.round(g.v + ((v - g.v) * j) / k), g.erase)
					if (!k) put(s, v, g.erase)
					g = { ...g, s, v }
				},
				step(i, time, dur) {
					const k = i % notes.length,
						v = notes[k]
					if (v < 0) return
					const o = oct + val(ctx.params.octave),
						d = dur * span(k),
						fn = play(ctx)
					fn(ctx, harmony.degree(v, o), time, d)
					for (const x of stack[k] || []) fn(ctx, harmony.degree(x, o), time, d, 0.55)
				},
				frame(gx, w, h, clock) {
					ensure()
					const n = notes.length,
						pos = clock.pos()
					const iw = w * (1 - 2 * PAD)
					const X = (s) => w * PAD + ((s + 0.5) / n) * iw,
						Y = (v) => (1 - (v + 0.5) / 8) * h
					const color = ctx.color
					const lw = Math.max(1.6, Math.min(5, h * 0.06))
					gx.lineCap = 'round'
					gx.lineJoin = 'round'
					// held notes: a flat bar at the note's height for as long as it rings
					gx.beginPath()
					for (let s = 0; s < n; s++) {
						if (notes[s] < 0 || span(s) < 2) continue
						const x1 = X(s) + (span(s) - 0.5) * (iw / n) - lw
						for (const v of [notes[s], ...(stack[s] || [])]) {
							gx.moveTo(X(s), Y(v))
							gx.lineTo(x1, Y(v))
						}
					}
					gx.strokeStyle = INK
					gx.lineWidth = lw * 2.4 + 2.2
					gx.stroke()
					gx.strokeStyle = rgba(color, 0.85)
					gx.lineWidth = lw * 2.4
					gx.stroke()
					gx.beginPath()
					for (let s = 0; s < n; s++) {
						const a = notes[s],
							b = notes[(s + 1) % n]
						if (a < 0 || b < 0 || span(s) > 1) continue
						const x0 = X(s),
							x1 = s + 1 === n ? iw + X(0) : X(s + 1)
						for (let k = 0; k <= 8; k++) {
							const f = k / 8,
								e = f * f * (3 - 2 * f)
							const x = x0 + (x1 - x0) * f,
								y = Y(a + (b - a) * e)
							k ? gx.lineTo(x, y) : gx.moveTo(x, y)
						}
					}
					gx.strokeStyle = INK
					gx.lineWidth = lw + 2.2
					gx.stroke()
					gx.strokeStyle = color
					gx.lineWidth = lw
					gx.stroke()
					const r = Math.max(2.2, Math.min(9, h * 0.075))
					gx.lineWidth = 1.1
					gx.strokeStyle = INK
					for (let s = 0; s < n; s++) {
						const v = notes[s]
						if (v < 0) continue
						const d = (pos - s + n) % n,
							f = d < 1.5 ? 1 - d / 1.5 : 0
						const all = [v, ...(stack[s] || [])]
						// a chord hangs on one ink stem
						if (all.length > 1) {
							gx.lineWidth = 1.6
							gx.beginPath()
							gx.moveTo(X(s), Y(Math.min(...all)))
							gx.lineTo(X(s), Y(Math.max(...all)))
							gx.stroke()
							gx.lineWidth = 1.1
						}
						if (f) {
							gx.strokeStyle = rgba(INK, 0.6 * f)
							gx.beginPath()
							gx.arc(X(s), Y(v), r + 3 + (1 - f) * 7, 0, 6.283)
							gx.stroke()
							gx.strokeStyle = INK
						}
						gx.fillStyle = f > 0.3 ? INK : color
						for (const u of all) {
							gx.beginPath()
							gx.arc(X(s), Y(u), (u === v ? r : r * 0.8) + f * 2, 0, 6.283)
							gx.fill()
							gx.stroke()
						}
					}
				},
				dispose() {},
			}
		},
	}
}
