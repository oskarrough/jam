// Bell: draw a line; height is pitch. Two-operator FM, bright and decaying.

import { stepline } from './lib/stepline.js'
import { mtof, env, osc, rnd, val } from './lib/util.js'

function gen() {
	const a = new Array(32).fill(-1)
	let v = 4 + rnd(3)
	for (let i = 0; i < 32; i++) if (Math.random() < (i >= 16 ? 0.32 : 0.16)) { v = Math.max(0, Math.min(7, v + rnd(5) - 2)); a[i] = v }
	return a
}

export default stepline({
	id: 'bell',
	glyph: '<path d="M10 21c0-8 2-13 6-13s6 5 6 13z"/><path d="M7 21h18M16 24v2"/>', name: 'Bell', how: 'Draw a line along your ring; higher is a higher note. Shift-drag erases.', base: 69,
	params: { ratio: { value: 3.5, min: 1, max: 8, step: 0.01 }, index: { value: 2.2, min: 0, max: 8, step: 0.1 } },
	generate: gen,
	// chattery repeated notes: a question over A and C, an answer over D and E
	sample: [3, -1, 3, -1, 3, -1, 2, -1, 1, -1, -1, -1, 1, -1, 2, -1, 3, -1, 3, -1, 4, -1, 3, -1, 2, -1, -1, -1, 1, -1, -1, -1, 2, -1, 2, -1, 2, -1, 1, -1, 0, -1, -1, -1, 1, -1, 2, -1, 3, -1, -1, -1, 2, -1, 1, -1, 0, -1, -1, -1, -1, -1, -1, -1],
	voice({ audio: ac, out, params }, m, t) {
		const f = mtof(m), g = ac.createGain(), mg = ac.createGain()
		env(g, t, 0.002, 0.12, 1.5); g.connect(out)
		const car = osc(ac, 'sine', f, t, 1.8, g)
		mg.gain.setValueAtTime(f * val(params.index) + 1, t)
		mg.gain.exponentialRampToValueAtTime(1, t + 0.7)
		osc(ac, 'sine', f * val(params.ratio), t, 1.8, mg)
		mg.connect(car.frequency)
	},
})
