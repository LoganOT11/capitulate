# Capitulate

A Monopoly-style board game built with [Phaser 4](https://phaser.io/) and tested
with [Playwright](https://playwright.dev/) (Firefox).

## What's here

- A 40-tile board (4 corners + 9 tiles per side) rendered on a WebGL canvas.
- Two dice rendered as a pixel-art physics tumble animation
  (`src/render/pixel-dice-physics.js`): the dice lift, spin, drop and bounce off
  the floor/walls, settle on the face left pointing up, then glide home and the
  token moves. A second slot-machine renderer (`src/render/pixel-dice-deluxe.js`)
  drives the owned-dice bar.
- A token sprite that hops tile-by-tile around the board by the dice sum and
  wraps at tile 40.
- A live readout panel (`data-testid` elements) and a `window.__game` API so the
  canvas-based game is fully inspectable from Playwright.

## Dice renderers

The board uses two canvas dice renderers, both dependency-free and idle-stopping
(the `requestAnimationFrame` loop only runs while a roll is in flight):

- `src/render/pixel-dice-physics.js` (`window.PixelDicePhysics`) — the centre
  board cubes that genuinely tumble and bounce; the face left up is the result.
- `src/render/pixel-dice-deluxe.js` (`window.PixelDiceDeluxe`) — the slot-machine
  spinner for the owned-dice bar.

Standalone prototypes and the low-allocation reference engine live in `demos/`:

- `demos/pixel-dice.js` (`window.PixelDice`) — a low-allocation engine that draws
  all dice into one shared low-res buffer (fixed canvas memory regardless of dice
  count). Showcased by `demos/dice-demo.html` (roll 1–100 dice: `npm start`, then
  open `/demos/dice-demo.html`).
- `demos/pixel-dice-fixed.html`, `demos/pixel-dice-deluxe.html`,
  `demos/pixel-dice-roll.html` — earlier prototypes the renderers grew from.
- `docs/DICE_PERFORMANCE.md` — RAM investigation, optimizations, before/after.
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
