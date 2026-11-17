// Harmony belongs to the room, and the eye holds it. Each bar's chord sits on the eye's rim at that bar's
// quarter of the loop; tap the eye there to roll it on, or drag up and down to scrub. It travels with the
// loop, so it lands on the next bar for everyone and replays carry it.
import { chordOf } from './instruments/lib/kit.js'
import { SERIF, INK, PAPER } from './palette.js'

const VERMILION = '#d64a28'
const STEP_PX = 18
// each tab leans its own way, like the seat badges
const LEAN = [-7, 5, -3, 8, -5, 3, -8, 6]

export function createHarmony({ canvas, view, transport, heart, readOnly = false }) {
	const { clock } = transport
	const box = document.createElement('div')
	box.setAttribute('aria-hidden', 'true')
	Object.assign(box.style, {
		position: 'fixed',
		inset: '0',
		pointerEvents: 'none',
		display: 'none',
	})
	document.body.append(box)
	const labels = []
	const label = () => {
		const s = document.createElement('span')
		Object.assign(s.style, {
			position: 'absolute',
			left: '0',
			top: '0',
			font: `italic 600 14px ${SERIF}`,
			color: INK,
			background: PAPER,
			border: `1px solid ${INK}`,
			borderRadius: '46% 54% 42% 58% / 58% 44% 56% 42%',
			padding: '0 .32em .05em .22em',
			lineHeight: '1.25',
			boxShadow: '1px 1.5px 0 rgba(33,26,46,.35)',
			whiteSpace: 'nowrap',
			transformOrigin: '50% 50%',
			transition: 'color .2s',
		})
		box.append(s)
		return s
	}

	// the newest loop, including one still waiting for its bar
	const latest = () => clock.pending?.().at(-1) || clock.loopAt()
	const angOf = (phase) => -Math.PI / 2 + phase * Math.PI * 2

	let held = null
	function eye(e) {
		const c = view.center()
		if (!c || view.focus.on || view.moving) return null
		const dx = e.clientX - c.x,
			dy = e.clientY - c.y
		if (Math.hypot(dx, dy) > c.r - 6) return null
		const phase = ((((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2)) % 1) + 1) % 1
		return { c, phase }
	}
	canvas.addEventListener(
		'pointerdown',
		(e) => {
			if (readOnly || held || e.button > 0) return
			const h = eye(e)
			if (!h) return
			e.stopImmediatePropagation()
			const l = latest()
			const bar = Math.floor(h.phase * l.bars)
			const from = chordOf(l, bar).deg
			held = { id: e.pointerId, bar, from, deg: from, y0: e.clientY, moved: false }
			canvas.setPointerCapture(e.pointerId)
			const a = angOf((bar + 0.5) / l.bars)
			heart?.look?.(Math.cos(a), Math.sin(a))
		},
		{ capture: true },
	)
	canvas.addEventListener('pointermove', (e) => {
		if (!held || e.pointerId !== held.id) return
		const steps = Math.round((held.y0 - e.clientY) / STEP_PX)
		if (steps) held.moved = true
		held.deg = (((held.from + steps) % 7) + 7) % 7
	})
	const up = (e) => {
		if (!held || e.pointerId !== held.id) return
		const h = held
		held = null
		if (e.type === 'pointercancel') return
		const deg = h.moved ? h.deg : (h.from + 1) % 7
		if (deg === h.from) return
		const l = latest()
		const chords = Array.from({ length: l.bars }, (_, b) => chordOf(l, b).deg)
		chords[h.bar] = deg
		transport.setLoop({ chords })
	}
	canvas.addEventListener('pointerup', up)
	canvas.addEventListener('pointercancel', up)

	let shown = ''
	function frame() {
		requestAnimationFrame(frame)
		const c = view.center()
		const p = clock.pos()
		if (!c || !p || view.focus.on || view.moving || c.r < 30) {
			if (shown !== 'none') box.style.display = shown = 'none'
			return
		}
		const l = p.loop,
			next = latest(),
			n = l.bars
		const absBar = Math.floor(p.beats / l.beatsPerBar)
		const first = absBar - (((absBar % n) + n) % n)
		const px = Math.max(12, Math.round(c.r * 0.19))
		const rr = c.r - px * 0.9
		let key = `${c.x | 0},${c.y | 0},${px},${absBar}`
		const rows = []
		for (let k = 0; k < n; k++) {
			const now = chordOf(l, first + k)
			const isHeld = held && held.bar === k
			const name = isHeld
				? chordOf({ ...next, chords: [held.deg] }, 0).name
				: chordOf(next, first + k).name
			const row = {
				name,
				cur: first + k === absBar,
				held: isHeld,
				pending: !isHeld && name !== now.name,
			}
			rows.push(row)
			key += `|${name}${+row.cur}${+row.held}${+row.pending}`
		}
		if (key === shown) return
		shown = key
		box.style.display = ''
		while (labels.length < n) labels.push(label())
		labels.forEach((s, k) => {
			const r = rows[k]
			if (!r) return (s.style.display = 'none')
			const a = angOf((k + 0.5) / n)
			const x = c.x + Math.cos(a) * rr,
				y = c.y + Math.sin(a) * rr
			const scale = r.held ? 1.7 : r.cur ? 1.25 : 1
			s.style.display = ''
			s.textContent = r.name
			s.style.fontSize = px + 'px'
			s.style.color = r.held || r.cur ? VERMILION : INK
			s.style.textDecoration = r.pending ? `underline dotted ${VERMILION}` : 'none'
			s.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) rotate(${LEAN[k % LEAN.length]}deg) scale(${scale})`
		})
	}
	requestAnimationFrame(frame)
}
