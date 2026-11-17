// Undo: your own ring's history. A snapshot is the ring's {instrument, state, params} taken just before a change;
// undo sends the old one like any edit, so everyone hears it.

export function createUndo(engine, { limit = 64 } = {}) {
	const past = new Map(),
		future = new Map()
	const list = (m, i) => (m.has(i) || m.set(i, []), m.get(i))
	const snap = (L) => ({
		instrument: L.module.id,
		state: structuredClone(L.instance.state),
		params: { ...L.params },
		len: L.len,
	})
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

	function restore(L, d) {
		L.len = d.len ?? null
		if (d.instrument !== L.module.id)
			engine.setInstrument(L, d.instrument, { state: d.state, params: d.params })
		else {
			Object.assign(L.params, d.params)
			L.instance.setState(d.state)
		}
		engine.push(L, { now: true })
	}
	function move(from, to, i) {
		const L = engine.seats[i],
			a = list(from, i)
		if (!L) return false
		const cur = snap(L)
		while (a.length && same(a.at(-1), cur)) a.pop()
		if (!a.length) return false
		list(to, i).push(cur)
		restore(L, a.pop())
		return true
	}

	return {
		remember(i) {
			const L = engine.seats[i]
			if (!L?.instance) return
			const a = list(past, i),
				s = snap(L)
			if (a.length && same(a.at(-1), s)) return
			a.push(s)
			if (a.length > limit) a.shift()
			future.set(i, [])
		},
		undo: (i) => move(past, future, i),
		redo: (i) => move(future, past, i),
		// bookmark and silent return: a two-finger tap's first finger has already drawn a dot
		mark: (i) => ({
			i,
			n: list(past, i).length,
			f: list(future, i).slice(),
			s: engine.seats[i]?.instance ? snap(engine.seats[i]) : null,
		}),
		rewind(m) {
			const L = engine.seats[m.i]
			if (!L || !m.s) return
			list(past, m.i).length = Math.min(m.n, list(past, m.i).length)
			future.set(m.i, m.f.slice())
			if (!same(snap(L), m.s)) restore(L, m.s)
		},
	}
}
