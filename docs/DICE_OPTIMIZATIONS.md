# Board dice renderer — footprint & optimization roadmap

Scope: the **in-game board dice** (`src/render/pixel-dice-physics.js`,
`window.PixelDicePhysics`) — the two cubes that tumble in the centre canvas.
The owned-dice bar (`pixel-dice-deluxe.js`) and the standalone demo engine
(`demos/pixel-dice.js`, see `DICE_PERFORMANCE.md`) are separate.

Goal of the renderer: **extremely responsive on a basic device**, while keeping
the exact tumble look and feel.

---

## Measured footprint (2 dice)

| Cost | Value | Notes |
| --- | ---: | --- |
| Visible canvas `#dice-canvas` (480×360×4) | **675.0 KB** | dominant; fixed by canvas size, not dice count |
| Offscreen buffer (120×90×4, `pixel: 4`) | **42.2 KB** | low-res buffer scaled up with `image-rendering: pixelated` |
| Retained JS heap (renderer instance) | **31.9 KB** | measured under Node `--expose-gc` |
| **Total resident** | **≈ 749 KB (0.73 MB)** | constant — same idle or mid-roll, independent of roll count |
| Leak over 10,000 rolls | **≈ 0** (~43 B/roll = GC noise) | dice objects are reused, nothing accumulates |
| **Idle CPU** | **0** | the `requestAnimationFrame` loop stops entirely when not rolling |
| Physics compute | ~1 ms per *whole* roll (~3 µs/frame at 2 dice) | from `measure-dice-fairness.js`, ~1000 rolls/s headless |

Takeaway: memory is **~0.73 MB and flat**, idle cost is **zero**, and per-frame
compute during a roll is **microseconds** for 2 dice — comfortably inside a
16 ms (60 fps) budget on a basic device.

---

## Already done

- **Idle = 0.** The RAF loop only runs while a roll is in flight; when idle the
  renderer draws a single rest frame and stops (no CPU, no allocation).
- **Settle bug fixed.** Dice previously froze mid-bounce because `PHYS_MAX` was
  cut to 2600 ms for "speed", chopping off dice that were still bouncing. Root
  cause: energy dissipation takes up to ~5.5 s, so the cap fired mid-air. Fix:
  restore the 6 s budget (the prototype's value) — dice always reach a natural
  rest before the cap, so it never freezes a moving die. The phys phase still
  ends the instant both dice settle, so a normal roll resolves in ~1.5–3 s.
- **Allocation-light hot paths** (same arithmetic, fewer short-lived arrays):
  - Per-die vertex rotations cached once per substep into `_rv`; `floorResolve`
    and the four wall planes reuse them (≈ 40 → 8 quaternion rotations per
    substep per die).
  - In-place integration in `stepDie` (no per-substep velocity/position arrays).
  - Render shares the 8 rotated vertices between `drawShadow` and `drawDie`
    via `_rvr` (computed once per frame).
  - Net: ~46 fewer short-lived arrays per substep per die (substeps run 4×/frame
    × 2 dice), proven byte-identical via a per-frame canvas hash.
- **Fairness verified.** ~0.2 % max deviation per face over 250k rolls
  (χ² ≈ 10.1 / 10.9, df = 5 — within the fair range); sum curve tracks 2d6.

## Verification tooling (use before/after any change)

- **Per-frame canvas hash** — seed `Math.random`, drive the renderer with a fixed
  60 fps step and a pumped RAF queue, hash the canvas every frame across several
  rolls. An unchanged signature proves the physics *and* the pixels are
  identical (look + feel untouched). Used as a throwaway Playwright spec.
- **`scripts/measure-dice-fairness.js`** — runs the real physics headlessly via
  `simulateResult()` and reports per-face frequencies + χ² and the 2d6 sum
  distribution. Confirms an optimization didn't bias the dice.

---

## Further optimizations (ranked for the 2-dice board)

| # | Optimization | Lever | Est. impact | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | **Shrink the visible canvas** (e.g. 480×360 → 320×240) | memory | **−≈375 KB** (675→300 KB) | trivial (canvas size) | low — lower display resolution |
| 2 | **Web Worker + OffscreenCanvas** (sim+render off main thread) | responsiveness | no main-thread stutter during a roll | medium–high | medium — plumbing / browser support |
| 3 | **Render-path allocation cleanup** (preallocate `project`/vector scratch) | GC during roll | near-zero render allocation | medium | low |
| 3b | …also replace per-face `createLinearGradient` with a flat band fill | GC + a little GPU | removes the only per-frame canvas object alloc | low | **changes shading look — needs sign-off** |
| 4 | **GPU / WebGL instanced cubes** | scales to many dice | flat cost at dozens–hundreds of dice | high | high — changes the pixel-art look |
| 5 | **In-place contact math** (impulse resolution → scratch) | physics GC | removes remaining physics allocation | medium | low (golden-hash verifiable) |
| 6 | **Raise `pixel`** (chunkier pixels, smaller buffer) | memory | buffer already only 42 KB → marginal | trivial | low — coarser dice |

### Detail

1. **Canvas size — the single biggest memory win.** 675 of the 749 KB is the
   480×360 visible canvas, and the dice only occupy a small region of it. Sizing
   it to what's actually displayed (320×240 ≈ 300 KB, 360×270 ≈ 380 KB) is a
   one-line change with a proportional saving. The buffer is already tiny.
2. **Worker offload — the best "basic device" win.** Moving the dice sim+render
   to a Web Worker drawing into an `OffscreenCanvas` keeps the Phaser board and
   UI smooth even when the main thread is busy. This buys perceived
   responsiveness rather than raw cost.
3. **Render-path allocation.** Physics is now allocation-light, so the render
   path is the remaining per-frame churn (`project`/`add` per vertex, the
   `faces[]`/`.map` temporaries, one gradient per visible face). Preallocating
   scratch removes most of it with no visual change; the gradient→flat swap
   (3b) removes the rest but alters shading slightly.
4. **GPU.** Only worth it if many dice are ever on screen at once. For 2 dice the
   2D path is already far under budget and a rewrite risks the look — not
   recommended unless the dice count grows a lot.
5. **Contact math.** Converts the last physics allocations to scratch; negligible
   benefit at 2 dice (physics is ~3 µs/frame), easily verified by the hash +
   fairness harness.

### Recommendation

For a basic device the renderer is already efficient (0.73 MB, idle = 0, µs/frame
compute). Don't chase the compute. The high-value, low-risk wins are **#1
(shrink the canvas)** for memory and **#2 (worker offload)** for smoothness.
Skip GPU unless many dice appear simultaneously.

### Guardrails

- **Do not** retune the physics constants (gravity, restitution, bounce assist,
  damping, phase timings) to "optimize" — that changes the feel. Speed work must
  be allocation/render/threading only.
- After any change, re-run the per-frame canvas hash (look + feel) and
  `measure-dice-fairness.js` (distribution) before shipping.
