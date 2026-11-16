// roughjam: wires transport, engine, view, bots and the debug panel together.

import { createLocalTransport } from './transport/local.js'
import { createEngine } from './engine.js'
import { createView } from './view.js'
import { createStrip } from './picker.js'
import { jellify } from './jelly.js'
import { createBots, botName } from './bots.js'
import { registry } from './instruments/index.js'
import { createHeart } from './heart.js'
import { createUndo } from './undo.js'
import { createGhost } from './ghost.js'
import { createRecorder, createReplayTransport, loadRecording, saveRecording } from './record.js'

const SEAT_IDS = ['seat1', 'seat2', 'seat3', 'seat4']
const START = ['bass', 'keys', 'bell', 'drums']

const q = new URLSearchParams(location.search)
// everyone lands in the open jam at /; your own is /j/<name>; ?room= also works
const replayId = location.pathname.match(/\/r\/([\w-]{4,32})\/?$/)?.[1]
const pathJam = decodeURIComponent(location.pathname.match(/\/j\/([\w-]{1,48})\/?$/)?.[1] || '')
const room = (q.get('room') || pathJam || 'open').toLowerCase().slice(0, 48)
// no invented names: 'player N' by seat unless ?name=
const name = q.get('name') || ''

// Network if there's a relay (?ws=url, jam.0sk.ar, or same-origin /sync/relay); otherwise tabs in this browser. ?ws=off forces tabs.
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

// /r/<id>: read-only replay
let rec = null
if (replayId) try { rec = await loadRecording(replayId) } catch (e) { console.warn(e) }
let view = null
const transport = rec
	? createReplayTransport(rec, { seatIds: SEAT_IDS, onCursor: (i, x, y, down, who) => view?.showCursor('r' + who + i, i, x, y, who) })
	: await makeTransport()
const replay = transport.kind === 'replay'
if (replay) document.body.classList.add('replay')
const engine = createEngine(transport, { seatIds: SEAT_IDS, instruments: START })
const { seats } = engine
const me = { name, seat: -1, erase: false }
const undo = createUndo(engine)

const humanAt = (i) => transport.peers.find((p) => p.seat === seats[i].id)
const occupant = (i) => {
	const p = humanAt(i)
	if (p && p.id === transport.id) return { name: 'you', label: 'you', initial: me.name ? me.name[0] : 'Y', me: true, human: true }
	if (p) return { name: p.name || playerName(i), label: p.name || playerName(i), initial: p.name ? p.name[0] : String(i + 1), human: true }
	if (bots?.opts.on && seats[i].module.generate) {
		const r = seats[i].riff
		const riff = r && { color: r.color, label: r.label || 'echoes', who: riffWho(r) }
		return { name: botName(i), label: riff ? `${botName(i)} · ${riff.label} ${riff.who}` : botName(i), initial: botName(i).slice(-1), bot: true, riff }
	}
	return { name: '', label: 'sit' }
}
const playerName = (i) => `player ${i + 1}`
const canDraw = (i) => !replay && me.seat === i
const riffWho = (r) => {
	if (r.from === transport.id) return 'you'
	const p = transport.peers.find((q) => q.id === r.from)
	return p ? occupant(seats.findIndex((L) => L.id === p.seat))?.label : 'a player'
}
let bots = null

function sit(i) {
	if (replay) return
	const p = humanAt(i)
	if (p && p.id !== transport.id) return
	me.seat = i
	seats[i].riff = null // a person taking the seat ends a robot riff
	if (view?.focus.on) view.setFocus(i)
	transport.setMe({ seat: seats[i].id, name: me.name })
	renderSeats()
}

view = createView(document.getElementById('c'), engine, {
	occupant,
	canDraw,
	onSit: (i) => (i === me.seat ? toggleFocus() : sit(i)),
	onHand(from, to) {
		if (from !== me.seat || !occupant(to).bot) return false
		const ok = bots.hand(from, to)
		renderSeats()
		return ok
	},
	canHand: (from, to) => from === me.seat && to !== from && !!occupant(to).bot,
	onWipe: () => wipe(),
	onMute: (i) => !replay && engine.setMute(seats[i], !seats[i].mix.mute),
	onSolo: (i) => engine.setSolo(i),
	onPointer(i, e) {
		const L = seats[i]
		if (e.type === 'down') ghost?.stop()
		if (me.erase) e.alt = true
		e.shape = view.focus.on && view.focus.seat === i ? 'sheet' : 'ring'
		if (e.type === 'down') undo.remember(i)
		L.instance.pointer(e)
		engine.pushSoon(L)
		view.showCursor('me', i, e.x, e.y, '')
		heart.glance?.(i, 1400)
		transport.cursor(e.x, e.y, e.type !== 'up', L.id)
	},
})
const ghost = createGhost({ engine, view, me })
const heart = createHeart({ engine, geom: () => { const c = view.center(); if (c) c.moving = view.moving; return c } })
bots = createBots(engine, { seated: (i) => !!humanAt(i), view })

