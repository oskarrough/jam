// roughjam: wires transport, engine, view, bots and the debug panel together.

import { createLocalTransport } from './transport/local.js'
import { createEngine } from './engine.js'
import { createView } from './view.js'
import { jellify } from './jelly.js'
import { createBots, botName } from './bots.js'
import { registry } from './instruments/index.js'
import { createHeart } from './heart.js'

const NAMES = ['ash', 'birch', 'wren', 'sorrel', 'quill', 'juniper', 'tansy', 'rook']
const LANE_IDS = ['lane1', 'lane2', 'lane3', 'lane4']
const START = ['bass', 'keys', 'bell', 'drums']

const q = new URLSearchParams(location.search)
// Jam: everyone lands in the one open jam at /. Your own lives at /j/<name> (root paths stay reserved); ?room= also works.
const pathJam = decodeURIComponent(location.pathname.match(/\/j\/([\w-]{1,48})\/?$/)?.[1] || '')
const room = (q.get('room') || pathJam || 'open').toLowerCase().slice(0, 48)
const name = q.get('name') || NAMES[Math.floor(Math.random() * NAMES.length)]

// Transport is the swappable part. Network when there's a relay: ?ws=url, the deployed site (jam.0sk.ar),
// or any same-origin relay that answers /sync/relay (sync/server.js locally). Otherwise tabs in this browser; ?ws=off forces that.
const sameOrigin = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`
async function relayUrl() {
	if (q.get('ws') === 'off' || !/^https?:$/.test(location.protocol)) return null
	if (q.get('ws')) return q.get('ws')
	if (/(^|\.)0sk\.ar$/.test(location.hostname)) return sameOrigin()
	try {
		const r = await fetch('/sync/relay', { cache: 'no-store', signal: AbortSignal.timeout(1500) })
		if (r.headers.get('x-roughjam-relay')) return sameOrigin()
	} catch {}
	return null
}
async function makeTransport() {
	const url = await relayUrl()
	if (url) {
		try {
			const { createTransport } = await import('../sync/sync.js')
			const t = createTransport({ url, room, name })
			t.kind = 'ws'
			return t
		} catch (e) {
			console.warn('ws transport unavailable, falling back to local', e)
		}
	}
	return createLocalTransport({ room, name })
}

const transport = await makeTransport()
const engine = createEngine(transport, { laneIds: LANE_IDS, instruments: START })
const { lanes } = engine
const me = { name, lane: -1, erase: false }

const humanAt = (i) => transport.peers.find((p) => p.instrument === lanes[i].id)
const seat = (i) => {
	const p = humanAt(i)
	if (p && p.id === transport.id) return { name: me.name, label: 'you', me: true, human: true }
	if (p) return { name: p.name, label: p.name, human: true }
	if (bots?.opts.on && lanes[i].module.generate) return { name: botName(i), label: botName(i), initial: botName(i).slice(-1), bot: true }
	return { name: '', label: 'sit' }
}
const canDraw = (i) => me.lane === i
let bots = null

function sit(i) {
	const p = humanAt(i)
	if (p && p.id !== transport.id) return
	me.lane = i
	transport.setMe({ instrument: lanes[i].id, name: me.name })
	renderSeats()
}

const view = createView(document.getElementById('c'), engine, {
	seat,
	canDraw,
	onSit: sit,
	onPointer(i, e) {
		const L = lanes[i]
		if (me.erase) e.alt = true
		L.instance.pointer(e)
		engine.pushSoon(L)
		view.showCursor('me', i, e.x, e.y, me.name)
		transport.cursor(e.x, e.y, e.type !== 'up', L.id)
	},
})
const heart = createHeart({ engine, geom: () => view.center() })
bots = createBots(engine, { seated: (i) => !!humanAt(i), view })

transport.on('cursor', (c) => {
	const i = lanes.findIndex((L) => L.id === c.lane)
	if (i >= 0) view.showCursor(c.from || 'peer' + i, i, c.x, c.y, c.name || transport.peers.find((p) => p.id === c.from)?.name)
})
transport.on('peers', renderSeats)
transport.on('welcome', () => {
	// take the first lane nobody is sitting at, keys first
	if (me.lane < 0) for (const i of [1, 2, 0, 3]) if (!humanAt(i)) { sit(i); break }
	renderSeats()
})
engine.on('lanes', renderSeats)

/* ───────── DOM chrome ───────── */
const $ = (id) => document.getElementById(id)

// The jam line: the open jam by default, or your own at /<name>. Words, not widgets.
const JAM_A = ['dusk', 'amber', 'moss', 'salt', 'velvet', 'copper', 'hollow', 'paper', 'lantern', 'violet']
const JAM_B = ['moth', 'heron', 'fern', 'kettle', 'orchard', 'tide', 'comet', 'wren', 'ember', 'quarry']
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const isOpenJam = room === 'open'
const jamline = $('jamline')
const word = (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.onclick = fn; return b }
if (transport.kind !== 'ws') jamline.textContent = 'just this browser'
else if (isOpenJam) jamline.append('the open jam · ', word('start your own', () => (location.href = '/j/' + pick(JAM_A) + '-' + pick(JAM_B))))
else {
	const b = document.createElement('b')
	b.textContent = room
	const copy = word('copy link', async () => {
		try { await navigator.clipboard.writeText(location.origin + '/j/' + encodeURIComponent(room)); copy.textContent = 'copied' } catch { copy.textContent = location.host + '/j/' + room }
		setTimeout(() => (copy.textContent = 'copy link'), 1600)
	})
	jamline.append('jam ', b, ' · ', copy, ' · ', word('open jam', () => (location.href = '/')))
}
function renderSeats() {
	const ol = $('seats')
	if (!ol) return
	ol.innerHTML = ''
	;[...lanes].reverse().forEach((L) => {
		const i = L.index, st = seat(i)
		const li = document.createElement('li')
		li.className = 'seat' + (st.me ? ' mine' : st.bot ? ' bot' : st.human ? '' : ' empty')
		li.style.setProperty('--c', L.color)
		const b = document.createElement('button')
		b.innerHTML = '<span class="dot"></span><span class="inst"></span><span class="who"></span>'
		b.querySelector('.inst').textContent = L.module.name.toLowerCase()
		b.querySelector('.who').textContent = st.me ? me.name : st.human ? st.label : st.bot ? st.label : '…'
		b.disabled = st.me || st.human
		b.title = st.me ? 'your ring' : st.human ? `${st.label}'s ring` : 'take this ring'
		b.setAttribute('aria-label', st.me ? `${L.module.name}, your ring` : `Take the ${L.module.name} ring`)
		b.onclick = () => sit(i)
		li.appendChild(b)
		ol.appendChild(li)
	})
	const names = transport.peers.map((p) => (p.id === transport.id ? 'you' : p.name)).filter(Boolean)
	$('peers').textContent = names.length > 1 ? names.join(', ').replace(/, ([^,]*)$/, ' & $1') : ''
}

