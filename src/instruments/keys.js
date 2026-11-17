// Keys: tide. Draw a wave; the threads are the notes of this bar's chord and move when the chord does.
// A note sounds wherever the water crosses a thread, so a cliff is a chord, a slope an arpeggio, flat water
// a held note. Where water starts, the thread nearest its surface sounds, so a tap is one note.
//
// state = { tide } one character per sample, W samples across the loop: '.' is dry, otherwise a height
// (LEVELS of them, '0' the bottom). A string, so the engine's loop-length resize leaves it alone.

import { voice as jukebox } from './lib/voices.js'
import { voiced } from './lib/voiced.js'
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
		['rhodes', jukebox('rhodes', -9.0)],
		['triangles', triangles],
		['organ', jukebox('organ', -3.9)],
		['harp', jukebox('harp', -4.4)],
		['chip', jukebox('chip', -3.7)],
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

export default {
	id: 'keys',
	glyph:
		'<path d="M3 10h26M3 16h26M3 22h26" stroke-width="1"/><path d="M3 24c5 0 6-14 11-14s5 10 9 10 4-6 6-6" stroke-width="2.4"/>',
	name: 'Keys',
	how: 'Draw a wave. The threads are this bar’s chord; a note sounds wherever the water crosses one. Steep is a chord, a slope an arpeggio, flat water holds. Shift-drag dries it up.',
	voices: V.voices,
	params: V.params,
	optional: ['tide'],
	demo: () => [wave(0.06, 0.6, 0.5, 0.3, 1.5, 24)],
	generate: () => gen(),
	sample: () => ({ tide: SAMPLE }),
	create(ctx) {
		const { clock } = ctx
		const harmony = kit(ctx.audio)
		const play = V.play
		const size = [1, 1]
		const fx = flashes()
		let ys = parseTide(SAMPLE)
		let last = null // last painted sample, so a fast drag leaves no holes
		const oct = () => val(ctx.params.octave)
		const stepOf = (j) => (j * clock.steps) / W
		const memo = new Map()
		// threads change with the jam's bar, wherever this seat's loop is in it: base is the jam step
		// this loop pass began on. Cache a bar's threads by its first step and the chord's notes.
		let base = 0
		const threadsAt = (j) => {
			const s = base + Math.floor(stepOf(j))
			const bs = harmony.barSteps(),
				bar = Math.floor(s / bs) * bs
			const ch = harmony.chord(bar).notes.join() + ':' + oct()
			let t = memo.get(bar)
			if (memo.size > 64) memo.clear()
			if (!t || t.key !== ch) memo.set(bar, (t = { key: ch, list: threads(harmony, bar, oct()) }))
			return t.list
		}

		function paint(x, y, erase) {
			const j = clamp(Math.floor(x * W), 0, W - 1)
			const v = erase ? null : clamp(y, 0, 1)
			if (last === null || Math.abs(j - last.j) > W / 2) ys[j] = v
			else {
				const d = j - last.j,
					k = Math.abs(d)
				for (let i = 0; i <= k; i++)
					ys[last.j + Math.sign(d) * i] = erase ? null : k ? last.y + ((v - last.y) * i) / k : v
			}
			last = { j, y: v ?? 0 }
		}

		return {
			get state() {
				return { tide: tideOf(ys) }
			},
			setState(s) {
				if (typeof s?.tide === 'string') ys = parseTide(s.tide)
				else if (Array.isArray(s?.notes)) {
					// a part saved by the old line-drawing keys: a wave through its notes
					const n = s.notes.length
					ys = through(
						s.notes.flatMap((v, i) => (v >= 0 ? [[i / n, clamp((v + 1) / 9, 0, 1)]] : [])),
						0.7,
					)
				} else ys = new Array(W).fill(null)
			},
			clear() {
				ys = new Array(W).fill(null)
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
							if (j + i < W && ys[j + i] === null) ys[j + i] = y
					}
				} else if (e.type === 'move' && e.pressed) paint(x, y, erase)
				else if (e.type === 'up' || e.type === 'cancel') last = null
			}),
			step(i, time, dur) {
				const j0 = Math.ceil((i * W) / clock.steps),
					j1 = Math.ceil(((i + 1) * W) / clock.steps)
				const fn = play(ctx)
				base = absOf(clock, time) - i
				for (const c of crossings(ys, j0, j1, threadsAt)) {
					const t = stepOf(c.at)
					// it rings until the water next crosses a thread, or dries, at most a bar
					let end = Math.ceil(c.at + 0.01)
					const lim = end + (W * harmony.barSteps()) / clock.steps
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
					const d = Math.max(0.5, stepOf(end) - t) * dur
					fn(ctx, c.m, time + Math.max(0, t - i) * dur, d, c.entry ? 0.75 : 0.62)
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
				base = Math.floor(absNow(clock) / steps) * steps
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
				// the water: filled to the bottom, its surface inked
				const runs = []
				let run = null
				for (let j = 0; j < W; j++) {
					if (ys[j] === null) run = null
					else {
						if (!run) runs.push((run = []))
						run.push(j)
					}
				}
				for (const r of runs) {
					gx.beginPath()
					gx.moveTo(X(r[0]), h)
					for (const j of r) gx.lineTo(X(j + 0.5), Y(ys[j]))
					gx.lineTo(X(r[r.length - 1] + 1), Y(ys[r[r.length - 1]]))
					gx.lineTo(X(r[r.length - 1] + 1), h)
					gx.closePath()
					gx.fillStyle = rgba(color, strip ? 0.3 : 0.18)
					gx.fill()
				}
				const lw = Math.max(1.4, Math.min(4, h * 0.05))
				for (const pass of [0, 1]) {
					for (const r of runs) {
						gx.beginPath()
						r.forEach((j, k) => (k ? gx.lineTo(X(j + 0.5), Y(ys[j])) : gx.moveTo(X(j), Y(ys[j]))))
						gx.lineTo(X(r[r.length - 1] + 1), Y(ys[r[r.length - 1]]))
						gx.strokeStyle = pass ? color : INK
						gx.lineWidth = pass ? lw : lw + 2.2
						gx.stroke()
					}
				}
				// where the water crosses a thread: the notes
				const r0 = Math.max(2, Math.min(6.5, h * 0.05))
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
					gx.beginPath()
					gx.arc(x, y, r0 + glow * 2, 0, 6.283)
					gx.fill()
					gx.stroke()
				}
			},
			dispose() {},
		}
	},
}
