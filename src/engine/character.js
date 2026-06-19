/* global Phaser, CHARACTER_TYPES, isTriggered, triggerCount, DicePool, ItemSlots */

// --- Character ------------------------------------------------------------
// Core entity that holds stats, loop progression, and (future) inventory.
// All archetypes start with identical base stats; passives diverge them over time.

const BASE_STATS = Object.freeze({
  health: 200,
  damage: 10,
  speed: 5, // seconds — base cooldown between dice rolls
});

// Health multiplier applied each time the character completes a full board loop.
// After loop N the character's max HP = 200 × 1.8^N.
const HEALTH_LOOP_MULTIPLIER = 1.8;

class Character {
  /**
   * @param {object} opts
   * @param {string} opts.name — display name
   * @param {string} opts.type — archetype key ("knight", "rogue", "mage", "cleric")
   */
  constructor({ name = 'Hero', type = 'knight' } = {}) {
    this.name = name;
    this.type = type;

    // --- base stats (shared by all archetypes) ---
    this.baseHealth = BASE_STATS.health;
    this.baseDamage = BASE_STATS.damage;
    this.baseSpeed  = BASE_STATS.speed;

    // --- live state ---
    this.maxHp   = this.baseHealth;
    this.hp      = this.maxHp;
    this.damage  = this.baseDamage;
    this.speed   = this.baseSpeed;
    this.loops   = 0;
    this.gold    = 0;

    // --- passive-derived flags ---
    this.magicType = false; // true when mage passive has triggered at least once

    // --- passive reference (set by processBoardRoll or externally) ---
    this.passive = CHARACTER_TYPES[type]
      ? { ...CHARACTER_TYPES[type].passive }
      : null;

    // --- passive trigger log (for UI/test inspection) ---
    this.lastPassiveTriggered = false;
    this.lastPassiveEffects   = [];

    // --- dice pool and item slots ---
    this.dicePool  = new DicePool();
    this.itemSlots = new ItemSlots(2, 3);
  }

