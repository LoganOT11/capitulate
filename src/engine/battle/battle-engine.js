// --- BattleEngine ---------------------------------------------------------
// Real-time batch-rolled combat.
//
// Each tick:
//   1. Roll all active dice (bought + combat) → face counts
//   2. For each die: damage = character.damage + pip
//   3. For each die: check itemSlots[pip] → trigger all matching items
//   4. Adjacent items chain if the triggering item has adjacent:true
//   5. Gold effects use face frequency (3× pip-2 = 3× gold)
//   6. Sum all damage → apply to enemy
//   7. Sum all heals → apply to self
//   8. Tick interval = character.speed (seconds)
//   9. Repeat until someone's HP ≤ 0

class BattleEngine {
  /**
   * @param {Character} player
   * @param {Character} enemy   — real character or ghost snapshot
   */
  constructor(player, enemy) {
    this.player = player;
    this.enemy  = enemy;

    this.tickCount    = 0;
    this.log          = [];   // battle log for UI
    this.running      = false;
    this.winner        = null;

    // Callbacks for UI hooks
    this.onTick       = null; // fn(tickResult)
    this.onEnd        = null; // fn(winner, loser)
  }

  /**
   * Run a single tick. Returns the tick result object.
   * Caller is responsible for calling this on a timer (player.speed seconds).
   */
  tick() {
    this.tickCount++;

    // --- Roll dice ---
    const playerRoll = this.player.dicePool.rollBattleTick();
    const enemyRoll  = this.enemy.dicePool.rollBattleTick();

    // --- Resolve player's dice ---
    const playerDmg = this._resolveDice(this.player, this.enemy, playerRoll);

    // --- Resolve enemy's dice ---
    const enemyDmg = this._resolveDice(this.enemy, this.player, enemyRoll);

    // --- Build tick result ---
    const result = {
      tick: this.tickCount,
      player: {
        rolls:    playerRoll.results.map(d => d.lastPip),
        faces:    playerRoll.faceCounts,
        damage:   playerDmg.totalDamage,
        healing:  playerDmg.totalHeal,
        gold:     playerDmg.totalGold,
        items:    playerDmg.itemTriggers,
      },
      enemy: {
        rolls:    enemyRoll.results.map(d => d.lastPip),
        faces:    enemyRoll.faceCounts,
        damage:   enemyDmg.totalDamage,
        healing:  enemyDmg.totalHeal,
        gold:     enemyDmg.totalGold,
        items:    enemyDmg.itemTriggers,
      },
      playerHp: this.player.hp,
      enemyHp:  this.enemy.hp,
    };

    this.log.push(result);
    if (this.onTick) this.onTick(result);

    // --- Check for death ---
    if (this.enemy.isDead) {
      this.winner = this.player;
      this.running = false;
      if (this.onEnd) this.onEnd(this.player, this.enemy);
    } else if (this.player.isDead) {
      this.winner = this.enemy;
      this.running = false;
      if (this.onEnd) this.onEnd(this.enemy, this.player);
    }

    return result;
  }

  /**
   * Resolve all dice for one side: damage, items, adjacency, gold.
   * @private
   */
  _resolveDice(attacker, defender, rollResult) {
    // Single accumulator threaded through item resolution so item procs
    // actually contribute to the totals (previously written to a throwaway).
    const acc = { totalDamage: 0, totalHeal: 0, totalGold: 0, itemTriggers: [] };

    for (const die of rollResult.results) {
      const pip = die.lastPip;

      // Base damage: character.damage + pip
      acc.totalDamage += attacker.damage + pip;

      // Die's own battle-scoped effects
      for (const fx of die.getBattleEffects()) {
        if (fx.type === 'damage') acc.totalDamage += fx.value;
        else if (fx.type === 'heal') acc.totalHeal += fx.value;
        else if (fx.type === 'gold') acc.totalGold += fx.value;
      }

      // Item triggers for this pip
      const matchedItems = attacker.itemSlots.findByPip(pip);
      const triggeredSet = new Set(); // track by grid position to avoid double-fire

      for (const { item, row, col } of matchedItems) {
        this._triggerItem(item, row, col, attacker, triggeredSet, acc);

        // Chain to adjacent items if this item has adjacent:true
        if (item.adjacent) {
          const neighbors = attacker.itemSlots.getAdjacent(row, col);
          for (const { row: nr, col: nc } of neighbors) {
            const neighbor = attacker.itemSlots.get(nr, nc);
            if (neighbor && !triggeredSet.has(`${nr},${nc}`)) {
              this._triggerItem(neighbor, nr, nc, attacker, triggeredSet, acc);
            }
          }
        }
      }
    }

    // Apply damage to defender
    if (acc.totalDamage > 0) {
      defender.takeDamage(acc.totalDamage);
    }
    // Apply heal + gold to attacker
    if (acc.totalHeal > 0) {
      attacker.heal(acc.totalHeal);
    }
    if (acc.totalGold > 0) {
      attacker.gold = (attacker.gold || 0) + acc.totalGold;
    }

    return acc;
  }

  /**
   * Trigger a single item's battle-scoped effects.
   * @private
   */
  _triggerItem(item, row, col, attacker, triggeredSet, accum) {
    const key = `${row},${col}`;
    if (triggeredSet.has(key)) return;
    triggeredSet.add(key);

    const effects = item.battleEffects;
    for (const fx of effects) {
      switch (fx.type) {
        case 'damage':
          accum.totalDamage += fx.value;
          break;
        case 'heal':
          accum.totalHeal += fx.value;
          break;
        case 'gold':
          accum.totalGold += fx.value;
          break;
        // future: buff, debuff, etc.
      }
    }
    accum.itemTriggers.push({ name: item.name, row, col, effects });
  }

  /** Tick interval in milliseconds (character speed in seconds → ms). */
  get tickMs() {
    return this.player.speed * 1000;
  }
}

window.BattleEngine = BattleEngine;
