// roughjam sync client. One module, no deps.
//   const t = createTransport({ url: 'ws://host:8787', room: 'open', name: 'oskar', seat: 'bass' })
//   t.on('apply', ({ seat, data, at }) => ...)   // fires LOOKAHEAD ms before `at` (server ms)
//   const at = t.edit('bass', state)             // quantized to next bar, returns server ms
//   t.seatAt('bass', serverMs)                   // what an audio scheduler should play at that time
//   t.clock.now() / toLocal() / toAudio(ctx, t) / pos() / nextBar()
//   t.debug()                                    // {connected, peers, rtt, offset, drift, jitter, ...}
// Every timestamp on the wire is server ms. Local time is performance.timeOrigin + performance.now(),
// which is monotonic, unlike Date.now().

export const LOOKAHEAD = 120 // ms before `at` that 'apply' fires, so audio can schedule exactly on the bar
const SAMPLES = 24

const localNow = () => performance.timeOrigin + performance.now()

export function loopTimeline(now) {
	const loops = []
	function setLoop(loop, from = -Infinity) {
		loops.push({ loop, from })
		loops.sort((a, b) => a.from - b.from)
	}
	function loopAt(t = now()) {
		while (loops.length > 1 && loops[1].from <= t - 60_000) loops.shift()
		for (let i = loops.length - 1; i > 0; i--) if (loops[i].from <= t) return loops[i].loop
		return loops[0]?.loop
	}
	const beatMs = (l) => 60000 / l.bpm
	const barMs = (l) => beatMs(l) * l.beatsPerBar
	const loopMs = (l) => barMs(l) * l.bars

	function pos(t = now()) {
		const l = loopAt(t)
		if (!l) return null
		const beats = (t - l.origin) / beatMs(l)
		const total = l.beatsPerBar * l.bars
		const inLoop = ((beats % total) + total) % total
		return {
			beats,
			bar: Math.floor(inLoop / l.beatsPerBar),
			beat: Math.floor(inLoop % l.beatsPerBar),
			loopPhase: inLoop / total,
			loop: l,
		}
	}
	function next(t, duration) {
		const l = loopAt(t)
		const unit = duration(l)
		return l.origin + Math.ceil((t - l.origin) / unit) * unit
	}

	return {
		setLoop,
		loopAt,
		pos,
		beatMs,
		barMs,
		loopMs,
		resetLoop(loop) {
			loops.length = 0
			setLoop(loop)
		},
		nextBar: (t = now()) => next(t, barMs),
		nextLoop: (t = now()) => next(t, loopMs),
		latestLoop: () => loops.at(-1)?.loop,
		pending: (t = now()) => loops.filter((l) => l.from > t).map((l) => l.loop),
	}
}

