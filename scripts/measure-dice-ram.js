#!/usr/bin/env node
/* Measures JS-heap usage of the dice renderers in Chromium (headless shell).
 *
 * Compares the original prototype (pixel-dice-fixed.html) against the optimized
 * engine (dice-demo.html / src/pixel-dice.js) at several dice counts, reporting:
 *   retained  - usedJSHeapSize after forced GC, at rest  (steady footprint)
 *   idle dlt  - heap max-min over ~1.2s while NOT rolling (idle churn)
 *   roll peak - heap growth above retained during a roll  (alloc pressure)
 *
 * Requires Chromium's precise memory info + exposed gc, both enabled via flags.
 */
const path = require('path');
const { spawn } = require('child_process');

const CLI_CORE = '/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(CLI_CORE);
const EXEC = '/home/logan/.cache/ms-playwright/chromium_headless_shell-1226/chrome-headless-shell-linux64/chrome-headless-shell';

// chrome-headless-shell needs NSS libs that aren't installed system-wide; the
// Playwright Firefox build bundles compatible copies. The browser inherits this
// env from the node process.
const NSS_DIR = '/home/logan/.cache/ms-playwright/firefox-1530/firefox';
process.env.LD_LIBRARY_PATH = NSS_DIR + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '');

const PORT = 8099;
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  return proc;
}

async function gcRetained(page) {
  // settle + collect a few times so retained excludes transient garbage
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.gc && window.gc()); await sleep(60); }
  return page.evaluate(() => performance.memory.usedJSHeapSize);
}

// Per-frame allocation of the rolling render path. We render N frames in a tight
// synchronous loop and sum the positive frame-to-frame usedJSHeapSize deltas
// (drops from GC are ignored). With precise-memory-info the heap size is
// byte-exact, so summing growth recovers true allocation regardless of when GC
// runs -- robust for both the high-churn original and the near-zero optimized.
const ONE = {
  optimized: 'window.__dice.__debugRenderFrame(0.3);',
  original: 'drawBg();for(let i=0;i<dice.length;i++)drawDie(cells[i],dice[i]);' +
    'ctx.clearRect(0,0,screen.width,screen.height);ctx.drawImage(buf,0,0,BW,BH,0,0,screen.width,screen.height);',
};
const PRE = { optimized: '', original: 'rolling=true;prog=0.3;' };
const POST = { optimized: '', original: 'rolling=false;' };

async function perFrameAlloc(page, kind) {
  const N = 600;
  const one = ONE[kind], pre = PRE[kind], post = POST[kind];
  await page.evaluate(`(()=>{${pre}for(let k=0;k<80;k++){${one}}${post}})()`); // warm up JIT
  const code = `(()=>{${pre}if(window.gc)window.gc();
    let prev=performance.memory.usedJSHeapSize,total=0;
    for(let k=0;k<${N};k++){${one}const h=performance.memory.usedJSHeapSize;const d=h-prev;if(d>0)total+=d;prev=h;}
    ${post}return total/${N};})()`;
  const vals = [];
  for (let t = 0; t < 3; t++) vals.push(await page.evaluate(code));
  vals.sort((a, b) => a - b);
  return vals[1]; // median of 3
}

const MB = (b) => (b / 1048576).toFixed(2);
const KB = (b) => (b / 1024).toFixed(1);

async function measure(page, kind, count) {
  if (kind === 'optimized') await page.evaluate((n) => window.__diceSetCount(n), count);
  else await page.evaluate((n) => setCount(n), count); // original: global fn decl
  await sleep(300);

  const retained = await gcRetained(page);
  const frameBytes = await perFrameAlloc(page, kind);
  return { retained, frameBytes, mbPerSec: frameBytes * 60 };
}

(async () => {
  const server = startServer();
  await sleep(700);

  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });

  const cases = [
    { kind: 'original', file: '/pixel-dice-fixed.html', counts: [1, 6, 20] },
    { kind: 'optimized', file: '/dice-demo.html', counts: [1, 6, 20, 50, 100] },
  ];

  const rows = [];
  for (const c of cases) {
    const page = await browser.newPage();
    await page.goto(BASE + c.file);
    await page.waitForTimeout(400);
    for (const n of c.counts) {
      const m = await measure(page, c.kind, n);
      rows.push({ kind: c.kind, count: n, ...m });
    }
    await page.close();
  }

  await browser.close();
  server.kill();

  console.log('\n=== Dice renderer allocation per rolling frame (Chromium headless) ===\n');
  console.log(['renderer  ', 'dice', 'retained(MB)', 'alloc/frame(KB)', 'churn@60fps(MB/s)'].join('  '));
  console.log('-'.repeat(72));
  for (const r of rows) {
    console.log([
      r.kind.padEnd(10),
      String(r.count).padStart(4),
      MB(r.retained).padStart(12),
      KB(r.frameBytes).padStart(15),
      MB(r.mbPerSec).padStart(17),
    ].join('  '));
  }
  console.log('\nNote: the optimized engine renders 0 frames while idle (RAF stops);');
  console.log('the original renders ~60 of these frames/sec continuously, even at rest.');

  // fixed canvas backing-store memory (independent of dice count)
  const screen = 720 * 540 * 4, buf = 180 * 135 * 4;
  console.log('\nFixed canvas backing store (both, any dice count): ' +
    MB(screen + buf) + ' MB  (' + MB(screen) + ' visible + ' + MB(buf) + ' buffer)');
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
