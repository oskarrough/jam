# Instruments

Each instrument is one file in this folder, and each one is a different answer to "what could drawing a sound mean?" Make your own:

    pnpm new-instrument pebbles      # writes pebbles.js from a working template and registers it
    python3 -m http.server              # from the repo root
    open 'http://localhost:8000/?instrument=pebbles'

The link seats you with your instrument and opens it up. Edit the file, reload, play. Everyone in the jam gets it once it's deployed.

Words: an **instrument** is a gesture plus its sound; its **voice** is the sound alone (bass, tide and bell each offer a few voices). A **seat** is where someone plays it; its **ring** is the drawing on the dial. Knob names to reuse: `level`, `range`, `decay`, `octave`.

## The contract

```js
export default {
	id: 'pebbles', // unique, lowercase; also the ?instrument= value
	name: 'Pebbles', // shown in the picker and the seat list
	how: 'Tap to drop…', // one line on the gesture
	glyph: '<path d="…"/>', // inner SVG for the picker, 32×32 box; strokes inherit, class="f" fills
	params: {
		// knobs in controls (d); the instance reads ctx.params live
		decay: { value: 0.5, min: 0.05, max: 2, step: 0.05 },
		shape: { value: 'sine', options: ['sine', 'square'] },
	},
	playhead: 'x', // optional: the host draws the playhead along x (default), 'y', or false if you show time yourself
	demo: (shape, aspect) => [
		[
			[0.1, 0.5],
			[0.6, 0.3],
		],
	], // optional: the gesture a ghost hand plays once when someone switches to you; strokes of [x, y], one point is a tap (helpers in lib/demo.js)
	generate(steps, params) {}, // optional: a fresh state; robots play your instrument with it
	sample(steps) {}, // optional: the state an empty jam starts with
	optional: ['vel'], // optional: state keys an older saved part may lack; setState fills them in
	inks: [['soft', '<circle …/>'], ['hard', '…']], // optional: brushes under the sheet, [name, 32×32 svg]; the first is the default. The instance keeps `ink` (get/set), and each stroke records its ink in state, so others hear it
	modes: ['pitch', 'loud'], // optional: what a drag draws, as word chips beside the inks; the first is the default. The instance keeps `mode` (get/set); local to the player, never in state
	create(ctx) {
		return instance
	},
}
```

`ctx` is `{ audio, out, clock, params, color, setLen }`. Connect your sound to `out`, never to `audio.destination`. `color` is your ring's colour as `#rrggbb`. `clock` is `{ bpm, steps, stepDur, startTime, now(), pos(), playing }` in AudioContext seconds, with `pos()` the fractional step in the loop. `clock` is your seat's own: each seat sets its loop length on its sheet (1, 2, 4 or 8 bars, like a clip), so `clock.steps` and `pos()` are your loop's while `startTime` stays the jam's. It changes live, so read `clock.steps` rather than assuming 16. `ctx.setLen(n)` sets it from a gesture of yours (n steps, `null` for the jam's length); arrays in your state that are one entry per step are cut or repeated to fit.

The instance does five things:

| part      | method                            |                                                                                                                                                                                                                                                       |
| --------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| serialize | `state`, `setState(s)`, `clear()` | `state` is plain JSON and is the only thing that crosses the network. Keep it small (well under 1 KB). `setState` gets a peer's state, or `null` to empty the seat.                                                                                   |
| play      | `pointer(e)`                      | `{ type: 'down'│'move'│'up', x, y, alt, shape }`, with x and y in 0..1. y = 0 is the top, which is the outside of your ring. `alt` means erase (Shift, or the eraser).                                                                                |
| schedule  | `step(i, time, dur)`              | Called slightly ahead of time for each 16th, where `i` is the step in the loop and `time` is when it sounds. Schedule audio at `time`, never "now".                                                                                                   |
| draw      | `frame(g, w, h, clock, shape)`    | Draw into a cleared w×h canvas (CSS px). `shape` is `'ring'` (a long thin strip the dial wraps round your ring, so x is loop phase clockwise from twelve) or `'sheet'` (zoomed in, big and flat). The ring is a summary; the sheet is where you play. |
| tidy      | `dispose()`                       | Let go of timers and long-lived nodes.                                                                                                                                                                                                                |

If someone sends a state your instrument doesn't understand, the registry ignores it and keeps your current one, so a mismatch can't break a seat.

## Controls

The controls should vanish into the instrument. A knob gets built in only when it matters enough to play with, and then in one of two places:

1. The drawing is the control. Height, length, speed and shape of the stroke carry the parameter: bass's knot stretches the riff, gears' outward drag adds pulses, steps' bracket sets the length. Prefer this; if a knob can become part of the gesture, make it so.
2. The tool row. Anything that changes what your next stroke does (inks, modes like steps' pitch/loud/chance) is a round chip in the one row under the sheet, in the brush style. Nowhere else.

Everything else stays off the sheet. `d` always holds every param, as the whole machine opened up, so it's never where a control gets moved to; the only question is whether to build a knob in. No clickable words on the sheet, nothing outside its frame but the tool row. Legends and readouts that take no taps (drums' row names, the chord) are fine.

## Helpers

`lib/util.js` has small timing, pointer and drawing helpers (`withPointer`, `subSlots`, `flashes`, `view`, `isStrip`) plus synth parts (`env`, `osc`, `noiseSrc`, `mtof`). `lib/kit.js` holds the jam's harmony and some voices: `kit(audio).degree(d, octave)` is a scale degree in the jam's key, `kit(audio).chord(absStep)` the triad for that bar. The key and chords travel with the loop, so use these rather than fixed notes and your instrument follows when someone changes them. `lib/voiced.js` turns `[[name, fn], …]` into a choice of voice: a `voice` param that syncs, listed in the sheet's corner (bass, tide and bell use it). `lib/voices.js` is a trimmed copy of the jukebox synth's voices (synbass, 808, rhodes, glock…); `voice('rhodes', -9)` plays one, trimmed in dB.

The [lab](../../lab/) plays the ten drawable instruments one at a time, each with its own panel.
