// Live debug panel (lil-gui). Press d to toggle. Everything here is for poking at the jam while it runs.

import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/dist/lil-gui.esm.min.js'

export function createDebug({ engine, transport, view, frengers, me, sit, registry, renderSeats, heart }) {
	const { clock } = transport
	const gui = new GUI({ title: 'debug  (d)', width: 280 })
	if (innerWidth < 640) gui.close()

	// ── me
	const meF = gui.addFolder('me')
	const meState = {
		get name() { return me.name },
		set name(v) { me.name = v; transport.setMe({ name: v }); renderSeats() },
		get seat() { return me.lane < 0 ? '—' : engine.lanes[me.lane].id },
		set seat(v) { const i = engine.lanes.findIndex((L) => L.id === v); if (i >= 0) sit(i) },
	}
	meF.add(meState, 'name')
	meF.add(meState, 'seat', engine.lanes.map((L) => L.id)).listen()

	// ── loop (changes land on the next loop boundary, for everyone)
	const loopF = gui.addFolder('loop')
	const cur = () => clock.loopAt()
	const loopEdit = { bpm: cur().bpm, bars: cur().bars, beatsPerBar: cur().beatsPerBar }
	const commit = () => transport.setLoop({ ...loopEdit })
	loopF.add(loopEdit, 'bpm', 50, 180, 1).onFinishChange(commit)
	loopF.add(loopEdit, 'bars', [1, 2, 4]).onChange(commit)
	loopF.add(loopEdit, 'beatsPerBar', [3, 4, 5, 7]).onChange(commit)
	transport.on('loop', ({ loop }) => { Object.assign(loopEdit, { bpm: loop.bpm, bars: loop.bars, beatsPerBar: loop.beatsPerBar }); loopF.controllersRecursive().forEach((c) => c.updateDisplay()) })

	// ── lanes: instrument per lane, mix, and the instrument's own params
	const lanesF = gui.addFolder('lanes')
	const ids = [...registry.keys()]
	engine.lanes.forEach((L) => {
		const f = lanesF.addFolder(`${L.id}`).close()
		const sel = { get instrument() { return L.module.id }, set instrument(v) { engine.setInstrument(L, v, { state: registry.get(v).sample?.(engine.steps()) }); engine.push(L); buildParams() } }
		f.add(sel, 'instrument', ids).listen()
		f.add(L.mix, 'level', 0, 1.5, 0.01).onChange(() => engine.applyMix(L))
		f.add(L.mix, 'space', 0, 1, 0.01).onChange(() => engine.applyMix(L))
		f.add(L.mix, 'mute').onChange(() => engine.applyMix(L))
		f.add({ clear: () => { L.instance.clear ? L.instance.clear() : L.instance.setState(null); engine.push(L) } }, 'clear')
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
		engine.on('lanes', () => { if (pf && pf._title !== `${L.module.name} params`) buildParams() })
	})

	// ── network
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

	// ── clock + scheduler
	const clkF = gui.addFolder('clock')
	const cd = { shared: '', 'bar.beat': '', phase: '', audio: '', 'audio state': '', 'out latency': '', scheduled: 0, 'late steps': 0 }
	Object.keys(cd).forEach((k) => clkF.add(cd, k).disable().listen())
	clkF.add(engine.cfg, 'lookaheadMs', 20, 500, 5).name('lookahead ms')
	clkF.add({ tick: engine.cfg.tickMs }, 'tick', 5, 100, 1).name('tick ms').onChange((v) => engine.setTick(v))

	// ── view + frengers
	const viewF = gui.addFolder('view')
	viewF.add(view.opts, 'mode', ['dial', 'strips']).onChange((m) => view.setMode(m))
	viewF.add(view.opts, 'ground', ['flamingo', 'nortel', 'vallotton', 'sand', 'cycle']).onChange((g) => view.setGround(g))
	viewF.add(view.opts, 'cycleLoops', 1, 16, 1).name('cycle every n loops')
	viewF.add(view.opts, 'slices', 32, 512, 1).name('ring slices')
	heart?.addGui(gui)
	const botF = gui.addFolder('frengers')
	botF.add(frengers.opts, 'on').onChange(() => { document.getElementById('bots')?.setAttribute('aria-pressed', frengers.opts.on); renderSeats() }).listen()
	botF.add(frengers.opts, 'minLoops', 1, 16, 1).name('min loops between')
	botF.add(frengers.opts, 'maxLoops', 1, 32, 1).name('max loops between')
	const bd = { get leading() { return frengers.leading }, get active() { return frengers.count } }
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

	return { gui, toggle: () => gui.show(gui._hidden) }
}
