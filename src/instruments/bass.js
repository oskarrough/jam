// Bass: an elastic riff. Its notes fill the seat's loop however long that is, so pulling the knot
// at the end of the loop stretches them: halftime, double time, or somewhere off the grid in between.
// Draw on it (height is pitch) and it snaps back onto the steps.
//
// state = { riff, ink, len? }
//   riff  one character per cell: '0'..'7' a scale degree, '.' a rest. The cells spread evenly over the loop.
//   ink   one digit per cell, its ink, picked in the tool strip per note. Absent before inks: the seat's old voice.
//   len   only on hosts without ctx.setLen: the loop length in steps the riff stretches over.

import { voice as jukebox } from './lib/voices.js'
import { voiced, head, dash } from './lib/voiced.js'
import { kit } from './lib/kit.js'
import { mtof, env, osc, rnd, val, rgba, clamp, withPointer, isStrip, fit } from './lib/util.js'
import { wave } from './lib/demo.js'
import { INK } from '../palette.js'

const PAD = 0.03 // side inset so a first-step note isn't clipped
const GUT = 0.12 // the strip along the bottom where the knot lives
const MAX = 256

export const parseRiff = (r) =>
	[...(typeof r === 'string' ? r : '')].slice(0, MAX).map((c) => (c >= '0' && c <= '7' ? +c : -1))
export const riffOf = (a) => a.map((v) => (v >= 0 && v <= 7 ? String(v) : '.')).join('')

// cells to a new count, each note landing on the cell nearest its old onset; inks (ks) ride along
export function regrid(a, n, ks = []) {
	const out = new Array(n).fill(-1),
		ink = new Array(n).fill(0)
	a.forEach((v, c) => {
		if (v < 0) return
		const j = Math.round((c * n) / a.length)
		if (j < n && out[j] < 0) {
			out[j] = v
			ink[j] = ks[c] || 0
		}
	})
	out.ink = ink
	return out
}

// a short motif, tiled to fill the loop
function gen(steps = 32) {
	const len = [4, 8, 8, 16, 16, 6, 12][rnd(7)]
	const a = new Array(len).fill(-1)
	for (let s = 0; s < len; s++)
		if (s === 0 || Math.random() < (s % 4 === 0 ? 0.8 : s % 2 ? 0.35 : 0.5))
			a[s] = s ? [0, 0, 3, 4, 2, 5, 0, 7][rnd(8)] : 0
	return { riff: riffOf(fit(a, steps, -1)) }
}

function saw({ audio: ac, out, params }, m, t, dur) {
	const f = mtof(m),
		g = ac.createGain(),
		lp = ac.createBiquadFilter()
	lp.type = 'lowpass'
	lp.Q.value = 7
	lp.frequency.setValueAtTime(f * val(params.cutoff), t)
	lp.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.22)
	env(g, t, 0.006, 0.32, dur * 2.4)
	lp.connect(g)
	g.connect(out)
	osc(ac, 'sawtooth', f, t, 0.9, lp)
	osc(ac, 'sine', f / 2, t, 0.9, g)
}

const V = voiced(
	[
		['synbass', jukebox('synbass', -5.4), 'dot'],
		['saw', saw, 'tri'],
		['808', jukebox('808', -9.9), 'ring'],
		['log drum', jukebox('logdrum', -10.5), 'bar'],
		['upright', jukebox('upright', -4.4), 'tall'],
	],
	{
		octave: { value: 0, min: -1, max: 1, step: 1 },
		cutoff: { value: 9, min: 2, max: 24, step: 0.5 },
	},
)

const SAMPLE = [
	0, -1, -1, 0, -1, -1, 5, -1, 0, -1, -1, 0, -1, -1, 3, -1, 1, -1, -1, 1, -1, -1, 6, -1, 1, -1, -1,
	1, -1, -1, 4, -1, 2, -1, -1, 2, -1, -1, 7, -1, 2, -1, -1, 2, -1, -1, 5, -1, 3, -1, -1, 3, -1, -1,
	3, -1, 3, -1, 4, -1, 3, -1, 2, -1,
]
// synbass, with the turnaround in the last bar on 808
const SAMPLE_INK = SAMPLE.map((_, c) => (c >= 56 ? 2 : 0)).join('')
const inksOf = (s, n) => Array.from({ length: n }, (_, c) => +s?.[c] || 0)

