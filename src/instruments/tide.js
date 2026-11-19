// Tide: draw a wave; the threads are the notes of this bar's chord and move when the chord does.
// A note sounds wherever the water crosses a thread, so a cliff is a chord, a slope an arpeggio, flat water
// a held note. Where water starts, the thread nearest its surface sounds, so a tap is one note.
//
// state = { tide } one character per sample, W samples across the loop: '.' is dry, otherwise a height
// (LEVELS of them, '0' the bottom). A string, so the engine's loop-length resize leaves it alone.
// state.ink: the ink of each sample, one digit each, picked in the tool strip per stretch of water.
// Parts from before inks have none: their water is all the seat's old voice.

import { voice as jukebox } from './lib/voices.js'
import { voiced, head, dash } from './lib/voiced.js'
import { kit } from './lib/kit.js'
import {
	mtof,
	env,
	osc,
	val,
	rgba,
	clamp,
	withPointer,
	isStrip,
	flashes,
	absOf,
	absNow,
} from './lib/util.js'
import { wave } from './lib/demo.js'
import { INK } from '../palette.js'

export const W = 256
const CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LEVELS = CH.length - 1
const PAD = 0.03
const SPAN = 26 // semitones from the lowest thread to the highest
const LOW = -7 // lowest thread, from the key's A3

// heights are 0 (bottom) .. 1 (top), null where dry
export const parseTide = (t) =>
	Array.from({ length: W }, (_, j) => {
		const k = CH.indexOf(typeof t === 'string' ? t[j] : '.')
		return k < 0 ? null : k / LEVELS
	})
export const tideOf = (ys) =>
	ys
		.map((y) =>
			y === null || y === undefined ? '.' : CH[clamp(Math.round(y * LEVELS), 0, LEVELS)],
		)
		.join('')

// a wave through (time 0..1, height 0..1) points, held flat after each one for `hold` of the gap
export function through(points, hold = 0.5) {
	const ys = new Array(W).fill(null)
	if (!points.length) return ys
	const ps = [...points].sort((a, b) => a[0] - b[0])
	ps.forEach(([t, y], k) => {
		const [t1, y1] = ps[k + 1] || [ps[0][0] + 1, ps[0][1]]
		const a = Math.round(t * W),
			b = Math.round(t1 * W),
			m = a + Math.max(1, Math.round((b - a) * hold))
		for (let j = a; j < b; j++) {
			const f = j < m ? 0 : (j - m) / Math.max(1, b - m)
			ys[((j % W) + W) % W] = y + (y1 - y) * f * f * (3 - 2 * f)
		}
	})
	return ys
}

function gen() {
	// one or two swells a bar, sometimes a cliff, sometimes dry
	const pts = []
	for (let b = 0; b < 4; b++) {
		if (Math.random() < 0.15) continue
		const n = 1 + Math.floor(Math.random() * 3)
		for (let k = 0; k < n; k++)
			pts.push([(b + (k + Math.random() * 0.5) / n) / 4, 0.15 + Math.random() * 0.7])
	}
	const ys = through(pts, 0.3 + Math.random() * 0.5)
	for (let j = 0; j < W; j += 64) if (Math.random() < 0.2) ys.fill(null, j + 40, j + 64)
	return { tide: tideOf(ys) }
}
const SAMPLE = tideOf(
	through(
		[
			[0, 0.3],
			[0.0625, 0.55],
			[0.25, 0.25],
			[0.3125, 0.6],
			[0.375, 0.45],
			[0.5, 0.35],
			[0.5625, 0.7],
			[0.75, 0.2],
			[0.8125, 0.5],
			[0.9375, 0.75],
		],
		0.55,
	),
)
// rhodes, with the third bar in harp
const SAMPLE_INK = '0'.repeat(128) + '3'.repeat(64) + '0'.repeat(64)
const parseInk = (s) => Array.from({ length: W }, (_, j) => +s[j] || 0)

