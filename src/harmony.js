// Harmony belongs to the room, and the eye holds it. Each bar's chord sits on the eye's rim at that bar's
// quarter of the loop; tap the eye there to roll it on, or drag up and down to scrub. It travels with the
// loop, so it lands on the next bar for everyone and replays carry it.
// A tab leads with the chord a player can read (Dm) and carries its numeral (iv) small, as the lesson.
// The key the numerals count from sits under the eye (A minor). Press it for a grid of keys: up and down picks
// the root among all twelve, sideways the mood, bright to dark. Pressing a tab raises a ladder of the
// key's seven chords above your finger: slide to a rung and you hear it, quietly and only you; let go to play it.
import {
	chordOf,
	nameOf,
	letterOf,
	triadOf,
	keyOf,
	spell,
	mtof,
	ROOTS,
	MOODS,
	moodOf,
} from './instruments/lib/kit.js'
import { SERIF, INK, PAPER } from './palette.js'

const VERMILION = '#d64a28'
// rung height: the ladder sits level with your pointer and the rung beside it is the one you get
const STEP_PX = 28
const LADDER_W = 168
// the ladder stands this far beside the pointer, wider for a thumb
const GAP = { touch: 44, pen: 26, mouse: 22 }
// each tab leans its own way, like the seat badges
const LEAN = [-7, 5, -3, 8, -5, 3, -8, 6]
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th']
const QUALITY = { m: 'minor', '°': 'dim', '': 'major' }
const KEYS = Object.keys(ROOTS)
const wrap = (i, n = 7) => ((i % n) + n) % n
// the key grid: twelve roots a semitone apart, the one you're in level with the pointer; four mood columns
const KEY_ROW = 24
const KEY_COL = 44
const KEY_W = 4 * KEY_COL + 24
const KEY_ROWS = { up: 6, down: 5 }
// what the grid's cell at (root step, mood) is, starting from loop l
const keyAt = (h, l) => ({
	...l,
	root: KEYS[wrap(h.from + h.steps, 12)],
	scale: MOODS[h.mood].scale,
})

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
			const start = { id: e.pointerId, y0: e.clientY, moved: false, steps: 0 }
			// the key label wins its own presses: a ladder of keys, never a chord
			const k = keyTag.getBoundingClientRect()
			if (
				e.clientX > k.left - 6 &&
				e.clientX < k.right + 6 &&
				e.clientY > k.top - 6 &&
				e.clientY < k.bottom + 6
			) {
				const from = Math.max(0, KEYS.indexOf(l.root ?? 'A'))
				const mood = moodOf(l.scale)
				held = { ...start, kind: 'key', from, idx: from, mood, mood0: mood, x0: e.clientX }
				place(held, e)
				canvas.setPointerCapture(e.pointerId)
				return
			}
			const bar = Math.floor(h.phase * l.bars)
			const from = chordOf(l, bar).deg
			held = { ...start, kind: 'chord', bar, from, idx: from }
			place(held, e)
			canvas.setPointerCapture(e.pointerId)
			const a = angOf((bar + 0.5) / l.bars)
			heart?.look?.(Math.cos(a), Math.sin(a))
		},
		{ capture: true },
	)
	canvas.addEventListener('pointermove', (e) => {
		if (!held || e.pointerId !== held.id) return
		if (Math.abs(e.clientY - held.y0) > 6 || Math.abs(e.clientX - (held.x0 ?? e.clientX)) > 6)
			held.moved = true
		if (!held.moved) return
		const l = clock.latestLoop()
		if (held.kind === 'key') {
			// the row level with the pointer is the root; each column's width sideways is one mood
			const steps = Math.max(
				-KEY_ROWS.down,
				Math.min(KEY_ROWS.up, Math.round((held.base - e.clientY) / KEY_ROW)),
			)
			const mood = Math.max(
				0,
				Math.min(3, held.mood0 + Math.round((e.clientX - held.x0) / KEY_COL)),
			)
			if (steps === held.steps && mood === held.mood) return
			held.steps = steps
			held.mood = mood
			held.idx = wrap(held.from + steps, 12)
			return hear(keyAt(held, l), 0)
		}
		// the rung level with the pointer; three each way reach all seven chords, so it stops instead of wrapping
		const steps = Math.max(-3, Math.min(3, Math.round((held.base - e.clientY) / STEP_PX)))
		const idx = wrap(held.from + steps)
		if (idx !== held.idx) hear(l, idx)
		held.idx = idx
		held.steps = steps
	})
	// key and chords always travel together: a patch lands on the playing loop, so sending one alone
	// would drop the other if it was changed this bar and hasn't landed yet
	const commit = (l, patch) =>
		transport.setLoop({
			root: l.root ?? 'A',
			scale: l.scale,
			...(l.chords ? { chords: l.chords } : {}),
			...patch,
		})
	const up = (e) => {
		if (!held || e.pointerId !== held.id) return
		const h = held
		held = null
		if (e.type === 'pointercancel') return
		const l = clock.latestLoop()
		if (h.kind === 'key') {
			if (!h.moved) return
			const { root, scale } = keyAt(h, l)
			if (root === (l.root ?? 'A') && scale === l.scale) return
			return commit(l, { root, scale })
		}
		const deg = h.moved ? h.idx : (h.from + 1) % 7
		if (deg === h.from) return
		const chords = Array.from({ length: l.bars }, (_, b) => chordOf(l, b).deg)
		chords[h.bar] = deg
		commit(l, { chords })
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
			n = l.bars
		// while you slide the key ladder, the tabs already speak the key under your pointer
		let next = clock.latestLoop()
		if (held?.kind === 'key') next = keyAt(held, next)
		const absBar = Math.floor(p.beats / l.beatsPerBar)
		const first = absBar - (((absBar % n) + n) % n)
		const px = Math.max(12, Math.round(c.r * 0.19))
		const rr = c.r - px * 0.9
		const key = `${c.x},${c.y},${c.r},${absBar},${held?.kind},${held?.bar},${held?.idx},${held?.mood}`
		if (shown?.loop === l && shown.next === clock.latestLoop() && key === shown.key) return
		shown = { loop: l, next: clock.latestLoop(), key }
		box.style.display = ''
		while (labels.length < n) labels.push(label())
		labels.forEach((s, k) => {
			if (k >= n) return (s.style.display = 'none')
			const current = first + k === absBar
			const pressed = held?.kind === 'chord' && held.bar === k
			const nowDeg = chordOf(l, first + k).deg
			const deg = pressed ? held.idx : chordOf(next, first + k).deg
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
		keyTag.style.color = held?.kind === 'key' ? VERMILION : INK
		keyTag.style.fontSize = Math.max(10, Math.round(px * 0.6)) + 'px'
		keyTag.style.transform = `translate(${Math.round(c.x)}px, ${Math.round(c.y + c.r * 0.86)}px) translate(-50%, -50%) rotate(-2deg)`
		drawLadder(next)
	}

	// The ladder goes beside the pointer with the chord you pressed level with it, then each rung up or down
	// is one step of the key, 1:1 under the pointer. Near a screen edge the ladder shifts rather than squeeze.
	function place(h, e) {
		const key = h.kind === 'key'
		const S = key ? KEY_ROW : STEP_PX,
			up = key ? KEY_ROWS.up : 3,
			down = key ? KEY_ROWS.down : 3,
			head = key ? 40 : 24,
			foot = key ? 22 : 6,
			W = innerWidth,
			H = innerHeight,
			w = key ? KEY_W : LADDER_W
		const gap = GAP[e.pointerType] ?? GAP.mouse
		const right = e.clientX + gap + w <= W - 6
		h.side = right ? 1 : -1
		h.x = right ? e.clientX + gap + w / 2 : Math.max(w / 2 + 6, e.clientX - gap - w / 2)
		h.base = Math.max(up * S + S / 2 + head, Math.min(H - down * S - S / 2 - foot, e.clientY))
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
		if (held.kind === 'key') return drawKeys(g, l)
		const S = STEP_PX,
			w = LADDER_W,
			{ base, x, side } = held
		const top = base - 3 * S - S / 2 - 18,
			bot = base + 3 * S + S / 2
		card(g, x, top, bot, w, base - held.steps * S, side)
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
			const idx = wrap(held.from + i)
			const y = base - i * S
			const on = i === lit,
				start = i === 0
			const name = letterOf(l, idx),
				num = nameOf(l.scale, idx)
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
				g.fillText(`${ORDINAL[idx]}, ${quality}`, x + 16, y + 1)
			}
			g.globalAlpha = 1
		}
	}
	// A paper card, a little crooked, with a notch on the pointer's side level with what's lit
	function card(g, x, top, bot, w, ny, side) {
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
		const nx = x - (side * w) / 2
		g.fillStyle = INK
		g.beginPath()
		g.moveTo(nx - side * 9, ny)
		g.lineTo(nx, ny - 6)
		g.lineTo(nx, ny + 6)
		g.fill()
	}

	// The key grid: twelve roots, a semitone a row, the key you're in level with your finger; four moods
	// across, bright to dark. Each cell is spelled the way that key is written (C♯ in C♯ minor, D♭ in D♭
	// major), and the foot spells out the lit key's seven chords, the ones the tabs will play.
	function drawKeys(g, l) {
		const S = KEY_ROW,
			w = KEY_W,
			{ base, x, side } = held
		const top = base - KEY_ROWS.up * S - S / 2 - 40,
			bot = base + KEY_ROWS.down * S + S / 2 + 22
		card(g, x, top, bot, w, base - held.steps * S, side)
		const lit = keyAt(held, l)
		const col = (m) => x - w / 2 + 12 + KEY_COL * (m + 0.5)
		g.textBaseline = 'middle'
		g.textAlign = 'center'
		g.fillStyle = INK
		g.font = `italic 600 12px ${SERIF}`
		g.fillText(keyOf(lit), x, top + 12)
		g.globalAlpha = 0.6
		g.font = `italic 500 9px ${SERIF}`
		MOODS.forEach((m, i) => g.fillText(i === 1 ? 'mixo' : m.name, col(i), top + 30))
		g.globalAlpha = 1
		for (let i = -KEY_ROWS.down; i <= KEY_ROWS.up; i++) {
			const y = base - i * S
			const root = KEYS[wrap(held.from + i, 12)]
			for (let m = 0; m < 4; m++) {
				const on = i === held.steps && m === held.mood,
					here = i === 0 && m === held.mood0
				const name = spell({ root, scale: MOODS[m].scale })
				if (on) {
					g.strokeStyle = VERMILION
					g.lineWidth = 1.6
					g.beginPath()
					g.ellipse(col(m), y, KEY_COL * 0.46, S * 0.44, -0.04, 0.2, Math.PI * 2 + 0.05)
					g.stroke()
				}
				g.fillStyle = on ? VERMILION : INK
				g.globalAlpha = on || here ? 1 : m === held.mood || i === held.steps ? 0.75 : 0.4
				g.font = `italic ${on || here ? 600 : 500} ${on ? 16 : 13}px ${SERIF}`
				g.fillText(name, col(m), y)
				if (here && !on) g.fillRect(col(m) - 9, y + 8, 18, 1.5)
			}
		}
		g.globalAlpha = 1
		// the lit key's chords, the lesson: C♯ dorian is C♯m D♯m E F♯ G♯m A♯° B
		g.fillStyle = VERMILION
		g.font = `italic 500 11px ${SERIF}`
		g.fillText(Array.from({ length: 7 }, (_, r) => letterOf(lit, r)).join(' '), x, bot - 12)
	}
	requestAnimationFrame(frame)
}
