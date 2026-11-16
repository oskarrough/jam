// roughjam sync client. One module, no deps.
//
//   const t = createTransport({ url: 'ws://host:8787', room: 'open', name: 'oskar', instrument: 'bass' })
//   t.on('apply', ({ lane, data, at }) => ...)   // fires LOOKAHEAD ms before `at` (server ms)
//   const at = t.edit('bass', state)             // quantized to next bar, returns server ms
//   t.laneAt('bass', serverMs)                   // what an audio scheduler should play at that time
//   t.clock.now() / toLocal() / toAudio(ctx, t) / pos() / nextBar()
//   t.debug()                                    // {connected, peers, rtt, offset, drift, jitter, ...}
//
// Every timestamp on the wire is server ms. Local time is performance.timeOrigin + performance.now(),
// which is monotonic, unlike Date.now().

const LOOKAHEAD = 120 // ms before `at` that 'apply' fires, so audio can schedule exactly on the bar
const SAMPLES = 24

const localNow = () => performance.timeOrigin + performance.now()

export function createClock() {
	const samples = [] // {rtt, offset, local}
	let offset = 0 // server - local, slewed
	let locked = false
	const loops = [] // [{loop, from}] future loop changes queue behind the current one

	function addSample(c0, s, c1) {
		const rtt = c1 - c0
		const raw = s - (c0 + c1) / 2
		samples.push({ rtt, offset: raw, local: c1 })
		if (samples.length > SAMPLES) samples.shift()
		// Trust the fastest round trips: least queueing, most symmetric.
		const minRtt = Math.min(...samples.map((x) => x.rtt))
		const good = samples.filter((x) => x.rtt <= minRtt * 1.25 + 2).map((x) => x.offset).sort((a, b) => a - b)
		const est = good[good.length >> 1]
		if (!locked || Math.abs(est - offset) > 30) offset = est
		else offset += Math.max(-1, Math.min(1, est - offset)) // slew ≤1ms per sample, no audible jumps
		if (samples.length >= 6) locked = true
	}

	const now = () => localNow() + offset
	const toLocal = (serverMs) => serverMs - offset - performance.timeOrigin // -> performance.now() ms
	const fromLocal = (perfMs) => perfMs + performance.timeOrigin + offset
	// AudioContext time for a server timestamp. Ignores output latency; instruments can subtract ctx.outputLatency.
	const toAudio = (ctx, serverMs) => ctx.currentTime + (toLocal(serverMs) - performance.now()) / 1000

	function setLoop(loop, from = -Infinity) {
		loops.push({ loop, from })
		loops.sort((a, b) => a.from - b.from)
	}
	function loopAt(t = now()) {
		let cur = loops[0]?.loop
		for (const l of loops) if (l.from <= t) cur = l.loop
		// prune changes that are fully in the past
		while (loops.length > 1 && loops[1].from <= t - 60_000) loops.shift()
		return cur
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
		return { beats, bar: Math.floor(inLoop / l.beatsPerBar), beat: Math.floor(inLoop % l.beatsPerBar), loopPhase: inLoop / total, loop: l }
	}
	const ceilTo = (l, t, unit) => l.origin + Math.ceil((t - l.origin) / unit) * unit
	const nextBar = (t = now()) => ceilTo(loopAt(t), t, barMs(loopAt(t)))
	const nextLoop = (t = now()) => ceilTo(loopAt(t), t, loopMs(loopAt(t)))

	function stats() {
		const rtts = samples.map((x) => x.rtt)
		const mean = rtts.reduce((a, b) => a + b, 0) / (rtts.length || 1)
		const jitter = Math.sqrt(rtts.reduce((a, b) => a + (b - mean) ** 2, 0) / (rtts.length || 1))
		// Drift: slope of raw offset vs local time across the sample window, in ms per minute.
		// Only low-RTT samples, and only once the window spans 20s; before that jitter dominates the slope.
		let drift = null
		const minRtt = Math.min(...rtts)
		const good = samples.filter((x) => x.rtt <= minRtt * 1.5 + 5)
		if (good.length > 4 && good.at(-1).local - good[0].local > 20000) {
			const xs = good.map((x) => x.local), ys = good.map((x) => x.offset)
			const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length
			let num = 0, den = 0
			for (let i = 0; i < xs.length; i++) (num += (xs[i] - mx) * (ys[i] - my)), (den += (xs[i] - mx) ** 2)
			drift = den ? (num / den) * 60000 : 0
		}
		return { rtt: rtts.length ? Math.min(...rtts) : null, rttLast: rtts.at(-1) ?? null, jitter, offset, drift, locked, samples: samples.length }
	}

	/** Adapter for the instruments' clock shape: {bpm, steps, startTime, pos()} in performance.now() ms. */
	function instrumentClock(steps = 16) {
		return {
			get bpm() { return loopAt()?.bpm },
			steps,
			get startTime() { return toLocal(loopAt().origin) },
			pos: () => { const p = pos(); return p && p.loopPhase * steps },
		}
	}

	/** Loop changes scheduled but not yet in effect. */
	const pending = (t = now()) => loops.filter((l) => l.from > t).map((l) => l.loop)

	return { addSample, pending, now, toLocal, fromLocal, toAudio, setLoop, loopAt, pos, nextBar, nextLoop, stats, instrumentClock, beatMs, barMs, loopMs }
}

