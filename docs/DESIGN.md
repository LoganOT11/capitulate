# Capitulate — Three-Tier Equipment System Design

This document defines the core equipment and progression systems for Capitulate. It replaces the flat item/stat model with a layered system inspired by auto-battlers (TFT, Dota Auto Chess) and roguelikes.

---

## Overview

Three tiers of equipment interact with dice:

| Tier | What | Where It Lives | How It Changes |
|------|------|---------------|----------------|
| **Die** | The core unit — has faces, base damage, level | Dice pool | Levels up via merging 3 copies |
| **Item** | Attaches to a die's slot — provides effects | Die item slots (1 per level) | Combines into stronger items (TFT-style) |
| **Die Modification** | Irreversible face mutation | Directly on the die's face array | Purchased from pip shop, applied once |

A Lv.3 die can hold 3 items and have multiple face modifications — it's your "carry."

---

## 1. Dice

### Properties

```js
{
  name: 'Ember Die',
  type: 'ember',           // merge family — only same-type dice can merge
  level: 1,                // 1–3
  baseDamage: 6,           // damage added per roll (before pip)
  faces: [1, 2, 3, 4, 5, 6],  // array of pip values — length can grow via mods
  speedMod: 1,             // ticks between rolls (1 = every tick)
  category: 'bought',      // movement | bought | combat
  itemSlots: [null, null, null],  // max = level (Lv.1 = 1, Lv.2 = 2, Lv.3 = 3)
  modifications: [],       // log of applied mods (for display)
}
```

### Face Distribution

Dice do NOT all have standard [1,2,3,4,5,6] faces. Face arrays define a die's identity:

| Die | Faces | Avg Roll | Feel |
|-----|-------|----------|------|
| Ember Die | [1,2,3,4,5,6] | 3.5 | Balanced starter |
| Boulder Die | [1,1,2,2,3,6] | 2.5 | Low average, high variance |
| Razor Die | [4,5,5,6,6,6] | 5.3 | Consistent high roller |
| Chaos Die | [1,1,1,6,6,6] | 3.5 | Polarized — feast or famine |
| Merchant Die | [1,1,2,3,4,5] | 2.7 | Weighted low (gold farming) |

The average pip matters, but the **distribution** matters more for synergies.

### Leveling (Merge)

Combine 3 dice of the **same type and level** to produce 1 die at the next level.

| Transition | Requirement | Bonuses |
|-----------|-------------|---------|
| Lv.1 → Lv.2 | 3× Lv.1 (same type) | +4 base damage, 1 face promotion, unlock slot 2 |
| Lv.2 → Lv.3 | 3× Lv.2 (9 total copies) | +6 base damage, 1 face promotion, unlock slot 3 |

**Face promotion:** Pick one face on the die and increase its pip by 1 (max 6). Chosen by the player at merge time. This lets you weight your carry die toward high rolls over time.

**Merge flow:**
1. Player selects a die as the "primary" (the one being upgraded)
2. Two other dice of the same type+level are consumed
3. Primary's items stay attached (they have room — new slot unlocked)
4. Sacrificed dice' items return to player inventory
5. Player picks a face to promote
6. Primary becomes next level with bonuses applied

### Die Registry (Starting Set)

```js
const DIE_REGISTRY = {
  ember_die: {
    name: 'Ember Die',
    baseDamage: 6,
    speedMod: 1,
    faces: [1, 2, 3, 4, 5, 6],
    category: 'bought',
    cost: 8,
    description: 'A reliable die. Average in every way.',
  },
  boulder_die: {
    name: 'Boulder Die',
    baseDamage: 10,
    speedMod: 2,  // slow — rolls every other tick
    faces: [1, 1, 2, 2, 3, 6],
    category: 'bought',
    cost: 12,
    description: 'Heavy and slow. High base, low average pip.',
  },
  razor_die: {
    name: 'Razor Die',
    baseDamage: 3,
    speedMod: 1,
    faces: [4, 5, 5, 6, 6, 6],
    category: 'bought',
    cost: 14,
    description: 'Light and precise. Low base, high pip average.',
  },
  chaos_die: {
    name: 'Chaos Die',
    baseDamage: 5,
    speedMod: 1,
    faces: [1, 1, 1, 6, 6, 6],
    category: 'bought',
    cost: 10,
    description: 'All or nothing. Polarized faces.',
  },
  merchant_die: {
    name: 'Merchant Die',
    baseDamage: 2,
    speedMod: 1,
    faces: [1, 1, 2, 3, 4, 5],
    category: 'bought',
    cost: 6,
    description: 'Weighted low for gold and utility synergies.',
  },
  ironclad_die: {
    name: 'Ironclad Die',
    baseDamage: 8,
    speedMod: 2,
    faces: [2, 3, 3, 4, 4, 5],
    category: 'combat',
    cost: 15,
    description: 'Steady and tough. Mid-range faces, high base.',
  },
};
```

