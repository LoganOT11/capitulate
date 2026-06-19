// --- Item Registry --------------------------------------------------------
// Master list of all items available in the game.
// Each entry is a factory function so items are fresh instances when created.

const ITEM_REGISTRY = {
  // --- Damage items (battle-scoped: deal damage in combat) ---
  fire_sword: () => new Item({
    name: 'Fire Sword',
    description: 'Deal +8 fire damage in battle when a die rolls 6.',
    pip: 6,
    effects: [{ scope: 'battle', type: 'damage', value: 8 }],
  }),

  sharp_fang: () => new Item({
    name: 'Sharp Fang',
    description: 'Deal +3 damage in battle when a die rolls 2.',
    pip: 2,
    effects: [{ scope: 'battle', type: 'damage', value: 3 }],
  }),

  thunder_lance: () => new Item({
    name: 'Thunder Lance',
    description: 'Deal +5 damage in battle when a die rolls 4.',
    pip: 4,
    effects: [{ scope: 'battle', type: 'damage', value: 5 }],
  }),

  shadow_blade: () => new Item({
    name: 'Shadow Blade',
    description: 'Deal +4 damage in battle when a die rolls 3.',
    pip: 3,
    effects: [{ scope: 'battle', type: 'damage', value: 4 }],
  }),

  // --- Heal items (battle-scoped: combat sustain) ---
  vitality_crystal: () => new Item({
    name: 'Vitality Crystal',
    description: 'Heal 3 HP in battle when a die rolls 1.',
    pip: 1,
    effects: [{ scope: 'battle', type: 'heal', value: 3 }],
  }),

  lifebloom: () => new Item({
    name: 'Lifebloom',
    description: 'Heal 5 HP in battle when a die rolls 5.',
    pip: 5,
    effects: [{ scope: 'battle', type: 'heal', value: 5 }],
  }),

  // --- Gold items (board-scoped: earn gold as you move) ---
  lucky_coin: () => new Item({
    name: 'Lucky Coin',
    description: 'Gain 2 gold on the board when a die rolls 1.',
    pip: 1,
    effects: [{ scope: 'board', type: 'gold', value: 2 }],
  }),

  merchants_ring: () => new Item({
    name: "Merchant's Ring",
    description: 'Gain 4 gold on the board when a die rolls 6.',
    pip: 6,
    effects: [{ scope: 'board', type: 'gold', value: 4 }],
  }),

  // --- Adjacent-trigger items (battle-scoped) ---
  chain_lightning: () => new Item({
    name: 'Chain Lightning',
    description: 'Deal +3 damage in battle when a die rolls 4. Triggers adjacent items.',
    pip: 4,
    effects: [{ scope: 'battle', type: 'damage', value: 3 }],
    adjacent: true,
  }),

  echo_gem: () => new Item({
    name: 'Echo Gem',
    description: 'Deal +2 damage in battle when a die rolls 3. Triggers adjacent items.',
    pip: 3,
    effects: [{ scope: 'battle', type: 'damage', value: 2 }],
    adjacent: true,
  }),
};

// Helper: create an item by key.
function createItem(key) {
  const factory = ITEM_REGISTRY[key];
  if (!factory) throw new Error(`Unknown item: ${key}`);
  return factory();
}

window.ITEM_REGISTRY = ITEM_REGISTRY;
window.createItem = createItem;
