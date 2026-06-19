# CLAUDE.md

## Project Overview

Capitulate is a Monopoly-style board game built with **Phaser 4** (WebGL, loaded via CDN) and tested with **Playwright** (Firefox, globally installed). Characters travel a 40-tile board collecting dice, items, and potions, fighting enemies at tile 0 each loop.

## Key Commands

```bash
npm start           # Dev server at http://localhost:8080 (server.js)
npm stop            # Kill the dev server (frees port 8080)
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
  main.js               # Phaser BoardScene: board, shops, movement, tile triggers
  style.css             # Layout, shop panel, readout styles
  render/               # Canvas dice renderers used by the game (decoupled from Phaser)
    pixel-dice-physics.js  # Centre board cubes: tumble + bounce physics (window.PixelDicePhysics)
    pixel-dice-deluxe.js   # Owned-dice bar: slot-machine spinner (window.PixelDiceDeluxe)
  engine/
    character.js         # Character class: stats, HP, dice pool, item slots, gold
    character-types.js   # Knight/Rogue/Mage/Cleric archetypes + passive triggers
    game-state.js        # State machine: board | battle | shop
    dice/
      die.js             # Die class: name, category (movement/bought/combat), speedMod, effects
      dice-pool.js       # Dice pool manager: batch rolling, face frequency counting
    items/
      item.js            # Item class (pip trigger, effect, adjacency) + ItemSlots (2×3 grid)
      item-registry.js   # Master item catalogue (10 items)
    battle/
      battle-engine.js   # Real-time batch combat engine (tick-based)
    shop/
      shop-engine.js     # Shop system: 3 types, 6-slot inventory, rerolling, discounts
demos/                  # Standalone dice prototypes — NOT part of the game
  pixel-dice.js          # Low-allocation reference engine (window.PixelDice)
  dice-demo.html         # Demo for pixel-dice.js — roll 1–100 dice
  pixel-dice-fixed.html  # Earliest prototype the renderers grew from
  pixel-dice-deluxe.html # Slot-machine prototype (source of pixel-dice-deluxe.js)
  pixel-dice-roll.html   # Physics-tumble prototype (source of pixel-dice-physics.js)
docs/
  DESIGN.md             # Three-tier equipment system design (dice → items → mods)
  DICE_PERFORMANCE.md   # demos/pixel-dice.js RAM investigation & optimization notes
  DICE_OPTIMIZATIONS.md # Board renderer (pixel-dice-physics) footprint + optimization roadmap
tests/
  game.spec.js          # Playwright tests using window.__game API
scripts/
  run-tests.js          # Test runner — resolves Playwright from global @playwright/cli
  measure-dice-ram.js   # demos dice RAM measurement harness (Chromium headless)
  measure-dice-fairness.js # Samples PixelDicePhysics outcomes at scale (fairness / chi-square)
```

## Architecture Notes

