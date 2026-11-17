# Notes for agents

- Commit to `main`, no branches. Pull (rebase) before you start and again before you push; several agents push here.
- Fresh or stale worktree? `git fetch && git reset --hard origin/main && npm i --no-save` first (check needs oxlint).
- `npm run check` (lint, 2 s) before every push. Touched `sync/` or `src/transport/`? Also `cd sync && NODE_PATH=$(npm root -g) node test.mjs` (needs Playwright).
- `npm run shots [-- <instrument>] [--phone]` puts dial and sheet screenshots in `shots/` (ignored). `npm run two-tabs` is the two-player smoke test. `npm run perf` prints JS ms per frame (keep it low: taps wait behind it).
- Verify in proportion, one pass, then ship: logic/cleanup → `npm run check` only. Visible change → one `npm run shots -- <instrument> [--phone]`, read the png, done. Render cost → `npm run perf`. No hand-driven browsing unless a shot looks wrong.
- Words: **seat** (a place at the machine), **ring** (its drawing on the dial), **instrument** (gesture + sound), **voice** (the sound alone). Full list in README.
- New instrument: `npm run new-instrument <name>`; contract in `src/instruments/README.md`; `/?instrument=<id>` opens it.
- Poking around by hand: `agent-browser` if installed, else Playwright (`scripts/lib/browser.js` has a server and helpers).
- Deploy is Oskar's: pull, then `bun install && npx cf deploy` from `main`.
- Before shipping: fun in 5 seconds without reading? strange over safe? one gesture?
