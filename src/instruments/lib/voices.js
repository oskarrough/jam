// Voices from Oskar's jukebox synth (github.com/oskarrough/jukebox, src/synth.js at 0936ef2), which started
// from Simon Willison's Scrimshaw Jukebox (https://tools.simonwillison.net/scrimshaw-jukebox, Apache License 2.0).
// A trimmed copy: only the twelve voices the jam offers, each playing into the seat's `out`.
// voice(name, trimDb)(ctx, midi, time, dur, vel): plays one note of that voice into ctx.out.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)

function G(S, v = 0) {
	const g = S.ctx.createGain()
	g.gain.value = v
	return g
}
function F(S, type, f, q = 0.7, gainDb) {
	const b = S.ctx.createBiquadFilter()
	b.type = type
	b.frequency.value = clamp(f, 10, S.nyq * 0.95)
	b.Q.value = q
	if (gainDb != null) b.gain.value = gainDb
	return b
}
function O(S, type, f, t, stop, p, ratio = 1, detune = 0) {
	const o = S.ctx.createOscillator()
	if (typeof type === 'string') o.type = type
	else o.setPeriodicWave(type)
	const ff = clamp(f * ratio, 1, S.nyq * 0.98)
	if (p && p.from) {
		o.frequency.setValueAtTime(clamp(p.from * ratio, 1, S.nyq * 0.98), t)
		o.frequency.exponentialRampToValueAtTime(ff, t + p.glide)
	} else o.frequency.setValueAtTime(ff, t)
	if (detune) o.detune.value = detune
	o.start(t)
	o.stop(stop)
	return o
}
function adsr(param, t, d, { a = 0.01, dc = 0.1, s = 1, r = 0.1, peak = 1 }) {
	const tOn = t + a,
		tOff = Math.max(t + d, tOn + 0.003)
	param.setValueAtTime(0, t)
	param.linearRampToValueAtTime(peak, tOn)
	// Pin the level where the release starts: node-web-audio-api otherwise
	// extrapolates the previous event into the release target and can produce
	// invalid samples (a flat sustain, or a decay that has long since settled).
	if (s < 1) {
		const tau = Math.max(0.002, dc / 3)
		param.setTargetAtTime(peak * s, tOn, tau)
		param.setValueAtTime(peak * s + peak * (1 - s) * Math.exp(-(tOff - tOn) / tau), tOff)
	} else param.setValueAtTime(peak, tOff)
	param.setTargetAtTime(0, tOff, Math.max(0.002, r / 4))
	return tOff + r * 1.8 + 0.03
}
function perc(param, t, { a = 0.002, tau = 0.3, peak = 1, damp = null, dampTau = 0.06 }) {
	param.setValueAtTime(0, t)
	param.linearRampToValueAtTime(peak, t + a)
	param.setTargetAtTime(0, t + a, Math.max(0.002, tau))
	let end = t + a + tau * 7
	if (damp != null && damp + dampTau * 7 < end) {
		const td = Math.max(damp, t + a + 0.002)
		param.setTargetAtTime(0, td, dampTau)
		end = td + dampTau * 7
	}
	return end
}
function partial(S, out, t, f, opt) {
	if (f >= S.nyq * 0.9) return
	const g = G(S)
	g.connect(out)
	const end = perc(g.gain, t, opt)
	const o = O(S, opt.type || 'sine', f, t, end)
	if (opt.bend) {
		o.frequency.setValueAtTime(f * opt.bend, t)
		o.frequency.setTargetAtTime(f, t, opt.bendTau || 0.02)
	}
	o.connect(g)
	return end
}
function noise(
	S,
	out,
	t,
	{ type = 'bandpass', f = 2000, q = 1, a = 0.001, tau = 0.01, peak = 0.1 },
) {
	const src = S.ctx.createBufferSource()
	src.buffer = S.noise
	src.loop = true
	const fl = F(S, type, f, q)
	const g = G(S)
	g.gain.setValueAtTime(0, t)
	g.gain.linearRampToValueAtTime(peak, t + a)
	g.gain.setTargetAtTime(0, t + a, Math.max(0.001, tau))
	src.connect(fl).connect(g).connect(out)
	src.start(t, Math.random() * (S.noise.duration - 0.5))
	src.stop(t + a + tau * 7 + 0.01)
	return { src, fl, g }
}
function vibrato(S, t, stop, targets, { rate = 5, depth = 10, delay = 0.2, rise = 0.3 }) {
	const lfo = S.ctx.createOscillator()
	lfo.frequency.value = rate * (0.94 + Math.random() * 0.12)
	const g = G(S)
	g.gain.setValueAtTime(0, t)
	g.gain.setValueAtTime(0, t + delay)
	g.gain.linearRampToValueAtTime(depth, t + delay + rise)
	lfo.connect(g)
	targets.forEach((o) => g.connect(o.detune))
	lfo.start(t)
	lfo.stop(stop)
}

