// The machine's panel (lil-gui). d opens or folds it. Knobs change the jam live, for everyone.

import GUI from './vendor/lil-gui.esm.min.js'
import { ROOTS, SCALES, CHORDS, NUMERALS, parseChords } from './instruments/lib/kit.js'

export function createDebug({ engine, transport, view, bots, me, sit, registry, renderSeats, heart }) {
	const { clock } = transport
	const gui = new GUI({ title: 'controls  (d)', width: 280 })
	gui.close()

	const meF = gui.addFolder('me')
	const meState = {
		get name() { return me.name },
		set name(v) { me.name = v; transport.setMe({ name: v }); renderSeats() },
		get seat() { return me.seat < 0 ? '—' : engine.seats[me.seat].id },
		set seat(v) { const i = engine.seats.findIndex((L) => L.id === v); if (i >= 0) sit(i) },
	}
	meF.add(meState, 'name')
	meF.add(meState, 'seat', engine.seats.map((L) => L.id)).listen()

	const loopF = gui.addFolder('loop')
	const cur = () => clock.loopAt()
	// chords as numerals, one per bar: 'i III iv v'; the key decides each chord's quality
	const numerals = (a) => (a?.length ? a : CHORDS).map((d) => NUMERALS[d]).join(' ')
	const fromLoop = (l) => ({ bpm: l.bpm, bars: l.bars, beatsPerBar: l.beatsPerBar, root: l.root ?? 'A', scale: l.scale ?? 'minor pent', chords: numerals(l.chords) })
	const loopEdit = fromLoop(cur())
	const commit = () => {
		const chords = parseChords(loopEdit.chords)
		const rest = { ...loopEdit }
		delete rest.chords
		transport.setLoop({ ...rest, ...(chords.length ? { chords } : {}) })
	}
	loopF.add(loopEdit, 'bpm', 50, 180, 1).onFinishChange(commit)
	loopF.add(loopEdit, 'bars', [1, 2, 4]).onChange(commit)
	loopF.add(loopEdit, 'beatsPerBar', [3, 4, 5, 7]).onChange(commit)
	loopF.add(loopEdit, 'root', Object.keys(ROOTS)).name('key').onChange(commit)
	loopF.add(loopEdit, 'scale', Object.keys(SCALES)).onChange(commit)
	loopF.add(loopEdit, 'chords').name('chords, one a bar').onFinishChange(commit)
	transport.on('loop', ({ loop }) => { Object.assign(loopEdit, fromLoop(loop)); loopF.controllersRecursive().forEach((c) => c.updateDisplay()) })

	const seatsF = gui.addFolder('seats')
	const ids = [...registry.keys()]
	engine.seats.forEach((L) => {
		const f = seatsF.addFolder(`${L.id}`).close()
		const sel = { get instrument() { return L.module.id }, set instrument(v) { engine.setInstrument(L, v, { state: registry.get(v).sample?.(engine.steps()) }); engine.push(L); buildParams() } }
		f.add(sel, 'instrument', ids).listen()
		f.add(L.mix, 'level', 0, 1.5, 0.01).onChange(() => engine.applyMix(L))
		f.add(L.mix, 'space', 0, 1, 0.01).onChange(() => engine.applyMix(L))
		f.add(L.mix, 'mute').onChange(() => engine.applyMix(L))
		f.add({ clear: () => { L.instance.clear ? L.instance.clear() : L.instance.setState(null); engine.push(L) } }, 'clear').name('wipe')
		let pf = null
		function buildParams() {
			pf?.destroy()
			pf = f.addFolder(`${L.module.name} params`)
			for (const [k, d] of Object.entries(L.module.params || {})) {
				let c
				if (d && typeof d === 'object' && 'options' in d) c = pf.add(L.params, k, d.options)
				else if (d && typeof d === 'object' && 'min' in d) c = pf.add(L.params, k, d.min, d.max, d.step)
				else c = pf.add(L.params, k)
				c.onChange(() => engine.pushSoon(L)).listen()
			}
		}
		buildParams()
		engine.on('seats', () => { if (pf && pf._title !== `${L.module.name} params`) buildParams() })
	})

	const netF = gui.addFolder('network')
	const info = { get transport() { return transport.kind || 'ws' } }
	netF.add(info, 'transport').disable().listen()
	if (transport.fake) {
		netF.add(transport.fake, 'latency', 0, 600, 1).name('fake latency ms')
		netF.add(transport.fake, 'jitter', 0, 300, 1).name('fake jitter ms')
		netF.add(transport.clock, 'skew', -500, 500, 1).name('clock skew ms')
		netF.add(transport.fake, 'quantize', ['bar', 'off']).name('remote edits land')
	}
	const nd = {}
	const keys = ['connected', 'peers', 'rtt', 'jitter', 'offset', 'drift', 'pending', 'lateMs']
	keys.forEach((k) => { nd[k] = ''; netF.add(nd, k).disable().listen() })

	const clkF = gui.addFolder('clock')
	const cd = { shared: '', 'bar.beat': '', phase: '', audio: '', 'audio state': '', 'out latency': '', scheduled: 0, 'late steps': 0 }
	Object.keys(cd).forEach((k) => clkF.add(cd, k).disable().listen())
	clkF.add(engine.cfg, 'lookaheadMs', 20, 500, 5).name('lookahead ms')
	clkF.add({ tick: engine.cfg.tickMs }, 'tick', 5, 100, 1).name('tick ms').onChange((v) => engine.setTick(v))

	const viewF = gui.addFolder('view')
	viewF.add(view.opts, 'mode', ['dial', 'strips']).onChange((m) => view.setMode(m))
	viewF.add(view.opts, 'ground', ['flamingo', 'nortel', 'vallotton', 'sand', 'cycle']).onChange((g) => view.setGround(g))
	viewF.add(view.opts, 'cycleLoops', 1, 16, 1).name('cycle every n loops')
	viewF.add(view.opts, 'slices', 32, 512, 1).name('ring slices')
	heart?.addGui(gui)

	const zF = gui.addFolder('zoom').close()
	const Z = view.zoom, zc = () => view.zoomChanged()
	zF.add(Z, 'inMs', 100, 2000, 10).name('in ms').onChange(zc)
	zF.add(Z, 'outMs', 100, 2000, 10).name('out ms').onChange(zc)
	zF.add(Z, 'machineEnd', 0.1, 1, 0.01).name('machine done at').onChange(zc)
	zF.add(Z, 'outMachineEnd', 0.1, 1, 0.01).name('out: machine spans').onChange(zc)
	zF.add(Z, 'sheetStart', 0, 0.9, 0.01).name('sheet starts at').onChange(zc)
	zF.add(Z, 'machineEase', view.easeNames).name('machine ease').onChange(zc)
	zF.add(Z, 'machineBezier').name('machine bezier').onFinishChange(zc)
	zF.add(Z, 'sheetEase', view.easeNames).name('sheet ease').onChange(zc)
	zF.add(Z, 'sheetBezier').name('sheet bezier').onFinishChange(zc)
	zF.add(Z, 'slide', 0, 1.5, 0.01).name('slide distance ×').onChange(zc)
	zF.add(Z, 'slidePad', 0, 200, 1).name('slide extra px').onChange(zc)
	zF.add(Z, 'barLag', 0, 0.8, 0.01).name('strip lag').onChange(zc)
	zF.add(Z, 'scale', 0.5, 1.6, 0.01).name('machine end scale').onChange(zc)
	zF.add(Z, 'dx', -300, 300, 1).name('machine end x').onChange(zc)
	zF.add(Z, 'dy', -300, 300, 1).name('machine end y').onChange(zc)
	let playing = 0
	zF.add({ play() {
		clearTimeout(playing)
		if (me.seat < 0) return
		view.setFocus(me.seat)
		playing = setTimeout(() => view.setFocus(-1), Z.inMs + 900)
	} }, 'play').name('play in → out')
	zF.add({ toggle() { view.setFocus(view.focus.on ? -1 : me.seat) } }, 'toggle').name('in / out')
	const copyCtl = zF.add({ async copy() {
		const json = JSON.stringify(Z)
		try { await navigator.clipboard.writeText(json); copyCtl.name('copied ✓') } catch { console.log(json); copyCtl.name('in the console') }
		setTimeout(() => copyCtl.name('copy values'), 1500)
	} }, 'copy').name('copy values')
	zF.add({ reset() { Object.assign(Z, view.zoomDefaults); zc(); zF.controllersRecursive().forEach((c) => c.updateDisplay()) } }, 'reset').name('reset')
	const iF = gui.addFolder('intro').close()
	const I = view.intro, ic = () => view.introChanged()
	const beats = { capMs: 'hold for fonts, at most', land: 'land fades up at', landMs: '… over', dial: 'dial lands at', dialMs: '… over', rings: 'first ring at', ringMs: '… each over', ringGap: '… then every', seatMs: 'each player pops over', menu: 'deck at', menuGap: '… a token every', hand: 'hand at', handMs: '… over' }
	for (const [k, label] of Object.entries(beats)) iF.add(I, k, 0, k === 'capMs' ? 1500 : 1200, 5).name(label).onChange(ic)
	iF.add({ play: () => view.replayIntro() }, 'play').name('play')
	iF.add({ reset() { Object.assign(I, view.introDefaults); ic(); iF.controllersRecursive().forEach((c) => c.updateDisplay()) } }, 'reset').name('reset')
	const botF = gui.addFolder('robots')
	botF.add(bots.opts, 'on').onChange(() => { document.getElementById('bots')?.setAttribute('aria-pressed', bots.opts.on); renderSeats() }).listen()
	botF.add(bots.opts, 'minLoops', 1, 16, 1).name('min loops between')
	botF.add(bots.opts, 'maxLoops', 1, 32, 1).name('max loops between')
	const bd = { get leading() { return bots.leading }, get active() { return bots.count } }
	botF.add(bd, 'leading').disable().listen()
	botF.add(bd, 'active').disable().listen()

	const fmt = (v, d = 1) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v))
	setInterval(() => {
		const d = transport.debug()
		keys.forEach((k) => (nd[k] = fmt(d[k])))
		const p = clock.pos()
		cd.shared = (clock.now() / 1000).toFixed(3)
		cd['bar.beat'] = p ? `${p.bar + 1}.${p.beat + 1}` : '—'
		cd.phase = p ? p.loopPhase.toFixed(3) : '—'
		cd.audio = engine.audio.currentTime.toFixed(3)
		cd['audio state'] = engine.audio.state
		cd['out latency'] = `${((engine.audio.outputLatency || 0) * 1000).toFixed(0)} + ${((engine.audio.baseLatency || 0) * 1000).toFixed(0)} ms`
		cd.scheduled = engine.stats.scheduled
		cd['late steps'] = engine.stats.late
	}, 100)

	return { gui, toggle: () => (gui._closed ? gui.open() : gui.close()) }
}
