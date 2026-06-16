// --- Die ------------------------------------------------------------------
// A single die that can be equipped in a character's dice pool.
// Dice are batch-rolled: all active dice roll simultaneously each tick.
//
// speedMod — how many ticks between rolls (1 = every tick, 2 = every other tick)
// category — "movement" | "bought" | "combat"
// effects  — board-only effects triggered by pip value (gold, heal, scaling)

class Die {
  /**
   * @param {object} opts
   * @param {string} opts.name        — display name
   * @param {string} opts.category    — "movement" | "bought" | "combat"
   * @param {number} [opts.speedMod]  — ticks between rolls (default 1)
   * @param {Array}  [opts.effects]   — board-scoped effects [{ scope, type, pip, value }]
   */
  constructor({ name, category, speedMod = 1, effects = [] } = {}) {
    this.name      = name;
    this.category  = category;
    this.speedMod  = speedMod;
    this.effects   = effects;

    // Runtime state
    this.lastPip   = null;  // result of most recent roll
    this.tickAccum = 0;     // ticks since last roll
  }

  /**
   * Should this die roll this tick?
   * Increments the accumulator and returns true when it fires.
   */
  shouldRoll() {
    this.tickAccum++;
    if (this.tickAccum >= this.speedMod) {
      this.tickAccum = 0;
      return true;
    }
    return false;
  }

  /** Roll: returns a random pip 1-6. */
  roll() {
    this.lastPip = Math.floor(Math.random() * 6) + 1;
    return this.lastPip;
  }

  /** Roll with a fixed value (for testing). */
  rollFixed(pip) {
    this.lastPip = pip;
    return this.lastPip;
  }

  /** Get board-scoped effects that match the current pip. */
  getBoardEffects() {
    if (this.lastPip == null) return [];
    return this.effects.filter(
      fx => fx.scope === 'board' && (fx.pip === this.lastPip || fx.pip === 'any')
    );
  }

  toJSON() {
    return {
      name: this.name,
      category: this.category,
      speedMod: this.speedMod,
      lastPip: this.lastPip,
    };
  }
}

window.Die = Die;
