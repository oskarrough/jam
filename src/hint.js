// Showing a newcomer that their badge holds other instruments, until they first switch.
// ?hint=fan    on arrival the badge fans the other glyphs out like a hand of cards, then folds them back
// ?hint=wobble the badge nudges every few seconds and one other glyph peeks out of it
// ?hint=open   your instrument opens zoomed, the strip of glyphs on top
// Tap a card to switch at once. Retires for good (this browser) after your first switch, unless ?hint= forces it.

const KEY = 'roughjam.switched'

export function createHint({ kind, forced, engine, view, me, registry, glyph, choose }) {
	let done = false
	try {
		done = !forced && !!localStorage.getItem(KEY)
	} catch {}
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
	const layer = document.createElement('div')
	layer.className = 'hint'
	document.body.append(layer)
	let timers = [],
		started = false
	const later = (f, ms) => timers.push(setTimeout(f, ms))

	const seat = () => engine.seats[me.seat]
	// other instruments, the strange ones first: the familiar three come last
	const others = () => {
		const ids = [...registry.keys()].filter((id) => id !== seat()?.module.id)
		return [...ids.slice(3), ...ids.slice(0, 3)]
	}
	function card(id, x, y) {
		const b = document.createElement('button')
		b.className = 'token card'
		b.setAttribute('aria-label', registry.get(id).name)
		b.style.setProperty('--c', seat().color)
		b.style.left = x + 'px'
		b.style.top = y + 'px'
		b.innerHTML = glyph(id)
		// switch on press, not click: instant
		b.addEventListener('pointerdown', (e) => {
			e.preventDefault()
			e.stopPropagation()
			choose(id)
		})
		layer.append(b)
		return b
	}
	// pointing from the badge into the dial, where there is always room
	function inward() {
		const s = view.seatAt(me.seat),
			c = view.center()
		return { s, a: c ? Math.atan2(c.y - s.y, c.x - s.x) : -Math.PI / 2 }
	}

	function fan() {
		if (done || me.seat < 0 || view.focus.on) return
		const { s, a } = inward()
		const ids = others(),
			n = ids.length
		// a hand of cards: a wide arc into the dial, each card half over the next
		const spread = Math.min(2.2, n * 0.2),
			R = Math.max(s.r * 3, (30 * (n - 1)) / spread)
		ids.forEach((id, k) => {
			const t = n > 1 ? k / (n - 1) - 0.5 : 0
			const b = card(id, s.x, s.y)
			const ang = a + t * spread
			// kept on screen
			const cx = Math.min(innerWidth - 26, Math.max(26, s.x + Math.cos(ang) * R)),
				cy = Math.min(innerHeight - 26, Math.max(26, s.y + Math.sin(ang) * R))
			b.style.setProperty('--dx', cx - s.x + 'px')
			b.style.setProperty('--dy', cy - s.y + 'px')
			b.style.setProperty('--rot', ((ang - a) * 180) / Math.PI + 'deg')
			b.style.setProperty('--d', (reduce ? 0 : Math.abs(t) * 2 * 160) + 'ms')
			b.style.zIndex = 100 - Math.round(Math.abs(t) * 20)
		})
		requestAnimationFrame(() => layer.classList.add('out'))
		later(() => layer.classList.remove('out'), 3200)
		later(clear, 3800)
	}

	let peekAt = 0
	function wobble() {
		if (done || me.seat < 0) return
		if (!view.focus.on) {
			view.jolt(me.seat)
			const { s, a } = inward()
			const ids = others()
			const id = ids[peekAt++ % ids.length]
			clear()
			const b = card(id, s.x, s.y)
			b.classList.add('peek')
			b.style.setProperty('--dx', Math.cos(a - 0.5) * s.r * 1.9 + 'px')
			b.style.setProperty('--dy', Math.sin(a - 0.5) * s.r * 1.9 + 'px')
			b.style.setProperty('--rot', '-14deg')
			requestAnimationFrame(() => layer.classList.add('out'))
			later(() => layer.classList.remove('out'), 1300)
		}
		later(wobble, 3200)
	}

	function open() {
		if (done || me.seat < 0 || view.focus.on) return
		view.setFocus(me.seat)
	}

	function clear() {
		layer.classList.remove('out')
		layer.replaceChildren()
	}

	return {
		// once you have a seat
		start() {
			if (done || !kind || started) return
			started = true
			view.quietNudge()
			if (kind === 'fan') later(fan, 900)
			else if (kind === 'wobble') later(wobble, 1500)
			else if (kind === 'open') later(open, 600)
		},
		// you switched: the hint has done its job
		switched() {
			if (done) return
			done = true
			for (const t of timers) clearTimeout(t)
			timers = []
			clear()
			try {
				localStorage.setItem(KEY, '1')
			} catch {}
		},
	}
}
