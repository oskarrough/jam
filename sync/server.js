// roughjam relay for Node; wraps room.js like worker.js.
// PORT=8787 node sync/server.js also serves the repo root. LAG=60 fakes 60 ms (±20%) one-way latency.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { createRoom, peerId } from './room.js'

const PORT = Number(process.env.PORT || 8787)
const LAG = Number(process.env.LAG || 0)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain', '.svg': 'image/svg+xml' }

const recordings = new Map()
const recId = () => Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('')

const http = createServer(async (req, res) => {
	if (req.url === '/api/r' && req.method === 'POST') {
		let body = ''
		for await (const c of req) if ((body += c).length > 1 << 20) return res.writeHead(413).end('too big')
		try { if (JSON.parse(body).v !== 1) throw 0 } catch { return res.writeHead(400).end('bad recording') }
		const id = recId()
		recordings.set(id, body)
		return res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id }))
	}
	const rm = req.url.match(/^\/api\/r\/([\w-]{4,32})$/)
	if (rm) return recordings.has(rm[1]) ? res.writeHead(200, { 'content-type': 'application/json' }).end(recordings.get(rm[1])) : res.writeHead(404).end('not found')
	if (req.url.split('?')[0].endsWith('/sync/relay')) return res.writeHead(204, { 'x-roughjam-relay': '1', 'cache-control': 'no-store' }).end()
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
	const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path)
	if (!file.startsWith(ROOT) || file.split(sep).some((p) => p === 'node_modules' || p.startsWith('.'))) return res.writeHead(403).end()
	try {
		const body = await readFile(file)
		res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
	} catch {
		const m = path.match(/^[/\\]([jr])[/\\]([\w-]{1,48})([/\\]?)$/)
		if (m && m[3]) return res.writeHead(301, { location: `/${m[1]}/${m[2]}` }).end()
		if (m) return res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(String(await readFile(join(ROOT, 'index.html'))).replace('<head>', '<head>\n<base href="/">'))
		res.writeHead(404).end('not found')
	}
})

const later = (fn) => (LAG ? setTimeout(fn, LAG * (0.8 + Math.random() * 0.4)) : fn())
const rooms = new Map()

function getRoom(roomId) {
	if (!rooms.has(roomId)) {
		const sockets = new Map(), info = new Map()
		const room = createRoom({
			now: Date.now,
			send: (id, msg) => { const ws = sockets.get(id); const s = JSON.stringify(msg); later(() => ws?.readyState === 1 && ws.send(s)) },
			peers: () => info.entries(),
			setPeer: (id, p) => info.set(id, p),
		})
		rooms.set(roomId, { room, sockets, info })
	}
	return rooms.get(roomId)
}

const wss = new WebSocketServer({ server: http })
wss.on('connection', (ws, req) => {
	const roomId = (new URL(req.url, 'http://x').searchParams.get('room') || '').slice(0, 64)
	const id = peerId()
	let r = null
	const join = (name) => {
		r = getRoom(name)
		r.sockets.set(id, ws)
		r.info.set(id, {})
	}
	if (roomId) join(roomId)

	ws.on('message', (raw) => later(() => {
		let m
		try { m = JSON.parse(raw) } catch { return }
		if (!r) join(String(m.room || 'open').slice(0, 64)) // legacy: room named in hello
		r.room.message(id, m, r.info.get(id))
	}))
	ws.on('close', () => {
		if (!r) return
		r.sockets.delete(id)
		r.info.delete(id)
		r.room.left()
		if (r.sockets.size === 0) setTimeout(() => r.sockets.size === 0 && rooms.delete([...rooms].find(([, v]) => v === r)?.[0]), 10 * 60_000)
	})
})

http.listen(PORT, () => console.log(`roughjam relay on http://localhost:${PORT}  (ws on the same port; /sync/ is the sync demo)`))
