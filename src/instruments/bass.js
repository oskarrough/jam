// Bass: draw a line; height is pitch. Five voices: synbass, its own filtered saw with a sub, 808, log drum, upright.

import { stepline } from './lib/stepline.js'
import { voice as jukebox } from './lib/voices.js'
import { mtof, env, osc, rnd, val } from './lib/util.js'

function gen() {
	const a = new Array(32).fill(-1)
	for (const h of [0, 3, 6, 10, 14, 16, 19, 22, 26, 28, 30]) if (h % 16 === 0 || Math.random() < 0.7) a[h] = [0, 0, 3, 4, 2, 5, 0][rnd(7)]
	a[0] = 0
	return a
}

// the bass's own voice, from before the jukebox voices
function saw({ audio: ac, out, params }, m, t, dur) {
	const f = mtof(m), g = ac.createGain(), lp = ac.createBiquadFilter()
	lp.type = 'lowpass'; lp.Q.value = 7
	lp.frequency.setValueAtTime(f * val(params.cutoff), t)
	lp.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.22)
	env(g, t, 0.006, 0.32, dur * 2.4)
	lp.connect(g); g.connect(out)
	osc(ac, 'sawtooth', f, t, 0.9, lp); osc(ac, 'sine', f / 2, t, 0.9, g)
}

export default stepline({
	id: 'bass',
	glyph: '<path d="M3 19c4-9 8 9 13 0s9 9 13 0" stroke-width="2.4"/>', name: 'Bass', how: 'Draw a line along your ring; higher is a higher note. Shift-drag erases.', base: 33,
	params: { cutoff: { value: 9, min: 2, max: 24, step: 0.5 } },
	voices: [['synbass', jukebox('synbass', -5.4)], ['saw', saw], ['808', jukebox('808', -9.9)], ['log drum', jukebox('logdrum', -10.5)], ['upright', jukebox('upright', -4.4)]],
	generate: gen,
	// 3-3-2 under one bar each of A, C, D, E; the octave jump on the third hit
	sample: [0, -1, -1, 0, -1, -1, 5, -1, 0, -1, -1, 0, -1, -1, 3, -1, 1, -1, -1, 1, -1, -1, 6, -1, 1, -1, -1, 1, -1, -1, 4, -1, 2, -1, -1, 2, -1, -1, 7, -1, 2, -1, -1, 2, -1, -1, 5, -1, 3, -1, -1, 3, -1, -1, 3, -1, 3, -1, 4, -1, 3, -1, 2, -1],
})
