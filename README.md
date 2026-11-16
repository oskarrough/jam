# roughjam

A loop machine for a few friends and some strange instruments.

Everyone sits at one dial. Each seat is a ring, each ring is an instrument, and the hand sweeps round them all on one shared clock. You don't pick notes from a menu; you draw on your ring and the drawing plays. Tap your own seat to zoom into your instrument, and its glyph token to swap it for another. Empty seats are taken by robots who redraw their part every few loops until a person sits down.

It is meant to be **malleable**. Press `d` and the machine opens up: tempo, bars and meter, which instrument sits in which ring and every one of its knobs, the network's latency, jitter and clock skew, the scheduler's lookahead. All of it changes live, mid-jam, for everyone. The panel isn't a developer backstage; it's part of the instrument.

And the instruments are **creative**, in the sense that each one is a different idea of what drawing a sound could mean. Fourteen so far:

- **bass, keys, bell**: draw a line, height is pitch
- **drums**: paint kick, snare and hat in three bands
- **contour, grid, rings, sweep, drift, scribble, strum, swarm, orbits, embers**: ten stranger ones, described in [lab/README.md](lab/README.md)

## Play

    python3 -m http.server          # any static server; there is no build
    open http://localhost:8000      # a second tab takes a second seat

On its own the page plays across tabs in one browser. With a relay it plays across machines:

    cd sync && npm i && npm start   # the page plus a WebSocket relay on :8787
    open http://localhost:8787      # finds the relay by itself

`/` is the one open jam everyone lands in; `/j/<name>` is your own (the page's "start your own" makes one). `?name=you` sets your name, `?ws=off` keeps you local.

Keys: `space` sound, `1`–`4` change seat, `e` or `Shift`-drag to erase, `d` the controls panel.

## Deploy

    cf deploy

`cloudflare.config.ts` ships the repo root as static assets plus the relay as a Worker with a Durable Object per jam, on jam.0sk.ar. The deployed page connects to the relay on its own. Details in [sync/README.md](sync/README.md).

## Inside

    index.html              the page
    src/main.js             wiring: transport, engine, view, seats, robots, panel
    src/engine.js           audio graph, lanes, lookahead scheduler on the shared clock
    src/view.js             the dial (lanes wrapped round rings) and a flat strips view
    src/heart.js            the centrepiece: a Möbius band of Gaussian splats, driven by the clock and the music
    src/picker.js           the glyph sheet for choosing your instrument
    src/jelly.js            the springy presses on buttons and badges
    src/bots.js             the robots
    src/debug.js            the panel (lil-gui, vendored)
    src/transport/local.js  tabs in one browser, same API as sync/sync.js, with fake latency, jitter and skew
    src/instruments/        instruments and the registry
    sync/                   the network: shared clock, quantized edits, relay for Node and Cloudflare
    lab/                    the ten lab instruments one at a time, each with its own panel

### Write an instrument

An instrument is one ES module. Register it in `src/instruments/index.js` (the full contract is there) and it shows up in every ring's menu.

    export default { id, name, params, create(ctx), generate?(steps), sample?(steps) }
    ctx      = { audio, out, clock, params, color }
    clock    = { bpm, steps, stepDur, startTime, now(), pos(), playing }   // AudioContext seconds
    instance = { state, setState(s), pointer(e), step(i, time, dur), frame(g, w, h, clock), clear?(), dispose() }

`frame` draws a plain rectangle; the dial wraps it round a ring, with x as loop phase clockwise from twelve and y = 0 on the outside. `pointer` gets `{type, x, y, alt}` in the same 0..1 space. `step` is called slightly ahead of time for each 16th. `state` is plain JSON and is the only thing that goes over the network. `params` become knobs in the panel. `generate` lets robots play it.

### Swap the transport

`src/transport/local.js` and `sync/sync.js` share one API: `on('welcome'|'peers'|'apply'|'cursor'|'loop')`, `edit(lane, data)` (returns when it lands, on the next bar), `laneAt`, `cursor`, `setLoop` (next loop boundary), `setMe`, `peers`, `debug()`, and a `clock` in shared milliseconds. Lane data is `{instrument, state, params}`; a seat is `peer.instrument === lane id`.
