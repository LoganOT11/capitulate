/* global Phaser */

// --- Board geometry -------------------------------------------------------
// A standard Monopoly board: 40 tiles around an 11x11 grid (4 corners + 9 per side).
const TILE = 58;
const MARGIN = 28;
const BOARD = TILE * 11;
const W = BOARD + MARGIN * 2;
const H = BOARD + MARGIN * 2;
const TILE_COUNT = 40;
const STEP_MS = 140; // animation time per tile while the token hops

// Map a tile index (0..39) to a grid column/row. Tile 0 (GO) is bottom-right,
// movement proceeds counter-clockwise: left along the bottom, up the left side,
// right along the top, down the right side.
function tileToColRow(i) {
  if (i <= 10) return { col: 10 - i, row: 10 }; // bottom row, right -> left
  if (i <= 20) return { col: 0, row: 20 - i }; // left column, bottom -> top
  if (i <= 30) return { col: i - 20, row: 0 }; // top row, left -> right
  return { col: 10, row: i - 30 }; // right column, top -> bottom
}

function tileCenter(i) {
  const { col, row } = tileToColRow(i);
  return {
    x: MARGIN + col * TILE + TILE / 2,
    y: MARGIN + row * TILE + TILE / 2,
  };
}

// --- DOM helpers (the testable readout panel) -----------------------------
function setReadout(name, value) {
  const el = document.querySelector(`[data-testid="${name}"]`);
  if (el) el.textContent = String(value);
}

// --- Scene ----------------------------------------------------------------
class BoardScene extends Phaser.Scene {
  constructor() {
    super('board');
  }

  create() {
    this.position = 0;
    this.rolling = false;
    this.lastRoll = [null, null];

    // --- Character setup --------------------------------------------------
    // All archetypes start with identical base stats (100 HP, 10 dmg, 5s speed).
    // Passives diverge them over time via processBoardRoll().
    this.character = new Character({ name: 'Hero', type: 'knight' });

    this.drawBoard();
    this.setupDice();

    const start = tileCenter(this.position);
    this.token = this.add
      .circle(start.x, start.y, TILE * 0.3, CHARACTER_TYPES.knight.color)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(10);

    this.exposeApi();
    this.syncDom();

    // Wire the HTML roll button to the game once the scene is ready.
    const btn = document.getElementById('roll-btn');
    btn.disabled = false;
    btn.addEventListener('click', () => this.roll());
  }

  drawBoard() {
    const g = this.add.graphics();
    for (let i = 0; i < TILE_COUNT; i++) {
      const { col, row } = tileToColRow(i);
      const x = MARGIN + col * TILE;
      const y = MARGIN + row * TILE;
      const isCorner = i % 10 === 0;
      g.fillStyle(isCorner ? 0xffe082 : 0xc8e6c9, 1);
      g.fillRect(x, y, TILE, TILE);
      g.lineStyle(2, 0x2e7d32, 1);
      g.strokeRect(x, y, TILE, TILE);
      this.add.text(x + 4, y + 4, String(i), {
        fontSize: '11px',
        color: '#33691e',
      });
    }
    this.add
      .text(W / 2, H / 2 - 30, 'CAPITULATE', {
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#2e7d32',
      })
      .setOrigin(0.5);
  }

  // The two dice are rendered by the standalone PixelDice engine (src/pixel-dice.js)
  // into its own canvas in the UI panel, so the tumble animation is fully
  // decoupled from Phaser's board renderer.
  setupDice() {
    const canvas = document.getElementById('dice-canvas');
    this.diceRoller = window.PixelDice({
      canvas,
      count: 2,
      duration: 1500, // snappy tumble; the token waits for it before moving
    });
  }

  // Roll two dice and move. Pass explicit values for deterministic tests.
  // Flow: dice tumble (PixelDice) -> settle on the rolled values -> token hops.
  roll(d1, d2) {
    if (this.rolling) return;
    this.rolling = true;
    d1 = d1 != null ? d1 : Phaser.Math.Between(1, 6);
    d2 = d2 != null ? d2 : Phaser.Math.Between(1, 6);
    this.lastRoll = [d1, d2];
    // Remember where we started so we can detect loop crossings.
    this.preMovePosition = this.position;
    this.syncDom();
    this.diceRoller.roll([d1, d2], () => {
      // Passive triggers on the movement dice (outside combat).
      this.character.processBoardRoll(d1, d2);
      this.stepMove(d1 + d2, () => {
        this.rolling = false;
        this.syncDom();
      });
    });
  }

