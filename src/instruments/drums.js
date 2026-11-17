// Drums: kick, snare, hat in three rows. Tap a step to toggle it, drag up or down for loudness,
// drag sideways to paint a dynamics curve. Shift or right-drag erases.
//
// state = { hits, vel }
//   hits[s]  bitmask per step: 1 kick, 2 snare, 4 hat
//   vel[s]   [kick, snare, hat] levels 1..9 (6 is a plain hit, 9 an accent, 2 a ghost)

import { env, osc, noiseSrc, fit, rgba, val, clamp, isStrip } from './lib/util.js'
import { INK, SERIF } from '../palette.js'
import { tap, line } from './lib/demo.js'

const ROWS = 3
const LV = 6
const LABELS = ['kick', 'snare', 'hat']
const blankVel = (n) => Array.from({ length: n }, () => [LV, LV, LV])

function drumSample() {
	const d = new Array(64).fill(0),
		v = blankVel(64)
	for (let b = 0; b < 4; b++) {
		const o = b * 16
		d[o] |= 1
		d[o + 6] |= 1
		d[o + 8] |= 1
		v[o][0] = 9
		v[o + 6][0] = 5
		d[o + 4] |= 2
		d[o + 12] |= 2
		v[o + 12][1] = 8
		for (const h of [2, 6, 10, 14]) {
			d[o + h] |= 4
			v[o + h][2] = h % 4 === 2 ? 7 : 4
		}
	}
	d[30] |= 1
	d[62] |= 1
	d[63] |= 2
	d[61] |= 2
	v[61][1] = 3
	v[63][1] = 5
	return { d, v }
}
function drumGen() {
	const a = new Array(32).fill(0),
		v = blankVel(32)
	for (let i = 0; i < 32; i++) {
		if (
			i % 8 === 0 ||
			(i % 2 === 0 && Math.random() < 0.12) ||
			(i % 8 === 3 && Math.random() < 0.3)
		)
			a[i] |= 1
		if (i % 8 === 4 || Math.random() < 0.05) a[i] |= 2
		if (i % 2 === 0 ? Math.random() < 0.85 : Math.random() < 0.3) a[i] |= 4
		v[i] = [
			i % 16 === 0 ? 9 : i % 8 === 0 ? 7 : 5,
			i % 8 === 4 ? (i % 16 === 12 ? 8 : 6) : 2 + Math.floor(Math.random() * 2),
			i % 4 === 0 ? 7 : i % 2 === 0 ? 5 : 3,
		]
	}
	return { d: a, v }
}

// steeper than linear: level 2 is a ghost note, 9 is roughly twice a plain hit
const gainOf = (lv) => Math.pow(lv / LV, 1.8)
// accents (8, 9) go through a soft clipper: louder peak, harder transient, compressor sees it
let clip
const punchBus = (ac, out, lv) => {
	if (lv < 8) return out
	if (!clip || clip.ac !== ac) {
		const c = new Float32Array(1024)
		for (let i = 0; i < 1024; i++) c[i] = Math.tanh(((i / 511.5 - 1) * 2.2)) / Math.tanh(2.2)
		clip = { ac, c }
	}
	const sh = ac.createWaveShaper(),
		pre = ac.createGain()
	sh.curve = clip.c
	pre.gain.value = lv >= 9 ? 1.6 : 1.2
	pre.connect(sh)
	sh.connect(out)
	return pre
}
const hitVoice = {
	1({ audio: ac, out: dry }, t, lv) {
		const out = punchBus(ac, dry, lv)
		const g = ac.createGain()
		env(g, t, 0.002, 0.7 * gainOf(lv), 0.3 + lv * 0.01)
		g.connect(out)
		const f0 = 120 + lv * 7
		const o = osc(ac, 'sine', f0, t, 0.5, g)
		o.frequency.setValueAtTime(f0, t)
		o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
	},
	2({ audio: ac, out: dry }, t, lv) {
		const out = punchBus(ac, dry, lv)
		const g = ac.createGain(),
			bp = ac.createBiquadFilter()
		bp.type = 'bandpass'
		bp.frequency.value = 1300 + lv * 110
		bp.Q.value = 0.8
		env(g, t, 0.002, 0.5 * gainOf(lv), 0.1 + lv * 0.012)
		bp.connect(g)
		g.connect(out)
		noiseSrc(ac, t, 0.25, bp)
		const g2 = ac.createGain()
		env(g2, t, 0.002, 0.3 * gainOf(lv), 0.07)
		g2.connect(out)
		osc(ac, 'triangle', 190, t, 0.12, g2)
	},
	4({ audio: ac, out: dry, params }, t, lv) {
		const out = punchBus(ac, dry, lv)
		const g = ac.createGain(),
			hp = ac.createBiquadFilter()
		hp.type = 'highpass'
		hp.frequency.value = 6000 + lv * 200
		env(g, t, 0.001, 0.2 * gainOf(lv), val(params.decay) * (0.6 + lv / 15))
		hp.connect(g)
		g.connect(out)
		noiseSrc(ac, t, 0.3, hp)
	},
}

