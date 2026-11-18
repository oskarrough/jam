# Notes for agents

- `pnpm run setup` first: fetches, fast-forwards a clean checkout, installs deps, never discards work.
- Several agents share this checkout and its `@`. To land only your paths, commit from your own workspace: `jj workspace add --name <you> /tmp/<you> -r main@origin`, copy your files in, commit, push, `jj workspace forget <you>`.
- Commit to `main`, no branches. Pull (rebase) before you start and again before you push; several agents push here.
- After you push, move the main checkout to the new main so Oskar's local server serves it: `cd /home/osk/sites/jam && jj git fetch && jj new main@origin`, but only if `jj st` there shows no changes.
- `pnpm check` (lint, 2 s; installs deps if missing) before every push. Touched `sync/` or `src/transport/`? Also `cd sync && NODE_PATH=$(npm root -g) node test.mjs` (needs Playwright).
- `pnpm shots [-- <instrument>] [--phone]` puts dial and sheet screenshots in `shots/` (ignored). `pnpm two-tabs` is the two-player smoke test. `pnpm perf` prints JS ms per frame (keep it low: taps wait behind it).
- Verify once: `check` always; a visible change gets one `pnpm shots -- <instrument> [--phone] [--at <ms>]` and you read the png (`--at 9000` jumps the clock and pins Math.random to 0, so an "every 8-14 s" effect is on screen); render cost gets `pnpm perf -- --quick`.
- Words: **seat** (a place at the machine), **ring** (its drawing on the dial), **instrument** (gesture + sound), **voice** (the sound alone). Full list in README.
- New instrument: `pnpm new-instrument <name>`; contract in `src/instruments/README.md`; `/?instrument=<id>` opens it.
- Poking around by hand: `npm i -g agent-browser` (1 s). `python3 -m http.server 8000 &`, then `agent-browser set viewport 390 844`, `agent-browser open 'http://localhost:8000/?ws=off&instrument=bell'` (`?instrument=x` seats you and zooms in), `agent-browser wait 1500`, `agent-browser screenshot /tmp/x.png`, read the png, `agent-browser close`. Skip `set device` (layout comes out wrong). Its snapshot can't see the canvas sheet, so screenshot, and prefer `pnpm shots`.
- Deploy: every push to `main` lints and deploys (.github/workflows/deploy.yml). Red lint = nothing ships.
- Robots are off by default, on purpose: humans make the music, robots are opt-in help (the robot token). A playtest finding empty seats silent is not a bug.
- Before shipping: fun in 5 seconds without reading? strange over safe? one gesture?