  // Hop the token one tile at a time so movement is visible.
  stepMove(stepsLeft, done) {
    if (stepsLeft <= 0) {
      // After all hops, check if we lapped the board.
      this.checkLoopCompletion();
      done();
      return;
    }
    this.position = (this.position + 1) % TILE_COUNT;

    // Detect loop completion: crossing tile 0 mid-move.
    // Because position wraps via modulo, we just need to check if we
    // arrived at tile 0 after having started elsewhere (or moved past it).
    // The simplest signal: if we just landed on 0 and stepsLeft > 0 it
    // means we haven't called done() yet so the loop fires after the
    // *last* hop.  We'll track crossing instead.

    const c = tileCenter(this.position);
    this.tweens.add({
      targets: this.token,
      x: c.x,
      y: c.y,
      duration: STEP_MS,
      ease: 'Quad.easeInOut',
      onComplete: () => this.stepMove(stepsLeft - 1, done),
    });
    this.syncDom();
  }

  /** Detect if the token crossed tile 0 during this move sequence. */
  checkLoopCompletion() {
    // We track the pre-move position.  If the sum of dice moved us past
    // tile 39 and back around, the character completed a loop.
    // Simplest: compare pre-move position + dice sum against TILE_COUNT.
    const diceSum = (this.lastRoll[0] || 0) + (this.lastRoll[1] || 0);
    if (this.preMovePosition + diceSum >= TILE_COUNT) {
      const result = this.character.completeLoop();
      this.syncDom();
    }
  }

  syncDom() {
    const [d1, d2] = this.lastRoll;
    const sum = (d1 || 0) + (d2 || 0);
    setReadout('die-1', d1 != null ? d1 : '-');
    setReadout('die-2', d2 != null ? d2 : '-');
    setReadout('sum', sum);
    setReadout('position', this.position);
    setReadout('rolling', this.rolling);

    // --- Character stats --------------------------------------------------
    if (this.character) {
      setReadout('char-name', this.character.name);
      setReadout('char-type', CHARACTER_TYPES[this.character.type].label);
      setReadout('char-hp', this.character.hp);
      setReadout('char-max-hp', this.character.maxHp);

      const dmgLabel = this.character.damage
        + (this.character.magicType ? ' (magic)' : '');
      setReadout('char-damage', dmgLabel);
      setReadout('char-speed', this.character.speed + 's');
      setReadout('char-loops', this.character.loops);

      // Passive feedback — show last trigger result.
      const passiveEl = document.querySelector('[data-testid="char-passive"]');
      if (passiveEl) {
        if (this.character.lastPassiveTriggered) {
          const effects = this.character.lastPassiveEffects
            .map(e => `${e.stat}: ${e.before} → ${e.after}`)
            .join(', ');
          passiveEl.textContent = `✓ ${this.character.passive.name} (${effects})`;
          passiveEl.classList.add('passive-flash');
          setTimeout(() => passiveEl.classList.remove('passive-flash'), 800);
        } else {
          passiveEl.textContent = this.character.passive
            ? this.character.passive.name
            : '—';
        }
      }
    }
  }

  // Expose a small API on window so Playwright can drive and inspect the game.
  exposeApi() {
    const scene = this;
    window.__game = {
      getState() {
        return {
          position: scene.position,
          dice: scene.lastRoll.slice(),
          sum: (scene.lastRoll[0] || 0) + (scene.lastRoll[1] || 0),
          rolling: scene.rolling,
          character: scene.character ? scene.character.toJSON() : null,
        };
      },
      roll() {
        scene.roll();
      },
      rollWith(d1, d2) {
        scene.roll(d1, d2);
      },
      /** Direct access to the Character instance for testing. */
      getCharacter() {
        return scene.character;
      },
    };
    window.__gameReady = true;
  }
}

// Phaser 4 is WebGL-only; omitting `type` selects the WebGL renderer.
new Phaser.Game({
  width: W,
  height: H,
  backgroundColor: '#ffffff',
  parent: 'game',
  scene: [BoardScene],
});