export function createTransport({ url, room = 'open', name = 'anon', instrument = null, color = null } = {}) {
	const clock = createClock()
	const listeners = {}
	const lanes = {} // lane -> [{at, data, rev, from}] (short history so laneAt() can answer for near-future times)
	const pending = new Map() // nonce -> {lane, data, at}
	const timers = new Set()
	let ws = null, id = null, peers = [], connected = false, retry = 0, pingTimer = null, closed = false
	let me = { name, instrument, color }
	let sent = 0, recv = 0, lastLateMs = 0

	const emit = (ev, d) => (listeners[ev] || []).forEach((fn) => fn(d))
	const on = (ev, fn) => ((listeners[ev] ||= []).push(fn), () => (listeners[ev] = listeners[ev].filter((f) => f !== fn)))
	const tx = (m) => { if (ws?.readyState === 1) { ws.send(JSON.stringify(m)); sent++ } }

	// Solo default until the server answers: local clock, default loop.
	clock.setLoop({ bpm: 96, beatsPerBar: 4, bars: 4, origin: Math.floor(localNow()) })

	function schedule(serverMs, fn) {
		const delay = clock.toLocal(serverMs) - performance.now()
		const h = setTimeout(() => (timers.delete(h), fn()), Math.max(0, delay))
		timers.add(h)
	}

	function record(lane, entry) {
		const h = (lanes[lane] ||= [])
		h.push(entry)
		h.sort((a, b) => a.at - b.at || a.rev - b.rev)
		while (h.length > 4) h.shift()
		schedule(entry.at - LOOKAHEAD, () => {
			const late = clock.now() - (entry.at - LOOKAHEAD)
			if (late > 20) lastLateMs = late
			emit('apply', { lane, ...entry, local: entry.from === id || entry.from === 'me' })
		})
	}

	function connect() {
		if (!url || closed) return
		const u = new URL(url, location.href)
		u.searchParams.set('room', room) // the Worker routes rooms to Durable Objects by this
		ws = new WebSocket(u)
		ws.onopen = () => {
			connected = true
			retry = 0
			tx({ t: 'hello', room, ...me })
			// Burst of pings to lock fast, then a slow trickle to track drift.
			let n = 0
			const burst = () => { tx({ t: 'ping', c0: localNow() }); if (++n < 10) pingTimer = setTimeout(burst, 50); else pingTimer = setInterval(() => tx({ t: 'ping', c0: localNow() }), 1500) }
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
				for (const [lane, l] of Object.entries(m.lanes)) record(lane, { at: l.at, data: l.data, rev: l.rev, from: l.owner })
				emit('welcome', { id, loop: m.loop, lanes: m.lanes, peers })
				emit('peers', peers)
			} else if (m.t === 'peers') {
				peers = m.peers
				emit('peers', peers)
			} else if (m.t === 'edit') {
				if (m.nonce && pending.has(m.nonce)) {
					// Our own edit: already scheduled locally. Server may have pushed `at` later if we were late.
					pending.delete(m.nonce)
					if (m.at !== m.proposed) {
						lanes[m.lane] = (lanes[m.lane] || []).filter((e) => e.rev !== Infinity)
						record(m.lane, { at: m.at, data: m.data, rev: m.rev, from: m.from })
					}
					return
				}
				record(m.lane, { at: m.at, data: m.data, rev: m.rev, from: m.from })
			} else if (m.t === 'cursor') emit('cursor', m)
			else if (m.t === 'loop') {
				clock.setLoop(m.loop, m.at)
				schedule(m.at - LOOKAHEAD, () => emit('loop', { loop: m.loop, at: m.at }))
			}
		}
		ws.onclose = () => {
			connected = false
			clearTimeout(pingTimer); clearInterval(pingTimer)
			emit('status', { connected })
			if (!closed) setTimeout(connect, Math.min(5000, 300 * 2 ** retry++))
		}
	}
	connect()

	/** Quantize an edit to the next bar that's safely beyond network latency. Returns server ms. */
	function edit(lane, data) {
		const { rtt } = clock.stats()
		const margin = Math.max(80, (rtt ?? 100) * 1.5 + 40) + LOOKAHEAD
		const at = clock.nextBar(clock.now() + margin)
		const nonce = Math.random().toString(36).slice(2)
		pending.set(nonce, { lane, data, at })
		record(lane, { at, data, rev: Infinity, from: id || 'me' }) // play our own edit even offline
		tx({ t: 'edit', lane, data, at, nonce, proposed: at })
		emit('pending', { lane, data, at })
		return at
	}

	/** The lane data in effect at a given server time. Audio schedulers should call this per step. */
	function laneAt(lane, t = clock.now()) {
		const h = lanes[lane]
		if (!h) return undefined
		let cur
		for (const e of h) if (e.at <= t) cur = e
		return cur?.data
	}

	return {
		on,
		edit,
		laneAt,
		lanes: () => Object.fromEntries(Object.keys(lanes).map((k) => [k, laneAt(k)])),
		cursor: (x, y, down = false, lane = me.instrument, name) => tx({ t: 'cursor', x, y, down, lane, name }),
		setLoop: (loop) => tx({ t: 'loop', ...loop }),
		setMe: (patch) => { Object.assign(me, patch); tx({ t: 'presence', ...patch }) },
		clock,
		get id() { return id },
		get peers() { return peers },
		debug: () => ({ connected, id, room, peers: peers.length, ...clock.stats(), pending: pending.size, sent, recv, lateMs: lastLateMs, pos: clock.pos() }),
		close: () => { closed = true; ws?.close(); timers.forEach(clearTimeout) },
	}
}
