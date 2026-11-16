// Jelly: things give where you press them, then spring back with a wobble.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

export function spring({ k = 520, c = 11 } = {}) {
	const s = { x: 0, v: 0, target: 0 }
	s.step = (dt) => {
		if (reduce) {
			s.x = s.target
			s.v = 0
			return s.x
		}
		// semi-implicit Euler, a few substeps so a dropped frame doesn't explode it
		const n = Math.max(1, Math.ceil(dt / 0.008)),
			h = dt / n
		for (let i = 0; i < n; i++) {
			s.v += (k * (s.target - s.x) - c * s.v) * h
			s.x += s.v * h
		}
		return s.x
	}
	s.settled = () => Math.abs(s.x - s.target) < 0.002 && Math.abs(s.v) < 0.01
	return s
}

export const dentAt = (t, a, w = 0.35) => {
	let d = t - a
	d = Math.atan2(Math.sin(d), Math.cos(d))
	return Math.exp(-((d / w) ** 2))
}

// DOM: squash toward the press point; pressing the middle squashes down. Nothing is redrawn.
export function jellify(el, { amount = 0.22 } = {}) {
	const s = spring({ k: 600, c: 12 })
	let ax = 0,
		ay = 0,
		raf = 0,
		last = 0
	function tick(t) {
		const dt = Math.min(0.05, (t - (last || t)) / 1000)
		last = t
		const x = s.step(dt)
		const ang = Math.atan2(ay, ax),
			off = Math.min(1, Math.hypot(ax, ay))
		const sq = 1 - amount * x * (0.5 + 0.5 * off),
			st = 1 + amount * 0.5 * x
		const deg = (ang * 180) / Math.PI
		el.style.transform = `translate(${ax * x * 3}px, ${ay * x * 3 + x * 2}px) rotate(${deg}deg) scale(${sq}, ${st}) rotate(${-deg}deg)`
		if (s.settled() && s.target === 0) {
			el.style.transform = ''
			raf = 0
			last = 0
			return
		}
		raf = requestAnimationFrame(tick)
	}
	const go = () => {
		if (!raf) raf = requestAnimationFrame(tick)
	}
	const aim = (e) => {
		const r = el.getBoundingClientRect()
		ax = ((e.clientX - r.left) / r.width - 0.5) * 2
		ay = ((e.clientY - r.top) / r.height - 0.5) * 2
	}
	el.addEventListener('pointerdown', (e) => {
		aim(e)
		s.target = 1
		go()
	})
	el.addEventListener('pointermove', (e) => {
		if (s.target) aim(e)
	})
	for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
		el.addEventListener(ev, () => {
			if (s.target) {
				s.target = 0
				s.v -= 4
				go()
			}
		})
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			ax = ay = 0
			s.target = 1
			go()
			setTimeout(() => {
				s.target = 0
				go()
			}, 90)
		}
	})
	return s
}