transport.on('cursor', (c) => {
	const i = seats.findIndex((L) => L.id === c.seat)
	if (i >= 0) heart.glance?.(i, 700)
	if (i >= 0) view.showCursor(c.from || 'peer' + i, i, c.x, c.y, c.name || transport.peers.find((p) => p.id === c.from)?.name || playerName(i))
})
transport.on('peers', renderSeats)
transport.on('welcome', () => {
	if (me.seat < 0) for (const i of [1, 2, 0, 3]) if (!humanAt(i)) { sit(i); break }
	const want = registry.get(q.get('instrument'))
	if (want && me.seat >= 0) {
		const L = seats[me.seat]
		if (L.module !== want) { engine.setInstrument(L, want.id, { state: want.sample?.(engine.steps()) }); engine.push(L) }
		view.setFocus?.(me.seat)
		ghost.play()
	}
	renderSeats()
})
engine.on('seats', renderSeats)
let riffSig = ''
setInterval(() => {
	const sig = seats.map((L) => (L.riff ? L.riff.id + L.riff.turn : '')).join('|')
	if (sig !== riffSig) { riffSig = sig; renderSeats() }
}, 300)

const $ = (id) => document.getElementById(id)

const JAM_A = ['dusk', 'amber', 'moss', 'salt', 'velvet', 'copper', 'hollow', 'paper', 'lantern', 'violet']
const JAM_B = ['moth', 'heron', 'fern', 'kettle', 'orchard', 'tide', 'comet', 'wren', 'ember', 'quarry']
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const isOpenJam = room === 'open'
const jamline = $('jamline')
const word = (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.onclick = fn; return b }
const live = () => word('play live', () => (location.href = '/'))
if (replay) {
	const from = rec.room && rec.room !== 'open' ? [' of ', Object.assign(document.createElement('b'), { textContent: rec.room })] : []
	jamline.append('a recording', ...from, ' · ', saveAudio(), ' · ', live())
} else if (replayId) jamline.append('that recording is gone · ', live())
else if (transport.kind === 'ws') {
	const fresh = (text) => Object.assign(word(text, () => (location.href = '/j/' + pick(JAM_A) + '-' + pick(JAM_B))), { title: 'a new jam with its own link, for you and whoever you send it to' })
	if (isOpenJam) jamline.append(fresh('start your own jam'))
	else {
		const b = word(room, async () => {
			try { await navigator.clipboard.writeText(location.origin + '/j/' + encodeURIComponent(room)); b.textContent = 'link copied' } catch { b.textContent = location.host + '/j/' + room }
			setTimeout(() => (b.textContent = room), 1600)
		})
		b.title = 'copy the link to this jam'
		const out = word('leave', () => (location.href = '/'))
		out.title = 'back to the jam everyone lands in'
		jamline.append(b, ' · ', out, ' · ', fresh('another'))
	}
}
// save audio: render the recording offline (m4a or WAV); phones share it, desktops download it
function saveAudio() {
	let file = null, busy = false
	const b = word('save audio', async () => {
		if (busy) return
		busy = true
		try {
			if (!file) {
				b.textContent = 'rendering…'
				const { renderRecording, encodeRecording } = await import('./export.js')
				const who = [...new Set(rec.seats.filter(Boolean))].join(', ')
				file = await encodeRecording(await renderRecording(rec, SEAT_IDS), { name: 'roughjam-' + replayId, title: rec.room && rec.room !== 'open' ? rec.room : 'roughjam', artist: who })
			}
			const { deliver } = await import('./export.js')
			b.textContent = (await deliver(file)) === 'shared' ? 'save audio' : 'saved'
		} catch (e) {
			// the share sheet wants a fresh tap once rendering took a while
			b.textContent = e.name === 'NotAllowedError' && file ? 'send audio' : 'could not save'
			if (e.name !== 'NotAllowedError') console.warn(e)
		}
		busy = false
	})
	b.title = 'this recording as an audio file'
	return b
}
// seats are drawn by view.js; this only keeps the peers line current
function renderSeats() {
	const names = transport.peers.map((p) => (p.id === transport.id ? 'you' : p.name || playerName(seats.findIndex((L) => L.id === p.seat))))
	$('peers').textContent = names.length > 1 ? names.join(', ').replace(/, ([^,]*)$/, ' & $1') : ''
}

