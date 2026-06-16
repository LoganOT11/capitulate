/* =====================================================================
 *  Pixel-art tumbling dice — reusable, low-allocation engine.
 *
 *  Exposes a global factory:  window.PixelDice({ canvas, ... }) -> roller
 *
 *  Design goals (see DICE_PERFORMANCE.md):
 *   - ONE low-res offscreen buffer is scaled up with `image-rendering:pixelated`.
 *     Canvas memory is fixed by the canvas size, NOT by the number of dice.
 *   - The hot render path performs ~zero per-frame heap allocation: all math
 *     scratch is preallocated and reused, colors are precomputed lookups, and
 *     pip geometry is baked once at load.
 *   - The requestAnimationFrame loop only runs while dice are actually rolling
 *     (plus a single frame to settle / redraw). When idle, nothing renders.
 *
 *  The visible motion is identical to the original prototype: the cube rests on
 *  one flat face, tumbles around a single tilted axis with a slow-in / long
 *  slow-out speed curve, and swaps to the result face at peak speed.
 * ===================================================================== */
(function (global) {
  'use strict';

  var cos = Math.cos, sin = Math.sin, PI = Math.PI, TWO_PI = PI * 2;
  var FOCAL = 7;
  var PEAK = 0.40;   // fraction of the roll where speed peaks (= face swap point)
  var TAIL = 3;      // higher = longer, slower wind-down
  var TILT = 0.62;

  // fixed spin axis, tilted off every face so all faces tumble
  var AXIS = (function () { var v = [0.78, 0.62, 0.24], m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; })();

  // --- geometry ------------------------------------------------------
  var V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  var FACES = [
    { v: [0, 1, 2, 3], num: 1, n: [0, 0, -1] }, { v: [4, 5, 6, 7], num: 6, n: [0, 0, 1] },
    { v: [1, 5, 6, 2], num: 2, n: [1, 0, 0] }, { v: [0, 4, 7, 3], num: 5, n: [-1, 0, 0] },
    { v: [0, 1, 5, 4], num: 3, n: [0, -1, 0] }, { v: [3, 2, 6, 7], num: 4, n: [0, 1, 0] }
  ];
  var TARGET = { 1: [0, 0, 0], 6: [0, PI, 0], 2: [0, PI / 2, 0], 5: [0, -PI / 2, 0], 3: [PI / 2, 0, 0], 4: [-PI / 2, 0, 0] };
  var PIPS = {
    1: [[0, 0]], 2: [[-.5, -.5], [.5, .5]], 3: [[-.5, -.5], [0, 0], [.5, .5]],
    4: [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]],
    5: [[-.5, -.5], [.5, -.5], [0, 0], [-.5, .5], [.5, .5]],
    6: [[-.5, -.6], [-.5, 0], [-.5, .6], [.5, -.6], [.5, 0], [.5, .6]]
  };

  // --- baked pip geometry --------------------------------------------
  // Each pip is two thin bars (a plus sign) living in the face plane. Their
  // corner positions in object space are constant, so we compute them once.
  // PIP_GEOM[faceIndex] is a flat Float64Array of quads: 4 corners * 3 coords.
  var PL = 0.13, PT = 0.05;                  // bar half-length / half-thickness
  var QUAD_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  var PIP_GEOM = FACES.map(function (f) {
    var c = f.v.map(function (i) { return V[i]; });
    var ctr = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2, (c[0][2] + c[2][2]) / 2];
    var u = [(c[1][0] - c[0][0]) / 2, (c[1][1] - c[0][1]) / 2, (c[1][2] - c[0][2]) / 2];
    var w = [(c[3][0] - c[0][0]) / 2, (c[3][1] - c[0][1]) / 2, (c[3][2] - c[0][2]) / 2];
    var uL = u.map(function (x) { return x * PL; }), uT = u.map(function (x) { return x * PT; });
    var wL = w.map(function (x) { return x * PL; }), wT = w.map(function (x) { return x * PT; });
    var out = [];
    function bar(P, da, db) {
      for (var s = 0; s < 4; s++) {
        var s1 = QUAD_SIGNS[s][0], s2 = QUAD_SIGNS[s][1];
        out.push(P[0] + da[0] * s1 + db[0] * s2, P[1] + da[1] * s1 + db[1] * s2, P[2] + da[2] * s1 + db[2] * s2);
      }
    }
    PIPS[f.num].forEach(function (p) {
      var pX = p[0], pY = p[1];
      var P = [ctr[0] + u[0] * pX * 0.6 + w[0] * pY * 0.6, ctr[1] + u[1] * pX * 0.6 + w[1] * pY * 0.6, ctr[2] + u[2] * pX * 0.6 + w[2] * pY * 0.6];
      bar(P, uL, wT);   // bar along u
      bar(P, uT, wL);   // bar along w
    });
    return new Float64Array(out);
  });

  // --- color ramp ----------------------------------------------------
  // ramp() quantizes brightness into 6 bands, so there are only 6 possible
  // face colours and 6 pip colours. Precompute them as ready-to-use strings.
  var STOPS = [[84, 36, 82], [122, 46, 92], [166, 62, 74], [200, 94, 58], [224, 144, 62], [238, 198, 96]];
  function rgb(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  var RAMP6 = STOPS.map(rgb);
  var PIP6 = [];
  for (var i = 0; i < 6; i++) {
    var litI = i / 5;
    PIP6.push(rgb([42 * (0.5 + 0.9 * litI), 29 * (0.5 + 0.9 * litI), 46 * (0.5 + 0.9 * litI)].map(function (x) { return Math.min(255, x); })));
  }
  function band(t) { return t < 0 ? 0 : t > 1 ? 5 : Math.round(t * 5); }
  var LN = (function () { var v = [-0.42, -0.82, -0.48], m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; })();
  var FILL_BIAS = 0.02, STROKE_BIAS = -0.16;

  // --- speed curve ---------------------------------------------------
  var DNORM = PEAK / 2 + (1 - PEAK) / (TAIL + 1);
  function rollEase(t) {
    if (t < PEAK) return (t * t / (2 * PEAK)) / DNORM;
    var u = (t - PEAK) / (1 - PEAK);
    return (PEAK / 2 + (1 - PEAK) * (1 - Math.pow(1 - u, TAIL + 1)) / (TAIL + 1)) / DNORM;
  }
  function rollSpeed(t) {
    if (t < PEAK) return t / PEAK;
    var u = (t - PEAK) / (1 - PEAK);
    return Math.pow(1 - u, TAIL);
  }

  // --- preallocated math scratch (shared; render is synchronous & non-reentrant)
  var T1 = new Float64Array(3), T2 = new Float64Array(3);
  var C0 = new Float64Array(3), C1 = new Float64Array(3), C2 = new Float64Array(3); // basis columns
  var P = new Float64Array(3), RN = new Float64Array(3);
  var PX = new Float64Array(8), PY = new Float64Array(8), PZ = new Float64Array(8);
  var QX = new Float64Array(4), QY = new Float64Array(4);
  var visFace = new Int32Array(6), visOrder = new Int32Array(6);
  var visZ = new Float64Array(6), visLit = new Float64Array(6), visMinY = new Float64Array(6), visMaxY = new Float64Array(6);

  function rotInto(out, x, y, z, rx, ry, rz) {
    var c = cos(rx), s = sin(rx), y1 = y * c - z * s, z1 = y * s + z * c;
    c = cos(ry); s = sin(ry); var x2 = x * c + z1 * s, z2 = -x * s + z1 * c;
    c = cos(rz); s = sin(rz);
    out[0] = x2 * c - y1 * s; out[1] = x2 * s + y1 * c; out[2] = z2;
  }
  function spinInto(out, x, y, z, a) {
    var c = cos(a), s = sin(a), k0 = AXIS[0], k1 = AXIS[1], k2 = AXIS[2];
    var d = k0 * x + k1 * y + k2 * z, w = 1 - c;
    out[0] = x * c + (k1 * z - k2 * y) * s + k0 * d * w;
    out[1] = y * c + (k2 * x - k0 * z) * s + k1 * d * w;
    out[2] = z * c + (k0 * y - k1 * x) * s + k2 * d * w;
  }
  // xf(v) = rot(spin(rot(v, mount), phi), view). Linear, so we only need its
  // action on the 3 basis vectors; every point is then a linear combination.
  function xfInto(out, x, y, z, m0, m1, m2, phi, vrx, vry) {
    rotInto(T1, x, y, z, m0, m1, m2);
    spinInto(T2, T1[0], T1[1], T1[2], phi);
    rotInto(out, T2[0], T2[1], T2[2], vrx, vry, 0);
  }
  function buildBasis(m0, m1, m2, phi, vrx, vry) {
    xfInto(C0, 1, 0, 0, m0, m1, m2, phi, vrx, vry);
    xfInto(C1, 0, 1, 0, m0, m1, m2, phi, vrx, vry);
    xfInto(C2, 0, 0, 1, m0, m1, m2, phi, vrx, vry);
  }
  function applyM(out, x, y, z) {
    out[0] = x * C0[0] + y * C1[0] + z * C2[0];
    out[1] = x * C0[1] + y * C1[1] + z * C2[1];
    out[2] = x * C0[2] + y * C1[2] + z * C2[2];
  }

  function rnd6() { return 1 + Math.floor(Math.random() * 6); }

  global.PixelDice = function createDiceRoller(opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    if (!canvas) throw new Error('PixelDice: opts.canvas is required');
    var PIXEL = opts.pixel || 4;
    var W = canvas.width, H = canvas.height;
    var BW = Math.round(W / PIXEL), BH = Math.round(H / PIXEL);
    var TURNS = opts.turns || 10;
    var DURATION = opts.duration != null ? opts.duration : 3800;
    var useGradient = !!opts.gradient;
    var onSettle = opts.onSettle || null;

    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var buf = document.createElement('canvas');
    buf.width = BW; buf.height = BH;
    var b = buf.getContext('2d');

    // background hatch is static -> bake it into a Path2D once.
    var BG = new Path2D();
    for (var cc = -BH; cc < BW + BH; cc += 13) {
      BG.moveTo(cc, 0); BG.lineTo(cc + BH, BH);
      BG.moveTo(cc, 0); BG.lineTo(cc - BH, BH);
    }

    var dice = [], count = 0, cells = [], SCALE = 22;
    var rolling = false, t0 = 0, prog = 0;
    var running = false, rafId = 0, pendingDone = null;

    function layout() {
      var perRow = count <= 3 ? count : (count <= 6 ? 3 : Math.ceil(Math.sqrt(count)));
      var rows = Math.ceil(count / perRow);
      var cellW = BW / perRow, cellH = Math.min(cellW, BH / rows);
      SCALE = cellW * 0.13;
      var gridH = rows * cellH, top = (BH - gridH) / 2;
      cells = [];
      for (var i = 0; i < count; i++) {
        var r = Math.floor(i / perRow), inRow = Math.min(perRow, count - r * perRow);
        var off = (BW - inRow * cellW) / 2, col = i - r * perRow;
        cells.push({ cx: off + (col + 0.5) * cellW, cy: top + (r + 0.5) * cellH });
      }
    }

    function setCount(n) {
      count = n;
      dice = new Array(n);
      for (var i = 0; i < n; i++) { var r = rnd6(); dice[i] = { result: r, prev: r }; }
      layout();
      requestRedraw();
      return getResults();
    }

    function drawBg() {
      b.fillStyle = '#1a2230';
      b.fillRect(0, 0, BW, BH);
      b.strokeStyle = 'rgba(255,255,255,0.035)';
      b.lineWidth = 1;
      b.stroke(BG);
    }

    function drawDie(idx) {
      var die = dice[idx], cell = cells[idx];
      var cx = cell.cx, cy = cell.cy;
      var env = 0, phi = 0, mIdx = die.result;
      if (rolling) {
        env = rollSpeed(prog);
        phi = rollEase(prog) * TURNS * TWO_PI;
        mIdx = prog < PEAK ? die.prev : die.result;
      }
      var mount = TARGET[mIdx];
      var vrx = -TILT * env, vry = TILT * env;
      buildBasis(mount[0], mount[1], mount[2], phi, vrx, vry);

      var v, k;
      for (v = 0; v < 8; v++) {
        applyM(P, V[v][0], V[v][1], V[v][2]);
        k = FOCAL / (FOCAL + P[2]);
        PX[v] = cx + P[0] * SCALE * k; PY[v] = cy + P[1] * SCALE * k; PZ[v] = P[2];
      }

      var visN = 0, fi, f, vi;
      for (fi = 0; fi < 6; fi++) {
        f = FACES[fi];
        applyM(RN, f.n[0], f.n[1], f.n[2]);
        if (RN[2] >= -0.015) continue;
        vi = f.v;
        var minY = 1e9, maxY = -1e9, j, py;
        for (j = 0; j < 4; j++) { py = PY[vi[j]]; if (py < minY) minY = py; if (py > maxY) maxY = py; }
        var lit = 0.18 + 0.82 * Math.max(0, -(RN[0] * LN[0] + RN[1] * LN[1] + RN[2] * LN[2]));
        visFace[visN] = fi;
        visZ[visN] = (PZ[vi[0]] + PZ[vi[1]] + PZ[vi[2]] + PZ[vi[3]]) * 0.25;
        visLit[visN] = lit; visMinY[visN] = minY; visMaxY[visN] = maxY;
        visOrder[visN] = visN; visN++;
      }
      // painter's order: farthest (largest z) first. Insertion sort (<=6 items).
      for (var a = 1; a < visN; a++) {
        var key = visOrder[a], kz = visZ[key], bI = a - 1;
        while (bI >= 0 && visZ[visOrder[bI]] < kz) { visOrder[bI + 1] = visOrder[bI]; bI--; }
        visOrder[bI + 1] = key;
      }

      for (var o = 0; o < visN; o++) {
        var s = visOrder[o];
        f = FACES[visFace[s]]; vi = f.v;
        var flit = visLit[s];

        b.beginPath();
        b.moveTo(PX[vi[0]], PY[vi[0]]);
        b.lineTo(PX[vi[1]], PY[vi[1]]);
        b.lineTo(PX[vi[2]], PY[vi[2]]);
        b.lineTo(PX[vi[3]], PY[vi[3]]);
        b.closePath();
        if (useGradient) {
          var g = b.createLinearGradient(0, visMinY[s], 0, visMaxY[s]);
          g.addColorStop(0, RAMP6[band(flit + 0.10)]);
          g.addColorStop(1, RAMP6[band(flit - 0.06)]);
          b.fillStyle = g;
        } else {
          b.fillStyle = RAMP6[band(flit + FILL_BIAS)];
        }
        b.fill();
        b.lineJoin = 'round'; b.lineWidth = 1;
        b.strokeStyle = RAMP6[band(flit + STROKE_BIAS)];
        b.stroke();

        // pips
        b.fillStyle = PIP6[band(flit)];
        var geom = PIP_GEOM[visFace[s]], nq = geom.length / 12, q, c, base;
        for (q = 0; q < nq; q++) {
          base = q * 12;
          for (c = 0; c < 4; c++) {
            applyM(P, geom[base + c * 3], geom[base + c * 3 + 1], geom[base + c * 3 + 2]);
            k = FOCAL / (FOCAL + P[2]);
            QX[c] = cx + P[0] * SCALE * k; QY[c] = cy + P[1] * SCALE * k;
          }
          b.beginPath();
          b.moveTo(QX[0], QY[0]); b.lineTo(QX[1], QY[1]); b.lineTo(QX[2], QY[2]); b.lineTo(QX[3], QY[3]);
          b.closePath(); b.fill();
        }
      }
    }

    function render() {
      drawBg();
      for (var i = 0; i < count; i++) drawDie(i);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(buf, 0, 0, BW, BH, 0, 0, W, H);
    }

    function settle() {
      rolling = false; prog = 0;
      var cb = pendingDone; pendingDone = null;
      if (cb) cb(getResults());
      if (onSettle) onSettle(getResults());
    }

    function tick(now) {
      var again = false;
      if (rolling) {
        prog = Math.min(1, (now - t0) / DURATION);
        if (prog >= 1) { prog = 1; render(); settle(); }
        else { again = true; render(); }
      } else {
        render();
      }
      if (again) { rafId = requestAnimationFrame(tick); }
      else { running = false; rafId = 0; }
    }

    function ensureLoop() {
      if (!running) { running = true; rafId = requestAnimationFrame(tick); }
    }

    // Draw exactly one frame when idle (e.g. after setCount), without starting
    // the continuous loop.
    function requestRedraw() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(function () { running = false; rafId = 0; render(); });
    }

    // results: optional array of target face values (1-6). Returns the results.
    function roll(results, done) {
      if (rolling) return getResults();
      for (var i = 0; i < count; i++) {
        dice[i].prev = dice[i].result;
        dice[i].result = (results && results[i] != null) ? results[i] : rnd6();
      }
      pendingDone = done || null;
      if (DURATION <= 0) {              // reduced-motion / instant
        requestRedraw();
        settle();
        return getResults();
      }
      rolling = true; prog = 0; t0 = (global.performance || Date).now();
      ensureLoop();
      return getResults();
    }

    function getResults() { return dice.map(function (d) { return d.result; }); }
    function isRolling() { return rolling; }
    function destroy() { if (rafId) cancelAnimationFrame(rafId); running = false; rolling = false; dice = []; cells = []; }

    setCount(opts.count || 1);

    // Render a single frame of the (expensive) rolling path. Used only by the
    // RAM-measurement harness to count per-frame allocation deterministically.
    function debugRenderFrame(p) {
      var wr = rolling, wp = prog;
      rolling = true; prog = p == null ? 0.3 : p;
      render();
      rolling = wr; prog = wp;
    }

    return {
      canvas: canvas,
      setCount: setCount,
      roll: roll,
      getResults: getResults,
      isRolling: isRolling,
      destroy: destroy,
      __debugRenderFrame: debugRenderFrame
    };
  };
})(typeof window !== 'undefined' ? window : this);
