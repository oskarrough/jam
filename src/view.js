// View: draws the machine (or plain strips) and turns pointer input into lane-local {x, y}.
// Each lane renders into its own offscreen canvas; the dial view wraps it round a ring.
//
// The look: a dusk landscape painted once into a backdrop layer (flat sky, violet hills, ochre field,
// a wandering ink line), and the machine on top: a paper dial pasted on with a flat offset shadow,
// one ring per player, ink on paper. The centre is left bare for src/heart.js.

import { rgba } from './instruments/lib/util.js'
import { INK, SERIF, GROUNDS } from './palette.js'
import { spring, dentAt } from './jelly.js'
import { paintLandscape, makeWisps } from './backdrop.js'

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

export function createView(canvas, engine, { seat, canDraw, onSit, onPointer, onHand, canHand }) {
	const g = canvas.getContext('2d')
	const { lanes, transport } = engine
	const { clock } = transport
	const opts = { mode: 'dial', slices: 192, landscape: true, ground: 'vallotton', cycleLoops: 4 }
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
	let W, H, S, CX, CY, DPR
	// zoom: the overview geometry (S0, CX0, CY0), the focus geometry (SF, CXF, CYF, dev) and zt easing between them.
	// In focus your instrument opens big and unwrapped on a paper sheet (dev); the machine shrinks beside it, still live.
	let S0, CX0, CY0, SF, CXF, CYF, dev = null, zt = 0, moving = false
	const focus = { on: false, lane: -1 }
	let bg = document.createElement('canvas'), bg2 = document.createElement('canvas')
	// ground state: current G, and while cycling an incoming one fading in
	let G = GROUNDS.vallotton, G2 = null, fade = 0, PAPER = G.paper, lastLoopN = -1
	const cursors = new Map() // key -> {lane, x, y, name, until}
	let heat = 0, lastT = performance.now(), lastBeat = -1, hover = null, drag = null
	// handing your part to a robot: press your own badge, drag the thread onto theirs
	let handing = null // {from, id, x, y, x0, y0, moved}
	const seatUnder = (px, py) => lanes.findIndex((_, i) => { const [x, y] = seatPos(i); return Math.hypot(px - x, py - y) < seatR() + 6 })
	// jelly: each ring and seat has a spring; pressing dents it where you pressed, release wobbles it back
	const ringJelly = lanes.map(() => ({ s: spring({ k: 420, c: 9 }), a: 0 }))
	const seatJelly = lanes.map(() => ({ s: spring({ k: 700, c: 10 }), a: 0 }))
	const press = (j, a) => { j.a = a; j.s.target = 1 }
	const release = (j) => { if (j.s.target) { j.s.target = 0; j.s.v -= 3 } }

	function resize() {
		DPR = Math.min(2, devicePixelRatio || 1)
		W = innerWidth
		H = innerHeight
		canvas.width = W * DPR
		canvas.height = H * DPR
		const narrow = W < 640, top = narrow ? 44 : 24, bottom = narrow ? 96 : 84, STRIP = 58 // room above the zoomed sheet for the instrument strip
		S0 = Math.max(240, Math.min(W - 24, H - top - bottom))
		CX0 = W / 2
		CY0 = top + (H - top - bottom) / 2
		if (narrow) {
			// phone: a small live medallion bottom-left above the deck, the sheet fills the middle
			SF = Math.min(180, W * 0.46)
			CXF = 8 + SF / 2
			CYF = H - bottom - SF / 2 + 6
			dev = { x: 12, y: 8 + STRIP, w: W - 24, h: Math.max(160, H - bottom - SF - STRIP - 16) }
		} else {
			// wide: the machine bottom-left, the sheet to its right
			SF = Math.max(220, Math.min(W * 0.34, H - bottom - 120, 520))
			CXF = 20 + SF / 2
			CYF = H - bottom - SF / 2 - 4
			const x = CXF + SF / 2 + 28
			dev = { x, y: 12 + STRIP, w: W - x - 24, h: H - 12 - STRIP - bottom - 16 }
		}
		applyZoom()
		sizeLanes()
		if (focus.on) dispatchEvent(new CustomEvent('zoom', { detail: { on: true, lane: focus.lane, dev: { ...dev } } }))
		paintBackdrop(bg, G)
		if (G2) paintBackdrop(bg2, G2)
	}

	// the zoom is one move in two beats, with no cross-fade: first the machine slides and shrinks into its corner,
	// then the sheet slides in from the right edge, opaque. Zooming out plays it backwards.
	// Every timing knob lives in Z, tunable live from the debug panel (zoom folder) and kept in localStorage.
	const ZOOM_DEFAULTS = { inMs: 550, outMs: 550, machineEnd: 0.6, sheetStart: 0.45, machineEase: 'smooth', sheetEase: 'smooth', machineBezier: '0.4, 0, 0.2, 1', sheetBezier: '0.2, 0.8, 0.3, 1', slide: 1, slidePad: 24, scale: 1, dx: 0, dy: 0, barLag: 0 }
	const Z = { ...ZOOM_DEFAULTS }
	try { Object.assign(Z, JSON.parse(localStorage.getItem('roughjam.zoom') || '{}')) } catch {}
	const EASES = {
		linear: (t) => t,
		smooth: (t) => t * t * (3 - 2 * t),
		'in-out cubic': (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
		'out cubic': (t) => 1 - (1 - t) ** 3,
		'out expo': (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
		'out back': (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
	}
	// cubic-bezier(x1, y1, x2, y2) like CSS: solve x(u) = t by Newton, then read y(u)
	const bezierCache = new Map()
	function bezier(str) {
		if (bezierCache.has(str)) return bezierCache.get(str)
		const [x1, y1, x2, y2] = String(str).split(',').map(Number)
		const B = (a, b, u) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3
		const dB = (a, b, u) => 3 * a * (1 - u) ** 2 + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u
		const f = [x1, y1, x2, y2].some((v) => !Number.isFinite(v)) ? EASES.smooth : (t) => {
			let u = t
			for (let i = 0; i < 8; i++) { const d = dB(x1, x2, u); if (Math.abs(d) < 1e-6) break; u = Math.max(0, Math.min(1, u - (B(x1, x2, u) - t) / d)) }
			return B(y1, y2, u)
		}
		bezierCache.set(str, f)
		return f
	}
	const easeOf = (name, bz) => (name === 'custom' ? bezier(bz) : EASES[name] || EASES.smooth)
	const clamp01 = (t) => Math.max(0, Math.min(1, t))
	const eMachine = () => easeOf(Z.machineEase, Z.machineBezier)(clamp01(zt / Math.max(0.01, Z.machineEnd)))
	const sheetP = () => clamp01((zt - Z.sheetStart) / Math.max(0.01, 1 - Z.sheetStart))
	const eSheet = () => easeOf(Z.sheetEase, Z.sheetBezier)(sheetP())
	// the strip above the sheet can trail it a little (barLag of the sheet's own move)
	const eBar = () => easeOf(Z.sheetEase, Z.sheetBezier)(clamp01((sheetP() - Z.barLag) / Math.max(0.01, 1 - Z.barLag)))
	const slideDist = () => (W - dev.x + Z.slidePad) * Z.slide
	let sheetLane = -1 // the lane whose canvas is sized to the sheet (lags focus on the way out)
	function applyZoom() {
		const e = eMachine()
		S = S0 + (SF * Z.scale - S0) * e
		CX = CX0 + (CXF + Z.dx - CX0) * e
		CY = CY0 + (CYF + Z.dy - CY0) * e
	}
	const small = () => S < 330 // below this the dial drops its captions and numerals

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
			// rings are sized at overview scale; warp() scales them down when the dial shrinks
			const b0 = (S0 * 0.26) / n()
			if (opts.mode === 'dial' && i === sheetLane) ({ w, h } = dev)
			else if (opts.mode === 'dial') { w = TAU * (S0 * 0.16 + i * b0 + (b0 * 0.82) / 2); h = b0 * 0.82 }
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
	const seatPos = (i) => (opts.mode === 'dial' ? polar(seatAngles()[i], S * 0.505) : [stripRect(i).x - 2, stripRect(i).y + 16])
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
	const inDev = (x, y) => focus.on && dev && x >= dev.x && x <= dev.x + dev.w && y >= dev.y && y <= dev.y + dev.h
	const devXY = (x, y) => ({ x: Math.max(0, Math.min(0.9999, (x - dev.x) / dev.w)), y: Math.max(0, Math.min(1, (y - dev.y) / dev.h)) })
	canvas.addEventListener('pointerdown', (e) => {
		if (inDev(e.clientX, e.clientY) && canDraw(focus.lane)) {
			canvas.setPointerCapture(e.pointerId)
			drag = { lane: focus.lane, id: e.pointerId, alt: e.shiftKey, button: e.button, dev: true }
			return onPointer(focus.lane, { type: 'down', ...devXY(e.clientX, e.clientY), id: e.pointerId, alt: drag.alt, button: e.button })
		}
		for (let i = 0; i < lanes.length; i++) {
			const [x, y] = seatPos(i)
			if (Math.hypot(e.clientX - x, e.clientY - y) < seatR() + 6) {
				press(seatJelly[i], Math.atan2(e.clientY - y, e.clientX - x))
				// your own badge waits for release: a tap zooms, a drag hands your part to a robot
				if (onHand && seat(i).me) {
					canvas.setPointerCapture(e.pointerId)
					handing = { from: i, id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false }
					return
				}
				setTimeout(() => release(seatJelly[i]), 110)
				return onSit(i)
			}
		}
		// in focus the shrunken machine is for looking; a tap on it zooms back out
		if (focus.on) { if (Math.hypot(e.clientX - CX, e.clientY - CY) < medallion()) setFocus(-1); return }
		const h = hit(e.clientX, e.clientY)
		if (h && opts.mode === 'dial') {
			press(ringJelly[h.lane], Math.atan2(e.clientY - CY, e.clientX - CX))
			if (!canDraw(h.lane)) setTimeout(() => release(ringJelly[h.lane]), 120) // a poke at someone else's ring
		}
		if (!h || !canDraw(h.lane)) return
		canvas.setPointerCapture(e.pointerId)
		drag = { lane: h.lane, id: e.pointerId, alt: e.shiftKey, button: e.button }
		onPointer(h.lane, { type: 'down', x: h.x, y: h.y, id: e.pointerId, alt: drag.alt, button: e.button })
	})
	canvas.addEventListener('pointermove', (e) => {
		hover = focus.on ? null : hit(e.clientX, e.clientY)
		const onSeat = lanes.some((_, i) => { const [x, y] = seatPos(i); return Math.hypot(e.clientX - x, e.clientY - y) < seatR() + 6 })
		const onDial = focus.on && Math.hypot(e.clientX - CX, e.clientY - CY) < medallion()
		canvas.style.cursor = onSeat || onDial ? 'pointer' : inDev(e.clientX, e.clientY) || (hover && canDraw(hover.lane)) ? '' : 'default'
		if (handing && e.pointerId === handing.id) {
			handing.x = e.clientX; handing.y = e.clientY
			if (Math.hypot(handing.x - handing.x0, handing.y - handing.y0) > 8) handing.moved = true
			if (handing.moved) canvas.style.cursor = 'grabbing'
			return
		}
		if (!drag || e.pointerId !== drag.id) return
		if (drag.dev) return onPointer(drag.lane, { type: 'move', ...devXY(e.clientX, e.clientY), id: e.pointerId, alt: drag.alt, button: drag.button })
		const h = hit(e.clientX, e.clientY, drag.lane)
		ringJelly[drag.lane].a = Math.atan2(e.clientY - CY, e.clientX - CX) // the dent follows the pen
		onPointer(drag.lane, { type: 'move', x: h.x, y: h.y, id: e.pointerId, alt: drag.alt, button: drag.button })
	})
	const up = (e) => {
		if (handing && e.pointerId === handing.id) {
			const { from, moved } = handing
			handing = null
			release(seatJelly[from])
			if (e.type === 'pointercancel') return
			if (!moved) return onSit(from)
			const to = seatUnder(e.clientX, e.clientY)
			if (to >= 0 && canHand?.(from, to)) {
				press(seatJelly[to], Math.atan2(e.clientY - seatPos(to)[1], e.clientX - seatPos(to)[0]))
				setTimeout(() => release(seatJelly[to]), 160)
				onHand(from, to)
			}
			return
		}
		if (!drag || e.pointerId !== drag.id) return
		const h = drag.dev ? devXY(e.clientX, e.clientY) : hit(e.clientX, e.clientY, drag.lane)
		onPointer(drag.lane, { type: 'up', x: h.x, y: h.y, id: e.pointerId, alt: drag.alt, button: drag.button })
		release(ringJelly[drag.lane])
		drag = null
	}
	canvas.addEventListener('pointerup', up)
	canvas.addEventListener('pointercancel', (e) => { if (handing && e.pointerId === handing.id) up(e) })

	// zoom into a lane (your own), or out with -1
	function setFocus(i) {
		if (drag) return
		const on = i >= 0 && opts.mode === 'dial'
		if (on === focus.on && i === focus.lane) return
		focus.on = on
		focus.lane = on ? i : -1
		if (on) { sheetLane = i; sizeLanes() } // on the way out the sheet keeps its drawing until it has slid away
		hover = null
		dispatchEvent(new CustomEvent('zoom', { detail: { on, lane: focus.lane, dev: on ? { ...dev } : null } }))
	}
	canvas.addEventListener('pointercancel', up)
	canvas.addEventListener('pointerleave', () => (hover = null))

	function showCursor(key, lane, x, y, name) { cursors.set(key, { lane, x, y, name, until: performance.now() + 700 }) }

	/* ───────── backdrop: painted once per resize ───────── */

	// a hand-drawn closed circle: radius wobbles a little, the same way every frame
	// dent: optional { a, depth, w } pushes the outline in (depth > 0) or out around angle a; that's the jelly
	function wobble(c, cx, cy, r, seed, amp = 0.8, dent = null) {
		const p = [(seed * 1.7) % TAU, (seed * 2.9) % TAU, (seed * 4.3) % TAU]
		c.beginPath()
		for (let k = 0; k <= 160; k++) {
			const a = (k / 160) * TAU
			let rr = r + amp * (Math.sin(a * 3 + p[0]) * 0.6 + Math.sin(a * 7 + p[1]) * 0.3 + Math.sin(a * 13 + p[2]) * 0.2)
			if (dent && dent.depth) rr -= dent.depth * dentAt(a, dent.a, dent.w)
			const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr
			k ? c.lineTo(x, y) : c.moveTo(x, y)
		}
		c.closePath()
	}

	function paintBackdrop(cv, G) {
		cv.frost = null
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

		// the landscape itself is painted in the heart's hand: see backdrop.js
		paintLandscape(cv, { W, H, DPR, hy, G, dial: { x: CX0, y: CY0, r: S0 * 0.475 } })
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
		const shape = opts.mode === 'dial' && focus.on && L.index === focus.lane ? 'sheet' : 'ring'
		try { L.instance.frame(lg, L.w, L.h, engine.iclock, shape) } catch (e) { if (!L.err) console.error(L.module.id, e); L.err = true }
		lg.restore()
	}

	// wrap a lane strip onto the annulus [r0, r1] as thin rotated slices
	function warp(L, r0, r1) {
		const N = moving ? 48 : opts.slices, sw = L.canvas.width / N, dw = ((r0 + r1) / 2) * (TAU / N) + 0.6
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
		const zTarget = focus.on ? 1 : 0
		if (zt !== zTarget) {
			zt = reduce ? zTarget : zTarget > zt ? Math.min(zTarget, zt + dt / Math.max(0.05, Z.inMs / 1000)) : Math.max(zTarget, zt - dt / Math.max(0.05, Z.outMs / 1000))
			applyZoom()
			if (!focus.on && sheetLane >= 0 && eSheet() === 0) { sheetLane = -1; sizeLanes() }
		}
		moving = zt > 0 && zt < 1
		for (const j of ringJelly) j.s.step(dt)
		for (const j of seatJelly) j.s.step(dt)

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
		if (opts.mode === 'dial' && eSheet() > 0) drawDevice(phase)
		drawCursors()
		drawHanding()
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

	// squiggles adrift in the sky, slow as weather; they keep clear of the dial. Sprites from backdrop.js, remade per ground.
	const drifters = Array.from({ length: 5 }, (_, k) => ({ u: (k * 0.23 + 0.07) % 1, v: 0.08 + ((k * 0.37) % 0.3), s: 0.6 + ((k * 0.61) % 0.8), sp: 0.4 + ((k * 0.29) % 0.6), rot: k * 1.3 }))
	let wisps = null, wispsFor = null
	function drawDrifters(t) {
		if (wispsFor !== G) { wisps = makeWisps(G); wispsFor = G }
		const T = reduce ? 0 : t / 1000
		g.imageSmoothingEnabled = false
		drifters.forEach((d, k) => {
			const x = ((d.u + T * 0.004 * d.sp) % 1.1) * (W + 60) - 30, y = d.v * H + Math.sin(T * 0.3 * d.sp + d.rot) * 8
			if (opts.mode === 'dial' && Math.hypot(x - CX, y - CY) < medallion() + 50) return
			if (x < 260 && y < 200) return // not over the title
			const set = wisps[k % wisps.length], im = set[Math.floor(T * 3 * d.sp + k) % set.length], z = 2 * (0.8 + d.s * 0.4)
			g.drawImage(im, Math.round(x - im.width * z), Math.round(y - (im.height * z) / 2), Math.round(im.width * z), Math.round(im.height * z))
		})
		g.imageSmoothingEnabled = true
	}


	// the sheet your instrument plays on in focus: paper, ink edge, flat shadow, beat ticks along the top
	const CHAMBER = '#1b1529', PALE = '#efe6f4'
	let filterOK = null
	function canFilter() {
		if (filterOK !== null) return filterOK
		try {
			const c = document.createElement('canvas'); c.width = c.height = 1
			const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 1, 1)
			const t = document.createElement('canvas'); t.width = t.height = 1
			const y = t.getContext('2d', { willReadFrequently: true }); y.filter = 'invert(1)'; y.drawImage(c, 0, 0)
			filterOK = y.getImageData(0, 0, 1, 1).data[0] > 200
		} catch { filterOK = false }
		return filterOK
	}
	function drawDevice(phase) {
		const e = eSheet(), { x, y, w, h } = dev, L = lanes[sheetLane]
		g.save()
		g.translate((1 - e) * slideDist(), 0) // slides in from the right edge, never translucent
		g.fillStyle = 'rgba(42,28,72,.5)'
		g.fillRect(x + 6, y + 8, w, h)
		// the sheet is the eye's chamber: a deep ink ground, the instrument drawn on it as scratchboard. The lane
		// canvas is drawn in ink for the paper rings, so here it goes through invert + half-turn hue: ink turns pale,
		// pigments keep their hue and come up bright. Browsers without canvas filters keep a paper sheet.
		const dark = canFilter()
		g.fillStyle = dark ? CHAMBER : PAPER
		g.fillRect(x, y, w, h)
		if (L && L.w === Math.round(w)) {
			const steps = engine.steps(), fg = dark ? (a) => rgba(PALE, a) : ink
			for (let s = 0; s < steps; s += 4) { g.fillStyle = s % 16 ? fg(0.07) : fg(0.18); g.fillRect(x + (s / steps) * w, y, 1, h) }
			if (dark) g.filter = 'invert(1) hue-rotate(180deg)'
			g.drawImage(L.canvas, x, y, w, h)
			g.filter = 'none'
			g.fillStyle = dark ? PALE : INK
			g.fillRect(x + phase * w, y - 5, 1.5, 10)
			g.fillRect(x + phase * w, y + h - 5, 1.5, 10)
		}
		g.strokeStyle = INK; g.lineWidth = 1.4
		g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
		g.restore()
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
		if (st.me) {
			g.fillStyle = 'rgba(40,25,60,.45)'; g.beginPath(); g.arc(x + 3, y + 4, r, 0, TAU); g.fill()
			// a slow dashed halo says: this one is yours, touch it to change instrument
			g.save()
			g.strokeStyle = INK; g.lineWidth = 1; g.setLineDash([3, 4]); g.lineDashOffset = reduce ? 0 : -performance.now() / 120
			wobble(g, x, y, r + 6, i * 7 + 3, 0.8); g.stroke()
			g.restore()
		}
		if (st.riff) {
			// a robot riffing on someone wears a thin ring in the giver's colour
			g.strokeStyle = st.riff.color; g.lineWidth = 2.4
			wobble(g, x, y, r + 5, i * 9 + 4, 0.7); g.stroke()
			g.strokeStyle = ink(0.55); g.lineWidth = 0.7
			wobble(g, x, y, r + 6.6, i * 9 + 4, 0.7); g.stroke()
		}
		const J = seatJelly[i]
		wobble(g, x, y, r, i * 5 + 2, 0.6, { a: J.a, depth: J.s.x * r * 0.4, w: 0.7 })
		g.fillStyle = st.name ? L.color : PAPER
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = st.me ? 2.4 : 1.1
		if (!st.name) g.setLineDash([2.5, 3])
		g.stroke()
		g.setLineDash([])
		g.font = serif(r * 1.05, 600, false)
		g.textAlign = 'center'; g.textBaseline = 'middle'
		g.fillStyle = st.name ? PAPER : ink(0.6)
		g.fillText(st.name ? (st.initial || st.name[0]).toUpperCase() : String(i + 1), x, y + 1)
		if (label && !small()) arcCaption(`${L.module.name.toLowerCase()} · ${st.label}`, Math.atan2(y - CY, x - CX), S * 0.505 + r + Math.max(10, S * 0.022), Math.max(11, S * 0.018), st.me)
	}

	// hand-set caption riding the outside of the dial's rim, centred on angle a. Upright on both halves:
	// on the top half letters run clockwise with their feet on the rim, on the bottom half anticlockwise.
	function arcCaption(text, a, R, px, strong) {
		g.save()
		// set like dial lettering: wide grotesque capitals, tracked out
		g.font = `${strong ? 700 : 600} ${Math.round(px)}px Syne, "Bricolage Grotesque", sans-serif`
		g.textAlign = 'center'; g.textBaseline = 'middle'
		const chars = [...text.toUpperCase()]
		const ws = chars.map((ch) => g.measureText(ch).width + px * 0.16)
		const total = ws.reduce((x, y) => x + y, 0)
		const bottom = Math.sin(a) > 0, dir = bottom ? -1 : 1
		let t = a - (dir * total) / R / 2
		const col = G.dark ? G.paper : INK
		// a soft halo in the sky colour keeps it legible over hills and crescents
		g.lineJoin = 'round'
		g.lineWidth = Math.max(2.5, px * 0.28)
		g.strokeStyle = rgba(G.sky[G.dark ? 0 : 2], 0.85)
		for (const pass of ['stroke', 'fill']) {
			let u = t
			for (let k = 0; k < ws.length; k++) {
				const mid = u + (dir * ws[k]) / R / 2
				g.save()
				g.translate(CX + Math.cos(mid) * R, CY + Math.sin(mid) * R)
				g.rotate(mid + (bottom ? -Math.PI / 2 : Math.PI / 2))
				if (pass === 'stroke') g.strokeText(chars[k], 0, 0)
				else { g.fillStyle = col; g.fillText(chars[k], 0, 0) }
				g.restore()
				u += (dir * ws[k]) / R
			}
		}
		g.restore()
	}


	// a blurred copy of a backdrop: shrink it twice and let smoothing do the blur on the way back up. Cached until repaint.
	function frost(cv) {
		if (cv.frost) return cv.frost
		const a = document.createElement('canvas'), b = document.createElement('canvas')
		a.width = Math.max(1, Math.round(W / 6)); a.height = Math.max(1, Math.round(H / 6))
		b.width = Math.max(1, Math.round(W / 28)); b.height = Math.max(1, Math.round(H / 28))
		a.getContext('2d').drawImage(cv, 0, 0, a.width, a.height)
		b.getContext('2d').drawImage(a, 0, 0, b.width, b.height)
		return (cv.frost = b)
	}

	function drawDial(t, dt, phase, loop) {
		const outer = ringIn(lanes.length - 1) + ringT() + 8, inner = ringIn(0) - 6, M = medallion()

		// the medallion: frosted paper in the ground's own tint. Mostly opaque; the land behind survives only as
		// soft colour (a heavily blurred copy of the backdrop), never as a line crossing the rings.
		g.fillStyle = 'rgba(30,20,60,.35)'
		g.beginPath(); g.arc(CX + S * 0.012, CY + S * 0.016, M, 0, TAU); g.fill()
		g.save()
		wobble(g, CX, CY, M, 1, 1.2); g.clip()
		g.drawImage(frost(bg), 0, 0, W, H)
		g.fillStyle = rgba(mixHex(PAPER, G.sky[1], 0.16), 0.84)
		g.fillRect(CX - M - 4, CY - M - 4, M * 2 + 8, M * 2 + 8)
		g.restore()
		wobble(g, CX, CY, M, 1, 1.2)
		g.strokeStyle = ink(0.75); g.lineWidth = 1.2; g.stroke()
		g.lineWidth = 0.5; g.strokeStyle = ink(0.22)
		wobble(g, CX, CY, M - 5, 2, 1); g.stroke()
		// four rivets at the quarters, nothing more
		g.fillStyle = ink(0.45)
		for (let k = 0; k < 4; k++) {
			const [x, y] = polar(angOf(k / 4 + 1 / 8), M - S * 0.012)
			g.beginPath(); g.arc(x, y, Math.max(1.2, S * 0.0024), 0, TAU); g.fill()
		}

		// shadow wedge trailing the hand, like the flat shadow planes on a dusk field
		const pa = angOf(phase)
		g.fillStyle = 'rgba(90,63,142,.05)'
		g.beginPath(); g.arc(CX, CY, outer, pa - 0.9, pa); g.arc(CX, CY, inner, pa, pa - 0.9, true); g.closePath(); g.fill()

		// beat and bar marks: hairlines, bars a touch longer. Numbers are left to the ear.
		const beats = loop ? loop.bars * loop.beatsPerBar : 8, bpb = loop?.beatsPerBar || 4
		g.lineWidth = 0.5
		for (let b = 0; b < beats; b++) {
			const a = angOf(b / beats), bar = b % bpb === 0
			const [x1, y1] = polar(a, inner), [x2, y2] = polar(a, outer + (bar ? 5 : 0))
			g.strokeStyle = bar ? ink(0.16) : ink(0.05)
			g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
		}
		// 16th ticks on the outer rim, only the beats get a mark you'd notice
		const steps = engine.steps()
		g.lineWidth = 0.5
		for (let s = 0; s < steps; s++) {
			const a = angOf(s / steps), [x1, y1] = polar(a, outer - 1), [x2, y2] = polar(a, outer + (s % 4 ? 1.5 : 3.5))
			g.strokeStyle = ink(s % 4 ? 0.12 : 0.3)
			g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
		}

		lanes.forEach((L, i) => {
			const r0 = ringIn(i), r1 = r0 + ringT(), own = canDraw(i)
			g.beginPath(); g.arc(CX, CY, r1, 0, TAU); g.arc(CX, CY, r0, 0, TAU, true)
			g.fillStyle = rgba(L.color, own ? 0.13 : 0.05); g.fill()
			if (own) { g.fillStyle = hatch(L.color, 0.3); g.fill() }
			g.strokeStyle = ink(own ? 0.75 : 0.2)
			g.lineWidth = own ? 1.1 : 0.6
			// pressed: the band pinches where you press, outer edge in, inner edge out
			const J = ringJelly[i], depth = J.s.x * ringT() * 0.28
			wobble(g, CX, CY, r0, i * 3 + 11, own ? 0.9 : 0.6, { a: J.a, depth: -depth * 0.6, w: 0.3 }); g.stroke()
			wobble(g, CX, CY, r1, i * 3 + 12, own ? 0.9 : 0.6, { a: J.a, depth, w: 0.32 }); g.stroke()
			if (own && hover && hover.lane === i && !drag) {
				const a0 = angOf(Math.floor(hover.x * steps) / steps), a1 = angOf((Math.floor(hover.x * steps) + 1) / steps)
				g.fillStyle = rgba(L.color, 0.28)
				g.beginPath(); g.arc(CX, CY, r1, a0, a1); g.arc(CX, CY, r0, a1, a0, true); g.fill()
			}
			warp(L, r0, r1)
			if (small()) return
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
		g.strokeStyle = ink(0.15); g.lineWidth = 0.5
		wobble(g, CX, CY, porthole() - 4, 22, 0.6); g.stroke()

		lanes.forEach((L, i) => drawSeat(i, ...seatPos(i), true))
	}

	// the thread you pull from your badge while handing your part over; robots that can take it ring dashed
	function drawHanding() {
		if (!handing?.moved) return
		const L = lanes[handing.from], [sx, sy] = seatPos(handing.from), r = seatR()
		const over = seatUnder(handing.x, handing.y)
		lanes.forEach((_, j) => {
			if (!canHand?.(handing.from, j)) return
			const [x, y] = seatPos(j)
			g.strokeStyle = over === j ? INK : ink(0.6)
			g.lineWidth = over === j ? 1.8 : 1
			g.setLineDash(over === j ? [] : [3, 4])
			g.lineDashOffset = reduce ? 0 : performance.now() / 90
			wobble(g, x, y, r + 9, j * 11 + 5, 0.8); g.stroke()
			g.setLineDash([])
		})
		// a slack ink thread that tightens as you pull
		const dx = handing.x - sx, dy = handing.y - sy, d = Math.hypot(dx, dy)
		const sag = Math.max(0, 40 - d * 0.12)
		g.strokeStyle = INK; g.lineWidth = 1.3; g.lineCap = 'round'
		g.beginPath(); g.moveTo(sx, sy)
		g.quadraticCurveTo(sx + dx / 2, sy + dy / 2 + sag, handing.x, handing.y)
		g.stroke()
		// your colour, as a small paper token on the end of the thread
		g.fillStyle = L.color
		g.beginPath(); g.arc(handing.x, handing.y, r * 0.45, 0, TAU); g.fill()
		g.strokeStyle = INK; g.lineWidth = 1.2; g.stroke()
	}

	function drawCursors() {
		const now = performance.now()
		for (const [key, c] of cursors) {
			if (c.until < now) { cursors.delete(key); continue }
			const L = lanes[c.lane]
			if (!L) continue
			let x, y
			if (opts.mode === 'dial' && focus.on && c.lane === focus.lane) { x = dev.x + c.x * dev.w; y = dev.y + c.y * dev.h }
			else if (opts.mode === 'dial') [x, y] = polar(angOf(c.x), ringIn(c.lane) + (1 - c.y) * ringT())
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
	document.fonts?.load(serif(16)).then(() => document.fonts.load(serif(16, 600, false))).then(() => document.fonts.load('600 16px Syne')).catch(() => {})

	addEventListener('resize', resize)
	resize()
	applyCss()
	requestAnimationFrame(frame)

	return {
		opts,
		showCursor,
		setMode(m) { opts.mode = m; if (m !== 'dial') setFocus(-1); sizeLanes() },
		repaint: () => paintBackdrop(bg, G),
		setGround,
		setFocus,
		// true while zooming in or out; a cue for anything expensive to rest for half a second
		get moving() { return moving },
		// how far the sheet is still off to the right, in px (0 when it has arrived); DOM chrome on the sheet rides with it
		get sheetShift() { return sheetLane < 0 ? Infinity : (1 - eBar()) * slideDist() },
		// zoom tuning (debug panel): the live knobs, their defaults, and a hook to apply a change
		zoom: Z, zoomDefaults: ZOOM_DEFAULTS, easeNames: [...Object.keys(EASES), 'custom'],
		zoomChanged() { bezierCache.clear(); applyZoom(); try { localStorage.setItem('roughjam.zoom', JSON.stringify(Z)) } catch {} },
		get focus() { return { ...focus, dev: focus.on ? { ...dev } : null } },
		// current ground colours ({ paper, dark, sky, ... }); a 'ground' event fires on window when it changes
		ground: () => ({ ...(G2 || G) }),
		// the bare disc inside the innermost ring, CSS px; null in strips mode
		heat: () => heat,
		// a seat badge on screen, CSS px
		seatAt: (i) => { const [x, y] = seatPos(i); return { x, y, r: seatR() } },
		center: () => (opts.mode === 'dial' ? { x: CX, y: CY, r: ringIn(0), ground: PAPER } : null),
		resize,
	}
}
