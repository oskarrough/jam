// Instrument strip: while zoomed in, every instrument sits above the sheet as a drawn glyph; tap one to swap your ring's instrument.

import { jellify } from './jelly.js'

// each instrument module carries its own 32×32 glyph (mod.glyph); `f` marks filled bits
const fallback = '<circle cx="16" cy="16" r="9"/>'

export function createStrip({ engine, registry, me, el, before, chosen }) {
	const glyph = (id) => `<svg viewBox="0 0 32 32" aria-hidden="true">${registry.get(id)?.glyph || fallback}</svg>`
	el.classList.add('strip')
	el.setAttribute('role', 'toolbar')
	el.setAttribute('aria-label', 'Instruments')
	const row = document.createElement('div')
	row.className = 'glyphs'
	const caption = document.createElement('p')
	caption.className = 'caption'
	const voices = document.createElement('p')
	voices.className = 'voices'
	voices.setAttribute('aria-label', 'Voices')
	el.append(row, caption, voices)

	const seat = () => engine.seats[me.seat]
	const showCurrent = () => { const L = seat(); caption.textContent = L ? L.module.name.toLowerCase() : '' }
	const buttons = []
	for (const [id, mod] of registry) {
		const b = document.createElement('button')
		b.className = 'glyph token'
		b.dataset.id = id
		b.setAttribute('aria-label', mod.name)
		b.title = mod.name.toLowerCase()
		b.innerHTML = glyph(id)
		const say = () => (caption.textContent = mod.name.toLowerCase())
		b.addEventListener('pointerenter', say)
		b.addEventListener('focus', say)
		b.addEventListener('pointerleave', showCurrent)
		b.addEventListener('blur', showCurrent)
		b.onclick = () => choose(id)
		jellify(b, { amount: 0.18 })
		row.append(b)
		buttons.push(b)
	}

	function choose(id) {
		const L = seat()
		if (!L || L.module.id === id) return false
		before?.()
		engine.setInstrument(L, id, { state: registry.get(id).sample?.(engine.steps()) })
		engine.push(L, { now: true })
		paint()
		chosen?.(id)
		return true
	}
	function voice(name) {
		const L = seat()
		if (!L || L.params.voice === name) return
		L.params.voice = name
		engine.push(L, { now: true })
		paintVoices()
	}
	let shown = null
	function paintVoices() {
		const L = seat(), names = L?.module.voices || []
		const key = names.join('|')
		if (key !== shown) {
			shown = key
			voices.replaceChildren(...names.map((n) => {
				const b = document.createElement('button')
				b.textContent = n
				b.onclick = () => voice(n)
				return b
			}))
		}
		voices.hidden = !names.length
		for (const b of voices.children) b.setAttribute('aria-pressed', b.textContent === L?.params.voice)
	}
	const ids = [...registry.keys()]
	function cycle(d) {
		const L = seat()
		if (!L) return null
		const id = ids[(ids.indexOf(L.module.id) + d + ids.length) % ids.length]
		choose(id)
		return id
	}
	function paint() {
		const L = seat()
		if (!L) return
		el.style.setProperty('--c', L.color)
		for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.id === L.module.id)
		showCurrent()
		paintVoices()
		const cur = buttons.find((b) => b.dataset.id === L.module.id)
		if (cur && row.scrollWidth > row.clientWidth) row.scrollLeft = cur.offsetLeft - row.clientWidth / 2 + cur.offsetWidth / 2
	}

	el.addEventListener('keydown', (e) => {
		const i = buttons.indexOf(document.activeElement)
		const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
		if (i >= 0 && step) { e.preventDefault(); e.stopPropagation(); buttons[(i + step + buttons.length) % buttons.length].focus() }
	})
	return { paint, cycle, glyph }
}

