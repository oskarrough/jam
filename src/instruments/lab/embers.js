// 10 Embers: tap the dark to throw a spark there; it pops on the next beat-step as a
// tuned crackle (high sparks are bright, low sparks thump, left/right pans).
// Every spark keeps popping in its slot each loop until it burns out, so the
// rhythm decays unless people keep feeding the fire.
import { kit, mtof } from './kit.js'
import { withPointer, view, absNow, absOf, theme, SLOTS, clamp, dist, TAU } from './util.js'

const MAX = 48
const FLIGHT = 0.45 // seconds a spark takes to rise

// born: null means "lit just now"; setState stamps it with the current loop
function gen(steps = 16) {
  const per = SLOTS / steps
  return {
    sparks: Array.from({ length: 7 }, () => ({
      s: Math.floor(Math.random() * steps) * per, x: +(0.15 + Math.random() * 0.7).toFixed(3), y: +(0.1 + Math.random() * 0.7).toFixed(3), born: null,
    })),
  }
}

export default {
  id: 'embers',
  name: 'Embers',
  how: 'Tap or drag in the dark above the fire to throw sparks. Each one pops on the grid and fades after a few loops.',
  params: {
    life: { value: 4, min: 0, max: 16, step: 1 },
    range: { value: 10, min: 3, max: 16, step: 1 },
    crackle: { value: 0.35, min: 0, max: 1, step: 0.01 },
    tone: { value: 0.5, min: 0, max: 1, step: 0.01 },
  },
  generate: (steps, params) => gen(steps, params),
  sample: (steps) => gen(steps),
  create(ctx) {
    const { audio, out, params, clock } = ctx
    const engine = kit(audio)
    const th = theme(ctx)
    const size = [1, 1] // lane size from the last frame, for pointer maths
    const state = { sparks: [] } // {s: slot, x, y, born: loop}
    let lastThrow = null

    function pop(sp, time) {
      const deg = Math.round((1 - sp.y) * params.range)
      const pan = (sp.x - 0.5) * 1.6
      engine.voices.noise(out, { time, freq: 300 + (1 - sp.y) * 6000, q: 2.5, gain: 0.35, d: 0.03 + sp.y * 0.08, pan })
      if (params.tone > 0) {
        engine.voices.tone(out, { freq: mtof(engine.degree(deg, 1)), time, gain: 0.1 * params.tone, d: 0.12, type: 'sine' })
      }
    }

    function throwAt(x, y) {
      const stepsPerSlot = SLOTS / clock.steps
      // the first step boundary at least FLIGHT/2 ahead
      const a = absNow(clock) + FLIGHT / 2 / clock.stepDur
      const target = Math.ceil(a)
      const sp = {
        s: (((target % clock.steps) + clock.steps) % clock.steps) * stepsPerSlot,
        x: +clamp(x, 0, 1).toFixed(3),
        y: +clamp(y, 0, 0.85).toFixed(3),
        born: Math.floor(target / clock.steps),
      }
      if (clock.playing ?? true) pop(sp, clock.startTime + target * clock.stepDur)
      state.sparks.push(sp)
      if (state.sparks.length > MAX) state.sparks.shift()
    }

    return {
      state,
      pointer: withPointer(size, (e) => {
        if (e.type === 'down') { throwAt(e.x, e.y); lastThrow = [e.px, e.py] }
        else if (e.type === 'move' && e.pressed && lastThrow) {
          if (dist(lastThrow[0], lastThrow[1], e.px, e.py) > Math.min(e.w, e.h) * 0.08) {
            throwAt(e.x, e.y); lastThrow = [e.px, e.py]
          }
        } else if (e.type === 'up') lastThrow = null
      }),
      step(i, time) {
        const abs = absOf(clock, time)
        const loop = Math.floor(abs / clock.steps)
        if (params.life > 0) state.sparks = state.sparks.filter((sp) => loop - sp.born <= params.life)
        const per = SLOTS / clock.steps
        for (const sp of state.sparks) {
          if (sp.born >= loop) continue // already popped live this loop
          if (Math.floor(sp.s / per) !== i) continue
          pop(sp, time)
        }
        // the fire itself crackles more as it is fed
        const heat = Math.min(1, state.sparks.length / 12)
        if (Math.random() < params.crackle * (0.15 + heat * 0.6)) {
          engine.voices.noise(out, { time: time + Math.random() * 0.05, freq: 2500 + Math.random() * 4000, q: 4, gain: 0.08 * params.crackle, d: 0.012, pan: (Math.random() - 0.5) * 0.4 })
        }
      },
      frame(g, w, h, clock) {
        size[0] = w; size[1] = h
        const t = view(clock)
        const loopDur = clock.stepDur * clock.steps
        const fx = w / 2, fy = h * 0.96
        const heat = Math.min(1, state.sparks.length / 12)
        // fire: a few flickering strokes
        for (let k = 0; k < 9; k++) {
          const off = (k - 4) * Math.min(w, h) * 0.018
          const hh = h * (0.06 + heat * 0.14) * (0.6 + 0.4 * Math.sin(t.now * (7 + k) + k * 1.7))
          g.strokeStyle = k % 3 ? th.dim : th.accent
          g.beginPath()
          g.moveTo(fx + off, fy)
          g.quadraticCurveTo(fx + off * 0.5 + Math.sin(t.now * 5 + k) * 4, fy - hh * 0.6, fx + off * 0.2, fy - hh)
          g.stroke()
        }
        g.strokeStyle = th.faint
        g.beginPath(); g.moveTo(fx - w * 0.08, fy + 1); g.lineTo(fx + w * 0.08, fy + 1); g.stroke()
        const loop = Math.floor(t.abs / t.steps)
        for (const sp of state.sparks) {
          const life = params.life > 0 ? 1 - Math.max(0, loop - sp.born) / (params.life + 1) : 1
          const tx = sp.x * w, ty = sp.y * h
          // time since this spark's pop in the current loop, in seconds (wrapped)
          let since = ((t.phase - sp.s / SLOTS) % 1 + 1) % 1 * loopDur
          if (loop < sp.born || (loop === sp.born && t.phase < sp.s / SLOTS)) since = -1
          const until = loopDur - since
          if (t.playing && since >= 0 && until < FLIGHT && until > 0) {
            // rising toward its pop point
            const u = 1 - until / FLIGHT
            const x = fx + (tx - fx) * u + Math.sin(u * 9 + sp.x * 20) * 4 * (1 - u)
            const y = fy + (ty - fy) * (1 - (1 - u) * (1 - u))
            g.fillStyle = th.accent
            g.beginPath(); g.arc(x, y, 2.5, 0, TAU); g.fill()
          }
          if (t.playing && since >= 0 && since < 0.5) {
            // burst
            const u = since / 0.5
            g.strokeStyle = `rgba(255,122,61,${(1 - u) * life})`
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * TAU + sp.x * 10
              const r1 = 3 + u * 16, r2 = r1 + 4
              g.beginPath()
              g.moveTo(tx + Math.cos(a) * r1, ty + Math.sin(a) * r1)
              g.lineTo(tx + Math.cos(a) * r2, ty + Math.sin(a) * r2)
              g.stroke()
            }
          }
          // ember resting where it pops, dimming as it burns out
          g.fillStyle = `rgba(236,230,220,${0.2 + 0.6 * life})`
          g.beginPath(); g.arc(tx, ty, 1.5 + life * 1.5, 0, TAU); g.fill()
        }
      },
      setState(s) {
        const loop = Math.floor(absNow(clock) / clock.steps)
        state.sparks = s.sparks.map((p) => ({ ...p, born: p.born ?? loop - 1 }))
      },
      clear() { state.sparks = [] },
      randomize() { this.setState(gen(clock.steps, params)) },
    }
  },
}
