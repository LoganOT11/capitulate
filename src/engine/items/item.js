// --- Item -----------------------------------------------------------------
// An equippable item that triggers when a die rolls a specific pip value.
// Items are placed in a 2D grid (ItemSlots) and can have adjacency effects.
//
// pip      — the face value that triggers this item (1-6)
// effect   — { type, value } where type is "damage" | "heal" | "gold" | "buff"
// adjacent — if true, triggers adjacent items in the grid too (chain reaction)

class Item {
  /**
   * @param {object} opts
   * @param {string} opts.name        — display name
   * @param {string} [opts.description]
   * @param {number} opts.pip         — trigger pip (1-6)
   * @param {object} opts.effect      — { type: string, value: number }
   * @param {boolean} [opts.adjacent] — trigger neighbors on activation
   */
  constructor({ name, description = '', pip, effect, adjacent = false } = {}) {
    this.name        = name;
    this.description = description;
    this.pip         = pip;
    this.effect      = effect;
    this.adjacent    = adjacent;
  }

  toJSON() {
    return {
      name: this.name,
      pip: this.pip,
      effect: this.effect,
      adjacent: this.adjacent,
    };
  }
}

// --- ItemSlots ------------------------------------------------------------
// 2D grid that holds equipped items.
// Rows × Cols = 6 slots total.  Items can be placed anywhere in the grid.
// Adjacent items (up/down/left/right) can trigger each other.

class ItemSlots {
  /**
   * @param {number} rows — grid rows (default 2)
   * @param {number} cols — grid columns (default 3)
   */
  constructor(rows = 2, cols = 3) {
    this.rows = rows;
    this.cols = cols;
    // 2D array: this.grid[row][col] = Item | null
    this.grid = [];
    for (let r = 0; r < rows; r++) {
      this.grid.push(new Array(cols).fill(null));
    }
  }

  /** Total slot count. */
  get capacity() {
    return this.rows * this.cols;
  }

  /** Number of equipped items. */
  get equipped() {
    let n = 0;
    for (const row of this.grid) {
      for (const cell of row) {
        if (cell) n++;
      }
    }
    return n;
  }

  /** True if all slots are full. */
  get full() {
    return this.equipped >= this.capacity;
  }

  /**
   * Place an item at (row, col).
   * Returns true on success, false if slot is occupied.
   */
  set(row, col, item) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return false;
    }
    if (this.grid[row][col] !== null) {
      return false;
    }
    this.grid[row][col] = item;
    return true;
  }

  /** Remove item at (row, col). Returns the item or null. */
  remove(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return null;
    }
    const item = this.grid[row][col];
    this.grid[row][col] = null;
    return item;
  }

  /** Get item at (row, col). */
  get(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return null;
    }
    return this.grid[row][col];
  }

  /**
   * Find all items that trigger on a given pip value.
   * Returns [{ item, row, col }]
   */
  findByPip(pip) {
    const matches = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] && this.grid[r][c].pip === pip) {
          matches.push({ item: this.grid[r][c], row: r, col: c });
        }
      }
    }
    return matches;
  }

  /**
   * Get adjacent positions (up/down/left/right) for a given cell.
   * Returns [{ row, col }]
   */
  getAdjacent(row, col) {
    const neighbors = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
        neighbors.push({ row: nr, col: nc });
      }
    }
    return neighbors;
  }

  /** Flat list of all equipped items. */
  allItems() {
    const items = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) {
          items.push({ item: this.grid[r][c], row: r, col: c });
        }
      }
    }
    return items;
  }

  toJSON() {
    return this.grid.map(row => row.map(item => item ? item.toJSON() : null));
  }
}

window.Item = Item;
window.ItemSlots = ItemSlots;
