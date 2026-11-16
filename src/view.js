// View: draws the machine (or plain strips) and turns pointer input into lane-local {x, y}.
// Each lane renders into its own offscreen canvas; the dial view wraps it round a ring.
//
// The look: a dusk landscape painted once into a backdrop layer (flat sky, violet hills, ochre field,
// a wandering ink line), and the machine on top: a paper dial pasted on with a flat offset shadow,
// one ring per player, ink on paper. The centre is left bare for src/heart.js.

import { rgba } from './instruments/util.js'
import { INK, SERIF, GROUNDS } from './palette.js'

const TAU = Math.PI * 2
const VERMILION = '#d64a28'
const ORDER = ['flamingo', 'nortel', 'vallotton', 'sand']
// hex lerp for the paper while grounds cross-fade
const mixHex = (a, b, t) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.substr(1 + i, 2), 16) * (1 - t) + parseInt(b.substr(1 + i, 2), 16) * t).toString(16).padStart(2, '0')).join('')
const ink = (a) => rgba(INK, a)
const serif = (px, w = 400, italic = true) => `${italic ? 'italic ' : ''}${w} ${Math.round(px)}px ${SERIF}`

// deterministic noise so the landscape and the wobble of the rings stay put across frames and resizes
function rng(seed) {
	let s = seed >>> 0 || 1
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export function createView(canvas, engine, { seat, canDraw, onSit, onPointer }) {
	const g = canvas.getContext('2d')
	const { lanes, transport } = engine
	const { clock } = transport
	const opts = { mode: 'dial', slices: 192, landscape: true, ground: 'vallotton', cycleLoops: 4 }
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
	let W, H, S, CX, CY, DPR
	let bg = document.createElement('canvas'), bg2 = document.createElement('canvas')
	// ground state: current G, and while cycling an incoming one fading in
	let G = GROUNDS.vallotton, G2 = null, fade = 0, PAPER = G.paper, lastLoopN = -1
	const cursors = new Map() // key -> {lane, x, y, name, until}
	let heat = 0, lastT = performance.now(), lastBeat = -1, hover = null, drag = null

	function resize() {
		DPR = Math.min(2, devicePixelRatio || 1)
		W = innerWidth
		H = innerHeight
		canvas.width = W * DPR
		canvas.height = H * DPR
		const narrow = W < 640, top = narrow ? 150 : 24, bottom = narrow ? 96 : 84
		S = Math.max(240, Math.min(W - 24, H - top - bottom))
		CX = W / 2
		CY = top + (H - top - bottom) / 2
		sizeLanes()
		paintBackdrop(bg, G)
		if (G2) paintBackdrop(bg2, G2)
	}

	// ring geometry, inner lane first
	const n = () => lanes.length
	const band = () => (S * 0.26) / n()
	const ringIn = (i) => S * 0.16 + i * band()
	const ringT = () => band() * 0.82
	const porthole = () => ringIn(0) - S * 0.014
	const medallion = () => S * 0.475
	// strip geometry
	const stripRect = (i) => {
		const top = W < 640 ? 160 : 90, bottom = W < 640 ? 110 : 100
		const h = Math.min(120, (H - top - bottom) / n() - 10)
		const x = Math.max(16, (W - 1100) / 2), w = W - 2 * x
		return { x, y: top + i * (h + 10), w, h }
	}

	function sizeLanes() {
		lanes.forEach((L, i) => {
			let w, h
			if (opts.mode === 'dial') { w = TAU * (ringIn(i) + ringT() / 2); h = ringT() }
			else ({ w, h } = stripRect(i))
			L.w = Math.round(w)
			L.h = Math.round(h)
			L.canvas.width = Math.max(1, L.w * DPR)
			L.canvas.height = Math.max(1, L.h * DPR)
		})
	}

	const angOf = (phase) => -Math.PI / 2 + phase * TAU
	const polar = (a, r) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r]
	const seatAngles = () => lanes.map((_, i) => Math.PI * 0.75 - (i * TAU) / lanes.length) // first lane bottom-left
	const seatPos = (i) => (opts.mode === 'dial' ? polar(seatAngles()[i], S * 0.468) : [stripRect(i).x - 2, stripRect(i).y + 16])
	const seatR = () => Math.max(12, S * 0.028)

	// screen -> lane hit: {lane, x, y} in the lane's 0..1 space
	function hit(px, py, only = null) {
		if (opts.mode === 'dial') {
			const dx = px - CX, dy = py - CY, r = Math.hypot(dx, dy)
			const x = (((Math.atan2(dy, dx) + Math.PI / 2) / TAU) % 1 + 1) % 1
			for (let i = 0; i < lanes.length; i++) {
				if (only !== null && i !== only) continue
				const a = ringIn(i), b = a + ringT(), pad = only !== null ? 1e9 : 4
				if (r >= a - pad && r <= b + pad) return { lane: i, x, y: Math.max(0, Math.min(1, 1 - (r - a) / ringT())) }
			}
		} else {
			for (let i = 0; i < lanes.length; i++) {
				if (only !== null && i !== only) continue
				const R = stripRect(i), pad = only !== null ? 1e9 : 0
				if (py >= R.y - pad && py <= R.y + R.h + pad) return { lane: i, x: Math.max(0, Math.min(0.9999, (px - R.x) / R.w)), y: Math.max(0, Math.min(1, (py - R.y) / R.h)) }
			}
		}
		return null
	}

	canvas.addEventListener('contextmenu', (e) => e.preventDefault())
	canvas.addEventListener('pointerdown', (e) => {
		for (let i = 0; i < lanes.length; i++) {
			const [x, y] = seatPos(i)
			if (Math.hypot(e.clientX - x, e.clientY - y) < seatR() + 6) return onSit(i)
		}
		const h = hit(e.clientX, e.clientY)
		if (!h || !canDraw(h.lane)) return
		canvas.setPointerCapture(e.pointerId)
		drag = { lane: h.lane, id: e.pointerId, alt: e.shiftKey, button: e.button }
		onPointer(h.lane, { type: 'down', x: h.x, y: h.y, id: e.pointerId, alt: drag.alt, button: e.button })
	})
	canvas.addEventListener('pointermove', (e) => {
		hover = hit(e.clientX, e.clientY)
		canvas.style.cursor = hover && canDraw(hover.lane) ? '' : 'default'
		if (!drag || e.pointerId !== drag.id) return
		const h = hit(e.clientX, e.clientY, drag.lane)
		onPointer(drag.lane, { type: 'move', x: h.x, y: h.y, id: e.pointerId, alt: drag.alt, button: drag.button })
	})
	const up = (e) => {
		if (!drag || e.pointerId !== drag.id) return
		const h = hit(e.clientX, e.clientY, drag.lane)
		onPointer(drag.lane, { type: 'up', x: h.x, y: h.y, id: e.pointerId, alt: drag.alt, button: drag.button })
		drag = null
	}
	canvas.addEventListener('pointerup', up)
	canvas.addEventListener('pointercancel', up)
	canvas.addEventListener('pointerleave', () => (hover = null))

	function showCursor(key, lane, x, y, name) { cursors.set(key, { lane, x, y, name, until: performance.now() + 700 }) }

	/* ───────── backdrop: painted once per resize ───────── */

	// a hand-drawn closed circle: radius wobbles a little, the same way every frame
	function wobble(c, cx, cy, r, seed, amp = 0.8) {
		const p = [(seed * 1.7) % TAU, (seed * 2.9) % TAU, (seed * 4.3) % TAU]
		c.beginPath()
		for (let k = 0; k <= 160; k++) {
			const a = (k / 160) * TAU
			const rr = r + amp * (Math.sin(a * 3 + p[0]) * 0.6 + Math.sin(a * 7 + p[1]) * 0.3 + Math.sin(a * 13 + p[2]) * 0.2)
			const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr
			k ? c.lineTo(x, y) : c.moveTo(x, y)
		}
		c.closePath()
	}

	// ridge line from summed bumps, filled down to the bottom
	function ridge(c, base, bumps, rough, R, color) {
		c.fillStyle = color
		c.beginPath()
		c.moveTo(-10, H + 10)
		const ph = R() * 10
		for (let x = -10; x <= W + 10; x += 6) {
			let y = base
			for (const [cx, w, h] of bumps) y -= h * Math.exp(-(((x / W - cx) / w) ** 2))
			y += Math.sin(x * 0.013 + ph) * rough + Math.sin(x * 0.041 + ph * 2) * rough * 0.4
			c.lineTo(x, y)
		}
		c.lineTo(W + 10, H + 10)
		c.closePath()
		c.fill()
	}

	// Mortensen-ish automatism: one thin line drifting across the sky, curling back on itself now and then
	function wanderingLine(c, R, y0, y1) {
		let x = -10, y = (y0 + y1) / 2, a = 0, da = 0
		const step = 3
		c.beginPath()
		c.moveTo(x, y)
		for (let k = 0; k < 4000 && x < W + 10; k++) {
			da = da * 0.95 + (R() - 0.5) * 0.025
			if (R() < 0.0015) da += (R() < 0.5 ? -1 : 1) * 0.35 // a loop
			a += da
			a -= Math.sin(a) * 0.01 // keep heading east, mostly
			if (y < y0) a += 0.05
			if (y > y1) a -= 0.05
			x += Math.cos(a) * step
			y += Math.sin(a) * step
			c.lineTo(x, y)
		}
		c.stroke()
	}

	function crescent(c, x, y, r, rot, thick) {
		c.save(); c.translate(x, y); c.rotate(rot)
		c.beginPath()
		c.arc(0, 0, r, -Math.PI * 0.85, Math.PI * 0.85)
		c.quadraticCurveTo(r * (1 - thick * 2.2), 0, Math.cos(-Math.PI * 0.85) * r, Math.sin(-Math.PI * 0.85) * r)
		c.fill()
		c.restore()
	}

	function paintBackdrop(cv, G) {
		cv.width = W * DPR
		cv.height = H * DPR
		const c = cv.getContext('2d'), R = rng(7)
		c.setTransform(DPR, 0, 0, DPR, 0, 0)
		const hy = Math.round(Math.max(H * 0.5, Math.min(H * 0.68, CY + S * 0.06))) // horizon

		// sky
		const sk = c.createLinearGradient(0, 0, 0, hy)
		sk.addColorStop(0, G.sky[0]); sk.addColorStop(0.75, G.sky[1]); sk.addColorStop(1, G.sky[2])
		c.fillStyle = sk
		c.fillRect(0, 0, W, H)
		if (!opts.landscape) { c.fillStyle = G.paper; c.fillRect(0, 0, W, H); paintGrain(c); return }

		// low flamingo sun, and a couple of black crescents floating where birds would be
		c.fillStyle = G.sun
		c.beginPath(); c.arc(W * 0.86, hy - H * 0.2, Math.max(14, Math.min(W, H) * 0.035), 0, TAU); c.fill()
		// the wandering line
		c.strokeStyle = G.line; c.lineWidth = 0.9; c.lineJoin = 'round'; c.lineCap = 'round'
		wanderingLine(c, R, Math.max(H * 0.26, hy - H * 0.34), hy - H * 0.16)

		// hills: far lilac, near violet, then a dark band of rounded tree masses
		ridge(c, hy, [[0.22, 0.28, H * 0.24], [0.78, 0.18, H * 0.09], [1.02, 0.12, H * 0.14]], 3, R, G.far)
		// flat shadow plane on the far hill
		c.fillStyle = G.farShade
		c.beginPath(); c.moveTo(W * 0.3, hy - H * 0.21); c.lineTo(W * 0.62, hy - H * 0.02); c.lineTo(W * 0.3, hy); c.closePath(); c.fill()
		ridge(c, hy + H * 0.02, [[0.65, 0.22, H * 0.1], [0.05, 0.1, H * 0.05]], 2, R, G.near)
		c.fillStyle = G.trees
		for (let k = 0; k < 26; k++) {
			const x = R() * W, y = hy + H * 0.02 - R() * H * 0.03, r = 6 + R() * Math.max(10, S * 0.03)
			c.beginPath(); c.ellipse(x, y, r * 1.1, r, 0, Math.PI, TAU); c.fill()
		}

		// fields: ochre, then a green bank cut on a diagonal, then a long violet shadow
		c.fillStyle = G.field
		c.beginPath(); c.moveTo(-10, hy + H * 0.02)
		for (let x = -10; x <= W + 10; x += 20) c.lineTo(x, hy + H * 0.02 + Math.sin(x * 0.01) * 3)
		c.lineTo(W + 10, H + 10); c.lineTo(-10, H + 10); c.closePath(); c.fill()
		// etched furrows
		c.strokeStyle = G.furrow; c.lineWidth = 0.8
		for (let k = 1; k < 14; k++) {
			const y = hy + H * 0.02 + k * k * 1.6
			c.beginPath(); c.moveTo(-10, y); c.bezierCurveTo(W * 0.3, y - 4, W * 0.7, y + 6, W + 10, y + 2); c.stroke()
		}
		c.fillStyle = G.grass
		c.beginPath(); c.moveTo(-10, H * 0.84); c.bezierCurveTo(W * 0.3, H * 0.8, W * 0.6, H * 0.9, W + 10, hy + H * 0.1); c.lineTo(W + 10, H + 10); c.lineTo(-10, H + 10); c.closePath(); c.fill()
		c.fillStyle = G.shadow
		c.beginPath(); c.moveTo(W * 0.55, H + 10); c.bezierCurveTo(W * 0.7, H * 0.9, W * 0.85, H * 0.86, W + 10, H * 0.8); c.lineTo(W + 10, H + 10); c.closePath(); c.fill()
		// grass hatching
		c.strokeStyle = G.grassInk; c.lineWidth = 0.8
		for (let k = 0; k < 240; k++) {
			const x = R() * W, y = H * 0.86 + R() * H * 0.16, h = 4 + R() * 7
			c.beginPath(); c.moveTo(x, y); c.lineTo(x + 1.5, y - h); c.stroke()
		}

		// collage scraps: an engineer's grid and a circuit trace, half buried in the field
		c.save()
		c.translate(W * 0.06, H * 0.74); c.rotate(-0.06)
		const gs = Math.max(9, S * 0.018)
		c.strokeStyle = G.dark ? G.line : ink(0.55); c.lineWidth = 0.7
		for (let k = 0; k <= 6; k++) { c.beginPath(); c.moveTo(k * gs, 0); c.lineTo(k * gs, gs * 4); c.stroke() }
		for (let k = 0; k <= 4; k++) { c.beginPath(); c.moveTo(0, k * gs); c.lineTo(gs * 6, k * gs); c.stroke() }
		c.fillStyle = G.scrap
		for (let k = 0; k < 9; k++) { c.beginPath(); c.arc((1 + (k % 3)) * gs + gs * 0.5, (1 + Math.floor(k / 3)) * gs - gs * 0.5, gs * 0.38, 0, TAU); c.fill() }
		c.restore()
		c.strokeStyle = VERMILION; c.lineWidth = 2; c.fillStyle = VERMILION
		const tx = W * 0.9, ty = H * 0.62, u = Math.max(10, S * 0.02)
		for (let k = 0; k < 4; k++) {
			c.beginPath(); c.moveTo(tx + k * u * 0.7, ty); c.lineTo(tx + k * u * 0.7, ty + u * (1.2 + k * 0.5)); c.lineTo(tx + k * u * 0.7 - u, ty + u * (2 + k * 0.5)); c.stroke()
			c.beginPath(); c.arc(tx + k * u * 0.7, ty, 2.4, 0, TAU); c.fill()
		}

		paintGrain(c)
	}

	function paintGrain(c) {
		const t = document.createElement('canvas')
		t.width = t.height = 160
		const tg = t.getContext('2d'), R = rng(3)
		for (let k = 0; k < 1400; k++) {
			tg.fillStyle = R() < 0.5 ? 'rgba(40,25,10,.09)' : 'rgba(255,250,235,.10)'
			tg.fillRect(R() * 160, R() * 160, 1, 1 + R() * 1.5)
		}
		c.fillStyle = c.createPattern(t, 'repeat')
		c.fillRect(0, 0, W, H)
	}

	// hatch patterns per colour, made on demand
	const hatches = new Map()
	function hatch(color, a = 0.35) {
		const key = color + a
		if (!hatches.has(key)) {
			const t = document.createElement('canvas')
			t.width = t.height = 7
			const tg = t.getContext('2d')
			tg.strokeStyle = rgba(color, a); tg.lineWidth = 1
			tg.beginPath(); tg.moveTo(-1, 8); tg.lineTo(8, -1); tg.stroke()
			hatches.set(key, g.createPattern(t, 'repeat'))
		}
		return hatches.get(key)
	}

	// draw one lane's instrument into its offscreen canvas
	function renderLane(L) {
		const lg = L.g
		lg.setTransform(1, 0, 0, 1, 0, 0)
		lg.clearRect(0, 0, L.canvas.width, L.canvas.height)
		lg.setTransform(DPR, 0, 0, DPR, 0, 0)
		lg.save()
		try { L.instance.frame(lg, L.w, L.h, engine.iclock) } catch (e) { if (!L.err) console.error(L.module.id, e); L.err = true }
		lg.restore()
	}

	// wrap a lane strip onto the annulus [r0, r1] as thin rotated slices
	function warp(L, r0, r1) {
		const N = opts.slices, sw = L.canvas.width / N, dw = ((r0 + r1) / 2) * (TAU / N) + 0.6
		for (let k = 0; k < N; k++) {
			const th = angOf((k + 0.5) / N) + Math.PI / 2, c = Math.cos(th), s = Math.sin(th)
			g.setTransform(DPR * c, DPR * s, -DPR * s, DPR * c, DPR * CX, DPR * CY)
			g.drawImage(L.canvas, k * sw, 0, sw, L.canvas.height, -dw / 2, -r1, dw, r1 - r0)
		}
		g.setTransform(DPR, 0, 0, DPR, 0, 0)
	}

	function frame(t) {
		const dt = Math.min(0.05, (t - lastT) / 1000)
		lastT = t
		const p = clock.pos()
		const phase = p ? p.loopPhase : 0
		const loop = p?.loop
		const beatIdx = p ? Math.floor(p.beats) : 0
		if (beatIdx !== lastBeat) { if (lastBeat !== -1) heat = Math.min(1, heat + (p.beat === 0 ? 0.25 : 0.08)); lastBeat = beatIdx }
		heat = Math.max(heat * Math.pow(0.04, dt), Math.min(0.9, engine.level() * 2.5))

		// cycling grounds: every few loops the next one fades in over a couple of seconds
		if (opts.ground === 'cycle' && p) {
			const ln = Math.floor(p.loops ?? p.beats / ((loop?.bars || 2) * (loop?.beatsPerBar || 4)))
			if (lastLoopN >= 0 && ln !== lastLoopN && ln % opts.cycleLoops === 0 && !G2) startFade(GROUNDS[ORDER[(ORDER.indexOf(groundName()) + 1) % ORDER.length]])
			lastLoopN = ln
		}
		if (G2) {
			fade = Math.min(1, fade + dt / (reduce ? 0.01 : 2.5))
			PAPER = mixHex(G.paper, G2.paper, fade)
			if (fade >= 1) { [bg, bg2] = [bg2, bg]; G = G2; G2 = null; PAPER = G.paper; applyCss() }
		}
		g.setTransform(1, 0, 0, 1, 0, 0)
		g.drawImage(bg, 0, 0)
		if (G2) { g.globalAlpha = fade; g.drawImage(bg2, 0, 0); g.globalAlpha = 1 }
		g.setTransform(DPR, 0, 0, DPR, 0, 0)
		if (opts.landscape) drawDrifters(t)
		lanes.forEach(renderLane)
		if (opts.mode === 'dial') drawDial(t, dt, phase, loop)
		else drawStrips(phase)
		drawCursors()
		requestAnimationFrame(frame)
	}

	const groundName = () => Object.keys(GROUNDS).find((k) => GROUNDS[k] === G)
	function startFade(next) {
		if (!next || next === G) return
		G2 = next; fade = 0
		paintBackdrop(bg2, G2)
		applyCss(G2)
	}
	// the DOM chrome follows the ground: page background, paper tokens, title colour
	function applyCss(g0 = G) {
		const r = document.documentElement.style
		r.setProperty('--paper', g0.paper)
		r.setProperty('--sky', g0.sky[0])
		r.setProperty('--title', g0.dark ? g0.paper : '#211a2e')
		document.documentElement.dataset.ground = Object.keys(GROUNDS).find((k) => GROUNDS[k] === g0)
		dispatchEvent(new CustomEvent('ground', { detail: { ...g0 } }))
	}
	function setGround(name) {
		opts.ground = name
		if (name === 'cycle') return
		G2 = null; G = GROUNDS[name] || G; PAPER = G.paper
		paintBackdrop(bg, G); applyCss()
	}

	// black crescents adrift in the sky, slow as weather; they keep clear of the dial
	const drifters = Array.from({ length: 5 }, (_, k) => ({ u: (k * 0.23 + 0.07) % 1, v: 0.08 + ((k * 0.37) % 0.3), s: 0.6 + ((k * 0.61) % 0.8), sp: 0.4 + ((k * 0.29) % 0.6), rot: k * 1.3 }))
	function drawDrifters(t) {
		const T = reduce ? 0 : t / 1000
		g.fillStyle = G.mark
		for (const d of drifters) {
			const x = ((d.u + T * 0.004 * d.sp) % 1.1) * (W + 60) - 30, y = d.v * H + Math.sin(T * 0.3 * d.sp + d.rot) * 8
			if (opts.mode === 'dial' && Math.hypot(x - CX, y - CY) < medallion() + 50) continue
			if (x < 260 && y < 200) continue // not over the title
			crescent(g, x, y, Math.max(5, S * 0.014) * d.s, d.rot + Math.sin(T * 0.2 + d.rot) * 0.4, 0.35)
		}
	}

	function slip(text, x, y, px, align = 'center') {
		g.font = serif(px)
		const w = g.measureText(text).width + px * 0.9, h = px * 1.45
		const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
		g.fillStyle = PAPER
		g.fillRect(x0, y - h / 2, w, h)
		g.strokeStyle = ink(0.7); g.lineWidth = 0.8
		g.strokeRect(x0 + 0.5, y - h / 2 + 0.5, w - 1, h - 1)
		g.fillStyle = INK
		g.textAlign = 'center'; g.textBaseline = 'middle'
		g.fillText(text, x0 + w / 2, y + 1)
	}

	function drawStrips(phase) {
		lanes.forEach((L, i) => {
			const R = stripRect(i), own = canDraw(i)
			g.fillStyle = 'rgba(40,25,60,.35)'
			g.fillRect(R.x + 5, R.y + 6, R.w, R.h)
			g.fillStyle = PAPER
			g.fillRect(R.x, R.y, R.w, R.h)
			if (own) { g.fillStyle = hatch(L.color, 0.22); g.fillRect(R.x, R.y, R.w, R.h) }
			g.strokeStyle = ink(own ? 0.9 : 0.45)
			g.lineWidth = own ? 1.4 : 1
			g.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1)
			const steps = engine.steps()
			for (let s = 0; s < steps; s += 4) {
				g.fillStyle = s % 16 === 0 ? ink(0.25) : ink(0.07)
				g.fillRect(R.x + (s / steps) * R.w, R.y, 1, R.h)
			}
			g.drawImage(L.canvas, R.x, R.y, R.w, R.h)
			g.fillStyle = INK
			g.fillRect(R.x + phase * R.w, R.y - 4, 1.5, R.h + 8)
			const st = seat(i)
			g.font = serif(13)
			g.textAlign = 'left'; g.textBaseline = 'top'
			g.fillStyle = ink(0.8)
			g.fillText(`${L.module.name.toLowerCase()}, ${st.label}`, R.x + 24, R.y + 8)
			drawSeat(i, ...seatPos(i))
		})
	}

	function drawSeat(i, x, y, label) {
		const L = lanes[i], st = seat(i), r = seatR()
		if (st.me) { g.fillStyle = 'rgba(40,25,60,.45)'; g.beginPath(); g.arc(x + 3, y + 4, r, 0, TAU); g.fill() }
		g.fillStyle = st.name ? L.color : PAPER
		g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill()
		g.strokeStyle = INK
		g.lineWidth = st.me ? 2.4 : 1.1
		if (!st.name) g.setLineDash([2.5, 3])
		wobble(g, x, y, r, i * 5 + 2, 0.6); g.stroke()
		g.setLineDash([])
		g.font = serif(r * 1.05, 600, false)
		g.textAlign = 'center'; g.textBaseline = 'middle'
		g.fillStyle = st.name ? PAPER : ink(0.6)
		g.fillText(st.name ? st.name[0].toUpperCase() : String(i + 1), x, y + 1)
		if (label) slip(`${L.module.name.toLowerCase()}, ${st.label}`, x, y > CY ? y + r + 13 : y - r - 13, Math.max(11, S * 0.019))
	}

	// one flame tongue: round foot, curling tip
	function tongue(bx, by, w, h, lean) {
		const tx = bx + lean, ty = by - h
		g.beginPath()
		g.moveTo(bx - w, by)
		g.bezierCurveTo(bx - w * 1.25, by - h * 0.45, tx - w * 0.9 + lean * 0.3, by - h * 0.7, tx, ty)
		g.bezierCurveTo(tx + w * 0.15 - lean * 0.4, by - h * 0.62, bx + w * 1.3, by - h * 0.42, bx + w, by)
		g.quadraticCurveTo(bx, by + w * 0.9, bx - w, by)
		g.closePath()
	}

	function drawDial(t, dt, phase, loop) {
		const outer = ringIn(lanes.length - 1) + ringT() + 8, inner = ringIn(0) - 6, M = medallion()

		// the medallion: a paper disc pasted onto the landscape, flat violet shadow, etched double rim
		g.fillStyle = 'rgba(42,28,72,.5)'
		g.beginPath(); g.arc(CX + S * 0.014, CY + S * 0.02, M, 0, TAU); g.fill()
		g.fillStyle = PAPER
		wobble(g, CX, CY, M, 1, 1.2); g.fill()
		g.strokeStyle = INK; g.lineWidth = 1.6; g.stroke()
		g.lineWidth = 0.7; g.strokeStyle = ink(0.5)
		wobble(g, CX, CY, M - 5, 2, 1); g.stroke()
		// rivets
		g.fillStyle = PAPER; g.strokeStyle = INK; g.lineWidth = 0.8
		for (let k = 0; k < 32; k++) {
			if (k % 8 === 3 || k % 8 === 5) continue // leave room for the seats
			const [x, y] = polar(angOf(k / 32 + 1 / 64), M - S * 0.012)
			g.beginPath(); g.arc(x, y, Math.max(1.6, S * 0.0032), 0, TAU); g.fill(); g.stroke()
		}

		// shadow wedge trailing the hand, like the flat shadow planes on a dusk field
		const pa = angOf(phase)
		g.fillStyle = 'rgba(90,63,142,.07)'
		g.beginPath(); g.arc(CX, CY, outer, pa - 0.9, pa); g.arc(CX, CY, inner, pa, pa - 0.9, true); g.closePath(); g.fill()

		// beat and bar marks, numerals outside the outer ring
		const beats = loop ? loop.bars * loop.beatsPerBar : 8, bpb = loop?.beatsPerBar || 4
		for (let b = 0; b < beats; b++) {
			const a = angOf(b / beats), bar = b % bpb === 0
			const [x1, y1] = polar(a, inner), [x2, y2] = polar(a, outer + (bar ? 6 : 0))
			g.strokeStyle = bar ? ink(0.3) : ink(0.08)
			g.lineWidth = bar ? 0.9 : 0.7
			g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
			if (bar) {
				g.font = serif(Math.max(12, S * 0.026))
				g.textAlign = 'center'; g.textBaseline = 'middle'
				g.fillStyle = ink(0.6)
				const [x, y] = polar(a + 0.05, outer + S * 0.022)
				g.fillText(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'][b / bpb] || String(b / bpb + 1), x, y)
			}
		}
		// 16th ticks on the outer rim, like a dial
		const steps = engine.steps()
		g.strokeStyle = ink(0.35); g.lineWidth = 0.7
		for (let s = 0; s < steps; s++) {
			const a = angOf(s / steps), [x1, y1] = polar(a, outer - 2), [x2, y2] = polar(a, outer + (s % 4 ? 2 : 4))
			g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
		}

		lanes.forEach((L, i) => {
			const r0 = ringIn(i), r1 = r0 + ringT(), own = canDraw(i)
			g.beginPath(); g.arc(CX, CY, r1, 0, TAU); g.arc(CX, CY, r0, 0, TAU, true)
			g.fillStyle = rgba(L.color, own ? 0.13 : 0.05); g.fill()
			if (own) { g.fillStyle = hatch(L.color, 0.3); g.fill() }
			g.strokeStyle = ink(own ? 0.9 : 0.4)
			g.lineWidth = own ? 1.3 : 0.9
			wobble(g, CX, CY, r0, i * 3 + 11, own ? 0.9 : 0.6); g.stroke()
			wobble(g, CX, CY, r1, i * 3 + 12, own ? 0.9 : 0.6); g.stroke()
			if (own && hover && hover.lane === i && !drag) {
				const a0 = angOf(Math.floor(hover.x * steps) / steps), a1 = angOf((Math.floor(hover.x * steps) + 1) / steps)
				g.fillStyle = rgba(L.color, 0.28)
				g.beginPath(); g.arc(CX, CY, r1, a0, a1); g.arc(CX, CY, r0, a1, a0, true); g.fill()
			}
			warp(L, r0, r1)
			g.save()
			g.translate(...polar(-Math.PI / 2 - 0.2, r0 + ringT() / 2))
			g.rotate(-0.2)
			g.font = serif(Math.max(11, S * 0.02))
			g.fillStyle = own ? INK : ink(0.6)
			g.textAlign = 'right'; g.textBaseline = 'middle'
			g.fillText(L.module.name.toLowerCase(), 0, 0)
			g.restore()
		})

		// hand: an ink needle with a vermilion bead
		const [x1, y1] = polar(pa, inner - 2), [x2, y2] = polar(pa, outer + 8)
		g.strokeStyle = INK; g.lineWidth = 1.4; g.lineCap = 'round'
		g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
		g.fillStyle = VERMILION
		g.beginPath(); g.arc(x2, y2, Math.max(3, S * 0.006), 0, TAU); g.fill()
		g.strokeStyle = INK; g.lineWidth = 1; g.stroke()

		// the centre stays bare paper with an etched rim; src/heart.js draws the machine's heart above it on its own canvas
		g.strokeStyle = ink(0.8); g.lineWidth = 1.1
		wobble(g, CX, CY, porthole(), 21, 0.8); g.stroke()
		g.strokeStyle = ink(0.3); g.lineWidth = 0.6
		wobble(g, CX, CY, porthole() - 4, 22, 0.6); g.stroke()

		lanes.forEach((L, i) => drawSeat(i, ...seatPos(i), true))
	}

	function drawCursors() {
		const now = performance.now()
		for (const [key, c] of cursors) {
			if (c.until < now) { cursors.delete(key); continue }
			const L = lanes[c.lane]
			if (!L) continue
			let x, y
			if (opts.mode === 'dial') [x, y] = polar(angOf(c.x), ringIn(c.lane) + (1 - c.y) * ringT())
			else { const R = stripRect(c.lane); x = R.x + c.x * R.w; y = R.y + c.y * R.h }
			g.fillStyle = L.color
			g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill()
			g.strokeStyle = INK; g.lineWidth = 1
			g.beginPath(); g.arc(x, y, 7, 0, TAU); g.stroke()
			g.font = serif(Math.max(12, (S || 600) * 0.02))
			g.textAlign = 'left'; g.textBaseline = 'alphabetic'
			g.fillStyle = INK
			g.fillText(c.name || '', x + 11, y - 8)
		}
	}

	// canvas text needs the faces loaded; repaint once they are
	document.fonts?.load(serif(16)).then(() => document.fonts.load(serif(16, 600, false))).catch(() => {})

	addEventListener('resize', resize)
	resize()
	applyCss()
	requestAnimationFrame(frame)

	return {
		opts,
		showCursor,
		setMode(m) { opts.mode = m; sizeLanes() },
		repaint: () => paintBackdrop(bg, G),
		setGround,
		// current ground colours ({ paper, dark, sky, ... }); a 'ground' event fires on window when it changes
		ground: () => ({ ...(G2 || G) }),
		// the bare disc inside the innermost ring, CSS px; null in strips mode
		heat: () => heat,
		center: () => (opts.mode === 'dial' ? { x: CX, y: CY, r: ringIn(0), ground: PAPER } : null),
		resize,
	}
}
