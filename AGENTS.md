# Notes for agents

- `pnpm run setup` first: fetches, fast-forwards a clean checkout, installs deps, never discards work.
- Commit to `main`, no branches. Pull (rebase) before you start and again before you push; several agents push here.
- `pnpm check` (lint, 2 s; installs deps if missing) before every push. Touched `sync/` or `src/transport/`? Also `cd sync && NODE_PATH=$(npm root -g) node test.mjs` (needs Playwright).
- `pnpm shots [-- <instrument>] [--phone]` puts dial and sheet screenshots in `shots/` (ignored). `pnpm two-tabs` is the two-player smoke test. `pnpm perf` prints JS ms per frame (keep it low: taps wait behind it).
- Verify once: `check` always; a visible change gets one `pnpm shots -- <instrument> [--phone] [--at <ms>]` and you read the png (`--at 9000` jumps the clock and pins Math.random to 0, so an "every 8-14 s" effect is on screen); render cost gets `pnpm perf -- --quick`.
- Words: **seat** (a place at the machine), **ring** (its drawing on the dial), **instrument** (gesture + sound), **voice** (the sound alone). Full list in README.
- New instrument: `pnpm new-instrument <name>`; contract in `src/instruments/README.md`; `/?instrument=<id>` opens it.
- Poking around by hand: `npm i -g agent-browser` (1 s). `python3 -m http.server 8000 &`, then `agent-browser set viewport 390 844`, `agent-browser open 'http://localhost:8000/?ws=off&instrument=bell'` (`?instrument=x` seats you and zooms in), `agent-browser wait 1500`, `agent-browser screenshot /tmp/x.png`, read the png, `agent-browser close`. Skip `set device` (layout comes out wrong). Its snapshot can't see the canvas sheet, so screenshot, and prefer `pnpm shots`.
- Deploy: every push to `main` lints and deploys (.github/workflows/deploy.yml). Red lint = nothing ships.
- Before shipping: fun in 5 seconds without reading? strange over safe? one gesture?
