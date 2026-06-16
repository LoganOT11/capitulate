# Capitulate — Feature Roadmap

Transform Capitulate from a Monopoly board demo into an asynchronous multiplayer dice-battler with procedural boards, character progression, and loop-based PvP encounters.

---

## Phase 1: Game Engine Core

### 1.1 Character Stats System
- [x] Define base stat schema: `{ hp: 200, damage: 10, speed: 5s }`
- [x] Create `Character` class in `src/engine/character.js`
- [x] Add HP management: `takeDamage(amount)`, `heal(amount)`, `isDead`
- [x] HP scales 1.8× per completed loop (200 → 360 → 648 → ...)
- [x] Gold tracking on character
- [x] `dicePool` and `itemSlots` integrated on Character
- [x] Serialization: `toJSON()` / `fromJSON()` for ghost snapshots
- [ ] Implement stat modifiers (buffs/debuffs) with duration tracking
- [ ] Defense/resistance stats (physical, magical)

### 1.2 Character Types
- [x] Define character archetypes — all start with identical base stats
- [x] Create `CHARACTER_TYPES` registry in `src/engine/character-types.js`
- [x] Archetypes with board-roll passives:
  - **Knight** — "Fortify": on pair, +3 damage and +8 max HP (healed). Trigger: 16.67%
  - **Rogue** — "Hustle": for each 6 rolled, speed −8% (compounds, min 1.5s). Trigger: 30.56%
  - **Mage** — "Arcane Infusion": on pair, +5 damage and damage becomes magic type. Trigger: 16.67%
  - **Cleric** — passive TBD
- [x] Passives trigger on BOARD movement dice only (not in combat)
- [x] `triggerCount()` for multi-hit triggers (Rogue double-6)
- [ ] Add character selection UI before the game starts

### 1.3 Dice System
- [x] `Die` class in `src/engine/dice/die.js` — name, category, speedMod, effects
- [x] `DicePool` in `src/engine/dice/dice-pool.js` — 3 categories (movement/bought/combat)
- [x] Batch rolling: all active dice roll simultaneously, face frequency counted
- [x] `speedMod` per die: controls tick skip (1 = every tick, 2 = every other)
- [x] Board-scoped effects on bought dice (gold, heal)
- [x] 8 starter dice in the dice shop catalogue

### 1.4 Item System
- [x] `Item` class in `src/engine/items/item.js` — pip trigger, effect, adjacency flag
- [x] `ItemSlots` — 2×3 grid with 4-directional adjacency
- [x] Items trigger when ANY die rolls the matching pip
- [x] Adjacent items chain-trigger if flagged
- [x] 10 starter items in `item-registry.js` (damage, heal, gold, adjacency)
- [x] Item shop with 6-slot inventory, rerolling, and discount support

### 1.5 Economy
- [x] Gold currency on character
- [x] 3 shop types: items (tile 10), dice (tile 20), potions (tile 30)
- [x] 6-slot inventory per shop, random selection from catalogue
- [x] Reroll system: first free, then 5g → 10g → 20g → ... (doubles)
- [x] −1 gold discount when landing exactly on a shop tile
- [x] Potion shop: consumable (instant), permanent (stat boost), temporary (battle-limited)
- [ ] Track temporary buff duration across battles

---

## Phase 2: Procedural Board Generation

### 2.1 Board Generator
- [ ] Create `src/engine/board-generator.js`
- [ ] Define tile types: `event`, `battle`, `rest`, `trap`, `treasure`, `empty`
- [ ] Implement weighted random distribution for the 36 non-corner tiles
- [ ] Ensure no more than 2 consecutive non-empty tiles
- [ ] Support difficulty scaling: more battle/trap tiles on later loops
- [ ] Generate a `BoardDefinition` object: `{ tiles: [{ index, type, data }] }`

### 2.2 Event Tiles
- [ ] Create `src/engine/events/` directory with one file per event category
- [ ] Define event interface: `{ id, description, choices[], resolve(choice, character) }`
- [ ] Implement event categories:
  - **Beneficial**: find gold, free heal, temporary buff
  - **Harmful**: take damage, lose gold, gain debuff
  - **Neutral/Story**: lore text, choose-your-outcome
  - **Special**: warp forward/backward, skip next tile, peek at upcoming tiles
