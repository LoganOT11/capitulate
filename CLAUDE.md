# CLAUDE.md

## Project Overview

Capitulate is a Monopoly-style board game built with **Phaser 4** (WebGL, loaded via CDN) and tested with **Playwright** (Firefox, globally installed).

## Key Commands

```bash
npm start           # Dev server at http://localhost:8080 (server.js)
npm test            # Run Playwright tests in Firefox (headless)
npm run test:headed # Run tests with a visible browser
```

Playwright auto-starts the dev server via `playwright.config.js`, so tests work without manually running `npm start`.

## Project Structure

```
index.html              # Entry point, loads Phaser 4.1.0 from CDN
server.js               # Zero-dependency Node.js static file server (port 8080)
playwright.config.js    # Playwright config — Firefox only, imports from playwright/test
src/
  main.js               # Phaser BoardScene: 40-tile board, token movement, game logic
  pixel-dice.js         # Standalone pixel-art dice renderer (no deps, canvas-based)
  style.css             # Layout styles
tests/
  game.spec.js          # Playwright tests using window.__game API
scripts/
  run-tests.js          # Test runner — resolves Playwright from global @playwright/cli
  measure-dice-ram.js   # Dice RAM measurement harness (Chromium headless)
```

## Architecture Notes

- **Phaser 4 is WebGL-only** — no `type` config needed, just `new Phaser.Game({...})`.
- **Phaser is loaded from CDN** (`cdn.jsdelivr.net/npm/phaser@4.1.0`), not bundled locally.
- **No local `npm install`** — Playwright resolves from the globally-installed `@playwright/cli` via `NODE_PATH` override in `scripts/run-tests.js`. Tests import `playwright/test` (not `@playwright/test`).
- **Board geometry**: 40 tiles on an 11×11 grid. Tile 0 (GO) is bottom-right, movement is counter-clockwise.
- **Dice are decoupled** from Phaser: `PixelDice` renders into its own `<canvas>` element in the UI panel. The Phaser scene triggers a roll and waits for the callback before moving the token.

## Testable Surface

The game exposes a `window.__game` API for Playwright:

| API | Description |
|-----|-------------|
| `window.__gameReady` | `true` once the scene is created |
| `window.__game.getState()` | `{ position, dice: [d1, d2], sum, rolling }` |
| `window.__game.roll()` | Roll two random dice and move |
| `window.__game.rollWith(a, b)` | Roll with fixed values (deterministic) |

State is also mirrored to the DOM via `data-testid` attributes: `die-1`, `die-2`, `sum`, `position`, `rolling`, `roll-button`.

## Roadmap

See `TODO.md` for the full feature plan: game engine core, procedural board generation, dice-roll battle system, async multiplayer, and progression/polish.

## Coding Conventions

- No build step — plain browser JS, no modules/bundlers.
- No dependencies in `package.json` — everything is either CDN-loaded or globally installed.
- Tests use `const { test, expect } = require('playwright/test')`.
- Use `data-testid` attributes for Playwright selectors.
