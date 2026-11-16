# roughjam

A multiplayer loop jam in the browser. Friends gather round one strange machine, each takes a seat (one ring, one instrument), and draws on their ring to play over one shared loop.

    python3 -m http.server 8000     # or any static server; there is no build
    open http://localhost:8000      # open a second tab to take a second seat

No server needed for local play: tabs in one browser talk over BroadcastChannel. `?ws=ws://host:8787` switches to the network layer in `sync/` (`cd sync && npm i && npm start`). `?room=name` and `?name=you` also work. Press `d` for the debug panel, `space` for sound, `1`–`4` to change seat, `Shift`-drag to erase.

## Layout

    index.html              chrome
    src/main.js             wiring: transport, engine, view, seats, bots, debug
    src/transport/local.js  BroadcastChannel transport, same API as sync/sync.js, with fake latency, jitter, skew
    src/engine.js           audio graph, lanes, lookahead scheduler on the shared clock
    src/view.js             dial view (lanes wrapped round rings, dusk backdrop) and strips view, pointer mapping
    src/heart.js            the centrepiece: a Möbius band of Gaussian splats on its own WebGL2 canvas, driven by the clock and lane audio
    src/bots.js             bots that sit in empty seats and redraw their part every few loops
    src/debug.js            lil-gui panel: loop, lanes and instrument params, network, clock
    src/instruments/        instrument modules and the registry

## Interfaces

**Transport** (swap `local.js` for `sync/sync.js`): `on('welcome'|'peers'|'apply'|'cursor'|'loop', fn)`, `edit(lane, data) -> ms it lands at`, `laneAt(lane, ms)`, `cursor(x, y, down, lane)`, `setLoop({bpm, bars, beatsPerBar})` (next loop boundary), `setMe({name, instrument, color})`, `peers`, `id`, `debug()`. `clock`: `now()` shared ms, `toAudio(ctx, ms)`, `loopAt()`, `pos() -> {bar, beat, loopPhase}`, `nextBar()`, `nextLoop()`. A seat is `peer.instrument === lane id`.

**Lane data** on the wire: `{instrument, state, params}`. Your own edits play immediately for you; everyone else gets them on the next bar (debug: network → remote edits land).

**Instrument** (`src/instruments/index.js` has the full contract):

    export default { id, name, params, create(ctx), generate?(steps), sample?(steps) }
    ctx      = { audio, out, clock, params, color }
    clock    = { bpm, steps, stepDur, startTime, now(), pos(), playing }   // seconds on the AudioContext timeline
    instance = { state, setState(s), pointer(e), step(i, time, dur), frame(g, w, h, clock), clear?(), dispose() }

`pointer` gets `{type, x, y, id, alt, button}` with x, y in 0..1 (y = 0 at the top / outer edge). `frame` draws into a cleared w×h lane; the fire view wraps it round a ring with x = loop phase clockwise from 12 o'clock. Loop length is 16 × bars × beatsPerBar / 4 steps, so read `clock.steps`.

## Deploy

Static files, no build: the whole repo root is the site. `cloudflare.config.ts` deploys the site plus the `sync/` relay (a Durable Object per room) to Cloudflare: `cf deploy`, then open `https://jam.0sk.ar/?ws=wss://jam.0sk.ar`. See `sync/README.md`.
