// Instrument picker: tap your own seat badge and a sheet of drawn glyphs blooms out of it,
// one squiggle per instrument. Tap one to swap your ring's instrument (it syncs like any edit).
// The name of whatever you point at is set in italics under the glyphs; nothing else is written.

import { jellify } from './jelly.js'

// one small drawing per instrument, 32×32, ink strokes; `f` marks filled bits
const GLYPHS = {
	bass: '<path d="M3 19c4-9 8 9 13 0s9 9 13 0" stroke-width="2.4"/>',
	keys: '<path d="M7 7v18M13 7v18M19 7v18M25 7v18"/><path class="f" d="M9.5 7h2v10h-2zM21.5 7h2v10h-2z"/>',
	bell: '<path d="M10 21c0-8 2-13 6-13s6 5 6 13z"/><path d="M7 21h18M16 24v2"/>',
	drums: '<circle cx="11" cy="18" r="6"/><path class="f" d="M20 11h8v8h-8z"/><circle class="f" cx="23" cy="25" r="1.6"/>',
	contour: '<path d="M3 22l5-7 4 3 6-11 5 7 6-4"/>',
	grid: '<path class="f" d="M7 7h4v4H7zM19 13h4v4h-4zM13 21h4v4h-4zM21 21h4v4h-4z"/><path d="M5 16h22M16 5v22" stroke-dasharray="1 3"/>',
	rings: '<circle cx="16" cy="16" r="4"/><circle cx="16" cy="16" r="8.5"/><circle cx="16" cy="16" r="13"/><circle class="f" cx="16" cy="3" r="1.8"/>',
	sweep: '<path d="M5 25A13 13 0 0 1 27 12"/><path d="M23 9l4 3-3 4"/><path d="M8 19h4M11 14h4" stroke-dasharray="1 2"/>',
	drift: '<circle class="f" cx="16" cy="16" r="2.6"/><circle cx="16" cy="16" r="7"/><circle cx="16" cy="16" r="12" stroke-dasharray="2 3"/>',
	scribble: '<path d="M4 21c3-11 6 6 8-5s4 11 7 0 3 9 9-7"/>',
	strum: '<path d="M4 9h24M4 13h24M4 17h24M4 21h24" stroke-width="1"/><path d="M9 26L23 5" stroke-width="2.2"/>',
	swarm: '<circle class="f" cx="8" cy="9" r="1.6"/><circle class="f" cx="22" cy="7" r="1.6"/><circle class="f" cx="13" cy="21" r="1.6"/><circle class="f" cx="25" cy="19" r="1.6"/><circle class="f" cx="17" cy="13" r="1.6"/><path d="M4 27L28 12"/>',
	orbits: '<ellipse cx="16" cy="16" rx="12" ry="6" transform="rotate(-25 16 16)"/><circle class="f" cx="16" cy="16" r="2.4"/><circle class="f" cx="26.5" cy="11" r="2"/>',
	embers: '<path class="f" d="M16 22l2 3-2 3-2-3zM10 13l1.5 2.2L10 17.5 8.5 15.2zM21 7l1.5 2.2L21 11.5 19.5 9.2z"/><path d="M11 28c3-2 7-2 10 0"/>',
}
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
		b.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">${GLYPHS[id] || fallback}</svg>`
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

	const glyph = (id) => `<svg viewBox="0 0 32 32" aria-hidden="true">${GLYPHS[id] || fallback}</svg>`
	return { open, close, toggle, glyph, get isOpen() { return !el.hidden } }
}
