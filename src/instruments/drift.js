// 05 Drift: place up to five stones in a pond; each one is a sustained drone voice.
// x picks the pitch, y the colour (low = dark and still, high = bright and beating).
// Voices breathe with the loop, each one offset, so the chord slowly rotates.
import { kit } from './lib/kit.js'
import { withPointer, view, absOf, theme, clamp, dist, TAU, tint } from './lib/util.js'
import { tap, line } from './lib/demo.js'

const MAX = 5

function gen() {
  return { stones: Array.from({ length: 3 + Math.floor(Math.random() * 2) }, () => ({ x: +Math.random().toFixed(3), y: +(0.3 + Math.random() * 0.6).toFixed(3) })) }
}

export default {
  id: 'drift',
  glyph: '<circle class="f" cx="16" cy="16" r="2.6"/><circle cx="16" cy="16" r="7"/><circle cx="16" cy="16" r="12" stroke-dasharray="2 3"/>',
  name: 'Drift',
  playhead: false, // a pond, not a timeline
  how: 'Tap to drop a stone, drag it to bend, tap it again to lift it out.',
  demo: () => [tap(0.25, 0.6), tap(0.6, 0.35), line(0.6, 0.35, 0.72, 0.6, 10)],
  params: {
    range: { value: 10, min: 4, max: 16, step: 1 },
    octave: { value: -1, min: -2, max: 1, step: 1 },
    breathe: { value: 0.7, min: 0, max: 1, step: 0.01 },
    glide: { value: 0.25, min: 0.01, max: 2, step: 0.01 },
    level: { value: 0.09, min: 0, max: 0.25, step: 0.005 },
  },
  generate: (steps, params) => gen(steps, params),
  sample: (steps) => gen(steps),
  create(ctx) {
    const { audio, out, params, clock } = ctx
    const engine = kit(audio)
    const th = theme(ctx)
    const size = [1, 1] // seat size from the last frame, for pointer maths
    const state = { stones: [] }
    const voices = []
    let drag = null

    function voice() {
      const a = audio.createOscillator()
      const b = audio.createOscillator()
      a.type = 'sine'
      b.type = 'triangle'
      const f = audio.createBiquadFilter()
      f.type = 'lowpass'
      const g = audio.createGain()
      g.gain.value = 0
      const p = audio.createStereoPanner()
      a.connect(f); b.connect(f)
      f.connect(g).connect(p).connect(out)
      a.start(); b.start()
      return { a, b, f, g, p, amp: 0 }
    }
    const freqOf = (s) => 440 * Math.pow(2, (engine.degree(Math.round(s.x * params.range), params.octave) - 69) / 12)

    // keep voices in step with stones; called after any state change
    function sync(time = audio.currentTime) {
      while (voices.length < state.stones.length) voices.push(voice())
      while (voices.length > state.stones.length) {
        const v = voices.pop()
        v.g.gain.setTargetAtTime(0, time, 0.3)
        v.a.stop(time + 2); v.b.stop(time + 2)
      }
      state.stones.forEach((s, k) => {
        const v = voices[k]
        const f = freqOf(s)
        v.a.frequency.setTargetAtTime(f, time, params.glide / 3)
        v.b.frequency.setTargetAtTime(f * 2, time, params.glide / 3)
        v.b.detune.setTargetAtTime((1 - s.y) * 22, time, 0.2)
        v.f.frequency.setTargetAtTime(150 * Math.pow(2, (1 - s.y) * 5.5), time, 0.1)
        v.p.pan.setTargetAtTime((s.x - 0.5) * 1.2, time, 0.1)
      })
    }

    const near = (e) => {
      let best = -1, bd = Infinity
      state.stones.forEach((s, k) => {
        const d = dist(s.x * e.w, s.y * e.h, e.px, e.py)
        if (d < bd) { bd = d; best = k }
      })
      return bd < Math.min(e.w, e.h) * 0.07 ? best : -1
    }

    return {
      state,
      pointer: withPointer(size, (e) => {
        if (e.type === 'down') {
          let k = near(e)
          let fresh = false
          if (k < 0) {
            if (state.stones.length >= MAX) state.stones.shift()
            state.stones.push({ x: clamp(e.x, 0, 1), y: clamp(e.y, 0, 1) })
            k = state.stones.length - 1
            fresh = true
          }
          drag = { k, moved: 0, x0: e.px, y0: e.py, fresh }
          sync()
        } else if (e.type === 'move' && drag) {
          const s = state.stones[drag.k]
          s.x = clamp(e.x, 0, 1); s.y = clamp(e.y, 0, 1)
          drag.moved = Math.max(drag.moved, dist(drag.x0, drag.y0, e.px, e.py))
          sync()
        } else if (e.type === 'up' && drag) {
          if (!drag.fresh && drag.moved < 5) { state.stones.splice(drag.k, 1); sync() }
          drag = null
        }
      }),
      step(i, time) {
        const abs = absOf(clock, time)
        const n = Math.max(1, state.stones.length)
        state.stones.forEach((s, k) => {
          const v = voices[k]
          if (!v) return
          const ph = abs / clock.steps + k / n
          const amp = params.level * (1 - params.breathe * 0.5 * (1 + Math.cos(TAU * ph)))
          v.amp = amp / params.level
          v.g.gain.setTargetAtTime(amp, time, clock.stepDur)
        })
      },
      frame(g, w, h, clock) {
        size[0] = w; size[1] = h
        const t = view(clock)
        const m = Math.min(w, h)
        // pitch columns
        g.strokeStyle = th.faint
        for (let d = 0; d <= params.range; d++) {
          const x = Math.round((d / params.range) * (w - 1)) + 0.5
          g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke()
        }
        const n = Math.max(1, state.stones.length)
        state.stones.forEach((s, k) => {
          const x = s.x * w, y = s.y * h
          const ph = t.abs / t.steps + k / n
          const amp = 1 - params.breathe * 0.5 * (1 + Math.cos(TAU * ph))
          // ripples travel outward; spacing tightens as the stone brightens
          const gap = m * (0.03 + s.y * 0.05)
          const off = (t.now * 20 * (1.2 - s.y)) % gap
          for (let r = off; r < m * 0.35; r += gap) {
            g.strokeStyle = tint(th.fg, 0.35 * amp * (1 - r / (m * 0.35)))
            g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke()
          }
          // snapped pitch tick
          const qx = (Math.round(s.x * params.range) / params.range) * w
          g.strokeStyle = th.dim
          g.beginPath(); g.moveTo(qx, y - 6); g.lineTo(qx, y + 6); g.stroke()
          g.fillStyle = drag && drag.k === k ? th.accent : th.fg
          g.beginPath(); g.arc(x, y, Math.max(3, m * 0.012 * (1 + amp)), 0, TAU); g.fill()
        })
      },
      setState(s) { state.stones = s.stones.map((p) => ({ ...p })); sync() },
      clear() { state.stones = []; sync() },
      randomize() { this.setState(gen(clock.steps, params)) },
      dispose() { state.stones = []; sync() },
    }
  },
}