$('sound').onclick = () => {
	engine.setSound(!engine.soundOn)
	$('sound').setAttribute('aria-pressed', engine.soundOn)
}
const setErase = (on) => {
	me.erase = on
	$('erase').setAttribute('aria-pressed', on)
	document.body.classList.toggle('erasing', on)
}
$('erase').onclick = () => setErase(!me.erase)
const tempo = (d) => {
	const l = transport.clock.loopAt()
	transport.setLoop({ bpm: Math.max(50, Math.min(180, l.bpm + d)) })
}
$('slower').onclick = () => tempo(-4)
$('faster').onclick = () => tempo(4)
$('clear').onclick = () => {
	const L = lanes[me.lane]
	if (!L) return
	L.instance.clear ? L.instance.clear() : L.instance.setState(null)
	engine.push(L)
}
$('bots').onclick = () => {
	bots.opts.on = !bots.opts.on
	$('bots').setAttribute('aria-pressed', bots.opts.on)
	renderSeats()
}
addEventListener('keydown', (e) => {
	if (e.target.closest?.('input, select, textarea, .lil-gui')) return
	if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
	if (e.key === ' ') { e.preventDefault(); $('sound').click() }
	else if (/^[1-9]$/.test(e.key) && +e.key <= lanes.length) sit(+e.key - 1)
	else if (e.key === 'd') debug.toggle()
	else if (e.key === 'e') setErase(!me.erase)
})
setInterval(() => {
	const l = transport.clock.loopAt()
	const next = transport.clock.pending?.().at(-1)
	const pending = next && next.bpm !== l.bpm
	$('bpm').textContent = pending ? next.bpm : l.bpm
	$('bpm').classList.toggle('pending', !!pending)
}, 200)

// the panel loads lazily; the jam plays without it
let debug = { toggle() {} }
import('./debug.js')
	.then(({ createDebug }) => (debug = createDebug({ engine, transport, view, bots, me, sit, registry, renderSeats, heart })))
	.catch((e) => console.warn('debug panel unavailable', e))
renderSeats()

// paper tokens give where you press them
document.querySelectorAll('.token').forEach((el) => jellify(el))
jellify(document.querySelector('.tempo'), { amount: 0.08 })

// handy in the console
Object.assign(window, { jam: { engine, transport, view, bots, registry, me, heart } })
