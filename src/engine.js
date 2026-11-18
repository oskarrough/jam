// Engine: audio graph, seats, lookahead scheduler.
// Talks to a transport (local.js or sync/sync.js, same API) and to instruments (see instruments/index.js).

import { registry } from './instruments/index.js'
import { val } from './instruments/lib/util.js'
import { kit } from './instruments/lib/kit.js'

import { SEAT_COLORS, INK_THEME } from './palette.js'
export { SEAT_COLORS }

// The playable part of a seat. Clone it when retaining a take or undo point.
export const partOf = (L) => ({
	instrument: L.module.id,
	state: L.instance.state,
	params: L.params,
	...(L.len ? { len: L.len } : {}),
})

export function createEngine(transport, { seatIds, instruments }) {
	const { clock } = transport
	const audio = new (window.AudioContext || window.webkitAudioContext)()
	const cfg = { lookaheadMs: 200, tickMs: 25 } // generous lookahead: the dial and heart share the main thread
	const stats = { scheduled: 0, late: 0, lastLateMs: 0 }
	let soundOn = false
	const listeners = {}
	const emit = (ev, d) => (listeners[ev] || []).forEach((fn) => fn(d))
	const on = (ev, fn) => (listeners[ev] ||= []).push(fn)

	const { master, roomIn, analyser } = mixBus(audio)
	master.gain.value = 0

	const loop = () => clock.loopAt()
	kit(audio).follow(loop)
	// a seat's own loop: `len` steps (set on its sheet like a clip length, any whole number of 16ths), else the jam's.
	// Shorter loops repeat; mixed lengths drift against each other and meet again.
	const steps = (L, l) => {
		if (L?.len) return L.len
		l ??= loop()
		return l.bars * l.beatsPerBar * 4
	}
	const stepMs = (l = loop()) => clock.beatMs(l) / 4

	const seatClock = (L) => ({
		get bpm() {
			return loop().bpm
		},
		get steps() {
			return steps(L)
		},
		get stepDur() {
			return stepMs() / 1000
		},
		get startTime() {
			return clock.toAudio(audio, loop().origin)
		},
		now: () => audio.currentTime,
		pos: () => {
			const p = clock.pos()
			if (!p) return 0
			const n = steps(L, p.loop)
			return (((p.beats * 4) % n) + n) % n
		},
		get playing() {
			return soundOn
		},
	})

	const seats = seatIds.map((id, i) => {
		const { out, send, lp } = seatStrip(audio, master, roomIn)
		// what the seat sounds like after its level and tone, for the mixer's dots
		const meter = audio.createAnalyser()
		meter.fftSize = 256
		lp.connect(meter)
		return {
			id,
			index: i,
			color: SEAT_COLORS[i % SEAT_COLORS.length],
			out,
			send,
			lp,
			meter,
			mix: { ...MIX, mute: false },
			module: null,
			instance: null,
			params: {},
			len: null,
			canvas: document.createElement('canvas'),
		}
	})
	seats.forEach((L) => {
		L.g = L.canvas.getContext('2d')
		L.clock = seatClock(L)
	})

	// mute, level, tone and space are the jam's (they travel with the seat's data); solo is yours alone, in your own ears
	let solo = -1
	const heard = (L) => !L.mix.mute && (solo < 0 || solo === L.index)
	function applyMix(L) {
		const t = audio.currentTime
		L.out.gain.setTargetAtTime(heard(L) ? L.mix.level : 0, t, 0.02)
		L.send.gain.setTargetAtTime(L.mix.space, t, 0.02)
		setTone(L.lp, L.mix.tone, t)
	}

	function setLen(L, n) {
		n = okLen(n)
		const from = steps(L)
		if ((n || steps(null)) === from) {
			L.len = n
			return
		}
		L.len = n
		L.instance.setState(resize(L.instance.state, from, steps(L)))
		push(L, { now: true })
		emit('seats')
	}

	function setInstrument(L, id, { state, params } = {}) {
		const mod = registry.get(id) || registry.values().next().value
		if (L.instance) L.instance.dispose?.()
		L.module = mod
		L.params = Object.fromEntries(Object.entries(mod.params || {}).map(([k, p]) => [k, val(p)]))
		if (params) Object.assign(L.params, params)
		L.instance = mod.create({
			audio,
			out: L.out,
			clock: L.clock,
			setLen: (n) => setLen(L, n),
			params: L.params,
			color: L.color,
			theme: INK_THEME,
		})
		if (state !== undefined) L.instance.setState(state)
		applyMix(L)
		emit('seats')
	}

	function applyPart(L, data) {
		L.len = okLen(data.len)
		if (data.instrument !== L.module.id) setInstrument(L, data.instrument, data)
		else {
			if (data.params) Object.assign(L.params, data.params)
			L.instance.setState(data.state)
		}
	}

	seats.forEach((L, i) => {
		const id = instruments[i]
		const mod = registry.get(id)
		setInstrument(L, id, { state: mod?.sample?.(steps(L)) })
	})

	const seatById = (id) => seats.find((L) => L.id === id)
	const lastSent = new Map()
	function push(L, { now = false } = {}) {
		const data = structuredClone(partOf(L))
		if (L.riff) data.riff = L.riff
		if (L.mix.mute) data.mute = true
		const m = mixData(L.mix)
		if (m) data.mix = m
		lastSent.set(L.id, performance.now())
		return transport.edit(L.id, data, { now })
	}
	const timers = new Map()
	function pushSoon(L) {
		const since = performance.now() - (lastSent.get(L.id) || 0)
		clearTimeout(timers.get(L.id))
		if (since > 100) push(L)
		else
			timers.set(
				L.id,
				setTimeout(() => push(L), 100 - since),
			)
	}
	transport.on('apply', ({ seat, data, local }) => {
		const L = seatById(seat)
		if (!L || !data || local) return
		L.riff = data.riff || null
		const m = { ...MIX, ...data.mix, mute: !!data.mute }
		if (Object.keys(m).some((k) => m[k] !== L.mix[k])) {
			Object.assign(L.mix, m)
			applyMix(L)
			emit('mix', L)
		}
		applyPart(L, data)
		emit('apply', L)
	})
	transport.on('welcome', ({ seats: snap }) => {
		for (const L of seats) if (!snap || !snap[L.id]) push(L, { now: true })
	})

	let nextT = null
	function tick() {
		if (!soundOn) return
		const now = clock.now()
		let l = loop()
		if (nextT === null || nextT < now - 200 || nextT > now + 2000) {
			const sm = stepMs(l)
			nextT = l.origin + Math.ceil((now - l.origin) / sm) * sm
		}
		while (nextT < now + cfg.lookaheadMs) {
			l = clock.loopAt(nextT)
			const sm = stepMs(l)
			const abs = Math.round((nextT - l.origin) / sm)
			const at = clock.toAudio(audio, nextT)
			const late = (audio.currentTime - at) * 1000
			if (late > 0) {
				stats.late++
				stats.lastLateMs = late
			}
			// a few ms late still sounds; much later would land off the beat, so drop it
			if (late <= 30)
				for (const L of seats) {
					const n = steps(L, l)
					try {
						L.instance.step(((abs % n) + n) % n, Math.max(at, audio.currentTime), sm / 1000)
					} catch (e) {
						console.error(L.module.id, e)
					}
				}
			stats.scheduled++
			const next = nextT + sm,
				ln = clock.loopAt(next)
			nextT = ln === l ? next : ln.origin + Math.ceil((next - ln.origin) / stepMs(ln)) * stepMs(ln)
		}
	}
	let timer = setInterval(tick, cfg.tickMs)

	function setSound(on) {
		soundOn = on
		if (on) audio.resume()
		nextT = null
		master.gain.setTargetAtTime(on ? 0.8 : 0, audio.currentTime, 0.05)
		emit('sound', on)
	}

	const buf = new Float32Array(512)
	function rms(an) {
		if (!soundOn) return 0
		const b = an.fftSize === buf.length ? buf : buf.subarray(0, an.fftSize)
		an.getFloatTimeDomainData(b)
		let s = 0
		for (let i = 0; i < b.length; i++) s += b[i] * b[i]
		return Math.sqrt(s / b.length)
	}
	const level = () => rms(analyser)

	return {
		audio,
		master,
		seats,
		cfg,
		stats,
		iclock: seatClock(null),
		transport,
		on,
		setInstrument,
		applyPart,
		push,
		pushSoon,
		applyMix,
		setSound,
		level,
		// one seat's loudness as heard (after its level, tone and mute), about 0..0.5
		seatLevel: (i) => rms(seats[i].meter),
		heard: (i) => heard(seats[i]),
		get solo() {
			return solo
		},
		setMute(L, on) {
			L.mix.mute = on
			applyMix(L)
			push(L, { now: true })
			emit('mix', L)
		},
		// level, tone or space from the dial or the panel: heard at once here, sent to the jam
		setMix(L, patch) {
			Object.assign(L.mix, patch)
			applyMix(L)
			pushSoon(L)
			emit('mix', L)
		},
		setSolo(i) {
			solo = solo === i ? -1 : i
			seats.forEach(applyMix)
			emit('mix')
		},
		get soundOn() {
			return soundOn
		},
		steps,
		loop,
		// set a seat's loop length in steps (null: the jam's); the part is cut to fit, or repeated to fill.
		// Synced and recorded with the seat. An instrument may drive it too (ctx.setLen).
		setLen,
		setBars: (L, bars) => setLen(L, bars * loop().beatsPerBar * 4),
		// where a seat's own loop sits on the dial: at dial phase x the seat is at phase (off + x · rep) mod 1
		ringMap(L) {
			const l = loop(),
				G = steps(null, l),
				S = steps(L, l)
			if (S === G) return { rep: 1, off: 0 }
			const beatSteps = (clock.pos()?.beats ?? 0) * 4
			const turn = Math.floor(beatSteps / G)
			return { rep: G / S, off: ((((turn * G) % S) + S) % S) / S }
		},
		setTick(ms) {
			cfg.tickMs = ms
			clearInterval(timer)
			timer = setInterval(tick, ms)
		},
	}
}