$('sound').onclick = () => {
	engine.setSound(!engine.soundOn)
	$('sound').setAttribute('aria-pressed', engine.soundOn)
}
// first touch wakes the sound; after that the speaker token is theirs
$('c').addEventListener('pointerdown', () => { if (!engine.soundOn) $('sound').click() }, { once: true, capture: true })
if (replay) {
	// a recording plays on the first tap anywhere, from bar 1
	const wake = (e) => { if (!e.target.closest?.('button, a, input, select')) $('sound').click() }
	document.addEventListener('pointerdown', wake, { capture: true })
	engine.on('sound', (on) => {
		document.removeEventListener('pointerdown', wake, { capture: true })
		if (on) transport.restart()
	})
}
// two-finger tap undoes, three redoes. The first finger has already drawn, so the tap first puts that back.
{
	const c = $('c'), touches = new Map()
	let tap = null
	c.addEventListener('pointerdown', (e) => {
		if (e.pointerType !== 'touch') return
		touches.set(e.pointerId, [e.clientX, e.clientY])
		const now = e.timeStamp // event time: a busy frame mustn't spoil a quick tap
		if (touches.size === 1) tap = { t: now, n: 1, moved: false, mark: me.seat >= 0 ? undo.mark(me.seat) : null }
		else if (tap && now - tap.t < 300) tap.n = Math.max(tap.n, touches.size)
		else tap = null
	}, { capture: true })
	c.addEventListener('pointermove', (e) => {
		const p = touches.get(e.pointerId)
		if (p && tap && Math.hypot(e.clientX - p[0], e.clientY - p[1]) > 14) tap.moved = true
	}, { capture: true })
	const lift = (e) => {
		if (!touches.delete(e.pointerId) || touches.size || !tap) return
		const t = tap
		tap = null
		if (t.n < 2 || t.moved || e.timeStamp - t.t > 500 || !t.mark) return
		undo.rewind(t.mark)
		;(t.n === 2 ? undo.undo : undo.redo)(t.mark.i)
	}
	c.addEventListener('pointerup', lift, { capture: true })
	c.addEventListener('pointercancel', lift, { capture: true })
}
const setErase = (on) => {
	me.erase = on
	$('erase').setAttribute('aria-pressed', on)
	document.body.classList.toggle('erasing', on)
}
$('erase').onclick = () => setErase(!me.erase)
// tempo lands on the next loop; `want` shows your ask before the relay echoes it (kept up to 2 s)
let want = null // { bpm, t }
const heading = () => {
	const next = transport.clock.pending?.().at(-1)?.bpm ?? transport.clock.loopAt().bpm
	if (want && (want.bpm === next || performance.now() - want.t > 2000)) want = null
	return want ? want.bpm : next
}
const tempo = (d) => {
	const bpm = Math.max(50, Math.min(180, heading() + d))
	want = { bpm, t: performance.now() }
	transport.setLoop({ bpm })
	showTempo()
}
$('slower').onclick = () => tempo(-4)
$('faster').onclick = () => tempo(4)
// broom: wipes your ring (undo restores); a second tap also sweeps rings no other person sits at
const SWEEP_AGAIN_MS = 1600
let swept = 0
function wipe() {
	if (!seats[me.seat]) return
	const again = performance.now() - swept < SWEEP_AGAIN_MS
	const rest = seats.map((_, i) => i).filter((i) => i !== me.seat && !humanAt(i))
	for (const i of again ? rest : [me.seat]) {
		const L = seats[i]
		undo.remember(i)
		L.instance.clear ? L.instance.clear() : L.instance.setState(null)
		engine.push(L)
	}
	swept = again ? 0 : performance.now()
	view.offerSweep(again ? [] : rest, SWEEP_AGAIN_MS)
}
// the choice rides on the loop so everyone shares it
function setRobots(on) {
	bots.opts.on = !!on && !replay
	$('bots').setAttribute('aria-pressed', bots.opts.on)
	renderSeats()
}
transport.on('welcome', ({ loop }) => setRobots(loop?.robots))
transport.on('loop', ({ loop }) => setRobots(loop?.robots))
$('bots').onclick = () => {
	const on = !bots.opts.on
	setRobots(on)
	transport.setLoop({ robots: on })
}
addEventListener('keydown', (e) => {
	if (e.target.closest?.('input, select, textarea, .lil-gui')) return
	if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
	if ((e.metaKey || e.ctrlKey) && /^[zy]$/i.test(e.key)) {
		e.preventDefault()
		if (me.seat >= 0) (e.key.toLowerCase() === 'y' || e.shiftKey ? undo.redo : undo.undo)(me.seat)
		return
	}
	if (e.metaKey || e.ctrlKey) return
	if (e.key === ' ') { e.preventDefault(); $('sound').click() }
	else if (/^[1-9]$/.test(e.key) && +e.key <= seats.length) sit(+e.key - 1)
	else if (e.key === 'd') debug.toggle()
	else if (e.key === 'e') setErase(!me.erase)
	else if (e.key === 'j' || e.key === 'ArrowLeft') { e.preventDefault(); cycleInstrument(-1) }
	else if (e.key === 'k' || e.key === 'ArrowRight') { e.preventDefault(); cycleInstrument(1) }
	else if (e.key === 'Escape' && view.focus.on) view.setFocus(-1)
})
function showTempo() {
	const now = transport.clock.loopAt().bpm, bpm = heading()
	$('bpm').textContent = bpm
	$('bpm').classList.toggle('pending', bpm !== now)
}
setInterval(showTempo, 200)