function triangles({ audio: ac, out, params }, m, t) {
	const f = mtof(m),
		g = ac.createGain(),
		lp = ac.createBiquadFilter()
	lp.type = 'lowpass'
	lp.frequency.value = 2600
	env(g, t, 0.012, 0.15, val(params.decay))
	lp.connect(g)
	g.connect(out)
	const d = val(params.decay) + 0.3
	osc(ac, 'triangle', f, t, d, lp).detune.value = -7
	osc(ac, 'triangle', f, t, d, lp).detune.value = 7
	osc(ac, 'sine', f * 2, t, d, lp)
}

const V = voiced(
	[
		['rhodes', jukebox('rhodes', -9.0), 'dot'],
		['triangles', triangles, 'tri'],
		['organ', jukebox('organ', -3.9), 'bar'],
		['harp', jukebox('harp', -4.4), 'tall'],
		['chip', jukebox('chip', -3.7), 'square'],
	],
	{
		octave: { value: 0, min: -1, max: 1, step: 1 },
		decay: { value: 0.8, min: 0.1, max: 3, step: 0.05 },
	},
)

// the threads for one bar: chord tones (midi) and their heights 0..1
export function threads(harmony, absStep, oct = 0) {
	const ch = harmony.chord(absStep)
	const lo = harmony.degree(0, oct) + LOW
	const out = []
	for (let o = -2; o <= 3; o++)
		for (const m0 of ch.notes) {
			const m = m0 + 12 * (o + oct)
			if (m >= lo && m <= lo + SPAN) out.push({ m, y: (m - lo) / SPAN, root: m0 === ch.root })
		}
	return out.sort((a, b) => a.m - b.m)
}

// every crossing in samples [j0, j1): { at sample (fractional), m, k thread index, y }
export function crossings(ys, j0, j1, threadsAt) {
	const out = []
	for (let j = j0; j < j1; j++) {
		const a = ys[(j - 1 + W) % W],
			b = ys[j % W]
		if (b === null) continue
		const th = threadsAt(j)
		// water arrives, or the chord changes under it: the thread nearest the surface
		if (a === null || (th !== threadsAt(j - 1) && !th.some((t) => (t.y - a) * (t.y - b) < 0))) {
			let best = null
			for (const t of th) if (!best || Math.abs(t.y - b) < Math.abs(best.y - b)) best = t
			if (best) out.push({ at: j, m: best.m, y: best.y, entry: true })
			continue
		}
		if (a === b) continue
		const up = b > a
		const hit = th.filter((t) => (up ? t.y > a && t.y <= b : t.y < a && t.y >= b))
		if (!up) hit.reverse()
		for (const t of hit) out.push({ at: j - 1 + (t.y - a) / (b - a), m: t.m, y: t.y })
	}
	return out
}

// Dry samples break the wave. Keep the filled water and its edge at drawing size: one edge path per ink.
function wavePaths(ys, ks, X, Y, h) {
	const water = new Path2D(),
		edges = new Map()
	let px = 0,
		py = 0,
		pk = -1
	const to = (x, y, k) => {
		if (!edges.has(k)) edges.set(k, new Path2D())
		const e = edges.get(k)
		if (k !== pk) e.moveTo(px, py)
		e.lineTo(x, y)
		px = x
		py = y
		pk = k
	}
	for (let j = 0; j < W; j++) {
		if (ys[j] === null) continue
		water.moveTo(X(j), h)
		px = X(j)
		py = Y(ys[j])
		pk = -1
		to(X(j + 0.5), Y(ys[j]), ks[j])
		water.lineTo(X(j + 0.5), Y(ys[j]))
		while (j + 1 < W && ys[j + 1] !== null) {
			j++
			water.lineTo(X(j + 0.5), Y(ys[j]))
			to(X(j + 0.5), Y(ys[j]), ks[j])
		}
		to(X(j + 1), Y(ys[j]), ks[j])
		water.lineTo(X(j + 1), Y(ys[j]))
		water.lineTo(X(j + 1), h)
		water.closePath()
	}
	return { water, edges }
}

