// 08 Swarm: fireflies fly fixed looping paths (the same on every screen, from a seed).
// Draw wires across their paths; a firefly crossing a wire plays a note set by the
// wire's height. You compose by placing tripwires, not notes.
import { kit, mtof } from './lib/kit.js'
import { LANE_COLORS } from '../palette.js'
import { withPointer, view, theme, subSlots, SLOTS, clamp, rng, intersect, segDist, flashes, tint, isStrip, TAU } from './lib/util.js'

const MAX_WIRES = 8

function gen() {
  return {
    wires: Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => {
      const y = Math.random(), x = Math.random() * 0.6
      return [x, y, x + 0.2 + Math.random() * 0.3, clamp(y + (Math.random() - 0.5) * 0.3, 0, 1)].map((v) => +v.toFixed(3))
    }),
  }
}

// Kandinsky's pairing, in our pigments: circles blue, triangles yellow, squares red
const FORMS = ['circle', 'triangle', 'square']
const PIG = { violet: LANE_COLORS[0], green: LANE_COLORS[1], pink: LANE_COLORS[2], blue: LANE_COLORS[3], ochre: LANE_COLORS[4], red: LANE_COLORS[5] }
const FORM_PIG = { circle: 'blue', triangle: 'ochre', square: 'red' }
// colour planes behind wires, low to high: deep to bright
const PLANES = [PIG.violet, PIG.blue, PIG.green, PIG.pink, PIG.red, PIG.ochre]

// fixed flight paths from a seed: every peer derives the same swarm
export function makeFlies(seed, count) {
  const r = rng(seed * 7919)
  return Array.from({ length: count }, () => ({
    a: 1 + Math.floor(r() * 3), b: 1 + Math.floor(r() * 3),
    p: r() * TAU, q: r() * TAU, ax: 0.3 + r() * 0.16, ay: 0.3 + r() * 0.16,
  }))
}
export const flyPos = (f, ph) => [0.5 + f.ax * Math.sin(TAU * f.a * ph + f.p), 0.5 + f.ay * Math.sin(TAU * f.b * ph + f.q)]

