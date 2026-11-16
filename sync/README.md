# roughjam sync

Multiplayer layer for the campfire: presence, shared loop clock, per-lane state, quantized edits.

    cd sync && npm i && npm start        # serves the repo root + relay on :8787
    open 'http://localhost:8787/?ws=ws://localhost:8787'   # the jam, networked; open twice
    open http://localhost:8787/sync/     # bare sync demo with a plain debug readout
    LAG=60 npm start                     # simulate 60 ms one-way latency (±20%)
    npm test                             # headless: two peers, one with a +5 s skewed clock, plus the jam page
    BASE=http://127.0.0.1:8788 npm test  # same tests against a local Worker dev server on :8788 (Durable Object)

Other devices on the LAN: `http://<your-ip>:8787/?ws=ws://<your-ip>:8787`.

## Deploy (Cloudflare)

`worker.js` is the same relay as a Worker with one Durable Object per room (`?room=` picks it), using WebSocket hibernation and persisting loop + lanes to storage. `../cloudflare.config.ts` defines the Worker: repo root as static assets, `runWorkerFirst: ["/"]` so WebSocket upgrades reach the relay, the `ROOMS` Durable Object binding and the `jam.0sk.ar` domain. From the repo root:

    cf deploy
    open 'https://jam.0sk.ar/?ws=wss://jam.0sk.ar'

`room.js` holds the protocol; `server.js` (Node + `ws`) and `worker.js` (Durable Object) are thin wrappers.

## Why a tiny WebSocket server

We send control data (patterns, cursors), never audio, and edits are quantized to the next bar anyway, so a 20–40 ms saving from peer-to-peer buys nothing audible. What we do need is one time authority and one source of truth for late joiners. A ~100-line relay gives both, works behind any NAT without TURN, and has no vendor. Yjs/y-webrtc solves concurrent editing of the same document, which single-owner lanes avoid. Trystero/WebRTC stays an option for a serverless mode later: the client only depends on `send`/`onmessage`. The research thread reached the same v0 conclusion independently.

## Model

- **Clock.** Server ms is the shared timeline. Clients ping (burst of 10 on connect, then every 1.5 s), keep the last 24 samples, take the median offset of the fastest round trips, and slew at ≤1 ms per sample once locked (jump only if off by >30 ms). Local time is `performance.timeOrigin + performance.now()`, which is monotonic.
- **Loop.** `{bpm, beatsPerBar, bars, origin}`. Position is pure arithmetic from server time, so nothing ticks over the network. Tempo/length changes land on the next loop boundary and become the new origin, so phase stays continuous.
- **Lanes.** Opaque instrument `state` keyed by lane id. An edit is stamped with `at` = the next bar beyond `max(80, 1.5·RTT + 40) + 120` ms. Everyone, including the sender, switches at `at`. The server clamps `at` to never be in the past and snapshots lanes for late joiners.
- **Cursors.** Unquantized, unstored, for visual feedback of who's drawing where.
- **Audio.** Schedulers call `laneAt(lane, serverMs)` for each step they're about to schedule, and `clock.toAudio(ctx, serverMs)` for the AudioContext time. `apply` events fire 120 ms early for UI.

## API (`sync.js`)

    const t = createTransport({ url, room, name, instrument, color })
    t.on('welcome' | 'peers' | 'apply' | 'pending' | 'cursor' | 'loop' | 'status', fn)
    t.edit(lane, state)          -> server ms it lands at
    t.laneAt(lane, serverMs?)    -> state in effect then
    t.cursor(x, y, down, lane)   // 0..1
    t.setLoop({ bpm, bars, beatsPerBar })
    t.setMe({ name, instrument, color })
    t.clock.now() toLocal() toAudio(ctx, ms) pos() nextBar() nextLoop() loopAt()
    t.clock.instrumentClock(16)  -> { bpm, steps, startTime, pos() } for the instruments thread
    t.debug()                    -> { connected, peers, rtt, jitter, offset, drift, locked, pending, lateMs, ... }

Offline it still works solo: edits schedule locally against the local clock, and it reconnects with backoff.

## Measured (test.mjs, 40 ms ±20% simulated one-way lag, +5 s clock skew on one peer)

- skew recovered to within ~2 ms; peers agree on server time within ~2 ms
- edits land on a bar boundary, absent before it, identical on both after
- tempo change scheduled on both; late joiner receives lane snapshot

## Not yet

- `gesture` messages for live (non-pattern) playing: schedule remote ones +1 step, drop late ones.
- Output-latency compensation (`ctx.outputLatency`) per device; Bluetooth headphones will be 150+ ms behind.
- Lane ownership is advisory (anyone can write any lane). Fine among friends.
- Drift is reported (ms/min, after 20 s of samples) but not compensated beyond continuous re-sampling, which is enough for a jam.
