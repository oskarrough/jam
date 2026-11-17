// Helpers shared by the instruments: timing, pointer, drawing, and small synth parts.

export const SLOTS = 64 // 4 sub-slots per 16th step

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)
export const TAU = Math.PI * 2

// xorshift: same seed, same motion on every client
export function rng(seed = 1) {
	let s = seed >>> 0 || 1
	return () => {
		s ^= s << 13
		s ^= s >>> 17
		s ^= s << 5
		return (s >>> 0) / 4294967296
	}
}

export function subSlots(i, time, dur, steps, fn) {
	const per = SLOTS / steps
	const a = Math.ceil(i * per - 1e-9),
		b = Math.ceil((i + 1) * per - 1e-9)
	for (let s = a; s < b; s++) fn(s, time + (s / per - i) * dur)
}

export const absOf = (clock, time) => Math.round((time - clock.startTime) / clock.stepDur)

export const absNow = (clock) =>
	clock.abs
		? clock.abs()
		: clock.playing === false
			? clock.pos()
			: (clock.now() - clock.startTime) / clock.stepDur

export function view(clock) {
	const pos = clock.pos()
	return {
		pos,
		abs: absNow(clock),
		now: clock.now(),
		playing: clock.playing ?? true,
		steps: clock.steps,
		phase: pos / clock.steps,
	}
}

export const THEME = {
	fg: '#ece6dc',
	dim: 'rgba(236,230,220,0.32)',
	faint: 'rgba(236,230,220,0.09)',
	accent: '#ff7a3d',
	font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
}
export function tint(c, a) {
	if (c[0] === '#') {
		const n = parseInt(c.slice(1), 16)
		return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
	}
	return c.replace(/rgba?\(([^,]+),([^,]+),([^,)]+).*\)/, `rgba($1,$2,$3,${a})`)
}
export const theme = (ctx) => ({
	...THEME,
	...(ctx.theme || {}),
	...(typeof ctx.color === 'string' ? { accent: ctx.color } : {}),
})

export function intersect(x1, y1, x2, y2, x3, y3, x4, y4) {
	const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
	if (Math.abs(d) < 1e-9) return null
	const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d
	const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d
	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

export function segDist(px, py, x1, y1, x2, y2) {
	const dx = x2 - x1,
		dy = y2 - y1
	const l = dx * dx + dy * dy || 1e-9
	const t = clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1)
	return dist(px, py, x1 + t * dx, y1 + t * dy)
}

export function flashes() {
	const m = new Map()
	return {
		hit(key, time) {
			m.set(key, time)
		},
		glow(key, now, len = 0.35) {
			const t = m.get(key)
			if (t === undefined || now < t) return 0
			return Math.max(0, 1 - (now - t) / len)
		},
	}
}

// Normalise host pointer events; `size` is [w, h] kept current from frame(), since hosts may not send seat size.
export function withPointer(size, fn) {
	let pressed = false
	return (e) => {
		if (e.type === 'down') pressed = true
		const w = e.w ?? size[0],
			h = e.h ?? size[1]
		const ev = {
			...e,
			pressed: e.pressed ?? pressed,
			w,
			h,
			px: e.px ?? e.x * w,
			py: e.py ?? e.y * h,
		}
		if (e.type === 'up' || e.type === 'cancel') pressed = false
		return fn(ev)
	}
}

// true when drawing the ring summary: the host says so (shape 'ring' | 'sheet'); older hosts only give a size
export const isStrip = (w, h, shape) => (shape ? shape === 'ring' : w > h * 2.5)

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)

export function fit(arr, n, fill) {
	if (!arr || !arr.length) return new Array(n).fill(fill)
	if (arr.length === n) return arr
	return Array.from({ length: n }, (_, i) => arr[i % arr.length])
}

export const val = (p) => (p && typeof p === 'object' && 'value' in p ? p.value : p)

export function env(g, t, a, peak, dec) {
	g.gain.setValueAtTime(0.0001, t)
	g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a)
	g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec)
}

export function osc(ac, type, f, t, dur, dest) {
	const o = ac.createOscillator()
	o.type = type
	o.frequency.value = f
	o.connect(dest)
	o.start(t)
	o.stop(t + dur)
	return o
}

const noiseCache = new WeakMap()
function noise(ac) {
	let b = noiseCache.get(ac)
	if (!b) {
		b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
		const d = b.getChannelData(0)
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
		noiseCache.set(ac, b)
	}
	return b
}
export function noiseSrc(ac, t, dur, dest) {
	const n = ac.createBufferSource()
	n.buffer = noise(ac)
	n.connect(dest)
	n.start(t, Math.random() * 0.5)
	n.stop(t + dur)
}

export const rnd = (n) => Math.floor(Math.random() * n)

export function rgba(hex, a) {
	const n = parseInt(hex.slice(1), 16)
	return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

// The host draws the playhead. Set `playhead` on the module: 'x' (default), 'y', or false
// when time isn't a straight axis; then show it your own way.
export const playhead = {
	under(g, w, h, clock, { color, axis = 'x' }) {
		const n = clock.steps,
			pos = clock.pos(),
			L = axis === 'y' ? h : w,
			cell = L / n,
			at = (pos / n) * L
		const trail = Math.min(L * 0.25, cell * 4)
		const band = (a, b, fill) => {
			g.fillStyle = fill
			axis === 'y' ? g.fillRect(0, a, w, b - a) : g.fillRect(a, 0, b - a, h)
		}
		for (const shift of [0, L]) {
			// wraps round the loop start
			const a = at - trail + shift,
				b = at + shift
			if (b <= 0 || a >= L) continue
			const gr =
				axis === 'y' ? g.createLinearGradient(0, a, 0, b) : g.createLinearGradient(a, 0, b, 0)
			gr.addColorStop(0, rgba(color, 0))
			gr.addColorStop(1, rgba(color, 0.2))
			band(a, b, gr)
		}
		const s = Math.floor(pos) % n
		band(s * cell, (s + 1) * cell, rgba(color, 0.14))
	},
	over(g, w, h, clock, { color, ink, axis = 'x' }) {
		const n = clock.steps,
			at = (clock.pos() / n) * (axis === 'y' ? h : w),
			k = 6
		g.save()
		g.shadowColor = color
		g.shadowBlur = 14
		g.fillStyle = ink
		if (axis === 'y') {
			g.fillRect(0, at - 1.25, w, 2.5)
			g.beginPath()
			g.moveTo(0, at - k)
			g.lineTo(k * 1.4, at)
			g.lineTo(0, at + k)
			g.moveTo(w, at - k)
			g.lineTo(w - k * 1.4, at)
			g.lineTo(w, at + k)
			g.fill()
		} else {
			g.fillRect(at - 1.25, 0, 2.5, h)
			g.beginPath()
			g.moveTo(at - k, 0)
			g.lineTo(at, k * 1.4)
			g.lineTo(at + k, 0)
			g.moveTo(at - k, h)
			g.lineTo(at, h - k * 1.4)
			g.lineTo(at + k, h)
			g.fill()
		}
		g.restore()
	},
}
