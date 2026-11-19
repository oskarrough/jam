// The machine's panel (lil-gui). The corner chip or d opens it. Knobs change the jam live, for everyone.

import GUI from './vendor/lil-gui.esm.min.js'
import { ROOTS, SCALES, CHORDS, NUMERALS, parseChords } from './instruments/lib/kit.js'

export function createDebug(options) {
	const dock = document.createElement('div')
	dock.className = 'debug-dock'
	const chip = document.createElement('button')
	chip.type = 'button'
	chip.className = 'chip debug-chip'
	chip.title = 'Controls (d)'
	chip.setAttribute('aria-label', 'Debug controls')
	chip.setAttribute('aria-controls', 'debug-panel')
	chip.setAttribute('aria-expanded', 'false')
	chip.innerHTML =
		'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h5m3 0h4M2 8h2m3 0h7M2 12h8m3 0h1M7 2v4M4 6v4m6 0v4"/></svg>'
	dock.append(chip)
	const gui = new GUI({ container: dock, width: 280 }).hide()
	gui.domElement.id = 'debug-panel'
	gui.domElement.setAttribute('role', 'region')
	gui.domElement.setAttribute('aria-label', 'Debug controls')
	document.body.append(dock)

	let open = false,
		refresh,
		timer
	function toggle() {
		open = !open
		chip.setAttribute('aria-expanded', open)
		if (!open) {
			clearInterval(timer)
			if (gui.domElement.contains(document.activeElement)) chip.focus()
			gui.hide()
			return
		}
		gui.show()
		refresh ??= buildPanel(gui, options)
		refresh()
		timer = setInterval(refresh, 100)
	}
	chip.addEventListener('click', toggle)
	// Capture before lil-gui swallows key events, but leave typing alone.
	addEventListener(
		'keydown',
		(e) => {
			if (e.key !== 'd' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
			if (e.target.closest?.('input, select, textarea, [contenteditable]')) return
			toggle()
		},
		true,
	)
}

function buildPanel(gui, { engine, transport, view, bots, me, sit, presence, registry, heart }) {
	const { clock } = transport

	const meF = gui.addFolder('me')
	const meState = {
		get name() {
			return me.name
		},
		set name(v) {
			me.name = v
			transport.setMe({ name: v })
		},
		get seat() {
			return me.seat < 0 ? '—' : engine.seats[me.seat].id
		},
		set seat(v) {
			const i = engine.seats.findIndex((L) => L.id === v)
			if (i >= 0) sit(i)
		},
	}
	meF.add(meState, 'name')
	meF.add(
		meState,
		'seat',
		engine.seats.map((L) => L.id),
	)
	// fake listeners, here only: above three they take seats, draw, go idle and hand off
	if (presence) {
		const crowd = { n: presence.crowd }
		meF
			.add(crowd, 'n', 0, 12, 1)
			.name('crowd')
			.onChange((v) => presence.setCrowd(v))
	}

	const loopF = gui.addFolder('loop')
	const cur = () => clock.loopAt()
	// chords as numerals, one per bar: 'i III iv v'; the key decides each chord's quality
	const numerals = (a) => (a?.length ? a : CHORDS).map((d) => NUMERALS[d]).join(' ')
	const fromLoop = (l) => ({
		bpm: l.bpm,
		bars: l.bars,
		beatsPerBar: l.beatsPerBar,
		root: l.root ?? 'A',
		scale: l.scale ?? 'minor pent',
		chords: numerals(l.chords),
	})
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
	transport.on('loop', ({ loop }) => {
		Object.assign(loopEdit, fromLoop(loop))
		loopF.controllersRecursive().forEach((c) => c.updateDisplay())
	})

	const seatsF = gui.addFolder('seats')
	const ids = [...registry.keys()]
	engine.seats.forEach((L) => {
		const f = seatsF.addFolder(`${L.id}`).close()
		const sel = {
			get instrument() {
				return L.module.id
			},
			set instrument(v) {
				engine.setInstrument(L, v, { state: registry.get(v).sample?.(engine.steps(L)) })
				engine.push(L)
			},
		}
		f.add(sel, 'instrument', ids)
		f.add(L.mix, 'level', 0, 1.5, 0.01)
			.listen()
			.onChange((v) => engine.setMix(L, { level: v }))
		f.add(L.mix, 'tone', 0, 1, 0.01)
			.listen()
			.onChange((v) => engine.setMix(L, { tone: v }))
		f.add(L.mix, 'space', 0, 1, 0.01)
			.listen()
			.onChange((v) => engine.setMix(L, { space: v }))
		f.add(L.mix, 'mute')
			.listen()
			.onChange((v) => engine.setMute(L, v))
		f.add(
			{
				clear: () => {
					L.instance.clear ? L.instance.clear() : L.instance.setState(null)
					engine.push(L)
				},
			},
			'clear',
		).name('wipe')
		let pf = null,
			boundParams
		function buildParams() {
			boundParams = L.params
			pf?.destroy()
			pf = f.addFolder(`${L.module.name} params`)
			for (const [k, d] of Object.entries(L.module.params || {})) {
				let c
				if (d && typeof d === 'object' && 'options' in d) c = pf.add(L.params, k, d.options)
				else if (d && typeof d === 'object' && 'min' in d)
					c = pf.add(L.params, k, d.min, d.max, d.step)
				else c = pf.add(L.params, k)
				c.onChange(() => engine.pushSoon(L))
			}
		}
		buildParams()
		engine.on('seats', () => {
			if (L.params !== boundParams) buildParams()
		})
	})

	const netF = gui.addFolder('network')
	const info = {
		get transport() {
			return transport.kind || 'ws'
		},
	}
	netF.add(info, 'transport').disable()
	if (transport.fake) {
		netF.add(transport.fake, 'latency', 0, 600, 1).name('fake latency ms')
		netF.add(transport.fake, 'jitter', 0, 300, 1).name('fake jitter ms')
		netF.add(transport.clock, 'skew', -500, 500, 1).name('clock skew ms')
		netF.add(transport.fake, 'quantize', ['bar', 'off']).name('remote edits land')
	}
	const nd = {}
	const keys = ['connected', 'peers', 'rtt', 'jitter', 'offset', 'drift', 'pending', 'lateMs']
	keys.forEach((k) => {
		nd[k] = ''
		netF.add(nd, k).disable()
	})

	const clkF = gui.addFolder('clock')
	const cd = {
		shared: '',
		'bar.beat': '',
		phase: '',
		audio: '',
		'audio state': '',
		'out latency': '',
		scheduled: 0,
		'late steps': 0,
	}
	Object.keys(cd).forEach((k) => clkF.add(cd, k).disable())
	clkF.add(engine.cfg, 'lookaheadMs', 20, 500, 5).name('lookahead ms')
	clkF
		.add({ tick: engine.cfg.tickMs }, 'tick', 5, 100, 1)
		.name('tick ms')
		.onChange((v) => engine.setTick(v))

	const viewF = gui.addFolder('view')
	viewF.add(view.opts, 'mode', ['dial', 'strips']).onChange((m) => view.setMode(m))
	viewF
		.add(view.opts, 'ground', ['flamingo', 'nortel', 'vallotton', 'sand', 'cycle'])
		.onChange((g) => view.setGround(g))
	viewF.add(view.opts, 'cycleLoops', 1, 16, 1).name('cycle every n loops')
	viewF.add(view.opts, 'slices', 32, 512, 1).name('ring slices')
	heart?.addGui(gui)

	const zF = gui.addFolder('zoom').close()
	const Z = view.zoom,
		zc = () => view.zoomChanged()
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
	zF.add(
		{
			play() {
				clearTimeout(playing)
				if (me.seat < 0) return
				view.setFocus(me.seat)
				playing = setTimeout(() => view.setFocus(-1), Z.inMs + 900)
			},
		},
		'play',
	).name('play in → out')
	zF.add(
		{
			toggle() {
				view.setFocus(view.focus.on ? -1 : me.seat)
			},
		},
		'toggle',
	).name('in / out')
	const copyCtl = zF
		.add(
			{
				async copy() {
					const json = JSON.stringify(Z)
					try {
						await navigator.clipboard.writeText(json)
						copyCtl.name('copied ✓')
					} catch {
						console.log(json)
						copyCtl.name('in the console')
					}
					setTimeout(() => copyCtl.name('copy values'), 1500)
				},
			},
			'copy',
		)
		.name('copy values')
	zF.add(
		{
			reset() {
				Object.assign(Z, view.zoomDefaults)
				zc()
				zF.controllersRecursive().forEach((c) => c.updateDisplay())
			},
		},
		'reset',
	).name('reset')
	const iF = gui.addFolder('intro').close()
	const I = view.intro,
		ic = () => view.introChanged()
	const beats = {
		capMs: 'hold for fonts, at most',
		land: 'land fades up at',
		landMs: '… over',
		dial: 'dial lands at',
		dialMs: '… over',
		rings: 'first ring at',
		ringMs: '… each over',
		ringGap: '… then every',
		seatMs: 'each player pops over',
		menu: 'deck at',
		menuGap: '… a token every',
		hand: 'hand at',
		handMs: '… over',
	}
	for (const [k, label] of Object.entries(beats))
		iF.add(I, k, 0, k === 'capMs' ? 1500 : 1200, 5)
			.name(label)
			.onChange(ic)
	iF.add({ play: () => view.replayIntro() }, 'play').name('play')
	iF.add(
		{
			reset() {
				Object.assign(I, view.introDefaults)
				ic()
				iF.controllersRecursive().forEach((c) => c.updateDisplay())
			},
		},
		'reset',
	).name('reset')
	const botF = gui.addFolder('robots')
	botF
		.add(bots.opts, 'on')
		.onChange(() => document.getElementById('bots')?.setAttribute('aria-pressed', bots.opts.on))
	botF.add(bots.opts, 'minLoops', 1, 16, 1).name('min loops between')
	botF.add(bots.opts, 'maxLoops', 1, 32, 1).name('max loops between')
	const bd = {
		get leading() {
			return bots.leading
		},
		get active() {
			return bots.count
		},
	}
	botF.add(bd, 'leading').disable()
	botF.add(bd, 'active').disable()

	const fmt = (v, d = 1) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v))
	function refreshOpen(folder) {
		for (const c of folder.controllers)
			if (!c.domElement.contains(document.activeElement)) c.updateDisplay()
		for (const child of folder.folders) if (!child._closed) refreshOpen(child)
	}
	return () => {
		const d = transport.debug()
		keys.forEach((k) => (nd[k] = fmt(d[k])))
		const p = clock.pos()
		cd.shared = (clock.now() / 1000).toFixed(3)
		cd['bar.beat'] = p ? `${p.bar + 1}.${p.beat + 1}` : '—'
		cd.phase = p ? p.loopPhase.toFixed(3) : '—'
		cd.audio = engine.audio.currentTime.toFixed(3)
		cd['audio state'] = engine.audio.state
		cd['out latency'] =
			`${((engine.audio.outputLatency || 0) * 1000).toFixed(0)} + ${((engine.audio.baseLatency || 0) * 1000).toFixed(0)} ms`
		cd.scheduled = engine.stats.scheduled
		cd['late steps'] = engine.stats.late
		refreshOpen(gui)
	}
}
