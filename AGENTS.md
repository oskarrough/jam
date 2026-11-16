# Notes for agents

- No build. Serve the repo root (`python3 -m http.server`) or `cd sync && npm start` for the relay too.
- Work on `main`: no branches. Pull before you start and before you push; several agents push here.
- Browser checks: use `agent-browser` when it's installed; otherwise Playwright.
- `cd sync && npm test` runs the multiplayer tests (two headless peers plus the jam page).
- Instruments: one file each in `src/instruments/`, contract in `src/instruments/README.md`. `npm run new-instrument <name>` scaffolds one; `/?instrument=<id>` opens it.
- Deploy: pull, then `bun install && npx cf deploy` from `main`; it ships the repo root plus the relay to jam.0sk.ar.
