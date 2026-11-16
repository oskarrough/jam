// roughjam relay on Cloudflare: one Durable Object per room, static site from Workers assets; wraps room.js.
// Date.now() advances only between I/O events: in webSocketMessage it is the delivery time, which an NTP-style pong wants.

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
		if (req.headers.get('x-roughjam-rec')) {
			if (req.method === 'PUT') { await this.ctx.storage.put('rec', await req.text()); return new Response(null, { status: 204 }) }
			const rec = await this.ctx.storage.get('rec')
			return rec ? new Response(rec, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=31536000, immutable' } }) : new Response('not found', { status: 404 })
		}
		const { 0: client, 1: server } = new WebSocketPair()
		const id = peerId()
		this.ctx.acceptWebSocket(server, [id])
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

// The link preview for /r/<id>: who played what, in which key. Names are the players' own text; setAttribute escapes them.
async function recCard(env, id) {
	try {
		const r = await env.ROOMS.get(env.ROOMS.idFromName('rec/' + id)).fetch('https://rec/', { headers: { 'x-roughjam-rec': '1' } })
		if (!r.ok) return null
		const rec = await r.json()
		const first = Object.values(rec.frames?.[0] || {})
		const who = (rec.seats || []).map((name, i) => name && first[i]?.instrument && `${name} on ${first[i].instrument}`).filter(Boolean)
		const l = rec.loop || {}
		const key = l.root ? `${l.root} ${l.scale || ''}`.trim() + ', ' : ''
		const room = rec.room && rec.room !== 'open' ? ` of ${rec.room}` : ''
		return {
			title: `a recording${room} · roughjam`.slice(0, 120),
			description: `${rec.bars} bars, ${key}${Math.round(l.bpm)} bpm${who.length ? ' · ' + who.join(', ') : ''}. Tap to listen.`.slice(0, 300),
		}
	} catch { return null }
}

export default {
	async fetch(req, env) {
		if (req.headers.get('upgrade') === 'websocket') {
			const room = (new URL(req.url).searchParams.get('room') || 'open').slice(0, 64)
			return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req)
		}
		if (new URL(req.url).pathname.endsWith('/sync/relay')) return new Response(null, { status: 204, headers: { 'x-roughjam-relay': '1', 'cache-control': 'no-store' } })
		const path = new URL(req.url).pathname
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
		const m = path.match(/^\/(j|r)\/([\w-]{1,48})(\/?)$/)
		if (m && m[3]) return Response.redirect(new URL(`/${m[1]}/${m[2]}`, req.url), 301)
		if (m) {
			const page = await env.ASSETS.fetch(new Request(new URL('/', req.url), req))
			let html = new HTMLRewriter().on('head', { element: (el) => el.prepend('<base href="/">', { html: true }) })
			const card = m[1] === 'r' ? await recCard(env, m[2]) : null
			if (card) {
				const set = (sel, v) => (html = html.on(sel, { element: (el) => el.setAttribute('content', v) }))
				html = html.on('title', { element: (el) => el.setInnerContent(card.title) })
				set('meta[property="og:title"]', card.title)
				set('meta[property="og:description"]', card.description)
				set('meta[name="description"]', card.description)
				html = html.on('head', { element: (el) => el.append(`<meta property="og:url" content="${new URL(path, req.url).href}">`, { html: true }) })
			}
			return html.transform(page)
		}
		return env.ASSETS.fetch(req)
	},
}
