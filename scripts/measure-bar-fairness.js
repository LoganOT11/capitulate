#!/usr/bin/env node
/* Dice-bar fairness harness — samples the owned-dice bar (PixelDiceDeluxe, the
 * slot-machine spinner) at scale, with no browser and no rendering, to answer
 * two questions for a bar holding multiple dice at once:
 *
 *   1. FAIRNESS  — is each face 1-6 equally likely? The bar's faces come from
 *      the in-game source `Die.roll()` (Math.floor(rand*6)+1), the same call
 *      that rolls a character's bought dice. We sample that source directly.
 *
 *   2. FIDELITY  — does the spinner actually LAND on the face it was told to
 *      show? roller.simulateResult(values) runs the real staggered
 *      spin -> land -> settle (shared with the animated path) on a fixed 60 fps
 *      virtual clock and returns each die's settled top face. If the settled
 *      face ever differs from the intended one, the displayed distribution would
 *      drift from the (fair) source — so we assert settled === intended for
 *      every die of every roll. Run with several dice so any stagger/index
 *      coupling between concurrent reels would show up.
 *
 *   node scripts/measure-bar-fairness.js [rollsPerConfig]   (default 50000)
 *
 * Single-threaded; CPU-bound. The reported settled-face distribution equals the
 * source distribution exactly when fidelity holds (0 mismatches).
 */
'use strict';

const path = require('path');

// --- Minimal canvas/DOM stubs so the renderer factory constructs under Node ---
// simulateResult never draws, so every 2D-context method is a no-op; only the
// one-time sprite/buffer bake at construction touches the context at all.
const noop = () => {};
function makeCtx() {
  return {
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)) }),
    createImageData: (w, h) => ({ width: w | 0, height: h | 0, data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)) }),
    putImageData: noop, drawImage: noop, fillRect: noop, clearRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, save: noop, restore: noop,
    translate: noop, scale: noop, rotate: noop, setTransform: noop, transform: noop,
    fillText: noop, strokeText: noop, measureText: () => ({ width: 0 }),
    createPattern: () => null, setLineDash: noop,
  };
}
const makeCanvas = (w, h) => ({ width: w | 0, height: h | 0, style: {}, getContext: makeCtx });
global.document = { createElement: () => makeCanvas(0, 0) };
let _vt = 0;
global.performance = { now: () => _vt };
global.requestAnimationFrame = () => 0;   // headless: the loop is driven manually
global.cancelAnimationFrame = () => {};

// Require the bar renderer BEFORE any `window` exists, so it attaches to this
// module's exports (root = module.exports) and we can destructure it.
const { PixelDiceDeluxe } = require(path.join(__dirname, '..', 'src', 'render', 'pixel-dice-deluxe.js'));

// The in-game face source: a bought Die's roll(). Load with a throwaway window.
global.window = {};
require(path.join(__dirname, '..', 'src', 'engine', 'dice', 'die.js'));
const Die = global.window.Die;
delete global.window;

const N = Math.max(1, parseInt(process.argv[2], 10) || 50000);
const CONFIGS = [1, 2, 8];   // dice on the bar at once — incl. "multiple dice"

function chiSquareUniform(counts) {
  const n = counts.slice(1).reduce((a, b) => a + b, 0), e = n / 6;
  let x2 = 0;
  for (let f = 1; f <= 6; f++) { const d = counts[f] - e; x2 += d * d / e; }
  return { x2, n };
}
function printDist(label, counts) {
  const { x2, n } = chiSquareUniform(counts);
  console.log(`  ${label} (${n.toLocaleString()} samples):`);
  for (let f = 1; f <= 6; f++) {
    console.log(`    ${f}: ${String(counts[f]).padStart(9)}  ` +
      `${(100 * counts[f] / n).toFixed(3).padStart(7)}%  (expect 16.667%)`);
  }
  console.log(`    chi-square = ${x2.toFixed(2)} (df=5; fair if < 11.07 @95%, < 15.09 @99%)`);
}

console.log(`\n=== Dice-bar fairness — ${N.toLocaleString()} rolls per config ===`);

const die = new Die({ name: 'Bought', category: 'bought' });
const overall = new Array(7).fill(0);   // settled faces, all configs pooled

for (const M of CONFIGS) {
  const roller = PixelDiceDeluxe({ canvas: makeCanvas(200, 200), count: M, theme: 'gold', grid: true, columns: 2 });
  const source = new Array(7).fill(0);                       // Die.roll() faces fed in
  const settledByPos = Array.from({ length: M }, () => new Array(7).fill(0));
  let mismatches = 0, mmExample = null;

  const t0 = Date.now();
  const intended = new Array(M);
  for (let r = 0; r < N; r++) {
    for (let i = 0; i < M; i++) { const v = die.roll(); intended[i] = v; source[v]++; }
    const settled = roller.simulateResult(intended);        // REAL spin -> settle
    for (let i = 0; i < M; i++) {
      const s = settled[i];
      settledByPos[i][s]++;
      overall[s]++;
      if (s !== intended[i]) { mismatches++; if (!mmExample) mmExample = { pos: i, want: intended[i], got: s }; }
    }
  }
  const secs = (Date.now() - t0) / 1000;
  const rate = Math.round((N * M) / secs);

  console.log(`\n--- ${M} ${M === 1 ? 'die' : 'dice'} on the bar ` +
    `(${(N * M).toLocaleString()} die-rolls in ${secs.toFixed(1)}s, ${rate.toLocaleString()} die-rolls/s) ---`);
  console.log(`  FIDELITY: settled face == intended for ${(N * M - mismatches).toLocaleString()}/${(N * M).toLocaleString()}` +
    ` die-rolls  ->  ${mismatches === 0 ? 'PASS (0 mismatches)' : `FAIL (${mismatches} mismatches, e.g. ${JSON.stringify(mmExample)})`}`);
  printDist('source Die.roll()', source);
  for (let i = 0; i < M; i++) printDist(`settled, reel #${i + 1}`, settledByPos[i]);
}

console.log('\n--- all configs pooled (settled faces) ---');
printDist('settled', overall);
console.log('');
