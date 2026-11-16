// Local transport: same API as sync/sync.js, over BroadcastChannel between tabs of one browser.
// No server needed; the debug panel can fake latency, jitter and clock skew.
//   const t = createLocalTransport({ room, name, seat, color })
//   t.on('welcome' | 'peers' | 'apply' | 'pending' | 'cursor' | 'loop' | 'status', fn)
//   t.edit(seat, data)          -> server ms it lands at
//   t.seatAt(seat, ms?)         -> data in effect then
//   t.cursor(x, y, down, seat, name?)
//   t.setLoop({ bpm, bars, beatsPerBar })   lands on the next loop boundary
//   t.setMe({ name, seat, color })
//   t.clock.now() toLocal() toAudio(ctx, ms) pos() loopAt() nextBar() nextLoop() stats()
//   t.debug()
//   t.fake = { latency, jitter, skew, quantize }   local-only knobs

const LOOKAHEAD = 120
const localNow = () => performance.timeOrigin + performance.now()

export function createLocalClock() {
	const loops = []
	const self = {
		skew: 0, // ms added to this tab's idea of "shared" time; simulates an unsynced clock
		now: () => localNow() + self.skew,
		toLocal: (ms) => ms - self.skew - performance.timeOrigin,
		fromLocal: (perfMs) => perfMs + performance.timeOrigin + self.skew,
		toAudio: (ctx, ms) => ctx.currentTime + (self.toLocal(ms) - performance.now()) / 1000,
		setLoop(loop, from = -Infinity) {
			if (from === -Infinity) loops.length = 0
			loops.push({ loop, from })
			loops.sort((a, b) => a.from - b.from)
		},
		loopAt(t = self.now()) {
			let cur = loops[0]?.loop
			for (const l of loops) if (l.from <= t) cur = l.loop
			while (loops.length > 1 && loops[1].from <= t - 60_000) loops.shift()
			return cur
		},
		pending: () => loops.filter((l) => l.from > self.now()).map((l) => l.loop),
		beatMs: (l) => 60000 / l.bpm,
		barMs: (l) => self.beatMs(l) * l.beatsPerBar,
		loopMs: (l) => self.barMs(l) * l.bars,
		pos(t = self.now()) {
			const l = self.loopAt(t)
			if (!l) return null
			const beats = (t - l.origin) / self.beatMs(l)
			const total = l.beatsPerBar * l.bars
			const inLoop = ((beats % total) + total) % total
			return { beats, bar: Math.floor(inLoop / l.beatsPerBar), beat: Math.floor(inLoop % l.beatsPerBar), loopPhase: inLoop / total, loop: l }
		},
		nextBar(t = self.now()) { const l = self.loopAt(t); const u = self.barMs(l); return l.origin + Math.ceil((t - l.origin) / u) * u },
		nextLoop(t = self.now()) { const l = self.loopAt(t); const u = self.loopMs(l); return l.origin + Math.ceil((t - l.origin) / u) * u },
		stats: () => ({ rtt: 0, rttLast: 0, jitter: 0, offset: self.skew, drift: 0, locked: true, samples: 0 }),
	}
	return self
}

