// --- DicePool -------------------------------------------------------------
// Manages all dice a character owns, grouped by category.
// Handles batch rolling and face-frequency counting.
//
// Phase participation by category:
//   movement — exactly 2. Roll on the BOARD only: their pips drive how many
//              tiles the token moves, and feed passives/items. They do NOT
//              fight in battle.
//   bought   — roll on the board AND in battle. No movement contribution.
//   combat   — roll on the board AND in battle. No movement contribution.
//
// So boardDice = every die; battleDice = bought + combat (movement excluded).
// On a board roll all dice roll → board-scoped effects + passives + items.
// On a battle tick the battle dice roll → battle-scoped effects + items.

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

  /** Dice that roll on the board — every die. */
  get boardDice() {
    return this.all;
  }

  /** Dice that fight in battle — bought + combat (movement dice don't fight). */
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
   * Batch-roll every die for a board roll.
   * The 2 movement dice drive the step count (movementSum); all dice (movement
   * + bought + combat) contribute faces for passives, items and board effects.
   *
   * @param {Array<number>} [fixedMovement] — force the movement dice to these
   *        pips (deterministic testing); the rest still roll randomly.
   * @returns {{ results: Die[], faceCounts: object, movementSum: number }}
   */
  rollBoard(fixedMovement = null) {
    const results = [];
    const faceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    let movementSum = 0;

    this.movement.forEach((die, i) => {
      const pip = (fixedMovement && fixedMovement[i] != null)
        ? die.rollFixed(fixedMovement[i])
        : die.roll();
      faceCounts[pip]++;
      movementSum += pip;
      results.push(die);
    });

    for (const die of [...this.bought, ...this.combat]) {
      const pip = die.roll();
      faceCounts[pip]++;
      results.push(die);
    }

    return { results, faceCounts, movementSum };
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
