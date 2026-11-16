// 03 Rings: three euclidean rhythms on concentric rings, each with its own length.
// Ring lengths that differ from 16 drift against the loop (polymeter).
import { kit } from './lib/kit.js'
import { isStrip, withPointer, view, absOf, theme, clamp, TAU, flashes } from './lib/util.js'

const RADII = [1, 0.7, 0.42]
const VOICES = ['hat', 'snare', 'kick']

export const hit = (j, n, k, rot) => (((((j - rot) % n) + n) % n) * k) % n < k

function gen(steps, p = {}) {
  const n = [p.outer ?? 16, p.middle ?? 12, p.inner ?? 16]
  return { rings: n.map((len) => ({ k: 1 + Math.floor(Math.random() * len * 0.6), rot: Math.floor(Math.random() * len) })) }
}

export default {
  id: 'rings',
  glyph: '<circle cx="16" cy="16" r="4"/><circle cx="16" cy="16" r="8.5"/><circle cx="16" cy="16" r="13"/><circle class="f" cx="16" cy="3" r="1.8"/>',
  name: 'Rings',
  playhead: false, // time goes round each ring
  how: 'Drag around a ring to rotate it, drag outward or inward to add or remove pulses, tap to add one.',
  params: {
    outer: { value: 16, min: 3, max: 16, step: 1 },
    middle: { value: 12, min: 3, max: 16, step: 1 },
    inner: { value: 16, min: 3, max: 16, step: 1 },
    kickPitch: { value: 50, min: 30, max: 90, step: 1 },
    hatOpen: { value: false },
  },
  generate: (steps, params) => gen(steps, params),
  sample: (steps) => gen(steps),
  create(ctx) {
    const { params, out, audio, clock } = ctx
    const { voices } = kit(audio)
    const th = theme(ctx)
    const size = [1, 1] // lane size from the last frame, for pointer maths
    const state = { rings: [{ k: 7, rot: 0 }, { k: 3, rot: 3 }, { k: 4, rot: 0 }] }
    const fx = flashes()
    const ns = () => [params.outer, params.middle, params.inner]
    let drag = null

    function geom(e) {
      const R = Math.min(e.w, e.h) * 0.44
      const dx = e.px - e.w / 2, dy = e.py - e.h / 2
      return { R, r: Math.hypot(dx, dy), a: Math.atan2(dy, dx) + Math.PI / 2 }
    }

    // unrolled: one row per ring (outer on top), x is the loop. Drag sideways to rotate,
    // tap to add a pulse, shift-tap to remove one.
    function stripPointer(e) {
      if (e.type === 'down') {
        const i = clamp(Math.floor(e.y * 3), 0, 2)
        drag = { i, x0: e.x, rot0: state.rings[i].rot, moved: 0, strip: true }
      } else if (e.type === 'move' && drag?.strip) {
        const n = ns()[drag.i]
        drag.moved = Math.max(drag.moved, Math.abs(e.x - drag.x0) * e.w)
        const m = Math.round((e.x - drag.x0) * clock.steps)
        state.rings[drag.i].rot = (((drag.rot0 + m) % n) + n) % n
      } else if (e.type === 'up' && drag?.strip) {
        if (drag.moved < 5) {
          const ring = state.rings[drag.i], n = ns()[drag.i]
          ring.k = clamp(ring.k + (e.alt ? -1 : 1), 0, n)
        }
        drag = null
      }
    }

    function frameStrip(g, w, h, t) {
      const steps = t.steps
      const start = Math.floor(t.abs / steps) * steps
      const cur = Math.floor(t.abs) - start
      const cw = w / steps, rh = h / 3
      ns().forEach((n, r) => {
        const { k, rot } = state.rings[r]
        const cy = rh * r + rh / 2
        for (let s = 0; s < steps; s++) {
          const j = (((start + s) % n) + n) % n
          const on = hit(j, n, Math.min(k, n), rot)
          const cx = cw * s + cw / 2
          const glow = fx.glow(`${r}:${j}`, t.now)
          const size = Math.max(1.5, Math.min(cw, rh) * (on ? 0.28 + glow * 0.1 : 0.08))
          g.fillStyle = on ? (glow > 0 ? th.accent : th.fg) : s === cur && t.playing ? th.fg : th.dim
          g.beginPath(); g.arc(cx, cy, size, 0, TAU); g.fill()
          // this ring's own downbeat, which drifts when its length isn't the loop's
          if (j === 0 && n !== steps) {
            g.fillStyle = th.dim
            g.fillRect(cw * s, rh * r + 1, 1, rh - 2)
          }
        }
      })
    }

    return {
      state,
      pointer: withPointer(size, (e) => {
        if (isStrip(e.w, e.h, e.shape)) return stripPointer(e)
        const { R, r, a } = geom(e)
        if (e.type === 'down') {
          let best = 0, bd = Infinity
          RADII.forEach((f, i) => { const d = Math.abs(r - f * R); if (d < bd) { bd = d; best = i } })
          const ring = state.rings[best]
          drag = { i: best, a0: a, r0: r, rot0: ring.rot, k0: ring.k, moved: 0, R }
        } else if (e.type === 'move' && drag) {
          const n = ns()[drag.i]
          const ring = state.rings[drag.i]
          let da = a - drag.a0
          da = Math.atan2(Math.sin(da), Math.cos(da))
          drag.moved = Math.max(drag.moved, Math.abs(r - drag.r0), Math.abs(da) * drag.r0)
          ring.rot = (((drag.rot0 + Math.round((da / TAU) * n)) % n) + n) % n
          ring.k = clamp(drag.k0 + Math.round((r - drag.r0) / (drag.R * 0.05)), 0, n)
        } else if (e.type === 'up' && drag) {
          if (drag.moved < 5) {
            const ring = state.rings[drag.i]
            ring.k = (ring.k + 1) % (ns()[drag.i] + 1)
          }
          drag = null
        }
      }),
      step(i, time, dur) {
        const abs = absOf(clock, time)
        ns().forEach((n, r) => {
          const { k, rot } = state.rings[r]
          const j = abs % n
          if (!hit(j, n, Math.min(k, n), rot)) return
          const v = VOICES[r]
          if (v === 'kick') voices.kick(out, { time, pitch: params.kickPitch })
          else if (v === 'snare') voices.snare(out, { time, gain: 0.22 })
          else voices.hat(out, { time, open: params.hatOpen && j % 4 === 2 })
          fx.hit(`${r}:${j}`, time)
        })
      },
      frame(g, w, h, clock, shape) {
        size[0] = w; size[1] = h
        if (isStrip(w, h, shape)) return frameStrip(g, w, h, view(clock))
        const t = view(clock)
        const R = Math.min(w, h) * 0.44
        const cx = w / 2, cy = h / 2
        const abs = Math.floor(t.abs)
        ns().forEach((n, r) => {
          const rad = RADII[r] * R
          const { k, rot } = state.rings[r]
          g.strokeStyle = th.faint
          g.lineWidth = 1
          g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.stroke()
          const cur = ((abs % n) + n) % n
          // playhead hand per ring, at its own polymeter position
          const frac = ((((t.abs % n) + n) % n) / n) * TAU - Math.PI / 2
          if (t.playing) {
            g.strokeStyle = th.dim
            g.beginPath()
            g.moveTo(cx + Math.cos(frac) * (rad - R * 0.08), cy + Math.sin(frac) * (rad - R * 0.08))
            g.lineTo(cx + Math.cos(frac) * (rad + R * 0.08), cy + Math.sin(frac) * (rad + R * 0.08))
            g.stroke()
          }
          let prev = null
          g.strokeStyle = th.dim
          for (let j = 0; j < n; j++) {
            const ang = (j / n) * TAU - Math.PI / 2
            const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad
            const on = hit(j, n, Math.min(k, n), rot)
            const glow = fx.glow(`${r}:${j}`, t.now)
            const s = Math.max(2, R * (on ? 0.035 + glow * 0.025 : 0.012))
            g.fillStyle = on ? (glow > 0 ? th.accent : th.fg) : j === cur && t.playing ? th.fg : th.dim
            g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill()
            if (on) {
              // polygon through the pulses
              if (prev) { g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(x, y); g.stroke() }
              prev = [x, y]
            }
          }
        })
      },
      setState(s) { state.rings = s.rings.map((r) => ({ ...r })) },
      clear() { state.rings.forEach((r) => { r.k = 0; r.rot = 0 }) },
      randomize() { this.setState(gen(clock.steps, params)) },
    }
  },
}
