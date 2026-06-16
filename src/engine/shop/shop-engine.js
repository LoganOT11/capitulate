// --- ShopEngine -----------------------------------------------------------
// Manages shop state: inventory, purchasing, rerolling.
// Three shop types: items, dice, potions.
// Each shop has 6 inventory slots.  First reroll is free, subsequent cost gold.
//
// Corner tiles:
//   0  — Battle (handled elsewhere)
//   10 — Item shop
//   20 — Dice shop
//   30 — Potion shop

const SHOP_TILE_ITEM   = 10;
const SHOP_TILE_DICE   = 20;
const SHOP_TILE_POTION = 30;
const SHOP_BATTLE      = 0;

const SHOP_INVENTORY_SIZE = 6;

// Reroll cost doubles each time until the shop is closed (resets per visit).
const REROLL_BASE_COST = 5;

// --- Catalogues -----------------------------------------------------------
// Each entry is a factory function that returns a fresh instance.

const ITEM_CATALOGUE = [
  { id: 'fire_sword',      cost: 15, create: () => createItem('fire_sword') },
  { id: 'sharp_fang',      cost: 8,  create: () => createItem('sharp_fang') },
  { id: 'thunder_lance',   cost: 12, create: () => createItem('thunder_lance') },
  { id: 'shadow_blade',    cost: 10, create: () => createItem('shadow_blade') },
  { id: 'vitality_crystal', cost: 10, create: () => createItem('vitality_crystal') },
  { id: 'lifebloom',        cost: 12, create: () => createItem('lifebloom') },
  { id: 'lucky_coin',       cost: 6,  create: () => createItem('lucky_coin') },
  { id: 'merchants_ring',   cost: 10, create: () => createItem('merchants_ring') },
  { id: 'chain_lightning',  cost: 14, create: () => createItem('chain_lightning') },
  { id: 'echo_gem',         cost: 10, create: () => createItem('echo_gem') },
];

const DICE_CATALOGUE = [
  { id: 'iron_die',        cost: 10, create: () => new Die({ name: 'Iron Die',        category: 'combat', speedMod: 1 }) },
  { id: 'swift_die',       cost: 15, create: () => new Die({ name: 'Swift Die',       category: 'combat', speedMod: 0.5 }) },
  { id: 'heavy_die',       cost: 12, create: () => new Die({ name: 'Heavy Die',       category: 'combat', speedMod: 2 }) },
  { id: 'merchant_die',    cost: 18, create: () => new Die({
    name: "Merchant's Die", category: 'bought', speedMod: 1,
    effects: [
      { scope: 'board', type: 'gold', pip: 3, value: 3 },
      { scope: 'board', type: 'gold', pip: 6, value: 5 },
    ],
  })},
  { id: 'lucky_die',       cost: 14, create: () => new Die({
    name: 'Lucky Die', category: 'bought', speedMod: 1,
    effects: [
      { scope: 'board', type: 'gold', pip: 'any', value: 1 },
    ],
  })},
  { id: 'ember_die',       cost: 20, create: () => new Die({
    name: 'Ember Die', category: 'combat', speedMod: 1,
    effects: [
      { scope: 'board', type: 'damage', pip: 'any', value: 2 },
    ],
  })},
  { id: 'frost_die',       cost: 20, create: () => new Die({
    name: 'Frost Die', category: 'combat', speedMod: 1.5,
    effects: [
      { scope: 'board', type: 'heal', pip: 4, value: 3 },
    ],
  })},
  { id: 'shadow_die',      cost: 25, create: () => new Die({ name: 'Shadow Die',      category: 'combat', speedMod: 0.75 }) },
];

const POTION_CATALOGUE = [
  { id: 'health_potion',   cost: 8,  type: 'consumable', create: () => ({ name: 'Health Potion',    effect: { stat: 'hp',     op: 'add', value: 30 }, description: 'Restore 30 HP instantly.' }) },
  { id: 'iron_skin',       cost: 20, type: 'permanent',  create: () => ({ name: 'Iron Skin',        effect: { stat: 'maxHp',  op: 'add', value: 15 }, description: 'Permanently gain +15 max HP.' }) },
  { id: 'sharpen',         cost: 18, type: 'permanent',  create: () => ({ name: 'Sharpen',          effect: { stat: 'damage', op: 'add', value: 2 },  description: 'Permanently gain +2 damage.' }) },
  { id: 'haste_brew',      cost: 15, type: 'permanent',  create: () => ({ name: 'Haste Brew',       effect: { stat: 'speed',  op: 'multiply', value: 0.95 }, description: 'Permanently reduce speed by 5%.' }) },
  { id: 'adrenaline',      cost: 12, type: 'temporary',  create: () => ({ name: 'Adrenaline',       effect: { stat: 'damage', op: 'add', value: 5, duration: 3 }, description: '+5 damage for the next 3 battles.' }) },
  { id: 'stone_elixir',    cost: 14, type: 'temporary',  create: () => ({ name: 'Stone Elixir',     effect: { stat: 'maxHp',  op: 'add', value: 30, duration: 3 }, description: '+30 max HP for the next 3 battles.' }) },
  { id: 'frenzy_draught',  cost: 16, type: 'temporary',  create: () => ({ name: 'Frenzy Draught',   effect: { stat: 'speed',  op: 'multiply', value: 0.85, duration: 2 }, description: '15% faster for the next 2 battles.' }) },
  { id: 'golden_tonic',    cost: 10, type: 'consumable', create: () => ({ name: 'Golden Tonic',     effect: { stat: 'gold',   op: 'add', value: 20 }, description: 'Gain 20 gold instantly.' }) },
];

// --- ShopEngine -----------------------------------------------------------