export function createLocalTransport({ room = 'open', name = 'anon', seat = null, color = null } = {}) {
	const clock = createLocalClock()
	const id = Math.random().toString(36).slice(2, 9)
	const listeners = {}
	const seats = {}
	const others = new Map()
	const me = { id, name, seat, color }
	const fake = { latency: 0, jitter: 0, quantize: 'bar' }
	let welcomed = false, sent = 0, recv = 0, lastLateMs = 0, rev = 0

	clock.setLoop({ bpm: 92, beatsPerBar: 4, bars: 2, origin: Math.floor(localNow()) })

	const emit = (ev, d) => (listeners[ev] || []).forEach((fn) => fn(d))
	const on = (ev, fn) => ((listeners[ev] ||= []).push(fn), () => (listeners[ev] = listeners[ev].filter((f) => f !== fn)))

	let chan = null
	try { chan = new BroadcastChannel('roughjam:' + room) } catch {}
	const tx = (m) => {
		if (!chan) return
		const msg = { ...m, from: id }
		const d = fake.latency + Math.random() * fake.jitter
		sent++
		if (d <= 0) chan.postMessage(msg)
		else setTimeout(() => chan.postMessage(msg), d)
	}

	const peers = () => [me, ...others.values()].map(({ id, name, seat, color }) => ({ id, name, seat, color }))

	function schedule(ms, fn) { setTimeout(fn, Math.max(0, clock.toLocal(ms) - performance.now())) }
	function record(seat, entry) {
		const h = (seats[seat] ||= [])
		h.push(entry)
		h.sort((a, b) => a.at - b.at || a.rev - b.rev)
		while (h.length > 4) h.shift()
		schedule(entry.at - LOOKAHEAD, () => {
			// timers for edits landing on the same bar can fire out of order; only the newest one for that bar applies
			const cur = seats[seat] || [], i = cur.indexOf(entry)
			if (i < 0 || cur[i + 1]?.at === entry.at) return
			const late = clock.now() - (entry.at - LOOKAHEAD)
			if (late > 20) lastLateMs = late
			emit('apply', { seat, ...entry, local: entry.from === id })
		})
	}
	function seatAt(seat, t = clock.now()) {
		let cur
		for (const e of seats[seat] || []) if (e.at <= t) cur = e
		return cur?.data
	}
	const snapshot = () => Object.fromEntries(Object.entries(seats).map(([k, h]) => { const e = h.at(-1); return [k, { at: e.at, data: e.data, rev: e.rev, owner: e.from }] }))

	if (chan) chan.onmessage = ({ data: m }) => {
		if (!m || m.from === id) return
		recv++
		const known = others.get(m.from)
		if (known) known.last = Date.now()
		switch (m.t) {
			case 'hello':
			case 'presence': {
				const p = known || { id: m.from, last: Date.now() }
				for (const k of ['name', 'seat', 'color']) if (k in m) p[k] = m[k]
				others.set(m.from, p)
				if (m.t === 'hello') tx({ t: 'welcome', to: m.from, loop: clock.loopAt(), seats: snapshot(), name: me.name, seat: me.seat, color: me.color })
				emit('peers', peers())
				break
			}
			case 'welcome':
				if (!others.has(m.from)) { others.set(m.from, { id: m.from, name: m.name, seat: m.seat, color: m.color, last: Date.now() }); emit('peers', peers()) }
				if (m.to !== id || welcomed) return
				welcomed = true
				clock.setLoop(m.loop, -Infinity)
				for (const [seat, l] of Object.entries(m.seats)) record(seat, { at: l.at, data: l.data, rev: l.rev, from: l.owner })
				emit('welcome', { id, loop: m.loop, seats: m.seats, peers: peers() })
				break
			case 'edit': record(m.seat, { at: m.at, data: m.data, rev: m.rev, from: m.from }); break
			case 'cursor': emit('cursor', { ...m, name: m.name || others.get(m.from)?.name }); break
			case 'loop': clock.setLoop(m.loop, m.at); schedule(m.at - LOOKAHEAD, () => emit('loop', { loop: m.loop, at: m.at })); break
			case 'beat':
				if (!known) { tx({ t: 'presence', ...me }); }
				break
			case 'bye': others.delete(m.from); emit('peers', peers()); break
		}
	}

	tx({ t: 'hello', name: me.name, seat: me.seat, color: me.color })
	setTimeout(() => { if (!welcomed) { welcomed = true; emit('welcome', { id, loop: clock.loopAt(), seats: {}, peers: peers() }) } emit('status', { connected: !!chan }) }, 400)
	setInterval(() => {
		tx({ t: 'beat' })
		const cutoff = Date.now() - 4000
		let changed = false
		for (const [pid, p] of others) if (p.last < cutoff) { others.delete(pid); changed = true }
		if (changed) emit('peers', peers())
	}, 1000)
	addEventListener('pagehide', () => tx({ t: 'bye' }))

	function edit(seat, data, opts = {}) {
		const now = clock.now()
		const at = opts.now || fake.quantize === 'off' ? now : clock.nextBar(now + Math.max(80, fake.latency * 1.5 + fake.jitter + 40) + LOOKAHEAD)
		const r = ++rev
		record(seat, { at, data, rev: r, from: id })
		tx({ t: 'edit', seat, data, at, rev: r })
		emit('pending', { seat, data, at })
		return at
	}

	function setLoop(patch) {
		const cur = clock.loopAt()
		const at = clock.nextLoop(clock.now() + 200)
		const loop = { ...cur, ...patch, origin: at }
		clock.setLoop(loop, at)
		tx({ t: 'loop', loop, at })
		schedule(at - LOOKAHEAD, () => emit('loop', { loop, at }))
		return at
	}

	return {
		kind: 'local',
		on,
		edit,
		seatAt,
		seats: () => Object.fromEntries(Object.keys(seats).map((k) => [k, seatAt(k)])),
		cursor: (x, y, down = false, seat = me.seat, name) => tx({ t: 'cursor', x, y, down, seat, name }),
		setLoop,
		setMe: (patch) => { Object.assign(me, patch); tx({ t: 'presence', ...patch }); emit('peers', peers()) },
		clock,
		fake,
		get id() { return id },
		get peers() { return peers() },
		debug: () => ({ connected: !!chan, id, room, peers: others.size + 1, ...clock.stats(), pending: 0, sent, recv, lateMs: lastLateMs, pos: clock.pos() }),
		close: () => chan?.close(),
	}
}
