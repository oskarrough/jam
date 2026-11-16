// Keys: draw a line; height is pitch. Soft detuned triangles.

import { stepline } from './lib/stepline.js'
import { mtof, env, osc, rnd, val } from './lib/util.js'

function gen() {
	const a = new Array(32).fill(-1)
	let v = 2 + rnd(3)
	for (let i = 0; i < 32; i += 2) if (Math.random() < (i % 8 === 0 ? 0.9 : 0.35)) { v = Math.max(0, Math.min(7, v + rnd(5) - 2)); a[i + (Math.random() < 0.2 ? 1 : 0)] = v }
	return a
}

export default stepline({
	id: 'keys',
	glyph: '<path d="M7 7v18M13 7v18M19 7v18M25 7v18"/><path class="f" d="M9.5 7h2v10h-2zM21.5 7h2v10h-2z"/>', name: 'Keys', how: 'Draw a line along your ring; higher is a higher note. Shift-drag erases.', base: 57,
	params: { decay: { value: 0.8, min: 0.1, max: 3, step: 0.05 } },
	generate: gen,
	sample: [4, -1, -1, -1, 5, -1, -1, 4, -1, -1, 3, -1, -1, -1, -1, -1, 2, -1, -1, -1, 3, -1, -1, 4, -1, -1, 5, -1, -1, -1, -1, -1],
	voice({ audio: ac, out, params }, m, t) {
		const f = mtof(m), g = ac.createGain(), lp = ac.createBiquadFilter()
		lp.type = 'lowpass'; lp.frequency.value = 2600
		env(g, t, 0.012, 0.15, val(params.decay))
		lp.connect(g); g.connect(out)
		const d = val(params.decay) + 0.3
		osc(ac, 'triangle', f, t, d, lp).detune.value = -7
		osc(ac, 'triangle', f, t, d, lp).detune.value = 7
		osc(ac, 'sine', f * 2, t, d, lp)
	},
})
