// Save audio: re-render a recording offline, through the same instruments and master chain as the jam, then
// encode it. m4a (AAC) where the browser encodes it natively, WAV everywhere else. Phones get the share sheet.

import { registry } from './instruments/index.js'
import { val } from './instruments/lib/util.js'
import { kit } from './instruments/lib/kit.js'
import { mixBus, SEAT_COLORS } from './engine.js'
import { INK_THEME } from './palette.js'

const RATE = 48000
const LEAD = 0.05 // s of air before the downbeat
const TAIL = 3 // s to let the room ring out after the last bar
const MIX = { level: 0.9, space: 0.25 } // a seat's default mix; mixes are local, so the recording has none

/** Renders rec to a stereo AudioBuffer, faster than realtime. */
export async function renderRecording(rec, seatIds) {
	const loop = rec.loop
	const stepDur = 60 / loop.bpm / 4
	const barSteps = loop.beatsPerBar * 4
	const n = loop.bars * barSteps
	const total = rec.bars * barSteps
	const end = LEAD + total * stepDur
	const off = new OfflineAudioContext(2, Math.ceil((end + TAIL) * RATE), RATE)

	// Instruments schedule at audio.currentTime (envelopes, dispose), which sits at 0 before an offline render.
	// This view of the context reports the moment being scheduled instead, so they behave exactly as live.
	let cursor = 0
	const audio = new Proxy(off, {
		get(t, k) {
			if (k === 'currentTime') return cursor
			const v = Reflect.get(t, k)
			return typeof v === 'function' ? v.bind(t) : v
		},
	})
	kit(audio).follow(() => loop)

	const { master, roomIn } = mixBus(off)
	master.gain.setValueAtTime(0.8, 0)
	master.gain.setValueAtTime(0.8, end)
	master.gain.linearRampToValueAtTime(0, end + TAIL)

	const clock = {
		bpm: loop.bpm,
		steps: n,
		stepDur,
		startTime: LEAD,
		now: () => cursor,
		pos: () => ((((cursor - LEAD) / stepDur) % n) + n) % n,
		playing: true,
	}

	const seats = seatIds.map((id, i) => {
		const out = off.createGain()
		const send = off.createGain()
		out.gain.value = MIX.level
		send.gain.value = MIX.space
		out.connect(master)
		out.connect(send).connect(roomIn)
		return { id, color: SEAT_COLORS[i % SEAT_COLORS.length], out, mod: null, inst: null, params: null }
	})
	function apply(L, data) {
		const mod = registry.get(data.instrument)
		if (!mod) return
		if (mod !== L.mod) {
			L.inst?.dispose?.()
			L.mod = mod
			L.params = Object.fromEntries(Object.entries(mod.params || {}).map(([k, p]) => [k, val(p)]))
			L.inst = mod.create({ audio, out: L.out, clock, params: L.params, color: L.color, theme: INK_THEME })
		}
		if (data.params) Object.assign(L.params, data.params)
		L.inst.setState(data.state)
		L.out.gain.setValueAtTime(data.mute ? 0 : MIX.level, cursor)
	}

	for (let g = 0; g < total; g++) {
		cursor = LEAD + g * stepDur
		if (g % barSteps === 0) {
			const frame = rec.frames[g / barSteps] || {}
			for (const L of seats) if (frame[L.id]) apply(L, frame[L.id])
		}
		for (const L of seats) {
			try { L.inst?.step(g % n, cursor, stepDur) } catch (e) { console.error(L.mod.id, e) }
		}
	}
	cursor = end
	for (const L of seats) L.inst?.dispose?.()
	return off.startRendering()
}

/** Encodes to m4a if this browser can, else WAV. Resolves with a File. */
export async function encodeRecording(buffer, { name, title, artist }) {
	try {
		const mb = await import('./vendor/mediabunny-m4a.js')
		const opts = { numberOfChannels: 2, sampleRate: RATE, bitrate: 192e3 }
		if (await mb.canEncodeAudio('aac', opts)) {
			const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() })
			const src = new mb.AudioBufferSource({ codec: 'aac', bitrate: opts.bitrate })
			output.addAudioTrack(src)
			output.setMetadataTags({ title, artist })
			await output.start()
			await src.add(buffer)
			await output.finalize()
			return new File([output.target.buffer], name + '.m4a', { type: 'audio/mp4' })
		}
	} catch (e) { console.warn('m4a failed, writing WAV', e) }
	return new File([wav(buffer)], name + '.wav', { type: 'audio/wav' })
}

function wav(buffer) {
	const ch = buffer.numberOfChannels, len = buffer.length, bytes = len * ch * 2
	const v = new DataView(new ArrayBuffer(44 + bytes))
	const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
	str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE')
	str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true)
	v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true)
	str(36, 'data'); v.setUint32(40, bytes, true)
	const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c))
	for (let i = 0, o = 44; i < len; i++) for (let c = 0; c < ch; c++, o += 2) {
		const s = Math.max(-1, Math.min(1, data[c][i]))
		v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
	}
	return v.buffer
}

/** Phones get the share sheet (WhatsApp, Messages…); everyone else a download. Throws NotAllowedError when the tap has gone stale. */
export async function deliver(file) {
	if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
		try { await navigator.share({ files: [file], title: file.name }) } catch (e) { if (e.name !== 'AbortError') throw e }
		return 'shared'
	}
	const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name })
	a.click()
	setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
	return 'saved'
}
