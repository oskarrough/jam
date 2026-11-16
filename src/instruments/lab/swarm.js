// 08 Swarm: fireflies fly fixed looping paths (the same on every screen, from a seed).
// Draw wires across their paths; a firefly crossing a wire plays a note set by the
// wire's height. You compose by placing tripwires, not notes.
import { kit, mtof } from './kit.js'
import { withPointer, view, theme, subSlots, SLOTS, clamp, rng, intersect, segDist, flashes, TAU } from './util.js'

const MAX_WIRES = 8

export default {
  id: 'swarm',
  name: 'Swarm',
  how: 'Drag to string a wire across the fireflies’ paths; tap a wire to cut it. Seed reshuffles the flight paths.',
  params: {
    count: { value: 9, min: 1, max: 24, step: 1 },
    seed: { value: 7, min: 1, max: 99, step: 1 },
    range: { value: 10, min: 4, max: 16, step: 1 },
    poly: { value: 3, min: 1, max: 6, step: 1 },
    decay: { value: 0.35, min: 0.05, max: 1.5, step: 0.01 },
    trails: { value: true },
  },
  create(ctx) {
    const { audio, out, params, clock } = ctx
    const engine = kit(audio)
    const th = theme(ctx)
    const state = { wires: [] } // [x1, y1, x2, y2]
    const fx = flashes()
    let flies = []
    let flyKey = ''
    let draft = null

    function ensureFlies() {
      const k = `${params.seed}:${params.count}`
      if (k === flyKey) return
      flyKey = k
      const r = rng(params.seed * 7919)
      flies = Array.from({ length: params.count }, () => ({
        a: 1 + Math.floor(r() * 3), b: 1 + Math.floor(r() * 3),
        p: r() * TAU, q: r() * TAU, ax: 0.3 + r() * 0.16, ay: 0.3 + r() * 0.16,
      }))
    }
    const pos = (f, ph) => [0.5 + f.ax * Math.sin(TAU * f.a * ph + f.p), 0.5 + f.ay * Math.sin(TAU * f.b * ph + f.q)]

    return {
      state,
      pointer: withPointer((e) => {
        if (e.type === 'down') draft = { x1: e.x, y1: e.y, x2: e.x, y2: e.y, px: e.px, py: e.py }
        else if (e.type === 'move' && draft) { draft.x2 = clamp(e.x, 0, 1); draft.y2 = clamp(e.y, 0, 1) }
        else if (e.type === 'up' && draft) {
          const len = Math.hypot((draft.x2 - draft.x1) * e.w, (draft.y2 - draft.y1) * e.h)
          if (len < 8) {
            // tap: cut the nearest wire
            const k = state.wires.findIndex(([a, b, c, d]) => segDist(e.px, e.py, a * e.w, b * e.h, c * e.w, d * e.h) < 12)
            if (k >= 0) state.wires.splice(k, 1)
          } else {
            state.wires.push([draft.x1, draft.y1, draft.x2, draft.y2].map((v) => +v.toFixed(4)))
            if (state.wires.length > MAX_WIRES) state.wires.shift()
          }
          draft = null
        }
      }),
      step(i, time, dur) {
        ensureFlies()
        subSlots(i, time, dur, clock.steps, (s, t) => {
          const p0 = s / SLOTS, p1 = (s + 1) / SLOTS
          let n = 0
          flies.forEach((f, fi) => {
            const [ax, ay] = pos(f, p0), [bx, by] = pos(f, p1)
            state.wires.forEach((wr, wi) => {
              if (n >= params.poly) return
              const u = intersect(ax, ay, bx, by, wr[0], wr[1], wr[2], wr[3])
              if (u === null) return
              const ym = (wr[1] + wr[3]) / 2
              const deg = Math.round((1 - ym) * params.range) + (fi % 3 === 0 ? 2 : 0)
              const tt = t + u * (dur * clock.steps) / SLOTS
              const freq = mtof(engine.degree(deg, 0))
              engine.voices.tone(out, { freq, time: tt, gain: 0.12, type: 'triangle', d: params.decay })
              engine.voices.tone(out, { freq: freq * 2, time: tt, gain: 0.04, d: params.decay * 0.3 })
              fx.hit(`w${wi}`, tt); fx.hit(`f${fi}`, tt)
              n++
            })
          })
        })
      },
      frame(g, w, h, clock) {
        ensureFlies()
        const t = view(clock)
        state.wires.forEach(([a, b, c, d], wi) => {
          const glow = fx.glow(`w${wi}`, t.now)
          g.strokeStyle = glow ? th.accent : th.dim
          g.lineWidth = 1 + glow * 2
          g.beginPath(); g.moveTo(a * w, b * h); g.lineTo(c * w, d * h); g.stroke()
        })
        g.lineWidth = 1
        if (draft) {
          g.strokeStyle = th.fg
          g.setLineDash([4, 4])
          g.beginPath(); g.moveTo(draft.x1 * w, draft.y1 * h); g.lineTo(draft.x2 * w, draft.y2 * h); g.stroke()
          g.setLineDash([])
        }
        flies.forEach((f, fi) => {
          if (params.trails) {
            g.strokeStyle = th.faint
            g.beginPath()
            for (let k = 0; k <= 24; k++) {
              const [x, y] = pos(f, t.phase - k * 0.004)
              k ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)
            }
            g.stroke()
          }
          const [x, y] = pos(f, t.phase)
          const glow = fx.glow(`f${fi}`, t.now, 0.5)
          g.fillStyle = glow ? th.accent : th.fg
          g.beginPath(); g.arc(x * w, y * h, 2 + glow * 4, 0, TAU); g.fill()
        })
      },
      setState(s) { state.wires = s.wires.map((x) => x.slice()) },
      clear() { state.wires = [] },
      randomize() {
        state.wires = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => {
          const y = Math.random(), x = Math.random() * 0.6
          return [x, y, x + 0.2 + Math.random() * 0.3, clamp(y + (Math.random() - 0.5) * 0.3, 0, 1)]
        })
      },
    }
  },
}
