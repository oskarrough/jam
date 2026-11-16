// Heart: a Möbius band of Gaussian splats turning round a stippled eye, on its own WebGL2 canvas.
// geom() -> {x, y, r} in CSS px or null to hide. The comet comes home every second loop (one-sided band).

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aC;
layout(location=2) in vec3 aU;
layout(location=3) in vec3 aV;
layout(location=4) in vec4 aCol;
layout(location=5) in float aAdd;
uniform float uZoom, uDist, uMinVar;
out vec2 vQ;
out vec4 vCol;
out float vAdd;
const float CUT = 2.6;
void main() {
	float iz = 1.0 / (uDist - aC.z), s = uDist * iz;
	vec2 c = aC.xy * s;
	vec2 u = (aU.xy + aC.xy * aU.z * iz) * s;
	vec2 v = (aV.xy + aC.xy * aV.z * iz) * s;
	float a = u.x * u.x + v.x * v.x + uMinVar, b = u.x * u.y + v.x * v.y, d = u.y * u.y + v.y * v.y + uMinVar;
	float mid = 0.5 * (a + d), rad = sqrt(max(0.25 * (a - d) * (a - d) + b * b, 1e-14));
	float l1 = mid + rad, l2 = max(mid - rad, uMinVar * 0.5);
	vec2 e1 = abs(b) > 1e-9 ? normalize(vec2(b, l1 - a)) : (a >= d ? vec2(1., 0.) : vec2(0., 1.));
	vec2 e2 = vec2(-e1.y, e1.x);
	vec2 p = c + aCorner.x * CUT * sqrt(l1) * e1 + aCorner.y * CUT * sqrt(l2) * e2;
	vQ = aCorner * CUT;
	vCol = aCol;
	vAdd = aAdd;
	gl_Position = vec4(p * uZoom, 0., 1.);
}`

const FS = `#version 300 es
precision mediump float;
in vec2 vQ;
in vec4 vCol;
in float vAdd;
uniform float uLevels, uDither;
out vec4 o;
float bayer(vec2 p) {
	ivec2 i = ivec2(p) & 3;
	const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
	return (m[i.x + i.y * 4] + 0.5) / 16.;
}
void main() {
	float g = (exp(-0.5 * dot(vQ, vQ)) - 0.034) / 0.966;
	if (g <= 0.) discard;
	float q = min(1., floor(g * uLevels + bayer(gl_FragCoord.xy)) / uLevels);
	g = mix(g, q, uDither);
	float a = vCol.a * g;
	if (a <= 0.) discard;
	o = vec4(vCol.rgb * a, a * (1. - vAdd));
}`

const TAU = Math.PI * 2
const STRIDE = 14
const mod = (a, n) => ((a % n) + n) % n
const hex = (h) => {
	const n = parseInt(h.slice(1), 16)
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const mixHex = (a, b, t) => {
	const x = hex(a),
		y = hex(b)
	return (
		'#' +
		x
			.map((v, i) =>
				Math.round((v + (y[i] - v) * t) * 255)
					.toString(16)
					.padStart(2, '0'),
			)
			.join('')
	)
}
const randn = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 0.87

export function createHeart({ engine, geom, after = document.querySelector('canvas') }) {
	const opts = {
		on: true,
		scale: 0.86,
		reach: 2.2,
		pixel: 1.5,
		levels: 3,
		dither: 0.85,
		// blend: 0 = pigment laid over the ground (paper), 1 = light added to it (dusk)
		additive: 0,
		spin: 0.22,
		tilt: 0.8,
		breathe: 0.22,
		ripple: 0.05,
		radius: 0.62,
		width: 0.26,
		hatch: 0.8,
		outline: 0.9,
		body: 0.6,
		sensitivity: 1,
		burst: 26,
		fling: 1,
		moteLife: 2,
		moteSize: 1,
		eye: 1,
		gaze: 0.17,
		shadow: 0.35,
		ochre: '#e0a63a',
		rose: '#cf6f9a',
		violet: '#5a3f8e',
		cream: '#f3e8cf',
		ink: '#211a2e',
		shade: '#211a2e',
		comet: '#d24b2a',
		scratch: false,
		// chamber off = sit on the view's ground
		chamber: true,
		well: '#211943',
		engrave: 0.2,
		// counts: changing them rebuilds
		nBody: 2400,
		nHatch: 1500,
		nEdge: 800,
		nComet: 220,
		nCore: 260,
		nMotes: 1400,
	}
	const stats = { splats: 0, ms: 0 }

	let ground = ''
	function setGround(h, { ink = '#211a2e', pale = '#f3e8cf' } = {}) {
		if (!/^#[0-9a-f]{6}$/i.test(h || '') || h === ground) return
		ground = h
		const [r, g, b] = hex(h),
			lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
		const dark = lum < 0.32
		opts.ink = dark ? pale : ink
		opts.cream = dark ? pale : mixHex(h, '#ffffff', 0.55)
		opts.additive = dark ? 0.55 : 0
		opts.scratch = dark
		opts.shadow = dark ? 0.18 : 0.35
		opts.shade = dark ? mixHex(h, '#000000', 0.35) : ink
		gui?.controllersRecursive().forEach((c) => c.updateDisplay())
	}
	let gui = null
	const stub = { opts, stats, canvas: null, addGui() {}, destroy() {} }

	const canvas = document.createElement('canvas')
	canvas.setAttribute('aria-hidden', 'true')
	Object.assign(canvas.style, {
		position: 'fixed',
		pointerEvents: 'none',
		imageRendering: 'pixelated',
		left: '0',
		top: '0',
	})
	const gl = canvas.getContext('webgl2', {
		alpha: true,
		premultipliedAlpha: true,
		antialias: false,
		depth: false,
		stencil: false,
	})
	if (!gl) return stub
	after ? after.after(canvas) : document.body.prepend(canvas)
	const well = document.createElement('div')
	well.setAttribute('aria-hidden', 'true')
	Object.assign(well.style, {
		position: 'fixed',
		left: '0',
		top: '0',
		pointerEvents: 'none',
		borderRadius: '50%',
	})
	canvas.before(well)
	let wellKey = ''
	function paintWell() {
		const e = opts.engrave,
			key = opts.well + e
		if (wellKey === key) return
		wellKey = key
		const pale = 'rgba(243,232,207,'
		well.style.background = [
			'radial-gradient(circle at 50% 47%, rgba(255,205,140,.20), rgba(255,205,140,0) 38%)',
			`repeating-radial-gradient(circle, ${pale}${(0.06 * e).toFixed(4)}) 0 1px, ${pale}0) 1px 6px)`,
			`repeating-conic-gradient(${pale}${(0.045 * e).toFixed(4)}) 0 1deg, ${pale}0) 1deg 5deg)`,
			`radial-gradient(circle, ${mixHex(opts.well, '#ffffff', 0.14)} 0%, ${opts.well} 50%, ${mixHex(opts.well, '#000000', 0.55)} 100%)`,
		].join(',')
		well.style.boxShadow = `inset 0 0 0 1.5px ${mixHex(opts.well, '#000000', 0.6)}, inset 0 10px 26px rgba(0,0,0,.55)`
	}

	function shader(type, src) {
		const s = gl.createShader(type)
		gl.shaderSource(s, src)
		gl.compileShader(s)
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
		return s
	}
	const prog = gl.createProgram()
	gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS))
	gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS))
	gl.linkProgram(prog)
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
	gl.useProgram(prog)
	const U = Object.fromEntries(
		['uZoom', 'uDist', 'uMinVar', 'uLevels', 'uDither'].map((k) => [
			k,
			gl.getUniformLocation(prog, k),
		]),
	)

	const vao = gl.createVertexArray()
	gl.bindVertexArray(vao)
	const quad = gl.createBuffer()
	gl.bindBuffer(gl.ARRAY_BUFFER, quad)
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
	gl.enableVertexAttribArray(0)
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
	const inst = gl.createBuffer()
	gl.bindBuffer(gl.ARRAY_BUFFER, inst)
	;[
		[1, 3, 0],
		[2, 3, 3],
		[3, 3, 6],
		[4, 4, 9],
		[5, 1, 13],
	].forEach(([loc, size, off]) => {
		gl.enableVertexAttribArray(loc)
		gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4)
		gl.vertexAttribDivisor(loc, 1)
	})
	gl.disable(gl.DEPTH_TEST)
	gl.enable(gl.BLEND)
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

	const BODY = 0,
		HATCH = 1,
		EDGE = 2
	let band, comet, core, shade, motes, scratch, sorted, zs, order, cap
	function build() {
		const nb = opts.nBody + opts.nHatch + opts.nEdge
		band = {
			n: nb,
			kind: new Uint8Array(nb),
			w: new Float32Array(nb),
			th: new Float32Array(nb),
			c: new Float32Array(nb),
			s: new Float32Array(nb),
			c2: new Float32Array(nb),
			s2: new Float32Array(nb),
			rnd: new Float32Array(nb),
			size: new Float32Array(nb),
		}
		for (let i = 0; i < nb; i++) {
			const kind = i < opts.nBody ? BODY : i < opts.nBody + opts.nHatch ? HATCH : EDGE
			const th = Math.random() * TAU
			band.kind[i] = kind
			band.th[i] = th
			band.w[i] =
				kind === EDGE
					? (Math.random() < 0.5 ? -1 : 1) * (0.97 + Math.random() * 0.05)
					: kind === HATCH
						? (Math.random() - 0.5) * 0.9
						: (Math.random() * 2 - 1) * 0.92
			band.c[i] = Math.cos(th)
			band.s[i] = Math.sin(th)
			band.c2[i] = Math.cos(th / 2)
			band.s2[i] = Math.sin(th / 2)
			band.rnd[i] = Math.random()
			band.size[i] = 0.7 + Math.random() * 0.6
		}
		comet = {
			n: opts.nComet,
			lag: new Float32Array(opts.nComet),
			dw: new Float32Array(opts.nComet),
			rnd: new Float32Array(opts.nComet),
		}
		for (let i = 0; i < comet.n; i++) {
			comet.lag[i] = Math.pow(Math.random(), 2.2) * 1.5
			comet.dw[i] = randn() * 0.22
			comet.rnd[i] = Math.random()
		}
		const nPupil = Math.round(opts.nCore * 0.16)
		core = {
			n: opts.nCore + nPupil,
			nGlow: opts.nCore,
			p: new Float32Array((opts.nCore + nPupil) * 3),
			rnd: new Float32Array(opts.nCore + nPupil),
		}
		for (let i = 0; i < core.n; i++) {
			for (let k = 0; k < 3; k++) core.p[i * 3 + k] = randn()
			core.rnd[i] = Math.random()
		}
		shade = {
			n: 140,
			x: new Float32Array(140),
			y: new Float32Array(140),
			rnd: new Float32Array(140),
		}
		for (let i = 0; i < shade.n; i++) {
			const a = Math.random() * TAU,
				r = Math.sqrt(Math.random())
			shade.x[i] = Math.cos(a) * r
			shade.y[i] = Math.sin(a) * r
			shade.rnd[i] = Math.random()
		}
		const nm = opts.nMotes
		motes = {
			n: nm,
			next: 0,
			p: new Float32Array(nm * 3),
			v: new Float32Array(nm * 3),
			col: new Float32Array(nm * 3),
			life: new Float32Array(nm),
			max: new Float32Array(nm),
			size: new Float32Array(nm),
		}
		cap = band.n + comet.n + core.n + shade.n + nm
		scratch = new Float32Array(cap * STRIDE)
		sorted = new Float32Array(cap * STRIDE)
		zs = new Float32Array(cap)
		order = new Uint32Array(cap)
		gl.bindBuffer(gl.ARRAY_BUFFER, inst)
		gl.bufferData(gl.ARRAY_BUFFER, sorted.byteLength, gl.DYNAMIC_DRAW)
	}
	build()

	let count = 0
	function put(z, cx, cy, cz, ux, uy, uz, vx, vy, vz, r, g, b, a, add) {
		if (a < 0.004 || count >= cap) return
		const o = count * STRIDE
		scratch[o] = cx
		scratch[o + 1] = cy
		scratch[o + 2] = cz
		scratch[o + 3] = ux
		scratch[o + 4] = uy
		scratch[o + 5] = uz
		scratch[o + 6] = vx
		scratch[o + 7] = vy
		scratch[o + 8] = vz
		scratch[o + 9] = r
		scratch[o + 10] = g
		scratch[o + 11] = b
		scratch[o + 12] = a
		scratch[o + 13] = add
		zs[count] = z
		order[count] = count
		count++
	}

	const { clock } = engine.transport
	const taps = engine.seats.map((L) => {
		const an = engine.audio.createAnalyser()
		an.fftSize = 256
		an.smoothingTimeConstant = 0.3
		L.out.connect(an)
		return { L, an, td: new Float32Array(256), fd: new Uint8Array(128), env: 0, slow: 0, last: 0 }
	})
	let level = 0,
		thump = 0
	function listen(dt, now) {
		let sum = 0,
			low = 0
		for (const t of taps) {
			t.an.getFloatTimeDomainData(t.td)
			let s = 0
			for (let i = 0; i < 256; i++) s += t.td[i] * t.td[i]
			const rms = Math.sqrt(s / 256)
			const rise = rms - t.slow * 1.4 - 0.006 / opts.sensitivity
			if (rise > 0 && now - t.last > 90) {
				t.last = now
				emit(t.L, Math.min(1, rise * 10 * opts.sensitivity))
			}
			t.slow += (rms - t.slow) * Math.min(1, dt * 9)
			t.env = Math.max(rms, t.env * Math.pow(0.02, dt))
			sum += t.env
			t.an.getByteFrequencyData(t.fd)
			low = Math.max(low, (t.fd[0] + t.fd[1] + t.fd[2]) / 765)
		}
		level = Math.min(1, sum * 2.2 * opts.sensitivity)
		thump = Math.max(low * low, thump * Math.pow(0.01, dt))
	}

	const head = { p: [0, 0, 0], t: [1, 0, 0], n: [0, 0, 1] }

	// a glance holds briefly; after a quiet spell the eye drifts home
	const gaze = { x: 0, y: 0, tx: 0, ty: 0, hold: 0, at: 0 }
	// matches the view: first seat bottom-left, then round
	const seatAngle = (i) =>
		opts.seatAngle ? opts.seatAngle(i) : Math.PI * 0.75 - (i * TAU) / engine.seats.length
	function glance(i, holdMs = 280) {
		const now = performance.now()
		if (now < gaze.hold && holdMs <= 280) return
		const a = seatAngle(i)
		gaze.tx = Math.cos(a) * opts.gaze
		gaze.ty = -Math.sin(a) * opts.gaze
		gaze.hold = now + holdMs
		gaze.at = now
	}
	function emit(L, strength) {
		glance(L.index)
		const n = Math.round(opts.burst * (0.25 + strength) * (reduce ? 0.3 : 1))
		const [r, g, b] = hex(L.color)
		const m = motes
		for (let k = 0; k < n; k++) {
			const i = m.next
			m.next = (m.next + 1) % m.n
			const sp = (0.35 + Math.random() * 1.1) * opts.fling,
				nn = randn() * 0.45 * opts.fling
			for (let a = 0; a < 3; a++) {
				m.p[i * 3 + a] = head.p[a] + randn() * 0.04
				m.v[i * 3 + a] = head.t[a] * sp + head.n[a] * nn + randn() * 0.14
			}
			m.col[i * 3] = r
			m.col[i * 3 + 1] = g
			m.col[i * 3 + 2] = b
			m.max[i] = m.life[i] = opts.moteLife * (0.45 + Math.random() * 0.8)
			m.size[i] = (0.6 + Math.random() * 0.9) * (0.7 + strength * 0.6)
		}
	}

	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
	const M = new Float64Array(9)
	const LX = -0.45,
		LY = 0.66,
		LZ = 0.6
	let last = performance.now(),
		raf = 0,
		side = 0,
		placed = '',
		wellU = 1

	// CSS only: keeps the backing store and last render
	function follow(G) {
		const size = Math.round(2 * G.r * opts.reach),
			wr = Math.max(8, Math.round(G.r * 0.9125 - 7))
		canvas.style.width = canvas.style.height = size + 'px'
		canvas.style.transform = `translate(${Math.round(G.x - size / 2)}px, ${Math.round(G.y - size / 2)}px)`
		well.style.width = well.style.height = 2 * wr + 'px'
		well.style.transform = `translate(${Math.round(G.x - wr)}px, ${Math.round(G.y - wr)}px)`
		placed = ''
	}
	function place(G) {
		const size = Math.round(2 * G.r * opts.reach),
			px = Math.max(48, Math.round(size / Math.max(0.5, opts.pixel)))
		const key = `${Math.round(G.x)},${Math.round(G.y)},${size},${px}`
		if (key === placed) return
		placed = key
		canvas.style.width = canvas.style.height = size + 'px'
		canvas.style.transform = `translate(${Math.round(G.x - size / 2)}px, ${Math.round(G.y - size / 2)}px)`
		if (canvas.width !== px) canvas.width = canvas.height = px
		side = px
		const wr = Math.max(8, Math.round(G.r * 0.9125 - 7))
		well.style.width = well.style.height = 2 * wr + 'px'
		well.style.transform = `translate(${Math.round(G.x - wr)}px, ${Math.round(G.y - wr)}px)`
		wellU = wr / (G.r * opts.scale)
	}

	// w runs across the band; th + TAU with -w is the same point
	const P = new Float64Array(9) // position, along, across
	function bandAt(c, s, c2, s2, w, R, hw, lift) {
		const rr = R + w * hw * c2,
			k = w * hw * 0.5
		let ax = -rr * s - k * s2 * c,
			ay = rr * c - k * s2 * s,
			az = k * c2
		const il = 1 / Math.hypot(ax, ay, az)
		ax *= il
		ay *= il
		az *= il
		const wx = c2 * c,
			wy = c2 * s,
			wz = s2
		const px = rr * c,
			py = rr * s,
			pz = w * hw * s2
		P[0] = M[0] * px + M[1] * py + M[2] * pz
		P[1] = M[3] * px + M[4] * py + M[5] * pz + lift
		P[2] = M[6] * px + M[7] * py + M[8] * pz
		P[3] = M[0] * ax + M[1] * ay + M[2] * az
		P[4] = M[3] * ax + M[4] * ay + M[5] * az
		P[5] = M[6] * ax + M[7] * ay + M[8] * az
		P[6] = M[0] * wx + M[1] * wy + M[2] * wz
		P[7] = M[3] * wx + M[4] * wy + M[5] * wz
		P[8] = M[6] * wx + M[7] * wy + M[8] * wz
	}

	function frame(now) {
		raf = requestAnimationFrame(frame)
		const G = opts.on ? geom() : null
		if (!G || !(G.r > 4)) {
			canvas.style.display = well.style.display = 'none'
			last = now
			return
		}
		canvas.style.display = ''
		canvas.style.opacity = well.style.opacity = G.fade ?? 1
		// geom.moving: no GL work, let CSS carry the last frame
		if (G.moving) {
			follow(G)
			last = now
			return
		}
		well.style.display = opts.chamber ? '' : 'none'
		place(G)
		if (opts.chamber) {
			paintWell()
			setGround(opts.well)
		} else if (G.ground) setGround(G.ground)
		const t0 = performance.now()
		const dt = Math.min(0.05, (now - last) / 1000)
		last = now

		const pos = clock.pos()
		const T = clock.now() / 1000
		const bpb = pos?.loop.beatsPerBar || 4,
			total = pos ? bpb * pos.loop.bars : 8
		const beats = pos ? pos.beats : T * 1.5
		const beatEnv = Math.exp(-mod(beats, 1) * 5),
			barEnv = Math.exp(-mod(beats, bpb) * 2.2)
		const phi = mod(beats / total, 2) * TAU // two loops per lap
		listen(dt, now)

		const slow = reduce ? 0.25 : 1
		const sp = T * opts.spin * slow,
			tl = opts.tilt + 0.16 * Math.sin(T * 0.23 * slow),
			rl = 0.22 * Math.sin(T * 0.17 * slow)
		const c = Math.cos(sp),
			s = Math.sin(sp),
			cb = Math.cos(tl),
			sb = Math.sin(tl),
			cr = Math.cos(rl),
			sr = Math.sin(rl)
		const r0 = [c, -s, 0],
			r1 = [cb * s, cb * c, -sb]
		for (let k = 0; k < 3; k++) {
			M[k] = cr * r0[k] - sr * r1[k]
			M[3 + k] = sr * r0[k] + cr * r1[k]
		}
		M[6] = sb * s
		M[7] = sb * c
		M[8] = cb
		const bob = 0.035 * Math.sin(T * 0.9 * slow),
			lift = 0.06 + bob

		const R = opts.radius,
			hw = opts.width * (1 + opts.breathe * beatEnv + 0.25 * level)
		const ochre = hex(opts.ochre),
			rose = hex(opts.rose),
			violet = hex(opts.violet),
			cream = hex(opts.cream),
			ink = hex(opts.ink),
			shd = hex(opts.shade),
			cometC = hex(opts.comet)
		const add = opts.additive
		const headTh = mod(phi, TAU),
			headW = phi < TAU ? 0.5 : -0.5
		const rip = opts.ripple * (0.3 + barEnv + level)
		count = 0

		for (let i = 0; i < shade.n && !opts.chamber; i++) {
			const sc = 0.62 * (1 - bob * 2)
			put(
				-99,
				shade.x[i] * sc,
				-0.86 + shade.y[i] * 0.05,
				0,
				0.05 + shade.rnd[i] * 0.09,
				0,
				0,
				0,
				0.006,
				0,
				shd[0] * 0.5,
				shd[1] * 0.5,
				shd[2] * 0.5,
				opts.shadow * (0.55 + 0.45 * shade.rnd[i]) * (1 - bob * 6),
				0,
			)
		}

		const b = band
		for (let i = 0; i < b.n; i++) {
			const th = b.th[i],
				w = b.w[i],
				kind = b.kind[i]
			bandAt(b.c[i], b.s[i], b.c2[i], b.s2[i], w, R, hw, lift)
			let ax = P[3],
				ay = P[4],
				az = P[5],
				wx = P[6],
				wy = P[7],
				wz = P[8]
			const nx = ay * wz - az * wy,
				ny = az * wx - ax * wz,
				nz = ax * wy - ay * wx
			const d = rip * Math.sin(2.5 * th - T * 2.4)
			const px = P[0] + nx * d,
				py = P[1] + ny * d,
				pz = P[2] + nz * d
			const lit = Math.abs(nx * LX + ny * LY + nz * LZ)
			let da = mod(headTh - th + Math.PI, TAU) - Math.PI
			const near =
				Math.exp(-(da > 0 ? da * da * 2.2 : da * da * 60)) *
				Math.exp(-(w - headW) * (w - headW) * 1.6)
			if (kind === BODY) {
				const m = 0.5 + 0.5 * b.c[i],
					sz = b.size[i] * (1 + 0.5 * near)
				let r = violet[0] + (rose[0] - violet[0]) * m,
					g = violet[1] + (rose[1] - violet[1]) * m,
					bl = violet[2] + (rose[2] - violet[2]) * m
				const dk = 0.5 - 0.5 * lit,
					hi = lit * lit * lit * 0.35 + near * 0.6
				r = (r + (shd[0] - r) * dk) * (1 - hi) + cream[0] * hi
				g = (g + (shd[1] - g) * dk) * (1 - hi) + cream[1] * hi
				bl = (bl + (shd[2] - bl) * dk) * (1 - hi) + cream[2] * hi
				const a = 0.085 * sz,
					c2 = 0.05 * sz
				put(
					pz,
					px,
					py,
					pz,
					ax * a,
					ay * a,
					az * a,
					wx * c2,
					wy * c2,
					wz * c2,
					r,
					g,
					bl,
					opts.body,
					near * add,
				)
			} else if (kind === HATCH) {
				const thr = 0.25 + b.rnd[i] * 0.6
				const al =
					opts.hatch *
					Math.min(1, Math.max(0, (thr - (opts.scratch ? 1 - lit : lit)) * 6)) *
					(1 - near)
				if (al < 0.01) continue
				const len = hw * (0.25 + 0.3 * b.size[i]),
					tw = 0.0055
				const kx = wx + ax * 0.35,
					ky = wy + ay * 0.35,
					kz = wz + az * 0.35
				put(
					pz + 0.004,
					px,
					py,
					pz,
					kx * len,
					ky * len,
					kz * len,
					ax * tw,
					ay * tw,
					az * tw,
					ink[0],
					ink[1],
					ink[2],
					al,
					0,
				)
			} else {
				const a = 0.05 * b.size[i],
					tw = 0.0065
				put(
					pz + 0.006,
					px,
					py,
					pz,
					ax * a,
					ay * a,
					az * a,
					wx * tw,
					wy * tw,
					wz * tw,
					ink[0],
					ink[1],
					ink[2],
					opts.outline * (0.55 + 0.45 * lit),
					0,
				)
			}
		}

		bandAt(
			Math.cos(headTh),
			Math.sin(headTh),
			Math.cos(headTh / 2),
			Math.sin(headTh / 2),
			headW,
			R,
			hw,
			lift,
		)
		head.p[0] = P[0]
		head.p[1] = P[1]
		head.p[2] = P[2]
		head.t[0] = P[3]
		head.t[1] = P[4]
		head.t[2] = P[5]
		head.n[0] = P[4] * P[8] - P[5] * P[7]
		head.n[1] = P[5] * P[6] - P[3] * P[8]
		head.n[2] = P[3] * P[7] - P[4] * P[6]
		for (let i = 0; i < comet.n; i++) {
			const lag = comet.lag[i],
				th = phi - lag,
				fade = Math.exp(-lag * 2.6)
			const w = Math.max(-1, Math.min(1, 0.5 + comet.dw[i] * (0.5 + lag)))
			bandAt(Math.cos(th), Math.sin(th), Math.cos(th / 2), Math.sin(th / 2), w, R, hw, lift)
			const sz = (0.03 + 0.05 * fade) * (1 + 0.6 * beatEnv + level),
				sw = sz * 0.45
			const m = fade * fade
			put(
				P[2] + 0.02,
				P[0],
				P[1],
				P[2],
				P[3] * sz * (1 + lag * 2),
				P[4] * sz * (1 + lag * 2),
				P[5] * sz * (1 + lag * 2),
				P[6] * sw,
				P[7] * sw,
				P[8] * sw,
				cometC[0] + (cream[0] - cometC[0]) * m,
				cometC[1] + (cream[1] - cometC[1]) * m,
				cometC[2] + (cream[2] - cometC[2]) * m,
				(0.25 + 0.6 * fade) * (0.7 + 0.3 * comet.rnd[i]),
				add,
			)
		}

		const swell = opts.eye * (1 + 0.55 * level + 0.3 * barEnv)
		if (now - gaze.at > 2600) {
			gaze.tx = Math.sin(T * 0.31) * opts.gaze * 0.25
			gaze.ty = Math.sin(T * 0.23 + 1) * opts.gaze * 0.15
		}
		const gk = Math.min(1, dt * (now - gaze.at > 2600 ? 1.5 : 11))
		gaze.x += (gaze.tx - gaze.x) * gk
		gaze.y += (gaze.ty - gaze.y) * gk
		for (let i = 0; i < core.n; i++) {
			const glow = i < core.nGlow
			const rad = glow ? 0.105 * swell : 0.034 * opts.eye * (1.25 - 0.7 * thump)
			const ox = core.p[i * 3] * rad,
				oy = core.p[i * 3 + 1] * rad,
				oz = core.p[i * 3 + 2] * rad
			const gz = glow ? 1 : 1.3
			const x = M[0] * ox + M[1] * oy + M[2] * oz + gaze.x * gz,
				y = M[3] * ox + M[4] * oy + M[5] * oz + lift + gaze.y * gz,
				z = M[6] * ox + M[7] * oy + M[8] * oz
			if (glow) {
				const fl = 0.75 + 0.25 * Math.sin(T * 3.1 + core.rnd[i] * 40),
					sz = (0.022 + 0.03 * core.rnd[i]) * swell * fl
				const m = Math.min(1, Math.hypot(ox, oy, oz) / (0.16 * swell))
				put(
					z,
					x,
					y,
					z,
					sz,
					0,
					0,
					0,
					sz,
					0,
					cometC[0] + (ochre[0] - cometC[0]) * m,
					cometC[1] + (ochre[1] - cometC[1]) * m,
					cometC[2] + (ochre[2] - cometC[2]) * m,
					0.4 * fl,
					add,
				)
			} else
				put(
					z + 0.22,
					x,
					y,
					z,
					0.018,
					0,
					0,
					0,
					0.018,
					0,
					shd[0] * 0.6,
					shd[1] * 0.6,
					shd[2] * 0.6,
					0.85,
					0,
				)
		}

		const m = motes,
			drag = Math.pow(0.35, dt)
		for (let i = 0; i < m.n; i++) {
			if (m.life[i] <= 0) continue
			m.life[i] -= dt
			const o = i * 3
			let vx = m.v[o],
				vy = m.v[o + 1],
				vz = m.v[o + 2]
			const x = (m.p[o] += vx * dt),
				y = (m.p[o + 1] += vy * dt),
				z = (m.p[o + 2] += vz * dt)
			vx = (vx - y * 0.9 * dt) * drag
			vy = (vy + x * 0.9 * dt + 0.1 * dt) * drag
			vz *= drag
			m.v[o] = vx
			m.v[o + 1] = vy
			m.v[o + 2] = vz
			const sp = Math.hypot(vx, vy, vz) + 1e-6,
				f = Math.max(0, m.life[i] / m.max[i])
			const len = (0.012 + sp * 0.07) * m.size[i] * opts.moteSize,
				th = 0.011 * m.size[i] * opts.moteSize * (0.5 + 0.5 * f)
			const il = 1 / (Math.hypot(vx, vy) + 1e-6)
			const inw =
				opts.chamber && add > 0
					? 0.35 * Math.min(1, Math.max(0, (wellU - Math.hypot(x, y)) * 6 + 0.5))
					: 0
			put(
				z,
				x,
				y,
				z,
				(vx / sp) * len,
				(vy / sp) * len,
				(vz / sp) * len,
				-vy * il * th,
				vx * il * th,
				0,
				m.col[o] + (cream[0] - m.col[o]) * inw,
				m.col[o + 1] + (cream[1] - m.col[o + 1]) * inw,
				m.col[o + 2] + (cream[2] - m.col[o + 2]) * inw,
				Math.min(1, f * 2.2) * 0.9,
				opts.chamber ? add * (0.15 + 2.4 * inw) : add,
			)
		}

		// sorted back to front: blending is order dependent
		const ord = order.subarray(0, count)
		ord.sort((a, b) => zs[a] - zs[b])
		for (let k = 0; k < count; k++) {
			const src = ord[k] * STRIDE,
				dst = k * STRIDE
			for (let j = 0; j < STRIDE; j++) sorted[dst + j] = scratch[src + j]
		}
		gl.viewport(0, 0, side, side)
		gl.clearColor(0, 0, 0, 0)
		gl.clear(gl.COLOR_BUFFER_BIT)
		const zoom = opts.scale / opts.reach,
			ppu = (side / 2) * zoom
		gl.uniform1f(U.uZoom, zoom)
		gl.uniform1f(U.uDist, 4)
		gl.uniform1f(U.uMinVar, (0.42 / ppu) ** 2)
		gl.uniform1f(U.uLevels, Math.max(1, opts.levels))
		gl.uniform1f(U.uDither, opts.dither)
		gl.bindBuffer(gl.ARRAY_BUFFER, inst)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, sorted, 0, count * STRIDE)
		gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
		stats.splats = count
		stats.ms += (performance.now() - t0 - stats.ms) * 0.05
	}
	raf = requestAnimationFrame(frame)

	function addGui(g0) {
		const f = (gui = g0.addFolder('heart').close())
		f.add(opts, 'on')
		f.add(opts, 'additive', 0, 1, 0.01).name('ink ↔ light')
		f.add(opts, 'chamber').onChange(() => {
			ground = ''
			placed = ''
		})
		f.addColor(opts, 'well')
			.name('chamber colour')
			.onChange(() => (ground = ''))
		f.add(opts, 'engrave', 0, 1, 0.01).name('chamber engraving')
		const ras = f.addFolder('raster')
		ras.add(opts, 'pixel', 0.5, 8, 0.5).name('pixel size')
		ras.add(opts, 'levels', 1, 8, 1).name('tone levels')
		ras.add(opts, 'dither', 0, 1, 0.01)
		ras.add(opts, 'scale', 0.4, 2, 0.01)
		ras.add(opts, 'reach', 1.2, 4, 0.1).onChange(() => (placed = ''))
		const mo = f.addFolder('motion')
		mo.add(opts, 'spin', -1, 1, 0.01)
		mo.add(opts, 'tilt', 0, 1.57, 0.01)
		mo.add(opts, 'breathe', 0, 1, 0.01).name('beat breathe')
		mo.add(opts, 'ripple', 0, 0.3, 0.005)
		const bd = f.addFolder('band')
		bd.add(opts, 'radius', 0.3, 0.9, 0.01)
		bd.add(opts, 'width', 0.05, 0.5, 0.01)
		bd.add(opts, 'body', 0, 1, 0.01).name('pigment')
		bd.add(opts, 'hatch', 0, 1, 0.01)
		bd.add(opts, 'scratch').name('hatch the light')
		bd.add(opts, 'outline', 0, 1, 0.01)
		bd.add(opts, 'shadow', 0, 1, 0.01)
		const re = f.addFolder('reaction')
		re.add(opts, 'sensitivity', 0.2, 4, 0.05)
		re.add(opts, 'burst', 0, 80, 1).name('motes per hit')
		re.add(opts, 'fling', 0, 3, 0.05)
		re.add(opts, 'moteLife', 0.3, 5, 0.1).name('mote life s')
		re.add(opts, 'moteSize', 0.3, 3, 0.05).name('mote size')
		re.add(opts, 'eye', 0, 2.5, 0.05)
		re.add(opts, 'gaze', 0, 0.3, 0.01)
		re.add({ poke: () => engine.seats.forEach((L) => emit(L, 0.8)) }, 'poke')
		const pal = f.addFolder('palette').close()
		for (const k of ['ochre', 'rose', 'violet', 'cream', 'ink', 'shade', 'comet'])
			pal.addColor(opts, k)
		const cn = f.addFolder('counts').close()
		for (const k of ['nBody', 'nHatch', 'nEdge', 'nComet', 'nCore', 'nMotes'])
			cn.add(opts, k, 0, 6000, 20).onFinishChange(build)
		const sd = {
			get splats() {
				return stats.splats
			},
			get cpu() {
				return stats.ms.toFixed(2) + ' ms'
			},
		}
		f.add(sd, 'splats').disable().listen()
		f.add(sd, 'cpu').disable().listen()
		return f
	}

	return {
		opts,
		stats,
		canvas,
		addGui,
		emit,
		setGround,
		glance,
		destroy() {
			cancelAnimationFrame(raf)
			taps.forEach((t) => t.L.out.disconnect(t.an))
			canvas.remove()
			well.remove()
		},
	}
}
