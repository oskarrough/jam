// roughjam: wires transport, engine, view, bots and the debug panel together.

import { createLocalTransport } from './transport/local.js'
import { createEngine } from './engine.js'
import { createView } from './view.js'
import { createPicker } from './picker.js'
import { jellify } from './jelly.js'
import { createBots, botName } from './bots.js'
import { registry } from './instruments/index.js'
import { createHeart } from './heart.js'
import { createRecorder, createReplayTransport, loadRecording, saveRecording } from './record.js'

const LANE_IDS = ['lane1', 'lane2', 'lane3', 'lane4']
const START = ['bass', 'keys', 'bell', 'drums']

const q = new URLSearchParams(location.search)
// Jam: everyone lands in the one open jam at /. Your own lives at /j/<name> (root paths stay reserved); ?room= also works.
const replayId = location.pathname.match(/\/r\/([\w-]{4,32})\/?$/)?.[1]
const pathJam = decodeURIComponent(location.pathname.match(/\/j\/([\w-]{1,48})\/?$/)?.[1] || '')
const room = (q.get('room') || pathJam || 'open').toLowerCase().slice(0, 48)
// no invented names: you are 'you', others are 'player N' by seat unless they set ?name=
const name = q.get('name') || ''

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

// /r/<id>: a recorded souvenir, replayed read-only in the full machine
let rec = null
if (replayId) try { rec = await loadRecording(replayId) } catch (e) { console.warn(e) }
let view = null
const transport = rec
	? createReplayTransport(rec, { laneIds: LANE_IDS, onCursor: (i, x, y, down, who) => view?.showCursor('r' + who + i, i, x, y, who) })
	: await makeTransport()
const replay = transport.kind === 'replay'
if (replay) document.body.classList.add('replay')
const engine = createEngine(transport, { laneIds: LANE_IDS, instruments: START })
const { lanes } = engine
const me = { name, lane: -1, erase: false }

const humanAt = (i) => transport.peers.find((p) => p.instrument === lanes[i].id)
const seat = (i) => {
	const p = humanAt(i)
	if (p && p.id === transport.id) return { name: 'you', label: 'you', initial: me.name ? me.name[0] : 'Y', me: true, human: true }
	if (p) return { name: p.name || playerName(i), label: p.name || playerName(i), initial: p.name ? p.name[0] : String(i + 1), human: true }
	if (bots?.opts.on && lanes[i].module.generate) return { name: botName(i), label: botName(i), initial: botName(i).slice(-1), bot: true }
	return { name: '', label: 'sit' }
}
const playerName = (i) => `player ${i + 1}`
const canDraw = (i) => !replay && me.lane === i
let bots = null

function sit(i) {
	if (replay) return
	const p = humanAt(i)
	if (p && p.id !== transport.id) return
	me.lane = i
	if (view?.focus.on) view.setFocus(i)
	transport.setMe({ instrument: lanes[i].id, name: me.name })
	renderSeats()
}

view = createView(document.getElementById('c'), engine, {
	seat,
	canDraw,
	onSit: (i) => (i === me.lane ? toggleFocus() : sit(i)),
	onPointer(i, e) {
		const L = lanes[i]
		if (me.erase) e.alt = true
		L.instance.pointer(e)
		engine.pushSoon(L)
		view.showCursor('me', i, e.x, e.y, '')
		heart.glance?.(i, 1400) // the eye settles on you while you draw
		transport.cursor(e.x, e.y, e.type !== 'up', L.id)
	},
})
const heart = createHeart({ engine, geom: () => view.center() })
bots = createBots(engine, { seated: (i) => !!humanAt(i), view })
if (replay) bots.opts.on = false

