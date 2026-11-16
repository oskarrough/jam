// roughjam relay on Cloudflare: one Durable Object per room, static site from Workers assets.
// Same protocol as server.js; both wrap room.js. Config: ../cloudflare.config.ts.
//
// WebSocket hibernation: sockets survive the object sleeping, presence rides on each socket's attachment,
// and loop + seats persist to storage so a cold room comes back with its patterns.
// Note: Date.now() in Workers advances only between I/O events. Inside webSocketMessage it is the time the
// message was delivered, which is what an NTP-style pong wants.

import { DurableObject } from 'cloudflare:workers'
import { createRoom, peerId } from './room.js'

export class JamRoom extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env)
		this.ready = ctx.blockConcurrencyWhile(async () => {
			const saved = (await ctx.storage.get('state')) || {}
			this.room = createRoom(
				{
					now: Date.now,
					send: (id, msg) => {
						const ws = this.socket(id)
						try { ws?.send(JSON.stringify(msg)) } catch {}
					},
					peers: () => this.ctx.getWebSockets().map((ws) => { const a = ws.deserializeAttachment() || {}; return [a.id, a.info || {}] }),
					setPeer: (id, info) => { const ws = this.socket(id); ws?.serializeAttachment({ id, info }) },
					persist: (state) => this.ctx.storage.put('state', state),
				},
				saved,
			)
		})
	}

	socket(id) {
		return this.ctx.getWebSockets(id)[0]
	}

	async fetch(req) {
		// Recordings reuse this class (one object per recording, no extra binding): PUT stores, GET reads.
		if (req.headers.get('x-roughjam-rec')) {
			if (req.method === 'PUT') { await this.ctx.storage.put('rec', await req.text()); return new Response(null, { status: 204 }) }
			const rec = await this.ctx.storage.get('rec')
			return rec ? new Response(rec, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=31536000, immutable' } }) : new Response('not found', { status: 404 })
		}
		const { 0: client, 1: server } = new WebSocketPair()
		const id = peerId()
		this.ctx.acceptWebSocket(server, [id]) // tag = peer id, so socket(id) is a lookup
		server.serializeAttachment({ id, info: {} })
		return new Response(null, { status: 101, webSocket: client })
	}

	async webSocketMessage(ws, raw) {
		await this.ready
		let m
		try { m = JSON.parse(raw) } catch { return }
		const { id, info } = ws.deserializeAttachment() || {}
		this.room.message(id, m, info)
	}

	async webSocketClose(ws) {
		await this.ready
		ws.serializeAttachment({ ...ws.deserializeAttachment(), info: {} }) // closing socket may still be listed
		try { ws.close() } catch {}
		this.room.left()
	}

	async webSocketError(ws) {
		return this.webSocketClose(ws)
	}
}

const MAX_REC = 1 << 20
const recId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')

export default {
	async fetch(req, env) {
		if (req.headers.get('upgrade') === 'websocket') {
			const room = (new URL(req.url).searchParams.get('room') || 'open').slice(0, 64)
			return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req)
		}
		// The page probes this to find out it can go multiplayer. Reaches the Worker because no asset matches.
		if (new URL(req.url).pathname.endsWith('/sync/relay')) return new Response(null, { status: 204, headers: { 'x-roughjam-relay': '1', 'cache-control': 'no-store' } })
		const path = new URL(req.url).pathname
		// recordings: POST /api/r -> {id}; GET /api/r/<id> -> the recording. Stored in a Durable Object per recording.
		if (path === '/api/r' && req.method === 'POST') {
			const body = await req.text()
			if (body.length > MAX_REC) return new Response('too big', { status: 413 })
			try { if (JSON.parse(body).v !== 1) throw 0 } catch { return new Response('bad recording', { status: 400 }) }
			const id = recId()
			await env.ROOMS.get(env.ROOMS.idFromName('rec/' + id)).fetch('https://rec/', { method: 'PUT', body, headers: { 'x-roughjam-rec': '1' } })
			return Response.json({ id }, { status: 201 })
		}
		const r = path.match(/^\/api\/r\/([\w-]{4,32})$/)
		if (r) return env.ROOMS.get(env.ROOMS.idFromName('rec/' + r[1])).fetch('https://rec/', { headers: { 'x-roughjam-rec': '1' } })
		// /j/<name> is your own jam, /r/<id> a recording: serve the page with <base href="/"> so its relative asset paths still resolve.
		const m = path.match(/^\/(j|r)\/([\w-]{1,48})(\/?)$/)
		if (m && m[3]) return Response.redirect(new URL(`/${m[1]}/${m[2]}`, req.url), 301)
		if (m) {
			const page = await env.ASSETS.fetch(new Request(new URL('/', req.url), req))
			return new HTMLRewriter().on('head', { element: (el) => el.prepend('<base href="/">', { html: true }) }).transform(page)
		}
		return env.ASSETS.fetch(req)
	},
}