const WAVES = {
	organ: [1, 0.8, 0.5, 0.42, 0, 0.25, 0, 0.2],
}
function wave(S, name) {
	if (!S.waves[name]) {
		const h = WAVES[name],
			n = h.length + 1
		const re = new Float32Array(n),
			im = new Float32Array(n)
		h.forEach((a, i) => {
			im[i + 1] = a
		})
		S.waves[name] = S.ctx.createPeriodicWave(re, im)
	}
	return S.waves[name]
}
function ks(S, f, cfg) {
	const sr = S.ctx.sampleRate
	const N = Math.max(2, Math.floor(sr / f - cfg.b))
	const key = cfg.id + ':' + N
	let e = S.ks.get(key)
	if (!e) {
		const len = Math.floor(sr * cfg.dur)
		const buf = S.ctx.createBuffer(1, len, sr)
		const y = buf.getChannelData(0)
		let lp = 0,
			mean = 0
		for (let i = 0; i < N; i++) {
			lp += (1 - cfg.color) * (Math.random() * 2 - 1 - lp)
			y[i] = lp
			mean += lp
		}
		mean /= N
		let pk = 1e-6
		for (let i = 0; i < N; i++) {
			y[i] -= mean
			pk = Math.max(pk, Math.abs(y[i]))
		}
		for (let i = 0; i < N; i++) y[i] /= pk
		const b = cfg.b,
			dk = cfg.decay
		for (let i = N; i < len; i++)
			y[i] = dk * ((1 - b) * y[i - N] + b * (i - N - 1 >= 0 ? y[i - N - 1] : 0))
		const fade = Math.floor(len * 0.25)
		for (let i = 0; i < fade; i++) {
			const k = i / fade
			y[len - fade + i] *= (1 - k) * (1 - k)
		}
		e = { buf, f0: sr / (N + b) }
		if (S.ks.size >= 160) S.ks.delete(S.ks.keys().next().value)
		S.ks.set(key, e)
	}
	return e
}
function pluck(S, out, t, d, f, v, cfg, chain) {
	const e = ks(S, f, cfg)
	const src = S.ctx.createBufferSource()
	src.buffer = e.buf
	const rate = f / e.f0
	src.playbackRate.value = rate
	const g = G(S)
	const end = perc(g.gain, t, {
		a: 0.001,
		tau: 50,
		peak: v,
		damp: t + d + cfg.hang,
		dampTau: cfg.dampTau,
	})
	let node = src
	for (const n of chain) {
		node.connect(n)
		node = n
	}
	node.connect(g).connect(out)
	src.start(t)
	src.stop(Math.min(end, t + e.buf.duration / rate))
}

const PLUCK = {
	harp: { id: 'harp', b: 0.45, decay: 0.9985, color: 0.55, dur: 2.8, hang: 1.4, dampTau: 0.25 },
	upright: { id: 'upr', b: 0.5, decay: 0.996, color: 0.7, dur: 1.7, hang: 0.04, dampTau: 0.07 },
}
function saturate(S) {
	if (!S.curve) {
		S.curve = new Float32Array(1024)
		for (let i = 0; i < 1024; i++) S.curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 2.2)
	}
	const w = S.ctx.createWaveShaper()
	w.curve = S.curve
	return w
}

