/* global Phaser, Character, Die, CHARACTER_TYPES, ShopEngine, shopTypeForTile,
          GAME_MODES, SHOP_BATTLE */

// --- Board geometry -------------------------------------------------------
const TILE = 58;
const MARGIN = 28;
const BOARD = TILE * 11;
const W = BOARD + MARGIN * 2;
const H = BOARD + MARGIN * 2;
const TILE_COUNT = 40;
const STEP_MS = 140;

function tileToColRow(i) {
  if (i <= 10) return { col: 10 - i, row: 10 };
  if (i <= 20) return { col: 0, row: 20 - i };
  if (i <= 30) return { col: i - 20, row: 0 };
  return { col: 10, row: i - 30 };
}

function tileCenter(i) {
  const { col, row } = tileToColRow(i);
  return {
    x: MARGIN + col * TILE + TILE / 2,
    y: MARGIN + row * TILE + TILE / 2,
  };
}

// --- DOM helpers ----------------------------------------------------------
function setReadout(name, value) {
  const el = document.querySelector(`[data-testid="${name}"]`);
  if (el) el.textContent = String(value);
}

// Which of the 9 cells (row-major) carry a dot for each die face.
const PIP_LAYOUT = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Build a small 3×3 pip-face element for a die value (1–6). */
function makePipFace(value) {
  const face = document.createElement('div');
  face.className = 'pip-face';
  const on = new Set(PIP_LAYOUT[value] || []);
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('span');
    if (on.has(i)) cell.className = 'on';
    face.appendChild(cell);
  }
  return face;
}

/** Scale the fixed-size board so it fits the available stage area. */
function fitBoard() {
  const stage = document.getElementById('board-stage');
  const board = document.getElementById('board');
  if (!stage || !board) return;
  board.style.width = W + 'px';
  board.style.height = H + 'px';
  const scale = Math.min(stage.clientWidth / W, stage.clientHeight / H);
  board.style.transform = `scale(${scale > 0 ? scale : 1})`;
}

const CORNER_COLORS = {
  0:  0xd32f2f,
  10: 0x7b1fa2,
  20: 0x1565c0,
  30: 0xf9a825,
};

// --- Scene ----------------------------------------------------------------
class BoardScene extends Phaser.Scene {
  constructor() {
    super('board');
  }

