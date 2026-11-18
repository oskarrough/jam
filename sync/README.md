# roughjam sync

Multiplayer layer for the jam: presence, shared loop clock, per-seat state, quantized edits.

    cd sync && pnpm i && pnpm start        # serves the repo root + relay on :8787
    open 'http://localhost:8787/?ws=ws://localhost:8787'   # the jam, networked; open twice
    open http://localhost:8787/sync/     # bare sync demo with a plain debug readout
    LAG=60 pnpm start                     # simulate 60 ms one-way latency (±20%)
    pnpm test                             # headless: two peers, one with a +5 s skewed clock, plus the jam page
    BASE=http://127.0.0.1:8788 pnpm test  # same tests against a local Worker dev server on :8788 (Durable Object)

Jams: `/` is the one open jam everyone lands in; `/j/<name>` is your own (the page's "New jam" makes one). Both `server.js` and the Worker serve the page there with `<base href="/">`. The page goes multiplayer on its own when the host answers `/sync/relay`; `?ws=off` keeps it to this browser.

Recordings: the deck's record token waits for the next loop, captures 8 bars (seat state per bar, who sat where, cursors), POSTs to `/api/r` and returns `/r/<id>`, which replays read-only in the full machine (`src/record.js`). The Worker stores each one in its own Durable Object of the existing `JamRoom` class, so `cloudflare.config.ts` needs no new binding; `server.js` keeps them in memory.

Other devices on the LAN: `http://<your-ip>:8787/?ws=ws://<your-ip>:8787`.

## Deploy (Cloudflare)

`worker.js` is the same relay as a Worker with one Durable Object per room (`?room=` picks it), using WebSocket hibernation and persisting loop + seats to storage. `../cloudflare.config.ts` defines the Worker: repo root as static assets, `runWorkerFirst: ["/"]` so WebSocket upgrades reach the relay, the `ROOMS` Durable Object binding and the `jam.0sk.ar` domain. From the repo root:

    cf deploy
    open 'https://jam.0sk.ar/?ws=wss://jam.0sk.ar'

`room.js` holds the protocol; `server.js` (Node + `ws`) and `worker.js` (Durable Object) are thin wrappers.

## Why a tiny WebSocket server

We send control data (patterns, cursors), never audio, and edits are quantized to the next bar anyway, so a 20–40 ms saving from peer-to-peer buys nothing audible. What we do need is one time authority and one source of truth for late joiners. A ~100-line relay gives both, works behind any NAT without TURN, and has no vendor. Yjs/y-webrtc solves concurrent editing of the same document, which single-owner seats avoid. Trystero/WebRTC stays an option for a serverless mode later: the client only depends on `send`/`onmessage`. The research thread reached the same v0 conclusion independently.

## Model

- **Clock.** Server ms is the shared timeline. Clients ping (burst of 10 on connect, then every 1.5 s), keep the last 24 samples, take the median offset of the fastest round trips, and slew at ≤1 ms per sample once locked (jump only if off by >30 ms). Local time is `performance.timeOrigin + performance.now()`, which is monotonic.
- **Loop.** `{bpm, beatsPerBar, bars, origin}`. Position is pure arithmetic from server time, so nothing ticks over the network. Tempo/length changes land on the next bar; the new origin is set back so the loop keeps counting (bar 3 stays bar 3).
- **Seats.** Opaque instrument `state` keyed by seat id. An edit is stamped with `at` = the next bar beyond `max(80, 1.5·RTT + 40) + 120` ms. Everyone, including the sender, switches at `at`. The server clamps `at` to never be in the past and snapshots seats for late joiners.
- **Cursors.** Unquantized, unstored, for visual feedback of who's drawing where.
- **Audio.** Schedulers call `seatAt(seat, serverMs)` for each step they're about to schedule, and `clock.toAudio(ctx, serverMs)` for the AudioContext time. `apply` events fire 120 ms early for UI.

## API (`sync.js`)

[`src/transport/local.js`](../src/transport/local.js) implements the same transport API for tabs in one browser. The clock uses shared milliseconds. A peer occupies a seat when `peer.seat` matches its id. Seat data carries `{instrument, state, params}` and an optional loop length `len`.

    const t = createTransport({ url, room, name, seat, color })
    t.on('welcome' | 'peers' | 'apply' | 'pending' | 'cursor' | 'loop' | 'status', fn)
    t.edit(seat, data)          -> server ms it lands at
    t.seatAt(seat, serverMs?)    -> state in effect then
    t.cursor(x, y, down, seat)   // 0..1
    t.setLoop({ bpm, bars, beatsPerBar })
    t.setMe({ name, seat, color })
    t.peers                     // current peers
    t.clock.now() toLocal() toAudio(ctx, ms) pos() nextBar() nextLoop() loopAt()
    t.clock.instrumentClock(16)  -> { bpm, steps, startTime, pos() } for the instruments thread
    t.debug()                    -> { connected, peers, rtt, jitter, offset, drift, locked, pending, lateMs, ... }

Offline it still works solo: edits schedule locally against the local clock, and it reconnects with backoff.

## Measured (test.mjs, 40 ms ±20% simulated one-way lag, +5 s clock skew on one peer)

- skew recovered to within ~2 ms; peers agree on server time within ~2 ms
- edits land on a bar boundary, absent before it, identical on both after
- tempo change scheduled on both; late joiner receives seat snapshot

## Not yet

- `gesture` messages for live (non-pattern) playing: schedule remote ones +1 step, drop late ones.
- Output-latency compensation (`ctx.outputLatency`) per device; Bluetooth headphones will be 150+ ms behind.
- Seat ownership is advisory (anyone can write any seat). Fine among friends.
- Drift is reported (ms/min, after 20 s of samples) but not compensated beyond continuous re-sampling, which is enough for a jam.
