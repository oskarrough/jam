// View: draws the campfire (or plain strips) and turns pointer input into lane-local {x, y}.
// Each lane renders into its own offscreen canvas; the fire view wraps it round a ring.

import { rgba } from './instruments/util.js'

export function createView(canvas, engine, { seat, canDraw, onSit, onPointer }) {
	const g = canvas.getContext('2d')
	const { lanes, transport } = engine
	const { clock } = transport
	const opts = { mode: 'fire', slices: 192, stars: true }
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
	let W, H, S, CX, CY, DPR
	const stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + 0.2, p: Math.random() * 6 }))
	const flames = [], sparks = []
	const cursors = new Map() // key -> {lane, x, y, name, until}
	let heat = 0, lastT = performance.now(), lastBeat = -1, hover = null, drag = null

	function resize() {
		DPR = Math.min(2, devicePixelRatio || 1)
		W = innerWidth
		H = innerHeight
		canvas.width = W * DPR
		canvas.height = H * DPR
		const narrow = W < 640, top = narrow ? 150 : 20, bottom = narrow ? 120 : 90
		S = Math.max(240, Math.min(W - 24, H - top - bottom))
		CX = W / 2
		CY = top + (H - top - bottom) / 2
		sizeLanes()
	}

	// ring geometry, inner lane first
	const n = () => lanes.length
	const band = () => (S * 0.26) / n()
	const ringIn = (i) => S * 0.16 + i * band()
	const ringT = () => band() * 0.82
	// strip geometry
	const stripRect = (i) => {
		const top = W < 640 ? 160 : 90, bottom = W < 640 ? 130 : 100
		const h = Math.min(120, (H - top - bottom) / n() - 10)
		const x = Math.max(16, (W - 1100) / 2), w = W - 2 * x
		return { x, y: top + i * (h + 10), w, h }
	}

	function sizeLanes() {
		lanes.forEach((L, i) => {
			let w, h
			if (opts.mode === 'fire') { w = 2 * Math.PI * (ringIn(i) + ringT() / 2); h = ringT() }
			else ({ w, h } = stripRect(i))
			L.w = Math.round(w)
			L.h = Math.round(h)
			L.canvas.width = Math.max(1, L.w * DPR)
			L.canvas.height = Math.max(1, L.h * DPR)
		})
	}

	const angOf = (phase) => -Math.PI / 2 + phase * Math.PI * 2
	const polar = (a, r) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r]
	const seatAngles = () => lanes.map((_, i) => Math.PI * 0.75 - (i * Math.PI * 2) / lanes.length) // first lane bottom-left
	const seatPos = (i) => (opts.mode === 'fire' ? polar(seatAngles()[i], S * 0.468) : [stripRect(i).x + 18, stripRect(i).y + 18])
	const seatR = () => Math.max(11, S * 0.026)

	// screen -> lane hit: {lane, x, y} in the lane's 0..1 space
	function hit(px, py, only = null) {
		if (opts.mode === 'fire') {
			const dx = px - CX, dy = py - CY, r = Math.hypot(dx, dy)
			const x = (((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2)) % 1 + 1) % 1
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
		const N = opts.slices, sw = L.canvas.width / N, dw = ((r0 + r1) / 2) * ((Math.PI * 2) / N) + 0.6
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

		g.setTransform(DPR, 0, 0, DPR, 0, 0)
		g.fillStyle = '#0c0e15'
		g.fillRect(0, 0, W, H)
		for (const st of stars) {
			g.globalAlpha = 0.22 + 0.18 * Math.sin(t / 900 + st.p)
			g.fillStyle = '#ebe5d9'
			g.beginPath(); g.arc(st.x * W, st.y * H, st.r, 0, 6.283); g.fill()
		}
		g.globalAlpha = 1
		lanes.forEach(renderLane)
		if (opts.mode === 'fire') drawFire(t, dt, phase, loop)
		else drawStrips(phase, loop)
		drawCursors()
		requestAnimationFrame(frame)
	}

	function drawStrips(phase) {
		lanes.forEach((L, i) => {
			const R = stripRect(i), own = canDraw(i)
			g.fillStyle = rgba(L.color, own ? 0.08 : 0.03)
			g.fillRect(R.x, R.y, R.w, R.h)
			g.strokeStyle = rgba(L.color, own ? 0.5 : 0.15)
			g.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1)
			const steps = engine.steps()
			for (let s = 0; s < steps; s += 4) {
				g.fillStyle = s % 16 === 0 ? 'rgba(235,229,217,.18)' : 'rgba(235,229,217,.06)'
				g.fillRect(R.x + (s / steps) * R.w, R.y, 1, R.h)
			}
			g.drawImage(L.canvas, R.x, R.y, R.w, R.h)
			g.fillStyle = 'rgba(255,190,120,.8)'
			g.fillRect(R.x + phase * R.w, R.y - 3, 1.5, R.h + 6)
			const st = seat(i)
			g.font = '500 11px "IBM Plex Mono", monospace'
			g.textAlign = 'left'; g.textBaseline = 'top'
			g.fillStyle = rgba(L.color, 0.9)
			g.fillText(`${i + 1} ${L.module.name.toLowerCase()} · ${st.label}`, R.x + 6, R.y + 6)
		})
	}

	function drawFire(t, dt, phase, loop) {
		const outer = ringIn(lanes.length - 1) + ringT() + 8, inner = ringIn(0) - 6
		const glowR = S * (0.55 + heat * 0.06)
		const gl = g.createRadialGradient(CX, CY, S * 0.02, CX, CY, glowR)
		gl.addColorStop(0, `rgba(255,140,60,${0.2 + heat * 0.08})`)
		gl.addColorStop(0.45, 'rgba(255,120,50,.05)')
		gl.addColorStop(1, 'rgba(255,120,50,0)')
		g.fillStyle = gl
		g.beginPath(); g.arc(CX, CY, glowR, 0, 6.283); g.fill()

		const pa = angOf(phase)
		if (g.createConicGradient) {
			const cg = g.createConicGradient(pa - 0.9, CX, CY)
			cg.addColorStop(0, 'rgba(255,170,100,0)')
			cg.addColorStop(0.143, 'rgba(255,170,100,.10)')
			cg.addColorStop(0.1432, 'rgba(255,170,100,0)')
			cg.addColorStop(1, 'rgba(255,170,100,0)')
			g.fillStyle = cg
			g.beginPath(); g.arc(CX, CY, outer, 0, 6.283); g.arc(CX, CY, inner, 0, 6.283, true); g.fill()
		}

		// beat and bar marks
		const beats = loop ? loop.bars * loop.beatsPerBar : 8, bpb = loop?.beatsPerBar || 4
		g.lineWidth = 1
		for (let b = 0; b < beats; b++) {
			const a = angOf(b / beats), [x1, y1] = polar(a, inner), [x2, y2] = polar(a, outer)
			g.strokeStyle = b % bpb === 0 ? 'rgba(235,229,217,.22)' : 'rgba(235,229,217,.06)'
			g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
			if (b % bpb === 0) {
				g.font = `500 ${Math.max(9, S * 0.018)}px "IBM Plex Mono", monospace`
				g.textAlign = 'center'; g.textBaseline = 'middle'
				g.fillStyle = 'rgba(235,229,217,.35)'
				const [x, y] = polar(a + 0.045, outer + 4)
				g.fillText(String(b / bpb + 1), x, y)
			}
		}

		lanes.forEach((L, i) => {
			const r0 = ringIn(i), r1 = r0 + ringT(), own = canDraw(i)
			g.fillStyle = rgba(L.color, own ? 0.085 : 0.03)
			g.beginPath(); g.arc(CX, CY, r1, 0, 6.283); g.arc(CX, CY, r0, 0, 6.283, true); g.fill()
			g.strokeStyle = rgba(L.color, own ? 0.5 : 0.14)
			g.lineWidth = own ? 1.2 : 1
			g.beginPath(); g.arc(CX, CY, r0, 0, 6.283); g.stroke()
			g.beginPath(); g.arc(CX, CY, r1, 0, 6.283); g.stroke()
			if (own && hover && hover.lane === i && !drag) {
				const steps = engine.steps(), s = Math.floor(hover.x * steps), a0 = angOf(s / steps), a1 = angOf((s + 1) / steps)
				g.fillStyle = rgba(L.color, 0.12)
				g.beginPath(); g.arc(CX, CY, r1, a0, a1); g.arc(CX, CY, r0, a1, a0, true); g.fill()
			}
			warp(L, r0, r1)
			g.save()
			g.translate(...polar(-Math.PI / 2 - 0.2, r0 + ringT() / 2))
			g.rotate(-0.2)
			g.font = `500 ${Math.max(9, S * 0.017)}px "IBM Plex Mono", monospace`
			g.fillStyle = rgba(L.color, 0.75)
			g.textAlign = 'right'; g.textBaseline = 'middle'
			g.fillText(L.module.name.toLowerCase(), 0, 0)
			g.restore()
		})

		// hand
		const [x1, y1] = polar(pa, inner - 2), [x2, y2] = polar(pa, outer + 2)
		const lgr = g.createLinearGradient(x1, y1, x2, y2)
		lgr.addColorStop(0, 'rgba(255,190,120,.9)')
		lgr.addColorStop(1, 'rgba(255,190,120,.15)')
		g.strokeStyle = lgr; g.lineWidth = 1.5
		g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()

		// logs
		g.lineCap = 'round'; g.strokeStyle = '#3a2a22'; g.lineWidth = S * 0.018
		for (const a of [-0.35, 0.35]) {
			g.beginPath()
			g.moveTo(CX - Math.cos(a) * S * 0.055, CY + S * 0.035 - Math.sin(a) * S * 0.02)
			g.lineTo(CX + Math.cos(a) * S * 0.055, CY + S * 0.035 + Math.sin(a) * S * 0.02)
			g.stroke()
		}

		// flames + sparks
		const rate = (reduce ? 1 : 3) + heat * (reduce ? 0.5 : 3)
		for (let k = 0; k < rate; k++) flames.push({ x: CX + (Math.random() - 0.5) * S * 0.07, y: CY + S * 0.03, vx: (Math.random() - 0.5) * S * 0.03, vy: -(S * 0.12 + Math.random() * S * 0.12) * (1 + heat * 0.4), life: 1, decay: 1.4 + Math.random() * 1.2, size: S * (0.018 + Math.random() * 0.02) })
		if (!reduce && Math.random() < heat * 0.25) sparks.push({ x: CX + (Math.random() - 0.5) * S * 0.04, y: CY - S * 0.04, vx: (Math.random() - 0.5) * 40, vy: -40 - Math.random() * 60, life: 1, c: '#ffb070' })
		g.globalCompositeOperation = 'lighter'
		for (let i = flames.length - 1; i >= 0; i--) {
			const f = flames[i]
			f.life -= f.decay * dt
			if (f.life <= 0) { flames.splice(i, 1); continue }
			f.x += (f.vx + Math.sin(t / 180 + f.y * 0.05) * S * 0.015) * dt
			f.y += f.vy * dt
			f.vx *= 0.96
			const L = f.life, r = f.size * (0.35 + L * 0.75)
			g.fillStyle = L > 0.7 ? `rgba(255,${(190 + 40 * L) | 0},120,${0.2 * L})` : L > 0.35 ? `rgba(255,${(110 + 80 * L) | 0},45,${0.22 * L})` : `rgba(200,60,40,${0.25 * L})`
			g.beginPath(); g.arc(f.x, f.y, r, 0, 6.283); g.fill()
		}
		for (let i = sparks.length - 1; i >= 0; i--) {
			const s = sparks[i]
			s.life -= dt * 0.9
			if (s.life <= 0) { sparks.splice(i, 1); continue }
			s.x += s.vx * dt; s.y += s.vy * dt; s.vx += Math.sin(t / 300 + i) * 8 * dt
			g.fillStyle = rgba(s.c, s.life * 0.9)
			g.beginPath(); g.arc(s.x, s.y, 1.2, 0, 6.283); g.fill()
		}
		g.globalCompositeOperation = 'source-over'

		// seats
		lanes.forEach((L, i) => {
			const [x, y] = seatPos(i), st = seat(i), r = seatR()
			g.fillStyle = '#171b27'
			g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill()
			g.strokeStyle = st.name ? L.color : rgba(L.color, 0.3)
			g.lineWidth = st.me ? 2.5 : 1.2
			if (!st.name) g.setLineDash([3, 3])
			g.beginPath(); g.arc(x, y, r, 0, 6.283); g.stroke()
			g.setLineDash([])
			g.font = `500 ${Math.max(10, S * 0.022)}px "IBM Plex Mono", monospace`
			g.textAlign = 'center'; g.textBaseline = 'middle'
			g.fillStyle = st.name ? L.color : rgba(L.color, 0.45)
			g.fillText(st.name ? st.name[0].toUpperCase() : String(i + 1), x, y + 1)
			g.font = `400 ${Math.max(10, S * 0.018)}px "IBM Plex Mono", monospace`
			g.fillStyle = 'rgba(235,229,217,.7)'
			g.fillText(`${L.module.name.toLowerCase()} · ${st.label}`, x, y > CY ? y + r + 12 : y - r - 12)
		})
	}

	function drawCursors() {
		const now = performance.now()
		for (const [key, c] of cursors) {
			if (c.until < now) { cursors.delete(key); continue }
			const L = lanes[c.lane]
			if (!L) continue
			let x, y
			if (opts.mode === 'fire') [x, y] = polar(angOf(c.x), ringIn(c.lane) + (1 - c.y) * ringT())
			else { const R = stripRect(c.lane); x = R.x + c.x * R.w; y = R.y + c.y * R.h }
			g.strokeStyle = L.color; g.lineWidth = 1.5
			g.beginPath(); g.arc(x, y, 6, 0, 6.283); g.stroke()
			g.font = `500 ${Math.max(10, (S || 600) * 0.018)}px "IBM Plex Mono", monospace`
			g.textAlign = 'left'; g.textBaseline = 'alphabetic'
			g.fillStyle = L.color
			g.fillText(c.name || '', x + 10, y - 8)
		}
	}

	addEventListener('resize', resize)
	resize()
	requestAnimationFrame(frame)

	return {
		opts,
		showCursor,
		setMode(m) { opts.mode = m; sizeLanes() },
		resize,
	}
}
