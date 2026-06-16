# Pixel dice — RAM investigation & optimization

The dice animation in `pixel-dice-fixed.html` was extracted into a reusable,
low-allocation engine (`src/pixel-dice.js`) and wired into the game. This note
explains where its memory goes, what was changed, and how to push the dice count
as high as possible while keeping RAM flat.

## What "RAM" means for a canvas dice renderer

There are three distinct costs, and only one of them actually scales with the
number of dice in the original code:

1. **Canvas backing stores** — fixed by canvas size, *not* by dice count.
   - Visible canvas `720×540×4 B` = **1.48 MB**
   - Offscreen pixel buffer `180×135×4 B` = **0.09 MB**
   - Total **~1.58 MB**, identical whether you roll 1 die or 100. The single
     shared low-res buffer (scaled up with `image-rendering: pixelated`) is the
     reason adding dice doesn't add canvas memory — this design was already good.

2. **Retained JS heap** — the live objects (dice state, geometry tables).
   Tiny, but in the original it grew with dice count because of GC pressure.

3. **GC churn / allocation rate** — short-lived objects created *every frame*.
   This is the real scaling problem and the thing that limits "how many dice."
   High allocation rate ⇒ frequent garbage collection ⇒ jank and a heap that
   sawtooths up and down. It is the dominant cost when rolling many dice.

## Measured results (Chromium headless, `--enable-precise-memory-info`)

Reproduce with `node scripts/measure-dice-ram.js` (see notes at the bottom).
`alloc/frame` is the per-frame heap growth of the rolling render path;
`churn@60fps` is that × 60.

| renderer  | dice | retained (MB) | alloc/frame (KB) | churn @60fps (MB/s) |
| --------- | ---: | ------------: | ---------------: | ------------------: |
| original  |    1 |          0.87 |             72.6 |                4.26 |
| original  |    6 |          1.50 |            317.8 |               18.62 |
| original  |   20 |          1.68 |            498.1 |               29.18 |
| optimized |    1 |          0.69 |              3.3 |                0.19 |
| optimized |    6 |          0.76 |              1.2 |                0.07 |
| optimized |   20 |          0.74 |              0.9 |                0.05 |
| optimized |   50 |          0.79 |              2.3 |                0.14 |
| optimized |  100 |          0.79 |              4.5 |                0.26 |

Takeaways:

- **Allocation per frame dropped ~100–500×.** The original allocates ~500 KB
  *per frame* at 20 dice (~29 MB/s of garbage); the optimized engine allocates
  under ~5 KB/frame even at **100** dice. The remaining few KB is measurement
  noise plus canvas-internal allocation, and it is essentially flat.
- **Retained heap is flat across dice count** for the optimized engine
  (0.69 MB @1 die → 0.79 MB @100 dice) vs. the original climbing to 1.68 MB by
  20 dice.
- **Idle cost went to zero.** The original runs `requestAnimationFrame` forever
  and re-renders every die ~60×/sec even when nothing is moving (that ~0.8 MB/s
  of idle churn at 1 die). The optimized engine stops the RAF loop when not
  rolling and renders a single frame to settle.

## What changed (`src/pixel-dice.js`)

The motion is visually identical; the math was refactored, not altered (a 20k-
sample numeric check confirms the transform matches the original to ~1e-15).

1. **Stop rendering when idle.** RAF only runs while a roll is in progress, plus
   one frame to redraw after `setCount`/settle. Biggest CPU/battery win.

2. **Treat the per-die transform as one linear map.** The original called
   `xf()` (three trig rotations) *per vertex, per normal, and per pip corner* —
   dozens of allocating `rot()/spin()` calls per die per frame. `xf` is linear,
   so the engine computes it once on the 3 basis vectors and every point is then
   an allocation-free linear combination. Fewer trig ops *and* zero garbage.

3. **Preallocated scratch.** All vectors/projection buffers are reused
   `Float64Array`s at module scope; the hot path allocates nothing. Visible-face
   sorting is an in-place insertion sort over ≤6 fixed slots.

4. **Precomputed colours.** `ramp()` quantizes brightness to 6 bands, so there
   are only 6 possible face/pip colours — baked into string lookups indexed by
   an integer. Per-face linear *gradients* (one allocated `CanvasGradient` per
   visible face per frame) were replaced with a flat band fill. The look is
   preserved by the existing per-face lighting + dark edge stroke. (Pass
   `gradient: true` to restore true gradients at a small allocation cost.)

5. **Baked pip geometry.** Each pip's two bars have constant object-space corner
   positions; they're computed once at load instead of rebuilt every frame.

6. **Static background as a `Path2D`.** The diagonal hatch never changes, so it's
   traced once and re-stroked, instead of re-issuing all line segments per frame.

## Rolling as many dice as possible while keeping RAM low

- **Memory is no longer the limit — CPU fill rate is.** Because canvas memory is
  count-independent and per-frame allocation is ~0, the heap stays ~constant from
  1 to hundreds of dice. What eventually slows down is the number of polygons
  filled per frame (≈ 3 faces + pips per die). You can roll dozens–hundreds of
  dice at a near-constant ~2–3 MB footprint.
- **The buffer resolution is the one knob that costs fixed memory.** A bigger
  canvas = more backing-store bytes (and more pixels to scale). For very high
  dice counts the dice get small anyway, so a smaller buffer both saves memory
  and reduces fill cost. Construct with a smaller canvas, or raise `pixel`
  (chunkier pixels, smaller buffer): `PixelDice({ canvas, pixel: 6 })`.
- **Keep `gradient: false`** (the default) for the lowest allocation.
- **If you ever need thousands of dice**, the next step is WebGL instanced cubes
  (one draw call, GPU-side transforms) — that changes the bottleneck from CPU
  fill rate to GPU and keeps JS allocation at zero. Not needed for the current
  game (2 dice) or the demo (≤100).

## API (`window.PixelDice`)

```js
const roller = PixelDice({
  canvas,            // required <canvas>; buffer = width/pixel × height/pixel
  count: 2,          // initial dice
  duration: 3800,    // ms per roll (set 0 for instant / reduced-motion)
  pixel: 4,          // upscale factor; higher = smaller buffer = less memory
  gradient: false,   // true restores per-face gradients (more allocation)
  onSettle: (results) => {}, // called with [v,...] when a roll finishes
});
roller.setCount(20);              // re-layout + randomize, redraw one frame
roller.roll();                    // random roll
roller.roll([3, 4], onDone);      // deterministic roll + per-call callback
roller.getResults();              // current face values
roller.isRolling();
```

## Reproducing the measurement

`scripts/measure-dice-ram.js` launches Chromium headless with byte-exact memory
info and exposed GC, then renders 600 rolling frames per case and sums the
positive heap deltas (GC drops ignored) to recover true per-frame allocation.

It uses machine-specific absolute paths for the Chromium binary and the NSS
shared libraries (borrowed from the Playwright Firefox build, since
`chrome-headless-shell` needs `libnss3`/`libnspr4` that aren't installed
system-wide here). Adjust those two constants for another environment.