// play(S, out, t, dur, freq, vel, p) ; p = {from, glide, bright, att, rel, drive}
const INST = {
	marimba: {
		rev: 0.18,
		level: 0.5,
		play(S, out, t, d, f, v, p) {
			const tau = clamp(0.26 * Math.sqrt(330 / f), 0.08, 0.6)
			partial(S, out, t, f, { a: 0.002, tau, peak: v * 0.8 })
			partial(S, out, t, f * 3.98, { a: 0.001, tau: tau * 0.18, peak: v * 0.22 * p.bright })
			partial(S, out, t, f * 9.9, { a: 0.001, tau: tau * 0.05, peak: v * 0.05 * p.bright })
			noise(S, out, t, { f: f * 2.5, q: 1.2, tau: 0.004, peak: v * 0.06 })
		},
	},
	rhodes: {
		rev: 0.25,
		level: 0.9,
		play(S, out, t, d, f, v, p) {
			const trem = G(S, 0.88)
			trem.connect(out)
			const tau = clamp(1.6 * Math.pow(440 / f, 0.35), 0.5, 3)
			const g = G(S)
			g.connect(trem)
			const end = perc(g.gain, t, {
				a: 0.003,
				tau,
				peak: v * 0.62,
				damp: t + d + (p.rel || 0.12),
				dampTau: 0.09,
			})
			const lfo = S.ctx.createOscillator()
			lfo.frequency.value = 4.6
			const lg = G(S, 0.1)
			lfo.connect(lg).connect(trem.gain)
			lfo.start(t)
			lfo.stop(end)
			const car = O(S, 'sine', f, t, end, p)
			const mod = O(S, 'sine', f, t, end, p)
			const idx = G(S)
			const bark = f * (0.6 + 2.4 * v * v) * p.bright
			idx.gain.setValueAtTime(bark, t)
			idx.gain.setTargetAtTime(f * 0.18 * p.bright, t, 0.22)
			mod.connect(idx).connect(car.frequency)
			car.connect(g)
			partial(S, trem, t, f * 7.1, { a: 0.001, tau: 0.05, peak: v * 0.08 * p.bright })
			noise(S, trem, t, { type: 'lowpass', f: 900, q: 0.6, tau: 0.008, peak: v * 0.05 })
		},
	},
	glock: {
		rev: 0.35,
		level: 0.53,
		play(S, out, t, d, f, v, p) {
			partial(S, out, t, f, { a: 0.001, tau: 0.7, peak: v * 0.6 })
			partial(S, out, t, f * 2.76, { a: 0.001, tau: 0.22, peak: v * 0.25 * p.bright })
			partial(S, out, t, f * 5.4, { a: 0.001, tau: 0.07, peak: v * 0.14 * p.bright })
			partial(S, out, t, f * 8.93, { a: 0.001, tau: 0.03, peak: v * 0.06 * p.bright })
		},
	},
	celesta: {
		rev: 0.35,
		level: 0.63,
		play(S, out, t, d, f, v, p) {
			const tau = clamp(0.55 * Math.pow(440 / f, 0.3), 0.2, 0.9)
			partial(S, out, t, f, { a: 0.002, tau, peak: v * 0.7 })
			partial(S, out, t, f * 2, { a: 0.001, tau: tau * 0.4, peak: v * 0.14 })
			partial(S, out, t, f * 4.02, { a: 0.001, tau: tau * 0.12, peak: v * 0.1 * p.bright })
			noise(S, out, t, { f: 5000, q: 1, tau: 0.003, peak: v * 0.04 })
		},
	},
	musicbox: {
		rev: 0.4,
		level: 0.64,
		play(S, out, t, d, f, v, p) {
			partial(S, out, t, f, { a: 0.001, tau: 0.5, peak: v * 0.7 })
			partial(S, out, t, f * 3, { a: 0.001, tau: 0.12, peak: v * 0.12 })
			partial(S, out, t, f * 5.2, { a: 0.001, tau: 0.05, peak: v * 0.06 * p.bright })
			noise(S, out, t, { f: 7000, q: 2, tau: 0.002, peak: v * 0.05 })
		},
	},
	organ: {
		rev: 0.15,
		level: 0.98,
		play(S, out, t, d, f, v, p) {
			const g = G(S)
			const lp = F(S, 'lowpass', 5500 * p.bright, 0.5)
			lp.connect(g).connect(out)
			const end = adsr(g.gain, t, d, { a: p.att || 0.005, r: p.rel || 0.06, peak: v * 0.5 })
			const o = O(S, wave(S, 'organ'), f, t, end, p)
			o.connect(lp)
			vibrato(S, t, end, [o], { rate: 6.3, depth: 5, delay: 0, rise: 0.05 })
			noise(S, out, t, { type: 'lowpass', f: 2500, q: 0.5, tau: 0.002, peak: v * 0.1 })
		},
	},
	harp: {
		rev: 0.45,
		level: 1.07,
		play(S, out, t, d, f, v, p) {
			pluck(S, out, t, d, f, v * 0.55, PLUCK.harp, [F(S, 'lowpass', 3500 * p.bright, 0.5)])
			partial(S, out, t, f, { a: 0.003, tau: 0.9, peak: v * 0.12 })
		},
	},
	upright: {
		rev: 0.15,
		level: 0.72,
		play(S, out, t, d, f, v, p) {
			pluck(S, out, t, d, f, v * 0.5, PLUCK.upright, [F(S, 'lowpass', 1400 * p.bright, 0.6)])
			partial(S, out, t, f, {
				a: 0.004,
				tau: 0.5,
				peak: v * 0.45,
				damp: t + d + 0.04,
				dampTau: 0.07,
			})
			noise(S, out, t, { type: 'lowpass', f: 900, q: 0.5, tau: 0.01, peak: v * 0.12 })
		},
	},
	808: {
		rev: 0.04,
		level: 1.1,
		play(S, out, t, d, f, v, p) {
			const k = p.drive || 0
			const g = G(S)
			const pre = G(S, 1 + 1.2 * k)
			pre
				.connect(saturate(S))
				.connect(F(S, 'lowpass', 1800 * p.bright * (1 + k), 0.5))
				.connect(g)
				.connect(out)
			const end = adsr(g.gain, t, d, {
				a: p.att || 0.003,
				dc: 1.2,
				s: 0.55,
				r: p.rel || 0.12,
				peak: (v * 0.55) / (1 + 0.1 * k),
			})
			const o = O(S, 'sine', f, t, end, p)
			if (!p.from) {
				o.frequency.setValueAtTime(f * 2.2, t)
				o.frequency.exponentialRampToValueAtTime(f, t + 0.04)
			}
			o.connect(pre)
		},
	},
	logdrum: {
		rev: 0.06,
		level: 1.15,
		play(S, out, t, d, f, v, p) {
			const k = p.drive || 0
			const g = G(S)
			const pre = G(S, 1.4 + 1.2 * k)
			pre
				.connect(saturate(S))
				.connect(F(S, 'peaking', clamp(f * 3, 200, 1200), 1.4, 5))
				.connect(F(S, 'lowpass', 2600 * p.bright * (1 + k), 0.6))
				.connect(g)
				.connect(out)
			const tau = clamp(0.3 * Math.pow(110 / f, 0.3), 0.12, 0.45)
			const end = perc(g.gain, t, {
				a: 0.002,
				tau,
				peak: (v * 0.5) / (1 + 0.1 * k),
				damp: t + d + (p.rel || 0.04),
				dampTau: 0.03,
			})
			const os = [
				[O(S, 'triangle', f, t, end, p), 0.7],
				[O(S, 'sine', f, t, end, p), 0.6],
			]
			for (const [o, a] of os) {
				if (!p.from) {
					o.frequency.setValueAtTime(f * 1.9, t)
					o.frequency.exponentialRampToValueAtTime(f, t + 0.055)
				}
				o.connect(G(S, a)).connect(pre)
			}
			noise(S, out, t, { f: clamp(f * 6, 600, 2400), q: 1.5, tau: 0.006, peak: v * 0.12 })
		},
	},
	// TR-808 cowbell as notes: squares at 540 and 800 Hz; C#5 is where Memphis tapes have it.
	synbass: {
		rev: 0.08,
		level: 0.76,
		play(S, out, t, d, f, v, p) {
			const g = G(S)
			const lp = F(S, 'lowpass', 300, 5)
			lp.connect(g).connect(out)
			const end = adsr(g.gain, t, d, {
				a: p.att || 0.003,
				dc: 0.35,
				s: 0.55,
				r: p.rel || 0.06,
				peak: v * 0.5,
			})
			lp.frequency.setValueAtTime(Math.min(5000, 2600 * p.bright * v), t)
			lp.frequency.setTargetAtTime(f * 2 + 80, t, 0.07)
			O(S, 'sawtooth', f, t, end, p).connect(lp)
			const sq = G(S, 0.5)
			O(S, 'square', f, t, end, p, 1, -6).connect(sq).connect(lp)
		},
	},
	chip: {
		rev: 0.15,
		level: 1.17,
		play(S, out, t, d, f, v, p) {
			const g = G(S)
			const lp = F(S, 'lowpass', 6000 * p.bright, 0.5)
			lp.connect(g).connect(out)
			const end = adsr(g.gain, t, d, {
				a: p.att || 0.003,
				dc: 0.1,
				s: 0.8,
				r: p.rel || 0.04,
				peak: v * 0.3,
			})
			const o = O(S, 'square', f, t, end, p)
			o.connect(lp)
			vibrato(S, t, end, [o], { rate: 6, depth: 12, delay: 0.25, rise: 0.1 })
		},
	},
}

// one synth state per AudioContext (noise buffer, plucked-string and waveform caches)
const states = new WeakMap()
function state(ac) {
	let S = states.get(ac)
	if (S) return S
	const n = ac.sampleRate * 3
	const noiseBuf = ac.createBuffer(1, n, ac.sampleRate)
	const d = noiseBuf.getChannelData(0)
	for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
	S = { ctx: ac, nyq: ac.sampleRate / 2, waves: {}, ks: new Map(), noise: noiseBuf }
	states.set(ac, S)
	return S
}
const trims = new WeakMap()
function input(S, out, name, trim) {
	let m = trims.get(out)
	if (!m) trims.set(out, (m = {}))
	if (!m[name]) {
		m[name] = G(S, INST[name].level * Math.pow(10, trim / 20))
		m[name].connect(out)
	}
	return m[name]
}
const P = { bright: 1, att: null, rel: null, glide: null, drive: 0, from: null }

export function voice(name, trim = 0) {
	const def = INST[name]
	return ({ audio, out }, m, t, dur, vel = 0.7) => {
		const S = state(audio)
		try {
			def.play(S, input(S, out, name, trim), t, dur, mtof(m), vel, P)
		} catch (e) {
			console.warn(name, e)
		}
	}
}
