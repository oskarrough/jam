// Phrase adapters for the lab instruments: state <-> { n, drums, notes: [{ s, p, v }] }.
// See src/phrase.js. `to` reads what a seat plays over one loop; `from` writes a phrase
// back in the instrument's own terms, as close as its gestures allow.
import { SLOTS, clamp, intersect } from './util.js'
import { hit } from '../rings.js'
import { REVS, lapsOf } from '../orbits.js'
import { makeFlies, flyPos } from '../swarm.js'

const OCT = 5
const mod = (a, n) => ((a % n) + n) % n
const P = (m, params, k) => params?.[k] ?? m?.params?.[k]?.value

// melodic notes into [lo, hi] by whole octaves (same as phrase.fitRange, kept local to avoid a cycle)
function fit(notes, lo, hi) {
  if (!notes.length) return notes
  const ps = notes.map((x) => x.p).sort((a, b) => a - b)
  const shift = Math.round(((lo + hi) / 2 - ps[Math.floor(ps.length / 2)]) / OCT) * OCT
  return notes.map((x) => {
    let p = x.p + shift
    while (p > hi && p - OCT >= lo) p -= OCT
    while (p < lo && p + OCT <= hi) p += OCT
    return { ...x, p: clamp(p, lo, hi) }
  })
}
const melody = (ph) => (ph.drums ? ph.notes.map((x) => ({ ...x, p: [0, 2, 4][x.p] ?? 0 })) : ph.notes)
const drumRows = (ph) => {
  if (ph.drums) return ph.notes
  const ps = ph.notes.map((x) => x.p).sort((a, b) => a - b)
  const lo = ps[Math.floor(ps.length / 3)] ?? 0, hi = ps[Math.floor((ps.length * 2) / 3)] ?? 0
  return ph.notes.map((x) => ({ ...x, p: x.p <= lo ? 0 : x.p >= hi && hi > lo ? 2 : 1 }))
}
const toSteps = (ph, n) => (ph.n === n ? ph.notes : ph.notes.map((x) => ({ ...x, s: (x.s * n) / ph.n })))
const sorted = (notes) => [...notes].sort((a, b) => a.s - b.s)

// a melodic contour from a sampled curve: a note wherever the quantised value changes
function contourNotes(values, n) {
  const notes = []
  let prev = null
  values.forEach((d, k) => {
    if (d === null) { prev = null; return }
    if (d !== prev) notes.push({ s: (k * n) / values.length, p: d, v: 0.8 })
    prev = d
  })
  return notes
}

