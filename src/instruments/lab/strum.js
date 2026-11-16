// 07 Strum: six strings standing upright. Swipe across them to strum.
// Strums are recorded where they happened in the loop (time runs top to bottom)
// and replay on whatever chord the loop is on, so a rhythm turns into a progression.
import { kit, mtof } from './kit.js'
import { withPointer, view, absNow, absOf, theme, subSlots, SLOTS, clamp } from './util.js'

const STRINGS = 6
const MAX_HITS = 96

function gen() {
  const hits = []
  ;[0, 6, 12, 20, 24, 28, 36, 44, 48, 54, 60].forEach((s) => {
    if (Math.random() < 0.3) return
    const down = Math.random() < 0.6
    for (let k = 0; k < STRINGS; k++) hits.push([s, down ? k : STRINGS - 1 - k, +(0.5 + Math.random() * 0.4).toFixed(2)])
  })
  return { hits }
}

export default {
  id: 'strum',
  name: 'Strum',
  how: 'Swipe sideways across the strings. Fast swipes are loud. Strums record into the loop.',
  params: {
    record: { value: true },
    damp: { value: 0.995, min: 0.98, max: 0.9995, step: 0.0005 },
    bright: { value: 0.55, min: 0, max: 1, step: 0.01 },
    octave: { value: 0, min: -1, max: 1, step: 1 },
    level: { value: 0.5, min: 0, max: 1, step: 0.01 },
  },
  generate: (steps, params) => gen(steps, params),
  sample: (steps) => gen(steps),
  create(ctx) {
    const { audio, out, params, clock } = ctx
    const engine = kit(audio)
    const th = theme(ctx)
    const size = [1, 1] // lane size from the last frame, for pointer maths
    const state = { hits: [] } // [slot, string, velocity]
    const ring = Array.from({ length: STRINGS }, () => ({ t: -1, v: 0 }))
    let lastX = null, lastT = 0
    let chordName = ''

    const xOf = (j) => (j + 0.5) / STRINGS
    function notes(abs) {
      const c = engine.chord(abs, clock.steps)
      chordName = c.name
      const [r, third, fifth] = c.notes.map((n) => n + 12 * params.octave)
      return [r - 12, fifth - 12, r, third, fifth, r + 12]
    }
    function pluck(j, vel, time, abs) {
      engine.voices.pluck(out, {
        freq: mtof(notes(abs)[j]), time, gain: params.level * vel,
        damp: params.damp, bright: params.bright, pan: (j - 2.5) * 0.12,
      })
      ring[j] = { t: time, v: vel }
    }
    function liveHit(j, vel) {
      const now = audio.currentTime
      pluck(j, vel, now, Math.floor(absNow(clock)))
      if (params.record && (clock.playing ?? true)) {
        const s = Math.floor((clock.pos() / clock.steps) * SLOTS) % SLOTS
        state.hits.push([s, j, +vel.toFixed(2)])
        if (state.hits.length > MAX_HITS) state.hits.shift()
      }
    }

    return {
      state,
      pointer: withPointer(size, (e) => {
        const now = performance.now()
        if (e.type === 'down') {
          // tapping right on a string plucks it
          const j = clamp(Math.round(e.x * STRINGS - 0.5), 0, STRINGS - 1)
          if (Math.abs(e.x - xOf(j)) < 0.04) liveHit(j, 0.6)
          lastX = e.x; lastT = now
        } else if (e.type === 'move' && e.pressed && lastX !== null) {
          const a = Math.min(lastX, e.x), b = Math.max(lastX, e.x)
          const speed = Math.abs(e.x - lastX) / Math.max(1, now - lastT) // screen-widths per ms
          const vel = clamp(0.25 + speed * 120, 0.25, 1)
          const dir = e.x > lastX ? 1 : -1
          const crossed = []
          for (let j = 0; j < STRINGS; j++) if (xOf(j) > a && xOf(j) <= b) crossed.push(j)
          if (dir < 0) crossed.reverse()
          crossed.forEach((j) => liveHit(j, vel))
          lastX = e.x; lastT = now
        } else if (e.type === 'up') lastX = null
      }),
      step(i, time, dur) {
        const abs = absOf(clock, time)
        subSlots(i, time, dur, clock.steps, (s, t) => {
          // hits sharing a slot keep their order, spread like a real strum
          let k = 0
          for (const [hs, j, v] of state.hits) if (hs === s) pluck(j, v, t + 0.011 * k++, abs)
        })
      },
      frame(g, w, h, clock) {
        size[0] = w; size[1] = h
        const t = view(clock)
        notes(Math.floor(t.abs))
        // recorded strums: time runs down each string
        state.hits.forEach(([s, j, v]) => {
          g.fillStyle = th.dim
          g.fillRect(xOf(j) * w - 6 * v - 2, (s / SLOTS) * h, 12 * v + 4, 2)
        })
        for (let j = 0; j < STRINGS; j++) {
          const x = xOf(j) * w
          const age = t.now - ring[j].t
          const amp = ring[j].t >= 0 && age >= 0 ? ring[j].v * Math.exp(-age * 3.5) * w * 0.012 : 0
          g.strokeStyle = amp > w * 0.003 ? th.accent : th.fg
          g.lineWidth = 1 + (STRINGS - j) * 0.35
          g.beginPath()
          for (let y = 0; y <= h; y += 6) {
            const dx = amp * Math.sin((y / h) * Math.PI) * Math.sin(t.now * 90 + j)
            y ? g.lineTo(x + dx, y) : g.moveTo(x + dx, y)
          }
          g.stroke()
        }
        g.lineWidth = 1
        if (t.playing) {
          const y = t.phase * h
          g.strokeStyle = th.faint
          g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke()
        }
        g.fillStyle = th.dim
        g.font = `${Math.max(10, h / 30)}px ${th.font}`
        g.fillText(chordName, 8, h - 8)
      },
      setState(s) { state.hits = s.hits.map((x) => x.slice()) },
      clear() { state.hits = [] },
      randomize() { this.setState(gen(clock.steps, params)) },
    }
  },
}
