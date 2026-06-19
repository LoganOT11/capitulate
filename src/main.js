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

// Vertical gap between the board and the dice panel (matches CSS gap).
const CENTER_GAP = 12;

/**
 * Lay out the centre column: make the board a square that fits beside the side
 * panels, then size the dice-storage panel beneath it to the same width.
 */
function fitLayout() {
  const col = document.getElementById('center-col');
  const stage = document.getElementById('board-stage');
  const board = document.getElementById('board');
  const dicePanel = document.getElementById('dice-panel');
  if (!col || !stage || !board) return;

  board.style.width = W + 'px';
  board.style.height = H + 'px';

  const diceH = dicePanel ? dicePanel.offsetHeight : 0;
  const availW = col.clientWidth;
  const availH = col.clientHeight - diceH - CENTER_GAP;
  const size = Math.max(0, Math.min(availW, availH));

  stage.style.width = size + 'px';
  stage.style.height = size + 'px';
  board.style.transform = `scale(${size / W})`;
  if (dicePanel) dicePanel.style.width = size + 'px';
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
    // Two movement dice — they live in the centre canvas and drive the steps.
    this.character.dicePool.addMovement(new Die({ name: 'Movement', category: 'movement' }));
    this.character.dicePool.addMovement(new Die({ name: 'Movement', category: 'movement' }));
    // Start with one bought die in the bar (harness for the bar animation).
    this.character.dicePool.addBought(new Die({ name: 'Bought', category: 'bought' }));
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
    document.getElementById('shop-toggle-btn')
      .addEventListener('click', () => this.toggleShopVisibility());
    document.getElementById('add-die-btn')
      .addEventListener('click', () => this.addBoughtDie());

    // Size the board + dice panel to the viewport, and re-fit on resize.
    fitLayout();
    window.addEventListener('resize', fitLayout);
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
    // Centre canvas — the physics movement-dice animation. Two cubes that lift,
    // tumble, bounce and settle, then glide home. The face left up is the result.
    const canvas = document.getElementById('dice-canvas');
    this.diceRoller = window.PixelDicePhysics({
      canvas,
      count: 2,
    });

    // Dice bar — bought dice only, via the deluxe slot-machine renderer.
    const barCanvas = document.getElementById('dice-bar-canvas');
    if (barCanvas && window.PixelDiceDeluxe) {
      this.barRoller = window.PixelDiceDeluxe({
        canvas: barCanvas,
        count: this.character.dicePool.bought.length,
        theme: 'gold',
      });
    }
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
    // Guard against re-rolling while a turn is resolving OR while the centre
    // dice are still gliding home from the previous roll.
    if (this.rolling || this.diceRoller.isRolling() || this.gameState !== 'board') return;
    this.rolling = true;
    this.syncDom();

    // rollWith(d1, d2) forces the movement values (deterministic test hook);
    // a plain roll lets the physics decide which faces land.
    const forced = (d1 != null && d2 != null) ? [d1, d2] : null;

    // Start both animations together: the centre cubes begin their tumble and
    // the dice bar begins its lottery spin.
    if (this.barRoller && this.barRoller.getCount() > 0) this.barRoller.spin();

    this.diceRoller.roll(forced, {
      // Fires once the centre dice have stopped moving and begin returning home.
      // This is the only moment the bar's lottery spin is allowed to stop.
      onReturn: (movePips) => {
        // Resolve the real roll using the settled movement faces. rollBoard fixes
        // the movement dice to these and rolls bought/combat for passives/items.
        const rollResult = this.character.dicePool.rollBoard(movePips);
        const boughtPips = this.character.dicePool.bought.map(die => die.lastPip);

        this.lastRoll = this.character.dicePool.movement.map(die => die.lastPip);
        this.preMovePosition = this.position;
        this.highlightTile((this.position + rollResult.movementSum) % TILE_COUNT);

        // Land the bar on the resolved bought values now that the centre settled.
        if (this.barRoller && this.barRoller.isRolling()) this.barRoller.stop(boughtPips);

        this.character.processBoardRoll(rollResult);
        this.stepMove(rollResult.movementSum);
        this.syncDom();
      },
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

    // Reveal the shop over the board, expanded, with a "Hide" toggle.
    const panel = document.getElementById('shop-panel');
    panel.classList.remove('collapsed');
    const toggle = document.getElementById('shop-toggle-btn');
    if (toggle) toggle.textContent = 'Hide';
    panel.style.display = 'flex';
  }

  /** Collapse the shop to a small bar so the board behind it is visible. */
  toggleShopVisibility() {
    const panel = document.getElementById('shop-panel');
    const toggle = document.getElementById('shop-toggle-btn');
    if (!panel) return;
    const collapsed = panel.classList.toggle('collapsed');
    if (toggle) toggle.textContent = collapsed ? 'View' : 'Hide';
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
    this.syncBarDice();
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

  /** Sync the dice bar (bought dice only) count + readout. */
  syncBarDice() {
    const n = this.character.dicePool.bought.length;
    if (this.barRoller) this.barRoller.setCount(n);
    const countEl = document.getElementById('dice-count');
    if (countEl) countEl.textContent = n ? `(${n})` : '';
  }

  /** Add a bought die to the bar (test button for the bar animation). */
  addBoughtDie() {
    if (this.rolling) return;
    this.character.dicePool.addBought(new Die({ name: 'Bought', category: 'bought' }));
    this.syncBarDice();
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
