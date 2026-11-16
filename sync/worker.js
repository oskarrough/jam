// roughjam relay on Cloudflare: one Durable Object per room, static site from Workers assets.
// Same protocol as server.js; both wrap room.js. Config: ../cloudflare.config.ts.
//
// WebSocket hibernation: sockets survive the object sleeping, presence rides on each socket's attachment,
// and loop + lanes persist to storage so a cold room comes back with its patterns.
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

	async fetch() {
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

export default {
	async fetch(req, env) {
		if (req.headers.get('upgrade') === 'websocket') {
			const room = (new URL(req.url).searchParams.get('room') || 'open').slice(0, 64)
			return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req)
		}
		// The page probes this to find out it can go multiplayer. Reaches the Worker because no asset matches.
		if (new URL(req.url).pathname.endsWith('/sync/relay')) return new Response(null, { status: 204, headers: { 'x-roughjam-relay': '1', 'cache-control': 'no-store' } })
		// /j/<name> is your own jam: serve the page with <base href="/"> so its relative asset paths still resolve.
		const m = new URL(req.url).pathname.match(/^\/j\/([\w-]{1,48})(\/?)$/)
		if (m && m[2]) return Response.redirect(new URL('/j/' + m[1], req.url), 301)
		if (m) {
			const page = await env.ASSETS.fetch(new Request(new URL('/', req.url), req))
			return new HTMLRewriter().on('head', { element: (el) => el.prepend('<base href="/">', { html: true }) }).transform(page)
		}
		return env.ASSETS.fetch(req)
	},
}
