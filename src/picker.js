// Instrument picker: tap your own seat badge and a sheet of drawn glyphs blooms out of it,
// one squiggle per instrument. Tap one to swap your ring's instrument (it syncs like any edit).
// The name of whatever you point at is set in italics under the glyphs; nothing else is written.

import { jellify } from './jelly.js'

// one small drawing per instrument, 32×32, ink strokes; `f` marks filled bits
const fallback = '<circle cx="16" cy="16" r="9"/>'

export function createPicker({ engine, registry, view, me }) {
	const el = document.createElement('div')
	el.className = 'picker'
	el.hidden = true
	el.setAttribute('role', 'dialog')
	el.setAttribute('aria-label', 'Choose an instrument')
	const grid = document.createElement('div')
	grid.className = 'glyphs'
	const caption = document.createElement('p')
	caption.className = 'caption'
	el.append(grid, caption)
	document.body.append(el)

	const buttons = []
	for (const [id, mod] of registry) {
		const b = document.createElement('button')
		b.className = 'glyph'
		b.dataset.id = id
		b.setAttribute('aria-label', mod.name)
		b.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">${registry.get(id)?.glyph || fallback}</svg>`
		const say = () => (caption.textContent = mod.name.toLowerCase())
		b.addEventListener('pointerenter', say)
		b.addEventListener('focus', say)
		b.addEventListener('pointerleave', () => showCurrent())
		b.onclick = () => choose(id)
		jellify(b, { amount: 0.18 })
		grid.append(b)
		buttons.push(b)
	}

	const lane = () => engine.lanes[me.lane]
	function showCurrent() {
		const L = lane()
		if (L) caption.textContent = L.module.name.toLowerCase()
	}

	function choose(id) {
		const L = lane()
		if (!L) return
		if (L.module.id !== id) {
			engine.setInstrument(L, id, { state: registry.get(id).sample?.(engine.steps()) })
			engine.push(L, { now: true })
		}
		close()
	}

	// anchor: a DOMRect-ish {left, top, width, height} or a seat {x, y, r}; the sheet blooms from it
	function open(anchor) {
		const L = lane()
		if (!L) return
		el.style.setProperty('--c', L.color)
		for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.id === L.module.id)
		showCurrent()
		el.hidden = false
		// bloom out of the badge: place the sheet near it, kept on screen
		const s = anchor?.width ? { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2, r: anchor.width / 2 } : anchor || view.seatAt(me.lane)
		const w = el.offsetWidth, h = el.offsetHeight, m = 12
		const dx = s.x < innerWidth / 2 ? 1 : -1, dy = s.y < innerHeight / 2 ? 1 : -1
		let x = s.x + dx * (s.r + 10) - (dx < 0 ? w : 0)
		let y = s.y + dy * (s.r + 10) - (dy < 0 ? h : 0)
		x = Math.max(m, Math.min(innerWidth - w - m, x))
		y = Math.max(m, Math.min(innerHeight - h - m, y))
		el.style.left = x + 'px'
		el.style.top = y + 'px'
		el.style.transformOrigin = `${s.x - x}px ${s.y - y}px`
		el.classList.remove('bloom'); void el.offsetWidth; el.classList.add('bloom')
		;(buttons.find((b) => b.dataset.id === L.module.id) || buttons[0]).focus({ preventScroll: true })
	}
	function close() { el.hidden = true }
	const toggle = (anchor) => (el.hidden ? open(anchor) : close())

	addEventListener('pointerdown', (e) => { if (!el.hidden && !el.contains(e.target) && !e.target.closest?.('#pick')) close() }, true)
	addEventListener('keydown', (e) => {
		if (el.hidden) return
		if (e.key === 'Escape') { close(); e.stopPropagation() }
		// arrows walk the sheet
		const i = buttons.indexOf(document.activeElement)
		if (i < 0) return
		const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[e.key]
		if (step) { e.preventDefault(); buttons[(i + step + buttons.length) % buttons.length].focus() }
	})

	const glyph = (id) => `<svg viewBox="0 0 32 32" aria-hidden="true">${registry.get(id)?.glyph || fallback}</svg>`
	return { open, close, toggle, glyph, get isOpen() { return !el.hidden } }
}
