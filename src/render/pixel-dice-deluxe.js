/* ===========================================================
 *  Pixel slot-machine dice — reusable factory.
 *  Extracted from the standalone "pixel-dice-deluxe" tuner.
 *  Each instance owns its canvas, pixel buffer, dice state and
 *  RAF loop. Faces are procedurally lit (height field -> normals
 *  -> diffuse + specular + AO -> posterized ramp) and cached as
 *  sprites, blitted at whole-pixel positions (no smoosh).
 *
 *  Sprites are immutable for a given (theme, resolution) pair, so
 *  they're cached module-wide and shared across instances.
 *
 *  Usage:
 *    const bar = PixelDiceDeluxe({ canvas, count: 1, theme: 'gold' });
 *    bar.setCount(3);
 *    bar.roll([4, 2, 6], onDone);   // animate to these faces
 * =========================================================== */
(function (root) {
  const ORDER = [1, 2, 3, 4, 5, 6];
  const faceForSlot = k => ORDER[((k % 6) + 6) % 6];
  const mod6 = x => ((x % 6) + 6) % 6;
  const PIPS = {
    1: [[0, 0]], 2: [[-.5, -.5], [.5, .5]], 3: [[-.5, -.5], [0, 0], [.5, .5]],
    4: [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]],
    5: [[-.5, -.5], [.5, -.5], [0, 0], [-.5, .5], [.5, .5]],
    6: [[-.5, -.6], [-.5, 0], [-.5, .6], [.5, -.6], [.5, 0], [.5, .6]],
  };
  const pipUnit = FS => Math.max(1, Math.round(FS / 16));

  const clamp = (v, a, bb) => v < a ? a : v > bb ? bb : v;
  const smoothstep = (a, bb, x) => { const t = clamp((x - a) / (bb - a), 0, 1); return t * t * (3 - 2 * t); };
  function normalize(v) { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; }
  function lookup(stops, t) {
    t = clamp(t, 0, 1);
    for (let i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1][0]) {
        const a = stops[i], c = stops[i + 1], f = (t - a[0]) / ((c[0] - a[0]) || 1);
        return [a[1][0] + (c[1][0] - a[1][0]) * f, a[1][1] + (c[1][1] - a[1][1]) * f, a[1][2] + (c[1][2] - a[1][2]) * f];
      }
    }
    return stops[stops.length - 1][1].slice();
  }

  const GEOM = {
    amb: 0.32, bands: 8, chamfer: 0.17, corner: 0.16, dome: 0.13,
    pitDepth: 0.60, relief: 0.085, shininess: 16, specStr: 0.8, ao: 0.55,
  };
  const LIGHT = [-0.6, -0.66, 0.46];

  const THEMES = {
    gold: { name: 'Gold', accent: 'rgba(236,193,90,0.5)', pipShape: 'plus',
      body: [[0, [44, 26, 46]], [.18, [96, 46, 56]], [.36, [152, 76, 50]], [.54, [198, 122, 52]], [.72, [230, 168, 74]], [.86, [246, 208, 122]], [1, [255, 242, 200]]],
      pip: [[0, [16, 10, 20]], [.55, [46, 30, 42]], [1, [96, 64, 74]]], spec: [255, 248, 225] },
    ivory: { name: 'Ivory', accent: 'rgba(214,206,184,0.5)', pipShape: 'plus',
      body: [[0, [58, 52, 62]], [.22, [112, 100, 98]], [.42, [162, 148, 138]], [.62, [202, 190, 172]], [.8, [228, 220, 202]], [1, [249, 245, 234]]],
      pip: [[0, [30, 28, 38]], [.55, [62, 58, 68]], [1, [104, 98, 108]]], spec: [255, 255, 250] },
    crimson: { name: 'Crimson', accent: 'rgba(228,120,96,0.5)', pipShape: 'plus',
      body: [[0, [36, 8, 18]], [.2, [86, 16, 30]], [.4, [140, 28, 40]], [.6, [188, 48, 52]], [.8, [224, 96, 88]], [1, [250, 176, 156]]],
      pip: [[0, [18, 4, 10]], [.55, [50, 16, 24]], [1, [96, 38, 42]]], spec: [255, 222, 210] },
    obsidian: { name: 'Obsidian', accent: 'rgba(150,165,205,0.5)', pipShape: 'plus',
      body: [[0, [10, 12, 18]], [.25, [26, 30, 42]], [.5, [50, 56, 74]], [.7, [80, 90, 114]], [.85, [124, 134, 162]], [1, [200, 210, 236]]],
      pip: [[0, [120, 124, 140]], [.55, [182, 186, 202]], [1, [238, 241, 250]]], spec: [235, 240, 255] },
    jade: { name: 'Jade', accent: 'rgba(120,200,150,0.5)', pipShape: 'plus',
      body: [[0, [12, 30, 24]], [.25, [22, 60, 44]], [.5, [42, 98, 68]], [.7, [72, 142, 98]], [.85, [122, 188, 136]], [1, [204, 238, 204]]],
      pip: [[0, [10, 22, 18]], [.55, [32, 58, 46]], [1, [74, 114, 88]]], spec: [240, 255, 240] },
  };
  function buildTheme(key) { return Object.assign({}, GEOM, THEMES[key] || THEMES.gold); }

  // ---------- procedural die renderer ----------
  function buildHeight(FS, v, th) {
    const H = new Float32Array(FS * FS), inside = new Uint8Array(FS * FS),
      isPip = new Uint8Array(FS * FS), pitD = new Float32Array(FS * FS);
    const hw = FS / 2, cx = FS / 2, cy = FS / 2, r = FS * th.corner, cw = FS * th.chamfer, u = pipUnit(FS), half = FS / 2;
    const pips = v ? PIPS[v].map(([px, py]) => [half * (1 + 0.6 * px), half * (1 + 0.6 * py)]) : [];
    const arm = 1.5 * u, thick = u / 2, rad = 1.25 * u, wall = Math.max(1, u * 0.55);
    function sdfIn(x, y) {
      const qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hw - r);
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const ins = Math.min(Math.max(qx, qy), 0);
      return -(out + ins - r);
    }
    function pipAmt(x, y) {
      let best = 0;
      for (const [px, py] of pips) {
        let d;
        if (th.pipShape === 'round') d = rad - Math.hypot(x - px, y - py);
        else {
          const dv = Math.min(thick - Math.abs(x - px), arm - Math.abs(y - py));
          const dh = Math.min(arm - Math.abs(x - px), thick - Math.abs(y - py)); d = Math.max(dv, dh);
        }
        const a = clamp(d / wall, 0, 1); if (a > best) best = a;
      }
      return best;
    }
    for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) {
      const di = sdfIn(x, y), idx = y * FS + x;
      if (di <= 0) continue;
      inside[idx] = 1;
      let h = smoothstep(0, cw, di);
      const dd = Math.hypot(x - cx, y - cy) / hw; h += th.dome * (1 - dd * dd);
      const pa = pipAmt(x, y);
      if (pa > 0) { h -= th.pitDepth * pa; pitD[idx] = pa; if (pa > 0.5) isPip[idx] = 1; }
      H[idx] = h;
    }
    return { H, inside, isPip, pitD };
  }
  function shadeDie(g, FS, v, th) {
    const { H, inside, isPip, pitD } = buildHeight(FS, v, th);
    const img = g.createImageData(FS, FS), d = img.data;
    const L = normalize(LIGHT), Hh = normalize([L[0], L[1], L[2] + 1]);
    const relief = FS * th.relief;
    for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) {
      const idx = y * FS + x, o = idx * 4;
      if (!inside[idx]) { d[o + 3] = 0; continue; }
      const xl = x > 0 ? x - 1 : x, xr = x < FS - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < FS - 1 ? y + 1 : y;
      let nx = (H[y * FS + xl] - H[y * FS + xr]) * relief, ny = (H[yu * FS + x] - H[yd * FS + x]) * relief, nz = 1;
      const iv = 1 / Math.hypot(nx, ny, nz); nx *= iv; ny *= iv; nz *= iv;
      let diff = nx * L[0] + ny * L[1] + nz * L[2]; if (diff < 0) diff = 0;
      let bright = th.amb + (1 - th.amb) * diff;
      let sp = nx * Hh[0] + ny * Hh[1] + nz * Hh[2]; if (sp < 0) sp = 0; sp = Math.pow(sp, th.shininess) * th.specStr;
      let col;
      if (isPip[idx]) {
        let bp = clamp(bright * (1 - th.ao * pitD[idx]), 0, 1);
        bp = Math.round(bp * (th.bands - 1)) / (th.bands - 1);
        col = lookup(th.pip, bp);
        const s = sp * 0.5; col = [col[0] + (th.spec[0] - col[0]) * s, col[1] + (th.spec[1] - col[1]) * s, col[2] + (th.spec[2] - col[2]) * s];
      } else {
        let bb = Math.round(clamp(bright, 0, 1) * (th.bands - 1)) / (th.bands - 1);
        col = lookup(th.body, bb);
        const glint = Math.min(1, Math.max(0, sp - 0.35) * 2.2);
        if (glint > 0) col = [col[0] + (th.spec[0] - col[0]) * glint, col[1] + (th.spec[1] - col[1]) * glint, col[2] + (th.spec[2] - col[2]) * glint];
      }
      d[o] = clamp(col[0], 0, 255); d[o + 1] = clamp(col[1], 0, 255); d[o + 2] = clamp(col[2], 0, 255); d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  // ---------- shared sprite cache (per theme + tier) ----------
  const spriteCache = {};
  function getSprites(th, FS) {
    const key = th.name + ':' + FS;
    if (spriteCache[key]) return spriteCache[key];
    const faces = {};
    for (let v = 1; v <= 6; v++) {
      const c = document.createElement('canvas'); c.width = FS; c.height = FS;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false; shadeDie(g, FS, v, th); faces[v] = c;
    }
    const bc = document.createElement('canvas'); bc.width = FS; bc.height = FS;
    const bg = bc.getContext('2d'); bg.imageSmoothingEnabled = false; shadeDie(bg, FS, null, th);
    const set = { faces, body: bc };
    spriteCache[key] = set;
    return set;
  }

  // ---------- shared edge-vignette cache (per face size) ----------
  // The reel's top/bottom darkening is identical for every die of a given size,
  // so bake it once and blit it at the right opacity instead of allocating a
  // fresh gradient per die per frame.
  const vignetteCache = {};
  function getVignette(FS) {
    if (vignetteCache[FS]) return vignetteCache[FS];
    const c = document.createElement('canvas'); c.width = FS; c.height = FS;
    const g = c.getContext('2d');
    const og = g.createLinearGradient(0, 0, 0, FS);
    og.addColorStop(0, 'rgba(6,4,8,1)');
    og.addColorStop(0.34, 'rgba(6,4,8,0)');
    og.addColorStop(0.66, 'rgba(6,4,8,0)');
    og.addColorStop(1, 'rgba(6,4,8,1)');
    g.fillStyle = og; g.fillRect(0, 0, FS, FS);
    vignetteCache[FS] = c; return c;
  }

  const DEFAULTS = {
    dur: 1600, stagger: 160, rate: 0.018, minSpins: 5,
    accel: 3.3, settle: 0.8, bounceAmp: 0.5, bounceCyc: 2.8, squash: 0, blurFull: 1.2,
  };
  const TIERS = [16, 24, 32, 48, 64, 90];

  function roundRect(c, x, y, w, h, r) {
    if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, r); return; }
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ---------- instance factory ----------
  function PixelDiceDeluxe(opts) {
    const canvas = opts.canvas;
    const PIXEL = Math.max(1, (opts.pixel | 0) || 4);   // buffer downscale (chunkiness)
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    let BW = Math.max(1, Math.round(canvas.width / PIXEL));
    let BH = Math.max(1, Math.round(canvas.height / PIXEL));
    const buf = document.createElement('canvas'); buf.width = BW; buf.height = BH;
    let b = buf.getContext('2d'); b.imageSmoothingEnabled = false;
    // Static background (flat fill + diagonal hatch) is identical every frame, so
    // bake it once per size and blit it, instead of re-stroking ~60 lines/frame.
    const bgCanvas = document.createElement('canvas');
    const bgCtx = bgCanvas.getContext('2d');

    const cfg = Object.assign({}, DEFAULTS, opts.cfg || {});
    // Grid mode: fixed-size dice in a column-major slot grid that grows downward.
    // The canvas height tracks the dice count so an overflow:auto container scrolls.
    const grid = !!opts.grid;
    const gridCols = Math.max(0, opts.columns | 0);   // 0 = derive columns from width / slot
    const gridSlot = Math.max(8, opts.slot || 96);    // target slot size (css px) when deriving
    let theme = buildTheme(opts.theme || 'gold');
    let sprites = null, curFS = 0;
    let dice = [], count = 0, cells = [], rolling = false, t0 = 0, ROLL_MAX = 0, onDone = null;
    // Grid-mode windowing: the canvas is only the visible viewport; dice cells
    // live in full content space and are culled/offset by the scroll position,
    // so memory + per-frame work stay flat no matter how many dice there are.
    let scrollTop = 0, contentH = 0, gridCell = 0;

    // Spin-until-stop timings, matched to the pixel-dice-deluxe demo's feel:
    //   cruise  — steady loop speed while waiting for the board dice (slots/ms)
    //   RAMP_MS — quick spin-up after each die's staggered start
    //   LAND_MS — the landing duration; the land curve mirrors the demo's
    //             reelState (accelerate into a slam at `settle`, then bounce),
    //             but starts velocity-continuous from `cruise` so there's no hitch.
    let mode = null, lastT = 0, running = false, rafId = 0;
    const cruise = cfg.rate;
    const RAMP_MS = 350;
    const LAND_MS = cfg.dur;

    // Pick a face size for a cell. Never exceed the cell, so dice never overlap
    // at high counts — below the smallest tier we fall back to the raw cell size.
    function chooseTier(cell) {
      const lim = cell * 0.94; let best = TIERS[0];
      for (const T of TIERS) if (T <= lim) best = T;
      return Math.min(best, Math.max(6, Math.floor(lim)));
    }
    function layout() {
      cells = [];
      if (grid) {
        // Fixed slot grid, filled row-major (top-left first, like the item grid).
        // The canvas is just the viewport (BW×BH); cells are placed in full
        // content space and `contentH` drives the scroll spacer in the DOM.
        const cols = gridCols || Math.max(1, Math.round(canvas.width / gridSlot));
        const cell = BW / cols;
        const rows = Math.max(1, Math.ceil(Math.max(count, 1) / cols));
        gridCell = cell;
        contentH = Math.round(rows * cell * PIXEL);    // display px, for the scroll spacer
        const FS = chooseTier(cell);
        for (let i = 0; i < count; i++) {
          const c = i % cols, r = Math.floor(i / cols);
          cells.push({ cx: (c + 0.5) * cell, cy: (r + 0.5) * cell });   // content-space coords
        }
        if (FS !== curFS) { curFS = FS; sprites = getSprites(theme, FS); }
        return;
      }
      if (count <= 0) return;
      // Adaptive grid: choose the row count that maximises cell size.
      let rows = 1, bestCell = -1;
      for (let r = 1; r <= count; r++) {
        const cols = Math.ceil(count / r);
        const cell = Math.min(BW / cols, BH / r);
        if (cell > bestCell + 1e-3) { bestCell = cell; rows = r; }
      }
      const cols = Math.ceil(count / rows);
      const cellW = BW / cols, cellH = BH / rows;
      const FS = chooseTier(Math.min(cellW, cellH));
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / cols), c = i - r * cols;
        const inRow = Math.min(cols, count - r * cols);
        const off = (BW - inRow * cellW) / 2;          // centre the final (partial) row
        cells.push({ cx: off + (c + 0.5) * cellW, cy: (r + 0.5) * cellH });
      }
      if (FS !== curFS) { curFS = FS; sprites = getSprites(theme, FS); }
    }
    // Sync the pixel buffer + baked background to the current canvas size.
    function syncBuffer() {
      BW = Math.max(1, Math.round(canvas.width / PIXEL));
      BH = Math.max(1, Math.round(canvas.height / PIXEL));
      if (buf.width !== BW) buf.width = BW;
      if (buf.height !== BH) buf.height = BH;
      b = buf.getContext('2d'); b.imageSmoothingEnabled = false;
      ctx.imageSmoothingEnabled = false;
      buildBg();
    }
    // Bake the static background for the current buffer size.
    function buildBg() {
      bgCanvas.width = BW; bgCanvas.height = BH;
      const g = bgCtx; g.imageSmoothingEnabled = false;
      g.fillStyle = '#1a2230'; g.fillRect(0, 0, BW, BH);
      g.strokeStyle = 'rgba(255,255,255,0.035)'; g.lineWidth = 1;
      const D = 13;
      for (let c = -BH; c < BW + BH; c += D) {
        g.beginPath(); g.moveTo(c, 0); g.lineTo(c + BH, BH); g.stroke();
        g.beginPath(); g.moveTo(c, 0); g.lineTo(c - BH, BH); g.stroke();
      }
    }
    // Match the canvas to a new on-screen (viewport) size, then re-lay out.
    function resize(cssW, cssH) {
      const w = Math.max(PIXEL, Math.round(cssW));
      const h = Math.max(PIXEL, Math.round(cssH));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      curFS = 0;                       // force a sprite/layout refresh at the new size
      syncBuffer(); layout(); requestRedraw();
    }
    // Scroll the content window (grid mode); the canvas repaints the visible slice.
    function setScroll(top) {
      const s = Math.max(0, top | 0);
      if (s === scrollTop) return;
      scrollTop = s;
      requestRedraw();
    }
    function makeDie() {
      const r = 1 + Math.floor(Math.random() * 6), s = ORDER.indexOf(r);
      return {
        result: r, prev: r, pos: s, slot0: s, spinFaces: 0, start: 0, dur: cfg.dur, p: 0, _pp: s,
        // lottery fields
        lphase: 'idle', lt_spin: 0, lstopAt: 0, linit: false, lpos0: s, ltarget: s, lt0: 0, lbounce: 0, lsq: 1,
      };
    }
    function setCount(n) {
      count = Math.max(0, n | 0);
      // Keep existing dice (and their displayed faces) intact; only grow/shrink
      // the tail so adding a die never re-randomizes the ones already showing.
      if (count < dice.length) dice.length = count;
      else while (dice.length < count) dice.push(makeDie());
      layout();
      requestRedraw();
    }
    function roll(values, done) {
      if (rolling || count <= 0) { if (done) done(); return; }
      onDone = done || null;
      const stag = Math.min(cfg.stagger, 1100 / count);
      ROLL_MAX = 0;
      dice.forEach((d, i) => {
        d.prev = d.result;
        d.result = (values && values[i] != null) ? values[i] : (1 + Math.floor(Math.random() * 6));
        d.slot0 = ORDER.indexOf(d.prev);
        const offset = mod6(ORDER.indexOf(d.result) - d.slot0);
        d.start = i * stag; d.dur = cfg.dur;
        let n = Math.round((d.dur * cfg.rate - offset) / 6);
        if (n < cfg.minSpins) n = cfg.minSpins;
        d.spinFaces = offset + 6 * n;
        d._pp = d.slot0; d.p = 0;
        ROLL_MAX = Math.max(ROLL_MAX, d.start + d.dur);
      });
      rolling = true; mode = 'oneshot'; t0 = performance.now(); lastT = t0;
      ensureLoop();
    }

    // --- Spin-until-stop: staggered spin-up, loop, then staggered land -------
    const stagger = () => Math.min(cfg.stagger, 1100 / Math.max(1, count));
    // Begin the reels: each die spins up after its own staggered start, then
    // loops at cruise until stop() lands it.
    function spin(now = performance.now()) {
      if (count <= 0) return;
      const stag = stagger();
      dice.forEach((d, i) => {
        if (d.lphase !== 'spin') d.lt_spin = now + i * stag;   // staggered spin-up start
        d.lphase = 'spin'; d.linit = false; d.lbounce = 0; d.lsq = 1; d._pp = d.pos;
      });
      mode = 'lottery'; rolling = true; lastT = now;
      ensureLoop();
    }
    // Land the (spinning) reels onto `values`, staggered, then done().
    function stop(values, done, now = performance.now()) {
      if (mode !== 'lottery' || !rolling) { if (done) done(); return; }
      onDone = done || null;
      const stag = stagger();
      dice.forEach((d, i) => {
        if (values && values[i] != null) d.result = values[i];
        d.lphase = 'land'; d.lstopAt = now + i * stag; d.linit = false;
      });
    }
    // Advance one die; writes d.pos / d.lbounce / d.lsq for drawAll.
    // The land mirrors the demo's reelState — accelerate into a slam at `settle`,
    // then a pinned bounce — but its approach is velocity-continuous from the
    // current spin speed, so the reel never visibly stutters when it stops.
    function updateLottery(d, now, dt) {
      if (d.lphase === 'spin' || (d.lphase === 'land' && now < d.lstopAt)) {
        const v = cruise * smoothstep(0, RAMP_MS, now - d.lt_spin);   // 0 -> cruise
        d.pos += v * dt; d.lbounce = 0; d.lsq = 1;
        return;
      }
      if (d.lphase === 'land') {
        if (!d.linit) {
          d.linit = true; d.lt0 = now; d.lpos0 = d.pos; d.lv0 = cruise;   // carry spin speed in
          const resSlot = ORDER.indexOf(d.result);
          const want = d.pos + cruise * LAND_MS;                   // a generous slam distance
          d.ltarget = Math.round((want - resSlot) / 6) * 6 + resSlot;
          while (d.ltarget <= d.pos + 6) d.ltarget += 6;           // forward, with real spins left
        }
        const T = LAND_MS, Ts = cfg.settle * T, t = now - d.lt0;
        if (t < Ts) {
          // ease-in: velocity starts at lv0 (continuous with the spin) and
          // accelerates so the reel hits the target at the slam point.
          const tau = t / Ts, D = d.ltarget - d.lpos0, base = d.lv0 * Ts;
          d.pos = d.lpos0 + base * tau + (D - base) * tau * tau;
          d.lbounce = 0; d.lsq = 1;
        } else {
          const w = Math.min(1, (t - Ts) / (T - Ts));             // pinned + bounce
          const osc = Math.sin(w * Math.PI * cfg.bounceCyc) * Math.pow(1 - w, 2);
          d.pos = d.ltarget;
          d.lbounce = cfg.bounceAmp * osc; d.lsq = 1 + cfg.squash * osc;
          if (w >= 1) { d.lphase = 'idle'; d.lbounce = 0; d.lsq = 1; }
        }
      }
    }
    function reelState(die, p) {
      if (p <= 0) return { pos: die.pos, bounce: 0, sq: 1 };
      if (p < cfg.settle) {
        const x = p / cfg.settle;
        const e = Math.pow(x, cfg.accel);
        return { pos: die.slot0 + e * die.spinFaces, bounce: 0, sq: 1 };
      }
      const w = (p - cfg.settle) / (1 - cfg.settle);
      const osc = Math.sin(w * Math.PI * cfg.bounceCyc) * Math.pow(1 - w, 2);
      return { pos: die.slot0 + die.spinFaces, bounce: cfg.bounceAmp * osc, sq: 1 + cfg.squash * osc };
    }
    function drawBg() { b.drawImage(bgCanvas, 0, 0); }
    function drawReel(cell, die, st) {
      if (!sprites) return;
      const FS = curFS, STEP = FS, half = FS / 2;
      const cx = Math.round(cell.cx), cy = Math.round(cell.cy);
      const x0 = cx - half, y0 = cy - half, rad = Math.max(2, Math.round(FS * theme.corner));

      const speed = st.pos - die._pp; die._pp = st.pos;
      const blur = Math.min(1, Math.abs(speed) / cfg.blurFull);

      b.save();
      roundRect(b, x0, y0, FS, FS, rad); b.clip();
      b.fillStyle = '#120c14'; b.fillRect(x0, y0, FS, FS);

      const squashing = Math.abs(st.sq - 1) > 0.001;
      if (squashing) { b.save(); b.translate(cx, cy); b.scale(1, st.sq); b.translate(-cx, -cy); }

      const bp = Math.round(st.bounce * STEP);
      const kc = Math.round(st.pos);
      const baseY = Math.round(cy + (kc - st.pos) * STEP - bp);
      const dx = cx - half;
      for (let k = kc - 2; k <= kc + 2; k++) {
        const dy = baseY - half + (k - kc) * FS;
        if (dy > y0 + FS || dy + FS < y0) continue;
        b.drawImage(sprites.faces[faceForSlot(k)], dx, dy);
        if (blur > 0) { b.globalAlpha = blur; b.drawImage(sprites.body, dx, dy); b.globalAlpha = 1; }
      }
      if (squashing) b.restore();

      // Edge vignette — baked once per size, blitted at the right opacity.
      b.globalAlpha = 0.10 + 0.5 * blur;
      b.drawImage(getVignette(FS), x0, y0);
      b.globalAlpha = 1;

      if (blur > 0.35) {
        b.fillStyle = 'rgba(255,235,200,' + (0.05 * blur).toFixed(3) + ')';
        for (let s = 0; s < 3; s++) b.fillRect(x0, y0 + Math.round(FS * (0.28 + 0.22 * s)), FS, 1);
      }
      b.restore();

      roundRect(b, x0 + 0.5, y0 + 0.5, FS - 1, FS - 1, rad);
      b.lineWidth = 1; b.strokeStyle = theme.accent; b.stroke();
    }
    const _vcell = { cx: 0, cy: 0 };       // reused so culling allocates nothing
    function drawAll() {
      drawBg();
      const sBuf = grid ? scrollTop / PIXEL : 0;
      const halfCell = gridCell / 2;
      for (let i = 0; i < dice.length; i++) {
        const d = dice[i];
        let cell = cells[i];
        if (grid) {
          const cy = cell.cy - sBuf;
          if (cy + halfCell < 0 || cy - halfCell > BH) continue;   // off-screen → skip
          _vcell.cx = cell.cx; _vcell.cy = cy; cell = _vcell;
        }
        let st;
        if (mode === 'oneshot') st = reelState(d, d.p);
        else if (mode === 'lottery') st = { pos: d.pos, bounce: d.lbounce, sq: d.lsq };
        else st = { pos: d.pos, bounce: 0, sq: 1 };
        drawReel(cell, d, st);
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(buf, 0, 0, BW, BH, 0, 0, canvas.width, canvas.height);
    }

    function frame(now) {
      const dt = Math.min(50, now - lastT) || 0; lastT = now;
      if (mode === 'oneshot' && rolling) {
        const el = now - t0;
        for (const d of dice) d.p = Math.max(0, Math.min(1, (el - d.start) / d.dur));
        if (el >= ROLL_MAX) {
          rolling = false; mode = null;
          for (const d of dice) { d.pos = ORDER.indexOf(d.result); d.slot0 = d.pos; d.p = 0; d._pp = d.pos; }
          const cb = onDone; onDone = null; if (cb) cb();
        }
      } else if (mode === 'lottery' && rolling) {
        for (const d of dice) updateLottery(d, now, dt);
        if (dice.every(d => d.lphase === 'idle')) {
          rolling = false; mode = null;
          const cb = onDone; onDone = null; if (cb) cb();
        }
      }
      drawAll();
      if (rolling) rafId = requestAnimationFrame(frame);
      else { running = false; rafId = 0; }
    }

    // The RAF loop only runs while a spin/roll is in flight.
    function ensureLoop() {
      if (!running) { running = true; lastT = performance.now(); rafId = requestAnimationFrame(frame); }
    }
    // Draw a single resting frame when idle (e.g. after setCount) without looping.
    let redrawId = 0;
    function requestRedraw() {
      if (running) return;        // the loop is active and will redraw anyway
      cancelAnimationFrame(redrawId);
      redrawId = requestAnimationFrame(() => { redrawId = 0; if (!running) drawAll(); });
    }

    syncBuffer();
    setCount(opts.count || 0);

    // Headless fairness sampler: runs the REAL staggered spin → land → settle on
    // a fixed 60 fps virtual clock with no rendering and no RAF, then returns
    // each die's settled top face. Shares spin/stop/updateLottery with the
    // animated path, so sampled outcomes match what the bar actually shows.
    function simulateResult(values) {
      if (count <= 0) return [];
      const STEP = 1000 / 60;
      let now = 0;
      spin(now);
      stop(values || null, null, now);
      let guard = 0;
      while (rolling && guard++ < 200000) {
        const prev = now; now += STEP;
        for (const d of dice) updateLottery(d, now, now - prev);
        if (dice.every(d => d.lphase === 'idle')) { rolling = false; mode = null; }
      }
      return dice.map(d => faceForSlot(Math.round(d.pos)));
    }

    return {
      setCount,
      getCount: () => count,
      roll,
      spin,
      stop,
      resize,
      setScroll,
      getContentHeight: () => contentH,
      isRolling: () => rolling,
      simulateResult,
      setTheme: (k) => { theme = buildTheme(k); curFS = 0; layout(); requestRedraw(); },
    };
  }

  root.PixelDiceDeluxe = PixelDiceDeluxe;
})(typeof window !== 'undefined' ? window : this);
