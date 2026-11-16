// Backdrop: the landscape, painted in the heart's hand. Same scene as before (sky, sun, two hills, trees,
// field, grass bank, long shadow) and the same ground palettes, but made the way the eye is made:
// tones are ordered-dithered between a few pigments, edges grow a fur of short strokes, crests get a
// thin scratched rim, and light is a Gaussian that breaks into stipple.
//
// Everything here runs once per resize or ground change, on a small raster (one cell per `px` CSS pixels)
// that is scaled up unsmoothed. Nothing here runs per frame; the view just blits the result.
//
//   paintLandscape(canvas, { W, H, DPR, hy, G })     fill canvas (W*DPR x H*DPR) for ground G, horizon at hy
//   makeWisps(G)                                      -> [[frames...], ...] small squiggle sprites that drift in the sky

const TAU = Math.PI * 2
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// '#rrggbb' or 'rgba(r,g,b,a)' -> [r, g, b, a] in 0..1
function col(s) {
	if (s[0] === '#') { const n = parseInt(s.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1] }
	const m = s.match(/[\d.]+/g).map(Number)
	return [m[0] / 255, m[1] / 255, m[2] / 255, m[3] ?? 1]
}

function rng(seed) {
	let a = seed >>> 0
	return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// smooth value noise, 0..1
function noise2(x, y) {
	const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
	const h = (i, j) => { let n = (i * 374761393 + j * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
	const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
	return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v
}

// A small premultiplied RGBA raster with one tool: the dithered anisotropic Gaussian stroke.
function raster(w, h) {
	const d = new Float32Array(w * h * 4)
	// centre, direction, sigma along and across, colour, alpha; add = light added instead of pigment laid over
	function stroke(cx, cy, ang, sl, ss, c, alpha, add = false, levels = 3) {
		sl = Math.max(0.45, sl); ss = Math.max(0.45, ss)
		const co = Math.cos(ang), si = Math.sin(ang)
		const ex = 2.6 * Math.hypot(sl * co, ss * si), ey = 2.6 * Math.hypot(sl * si, ss * co)
		const x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(w - 1, Math.ceil(cx + ex))
		const y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(h - 1, Math.ceil(cy + ey))
		const il = 1 / (sl * sl), is = 1 / (ss * ss)
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const dx = x - cx, dy = y - cy, u = dx * co + dy * si, v = -dx * si + dy * co
				const gq = Math.exp(-0.5 * (u * u * il + v * v * is)) - 0.034
				if (gq <= 0) continue
				const q = Math.min(1, Math.floor((gq / 0.966) * levels + BAYER[(x & 3) + (y & 3) * 4]) / levels)
				const a = alpha * q
				if (a <= 0) continue
				const o = (y * w + x) * 4
				if (add) { d[o] += c[0] * a; d[o + 1] += c[1] * a; d[o + 2] += c[2] * a; d[o + 3] = Math.min(1, d[o + 3] + a * 0.5) }
				else { const k = 1 - a; d[o] = d[o] * k + c[0] * a; d[o + 1] = d[o + 1] * k + c[1] * a; d[o + 2] = d[o + 2] * k + c[2] * a; d[o + 3] = d[o + 3] * k + a }
			}
		}
	}
	function toCanvas() {
		const cv = document.createElement('canvas')
		cv.width = w; cv.height = h
		const im = new ImageData(w, h), p = im.data
		for (let i = 0; i < w * h; i++) {
			const a = d[i * 4 + 3], k = a > 0 ? 255 / a : 0 // unpremultiply
			p[i * 4] = d[i * 4] * k; p[i * 4 + 1] = d[i * 4 + 1] * k; p[i * 4 + 2] = d[i * 4 + 2] * k; p[i * 4 + 3] = a * 255
		}
		cv.getContext('2d').putImageData(im, 0, 0)
		return cv
	}
	return { d, w, h, stroke, toCanvas }
}

export function paintLandscape(cv, { W, H, DPR, hy, G, px = 2 }) {
	const w = Math.ceil(W / px), h = Math.ceil(H / px), hz = hy / px
	const r = raster(w, h), d = r.d, R = rng(7)
	const k = Math.max(0.35, Math.min(2, (w * h) / 256000)) // stroke counts follow the area
	const sky = G.sky.map(col), sun = col(G.sun), far = col(G.far), near = col(G.near), trees = col(G.trees)
	const field = col(G.field), furrow = col(G.furrow), grass = col(G.grass), grassInk = col(G.grassInk), shadow = col(G.shadow), line = col(G.line)
	const pale = G.dark ? col(G.paper) : mix(sky[2], [1, 1, 1], 0.6)
	const rim = G.dark ? mix(pale, sun, 0.3) : trees // the scratched line along a crest: pale on dark grounds, ink on light
	const sunX = w * 0.86, sunY = hz - h * 0.2, sunR = Math.max(6, Math.min(w, h) * 0.035)

	// the lie of the land, one height per column
	const bump = (x, b) => b.reduce((y, [cx, bw, bh]) => y - bh * Math.exp(-(((x / w - cx) / bw) ** 2)), 0)
	const yFar = new Float32Array(w), yNear = new Float32Array(w), yField = new Float32Array(w), yGrass = new Float32Array(w), yShade = new Float32Array(w)
	const bez = (p0, p1, p2, p3, out, from = -Infinity) => {
		out.fill(1e9)
		let px0 = p0[0], py0 = p0[1]
		for (let i = 1; i <= 400; i++) {
			const t = i / 400, m = 1 - t
			const x = m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0]
			const y = m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]
			for (let xi = Math.max(0, Math.ceil(px0)); xi <= Math.min(w - 1, x); xi++) if (xi >= from) out[xi] = py0 + ((y - py0) * (xi - px0)) / Math.max(1e-6, x - px0)
			px0 = x; py0 = y
		}
	}
	for (let x = 0; x < w; x++) {
		const X = x * px
		yFar[x] = hz + bump(x, [[0.22, 0.28, h * 0.24], [0.78, 0.18, h * 0.09], [1.02, 0.12, h * 0.14]]) + (Math.sin(X * 0.013 + 1.3) * 3 + Math.sin(X * 0.041 + 2.6) * 1.2) / px
		yNear[x] = hz + h * 0.02 + bump(x, [[0.65, 0.22, h * 0.1], [0.05, 0.1, h * 0.05]]) + (Math.sin(X * 0.013 + 4.1) * 2 + Math.sin(X * 0.041 + 0.7) * 0.8) / px
		yField[x] = hz + h * 0.02 + (Math.sin(X * 0.01) * 3) / px
	}
	bez([-5, h * 0.84], [w * 0.3, h * 0.8], [w * 0.6, h * 0.9], [w + 5, hz + h * 0.1], yGrass)
	bez([w * 0.55, h + 5], [w * 0.7, h * 0.9], [w * 0.85, h * 0.86], [w + 5, h * 0.8], yShade, w * 0.55)

	// tone ramps, dark to light; a pixel's tone picks between neighbours through the Bayer matrix
	const ramps = {
		sky: [sky[0], mix(sky[0], sky[1], 0.5), sky[1], mix(sky[1], sky[2], 0.5), sky[2], mix(sky[2], sun, 0.45)],
		far: [mix(far, trees, 0.5), mix(far, trees, 0.2), far, mix(far, sky[2], 0.4), mix(far, sun, 0.45)],
		near: [mix(near, trees, 0.6), mix(near, trees, 0.25), near, mix(near, far, 0.5)],
		field: [mix(field, furrow, 0.6), mix(field, furrow, 0.25), field, mix(field, pale, 0.35)],
		grass: [mix(grass, grassInk, 0.6), mix(grass, grassInk, 0.25), grass, mix(grass, sun, 0.25)],
	}
	ramps.shade = ramps.grass.map((c) => mix(c, shadow, shadow[3]))
	const sunSide = (x) => clamp((sunX - x) / (w * 0.5), -1, 1)
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let ramp, t
			const n = noise2(x * 0.02, y * 0.07), n2 = noise2(x * 0.11 + 9, y * 0.11)
			if (y >= yShade[x]) { ramp = ramps.shade; t = 0.55 - (y - yShade[x]) / (h * 0.3) + n * 0.3 }
			else if (y >= yGrass[x]) { ramp = ramps.grass; t = 0.75 - (y - yGrass[x]) / (h * 0.35) + n2 * 0.35 }
			else if (y >= yField[x]) {
				ramp = ramps.field
				t = 0.5 + n * 0.3 + 0.3 * Math.exp(-(((x - sunX) / (w * 0.18)) ** 2)) - ((y - yField[x]) / (h * 0.5)) * 0.4
			} else if (y >= yNear[x]) {
				const sl = yNear[Math.min(w - 1, x + 2)] - yNear[Math.max(0, x - 2)]
				ramp = ramps.near; t = 0.7 - (y - yNear[x]) / (h * 0.09) - sl * 0.12 * clamp((sunX - x) / (w * 0.06), -1, 1) + n2 * 0.25
			} else if (y >= yFar[x]) {
				const sl = yFar[Math.min(w - 1, x + 2)] - yFar[Math.max(0, x - 2)]
				ramp = ramps.far; t = 0.78 - (y - yFar[x]) / (h * 0.2) - sl * 0.16 * clamp((sunX - x) / (w * 0.06), -1, 1) + n * 0.22 + 0.1 * sunSide(x)
			} else {
				const ds = Math.hypot(x - sunX, (y - sunY) * 1.25)
				ramp = ramps.sky; t = Math.pow(y / hz, 1.3) * 0.8 + (n - 0.5) * 0.3 + 0.45 * Math.exp(-(ds * ds) / (2 * (sunR * 4.5) ** 2))
			}
			const f = clamp(t) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(f))
			const c = f - i > BAYER[(x & 3) + (y & 3) * 4] ? ramp[i + 1] : ramp[i]
			const o = (y * w + x) * 4
			d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 1
		}
	}

	const up = -Math.PI / 2
	const light = G.dark // on dark grounds glow is added light; on light ones it is pigment
	// sky: stars, long wisps, and the wandering line dissolving into stipple
	if (G.dark) for (let i = 0; i < 110 * k; i++) { const x = R() * w, y = R() * R() * hz * 0.8; if (y < yFar[x | 0] - 4) r.stroke(x, y, 0, 0.45, 0.45, pale, 0.25 + R() * 0.5, true, 2) }
	for (let i = 0; i < 12 * k; i++) {
		const cx = R() * w, cy = h * 0.04 + R() * (hz - h * 0.28), tilt = (R() - 0.5) * 0.25, c = mix(sky[2], R() < 0.5 ? sun : pale, 0.35 + R() * 0.3)
		for (let j = 0, n = 10 + R() * 22; j < n; j++) {
			const x = cx + (R() - 0.5) * 90, y = cy + (x - cx) * tilt * 0.4 + (R() - 0.5) * 9
			if (x * px < 300 && y * px < 220) continue // keep the title's corner calm
			if (y < yFar[clamp(x | 0, 0, w - 1)] - 3) r.stroke(x, y, tilt + (R() - 0.5) * 0.15, 5 + R() * 16, 0.5 + R() * 0.4, c, 0.08 + R() * 0.2, light)
		}
	}
	{
		let x = -4, y = Math.max(h * 0.3, hz - h * 0.25), a = 0, da = 0
		const y0 = Math.max(h * 0.24, hz - h * 0.36), y1 = hz - h * 0.14
		for (let i = 0; i < 6000 && x < w + 4; i++) {
			da = da * 0.95 + (R() - 0.5) * 0.04
			if (R() < 0.003) da += (R() < 0.5 ? -1 : 1) * 0.4
			a += da; a -= Math.sin(a) * 0.012
			if (y < y0) a += 0.05
			if (y > y1) a -= 0.05
			x += Math.cos(a) * 1.2; y += Math.sin(a) * 1.2
			const al = clamp(noise2(i * 0.02, 3.3) * 1.6 - 0.35) * line[3]
			if (al > 0.02) r.stroke(x, y, a, 1.1, 0.45, line, al, false, 2)
		}
	}
	// sun: a halo, a core, and lashes, the way the iris is built
	r.stroke(sunX, sunY, 0, sunR * 2.4, sunR * 2.4, sun, 0.3, light, 4)
	for (let i = 0; i < 90; i++) {
		const a = R() * TAU, rr = sunR * (1.15 + R() * 1.5)
		r.stroke(sunX + Math.cos(a) * rr, sunY + Math.sin(a) * rr, a, sunR * (0.2 + R() * 0.5), 0.45, mix(sun, pale, R() * 0.5), 0.2 + R() * 0.35, light)
	}
	r.stroke(sunX, sunY, 0, sunR * 0.62, sunR * 0.62, sun, 1, false, 4)
	r.stroke(sunX - sunR * 0.15, sunY - sunR * 0.15, 0, sunR * 0.3, sunR * 0.3, mix(sun, pale, 0.6), 0.7, light, 3)

	// a crest: fur of short strokes standing off it, then the scratched rim along it
	function crest(ys, x0, x1, body, lift, furA, rimA) {
		for (let x = x0; x < x1; x += 0.7) {
			const xi = clamp(x | 0, 1, w - 2), y = ys[xi], tan = Math.atan2(ys[xi + 1] - ys[xi - 1], 2)
			if (y > h + 2) continue
			if (R() < 0.75) r.stroke(x, y - R() * 1.5, tan + up + (R() - 0.5) * 0.9, 1 + R() * 2.6, 0.45, mix(body, lift, R() * 0.6), furA * (0.4 + R() * 0.6))
			if (rimA && R() < 0.8) r.stroke(x, y, tan, 1.6, 0.45, rim, rimA * (0.5 + 0.5 * noise2(x * 0.05, 1.7)), false, 2)
		}
	}
	// cross-hatching inside a region, where it is in shade
	function hatch(n, top, bottom, ang, c, a, len) {
		for (let i = 0; i < n; i++) {
			const x = R() * w, xi = x | 0, t0 = top[xi], b0 = Math.min(bottom[xi], h)
			if (b0 - t0 < 3) continue
			const y = t0 + 2 + R() * R() * (b0 - t0 - 2) + (b0 - t0) * 0.25 * R()
			if (y < b0) r.stroke(x, y, ang + (R() - 0.5) * 0.25, len * (0.6 + R()), 0.45, c, a * (0.4 + R() * 0.6))
		}
	}
	const farBottom = yNear.map((v, i) => Math.min(v, yField[i]))
	hatch(700 * k, yFar, farBottom, 0.95, mix(far, trees, 0.75), 0.5, 3.5)
	crest(yFar, 0, w, far, G.dark ? sky[2] : pale, 0.55, 0.75)
	hatch(260 * k, yNear, yField, 0.95, trees, 0.45, 3)
	crest(yNear, 0, w, near, far, 0.5, 0.45)
	// trees: dark domes with a bristle on top and a lit edge toward the sun
	for (let i = 0; i < 26; i++) {
		const x = R() * w, y = hz + h * 0.02 - R() * h * 0.03, rr = (6 + R() * Math.max(10, Math.min(W, H) * 0.03)) / px
		if (y < yNear[clamp(x | 0, 0, w - 1)] - rr) continue
		r.stroke(x, y, 0, rr * 0.62, rr * 0.5, trees, 1, false, 4)
		for (let j = 0; j < rr * 9; j++) {
			const a = -Math.PI * R(), ex = Math.cos(a) * rr, ey = Math.sin(a) * rr * 0.85
			const lit = Math.cos(a) * Math.sign(sunX - x) > 0.2
			r.stroke(x + ex, y + ey, a + (R() - 0.5) * 0.6, 0.8 + R() * 1.8, 0.45, lit ? mix(trees, rim, 0.3) : trees, lit ? 0.5 : 0.8)
		}
	}
	// field: furrows drawn as broken strokes, stubble between them
	for (let j = 1; j < 14; j++) {
		const yy = (j * j * 1.6) / px
		for (let x = -2; x < w + 2; x += 2.2) {
			const xi = clamp(x | 0, 0, w - 1), u = x / w
			const y = yField[xi] + yy + (-4 * 3 * u * (1 - u) * (1 - u) + 6 * 3 * u * u * (1 - u) + 2 * u * u * u) / px
			if (y < yGrass[xi] && noise2(x * 0.06, j * 3.1) > 0.28) r.stroke(x, y, (R() - 0.5) * 0.12, 1.6, 0.45, furrow, Math.min(1, furrow[3] * 2.2) * (0.5 + R() * 0.5), false, 2)
		}
	}
	for (let i = 0; i < 1300 * k; i++) {
		const x = R() * w, xi = x | 0, y = yField[xi] + R() * (Math.min(yGrass[xi], h) - yField[xi])
		if (y < yGrass[xi]) r.stroke(x, y, up + (R() - 0.5) * 0.5, 0.8 + R() * 1.2, 0.45, mix(field, R() < 0.5 ? furrow : pale, 0.5), 0.35)
	}
	// grass: blades, a furred bank, and the long shadow hatched across it
	crest(yGrass, 0, w, grass, mix(grass, sun, 0.4), 0.7, 0)
	for (let i = 0; i < 2600 * k; i++) {
		const x = R() * w, xi = x | 0, y = yGrass[xi] + R() * (h - yGrass[xi])
		if (y > h || y < yGrass[xi]) continue
		const sh = y >= yShade[xi]
		r.stroke(x, y, up + 0.2 + (R() - 0.5) * 0.6, 1.2 + R() * 2.4, 0.45, sh ? mix(shadow, grass, R() * 0.4) : mix(grass, R() < 0.55 ? grassInk : sun, 0.25 + R() * 0.45), sh ? 0.5 : 0.55)
	}
	crest(yShade, Math.floor(w * 0.55), w, mix(grass, shadow, shadow[3]), shadow, 0.6, 0)
	hatch(500 * k, yShade, new Float32Array(w).fill(h), 0.6, mix(shadow, trees, 0.5), 0.4, 4)

	cv.width = W * DPR
	cv.height = H * DPR
	const c = cv.getContext('2d')
	c.imageSmoothingEnabled = false
	c.drawImage(r.toCanvas(), 0, 0, w, h, 0, 0, w * px * DPR, h * px * DPR)
}

