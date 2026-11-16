// Engine: audio graph, lanes, lookahead scheduler.
// Talks to a transport (local.js or sync/sync.js, same API) and to instruments (see instruments/index.js).

import { registry } from './instruments/index.js'
import { val } from './instruments/util.js'

import { LANE_COLORS, INK_THEME } from './palette.js'
export { LANE_COLORS }

export function createEngine(transport, { laneIds, instruments }) {
	const { clock } = transport
	const audio = new (window.AudioContext || window.webkitAudioContext)()
	const cfg = { lookaheadMs: 120, tickMs: 25 }
	const stats = { scheduled: 0, late: 0, lastLateMs: 0 }
	let soundOn = false
	const listeners = {}
	const emit = (ev, d) => (listeners[ev] || []).forEach((fn) => fn(d))
	const on = (ev, fn) => (listeners[ev] ||= []).push(fn)


	// master chain: lanes -> master -> compressor -> analyser -> out; lanes also send to a shared room
	const master = audio.createGain()
	master.gain.value = 0
	const comp = audio.createDynamicsCompressor()
	comp.threshold.value = -14
	comp.ratio.value = 3
	const analyser = audio.createAnalyser()
	analyser.fftSize = 512
	master.connect(comp).connect(analyser).connect(audio.destination)
	const room = audio.createConvolver()
	room.buffer = impulse(audio, 2.8, 2.4)
	const roomIn = audio.createGain()
	const wet = audio.createGain()
	wet.gain.value = 0.55
	roomIn.connect(room).connect(wet).connect(master)

	const loop = () => clock.loopAt()
	const steps = () => { const l = loop(); return l.bars * l.beatsPerBar * 4 }
	const stepMs = (l = loop()) => clock.beatMs(l) / 4

	// what instruments see as ctx.clock
	const iclock = {
		get bpm() { return loop().bpm },
		get steps() { return steps() },
		get stepDur() { return stepMs() / 1000 },
		get startTime() { return clock.toAudio(audio, loop().origin) },
		now: () => audio.currentTime,
		pos: () => { const p = clock.pos(); return p ? p.loopPhase * steps() : 0 },
		get playing() { return soundOn },
	}

	const lanes = laneIds.map((id, i) => {
		const out = audio.createGain()
		const send = audio.createGain()
		out.connect(master)
		out.connect(send).connect(roomIn)
		return { id, index: i, color: LANE_COLORS[i % LANE_COLORS.length], out, send, mix: { level: 0.9, space: 0.25, mute: false }, module: null, instance: null, params: {}, canvas: document.createElement('canvas') }
	})
	lanes.forEach((L) => (L.g = L.canvas.getContext('2d')))

	function applyMix(L) {
		L.out.gain.setTargetAtTime(L.mix.mute ? 0 : L.mix.level, audio.currentTime, 0.02)
		L.send.gain.setTargetAtTime(L.mix.space, audio.currentTime, 0.02)
	}

	function setInstrument(L, id, { state, params } = {}) {
		const mod = registry.get(id) || registry.values().next().value
		if (L.instance) L.instance.dispose?.()
		L.module = mod
		L.params = Object.fromEntries(Object.entries(mod.params || {}).map(([k, p]) => [k, val(p)]))
		if (params) Object.assign(L.params, params)
		L.instance = mod.create({ audio, out: L.out, clock: iclock, params: L.params, color: L.color, theme: INK_THEME })
		if (state !== undefined) L.instance.setState(state)
		applyMix(L)
		emit('lanes')
	}

	lanes.forEach((L, i) => {
		const id = instruments[i]
		const mod = registry.get(id)
		setInstrument(L, id, { state: mod?.sample?.(steps()) })
	})

	// network: lane data is {instrument, state, params}
	const laneById = (id) => lanes.find((L) => L.id === id)
	const lastSent = new Map()
	function push(L, { now = false } = {}) {
		const data = { instrument: L.module.id, state: structuredClone(L.instance.state), params: { ...L.params } }
		lastSent.set(L.id, performance.now())
		return transport.edit(L.id, data, { now })
	}
	const timers = new Map()
	function pushSoon(L) {
		// throttle to ~10/s while drawing, always send the trailing edit
		const since = performance.now() - (lastSent.get(L.id) || 0)
		clearTimeout(timers.get(L.id))
		if (since > 100) push(L)
		else timers.set(L.id, setTimeout(() => push(L), 100 - since))
	}
	transport.on('apply', ({ lane, data, local }) => {
		const L = laneById(lane)
		if (!L || !data || local) return
		if (data.instrument !== L.module.id) setInstrument(L, data.instrument, { state: data.state, params: data.params })
		else { if (data.params) Object.assign(L.params, data.params); L.instance.setState(data.state) }
		emit('apply', L)
	})
	transport.on('welcome', ({ lanes: snap }) => {
		// first in the room: publish our starting lanes so later joiners get them
		for (const L of lanes) if (!snap || !snap[L.id]) push(L, { now: true })
	})

	// scheduler: walk 16ths on the shared timeline, hand each to every lane ahead of time
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
			const sm = stepMs(l), n = l.bars * l.beatsPerBar * 4
			const abs = Math.round((nextT - l.origin) / sm)
			const i = ((abs % n) + n) % n
			const at = clock.toAudio(audio, nextT)
			if (at < audio.currentTime) { stats.late++; stats.lastLateMs = (audio.currentTime - at) * 1000 }
			else for (const L of lanes) { try { L.instance.step(i, at, sm / 1000) } catch (e) { console.error(L.module.id, e) } }
			stats.scheduled++
			// a loop change re-anchors the grid at its own origin
			const next = nextT + sm, ln = clock.loopAt(next)
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
	function level() {
		if (!soundOn) return 0
		analyser.getFloatTimeDomainData(buf)
		let s = 0
		for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
		return Math.sqrt(s / buf.length)
	}

	return {
		audio, lanes, cfg, stats, iclock, transport,
		on, setInstrument, push, pushSoon, applyMix, setSound, level,
		get soundOn() { return soundOn },
		steps, loop,
		setTick(ms) { cfg.tickMs = ms; clearInterval(timer); timer = setInterval(tick, ms) },
	}
}

function impulse(ac, sec, decay) {
	const len = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(2, len, ac.sampleRate)
	for (let c = 0; c < 2; c++) {
		const d = b.getChannelData(c)
		for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
	}
	return b
}
