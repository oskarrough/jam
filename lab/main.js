import GUI from '../src/vendor/lil-gui.esm.min.js'
import { createEngine, createClock, SCALES, ROOTS } from './engine.js'
import { instruments } from '../src/instruments/lab/index.js'
import { THEME } from '../src/instruments/lab/util.js'

const $ = (s) => document.querySelector(s)
const STORE = 'roughjam.lab.v1'
const LOOKAHEAD = 0.12
const TICK_MS = 25

let engine, clock, lanes, focus = 0
const ui = {
  playing: false,
  bpm: 92,
  steps: 16,
  root: 'A',
  scale: 'minor pent',
  backing: true,
  master: 0.8,
  solo: true,
  instrument: instruments[0].name,
  level: 1,
  reverb: 0.25,
  mute: false,
}

// ---------------------------------------------------------------------------
// boot

$('#start').addEventListener('click', boot, { once: true })

function boot() {
  $('#start').remove()
  engine = createEngine()
  clock = createClock(engine.audio, { bpm: ui.bpm, steps: ui.steps })
  const saved = load()
  if (saved?.ui) Object.assign(ui, saved.ui, { playing: false })
  clock.bpm = ui.bpm
  clock.steps = ui.steps
  engine.key.root = ui.root
  engine.key.scale = ui.scale
  engine.master.gain.value = ui.master

  lanes = instruments.map((mod, idx) => {
    const params = Object.fromEntries(Object.entries(mod.params).map(([k, d]) => [k, d.value]))
    const s = saved?.lanes?.[mod.id]
    if (s?.params) for (const k in s.params) if (k in params) params[k] = s.params[k]
    const { out, send } = engine.lane()
    const inst = mod.create({ audio: engine.audio, out, clock, params, theme: THEME })
    if (s?.state) try { inst.setState(s.state) } catch (e) { console.warn('bad saved state', mod.id, e) }
    else inst.randomize?.()
    return { mod, inst, params, out, send, level: s?.level ?? 1, reverb: s?.reverb ?? 0.25, mute: false, heard: idx === 0 }
  })
  focus = clampIdx(saved?.focus ?? 0)
  lanes[focus].heard = true

  buildStrip()
  buildGui()
  select(focus)
  setInterval(tick, TICK_MS)
  setInterval(save, 2000)
  bindPointer()
  bindKeys()
  requestAnimationFrame(frame)
  play(true)
}

const clampIdx = (i) => Math.max(0, Math.min(instruments.length - 1, i | 0))

// ---------------------------------------------------------------------------
// transport + scheduler

let nextStep = 0
let nextTime = 0

function play(on) {
  ui.playing = on
  if (on) {
    engine.audio.resume()
    clock.startTime = engine.audio.currentTime + 0.06
    clock.playing = true
    nextStep = 0
    nextTime = clock.startTime
  } else {
    clock.frozen = clock.abs()
    clock.playing = false
  }
  gui?.controllersRecursive().forEach((c) => c.updateDisplay())
  updateGains()
}

function tick() {
  if (!clock.playing) return
  const ac = engine.audio
  // if the tab slept, skip ahead instead of firing a burst of old steps
  if (nextTime < ac.currentTime - 0.2) {
    nextStep = Math.ceil(clock.abs())
    nextTime = clock.startTime + nextStep * clock.stepDur
  }
  while (nextTime < ac.currentTime + LOOKAHEAD) {
    const i = ((nextStep % clock.steps) + clock.steps) % clock.steps
    lanes.forEach((l, idx) => {
      if (!audible(idx)) return
      try { l.inst.step(i, nextTime, clock.stepDur) } catch (e) { console.error(l.mod.id, e) }
    })
    if (ui.backing) backing(i, nextTime)
    nextStep++
    nextTime = clock.startTime + nextStep * clock.stepDur
  }
}

