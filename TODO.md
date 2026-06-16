# Capitulate — Feature Roadmap

Transform Capitulate from a Monopoly board demo into an asynchronous multiplayer dice-battler with procedural boards, character progression, and loop-based PvP encounters.

---

## Phase 1: Game Engine Core

### 1.1 Character Stats System
- [ ] Define base stat schema: `{ hp, maxHp, damage, speed, defense, luck }`
- [ ] Create `Character` class in `src/engine/character.js`
- [ ] Implement stat modifiers (buffs/debuffs) with duration tracking
- [ ] Add HP management: `takeDamage(amount)`, `heal(amount)`, `isDead()`
- [ ] Add speed stat that influences dice roll bonuses or turn order in battles
- [ ] Persist character state across board loops (stats carry between laps)

### 1.2 Character Types
- [x] Define character archetypes — all start with identical base stats (100 HP, 10 dmg, 5s speed)
- [x] Create `CHARACTER_TYPES` registry in `src/engine/character-types.js`
- [x] Archetypes:
  - **Knight** — passive "Fortify": on pair, +3 damage and +8 max HP (healed). Trigger: 16.67%
  - **Rogue** — passive "Hustle": on sum ≥ 7, speed −8% (compounds, min 1.5s). Trigger: 58.33%
  - **Mage** — passive "Arcane Infusion": on pair, +5 damage and damage becomes magic type. Trigger: 16.67%
  - **Cleric** — passive TBD
- [x] Passives trigger on BOARD movement dice only (not in combat) to prevent scaling explosion
- [ ] Add character selection UI before the game starts
- [ ] Store selected type on the character instance for battle lookups

### 1.3 Inventory & Economy
- [ ] Create `Inventory` class in `src/engine/inventory.js`
- [ ] Track gold currency earned from events and victories
- [ ] Track consumable items (potions, buffs)
- [ ] Track equipment slots (weapon, armor, accessory) with stat bonuses
- [ ] Implement `equip(item)`, `use(item)`, `addGold(amount)` methods

---

## Phase 2: Procedural Board Generation

### 2.1 Board Generator
- [ ] Create `src/engine/board-generator.js`
- [ ] Define tile types: `shop`, `event`, `battle`, `rest`, `trap`, `treasure`, `empty`
- [ ] Fix 4 corner tiles as mandatory shop tiles (see 2.2)
- [ ] Implement weighted random distribution for remaining 36 tiles
- [ ] Ensure no more than 2 consecutive non-empty tiles
- [ ] Support difficulty scaling: more battle/trap tiles on later loops
- [ ] Generate a `BoardDefinition` object: `{ tiles: [{ index, type, data }] }`

### 2.2 Corner Shops (4 mandatory stops)
- [ ] **Tile 0 — Armory**: buy/sell weapons and armor
- [ ] **Tile 10 — Alchemist**: buy potions, buff scrolls, cure debuffs
- [ ] **Tile 20 — Trainer**: spend gold to permanently boost a stat
- [ ] **Tile 30 — Mystic**: gamble gold for random rare items or stat changes
- [ ] Create `Shop` class with inventory, pricing, and buy/sell logic
- [ ] Each shop has a curated item pool + random filler items
- [ ] Shops restock/rescale prices each loop

### 2.3 Event Tiles
- [ ] Create `src/engine/events/` directory with one file per event category
- [ ] Define event interface: `{ id, description, choices[], resolve(choice, character) }`
- [ ] Implement event categories:
  - **Beneficial**: find gold, free heal, temporary buff
  - **Harmful**: take damage, lose gold, gain debuff
  - **Neutral/Story**: lore text, choose-your-outcome
  - **Special**: warp forward/backward, skip next tile, peek at upcoming tiles
- [ ] Create an event pool (20–30 events) with rarity tiers
- [ ] Events are selected from the pool during procedural generation

### 2.4 Tile Rendering
- [ ] Update `drawBoard()` to accept a `BoardDefinition` and render tile types visually
- [ ] Color-code tiles by type (shop=purple, battle=red, event=blue, etc.)
- [ ] Add icons or labels for tile types on the board
- [ ] Show upcoming tile preview when hovering or during movement

---

## Phase 3: Dice Roll Battle System

### 3.1 Battle Engine
- [ ] Create `src/engine/battle.js` with a `Battle(attacker, defender)` class
- [ ] Battle flow:
  1. Both sides roll dice (modified by speed stat)
  2. Higher total attacks first (ties = simultaneous)
  3. Attack roll (dice + damage stat) vs. defense roll (dice + defense stat)
  4. Net damage applied to defender HP
  5. Repeat until one side reaches 0 HP
- [ ] Cap rounds at 10 to prevent infinite fights; winner = higher HP%
- [ ] Return a `BattleResult` object: `{ winner, loser, rounds[], turnsUsed }`
- [ ] Support `BattleOptions`: `{ playerDiceOverride, enemyDiceOverride }` for testing

### 3.2 Dice Modifiers
- [ ] Speed bonus: `floor(speed / 5)` extra pips added to each die roll
- [ ] Luck bonus: chance to reroll 1s (luck % chance)
- [ ] Character passive abilities trigger at defined moments (first hit, on kill, etc.)
- [ ] Equipment bonuses add to damage/defense rolls
- [ ] Consumable buffs apply temporary modifiers for one battle

