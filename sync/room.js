// The relay's whole protocol, transport-agnostic. server.js (Node + ws) and worker.js (Durable Object) both wrap it.
// The server is the time authority: every timestamp on the wire is server ms from `now()`.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const loopMs = (l) => (l.bars * l.beatsPerBar * 60000) / l.bpm
const nextLoopBoundary = (l, t) => l.origin + Math.ceil((t - l.origin) / loopMs(l)) * loopMs(l)
// key and chords: kept if new ones don't look right. Chords are degrees 0..6, one per bar, at most 16.
function harmony(m, cur) {
	const h = {}
	const root = /^[A-G]$/.test(m.root) ? m.root : cur.root
	const scale = typeof m.scale === 'string' && /^[a-z ]{1,20}$/.test(m.scale) ? m.scale : cur.scale
	const chords = Array.isArray(m.chords) && m.chords.length ? m.chords.slice(0, 16).map((d) => clamp(Math.floor(Number(d)) || 0, 0, 6)) : cur.chords
	if (root) h.root = root
	if (scale) h.scale = scale
	if (chords) h.chords = chords
	return h
}

/**
 * @param {object} io  {now, send(peerId, msg), peers() -> [peerId, info], setPeer(peerId, info), persist?(state)}
 * @param {object} [state]  previously persisted {loop, seats, seq}
 */
export function createRoom(io, state = {}) {
	const s = {
		loop: state.loop || { bpm: 96, beatsPerBar: 4, bars: 4, origin: io.now() },
		seats: state.seats || fromLanes(state.lanes),
		seq: state.seq || 0,
	}
	const peerList = () => [...io.peers()].filter(([, p]) => p.joined).map(([id, p]) => ({ id, name: p.name, seat: p.seat, color: p.color, joinedAt: p.joinedAt }))
	const broadcast = (msg, except) => { for (const [id, p] of io.peers()) if (id !== except && p.joined) io.send(id, msg) }
	const save = () => io.persist?.({ loop: s.loop, seats: s.seats, seq: s.seq })

	function message(id, m, info) {
		if (m.t === 'ping') return io.send(id, { t: 'pong', c0: m.c0, s: io.now() })

		if (m.t === 'hello') {
			io.setPeer(id, { joined: true, name: String(m.name || 'anon').slice(0, 32), seat: m.seat ?? null, color: m.color ?? null, joinedAt: io.now() })
			io.send(id, { t: 'welcome', id, now: io.now(), loop: s.loop, seats: s.seats, peers: peerList() })
			return broadcast({ t: 'peers', peers: peerList() })
		}
		if (!info?.joined) return

		if (m.t === 'presence') {
			const p = { ...info }
			if ('seat' in m) p.seat = m.seat
			if ('name' in m) p.name = String(m.name).slice(0, 32)
			if ('color' in m) p.color = m.color
			io.setPeer(id, p)
			broadcast({ t: 'peers', peers: peerList() })
		} else if (m.t === 'edit') {
			const at = Math.max(Number(m.at) || 0, io.now())
			const seat = String(m.seat)
			const rev = (s.seats[seat]?.rev || 0) + 1
			s.seats[seat] = { owner: id, data: m.data, at, rev }
			broadcast({ t: 'edit', from: id, seat, data: m.data, at, rev, seq: ++s.seq, nonce: m.nonce, proposed: m.proposed })
			save()
		} else if (m.t === 'cursor') {
			broadcast({ t: 'cursor', from: id, x: m.x, y: m.y, down: !!m.down, seat: m.seat, name: m.name }, id)
		} else if (m.t === 'loop') {
			// Tempo/length change lands on the next loop boundary; the new origin is that boundary, so phase stays continuous.
			const at = nextLoopBoundary(s.loop, io.now() + 150)
			s.loop = {
				bpm: clamp(Number(m.bpm) || s.loop.bpm, 30, 300),
				beatsPerBar: clamp(Number(m.beatsPerBar) || s.loop.beatsPerBar, 1, 16),
				bars: clamp(Number(m.bars) || s.loop.bars, 1, 64),
				...harmony(m, s.loop),
				robots: typeof m.robots === 'boolean' ? m.robots : !!s.loop.robots,
				origin: at,
			}
			broadcast({ t: 'loop', loop: s.loop, at })
			save()
		}
	}

	const left = () => broadcast({ t: 'peers', peers: peerList() })

	return { message, left, state: s }
}

let n = 0
export const peerId = () => (n++).toString(36) + Math.random().toString(36).slice(2, 7)

// rooms persisted before "lane" became "seat" stored {lanes: {lane1: …}}
function fromLanes(lanes) {
	return Object.fromEntries(Object.entries(lanes || {}).map(([k, v]) => [k.replace(/^lane/, 'seat'), v]))
}
