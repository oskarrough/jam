// Keys: draw a line; height is pitch. Voices: rhodes, soft triangles, organ, harp, chip.

import { stepline } from './lib/stepline.js'
import { voice as jukebox } from './lib/voices.js'
import { mtof, env, osc, rnd, val } from './lib/util.js'

function gen() {
	const notes = new Array(32).fill(-1),
		hold = new Array(32).fill(1),
		stack = Array.from({ length: 32 }, () => [])
	let v = 2 + rnd(3)
	for (let i = 0; i < 32; i += 2) {
		if (Math.random() >= (i % 8 === 0 ? 0.9 : 0.35)) continue
		v = Math.max(0, Math.min(7, v + rnd(5) - 2))
		const s = i + (Math.random() < 0.2 ? 1 : 0)
		notes[s] = v
		// downbeats often land as a chord and ring a while
		if (i % 8 === 0 && Math.random() < 0.6) {
			stack[s] = [v + 2, v + 4].filter((x) => x <= 7).slice(0, 1 + rnd(2))
			hold[s] = 2 + rnd(3)
		}
	}
	return { notes, hold, stack }
}

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

export default stepline({
	id: 'keys',
	glyph:
		'<path d="M7 7v18M13 7v18M19 7v18M25 7v18"/><path class="f" d="M9.5 7h2v10h-2zM21.5 7h2v10h-2z"/>',
	name: 'Keys',
	how: 'Draw a line along your ring; higher is a higher note. Tap above or below a note to make a chord, tap a note to lift it off, drag right from it to hold it. Shift-drag erases.',
	base: 57,
	chords: 3,
	params: { decay: { value: 0.8, min: 0.1, max: 3, step: 0.05 } },
	voices: [
		['rhodes', jukebox('rhodes', -9.0)],
		['triangles', triangles],
		['organ', jukebox('organ', -3.9)],
		['harp', jukebox('harp', -4.4)],
		['chip', jukebox('chip', -3.7)],
	],
	generate: gen,
	sample: [
		3, -1, -1, 3, -1, -1, 1, -1, 3, -1, -1, 3, -1, -1, 5, -1, 4, -1, -1, 4, -1, -1, 3, -1, 4, -1,
		-1, 4, -1, -1, 6, -1, 4, -1, -1, 4, -1, -1, 2, -1, 4, -1, -1, 4, -1, -1, 6, -1, 3, -1, -1, 3,
		-1, -1, 5, -1, 3, -1, 3, -1, 2, -1, 3, -1,
	],
})
