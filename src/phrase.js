// Phrases: a neutral form of a lane's part, so a motif drawn on one instrument can be
// handed to a robot on another and varied musically.
//
//   phrase = { n, drums, notes: [{ s, p, v }] }
//     n      steps in the loop the phrase was taken from
//     s      onset in steps (may be fractional), 0 <= s < n
//     p      pitch as a scale degree (5 per octave), or for drums the row: 0 kick, 1 snare, 2 hat
//     v      velocity 0..1
//
// toPhrase(lane) and fromPhrase(phrase, lane) go through an adapter per instrument id.
// vary(phrase, turn) picks the next move for a robot.

import { adapters as labAdapters } from './instruments/lib/phrases.js'

export const OCT = 5

const sortNotes = (ns) => ns.sort((a, b) => a.s - b.s || a.p - b.p)
const mod = (a, n) => ((a % n) + n) % n

// shift by octaves so the phrase sits in [lo, hi], folding stragglers back in
export function fitRange(notes, lo, hi) {
	if (!notes.length) return notes
	const ps = notes.map((x) => x.p).sort((a, b) => a - b)
	const mid = ps[Math.floor(ps.length / 2)]
	const shift = Math.round(((lo + hi) / 2 - mid) / OCT) * OCT
	return notes.map((x) => {
		let p = x.p + shift
		while (p > hi && p - OCT >= lo) p -= OCT
		while (p < lo && p + OCT <= hi) p += OCT
		return { ...x, p: Math.max(lo, Math.min(hi, p)) }
	})
}

// melodic <-> drum views of the same phrase
export function asDrums(ph) {
	if (ph.drums) return ph
	const ps = ph.notes.map((x) => x.p).sort((a, b) => a - b)
	const lo = ps[Math.floor(ps.length / 3)] ?? 0, hi = ps[Math.floor((ps.length * 2) / 3)] ?? 0
	return { n: ph.n, drums: true, notes: ph.notes.map((x) => ({ ...x, p: x.p <= lo ? 0 : x.p >= hi && hi > lo ? 2 : 1 })) }
}
export function asMelody(ph) {
	if (!ph.drums) return ph
	return { n: ph.n, drums: false, notes: ph.notes.map((x) => ({ ...x, p: [0, 2, 4][x.p] ?? 0 })) }
}

// rescale onsets to another loop length
export function retime(ph, n) {
	if (ph.n === n) return ph
	const k = n / ph.n
	return { ...ph, n, notes: ph.notes.map((x) => ({ ...x, s: x.s * k })) }
}

/* ───────── adapters ───────── */

const fit = (arr, n, empty) => Array.from({ length: n }, (_, i) => arr[Math.floor((i * arr.length) / n)] ?? empty)

// stepline: one note per step, value 0..7 or -1
const stepline = {
	to(state, n) {
		const a = state?.notes || []
		return { n, drums: false, notes: a.flatMap((v, i) => (v >= 0 ? [{ s: (i * n) / a.length, p: v, v: 0.8 }] : [])) }
	},
	from(ph, n) {
		const notes = new Array(n).fill(-1)
		for (const x of fitRange(asMelody(retime(ph, n)).notes, 0, 7)) {
			const s = mod(Math.round(x.s), n)
			if (notes[s] < 0) notes[s] = x.p
		}
		return { notes }
	},
}

// drums: per-step bitmask, 1 kick, 2 snare, 4 hat; vel[s][row] is how hard, 1..9
const drums = {
	to(state, n) {
		const a = state?.hits || [], vel = state?.vel || []
		const notes = []
		a.forEach((m, i) => { for (let r = 0; r < 3; r++) if (m & (1 << r)) notes.push({ s: (i * n) / a.length, p: r, v: (vel[i]?.[r] || 6) / 9 }) })
		return { n, drums: true, notes }
	},
	from(ph, n) {
		const hits = new Array(n).fill(0), vel = Array.from({ length: n }, () => [6, 6, 6])
		for (const x of asDrums(retime(ph, n)).notes) {
			const s = mod(Math.round(x.s), n)
			hits[s] |= 1 << x.p
			vel[s][x.p] = Math.max(1, Math.min(9, Math.round((x.v ?? 0.67) * 9)))
		}
		return { hits, vel }
	},
}

const adapters = { bass: stepline, keys: stepline, bell: stepline, drums, ...labAdapters }

export const canPhrase = (id) => !!adapters[id]

export function toPhrase(lane, steps) {
	const a = adapters[lane.module.id]
	if (!a) return null
	const ph = a.to(lane.instance.state, steps, lane.params, lane.module)
	ph.notes = sortNotes(ph.notes.filter((x) => Number.isFinite(x.s) && Number.isFinite(x.p)))
	return ph
}

export function fromPhrase(ph, lane, steps) {
	const a = adapters[lane.module.id]
	if (!a || !ph) return null
	return a.from(ph, steps, lane.params, lane.module)
}