// Squiggles for the sky: a soft head and a curling tail of strokes, a few frames each so they wriggle.
// Low contrast on purpose: they are weather, not objects.
export function makeWisps(G, { kinds = 3, frames = 4 } = {}) {
	const sky = col(G.sky[1]), sun = col(G.sun), mark = col(G.mark), pale = G.dark ? col(G.paper) : mark
	const body = G.dark ? mix(sky, pale, 0.5) : mix(sky, mark, 0.5), tip = G.dark ? mix(sun, pale, 0.4) : mix(sky, mark, 0.75)
	const out = []
	for (let kd = 0; kd < kinds; kd++) {
		const R0 = rng(31 + kd * 17), len = 26 + R0() * 16, amp = 3 + R0() * 3, waves = 1.4 + R0() * 1.2, set = []
		for (let f = 0; f < frames; f++) {
			const w = Math.ceil(len + 14), h = 26, r = raster(w, h), R = rng(5 + kd), ph = (f / frames) * TAU
			for (let i = 0; i < 70; i++) {
				const u = i / 70, x = w - 8 - u * len, taper = Math.pow(u, 0.7)
				const y = h / 2 + Math.sin(u * waves * TAU + ph) * amp * taper
				const dy = Math.cos(u * waves * TAU + ph) * amp * taper * waves * TAU / len
				r.stroke(x + (R() - 0.5), y + (R() - 0.5) * 1.5, Math.atan2(-dy, 1) + (R() - 0.5) * 0.5, 1.2 + R() * 1.6, 0.45 + (1 - u) * 0.5, mix(body, tip, R() * 0.5), (0.5 - 0.4 * u) * (0.5 + R() * 0.5))
			}
			r.stroke(w - 8, h / 2, 0, 2.3, 2, body, 0.6, false, 3)
			r.stroke(w - 7.4, h / 2 - 0.4, 0, 1, 1, tip, 0.7, false, 2)
			set.push(r.toCanvas())
		}
		out.push(set)
	}
	return out
}