  create() {
    this.position = 0;
    this.rolling = false;
    this.lastRoll = [null, null];
    this.remainingSteps = 0;  // steps left when paused for a shop/battle

    // --- Systems ----------------------------------------------------------
    this.character = new Character({ name: 'Hero', type: 'knight' });
    // Seed the two movement dice so the dice inventory reflects what rolls.
    this.character.dicePool.addMovement(new Die({ name: 'Movement', category: 'movement' }));
    this.character.dicePool.addMovement(new Die({ name: 'Movement', category: 'movement' }));
    this.shop      = new ShopEngine();
    this.gameState = 'board';

    this.drawBoard();
    this.setupDice();

    // Highlight graphic — drawn on top of the board, below the token.
    this.highlightGfx = this.add.graphics().setDepth(5);

    const start = tileCenter(this.position);
    this.token = this.add
      .circle(start.x, start.y, TILE * 0.3, CHARACTER_TYPES.knight.color)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(10);

    this.exposeApi();
    this.syncDom();
    this.renderInventories();

    // Wire buttons
    document.getElementById('roll-btn').disabled = false;
    document.getElementById('roll-btn')
      .addEventListener('click', () => this.roll());
    document.getElementById('shop-reroll-btn')
      .addEventListener('click', () => this.handleReroll());
    document.getElementById('shop-close-btn')
      .addEventListener('click', () => this.closeShop());

    // Scale the board to fit the viewport, and re-fit on window resize.
    fitBoard();
    window.addEventListener('resize', fitBoard);

    // Re-size dice chips whenever the inventory box is resized by the user.
    const diceBox = document.getElementById('dice-inventory');
    if (diceBox && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.layoutDiceInventory()).observe(diceBox);
    }
  }

  // --- Board rendering ----------------------------------------------------

  drawBoard() {
    const g = this.add.graphics();
    for (let i = 0; i < TILE_COUNT; i++) {
      const { col, row } = tileToColRow(i);
      const x = MARGIN + col * TILE;
      const y = MARGIN + row * TILE;
      const isCorner = i % 10 === 0;

      const color = isCorner
        ? (CORNER_COLORS[i] || 0xffe082)
        : 0xc8e6c9;

      g.fillStyle(color, 1);
      g.fillRect(x, y, TILE, TILE);
      g.lineStyle(2, 0x2e7d32, 1);
      g.strokeRect(x, y, TILE, TILE);

      const label = isCorner
        ? (i === 0 ? '⚔' : i === 10 ? '🛡' : i === 20 ? '🎲' : '🧪')
        : String(i);
      this.add.text(x + 4, y + 4, label, {
        fontSize: isCorner ? '18px' : '11px',
        color: isCorner ? '#fff' : '#33691e',
      });
    }
  }

  setupDice() {
    const canvas = document.getElementById('dice-canvas');
    this.diceRoller = window.PixelDice({
      canvas,
      count: 2,
      duration: 1500,
    });
  }

  // --- Tile highlight -----------------------------------------------------

  /** Draw a yellow border around the given tile index. */
  highlightTile(tileIndex) {
    const g = this.highlightGfx;
    g.clear();
    if (tileIndex == null) return;
    const { col, row } = tileToColRow(tileIndex);
    const x = MARGIN + col * TILE;
    const y = MARGIN + row * TILE;
    g.lineStyle(3, 0xffeb3b, 1);
    g.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
  }

  clearHighlight() {
    this.highlightGfx.clear();
  }

  // --- Dice rolling & movement --------------------------------------------

  roll(d1, d2) {
    if (this.rolling || this.gameState !== 'board') return;
    this.rolling = true;
    d1 = d1 != null ? d1 : Phaser.Math.Between(1, 6);
    d2 = d2 != null ? d2 : Phaser.Math.Between(1, 6);
    this.lastRoll = [d1, d2];
    this.preMovePosition = this.position;

    // Highlight the final destination tile immediately.
    const finalDest = (this.position + d1 + d2) % TILE_COUNT;
    this.highlightTile(finalDest);
    this.syncDom();

    this.diceRoller.roll([d1, d2], () => {
      this.character.processBoardRoll(d1, d2);
      this.stepMove(d1 + d2);
    });
  }

  /**
   * Move the token one tile at a time.
   * If we land on a corner tile, pause movement and trigger the event.
   * After the event closes, resumeMovement() continues the remaining steps.
   */
  stepMove(stepsLeft) {
    if (stepsLeft <= 0) {
      this.clearHighlight();
      this.checkLoopCompletion();
      this.rolling = false;
      this.syncDom();
      return;
    }

    this.position = (this.position + 1) % TILE_COUNT;
    const nextTile = this.position;

    const c = tileCenter(nextTile);
    this.tweens.add({
      targets: this.token,
      x: c.x,
      y: c.y,
      duration: STEP_MS,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        this.syncDom();

        // Check if we landed on a corner tile (pass-through or final destination)
        if (nextTile % 10 === 0) {
          this.remainingSteps = stepsLeft - 1;
          this.triggerCornerTile(nextTile);
          return; // movement pauses here; resumeMovement() continues
        }

        this.stepMove(stepsLeft - 1);
      },
    });
  }

  /** Continue movement after a shop/battle closes. */
  resumeMovement() {
    if (this.remainingSteps > 0) {
      this.stepMove(this.remainingSteps);
    } else {
      this.clearHighlight();
      this.checkLoopCompletion();
      this.rolling = false;
      this.syncDom();
    }
  }

  checkLoopCompletion() {
    const diceSum = (this.lastRoll[0] || 0) + (this.lastRoll[1] || 0);
    if (this.preMovePosition + diceSum >= TILE_COUNT) {
      this.character.completeLoop();
      this.syncDom();
    }
  }

  /** Get the final destination tile for this roll. */
  getFinalDestination() {
    const diceSum = (this.lastRoll[0] || 0) + (this.lastRoll[1] || 0);
    return (this.preMovePosition + diceSum) % TILE_COUNT;
  }

  // --- Corner tile triggers -----------------------------------------------

  triggerCornerTile(tileIndex) {
    if (tileIndex === SHOP_BATTLE) {
      this.triggerBattle();
    } else {
      const shopType = shopTypeForTile(tileIndex);
      if (shopType) {
        // Apply -1 discount if this shop tile is the final destination
        const isFinalDestination = this.remainingSteps === 0;
        this.openShop(shopType, isFinalDestination);
      }
    }
  }

  triggerBattle() {
    this.gameState = 'battle';
    this.character.gold += 10;
    this.syncDom();
    setTimeout(() => {
      this.gameState = 'board';
      this.syncDom();
      this.resumeMovement();
    }, 500);
  }

  // --- Shop ---------------------------------------------------------------

  openShop(shopType, isFinalDestination) {
    this.gameState = 'shop';
    this.shop.open(shopType);

    // Apply discount if shop is the final destination
    this.shop.setDiscount(isFinalDestination ? 1 : 0);

    document.getElementById('roll-btn').disabled = true;
    this.renderShop();
    document.getElementById('shop-panel').style.display = 'block';
  }

  closeShop() {
    this.shop.close();
    this.gameState = 'board';
    document.getElementById('shop-panel').style.display = 'none';
    document.getElementById('roll-btn').disabled = false;
    this.syncDom();
    this.resumeMovement();
  }

  handleReroll() {
    const result = this.shop.reroll(this.character);
    if (result.success) {
      this.renderShop();
      this.syncDom();
    }
  }

  handleBuy(index) {
    const result = this.shop.buy(index, this.character);
    if (result.success) {
      this.renderShop();
      this.syncDom();
      this.renderInventories();
    }
  }

  renderShop() {
    const title = document.querySelector('[data-testid="shop-title"]');
    const container = document.querySelector('[data-testid="shop-inventory"]');
    const rerollBtn = document.getElementById('shop-reroll-btn');

    const labels = { item: '🛡 Item Shop', dice: '🎲 Dice Shop', potion: '🧪 Potion Shop' };
    const discount = this.shop.discount || 0;
    title.textContent = labels[this.shop.shopType] || 'Shop'
      + (discount > 0 ? ' (−' + discount + 'g)' : '');

    const display = this.shop.getDisplay();
    container.innerHTML = '';

    for (const slot of display) {
      const el = document.createElement('div');
      el.className = 'shop-slot' + (slot.sold ? ' sold' : '');
      el.dataset.testid = `shop-slot-${slot.index}`;
      const costText = slot.sold ? 'SOLD' : slot.cost + 'g';
      el.innerHTML = `
        <div class="slot-name">${slot.name}</div>
        <div class="slot-cost">${costText}</div>
        ${slot.description ? `<div class="slot-desc">${slot.description}</div>` : ''}
      `;
      if (!slot.sold) {
        el.addEventListener('click', () => this.handleBuy(slot.index));
      }
      container.appendChild(el);
    }

    const cost = this.shop.rerollCost;
    rerollBtn.textContent = cost === 0 ? 'Reroll (Free)' : `Reroll (${cost}g)`;
  }

  // --- DOM sync -----------------------------------------------------------

  syncDom() {
    const [d1, d2] = this.lastRoll;
    const sum = (d1 || 0) + (d2 || 0);
    setReadout('die-1', d1 != null ? d1 : '-');
    setReadout('die-2', d2 != null ? d2 : '-');
    setReadout('sum', sum);
    setReadout('position', this.position);
    setReadout('rolling', this.rolling);

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
      setReadout('char-gold', this.character.gold);

      const abilityEl = document.getElementById('ability-desc');
      if (abilityEl) {
        abilityEl.textContent = this.character.passive
          ? this.character.passive.description
          : '';
      }

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

  // --- Inventories --------------------------------------------------------

  renderInventories() {
    this.renderItemInventory();
    this.renderDiceInventory();
  }

  /** Render the 2×3 item grid, showing equipped items and empty slots. */
  renderItemInventory() {
    const grid = document.getElementById('item-grid');
    if (!grid) return;
    const slots = this.character.itemSlots;
    grid.innerHTML = '';

    for (let r = 0; r < slots.rows; r++) {
      for (let c = 0; c < slots.cols; c++) {
        const item = slots.get(r, c);
        const cell = document.createElement('div');
        cell.className = 'item-slot ' + (item ? 'filled' : 'empty');
        cell.dataset.testid = `item-slot-${r}-${c}`;
        if (item) {
          cell.title = item.name + (item.description ? ' — ' + item.description : '');
          cell.innerHTML =
            `<span class="item-pip">⚅${item.pip}</span>` +
            `<span class="item-name">${item.name}</span>`;
        } else {
          cell.innerHTML = '<span class="item-empty">+</span>';
        }
        grid.appendChild(cell);
      }
    }
  }

  /** Render every owned die as a pip-face chip, then size them to fit. */
  renderDiceInventory() {
    const container = document.getElementById('dice-inventory');
    if (!container) return;
    const dice = this.character.dicePool.all;
    container.innerHTML = '';

    for (const die of dice) {
      const chip = document.createElement('div');
      chip.className = 'die-chip cat-' + die.category;
      chip.title = `${die.name} (${die.category})`;
      chip.appendChild(makePipFace(die.lastPip || 6));
      const name = document.createElement('span');
      name.className = 'die-chip-name';
      name.textContent = die.name;
      chip.appendChild(name);
      container.appendChild(chip);
    }

    const countEl = document.getElementById('dice-count');
    if (countEl) countEl.textContent = dice.length ? `(${dice.length})` : '';

    this.layoutDiceInventory();
  }

  /**
   * Pick the column count and chip size that best fills the (resizable) box
   * for the current dice count, so dice stay visible and shrink as more
   * are added.
   */
  layoutDiceInventory() {
    const container = document.getElementById('dice-inventory');
    if (!container) return;
    const n = container.childElementCount;
    if (n === 0) return;

    const gap = 6;
    const cw = Math.max(0, container.clientWidth - 16);   // minus 8px padding ×2
    const ch = Math.max(0, container.clientHeight - 16);

    let bestCols = 1;
    let bestSize = 0;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = (cw - gap * (cols - 1)) / cols;
      const h = (ch - gap * (rows - 1)) / rows;
      const size = Math.min(w, h);
      if (size > bestSize) { bestSize = size; bestCols = cols; }
    }

    bestSize = Math.max(28, Math.min(bestSize, 120)); // clamp for legibility
    container.style.setProperty('--dice-cols', bestCols);
    container.style.setProperty('--chip-size', bestSize + 'px');
  }

  // --- API ----------------------------------------------------------------

  exposeApi() {
    const scene = this;
    window.__game = {
      getState() {
        return {
          position: scene.position,
          dice: scene.lastRoll.slice(),
          sum: (scene.lastRoll[0] || 0) + (scene.lastRoll[1] || 0),
          rolling: scene.rolling,
          gameState: scene.gameState,
          remainingSteps: scene.remainingSteps,
          character: scene.character ? scene.character.toJSON() : null,
          shop: scene.shop.isOpen ? {
            type: scene.shop.shopType,
            inventory: scene.shop.getDisplay(),
            rerollCost: scene.shop.rerollCost,
            discount: scene.shop.discount,
          } : null,
        };
      },
      roll() { scene.roll(); },
      rollWith(d1, d2) { scene.roll(d1, d2); },
      getCharacter() { return scene.character; },
      getShop() { return scene.shop; },
      closeShop() { scene.closeShop(); },
      // Redraw stat/inventory panels after direct character mutations.
      refresh() { scene.syncDom(); scene.renderInventories(); },
    };
    window.__gameReady = true;
  }
}

new Phaser.Game({
  width: W,
  height: H,
  backgroundColor: '#ffffff',
  parent: 'game',
  scene: [BoardScene],
});
