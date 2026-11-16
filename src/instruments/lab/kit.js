// Shared musical kit for the lab instruments: voices, key, scale, chord progression.
// Everything time-related is in AudioContext seconds.

export const SCALES = {
  'minor pent': [0, 3, 5, 7, 10],
  'major pent': [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'hira joshi': [0, 2, 3, 7, 8],
}
export const ROOTS = { C: 48, D: 50, E: 52, F: 53, G: 55, A: 57, B: 59 }

// i  VI  III  VII over natural minor, one chord per loop
const PROGRESSION = [0, 5, 2, 6]
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10]

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// Musical kit shared by every instrument on one AudioContext: voices, key, scale, chords.
const kits = new WeakMap()
export function kit(audio) {
  let k = kits.get(audio)
  if (k) return k

  const noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate)
  {
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }

  const key = { root: 'A', scale: 'minor pent' }
  const rootMidi = () => ROOTS[key.root] ?? 57

  // scale degree (any integer) to midi
  function degree(deg, oct = 0) {
    const s = SCALES[key.scale] || SCALES['minor pent']
    const n = s.length
    const o = Math.floor(deg / n)
    const d = ((deg % n) + n) % n
    return rootMidi() + s[d] + 12 * (o + oct)
  }
  // triad (midi) for the loop that contains absStep
  function chord(absStep, steps = 16) {
    const loop = Math.floor(absStep / steps)
    const r = PROGRESSION[((loop % 4) + 4) % 4]
    const tone = (i) => {
      const o = Math.floor((r + i) / 7)
      return rootMidi() + NATURAL_MINOR[(r + i) % 7] + 12 * o
    }
    return { root: tone(0), notes: [tone(0), tone(2), tone(4)], name: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'][r] }
  }

  k = { noise, key, degree, chord, voices: makeVoices(audio, noise) }
  kits.set(audio, k)
  return k
}

// ---------------------------------------------------------------------------
// voices: each schedules itself at `time` and cleans up after

function makeVoices(ac, noise) {
  const ksCache = new Map()

  function env(g, time, peak, a, d) {
    g.gain.setValueAtTime(0.0001, time)
    g.gain.linearRampToValueAtTime(peak, time + a)
    g.gain.exponentialRampToValueAtTime(0.0001, time + a + d)
  }

  return {
    tone(dest, { freq, time, gain = 0.2, type = 'sine', a = 0.005, d = 0.4, detune = 0 }) {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = type
      o.frequency.value = freq
      o.detune.value = detune
      env(g, time, gain, a, d)
      o.connect(g).connect(dest)
      o.start(time)
      o.stop(time + a + d + 0.05)
    },

    // two-operator FM bell
    bell(dest, { freq, time, gain = 0.15, d = 1.2, ratio = 3.5, index = 2 }) {
      const c = ac.createOscillator()
      const m = ac.createOscillator()
      const mg = ac.createGain()
      const g = ac.createGain()
      c.frequency.value = freq
      m.frequency.value = freq * ratio
      mg.gain.setValueAtTime(freq * index, time)
      mg.gain.exponentialRampToValueAtTime(freq * 0.05, time + d * 0.6)
      m.connect(mg).connect(c.frequency)
      env(g, time, gain, 0.002, d)
      c.connect(g).connect(dest)
      c.start(time); m.start(time)
      c.stop(time + d + 0.1); m.stop(time + d + 0.1)
    },

    // soft marimba: fundamental plus a fast-decaying 4th harmonic
    marimba(dest, { freq, time, gain = 0.2, d = 0.6 }) {
      this.tone(dest, { freq, time, gain, d })
      this.tone(dest, { freq: freq * 4, time, gain: gain * 0.35, d: d * 0.15 })
    },

    // Karplus-Strong string rendered to a buffer once per pitch
    pluck(dest, { freq, time, gain = 0.3, damp = 0.996, bright = 0.5, pan = 0 }) {
      const k = `${Math.round(freq * 10)}:${damp}:${bright}`
      let buf = ksCache.get(k)
      if (!buf) {
        const sr = ac.sampleRate
        const len = Math.floor(sr * 2.2)
        buf = ac.createBuffer(1, len, sr)
        const d = buf.getChannelData(0)
        const N = Math.max(2, Math.round(sr / freq))
        const ring = new Float32Array(N)
        let prev = 0
        for (let i = 0; i < N; i++) {
          // lowpassed noise burst; bright controls the excitation colour
          const n = Math.random() * 2 - 1
          prev = prev + (n - prev) * (0.2 + bright * 0.8)
          ring[i] = prev
        }
        let p = 0
        for (let i = 0; i < len; i++) {
          const next = (p + 1) % N
          const v = ring[p]
          ring[p] = damp * 0.5 * (ring[p] + ring[next])
          d[i] = v
          p = next
        }
        ksCache.set(k, buf)
      }
      const src = ac.createBufferSource()
      src.buffer = buf
      const g = ac.createGain()
      g.gain.value = gain
      const pn = ac.createStereoPanner()
      pn.pan.value = pan
      src.connect(g).connect(pn).connect(dest)
      src.start(time)
    },

    noise(dest, { time, freq = 2000, q = 1, gain = 0.3, d = 0.08, type = 'bandpass', pan = 0 }) {
      const src = ac.createBufferSource()
      src.buffer = noise
      const f = ac.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      const g = ac.createGain()
      env(g, time, gain, 0.001, d)
      const pn = ac.createStereoPanner()
      pn.pan.value = pan
      src.connect(f).connect(g).connect(pn).connect(dest)
      src.start(time, Math.random() * 1.5)
      src.stop(time + d + 0.05)
    },

    kick(dest, { time, gain = 0.6, pitch = 52 }) {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.frequency.setValueAtTime(pitch * 3, time)
      o.frequency.exponentialRampToValueAtTime(pitch, time + 0.06)
      env(g, time, gain, 0.002, 0.35)
      o.connect(g).connect(dest)
      o.start(time)
      o.stop(time + 0.45)
    },

    snare(dest, { time, gain = 0.3 }) {
      this.noise(dest, { time, freq: 1800, q: 0.7, gain, d: 0.16 })
      this.tone(dest, { freq: 190, time, gain: gain * 0.6, d: 0.08, type: 'triangle' })
    },

    hat(dest, { time, gain = 0.12, open = false }) {
      this.noise(dest, { time, freq: 8000, q: 0.5, gain, d: open ? 0.25 : 0.04, type: 'highpass' })
    },
  }
}