- [ ] Create an event pool (20–30 events) with rarity tiers

### 2.3 Tile Rendering
- [ ] Update `drawBoard()` to accept a `BoardDefinition` and render tile types visually
- [ ] Color-code tiles by type (event=blue, trap=orange, etc.)
- [ ] Add icons or labels for tile types on the board

---

## Phase 3: Battle System

### 3.1 Battle Engine (Batch Tick)
- [x] Create `src/engine/battle/battle-engine.js`
- [x] Batch tick: all active dice roll simultaneously each tick
- [x] Tick interval = `character.speed` seconds
- [x] Damage formula: `baseDamage + pip + item triggers`
- [x] Face frequency counting for synergy effects
- [x] Per-die speedMod (skip-tick system)
- [ ] Wire battle engine to tile 0 trigger (currently a stub that gives 10 gold)
- [ ] Battle UI: overlay/modal with HP bars, dice rolls, damage log
- [ ] Victory/defeat resolution with rewards
- [ ] Continue button to return to board

### 3.2 Enemy Definitions
- [ ] Create `src/engine/enemies.js` with enemy archetypes
- [ ] Enemies scale with loop number
- [ ] Define 5–8 enemy types (Slime, Bandit, Golem, Dragon, etc.)
- [ ] Enemy dice pools and item loadouts
- [ ] Loot drops on defeat

### 3.3 Battle Integration
- [ ] Battle triggers when crossing tile 0
- [ ] Ghost opponent lookup (Phase 4) or NPC generation
- [ ] Post-battle: heal (Cleric passive), gold rewards, XP
- [ ] Game over when HP reaches 0

---

## Phase 4: Asynchronous Multiplayer

### 4.1 Loop Tracking
- [x] `loopCount` increments on board completion
- [x] HP scales by 1.8× per loop
- [x] Displayed in UI readout panel
- [ ] Persist loop count to `localStorage` (and eventually server)
- [ ] Save/load game state to `localStorage`

### 4.2 Ghost Opponents
- [ ] Create `src/engine/matchmaker.js`
- [ ] When a player completes a loop, save a "ghost" snapshot: `{ character, stats, dicePool, itemSlots, loopCount, timestamp }`
- [ ] When a player enters battle at tile 0 on loop N, look up a ghost from loop N-1 or N
- [ ] Ghosts stored in `localStorage` for local dev; future: server API
- [ ] If no ghost available, generate a scaled NPC opponent

### 4.3 Async Battle Resolution
- [ ] Ghost uses stats/items from their snapshot — no real-time connection
- [ ] Battle plays out identically to PvE but against ghost's stats
- [ ] Victory over ghost yields bonus rewards
- [ ] Track win/loss record against ghosts per loop

### 4.4 Multiplayer Data Layer (Future)
- [ ] Define API contract:
  - `POST /api/ghosts` — submit ghost after loop completion
  - `GET /api/ghosts?loop=N` — retrieve a ghost for loop N
- [ ] Server stores ghosts in database, ranked by loop count
- [ ] Matchmaking: match within ±1 loop, prefer similar power level
- [ ] Player profile: name, total loops, win/loss record, favorite character

---

## Phase 5: Progression & Polish

### 5.1 Experience & Leveling
- [ ] Award XP for battles won, events completed, loops finished
- [ ] Level-up grants stat point allocation
- [ ] Level scaling: enemies and events scale with player level + loop count

### 5.2 Game Flow
- [ ] Title screen with character selection
- [ ] Save/load game state to `localStorage`
- [ ] Game over screen when HP reaches 0 (roguelike: restart from loop 1)
- [ ] Victory condition: survive X loops or defeat a final-loop boss

### 5.3 Visual & Audio Polish
- [ ] Add sprite art or styled placeholders for characters and enemies
- [ ] Tile animations (shop sparkle, battle flames, event shimmer)
- [ ] Sound effects for dice rolls, hits, purchases, events
- [ ] Screen shake or flash on critical hits

---

## Implementation Order

```
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4  →  Phase 5
(engine)    (board)     (battles)   (multi)     (polish)
```

Phase 1 is substantially complete. Phase 2 (procedural board) and Phase 3 (battle UI + enemies) are the next priorities. Phase 4 builds on the ghost snapshot system already designed into Character.toJSON().