class ShopEngine {
  constructor() {
    this.shopType    = null;  // 'item' | 'dice' | 'potion'
    this.inventory   = [];    // [{ ...catalogueEntry, sold: false }]
    this.rerollCount = 0;     // how many rerolls this visit
    this.isOpen      = false;
    this.discount    = 0;     // gold subtracted from all costs (landing bonus)
  }

  /** Reroll cost for the next reroll (after discount). */
  get rerollCost() {
    if (this.rerollCount === 0) return 0; // first is free
    const base = REROLL_BASE_COST * Math.pow(2, this.rerollCount - 1);
    return Math.max(0, base - this.discount);
  }

  /** Set the discount amount (e.g. 1 when landing exactly on a shop tile). */
  setDiscount(amount) {
    this.discount = amount;
  }

  /** Open a shop of the given type. Fills inventory with random items. */
  open(shopType) {
    this.shopType    = shopType;
    this.rerollCount = 0;
    this.isOpen      = true;
    this.discount    = 0;
    this._fillInventory();
  }

  /** Close the shop. */
  close() {
    this.isOpen    = false;
    this.shopType  = null;
    this.inventory = [];
  }

  /** Reroll: replace all unsold inventory items with new random ones. */
  reroll(character) {
    const cost = this.rerollCost;
    if (character.gold < cost) return { success: false, reason: 'Not enough gold.' };

    character.gold -= cost;
    this.rerollCount++;
    this._fillInventory();
    return { success: true, cost };
  }

  /** Buy an item at the given index. Returns { success, item, reason? } */
  buy(index, character) {
    if (!this.isOpen) return { success: false, reason: 'Shop is not open.' };
    if (index < 0 || index >= this.inventory.length) return { success: false, reason: 'Invalid slot.' };

    const slot = this.inventory[index];
    if (!slot || slot.sold) return { success: false, reason: 'Item already sold.' };

    const effectiveCost = Math.max(0, slot.cost - this.discount);
    if (character.gold < effectiveCost) {
      return { success: false, reason: 'Not enough gold.' };
    }

    character.gold -= effectiveCost;
    slot.sold = true;

    // Apply the purchase based on shop type
    return this._applyPurchase(slot, character);
  }

  /** Get current inventory as a displayable array (costs after discount). */
  getDisplay() {
    return this.inventory.map((slot, i) => ({
      index: i,
      name: slot.create().name,
      cost: Math.max(0, slot.cost - this.discount),
      sold: slot.sold,
      description: slot.create().description || '',
    }));
  }

  // --- Private ------------------------------------------------------------

  _getCatalogue() {
    switch (this.shopType) {
      case 'item':   return ITEM_CATALOGUE;
      case 'dice':   return DICE_CATALOGUE;
      case 'potion': return POTION_CATALOGUE;
      default:       return [];
    }
  }

  _fillInventory() {
    const catalogue = this._getCatalogue();
    const picked = [];
    const used = new Set();

    while (picked.length < SHOP_INVENTORY_SIZE && picked.length < catalogue.length) {
      const idx = Math.floor(Math.random() * catalogue.length);
      if (!used.has(idx)) {
        used.add(idx);
        picked.push({ ...catalogue[idx], sold: false });
      }
    }

    this.inventory = picked;
  }

  _applyPurchase(slot, character) {
    const itemData = slot.create();

    switch (this.shopType) {
      case 'item': {
        // Find first empty slot in the 2D item grid
        const emptySlot = this._findEmptyItemSlot(character);
        if (!emptySlot) {
          character.gold += slot.cost; // refund
          slot.sold = false;
          return { success: false, reason: 'Item slots are full.' };
        }
        character.itemSlots.set(emptySlot.row, emptySlot.col, itemData);
        return { success: true, item: itemData, slot: emptySlot };
      }

      case 'dice': {
        if (itemData.category === 'bought') {
          character.dicePool.addBought(itemData);
        } else {
          character.dicePool.addCombat(itemData);
        }
        return { success: true, item: itemData };
      }

      case 'potion': {
        const effect = itemData.effect;
        switch (effect.op) {
          case 'add':
            if (effect.stat === 'hp') {
              character.heal(effect.value);
            } else if (effect.stat === 'gold') {
              character.gold += effect.value;
            } else {
              character[effect.stat] = (character[effect.stat] || 0) + effect.value;
            }
            break;
          case 'multiply':
            character[effect.stat] = +(character[effect.stat] * effect.value).toFixed(2);
            break;
        }
        return { success: true, item: itemData };
      }

      default:
        return { success: false, reason: 'Unknown shop type.' };
    }
  }

  _findEmptyItemSlot(character) {
    for (let r = 0; r < character.itemSlots.rows; r++) {
      for (let c = 0; c < character.itemSlots.cols; c++) {
        if (!character.itemSlots.get(r, c)) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }
}

// --- Tile → Shop type mapping --------------------------------------------

function shopTypeForTile(tileIndex) {
  switch (tileIndex) {
    case SHOP_TILE_ITEM:   return 'item';
    case SHOP_TILE_DICE:   return 'dice';
    case SHOP_TILE_POTION: return 'potion';
    default:               return null;
  }
}

// Expose globally
window.ShopEngine = ShopEngine;
window.shopTypeForTile = shopTypeForTile;
window.SHOP_TILE_ITEM = SHOP_TILE_ITEM;
window.SHOP_TILE_DICE = SHOP_TILE_DICE;
window.SHOP_TILE_POTION = SHOP_TILE_POTION;
window.SHOP_BATTLE = SHOP_BATTLE;
window.SHOP_INVENTORY_SIZE = SHOP_INVENTORY_SIZE;