- **Phaser 4 is WebGL-only** — no `type` config needed, just `new Phaser.Game({...})`.
- **Phaser is loaded from CDN** (`cdn.jsdelivr.net/npm/phaser@4.1.0`), not bundled locally.
- **No local `npm install`** — Playwright resolves from the globally-installed `@playwright/cli` via `NODE_PATH` override in `scripts/run-tests.js`. Tests import `playwright/test` (not `@playwright/test`).
- **Board geometry**: 40 tiles on an 11×11 grid. Tile 0 (GO) is bottom-right, movement is counter-clockwise.
- **Dice renderers are decoupled** from Phaser (`src/render/`, canvas-based, attach to `window`): `PixelDicePhysics` (centre board `#dice-canvas`) tumbles two cubes whose settled top face is the roll result; `PixelDiceDeluxe` (`#dice-bar-canvas`) spins the owned-dice bar. Both stop their `requestAnimationFrame` loop when idle and draw a single rest frame.
- **Physics dice settle within a 6 s budget.** A roll runs lift → hover → phys → hold → tiltOut. `restDie()` marks a die settled once it has been on the floor, slow, and lying flat for `CALM_T`; the phys phase ends when both dice settle or at `PHYS_MAX` (the 6 s settle budget, matching the standalone prototype). The budget is generous on purpose: a die always reaches a natural rest before the cap, so the cap never freezes a still-bouncing die. The hot physics/render paths are allocation-light (per-die vertex rotations cached once per substep/frame in `_rv`/`_rvr`, in-place integration), and the RAF loop stops entirely when idle. Tune feel via `opts.cfg` — **do not** retune the physics constants without re-checking the look.
- **Dice are fair and verifiable.** `PixelDicePhysics(...).simulateResult([forced])` runs one roll's real physics headlessly (no rendering, no RAF, fixed 60 fps step) and returns the settled faces — it shares `beginRoll`/`advance` with the animated path, so sampled outcomes match the game. `scripts/measure-dice-fairness.js` uses it to sample the distribution at scale (~1000 rolls/s; each face ≈16.667%, χ² within fair range). Validate any physics change against it, plus a per-frame canvas hash, so neither the look nor the distribution drifts. Footprint + further wins: see `docs/DICE_OPTIMIZATIONS.md`.
- **No build step** — plain browser JS, no modules/bundlers. All engine classes attach to `window`.
- **Script load order matters** in `index.html` — dependencies (die, dice-pool, item, render/) load before consumers (character, main).

## Character System

- **Base stats**: 200 HP, 10 damage, 5s speed (all archetypes start identical)
- **HP scaling**: 1.8× per completed loop (200 → 360 → 648 → 1166 → ...)
- **Archetypes**: Knight (pair → +3 dmg, +8 HP), Rogue (roll 6 → −8% speed per 6), Mage (pair → +5 magic dmg), Cleric (TBD)
- **Passives trigger on board movement dice only** — not in combat, to prevent scaling explosion

## Dice System

Three categories, each with different roll contexts:

| Category | Rolls on Board | Rolls in Battle | Notes |
|----------|---------------|-----------------|-------|
| Movement (max 2) | Yes, manually | No | Trigger passives |
| Bought | Yes, auto | Yes, on tick | Board effects only on board; battle effects in combat |
| Combat | No | Yes, on tick | Battle-only |

**Batch rolling**: all active dice roll simultaneously. Face frequencies are counted for scaling and synergy effects.

## Item System

- **6 equip slots** arranged in a 2×3 grid
- Each item has a `pip` trigger (1–6) and an `effect` (damage/heal/gold)
- Multiple items can share the same pip — all trigger when that pip is rolled
- Items with `adjacent: true` chain-trigger their grid neighbors
- Items trigger in **battle only**, not on board rolls

## Corner Tiles

| Tile | Function | Color | Trigger |
|------|----------|-------|--------|
| 0 (GO) | Battle | Red ⚔ | Fight every time crossed |
| 10 | Item Shop | Purple 🛡 | 6 items, first reroll free |
| 20 | Dice Shop | Blue 🎲 | 6 dice, first reroll free |
| 30 | Potion Shop | Gold 🧪 | 6 potions, first reroll free |

- Shops trigger on **pass-through** (not just landing) — movement pauses, resumes after closing
- Landing exactly on a shop tile gives **−1 gold discount** on all costs
- Yellow highlight marks the final destination tile during movement

## Shop System

| Shop | Catalogue | Contents |
|------|-----------|----------|
| Items | 10 items | Damage, heal, gold, adjacency items |
| Dice | 8 dice | Combat, bought, speed variants (0.5×–2×) |
| Potions | 8 potions | Permanent stat boosts, temporary battle buffs, consumables |

**Reroll**: first free, then 5g → 10g → 20g → ... (doubles each time). Resets per visit.

## Battle Engine

