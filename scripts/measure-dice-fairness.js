#!/usr/bin/env node
/* Dice fairness harness — samples the REAL physics outcome distribution at
 * scale (no browser, no rendering) via PixelDicePhysics.simulateResult(), which
 * runs the exact lift → hover → phys roll the game uses and returns the settled
 * faces. Reports per-die face frequencies with a chi-square goodness-of-fit vs
 * uniform, and the two-die sum distribution vs the theoretical 2d6.
 *
 *   node scripts/measure-dice-fairness.js [N]      (default 200000, ~1000 rolls/s)
 *
 * Single-threaded. For millions, run a larger N (it is CPU-bound and trivially
 * parallelizable across processes if needed).
 */
'use strict';

// Minimal DOM stubs so the canvas renderer's factory constructs under Node.
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

const path = require('path');
const { PixelDicePhysics } = require(path.join(__dirname, '..', 'src', 'render', 'pixel-dice-physics.js'));

const N = Math.max(1, parseInt(process.argv[2], 10) || 200000);
const roller = PixelDicePhysics({ canvas: { width: 480, height: 360, getContext: () => ({}) }, count: 2 });

const faces = [new Array(7).fill(0), new Array(7).fill(0)]; // [die][1..6]
const sums = new Array(13).fill(0);                          // index 2..12

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const r = roller.simulateResult();
  faces[0][r[0]]++; faces[1][r[1]]++;
  sums[r[0] + r[1]]++;
}
const secs = (Date.now() - t0) / 1000;

function chiSquareUniform(counts) {
  const n = counts.slice(1).reduce((a, b) => a + b, 0), e = n / 6;
  let x2 = 0;
  for (let f = 1; f <= 6; f++) { const d = counts[f] - e; x2 += d * d / e; }
  return { x2, n };
}

console.log(`\n=== Dice fairness — ${N.toLocaleString()} rolls in ${secs.toFixed(1)}s ` +
  `(${Math.round(N / secs).toLocaleString()} rolls/s) ===\n`);
for (let d = 0; d < 2; d++) {
  const c = faces[d], { x2, n } = chiSquareUniform(c);
  console.log(`Die ${d + 1}:`);
  for (let f = 1; f <= 6; f++) {
    console.log(`  ${f}: ${String(c[f]).padStart(9)}  ${(100 * c[f] / n).toFixed(3).padStart(7)}%  (expect 16.667%)`);
  }
  console.log(`  chi-square = ${x2.toFixed(2)} (df=5; fair if < 11.07 @95%, < 15.09 @99%)\n`);
}
console.log('Two-die sum vs theoretical 2d6:');
const theo = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const totalSums = sums.reduce((a, b) => a + b, 0);
for (let s = 2; s <= 12; s++) {
  console.log(`  ${String(s).padStart(2)}: obs ${(100 * sums[s] / totalSums).toFixed(3).padStart(7)}%   ` +
    `exp ${(100 * theo[s] / 36).toFixed(3).padStart(7)}%`);
}
console.log('');
