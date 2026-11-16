# Notes for agents

- Commit to `main`, no branches. Pull (rebase) before you start and again before you push; several agents push here.
- `npm run check` before every push: lint, all instruments in a headless browser, the multiplayer tests. `-- --quick` skips the last.
- `npm run shots [-- <instrument>] [--phone]` puts dial and sheet screenshots in `shots/` (ignored). `npm run two-tabs` is the two-player smoke test.
- Words: **seat** (a place at the machine), **ring** (its drawing on the dial), **instrument** (gesture + sound), **voice** (the sound alone). Full list in README.
- New instrument: `npm run new-instrument <name>`; contract in `src/instruments/README.md`; `/?instrument=<id>` opens it.
- Poking around by hand: `agent-browser` if installed, else Playwright (`scripts/lib/browser.js` has a server and helpers).
- Deploy is Oskar's: pull, then `bun install && npx cf deploy` from `main`.
