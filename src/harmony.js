// Harmony belongs to the room, and the eye holds it. Each bar's chord sits on the eye's rim at that bar's
// quarter of the loop; tap the eye there to roll it on, or drag up and down to scrub. It travels with the
// loop, so it lands on the next bar for everyone and replays carry it.
// A tab leads with the chord a player can read (Dm) and carries its numeral (iv) small, as the lesson.
// The key the numerals count from sits under the eye (A minor). Pressing a tab raises a ladder of the
// key's seven chords above your finger: slide to a rung and you hear it, quietly and only you; let go to play it.
import { chordOf, nameOf, letterOf, triadOf, keyOf, mtof } from './instruments/lib/kit.js'
import { SERIF, INK, PAPER } from './palette.js'

const VERMILION = '#d64a28'
// one rung of the ladder per this many px of drag, so the lit rung tracks the finger
const STEP_PX = 28
// the ladder's starting rung floats this far above the finger, clear of the thumb
const LIFT = 96
// each tab leans its own way, like the seat badges
const LEAN = [-7, 5, -3, 8, -5, 3, -8, 6]
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th']
const QUALITY = { m: 'minor', '°': 'dim', '': 'major' }

export function createHarmony({ canvas, view, transport, heart, engine, readOnly = false }) {
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
		s.chord = document.createElement('span')
		s.num = document.createElement('span')
		Object.assign(s.num.style, { fontSize: '.62em', marginLeft: '.2em', opacity: '.6' })
		s.append(s.chord, s.num)
		box.append(s)
		return s
	}
	// the key, quiet under the eye's pupil
	const keyTag = document.createElement('span')
	Object.assign(keyTag.style, {
		position: 'absolute',
		left: '0',
		top: '0',
		font: `italic 500 11px ${SERIF}`,
		color: INK,
		background: PAPER,
		borderRadius: '.6em',
		padding: '0 .4em .05em',
		lineHeight: '1.2',
		opacity: '.82',
		whiteSpace: 'nowrap',
	})
	box.append(keyTag)

	// the ladder: drawn only while a tab is held
	const ladder = document.createElement('canvas')
	Object.assign(ladder.style, {
		position: 'absolute',
		left: '0',
		top: '0',
		zIndex: '1',
		display: 'none',
	})
	box.append(ladder)
	const lx = ladder.getContext('2d')

	// a soft preview of a rung's chord, into the master so the sound switch still rules it
	let preview = null
	function hear(l, deg) {
		const audio = engine?.audio
		if (!audio || !engine.master || audio.state !== 'running') return
		const t = audio.currentTime
		preview?.gain.setTargetAtTime(0, t, 0.03)
		const g = audio.createGain()
		const lp = audio.createBiquadFilter()
		lp.frequency.value = 1400
		g.gain.setValueAtTime(0, t)
		g.gain.linearRampToValueAtTime(0.09, t + 0.025)
		g.gain.setTargetAtTime(0, t + 0.08, 0.35)
		g.connect(lp).connect(engine.master)
		triadOf(l, deg).forEach((m, i) => {
			const o = audio.createOscillator()
			o.type = 'triangle'
			o.frequency.value = mtof(m + 12)
			o.detune.value = (i - 1) * 4
			o.connect(g)
			o.start(t + i * 0.012)
			o.stop(t + 1.6)
		})
		preview = g
	}

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
			const l = clock.latestLoop()
			const bar = Math.floor(h.phase * l.bars)
			const from = chordOf(l, bar).deg
			held = { id: e.pointerId, bar, from, deg: from, x0: e.clientX, y0: e.clientY, moved: false }
			canvas.setPointerCapture(e.pointerId)
			const a = angOf((bar + 0.5) / l.bars)
			heart?.look?.(Math.cos(a), Math.sin(a))
		},
		{ capture: true },
	)
	canvas.addEventListener('pointermove', (e) => {
		if (!held || e.pointerId !== held.id) return
		// three rungs each way reach all seven chords, so the ladder stops instead of wrapping
		const steps = Math.max(-3, Math.min(3, Math.round((held.y0 - e.clientY) / STEP_PX)))
		if (steps) held.moved = true
		const deg = (((held.from + steps) % 7) + 7) % 7
		if (deg !== held.deg) hear(clock.latestLoop(), deg)
		held.deg = deg
		held.steps = steps
	})
	const up = (e) => {
		if (!held || e.pointerId !== held.id) return
		const h = held
		held = null
		if (e.type === 'pointercancel') return
		const deg = h.moved ? h.deg : (h.from + 1) % 7
		if (deg === h.from) return
		const l = clock.latestLoop()
		const chords = Array.from({ length: l.bars }, (_, b) => chordOf(l, b).deg)
		chords[h.bar] = deg
		transport.setLoop({ chords })
	}
	canvas.addEventListener('pointerup', up)
	canvas.addEventListener('pointercancel', up)

	let shown = null
	function frame() {
		requestAnimationFrame(frame)
		const c = view.center()
		const p = clock.pos()
		if (!c || !p || view.focus.on || view.moving || c.r < 30) {
			if (shown) box.style.display = 'none'
			if (held) held = null
			shown = null
			return
		}
		const l = p.loop,
			next = clock.latestLoop(),
			n = l.bars
		const absBar = Math.floor(p.beats / l.beatsPerBar)
		const first = absBar - (((absBar % n) + n) % n)
		const px = Math.max(12, Math.round(c.r * 0.19))
		const rr = c.r - px * 0.9
		const key = `${c.x},${c.y},${c.r},${absBar},${held?.bar},${held?.deg}`
		if (shown?.loop === l && shown.next === next && key === shown.key) return
		shown = { loop: l, next, key }
		box.style.display = ''
		while (labels.length < n) labels.push(label())
		labels.forEach((s, k) => {
			if (k >= n) return (s.style.display = 'none')
			const current = first + k === absBar
			const pressed = held?.bar === k
			const nowDeg = chordOf(l, first + k).deg
			const deg = pressed ? held.deg : chordOf(next, first + k).deg
			const chord = letterOf(next, deg)
			const pending = !pressed && chord !== letterOf(l, nowDeg)
			const a = angOf((k + 0.5) / n)
			const x = c.x + Math.cos(a) * rr,
				y = c.y + Math.sin(a) * rr
			const scale = pressed ? 1.4 : current ? 1.25 : 1
			s.style.display = ''
			s.chord.textContent = chord
			s.num.textContent = nameOf(next.scale, deg)
			s.num.style.opacity = pressed ? '1' : '.6'
			s.style.fontSize = px + 'px'
			s.style.color = pressed || current ? VERMILION : INK
			s.style.textDecoration = pending ? `underline dotted ${VERMILION}` : 'none'
			s.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) rotate(${LEAN[k % LEAN.length]}deg) scale(${scale})`
		})
		keyTag.textContent = keyOf(next)
		keyTag.style.fontSize = Math.max(10, Math.round(px * 0.6)) + 'px'
		keyTag.style.transform = `translate(${Math.round(c.x)}px, ${Math.round(c.y + c.r * 0.86)}px) translate(-50%, -50%) rotate(-2deg)`
		drawLadder(next)
	}

	// Seven rungs, the chord you started on in the middle, one step of the key per rung. Each rung reads
	// 'Dm iv'; the lit one also says what the numeral means: '4th of A minor, a minor chord'.
	function drawLadder(l) {
		if (!held) return (ladder.style.display = 'none')
		const W = innerWidth,
			H = innerHeight,
			dpr = devicePixelRatio || 1
		if (ladder.width !== Math.round(W * dpr) || ladder.height !== Math.round(H * dpr)) {
			ladder.width = Math.round(W * dpr)
			ladder.height = Math.round(H * dpr)
			ladder.style.width = W + 'px'
			ladder.style.height = H + 'px'
		}
		ladder.style.display = ''
		const g = lx
		g.setTransform(dpr, 0, 0, dpr, 0, 0)
		g.clearRect(0, 0, W, H)
		const S = STEP_PX,
			w = 168
		let base = held.y0 - LIFT
		// keep the top rung on screen; if that squeezes, the ladder slides down rather than off
		base = Math.max(base, 3 * S + 34)
		const x = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, held.x0))
		const top = base - 3 * S - S / 2 - 18,
			bot = base + 3 * S + S / 2
		// paper card, a little crooked
		g.save()
		g.translate(x, (top + bot) / 2)
		g.rotate(-0.025)
		g.fillStyle = PAPER
		g.strokeStyle = INK
		g.lineWidth = 1.2
		g.shadowColor = 'rgba(33,26,46,.35)'
		g.shadowOffsetX = 1.5
		g.shadowOffsetY = 2
		g.beginPath()
		g.roundRect(-w / 2, -(bot - top) / 2, w, bot - top, 12)
		g.fill()
		g.shadowColor = 'transparent'
		g.stroke()
		g.restore()
		// the key, as the ladder's title
		g.fillStyle = INK
		g.globalAlpha = 0.6
		g.font = `italic 500 11px ${SERIF}`
		g.textAlign = 'center'
		g.textBaseline = 'middle'
		g.fillText(`in ${keyOf(l)}`, x, top + 11)
		g.globalAlpha = 1
		// rails
		g.strokeStyle = INK
		g.globalAlpha = 0.25
		g.lineWidth = 1
		for (const rx of [x - w / 2 + 14, x + w / 2 - 14]) {
			g.beginPath()
			g.moveTo(rx, top + 22)
			g.lineTo(rx + 1, bot - 6)
			g.stroke()
		}
		g.globalAlpha = 1
		const lit = held.steps ?? 0
		for (let i = -3; i <= 3; i++) {
			const deg = (((held.from + i) % 7) + 7) % 7
			const y = base - i * S
			const on = i === lit,
				start = i === 0
			const name = letterOf(l, deg),
				num = nameOf(l.scale, deg)
			if (on) {
				// a scribbled ring round the lit rung
				g.strokeStyle = VERMILION
				g.lineWidth = 1.6
				g.beginPath()
				g.ellipse(x - 30, y, 40, S * 0.42, -0.04, 0.2, Math.PI * 2 + 0.05)
				g.stroke()
			}
			g.fillStyle = on ? VERMILION : INK
			g.globalAlpha = on || start ? 1 : 0.72
			g.textAlign = 'right'
			g.font = `italic 600 ${on ? 18 : 15}px ${SERIF}`
			g.fillText(name, x - 28, y)
			g.textAlign = 'left'
			g.font = `italic 500 ${on ? 13 : 11}px ${SERIF}`
			g.fillText(num, x - 22, y + 1)
			if (start && !on) {
				// where you came from: a small tick on the left rail
				g.fillRect(x - w / 2 + 10, y - 1, 8, 2)
			}
			if (on) {
				const quality = QUALITY[name.slice(-1)] ?? QUALITY['']
				g.font = `italic 500 10px ${SERIF}`
				g.globalAlpha = 0.85
				g.fillText(`${ORDINAL[deg]}, ${quality}`, x + 16, y + 1)
			}
			g.globalAlpha = 1
		}
	}
	requestAnimationFrame(frame)
}
