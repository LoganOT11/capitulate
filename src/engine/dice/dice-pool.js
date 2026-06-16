// --- DicePool -------------------------------------------------------------
// Manages all dice a character owns, grouped by category.
// Handles batch rolling and face-frequency counting.
//
// Categories:
//   movement — exactly 2, rolled manually on the board, trigger passives
//   bought   — collected on the board, roll alongside movement dice,
//              board-scoped effects only. In battle: act as combat dice.
//   combat   — unlimited, battle-only, roll on batch ticks.

class DicePool {
  constructor() {
    this.movement = [];   // Die[2]
    this.bought   = [];   // Die[]
    this.combat   = [];   // Die[]
  }

  // --- Accessors ----------------------------------------------------------

  /** All dice in the pool. */
  get all() {
    return [...this.movement, ...this.bought, ...this.combat];
  }

  /** Dice that roll on the board (movement + bought). */
  get boardDice() {
    return [...this.movement, ...this.bought];
  }

  /** Dice that roll in battle (bought + combat). */
  get battleDice() {
    return [...this.bought, ...this.combat];
  }

  /** Total dice count. */
  get count() {
    return this.movement.length + this.bought.length + this.combat.length;
  }

  // --- Management ---------------------------------------------------------

  addMovement(die) {
    if (this.movement.length >= 2) {
      throw new Error('Movement dice slots are full (max 2).');
    }
    this.movement.push(die);
  }

  addBought(die) {
    this.bought.push(die);
  }

  addCombat(die) {
    this.combat.push(die);
  }

  removeDie(die) {
    for (const list of [this.movement, this.bought, this.combat]) {
      const idx = list.indexOf(die);
      if (idx !== -1) { list.splice(idx, 1); return true; }
    }
    return false;
  }

  // --- Rolling ------------------------------------------------------------

  /**
   * Batch-roll all board dice (movement + bought).
   * Returns { results: Die[], faceCounts: {1:n, 2:n, ... , 6:n} }
   */
  rollBoard() {
    const dice = this.boardDice;
    const results = [];
    const faceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    for (const die of dice) {
      const pip = die.roll();
      faceCounts[pip]++;
      results.push(die);
    }

    return { results, faceCounts };
  }

  /**
   * Batch-roll dice that are active this battle tick.
   * Uses shouldRoll() to respect each die's speedMod.
   * Returns { results: Die[], faceCounts: {1:n, ... , 6:n} }
   */
  rollBattleTick() {
    const dice = this.battleDice;
    const results = [];
    const faceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    for (const die of dice) {
      if (die.shouldRoll()) {
        const pip = die.roll();
        faceCounts[pip]++;
        results.push(die);
      }
    }

    return { results, faceCounts };
  }

  /**
   * Force all battle dice to roll this tick (ignore speedMod).
   * Used for the first tick of combat so all dice fire immediately.
   */
  rollBattleAll() {
    const dice = this.battleDice;
    const results = [];
    const faceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    for (const die of dice) {
      die.tickAccum = 0; // reset so shouldRoll logic stays consistent after
      const pip = die.roll();
      faceCounts[pip]++;
      results.push(die);
    }

    return { results, faceCounts };
  }

  // --- Serialization ------------------------------------------------------

  toJSON() {
    return {
      movement: this.movement.map(d => d.toJSON()),
      bought:   this.bought.map(d => d.toJSON()),
      combat:   this.combat.map(d => d.toJSON()),
    };
  }
}

window.DicePool = DicePool;