---

## 2. Items

Items attach to dice in their item slots. Two items can be combined (TFT-style) to create a stronger item. Items provide effects that trigger based on die rolls.

### Item Properties

```js
{
  name: 'Fire Essence',
  tier: 1,                 // 1 = component, 2 = combined, 3 = masterwork
  tags: ['fire', 'damage'], // combination identifiers
  effect: {
    trigger: 'pip',        // 'pip' | 'base' | 'always'
    pip: 6,                // which pip triggers (if trigger === 'pip')
    type: 'damage',        // 'damage' | 'heal' | 'gold' | 'slow' | 'special'
    value: 4,              // magnitude
    scope: 'battle',       // 'battle' | 'board' | 'both'
  },
  description: '+4 damage on pip 6 in battle.',
}
```

### Combination Rules

Two items combine when placed in a "combine" interface (not auto-combined on the die). The player chooses which two items to fuse. Combination is based on the items' identities — specific recipes, not tag-matching.

Items on a die **cannot** be combined — they're locked in once attached. Combine in inventory first, then attach the result.

### Tier 1 — Component Items

Found in shops, loot drops, event rewards. Simple, single-effect.

| Item | Effect | Tags | Cost |
|------|--------|------|------|
| Iron Shard | +3 base damage (battle) | damage | 5g |
| Whetstone | +2 base damage (battle) | damage | 4g |
| Fire Essence | +4 damage on pip 6 (battle) | fire | 6g |
| Frost Essence | +3 damage on pip 1, enemy speed +0.5s (battle) | frost | 6g |
| Ember Core | +2 damage on even pips (battle) | fire | 5g |
| Vitality Herb | +3 heal on pip 3 (battle) | nature | 5g |
| Lucky Pebble | +2 gold on pip 1 (board) | fortune | 4g |
| Quartz Crystal | +1 base damage, +1 heal on pip 2 (both) | hybrid | 5g |

### Tier 2 — Combined Items

Fused from two specific Tier 1 items. Stronger, often dual-effect.

| Recipe | Result | Effect |
|--------|--------|--------|
| Iron Shard + Fire Essence | **Flameblade** | +5 base damage, +6 damage on pip 6 |
| Iron Shard + Whetstone | **War Mace** | +8 base damage |
| Fire Essence + Ember Core | **Inferno Core** | +4 damage on even pips, +6 on pip 6 |
| Frost Essence + Vitality Herb | **Frozen Heart** | +4 damage on pip 1, +5 heal on pip 3, slow |
| Lucky Pebble + Quartz Crystal | **Merchant's Sigil** | +3 gold on pip 1, +2 heal on pip 2, +1 base dmg |
| Vitality Herb + Vitality Herb | **Bloom of Life** | +8 heal on pip 3 |
| Fire Essence + Frost Essence | **Elemental Fusion** | +5 on pip 1, +5 on pip 6 |
| Lucky Pebble + Lucky Pebble | **Golden Idol** | +5 gold on pip 1 (board) |

### Tier 3 — Masterwork Items

Fused from two Tier 2 items. Build-defining, rare.

| Recipe | Result | Effect |
|--------|--------|--------|
| Flameblade + Inferno Core | **Phoenix Blade** | +8 base damage, +10 on pip 6, pip 6 triggers a second roll |
| War Mace + any T2 damage | **Titan's Grip** | +14 base damage, die speed -1 (faster) |
| Frozen Heart + Elemental Fusion | **Absolute Zero** | +7 on pip 1, +7 on pip 6, all enemies slowed |
| Golden Idol + Merchant's Sigil | **Crown of Greed** | +8 gold on pip 1, gain 1 gold per kill |

---

## 3. Die Modifications

Irreversible mutations applied directly to a die's face array. Purchased from the pip shop. Once applied, they cannot be undone.

### Modification Types

| Modification | Cost | Effect | Limit |
|-------------|------|--------|-------|
| **Pip Convert** | 10g | Convert all faces of pip X to pip Y | 1 per die |
| **Face Inject** | 15g | Add a 7th face (pip of your choice) to this die | 1 per die |
| **Weighted Face** | 12g | Pick a face — it now appears 2× as often (add duplicate) | 2 per die |
| **Face Promote** | Free (merge bonus) | Pick a face, pip +1 (max 6) | 1 per merge |

### Modification Stacking

Modifications are applied sequentially and permanently. Examples:

```
Ember Die [1,2,3,4,5,6]
  → Pip Convert (1→6): [6,2,3,4,5,6]
  → Weighted Face (6): [6,6,2,3,4,5,6]  (7 faces now)
  → Face Inject (6):   [6,6,2,3,4,5,6,6]  (8 faces, three 6s)
```

This die is now a "crit machine" — 3/8 faces are 6s. Irreversible. If you merged this into a Lv.2, all modifications carry over.

### Merge + Modification Interaction

When merging dice, all modifications from the primary die carry over. Modifications from sacrificed dice are **lost** — they're consumed in the merge. This creates a meaningful choice: which die do you invest modifications into?

---

## 4. Damage Formula

The old formula (`character.damage + pip`) is replaced. Damage is now entirely per-die:

```
per-die damage = die.baseDamage + pip + item_bonus
total damage per tick = Σ(per-die damage for all dice that rolled)
```

`character.damage` is removed. Character progression comes from:
- Die quality (level, base damage)
- Die modifications (face weighting)
- Items attached to dice
- Loop HP scaling (survivability only)

---

## 5. Economy

### Shop Types (Updated)

| Shop | Tile | Sells | Reroll |
|------|------|-------|--------|
| Item Shop | 10 | Tier 1 items, combination recipes | First free, then doubles |
| Pip Shop | 20 | Dice copies, die modifications | First free, then doubles |
| Potion Shop | 30 | Potions (consumable buffs) | First free, then doubles |

### Item Combining UI

Items are combined in inventory, NOT on dice. The player opens an inventory panel, selects two items, and clicks "Combine." If a valid recipe exists, the result appears. If not, the combination fails (items are kept).

### Merge UI

The player opens the dice panel, selects a die, and clicks "Merge." The game shows available copies of the same type+level. The player selects two sacrifices and confirms. Then picks a face to promote.

---

## 6. Build Archetypes

These emerge from the system rather than being hard-coded:

| Build | Core Die | Key Items | Strategy |
|-------|----------|-----------|----------|
| **Crit Carry** | Razor Die Lv.3 | Phoenix Blade | Stack 6-pips, double-roll on 6 |
| **Gold Farmer** | Merchant Die Lv.2 | Crown of Greed | Low pips = gold triggers, out-economy |
| **Sustain Tank** | Boulder Die Lv.3 | Frozen Heart + Bloom of Life | High base, heal on low pips, win by attrition |
| **Speed Stacker** | Ember Die Lv.2 | Titan's Grip | Fast rolls, high base damage, overwhelm |
| **Chaos Gambler** | Chaos Die Lv.3 | Inferno Core | Even-pip triggers on polarized faces |

---

## 7. Slot Interaction Rules

1. Items attach permanently once placed on a die — no swapping
2. Items on a die cannot be combined — combine in inventory first
3. Merging dice preserves the primary die's items (slot limit increases with level)
4. Sacrificed dice' items return to inventory on merge
5. Slot limit is hard: Lv.1 = 1 slot, Lv.2 = 2 slots, Lv.3 = 3 slots
6. Die modifications are irreversible once applied
7. Modifications from sacrificed dice are lost on merge (invest in your primary)

---

## 8. Migration from Current System

| Current | New |
|---------|-----|
| `character.damage` (base 10) | Removed — damage is per-die |
| `Item` class (pip trigger, global slots) | Redesigned — items attach to specific dice |
| `ItemSlots` (2×3 grid on character) | Replaced with per-die item arrays |
| `item-registry.js` (10 items) | Expanded to 3-tier item system with recipes |
| Die effects array | Replaced with item effects + modifications |
| Die `category` (movement/bought/combat) | Kept — movement dice still drive board steps |

### Files to Modify

| File | Change |
|------|--------|
| `src/engine/dice/die.js` | Add `level`, `baseDamage`, `faces[]`, `itemSlots[]`, `modifications[]` |
| `src/engine/dice/dice-pool.js` | Add merge logic, face promotion |
| `src/engine/character.js` | Remove `baseDamage`/`damage`, remove `ItemSlots`, add merge helpers |
| `src/engine/battle/battle-engine.js` | Change formula to `die.baseDamage + pip + item_bonus` |
| `src/engine/items/item.js` | Redesign for attachment to dice, add tier/recipe properties |
| `src/engine/items/item-registry.js` | Expand to full 3-tier catalogue with recipes |

### New Files to Create

| File | Purpose |
|------|---------|
| `src/engine/dice/die-registry.js` | Die templates with face distributions |
| `src/engine/dice/die-modifications.js` | Modification catalogue and application logic |
| `src/engine/items/item-combiner.js` | Recipe lookup and combination logic |
