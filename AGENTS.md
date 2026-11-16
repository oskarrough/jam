# Notes for agents

- No build. Serve the repo root (`python3 -m http.server`) or `cd sync && npm start` for the relay too.
- Work on `main`: no branches. Pull before you start and before you push; several agents push here.
- Browser checks: use `agent-browser` when it's installed; otherwise Playwright.
- `cd sync && npm test` runs the multiplayer tests (two headless peers plus the jam page).
- Instruments: see the contract in `src/instruments/index.js`. Deploy: `cf deploy` (see README).
