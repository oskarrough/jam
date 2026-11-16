// Small helpers shared by the built-in instruments.

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
