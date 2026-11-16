// The relay's whole protocol, transport-agnostic. server.js (Node + ws) and worker.js (Durable Object) both wrap it.
// The server is the time authority: every timestamp on the wire is server ms from `now()`.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const loopMs = (l) => (l.bars * l.beatsPerBar * 60000) / l.bpm
const nextLoopBoundary = (l, t) => l.origin + Math.ceil((t - l.origin) / loopMs(l)) * loopMs(l)

/**
 * @param {object} io
 * @param {() => number} io.now
 * @param {(peerId: string, msg: object) => void} io.send
 * @param {() => Iterable<[string, object]>} io.peers  [peerId, info] pairs currently connected
 * @param {(peerId: string, info: object) => void} io.setPeer  store presence for a peer
 * @param {(state: object) => void} [io.persist]  called after loop/lane changes
 * @param {object} [state]  previously persisted {loop, lanes, seq}
 */
export function createRoom(io, state = {}) {
	const s = {
		loop: state.loop || { bpm: 96, beatsPerBar: 4, bars: 4, origin: io.now() },
		lanes: state.lanes || {}, // laneId -> {owner, data, at, rev}
		seq: state.seq || 0,
	}
	const peerList = () => [...io.peers()].filter(([, p]) => p.joined).map(([id, p]) => ({ id, name: p.name, instrument: p.instrument, color: p.color, joinedAt: p.joinedAt }))
	const broadcast = (msg, except) => { for (const [id, p] of io.peers()) if (id !== except && p.joined) io.send(id, msg) }
	const save = () => io.persist?.({ loop: s.loop, lanes: s.lanes, seq: s.seq })

	function message(id, m, info) {
		// Pong first and fast so server work doesn't inflate RTT.
		if (m.t === 'ping') return io.send(id, { t: 'pong', c0: m.c0, s: io.now() })

		if (m.t === 'hello') {
			io.setPeer(id, { joined: true, name: String(m.name || 'anon').slice(0, 32), instrument: m.instrument ?? null, color: m.color ?? null, joinedAt: io.now() })
			io.send(id, { t: 'welcome', id, now: io.now(), loop: s.loop, lanes: s.lanes, peers: peerList() })
			return broadcast({ t: 'peers', peers: peerList() })
		}
		if (!info?.joined) return

		if (m.t === 'presence') {
			const p = { ...info }
			if ('instrument' in m) p.instrument = m.instrument
			if ('name' in m) p.name = String(m.name).slice(0, 32)
			if ('color' in m) p.color = m.color
			io.setPeer(id, p)
			broadcast({ t: 'peers', peers: peerList() })
		} else if (m.t === 'edit') {
			// Client proposes `at` (a bar boundary in server time). Never let it land in the past.
			const at = Math.max(Number(m.at) || 0, io.now())
			const lane = String(m.lane)
			const rev = (s.lanes[lane]?.rev || 0) + 1
			s.lanes[lane] = { owner: id, data: m.data, at, rev }
			broadcast({ t: 'edit', from: id, lane, data: m.data, at, rev, seq: ++s.seq, nonce: m.nonce, proposed: m.proposed })
			save()
		} else if (m.t === 'cursor') {
			// Ephemeral, unquantized, not stored. Drawing feedback, not sound.
			broadcast({ t: 'cursor', from: id, x: m.x, y: m.y, down: !!m.down, lane: m.lane, name: m.name }, id)
		} else if (m.t === 'loop') {
			// Tempo/length change lands on the next loop boundary; new origin = that boundary, so phase is continuous.
			const at = nextLoopBoundary(s.loop, io.now() + 150)
			s.loop = {
				bpm: clamp(Number(m.bpm) || s.loop.bpm, 30, 300),
				beatsPerBar: clamp(Number(m.beatsPerBar) || s.loop.beatsPerBar, 1, 16),
				bars: clamp(Number(m.bars) || s.loop.bars, 1, 64),
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
