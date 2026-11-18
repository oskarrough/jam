// Hover preview for the instrument strip: hovering a glyph opens a live sheet just under it, that instrument's
// `demo` drawn by a ghost hand and playing on the jam's clock (like a browser's preview before you load a sound).
// Silent: the instance's out goes nowhere. One instance per instrument, made on first hover; only the shown one draws.

import { INK, INK_THEME } from './palette.js'

const PW = 264, // the preview's size in CSS px; the instrument draws into exactly this
	PH = 164,
	HOLD_MS = 3200, // once the demo is drawn it plays this long, then the hand draws it again
	// a demo of a few taps reads as an empty sheet: these start from their full sample, and the hand draws on top
	SEEDED = new Set(['drums', 'gears', 'steps'])

export function createPreview({ engine, registry, el }) {
	const box = document.createElement('div')
	box.className = 'preview'
	box.hidden = true
	const canvas = document.createElement('canvas')
	box.append(canvas)
	el.append(box)
	const dpr = Math.min(2, devicePixelRatio || 1)
	canvas.width = PW * dpr
	canvas.height = PH * dpr
	const g = canvas.getContext('2d')
	const sink = engine.audio.createGain() // never connected
	const made = new Map()
	let cur = null,
		raf = 0,
		hideT = 0

	function make(id, color) {
		if (made.has(id)) return made.get(id)
		const mod = registry.get(id),
			t = { id, mod }
		made.set(id, t)
		try {
			t.inst = mod.create({
				audio: engine.audio,
				out: sink,
				clock: engine.iclock,
				params: Object.fromEntries(Object.entries(mod.params || {}).map(([k, p]) => [k, p.value])),
				color,
				theme: INK_THEME,
				setLen() {},
			})
			const d = mod.demo
			t.strokes = d ? (typeof d === 'function' ? d('sheet', PW / PH) : d).filter((s) => s.length) : []
			t.seed = (SEEDED.has(id) || !t.strokes.length) && mod.sample ? mod.sample(engine.iclock.steps) : null
			t.plan = []
			let at = 0
			for (const s of t.strokes) {
				const dur = s.length === 1 ? 260 : 380 + s.length * 45
				t.plan.push({ s, t0: at, dur, fed: -1 })
				at += dur + 300
			}
			t.cycle = at + HOLD_MS
			draw(t) // a first frame, for pointer maths that reads the size
		} catch (e) {
			console.warn('preview', id, e)
			t.err = true
		}
		return t
	}
	const pt = (s, k) => ({ x: s[k][0], y: s[k][1], alt: false, shape: 'sheet', id: 'preview' })
	// feed the demo up to now; each pass starts from the seed (or a blank sheet)
	function run(t, now) {
		const ms = now - t.start,
			pass = Math.floor(ms / t.cycle)
		if (pass !== t.pass) {
			t.pass = pass
			if (t.seed) t.inst.setState(structuredClone(t.seed))
			else t.inst.clear ? t.inst.clear() : t.inst.setState(null)
			for (const p of t.plan) p.fed = -1
		}
		const el = ms - pass * t.cycle
		t.hand = null
		for (const p of t.plan) {
			if (el < p.t0) break
			const n = p.s.length,
				k = Math.min(n - 1, Math.floor(((el - p.t0) / p.dur) * (n - 1)))
			while (p.fed < k) {
				p.fed++
				t.inst.pointer({ type: p.fed ? 'move' : 'down', ...pt(p.s, p.fed) })
				if (p.fed === n - 1) t.inst.pointer({ type: 'up', ...pt(p.s, n - 1) })
			}
			if (el < p.t0 + p.dur) t.hand = p.s[k]
		}
	}
	function draw(t) {
		g.setTransform(1, 0, 0, 1, 0, 0)
		g.clearRect(0, 0, canvas.width, canvas.height)
		g.setTransform(dpr, 0, 0, dpr, 0, 0)
		if (t.err) return
		g.save()
		try {
			t.inst.frame(g, PW, PH, engine.iclock, 'sheet')
		} catch (e) {
			console.warn('preview', t.id, e)
			t.err = true
		}
		g.restore()
		const axis = t.mod.playhead ?? 'x'
		if (axis && engine.iclock.playing) {
			const p = engine.iclock.pos() / engine.iclock.steps
			g.fillStyle = INK
			if (axis === 'y') g.fillRect(0, p * PH, PW, 1.5)
			else g.fillRect(p * PW, 0, 1.5, PH)
		}
		if (t.hand) {
			g.fillStyle = INK
			g.beginPath()
			g.arc(t.hand[0] * PW, t.hand[1] * PH, 6, 0, Math.PI * 2)
			g.fill()
		}
	}
	function previewTick(now) {
		raf = 0
		if (!cur) return
		if (!cur.err && cur.strokes.length) run(cur, now)
		draw(cur)
		raf = requestAnimationFrame(previewTick)
	}

	return {
		// open under the glyph `at` (an element inside el)
		show(id, at, color) {
			clearTimeout(hideT)
			const t = make(id, color)
			if (cur !== t) {
				cur = t
				t.start = performance.now()
				t.pass = -1
			}
			const r = at.getBoundingClientRect(),
				o = el.getBoundingClientRect()
			const x = Math.max(0, Math.min(o.width - PW, r.left - o.left + r.width / 2 - PW / 2))
			box.style.left = x + 'px'
			box.style.top = r.bottom - o.top + 8 + 'px'
			box.hidden = false
			raf ||= requestAnimationFrame(previewTick)
		},
		// a short grace, so sliding along the row keeps it open
		hide(now = false) {
			clearTimeout(hideT)
			const go = () => {
				cur = null
				box.hidden = true
			}
			now ? go() : (hideT = setTimeout(go, 120))
		},
	}
}
