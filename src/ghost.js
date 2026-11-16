// Ghost hand: when you switch instruments, a cursor in your colour plays that instrument's gesture once on
// your seat (the sheet when you're zoomed in, your ring when not), using the same cursor and trail as robots
// and other players. No words. It only moves a cursor; your drawing is untouched. Each instrument's
// gesture is its `demo` (see src/instruments/lib/demo.js). After two showings per instrument it rests,
// and it stops the moment you touch your seat.

export function createGhost({ engine, view, me, times = 2 }) {
	let run = null
	const seen = (id) => { try { return +localStorage.getItem('roughjam.ghost.' + id) || 0 } catch { return 0 } }
	const saw = (id) => { try { localStorage.setItem('roughjam.ghost.' + id, seen(id) + 1) } catch {} }
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

	function stop() { if (run) { cancelAnimationFrame(run.raf); clearTimeout(run.wait); run = null } }

	function play(i = me.seat, { force = false } = {}) {
		stop()
		const L = engine.seats[i]
		const demo = L?.module.demo
		if (!demo || reduce || (!force && seen(L.module.id) >= times)) return false
		const id = L.module.id
		const r = (run = { raf: 0, wait: 0 })
		// a beat's wait, so cycling quickly through instruments doesn't flicker ghosts (and a zoom can settle)
		r.wait = setTimeout(() => {
			const shape = view.focus.on && view.focus.seat === i ? 'sheet' : 'ring'
			const aspect = L.canvas.width / Math.max(1, L.canvas.height)
			const strokes = (typeof demo === 'function' ? demo(shape, aspect) : demo).filter((s) => s.length)
			if (!strokes.length) return (run = null)
			// one timeline: each stroke takes its time, taps are short, a breath between strokes
			const plan = []
			let t = 0
			for (const s of strokes) {
				const dur = s.length === 1 ? 260 : 380 + s.length * 45
				plan.push({ s, t0: t, dur })
				t += dur + 300
			}
			const t0 = performance.now()
			saw(id)
			const tick = () => {
				if (run !== r || engine.seats[i].module.id !== id) return
				const now = performance.now() - t0
				const cur = plan.find((p) => now >= p.t0 && now < p.t0 + p.dur)
				if (cur) {
					const f = (now - cur.t0) / cur.dur, k = Math.min(cur.s.length - 1, f * (cur.s.length - 1))
					const a = cur.s[Math.floor(k)], b = cur.s[Math.ceil(k)], u = k - Math.floor(k)
					view.showCursor('ghost', i, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, '')
				}
				if (now < t) r.raf = requestAnimationFrame(tick)
				else run = null
			}
			r.raf = requestAnimationFrame(tick)
		}, 650)
		return true
	}

	return { play, stop, get playing() { return !!run } }
}