export const BARS = [1, 2, 4, 8]
const okLen = (n) => (Number.isInteger(n) && n >= 1 && n <= 256 ? n : null)

// step-sized arrays (one entry per step) are cut or repeated to the new length; everything else stays
export function resize(state, from, to) {
	if (!state || typeof state !== 'object' || from === to) return state
	const out = structuredClone(state)
	for (const k in out)
		if (Array.isArray(out[k]) && out[k].length === from)
			out[k] = Array.from({ length: to }, (_, i) => structuredClone(out[k][i % from]))
	return out
}

// A seat's mix: level (0..1.5), space (room send), tone (0 dark .. 1 open, a lowpass on everything it plays)
export const MIX = { level: 0.9, space: 0.25, tone: 1 }
// what differs from the default, for the seat's data; null when nothing does
export function mixData(mix) {
	const m = {}
	for (const k in MIX) if (Number.isFinite(mix?.[k]) && mix[k] !== MIX[k]) m[k] = mix[k]
	return Object.keys(m).length ? m : null
}
// instruments play into `out` (level), then the tone filter, then the room and master
export function seatStrip(audio, master, roomIn) {
	const out = audio.createGain()
	const lp = audio.createBiquadFilter()
	const send = audio.createGain()
	setTone(lp, MIX.tone, 0)
	out.connect(lp).connect(master)
	lp.connect(send).connect(roomIn)
	return { out, send, lp }
}
// tone 1 is wide open; down to 0 it closes to a dark 140 Hz with a little resonance on the way
export function setTone(lp, tone, t) {
	tone = Math.max(0, Math.min(1, tone ?? 1))
	lp.frequency.setTargetAtTime(140 * (20000 / 140) ** tone, t, 0.03)
	lp.Q.setTargetAtTime(0.7 + 1.8 * Math.sin(Math.PI * (1 - tone) * 0.9) ** 2, t, 0.03)
}

// The master chain every seat plays into: glue compressor, limiter, a shared room. The export renders through it too.
export function mixBus(audio, dest = audio.destination) {
	const master = audio.createGain()
	const comp = audio.createDynamicsCompressor()
	comp.threshold.value = -14
	comp.ratio.value = 3
	const limiter = audio.createDynamicsCompressor()
	limiter.threshold.value = -3
	limiter.knee.value = 0
	limiter.ratio.value = 20
	limiter.attack.value = 0.001
	limiter.release.value = 0.1
	const analyser = audio.createAnalyser()
	analyser.fftSize = 512
	master.connect(comp).connect(limiter).connect(analyser).connect(dest)
	const room = audio.createConvolver()
	room.buffer = impulse(audio, 2.8, 2.4)
	const roomIn = audio.createGain()
	const wet = audio.createGain()
	wet.gain.value = 0.55
	roomIn.connect(room).connect(wet).connect(master)
	return { master, roomIn, analyser }
}

function impulse(ac, sec, decay) {
	const len = Math.floor(ac.sampleRate * sec),
		b = ac.createBuffer(2, len, ac.sampleRate)
	for (let c = 0; c < 2; c++) {
		const d = b.getChannelData(c)
		for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
	}
	return b
}
