// Standalone audio engine and clock for the instrument lab page.
import { kit } from '../src/instruments/lib/kit.js'
export { SCALES, ROOTS, mtof } from '../src/instruments/lib/kit.js'

export function createClock(audio, { bpm = 96, steps = 16 } = {}) {
	const c = {
		bpm,
		steps,
		startTime: 0,
		playing: false,
		frozen: 0,
		get stepDur() {
			return 60 / c.bpm / 4
		},
		get loopDur() {
			return c.stepDur * c.steps
		},
		now: () => audio.currentTime,
		abs(t = audio.currentTime) {
			if (!c.playing) return c.frozen
			return (t - c.startTime) / c.stepDur
		},
		pos(t) {
			const a = c.abs(t)
			return ((a % c.steps) + c.steps) % c.steps
		},
		setBpm(b) {
			const a = c.abs()
			c.bpm = b
			if (c.playing) c.startTime = audio.currentTime - a * c.stepDur
		},
	}
	return c
}

export function createEngine() {
	const audio = new (window.AudioContext || window.webkitAudioContext)({
		latencyHint: 'interactive',
	})
	const comp = audio.createDynamicsCompressor()
	comp.threshold.value = -14
	comp.ratio.value = 4
	comp.attack.value = 0.004
	comp.release.value = 0.2
	comp.connect(audio.destination)

	const master = audio.createGain()
	master.gain.value = 0.8
	master.connect(comp)

	const reverb = audio.createConvolver()
	const len = Math.floor(audio.sampleRate * 2.8)
	const ir = audio.createBuffer(2, len, audio.sampleRate)
	for (let ch = 0; ch < 2; ch++) {
		const d = ir.getChannelData(ch)
		for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
	}
	reverb.buffer = ir
	const reverbOut = audio.createGain()
	reverbOut.gain.value = 0.5
	reverb.connect(reverbOut).connect(master)

	function seat() {
		const out = audio.createGain()
		const send = audio.createGain()
		out.connect(master)
		out.connect(send).connect(reverb)
		send.gain.value = 0.25
		return { out, send }
	}

	return { audio, master, reverb, seat, ...kit(audio) }
}