### 3.3 Battle UI
- [ ] Create a battle overlay/modal that appears when a battle tile is triggered
- [ ] Show both combatants with HP bars, stats, and character art placeholder
- [ ] Animate dice rolls using `PixelDice` with attack/defense labels
- [ ] Display round-by-round log: "Player rolled 8 (5+3) + 4 damage = 12 attack vs 9 defense. Enemy takes 3 damage."
- [ ] Show victory/defeat screen with rewards (gold, XP, items)
- [ ] Add "Continue" button to return to the board

### 3.4 Enemy Definitions
- [ ] Create `src/engine/enemies.js` with enemy archetypes
- [ ] Enemies scale with loop number: base stats × (1 + loop × 0.15)
- [ ] Define 5–8 enemy types (Slime, Bandit, Golem, Dragon, etc.) with varying stat weights
- [ ] Assign enemies to battle tiles during procedural generation
- [ ] Some enemies drop specific loot on defeat

---

## Phase 4: Asynchronous Multiplayer

### 4.1 Loop Tracking
- [ ] Add a `loopCount` variable to game state (increments each full board pass)
- [ ] Persist loop count to `localStorage` (and eventually server)
- [ ] Update `window.__game.getState()` to include `loopCount`
- [ ] Display current loop number in the UI readout panel

### 4.2 Ghost Opponents
- [ ] Create `src/engine/matchmaker.js`
- [ ] When a player completes a loop, save a "ghost" snapshot: `{ character, stats, inventory, loopCount, timestamp }`
- [ ] When a player enters a battle tile on loop N, look up a ghost from loop N-1 or N
- [ ] Ghosts are stored in `localStorage` for local dev; future: server API
- [ ] If no ghost is available, generate a scaled NPC opponent

### 4.3 Async Battle Resolution
- [ ] Ghost opponent uses the stats/items from their snapshot — no real-time connection needed
- [ ] Battle plays out identically to PvE but against the ghost's stats
- [ ] Victory over a ghost yields bonus rewards (more gold, rare items)
- [ ] Track win/loss record against ghosts per loop

### 4.4 Multiplayer Data Layer (Future)
- [ ] Define API contract for ghost submission and retrieval:
  - `POST /api/ghosts` — submit a ghost snapshot after loop completion
  - `GET /api/ghosts?loop=N` — retrieve a ghost for loop N
- [ ] Server stores ghosts in a database, ranked by loop count
- [ ] Implement matchmaking: match players within ±1 loop, prefer similar power level
- [ ] Add player profile: name, total loops, win/loss record, favorite character

---

## Phase 5: Progression & Polish

### 5.1 Experience & Leveling
- [ ] Award XP for battles won, events completed, loops finished
- [ ] Level-up grants stat point allocation (player chooses which stat to boost)
- [ ] Level scaling: enemies and events scale with player level + loop count

### 5.2 Game Flow
- [ ] Title screen with character selection and "New Game" / "Continue" options
- [ ] Save/load game state to `localStorage`
- [ ] Game over screen when HP reaches 0 (roguelike: restart from loop 1)
- [ ] Victory condition: survive X loops or defeat a final-loop boss

### 5.3 Visual & Audio Polish
- [ ] Add sprite art or styled placeholders for characters and enemies
- [ ] Tile animations (shop sparkle, battle flames, event shimmer)
- [ ] Sound effects for dice rolls, hits, purchases, events
- [ ] Screen shake or flash on critical hits

---

## File Structure Target

```
src/
  engine/
    character.js          # Character class with stats, HP, equipment
    character-types.js    # Knight, Rogue, Mage, Cleric definitions
    inventory.js          # Gold, items, equipment management
    board-generator.js    # Procedural tile layout per loop
    tile-types.js         # Tile type constants and config
    battle.js             # Dice-roll battle engine
    enemies.js            # Enemy archetypes and scaling
    events/
      index.js            # Event pool and selection
      beneficial.js       # Positive outcome events
      harmful.js          # Negative outcome events
      special.js          # Warp, skip, peek events
    shops/
      armory.js           # Tile 0 shop
      alchemist.js        # Tile 10 shop
      trainer.js          # Tile 20 shop
      mystic.js           # Tile 30 shop
    matchmaker.js         # Ghost opponent lookup (local + future server)
  ui/
    battle-overlay.js     # Battle modal component
    shop-modal.js         # Shop interface
    event-modal.js        # Event choice interface
    character-select.js   # Character type picker
    hud.js                # HP bar, gold, loop counter
  main.js                 # Phaser scene (refactored to use engine)
  pixel-dice.js           # Unchanged — dice renderer
tests/
  engine/
    character.test.js
    battle.test.js
    board-generator.test.js
    inventory.test.js
  game.spec.js            # Updated Playwright integration tests
```

---

## Implementation Order

```
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4  →  Phase 5
(engine)    (board)     (battles)   (multi)     (polish)
```

Each phase builds on the previous. Phases 1–3 can be developed and tested locally with no server. Phase 4 starts with `localStorage` ghosts and adds the server layer later.
