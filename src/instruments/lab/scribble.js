// 06 Scribble: scribble anywhere; the whole scribble is replayed once per loop
// in the order you drew it, as grains of a slowly morphing vowel.
// x picks where in the vowel the grain is read (oo .. ah .. ee), y picks the pitch.
import { kit, mtof } from './kit.js'
import { withPointer, view, theme, subSlots, SLOTS, clamp, dist, flashes, TAU } from './util.js'

const MAX_PTS = 400
const SRC_SECONDS = 3
const F0 = 110

// a sung tone whose formants glide from oo to ah to ee across the buffer
function vowelBuffer(audio) {
  const sr = audio.sampleRate
  const len = Math.floor(sr * SRC_SECONDS)
  const buf = audio.createBuffer(1, len, sr)
  const d = buf.getChannelData(0)
  const F = [[300, 870], [730, 1090], [270, 2290]] // oo, ah, ee
  const lerp = (a, b, t) => a + (b - a) * t
  const formants = (u) => {
    const seg = u < 0.5 ? 0 : 1
    const t = u < 0.5 ? u * 2 : (u - 0.5) * 2
    return [lerp(F[seg][0], F[seg + 1][0], t), lerp(F[seg][1], F[seg + 1][1], t)]
  }
  const H = 36
  const phase = new Float64Array(H)
  let peak = 0
  for (let i = 0; i < len; i++) {
    const u = i / len
    const [f1, f2] = formants(u)
    let v = 0
    const vib = 1 + 0.004 * Math.sin((TAU * 5.2 * i) / sr)
    for (let h = 1; h <= H; h++) {
      const f = F0 * h
      const a = Math.exp(-(((f - f1) / 120) ** 2)) + 0.6 * Math.exp(-(((f - f2) / 180) ** 2)) + 0.02 / h
      phase[h - 1] += (TAU * f * vib) / sr
      v += a * Math.sin(phase[h - 1])
    }
    v += (Math.random() * 2 - 1) * 0.02
    d[i] = v
    peak = Math.max(peak, Math.abs(v))
  }
  for (let i = 0; i < len; i++) d[i] /= peak
  return buf
}

function gen() {
  const pts = []
  let x = Math.random(), y = Math.random(), a = Math.random() * TAU
  for (let k = 0; k < 120; k++) {
    a += (Math.random() - 0.5) * 1.2
    x = clamp(x + Math.cos(a) * 0.03, 0, 1); y = clamp(y + Math.sin(a) * 0.03, 0, 1)
    pts.push([+x.toFixed(3), +y.toFixed(3), k === 0 ? 1 : 0])
  }
  return { pts }
}

export default {
  id: 'scribble',
  name: 'Scribble',
  how: 'Scribble anywhere. The drawing replays once per loop in stroke order; left is oo, right is ee, height is pitch.',
  params: {
    range: { value: 10, min: 3, max: 16, step: 1 },
    octave: { value: 0, min: -2, max: 1, step: 1 },
    density: { value: 2, min: 1, max: 4, step: 1 },
    grain: { value: 0.09, min: 0.02, max: 0.4, step: 0.005 },
    jitter: { value: 0.02, min: 0, max: 0.3, step: 0.005 },
    level: { value: 0.22, min: 0, max: 0.6, step: 0.01 },
  },
  generate: (steps, params) => gen(steps, params),
  sample: (steps) => gen(steps),
  create(ctx) {
    const { audio, out, params, clock } = ctx
    const engine = kit(audio)
    const th = theme(ctx)
    const size = [1, 1] // lane size from the last frame, for pointer maths
    const state = { pts: [] } // [x, y, strokeStart]
    const src = vowelBuffer(audio)
    const fx = flashes()
    let last = null

    function grain(x, y, time) {
      const s = audio.createBufferSource()
      s.buffer = src
      const deg = Math.round((1 - y) * params.range)
      s.playbackRate.value = mtof(engine.degree(deg, params.octave)) / F0
      const g = audio.createGain()
      const d = params.grain
      g.gain.setValueAtTime(0, time)
      g.gain.linearRampToValueAtTime(params.level, time + d * 0.4)
      g.gain.linearRampToValueAtTime(0, time + d)
      s.connect(g).connect(out)
      const off = clamp(x + (Math.random() - 0.5) * params.jitter, 0, 0.98) * SRC_SECONDS
      s.start(time, off)
      s.stop(time + d + 0.01)
    }

    return {
      state,
      pointer: withPointer(size, (e) => {
        if (e.type === 'down') {
          last = [e.px, e.py]
          state.pts.push([clamp(e.x, 0, 1), clamp(e.y, 0, 1), 1])
        } else if (e.type === 'move' && e.pressed && last) {
          if (dist(last[0], last[1], e.px, e.py) < Math.min(e.w, e.h) * 0.012) return
          last = [e.px, e.py]
          state.pts.push([clamp(e.x, 0, 1), clamp(e.y, 0, 1), 0])
        } else if (e.type === 'up') last = null
        if (state.pts.length > MAX_PTS) {
          state.pts.splice(0, state.pts.length - MAX_PTS)
          state.pts[0][2] = 1
        }
      }),
      step(i, time, dur) {
        const N = state.pts.length
        if (!N) return
        subSlots(i, time, dur, clock.steps, (s, t) => {
          // points whose onset falls in this slot
          const a = Math.ceil((s * N) / SLOTS), b = Math.ceil(((s + 1) * N) / SLOTS)
          const span = b - a
          if (span <= 0) return
          const n = Math.min(params.density, span)
          for (let k = 0; k < n; k++) {
            const idx = a + Math.floor((k * span) / n)
            const p = state.pts[idx]
            const tt = t + (k * dur) / (SLOTS / clock.steps) / n
            grain(p[0], p[1], tt)
            fx.hit(idx, tt)
          }
        })
      },
      frame(g, w, h, clock) {
        size[0] = w; size[1] = h
        const t = view(clock)
        const N = state.pts.length
        // vowel zones
        g.fillStyle = th.faint
        g.font = `${Math.max(10, h / 28)}px ${th.font}`
        g.fillText('oo', 8, h - 8)
        g.fillText('ah', w / 2 - 8, h - 8)
        g.fillText('ee', w - 24, h - 8)
        g.strokeStyle = th.dim
        g.lineWidth = 1
        g.beginPath()
        state.pts.forEach(([x, y, start]) => (start ? g.moveTo(x * w, y * h) : g.lineTo(x * w, y * h)))
        g.stroke()
        // grains
        for (let k = 0; k < N; k++) {
          const glow = fx.glow(k, t.now, 0.5)
          if (!glow) continue
          const [x, y] = state.pts[k]
          g.fillStyle = `rgba(255,122,61,${glow})`
          g.beginPath(); g.arc(x * w, y * h, 2 + (1 - glow) * Math.min(w, h) * 0.03, 0, TAU); g.fill()
        }
        if (N && t.playing) {
          const [x, y] = state.pts[Math.min(N - 1, Math.floor(t.phase * N))]
          g.fillStyle = th.fg
          g.beginPath(); g.arc(x * w, y * h, 3, 0, TAU); g.fill()
        }
      },
      setState(s) { state.pts = s.pts.map((p) => p.slice()) },
      clear() { state.pts = [] },
      randomize() { this.setState(gen(clock.steps, params)) },
    }
  },
}
