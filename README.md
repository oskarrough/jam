A live loop machine for a few friends and some strange instruments.

Try it on https://jam.0sk.ar

---

Everyone sits at one dial. A seat is a ring, a ring is an instrument. You draw and the drawing plays. The hand sweeps round them all on one shared clock. Robots are off unless you want help.

It is meant to be **malleable**. Press `d` and the machine opens up: tempo, bars and meter, which instrument sits in which ring and every one of its knobs. All of it changes live, mid-jam, for everyone. Controls aren't a developer backstage; they're part of the instrument. Hold a tab on the eye and choose a chord from the ladder. The key sits under the eye.

And the instruments are **creative**, in the sense that each one is a different idea of what drawing a sound could mean.

### Beat

- drums: Paint kick, snare and hat.
- gears: Turn gears to shift the beat.
- embers: Throw sparks that pop and burn out.
- steps: Tap notes and pull their tails to hold them.

### Low

- bass: Pull the knot to stretch the riff.

### Chords

- bloom: Draw higher to open the chord.
- sweep: Sweep a filter and hear your hand played back.
- drift: Drop stones that drone.
- strum: Swipe strings into a repeating strum.
- tide: Draw water that rings where it crosses a thread.

### Tune

- bell: Drop marbles that ring on the bounce.
- scribble: Scribble vowels from oo to ee.
- swarm: String wires across fireflies' paths.
- orbits: Place planets that play as they go round.
- contour: Draw a line that sings.

Play them one at a time in [the lab](lab/README.md).

## Play

The sheet’s bracket sets loop length. Inks underneath are brushes for the next stroke.

Keys: `space` sound, `1`–`4` seats, `e` erase, `Ctrl`/`⌘`-`Z` undo, `d` controls.

Share makes a link to the song. In the console: `jam.export()` / `jam.import()`.

Run `python3 -m http.server` to play across local tabs, or [run a relay](sync/README.md) to play across machines.

## Words

- **seat**: your place at the machine, and who sits there (you, a friend, a robot). Code says seat too.
- **ring**: what's drawn on the dial for a seat. Only a picture.
- **instrument**: what you play, a gesture plus its sound. The thing you pick from the glyphs.
- **voice**: the sound alone. Bass, tide and bell each have a few, picked per stroke as inks.
- **erase** rubs out under the pen; **wipe** clears your whole ring.
- **loud** is one note's level; **level** is an instrument's volume. **range** is pitch spread, **decay** is tail length.
- **controls**: the `d` panel.

## Deploy

    cf deploy    # CI does this on every push to main

`cloudflare.config.ts` ships the repo root as static assets plus the relay as a Worker with a Durable Object per jam, on jam.0sk.ar. The deployed page connects to the relay on its own. Details in [sync/README.md](sync/README.md).

## Inside

    index.html              the page
    src/main.js             wiring: transport, engine, view, seats, robots, panel
    src/engine.js           audio graph, seats, lookahead scheduler on the shared clock
    src/view.js             the dial (seats wrapped round rings) and a flat strips view
    src/heart.js            the centrepiece: a Möbius band of Gaussian splats, driven by the clock and the music
    src/backdrop.js         the landscape and sky squiggles, painted once per resize in the heart's dithered, stroked hand
    src/picker.js           the glyph sheet for choosing your instrument
    src/jelly.js            the springy presses on buttons and badges
    src/ghost.js            the ghost hand: shows an instrument's gesture once when you sit or switch
    src/undo.js             undo and redo for your own ring, for any instrument
    src/bots.js             the robots, and riffing on a motif you hand them
    src/phrase.js           parts as neutral phrases, and the musical moves robots vary them with
    src/debug.js            the panel (lil-gui, vendored)
    src/transport/local.js  tabs in one browser, same API as sync/sync.js, with fake latency, jitter and skew
    src/instruments/        one file per instrument, the registry, and README.md with the contract
    scripts/new-instrument.js  pnpm new-instrument <name>
    sync/                   the network: shared clock, quantized edits, relay for Node and Cloudflare
    lab/                    the ten lab instruments one at a time, each with its own panel

### Write an instrument

Every instrument is one file in `src/instruments/`, and there's room for more. To start one:

    pnpm new-instrument pebbles
    open 'http://localhost:8000/?instrument=pebbles'

That writes a small working instrument, registers it, and the link seats you with it, zoomed in. An instrument does five things: keep its drawing as plain JSON (that's all that goes over the network), take pointer input, schedule notes ahead of time, draw itself twice (a thin summary round its ring, and a big sheet when zoomed), and tidy up. The contract is in [src/instruments/README.md](src/instruments/README.md).

`?instrument=<id>` works for any of them: `/?instrument=strum` sits you down at the strings.

### Swap the transport

`src/transport/local.js` and `sync/sync.js` share one API: `on('welcome'|'peers'|'apply'|'cursor'|'loop')`, `edit(seat, data)` (returns the shared time it will land), `seatAt`, `cursor`, `setLoop` (next bar), `setMe`, `peers`, `debug()`, and a `clock` in shared milliseconds. Seat data is `{instrument, state, params}`; a peer occupies a seat when `peer.seat` matches its id.