function backing(i, time) {
  const v = engine.voices
  const q = clock.steps / 4
  if (i % (q * 2) === 0) v.kick(engine.master, { time, gain: 0.35 })
  if (i % q === q / 2) v.hat(engine.master, { time, gain: 0.05 })
}

const audible = (idx) => !lanes[idx].mute && (ui.solo ? idx === focus : lanes[idx].heard)

function updateGains() {
  const t = engine.audio.currentTime
  lanes.forEach((l, idx) => {
    l.out.gain.setTargetAtTime(audible(idx) ? l.level : 0, t, 0.04)
    l.send.gain.setTargetAtTime(l.reverb, t, 0.04)
  })
  document.querySelectorAll('.lane').forEach((el, idx) => el.classList.toggle('on', audible(idx)))
}

// ---------------------------------------------------------------------------
// focus + strip

function select(idx) {
  focus = clampIdx(idx)
  const l = lanes[focus]
  l.heard = true
  ui.instrument = l.mod.name
  ui.level = l.level
  ui.reverb = l.reverb
  ui.mute = l.mute
  $('#how').textContent = l.mod.how
  $('#title').textContent = `${String(focus + 1).padStart(2, '0')} ${l.mod.name.toLowerCase()}`
  document.querySelectorAll('.lane').forEach((el, i) => el.classList.toggle('focus', i === focus))
  buildParams()
  gui.controllersRecursive().forEach((c) => c.updateDisplay())
  updateGains()
}

function buildStrip() {
  const strip = $('#strip')
  lanes.forEach((l, idx) => {
    const el = document.createElement('button')
    el.className = 'lane'
    el.innerHTML = `<canvas></canvas><span><b>${String(idx + 1).padStart(2, '0')}</b> ${l.mod.name.toLowerCase()}</span>`
    el.addEventListener('click', () => select(idx))
    strip.append(el)
    l.thumb = el.querySelector('canvas')
  })
}

// ---------------------------------------------------------------------------
// debug gui

let gui, paramFolder

function buildGui() {
  gui = new GUI({ container: $('#gui'), title: 'debug' })
  const tr = gui.addFolder('transport')
  tr.add(ui, 'playing').name('play (space)').onChange(play)
  tr.add(ui, 'bpm', 50, 180, 1).onChange((v) => clock.setBpm(v))
  tr.add(ui, 'steps', [16, 32]).onChange((v) => {
    clock.steps = +v
    if (clock.playing) play(true)
  })
  tr.add(ui, 'root', Object.keys(ROOTS)).onChange((v) => (engine.key.root = v))
  tr.add(ui, 'scale', Object.keys(SCALES)).onChange((v) => (engine.key.scale = v))
  tr.add(ui, 'backing').name('backing beat')
  tr.add(ui, 'master', 0, 1, 0.01).onChange((v) => engine.master.gain.setTargetAtTime(v, engine.audio.currentTime, 0.03))
  tr.add(ui, 'solo').name('solo focused').onChange(updateGains)

  const ln = gui.addFolder('lane')
  ln.add(ui, 'instrument', instruments.map((m) => m.name)).onChange((name) => select(instruments.findIndex((m) => m.name === name)))
  ln.add(ui, 'level', 0, 2, 0.01).onChange((v) => { lanes[focus].level = v; updateGains() })
  ln.add(ui, 'reverb', 0, 1, 0.01).onChange((v) => { lanes[focus].reverb = v; updateGains() })
  ln.add(ui, 'mute').onChange((v) => { lanes[focus].mute = v; updateGains() })
  const actions = {
    clear: () => lanes[focus].inst.clear?.(),
    randomize: () => lanes[focus].inst.randomize?.(),
    'copy state': () => navigator.clipboard?.writeText(JSON.stringify(serialize(focus))),
    'reset params': () => {
      const l = lanes[focus]
      for (const [k, d] of Object.entries(l.mod.params)) l.params[k] = d.value
      paramFolder.controllers.forEach((c) => c.updateDisplay())
    },
  }
  Object.keys(actions).forEach((k) => ln.add(actions, k))
  paramFolder = gui.addFolder('params')
}

