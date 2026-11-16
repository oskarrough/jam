// Campfire Jam: wires transport, engine, view, frengers and the debug panel together.

import { createLocalTransport } from './transport/local.js'
import { createEngine } from './engine.js'
import { createView } from './view.js'
import { createFrengers, BOT_NAMES } from './frengers.js'
import { registry } from './instruments/index.js'

const NAMES = ['ash', 'birch', 'wren', 'sorrel', 'quill', 'juniper', 'tansy', 'rook']
const LANE_IDS = ['lane1', 'lane2', 'lane3', 'lane4']
const START = ['bass', 'keys', 'bell', 'drums']

const q = new URLSearchParams(location.search)
const room = q.get('room') || 'campfire'
const name = q.get('name') || NAMES[Math.floor(Math.random() * NAMES.length)]

// Transport is the swappable part: ?ws=ws://host:8787 uses the network layer in sync/, if present.
async function makeTransport() {
	if (q.get('ws')) {
		try {
			const { createTransport } = await import('../sync/sync.js')
			const t = createTransport({ url: q.get('ws'), room, name })
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
const me = { name, lane: -1 }

const humanAt = (i) => transport.peers.find((p) => p.instrument === lanes[i].id)
const seat = (i) => {
	const p = humanAt(i)
	if (p && p.id === transport.id) return { name: me.name, label: 'you', me: true, human: true }
	if (p) return { name: p.name, label: p.name, human: true }
	if (frengers?.opts.on && lanes[i].module.generate) return { name: BOT_NAMES[i], label: BOT_NAMES[i], bot: true }
	return { name: '', label: 'sit' }
}
const canDraw = (i) => me.lane === i
let frengers = null

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
		L.instance.pointer(e)
		engine.pushSoon(L)
		view.showCursor('me', i, e.x, e.y, me.name)
		transport.cursor(e.x, e.y, e.type !== 'up', L.id)
	},
})
frengers = createFrengers(engine, { seated: (i) => !!humanAt(i), view })

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
function renderSeats() {
	const ul = $('seats')
	if (!ul) return
	ul.innerHTML = ''
	;[...lanes].reverse().forEach((L) => {
		const i = L.index, st = seat(i)
		const li = document.createElement('li')
		li.className = 'seat' + (st.me ? ' mine' : '')
		li.style.setProperty('--c', L.color)
		li.innerHTML = '<span class="dot"></span><span class="inst"></span><span class="who"></span>'
		li.querySelector('.inst').textContent = L.module.name.toLowerCase()
		li.querySelector('.who').textContent = st.me ? `${me.name} (you)` : st.bot ? `${st.label} · frenger` : st.human ? st.label : 'empty'
		const b = document.createElement('button')
		b.className = 'sit'
		b.textContent = st.me ? 'seated' : 'sit'
		b.disabled = st.me || (st.human && !st.me)
		b.setAttribute('aria-label', `Sit at ${L.module.name}`)
		b.onclick = () => sit(i)
		li.appendChild(b)
		ul.appendChild(li)
	})
	const names = transport.peers.map((p) => (p.id === transport.id ? `${me.name} (you)` : p.name)).filter(Boolean)
	$('peers').textContent = `${names.length} at the fire: ${names.join(', ')}`
}

$('sound').onclick = () => {
	engine.setSound(!engine.soundOn)
	$('sound').setAttribute('aria-pressed', engine.soundOn)
	$('sound').textContent = engine.soundOn ? 'Sound off' : 'Sound on'
}
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
	frengers.opts.on = !frengers.opts.on
	$('bots').setAttribute('aria-pressed', frengers.opts.on)
	renderSeats()
}
addEventListener('keydown', (e) => {
	if (e.target.closest?.('input, select, textarea, .lil-gui')) return
	if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
	if (e.key === ' ') { e.preventDefault(); $('sound').click() }
	else if (/^[1-9]$/.test(e.key) && +e.key <= lanes.length) sit(+e.key - 1)
	else if (e.key === 'd') debug.toggle()
})
setInterval(() => {
	const l = transport.clock.loopAt()
	const next = transport.clock.pending?.().at(-1)
	$('bpm').textContent = next && next.bpm !== l.bpm ? `${l.bpm} → ${next.bpm}` : `${l.bpm} bpm`
}, 200)

// debug panel loads its library from a CDN; the jam must work without it
let debug = { toggle() {} }
import('./debug.js')
	.then(({ createDebug }) => (debug = createDebug({ engine, transport, view, frengers, me, sit, registry, renderSeats })))
	.catch((e) => console.warn('debug panel unavailable', e))
renderSeats()

// handy in the console
Object.assign(window, { jam: { engine, transport, view, frengers, registry, me } })