export function createClock() {
	const samples = []
	let offset = 0
	let locked = false

	function addSample(c0, s, c1) {
		const rtt = c1 - c0
		const raw = s - (c0 + c1) / 2
		samples.push({ rtt, offset: raw, local: c1 })
		if (samples.length > SAMPLES) samples.shift()
		const minRtt = Math.min(...samples.map((x) => x.rtt))
		const good = samples
			.filter((x) => x.rtt <= minRtt * 1.25 + 2)
			.map((x) => x.offset)
			.sort((a, b) => a - b)
		const est = good[good.length >> 1]
		if (!locked || Math.abs(est - offset) > 30) offset = est
		else offset += Math.max(-1, Math.min(1, est - offset))
		if (samples.length >= 6) locked = true
	}

	const now = () => localNow() + offset
	const toLocal = (serverMs) => serverMs - offset - performance.timeOrigin
	const fromLocal = (perfMs) => perfMs + performance.timeOrigin + offset
	const toAudio = (ctx, serverMs) =>
		ctx.currentTime + (toLocal(serverMs) - performance.now()) / 1000

	function stats() {
		const rtts = samples.map((x) => x.rtt)
		const mean = rtts.reduce((a, b) => a + b, 0) / (rtts.length || 1)
		const jitter = Math.sqrt(rtts.reduce((a, b) => a + (b - mean) ** 2, 0) / (rtts.length || 1))
		// Drift in ms per minute: slope of raw offset over low-RTT samples; needs a 20 s window or jitter dominates.
		let drift = null
		const minRtt = Math.min(...rtts)
		const good = samples.filter((x) => x.rtt <= minRtt * 1.5 + 5)
		if (good.length > 4 && good.at(-1).local - good[0].local > 20000) {
			const xs = good.map((x) => x.local),
				ys = good.map((x) => x.offset)
			const mx = xs.reduce((a, b) => a + b) / xs.length,
				my = ys.reduce((a, b) => a + b) / ys.length
			let num = 0,
				den = 0
			for (let i = 0; i < xs.length; i++)
				((num += (xs[i] - mx) * (ys[i] - my)), (den += (xs[i] - mx) ** 2))
			drift = den ? (num / den) * 60000 : 0
		}
		return {
			rtt: rtts.length ? Math.min(...rtts) : null,
			rttLast: rtts.at(-1) ?? null,
			jitter,
			offset,
			drift,
			locked,
			samples: samples.length,
		}
	}

	const timeline = loopTimeline(now)
	const { pos, loopAt } = timeline

	function instrumentClock(steps = 16) {
		return {
			get bpm() {
				return loopAt()?.bpm
			},
			steps,
			get startTime() {
				return toLocal(loopAt().origin)
			},
			pos: () => {
				const p = pos()
				return p && p.loopPhase * steps
			},
		}
	}

	return { ...timeline, addSample, now, toLocal, fromLocal, toAudio, stats, instrumentClock }
}

// Shared by the relay and local tabs. Only the latest edit for a seat on a bar may fire.
export function seatHistory(clock, isLocal) {
	const seats = Object.create(null)
	const timers = new Set()
	const listeners = {}
	let lastLateMs = 0
	const emit = (ev, d) => (listeners[ev] || []).forEach((fn) => fn(d))
	const on = (ev, fn) => (
		(listeners[ev] ||= []).push(fn),
		() => (listeners[ev] = listeners[ev].filter((f) => f !== fn))
	)
	function schedule(serverMs, fn) {
		const delay = clock.toLocal(serverMs) - performance.now()
		const h = setTimeout(() => (timers.delete(h), fn()), Math.max(0, delay))
		timers.add(h)
	}

	function record(seat, entry) {
		const h = (seats[seat] ||= [])
		h.push(entry)
		h.sort((a, b) => a.at - b.at || a.rev - b.rev)
		while (h.length > 4) h.shift()
		schedule(entry.at - LOOKAHEAD, () => {
			// timers for edits landing on the same bar can fire out of order; only the newest one for that bar applies
			const i = h.indexOf(entry)
			if (i < 0 || h[i + 1]?.at === entry.at) return
			const late = clock.now() - (entry.at - LOOKAHEAD)
			if (late > 20) lastLateMs = late
			emit('apply', { seat, ...entry, local: isLocal(entry.from) })
		})
		return entry
	}

	function seatAt(seat, t = clock.now()) {
		const h = seats[seat]
		if (!h) return undefined
		let cur
		for (const e of h) if (e.at <= t) cur = e
		return cur?.data
	}

	return {
		on,
		emit,
		record,
		seatAt,
		schedule,
		seats: () => Object.fromEntries(Object.keys(seats).map((k) => [k, seatAt(k)])),
		snapshot: () =>
			Object.fromEntries(
				Object.entries(seats).map(([seat, entries]) => {
					const { at, data, rev, from } = entries.at(-1)
					return [seat, { at, data, rev, owner: from }]
				}),
			),
		forget(seat, entry) {
			const entries = seats[seat]
			const i = entries?.indexOf(entry) ?? -1
			if (i >= 0) entries.splice(i, 1)
			if (entries && !entries.length) delete seats[seat]
		},
		get lateMs() {
			return lastLateMs
		},
		close() {
			timers.forEach(clearTimeout)
			timers.clear()
		},
	}
}