- **Batch tick system**: all active dice roll simultaneously each tick
- Tick interval = `character.speed` seconds
- Each die: `baseDamage + pip` + item triggers for matching pips
- Face frequency counting for synergy effects
- Speed mod per die: `speedMod` controls how many ticks between rolls (1 = every tick, 2 = every other)

## Health Scaling Math

Target: ~13 ticks-to-kill at loop 7 (both sides, same HP scaling).

| Loop | HP (1.8×) | Dice | Dmg/tick | Ticks to kill |
|------|----------|------|----------|---------------|
| 0 | 200 | 2 | 37 | 5.4 |
| 1 | 360 | 4 | 74 | 4.9 |
| 2 | 648 | 6 | 111 | 5.8 |
| 3 | 1,166 | 8 | 165 | 7.1 |
| 5 | 3,778 | 12 | 248 | 15.2 |
| 7 | 12,242 | 16 | 296 | 41.4 |

Actual scaling will be higher than base+pip due to item procs — the 1.8× multiplier provides headroom.

## Testable Surface

The game exposes `window.__game` for Playwright:

| API | Description |
|-----|-------------|
| `window.__gameReady` | `true` once the scene is created |
| `window.__game.getState()` | `{ position, dice, sum, rolling, gameState, remainingSteps, character, shop }` |
| `window.__game.roll()` | Roll two random dice and move |
| `window.__game.rollWith(a, b)` | Roll with fixed values (deterministic) |
| `window.__game.getCharacter()` | Direct access to the Character instance |
| `window.__game.getShop()` | Direct access to the ShopEngine instance |
| `window.__game.closeShop()` | Close the current shop (for testing) |
| `window.__game.refresh()` | Redraw stat/inventory panels after direct character mutations |

DOM readout via `data-testid`: `die-1`, `die-2`, `sum`, `position`, `rolling`, `roll-button`, `char-name`, `char-type`, `char-hp`, `char-max-hp`, `char-damage`, `char-speed`, `char-loops`, `char-gold`, `char-passive`. Item slots: `item-slot-{row}-{col}` (2×3 grid).

## Layout

A single-page, no-scroll layout (`#app` fills `100vh`) with the board centred and panels on the edges. `fitLayout()` (on load + window resize) makes the board a square that fits beside the side panels and matches the dice panel to the board's width.

- **Left** (`#char-panel`) — full-height character window: name, archetype badge, ability name + description, and a vertical stat list.
- **Centre** (`#center-col`) — the Phaser board (held at native size in `#board`, CSS-`transform: scale()`-d from the top-left to fill the JS-sized `#board-stage`), with the centre dice tumble animation (`#dice-canvas`, `PixelDicePhysics`) overlaid via `#board-overlay`, and the horizontal **dice-storage panel** (`#dice-panel`) directly beneath it, width-matched to the board.
- **Right** (`#right-col`) — `#equip-panel` (6 equipment slots, `item-slot-{row}-{col}`) on top; `#roll-area` at the bottom-right corner holds the roll-status readout and the roll button.
- **Dice bar** — owned (bought) dice render on `#dice-bar-canvas` via `PixelDiceDeluxe` (`src/render/pixel-dice-deluxe.js`), a slot-machine spinner that lands on the rolled faces; "＋ Add Die" adds a die to the bar.
- **Shop overlay** — `#shop-panel` floats over the board (inside `#board-stage`). `#shop-toggle-btn` toggles a `collapsed` class (Hide ⇄ View) that hides the shop body so the board behind it is visible.

## Coding Conventions

- No build step — plain browser JS, no modules/bundlers.
- No dependencies in `package.json` — everything is either CDN-loaded or globally installed.
- All engine classes attach to `window` for cross-file access via `<script>` tags.
- Tests use `const { test, expect } = require('playwright/test')`.
- Use `data-testid` attributes for Playwright selectors.

## Roadmap

See `TODO.md` for the full feature plan: game engine core, procedural board generation, dice-roll battle system, async multiplayer, and progression/polish.