export default {
	id: 'drums',
	glyph:
		'<circle cx="11" cy="18" r="6"/><path class="f" d="M20 11h8v8h-8z"/><circle class="f" cx="23" cy="25" r="1.6"/>',
	name: 'Drums',
	how: 'Kick, snare and hat in three rows. Tap a step for a hit, drag it up or down for how loud it hits, sideways to paint: higher in the row hits louder. Shift-drag erases.',
	demo: () => [
		tap(0.07, 0.84),
		tap(0.32, 0.84),
		tap(0.57, 0.84),
		line(0.32, 0.84, 0.32, 0.72, 6),
		line(0.07, 0.17, 0.6, 0.17, 16),
	],
	optional: ['vel'],
	params: { decay: { value: 0.045, min: 0.01, max: 0.3, step: 0.005 } },
	generate: (steps) => {
		const { d, v } = drumGen()
		return { hits: fit(d, steps, 0), vel: fit(v, steps, [LV, LV, LV]) }
	},
	sample: (steps) => {
		const { d, v } = drumSample()
		return { hits: fit(d, steps, 0), vel: fit(v, steps, [LV, LV, LV]) }
	},
	create(ctx) {
		const { clock } = ctx
		let hits = new Array(clock.steps).fill(0)
		let vel = blankVel(clock.steps)
		let g = null
		const ensure = () => {
			if (hits.length !== clock.steps) hits = fit(hits, clock.steps, 0)
			if (vel.length !== hits.length)
				vel = fit(vel, hits.length, [LV, LV, LV]).map((x) => x.slice())
		}
		const has = (s, row) => !!(hits[s] & (1 << row))
		const put = (s, row, on, lv) => {
			const b = 1 << row
			hits[s] = on ? hits[s] | b : hits[s] & ~b
			if (on && lv) vel[s][row] = lv
		}
		const lvOf = (s, row) => vel[s]?.[row] || LV
		// the pen sits where the stem's top would (see frame)
		const lvAt = (y, row) => clamp(Math.round((((1 - y) * ROWS - row - 0.1) / 0.68) * 9), 1, 9)
		return {
			get state() {
				return { hits, vel }
			},
			setState(s) {
				hits = s?.hits ? s.hits.slice() : new Array(clock.steps).fill(0)
				vel =
					Array.isArray(s?.vel) && s.vel.length === hits.length
						? s.vel.map((x) => [0, 1, 2].map((r) => clamp(Math.round(x?.[r] || LV), 1, 9)))
						: blankVel(hits.length)
			},
			clear() {
				hits = new Array(clock.steps).fill(0)
				vel = blankVel(clock.steps)
			},
			pointer(e) {
				ensure()
				const n = hits.length,
					s = Math.min(n - 1, Math.max(0, Math.floor(e.x * n)))
				const row = clamp(Math.floor((1 - e.y) * ROWS), 0, ROWS - 1)
				if (e.type === 'down') {
					if (e.alt || e.button === 2) {
						put(s, row, false)
						g = { s, row, mode: 'erase' }
						return
					}
					const had = has(s, row)
					if (!had) put(s, row, true, LV)
					g = { s, row, had, lv: lvOf(s, row), x0: e.x, y0: e.y, mode: null }
				} else if (e.type === 'move' && g) {
					if (!g.mode) {
						if (Math.abs(e.x - g.x0) * n >= 0.7) g.mode = 'paint'
						else if (Math.abs(e.y - g.y0) > 0.025) g.mode = 'level'
						else return
					}
					if (g.mode === 'level') {
						// a third of the height covers the whole range
						const lv = clamp(Math.round(g.lv - (e.y - g.y0) * 24), 1, 9)
						put(g.s, g.row, true, lv)
						g.shown = lv
						return
					}
					let d = s - g.s
					if (d > n / 2) d -= n
					if (d < -n / 2) d += n
					const lv = g.mode === 'paint' ? lvAt(e.y, g.row) : g.lv,
						from = g.paintLv ?? lv
					if (g.mode === 'paint' && !g.paintLv) put(g.s, g.row, true, lv)
					for (let j = 1; j <= Math.abs(d); j++)
						put(
							(g.s + Math.sign(d) * j + n) % n,
							g.row,
							g.mode !== 'erase',
							Math.round(from + ((lv - from) * j) / Math.abs(d)),
						)
					if (g.mode === 'paint') g.paintLv = lv
					g.s = s
				} else if (e.type === 'up' && g) {
					if (!g.mode && g.had) put(g.s, g.row, false)
					g = null
				}
			},
			step(i, time) {
				const k = i % hits.length,
					m = hits[k]
				for (let r = 0; r < ROWS; r++) if (m & (1 << r)) hitVoice[1 << r](ctx, time, lvOf(k, r))
			},
			frame(gx, w, h, clock, shape) {
				ensure()
				const n = hits.length,
					pos = clock.pos(),
					color = ctx.color
				const strip = isStrip(w, h, shape),
					band = h / ROWS,
					cw = w / n
				const rowY = (r) => (1 - (r + 0.5) / ROWS) * h
				gx.fillStyle = rgba(INK, 0.22)
				for (let r = 1; r < ROWS; r++) gx.fillRect(0, (r / ROWS) * h - 0.5, w, 1)
				gx.font = `italic 400 ${Math.max(9, Math.min(strip ? 13 : 18, band * 0.3))}px ${SERIF}`
				gx.textAlign = 'left'
				gx.textBaseline = strip ? 'middle' : 'top'
				gx.fillStyle = rgba(INK, 0.55)
				LABELS.forEach((label, r) =>
					gx.fillText(label, cw + 3, strip ? rowY(r) : h - (r + 1) * band + 6),
				)
				if (!strip) {
					for (let r = 0; r < ROWS; r++) {
						const base = h - r * band - band * 0.1
						gx.fillStyle = rgba(INK, 0.3)
						gx.fillRect(0, base, w, 1)
						for (let s = 0; s < n; s++) {
							const beat = s % 4 === 0
							gx.fillRect((s + 0.5) * cw - 0.5, base - (beat ? 5 : 2), 1, beat ? 5 : 2)
						}
					}
				}
				for (let s = 0; s < n; s++) {
					const m = hits[s]
					if (!m) continue
					const d = (pos - s + n) % n,
						f = d < 1.5 ? 1 - d / 1.5 : 0
					const x = (s + 0.5) * cw
					for (let r = 0; r < ROWS; r++) {
						if (!(m & (1 << r))) continue
						const lv = lvOf(s, r),
							k = lv / 9
						const full = Math.min(band * [0.17, 0.13, 0.09][r], [16, 12, 8][r])
						let y, size
						if (strip) {
							y = rowY(r)
							size = full * (0.45 + 0.55 * k) + f * 2
						} else {
							const base = h - r * band - band * 0.1
							y = base - k * band * 0.68
							size = Math.min(full, cw * 0.32) * (0.75 + 0.35 * k) + f * 2
							gx.strokeStyle = INK
							gx.lineWidth = 1 + k * 1.5
							gx.beginPath()
							gx.moveTo(x, base)
							gx.lineTo(x, y)
							gx.stroke()
						}
						gx.fillStyle = f > 0.3 ? INK : lv >= 9 ? INK : color
						gx.beginPath()
						if (r === 1) gx.rect(x - size, y - size, size * 2, size * 2)
						else if (r === 2) {
							gx.moveTo(x, y - size * 1.3)
							gx.lineTo(x + size, y)
							gx.lineTo(x, y + size * 1.3)
							gx.lineTo(x - size, y)
							gx.closePath()
						} else gx.arc(x, y, size, 0, 6.283)
						gx.fill()
						gx.strokeStyle = INK
						gx.lineWidth = 1
						gx.stroke()
						if (lv >= 9) {
							gx.beginPath()
							gx.arc(x, y, size + 3.5, 0, 6.283)
							gx.stroke()
						}
						if (g?.shown && g.s === s && g.row === r && g.mode === 'level') {
							gx.fillStyle = INK
							gx.textAlign = 'center'
							gx.textBaseline = 'bottom'
							gx.fillText(String(lv), x, y - size * 1.4 - 3)
						}
					}
				}
			},
			dispose() {},
		}
	},
}
