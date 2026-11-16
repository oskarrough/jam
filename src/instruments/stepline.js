// Stepline: draw a line across the lane, one note per step, height = pitch.
// Factory used by the bass, keys and bell instruments; they differ only in voice and range.

import { SCALE, fit, val, rgba } from './util.js'

export function stepline({ id, name, base, voice, params = {}, generate, sample }) {
	return {
		id,
		name,
		params: { octave: { value: 0, min: -1, max: 1, step: 1 }, ...params },
		// optional hooks used by frengers (bots) and first load
		generate: (steps) => ({ notes: fit(generate(), steps, -1) }),
		sample: (steps) => ({ notes: fit(sample, steps, -1) }),
		create(ctx) {
			const { clock } = ctx
			let notes = new Array(clock.steps).fill(-1)
			let last = null
			const ensure = () => { if (notes.length !== clock.steps) notes = fit(notes, clock.steps, -1) }
			const put = (s, v, erase) => { notes[s] = erase ? -1 : v }

			return {
				get state() { return { notes } },
				setState(s) { notes = s?.notes ? s.notes.slice() : new Array(clock.steps).fill(-1) },
				clear() { notes = new Array(clock.steps).fill(-1) },
				pointer(e) {
					ensure()
					const n = clock.steps
					const s = Math.min(n - 1, Math.floor(e.x * n))
					const v = Math.max(0, Math.min(7, Math.floor((1 - e.y) * 8)))
					const erase = e.alt || e.button === 2
					if (e.type === 'down') { put(s, v, erase); last = { s, v, erase } }
					else if (e.type === 'move' && last) {
						// fill skipped steps the short way round, interpolating height
						let d = s - last.s
						if (d > n / 2) d -= n
						if (d < -n / 2) d += n
						const k = Math.abs(d)
						for (let j = 1; j <= k; j++) put((last.s + Math.sign(d) * j + n) % n, Math.round(last.v + ((v - last.v) * j) / k), last.erase)
						if (!k) put(s, v, last.erase)
						last = { ...last, s, v }
					} else if (e.type === 'up') last = null
				},
				step(i, time, dur) {
					const v = notes[i % notes.length]
					if (v >= 0) voice(ctx, base + 12 * val(ctx.params.octave) + SCALE[v], time, dur)
				},
				frame(g, w, h, clock) {
					const n = notes.length, pos = clock.pos()
					const X = (s) => ((s + 0.5) / n) * w, Y = (v) => (1 - (v + 0.5) / 8) * h
					const color = ctx.color
					g.lineWidth = Math.max(1.6, h * 0.06)
					g.lineCap = 'round'
					g.lineJoin = 'round'
					g.strokeStyle = color
					g.shadowColor = color
					g.shadowBlur = 8
					g.beginPath()
					for (let s = 0; s < n; s++) {
						const a = notes[s], b = notes[(s + 1) % n]
						if (a < 0 || b < 0) continue
						const x0 = X(s), x1 = s + 1 === n ? w + X(0) : X(s + 1)
						for (let k = 0; k <= 8; k++) {
							const f = k / 8, e = f * f * (3 - 2 * f)
							const x = x0 + (x1 - x0) * f, y = Y(a + (b - a) * e)
							k ? g.lineTo(x, y) : g.moveTo(x, y)
						}
					}
					g.stroke()
					g.shadowBlur = 0
					const r = Math.max(2, h * 0.07)
					for (let s = 0; s < n; s++) {
						const v = notes[s]
						if (v < 0) continue
						const d = (pos - s + n) % n, f = d < 1.5 ? 1 - d / 1.5 : 0
						if (f) { g.fillStyle = rgba(color, 0.25 * f); g.beginPath(); g.arc(X(s), Y(v), r + 2 + f * 8, 0, 6.283); g.fill() }
						g.fillStyle = f ? '#fff6e8' : color
						g.beginPath(); g.arc(X(s), Y(v), r + f * 2, 0, 6.283); g.fill()
					}
				},
				dispose() {},
			}
		},
	}
}
