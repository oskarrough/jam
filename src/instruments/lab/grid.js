// 02 Grid: the plain step sequencer, as a baseline to compare the others against.
import { kit } from './kit.js'
import { withPointer, view, theme, clamp, flashes } from './util.js'

const COLS = 16
const ROWS = 8

function gen() {
  const cells = Array(COLS * ROWS).fill(0)
  for (let c = 0; c < COLS; c++) if (Math.random() < 0.55) cells[Math.floor(Math.random() * ROWS) * COLS + c] = 1
  return { cells }
}

export default {
  id: 'grid',
  name: 'Grid',
  how: 'Click or drag to paint cells; the first cell decides paint or erase.',
  params: {
    octave: { value: 1, min: -1, max: 2, step: 1 },
    decay: { value: 0.9, min: 0.1, max: 3, step: 0.05 },
    ratio: { value: 3.5, min: 1, max: 8, step: 0.01 },
    index: { value: 1.6, min: 0, max: 6, step: 0.05 },
  },
  generate: (steps, params) => gen(steps, params),
  sample: (steps) => gen(steps),
  create(ctx) {
    const { params, out, audio, clock } = ctx
    const engine = kit(audio)
    const { voices } = engine
    const th = theme(ctx)
    const size = [1, 1] // lane size from the last frame, for pointer maths
    const state = { cells: Array(COLS * ROWS).fill(0) }
    const fx = flashes()
    let mode = 1

    const cellAt = (x, y) => {
      const c = clamp(Math.floor(x * COLS), 0, COLS - 1)
      const r = clamp(Math.floor((1 - y) * ROWS), 0, ROWS - 1)
      return r * COLS + c
    }

    return {
      state,
      pointer: withPointer(size, (e) => {
        if (e.type === 'down') {
          const i = cellAt(e.x, e.y)
          mode = state.cells[i] ? 0 : 1
          state.cells[i] = mode
        } else if (e.type === 'move' && e.pressed) {
          state.cells[cellAt(e.x, e.y)] = mode
        }
      }),
      step(i, time) {
        // 16 columns span the loop; with longer loops columns fall on every n-th step
        const per = clock.steps / COLS
        if (i % per) return
        i = i / per
        for (let r = 0; r < ROWS; r++) {
          if (!state.cells[r * COLS + i]) continue
          const f = 440 * Math.pow(2, (engine.degree(r, params.octave) - 69) / 12)
          voices.bell(out, { freq: f, time, gain: 0.13, d: params.decay, ratio: params.ratio, index: params.index })
          fx.hit(r * COLS + i, time)
        }
      },
      frame(g, w, h, clock) {
        size[0] = w; size[1] = h
        const t = view(clock)
        const cw = w / COLS, ch = h / ROWS
        const col = Math.floor(t.phase * COLS)
        if (t.playing) {
          g.fillStyle = th.faint
          g.fillRect(col * cw, 0, cw, h)
        }
        const r0 = Math.max(1.5, Math.min(cw, ch) * 0.06)
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c
            const x = c * cw + cw / 2
            const y = h - (r * ch + ch / 2)
            if (state.cells[i]) {
              const glow = fx.glow(i, t.now)
              const s = Math.min(cw, ch) * (0.3 + glow * 0.12)
              g.fillStyle = glow > 0 ? th.accent : th.fg
              g.fillRect(x - s, y - s, s * 2, s * 2)
            } else {
              g.fillStyle = c % 4 === 0 ? th.dim : th.faint
              g.fillRect(x - r0, y - r0, r0 * 2, r0 * 2)
            }
          }
        }
      },
      setState(s) { state.cells = s.cells.slice() },
      clear() { state.cells.fill(0) },
      randomize() { this.setState(gen(clock.steps, params)) },
    }
  },
}
