// roughjam: wires transport, engine, view, bots and the debug panel together.

import { rng } from './instruments/lib/util.js'
import { createLocalTransport } from './transport/local.js'
import { createEngine } from './engine.js'
import { createView } from './view.js'
import { createStrip } from './picker.js'
import { createHint } from './hint.js'
import { jellify } from './jelly.js'
import { createBots, botName } from './bots.js'
import { registry } from './instruments/index.js'
import { createHeart } from './heart.js'
import { createHarmony } from './harmony.js'
import { createUndo } from './undo.js'
import { createGhost } from './ghost.js'
import { createRecorder, createReplayTransport, loadRecording, saveRecording } from './record.js'
import { songOf, loadSong, encodeSong, decodeSong } from './song.js'
import { createPresence } from './presence.js'

const SEAT_IDS = ['seat1', 'seat2', 'seat3', 'seat4']

const q = new URLSearchParams(location.search)
// everyone lands in the open jam at /; your own is /j/<name>; ?room= also works
const replayId = location.pathname.match(/\/r\/([\w-]{4,32})\/?$/)?.[1]
const pathJam = decodeURIComponent(location.pathname.match(/\/j\/([\w-]{1,48})\/?$/)?.[1] || '')
const room = (q.get('room') || pathJam || 'open').toLowerCase().slice(0, 48)
// A fresh jam: bass and drums hold the floor, the middle two seats are dealt from the strange instruments.
// Seeded by room and day, so everyone in a room sees the same lineup and the open jam changes daily.
const STRANGE = [
	'contour',
	'steps',
	'sweep',
	'bloom',
	'drift',
	'scribble',
	'strum',
	'swarm',
	'orbits',
	'embers',
]
const START = (() => {
	let h = 2166136261
	for (const c of room + new Date().toISOString().slice(0, 10))
		h = Math.imul(h ^ c.charCodeAt(0), 16777619)
	const r = rng(h),
		pile = STRANGE.slice()
	const deal = () => pile.splice(Math.floor(r() * pile.length), 1)[0]
	return ['bass', deal(), deal(), 'drums']
})()
// your own jam (/j/<name>) starts as a blank page: no seat has an instrument until someone sits there and picks one
const blankJam = room !== 'open' && !replayId
const blank = (L) => L.module.id === 'empty'
// Someone who has never switched instruments is dealt one that's fun in five seconds without reading.
// Steps and contour still turn up for robots and in the picker.
const FIRST = ['strum', 'swarm', 'orbits', 'embers', 'scribble']
const newcomer = () => {
	try {
		return !localStorage.getItem('roughjam.switched')
	} catch {
		return true
	}
}
// no invented names: 'player N' by seat unless ?name=
const name = q.get('name') || ''