export const adapters = {
  contour: {
    to: (st, n, params, m) => ({ n, drums: false, notes: contourNotes(st.ys.map((y) => (y === null ? null : Math.round((1 - y) * P(m, params, 'range')))), n) }),
    from(ph, n, params, m) {
      const r = P(m, params, 'range')
      const notes = sorted(fit(melody(ph), 0, r)).map((x) => ({ ...x, slot: Math.round((x.s / ph.n) * SLOTS) % SLOTS }))
      const ys = Array(SLOTS).fill(null)
      notes.forEach((x, k) => {
        const next = notes[k + 1] ? notes[k + 1].slot : notes[0].slot + SLOTS
        const len = Math.max(2, Math.min(next - x.slot, 12))
        for (let j = 0; j < len; j++) ys[(x.slot + j) % SLOTS] = +(1 - x.p / r).toFixed(3)
      })
      return { ys }
    },
  },

  // pattern of up to 16 steps, each [pitch 0..14, length, loud, chance]; read over one loop, repeats and all
  grid: {
    to(st, n) {
      const notes = []
      for (let s = 0; s < n; s++) { const x = st.s[s % st.len]; if (x) notes.push({ s, p: x[0], v: x[2] / 9 }) }
      return { n, drums: false, notes }
    },
    from(ph) {
      const s = Array(16).fill(0)
      for (const x of fit(melody(ph), 0, 14)) {
        const k = Math.round((x.s / ph.n) * 16) % 16
        if (!s[k]) s[k] = [x.p, 3, clamp(Math.round((x.v ?? 0.8) * 9), 2, 9), 9]
      }
      return { len: 16, s }
    },
  },

  // drums: ring 0 hat (outer), 1 snare, 2 kick; phrase rows 0 kick, 1 snare, 2 hat
  rings: {
    to(st, n, params, m) {
      const ns = [P(m, params, 'outer'), P(m, params, 'middle'), P(m, params, 'inner')]
      const notes = []
      for (let s = 0; s < n; s++) st.rings.forEach((r, i) => { if (hit(s % ns[i], ns[i], Math.min(r.k, ns[i]), r.rot)) notes.push({ s, p: 2 - i, v: 0.8 }) })
      return { n, drums: true, notes }
    },
    from(ph, n, params, m) {
      const ns = [P(m, params, 'outer'), P(m, params, 'middle'), P(m, params, 'inner')]
      const rows = drumRows(ph)
      return {
        rings: ns.map((len, i) => {
          const at = sorted(rows.filter((x) => x.p === 2 - i)).map((x) => Math.round((x.s / ph.n) * n))
          // a euclidean ring with as many pulses, turned so its first pulse lands on the first hit
          return { k: Math.min(at.length, len), rot: at.length ? mod(at[0], len) : 0 }
        }),
      }
    },
  },

  // the filter curve read as a melody line: higher cutoff, higher note
  sweep: {
    to: (st, n) => ({ n, drums: false, notes: contourNotes(Array.from({ length: n }, (_, i) => { const a = st.auto[Math.floor((i * SLOTS) / n)]; return a ? Math.round((1 - a[0]) * 10) : null }), n) }),
    from(ph) {
      const notes = sorted(fit(melody(ph), 0, 10))
      if (!notes.length) return { auto: Array(SLOTS).fill(null) }
      const auto = Array.from({ length: SLOTS }, (_, k) => {
        const t = (k / SLOTS) * ph.n
        const x = [...notes].reverse().find((y) => y.s <= t) || notes[notes.length - 1]
        return [+(1 - x.p / 10).toFixed(3), +(0.15 + (x.v ?? 0.8) * 0.3).toFixed(3)]
      })
      return { auto }
    },
  },

  // stones have no time; the robot keeps the motif's strongest distinct pitches as a chord
  drift: {
    to: (st, n, params, m) => ({ n, drums: false, notes: st.stones.map((x, i) => ({ s: (i * n) / Math.max(1, st.stones.length), p: Math.round(x.x * P(m, params, 'range')), v: 1 - x.y })) }),
    from(ph, n, params, m) {
      const span = P(m, params, 'range')
      const beat = ph.n / 4
      const pick = []
      for (const x of [...fit(melody(ph), 0, span)].sort((a, b) => (a.s % beat) - (b.s % beat) || a.s - b.s)) {
        if (!pick.some((y) => y.p === x.p)) pick.push(x)
        if (pick.length === 4) break
      }
      return { stones: pick.map((x, k) => ({ x: +(x.p / span).toFixed(3), y: +(0.3 + (k / 4) * 0.5).toFixed(3) })) }
    },
  },

  // the scribble is replayed evenly across the loop, so time = position in the stroke
  scribble: {
    to(st, n, params, m) {
      const N = st.pts.length, r = P(m, params, 'range')
      return { n, drums: false, notes: N ? contourNotes(Array.from({ length: n }, (_, i) => Math.round((1 - st.pts[Math.floor((i * N) / n)][1]) * r)), n) : [] }
    },
    from(ph, n, params, m) {
      const r = P(m, params, 'range')
      const notes = sorted(fit(melody(ph), 0, r))
      if (!notes.length) return { pts: [] }
      const pts = []
      let prev = null
      for (let k = 0; k < SLOTS; k++) {
        const t = (k / SLOTS) * ph.n
        const x = [...notes].reverse().find((y) => y.s <= t) || notes[notes.length - 1]
        const wob = Math.sin(k * 1.7) * 0.015
        pts.push([+clamp(0.08 + (0.84 * k) / SLOTS, 0, 1).toFixed(3), +clamp(1 - x.p / r + wob, 0, 1).toFixed(3), x !== prev ? 1 : 0])
        prev = x
      }
      return { pts }
    },
  },

  // a strum is a note; its pitch is where on the six strings it centres
  strum: {
    to(st, n) {
      const by = new Map()
      for (const [s, j, v] of st.hits) { const a = by.get(s) || []; a.push([j, v]); by.set(s, a) }
      return { n, drums: false, notes: [...by].map(([s, a]) => ({ s: (s * n) / SLOTS, p: Math.round((a.reduce((t, x) => t + x[0], 0) / a.length) * 2), v: Math.max(...a.map((x) => x[1])) })) }
    },
    from(ph) {
      const hits = []
      let prev = null
      for (const x of sorted(fit(melody(ph), 0, 10))) {
        const c = clamp(Math.round(x.p / 2), 1, 4)
        const strings = [c - 1, c, c + 1]
        if (prev !== null && x.p < prev) strings.reverse() // falling lines strum upward
        const slot = Math.round((x.s / ph.n) * SLOTS) % SLOTS
        strings.forEach((j) => hits.push([slot, j, +(x.v ?? 0.8).toFixed(2)]))
        prev = x.p
      }
      return { hits: hits.slice(0, 96) }
    },
  },

  // read: replay the flight and log every wire crossing. write: for each note, find the
  // firefly that is nearest the right height at the right moment and string a short wire across its path.
  swarm: {
    to(st, n, params, m) {
      const flies = makeFlies(P(m, params, 'seed'), P(m, params, 'count'))
      const r = P(m, params, 'range')
      const notes = []
      for (let s = 0; s < SLOTS; s++) {
        const p0 = s / SLOTS, p1 = (s + 1) / SLOTS
        for (const f of flies) {
          const [ax, ay] = flyPos(f, p0), [bx, by] = flyPos(f, p1)
          const w = st.wires.find((w) => intersect(ax, ay, bx, by, w[0], w[1], w[2], w[3]) !== null)
          if (w) { notes.push({ s: (s * n) / SLOTS, p: Math.round((1 - (w[1] + w[3]) / 2) * r), v: 0.8 }); break }
        }
      }
      return { n, drums: false, notes }
    },
    from(ph, n, params, m) {
      const flies = makeFlies(P(m, params, 'seed'), P(m, params, 'count'))
      const r = P(m, params, 'range')
      const beat = ph.n / 4
      const notes = [...fit(melody(ph), 1, r - 1)].sort((a, b) => (a.s % beat) - (b.s % beat) || a.s - b.s).slice(0, 8)
      const wires = notes.map((x) => {
        const t = x.s / ph.n, want = 1 - x.p / r
        let best = flies[0], bd = Infinity
        for (const f of flies) { const d = Math.abs(flyPos(f, t)[1] - want); if (d < bd) { bd = d; best = f } }
        const [px, py] = flyPos(best, t), [qx, qy] = flyPos(best, t + 0.003)
        const len = Math.hypot(qx - px, qy - py) || 1
        const ux = -(qy - py) / len, uy = (qx - px) / len
        return [px - ux * 0.05, py - uy * 0.05, px + ux * 0.05, py + uy * 0.05].map((v) => +clamp(v, 0, 1).toFixed(4))
      })
      return { wires }
    },
  },

  // read: every pass of 12 o'clock is a note, pitch from planet size. write: a run of
  // same-pitch notes evenly spaced becomes one faster planet; anything else gets its own slow one.
  orbits: {
    to(st, n, params, m) {
      const r = P(m, params, 'range')
      const notes = []
      for (const p of st.planets) {
        const laps = lapsOf(p.r)
        for (let c = Math.ceil(p.a); (c - p.a) / laps < 1; c++) notes.push({ s: ((c - p.a) / laps) * n, p: Math.round((1 - p.m) * r), v: 0.5 + p.m * 0.5 })
      }
      return { n, drums: false, notes }
    },
    from(ph, n, params, m) {
      const r = P(m, params, 'range')
      const band = (laps) => +(0.15 + (REVS.indexOf(laps) + 0.5) * (0.85 / REVS.length)).toFixed(3)
      const groups = new Map()
      for (const x of fit(melody(ph), 0, r)) { const a = groups.get(x.p) || []; a.push(x.s / ph.n); groups.set(x.p, a) }
      const planets = []
      for (const [p, at] of groups) {
        at.sort((a, b) => a - b)
        const c = at.length
        const even = c > 1 && REVS.includes(c) && at.every((t, k) => Math.abs(t - at[0] - k / c) < 0.02)
        const mass = +clamp(1 - p / r, 0.05, 1).toFixed(3)
        if (even) planets.push({ r: band(c), a: +(-c * at[0]).toFixed(4), m: mass })
        else at.forEach((t, k) => planets.push({ r: +(band(1) - 0.012 * (k % 4)).toFixed(3), a: +(-t).toFixed(4), m: mass }))
      }
      return { planets: planets.slice(0, 10) }
    },
  },

  embers: {
    to: (st, n, params, m) => ({ n, drums: false, notes: st.sparks.map((x) => ({ s: (x.s * n) / SLOTS, p: Math.round((1 - x.y) * P(m, params, 'range')), v: 0.8 })) }),
    from(ph, n, params, m) {
      const r = P(m, params, 'range')
      const per = SLOTS / n
      return {
        sparks: toSteps({ ...ph, notes: fit(melody(ph), 0, r) }, n).slice(0, 48).map((x, k) => ({
          s: mod(Math.round(x.s), n) * per,
          x: +(0.2 + 0.6 * ((k * 0.618) % 1)).toFixed(3),
          y: +clamp(1 - x.p / r, 0.1, 0.85).toFixed(3),
          born: null,
        })),
      }
    },
  },
}