export function createTransport({
	url,
	room = 'open',
	name = '',
	seat = null,
	color = null,
} = {}) {
	const clock = createClock()
	const pending = new Map()
	let ws = null,
		id = null,
		peers = [],
		connected = false,
		retry = 0,
		pingTimer = null,
		closed = false
	let me = { name, seat, color }
	let sent = 0,
		recv = 0

	const history = seatHistory(clock, (from) => from === id || from === 'me')
	const { on, emit, record, schedule, seatAt } = history
	const tx = (m) => {
		if (ws?.readyState === 1) {
			ws.send(JSON.stringify(m))
			sent++
		}
	}

	clock.setLoop({ bpm: 96, beatsPerBar: 4, bars: 4, origin: Math.floor(localNow()) })

	function connect() {
		if (!url || closed) return
		const u = new URL(url, location.href)
		u.searchParams.set('room', room)
		ws = new WebSocket(u)
		ws.onopen = () => {
			connected = true
			retry = 0
			tx({ t: 'hello', room, ...me })
			let n = 0
			const burst = () => {
				tx({ t: 'ping', c0: localNow() })
				if (++n < 10) pingTimer = setTimeout(burst, 50)
				else pingTimer = setInterval(() => tx({ t: 'ping', c0: localNow() }), 1500)
			}
			burst()
			emit('status', { connected })
		}
		ws.onmessage = (e) => {
			recv++
			const m = JSON.parse(e.data)
			if (m.t === 'pong') clock.addSample(m.c0, m.s, localNow())
			else if (m.t === 'welcome') {
				id = m.id
				peers = m.peers
				clock.setLoop(m.loop, -Infinity)
				for (const [seat, l] of Object.entries(m.seats))
					record(seat, { at: l.at, data: l.data, rev: l.rev, from: l.owner })
				emit('welcome', { id, loop: m.loop, seats: m.seats, peers })
				emit('peers', peers)
			} else if (m.t === 'peers') {
				peers = m.peers
				emit('peers', peers)
			} else if (m.t === 'edit') {
				if (m.nonce && pending.has(m.nonce)) {
					// Our own edit: already scheduled locally. Server may have pushed `at` later if we were late.
					const entry = pending.get(m.nonce)
					pending.delete(m.nonce)
					if (m.at !== m.proposed) {
						history.forget(m.seat, entry)
						record(m.seat, { at: m.at, data: m.data, rev: m.rev, from: m.from })
					}
					return
				}
				record(m.seat, { at: m.at, data: m.data, rev: m.rev, from: m.from })
			} else if (m.t === 'cursor') emit('cursor', m)
			else if (m.t === 'loop') {
				clock.setLoop(m.loop, m.at)
				schedule(m.at - LOOKAHEAD, () => emit('loop', { loop: m.loop, at: m.at }))
			}
		}
		ws.onclose = () => {
			connected = false
			clearTimeout(pingTimer)
			clearInterval(pingTimer)
			emit('status', { connected })
			if (!closed) setTimeout(connect, Math.min(5000, 300 * 2 ** retry++))
		}
	}
	connect()

	function edit(seat, data) {
		const { rtt } = clock.stats()
		const margin = Math.max(80, (rtt ?? 100) * 1.5 + 40) + LOOKAHEAD
		const at = clock.nextBar(clock.now() + margin)
		const nonce = Math.random().toString(36).slice(2)
		pending.set(nonce, record(seat, { at, data, rev: Infinity, from: id || 'me' }))
		tx({ t: 'edit', seat, data, at, nonce, proposed: at })
		emit('pending', { seat, data, at })
		return at
	}

	return {
		on,
		edit,
		seatAt,
		seats: history.seats,
		cursor: (x, y, down = false, seat = me.seat, name) =>
			tx({ t: 'cursor', x, y, down, seat, name }),
		setLoop: (loop) => tx({ t: 'loop', ...loop }),
		setMe: (patch) => {
			Object.assign(me, patch)
			tx({ t: 'presence', ...patch })
		},
		clock,
		get id() {
			return id
		},
		get peers() {
			return peers
		},
		debug: () => ({
			connected,
			id,
			room,
			peers: peers.length,
			...clock.stats(),
			pending: pending.size,
			sent,
			recv,
			lateMs: history.lateMs,
			pos: clock.pos(),
		}),
		close: () => {
			closed = true
			ws?.close()
			history.close()
		},
	}
}