  // --- HP management ------------------------------------------------------

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    return this.hp;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp;
  }

  get isDead() {
    return this.hp <= 0;
  }

  // --- Board-roll passive -------------------------------------------------

  /**
   * Resolve a full board roll: every die's faces drive the archetype passive,
   * each die's board-scoped effects fire, and board-scoped item effects trigger
   * by pip. Board has no enemy, so only gold/heal effects apply (damage is
   * skipped); battle effects are handled by BattleEngine.
   *
   * Accepts either:
   *   - a rollResult { results: Die[], faceCounts } from DicePool.rollBoard(), or
   *   - legacy (d1, d2) numbers — passive only, no die/item board effects.
   *
   * Returns { triggered, effects[], hits, gold, heal, itemTriggers }.
   */
  processBoardRoll(arg1, arg2) {
    this.lastPassiveTriggered = false;
    this.lastPassiveEffects   = [];

    const { faceCounts, results } = this._normalizeBoardRoll(arg1, arg2);

    const passive = this._applyPassive(faceCounts);
    const board   = this._applyBoardEffects(results);

    return { ...passive, ...board };
  }

  /** @private — accept a rollResult object or legacy (d1, d2) numbers. */
  _normalizeBoardRoll(arg1, arg2) {
    if (arg1 && typeof arg1 === 'object') {
      return { faceCounts: arg1.faceCounts, results: arg1.results || [] };
    }
    const faceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    if (arg1 != null) faceCounts[arg1]++;
    if (arg2 != null) faceCounts[arg2]++;
    return { faceCounts, results: [] };
  }

  /** @private — fire the archetype passive over the rolled face counts. */
  _applyPassive(faceCounts) {
    if (!this.passive || !this.passive.trigger) {
      return { triggered: false, effects: [] };
    }

    // How many times does the trigger fire?  (e.g. two 6s → Rogue fires twice)
    const hits = triggerCount(this.passive.trigger, faceCounts);
    if (hits === 0) {
      return { triggered: false, effects: [] };
    }

    // Passive triggered — apply each effect `hits` times.
    const applied = [];
    for (const fx of this.passive.effects) {
      const before = this[fx.stat];
      for (let i = 0; i < hits; i++) {
        switch (fx.op) {
          case 'add':
            this[fx.stat] = (this[fx.stat] || 0) + fx.value;
            break;
          case 'multiply':
            this[fx.stat] = +(this[fx.stat] * fx.value).toFixed(2);
            if (fx.min != null && this[fx.stat] < fx.min) {
              this[fx.stat] = fx.min;
            }
            break;
          case 'set':
            this[fx.stat] = fx.value;
            break;
        }
      }
      const after = this[fx.stat];
      applied.push({ stat: fx.stat, before, after, hits });
    }

    // If maxHp increased, heal the difference so the character gains the HP.
    const hpGain = applied.find(e => e.stat === 'maxHp');
    if (hpGain && hpGain.after > hpGain.before) {
      this.heal(hpGain.after - hpGain.before);
    }

    this.lastPassiveTriggered = true;
    this.lastPassiveEffects   = applied;

    return { triggered: true, effects: applied, hits };
  }

  /**
   * @private — apply board-scoped effects from the rolled dice + equipped items.
   * Gold is gained, heal is applied; damage has no board target and is ignored.
   */
  _applyBoardEffects(results) {
    let gold = 0;
    let heal = 0;
    const itemTriggers = [];

    for (const die of results) {
      for (const fx of die.getBoardEffects()) {
        if (fx.type === 'gold') gold += fx.value;
        else if (fx.type === 'heal') heal += fx.value;
      }

      const pip = die.lastPip;
      if (pip == null) continue;
      const res = this._triggerBoardItems(pip, itemTriggers);
      gold += res.gold;
      heal += res.heal;
    }

    if (gold) this.gold += gold;
    if (heal) this.heal(heal);

    return { gold, heal, itemTriggers };
  }

  /**
   * @private — fire board-scoped effects of items matching `pip`, chaining to
   * neighbours when an item is adjacent:true. Mirrors BattleEngine's item
   * resolution but board-scoped. Returns { gold, heal }.
   */
  _triggerBoardItems(pip, itemTriggers) {
    let gold = 0;
    let heal = 0;
    const fired = new Set();

    const apply = (item, row, col) => {
      const key = `${row},${col}`;
      if (fired.has(key)) return;
      fired.add(key);
      const effects = item.boardEffects;
      if (effects.length === 0) return;
      for (const fx of effects) {
        if (fx.type === 'gold') gold += fx.value;
        else if (fx.type === 'heal') heal += fx.value;
      }
      itemTriggers.push({ name: item.name, row, col, effects });
    };

    for (const { item, row, col } of this.itemSlots.findByPip(pip)) {
      apply(item, row, col);
      if (item.adjacent) {
        for (const { row: nr, col: nc } of this.itemSlots.getAdjacent(row, col)) {
          const neighbor = this.itemSlots.get(nr, nc);
          if (neighbor) apply(neighbor, nr, nc);
        }
      }
    }

    return { gold, heal };
  }

  // --- Loop progression ---------------------------------------------------

  completeLoop() {
    this.loops += 1;
    this.maxHp = Math.round(this.baseHealth * Math.pow(HEALTH_LOOP_MULTIPLIER, this.loops));
    this.hp = this.maxHp; // full heal on loop completion
    return {
      loops: this.loops,
      maxHp: this.maxHp,
      hp: this.hp,
    };
  }

  // --- Serialization (for ghost snapshots / save-load) --------------------

  toJSON() {
    return {
      name:      this.name,
      type:      this.type,
      maxHp:     this.maxHp,
      hp:        this.hp,
      damage:    this.damage,
      speed:     this.speed,
      loops:     this.loops,
      gold:      this.gold,
      magicType: this.magicType,
      dicePool:  this.dicePool.toJSON(),
      itemSlots: this.itemSlots.toJSON(),
    };
  }

  static fromJSON(data) {
    const c = new Character({ name: data.name, type: data.type });
    c.maxHp     = data.maxHp;
    c.hp        = data.hp;
    c.damage    = data.damage;
    c.speed     = data.speed;
    c.loops     = data.loops;
    c.magicType = data.magicType || false;
    return c;
  }
}

// Expose globally
window.Character = Character;
window.BASE_STATS = BASE_STATS;
window.HEALTH_LOOP_MULTIPLIER = HEALTH_LOOP_MULTIPLIER;
