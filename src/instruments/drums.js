// Drums: paint kick, snare and hat in three bands. Shift or right-drag clears.

import { env, osc, noiseSrc, fit, rgba, val } from './lib/util.js'
import { INK, SERIF } from '../palette.js'

const ROWS = 3
function drumSample() {
	const d = new Array(32).fill(0)
	for (let i = 0; i < 32; i++) { if (i % 8 === 0) d[i] |= 1; if (i % 8 === 4) d[i] |= 2; if (i % 2 === 0) d[i] |= 4 }
	d[11] |= 1; d[27] |= 1; d[31] |= 4
	return d
}
function drumGen() {
	const a = new Array(32).fill(0)
	for (let i = 0; i < 32; i++) {
		if (i % 8 === 0 || (i % 2 === 0 && Math.random() < 0.12) || (i % 8 === 3 && Math.random() < 0.3)) a[i] |= 1
		if (i % 8 === 4 || Math.random() < 0.05) a[i] |= 2
		if (i % 2 === 0 ? Math.random() < 0.85 : Math.random() < 0.3) a[i] |= 4
	}
	return a
}
const hitVoice = {
	1({ audio: ac, out }, t) {
		const g = ac.createGain(); env(g, t, 0.002, 0.9, 0.34); g.connect(out)
		const o = osc(ac, 'sine', 150, t, 0.5, g)
		o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
	},
	2({ audio: ac, out }, t) {
		const g = ac.createGain(), bp = ac.createBiquadFilter()
		bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8
		env(g, t, 0.002, 0.45, 0.16); bp.connect(g); g.connect(out); noiseSrc(ac, t, 0.25, bp)
		const g2 = ac.createGain(); env(g2, t, 0.002, 0.25, 0.07); g2.connect(out); osc(ac, 'triangle', 190, t, 0.12, g2)
	},
	4({ audio: ac, out, params }, t) {
		const g = ac.createGain(), hp = ac.createBiquadFilter()
		hp.type = 'highpass'; hp.frequency.value = 7200
		env(g, t, 0.001, 0.16, val(params.hatDecay)); hp.connect(g); g.connect(out); noiseSrc(ac, t, 0.3, hp)
	},
}

export default {
	id: 'drums',
	glyph: '<circle cx="11" cy="18" r="6"/><path class="f" d="M20 11h8v8h-8z"/><circle class="f" cx="23" cy="25" r="1.6"/>',
	name: 'Drums',
	how: 'Paint hits in three bands: kick inside, snare in the middle, hat outside. Shift-drag erases.',
	params: { hatDecay: { value: 0.045, min: 0.01, max: 0.3, step: 0.005 } },
	generate: (steps) => ({ hits: fit(drumGen(), steps, 0) }),
	sample: (steps) => ({ hits: fit(drumSample(), steps, 0) }),
	create(ctx) {
		const { clock } = ctx
		let hits = new Array(clock.steps).fill(0)
		let last = null
		const ensure = () => { if (hits.length !== clock.steps) hits = fit(hits, clock.steps, 0) }
		const put = (s, row, erase) => { const b = 1 << row; hits[s] = erase ? hits[s] & ~b : hits[s] | b }
		return {
			get state() { return { hits } },
			setState(s) { hits = s?.hits ? s.hits.slice() : new Array(clock.steps).fill(0) },
			clear() { hits = new Array(clock.steps).fill(0) },
			pointer(e) {
				ensure()
				const n = clock.steps, s = Math.min(n - 1, Math.floor(e.x * n))
				const row = Math.max(0, Math.min(ROWS - 1, Math.floor((1 - e.y) * ROWS)))
				const erase = e.alt || e.button === 2
				if (e.type === 'down') { put(s, row, erase); last = { s, row, erase } }
				else if (e.type === 'move' && last) {
					let d = s - last.s
					if (d > n / 2) d -= n
					if (d < -n / 2) d += n
					for (let j = 1; j <= Math.abs(d); j++) put((last.s + Math.sign(d) * j + n) % n, last.row, last.erase)
					last.s = s
				} else if (e.type === 'up') last = null
			},
			step(i, time) {
				const m = hits[i % hits.length]
				for (const b of [1, 2, 4]) if (m & b) hitVoice[b](ctx, time)
			},
			frame(g, w, h, clock) {
				const n = hits.length, pos = clock.pos(), color = ctx.color
				// row guides so the three bands are findable: hat (top/outer), snare, kick (bottom/inner)
				g.fillStyle = rgba(INK, 0.22)
				for (let r = 1; r < ROWS; r++) g.fillRect(0, (r / ROWS) * h - 0.5, w, 1)
				g.font = `italic 400 ${Math.max(9, Math.min(13, h / ROWS))}px ${SERIF}`
				g.textAlign = 'left'
				g.textBaseline = 'middle'
				g.fillStyle = rgba(INK, 0.55)
				;['kick', 'snare', 'hat'].forEach((label, r) => g.fillText(label, w / n + 3, (1 - (r + 0.5) / ROWS) * h))
				for (let s = 0; s < n; s++) {
					const m = hits[s]
					if (!m) continue
					const d = (pos - s + n) % n, f = d < 1.5 ? 1 - d / 1.5 : 0
					const x = ((s + 0.5) / n) * w
					for (let r = 0; r < ROWS; r++) {
						if (!(m & (1 << r))) continue
						const y = (1 - (r + 0.5) / ROWS) * h
						const size = Math.min(h * [0.11, 0.085, 0.055][r], [12, 9, 6][r]) + f * 2.5
						g.fillStyle = f > 0.3 ? INK : color
						g.beginPath()
						if (r === 1) g.rect(x - size, y - size, size * 2, size * 2)
						else g.arc(x, y, size, 0, 6.283)
						g.fill()
						g.strokeStyle = INK; g.lineWidth = 1; g.stroke()
					}
				}
			},
			dispose() {},
		}
	},
}
