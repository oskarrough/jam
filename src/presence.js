// Who's here. Four seats, any number listening: the listeners are dots round the dial's rim, and whoever's waiting
// queues in arrival order. While anyone waits, each seat is a candle: a player who hasn't drawn for two loops burns
// down, gets up, and the first in line sits in their place. Any stroke relights it.
//
// A peer's presence seat says where they are: a seat id; 'wait:<ms>' (or nothing yet: their arrival) is in line
// since then; 'out' is listening, not waiting, until they touch the machine again. Every tab sorts the same list
// the same way, so the k-th in line takes the k-th free seat and nobody races. A burnt-out player's own tab gets
// them up; nobody else moves anyone.
//
// The crowd: fake listeners for trying this alone, local only, never sent. Above three they also take seats,
// draw now and then and go idle sometimes, so you see a badge dim, relight and hand off.

const PALETTE = [
	'#e0607e',
	'#f2a541',
	'#5fb49c',
	'#6c8ead',
	'#b07cc6',
	'#e9d758',
	'#ef8354',
	'#7fc8f8',
]
const NAMES = ['ada', 'bo', 'cleo', 'dev', 'eli', 'fen', 'gus', 'ivy', 'jo', 'kit', 'lou', 'mo']
const ORDER = [1, 2, 0, 3] // the seats arrivals take first
const LOOPS = 2 // a candle lasts this many loops

const rand = (a, b) => a + Math.random() * (b - a)
const hue = (id) =>
	PALETTE[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]

export function createPresence({ transport, seats, sit, getUp, rejoin, draw }) {
	const clock = transport.clock
	const now = () => clock.now()
	const fakes = []
	const lit = seats.map(() => 0) // when each seat last saw its player draw, shared ms
	const holder = seats.map(() => null)
	let lineSince = 0,
		crowd = 0,
		ready = false

	const loopMs = () => {
		const l = clock.loopAt?.()
		return l ? (l.bars * l.beatsPerBar * 60000) / l.bpm : 10000
	}
	const people = () => [...transport.peers, ...fakes]
	const seatOf = (p) => seats.findIndex((L) => L.id === p.seat)
	const since = (p) =>
		typeof p.seat === 'string' && p.seat.startsWith('wait:') ? +p.seat.slice(5) : (p.joinedAt ?? 0)
	const waiting = (p) => seatOf(p) < 0 && p.seat !== 'out'
	const line = () =>
		people()
			.filter(waiting)
			.sort((a, b) => since(a) - since(b) || (a.id < b.id ? -1 : 1))
	const at = (i) => people().find((p) => p.seat === seats[i].id)
	const touch = (i) => i >= 0 && (lit[i] = Math.max(lit[i], now()))
	// 0 lit .. 1 out; nothing burns while nobody waits
	const dim = (i) =>
		!lineSince || !at(i)
			? 0
			: Math.min(1, Math.max(0, (now() - Math.max(lit[i], lineSince)) / (LOOPS * loopMs())))

	// a stroke from whoever sits there relights it: their cursor right away, their edits as they land
	transport.on('cursor', (c) => {
		const i = seats.findIndex((L) => L.id === c.seat)
		if (c.down && i >= 0 && at(i)?.id === c.from) touch(i)
	})
	transport.on('apply', (e) => {
		const i = seats.findIndex((L) => L.id === e.seat)
		if (i >= 0 && (e.local || at(i)?.id === e.from)) touch(i)
	})

	function tick() {
		if (!ready) return
		const t = now()
		seats.forEach((_, i) => {
			const id = at(i)?.id ?? null
			if (id !== holder[i]) ((holder[i] = id), (lit[i] = t))
		})
		lineSince = line().length ? lineSince || t : 0
		play(t)
		// burnt out: as many get up as are waiting for a seat, the longest idle first. Your own seat gets you up,
		// and the crowd's seats get theirs up.
		const free = ORDER.filter((i) => i < seats.length && !at(i))
		const out = seats
			.map((_, i) => i)
			.filter((i) => dim(i) >= 1)
			.sort((a, b) => lit[a] - lit[b] || a - b)
			.slice(0, Math.max(0, line().length - free.length))
		for (const i of out) {
			const p = at(i)
			if (p.id === transport.id) getUp()
			else if (p.fake) Object.assign(p, { seat: 'out', back: t + rand(4000, 3 * loopMs()) })
		}
		// the line takes the free seats in order; you sit yourself, and the crowd sits here
		const q = line()
		// got up, and now there's a seat nobody's waiting for: back you go
		if (!q.length && free.length && people().find((p) => p.id === transport.id)?.seat === 'out')
			rejoin()
		q.slice(0, free.length).forEach((p, k) => {
			if (p.id === transport.id) sit(free[k])
			else if (p.fake)
				Object.assign(p, { seat: seats[free[k]].id, busy: true, next: t + rand(4000, 12000) })
		})
	}

	// the crowd: seated ones draw in bursts and rest in between, sometimes long enough to burn out
	function play(t) {
		for (const f of fakes) {
			const i = seatOf(f)
			if (i >= 0) {
				if (t > f.next) {
					f.busy = !f.busy
					f.next = t + (f.busy ? rand(3000, 12000) : rand(0.2, 1.3) * LOOPS * loopMs())
				}
				if (f.busy) {
					touch(i)
					const u = t / 1000 + f.phase
					draw(i, f, (u * 0.15) % 1, 0.5 + 0.3 * Math.sin(u * 2.3) * Math.cos(u * 0.7))
				}
			} else if (f.seat === 'out' && crowd > 3 && t > f.back) f.seat = 'wait:' + t
		}
	}

	function setCrowd(n) {
		crowd = n = Math.max(0, Math.min(12, Math.round(n)))
		const t = now()
		while (fakes.length > n) fakes.pop()
		while (fakes.length < n) {
			const k = fakes.length
			fakes.push({
				id: 'crowd' + k,
				name: NAMES[k],
				fake: true,
				joinedAt: t + k,
				seat: 'out',
				back: t + 400 + k * 300,
				phase: Math.random() * 100,
			})
		}
		// three or fewer just listen
		if (n <= 3) for (const f of fakes) f.seat = 'out'
		tick()
	}

	// the dots: everyone, seated or not, so the view can slide one into its badge and out again
	function audience() {
		const all = people()
		if (all.length < 2) return []
		const q = line()
		// the line queues by the seat idle longest, first in line nearest it
		const idlest = seats
			.map((_, i) => i)
			.filter((i) => at(i))
			.sort((a, b) => lit[a] - lit[b] || a - b)[0]
		return all.map((p) => {
			const k = q.indexOf(p)
			return {
				id: p.id,
				name: p.id === transport.id ? 'you' : p.name || 'someone',
				color: hue(p.id),
				seat: seatOf(p),
				near: k >= 0 && idlest !== undefined ? idlest : -1,
				place: k,
				me: p.id === transport.id,
			}
		})
	}

	setInterval(tick, 100)
	return {
		at,
		dim,
		touch,
		line,
		audience,
		setCrowd,
		get crowd() {
			return crowd
		},
		start() {
			ready = true
			tick()
		},
		tick,
	}
}