export default {
	id: 'bass',
	ownLength: true, // the knot sets the loop, so the sheet's bracket stays off
	glyph:
		'<path d="M3 19c4-9 8 9 13 0s9 9 13 0" stroke-width="2.4"/><circle class="f" cx="29" cy="19" r="2.6"/>',
	name: 'Bass',
	how: 'An elastic riff: draw notes, higher is higher. Pull the knot at the end to stretch the whole riff longer or squeeze it shorter. Tap a note to lift it off; Shift-drag erases.',
	inks: V.inks,
	params: V.params,
	optional: ['len'],
	demo: (shape) =>
		shape === 'ring'
			? [wave(0.06, 0.5, 0.55, 0.25, 1, 16)]
			: [
					wave(0.06, 0.45, 0.5, 0.25, 1, 16),
					[
						[0.97, 0.94],
						[0.8, 0.94],
						[0.62, 0.94],
						[0.75, 0.94],
						[0.97, 0.94],
					],
				],
	generate: (steps) => gen(steps),
	sample: (steps) => ({
		riff: riffOf(fit(SAMPLE, steps, -1)),
		ink: fit([...SAMPLE_INK], steps, '0').join(''),
	}),
	create(ctx) {
		const { clock } = ctx
		const harmony = kit(ctx.audio)
		const size = [1, 1]
		let cells = parseRiff(riffOf(fit(SAMPLE, clock.steps, -1)))
		let ks = inksOf(fit([...SAMPLE_INK], clock.steps, '0'), cells.length) // each cell's ink
		let ink = 0 // the brush in your hand; local, but every note keeps its own
		const put = (c, v) => {
			cells[c] = v
			if (v >= 0) ks[c] = ink
		}
		let len = null // fallback loop length when the host can't set the seat's own
		let g = null // gesture in progress
		const own = typeof ctx.setLen === 'function'
		const L = () => (own ? clock.steps : clamp(len || clock.steps, 1, clock.steps))
		const setL = (n) => {
			if (n === L()) return
			if (own) ctx.setLen(n)
			else len = n === clock.steps ? null : n
		}
		// onsets in steps across the loop: copy k of the riff starts at k * L()
		const onsets = function* () {
			const l = L(),
				n = cells.length,
				steps = span()
			for (let k = 0; k * l < steps; k++)
				for (let c = 0; c < n; c++) {
					if (cells[c] < 0) continue
					const t = k * l + (c * l) / n
					if (t >= steps) break
					yield { t, c, v: cells[c], k, i: ks[c] }
				}
		}
		// steps the sheet spans: the loop, or while the knot is held, room to pull it either way
		const span = () => (g?.mode === 'knot' ? g.ref : clock.steps)
		const knotX = (w) => w * PAD + (L() / span()) * w * (1 - 2 * PAD)

		function pointer(e) {
			const strip = isStrip(e.w, e.h, e.shape)
			const gut = strip ? 0 : GUT
			const iw = 1 - 2 * PAD
			const x = clamp((e.x - PAD) / iw, 0, 0.9999)
			if (e.type === 'down') {
				if (!strip && Math.abs(e.px - knotX(e.w)) < 26 && e.py > e.h * (1 - gut * 2.4))
					return (g = {
						mode: 'knot',
						ref: own ? clamp(L() * 2, 2, MAX) : clock.steps,
						x0: x,
						l0: L(),
					})
			}
			if (g?.mode === 'knot') {
				if (e.type === 'up' || e.type === 'cancel') return (g = null)
				// relative, so the knot doesn't jump to the finger when the sheet makes room
				setL(clamp(Math.round(g.l0 + (x - g.x0) * g.ref), 1, g.ref))
				return
			}
			const l = L()
			// drawing snaps the riff back to one cell per step
			if (e.type === 'down' && cells.length !== l) {
				cells = regrid(cells, l, ks)
				ks = cells.ink
			}
			const n = cells.length
			const s = Math.floor((x * span()) % l)
			const c = clamp(s, 0, n - 1)
			const v = clamp(Math.floor((1 - e.y / (1 - gut)) * 8), 0, 7)
			const erase = e.alt || e.button === 2
			if (e.type === 'down') {
				if (!erase && cells[c] === v) g = { mode: 'note', c, v }
				else {
					put(c, erase ? -1 : v)
					g = { mode: 'draw', c, v, erase }
				}
				return
			}
			if (e.type === 'up' || e.type === 'cancel') {
				if (g?.mode === 'note' && e.type === 'up') cells[g.c] = -1
				g = null
				return
			}
			if (e.type !== 'move' || !g) return
			if (g.mode === 'note') {
				if (c === g.c && v === g.v) return
				g.mode = 'draw'
			}
			let d = c - g.c
			if (d > n / 2) d -= n
			if (d < -n / 2) d += n
			const k = Math.abs(d)
			for (let j = 1; j <= k; j++)
				put((g.c + Math.sign(d) * j + n) % n, g.erase ? -1 : Math.round(g.v + ((v - g.v) * j) / k))
			if (!k) put(c, g.erase ? -1 : v)
			g = { ...g, c, v }
		}

		return {
			get state() {
				const s = { riff: riffOf(cells), ink: ks.join('') }
				if (len) s.len = len
				return s
			},
			setState(s) {
				if (s && typeof s.riff === 'string') cells = parseRiff(s.riff)
				else if (Array.isArray(s?.notes))
					// a part saved by the old line-drawing bass
					cells = s.notes
						.slice(0, MAX)
						.map((v) => (Number.isInteger(v) && v >= 0 && v <= 7 ? v : -1))
				else cells = new Array(clock.steps).fill(-1)
				if (!cells.length) cells = [-1]
				// notes from before inks ring in the seat's old voice; they keep that ink for good
				ks =
					typeof s?.ink === 'string'
						? inksOf(s.ink, cells.length).map((k) => k % V.names.length)
						: new Array(cells.length).fill(V.legacy(ctx))
				len = !own && Number.isInteger(s?.len) ? clamp(s.len, 1, MAX) : null
			},
			clear() {
				cells = new Array(L()).fill(-1)
				ks = new Array(cells.length).fill(0)
			},
			get ink() {
				return V.names[ink]
			},
			set ink(v) {
				ink = V.index(v)
			},
			pointer: withPointer(size, pointer),
			step(i, time, dur) {
				const o = val(ctx.params.octave) - 2, // the key's A3 is 57; bass sits two octaves down
					l = L(),
					stretch = l / cells.length
				const at = own ? i % l : i
				// only this step's onsets: copy floor(at / l), cells whose onset falls in [at, at + 1)
				const k = Math.floor(at / l),
					n = cells.length
				const c0 = Math.max(0, Math.ceil(((at - k * l) * n) / l - 1e-9))
				for (let c = c0; c < n; c++) {
					const t = k * l + (c * l) / n
					if (t >= at + 1 - 1e-9) break
					if (cells[c] < 0) continue
					V.fn(ks[c])(ctx, harmony.degree(cells[c], o), time + (t - at) * dur, dur * Math.max(0.5, stretch))
				}
			},
			frame(gx, w, h, clock, shape) {
				size[0] = w
				size[1] = h
				const strip = isStrip(w, h, shape)
				const gut = strip ? 0 : GUT
				const steps = span(),
					l = L(),
					n = cells.length,
					pos = clock.pos()
				const iw = w * (1 - 2 * PAD),
					ih = h * (1 - gut)
				const cw = (l / n) * (iw / steps) // one cell's width
				const X = (t) => w * PAD + (t / steps) * iw + Math.min(cw, iw / steps) / 2,
					Y = (v) => (1 - (v + 0.5) / 8) * ih
				const color = ctx.color
				const lw = Math.max(1.6, Math.min(5, h * 0.06))
				const notes = [...onsets()]
				gx.lineCap = 'round'
				gx.lineJoin = 'round'
				// the riff's copies: seams, then the line through every note
				if (!strip) {
					gx.strokeStyle = rgba(color, 0.35)
					gx.lineWidth = 1
					gx.setLineDash([3, 5])
					for (let k = 1; k * l < steps; k++) {
						const x = w * PAD + ((k * l) / steps) * iw
						gx.beginPath()
						gx.moveTo(x, 0)
						gx.lineTo(x, ih)
						gx.stroke()
					}
					gx.setLineDash([])
				}
				const curve = (a, b) => {
					const x0 = X(a.t),
						x1 = X(b.t)
					for (let j = 0; j <= 8; j++) {
						const f = j / 8,
							e = f * f * (3 - 2 * f)
						const x = x0 + (x1 - x0) * f,
							y = Y(a.v + (b.v - a.v) * e)
						j ? gx.lineTo(x, y) : gx.moveTo(x, y)
					}
				}
				// the ink pass whole, then the colour pass ink by ink, each leg in its first note's dash
				for (const pass of [-1, ...new Set(notes.map((x) => x.i))]) {
					gx.beginPath()
					for (let j = 0; j + 1 < notes.length; j++) {
						const a = notes[j],
							b = notes[j + 1]
						// neighbours on the riff only: a rest between them breaks the line
						const gap = b.t - a.t
						if (gap > (l / n) * 1.01 + 1e-9 || (pass >= 0 && a.i !== pass)) continue
						curve(a, b)
					}
					gx.strokeStyle = pass >= 0 ? color : INK
					gx.lineWidth = pass >= 0 ? lw : lw + 2.2
					gx.setLineDash(pass >= 0 ? dash(V.mark(pass), lw) : [])
					gx.stroke()
				}
				gx.setLineDash([])
				const r = Math.max(strip ? 3.2 : 2.2, Math.min(9, h * 0.075, cw * 0.6 + 3))
				gx.lineWidth = 1.1
				for (const x of notes) {
					const d = pos - x.t,
						f = d >= 0 && d < 1.5 ? 1 - d / 1.5 : 0
					const faded = !strip && x.k > 0
					if (f) {
						gx.strokeStyle = rgba(INK, 0.6 * f)
						gx.beginPath()
						gx.arc(X(x.t), Y(x.v), r + 3 + (1 - f) * 7, 0, 6.283)
						gx.stroke()
					}
					gx.strokeStyle = INK
					gx.fillStyle = f > 0.3 ? INK : faded ? rgba(color, 0.55) : color
					head(gx, V.mark(x.i), X(x.t), Y(x.v), r + f * 2)
				}
				if (strip) return
				// the elastic: a band from the start to the knot, thinner and straighter the more it's stretched
				const kx = knotX(w),
					ky = h * (1 - gut / 2),
					x0 = w * PAD,
					tension = clamp(l / n, 0.25, 4)
				const wob = Math.min(5, 2.5 / tension) * Math.min(1, h * 0.012)
				const t0 = (clock.now?.() ?? 0) * 3
				for (const pass of [0, 1]) {
					gx.beginPath()
					for (let j = 0; j <= 96; j++) {
						const f = j / 96,
							x = x0 + (kx - x0) * f
						const y = ky + Math.sin(f * Math.PI * (2 + n / 16) + t0) * wob * Math.sin(f * Math.PI)
						j ? gx.lineTo(x, y) : gx.moveTo(x, y)
					}
					gx.strokeStyle = pass ? color : INK
					gx.lineWidth = (pass ? 3 : 5.2) / Math.sqrt(tension)
					gx.stroke()
				}
				const kr = Math.max(8, Math.min(14, h * 0.035))
				gx.fillStyle = g?.mode === 'knot' ? INK : color
				gx.strokeStyle = INK
				gx.lineWidth = 2
				gx.beginPath()
				gx.arc(kx, ky, kr, 0, 6.283)
				gx.fill()
				gx.stroke()
				// a knot, not a dot: one loop of string through it
				gx.strokeStyle = g?.mode === 'knot' ? color : INK
				gx.lineWidth = 1.6
				gx.beginPath()
				gx.ellipse(kx, ky, kr * 0.5, kr * 0.28, 0.6, 0, 6.283)
				gx.stroke()
			},
			dispose() {},
		}
	},
}
