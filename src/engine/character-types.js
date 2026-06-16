// --- Character Archetypes -------------------------------------------------
// Each archetype starts with identical base stats (100 HP, 10 dmg, 5s speed).
// Differentiation comes from passives that trigger on board movement dice.
//
// Passives fire OUTSIDE combat only — when the 2 movement dice are rolled.
// This naturally throttles scaling: you get ~4-8 triggers per board loop.

const CHARACTER_TYPES = Object.freeze({
  knight: {
    key: 'knight',
    label: 'Knight',
    description: 'Toughens up as you explore. Pairs fortify health and damage.',
    color: 0x1565c0,
    passive: {
      id: 'fortify',
      name: 'Fortify',
      description: 'When you roll a pair, gain +3 damage and +8 max HP (healed).',
      trigger: 'pair',         // d1 === d2
      effects: [
        { stat: 'damage', op: 'add', value: 3 },
        { stat: 'maxHp',  op: 'add', value: 8 },
      ],
    },
  },

  rogue: {
    key: 'rogue',
    label: 'Rogue',
    description: 'Gets faster every time a 6 is rolled. Doubles are extra fast.',
    color: 0xc62828,
    passive: {
      id: 'hustle',
      name: 'Hustle',
      description: 'For each 6 rolled, reduce speed cooldown by 8% (min 1.5s).',
      trigger: 'has_six',      // d1 === 6 || d2 === 6
      effects: [
        // Applied once per 6 rolled — called in a loop by processBoardRoll.
        { stat: 'speed', op: 'multiply', value: 0.92, min: 1.5 },
      ],
    },
  },

  mage: {
    key: 'mage',
    label: 'Mage',
    description: 'Converts damage to arcane power. Pairs amplify magic.',
    color: 0x6a1b9a,
    passive: {
      id: 'arcane_infusion',
      name: 'Arcane Infusion',
      description: 'When you roll a pair, damage becomes magic type and +5 damage.',
      trigger: 'pair',
      effects: [
        { stat: 'damage',   op: 'add', value: 5 },
        { stat: 'magicType', op: 'set', value: true },
      ],
    },
  },

  cleric: {
    key: 'cleric',
    label: 'Cleric',
    description: 'Balanced and resilient. Passive to be determined.',
    color: 0xf9a825,
    passive: {
      id: 'tbd',
      name: 'TBD',
      description: 'Passive effect to be decided.',
      trigger: null,
      effects: [],
    },
  },
});

// --- Trigger evaluation ---------------------------------------------------

/** Returns true if the passive's trigger condition is met for this roll. */
function isTriggered(trigger, d1, d2) {
  switch (trigger) {
    case 'pair':
      return d1 === d2;
    case 'has_six':
      return d1 === 6 || d2 === 6;
    default:
      return false;
  }
}

/**
 * For multi-hit triggers like 'has_six', returns how many times it fires.
 * Knight/Mage pair → 1 trigger.  Rogue has_six → count of 6s rolled.
 */
function triggerCount(trigger, d1, d2) {
  switch (trigger) {
    case 'pair':
    case 'has_six':
      // For has_six: 0, 1, or 2.  For pair: always 0 or 1.
      let count = 0;
      if (trigger === 'pair') {
        return d1 === d2 ? 1 : 0;
      }
      if (d1 === 6) count++;
      if (d2 === 6) count++;
      return count;
    default:
      return isTriggered(trigger, d1, d2) ? 1 : 0;
  }
}

// Expose globally
window.CHARACTER_TYPES = CHARACTER_TYPES;
window.isTriggered = isTriggered;
