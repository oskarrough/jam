A live loop machine for a few friends and some strange instruments.

Try it on https://jam.0sk.ar

---

Everyone sits at one dial. Each seat is a ring, each ring is an instrument, and the hand sweeps round them all on one shared clock. You don't pick notes from a menu; you draw on your ring and the drawing plays. Tap your own seat to zoom into your instrument, and its glyph token to swap it for another. Robots are off by default: the point is that people make the music, not the code playing by itself. Turn them on when you want help, and they take empty seats and redraw their ring every few loops until a person sits down. Drag your own seat badge onto a robot's and it takes your ring as a motif and improvises on it in its own instrument: echo, a variation or two, then a call-and-response, round again.

It is meant to be **malleable**. Press `d` and the machine opens up: tempo, bars and meter, the key and the chords (one a bar, typed as numerals: `i III iv v`; players change them on the eye: tap a quarter to roll that bar's chord, drag up or down to scrub), which instrument sits in which ring and every one of its knobs, the network's latency, jitter and clock skew, the scheduler's lookahead. All of it changes live, mid-jam, for everyone. Controls aren't a developer backstage; they're part of the instrument.

And the instruments are **creative**, in the sense that each one is a different idea of what drawing a sound could mean. Fifteen so far:

- **bass**: an elastic riff; pull the knot to stretch it. **tide**: draw water, notes ring where it crosses the chord's threads. **bell**: tap for a bell, drag up to drop a bouncing marble. **bloom**: holds the room's chord; draw it higher and it opens up, the 7th and 9th flowering on top
- **drums**: paint kick, snare and hat in three bands
- **contour, steps, gears, sweep, drift, scribble, strum, swarm, orbits, embers**: ten stranger ones, described in [lab/README.md](lab/README.md)

## Words

- **seat**: your place at the machine, and who sits there (you, a friend, a robot). Code says seat too.
- **ring**: what's drawn on the dial for a seat. Only a picture.
- **instrument**: what you play, a gesture plus its sound. The thing you pick from the glyphs.
- **voice**: the sound alone. Bass, tide and bell each have a few voices to pick from.
- **erase** rubs out under the pen; **wipe** clears your whole ring.
- **loud** is one note's level; **level** is an instrument's volume. **range** is pitch spread, **decay** is tail length.
- **controls**: the `d` panel.

## Play

    python3 -m http.server          # any static server; there is no build
    open http://localhost:8000      # a second tab takes a second seat

On its own the page plays across tabs in one browser. With a relay it plays across machines:

    cd sync && pnpm i && pnpm start   # the page plus a WebSocket relay on :8787
    open http://localhost:8787      # finds the relay by itself

`/` is the one open jam everyone lands in; `/j/<name>` is your own (the page's "New jam" makes one). Your own starts blank: you're dealt an instrument with nothing drawn, and the other seats are bare rings until someone sits there and picks one. `?name=you` sets your name, `?ws=off` keeps you local.

"Share" copies a link that holds the song itself (loop, key and chords, every ring, the mix) in its hash, so it needs no relay. Opening it with a relay forks the song into a new `/j/<name>`; without one it loads into the local jam. Every jam also saves itself in this browser, per room: a reload brings a local jam back, and a relay jam that comes back empty is refilled. In the console, `jam.export()` is the song as data and `jam.import(songOrLink)` loads one (`src/song.js`).

Keys: `space` sound, `1`–`4` change seat, `e` or `Shift`-drag to erase, `Ctrl`/`⌘`-`Z` undo (`Shift` to redo), `d` controls. On a phone, tap with two fingers to undo, three to redo. In the mixer (the button by your badge), drag your dot for level and tone, tap any dot to mute that seat for everyone, hold one to hear it alone, just you.

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

`src/transport/local.js` and `sync/sync.js` share one API: `on('welcome'|'peers'|'apply'|'cursor'|'loop')`, `edit(seat, data)` (returns when it lands, on the next bar), `seatAt`, `cursor`, `setLoop` (next bar), `setMe`, `peers`, `debug()`, and a `clock` in shared milliseconds. Seat data is `{instrument, state, params}`; a seat is `peer.instrument === seat id`.