// Network if there's a relay (?ws=url, jam.0sk.ar, or same-origin /sync/relay); otherwise tabs in this browser. ?ws=off forces tabs.
const sameOrigin = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`
let relayP = null
const relay = () => (relayP ||= relayUrl())
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
// a jam's name for "New jam" and for a fork of a shared song
const JAM_A = [
	'dusk',
	'amber',
	'moss',
	'salt',
	'velvet',
	'copper',
	'hollow',
	'paper',
	'lantern',
	'violet',
]
const JAM_B = [
	'moth',
	'heron',
	'fern',
	'kettle',
	'orchard',
	'tide',
	'comet',
	'wren',
	'ember',
	'quarry',
]
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const freshJam = () => pick(JAM_A) + '-' + pick(JAM_B)
async function makeTransport(url) {
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

// #song=…: a shared song. With a relay it forks into a new jam of its own (#seed= there), so the original stays
// untouched; without one it loads into this jam. Either way it lands once the jam has welcomed us.
const songHash = !replayId && location.hash.match(/^#(song|seed)=([\w-]+)$/)
if (songHash?.[1] === 'song' && (await relay())) {
	location.replace('/j/' + freshJam() + '#seed=' + songHash[2])
	await new Promise(() => {})
}

// /r/<id>: read-only replay
let rec = null
if (replayId)
	try {
		rec = await loadRecording(replayId)
	} catch (e) {
		console.warn(e)
	}
let view = null
const transport = rec
	? createReplayTransport(rec, {
			seatIds: SEAT_IDS,
			onCursor: (i, x, y, down, who) => view?.showCursor('r' + who + i, i, x, y, who),
		})
	: await makeTransport(await relay())
const replay = transport.kind === 'replay'
if (replay) document.body.classList.add('replay')
const engine = createEngine(transport, {
	seatIds: SEAT_IDS,
	instruments: blankJam ? SEAT_IDS.map(() => 'empty') : START,
})
const { seats } = engine
const me = { name, seat: -1, erase: false }
const undo = createUndo(engine)

// a person in that seat, real or one of the crowd
const humanAt = (i) =>
	presence ? presence.at(i) : transport.peers.find((p) => p.seat === seats[i].id)
const occupant = (i) => {
	const p = humanAt(i)
	if (p && p.id === transport.id)
		return {
			name: 'you',
			label: 'you',
			initial: name ? name[0] : 'Y',
			me: true,
			human: true,
			dim: presence?.dim(i) || 0,
		}
	if (p)
		return {
			name: p.name || playerName(i),
			label: p.name || playerName(i),
			initial: p.name ? p.name[0] : String(i + 1),
			human: true,
			dim: presence?.dim(i) || 0,
		}
	if (bots?.opts.on && seats[i].module.generate) {
		const r = seats[i].riff
		const riff = r && { color: r.color, label: r.label || 'echoes', who: riffWho(r) }
		return {
			name: botName(i),
			label: riff ? `${botName(i)} · ${riff.label} ${riff.who}` : botName(i),
			initial: botName(i).slice(-1),
			bot: true,
			riff,
		}
	}
	return { name: '', label: 'sit' }
}
const playerName = (i) => `player ${i + 1}`
const canDraw = (i) => !replay && me.seat === i
const riffWho = (r) => {
	if (r.from === transport.id) return 'you'
	const p = transport.peers.find((q) => q.id === r.from)
	const i = p ? seats.findIndex((L) => L.id === p.seat) : -1
	return i >= 0 ? occupant(i).label : p?.name || 'a player'
}
let bots = null,
	hint = null

function sit(i) {
	if (replay) return
	const p = humanAt(i)
	if (p && p.id !== transport.id) return
	me.seat = i
	me.out = false
	seats[i].riff = null // a person taking the seat ends a robot riff
	if (view?.focus.on) view.setFocus(i)
	transport.setMe({ seat: seats[i].id, name: me.name })
}
// your candle burnt out while someone waited: you get up and listen; touching the machine puts you back in line
function getUp() {
	if (me.seat < 0) return
	if (view.focus.on) view.setFocus(-1)
	ghost.stop()
	me.seat = -1
	me.out = true
	transport.setMe({ seat: 'out', name: me.name })
}
function backInLine() {
	if (replay || !me.out) return
	me.out = false
	transport.setMe({ seat: 'wait:' + transport.clock.now(), name: me.name })
}
const presence = replay
	? null
	: createPresence({
			transport,
			seats,
			sit,
			getUp,
			rejoin: () => ((me.out = true), backInLine()),
			draw: (i, f, x, y) => view.showCursor('crowd' + f.id, i, x, y),
		})
// two who sat on one seat at the same moment: the later arrival gets up and waits again
transport.on('peers', () => {
	const all = transport.peers,
		mine = all.find((p) => p.id === transport.id)
	const rival =
		me.seat >= 0 && mine && all.find((p) => p.id !== transport.id && p.seat === seats[me.seat].id)
	// an arrival time we don't know yet counts as late: nobody gets up for a stranger
	const t = (p) => p.joinedAt ?? Infinity
	if (rival && (t(rival) - t(mine) || (rival.id < mine.id ? -1 : 1)) < 0) {
		me.seat = -1
		if (view.focus.on) view.setFocus(-1)
		transport.setMe({ seat: null, name: me.name })
	}
	presence?.tick()
})

// every stroke on a ring or sheet comes through here. Erasing (token, shift, right button, two fingers)
// arrives as e.alt; instruments rub out with it and never draw.
let lastPt = null
function pointerTo(i, e) {
	const L = seats[i]
	if (e.type === 'down') ghost?.stop()
	if (i === me.seat) presence?.touch(i)
	// your first stroke: now the hint can show the other instruments
	if (e.type === 'up' && i === me.seat) hint?.start()
	if (me.erase || e.button === 2) e.alt = true
	e.shape = view.focus.on && view.focus.seat === i ? 'sheet' : 'ring'
	if (e.type === 'down') undo.remember(i)
	// the ring is the jam's loop; a seat with its own length goes round it more (or less) than once
	const { rep, off } = engine.ringMap(L)
	L.instance.pointer(e.shape === 'ring' && rep !== 1 ? { ...e, x: (off + e.x * rep) % 1 } : e)
	engine.pushSoon(L)
	lastPt = e.type === 'up' ? null : { seat: i, x: e.x, y: e.y, id: e.id }
	view.showCursor('me', i, e.x, e.y, '', !!e.alt)
	heart.glance?.(i, 1400)
	transport.cursor(e.x, e.y, e.type !== 'up', L.id)
}
// a second finger joined a stroke and both moved: what the first finger drew goes back, and it erases from here
function rubFromHere(mark) {
	const p = lastPt,
		i = view.rubDrag()
	if (i < 0 || !p || p.seat !== i) return false
	const shape = view.focus.on && view.focus.seat === i ? 'sheet' : 'ring'
	seats[i].instance.pointer({ type: 'up', x: p.x, y: p.y, id: p.id, alt: false, shape })
	if (mark?.i === i) undo.rewind(mark)
	pointerTo(i, { type: 'down', x: p.x, y: p.y, id: p.id, alt: true })
	return true
}
view = createView(document.getElementById('c'), engine, {
	occupant,
	audience: () => presence?.audience() || [],
	canDraw,
	// sitting down at a bare ring opens it, so the glyphs are right there to pick from
	onSit: (i) => (i === me.seat ? toggleFocus() : (sit(i), blank(seats[i]) && view.setFocus(i))),
	onHand(from, to) {
		if (from !== me.seat || !occupant(to).bot) return false
		return bots.hand(from, to)
	},
	canHand: (from, to) => from === me.seat && to !== from && !!occupant(to).bot,
	onWipe: () => wipe(),
	onMute: (i) => !replay && engine.setMute(seats[i], !seats[i].mix.mute),
	onSolo: (i) => engine.setSolo(i),
	onMix: (i, patch) => !replay && engine.setMix(seats[i], patch),
	onPointer: pointerTo,
	onBars(i, n) {
		const L = seats[i]
		undo.remember(i)
		// a pattern with its own length in bars (steps) grows itself; the rest change the seat's loop
		if (L.instance?.bars) {
			L.instance.bars = n
			engine.push(L, { now: true })
		} else engine.setBars(L, n)
	},
})
const ghost = createGhost({ engine, view, me })
// got up while away: any touch on the machine puts you back in line
document.getElementById('c').addEventListener('pointerdown', backInLine)
const heart = createHeart({
	engine,
	geom: () => {
		const c = view.center()
		if (c) c.moving = view.moving
		return c
	},
})
createHarmony({
	canvas: document.getElementById('c'),
	view,
	transport,
	heart,
	engine,
	readOnly: replay,
})
bots = createBots(engine, { seated: (i) => !!humanAt(i), view })

transport.on('cursor', (c) => {
	const i = seats.findIndex((L) => L.id === c.seat)
	if (i >= 0) heart.glance?.(i, 700)
	if (i >= 0)
		view.showCursor(
			c.from || 'peer' + i,
			i,
			c.x,
			c.y,
			c.name || transport.peers.find((p) => p.id === c.from)?.name || playerName(i),
		)
})
// no ?name=: the lowest 'player N' nobody here has, kept for the session whichever seat you move to
const freeName = () => {
	const taken = new Set(transport.peers.filter((p) => p.id !== transport.id).map((p) => p.name))
	let n = 1
	while (taken.has(`player ${n}`)) n++
	return `player ${n}`
}
transport.on('welcome', ({ seats: snap }) => {
	if (!me.name) me.name = freeName()
	presence?.start()
	// the jam's seats as they stand land a moment after the welcome; deal after them, or they'd undo the deal here.
	// A song from the link, or the one saved here when the jam comes back empty, takes the place of the deal.
	if (!replay && !restoring)
		restoring = setTimeout(async () => ((await restore(snap)) ? ghost.play() : deal(), autosave()))
	else if (replay) setTimeout(deal)
})
let restoring = 0
const saveKey = 'roughjam.song.' + room
async function restore(snap) {
	let song = null,
		from = ''
	try {
		if (songHash) {
			from = 'link'
			history.replaceState(null, '', location.pathname + location.search)
			song = await decodeSong(songHash[2])
		} else if (!Object.keys(snap || {}).length) {
			from = 'saved'
			const saved = localStorage.getItem(saveKey)
			song = saved && (await decodeSong(saved))
		}
		if (!song) return false
		loadSong(engine, transport, song)
		return true
	} catch (e) {
		console.warn(e)
		// a save that won't load is kept aside rather than overwritten
		if (from === 'saved') localStorage.setItem(saveKey + '.broken', localStorage.getItem(saveKey))
		say(from === 'link' ? e.message : 'the song saved here would not load')
		return false
	}
}
// every change to the jam lands in localStorage, so a reload or a closed tab never loses a song
function autosave() {
	let last = ''
	const save = () => {
		try {
			const json = JSON.stringify(songOf(engine, transport))
			if (json !== last) localStorage.setItem(saveKey, (last = json))
		} catch (e) {
			console.warn('autosave', e)
		}
	}
	save()
	setInterval(save, 1000)
	addEventListener('pagehide', save)
}
function deal() {
	let want = registry.get(q.get('instrument'))
	if (want?.hidden) want = null
	const bare = me.seat >= 0 && blank(seats[me.seat])
	// a newcomer's first seat, or a bare one: one of the five-second instruments, and the ghost plays it once on their ring
	if (!want && me.seat >= 0 && (bare || (newcomer() && !FIRST.includes(seats[me.seat].module.id))))
		want = registry.get(
			FIRST.map((_, k) => FIRST[(k + new Date().getDate()) % FIRST.length]).find(
				(id) => !seats.some((L) => L.module.id === id),
			) || FIRST[0],
		)
	if (!want && me.seat >= 0) ghost.play()
	if (want && me.seat >= 0) {
		const L = seats[me.seat]
		if (L.module !== want) {
			// dealt into a blank jam it starts blank too
			engine.setInstrument(L, want.id, bare ? {} : { state: want.sample?.(engine.steps(L)) })
			engine.push(L)
		}
		if (q.get('instrument')) view.setFocus?.(me.seat)
		ghost.play()
	}
}

const $ = (id) => document.getElementById(id)

const isOpenJam = room === 'open'
const jamline = $('jamline')
const word = (text, fn) => {
	const b = document.createElement('button')
	b.textContent = text
	b.onclick = fn
	return b
}
// leaves the recording for the jam it came from, live; the open jam when it came from there or we don't know
const live = (room) => {
	const named = room && room !== 'open'
	const b = word(
		'← back to ' + (named ? room : 'live'),
		() => (location.href = named ? '/j/' + encodeURIComponent(room) : '/'),
	)
	b.title = 'leave this recording and play along with whoever is in there now'
	return b
}
if (replay) {
	const br = () => document.createElement('br')
	jamline.append(
		Object.assign(document.createElement('b'), { textContent: 'Recording ' + replayId }),
		br(),
		saveAudio(),
		br(),
		br(),
		live(rec.room),
	)
} else if (replayId)
	jamline.append(
		'That recording is gone',
		document.createElement('br'),
		document.createElement('br'),
		live(),
	)
else if (isOpenJam) {
	// the open jam: "New jam" (only with a relay to meet in), then Share
	if (transport.kind === 'ws') {
		const chip = word('New jam', () => (location.href = '/j/' + freshJam()))
		chip.title = 'a new jam with its own link, for you and whoever you send it to'
		chip.className = 'chip'
		chip.insertAdjacentHTML(
			'afterbegin',
			'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
		)
		jellify(chip, { amount: 0.12 })
		jamline.append(chip)
	}
	jamline.append(shareChip())
} else {
	// a named jam, like an iOS header: a round back chip, then the jam's name and Share in one chip.
	// Another new jam is back, then New jam.
	const back = word('', () => (location.href = '/'))
	back.className = 'chip back'
	back.title = 'back to the jam everyone lands in'
	back.setAttribute('aria-label', 'back to the open jam')
	back.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>'
	jellify(back, { amount: 0.12 })
	const chip = shareChip()
	chip.prepend(
		Object.assign(document.createElement('span'), { className: 'name', textContent: room }),
	)
	jamline.append(back, chip)
}
// share: a link that carries the song itself, so it works with no relay and offline; opening it forks the song
// into a new jam. Its last child is the word that flips to "link copied".
function shareChip() {
	const chip = word('', share)
	chip.className = 'chip'
	chip.append(Object.assign(document.createElement('span'), { textContent: 'Share' }))
	chip.title = 'copy a link that holds this song: whoever opens it gets their own copy to play'
	jellify(chip, { amount: 0.12 })
	return chip
}
async function songLink() {
	return location.origin + '/#song=' + (await encodeSong(songOf(engine, transport)))
}
async function share() {
	const chip = this
	const label = chip.lastChild,
		was = label.textContent
	const link = songLink()
	try {
		// Safari only lets the clipboard wait for a promise handed over inside the tap
		if (window.ClipboardItem)
			await navigator.clipboard.write([
				new ClipboardItem({
					'text/plain': link.then((u) => new Blob([u], { type: 'text/plain' })),
				}),
			])
		else await navigator.clipboard.writeText(await link)
		label.textContent = 'link copied'
		say('')
	} catch {
		// no clipboard: the link itself, to copy by hand
		const a = Object.assign(document.createElement('a'), {
			href: await link,
			textContent: 'the song',
		})
		say('copy this link: ', a)
	}
	setTimeout(() => (label.textContent = was), 1600)
}
function say(...what) {
	$('recline').replaceChildren(...what)
}
// save audio: render the recording offline (m4a or WAV); phones share it, desktops download it
function saveAudio() {
	let file = null,
		busy = false
	const b = word('download audio', async () => {
		if (busy) return
		busy = true
		try {
			if (!file) {
				b.textContent = 'rendering…'
				const { renderRecording, encodeRecording } = await import('./export.js')
				const who = [...new Set(rec.seats.filter(Boolean))].join(', ')
				file = await encodeRecording(await renderRecording(rec, SEAT_IDS), {
					name: 'roughjam-' + replayId,
					title: rec.room && rec.room !== 'open' ? rec.room : 'roughjam',
					artist: who,
				})
			}
			const { deliver } = await import('./export.js')
			b.textContent = (await deliver(file)) === 'shared' ? 'download audio' : 'downloaded'
		} catch (e) {
			// the share sheet wants a fresh tap once rendering took a while
			b.textContent =
				e.name === 'NotAllowedError' && file ? 'send audio' : 'could not make the audio'
			if (e.name !== 'NotAllowedError') console.warn(e)
		}
		busy = false
	})
	b.title = 'this recording as an audio file'
	b.className = 'dl'
	return b
}

// a toggle acts when the finger lands, like a hardware button; keyboard clicks (detail 0) still work
const onPress = (el, fn) => {
	el.addEventListener('pointerdown', (e) => e.button === 0 && fn())
	el.onclick = (e) => e.detail === 0 && fn()
}
// iOS only paints :active when some touch listener exists
document.addEventListener('touchstart', () => {}, { passive: true })
$('sound').onclick = () => {
	engine.setSound(!engine.soundOn)
	$('sound').setAttribute('aria-pressed', engine.soundOn)
}
// the first tap or key anywhere wakes the sound (the speaker token and space toggle it themselves); after that it's theirs
if (!replay) {
	const wake = (e) => {
		removeEventListener('pointerdown', wake, true)
		removeEventListener('keydown', wake, true)
		if (engine.soundOn || e.target.closest?.('#sound') || e.key === ' ') return
		$('sound').click()
	}
	addEventListener('pointerdown', wake, true)
	addEventListener('keydown', wake, true)
}
if (replay) {
	// a recording plays on the first tap anywhere, from bar 1
	const wake = (e) => {
		if (!e.target.closest?.('button, a, input, select')) $('sound').click()
	}
	document.addEventListener('pointerdown', wake, { capture: true })
	engine.on('sound', (on) => {
		document.removeEventListener('pointerdown', wake, { capture: true })
		if (on) transport.restart()
	})
}
// two-finger tap undoes, three redoes; two-finger drag erases. The first finger has already drawn, so either
// first puts that back.
{
	const c = $('c'),
		touches = new Map()
	let tap = null
	c.addEventListener(
		'pointerdown',
		(e) => {
			if (e.pointerType !== 'touch') return
			touches.set(e.pointerId, [e.clientX, e.clientY])
			const now = e.timeStamp // event time: a busy frame mustn't spoil a quick tap
			if (touches.size === 1)
				tap = { t: now, n: 1, moved: false, mark: me.seat >= 0 ? undo.mark(me.seat) : null }
			else if (tap) {
				tap.n = Math.max(tap.n, touches.size)
				if (now - tap.t >= 300) tap.late = true // too slow for a tap, still fine for a two-finger drag
			}
		},
		{ capture: true },
	)
	c.addEventListener(
		'pointermove',
		(e) => {
			const p = touches.get(e.pointerId)
			if (p && tap && Math.hypot(e.clientX - p[0], e.clientY - p[1]) > 14) tap.moved = true
			// two fingers dragging: the stroke becomes an eraser
			if (tap?.moved && touches.size >= 2 && !tap.rub) tap.rub = rubFromHere(tap.mark) || 'no'
		},
		{ capture: true },
	)
	const lift = (e) => {
		if (!touches.delete(e.pointerId) || touches.size || !tap) return
		const t = tap
		tap = null
		if (t.n < 2 || t.moved || t.late || e.timeStamp - t.t > 500 || !t.mark) return
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
onPress($('erase'), () => setErase(!me.erase))
// tempo lands on the next bar; `want` shows your ask before the relay echoes it (kept up to 2 s)
let want = null // { bpm, t }
const heading = () => {
	const next = transport.clock.latestLoop().bpm
	if (want && (want.bpm === next || performance.now() - want.t > 2000)) want = null
	return want ? want.bpm : next
}
const tempo = (d) => {
	const bpm = Math.max(50, Math.min(180, heading() + d))
	want = { bpm, t: performance.now() }
	transport.setLoop({ bpm })
	showTempo()
}
onPress($('slower'), () => tempo(-4))
onPress($('faster'), () => tempo(4))
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
}
transport.on('welcome', ({ loop }) => setRobots(loop?.robots))
transport.on('loop', ({ loop }) => setRobots(loop?.robots))
onPress($('bots'), () => {
	const on = !bots.opts.on
	setRobots(on)
	transport.setLoop({ robots: on })
})
addEventListener('keydown', (e) => {
	if (e.target.closest?.('input, select, textarea, .lil-gui')) return
	if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
	if ((e.metaKey || e.ctrlKey) && /^[zy]$/i.test(e.key)) {
		e.preventDefault()
		if (me.seat >= 0) (e.key.toLowerCase() === 'y' || e.shiftKey ? undo.redo : undo.undo)(me.seat)
		return
	}
	if (e.metaKey || e.ctrlKey) return
	if (e.key === ' ') {
		e.preventDefault()
		$('sound').click()
	} else if (/^[1-9]$/.test(e.key) && +e.key <= seats.length) sit(+e.key - 1)
	else if (e.key === 'e') setErase(!me.erase)
	else if (e.key === 'j' || e.key === 'ArrowLeft') {
		e.preventDefault()
		cycleInstrument(-1)
	} else if (e.key === 'k' || e.key === 'ArrowRight') {
		e.preventDefault()
		cycleInstrument(1)
	} else if (e.key === 'Escape' && view.focus.on) view.setFocus(-1)
})
function showTempo() {
	const now = transport.clock.loopAt().bpm,
		bpm = heading()
	$('bpm').textContent = bpm
	$('bpm').classList.toggle('pending', bpm !== now)
}
setInterval(showTempo, 200)

import('./debug.js')
	.then(({ createDebug }) =>
		createDebug({ engine, transport, view, bots, me, sit, presence, registry, heart }),
	)
	.catch((e) => console.warn('debug panel unavailable', e))

document.querySelectorAll('.token').forEach((el) => jellify(el))
jellify(document.querySelector('.tempo'), { amount: 0.08 })

const sheetbar = $('sheetbar')
const strip = createStrip({
	engine,
	registry,
	me,
	el: sheetbar,
	before: () => undo.remember(me.seat),
	chosen: () => {
		ghost.play()
		hint.switched()
	},
})
hint = createHint({
	engine,
	view,
	me,
	registry,
	glyph: strip.glyph,
	choose: (id) => strip.choose(id) && popFlash(id),
})
// a sideways two-finger trackpad swipe over the sheet moves to the next instrument (picker.js); drawing is a press, so they never meet
$('c').addEventListener(
	'wheel',
	(e) => view.focus.on && view.focus.seat === me.seat && !replay && strip.wheel(e),
	{ passive: false },
)
function toggleFocus() {
	view.setFocus(view.focus.on ? -1 : me.seat)
}
addEventListener('zoom', (e) => {
	const { on, sheet } = e.detail
	document.body.classList.toggle('zoomed', on)
	if (on) {
		sheetbar.style.left = sheet.x + 'px'
		sheetbar.style.top = sheet.y - (innerWidth < 640 ? 114 : 70) + 'px'
		sheetbar.style.width = sheet.w + 'px'
		// the tool strip sits inside the sheet's frame, under the drawing
		sheetbar.style.setProperty('--inks-top', (innerWidth < 640 ? 114 : 70) + sheet.h + 'px')
		sheetbar.style.setProperty('--inks-h', (sheet.tools || 0) + 'px')
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
		// the top-left chips leave as the machine moves in, and come back as it moves out
		const m = view.machineShift
		jamline.style.opacity = m ? 1 - m : ''
		jamline.style.transform = m ? `translateY(${-14 * m}px)` : ''
		jamline.style.pointerEvents = m ? 'none' : ''
		jamline.style.visibility = m >= 1 ? 'hidden' : ''
		riding = view.moving || (view.focus.on && x > 0) ? requestAnimationFrame(go) : 0
	}
	riding = requestAnimationFrame(go)
}
engine.on('seats', () => view.focus.on && strip.paint())
engine.on('apply', (L) => view.focus.on && L.index === me.seat && strip.paint())

const flash = document.createElement('div')
flash.className = 'flash'
flash.hidden = true
flash.setAttribute('aria-live', 'polite')
document.body.append(flash)
let flashT = 0
function cycleInstrument(d) {
	if (replay || me.seat < 0) return
	const id = strip.cycle(d)
	if (id) popFlash(id)
}
// the instrument you just switched to, popped up on your badge for a second
function popFlash(id) {
	if (view.focus.on) return
	const s = view.seatAt(me.seat),
		L = seats[me.seat]
	flash.style.setProperty('--c', L.color)
	flash.innerHTML = `<span class="token">${strip.glyph(id)}</span><i></i>`
	flash.querySelector('i').textContent = registry.get(id).name.toLowerCase()
	flash.style.left = s.x + 'px'
	flash.style.top = s.y + 'px'
	flash.hidden = false
	flash.classList.remove('pop')
	void flash.offsetWidth
	flash.classList.add('pop')
	clearTimeout(flashT)
	flashT = setTimeout(() => (flash.hidden = true), 1100)
}

Object.assign(window, {
	jam: {
		engine,
		transport,
		view,
		bots,
		registry,
		me,
		heart,
		undo,
		presence,
		// the escape hatch: jam.export() is the song as data, jam.import() takes that, its JSON or a share link
		export: () => songOf(engine, transport),
		import: async (song) =>
			loadSong(engine, transport, typeof song === 'string' ? await decodeSong(song) : song),
		link: songLink,
	},
})

// records 8 bars from the next loop start
const recBtn = $('rec')
if (recBtn && transport.kind === 'ws') {
	const recorder = createRecorder({
		engine,
		transport,
		seatName: (i) => {
			const o = occupant(i)
			return o.me ? me.name || playerName(i) : o.name || null
		},
	}) // 'you' becomes your name or seat
	const recline = $('recline')
	const setRec = (state, p = 0) => {
		recBtn.dataset.state = state
		recBtn.style.setProperty('--p', p.toFixed(3))
	}
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
				try {
					await navigator.clipboard.writeText(url)
					copy.textContent = 'link copied'
				} catch {
					copy.textContent = url
				}
			})
			copy.title = url
			const a = Object.assign(document.createElement('a'), {
				href: '/r/' + id,
				target: '_blank',
				textContent: 'listen',
			})
			recline.append(r.bars + ' bars · ', copy, ' · ', a)
			try {
				await navigator.clipboard.writeText(url)
				copy.textContent = 'link copied'
			} catch {}
			setTimeout(() => setRec('idle'), 2500)
		} catch (e) {
			console.warn(e)
			setRec('idle')
			recline.textContent = 'could not save that one'
		}
	}
	jellify(recBtn)
} else if (recBtn && !replay)
	recBtn.onclick = () => say('recording needs the relay; share keeps the song as a link')
else if (recBtn) recBtn.closest('li').hidden = true
