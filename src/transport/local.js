// Local rooms share edits over BroadcastChannel. The debug panel can simulate latency and clock skew.
import { LOOKAHEAD, loopTimeline, seatHistory } from '../../sync/sync.js'
import { nextLoopAt } from '../../sync/room.js'

const localNow = () => performance.timeOrigin + performance.now()

function createLocalClock() {
	const timeline = loopTimeline(() => self.now())
	const self = {
		...timeline,
		skew: 0, // ms added to this tab's idea of "shared" time; simulates an unsynced clock
		now: () => localNow() + self.skew,
		toLocal: (ms) => ms - self.skew - performance.timeOrigin,
		fromLocal: (perfMs) => perfMs + performance.timeOrigin + self.skew,
		toAudio: (ctx, ms) => ctx.currentTime + (self.toLocal(ms) - performance.now()) / 1000,
		setLoop(loop, from = -Infinity) {
			if (from === -Infinity) timeline.resetLoop(loop)
			else timeline.setLoop(loop, from)
		},
		stats: () => ({
			rtt: 0,
			rttLast: 0,
			jitter: 0,
			offset: self.skew,
			drift: 0,
			locked: true,
			samples: 0,
		}),
	}
	return self
}

export function createLocalTransport({
	room = 'open',
	name = 'anon',
	seat = null,
	color = null,
} = {}) {
	const clock = createLocalClock()
	const id = Math.random().toString(36).slice(2, 9)
	const history = seatHistory(clock, (from) => from === id)
	const { on, emit, seatAt, schedule, record } = history
	const others = new Map()
	const me = { id, name, seat, color }
	const fake = { latency: 0, jitter: 0, quantize: 'bar' }
	let welcomed = false,
		sent = 0,
		recv = 0,
		rev = 0

	clock.setLoop({ bpm: 96, beatsPerBar: 4, bars: 4, origin: Math.floor(localNow()) })

	let chan = null
	try {
		chan = new BroadcastChannel('roughjam:' + room)
	} catch {}
	const tx = (m) => {
		if (!chan) return
		const msg = { ...m, from: id }
		const d = fake.latency + Math.random() * fake.jitter
		sent++
		if (d <= 0) chan.postMessage(msg)
		else schedule(clock.now() + d, () => chan.postMessage(msg))
	}

	const peers = () =>
		[me, ...others.values()].map(({ id, name, seat, color }) => ({ id, name, seat, color }))

	if (chan)
		chan.onmessage = ({ data: m }) => {
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
					if (m.t === 'hello')
						tx({
							t: 'welcome',
							to: m.from,
							loop: clock.loopAt(),
							seats: history.snapshot(),
							name: me.name,
							seat: me.seat,
							color: me.color,
						})
					emit('peers', peers())
					break
				}
				case 'welcome':
					if (!others.has(m.from)) {
						others.set(m.from, {
							id: m.from,
							name: m.name,
							seat: m.seat,
							color: m.color,
							last: Date.now(),
						})
						emit('peers', peers())
					}
					if (m.to !== id || welcomed) return
					welcomed = true
					clock.setLoop(m.loop, -Infinity)
					for (const [seat, l] of Object.entries(m.seats))
						record(seat, { at: l.at, data: l.data, rev: l.rev, from: l.owner })
					emit('welcome', { id, loop: m.loop, seats: m.seats, peers: peers() })
					break
				case 'edit':
					record(m.seat, { at: m.at, data: m.data, rev: m.rev, from: m.from })
					break
				case 'cursor':
					emit('cursor', { ...m, name: m.name || others.get(m.from)?.name })
					break
				case 'loop':
					clock.setLoop(m.loop, m.at)
					schedule(m.at - LOOKAHEAD, () => emit('loop', { loop: m.loop, at: m.at }))
					break
				case 'beat':
					if (!known) {
						tx({ t: 'presence', ...me })
					}
					break
				case 'bye':
					others.delete(m.from)
					emit('peers', peers())
					break
			}
		}

	tx({ t: 'hello', name: me.name, seat: me.seat, color: me.color })
	schedule(clock.now() + 400, () => {
		if (!welcomed) {
			welcomed = true
			emit('welcome', { id, loop: clock.loopAt(), seats: {}, peers: peers() })
		}
		emit('status', { connected: !!chan })
	})
	const heartbeat = setInterval(() => {
		tx({ t: 'beat' })
		const cutoff = Date.now() - 4000
		let changed = false
		for (const [pid, p] of others)
			if (p.last < cutoff) {
				others.delete(pid)
				changed = true
			}
		if (changed) emit('peers', peers())
	}, 1000)
	const bye = () => tx({ t: 'bye' })
	addEventListener('pagehide', bye)

	function edit(seat, data, opts = {}) {
		const now = clock.now()
		const at =
			opts.now || fake.quantize === 'off'
				? now
				: clock.nextBar(now + Math.max(80, fake.latency * 1.5 + fake.jitter + 40) + LOOKAHEAD)
		const r = ++rev
		record(seat, { at, data, rev: r, from: id })
		tx({ t: 'edit', seat, data, at, rev: r })
		emit('pending', { seat, data, at })
		return at
	}

	function setLoop(patch) {
		const current = clock.loopAt()
		const { at, loop } = nextLoopAt(current, { ...current, ...patch }, clock.now() + 200)
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
		seats: history.seats,
		cursor: (x, y, down = false, seat = me.seat, name) =>
			tx({ t: 'cursor', x, y, down, seat, name }),
		setLoop,
		setMe: (patch) => {
			Object.assign(me, patch)
			tx({ t: 'presence', ...patch })
			emit('peers', peers())
		},
		clock,
		fake,
		get id() {
			return id
		},
		get peers() {
			return peers()
		},
		debug: () => ({
			connected: !!chan,
			id,
			room,
			peers: others.size + 1,
			...clock.stats(),
			pending: 0,
			sent,
			recv,
			lateMs: history.lateMs,
			pos: clock.pos(),
		}),
		close() {
			removeEventListener('pagehide', bye)
			clearInterval(heartbeat)
			history.close()
			chan?.close()
			chan = null
		},
	}
}