/* ───────── variations ───────── */
// Each move takes a phrase and returns a new one. They keep the motif recognisable:
// the same rhythm with new pitches, or the same pitches with new placement.

const beat = (ph) => ph.n / 4
const onBeat = (ph, s) => Math.abs(s / beat(ph) - Math.round(s / beat(ph))) < 1e-6
const firstP = (ph) => ph.notes[0]?.p ?? 0
const keep = (ph, notes) => ({ ...ph, notes: sortNotes(notes) })

export const MOVES = {
	// the motif as given
	theme: { label: 'echoes', fn: (ph) => ph },
	// up or down a scale step or two, rhythm intact
	lift: { label: 'lifts', melodic: true, fn: (ph) => keep(ph, ph.notes.map((x) => ({ ...x, p: x.p + 2 }))) },
	sink: { label: 'lowers', melodic: true, fn: (ph) => keep(ph, ph.notes.map((x) => ({ ...x, p: x.p - 2 }))) },
	// mirror the contour around the first note
	invert: { label: 'inverts', melodic: true, fn: (ph) => { const a = firstP(ph); return keep(ph, ph.notes.map((x) => ({ ...x, p: 2 * a - x.p }))) } },
	// play it backwards in time
	retro: { label: 'reverses', fn: (ph) => keep(ph, ph.notes.map((x) => ({ ...x, s: mod(ph.n - 1 - x.s, ph.n) }))) },
	// keep the beats and the loudest offbeats, drop the rest
	thin: {
		label: 'thins',
		fn: (ph) => keep(ph, ph.notes.filter((x, k) => onBeat(ph, x.s) || k % 3 === 0)),
	},
	// push some on-beat notes a 16th early, so they lean into the beat
	syncopate: {
		label: 'syncopates',
		fn: (ph) => keep(ph, ph.notes.map((x, k) => (onBeat(ph, x.s) && x.s > 0 && k % 2 ? { ...x, s: x.s - 1 } : x))),
	},
	// shift the whole thing by an eighth note
	displace: { label: 'shifts', fn: (ph) => keep(ph, ph.notes.map((x) => ({ ...x, s: mod(x.s + ph.n / 8, ph.n) }))) },
	// first half stretched over the whole loop
	halftime: {
		label: 'stretches',
		fn: (ph) => keep(ph, ph.notes.filter((x) => x.s < ph.n / 2).map((x) => ({ ...x, s: x.s * 2 }))),
	},
	// the whole loop squeezed into half, twice
	double: {
		label: 'doubles',
		fn: (ph) => keep(ph, ph.notes.flatMap((x) => [{ ...x, s: x.s / 2 }, { ...x, s: x.s / 2 + ph.n / 2 }]).filter((x, k, a) => k === 0 || a.findIndex((y) => Math.abs(y.s - x.s) < 0.5 && y.p === x.p) === k)),
	},
	// call and response: the first half asks, the second half answers a step lower and comes home
	answer: {
		label: 'answers',
		fn: (ph) => {
			const call = ph.notes.filter((x) => x.s < ph.n / 2)
			if (!call.length) return ph
			const home = firstP(ph)
			const resp = call.map((x, k) => ({ ...x, s: x.s + ph.n / 2, p: k === call.length - 1 ? home : ph.drums ? x.p : x.p - 1 }))
			return keep(ph, [...call, ...resp])
		},
	},
	// passing notes in the gaps between leaps
	fill: {
		label: 'fills',
		melodic: true,
		fn: (ph) => {
			const out = [...ph.notes]
			ph.notes.forEach((x, k) => {
				const y = ph.notes[(k + 1) % ph.notes.length]
				if (!y) return
				const gap = mod(y.s - x.s, ph.n)
				if (gap >= 2 && Math.abs(y.p - x.p) >= 2) out.push({ s: mod(x.s + Math.floor(gap / 2), ph.n), p: Math.round((x.p + y.p) / 2), v: x.v * 0.7 })
			})
			return keep(ph, out)
		},
	},
}

// A robot's set: theme, two variations, then a call-and-response; repeat with new choices.
const POOL = ['lift', 'sink', 'invert', 'retro', 'thin', 'syncopate', 'displace', 'halftime', 'double', 'fill']
export function vary(ph, turn, last = null) {
	const phase = turn % 4
	let move
	if (phase === 0) move = 'theme'
	else if (phase === 3) move = 'answer'
	else {
		const pool = POOL.filter((m) => m !== last && !(ph.drums && MOVES[m].melodic))
		move = pool[Math.floor(Math.random() * pool.length)]
	}
	let out = MOVES[move].fn(ph)
	// a thin result isn't worth a turn; fall back to the theme
	if (out.notes.length < Math.min(2, ph.notes.length)) { move = 'theme'; out = ph }
	return { phrase: out, move, label: MOVES[move].label }
}
