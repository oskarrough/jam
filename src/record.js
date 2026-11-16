// Souvenirs: record 8 bars of the jam, store them, replay them read-only at /r/<id>.
//   rec = { v: 1, loop: {bpm, beatsPerBar, bars, root, scale, chords}, bars: N, seats: [name|null ×seats],
//           frames: [{seat: data} ×N],   // seat data per bar; a seat is omitted if unchanged since the bar before
//           cursors: [[ms, seatIndex, x, y, down, name], …], room, at }

import { createClock } from '../sync/sync.js'

const MIN_BARS = 8
const CURSOR_HZ = 15

export function createRecorder({ engine, transport, seatName }) {
	const { seats } = engine
	const clock = transport.clock
	let cur = null

	const snap = (L) => ({
		instrument: L.module.id,
		state: structuredClone(L.instance.state),
		params: { ...L.params },
		...(L.mix.mute ? { mute: true } : {}),
	})
	const same = (a, b) => a && b && JSON.stringify(a) === JSON.stringify(b)

	const lastCursor = new Map()
	function logCursor(seat, x, y, down, name) {
		if (!cur?.running) return
		const t = clock.now() - cur.start
		if (t < 0) return
		const key = seat + '|' + name,
			prev = lastCursor.get(key)
		if (prev && t - prev < 1000 / CURSOR_HZ && down) return
		lastCursor.set(key, t)
		const i = seats.findIndex((L) => L.id === seat)
		if (i >= 0)
			cur.rec.cursors.push([
				Math.round(t),
				i,
				+x.toFixed(3),
				+y.toFixed(3),
				down ? 1 : 0,
				name || '',
			])
	}
	transport.on('cursor', (c) =>
		logCursor(
			c.seat,
			c.x,
			c.y,
			c.down,
			c.name || transport.peers.find((p) => p.id === c.from)?.name,
		),
	)
	const sendCursor = transport.cursor
	transport.cursor = (x, y, down, seat, name) => {
		logCursor(seat, x, y, down, name || seatName(seats.findIndex((L) => L.id === seat)))
		return sendCursor(x, y, down, seat, name)
	}

	/** onProgress({state, p}), state armed | rec. Resolves with the recording. */
	function record(onProgress = () => {}) {
		if (cur) return cur.promise
		const l = clock.loopAt()
		const barMs = clock.barMs(l)
		const bars = l.bars >= MIN_BARS ? l.bars : l.bars * Math.ceil(MIN_BARS / l.bars)
		const start = clock.nextLoop(clock.now() + 50)
		const { bpm, beatsPerBar, root, scale, chords } = l
		const rec = {
			v: 1,
			loop: { bpm, beatsPerBar, bars: l.bars, root, scale, chords },
			bars,
			seats: [],
			frames: [],
			cursors: [],
			at: Date.now(),
		}
		let resolve
		const promise = new Promise((r) => (resolve = r))
		cur = { rec, start, running: false, promise }
		const prev = {}
		let bar = 0
		const tick = () => {
			const now = clock.now()
			if (now < start) {
				onProgress({ state: 'armed', p: 1 - (start - now) / clock.loopMs(l), inMs: start - now })
				return
			}
			cur.running = true
			while (bar < bars && now >= start + bar * barMs + 30) {
				const f = {}
				seats.forEach((L) => {
					const d = snap(L)
					if (!same(d, prev[L.id])) f[L.id] = prev[L.id] = d
				})
				rec.frames.push(f)
				if (bar === 0) rec.seats = seats.map((L, i) => seatName(i) || null)
				bar++
			}
			onProgress({ state: 'rec', p: Math.min(1, (now - start) / (bars * barMs)) })
			if (now >= start + bars * barMs) {
				clearInterval(timer)
				cur = null
				resolve(rec)
			}
		}
		const timer = setInterval(tick, 20)
		tick()
		return promise
	}

	return {
		record,
		get busy() {
			return !!cur
		},
	}
}

export async function saveRecording(rec) {
	const r = await fetch('/api/r', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(rec),
	})
	if (!r.ok) throw new Error(`save failed: ${r.status} ${await r.text()}`)
	return (await r.json()).id
}

export async function loadRecording(id) {
	const r = await fetch('/api/r/' + encodeURIComponent(id))
	if (!r.ok) throw new Error(`no recording ${id} (${r.status})`)
	return r.json()
}

/** Plays a recording on a loop: read-only, same API as sync.js. */
export function createReplayTransport(rec, { seatIds, onCursor }) {
	const clock = createClock()
	const listeners = {}
	const emit = (ev, d) => (listeners[ev] || []).forEach((fn) => fn(d))
	const on = (ev, fn) => (
		(listeners[ev] ||= []).push(fn),
		() => (listeners[ev] = listeners[ev].filter((f) => f !== fn))
	)

	let origin = Math.ceil(clock.now() + 300)
	let loop = { ...rec.loop, origin }
	clock.setLoop(loop)
	const barMs = clock.barMs(loop),
		totalMs = rec.bars * barMs

	const full = []
	rec.frames.forEach((f, b) => (full[b] = { ...(full[b - 1] || {}), ...f }))
	const first = { ...full.at(-1), ...full[0] }
	const atBar = (b) => (b === 0 ? first : full[b])

	const peers = rec.seats
		.map((name, i) => name && { id: 'seat' + i, name, seat: seatIds[i] })
		.filter(Boolean)
	let bar = -1,
		cursorIdx = 0,
		lastPass = -1
	function tick() {
		const t = clock.now() - origin
		if (t < -150) return
		const pass = Math.floor(Math.max(0, t) / totalMs),
			inPass = Math.max(0, t) - pass * totalMs
		const b = Math.floor((inPass + 120) / barMs) % rec.bars
		if (b !== bar) {
			bar = b
			const seats = b === 0 ? atBar(0) : rec.frames[b]
			for (const [seat, data] of Object.entries(seats))
				emit('apply', { seat, data, at: origin + pass * totalMs + b * barMs })
		}
		if (pass !== lastPass) {
			lastPass = pass
			cursorIdx = 0
		}
		while (cursorIdx < rec.cursors.length && rec.cursors[cursorIdx][0] <= inPass) {
			const [, i, x, y, down, name] = rec.cursors[cursorIdx++]
			onCursor?.(i, x, y, !!down, name)
		}
	}
	setInterval(tick, 20)
	queueMicrotask(() => {
		emit('welcome', {
			id: 'replay',
			loop,
			seats: Object.fromEntries(seatIds.map((id) => [id, first[id]])),
			peers,
		})
		emit('peers', peers)
		tick()
	})

	return {
		kind: 'replay',
		on,
		edit: () => clock.now(),
		seatAt: (seat, t = clock.now()) => {
			const x = t - origin,
				i = Math.floor((((x % totalMs) + totalMs) % totalMs) / barMs)
			return atBar(i)?.[seat]
		},
		seats: () => atBar(Math.max(0, bar)),
		cursor() {},
		setLoop() {},
		setMe() {},
		clock,
		id: 'replay',
		peers,
		debug: () => ({
			connected: false,
			kind: 'replay',
			bars: rec.bars,
			bar,
			peers: peers.length,
			...clock.stats(),
		}),
		close() {},
		// back to bar 1, so whoever presses play hears the recording from the top
		restart() {
			origin = Math.ceil(clock.now() + 120)
			loop = { ...rec.loop, origin }
			clock.setLoop(loop)
			bar = -1
			lastPass = -1
			tick()
		},
	}
}
