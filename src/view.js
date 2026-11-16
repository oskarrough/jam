// Draws the machine (or plain strips); pointer input becomes seat-local {x, y}.
// Each seat renders offscreen; the dial view wraps it round a ring.

import { rgba, playhead } from './instruments/lib/util.js'
import { INK, SERIF, GROUNDS } from './palette.js'
import { spring, dentAt } from './jelly.js'
import { paintLandscape, makeWisps } from './backdrop.js'
import { registry } from './instruments/index.js'

const TAU = Math.PI * 2
const BROOM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="96" height="96" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M23 3l-4.6 10.4"/><path d="M14.5 11.6l8.6 3.6"/><path d="M14.5 11.6C11 15 8 19.5 6.3 24.5c4.6 2.4 10.4 3.7 15.4 3.7 1.2-4.6 1.5-9 1.4-13"/><path d="M17.3 12.8l-5.2 13.4M20.3 14l-2.3 13.8"/><circle fill="${INK}" cx="26" cy="28" r=".9"/><circle fill="${INK}" cx="28.6" cy="25.6" r=".7"/></svg>`
const VERMILION = '#d64a28'
const ORDER = ['flamingo', 'nortel', 'vallotton', 'sand']
const mixHex = (a, b, t) =>
	'#' +
	[0, 2, 4]
		.map((i) =>
			Math.round(parseInt(a.substr(1 + i, 2), 16) * (1 - t) + parseInt(b.substr(1 + i, 2), 16) * t)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')
const ink = (a) => rgba(INK, a)
const serif = (px, w = 400, italic = true) =>
	`${italic ? 'italic ' : ''}${w} ${Math.round(px)}px ${SERIF}`

// deterministic noise so the landscape and the wobble of the rings stay put across frames and resizes
function rng(seed) {
	let s = seed >>> 0 || 1
	return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

export function createView(
	canvas,
	engine,
	{ occupant, canDraw, onSit, onPointer, onHand, canHand, onWipe, onMute, onSolo },
) {
	const g = canvas.getContext('2d')
	const { seats, transport } = engine
	const { clock } = transport
	const opts = { mode: 'dial', slices: 192, landscape: true, ground: 'vallotton', cycleLoops: 4 }
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
	let W, H, S, CX, CY, DPR
	// zoom: the overview geometry (S0, CX0, CY0), the focus geometry (SF, CXF, CYF, sheet) and zt easing between them.
	let S0,
		CX0,
		CY0,
		SF,
		CXF,
		CYF,
		sheet = null,
		zt = 0,
		moving = false
	const focus = { on: false, seat: -1 }
	let bg = document.createElement('canvas'),
		bg2 = document.createElement('canvas')
	// ground state: current G, and while cycling an incoming one fading in
	let G = GROUNDS.vallotton,
		G2 = null,
		fade = 0,
		PAPER = G.paper,
		lastLoopN = -1
	const cursors = new Map() // key -> {seat, x, y, name, until}
	//  - trails: every pen stroke (yours and everyone's) stays on its ring as thin ink, fading out over one loop
	//  - ghosts: when a ring changed during the loop, what it held before lingers faintly through the next one
	const trails = new Map() // key -> [{seat, pts: [{x, y, t}]}]
	let lastPhase = 0,
		loopMs = 5000
	let heat = 0,
		lastT = performance.now(),
		lastBeat = -1,
		hover = null,
		drag = null
	// handing your part to a robot: press your own badge, drag the thread onto theirs
	let handing = null // a press on a badge: {from, id, x, y, x0, y0, moved, own, long, timer}
	let lastTap = null
	const LONG_MS = 550,
		DOUBLE_MS = 300
	const seatUnder = (px, py) =>
		seats.findIndex((_, i) => {
			const [x, y] = seatPos(i)
			return Math.hypot(px - x, py - y) < seatR() + 6
		})
	const ringJelly = seats.map(() => ({ s: spring({ k: 420, c: 9 }), a: 0 }))
	const seatJelly = seats.map(() => ({ s: spring({ k: 700, c: 10 }), a: 0 }))
	const press = (j, a) => {
		j.a = a
		j.s.target = 1
	}
	const release = (j) => {
		if (j.s.target) {
			j.s.target = 0
			j.s.v -= 3
		}
	}

	function resize() {
		DPR = Math.min(2, devicePixelRatio || 1)
		W = innerWidth
		H = innerHeight
		canvas.width = W * DPR
		canvas.height = H * DPR
		const narrow = W < 640,
			top = narrow ? 44 : 24,
			bottom = narrow ? 96 : 84,
			STRIP = narrow ? 112 : 58 // the strip wraps to two rows on a phone
		S0 = Math.max(240, Math.min(W - 24, H - top - bottom))
		CX0 = W / 2
		CY0 = top + (H - top - bottom) / 2
		if (narrow) {
			SF = Math.min(180, W * 0.46)
			CXF = 8 + SF / 2
			CYF = H - bottom - SF / 2 + 6
			sheet = { x: 12, y: 8 + STRIP, w: W - 24, h: Math.max(160, H - bottom - SF - STRIP - 16) }
		} else {
			SF = Math.max(220, Math.min(W * 0.34, H - bottom - 120, 520))
			CXF = 20 + SF / 2
			CYF = H - bottom - SF / 2 - 4
			const x = CXF + SF / 2 + 28
			sheet = { x, y: 12 + STRIP, w: W - x - 24, h: H - 12 - STRIP - bottom - 16 }
		}
		applyZoom()
		sizeSeats()
		if (focus.on)
			dispatchEvent(
				new CustomEvent('zoom', { detail: { on: true, seat: focus.seat, sheet: { ...sheet } } }),
			)
		paintBackdrop(bg, G)
		if (G2) paintBackdrop(bg2, G2)
	}

	const ZOOM_DEFAULTS = {
		inMs: 550,
		outMs: 550,
		machineEnd: 0.6,
		outMachineEnd: 1,
		sheetStart: 0.27,
		machineEase: 'smooth',
		sheetEase: 'smooth',
		machineBezier: '0.4, 0, 0.2, 1',
		sheetBezier: '0.2, 0.8, 0.3, 1',
		slide: 1,
		slidePad: 24,
		scale: 1,
		dx: 0,
		dy: 0,
		barLag: 0,
	}
	const Z = { ...ZOOM_DEFAULTS }
	try {
		Object.assign(Z, JSON.parse(localStorage.getItem('roughjam.zoom') || '{}'))
	} catch {}
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
		const f = [x1, y1, x2, y2].some((v) => !Number.isFinite(v))
			? EASES.smooth
			: (t) => {
					let u = t
					for (let i = 0; i < 8; i++) {
						const d = dB(x1, x2, u)
						if (Math.abs(d) < 1e-6) break
						u = Math.max(0, Math.min(1, u - (B(x1, x2, u) - t) / d))
					}
					return B(y1, y2, u)
				}
		bezierCache.set(str, f)
		return f
	}
	const easeOf = (name, bz) => (name === 'custom' ? bezier(bz) : EASES[name] || EASES.smooth)
	const clamp01 = (t) => Math.max(0, Math.min(1, t))
	// on the way in the machine moves first (done at machineEnd); on the way out it starts at once, alongside the sheet
	const eMachine = () =>
		easeOf(
			Z.machineEase,
			Z.machineBezier,
		)(clamp01(zt / Math.max(0.01, focus.on ? Z.machineEnd : Z.outMachineEnd)))
	const sheetP = () => clamp01((zt - Z.sheetStart) / Math.max(0.01, 1 - Z.sheetStart))
	const eSheet = () => easeOf(Z.sheetEase, Z.sheetBezier)(sheetP())
	const eBar = () =>
		easeOf(
			Z.sheetEase,
			Z.sheetBezier,
		)(clamp01((sheetP() - Z.barLag) / Math.max(0.01, 1 - Z.barLag)))
	const slideDist = () => (W - sheet.x + Z.slidePad) * Z.slide
	let sheetSeat = -1 // the seat whose canvas is sized to the sheet (lags focus on the way out)
	function applyZoom() {
		const e = eMachine()
		S = S0 + (SF * Z.scale - S0) * e
		CX = CX0 + (CXF + Z.dx - CX0) * e
		CY = CY0 + (CYF + Z.dy - CY0) * e
	}
	const small = () => S < 330

	// Under a second, so it plays for everyone, reduced motion or not; automated browsers get the settled machine.
	// Times are ms from the first frame once the fonts are in (or capMs, whichever comes first).
	const INTRO_DEFAULTS = {
		capMs: 350,
		land: 60,
		landMs: 220,
		dial: 140,
		dialMs: 260,
		rings: 230,
		ringMs: 220,
		ringGap: 55,
		seatMs: 220,
		menu: 620,
		menuGap: 25,
		hand: 700,
		handMs: 240,
	}
	const INTRO = { ...INTRO_DEFAULTS }
	try {
		Object.assign(INTRO, JSON.parse(localStorage.getItem('roughjam.intro') || '{}'))
	} catch {}
	let introT0 = navigator.webdriver ? -1e9 : null,
		seatsAt = [],
		introNow = 0,
		firstT = null,
		fontsIn = false,
		menuUp = false
	const ip = (at, ms) =>
		introT0 === null ? 0 : clamp01((introNow - introT0 - at) / Math.max(1, ms))
	function introTick(t) {
		introNow = t
		firstT ??= t
		if (introT0 === null && (fontsIn || t - firstT > INTRO.capMs)) introT0 = t
		if (!menuUp && introT0 !== null && t - introT0 >= INTRO.menu) {
			menuUp = true
			document
				.querySelectorAll('.deck li')
				.forEach(
					(li, k) => (li.style.transitionDelay = introT0 < 0 ? '' : k * INTRO.menuGap + 'ms'),
				)
			document.body.classList.remove('intro')
		}
	}
	function around(x, y, k, fn) {
		if (k === 1) return fn()
		g.save()
		g.translate(x, y)
		g.scale(k, k)
		g.translate(-x, -y)
		fn()
		g.restore()
	}

	const n = () => seats.length
	const band = () => (S * 0.26) / n()
	const ringIn = (i) => S * 0.16 + i * band()
	const ringT = () => band() * 0.82
	const porthole = () => ringIn(0) - S * 0.014
	const medallion = () => S * 0.475
	const stripRect = (i) => {
		const top = W < 640 ? 160 : 90,
			bottom = W < 640 ? 110 : 100
		const h = Math.min(120, (H - top - bottom) / n() - 10)
		const x = Math.max(16, (W - 1100) / 2),
			w = W - 2 * x
		return { x, y: top + i * (h + 10), w, h }
	}

	function sizeSeats() {
		seats.forEach((L, i) => {
			let w, h
			// rings are sized at overview scale; warp() scales them down when the dial shrinks
			const b0 = (S0 * 0.26) / n()
			if (opts.mode === 'dial' && i === sheetSeat) ({ w, h } = sheet)
			else if (opts.mode === 'dial') {
				w = TAU * (S0 * 0.16 + i * b0 + (b0 * 0.82) / 2)
				h = b0 * 0.82
			} else ({ w, h } = stripRect(i))
			L.w = Math.round(w)
			L.h = Math.round(h)
			L.canvas.width = Math.max(1, L.w * DPR)
			L.canvas.height = Math.max(1, L.h * DPR)
		})
	}

	const angOf = (phase) => -Math.PI / 2 + phase * TAU
	const polar = (a, r) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r]
	const seatAngles = () => seats.map((_, i) => Math.PI * 0.75 - (i * TAU) / seats.length)
	const seatPos = (i) =>
		opts.mode === 'dial'
			? polar(seatAngles()[i], S * 0.505)
			: [stripRect(i).x - 2, stripRect(i).y + 16]
	const seatR = () => Math.max(12, S * 0.028)
	// a point on the badges' rim, k badge-widths round from seat i (positive is clockwise)
	const rimFrom = (i, k) => polar(seatAngles()[i] + (k * seatR() * 2.3) / (S * 0.505), S * 0.505)
	const wipeAt = () => {
		const i = seats.findIndex((_, j) => canDraw(j))
		return i < 0 || focus.on || zt > 0 || opts.mode !== 'dial'
			? null
			: { i, xy: rimFrom(i, 1), r: seatR() * 0.72 }
	}
	const wipeJelly = { s: spring({ k: 700, c: 10 }), a: 0 }

	// screen -> seat hit: {seat, x, y} in the seat's 0..1 space
	function hit(px, py, only = null) {
		if (opts.mode === 'dial') {
			const dx = px - CX,
				dy = py - CY,
				r = Math.hypot(dx, dy)
			const x = ((((Math.atan2(dy, dx) + Math.PI / 2) / TAU) % 1) + 1) % 1
			for (let i = 0; i < seats.length; i++) {
				if (only !== null && i !== only) continue
				const a = ringIn(i),
					b = a + ringT(),
					pad = only !== null ? 1e9 : 4
				if (r >= a - pad && r <= b + pad)
					return { seat: i, x, y: Math.max(0, Math.min(1, 1 - (r - a) / ringT())) }
			}
		} else {
			for (let i = 0; i < seats.length; i++) {
				if (only !== null && i !== only) continue
				const R = stripRect(i),
					pad = only !== null ? 1e9 : 0
				if (py >= R.y - pad && py <= R.y + R.h + pad)
					return {
						seat: i,
						x: Math.max(0, Math.min(0.9999, (px - R.x) / R.w)),
						y: Math.max(0, Math.min(1, (py - R.y) / R.h)),
					}
			}
		}
		return null
	}

	canvas.addEventListener('contextmenu', (e) => e.preventDefault())
	const inSheet = (x, y) =>
		focus.on &&
		sheet &&
		x >= sheet.x &&
		x <= sheet.x + sheet.w &&
		y >= sheet.y &&
		y <= sheet.y + sheet.h
	const sheetXY = (x, y) => ({
		x: Math.max(0, Math.min(0.9999, (x - sheet.x) / sheet.w)),
		y: Math.max(0, Math.min(1, (y - sheet.y) / sheet.h)),
	})
	canvas.addEventListener('pointerdown', (e) => {
		if (inSheet(e.clientX, e.clientY) && canDraw(focus.seat)) {
			canvas.setPointerCapture(e.pointerId)
			drag = { seat: focus.seat, id: e.pointerId, alt: e.shiftKey, button: e.button, sheet: true }
			return onPointer(focus.seat, {
				type: 'down',
				...sheetXY(e.clientX, e.clientY),
				id: e.pointerId,
				alt: drag.alt,
				button: e.button,
			})
		}
		const w = wipeAt()
		if (w && onWipe && Math.hypot(e.clientX - w.xy[0], e.clientY - w.xy[1]) < w.r + 5) {
			press(wipeJelly, Math.atan2(e.clientY - w.xy[1], e.clientX - w.xy[0]))
			setTimeout(() => release(wipeJelly), 110)
			return onWipe()
		}
		for (let i = 0; i < seats.length; i++) {
			const [x, y] = seatPos(i)
			if (Math.hypot(e.clientX - x, e.clientY - y) < seatR() + 6) {
				press(seatJelly[i], Math.atan2(e.clientY - y, e.clientX - x))
				// a badge waits for release: a tap sits or zooms, a double tap solos, a long press mutes,
				// and dragging your own hands your part to a robot
				canvas.setPointerCapture(e.pointerId)
				const h = (handing = {
					from: i,
					id: e.pointerId,
					x: e.clientX,
					y: e.clientY,
					x0: e.clientX,
					y0: e.clientY,
					moved: false,
					own: !!onHand && occupant(i).me,
				})
				h.timer = setTimeout(() => {
					if (handing === h && !h.moved) {
						h.long = true
						release(seatJelly[i])
						onMute?.(i)
					}
				}, LONG_MS)
				return
			}
		}
		if (focus.on) {
			if (!inSheet(e.clientX, e.clientY)) setFocus(-1)
			return
		}
		const h = hit(e.clientX, e.clientY)
		if (h && opts.mode === 'dial') {
			press(ringJelly[h.seat], Math.atan2(e.clientY - CY, e.clientX - CX))
			if (!canDraw(h.seat)) setTimeout(() => release(ringJelly[h.seat]), 120)
		}
		if (!h || !canDraw(h.seat)) return
		canvas.setPointerCapture(e.pointerId)
		drag = { seat: h.seat, id: e.pointerId, alt: e.shiftKey, button: e.button }
		onPointer(h.seat, {
			type: 'down',
			x: h.x,
			y: h.y,
			id: e.pointerId,
			alt: drag.alt,
			button: e.button,
		})
	})
	canvas.addEventListener('pointermove', (e) => {
		hover = focus.on ? null : hit(e.clientX, e.clientY)
		const onSeat = seats.some((_, i) => {
			const [x, y] = seatPos(i)
			return Math.hypot(e.clientX - x, e.clientY - y) < seatR() + 6
		})
		const onDial = focus.on && Math.hypot(e.clientX - CX, e.clientY - CY) < medallion()
		const w = wipeAt(),
			onWipeTok = w && Math.hypot(e.clientX - w.xy[0], e.clientY - w.xy[1]) < w.r + 5
		canvas.style.cursor =
			onSeat || onDial || onWipeTok || (focus.on && !inSheet(e.clientX, e.clientY))
				? 'pointer'
				: inSheet(e.clientX, e.clientY) || (hover && canDraw(hover.seat))
					? ''
					: 'default'
		if (handing && e.pointerId === handing.id) {
			handing.x = e.clientX
			handing.y = e.clientY
			if (Math.hypot(handing.x - handing.x0, handing.y - handing.y0) > 8) handing.moved = true
			if (handing.moved) canvas.style.cursor = 'grabbing'
			return
		}
		if (!drag || e.pointerId !== drag.id) return
		if (drag.sheet)
			return onPointer(drag.seat, {
				type: 'move',
				...sheetXY(e.clientX, e.clientY),
				id: e.pointerId,
				alt: drag.alt,
				button: drag.button,
			})
		const h = hit(e.clientX, e.clientY, drag.seat)
		ringJelly[drag.seat].a = Math.atan2(e.clientY - CY, e.clientX - CX)
		onPointer(drag.seat, {
			type: 'move',
			x: h.x,
			y: h.y,
			id: e.pointerId,
			alt: drag.alt,
			button: drag.button,
		})
	})
	const up = (e) => {
		if (handing && e.pointerId === handing.id) {
			const { from, moved, own, long, timer } = handing
			handing = null
			clearTimeout(timer)
			release(seatJelly[from])
			if (e.type === 'pointercancel' || long) return
			if (!moved || !own) {
				// a tap acts at once. A second tap on the same badge soon after makes it a double tap: solo.
				// Whatever the first tap did, the second puts back: zoom in or out again, or return to your old seat.
				if (lastTap && lastTap.i === from && performance.now() - lastTap.t < DOUBLE_MS) {
					const { own, prev } = lastTap
					lastTap = null
					if (own) onSit(from)
					else if (prev >= 0 && occupant(from).me) onSit(prev)
					return onSolo?.(from)
				}
				lastTap = {
					i: from,
					t: performance.now(),
					own: occupant(from).me,
					prev: seats.findIndex((_, j) => occupant(j).me),
				}
				onSit(from)
				return
			}
			const to = seatUnder(e.clientX, e.clientY)
			if (to >= 0 && canHand?.(from, to)) {
				press(seatJelly[to], Math.atan2(e.clientY - seatPos(to)[1], e.clientX - seatPos(to)[0]))
				setTimeout(() => release(seatJelly[to]), 160)
				if (onHand(from, to) !== false) handHintDone()
			}
			return
		}
		if (!drag || e.pointerId !== drag.id) return
		const h = drag.sheet ? sheetXY(e.clientX, e.clientY) : hit(e.clientX, e.clientY, drag.seat)
		onPointer(drag.seat, {
			type: 'up',
			x: h.x,
			y: h.y,
			id: e.pointerId,
			alt: drag.alt,
			button: drag.button,
		})
		release(ringJelly[drag.seat])
		drag = null
	}
	canvas.addEventListener('pointerup', up)
	canvas.addEventListener('pointercancel', (e) => {
		if (handing && e.pointerId === handing.id) up(e)
	})

	function setFocus(i) {
		if (drag) return
		const on = i >= 0 && opts.mode === 'dial'
		if (on === focus.on && i === focus.seat) return
		focus.on = on
		focus.seat = on ? i : -1
		if (on) {
			sheetSeat = i
			sizeSeats()
			opened()
		} // on the way out the sheet keeps its drawing until it has slid away
		hover = null
		dispatchEvent(
			new CustomEvent('zoom', {
				detail: { on, seat: focus.seat, sheet: on ? { ...sheet } : null },
			}),
		)
	}
	canvas.addEventListener('pointercancel', up)
	canvas.addEventListener('pointerleave', () => (hover = null))

	function showCursor(key, seat, x, y, name) {
		const now = performance.now()
		cursors.set(key, { seat, x, y, name, until: now + 700 })
		let segs = trails.get(key)
		if (!segs) trails.set(key, (segs = []))
		let seg = segs[segs.length - 1]
		const last = seg?.pts[seg.pts.length - 1]
		if (!seg || seg.seat !== seat || now - last.t > 250 || Math.abs(x - last.x) > 0.5)
			segs.push((seg = { seat, pts: [] }))
		if (!last || seg.pts.length === 0 || Math.hypot(x - last.x, y - last.y) > 0.002)
			seg.pts.push({ x, y, t: now })
		if (seg.pts.length > 800) seg.pts.splice(0, 200)
	}
	function seatPoint(seat, x, y) {
		if (opts.mode === 'dial' && focus.on && seat === focus.seat && eSheet() >= 1)
			return [sheet.x + x * sheet.w, sheet.y + y * sheet.h]
		if (opts.mode === 'dial') return polar(angOf(x), ringIn(seat) + (1 - y) * ringT())
		const R = stripRect(seat)
		return [R.x + x * R.w, R.y + y * R.h]
	}
	function drawTrails() {
		const now = performance.now(),
			life = loopMs
		g.lineCap = 'round'
		g.lineJoin = 'round'
		for (const [key, segs] of trails) {
			for (let k = segs.length - 1; k >= 0; k--) {
				const seg = segs[k]
				while (seg.pts.length && now - seg.pts[0].t > life) seg.pts.shift()
				if (seg.pts.length < 2) {
					if (!seg.pts.length || now - seg.pts[0].t > life) segs.splice(k, 1)
					continue
				}
				const L = seats[seg.seat]
				if (!L) continue
				const onSheet = opts.mode === 'dial' && focus.on && seg.seat === focus.seat && eSheet() >= 1
				g.strokeStyle = onSheet ? rgba('#efe6f4', 1) : L.color
				g.lineWidth = onSheet ? 1.6 : 1.1
				// draw in short runs so each run can fade by its own age
				for (let i = 1; i < seg.pts.length; i++) {
					const a = seg.pts[i - 1],
						b = seg.pts[i],
						age = (now - b.t) / life
					g.globalAlpha = 0.55 * (1 - age) ** 1.5
					const n = onSheet ? 1 : Math.max(1, Math.ceil(Math.abs(b.x - a.x) / 0.008))
					g.beginPath()
					g.moveTo(...seatPoint(seg.seat, a.x, a.y))
					for (let j = 1; j <= n; j++)
						g.lineTo(
							...seatPoint(seg.seat, a.x + ((b.x - a.x) * j) / n, a.y + ((b.y - a.y) * j) / n),
						)
					g.stroke()
				}
			}
			if (!segs.length) trails.delete(key)
		}
		g.globalAlpha = 1
	}
	const sigOf = (L) => {
		try {
			return L.module.id + JSON.stringify(L.instance?.state ?? null)
		} catch {
			return L.module.id + Math.random()
		}
	}
	function loopTurned() {
		for (const L of seats) {
			if (!L.canvas) continue
			const sig = sigOf(L)
			L.ghost =
				L.snap &&
				L.snapSig !== sig &&
				L.snap.width === L.canvas.width &&
				L.snap.height === L.canvas.height
					? L.snap
					: null
			const c = L.ghost === L.snap || !L.snap ? document.createElement('canvas') : L.snap
			c.width = L.canvas.width
			c.height = L.canvas.height
			const x = c.getContext('2d')
			x.clearRect(0, 0, c.width, c.height)
			x.drawImage(L.canvas, 0, 0)
			L.snap = c
			L.snapSig = sig
		}
	}

	// dent: optional { a, depth, w } pushes the outline in (depth > 0) or out around angle a; that's the jelly
	function wobble(c, cx, cy, r, seed, amp = 0.8, dent = null) {
		const p = [(seed * 1.7) % TAU, (seed * 2.9) % TAU, (seed * 4.3) % TAU]
		c.beginPath()
		for (let k = 0; k <= 160; k++) {
			const a = (k / 160) * TAU
			let rr =
				r +
				amp *
					(Math.sin(a * 3 + p[0]) * 0.6 +
						Math.sin(a * 7 + p[1]) * 0.3 +
						Math.sin(a * 13 + p[2]) * 0.2)
			if (dent && dent.depth) rr -= dent.depth * dentAt(a, dent.a, dent.w)
			const x = cx + Math.cos(a) * rr,
				y = cy + Math.sin(a) * rr
			k ? c.lineTo(x, y) : c.moveTo(x, y)
		}
		c.closePath()
	}

	function paintBackdrop(cv, G) {
		cv.frost = null
		cv.width = W * DPR
		cv.height = H * DPR
		const c = cv.getContext('2d')
		c.setTransform(DPR, 0, 0, DPR, 0, 0)
		const hy = Math.round(Math.max(H * 0.5, Math.min(H * 0.68, CY + S * 0.06)))

		const sk = c.createLinearGradient(0, 0, 0, hy)
		sk.addColorStop(0, G.sky[0])
		sk.addColorStop(0.75, G.sky[1])
		sk.addColorStop(1, G.sky[2])
		c.fillStyle = sk
		c.fillRect(0, 0, W, H)
		if (!opts.landscape) {
			c.fillStyle = G.paper
			c.fillRect(0, 0, W, H)
			paintGrain(c)
			return
		}

		paintLandscape(cv, { W, H, DPR, hy, G, dial: { x: CX0, y: CY0, r: S0 * 0.475 } })
	}

	function paintGrain(c) {
		const t = document.createElement('canvas')
		t.width = t.height = 160
		const tg = t.getContext('2d'),
			R = rng(3)
		for (let k = 0; k < 1400; k++) {
			tg.fillStyle = R() < 0.5 ? 'rgba(40,25,10,.09)' : 'rgba(255,250,235,.10)'
			tg.fillRect(R() * 160, R() * 160, 1, 1 + R() * 1.5)
		}
		c.fillStyle = c.createPattern(t, 'repeat')
		c.fillRect(0, 0, W, H)
	}

	const hatches = new Map()
	function hatch(color, a = 0.35) {
		const key = color + a
		if (!hatches.has(key)) {
			const t = document.createElement('canvas')
			t.width = t.height = 7
			const tg = t.getContext('2d')
			tg.strokeStyle = rgba(color, a)
			tg.lineWidth = 1
			tg.beginPath()
			tg.moveTo(-1, 8)
			tg.lineTo(8, -1)
			tg.stroke()
			hatches.set(key, g.createPattern(t, 'repeat'))
		}
		return hatches.get(key)
	}

	function renderSeat(L) {
		const lg = L.g
		lg.setTransform(1, 0, 0, 1, 0, 0)
		lg.clearRect(0, 0, L.canvas.width, L.canvas.height)
		lg.setTransform(DPR, 0, 0, DPR, 0, 0)
		lg.save()
		const shape = opts.mode === 'dial' && focus.on && L.index === focus.seat ? 'sheet' : 'ring'
		try {
			L.instance.frame(lg, L.w, L.h, engine.iclock, shape)
		} catch (e) {
			if (!L.err) console.error(L.module.id, e)
			L.err = true
		}
		lg.restore()
	}

	function warp(L, r0, r1, src = L.canvas) {
		const N = moving ? 48 : opts.slices,
			sw = src.width / N,
			dw = ((r0 + r1) / 2) * (TAU / N) + 0.6
		for (let k = 0; k < N; k++) {
			const th = angOf((k + 0.5) / N) + Math.PI / 2,
				c = Math.cos(th),
				s = Math.sin(th)
			g.setTransform(DPR * c, DPR * s, -DPR * s, DPR * c, DPR * CX, DPR * CY)
			g.drawImage(src, k * sw, 0, sw, src.height, -dw / 2, -r1, dw, r1 - r0)
		}
		g.setTransform(DPR, 0, 0, DPR, 0, 0)
	}

	function frame(t) {
		const dt = Math.min(0.05, (t - lastT) / 1000)
		lastT = t
		introTick(t)
		const p = clock.pos()
		const phase = p ? p.loopPhase : 0
		const loop = p?.loop
		if (loop) loopMs = (loop.bars * loop.beatsPerBar * 60000) / loop.bpm
		if (p && phase < lastPhase - 0.5) {
			loopTurned()
			maybeHint()
		}
		lastPhase = phase
		const beatIdx = p ? Math.floor(p.beats) : 0
		if (beatIdx !== lastBeat) {
			if (lastBeat !== -1) heat = Math.min(1, heat + (p.beat === 0 ? 0.25 : 0.08))
			lastBeat = beatIdx
		}
		heat = Math.max(heat * Math.pow(0.04, dt), Math.min(0.9, engine.level() * 2.5))
		const zTarget = focus.on ? 1 : 0
		if (zt !== zTarget) {
			zt = reduce
				? zTarget
				: zTarget > zt
					? Math.min(zTarget, zt + dt / Math.max(0.05, Z.inMs / 1000))
					: Math.max(zTarget, zt - dt / Math.max(0.05, Z.outMs / 1000))
			applyZoom()
			if (!focus.on && sheetSeat >= 0 && eSheet() === 0) {
				sheetSeat = -1
				sizeSeats()
			}
		}
		moving = zt > 0 && zt < 1
		for (const j of ringJelly) j.s.step(dt)
		for (const j of seatJelly) j.s.step(dt)
		wipeJelly.s.step(dt)

		if (opts.ground === 'cycle' && p) {
			const ln = Math.floor(p.loops ?? p.beats / ((loop?.bars || 2) * (loop?.beatsPerBar || 4)))
			if (lastLoopN >= 0 && ln !== lastLoopN && ln % opts.cycleLoops === 0 && !G2)
				startFade(GROUNDS[ORDER[(ORDER.indexOf(groundName()) + 1) % ORDER.length]])
			lastLoopN = ln
		}
		if (G2) {
			fade = Math.min(1, fade + dt / (reduce ? 0.01 : 2.5))
			PAPER = mixHex(G.paper, G2.paper, fade)
			if (fade >= 1) {
				;[bg, bg2] = [bg2, bg]
				G = G2
				G2 = null
				PAPER = G.paper
				applyCss()
			}
		}
		g.setTransform(1, 0, 0, 1, 0, 0)
		const land = EASES.smooth(ip(INTRO.land, INTRO.landMs))
		if (land < 1) g.clearRect(0, 0, canvas.width, canvas.height) // the page's own sky shows through until the land is up
		g.globalAlpha = land
		g.drawImage(bg, 0, 0)
		if (G2) {
			g.globalAlpha = fade * land
			g.drawImage(bg2, 0, 0)
		}
		g.setTransform(DPR, 0, 0, DPR, 0, 0)
		if (opts.landscape) drawDrifters(t)
		g.globalAlpha = 1
		seats.forEach(renderSeat)
		if (opts.mode === 'dial') drawDial(t, dt, phase, loop)
		else drawStrips(phase)
		if (opts.mode === 'dial' && eSheet() > 0) drawSheet(phase)
		drawTrails()
		drawCursors()
		drawHanding()
		drawHandHint()
		if (opts.mode === 'dial') {
			drawNudge()
			drawOffer()
		}
		requestAnimationFrame(frame)
	}

	const groundName = () => Object.keys(GROUNDS).find((k) => GROUNDS[k] === G)
	function startFade(next) {
		if (!next || next === G) return
		G2 = next
		fade = 0
		paintBackdrop(bg2, G2)
		applyCss(G2)
	}
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
		G2 = null
		G = GROUNDS[name] || G
		PAPER = G.paper
		paintBackdrop(bg, G)
		applyCss()
	}

	const drifters = Array.from({ length: 5 }, (_, k) => ({
		u: (k * 0.23 + 0.07) % 1,
		v: 0.08 + ((k * 0.37) % 0.3),
		s: 0.6 + ((k * 0.61) % 0.8),
		sp: 0.4 + ((k * 0.29) % 0.6),
		rot: k * 1.3,
	}))
	let wisps = null,
		wispsFor = null
	function drawDrifters(t) {
		if (wispsFor !== G) {
			wisps = makeWisps(G)
			wispsFor = G
		}
		const T = reduce ? 0 : t / 1000
		g.imageSmoothingEnabled = false
		drifters.forEach((d, k) => {
			const x = ((d.u + T * 0.004 * d.sp) % 1.1) * (W + 60) - 30,
				y = d.v * H + Math.sin(T * 0.3 * d.sp + d.rot) * 8
			if (opts.mode === 'dial' && Math.hypot(x - CX, y - CY) < medallion() + 50) return
			if (x < 260 && y < 200) return
			const set = wisps[k % wisps.length],
				im = set[Math.floor(T * 3 * d.sp + k) % set.length],
				z = 2 * (0.8 + d.s * 0.4)
			g.drawImage(
				im,
				Math.round(x - im.width * z),
				Math.round(y - (im.height * z) / 2),
				Math.round(im.width * z),
				Math.round(im.height * z),
			)
		})
		g.imageSmoothingEnabled = true
	}

	const CHAMBER = '#1b1529',
		PALE = '#efe6f4'
	let filterOK = null
	function canFilter() {
		if (filterOK !== null) return filterOK
		try {
			const c = document.createElement('canvas')
			c.width = c.height = 1
			const x = c.getContext('2d')
			x.fillStyle = '#000'
			x.fillRect(0, 0, 1, 1)
			const t = document.createElement('canvas')
			t.width = t.height = 1
			const y = t.getContext('2d', { willReadFrequently: true })
			y.filter = 'invert(1)'
			y.drawImage(c, 0, 0)
			filterOK = y.getImageData(0, 0, 1, 1).data[0] > 200
		} catch {
			filterOK = false
		}
		return filterOK
	}
	function drawSheet(phase) {
		const e = eSheet(),
			{ x, y, w, h } = sheet,
			L = seats[sheetSeat]
		g.save()
		g.translate((1 - e) * slideDist(), 0) // slides in from the right edge, never translucent
		g.fillStyle = 'rgba(42,28,72,.5)'
		g.fillRect(x + 6, y + 8, w, h)
		// canvas is drawn in ink for the paper rings, so here it goes through invert + half-turn hue: ink turns pale,
		// pigments keep their hue and come up bright. Browsers without canvas filters keep a paper sheet.
		const dark = canFilter()
		g.fillStyle = dark ? CHAMBER : PAPER
		g.fillRect(x, y, w, h)
		if (L && L.w === Math.round(w)) {
			const steps = engine.steps(),
				fg = dark ? (a) => rgba(PALE, a) : ink
			for (let s = 0; s < steps; s += 4) {
				g.fillStyle = s % 16 ? fg(0.07) : fg(0.18)
				g.fillRect(x + (s / steps) * w, y, 1, h)
			}
			const axis = L.module.playhead ?? 'x',
				ph = { color: L.color, ink: dark ? PALE : INK, axis }
			g.save()
			g.translate(x, y)
			if (axis) playhead.under(g, w, h, engine.iclock, ph)
			if (dark) g.filter = 'invert(1) hue-rotate(180deg)'
			g.drawImage(L.canvas, 0, 0, w, h)
			g.filter = 'none'
			if (axis) playhead.over(g, w, h, engine.iclock, ph)
			g.restore()
		}
		g.strokeStyle = INK
		g.lineWidth = 1.4
		g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
		g.restore()
	}

	function drawStrips(phase) {
		seats.forEach((L, i) => {
			const R = stripRect(i),
				own = canDraw(i)
			g.fillStyle = 'rgba(40,25,60,.35)'
			g.fillRect(R.x + 5, R.y + 6, R.w, R.h)
			g.fillStyle = PAPER
			g.fillRect(R.x, R.y, R.w, R.h)
			if (own) {
				g.fillStyle = hatch(L.color, 0.22)
				g.fillRect(R.x, R.y, R.w, R.h)
			}
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
			const st = occupant(i)
			g.font = serif(13)
			g.textAlign = 'left'
			g.textBaseline = 'top'
			g.fillStyle = ink(0.8)
			g.fillText(`${L.module.name.toLowerCase()}, ${st.label}`, R.x + 24, R.y + 8)
			drawSeat(i, ...seatPos(i))
		})
	}

	// an instrument's picker glyph as a sprite for the canvas, in one ink colour; null until the image has loaded
	const glyphs = new Map()
	function glyphImg(id, color) {
		const key = id + color
		if (glyphs.has(key)) return glyphs.get(key).ready ? glyphs.get(key).img : null
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="96" height="96" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><style>.f,.fill{fill:${color}}</style>${registry.get(id)?.glyph || '<circle cx="16" cy="16" r="9"/>'}</svg>`
		const e = { img: new Image(), ready: false }
		e.img.onload = () => (e.ready = true)
		e.img.src = 'data:image/svg+xml,' + encodeURIComponent(svg)
		glyphs.set(key, e)
		return null
	}

	let nudge = null,
		nudgeOff = false
	try {
		nudgeOff = localStorage.getItem('roughjam.opened') === 'yes'
	} catch {}
	function opened() {
		nudge = null
		if (!nudgeOff) {
			nudgeOff = true
			try {
				localStorage.setItem('roughjam.opened', 'yes')
			} catch {}
		}
	}
	function maybeNudge(mine) {
		if (
			nudgeOff ||
			nudge ||
			focus.on ||
			handing ||
			drag ||
			hint ||
			(loopsSeated !== 2 && loopsSeated !== 6 && loopsSeated !== 14)
		)
			return
		const others = [...registry.keys()].filter(
			(id) => id !== seats[mine].module.id && registry.get(id).glyph,
		)
		const ids = Array.from(
			{ length: 3 },
			() => others.splice(Math.floor(Math.random() * others.length), 1)[0],
		)
		nudge = { seat: mine, ids, t0: performance.now() }
		seatJelly[mine].s.v += 14
	}
	function drawNudge() {
		if (!nudge) return
		const t = (performance.now() - nudge.t0) / 1000
		if (t > 1.9 || focus.on || !canDraw(nudge.seat)) {
			nudge = null
			return
		}
		const [x, y] = seatPos(nudge.seat),
			r = seatR()
		const out =
			t < 1.3 ? EASES['out back'](clamp01(t / 0.45)) : 1 - EASES.smooth(clamp01((t - 1.3) / 0.5))
		nudge.ids.forEach((id, k) => {
			// along the rim, counter-clockwise (the broom sits the other side), each a step further
			const [rx, ry] = rimFrom(nudge.seat, -(k + 1) * 0.95),
				tr = r * 0.8 * Math.min(1, out * 1.4)
			const gx = x + (rx - x) * out,
				gy = y + (ry - y) * out
			if (tr <= 0.5) return
			g.save()
			g.globalAlpha = Math.min(1, out * 1.5)
			g.fillStyle = 'rgba(40,25,60,.35)'
			g.beginPath()
			g.arc(gx + 2, gy + 3, tr, 0, TAU)
			g.fill()
			wobble(g, gx, gy, tr, 31 + k * 3, 0.5)
			g.fillStyle = PAPER
			g.fill()
			g.strokeStyle = INK
			g.lineWidth = 1
			g.stroke()
			const img = glyphImg(id, INK)
			if (img) g.drawImage(img, gx - tr * 0.7, gy - tr * 0.7, tr * 1.4, tr * 1.4)
			g.restore()
		})
	}

	function drawSeat(i, x, y, label) {
		const L = seats[i],
			st = occupant(i),
			r = seatR()
		if (st.me) {
			g.fillStyle = 'rgba(40,25,60,.45)'
			g.beginPath()
			g.arc(x + 3, y + 4, r, 0, TAU)
			g.fill()
			g.save()
			g.strokeStyle = INK
			g.lineWidth = 1
			g.setLineDash([3, 4])
			g.lineDashOffset = reduce ? 0 : -performance.now() / 120
			wobble(g, x, y, r + 6, i * 7 + 3, 0.8)
			g.stroke()
			g.restore()
		}
		if (st.riff) {
			g.strokeStyle = st.riff.color
			g.lineWidth = 2.4
			wobble(g, x, y, r + 5, i * 9 + 4, 0.7)
			g.stroke()
			g.strokeStyle = ink(0.55)
			g.lineWidth = 0.7
			wobble(g, x, y, r + 6.6, i * 9 + 4, 0.7)
			g.stroke()
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
		g.textAlign = 'center'
		g.textBaseline = 'middle'
		g.fillStyle = st.name ? PAPER : ink(0.6)
		// every badge wears its instrument's glyph: pale on a taken seat, faint ink on an empty one
		const img = glyphImg(L.module.id, st.name ? PAPER : ink(0.6))
		if (img) g.drawImage(img, x - r * 0.78, y - r * 0.78, r * 1.56, r * 1.56)
		else g.fillText(st.name ? (st.initial || st.name[0]).toUpperCase() : String(i + 1), x, y + 1)
		if (L.mix.mute) {
			// muted: an ink slash through the badge, edged in paper so it reads over the glyph
			g.strokeStyle = PAPER
			g.lineWidth = 5
			g.lineCap = 'round'
			g.beginPath()
			g.moveTo(x - r * 0.95, y + r * 0.95)
			g.lineTo(x + r * 0.95, y - r * 0.95)
			g.stroke()
			g.strokeStyle = INK
			g.lineWidth = 2.2
			g.stroke()
			g.lineCap = 'butt'
		}
		if (engine.solo === i) {
			// soloed in your ears: a second, looser ring round the badge
			g.strokeStyle = L.color
			g.lineWidth = 2
			wobble(g, x, y, r + 9, i * 11 + 5, 1.1)
			g.stroke()
		}
		const tag = L.mix.mute ? ' · muted' : engine.solo === i ? ' · solo' : ''
		if (label && !small())
			arcCaption(
				`${L.module.name.toLowerCase()} · ${st.label}${tag}`,
				Math.atan2(y - CY, x - CX),
				S * 0.505 + r + Math.max(10, S * 0.022),
				Math.max(11, S * 0.018),
				st.me,
			)
	}

	// hand-set caption riding the outside of the dial's rim, centred on angle a. Upright on both halves:
	// on the top half letters run clockwise with their feet on the rim, on the bottom half anticlockwise.
	function arcCaption(text, a, R, px, strong) {
		g.save()
		g.font = `${strong ? 700 : 600} ${Math.round(px)}px Syne, "Bricolage Grotesque", sans-serif`
		g.textAlign = 'center'
		g.textBaseline = 'middle'
		const chars = [...text.toUpperCase()]
		const ws = chars.map((ch) => g.measureText(ch).width + px * 0.16)
		const total = ws.reduce((x, y) => x + y, 0)
		const bottom = Math.sin(a) > 0,
			dir = bottom ? -1 : 1
		let t = a - (dir * total) / R / 2
		const col = G.dark ? G.paper : INK
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
				else {
					g.fillStyle = col
					g.fillText(chars[k], 0, 0)
				}
				g.restore()
				u += (dir * ws[k]) / R
			}
		}
		g.restore()
	}

	// a blurred copy of a backdrop: shrink it twice and let smoothing do the blur on the way back up. Cached until repaint.
	function frost(cv) {
		if (cv.frost) return cv.frost
		const a = document.createElement('canvas'),
			b = document.createElement('canvas')
		a.width = Math.max(1, Math.round(W / 6))
		a.height = Math.max(1, Math.round(H / 6))
		b.width = Math.max(1, Math.round(W / 28))
		b.height = Math.max(1, Math.round(H / 28))
		a.getContext('2d').drawImage(cv, 0, 0, a.width, a.height)
		b.getContext('2d').drawImage(a, 0, 0, b.width, b.height)
		return (cv.frost = b)
	}

	function drawDial(t, dt, phase, loop) {
		const outer = ringIn(seats.length - 1) + ringT() + 8,
			inner = ringIn(0) - 6,
			M = medallion()
		const dialP = ip(INTRO.dial, INTRO.dialMs),
			handP = EASES['out cubic'](ip(INTRO.hand, INTRO.handMs))
		const ringP = (i) => EASES['out cubic'](ip(INTRO.rings + i * INTRO.ringGap, INTRO.ringMs))
		const sweep = ringP(seats.length - 1)
		const seatP = (i) => {
			if (introT0 === null) return 0
			if (seatsAt[i] == null && sweep >= ((((seatAngles()[i] + Math.PI / 2) / TAU) % 1) + 1) % 1)
				seatsAt[i] = introT0 < 0 ? -1e9 : introNow
			return seatsAt[i] == null ? 0 : clamp01((introNow - seatsAt[i]) / Math.max(1, INTRO.seatMs))
		}
		if (dialP === 0) return
		g.save()
		g.globalAlpha = EASES.smooth(Math.min(1, dialP * 2.5))
		const dk = 0.86 + 0.14 * EASES['out back'](dialP)
		if (dk !== 1) {
			g.translate(CX, CY)
			g.scale(dk, dk)
			g.translate(-CX, -CY)
		}

		g.fillStyle = 'rgba(30,20,60,.35)'
		g.beginPath()
		g.arc(CX + S * 0.012, CY + S * 0.016, M, 0, TAU)
		g.fill()
		g.save()
		wobble(g, CX, CY, M, 1, 1.2)
		g.clip()
		g.drawImage(frost(bg), 0, 0, W, H)
		g.fillStyle = rgba(mixHex(PAPER, G.sky[1], 0.16), 0.84)
		g.fillRect(CX - M - 4, CY - M - 4, M * 2 + 8, M * 2 + 8)
		g.restore()
		wobble(g, CX, CY, M, 1, 1.2)
		g.strokeStyle = ink(0.75)
		g.lineWidth = 1.2
		g.stroke()
		g.lineWidth = 0.5
		g.strokeStyle = ink(0.22)
		wobble(g, CX, CY, M - 5, 2, 1)
		g.stroke()
		g.fillStyle = ink(0.45)
		for (let k = 0; k < 4; k++) {
			const [x, y] = polar(angOf(k / 4 + 1 / 8), M - S * 0.012)
			g.beginPath()
			g.arc(x, y, Math.max(1.2, S * 0.0024), 0, TAU)
			g.fill()
		}

		const pa = angOf(phase)
		if (handP > 0) {
			g.globalAlpha *= handP
			g.fillStyle = 'rgba(90,63,142,.05)'
			g.beginPath()
			g.arc(CX, CY, outer, pa - 0.9, pa)
			g.arc(CX, CY, inner, pa, pa - 0.9, true)
			g.closePath()
			g.fill()
			g.globalAlpha /= handP
		}

		const beats = loop ? loop.bars * loop.beatsPerBar : 8,
			bpb = loop?.beatsPerBar || 4
		g.lineWidth = 0.5
		for (let b = 0; b < beats; b++) {
			const a = angOf(b / beats),
				bar = b % bpb === 0
			const [x1, y1] = polar(a, inner),
				[x2, y2] = polar(a, outer + (bar ? 5 : 0))
			g.strokeStyle = bar ? ink(0.16) : ink(0.05)
			g.beginPath()
			g.moveTo(x1, y1)
			g.lineTo(x2, y2)
			g.stroke()
		}
		const steps = engine.steps()
		g.lineWidth = 0.5
		for (let s = 0; s < steps; s++) {
			const a = angOf(s / steps),
				[x1, y1] = polar(a, outer - 1),
				[x2, y2] = polar(a, outer + (s % 4 ? 1.5 : 3.5))
			g.strokeStyle = ink(s % 4 ? 0.12 : 0.3)
			g.beginPath()
			g.moveTo(x1, y1)
			g.lineTo(x2, y2)
			g.stroke()
		}

		seats.forEach((L, i) => {
			const r0 = ringIn(i),
				r1 = r0 + ringT(),
				own = canDraw(i),
				rp = ringP(i)
			if (rp === 0) return
			g.save()
			if (rp < 1) {
				g.beginPath()
				g.moveTo(CX, CY)
				g.arc(CX, CY, r1 + S * 0.05, angOf(0) - 0.05, angOf(rp) + 0.05)
				g.closePath()
				g.clip()
			}
			g.beginPath()
			g.arc(CX, CY, r1, 0, TAU)
			g.arc(CX, CY, r0, 0, TAU, true)
			g.fillStyle = rgba(L.color, own ? 0.13 : 0.05)
			g.fill()
			if (own) {
				g.fillStyle = hatch(L.color, 0.3)
				g.fill()
			}
			g.strokeStyle = ink(own ? 0.75 : 0.2)
			g.lineWidth = own ? 1.1 : 0.6
			const J = ringJelly[i],
				depth = J.s.x * ringT() * 0.28
			wobble(g, CX, CY, r0, i * 3 + 11, own ? 0.9 : 0.6, { a: J.a, depth: -depth * 0.6, w: 0.3 })
			g.stroke()
			wobble(g, CX, CY, r1, i * 3 + 12, own ? 0.9 : 0.6, { a: J.a, depth, w: 0.32 })
			g.stroke()
			if (own && hover && hover.seat === i && !drag) {
				const a0 = angOf(Math.floor(hover.x * steps) / steps),
					a1 = angOf((Math.floor(hover.x * steps) + 1) / steps)
				g.fillStyle = rgba(L.color, 0.28)
				g.beginPath()
				g.arc(CX, CY, r1, a0, a1)
				g.arc(CX, CY, r0, a1, a0, true)
				g.fill()
			}
			if (L.ghost && !moving) {
				g.globalAlpha = 0.3 * (1 - phase) ** 1.2
				warp(L, r0, r1, L.ghost)
				g.globalAlpha = 1
			}
			// a ring you can't hear (muted for the jam, or someone else soloed in your ears) fades back
			if (!engine.heard(i)) g.globalAlpha = 0.28
			warp(L, r0, r1)
			g.globalAlpha = 1
			if (!small()) {
				g.translate(...polar(-Math.PI / 2 - 0.2, r0 + ringT() / 2))
				g.rotate(-0.2)
				g.font = serif(Math.max(11, S * 0.02))
				g.fillStyle = own ? INK : ink(0.6)
				g.textAlign = 'right'
				g.textBaseline = 'middle'
				g.fillText(L.module.name.toLowerCase(), 0, 0)
			}
			g.restore()
		})

		if (handP > 0) {
			const [x1, y1] = polar(pa, inner - 2),
				[x2, y2] = polar(pa, inner - 2 + (outer + 10 - inner) * handP)
			g.strokeStyle = INK
			g.lineWidth = 1.4
			g.lineCap = 'round'
			g.beginPath()
			g.moveTo(x1, y1)
			g.lineTo(x2, y2)
			g.stroke()
			g.fillStyle = VERMILION
			g.beginPath()
			g.arc(x2, y2, Math.max(3, S * 0.006) * handP, 0, TAU)
			g.fill()
			g.strokeStyle = INK
			g.lineWidth = 1
			g.stroke()
		}

		g.strokeStyle = ink(0.8)
		g.lineWidth = 1.1
		wobble(g, CX, CY, porthole(), 21, 0.8)
		g.stroke()
		g.strokeStyle = ink(0.15)
		g.lineWidth = 0.5
		wobble(g, CX, CY, porthole() - 4, 22, 0.6)
		g.stroke()

		g.restore()

		seats.forEach((L, i) => {
			const sp = seatP(i)
			if (sp === 0) return
			const [x, y] = seatPos(i)
			g.save()
			g.globalAlpha = Math.min(1, sp * 3)
			around(x, y, EASES['out back'](sp), () => drawSeat(i, x, y, true))
			if (canDraw(i)) around(x, y, EASES['out back'](sp), drawWipe)
			g.restore()
		})
	}
	function drawWipe() {
		const w = wipeAt()
		if (!w) return
		const [x, y] = w.xy,
			r = w.r
		g.fillStyle = 'rgba(40,25,60,.4)'
		g.beginPath()
		g.arc(x + 2, y + 3, r, 0, TAU)
		g.fill()
		wobble(g, x, y, r, 41, 0.5, { a: wipeJelly.a, depth: wipeJelly.s.x * r * 0.4, w: 0.7 })
		g.fillStyle = PAPER
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = 1
		g.stroke()
		const img = (broom ||= Object.assign(new Image(), {
			src: 'data:image/svg+xml,' + encodeURIComponent(BROOM),
		}))
		if (img.complete && img.naturalWidth)
			g.drawImage(img, x - r * 0.72, y - r * 0.72, r * 1.44, r * 1.44)
	}
	let broom = null
	let offer = null
	function drawOffer() {
		if (!offer) return
		const t = (performance.now() - offer.t0) / offer.ms
		if (t >= 1 || focus.on) {
			offer = null
			return
		}
		const a =
			Math.sin((Math.min(1, t * 4) * Math.PI) / 2) * (1 - t) * (0.75 + 0.25 * Math.sin(t * 18))
		g.save()
		g.setLineDash([3, 4])
		g.lineDashOffset = -performance.now() / 60
		for (const i of offer.seats) {
			const r0 = ringIn(i),
				r1 = r0 + ringT()
			g.beginPath()
			g.arc(CX, CY, r1, 0, TAU)
			g.arc(CX, CY, r0, 0, TAU, true)
			g.fillStyle = rgba(seats[i].color, 0.22 * a)
			g.fill()
			g.strokeStyle = ink(0.7 * a)
			g.lineWidth = 1.2
			g.beginPath()
			g.arc(CX, CY, (r0 + r1) / 2, 0, TAU)
			g.stroke()
		}
		g.restore()
	}

	// Twice a session at most, and never again once you've handed a part over yourself.
	let hint = null,
		hintsShown = 0,
		loopsSeated = 0
	let hintOff = false
	try {
		hintOff = localStorage.getItem('roughjam.handHint') === 'done'
	} catch {}
	function handHintDone() {
		hintOff = true
		hint = null
		try {
			localStorage.setItem('roughjam.handHint', 'done')
		} catch {}
	}
	function maybeHint() {
		const mine = seats.findIndex((_, i) => canDraw(i))
		if (mine < 0) {
			loopsSeated = 0
			return
		}
		loopsSeated++
		maybeNudge(mine)
		if (hintOff || hint || hintsShown >= 2 || focus.on || handing || drag) return
		if (loopsSeated !== 3 && loopsSeated !== 12) return
		const targets = seats.map((_, j) => j).filter((j) => canHand?.(mine, j))
		if (!targets.length) return
		const [mx, my] = seatPos(mine)
		const to = targets.sort(
			(a, b) =>
				Math.hypot(seatPos(a)[0] - mx, seatPos(a)[1] - my) -
				Math.hypot(seatPos(b)[0] - mx, seatPos(b)[1] - my),
		)[0]
		hint = { from: mine, to, t0: performance.now() }
		hintsShown++
	}
	function drawHandHint() {
		if (!hint || reduce) return
		const t = (performance.now() - hint.t0) / 1000
		if (t > 3.2 || focus.on || handing || !canHand?.(hint.from, hint.to)) {
			hint = null
			return
		}
		const [sx, sy] = seatPos(hint.from),
			[tx, ty] = seatPos(hint.to),
			r = seatR()
		const go = Math.min(1, t / 1.3),
			e = go * go * (3 - 2 * go)
		const fade = t < 2.2 ? 1 : 1 - (t - 2.2) / 1
		const x = sx + (tx - sx) * e,
			y = sy + (ty - sy) * e,
			d = Math.hypot(x - sx, y - sy)
		const mx = (sx + x) / 2,
			my = (sy + y) / 2,
			om = Math.hypot(mx - CX, my - CY) || 1,
			bow = d * 0.22
		g.save()
		g.globalAlpha = 0.75 * fade
		g.strokeStyle = INK
		g.lineWidth = 1.1
		g.lineCap = 'round'
		g.setLineDash([3, 5])
		g.beginPath()
		g.moveTo(sx, sy)
		g.quadraticCurveTo(mx + ((mx - CX) / om) * bow, my + ((my - CY) / om) * bow, x, y)
		g.stroke()
		if (go >= 1) {
			g.lineDashOffset = performance.now() / 90
			wobble(g, tx, ty, r + 9, hint.to * 11 + 5, 0.8)
			g.stroke()
		}
		g.setLineDash([])
		g.fillStyle = seats[hint.from].color
		g.beginPath()
		g.arc(x, y, r * 0.42, 0, TAU)
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = 1.1
		g.stroke()
		g.restore()
	}

	function drawHanding() {
		if (!handing?.moved || !handing.own) return
		const L = seats[handing.from],
			[sx, sy] = seatPos(handing.from),
			r = seatR()
		const over = seatUnder(handing.x, handing.y)
		seats.forEach((_, j) => {
			if (!canHand?.(handing.from, j)) return
			const [x, y] = seatPos(j)
			g.strokeStyle = over === j ? INK : ink(0.6)
			g.lineWidth = over === j ? 1.8 : 1
			g.setLineDash(over === j ? [] : [3, 4])
			g.lineDashOffset = reduce ? 0 : performance.now() / 90
			wobble(g, x, y, r + 9, j * 11 + 5, 0.8)
			g.stroke()
			g.setLineDash([])
		})
		const dx = handing.x - sx,
			dy = handing.y - sy,
			d = Math.hypot(dx, dy)
		const sag = Math.max(0, 40 - d * 0.12)
		g.strokeStyle = INK
		g.lineWidth = 1.3
		g.lineCap = 'round'
		g.beginPath()
		g.moveTo(sx, sy)
		g.quadraticCurveTo(sx + dx / 2, sy + dy / 2 + sag, handing.x, handing.y)
		g.stroke()
		g.fillStyle = L.color
		g.beginPath()
		g.arc(handing.x, handing.y, r * 0.45, 0, TAU)
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = 1.2
		g.stroke()
	}

	function drawCursors() {
		const now = performance.now()
		for (const [key, c] of cursors) {
			if (c.until < now) {
				cursors.delete(key)
				continue
			}
			const L = seats[c.seat]
			if (!L) continue
			let x, y
			if (opts.mode === 'dial' && focus.on && c.seat === focus.seat) {
				x = sheet.x + c.x * sheet.w
				y = sheet.y + c.y * sheet.h
			} else if (opts.mode === 'dial')
				[x, y] = polar(angOf(c.x), ringIn(c.seat) + (1 - c.y) * ringT())
			else {
				const R = stripRect(c.seat)
				x = R.x + c.x * R.w
				y = R.y + c.y * R.h
			}
			// on the dark sheet a cursor is drawn pale, or it vanishes into the chamber
			const pale = opts.mode === 'dial' && focus.on && c.seat === focus.seat && canFilter()
			if (key === 'ghost') {
				const r = Math.max(9, (S || 600) * 0.016)
				g.globalAlpha = 0.35
				g.fillStyle = L.color
				g.beginPath()
				g.arc(x, y, r, 0, TAU)
				g.fill()
				g.globalAlpha = 0.9
				g.strokeStyle = pale ? PALE : INK
				g.lineWidth = 1.4
				g.setLineDash([3, 3])
				g.lineDashOffset = reduce ? 0 : -now / 90
				g.beginPath()
				g.arc(x, y, r, 0, TAU)
				g.stroke()
				g.setLineDash([])
				g.globalAlpha = 1
				continue
			}
			g.fillStyle = L.color
			g.beginPath()
			g.arc(x, y, 3, 0, TAU)
			g.fill()
			g.strokeStyle = pale ? PALE : INK
			g.lineWidth = 1
			g.beginPath()
			g.arc(x, y, 7, 0, TAU)
			g.stroke()
			g.font = serif(Math.max(12, (S || 600) * 0.02))
			g.textAlign = 'left'
			g.textBaseline = 'alphabetic'
			g.fillStyle = INK
			g.fillText(c.name || '', x + 11, y - 8)
		}
	}

	document.fonts
		?.load(serif(16))
		.then(() => document.fonts.load(serif(16, 600, false)))
		.then(() => document.fonts.load('600 16px Syne'))
		.catch(() => {})
		.finally(() => (fontsIn = true))

	addEventListener('resize', resize)
	resize()
	applyCss()
	requestAnimationFrame(frame)

	return {
		opts,
		showCursor,
		setMode(m) {
			opts.mode = m
			if (m !== 'dial') setFocus(-1)
			sizeSeats()
		},
		repaint: () => paintBackdrop(bg, G),
		setGround,
		setFocus,
		get moving() {
			return moving
		},
		get handHint() {
			return hint
		},
		offerSweep: (list, ms) =>
			(offer = list.length ? { seats: list, t0: performance.now(), ms } : null),
		nudge: () => {
			const i = seats.findIndex((_, j) => canDraw(j))
			if (i >= 0) {
				nudge = null
				nudgeOff = false
				loopsSeated = 2
				maybeNudge(i)
			}
		},
		// how far the sheet is still off to the right, in px (0 when it has arrived); DOM chrome on the sheet rides with it
		get sheetShift() {
			return sheetSeat < 0 ? Infinity : (1 - eBar()) * slideDist()
		},
		zoom: Z,
		zoomDefaults: ZOOM_DEFAULTS,
		easeNames: [...Object.keys(EASES), 'custom'],
		intro: INTRO,
		introDefaults: INTRO_DEFAULTS,
		introChanged() {
			try {
				localStorage.setItem('roughjam.intro', JSON.stringify(INTRO))
			} catch {}
		},
		replayIntro() {
			introT0 = performance.now()
			seatsAt = []
			menuUp = false
			document.body.classList.add('intro')
		},
		zoomChanged() {
			bezierCache.clear()
			applyZoom()
			try {
				localStorage.setItem('roughjam.zoom', JSON.stringify(Z))
			} catch {}
		},
		get focus() {
			return { ...focus, sheet: focus.on ? { ...sheet } : null }
		},
		// current ground colours ({ paper, dark, sky, ... }); a 'ground' event fires on window when it changes
		ground: () => ({ ...(G2 || G) }),
		heat: () => heat,
		// a seat badge on screen, CSS px
		seatAt: (i) => {
			const [x, y] = seatPos(i)
			return { x, y, r: seatR() }
		},
		// the bare disc inside the innermost ring, CSS px; null in strips mode
		center: () => (opts.mode === 'dial' ? { x: CX, y: CY, r: ringIn(0), ground: PAPER } : null),
		resize,
	}
}
