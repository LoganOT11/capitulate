/* =====================================================================
 *  Physics pixel dice — reusable factory.
 *  Extracted from the standalone "pixel-dice-roll" prototype.
 *
 *  Two cubes that genuinely tumble: the camera tilts from top-down to
 *  isometric, the dice lift and spin up, hover, then drop and bounce off
 *  the floor and invisible walls, shedding energy until they come to rest.
 *  The face left pointing up IS the physics result — nothing is guided.
 *  Then the camera tilts back and the dice glide home.
 *
 *  Usage:
 *    const roller = PixelDicePhysics({ canvas, count: 2 });
 *    roller.roll(null, {
 *      onReturn: (faces) => { ... },  // dice settled + returning home
 *      onDone:   (faces) => { ... },  // dice back at rest
 *    });
 *
 *  `roll(results, opts)`:
 *    - results == null  -> physics decides; onReturn reports the top faces.
 *    - results = [a, b] -> animation runs unguided, but onReturn / getResults
 *      report `results` (deterministic hook for tests; the canvas is visual
 *      only and not asserted against).
 *
 *  The RAF loop only runs while a roll is in flight; when idle a single rest
 *  frame is drawn and the loop stops.
 * ===================================================================== */
(function (global) {
  'use strict';

  // ---------- vec3 ----------
  const add = (a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]];
  const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // ---------- quaternion [x,y,z,w] (local -> world) ----------
  const qmul = (a, c) => [
    a[3] * c[0] + a[0] * c[3] + a[1] * c[2] - a[2] * c[1],
    a[3] * c[1] - a[0] * c[2] + a[1] * c[3] + a[2] * c[0],
    a[3] * c[2] + a[0] * c[1] - a[1] * c[0] + a[2] * c[3],
    a[3] * c[3] - a[0] * c[0] - a[1] * c[1] - a[2] * c[2]];
  const qnorm = q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
  const qaxis = (ax, ang) => { const a = norm(ax), h = ang / 2, s = Math.sin(h); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)]; };
  const qrot = (q, p) => {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const tx = 2 * (y * p[2] - z * p[1]), ty = 2 * (z * p[0] - x * p[2]), tz = 2 * (x * p[1] - y * p[0]);
    return [p[0] + w * tx + (y * tz - z * ty), p[1] + w * ty + (z * tx - x * tz), p[2] + w * tz + (x * ty - y * tx)];
  };
  function qslerp(a, c, t) {
    let d = a[0] * c[0] + a[1] * c[1] + a[2] * c[2] + a[3] * c[3];
    if (d < 0) { c = [-c[0], -c[1], -c[2], -c[3]]; d = -d; }
    if (d > 0.9995) return qnorm([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, a[3] + (c[3] - a[3]) * t]);
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wc = Math.sin(t * th) / s;
    return [a[0] * wa + c[0] * wc, a[1] * wa + c[1] * wc, a[2] * wa + c[2] * wc, a[3] * wa + c[3] * wc];
  }
  function qintegrate(q, w, dt) {
    const dq = qmul([w[0], w[1], w[2], 0], q);
    return qnorm([q[0] + 0.5 * dq[0] * dt, q[1] + 0.5 * dq[1] * dt, q[2] + 0.5 * dq[2] * dt, q[3] + 0.5 * dq[3] * dt]);
  }
  function qfromTo(a, bv) {
    a = norm(a); bv = norm(bv); const d = dot(a, bv);
    if (d > 0.999999) return [0, 0, 0, 1];
    if (d < -0.999999) { let ax = cross([1, 0, 0], a); if (len(ax) < 1e-4) ax = cross([0, 1, 0], a); ax = norm(ax); return [ax[0], ax[1], ax[2], 0]; }
    const c = cross(a, bv); return qnorm([c[0], c[1], c[2], 1 + d]);
  }

  // ---------- cube geometry (edge = 1) ----------
  const HS = 0.5;
  const VERT = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) VERT.push([sx * HS, sy * HS, sz * HS]);
  const PIPS = {
    1: [[0, 0]], 2: [[-.5, -.5], [.5, .5]], 3: [[-.5, -.5], [0, 0], [.5, .5]],
    4: [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]],
    5: [[-.5, -.5], [.5, -.5], [0, 0], [-.5, .5], [.5, .5]],
    6: [[-.5, -.6], [-.5, 0], [-.5, .6], [.5, -.6], [.5, 0], [.5, .6]]
  };
  const FACEDEF = [
    { idx: [4, 5, 7, 6], n: [1, 0, 0], num: 2 },
    { idx: [0, 2, 3, 1], n: [-1, 0, 0], num: 5 },
    { idx: [2, 3, 7, 6], n: [0, 1, 0], num: 4 },
    { idx: [0, 4, 5, 1], n: [0, -1, 0], num: 3 },
    { idx: [1, 3, 7, 5], n: [0, 0, 1], num: 6 },
    { idx: [0, 2, 6, 4], n: [0, 0, -1], num: 1 },
  ];
  for (const f of FACEDEF) {
    const p = f.idx.map(i => VERT[i]);
    f.ctr = mul(add(add(p[0], p[1]), add(p[2], p[3])), 0.25);
    f.u = norm(sub(p[1], p[0])); f.w = norm(sub(p[3], p[0]));
  }
  const NORMAL_OF = { 1: [0, 0, -1], 2: [1, 0, 0], 3: [0, -1, 0], 4: [0, 1, 0], 5: [-1, 0, 0], 6: [0, 0, 1] };
  function topFace(q) { let best = -2, num = 1; for (const f of FACEDEF) { const y = qrot(q, f.n)[1]; if (y > best) { best = y; num = f.num; } } return num; }
  // nearest axis-aligned pose with the SAME up face, snapped to a clean heading (cosmetic, on return only)
  function squareUp(q) {
    const r = topFace(q), base = qfromTo(NORMAL_OF[r], [0, 1, 0]);
    const qd = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2] + a[3] * c[3];
    let best = base, bd = -2;
    for (let k = 0; k < 4; k++) { const cand = qmul(qaxis([0, 1, 0], k * Math.PI / 2), base); const d = Math.abs(qd(cand, q)); if (d > bd) { bd = d; best = cand; } }
    return qd(best, q) < 0 ? [-best[0], -best[1], -best[2], -best[3]] : best;
  }

  // ---------- colour ----------
  const STOPS = [[0, [84, 36, 82]], [0.2, [122, 46, 92]], [0.4, [166, 62, 74]], [0.6, [200, 94, 58]], [0.8, [224, 144, 62]], [1, [238, 198, 96]]];
  function ramp(t) {
    t = Math.max(0, Math.min(1, t)); t = Math.round(t * 5) / 5;
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (t <= STOPS[i + 1][0]) {
        const a = STOPS[i], c = STOPS[i + 1], f = (t - a[0]) / ((c[0] - a[0]) || 1);
        return [a[1][0] + (c[1][0] - a[1][0]) * f, a[1][1] + (c[1][1] - a[1][1]) * f, a[1][2] + (c[1][2] - a[1][2]) * f];
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const LIGHT = norm([-0.45, 0.86, 0.45]);

  // ---------- world + physics constants ----------
  const WX = 2.55, WZ = 2.55, APEX = 3.0, BOX_H = 3.4;
  const GRAV = [0, -27, 0];
  const TOP = { yaw: 0, pitch: Math.PI / 2 }, ISO = { yaw: Math.PI / 4, pitch: 0.585 };
  const invM = 1, INERTIA = (2 / 3) * HS * HS, invI = 1 / INERTIA;
  const E_FLOOR = 0.32, E_WALL = 0.42, MU = 0.5, BOUNCE_MIN = 2.4, BOUNCE_GAIN = 0.5, MAXB = 3;
  const RIGHT_RATE = 14, RIGHT_DAMP = 0.55;
  const PLANES = [
    { n: [-1, 0, 0], off: -WX, e: E_WALL },
    { n: [1, 0, 0], off: -WX, e: E_WALL },
    { n: [0, 0, -1], off: -WZ, e: E_WALL },
    { n: [0, 0, 1], off: -WZ, e: E_WALL },
  ];
  const E_DIE = 0.5;
  const V_REST = 0.42, W_REST = 1.0, CALM_T = 0.16, STUCK_T = 0.45;

  const smooth = t => t * t * (3 - 2 * t);
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  // ---------- physics (operate on plain die objects) ----------
  function floorResolve(d) {
    let deepest = 0; const contacts = [];
    for (const lv of VERT) { const wv = add(d.p, qrot(d.q, lv)); if (wv[1] < 0) { contacts.push(wv); if (wv[1] < deepest) deepest = wv[1]; } }
    if (!contacts.length) return;
    d.onFloor = true; d.p[1] -= deepest;
    let approach = 0;
    for (const wv of contacts) {
      const r = sub(wv, d.p), vc = add(d.v, cross(d.w, r)), vn = vc[1];
      if (vn < 0) {
        if (-vn > approach) approach = -vn;
        const rn = cross(r, [0, 1, 0]), jn = -(1 + E_FLOOR) * vn / (invM + invI * dot(rn, rn));
        d.v = [d.v[0], d.v[1] + jn * invM, d.v[2]]; d.w = add(d.w, mul(cross(r, [0, jn, 0]), invI));
        const vc2 = add(d.v, cross(d.w, r)), vtl = Math.hypot(vc2[0], vc2[2]);
        if (vtl > 1e-4) {
          const t = [vc2[0] / vtl, 0, vc2[2] / vtl], rt = cross(r, t);
          let jt = -(vc2[0] * t[0] + vc2[2] * t[2]) / (invM + invI * dot(rt, rt)); const lim = MU * jn; jt = Math.max(-lim, Math.min(lim, jt));
          d.v = add(d.v, mul(t, jt * invM)); d.w = add(d.w, mul(cross(r, mul(t, jt)), invI));
        }
      }
    }
    if (approach > BOUNCE_MIN && d.bounces < MAXB) {
      const target = approach * BOUNCE_GAIN;
      if (d.v[1] < target) { d.v[1] = target; d.bounces++; }
      const ax = norm([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
      d.w = add(d.w, mul(ax, Math.min(2.0, 0.22 * approach)));
    }
  }
  function planeContact(d, pl) {
    const n = pl.n;
    let deepest = 0; const contacts = [];
    for (const lv of VERT) { const wv = add(d.p, qrot(d.q, lv)); const sd = dot(wv, n) - pl.off; if (sd < 0) { contacts.push(wv); if (sd < deepest) deepest = sd; } }
    if (!contacts.length) return;
    if (n[1] > 0.5) d.onFloor = true;
    d.p = add(d.p, mul(n, -deepest * 0.9));
    let strongest = 0;
    for (const wv of contacts) {
      const r = sub(wv, d.p), vc = add(d.v, cross(d.w, r)), vn = dot(vc, n);
      if (vn < 0) {
        if (-vn > strongest) strongest = -vn;
        const rn = cross(r, n), denom = invM + invI * dot(rn, rn), jn = -(1 + pl.e) * vn / denom;
        d.v = add(d.v, mul(n, jn * invM)); d.w = add(d.w, mul(cross(r, mul(n, jn)), invI));
        const vc2 = add(d.v, cross(d.w, r)), vt = sub(vc2, mul(n, dot(vc2, n))), vtl = len(vt);
        if (vtl > 1e-4) {
          const t = mul(vt, 1 / vtl), rt = cross(r, t);
          let jt = -dot(vc2, t) / (invM + invI * dot(rt, rt)); const lim = MU * jn; jt = Math.max(-lim, Math.min(lim, jt));
          d.v = add(d.v, mul(t, jt * invM)); d.w = add(d.w, mul(cross(r, mul(t, jt)), invI));
        }
      }
    }
    if (strongest > 2) {
      const k = Math.min(2.4, 0.32 * strongest);
      const ax = norm([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
      d.w = add(d.w, mul(ax, k));
    }
  }
  function ddContact(A, B, cw, n, pen) {
    const imA = A.settled ? 0 : invM, iIA = A.settled ? 0 : invI;
    const imB = B.settled ? 0 : invM, iIB = B.settled ? 0 : invI;
    const im = imA + imB; if (im <= 0) return;
    A.p = add(A.p, mul(n, pen * imA / im)); B.p = add(B.p, mul(n, -pen * imB / im));
    const ra = sub(cw, A.p), rb = sub(cw, B.p);
    const va = add(A.v, cross(A.w, ra)), vb = add(B.v, cross(B.w, rb));
    const vn = dot(sub(va, vb), n);
    if (vn >= 0) return;
    const ran = cross(ra, n), rbn = cross(rb, n);
    const j = -(1 + E_DIE) * vn / (imA + imB + iIA * dot(ran, ran) + iIB * dot(rbn, rbn));
    A.v = add(A.v, mul(n, j * imA)); B.v = add(B.v, mul(n, -j * imB));
    A.w = add(A.w, mul(cross(ra, mul(n, j)), iIA)); B.w = add(B.w, mul(cross(rb, mul(n, -j)), iIB));
    const va2 = add(A.v, cross(A.w, ra)), vb2 = add(B.v, cross(B.w, rb));
    const rv2 = sub(va2, vb2), vt = sub(rv2, mul(n, dot(rv2, n))), vtl = len(vt);
    if (vtl > 1e-4) {
      const t = mul(vt, 1 / vtl), rat = cross(ra, t), rbt = cross(rb, t);
      let jt = -dot(rv2, t) / (imA + imB + iIA * dot(rat, rat) + iIB * dot(rbt, rbt));
      const lim = MU * Math.abs(j); jt = Math.max(-lim, Math.min(lim, jt));
      A.v = add(A.v, mul(t, jt * imA)); B.v = add(B.v, mul(t, -jt * imB));
      A.w = add(A.w, mul(cross(ra, mul(t, jt)), iIA)); B.w = add(B.w, mul(cross(rb, mul(t, -jt)), iIB));
    }
  }
  const obbAxes = d => [qrot(d.q, [1, 0, 0]), qrot(d.q, [0, 1, 0]), qrot(d.q, [0, 0, 1])];
  function dieDie(a, c) {
    if (a.settled && c.settled) return;
    const t = sub(c.p, a.p);
    if (len(t) > 2 * HS * 1.74) return;
    const A = obbAxes(a), B = obbAxes(c);
    const axes = [A[0], A[1], A[2], B[0], B[1], B[2]];
    for (const ua of A) for (const ub of B) { const x = cross(ua, ub), l = len(x); if (l > 1e-5) axes.push([x[0] / l, x[1] / l, x[2] / l]); }
    let minOv = 1e9, n = null;
    for (const L of axes) {
      const rA = HS * (Math.abs(dot(A[0], L)) + Math.abs(dot(A[1], L)) + Math.abs(dot(A[2], L)));
      const rB = HS * (Math.abs(dot(B[0], L)) + Math.abs(dot(B[1], L)) + Math.abs(dot(B[2], L)));
      const ov = rA + rB - Math.abs(dot(t, L));
      if (ov <= 0) return;
      if (ov < minOv) { minOv = ov; n = L; }
    }
    if (dot(n, t) > 0) n = mul(n, -1);
    const supA = a.p.slice(), supB = c.p.slice();
    for (const u of A) { const s = Math.sign(dot(u, t)) || 1; supA[0] += s * HS * u[0]; supA[1] += s * HS * u[1]; supA[2] += s * HS * u[2]; }
    for (const u of B) { const s = Math.sign(dot(u, t)) || 1; supB[0] -= s * HS * u[0]; supB[1] -= s * HS * u[1]; supB[2] -= s * HS * u[2]; }
    ddContact(a, c, mul(add(supA, supB), 0.5), n, minOv);
  }
  function stepDie(d, dt) {
    if (d.settled) return;
    d.onFloor = false;
    d.v = add(d.v, mul(GRAV, dt));
    d.v = mul(d.v, 0.995); d.w = mul(d.w, 0.985);
    d.p = add(d.p, mul(d.v, dt));
    d.q = qintegrate(d.q, d.w, dt);
    floorResolve(d);
    for (const pl of PLANES) planeContact(d, pl);
    if (d.onFloor && len(d.v) < 1.5 && len(d.w) < 3.6) {
      let tf = FACEDEF[0], bestY = -2; for (const f of FACEDEF) { const y = qrot(d.q, f.n)[1]; if (y > bestY) { bestY = y; tf = f; } }
      if (bestY < 0.9999) {
        const nW = qrot(d.q, tf.n), ax = cross(nW, [0, 1, 0]), axl = len(ax);
        if (axl > 1e-5) {
          const ang = Math.acos(Math.max(-1, Math.min(1, nW[1])));
          const stp = Math.min(ang, RIGHT_RATE * dt);
          d.q = qmul(qaxis([ax[0] / axl, ax[1] / axl, ax[2] / axl], stp), d.q);
          d.w = mul(d.w, RIGHT_DAMP);
        }
      }
    }
  }
  function physStep(dice, dt) {
    for (const d of dice) stepDie(d, dt);
    for (let i = 0; i < dice.length; i++) for (let j = i + 1; j < dice.length; j++) dieDie(dice[i], dice[j]);
  }
  function restDie(d, frameDt) {
    if (d.settled) return;
    // Tolerant ground test: a die at rest sits with its lowest vertex at ~0 and
    // may register no floor penetration on a given frame, so `onFloor` flickers
    // off and the calm timer keeps resetting — the die stops moving but never
    // settles. Test proximity to the floor instead of penetration.
    let minY = 1e9, up = -2;
    for (const lv of VERT) { const wy = d.p[1] + qrot(d.q, lv)[1]; if (wy < minY) minY = wy; }
    for (const f of FACEDEF) { const y = qrot(d.q, f.n)[1]; if (y > up) up = y; }
    const grounded = minY < 0.03, v = len(d.v), w = len(d.w);
    // Clean rest: grounded, slow, and lying flat — settle promptly.
    if (grounded && v < V_REST && w < W_REST && up > 0.985) d.calm += frameDt; else d.calm = 0;
    // Stuck fallback: near-motionless but not perfectly flat (wedged on an edge
    // or against a wall). Guarantees the phys phase ends instead of running out
    // to PHYS_MAX and freezing the dice mid-bounce.
    if (grounded && v < V_REST * 0.6 && w < W_REST * 0.6) d.stuck += frameDt; else d.stuck = 0;
    if (d.calm > CALM_T || d.stuck > STUCK_T) {
      d.settled = true; d.v = [0, 0, 0]; d.w = [0, 0, 0]; d.result = topFace(d.q);
    }
  }

  function hull2(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const x = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = []; for (const p of pts) { while (lo.length >= 2 && x(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    const up = []; for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && x(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop(); return lo.concat(up);
  }

  // Default phase timings (ms). The fixed phases are snappier than the standalone
  // tuner so an in-game roll resolves quickly. PHYS_MAX is only a safety cap: the
  // phys phase ends the instant the dice settle (reliably fast via restDie's calm
  // /stuck timers), so the cap is kept generous and is reached only by a die that
  // is genuinely still bouncing — which must finish naturally, never be frozen
  // mid-air. Override any of these via opts.cfg.
  const DEFAULTS = { LIFT: 300, HOVER: 200, HOLD: 150, TILT_OUT: 320, PHYS_MAX: 3000 };

  // ---------- instance factory ----------
  global.PixelDicePhysics = function createPhysicsDice(opts) {
    opts = opts || {};
    const canvas = opts.canvas;
    if (!canvas) throw new Error('PixelDicePhysics: opts.canvas is required');
    const cfg = Object.assign({}, DEFAULTS, opts.cfg || {});
    const PIXEL = opts.pixel || 4;
    const BW = Math.round(canvas.width / PIXEL), BH = Math.round(canvas.height / PIXEL);
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const buf = document.createElement('canvas'); buf.width = BW; buf.height = BH;
    const b = buf.getContext('2d');

    // ---- camera (instance) ----
    let camFwd = [0, -1, 0], camRight = [1, 0, 0], camUp = [0, 0, 1];
    function setCam(yaw, pitch) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      camFwd = [cp * sy, -sp, cp * cy]; camRight = [cy, 0, -sy]; camUp = cross(camFwd, camRight);
    }
    const viewOf = p => [dot(p, camRight), dot(p, camUp), dot(p, camFwd)];

    // ---- fit the iso box into the buffer ----
    let SCALE = 20;
    (function fitScale() {
      setCam(ISO.yaw, ISO.pitch);
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const sx of [-WX, WX]) for (const sy of [0, BOX_H]) for (const sz of [-WZ, WZ]) {
        const v = viewOf([sx, sy, sz]); minx = Math.min(minx, v[0]); maxx = Math.max(maxx, v[0]); miny = Math.min(miny, v[1]); maxy = Math.max(maxy, v[1]);
      }
      SCALE = Math.min(BW * 0.82 / (maxx - minx), BH * 0.82 / (maxy - miny));
    })();
    const GRID_EXT = Math.ceil(Math.max(BW, BH) / SCALE) + 4;

    let CX = BW / 2, CY = BH / 2;
    function recenter() {
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const sx of [-WX, WX]) for (const sy of [0, BOX_H]) for (const sz of [-WZ, WZ]) {
        const v = viewOf([sx, sy, sz]); minx = Math.min(minx, v[0]); maxx = Math.max(maxx, v[0]); miny = Math.min(miny, v[1]); maxy = Math.max(maxy, v[1]);
      }
      CX = BW / 2 - ((minx + maxx) / 2) * SCALE; CY = BH / 2 + ((miny + maxy) / 2) * SCALE + BH * 0.05;
    }
    const project = p => { const v = viewOf(p); return [v[0] * SCALE + CX, -v[1] * SCALE + CY, v[2]]; };

    // ---- dice ----
    let NDICE = Math.max(1, opts.count || 2);
    let HOME = [];
    function homeFor(n) {
      // single row, centred, spaced ~1.9 apart so two dice read clearly
      const out = []; const gap = 1.9;
      for (let i = 0; i < n; i++) out.push([(i - (n - 1) / 2) * gap, HS, 0]);
      return out;
    }
    function makeDie(home) {
      const r = 1 + Math.floor(Math.random() * 6);
      return {
        p: home.slice(), v: [0, 0, 0], q: squareUp(qfromTo(NORMAL_OF[r], [0, 1, 0])), w: [0, 0, 0],
        result: r, onFloor: true, calm: 1, stuck: 0, settled: true, axis: [0, 1, 0], spin: 0, bounces: 0,
        home: home.slice(), p0: home.slice(), q0: [0, 0, 0, 1], qT: [0, 0, 0, 1]
      };
    }
    let dice = [];
    function setCount(n) {
      NDICE = Math.max(1, n | 0);
      HOME = homeFor(NDICE);
      dice = Array.from({ length: NDICE }, (_, i) => makeDie(HOME[i]));
      requestRedraw();
      return getResults();
    }

    // ---- state machine ----
    let phase = 'idle', pt = 0, camT = 0, physClock = 0, last = 0;
    let running = false, rafId = 0;
    let forced = null, lastResults = null, returnFired = false;
    let onReturn = null, onDone = null;

    function roll(results, o) {
      if (phase !== 'idle') return getResults();
      o = o || {};
      onReturn = o.onReturn || null;
      onDone = o.onDone || null;
      forced = (results && results.length >= NDICE) ? results.slice(0, NDICE) : null;
      returnFired = false;
      for (const d of dice) {
        do { d.axis = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]; } while (len(d.axis) < 0.25);
        d.axis = norm(d.axis);
        d.spin = 13 + Math.random() * 5;
        d.q0 = d.q.slice();
        d.settled = false; d.onFloor = false; d.calm = 0; d.stuck = 0; d.bounces = 0;
      }
      phase = 'lift'; pt = 0; physClock = 0;
      ensureLoop();
      return getResults();
    }

    // ---- render ----
    function drawBg() {
      b.fillStyle = '#1a2230'; b.fillRect(0, 0, BW, BH);
      const S = 0.9, EXT = GRID_EXT;
      b.strokeStyle = 'rgba(255,255,255,0.05)'; b.lineWidth = 1;
      for (let i = -EXT; i <= EXT + 1e-6; i += S) {
        const a1 = project([i, 0, -EXT]), a2 = project([i, 0, EXT]);
        b.beginPath(); b.moveTo(a1[0], a1[1]); b.lineTo(a2[0], a2[1]); b.stroke();
        const c1 = project([-EXT, 0, i]), c2 = project([EXT, 0, i]);
        b.beginPath(); b.moveTo(c1[0], c1[1]); b.lineTo(c2[0], c2[1]); b.stroke();
      }
    }
    function drawBox() {
      if (camT < 0.02) return;
      const f = camT;
      const c = (x, y, z) => project([x, y, z]);
      const bot = [c(-WX, 0, -WZ), c(WX, 0, -WZ), c(WX, 0, WZ), c(-WX, 0, WZ)];
      const top = [c(-WX, BOX_H, -WZ), c(WX, BOX_H, -WZ), c(WX, BOX_H, WZ), c(-WX, BOX_H, WZ)];
      b.fillStyle = `rgba(236,193,90,${0.05 * f})`;
      b.beginPath(); b.moveTo(bot[0][0], bot[0][1]);
      for (let i = 1; i < 4; i++) b.lineTo(bot[i][0], bot[i][1]);
      b.closePath(); b.fill();
      const poly = (pts, style) => {
        b.strokeStyle = style; b.lineWidth = 1;
        b.beginPath(); b.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) b.lineTo(pts[i][0], pts[i][1]);
        b.closePath(); b.stroke();
      };
      b.strokeStyle = `rgba(236,193,90,${0.22 * f})`; b.lineWidth = 1;
      for (let i = 0; i < 4; i++) { b.beginPath(); b.moveTo(bot[i][0], bot[i][1]); b.lineTo(top[i][0], top[i][1]); b.stroke(); }
      poly(top, `rgba(236,193,90,${0.16 * f})`);
      poly(bot, `rgba(236,193,90,${0.5 * f})`);
    }
    function drawShadow(d) {
      const h = Math.max(0, d.p[1] - HS);
      const grow = 1 + h * 0.12;
      const ox = d.p[0] - LIGHT[0] * h * 0.18, oz = d.p[2] - LIGHT[2] * h * 0.18;
      const pts = VERT.map(v => { const w = add(d.p, qrot(d.q, v)); return [ox + (w[0] - d.p[0]) * grow, oz + (w[2] - d.p[2]) * grow]; });
      const hull = hull2(pts);
      const a = Math.max(0.05, 0.4 - h * 0.05);
      const ring = (scale, alpha) => {
        b.fillStyle = `rgba(0,0,0,${alpha})`; b.beginPath();
        for (let i = 0; i < hull.length; i++) { const s = project([ox + (hull[i][0] - ox) * scale, 0, oz + (hull[i][1] - oz) * scale]); i ? b.lineTo(s[0], s[1]) : b.moveTo(s[0], s[1]); }
        b.closePath(); b.fill();
      };
      ring(1.35, a * 0.32);
      ring(1.0, a);
    }
    const REFL_RANGE = 1.9, REFL_GAIN = 0.55;
    function drawDie(d, all) {
      const sv = VERT.map(v => project(add(d.p, qrot(d.q, v))));
      const faces = [];
      for (const f of FACEDEF) {
        const wn = qrot(d.q, f.n);
        if (dot(wn, camFwd) >= -0.01) continue;
        const pts = f.idx.map(i => sv[i]);
        faces.push({ f, wn, pts, z: (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4 });
      }
      faces.sort((a, c) => c.z - a.z);
      for (const o of faces) {
        let refl = 0;
        if (all) for (const od of all) {
          if (od === d) continue;
          const to = sub(od.p, d.p), dd = len(to) || 1;
          if (dd < REFL_RANGE) { const prox = 1 - dd / REFL_RANGE; refl = Math.max(refl, prox * Math.max(0, dot(o.wn, mul(to, 1 / dd)))); }
        }
        const lit = Math.min(1, 0.16 + 0.84 * Math.max(0, dot(o.wn, LIGHT)) + refl * REFL_GAIN);
        let minY = 1e9, maxY = -1e9; for (const p of o.pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
        const g = b.createLinearGradient(0, minY, 0, maxY);
        g.addColorStop(0, rgb(ramp(lit + 0.10))); g.addColorStop(1, rgb(ramp(lit - 0.06)));
        b.beginPath(); b.moveTo(o.pts[0][0], o.pts[0][1]);
        for (let i = 1; i < 4; i++) b.lineTo(o.pts[i][0], o.pts[i][1]);
        b.closePath(); b.fillStyle = g; b.fill();
        b.lineJoin = 'round'; b.lineWidth = 1; b.strokeStyle = rgb(ramp(lit - 0.16)); b.stroke();

        const uW = qrot(d.q, o.f.u), wW = qrot(d.q, o.f.w);
        const PL = 0.15 * HS, PT = 0.055 * HS;
        const uL = mul(uW, PL), uT = mul(uW, PT), wL = mul(wW, PL), wT = mul(wW, PT);
        b.fillStyle = rgb([42, 29, 46].map(c => Math.min(255, c * (0.5 + 0.95 * lit))));
        const quad = (C, da, db) => {
          const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s1, s2]) =>
            project([C[0] + da[0] * s1 + db[0] * s2, C[1] + da[1] * s1 + db[1] * s2, C[2] + da[2] * s1 + db[2] * s2]));
          b.beginPath(); b.moveTo(q[0][0], q[0][1]);
          for (let i = 1; i < 4; i++) b.lineTo(q[i][0], q[i][1]);
          b.closePath(); b.fill();
        };
        const cw = add(d.p, qrot(d.q, o.f.ctr));
        for (const [pX, pY] of PIPS[o.f.num]) {
          const C = add(cw, add(mul(uW, pX * 0.6 * HS), mul(wW, pY * 0.6 * HS)));
          quad(C, uL, wT); quad(C, uT, wL);
        }
      }
    }

    function render() {
      setCam(TOP.yaw + (ISO.yaw - TOP.yaw) * camT, TOP.pitch + (ISO.pitch - TOP.pitch) * camT);
      recenter();
      drawBg(); drawBox();
      for (const d of dice) drawShadow(d);
      const order = dice.map((_, i) => i).sort((a, c) => viewOf(dice[c].p)[2] - viewOf(dice[a].p)[2]);
      for (const i of order) drawDie(dice[i], dice);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(buf, 0, 0, BW, BH, 0, 0, canvas.width, canvas.height);
    }

    // ---- main loop (runs only while a roll is in flight) ----
    function frame(now) {
      const frameDt = Math.min(0.05, (now - last) / 1000) || 0; last = now;

      if (phase === 'lift') {
        pt += frameDt * 1000; const t = Math.min(1, pt / cfg.LIFT); camT = smooth(t);
        const spinFrac = t * t;
        for (const d of dice) {
          d.p = [d.home[0], HS + (APEX - HS) * easeOut(t), d.home[2]];
          d.w = mul(d.axis, d.spin * spinFrac);
          d.q = qintegrate(d.q, d.w, frameDt);
        }
        if (t >= 1) { phase = 'hover'; pt = 0; }
      } else if (phase === 'hover') {
        pt += frameDt * 1000; camT = 1;
        const bob = Math.sin(pt / cfg.HOVER * Math.PI * 2) * 0.05;
        for (const d of dice) {
          d.p = [d.home[0], APEX + bob, d.home[2]];
          d.w = mul(d.axis, d.spin);
          d.q = qintegrate(d.q, d.w, frameDt);
        }
        if (pt >= cfg.HOVER) {
          for (const d of dice) {
            const inward = -Math.sign(d.home[0]) || (Math.random() < 0.5 ? 1 : -1);
            d.v = [inward * (1.5 + Math.random() * 0.7) + (Math.random() * 2 - 1) * 0.25, -4.3, (Math.random() * 2 - 1) * 0.5];
            d.bounces = 0; d.w = mul(d.axis, d.spin);
          }
          phase = 'phys'; physClock = 0;
        }
      } else if (phase === 'phys') {
        camT = 1; physClock += frameDt * 1000;
        const steps = Math.max(1, Math.min(8, Math.round(frameDt / (1 / 240)))), sdt = frameDt / steps;
        for (let s = 0; s < steps; s++) physStep(dice, sdt);
        for (const d of dice) restDie(d, frameDt);
        if (dice.every(d => d.settled) || physClock > cfg.PHYS_MAX) {
          for (const d of dice) { if (!d.settled) { d.settled = true; d.v = [0, 0, 0]; d.w = [0, 0, 0]; d.result = topFace(d.q); } }
          lastResults = forced ? forced.slice() : dice.map(d => d.result);
          phase = 'hold'; pt = 0;
        }
      } else if (phase === 'hold') {
        camT = 1; pt += frameDt * 1000;
        if (pt >= cfg.HOLD) {
          phase = 'tiltOut'; pt = 0;
          for (const d of dice) { d.p0 = d.p.slice(); d.q0 = d.q.slice(); d.qT = squareUp(d.q); }
          // Dice have stopped moving and are now returning home.
          if (!returnFired) { returnFired = true; if (onReturn) onReturn(getResults()); }
        }
      } else if (phase === 'tiltOut') {
        pt += frameDt * 1000; const e = smooth(Math.min(1, pt / cfg.TILT_OUT)); camT = 1 - e;
        for (const d of dice) {
          d.p = [d.p0[0] + (d.home[0] - d.p0[0]) * e, HS, d.p0[2] + (d.home[2] - d.p0[2]) * e];
          d.q = qslerp(d.q0, d.qT, e);
        }
        if (pt >= cfg.TILT_OUT) {
          phase = 'idle'; camT = 0;
          for (const d of dice) { d.p = d.home.slice(); d.q = d.qT; }
          const cb = onDone; onDone = null; if (cb) cb(getResults());
        }
      } else { camT = 0; }

      render();
      if (phase !== 'idle') { rafId = requestAnimationFrame(frame); }
      else { running = false; rafId = 0; }
    }

    function ensureLoop() {
      if (!running) { running = true; last = (global.performance || Date).now(); rafId = requestAnimationFrame(frame); }
    }
    // Draw one rest frame when idle (e.g. after setCount) without looping.
    let redrawId = 0;
    function requestRedraw() {
      if (running) return;        // the loop is active and will redraw anyway
      cancelAnimationFrame(redrawId);
      redrawId = requestAnimationFrame(() => { redrawId = 0; if (!running) { camT = 0; render(); } });
    }

    function getResults() { return lastResults ? lastResults.slice() : dice.map(d => d.result); }
    function isRolling() { return phase !== 'idle'; }
    function destroy() { if (rafId) cancelAnimationFrame(rafId); running = false; phase = 'idle'; dice = []; }

    setCount(NDICE);

    return {
      canvas,
      roll,
      setCount,
      getResults,
      isRolling,
      destroy,
    };
  };
})(typeof window !== 'undefined' ? window : this);
