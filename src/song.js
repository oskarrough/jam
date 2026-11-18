// A song as plain data: the loop and every seat's part and mix, nobody sitting. The share link carries it in its
// hash (#song=…, deflated and base64url), autosave keeps it in localStorage per room, and window.jam.export() /
// jam.import() hand it over by hand.
//   song = { v: 1, loop: {bpm, beatsPerBar, bars, root?, scale?, chords?}, seats: [{instrument, state, params, len?, mix?, mute?} ×4] }

import { partOf, mixData, readMix } from './engine.js'

export const VERSION = 1

export function songOf(engine, transport) {
	const { bpm, beatsPerBar, bars, root, scale, chords } = transport.clock.latestLoop()
	const loop = { bpm, beatsPerBar, bars }
	if (root) loop.root = root
	if (scale) loop.scale = scale
	if (chords) loop.chords = chords
	return {
		v: VERSION,
		loop,
		seats: engine.seats.map((L) => {
			const d = structuredClone(partOf(L)),
				m = mixData(L.mix)
			if (m) d.mix = m
			if (L.mix.mute) d.mute = true
			return d
		}),
	}
}

// throws with a message fit for the page when a song can't be played here
export function checkSong(s) {
	if (!s || typeof s !== 'object' || !Number.isInteger(s.v))
		throw new Error('that song link is broken')
	if (s.v > VERSION) throw new Error('that song is from a newer jam: reload and try again')
	if (s.v !== VERSION || !s.loop || !Array.isArray(s.seats))
		throw new Error('that song link is broken')
	return s
}

// the song lands on the next bar for everyone; robots stay off, seats stay free
export function loadSong(engine, transport, song) {
	checkSong(song)
	const { bpm, beatsPerBar, bars, root, scale, chords } = song.loop
	transport.setLoop({ bpm, beatsPerBar, bars, root, scale, chords, robots: false })
	song.seats.forEach((d, i) => {
		const L = engine.seats[i]
		if (!L || !d?.instrument) return
		L.riff = null
		engine.applyPart(L, structuredClone(d))
		Object.assign(L.mix, readMix(d.mix), { mute: !!d.mute })
		engine.applyMix(L)
		engine.push(L, { now: true })
	})
}

const pipe = async (bytes, stream) =>
	new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer())

export async function encodeSong(song) {
	const z = await pipe(
		new TextEncoder().encode(JSON.stringify(song)),
		new CompressionStream('deflate-raw'),
	)
	let s = ''
	for (let i = 0; i < z.length; i += 0x8000) s += String.fromCharCode(...z.subarray(i, i + 0x8000))
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// a whole link, a bare hash, the encoded text alone, or the JSON
export async function decodeSong(text) {
	text = String(text).trim()
	if (text.startsWith('{')) return checkSong(JSON.parse(text))
	text = text.replace(/^.*#(song|seed)=/, '')
	let z
	try {
		const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
		z = await pipe(
			Uint8Array.from(b, (c) => c.charCodeAt(0)),
			new DecompressionStream('deflate-raw'),
		)
	} catch {
		throw new Error('that song link is broken')
	}
	return checkSong(JSON.parse(new TextDecoder().decode(z)))
}
