// Instrument strip: while zoomed in, every instrument sits above the sheet as a drawn glyph; tap one to swap your ring's instrument.

import { jellify } from './jelly.js'
import { groupStarts } from './instruments/index.js'

// each instrument module carries its own 32×32 glyph (mod.glyph); `f` marks filled bits
const fallback = '<circle cx="16" cy="16" r="9"/>'

export function createStrip({ engine, registry, me, el, before, chosen }) {
	const glyph = (id) =>
		`<svg viewBox="0 0 32 32" aria-hidden="true">${registry.get(id)?.glyph || fallback}</svg>`
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
	// the seat's loop length in bars, in the sheet's other top corner: a little drawn loop, then 1 2 4 8
	const loops = document.createElement('p')
	loops.className = 'loops'
	loops.setAttribute('aria-label', 'Loop length in bars')
	loops.innerHTML =
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6.5A7.5 7.5 0 1 0 19.5 12"/><path d="M14 5.5l3.4 1.2-.8-3.6"/></svg>'
	const BARS = [1, 2, 4, 8]
	for (const n of BARS) {
		const b = document.createElement('button')
		b.textContent = n
		b.title = n === 1 ? 'loop one bar' : `loop ${n} bars`
		b.onclick = () => {
			const L = seat()
			if (!L) return
			before?.()
			engine.setBars(L, n)
			paintLoops()
		}
		loops.append(b)
	}
	const odd = document.createElement('i')
	loops.append(odd)
	// an instrument's inks (mod.inks), like a painter's brushes, under the sheet's bottom-left corner; one per stroke
	const inks = document.createElement('p')
	inks.className = 'inks'
	inks.setAttribute('aria-label', 'Inks')
	el.append(row, caption, voices, loops, inks)
	function paintLoops() {
		const L = seat()
		if (!L) return
		const bars = engine.steps(L) / (engine.loop().beatsPerBar * 4)
		for (const b of loops.querySelectorAll('button'))
			b.setAttribute('aria-pressed', +b.textContent === bars)
		// a length set some other way (an instrument's own gesture) that isn't 1, 2, 4 or 8 bars
		odd.textContent = BARS.includes(bars) ? '' : engine.steps(L) + '/16'
	}

	const seat = () => engine.seats[me.seat]
	const showCurrent = () => {
		const L = seat()
		caption.textContent = L ? L.module.name.toLowerCase() : ''
	}
	const buttons = []
	for (const [id, mod] of registry) {
		if (mod.hidden) continue
		const b = document.createElement('button')
		b.className = groupStarts.has(id) ? 'glyph token role' : 'glyph token'
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

	// what you left on each instrument, so switching back finds it again; this tab only
	const left = new Map()
	function choose(id) {
		const L = seat()
		if (!L || L.module.id === id) return false
		before?.()
		left.set(`${L.id}:${L.module.id}`, {
			state: structuredClone(L.instance.state),
			params: { ...L.params },
		})
		const back = left.get(`${L.id}:${id}`)
		engine.setInstrument(
			L,
			id,
			back ? structuredClone(back) : { state: registry.get(id).sample?.(engine.steps(L)) },
		)
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
	let inksShown = null
	function paintInks() {
		const L = seat(),
			list = L?.module.inks || []
		const key = list.map((i) => i[0]).join('|')
		if (key !== inksShown) {
			inksShown = key
			inks.replaceChildren(
				...list.map(([n, svg]) => {
					const b = document.createElement('button')
					b.title = n
					b.dataset.ink = n
					b.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">${svg}</svg>`
					b.onclick = () => {
						const S = seat()
						if (S?.instance) S.instance.ink = n
						paintInks()
					}
					return b
				}),
			)
		}
		inks.hidden = !list.length
		const cur = L?.instance?.ink
		for (const b of inks.children) b.setAttribute('aria-pressed', b.dataset.ink === cur)
	}
	let shown = null
	function paintVoices() {
		paintInks()
		const L = seat(),
			names = L?.module.voices || []
		const key = names.join('|')
		if (key !== shown) {
			shown = key
			voices.replaceChildren(
				...names.map((n) => {
					const b = document.createElement('button')
					b.textContent = n
					b.onclick = () => voice(n)
					return b
				}),
			)
		}
		voices.hidden = !names.length
		for (const b of voices.children)
			b.setAttribute('aria-pressed', b.textContent === L?.params.voice)
	}
	const ids = [...registry.keys()].filter((id) => !registry.get(id).hidden)
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
		paintLoops()
		const cur = buttons.find((b) => b.dataset.id === L.module.id)
		// arrows switch the instrument (main.js), so a focused glyph follows the choice
		if (cur && buttons.includes(document.activeElement)) cur.focus()
		if (cur && row.scrollWidth > row.clientWidth)
			row.scrollLeft = cur.offsetLeft - row.clientWidth / 2 + cur.offsetWidth / 2
	}

	return { paint, cycle, glyph, choose }
}
