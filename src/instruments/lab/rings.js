// 03 Rings: three euclidean rhythms on concentric rings, each with its own length.
// Ring lengths that differ from 16 drift against the loop (polymeter).
import { kit } from './kit.js'
import { withPointer, view, absOf, theme, clamp, TAU, flashes } from './util.js'

const RADII = [1, 0.7, 0.42]
const VOICES = ['hat', 'snare', 'kick']

const hit = (j, n, k, rot) => (((((j - rot) % n) + n) % n) * k) % n < k

export default {
  id: 'rings',
  name: 'Rings',
  how: 'Drag around a ring to rotate it, drag outward or inward to add or remove pulses, tap to add one.',
  params: {
    outer: { value: 16, min: 3, max: 16, step: 1 },
    middle: { value: 12, min: 3, max: 16, step: 1 },
    inner: { value: 16, min: 3, max: 16, step: 1 },
    kickPitch: { value: 50, min: 30, max: 90, step: 1 },
    hatOpen: { value: false },
  },
  create(ctx) {
    const { params, out, audio, clock } = ctx
    const { voices } = kit(audio)
    const th = theme(ctx)
    const state = { rings: [{ k: 7, rot: 0 }, { k: 3, rot: 3 }, { k: 4, rot: 0 }] }
    const fx = flashes()
    const ns = () => [params.outer, params.middle, params.inner]
    let drag = null

    function geom(e) {
      const R = Math.min(e.w, e.h) * 0.44
      const dx = e.px - e.w / 2, dy = e.py - e.h / 2
      return { R, r: Math.hypot(dx, dy), a: Math.atan2(dy, dx) + Math.PI / 2 }
    }

    return {
      state,
      pointer: withPointer((e) => {
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
      frame(g, w, h, clock) {
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
      randomize() {
        const n = ns()
        state.rings.forEach((r, i) => { r.k = 1 + Math.floor(Math.random() * (n[i] * 0.6)); r.rot = Math.floor(Math.random() * n[i]) })
      },
    }
  },
}