function buildParams() {
  paramFolder.controllers.slice().forEach((c) => c.destroy())
  const l = lanes[focus]
  for (const [k, d] of Object.entries(l.mod.params)) {
    if (d.options) paramFolder.add(l.params, k, d.options)
    else if (typeof d.value === 'boolean') paramFolder.add(l.params, k)
    else paramFolder.add(l.params, k, d.min, d.max, d.step)
  }
}

// ---------------------------------------------------------------------------
// state

const serialize = (idx) => {
  const l = lanes[idx]
  return { id: l.mod.id, params: l.params, state: l.inst.state }
}

function save() {
  try {
    const data = { ui: { ...ui }, focus, lanes: {} }
    lanes.forEach((l) => (data.lanes[l.mod.id] = { params: l.params, state: l.inst.state, level: l.level, reverb: l.reverb }))
    localStorage.setItem(STORE, JSON.stringify(data))
  } catch {}
}
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) } catch { return null }
}

let lastStateDump = 0
function dumpState(now) {
  if (now - lastStateDump < 250) return
  lastStateDump = now
  const json = JSON.stringify(lanes[focus].inst.state)
  $('#bytes').textContent = `${json.length} B`
  if ($('#state').open) $('#state pre').textContent = JSON.stringify(serialize(focus), (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v), 1)
}

// ---------------------------------------------------------------------------
// drawing

const stage = $('#stage')

function fit(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = c.clientWidth, h = c.clientHeight
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  return [g, w, h]
}

function frame(now) {
  requestAnimationFrame(frame)
  const [g, w, h] = fit(stage)
  try { lanes[focus].inst.frame(g, w, h, clock) } catch (e) { console.error(e) }
  lanes.forEach((l) => {
    const [tg, tw, th] = fit(l.thumb)
    try { l.inst.frame(tg, tw, th, clock) } catch {}
  })
  const a = clock.abs()
  const bar = Math.floor(a / clock.steps) + 1
  const beat = Math.floor((((a % clock.steps) + clock.steps) % clock.steps) / 4) + 1
  $('#pos').textContent = `${ui.bpm} bpm  ${engine.key.root} ${engine.key.scale}  ${clock.playing ? `${bar}.${beat}` : 'stopped'}`
  dumpState(now)
}

// ---------------------------------------------------------------------------
// input

function bindPointer() {
  const send = (type, ev) => {
    const r = stage.getBoundingClientRect()
    const px = ev.clientX - r.left, py = ev.clientY - r.top
    lanes[focus].inst.pointer({
      type, id: ev.pointerId, x: px / r.width, y: py / r.height, px, py, w: r.width, h: r.height,
      pressed: ev.buttons > 0 || type === 'down', alt: ev.shiftKey || ev.altKey, pressure: ev.pressure,
    })
  }
  stage.addEventListener('pointerdown', (ev) => { stage.setPointerCapture(ev.pointerId); engine.audio.resume(); send('down', ev) })
  stage.addEventListener('pointermove', (ev) => send('move', ev))
  stage.addEventListener('pointerup', (ev) => send('up', ev))
  stage.addEventListener('pointercancel', (ev) => send('up', ev))
  stage.addEventListener('contextmenu', (ev) => ev.preventDefault())
}

function bindKeys() {
  window.addEventListener('keydown', (ev) => {
    if (ev.target.closest?.('input, select, textarea')) return
    if (ev.code === 'Space') { ev.preventDefault(); play(!ui.playing) }
    const n = '1234567890'.indexOf(ev.key)
    if (n >= 0) select(n)
    if (ev.key === 'ArrowRight') select((focus + 1) % lanes.length)
    if (ev.key === 'ArrowLeft') select((focus - 1 + lanes.length) % lanes.length)
  })
}

// expose for poking from the console
window.lab = { get lanes() { return lanes }, get clock() { return clock }, get engine() { return engine }, select, play, serialize }
