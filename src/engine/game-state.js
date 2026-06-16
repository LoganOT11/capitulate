// --- GameState ------------------------------------------------------------
// Simple state machine that controls which game mode is active.
// Transitions:  board ↔ battle,  board ↔ shop
//
// Each state controls what rolls, what triggers, and what's visible.

const GAME_MODES = Object.freeze({
  BOARD:  'board',
  BATTLE: 'battle',
  SHOP:   'shop',
});

class GameState {
  constructor() {
    this.mode = GAME_MODES.BOARD;
    this.listeners = [];
  }

  /** Current mode. */
  get current() {
    return this.mode;
  }

  get isBoard()  { return this.mode === GAME_MODES.BOARD; }
  get isBattle() { return this.mode === GAME_MODES.BATTLE; }
  get isShop()   { return this.mode === GAME_MODES.SHOP; }

  /**
   * Transition to a new mode.
   * Returns true if the transition happened, false if already in that mode.
   */
  transition(newMode) {
    if (this.mode === newMode) return false;
    const oldMode = this.mode;
    this.mode = newMode;
    this._notify(oldMode, newMode);
    return true;
  }

  /** Register a listener: fn(oldMode, newMode). */
  onTransition(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  _notify(oldMode, newMode) {
    for (const fn of this.listeners) {
      fn(oldMode, newMode);
    }
  }
}

window.GAME_MODES = GAME_MODES;
window.GameState = GameState;
