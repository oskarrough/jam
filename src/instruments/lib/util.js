// Helpers shared by the instruments: timing, pointer, drawing, and small synth parts.

export const SLOTS = 64 // 4 sub-slots per 16th step

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)
export const TAU = Math.PI * 2

// xorshift, deterministic so every client derives the same motion from the same seed
export function rng(seed = 1) {
  let s = (seed >>> 0) || 1
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

// call fn(slot, time) for each of the SLOTS that fall inside step i of a loop of `steps`
export function subSlots(i, time, dur, steps, fn) {
  const per = SLOTS / steps
  const a = Math.ceil(i * per - 1e-9), b = Math.ceil((i + 1) * per - 1e-9)
  for (let s = a; s < b; s++) fn(s, time + (s / per - i) * dur)
}

// absolute step index (since the clock started) for an audio time
export const absOf = (clock, time) => Math.round((time - clock.startTime) / clock.stepDur)

// fractional absolute step right now
export const absNow = (clock) =>
  clock.abs ? clock.abs() : clock.playing === false ? clock.pos() : (clock.now() - clock.startTime) / clock.stepDur

// what frame() needs from the clock facade
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
// '#rrggbb' or 'rgba(...)' at alpha a
export function tint(c, a) {
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }
  return c.replace(/rgba?\(([^,]+),([^,]+),([^,)]+).*\)/, `rgba($1,$2,$3,${a})`)
}
export const theme = (ctx) => ({ ...THEME, ...(ctx.theme || {}), ...(typeof ctx.color === 'string' ? { accent: ctx.color } : {}) })

// intersection of segments p1-p2 and p3-p4; returns t along p1-p2 or null
export function intersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(d) < 1e-9) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

// distance from point to segment
export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const l = dx * dx + dy * dy || 1e-9
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1)
  return dist(px, py, x1 + t * dx, y1 + t * dy)
}

// flash bookkeeping: remember audio times of hits, read back a 0..1 glow
export function flashes() {
  const m = new Map()
  return {
    hit(key, time) { m.set(key, time) },
    glow(key, now, len = 0.35) {
      const t = m.get(key)
      if (t === undefined || now < t) return 0
      return Math.max(0, 1 - (now - t) / len)
    },
  }
}

// Normalise pointer events from any host: tracks `pressed`, fills in pixel coords
// (px, py, w, h) when the host only sends normalised x/y. `size` is a [w, h] array
// the instrument keeps current from frame(), since hosts may not send lane size.
export function withPointer(size, fn) {
  let pressed = false
  return (e) => {
    if (e.type === 'down') pressed = true
    const w = e.w ?? size[0], h = e.h ?? size[1]
    const ev = { ...e, pressed: e.pressed ?? pressed, w, h, px: e.px ?? e.x * w, py: e.py ?? e.y * h }
    if (e.type === 'up' || e.type === 'cancel') pressed = false
    return fn(ev)
  }
}

// true when drawing the ring summary: the host says so (shape 'ring' | 'sheet'); older hosts only give a size
export const isStrip = (w, h, shape) => (shape ? shape === 'ring' : w > h * 2.5)

// ── synth parts and per-step arrays (used by bass, keys, bell, drums)

export const SCALE = [0, 3, 5, 7, 10, 12, 15, 17] // A minor pentatonic, 8 degrees
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)

/** Resize a per-step array to n steps by repeating its content (16 -> 32 doubles the bar). */
export function fit(arr, n, fill) {
	if (!arr || !arr.length) return new Array(n).fill(fill)
	if (arr.length === n) return arr
	return Array.from({ length: n }, (_, i) => arr[i % arr.length])
}

/** Read a param value whether it was declared as a plain default or a {value, ...} descriptor. */
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
export function noise(ac) {
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

/** "#rrggbb" + alpha -> rgba() */
export function rgba(hex, a) {
	const n = parseInt(hex.slice(1), 16)
	return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