export default {
	id: 'tide',
	glyph:
		'<path d="M3 10h26M3 16h26M3 22h26" stroke-width="1"/><path d="M3 24c5 0 6-14 11-14s5 10 9 10 4-6 6-6" stroke-width="2.4"/>',
	name: 'Tide',
	trim: 3,
	how: 'Draw a wave. The threads are this bar’s chord; a note sounds wherever the water crosses one. Steep is a chord, a slope an arpeggio, flat water holds. Shift-drag dries it up.',
	inks: V.inks,
	params: V.params,
	optional: ['tide'],
	demo: () => [wave(0.06, 0.6, 0.5, 0.3, 1.5, 24)],
	generate: () => gen(),
	sample: () => ({ tide: SAMPLE, ink: SAMPLE_INK }),
	create(ctx) {
		const { clock } = ctx
		const harmony = kit(ctx.audio)
		const size = [1, 1]
		const fx = flashes()
		let ys = parseTide(SAMPLE)
		let ks = parseInk(SAMPLE_INK) // each sample's ink
		let ink = 0 // the brush in your hand; local, but every stretch of water keeps its own
		const inkAt = (at) => ks[Math.ceil(at) % W]
		let wave = null
		let last = null // last painted sample, so a fast drag leaves no holes
		// A seat can start mid-bar. Resolve each bar once per draw or scheduling pass.
		function barThreads(base, steps, barSteps) {
			const bars = new Map()
			const octave = val(ctx.params.octave)
			return (j) => {
				const bar = Math.floor((base + Math.floor((j * steps) / W)) / barSteps)
				if (!bars.has(bar)) bars.set(bar, threads(harmony, bar * barSteps, octave))
				return bars.get(bar)
			}
		}

		function paint(x, y, erase) {
			wave = null
			const j = clamp(Math.floor(x * W), 0, W - 1)
			const v = erase ? null : clamp(y, 0, 1)
			if (last === null || Math.abs(j - last.j) > W / 2) {
				ys[j] = v
				if (!erase) ks[j] = ink
			} else {
				const d = j - last.j,
					k = Math.abs(d)
				for (let i = 0; i <= k; i++) {
					const at = last.j + Math.sign(d) * i
					ys[at] = erase ? null : k ? last.y + ((v - last.y) * i) / k : v
					if (!erase) ks[at] = ink
				}
			}
			last = { j, y: v ?? 0 }
		}

		return {
			get state() {
				return { tide: tideOf(ys), ink: ks.join('') }
			},
			setState(s) {
				wave = null
				// water from before inks rings in the seat's old voice; it keeps that ink for good
				ks =
					typeof s?.ink === 'string'
						? parseInk(s.ink).map((k) => k % V.names.length)
						: new Array(W).fill(V.legacy(ctx))
				if (typeof s?.tide === 'string') ys = parseTide(s.tide)
				else if (Array.isArray(s?.notes)) {
					// a part saved by the old line-drawing instrument: a wave through its notes
					const n = s.notes.length
					ys = through(
						s.notes.flatMap((v, i) => (v >= 0 ? [[i / n, clamp((v + 1) / 9, 0, 1)]] : [])),
						0.7,
					)
				} else ys = new Array(W).fill(null)
			},
			clear() {
				wave = null
				ys = new Array(W).fill(null)
			},
			get ink() {
				return V.names[ink]
			},
			set ink(v) {
				ink = V.index(v)
			},
			pointer: withPointer(size, (e) => {
				const x = clamp((e.x - PAD) / (1 - 2 * PAD), 0, 0.9999),
					y = 1 - clamp(e.y, 0, 1)
				const erase = e.alt || e.button === 2
				if (e.type === 'down') {
					last = null
					paint(x, y, erase)
					// a tap is a puddle: a sliver of water so it has somewhere to start
					if (!erase) {
						const j = Math.floor(x * W)
						for (let i = 1; i < W / clock.steps; i++)
							if (j + i < W && ys[j + i] === null) {
								ys[j + i] = y
								ks[j + i] = ink
							}
					}
				} else if (e.type === 'move' && e.pressed) paint(x, y, erase)
				else if (e.type === 'up' || e.type === 'cancel') last = null
			}),
			step(i, time, dur) {
				const steps = clock.steps,
					bs = harmony.barSteps(),
					j0 = Math.ceil((i * W) / steps),
					j1 = Math.ceil(((i + 1) * W) / steps)
				const threadsAt = barThreads(absOf(clock, time) - i, steps, bs)
				for (const c of crossings(ys, j0, j1, threadsAt)) {
					const t = (c.at * steps) / W
					// it rings until the water next crosses a thread, or dries, at most a bar
					let end = Math.ceil(c.at + 0.01)
					const lim = end + (W * bs) / steps
					for (; end < lim; end++) {
						const a = ys[(end - 1 + W) % W],
							b = ys[end % W]
						if (
							b === null ||
							threadsAt(end) !== threadsAt(end - 1) ||
							(a !== null && threadsAt(end).some((h) => (h.y - a) * (h.y - b) < 0))
						)
							break
					}
					const d = Math.max(0.5, (end * steps) / W - t) * dur
					V.fn(inkAt(c.at))(ctx, c.m, time + Math.max(0, t - i) * dur, d, c.entry ? 0.75 : 0.62)
					fx.hit(c.m * 1000 + Math.round(c.at), time + Math.max(0, t - i) * dur)
				}
			},
			frame(gx, w, h, clock, shape) {
				size[0] = w
				size[1] = h
				const strip = isStrip(w, h, shape)
				const iw = w * (1 - 2 * PAD)
				const X = (j) => w * PAD + (j / W) * iw,
					Y = (y) => (1 - y) * h * 0.92 + h * 0.04
				const color = ctx.color
				const now = clock.now()
				const bs = harmony.barSteps(),
					steps = clock.steps
				const base = Math.floor(absNow(clock) / steps) * steps
				const threadsAt = barThreads(base, steps, bs)
				gx.lineCap = 'round'
				gx.lineJoin = 'round'
				// threads, bar by bar
				for (let b = -(base % bs); b < steps; b += bs) {
					const j0 = Math.max(0, Math.round((b * W) / steps)),
						j1 = Math.round((Math.min(steps, b + bs) * W) / steps)
					for (const t of threadsAt(j0)) {
						gx.strokeStyle = rgba(color, t.root ? 0.55 : 0.28)
						gx.lineWidth = t.root ? 1.6 : 1
						gx.beginPath()
						gx.moveTo(X(j0) + 2, Y(t.y))
						gx.lineTo(X(j1) - 2, Y(t.y))
						gx.stroke()
					}
				}
				if (!wave || wave.w !== w || wave.h !== h) wave = { ...wavePaths(ys, ks, X, Y, h), w, h }
				gx.fillStyle = rgba(color, strip ? 0.3 : 0.18)
				gx.fill(wave.water)
				const lw = Math.max(1.4, Math.min(4, h * 0.05))
				gx.lineWidth = lw + 2.2
				gx.strokeStyle = INK
				for (const e of wave.edges.values()) gx.stroke(e)
				gx.lineWidth = lw
				gx.strokeStyle = color
				for (const [k, e] of wave.edges) {
					gx.setLineDash(dash(V.mark(k), lw))
					gx.stroke(e)
				}
				gx.setLineDash([])
				// where the water crosses a thread: the notes
				const r0 = Math.max(strip ? 3 : 2, Math.min(6.5, h * 0.05))
				gx.lineWidth = 1.1
				for (const c of crossings(ys, 0, W, threadsAt)) {
					const glow = fx.glow(c.m * 1000 + Math.round(c.at), now, 0.35)
					const x = X(c.at + 0.5),
						y = Y(c.y)
					if (glow && !strip) {
						gx.strokeStyle = rgba(INK, 0.6 * glow)
						gx.beginPath()
						gx.arc(x, y, r0 + 3 + (1 - glow) * 8, 0, 6.283)
						gx.stroke()
					}
					gx.fillStyle = glow > 0.3 ? INK : color
					gx.strokeStyle = INK
					head(gx, V.mark(inkAt(c.at)), x, y, r0 + glow * 2)
				}
			},
			dispose() {},
		}
	},
}