export default {
  id: 'swarm',
  glyph: '<circle class="f" cx="8" cy="9" r="1.6"/><circle class="f" cx="22" cy="7" r="1.6"/><circle class="f" cx="13" cy="21" r="1.6"/><circle class="f" cx="25" cy="19" r="1.6"/><circle class="f" cx="17" cy="13" r="1.6"/><path d="M4 27L28 12"/>',
  name: 'Swarm',
  playhead: false, // time is the fireflies' flight
  how: 'Drag to string a wire across the fireflies’ paths; tap a wire to cut it. Seed reshuffles the flight paths.',
  params: {
    count: { value: 9, min: 1, max: 24, step: 1 },
    seed: { value: 7, min: 1, max: 99, step: 1 },
    range: { value: 10, min: 4, max: 16, step: 1 },
    poly: { value: 3, min: 1, max: 6, step: 1 },
    decay: { value: 0.35, min: 0.05, max: 1.5, step: 0.01 },
    trails: { value: true },
  },
  generate: (steps, params) => gen(steps, params),
  sample: (steps) => gen(steps),
  create(ctx) {
    const { audio, out, params, clock } = ctx
    const engine = kit(audio)
    const th = theme(ctx)
    const size = [1, 1] // lane size from the last frame, for pointer maths
    const state = { wires: [] } // [x1, y1, x2, y2]
    const fx = flashes()
    let flies = []
    let flyKey = ''
    let draft = null

    function ensureFlies() {
      const k = `${params.seed}:${params.count}`
      if (k === flyKey) return
      flyKey = k
      flies = makeFlies(params.seed, params.count)
    }
    const pos = flyPos

    return {
      state,
      pointer: withPointer(size, (e) => {
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
              // each form has its own voice: circles round, triangles sharp, squares hollow and reedy
              const form = FORMS[fi % FORMS.length]
              if (form === 'circle') {
                engine.voices.tone(out, { freq, time: tt, gain: 0.12, type: 'sine', d: params.decay * 1.4 })
                engine.voices.tone(out, { freq: freq * 2, time: tt, gain: 0.035, d: params.decay * 0.5 })
              } else if (form === 'triangle') {
                engine.voices.tone(out, { freq: freq * 2, time: tt, gain: 0.07, type: 'triangle', d: params.decay * 0.45, a: 0.001 })
                engine.voices.tone(out, { freq: freq * 6, time: tt, gain: 0.02, d: 0.04, a: 0.001 })
              } else {
                engine.voices.tone(out, { freq, time: tt, gain: 0.05, type: 'square', d: params.decay * 0.8, a: 0.01 })
                engine.voices.tone(out, { freq: freq / 2, time: tt, gain: 0.05, type: 'sine', d: params.decay })
              }
              fx.hit(`w${wi}`, tt); fx.hit(`f${fi}`, tt)
              n++
            })
          })
        })
      },
      frame(g, w, h, clock, shape) {
        size[0] = w; size[1] = h
        ensureFlies()
        const t = view(clock)
        const sheet = (shape || (isStrip(w, h) ? 'ring' : 'sheet')) === 'sheet'
        const ink = th.fg // the dark sheet inverts the lane canvas, so ink stays ink
        const m = Math.min(w, h)
        const U = sheet ? m : h // unit for sizes; on the thin ring everything shrinks to the strip
        g.lineCap = 'round'; g.lineJoin = 'round'

        // the ground: one big quiet circle with its halo, placed by the seed (the same on every screen)
        if (sheet) {
          const r = rng(params.seed * 31)
          const cx = (0.25 + r() * 0.5) * w, cy = (0.25 + r() * 0.5) * h, R = m * (0.22 + r() * 0.1)
          g.fillStyle = tint(PIG.blue, 0.1); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill()
          g.strokeStyle = tint(ink, 0.18); g.lineWidth = 1
          g.beginPath(); g.arc(cx, cy, R * 1.18, 0, TAU); g.stroke()
          g.fillStyle = tint(PIG.ochre, 0.12); g.beginPath(); g.arc(cx + R * 0.35, cy - R * 0.2, R * 0.38, 0, TAU); g.fill()
        }

        // wires: each lays a translucent half-disc of colour, then a bold tapered ink stroke
        state.wires.forEach(([a, b, c, d], wi) => {
          const x1 = a * w, y1 = b * h, x2 = c * w, y2 = d * h
          const len = Math.hypot(x2 - x1, y2 - y1) || 1
          const glow = fx.glow(`w${wi}`, t.now)
          const ym = (b + d) / 2
          const pig = PLANES[Math.round((1 - ym) * (PLANES.length - 1))]
          const ang = Math.atan2(y2 - y1, x2 - x1)
          g.fillStyle = tint(pig, 0.13 + glow * 0.18)
          g.beginPath(); g.arc((x1 + x2) / 2, (y1 + y2) / 2, len / 2, ang, ang + Math.PI); g.fill()
          // tapered: heavy at the start, a hairline at the end, so every wire has a direction
          const wt = Math.max(1.5, U * (sheet ? 0.012 : 0.05)) * (1 + glow * 0.8)
          const nx = -(y2 - y1) / len, ny = (x2 - x1) / len
          g.fillStyle = glow ? pig : ink
          g.beginPath()
          g.moveTo(x1 + nx * wt, y1 + ny * wt)
          g.lineTo(x2 + nx * 0.4, y2 + ny * 0.4)
          g.lineTo(x2 - nx * 0.4, y2 - ny * 0.4)
          g.lineTo(x1 - nx * wt, y1 - ny * wt)
          g.closePath(); g.fill()
          g.beginPath(); g.arc(x1, y1, wt, 0, TAU); g.fill()
        })
        if (draft) {
          g.strokeStyle = ink; g.lineWidth = 1
          g.setLineDash([4, 4])
          g.beginPath(); g.moveTo(draft.x1 * w, draft.y1 * h); g.lineTo(draft.x2 * w, draft.y2 * h); g.stroke()
          g.setLineDash([])
        }

        // fireflies: circles in circles, sharp triangles, tilted squares, each in its own pigment
        flies.forEach((f, fi) => {
          const form = FORMS[fi % FORMS.length], pig = PIG[FORM_PIG[form]]
          const [x, y] = pos(f, t.phase)
          const glow = fx.glow(`f${fi}`, t.now, 0.6)
          const s0 = Math.max(2, U * (sheet ? 0.018 : 0.11)) * (0.8 + (fi % 4) * 0.15)
          const sz = s0 * (1 + glow * 0.7)
          if (params.trails) {
            // a trail that thins as it ages, like a brush lifting
            for (let k = 0; k < 16; k++) {
              const [ax, ay] = pos(f, t.phase - k * 0.005), [bx, by] = pos(f, t.phase - (k + 1) * 0.005)
              g.strokeStyle = tint(ink, 0.35 * (1 - k / 16)); g.lineWidth = Math.max(0.5, (sheet ? 2.2 : 1.2) * (1 - k / 16))
              g.beginPath(); g.moveTo(ax * w, ay * h); g.lineTo(bx * w, by * h); g.stroke()
            }
          }
          if (glow && sheet) {
            // a struck form rings outward
            g.strokeStyle = tint(pig, glow * 0.8); g.lineWidth = 1.5
            g.beginPath(); g.arc(x * w, y * h, sz + (1 - glow) * s0 * 4, 0, TAU); g.stroke()
          }
          g.save()
          g.translate(x * w, y * h)
          g.rotate(t.phase * TAU * (fi % 2 ? 1 : -1) * (form === 'circle' ? 0 : 1) + fi)
          g.beginPath()
          if (form === 'circle') g.arc(0, 0, sz, 0, TAU)
          else if (form === 'triangle') { g.moveTo(0, -sz * 1.25); g.lineTo(sz * 1.05, sz * 0.75); g.lineTo(-sz * 1.05, sz * 0.75); g.closePath() }
          else g.rect(-sz * 0.8, -sz * 0.8, sz * 1.6, sz * 1.6)
          g.fillStyle = glow ? pig : tint(pig, 0.85)
          g.fill()
          g.strokeStyle = ink; g.lineWidth = sheet ? 1.3 : 0.9
          g.stroke()
          if (form === 'circle' && sz > 4) {
            // circles in circles
            g.fillStyle = tint(PIG.ochre, 0.95); g.beginPath(); g.arc(sz * 0.18, -sz * 0.12, sz * 0.45, 0, TAU); g.fill()
            g.fillStyle = ink; g.beginPath(); g.arc(sz * 0.18, -sz * 0.12, sz * 0.15, 0, TAU); g.fill()
          }
          g.restore()
        })
      },
      setState(s) { state.wires = s.wires.map((x) => x.slice()) },
      clear() { state.wires = [] },
      randomize() { this.setState(gen(clock.steps, params)) },
    }
  },
}
