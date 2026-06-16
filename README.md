# Capitulate

A Monopoly-style board game built with [Phaser 4](https://phaser.io/) and tested
with [Playwright](https://playwright.dev/) (Firefox).

## What's here

- A 40-tile board (4 corners + 9 tiles per side) rendered on a WebGL canvas.
- Two dice rendered as a pixel-art 3D tumble animation (`src/pixel-dice.js`,
  integrated from `pixel-dice-fixed.html`). Rolling tumbles the dice, they settle
  on the rolled values, then the token moves.
- A token sprite that hops tile-by-tile around the board by the dice sum and
  wraps at tile 40.
- A live readout panel (`data-testid` elements) and a `window.__game` API so the
  canvas-based game is fully inspectable from Playwright.

## Dice animation

`src/pixel-dice.js` is a standalone, dependency-free, low-allocation dice engine
(`window.PixelDice({ canvas, ... })`). It draws all dice into one shared low-res
buffer scaled up with `image-rendering: pixelated`, so canvas memory is fixed
regardless of dice count, and it stops rendering entirely when idle.

- `dice-demo.html` — standalone demo; roll 1–100 dice (`npm start`, then open
  `/dice-demo.html`).
- `DICE_PERFORMANCE.md` — RAM investigation, the optimizations applied, and
  before/after measurements.
- `scripts/measure-dice-ram.js` — the measurement harness (Chromium headless).

## No install required

- **Phaser 4.1.0** is loaded from a CDN in `index.html`.
- **Playwright** uses the already-installed global `@playwright/cli` (which
  bundles Playwright + the Firefox browser). `scripts/run-tests.js` points module
  resolution at that bundled copy, so there is no local `npm install` step.

## Run it

```bash
npm start          # serves http://localhost:8080
```

## Test it

```bash
npm test           # runs tests/*.spec.js in Firefox
npm run test:headed
```

Playwright auto-starts the dev server (see `playwright.config.js`).

## Testable surface

The game exposes a small API on `window` for deterministic tests:

| Member                        | Description                                      |
| ----------------------------- | ------------------------------------------------ |
| `window.__gameReady`          | `true` once the scene is created.                |
| `window.__game.getState()`    | `{ position, dice: [d1, d2], sum, rolling }`.    |
| `window.__game.roll()`        | Rolls two random dice (1–6) and moves the token. |
| `window.__game.rollWith(a,b)` | Rolls with fixed dice values (deterministic).    |

The same state is mirrored to the DOM readout via `data-testid` attributes
(`die-1`, `die-2`, `sum`, `position`, `rolling`) and the `roll-button`.

> Tests import from `playwright/test` (not `@playwright/test`) because they run
> against the globally-installed Playwright rather than a local dependency.
