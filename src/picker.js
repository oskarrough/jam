// Instrument strip: while zoomed in, every instrument sits above the sheet as a drawn glyph with its name under it;
// hover one for a live preview of its sheet (preview.js), tap one to swap your ring's instrument.

import { jellify } from './jelly.js'
import { createPreview } from './preview.js'
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
	// an instrument's inks (mod.inks), like a painter's brushes, in the tool strip along the sheet's bottom edge; one per stroke
	const inks = document.createElement('p')
	inks.className = 'inks'
	inks.setAttribute('aria-label', 'Inks')
	el.append(row, inks)
	const seat = () => engine.seats[me.seat]
	const preview = createPreview({ engine, registry, el })
	const buttons = []
	for (const [id, mod] of registry) {
		if (mod.hidden) continue
		const slot = document.createElement('div')
		slot.className = groupStarts.has(id) ? 'pick role' : 'pick'
		const b = document.createElement('button')
		b.className = 'glyph token'
		b.dataset.id = id
		b.setAttribute('aria-label', mod.name)
		b.innerHTML = glyph(id)
		const name = document.createElement('span')
		name.className = 'name'
		name.textContent = mod.name.toLowerCase()
		name.setAttribute('aria-hidden', 'true')
		const show = () => preview.show(id, slot, seat()?.color)
		slot.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && show())
		slot.addEventListener('pointerleave', () => preview.hide())
		b.addEventListener('focus', () => b.matches(':focus-visible') && show())
		b.addEventListener('blur', () => preview.hide())
		b.onclick = name.onclick = () => choose(id)
		jellify(b, { amount: 0.18 })
		slot.append(b, name)
		row.append(slot)
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
	let inksShown = null
	function paintInks() {
		const L = seat(),
			list = L?.module.inks || []
		const key = list.map((i) => i[0]).join('|')
		if (key !== inksShown) {
			inksShown = key
			const brushes = document.createElement('span')
			brushes.className = 'brushes'
			brushes.append(
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
			inks.replaceChildren(...(list.length ? [brushes] : []))
		}
		inks.hidden = !list.length
		const cur = L?.instance?.ink
		for (const b of inks.querySelectorAll('[data-ink]'))
			b.setAttribute('aria-pressed', b.dataset.ink === cur)
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
		paintInks()
		const cur = buttons.find((b) => b.dataset.id === L.module.id)
		// arrows switch the instrument (main.js), so a focused glyph follows the choice
		if (cur && buttons.includes(document.activeElement)) cur.focus()
		if (cur && row.scrollWidth > row.clientWidth)
			row.scrollLeft =
				cur.parentNode.offsetLeft - row.clientWidth / 2 + cur.parentNode.offsetWidth / 2
	}

	// a sideways two-finger trackpad swipe over the sheet: one swipe, one instrument along, like paging. The swipe's
	// glide-out is ignored until the wheel rests.
	let swipe = null
	function wheel(e) {
		if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || e.ctrlKey) return false
		e.preventDefault()
		swipe ||= { acc: 0, done: false }
		clearTimeout(swipe.t)
		swipe.t = setTimeout(() => (swipe = null), 300)
		swipe.acc += e.deltaX
		if (!swipe.done && Math.abs(swipe.acc) > 50) {
			swipe.done = true
			cycle(Math.sign(swipe.acc))
		}
		return true
	}

	return { paint, cycle, glyph, choose, wheel }
}
