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
//
// Triggers operate over the face-count map of EVERY rolled die
// ({ 1:n, 2:n, ... , 6:n }) so passives scale with the whole pool, not just
// the 2 movement dice.

/**
 * How many times does this trigger fire for the given face counts?
 *   pair     → number of matched pairs across all faces
 *              (e.g. 3,3,5,5 → 2 pairs; 6,6,6 → 1 pair)
 *   has_six  → count of 6s rolled
 */
function triggerCount(trigger, faceCounts) {
  switch (trigger) {
    case 'pair': {
      let pairs = 0;
      for (let f = 1; f <= 6; f++) pairs += Math.floor((faceCounts[f] || 0) / 2);
      return pairs;
    }
    case 'has_six':
      return faceCounts[6] || 0;
    default:
      return 0;
  }
}

/** Returns true if the passive's trigger condition is met at least once. */
function isTriggered(trigger, faceCounts) {
  return triggerCount(trigger, faceCounts) > 0;
}

// Expose globally
window.CHARACTER_TYPES = CHARACTER_TYPES;
window.isTriggered = isTriggered;