let debug = { toggle() {} }
import('./debug.js')
	.then(({ createDebug }) => (debug = createDebug({ engine, transport, view, bots, me, sit, registry, renderSeats, heart })))
	.catch((e) => console.warn('debug panel unavailable', e))
renderSeats()

document.querySelectorAll('.token').forEach((el) => jellify(el))
jellify(document.querySelector('.tempo'), { amount: 0.08 })

const sheetbar = $('sheetbar')
const strip = createStrip({ engine, registry, me, el: sheetbar, before: () => undo.remember(me.seat), chosen: () => ghost.play() })
function toggleFocus() { view.setFocus(view.focus.on ? -1 : me.seat) }
addEventListener('zoom', (e) => {
	const { on, sheet } = e.detail
	document.body.classList.toggle('zoomed', on)
	if (on) {
		sheetbar.style.left = sheet.x + 'px'
		sheetbar.style.top = sheet.y - (innerWidth < 640 ? 104 : 54) + 'px'
		sheetbar.style.width = sheet.w + 'px'
		strip.paint()
	}
	rideSheet()
})
// pinned to the sheet, frame for frame
let riding = 0
function rideSheet() {
	if (riding) return
	const go = () => {
		const x = view.sheetShift
		sheetbar.hidden = !Number.isFinite(x) || x > innerWidth
		if (!sheetbar.hidden) sheetbar.style.transform = `translateX(${x}px)`
		riding = view.moving || (view.focus.on && x > 0) ? requestAnimationFrame(go) : 0
	}
	riding = requestAnimationFrame(go)
}
engine.on('seats', () => view.focus.on && strip.paint())

const flash = document.createElement('div')
flash.className = 'flash'
flash.hidden = true
flash.setAttribute('aria-live', 'polite')
document.body.append(flash)
let flashT = 0
function cycleInstrument(d) {
	if (replay || me.seat < 0) return
	const id = strip.cycle(d)
	if (!id || view.focus.on) return
	const s = view.seatAt(me.seat), L = seats[me.seat]
	flash.style.setProperty('--c', L.color)
	flash.innerHTML = `<span class="token">${strip.glyph(id)}</span><i></i>`
	flash.querySelector('i').textContent = registry.get(id).name.toLowerCase()
	flash.style.left = s.x + 'px'
	flash.style.top = s.y + 'px'
	flash.hidden = false
	flash.classList.remove('pop'); void flash.offsetWidth; flash.classList.add('pop')
	clearTimeout(flashT)
	flashT = setTimeout(() => (flash.hidden = true), 1100)
}

Object.assign(window, { jam: { engine, transport, view, bots, registry, me, heart, undo } })

// records 8 bars from the next loop start
const recBtn = $('rec')
if (recBtn && transport.kind === 'ws') {
	const recorder = createRecorder({ engine, transport, seatName: (i) => { const o = occupant(i); return o.me ? me.name || playerName(i) : o.name || null } }) // 'you' becomes your name or seat
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
