// Undo: your own ring's history. A snapshot is the ring's data ({instrument, state, params}) taken just
// before you change it: a stroke, a wipe, a swap to another instrument. Undo puts the last one back and
// sends it like any edit, so everyone hears the undo. Every instrument already serializes itself, so this
// works for all of them without any of them knowing.

export function createUndo(engine, { limit = 64 } = {}) {
	const past = new Map(), future = new Map() // seat index -> snapshots, oldest first
	const list = (m, i) => (m.has(i) || m.set(i, []), m.get(i))
	const snap = (L) => ({ instrument: L.module.id, state: structuredClone(L.instance.state), params: { ...L.params } })
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

	function restore(L, d) {
		if (d.instrument !== L.module.id) engine.setInstrument(L, d.instrument, { state: d.state, params: d.params })
		else { Object.assign(L.params, d.params); L.instance.setState(d.state) }
		engine.push(L, { now: true })
	}
	// step from one stack to the other, skipping snapshots that look just like now (a tap that changed nothing)
	function move(from, to, i) {
		const L = engine.seats[i], a = list(from, i)
		if (!L) return false
		const cur = snap(L)
		while (a.length && same(a.at(-1), cur)) a.pop()
		if (!a.length) return false
		list(to, i).push(cur)
		restore(L, a.pop())
		return true
	}

	return {
		// call just before changing seat i
		remember(i) {
			const L = engine.seats[i]
			if (!L?.instance) return
			const a = list(past, i), s = snap(L)
			if (a.length && same(a.at(-1), s)) return
			a.push(s)
			if (a.length > limit) a.shift()
			future.set(i, [])
		},
		undo: (i) => move(past, future, i),
		redo: (i) => move(future, past, i),
		// a bookmark, and a silent return to it: a two-finger tap's first finger has already drawn a dot
		mark: (i) => ({ i, n: list(past, i).length, f: list(future, i).slice(), s: engine.seats[i]?.instance ? snap(engine.seats[i]) : null }),
		rewind(m) {
			const L = engine.seats[m.i]
			if (!L || !m.s) return
			list(past, m.i).length = Math.min(m.n, list(past, m.i).length)
			future.set(m.i, m.f.slice())
			if (!same(snap(L), m.s)) restore(L, m.s)
		},
	}
}