transport.on('cursor', (c) => {
	const i = lanes.findIndex((L) => L.id === c.lane)
	if (i >= 0) heart.glance?.(i, 700)
	if (i >= 0) view.showCursor(c.from || 'peer' + i, i, c.x, c.y, c.name || transport.peers.find((p) => p.id === c.from)?.name || playerName(i))
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

// Jams: the open one at /, your own at /j/<words>. In your own, its name sits under the title and copies the
// link when tapped; the title leads back to the open jam. The deck's sprout token starts a new one.
const JAM_A = ['dusk', 'amber', 'moss', 'salt', 'velvet', 'copper', 'hollow', 'paper', 'lantern', 'violet']
const JAM_B = ['moth', 'heron', 'fern', 'kettle', 'orchard', 'tide', 'comet', 'wren', 'ember', 'quarry']
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const isOpenJam = room === 'open'
const jamline = $('jamline')
const word = (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.onclick = fn; return b }
const live = () => word('play live', () => (location.href = '/'))
if (replay) {
	const from = rec.room && rec.room !== 'open' ? [' of ', Object.assign(document.createElement('b'), { textContent: rec.room })] : []
	jamline.append('a recording', ...from, ' · ', live())
} else if (replayId) jamline.append('that recording is gone · ', live())
else if (transport.kind === 'ws') {
	$('newjam').closest('li').hidden = false
	$('newjam').onclick = () => (location.href = '/j/' + pick(JAM_A) + '-' + pick(JAM_B))
	if (!isOpenJam) {
		const b = word(room, async () => {
			try { await navigator.clipboard.writeText(location.origin + '/j/' + encodeURIComponent(room)); b.textContent = 'link copied' } catch { b.textContent = location.host + '/j/' + room }
			setTimeout(() => (b.textContent = room), 1600)
		})
		b.title = 'copy the link to this jam'
		jamline.append(b)
		const h1 = document.querySelector('h1')
		h1.style.cursor = 'pointer'
		h1.title = 'back to the open jam'
		h1.onclick = () => (location.href = '/')
	}
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
		b.querySelector('.who').textContent = st.human || st.bot ? st.label : '…'
		b.disabled = !st.me && st.human
		b.title = st.me ? 'open your instrument' : st.human ? `${st.label}'s ring` : 'take this ring'
		b.setAttribute('aria-label', st.me ? `${L.module.name}, your ring` : `Take the ${L.module.name} ring`)
		b.onclick = () => (st.me ? toggleFocus() : sit(i))
		li.appendChild(b)
		ol.appendChild(li)
	})
	const names = transport.peers.map((p) => (p.id === transport.id ? 'you' : p.name || playerName(lanes.findIndex((L) => L.id === p.instrument))))
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
	else if (e.key === 'Escape' && view.focus.on) view.setFocus(-1)
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

/* ───────── zoom: tap your badge and your instrument opens big, in its own form; the machine shrinks beside it ───────── */
const picker = createPicker({ engine, registry, view, me })
const devbar = $('devbar')
function toggleFocus() { view.setFocus(view.focus.on ? -1 : me.lane) }
addEventListener('zoom', (e) => {
	const { on, dev } = e.detail
	document.body.classList.toggle('zoomed', on)
	if (!on) picker.close()
	else {
		devbar.style.left = dev.x + dev.w - 12 + 'px'
		devbar.style.top = dev.y + 12 + 'px'
		paintPick()
	}
	rideSheet()
})
// the devbar is pinned to the sheet: it slides in and out with it, frame for frame
let riding = 0
function rideSheet() {
	if (riding) return
	const go = () => {
		const x = view.sheetShift
		devbar.hidden = !Number.isFinite(x) || x > innerWidth
		if (!devbar.hidden) devbar.style.transform = `translateX(calc(-100% + ${x}px))`
		riding = view.moving || (view.focus.on && x > 0) ? requestAnimationFrame(go) : 0
	}
	riding = requestAnimationFrame(go)
}
// the pick token wears the current instrument's glyph
function paintPick() { const L = lanes[me.lane]; if (L) $('pick').innerHTML = picker.glyph(L.module.id) }
engine.on('lanes', () => view.focus.on && paintPick())
$('pick').onclick = () => picker.toggle($('pick').getBoundingClientRect())
$('back').onclick = () => view.setFocus(-1)
jellify($('pick'))
jellify($('back'))

// handy in the console
Object.assign(window, { jam: { engine, transport, view, bots, registry, me, heart } })

/* ───────── record: 8 bars from the next loop start, stored, a link to replay them at /r/<id> ───────── */
const recBtn = $('rec')
if (recBtn && transport.kind === 'ws') {
	const recorder = createRecorder({ engine, transport, seatName: (i) => seat(i).name || null })
	const recline = $('recline')
	const setRec = (state, p = 0) => { recBtn.dataset.state = state; recBtn.style.setProperty('--p', p.toFixed(3)) }
	setRec('idle')
	recBtn.onclick = async () => {
		if (recorder.busy || recBtn.dataset.state === 'saving') return
		recline.textContent = ''
		try {
			const r = await recorder.record(({ state, p }) => setRec(state, p))
			r.room = room
			setRec('saving', 1)
			const id = await saveRecording(r)
			const url = `${location.origin}/r/${id}`
			setRec('done', 1)
			const copy = word('copy link', async () => {
				try { await navigator.clipboard.writeText(url); copy.textContent = 'copied' } catch { copy.textContent = url }
			})
			const a = Object.assign(document.createElement('a'), { href: '/r/' + id, target: '_blank', textContent: 'play it back' })
			recline.append('recorded ' + r.bars + ' bars · ', copy, ' · ', a)
			try { await navigator.clipboard.writeText(url) ; copy.textContent = 'link copied' } catch {}
			setTimeout(() => setRec('idle'), 2500)
		} catch (e) {
			console.warn(e)
			setRec('idle')
			recline.textContent = 'could not save that one'
		}
	}
	jellify(recBtn)
} else if (recBtn) recBtn.closest('li').hidden = true
