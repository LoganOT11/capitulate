/* global Phaser, CHARACTER_TYPES, isTriggered, triggerCount */

// --- Character ------------------------------------------------------------
// Core entity that holds stats, loop progression, and (future) inventory.
// All archetypes start with identical base stats; passives diverge them over time.

const BASE_STATS = Object.freeze({
  health: 100,
  damage: 10,
  speed: 5, // seconds — base cooldown between dice rolls
});

// Health multiplier applied each time the character completes a full board loop.
// After loop N the character's max HP = 100 × 1.8^N.
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

    // --- passive-derived flags ---
    this.magicType = false; // true when mage passive has triggered at least once

    // --- passive reference (set by processBoardRoll or externally) ---
    this.passive = CHARACTER_TYPES[type]
      ? { ...CHARACTER_TYPES[type].passive }
      : null;

    // --- passive trigger log (for UI/test inspection) ---
    this.lastPassiveTriggered = false;
    this.lastPassiveEffects   = [];
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
   * Call after rolling the 2 movement dice on the board.
   * Checks the archetype's passive trigger and applies stat effects.
   * Returns { triggered, effects[] } so the caller can show feedback.
   */
  processBoardRoll(d1, d2) {
    this.lastPassiveTriggered = false;
    this.lastPassiveEffects   = [];

    if (!this.passive || !this.passive.trigger) {
      return { triggered: false, effects: [] };
    }

    // How many times does the trigger fire?  (e.g. two 6s → Rogue fires twice)
    const hits = triggerCount(this.passive.trigger, d1, d2);
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
      magicType: this.magicType,
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
