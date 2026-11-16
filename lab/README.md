# instrument lab

Ten ways to play one lane of the campfire. The modules live in `src/instruments/lab/` and are registered with the main jam, so any seat can pick them; this page plays them one at a time with their own debug panel.
(`npx serve .` or `python3 -m http.server`), click, and press 1–0 to switch.
No build step, no network: lil-gui is vendored.

All ten share one clock and one key. Each draws into a plain rectangle, so the fire view
can wrap it into a ring. Everything you draw is the instrument's `state`, plain JSON,
mostly well under 1 KB.

| # | instrument | gesture | intended feel |
|---|---|---|---|
| 01 | contour | draw a line; x is time, y is pitch | singing with a pencil; the glide makes sloppy lines sound deliberate |
| 02 | grid | paint cells | the control group: precise, familiar, a little office-like |
| 03 | rings | rotate and stretch euclidean rings, each with its own length | turning a lock; uneven ring lengths drift into polymeter on their own |
| 04 | sweep | hold and move over a held chord; records at the playhead | DJ hands: you perform the filter, then it performs you back |
| 05 | drift | drop up to five drone stones in a pond | slow and ambient; the chord breathes and rotates without you |
| 06 | scribble | scribble freely; replayed in stroke order as vowel grains | handwriting as voice; frantic scribbles stutter, calm ones hum |
| 07 | strum | swipe across six strings; strums record and follow the chords | the most social one: a rhythm you play once turns into a progression |
| 08 | swarm | string wires across fireflies' fixed flight paths | composing by placing tripwires, not notes; surprising, deterministic |
| 09 | orbits | place planets; size is pitch, distance is speed | watch-it-happen polyrhythm; 3 and 6 lap orbits fall between the 16ths |
| 10 | embers | throw sparks above the fire; they pop on the grid and burn out | percussion that decays unless someone keeps feeding it |

The "intended feel" column is design intent from building them, not a listening test.

## interface

```js
export default {
  id, name, how,                       // how: one-line gesture hint
  params: { key: { value, min, max, step } | { value, options } | { value: bool } },
  create(ctx) -> instance,             // ctx = { audio, out, clock, params, color? }
}

instance = {
  state,                               // JSON, the thing to sync
  pointer({ type: 'down'|'move'|'up', x, y, id, px?, py?, w?, h?, pressed?, alt? }),
  step(i, time, dur),                  // i = step in loop, time in AudioContext seconds
  frame(g, w, h, clock),               // draw into a w×h rectangle
  setState(s), clear(), randomize(), dispose(),
}

clock = { bpm, steps, stepDur, startTime, now(), pos(), playing?, abs()? }
```

Shared sound comes from `kit(audio)` in `src/instruments/lab/kit.js`: voices (bell, pluck, marimba,
kick, snare, hat, noise), the key (`degree(n, oct)`), and a four-chord progression
that advances once per loop (`chord(absStep, steps)`).

Instruments whose motion depends on time (swarm, orbits) compute it purely from loop
phase and a seed, so every peer sees and hears the same thing from the same state.

## debug ui

Right panel: transport (play, bpm, 16/32 steps, root, scale, backing beat, solo),
lane (switch, level, reverb, mute, clear, randomize, copy state), and the focused
instrument's params. The state drawer under the strip shows the live JSON and its size.
`window.lab` exposes lanes, clock and engine in the console.
