// roughjam sync server: rooms, presence, lane state, loop clock, NTP-ish pongs.
// The server is the time authority: every timestamp on the wire is server ms (Date.now() here).
// Usage: PORT=8787 node server.js   (also serves this folder statically, so / is the demo)

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 8787)
const LAG = Number(process.env.LAG || 0) // simulate one-way latency (ms) in both directions, for testing
const ROOT = fileURLToPath(new URL('.', import.meta.url))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain' }

const http = createServer(async (req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
	const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path)
	if (!file.startsWith(ROOT) || file.includes('node_modules')) return res.writeHead(403).end()
	try {
		const body = await readFile(file)
		res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
	} catch {
		res.writeHead(404).end('not found')
	}
})

/** @type {Map<string, Room>} */
const rooms = new Map()

function room(id) {
	if (!rooms.has(id)) {
		rooms.set(id, {
			id,
			peers: new Map(), // id -> {ws, name, instrument, color, joinedAt}
			loop: { bpm: 96, beatsPerBar: 4, bars: 4, origin: Date.now() },
			lanes: {}, // laneId -> {owner, data, at, rev}
			seq: 0,
		})
	}
	return rooms.get(id)
}

const loopMs = (l) => (l.bars * l.beatsPerBar * 60000) / l.bpm
const nextLoopBoundary = (l, t) => l.origin + Math.ceil((t - l.origin) / loopMs(l)) * loopMs(l)

const peerList = (r) => [...r.peers].map(([id, p]) => ({ id, name: p.name, instrument: p.instrument, color: p.color, joinedAt: p.joinedAt }))
const later = (fn) => (LAG ? setTimeout(fn, LAG * (0.8 + Math.random() * 0.4)) : fn())
const send = (ws, msg) => later(() => ws.readyState === 1 && ws.send(JSON.stringify(msg)))
const broadcast = (r, msg, except) => {
	const s = JSON.stringify(msg)
	for (const [id, p] of r.peers) if (id !== except) later(() => p.ws.readyState === 1 && p.ws.send(s))
}

let nextId = 1
const wss = new WebSocketServer({ server: http })

wss.on('connection', (ws) => {
	const id = (nextId++).toString(36) + Math.random().toString(36).slice(2, 6)
	let r = null

	ws.on('message', (raw) => later(() => onMessage(raw)))
	function onMessage(raw) {
		let m
		try {
			m = JSON.parse(raw)
		} catch {
			return
		}
		// Pong as early as possible so server processing doesn't inflate RTT.
		if (m.t === 'ping') return send(ws, { t: 'pong', c0: m.c0, s: Date.now() })

		if (m.t === 'hello') {
			r = room(String(m.room || 'campfire').slice(0, 64))
			r.peers.set(id, { ws, name: String(m.name || 'anon').slice(0, 32), instrument: m.instrument || null, color: m.color || null, joinedAt: Date.now() })
			send(ws, { t: 'welcome', id, now: Date.now(), loop: r.loop, lanes: r.lanes, peers: peerList(r) })
			broadcast(r, { t: 'peers', peers: peerList(r) })
			return
		}
		if (!r) return

		if (m.t === 'presence') {
			const p = r.peers.get(id)
			if ('instrument' in m) p.instrument = m.instrument
			if ('name' in m) p.name = String(m.name).slice(0, 32)
			if ('color' in m) p.color = m.color
			broadcast(r, { t: 'peers', peers: peerList(r) })
		} else if (m.t === 'edit') {
			// Client proposes `at` (a bar boundary in server time). Never let it land in the past.
			const at = Math.max(Number(m.at) || 0, Date.now())
			const lane = String(m.lane)
			const rev = (r.lanes[lane]?.rev || 0) + 1
			r.lanes[lane] = { owner: id, data: m.data, at, rev }
			broadcast(r, { t: 'edit', from: id, lane, data: m.data, at, rev, seq: ++r.seq, nonce: m.nonce, proposed: m.proposed })
		} else if (m.t === 'cursor') {
			// Ephemeral, unquantized, not stored. Drawing feedback, not sound.
			broadcast(r, { t: 'cursor', from: id, x: m.x, y: m.y, down: !!m.down, lane: m.lane }, id)
		} else if (m.t === 'loop') {
			// Tempo/length change lands on the next loop boundary; new origin = that boundary, so phase is continuous.
			const at = nextLoopBoundary(r.loop, Date.now() + 150)
			const loop = {
				bpm: clamp(Number(m.bpm) || r.loop.bpm, 30, 300),
				beatsPerBar: clamp(Number(m.beatsPerBar) || r.loop.beatsPerBar, 1, 16),
				bars: clamp(Number(m.bars) || r.loop.bars, 1, 64),
				origin: at,
			}
			r.loop = loop
			broadcast(r, { t: 'loop', loop, at })
		}
	}

	ws.on('close', () => {
		if (!r) return
		r.peers.delete(id)
		broadcast(r, { t: 'peers', peers: peerList(r) })
		if (r.peers.size === 0) setTimeout(() => r.peers.size === 0 && rooms.delete(r.id), 10 * 60_000)
	})
})

function clamp(v, a, b) {
	return Math.min(b, Math.max(a, v))
}

http.listen(PORT, () => console.log(`roughjam sync on http://localhost:${PORT}  (ws same port)`))
