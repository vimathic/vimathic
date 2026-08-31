// math-visualizer.js — CPU-driven deformation of the shared GPU mesh.
//
// The render mesh is normally driven entirely by the vertex shader: it
// computes pos.y from audio uniforms and a chosen GLSL formula. When a
// "CPU formula" (from math-collections.js) is activated, control of the
// height field crosses over to JavaScript — the shader steps aside via a
// single uniform and reads whatever the CPU wrote into the geometry.
//
//   uMathMode = 0 → GPU shader owns pos.y (default path).
//   uMathMode = 1 → CPU writes pos.y / position attribute; the shader scales
//                   it by uMorphProgress and colours by it.
//
// Colour is a second, narrower question, and uMathMode cannot answer it: it is
// 1 for all three CPU modes. The ramp wants the audio displacement alone, and
// in Surface mode the attribute holds base + field (round 10 made the shape
// keep its own y), so the base has to come back out. uVHField carries that one
// bit to the shader and _syncColourSource is the only thing that writes it.
//
// Three deformation modes share this surface:
//   surface  — Y-only height field on a grid. Default, worker-accelerated.
//   volume   — Full XYZ displacement from snapshotted base positions,
//              driven by VOLUME_FORMULAS (twist, breathe, etc.).
//   collapse — Displacement along stored vertex normals, formula
//              evaluated in spherical (θ, φ) coords relative to centroid.
//              Reuses the currently-active Surface formula.
//
// ── Computation strategy ──────────────────────────────────────────────────
// Surface mode prefers an off-thread Web Worker (math-worker.js) with
// zero-copy Transferable round-trip. If the worker is unavailable (e.g.
// missing file in production), the visualizer transparently falls back to
// synchronous evaluation on the main thread. Same numeric result, just
// blocks the render loop.
//
// Volume and Collapse modes always run on the main thread: their per-vertex
// non-grid coordinates would require a different worker protocol, and the
// formulas they use are cheaper than Surface in practice.
//
// ── Transition blending ───────────────────────────────────────────────────
// When setFormula() is called while another formula is active, the current
// height field is captured into _prevHF and linearly blended toward the new
// formula's output over _blendDuration ms with an ease-in-out curve. The
// blend buffer (_blendBuf) and the worker-receive buffer (_hfBuffer) are
// pre-allocated and reused every frame to keep allocation out of the hot
// path entirely.

import {
  getFormula,
  generateSurfaceFromFormula,
  applyHeightField,
  generateVolumeFromFormula,
  applyDisplacementField,
  generateCollapseScalarField,
  applyCollapseField,
  VOLUME_FORMULAS,
  FIELD_EXTENT,
} from './math-collections.js';

// ── Worker bootstrap ───────────────────────────────────────────────────────
// Returns the Worker instance, or null if construction fails. A failure here
// is recoverable (sync fallback covers the same surface), but we log it
// clearly: a silent fallback would only surface as a mysterious FPS drop on
// heavy formulas.
//
// FIX(#25): window._vimathic_worker_active has two real readers — the e2e
// smoke test and an operator debugging a deploy by hand (documents/
// troubleshooting.md). It is a liveness claim, so every path that disarms the
// channel must clear it — see MathVisualizer._disableWorker.
function createMathWorker() {
  try {
    const w = new Worker(new URL('./math-worker.js', import.meta.url), { type: 'module' });
    if (typeof window !== 'undefined') window._vimathic_worker_active = true;
    return w;
  } catch (e) {
    console.warn(
      '[MathVisualizer] Worker unavailable — math will run synchronously on main thread.\n' +
      'Cause:', e.message, '\n' +
      'Hint: math-worker-*.js must be at the same path as index.html on the server.'
    );
    if (typeof window !== 'undefined') window._vimathic_worker_active = false;
    return null;
  }
}

// FIX(#4): budget for an unanswered tick before the busy gate is released and
// the frame is computed synchronously. Far above the single-digit milliseconds
// the heaviest formulas (Gray-Scott, FitzHugh-Nagumo) cost even on mobile, so
// a merely slow worker is never disowned.
const WORKER_STALL_MS = 2000;

// FIX(#4, r2): the first reply also pays for loading the worker's module graph
// — under `npm run dev` that means math-collections.js through Vite's transform
// pipeline, measured at 3.5s. Sharing WORKER_STALL_MS made every dev cold start
// print a channel-is-dead warning about a worker that then ran fine all session.
const WORKER_COLD_START_MS = 15000;

// FIX(#4, r3): how many post-startup worker.onerror hits the channel survives
// before a "one-off throw" stops being credible and we fall back for good.
const WORKER_ERROR_TOLERANCE = 3;

// Cubic ease-in-out for the formula-transition blend curve.
// Smoother than a linear ramp; cheaper than a spring.
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}


/**
 * Normals welded across coincident positions.
 *
 * FIX(r11): a hard edge is several vertices at ONE point carrying DIFFERENT
 * normals — a box corner belongs to three faces and appears three times. The
 * height field hands all of those copies the same value (that is round 10's
 * repair: "coincident vertices take the same height — no shape is torn apart"),
 * and displacing each along its OWN normal therefore pulls them apart by
 * h·|n₁ − n₂|. Measured before this weld, at the factory sliders: a 0.405 gap
 * on `box` over 964 seam pairs, 0.493 on `pyramid-smooth`, and up to 4.664
 * world units on `octahedron` across the 192 kernels — on a body of radius 3.5.
 *
 * Averaging the normals of every group that shares a position gives all copies
 * one direction, so a seam travels as a unit and stays shut. On smooth
 * geometry — sphere, torus, torus knot, ring, icosahedron-smooth, solar — there
 * are no coincident groups at all and this returns the input untouched.
 *
 * The key quantises to 1e-6, which is what tests/shape-lateral-surface.js uses
 * to decide the same question about the same meshes.
 */

/** Smallest bounding-box extent of a base-position array. */
function thinnestExtent(positions) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  return Math.min(mxx - mnx, mxy - mny, mxz - mnz);
}

/** Below this, a body is a plate and the field stays vertical. See _capturePristine. */
const THIN_BODY = 1.0;

/** …and below this much clearance, following the surface is not worth doing at all. */
const MIN_USEFUL_DEPTH = 0.3;


/**
 * Does this geometry have hard edges?
 *
 * FIX(r11, second pass): welding the normals closed the seams and opened a
 * FOLD instead. The vertices ON a hard edge now share one averaged direction,
 * but their neighbours a row away still travel along their own face normal, so
 * the strip between them shears by h·|n_avg − n_face| — and where the field is
 * NEGATIVE that strip turns inside out. Measured with a constant field: at
 * +0.4 not one triangle of `box` inverts, at −0.4 exactly 3744 of 76 800 do,
 * and on the boot formula at the factory sliders 1012 do. A mitre would fix the
 * outward half and nothing would fix the inward half short of limiting the
 * depth to the mesh spacing.
 *
 * So a body with hard edges keeps the vertical rule. The test is the geometry's
 * own: two vertices at one position whose normals disagree by more than a few
 * degrees. Smooth bodies (sphere, torus, torus knot, icosahedron-smooth, solar)
 * have coincident vertices only at their wrap seam, where the normals agree,
 * and those stay on the normal path.
 *
 * Takes the grouping rather than building its own, because the weld needs the
 * very same one — see positionGroups.
 */
function normalsDisagree(rep, normals) {
  for (let i = 0; i < rep.length; i++) {
    const r = rep[i];
    if (r === i) continue;                       // this vertex IS its group's first
    const d = normals[r * 3] * normals[i * 3]
            + normals[r * 3 + 1] * normals[i * 3 + 1]
            + normals[r * 3 + 2] * normals[i * 3 + 2];
    if (d < 0.98) return true;                   // more than ~11 degrees apart
  }
  return false;
}

/**
 * For each vertex, the first vertex standing at the same point — its group's
 * representative, or itself when it stands alone.
 *
 * FIX(r11, cost): this used to be built TWICE per shape change, once by the
 * hard-edge test and once by the weld, both keyed by a string
 * `"${qx},${qy},${qz}"`. That is where the shape-change hitch came from: with
 * the string keys, capture cost 64.6 ms on `sphere` and 18.4 ms on `box`
 * against 0.59 and 0.61 on the version before this feature, and 6.6 % of the
 * profile was garbage collection of those keys. One pass, hashed into a
 * 32-bit key with the quantised triple compared exactly inside the bucket, is
 * the same grouping without the garbage — a hash collision costs a comparison,
 * never a wrong answer. That comparison is not ceremony: dropping it and
 * trusting the hash makes the weld wrong on all seven shapes the equivalence
 * test covers, `disc` and `solar` included.
 *
 * The quantisation stays at 1e-6, which is what tests/shape-lateral-surface.js
 * uses to decide the same question about the same meshes.
 */
function positionGroups(positions) {
  const n  = positions.length / 3;
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    qx[i] = Math.round(positions[i * 3] * 1e6);
    qy[i] = Math.round(positions[i * 3 + 1] * 1e6);
    qz[i] = Math.round(positions[i * 3 + 2] * 1e6);
  }
  const rep = new Int32Array(n);
  const buckets = new Map();                     // hash → representatives sharing it
  for (let i = 0; i < n; i++) {
    const h = (Math.imul(qx[i], 73856093) ^ Math.imul(qy[i], 19349663) ^ Math.imul(qz[i], 83492791)) | 0;
    const b = buckets.get(h);
    if (b === undefined) { buckets.set(h, [i]); rep[i] = i; continue; }
    let found = -1;
    for (let k = 0; k < b.length; k++) {
      const j = b[k];
      if (qx[j] === qx[i] && qy[j] === qy[i] && qz[j] === qz[i]) { found = j; break; }
    }
    if (found < 0) { b.push(i); rep[i] = i; } else rep[i] = found;
  }
  return rep;
}

/**
 * How deep the field may push before the surface meets itself.
 *
 * The thin-body rule measured the bounding box, and that is the wrong quantity:
 * `ring` (tube 0.35, box 0.70) was protected while `torusknot` (tube 0.65, box
 * 3.48) was not, though the two are nearly as thin as each other. What decides
 * an inversion is the local tube radius — the distance to the medial axis — so
 * that is what is measured here: for a sample of vertices, the nearest vertex
 * whose normal points back at it, halved.
 *
 * Sampled rather than exhaustive because the app calls this once per shape and
 * the meshes run to 26 000 vertices; the sample is deterministic (a fixed
 * stride), so the answer does not wander between runs.
 */
function medialRadius(positions, normals) {
  const n = positions.length / 3;
  if (n < 8) return Infinity;
  // Sources are sampled; CANDIDATES are not. A torus knot's strands pass each
  // other closer than its own tube is thick, and a strided candidate list walks
  // straight past that: with both sides sampled the knot measured 0.509 and
  // still inverted on 70 of the 192 kernels at the reachable over-drive.
  const stride = Math.max(1, Math.floor(n / 400));
  let best = Infinity;
  for (let i = 0; i < n; i += stride) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    // Squared throughout, with the one square root taken at the end. Both tests
    // below survive the change unchanged in meaning: `dist >= near` is monotone
    // in the square, and |along| > 0.7·dist is along² > 0.49·dist² with both
    // sides non-negative. Math.hypot was 12 % of the whole profile.
    let near2 = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = nx * normals[j * 3] + ny * normals[j * 3 + 1] + nz * normals[j * 3 + 2];
      if (d > -0.8) continue;                    // not facing back at us
      const dx = positions[j * 3] - px, dy = positions[j * 3 + 1] - py, dz = positions[j * 3 + 2] - pz;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 >= near2) continue;
      // BOTH directions matter, and for different reasons. Inward, the surface
      // meets its own far wall — that is the tube. Outward, it meets the
      // neighbour it is passing: a torus knot's strands run closer to each
      // other than its tube is thick, and a search that only looked inward
      // measured 0.509 for the knot and let it invert on 70 of the 192 kernels
      // at the reachable over-drive.
      const along = dx * nx + dy * ny + dz * nz;
      if (along * along > dist2 * 0.49) near2 = dist2;
    }
    const near = near2 === Infinity ? Infinity : Math.sqrt(near2);
    if (near / 2 < best) best = near / 2;
  }
  return best;
}

/**
 * How far the field may push before the surface folds against its OWN curvature.
 *
 * medialRadius above answers a different question — how far away the nearest
 * sheet FACING BACK is — and until wave B that was the only one the catalogue
 * needed, because a three primitive's radius of curvature is comfortably larger
 * than its medial radius. An isosurface's is not, and the gap is not small:
 * measured with a constant field of -0.4, the gyroid turns 4.81 % of its area
 * inside out at a medial cap of 0.507, Schwarz P 2.57 % at 0.562, the Chmutov
 * surface 4.76 % at 0.587 and the Cayley cubic 5.25 % at 1.485 — while sphere,
 * torus, icosahedron-smooth, catenoid and hyperboloid invert NOTHING at any
 * amplitude up to 4. No second sheet is involved in any of those folds. Push a
 * patch inward past the centre of its own curvature and it turns over on its
 * own.
 *
 * `helicoid` was the catalogue's own warning and nobody read it: it inverts 20
 * of its 19 200 triangles at -0.4 and 33 of the 192 shipped kernels reach that,
 * because its rulings converge on its axis where the surface's focal distance
 * is the screw pitch 0.42 — a quantity medialRadius (0.506 there) cannot see.
 *
 * ── What is computed, and why it is exact rather than a proxy ───────────────
 * Displace every vertex by d along its own normal and a triangle's normal
 * becomes a QUADRATIC in d:
 *
 *   N(d) = (B + d.NB) x (C + d.NC),   B = b-a, C = c-a, NB = nb-na, NC = nc-na
 *   N(d).N(0) = |N0|^2 + d.((B x NC + NB x C).N0) + d^2.((NB x NC).N0)
 *
 * so the exact d at which that triangle turns over is the root of a quadratic
 * nearest to zero — in either direction, because the field has both signs. No
 * curvature estimate, no discretisation of a derivative.
 *
 * ── Why a quantile and not the minimum ──────────────────────────────────────
 * The minimum is useless and that was measured before this was written. A
 * marching-cubes mesh carries slivers — triangles of tiny but non-zero area
 * whose normal is numerically unstable — so SOME triangle inverts at d = 1e-4
 * on every one of these bodies, including one whose real limit is 1.3. Weighting
 * by area and taking the point where a ten-thousandth of the surface has turned
 * over answers the question a viewer would ask. Calibrated against the
 * catalogue at desktop resolution: sphere, torus, icosahedron-smooth, catenoid,
 * hyperboloid and solar answer 3.500, 1.100, 3.500, 1.500, 1.600 and 1.200 —
 * every one of them ABOVE the medial cap that already bound it, so the bodies
 * already following their normals lose nothing. helicoid answers 0.185 against
 * a medial cap of 0.405, and the five implicit bodies 0.011 to 0.034 against
 * medial caps of 0.507 to 1.485.
 *
 * Infinity comes out of here only for a mesh of fewer than four triangles: the
 * walk always reaches `total`, and `total >= budget`, so some triangle always
 * answers. An earlier draft of this paragraph claimed the six above return
 * Infinity "because they never fold", and that was never measurable — what
 * they return is the radius at which each closes on itself.
 *
 * @param {Float32Array} positions  pristine, xyz per vertex
 * @param {Float32Array} normals    welded, xyz per vertex
 * @param {ArrayLike<number>|null} index  triangle list, or null for a soup
 */
function foldRadius(positions, normals, index) {
  const nTri = index ? index.length / 3 : positions.length / 9;
  if (nTri < 4) return Infinity;
  const dist = new Float64Array(nTri);
  const area = new Float64Array(nTri);
  let total = 0;

  for (let t = 0; t < nTri; t++) {
    const ia = index ? index[t * 3] : t * 3;
    const ib = index ? index[t * 3 + 1] : t * 3 + 1;
    const ic = index ? index[t * 3 + 2] : t * 3 + 2;
    const bx = positions[ib * 3] - positions[ia * 3];
    const by = positions[ib * 3 + 1] - positions[ia * 3 + 1];
    const bz = positions[ib * 3 + 2] - positions[ia * 3 + 2];
    const cx = positions[ic * 3] - positions[ia * 3];
    const cy = positions[ic * 3 + 1] - positions[ia * 3 + 1];
    const cz = positions[ic * 3 + 2] - positions[ia * 3 + 2];
    const ux = normals[ib * 3] - normals[ia * 3];
    const uy = normals[ib * 3 + 1] - normals[ia * 3 + 1];
    const uz = normals[ib * 3 + 2] - normals[ia * 3 + 2];
    const vx = normals[ic * 3] - normals[ia * 3];
    const vy = normals[ic * 3 + 1] - normals[ia * 3 + 1];
    const vz = normals[ic * 3 + 2] - normals[ia * 3 + 2];

    const n0x = by * cz - bz * cy, n0y = bz * cx - bx * cz, n0z = bx * cy - by * cx;
    const A = n0x * n0x + n0y * n0y + n0z * n0z;
    area[t] = Math.sqrt(A) / 2;
    total += area[t];
    if (A < 1e-24) { dist[t] = 0; continue; }      // already degenerate

    // B x NC + NB x C, dotted into N0
    const p1x = by * vz - bz * vy, p1y = bz * vx - bx * vz, p1z = bx * vy - by * vx;
    const p2x = uy * cz - uz * cy, p2y = uz * cx - ux * cz, p2z = ux * cy - uy * cx;
    const B1 = (p1x + p2x) * n0x + (p1y + p2y) * n0y + (p1z + p2z) * n0z;
    // NB x NC, dotted into N0
    const q1x = uy * vz - uz * vy, q1y = uz * vx - ux * vz, q1z = ux * vy - uy * vx;
    const C1 = q1x * n0x + q1y * n0y + q1z * n0z;

    let best = Infinity;
    if (Math.abs(C1) < 1e-18) {
      if (Math.abs(B1) > 1e-18) best = Math.abs(A / B1);
    } else {
      const disc = B1 * B1 - 4 * C1 * A;
      if (disc >= 0) {
        const rt = Math.sqrt(disc);
        for (const r of [(-B1 + rt) / (2 * C1), (-B1 - rt) / (2 * C1)]) {
          if (Math.abs(r) < best) best = Math.abs(r);
        }
      }
    }
    dist[t] = best;
  }

  // The area quantile: sort by fold distance and walk until a ten-thousandth
  // of the surface has turned over.
  const order = Array.from({ length: nTri }, (_, i) => i).sort((i, j) => dist[i] - dist[j]);
  const budget = total * 1e-4;
  let acc = 0;
  for (const i of order) {
    acc += area[i];
    if (acc >= budget) return dist[i];
  }
  return Infinity;
}

export function weldNormals(positions, normals) {
  return weldWithGroups(positionGroups(positions), normals);
}

/** The weld itself, once the grouping is in hand. */
function weldWithGroups(rep, normals) {
  const n = rep.length;
  const out = Float32Array.from(normals);
  // Sums accumulate onto the representative's slot, so no per-group array is
  // built: on `box` that is 39 366 vertices' worth of allocation not made.
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n);
  const count = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rep[i];
    sx[r] += normals[i * 3]; sy[r] += normals[i * 3 + 1]; sz[r] += normals[i * 3 + 2];
    count[r]++;
  }
  for (let i = 0; i < n; i++) {
    const r = rep[i];
    if (count[r] < 2) continue;
    const len = Math.sqrt(sx[r] * sx[r] + sy[r] * sy[r] + sz[r] * sz[r]);
    // A group whose normals cancel exactly — the two faces of a zero-thickness
    // sheet — has no direction to offer; those keep their own, and the caller's
    // thin-body rule is what protects them.
    if (len < 1e-6) continue;
    out[i * 3] = sx[r] / len; out[i * 3 + 1] = sy[r] / len; out[i * 3 + 2] = sz[r] / len;
  }
  return out;
}

export class MathVisualizer {
  constructor(render, audio) {
    this.render      = render;
    this.audio       = audio;
    this.active      = false;
    this._formulaFn  = null;
    this._collId     = null;
    this._formulaKey = null;
    this._gridSize   = null;

    // Tick counter, plus the mobile gate for MAIN-THREAD math: halving the
    // evaluation rate there is invisible to the eye and buys back CPU.
    //
    // FIX(#11): every tick path must advance _frame — a surface-only session
    // left it at 0, where `0 % 2 === 0` waves every frame through.
    //
    // FIX(#11, r2): _throttle gates only main-thread paths (Volume, Collapse,
    // Surface sync fallback). main.js already delivers tick() every 2nd rAF on
    // mobile, so gating the worker-backed path here stacked a second halving
    // and landed all 192 CPU formulas at ~15Hz; worker ticks spend no
    // main-thread time and have nothing to buy back.
    //
    // Rates on a 60Hz display: worker Surface 60Hz desktop / 30Hz mobile;
    // main-thread paths 60Hz / 15Hz.
    this._frame      = 0;
    this._throttle   = render.isMobile ? 2 : 1;

    // ── Worker channel ──────────────────────────────────────────────────
    // _workerBusy gates posting a new tick while the previous one is still
    // in flight — we accept 1-frame latency rather than queueing work that
    // would arrive stale. _pendingHF holds the latest result waiting to be
    // applied; it's cleared once consumed.
    this._worker      = createMathWorker();
    this._workerReady = !!this._worker;
    this._pendingHF   = null;
    this._workerBusy  = false;
    // FIX(#4): last posted tick and a one-shot log guard — both feed the
    // stall watchdog in _tickSurface.
    this._workerPostTime  = 0;
    this._workerStallWarn = false;
    // FIX(#4, r2): flips on the first reply of any kind; until then the
    // watchdog runs on WORKER_COLD_START_MS.
    this._workerAnswered  = false;
    // FIX(#4, r3): post-startup onerror hits so far — see onerror below.
    this._workerErrors    = 0;

    if (this._worker) {
      this._worker.onmessage = ({ data }) => {
        this._workerBusy = false;
        this._workerAnswered = true;   // FIX(#4, r2): channel proven alive
        if (data.type === 'result') {
          // Discard if this result is from a superseded generation —
          // formula or mode changed while the worker was computing, so
          // the height field would not match the current geometry intent.
          // We still clear workerBusy above so the next tick can post.
          if (data.gen !== undefined && data.gen !== this._generation) {
            return;
          }
          // Discard if we're no longer in surface mode — the worker only
          // produces height fields, and Volume/Collapse modes don't apply
          // them. Without this gate, a switch surface→volume mid-tick
          // would still consume the next worker response and write Y
          // values over the Volume displacement.
          if (this._mode !== 'surface') {
            return;
          }
          // Copy the transferred buffer into our persistent receive buffer
          // so the worker can reuse its own buffer next tick. Without this
          // copy, every tick allocates a new Float32Array on the main
          // thread — visible as steady GC pressure on long sessions.
          if (!this._hfBuffer || this._hfBuffer.length !== data.hf.length) {
            this._hfBuffer = new Float32Array(data.hf.length);
          }
          this._hfBuffer.set(data.hf);
          this._pendingHF = this._hfBuffer;
        } else if (data.type === 'error') {
          // FIX(#4, r3): go through _disableWorker. The worker sends this only
          // when it has nothing left to serve (it disarms the formula on every
          // path that reports one), so the channel is done — and clearing
          // _workerReady on its own left _vimathic_worker_active still claiming
          // a live worker, the exact lie the e2e guard and the troubleshooting
          // doc exist to catch.
          this._disableWorker(`worker reported: ${data.message}`);
        }
      };

      // FIX(#4): a module Worker that fails to LOAD does not throw from
      // `new Worker()` — a 404, a syntax error or a broken import surface
      // asynchronously, here. Unhandled, the window flag keeps claiming a live
      // channel while _workerBusy stays latched, so every later frame quietly
      // takes the sync branch and the failure is never logged.
      //
      // FIX(#4, r3): policy — onerror before the first reply means the module
      // never loaded and the channel really is dead, while onerror after it is
      // one bad frame worth surviving (up to WORKER_ERROR_TOLERANCE of them),
      // because disowning the worker is permanent and moves all 192 formulas
      // onto the main thread, throttled, for the rest of the session. Formula
      // exceptions never arrive here at all: math-worker.js reports them as
      // error messages, so a throw reaching this handler is worker-level.
      this._worker.onerror = (e) => {
        const reason = (e && e.message) ? e.message : 'worker failed to load or threw';
        if (!this._workerAnswered || ++this._workerErrors > WORKER_ERROR_TOLERANCE) {
          this._disableWorker(reason);
          return;
        }
        // Release the gate so the next tick can post again.
        this._workerBusy = false;
        console.warn('[MathVisualizer] Worker threw — keeping the channel:', reason);
      };
      // A reply that cannot be deserialised is unrecoverable for this instance.
      this._worker.onmessageerror = () => {
        this._disableWorker('worker reply could not be deserialised');
      };
    }

    // ── Surface blend state ─────────────────────────────────────────────
    // Persistent buffers so a formula change does not allocate during the
    // 400-800ms blend window.
    this._prevHF        = null;
    this._blendBuf      = null;
    this._hfBuffer      = null;
    // The last field actually APPLIED, kept because the blend works in grid
    // space while the mesh now carries vertex space — see _applyHF. Null means
    // "the mesh is not carrying a field", which is the state every pristine
    // restore puts it in. _lastHFBuf is the storage behind it: _applyHF copies
    // into it rather than aliasing the caller's array, so nulling _lastHF
    // costs no allocation on the way back.
    this._lastHF        = null;
    this._lastHFBuf     = null;
    this._blendActive   = false;
    this._blendStart    = 0;
    this._blendDuration = render.isMobile ? 400 : 800;

    // ── Volume / collapse state ─────────────────────────────────────────
    // _basePositions  — snapshot of geometry at mode entry; both Volume and
    //                   Collapse modes write base + offset back into the
    //                   live attribute, so we must keep the originals.
    // _baseNormals    — parallel to _basePositions; Collapse projects its
    //                   scalar field along the surface normal.
    // _basePts*       — same pair for the optional points-mesh proxy.
    // _dfBuffer       — displacement field reused each Volume tick.
    // _collapseBuf    — scalar field reused each Collapse tick.
    //
    // _pristinePositions — clean geometry snapshot taken once per shape,
    //                   right after RenderEngine.setShape builds new geo.
    //                   Surface ticks rewrite pos.y absolutely each frame
    //                   (see math-collections.js applyHeightField), and
    //                   Volume/Collapse ticks write displaced positions
    //                   directly into the live attribute. Without an
    //                   untouched-by-ticks reference, restoring geometry
    //                   on mode transition has no clean source — the
    //                   "baseline" ends up being whatever the previous
    //                   mode last wrote. This caused visible bugs:
    //                   Volume→Surface→Volume kept the mesh locked into
    //                   the Surface deformation; changing shape inside
    //                   Volume stalled because _basePositions was nulled
    //                   by the rebuild detect but never re-captured. The
    //                   pristine snapshot is the canonical "true shape"
    //                   that mode transitions and shape changes restore
    //                   from before any new baseline is taken.
    this._mode             = 'surface';
    this._basePositions    = null;
    this._baseNormals      = null;
    this._basePtsPositions = null;
    this._basePtsNormals   = null;
    this._pristinePositions    = null;
    this._pristineNormals      = null;
    this._pristineDepth        = Infinity;
    this._pristinePtsPositions = null;
    this._pristinePtsNormals   = null;
    this._volumeFn         = null;
    this._dfBuffer         = null;
    this._collapseBuf      = null;
    this._collapseStrength = 1.0;

    // ── Volume time accumulator ─────────────────────────────────────────
    // Volume formulas like 'twist' use `time` as their evolution parameter.
    // Pausing the accumulator lets the freeze-frame button hold a Volume
    // figure at its current deformation state instead of continuing to
    // rotate. Audio reactivity keeps working either way — only the
    // monotonic time argument freezes.
    this._volumeTimePaused = false;
    this._volumeAccumTime  = 0;
    this._lastTickTime     = null;

    // ── Operation generation counter ────────────────────────────────────
    // Bumped on every state-affecting public call (setFormula, setMode,
    // setVolumeFormula, setVolumeFn, deactivate). Worker tick messages
    // carry the current generation; the onmessage handler discards results
    // whose generation does not match the current one — i.e. results that
    // were computed for a formula or mode that has since been superseded.
    //
    // This is the cancel-safety primitive for the math pipeline. Without
    // it, rapid switching between Surface and Volume modes (or between
    // formulas in either mode) could land a stale height field on geometry
    // that has already been re-snapshotted for a different mode, producing
    // visual artefacts that look like "the UI clicks but nothing changes".
    this._generation = 0;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Activate a Surface-mode formula from math-collections.js.
   * If another formula is currently active, the existing height field is
   * captured and a blend to the new formula's output begins automatically.
   *
   * If the visualizer is currently in volume mode, automatically transitions
   * to collapse mode first. Reason: the 192 catalogue formulas are scalar
   * fields (Z = f(x,y)), but volume mode runs a vector-field tick that
   * only consults _volumeFn. A bare setFormula() would update _formulaFn
   * with the new function but the volume tick would keep using the old
   * _volumeFn, so the user would see no change. Collapse mode runs the
   * scalar formula along surface normals — the closest 3D-preserving
   * rendering, and exactly what the user means when they pick e.g.
   * "Mandelbrot" on a Sphere.
   *
   * The auto-exit lives here (not at every caller) so it covers every
   * code path that ends up at setFormula: the gpu-sel dropdown, the R
   * hotkey, preset apply, future MIDI handlers, AI-generated formulas.
   */
  setFormula(collectionId, formulaKey) {
    const f = getFormula(collectionId, formulaKey);
    if (!f) return;

    // Auto-exit volume mode before applying a surface formula.
    // setMode(collapse) restores the baseline geometry (clean shape) and
    // takes a fresh snapshot, so the formula displaces clean normals
    // rather than the volume-distorted mesh. Must happen BEFORE the
    // _generation bump below so setMode's own bump doesn't race ours.
    if (this._mode === 'volume') {
      this.setMode('collapse');
    }

    this._generation++;

    // Snapshot the field the mesh is carrying, so the blend has a "from"
    // state. That field is _lastHF — the one _applyHF wrote — and NOT the live
    // geometry: see the FIX(r10) note below for why reading Y back is wrong
    // now. _lastHF means "the field the mesh currently carries", so every path
    // that takes the field OFF the mesh has to clear it, or this line starts
    // the next blend from something the user is no longer looking at:
    // _restorePristineToMesh() (setMode, setVolumeFormula, setVolumeFn,
    // deactivate all go through it) and onShapeChange() both null it.
    if (this.active && this._gridSize) {
      const pos   = this.render.gpuMesh.geometry.attributes.position;
      const count = pos.count;
      // FIX(#5c): size the snapshot as gridSize² — what _tickSurface asks for
      // and generateSurfaceFromFormula returns — not pos.count. On every shape
      // whose vertex count is not a perfect square (torus, torusknot, cone,
      // cylinder, box, icosahedron, star) the lengths disagreed,
      // _applyHFWithBlend gave up, and formula transitions never animated.
      const gs    = Math.round(Math.sqrt(count));
      const hfLen = gs * gs;
      if (!this._prevHF || this._prevHF.length !== hfLen) {
        this._prevHF   = new Float32Array(hfLen);
        this._blendBuf = new Float32Array(hfLen);
      }
      // FIX(r10): the "from" state is the last field APPLIED, not the mesh's
      // Y read index-wise. applyHeightField now samples the field at each
      // vertex's own (x,z), so mesh Y is vertex space and hf is grid space;
      // on the plane the two are the same array, which is why the old read
      // worked there, but on the other nineteen shapes it would start every
      // formula transition from a permutation of the outgoing field. With no
      // field applied yet, blend up from flat — the state the shape is in.
      if (this._lastHF && this._lastHF.length === hfLen) this._prevHF.set(this._lastHF);
      else this._prevHF.fill(0);
      this._blendActive = true;
      this._blendStart  = performance.now();
    }

    this._formulaFn  = f.f;
    this._collId     = collectionId;
    this._formulaKey = formulaKey;
    this.active      = true;
    this._pendingHF  = null;
    this._workerBusy = false;

    const pos = this.render.gpuMesh.geometry.attributes.position;
    this._gridSize = Math.round(Math.sqrt(pos.count));

    if (this._worker && this._workerReady) {
      this._worker.postMessage({ type: 'setFormula', collectionId, formulaKey });
    }

    this.render.U.uMathMode.value = 1;
    this._syncColourSource();
  }

  /**
   * Switch to Volume mode using one of the built-in VOLUME_FORMULAS.
   * @param {string} key — key into VOLUME_FORMULAS
   */
  setVolumeFormula(key) {
    const f = VOLUME_FORMULAS[key];
    if (!f) {
      console.warn(`[MathVisualizer] Unknown volume formula: ${key}`);
      return;
    }
    this._generation++;
    this._pendingHF  = null;
    this._workerBusy = false;
    // Restore pristine BEFORE snapshotting — otherwise the snapshot
    // captures whatever the previous mode left in the live attribute
    // (Surface's rewritten Y values, Volume's displacement field), and
    // every subsequent Volume tick layers on top of that frozen
    // distortion. With the restore, snapshot is always taken from
    // clean geometry. See setMode for the full rationale.
    if (this._pristinePositions) this._restorePristineToMesh();
    this._snapshotBasePositions();
    this._volumeFn  = f.f;
    this._volumeKey = key;
    this._mode      = 'volume';
    this.active     = true;
    this._pendingHF = null;
    this.render.U.uMathMode.value = 1;
    this._syncColourSource();
  }

  /**
   * Volume mode with a caller-supplied function. Intended for AI-API use
   * where formulas are generated at runtime rather than picked from the
   * registry.
   * @param {Function} fn — f(x, y, z, t, params) → { dx, dy, dz }
   */
  setVolumeFn(fn) {
    if (typeof fn !== 'function') return;
    this._generation++;
    this._pendingHF  = null;
    this._workerBusy = false;
    if (this._pristinePositions) this._restorePristineToMesh();
    this._snapshotBasePositions();
    this._volumeFn = fn;
    this._mode     = 'volume';
    this.active    = true;
    this._pendingHF = null;
    this.render.U.uMathMode.value = 1;
    this._syncColourSource();
  }

  /**
   * Switch deformation mode without changing the formula.
   * @param {'surface'|'volume'|'collapse'} mode
   */
  setMode(mode) {
    if (mode === this._mode) return;
    this._generation++;
    // Invalidate any in-flight worker response and the pending buffer.
    // A switch out of surface mode means whatever the worker is currently
    // computing (or has already returned) is no longer wanted.
    this._pendingHF  = null;
    this._workerBusy = false;
    // Cancel any in-flight Surface formula-transition blend. Without this,
    // a switch surface→volume→surface within the 800ms blend window would
    // resume the old blend from _prevHF, which now points at a height
    // field from a formula the user is no longer looking at. The blend
    // animation would briefly show a ghost of the abandoned formula.
    this._blendActive = false;
    // Reset the volume time accumulator's "last tick" marker. If we were
    // in volume mode and switch away (or in surface and switch into
    // volume), the next _tickVolume should treat itself as the first
    // tick — no carried-over dt from before the mode switch. Without
    // this, the dt sanity guards in _tickVolume silently discard the
    // first frame after mode entry, causing a one-frame jitter.
    this._lastTickTime = null;
    // Entering volume with no formula yet — pick a sensible default rather
    // than leave the mesh undeformed and confused.
    if (mode === 'volume' && !this._volumeFn) {
      this.setVolumeFormula('breathe');
      return;
    }

    // Volume and Collapse both write displaced positions over the base
    // snapshot. Surface mode rewrites pos.y absolutely each tick. The
    // safe transition path is: restore mesh from the pristine reference
    // (untouched-by-ticks), then snapshot a fresh baseline if entering
    // a displacement mode. Without the pristine restore, any new
    // baseline would just capture whatever the previous mode last
    // wrote — locking the mesh into yesterday's deformation.
    //
    // Order:
    //   1. restore mesh from pristine (if captured) — mesh is now clean
    //   2. if entering volume/collapse, snapshot mesh into _basePositions
    //
    // The pristine snapshot is captured once per shape via the public
    // onShapeChange() hook called from main.js after RenderEngine.setShape.
    // Code paths that reach setMode before any shape has been formally
    // announced (e.g. very early boot) skip the restore harmlessly.
    if (this._pristinePositions) {
      this._restorePristineToMesh();
    } else if ((this._mode === 'volume' || this._mode === 'collapse') &&
               this._basePositions) {
      // Legacy fallback for the early-boot case: if pristine wasn't
      // captured but we have a basePositions from a previous mode entry,
      // use that. Rarely hits in practice — onShapeChange fires from the
      // initial setShape during boot.
      this._restoreBasePositions();
    }

    if (mode === 'volume' || mode === 'collapse') {
      this._snapshotBasePositions();
    }
    this._mode = mode;
    this._syncColourSource();
  }

  /**
   * Hook called from main.js after RenderEngine.setShape finishes building
   * a new geometry. Captures the pristine reference for the new shape and
   * resets all stale per-shape state (worker pending, blends, baseline).
   *
   * Without this hook, a shape change inside Volume/Collapse mode used to
   * stall because the in-tick rebuild detect nulled _basePositions and
   * never re-snapshotted — the next tick's `if (!_basePositions) return`
   * froze the displacement entirely. Now main.js wires this to fire
   * synchronously after every setShape, so the pristine snapshot is
   * always fresh and current-mode re-snapshots its baseline from the
   * new shape's clean geometry.
   */
  onShapeChange() {
    this._capturePristine();
    // Invalidate any in-flight worker tick — its result would be sized for
    // the old vertex count and would fail to apply (or worse, apply
    // partially) to the new geometry.
    this._generation++;
    this._pendingHF    = null;
    this._lastHF       = null;   // belongs to the geometry that just went away
    this._workerBusy   = false;
    this._blendActive  = false;
    this._lastTickTime = null;
    const pos = this.render.gpuMesh.geometry.attributes.position;
    this._gridSize = Math.round(Math.sqrt(pos.count));

    // If we're in a displacement mode when the shape changes, immediately
    // refresh _basePositions from the new pristine. Without this, the
    // current mode's next tick would either bail (no baseline) or
    // displace from stale baseline of the previous shape.
    if (this._mode === 'volume' || this._mode === 'collapse') {
      this._snapshotBasePositions();
    }

    // The pristine snapshot the colour ramp subtracts is the one just taken,
    // so re-state which value the ramp should read. This is the call that
    // matters when a formula was armed before any shape had been announced:
    // until this point there was no base to subtract and the ramp had to
    // colour by pos.y.
    this._syncColourSource();

    // Re-arm the worker with the current formula so it knows about the
    // (possibly) new grid size. If no formula is active, nothing to do.
    if (this._formulaFn && this._worker && this._workerReady && this._collId) {
      this._worker.postMessage({
        type: 'setFormula', collectionId: this._collId, formulaKey: this._formulaKey,
      });
    }
  }

  /**
   * Strength multiplier for collapse mode.
   * 0 = no displacement (geometry unchanged), 1 = default, 2 = double.
   */
  setCollapseStrength(s) {
    this._collapseStrength = Math.max(0, s);
  }

  /**
   * Pause or resume the volume-mode time accumulator. Audio reactivity
   * continues; only the monotonic time argument stops advancing. Called
   * by main.js from the freeze-frame handler so volume formulas like
   * 'twist' don't keep rotating while the render loop is held.
   */
  setVolumeTimePaused(paused) {
    this._volumeTimePaused = !!paused;
  }

  /** Descriptors for every available volume formula. */
  getVolumeFormulaKeys() {
    return Object.entries(VOLUME_FORMULAS).map(([key, f]) => ({ key, name: f.name, description: f.description }));
  }

  /**
   * Return control of the geometry to the GPU shader, leaving the mesh as the
   * shape made it.
   *
   * FIX: this used to zero pos.y and nothing else, and its doc block claimed
   * that left "a flat surface" — true only of Surface mode. Volume and Collapse
   * write all three components, so switching from DEFORM: VOLUME to a GPU
   * shader left the mesh permanently displaced sideways underneath it (a
   * radius-2 sphere came out over two units out of shape on X and Z), with
   * nothing to put it back short of changing shape. Restoring the pristine
   * snapshot is what every mode transition already does for this exact reason
   * — see setMode. The Y-zeroing stays as the fallback for the one case with
   * no snapshot yet: deactivate before any shape has been announced.
   */
  deactivate() {
    this._generation++;
    this.active       = false;
    this._formulaFn   = null;
    this._pendingHF   = null;
    this._workerBusy  = false;
    this._blendActive = false;

    if (this._worker && this._workerReady) {
      this._worker.postMessage({ type: 'deactivate' });
    }

    this.render.U.uMathMode.value = 0;
    this._syncColourSource();

    if (this._pristinePositions) {
      this._restorePristineToMesh();
      return;
    }

    // No snapshot yet — nothing has announced a shape. Y is all this path can
    // have touched, and it is what the old code did in every case.
    // Same invariant as the restore above: the field is off the mesh. Nothing
    // observes it on this branch today — deactivate leaves active === false, so
    // setFormula skips the snapshot entirely — so this is here to keep "_lastHF
    // is what the mesh carries" true by construction rather than by luck.
    this._lastHF = null;
    const pos = this.render.gpuMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, 0);
    pos.needsUpdate = true;
    const ptsGeo = this._ownPtsGeometry();
    if (ptsGeo) {
      const pp = ptsGeo.attributes.position;
      for (let i = 0; i < pp.count; i++) pp.setY(i, 0);
      pp.needsUpdate = true;
    }
  }

  /**
   * Per-frame entry point. Called from main.js's animate loop; a no-op when
   * inactive. Handles geometry-resize invalidation, then dispatches to the
   * mode-specific tick.
   *
   * FIX(#25): the call is NOT unconditional — animate() gates it on the
   * render-rate skip (every 2nd rAF on mobile) and on isFrozen. The tick rate
   * is therefore already halved on mobile before _throttle is consulted, which
   * is why _throttle guards only main-thread math, and no tick arrives at all
   * while the output is frozen.
   */
  tick(time) {
    if (!this.active) return;

    // Geometry can be rebuilt under us when the user changes shape. The
    // vertex count and grid size change, so worker state and snapshots
    // are invalidated. Cheaper to detect here than to thread a callback
    // through the shape-change path.
    const currentCount = this.render.gpuMesh.geometry.attributes.position.count;
    const currentGrid  = Math.round(Math.sqrt(currentCount));
    if (currentGrid !== this._gridSize) {
      // Bump generation: the worker may currently be computing a tick for
      // the OLD grid size. When its result lands, the gen check will
      // discard it instead of trying to apply a height field whose length
      // no longer matches the geometry vertex count. Without this, a
      // rapid shape change would race the previous tick into the new
      // shape's attribute buffer and produce a length mismatch error
      // (or worse — a silent partial-write artefact).
      this._generation++;
      this._gridSize    = currentGrid;
      this._pendingHF   = null;
      this._workerBusy  = false;
      this._blendActive = false;
      this._basePositions    = null;
      this._baseNormals      = null;
      this._basePtsPositions = null;
      this._basePtsNormals   = null;
      if (this._worker && this._workerReady && this._collId) {
        this._worker.postMessage({ type: 'setFormula', collectionId: this._collId, formulaKey: this._formulaKey });
      }
      // The snapshot the ramp subtracts is now the wrong length for this
      // geometry, and applyHeightField will ignore it for exactly that reason
      // — so the ramp must stop subtracting too, or it would take the old
      // shape's body out of a field that no longer has it in.
      this._syncColourSource();
    }

    if (this._mode === 'volume') {
      this._tickVolume(time);
      return;
    }
    if (this._mode === 'collapse') {
      this._tickCollapse(time);
      return;
    }
    this._tickSurface(time);
  }

  /**
   * Collapse tick: evaluate the active Surface formula in spherical
   * (θ, φ) coords relative to the geometry centroid, then displace each
   * vertex along its stored normal by scalar · _collapseStrength.
   *
   * Reuses _formulaFn from the last setFormula() call. No-op when no
   * formula is active. Geometry restoration on mode exit is handled by
   * setMode('surface'), not here.
   *
   * Runs synchronously on the main thread: the worker protocol is grid-
   * oriented, and routing per-vertex spherical evaluation through it
   * would require a different message shape for marginal gain.
   */
  _tickCollapse(time) {
    if (!this._formulaFn || !this._basePositions || !this._baseNormals) return;

    this._frame++;
    if (this._frame % this._throttle !== 0) return;

    const { bass, mid, treble, beatInt, amp, waveInt } = this.audio;
    const audioParams = {
      amp:  amp     * (1 + bass   * 0.5),
      freq: waveInt * (1 + treble * 0.3),
      comp: 0.5     + mid * 0.4,
    };
    const t = time + beatInt * 0.3;

    const N = this._basePositions.length / 3;
    if (!this._collapseBuf || this._collapseBuf.length !== N) {
      this._collapseBuf = new Float32Array(N);
    }

    const sf = generateCollapseScalarField(
      this._formulaFn, audioParams, this._basePositions, t
    );

    // Scale displacement by the current shape-morph progress so a
    // collapse-mode formula does not snap into full strength mid-morph.
    // Matches how Surface mode multiplies pos.y by uMorphProgress.
    const morphScale = this.render.U.uMorphProgress?.value ?? 1.0;
    const strength   = this._collapseStrength * morphScale;

    applyCollapseField(
      this.render.gpuMesh.geometry, sf,
      this._basePositions, this._baseNormals, strength, this._bandLayer()
    );
    const ptsGeo = this._ownPtsGeometry();
    if (ptsGeo && this._basePtsPositions && this._basePtsNormals) {
      // A proxy with its own geometry can carry a different vertex count, so
      // the scalar field is recomputed for it rather than reused.
      const sfPts = generateCollapseScalarField(
        this._formulaFn, audioParams, this._basePtsPositions, t
      );
      applyCollapseField(
        ptsGeo, sfPts,
        this._basePtsPositions, this._basePtsNormals, strength, this._bandLayer()
      );
    }
  }

  /** Volume tick: full XYZ displacement from base positions. */
  _tickVolume(time) {
    if (!this._volumeFn || !this._basePositions) return;

    this._frame++;
    if (this._frame % this._throttle !== 0) return;

    // Advance the internal time accumulator only when not paused. Two
    // guards on dt: reject backwards jumps (rAF clock quirks under DST or
    // worker-thread time sources) and reject huge deltas (tab was hidden
    // and we got a single 30-second tick on return — that would teleport
    // the formula instead of animating it).
    if (this._lastTickTime !== null) {
      const dt = time - this._lastTickTime;
      if (dt > 0 && dt < 1) {
        if (!this._volumeTimePaused) this._volumeAccumTime += dt;
      }
    }
    this._lastTickTime = time;

    const { bass, mid, treble, amp, waveInt } = this.audio;
    const audioParams = {
      // FIX(r11): freq was `1 + treble·0.3` here and `waveInt·(1 + treble·0.3)`
      // in both other modes, so WAVE INTENSITY — the app's main formula control
      // — did nothing at all in VOLUME: every one of the six vector fields saw
      // freq in [1.00, 1.30] wherever the slider stood, against [0.30, 4.55]
      // in Surface and Collapse.
      amp:  amp     * (1 + bass   * 0.5),
      freq: waveInt * (1 + treble * 0.3),
      comp: 0.5     + mid   * 0.4,
    };

    const count = this._basePositions.length / 3;
    if (!this._dfBuffer || this._dfBuffer.length !== count * 3) {
      this._dfBuffer = new Float32Array(count * 3);
    }

    const df = generateVolumeFromFormula(
      this._volumeFn, audioParams,
      this._gridSize, 3.5, this._volumeAccumTime,
      this._basePositions
    );

    // The band layer reaches VOLUME and COLLAPSE too. It did not at first, and
    // the symptom was the worst kind of nothing: the slider moved, its readout
    // counted, presets and autosave stored the value, and not one pixel changed
    // — because both DEFORM modes have their own door into the geometry and
    // neither had been given the layer. Found by a review sweep.
    applyDisplacementField(this.render.gpuMesh.geometry, df, this._basePositions, this._bandLayer());
    const ptsGeo = this._ownPtsGeometry();
    if (ptsGeo) {
      applyDisplacementField(ptsGeo, df, this._basePtsPositions ?? this._basePositions, this._bandLayer());
    }
  }

  /** Surface tick: Y-only height field, worker-preferred. */
  _tickSurface(time) {
    // FIX(#11): advance the shared frame counter here too — it was moved only
    // by _tickCollapse / _tickVolume, so a surface-only session left it at 0.
    //
    // FIX(#11, r2): the counter advances, but the gate does not sit here. On
    // mobile tick() already arrives at half rate, so a gate at the top halved
    // two more things: the worker-backed evaluation rate (~15Hz against the
    // ~30Hz the constructor promises) and the _pendingHF application below,
    // which stepped the geometry at half the rate it was drawn. The gate now
    // guards only the sync fallback at the bottom of this method.
    this._frame++;

    // Apply whatever the worker delivered last tick (1-frame latency).
    // The pending field is consumed before we post a new request so the
    // worker never has more than one tick of work queued.
    if (this._pendingHF) {
      const hf = this._pendingHF;
      this._pendingHF = null;
      this._applyHFWithBlend(hf);
    }

    const { bass, mid, treble, beatInt, amp, waveInt } = this.audio;
    const audioParams = {
      amp:  amp   * (1 + bass   * 0.5),
      freq: waveInt * (1 + treble * 0.3),
      comp: 0.5   + mid   * 0.4,
    };
    const t = time + beatInt * 0.3;

    // FIX(#4): stall watchdog. An unanswered post latches _workerBusy, and the
    // worker path is then never retried — later frames fall through to the sync
    // branch silently. Releasing the gate lets a merely slow channel recover;
    // we skip the post for this one frame so the sync branch still produces
    // geometry, and never terminate the worker, so a late reply is still
    // consumed by onmessage.
    let stalled = false;
    const budget = this._workerAnswered ? WORKER_STALL_MS : WORKER_COLD_START_MS;
    if (this._workerBusy && performance.now() - this._workerPostTime > budget) {
      this._workerBusy = false;
      stalled = true;
      if (!this._workerStallWarn) {
        this._workerStallWarn = true;
        console.warn(
          `[MathVisualizer] Worker tick unanswered for ${budget}ms — ` +
          'computing this frame synchronously and retrying the worker.'
        );
      }
    }

    // Worker path: post next tick, return immediately. The result lands
    // in onmessage and is picked up at the top of the next tick.
    if (this._workerReady && this._worker && !this._workerBusy && !stalled) {
      this._workerBusy = true;
      this._workerPostTime = performance.now();   // FIX(#4): watchdog baseline
      this._worker.postMessage({
        type: 'tick',
        time: t,
        gridSize: this._gridSize,
        extent: 3.5,
        audioParams,
        gen: this._generation,
      });
      return;
    }

    // Sync fallback: compute on main thread and apply immediately.
    if (!this._formulaFn) return;
    // FIX(#11, r2): the mobile gate lives here — the one Surface path that
    // spends main-thread time, so the one with CPU to buy back. A stalled frame
    // is exempt: the watchdog skipped the post so this branch covers it.
    if (!stalled && this._frame % this._throttle !== 0) return;
    const hf = generateSurfaceFromFormula(this._formulaFn, audioParams, this._gridSize, 3.5, t);
    this._applyHFWithBlend(hf);
    // FIX: a main-thread apply supersedes the tick still in flight. Without
    // this the worker's answer for an OLDER time arrives carrying the current
    // generation, is accepted, and is applied at the top of the next tick — the
    // surface steps backwards one frame and then forwards again. Bumping the
    // generation reuses the guard in onmessage that already exists for a
    // formula changing mid-computation; the worker echoes gen unchanged, so
    // nothing on that side needs to know.
    this._generation++;
  }

  /** Tear down the worker. Called from main.js on beforeunload. */
  dispose() {
    if (this._worker) { this._worker.terminate(); this._worker = null; }
  }

  // ── Private — worker channel ─────────────────────────────────────────────

  /**
   * FIX(#4): disarm the worker channel after an unrecoverable failure and fall
   * back to synchronous evaluation for the rest of the session. Clears the busy
   * gate (nothing will answer the in-flight tick) and the pending buffer (it
   * belongs to a dead channel), and clears _vimathic_worker_active — leaving
   * that flag true is exactly the lie the e2e guard and the troubleshooting doc
   * exist to catch. Idempotent; warns once, in the same shape as
   * createMathWorker(), so both failure modes read identically in the console.
   */
  _disableWorker(reason) {
    if (!this._workerReady) return;
    this._workerReady = false;
    this._workerBusy  = false;
    this._pendingHF   = null;
    if (typeof window !== 'undefined') window._vimathic_worker_active = false;
    console.warn(
      '[MathVisualizer] Worker failed — math will run synchronously on main thread.\n' +
      'Cause:', reason, '\n' +
      'Hint: math-worker-*.js must be at the same path as index.html on the server.'
    );
  }

  /**
   * Tell the vertex program which value the colour ramp should read.
   *
   * The ramp's window is the size of the audio displacement and nothing wider
   * (t = clamp((vH+.8)*.6,.03,.97) — see the note at the top of VS), so it has
   * to be handed the FIELD, not the absolute height. Surface mode is the only
   * mode where the two differ: applyHeightField writes base + field, and the
   * base comes back out as pos.y - aBaseY. Volume and Collapse have always
   * written base + displacement and have always coloured by the sum; this
   * method is what keeps them bit-identical rather than "close".
   *
   * The condition is not "are we in Surface mode" but the exact condition
   * applyHeightField uses to decide whether it added a base at all:
   *
   *     base = (basePositions && basePositions.length === n*3) ? basePositions : null
   *
   * With no usable snapshot the field is written alone, and subtracting aBaseY
   * would then take out a body that is not in there. Keeping the two tests
   * identical is what makes every fallback path agree instead of disagree.
   *
   * uVHField is absent only from the hand-built render stubs in the tests; the
   * app's uniform block always declares it.
   */
  _syncColourSource() {
    const u = this.render.U?.uVHField;
    if (!u) return;
    const pos    = this.render.gpuMesh?.geometry?.attributes?.position;
    const based  = !!(this._pristinePositions && pos &&
                      this._pristinePositions.length === pos.count * 3);
    // FIX(r11): three states, not two. 2 says "the field is in aField", which
    // is what the surface path writes now that the displacement follows the
    // normal — pos.y - aBaseY would give the ramp n_y·h. 1 is the old
    // subtraction, kept for a geometry that has no aField (an imported model),
    // and 0 is the shader path.
    const geo    = this.render.gpuMesh?.geometry;
    const hasFld = !!(geo?.attributes?.aField && pos && geo.attributes.aField.array.length === pos.count);
    u.value = (this.active && this._mode === 'surface' && based) ? (hasFld ? 2 : 1) : 0;
  }

  // ── Private — volume / collapse helpers ──────────────────────────────────

  /**
   * Capture pristine (untouched-by-ticks) geometry. Called via the public
   * onShapeChange() hook after RenderEngine.setShape rebuilds the mesh.
   *
   * The captured buffers stay alive across mode changes and are the
   * authoritative "true shape" — Volume and Collapse ticks displace
   * from this, Surface ticks rewrite Y but the X/Z reference is still
   * pristine for any subsequent restore. Without this, restoring a clean
   * baseline at mode-switch time has no source: ticks have already
   * mutated the live attribute past recognition.
   */
  /**
   * FIX(#52): the geometry the points proxy carries — but only when it is the
   * proxy's OWN. In the shipped app the proxy BORROWS gpuMesh.geometry
   * (render.js FIX(#3): construction shares it, every shape swap re-shares
   * it), so all per-vertex work done for the mesh has already landed in the
   * proxy's buffers, and every "and now the same for the proxy" branch was
   * doing that work a second time on the same arrays — Collapse recomputed
   * the whole scalar field once per tick, Volume re-applied the displacement
   * pass, the snapshot methods held a byte-identical second copy of every
   * pristine/base array (~1.2 MB at 161²). _tickSurface has guarded with
   * `ptsGeo !== geo` since FIX(r11); this helper is that guard for everyone.
   * A proxy that one day owns distinct geometry gets served exactly as
   * before — that is the branch these call sites keep existing for.
   */
  _ownPtsGeometry() {
    const ptsGeo = this.render.gpuPtsProxy?.geometry;
    return (ptsGeo && ptsGeo !== this.render.gpuMesh.geometry) ? ptsGeo : null;
  }

  _capturePristine() {
    const geo = this.render.gpuMesh.geometry;
    const pos = geo.attributes.position;
    const n   = pos.count;

    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nrm = geo.attributes.normal;

    this._pristinePositions = new Float32Array(n * 3);
    this._pristineNormals   = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this._pristinePositions[i * 3]     = pos.getX(i);
      this._pristinePositions[i * 3 + 1] = pos.getY(i);
      this._pristinePositions[i * 3 + 2] = pos.getZ(i);
      this._pristineNormals[i * 3]     = nrm.getX(i);
      this._pristineNormals[i * 3 + 1] = nrm.getY(i);
      this._pristineNormals[i * 3 + 2] = nrm.getZ(i);
    }
    // Which bodies the field may follow, decided by measurement rather than by
    // shape name — names change, and round 10 spent a wave on that lesson.
    //
    //   * thin plate  → vertical. `disc` is 0.08 thick with 95.3 % of its
    //     vertices carrying a horizontal normal; pushing its faces apart turns
    //     it inside out (measured thickness −0.606 at the factory sliders).
    //   * hard edges  → vertical. The weld closes the seam and opens a fold in
    //     the strip beside it; see normalsDisagree.
    //   * otherwise   → the normal, with the depth capped at 0.8 of the local
    //     medial radius, because that — not the bounding box — is what decides
    //     whether the surface reaches its own axis. `torusknot` (tube 0.65)
    //     inverted on 8 of the 192 kernels at the factory sliders before this
    //     cap, worst −0.931, i.e. 143 % past the axis.
    //
    // FIX(r11, cost): the three questions are asked cheapest-first now, and the
    // order is not cosmetic. The bounding box costs one pass and no allocation;
    // the other two cost a hash of every vertex. Asked in the old order,
    // `plane` — 25 921 vertices, and a plate by any measure — paid 25.5 ms per
    // shape change to be told what its own bounding box already knew.
    this._pristineDepth = Infinity;
    if (thinnestExtent(this._pristinePositions) < THIN_BODY) {
      this._pristineNormals = null;
    } else {
      // One grouping, two answers. The hard-edge test runs on the RAW normals:
      // welding makes every copy at a position agree by construction, so asking
      // afterwards always answers "no". (It did, and box, cylinder, cone and
      // both pyramids went down the normal path and folded — 3744 inverted
      // faces on box under a negative field.)
      const rep = positionGroups(this._pristinePositions);
      if (normalsDisagree(rep, this._pristineNormals)) {
        this._pristineNormals = null;                 // and no weld: it would be discarded
      } else {
        this._pristineNormals = weldWithGroups(rep, this._pristineNormals);
        // Two caps, cheapest first — the same ordering principle as the three
        // questions above, and here it pays twice over. foldRadius is one pass
        // and a sort; medialRadius is 400 sources against every vertex, which on
        // the gyroid is 16 million distance tests. A body the fold rule already
        // rejects never pays for the medial one.
        //
        // FIX(wave B): until this, the cap was the medial radius alone, and it
        // answers only "how far is the nearest sheet facing back". A surface
        // also folds against its own curvature with no second sheet in sight —
        // see foldRadius for the measurements. Taking the MINIMUM of the two is
        // what keeps the change surgical: on every body already on this path
        // foldRadius answers ABOVE the medial cap that already bound it — sphere
        // 3.500 against 2.656, torus 1.100 against 0.837, icosahedron-smooth
        // 3.500 against 2.663, catenoid 1.500 against 1.141, hyperboloid 1.600
        // against 1.217, solar 1.200 against 0.911 — so the minimum is still the
        // medial one and their caps and their pixels are unchanged. The
        // two that move are `helicoid`, which was folding 20 of its 19 200
        // triangles under 33 of the 192 kernels, and the five implicit bodies,
        // which would have folded far harder.
        // No 0.8 on the fold distance, unlike the medial one below, and the
        // asymmetry is deliberate. medialRadius samples 400 sources, so its
        // answer can overstate the clearance and is bought down. foldRadius is
        // exact for every triangle; its only softening is the area quantile,
        // which is already the margin. A second one would double-count it.
        const f = foldRadius(this._pristinePositions, this._pristineNormals,
                             geo.index ? geo.index.array : null);
        this._pristineDepth = f;
        if (this._pristineDepth >= MIN_USEFUL_DEPTH) {
          const r = medialRadius(this._pristinePositions, this._pristineNormals);
          this._pristineDepth = Math.min(f, Number.isFinite(r) ? r * 0.8 : Infinity);
        }
        // And a body with almost no room keeps the vertical rule too. The knot's
        // strands leave 0.222 between them, and a cap that tight both hides the
        // field and still leaves the surface crossing itself somewhere the sample
        // did not look — 34 of the 192 kernels at the reachable over-drive, worst
        // 10 faces of 10 240. Below a third of a unit the answer is not a smaller
        // cap, it is that this body cannot carry this field.
        if (this._pristineDepth < MIN_USEFUL_DEPTH) {
          this._pristineNormals = null;
          this._pristineDepth = Infinity;
        }
      }
    }

    const ptsGeo = this._ownPtsGeometry();
    if (ptsGeo) {
      const pp = ptsGeo.attributes.position;
      if (!ptsGeo.attributes.normal) ptsGeo.computeVertexNormals();
      const pn = ptsGeo.attributes.normal;
      this._pristinePtsPositions = new Float32Array(pp.count * 3);
      this._pristinePtsNormals   = new Float32Array(pp.count * 3);
      for (let i = 0; i < pp.count; i++) {
        this._pristinePtsPositions[i * 3]     = pp.getX(i);
        this._pristinePtsPositions[i * 3 + 1] = pp.getY(i);
        this._pristinePtsPositions[i * 3 + 2] = pp.getZ(i);
        this._pristinePtsNormals[i * 3]     = pn.getX(i);
        this._pristinePtsNormals[i * 3 + 1] = pn.getY(i);
        this._pristinePtsNormals[i * 3 + 2] = pn.getZ(i);
      }
      // Same three questions in the same cheapest-first order as the mesh above.
      if (thinnestExtent(this._pristinePtsPositions) < THIN_BODY) {
        this._pristinePtsNormals = null;
      } else {
        const ptsRep = positionGroups(this._pristinePtsPositions);
        this._pristinePtsNormals = normalsDisagree(ptsRep, this._pristinePtsNormals)
          ? null
          : weldWithGroups(ptsRep, this._pristinePtsNormals);
      }
    } else {
      this._pristinePtsPositions = null;
      this._pristinePtsNormals   = null;
    }
  }

  /**
   * Copy pristine positions back to the live mesh. Used at mode-transition
   * time to give the next mode a clean canvas to draw on. No-op if pristine
   * hasn't been captured yet (first mode-switch before any shape was set
   * via the onShapeChange hook — falls through to existing _basePositions
   * behaviour).
   */
  _restorePristineToMesh() {
    if (!this._pristinePositions) return;
    const pos = this.render.gpuMesh.geometry.attributes.position;
    const n   = pos.count;
    // Defensive: if vertex count drifted, the pristine snapshot is stale;
    // skip rather than write into mismatched buffers.
    if (this._pristinePositions.length !== n * 3) return;
    for (let i = 0; i < n; i++) {
      pos.setXYZ(i,
        this._pristinePositions[i * 3],
        this._pristinePositions[i * 3 + 1],
        this._pristinePositions[i * 3 + 2]);
    }
    pos.needsUpdate = true;
    this.render.gpuMesh.geometry.computeVertexNormals();

    const ptsGeo = this._ownPtsGeometry();
    if (ptsGeo && this._pristinePtsPositions) {
      const pp = ptsGeo.attributes.position;
      if (this._pristinePtsPositions.length === pp.count * 3) {
        for (let i = 0; i < pp.count; i++) {
          pp.setXYZ(i,
            this._pristinePtsPositions[i * 3],
            this._pristinePtsPositions[i * 3 + 1],
            this._pristinePtsPositions[i * 3 + 2]);
        }
        pp.needsUpdate = true;
        ptsGeo.computeVertexNormals();
      }
    }

    // The mesh no longer carries a height field, so the blend has nothing to
    // start FROM: the next setFormula must blend up from the restored shape.
    // Set here rather than in each of the four callers (setMode,
    // setVolumeFormula, setVolumeFn, deactivate) because this is the line that
    // makes it true — and because the two early returns above deliberately do
    // NOT clear it: if the restore did not happen, the field is still on the
    // mesh. Without this line, Surface → Collapse → Surface → new formula puts
    // the OLD formula's plate on screen for the first frame and blends away
    // from it. `tests/blend-from-state.test.js` is where that is measured and
    // where the numbers live: delete this line and it prints 0.9795 world units
    // on the plane and 0.9640 on the sphere, in its own failure messages, on
    // the desktop geometry it builds. Its third test walks every path that
    // reaches this method, so a partial fix fails it too.
    this._lastHF = null;
  }

  /**
   * Snapshot current geometry positions AND normals as the base for
   * displacement modes. Both Volume and Collapse read base+offset every
   * tick, so the originals must be kept somewhere they won't be overwritten.
   *
   * Normals are assumed already correct — RenderEngine._buildShapeGeo
   * calls computeVertexNormals() after creating each shape. The defensive
   * recompute below is for the unlikely case of a geometry arriving
   * without a normal attribute at all.
   */
  _snapshotBasePositions() {
    const geo = this.render.gpuMesh.geometry;
    const pos = geo.attributes.position;
    const n   = pos.count;

    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nrm = geo.attributes.normal;

    this._basePositions = new Float32Array(n * 3);
    this._baseNormals   = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this._basePositions[i * 3]     = pos.getX(i);
      this._basePositions[i * 3 + 1] = pos.getY(i);
      this._basePositions[i * 3 + 2] = pos.getZ(i);
      this._baseNormals[i * 3]     = nrm.getX(i);
      this._baseNormals[i * 3 + 1] = nrm.getY(i);
      this._baseNormals[i * 3 + 2] = nrm.getZ(i);
    }
    this._gridSize = Math.round(Math.sqrt(n));

    const ptsGeo = this._ownPtsGeometry();
    if (ptsGeo) {
      const pp = ptsGeo.attributes.position;
      if (!ptsGeo.attributes.normal) ptsGeo.computeVertexNormals();
      const pn = ptsGeo.attributes.normal;
      this._basePtsPositions = new Float32Array(pp.count * 3);
      this._basePtsNormals   = new Float32Array(pp.count * 3);
      for (let i = 0; i < pp.count; i++) {
        this._basePtsPositions[i * 3]     = pp.getX(i);
        this._basePtsPositions[i * 3 + 1] = pp.getY(i);
        this._basePtsPositions[i * 3 + 2] = pp.getZ(i);
        this._basePtsNormals[i * 3]     = pn.getX(i);
        this._basePtsNormals[i * 3 + 1] = pn.getY(i);
        this._basePtsNormals[i * 3 + 2] = pn.getZ(i);
      }
    } else {
      // Shared or absent proxy: the base arrays above cover it. Nulling keeps
      // a snapshot from a formerly-distinct proxy from surviving a re-share —
      // _capturePristine's else does the same one method up.
      this._basePtsPositions = null;
      this._basePtsNormals   = null;
    }
  }

  /** Restore geometry to the snapshotted base positions. */
  _restoreBasePositions() {
    if (!this._basePositions) return;
    const pos = this.render.gpuMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i,
        this._basePositions[i * 3],
        this._basePositions[i * 3 + 1],
        this._basePositions[i * 3 + 2]
      );
    }
    pos.needsUpdate = true;
  }

  // ── Private — surface blend ───────────────────────────────────────────────

  /**
   * Apply hf, blending from _prevHF if a formula transition is in progress.
   * Steady-state allocations are zero — _blendBuf is reused every frame
   * and only resized when the geometry's vertex count changes.
   */
  _applyHFWithBlend(hf) {
    if (!this._blendActive) {
      this._applyHF(hf);
      return;
    }

    const elapsed = performance.now() - this._blendStart;
    const rawT    = Math.min(1, elapsed / this._blendDuration);
    const blendT  = easeInOutCubic(rawT);

    // Nothing to blend from — first field after activation.
    if (!this._prevHF) {
      this._blendActive = false;
      this._applyHF(hf);
      return;
    }

    if (!this._blendBuf || this._blendBuf.length !== hf.length) {
      this._blendBuf = new Float32Array(hf.length);
    }

    // FIX(#5c): blend over the overlap instead of abandoning the transition
    // on any length mismatch. The snapshot in setFormula and the field the
    // worker returns are sized the same way now, so the overlap is normally
    // the whole field; the min() only matters if a geometry rebuild slipped
    // between the snapshot and this tick, and even then the shared prefix is
    // still a legitimate "from" state. Entries past the overlap have no
    // previous value, so they pass through unblended — identical to what the
    // no-blend path would have written for them.
    const buf  = this._blendBuf;
    const prev = this._prevHF;
    const n    = Math.min(prev.length, hf.length);
    for (let i = 0; i < n; i++) {
      buf[i] = prev[i] + (hf[i] - prev[i]) * blendT;
    }
    for (let i = n, len = hf.length; i < len; i++) {
      buf[i] = hf[i];
    }

    this._applyHF(buf);

    if (rawT >= 1) this._blendActive = false;
  }

  /**
   * Push a height field into the mesh — and into the points proxy only when
   * that is a DIFFERENT geometry object.
   *
   * FIX(r10 §1.3/§1.4/§1.6): the pristine snapshot is the Y the field
   * displaces from; without it applyHeightField falls back to a bare graph and
   * the shape's own height is lost. It is captured by onShapeChange() before
   * any tick can run (main.js wires it to RenderEngine.setShape and calls it
   * once at boot), and Surface ticks never write X or Z, so it stays the
   * shape's true position for as long as the shape lives.
   *
   * FIX(r10 §1.8): the proxy deliberately BORROWS gpuMesh.geometry — render.js
   * builds it with that very object and setShape assigns one newGeo to both —
   * so the two calls wrote the same Y values into the same buffer twice and
   * ran computeVertexNormals twice, every frame in PTS mode. It cost a second
   * full applyHeightField per frame: on the box, the largest geometry the app
   * builds a shape from (39 366 vertices, grid 198), the doubled call is
   * measured at almost exactly twice the single one, and the single one is
   * already about a third of a 60 fps frame. Absolute readings on this
   * developer's device — an ARM64 Debian guest, node 24 — were 4.85 and 9.78 ms
   * in one session and 5.22 and 10.41 ms in another, which is why the durable
   * statement here is the RATIO and the fraction of the budget, not the
   * milliseconds: re-derive with two calls against one on the box's geometry,
   * on whatever machine is asking. The identity TEST rather than dropping the
   * second call outright: if a proxy ever does get a geometry of its own it is
   * still filled exactly as before, so this is a no-op on every arrangement
   * that was already correct.
   *
   * _lastHF is the field a formula change blends away FROM: the blend works in
   * grid space, and reading it back off the mesh would read vertex space.
   *
   * FIX(r10, wave 2): copy into _lastHFBuf instead of keeping the caller's
   * array. Every array that reaches here is one somebody else keeps writing:
   * on the worker path `hf` IS _hfBuffer, which the next reply overwrites in
   * place, and during a blend it IS _blendBuf, rewritten every frame. Aliasing
   * made _lastHF mean "whatever those buffers hold now". Measured with a stub
   * Worker driving the real onmessage handler: with a reply landing between an
   * apply and the next tick, the blend's from-state was the field that had NOT
   * reached the mesh.
   *
   * Size of the error = one frame of the formula's own motion, max over the
   * lattice of |f(t + 0.008) − f(t)| at t = 0 — 0.008 being one 60 Hz frame of
   * the 0.48 units/s clock (FIX(#50); a counted mobile-path frame spans two,
   * which doubles the reading but not who has one). That count depends on the grid
   * and on the amplitude, so both have to be named: over the 192 catalogue
   * formulas it is exactly 0 for 100 of them at grids 21, 83, 90 and 198, and
   * for 99 at 43, 81 and 161 — and 43 and 83 are the boot grids while 81 and
   * 161 are the plane's own, so the count differs between two grids the app
   * boots on. "About a hundred of 192 take no clock" is the form that does not
   * depend on which lattice is asking. The largest single reading is
   * topology/helicoid, 0.70659 world units at the validation baseline amp 1.00
   * (0.49461 at the factory 0.70), which is 199.9 % of its own peak at the
   * same setting — and even that is grid-conditioned: it holds at 3, 5, 21,
   * 43, 81, 83 and 161 and collapses to 0.00027 at 90 and 198. Grid 90 is not
   * a lattice this app lays down; 43 and 83 are the boot grids. CONTROL for
   * that count: at dt = 0 all 192 read exactly 0, and 88 of the 192 move at
   * every grid tested — so a formula reading 0 is standing still, not the
   * comparator being blind.
   *
   * The copy is one Float32Array.set of gridSize² per frame — the same buffer
   * discipline _prevHF and _blendBuf already keep, and no steady-state
   * allocation. Its cost is a memcpy of 25 921 floats against a per-vertex
   * sample-and-normals pass over the same plate: on this developer's device the
   * two read 0.0044 ms and 3.29 ms, so the copy is a fraction of a percent of
   * the call it rides along with. Both are machine numbers; the durable claim
   * is the ratio, and it is the reason this fix costs nothing to take.
   */
  /**
   * The 24-band layer as applyHeightField wants it, or null when it is off.
   *
   * Reads the SAME two numbers the shader is given — the engine's live band
   * array and the renderer's uBandR — rather than measuring the body a second
   * time here. Two independent measurements of "how wide is this shape" would
   * agree until the day one of them was updated and the other was not, and the
   * symptom would be the CPU and GPU paths drawing their rings at different
   * radii on the same body.
   */
  _bandLayer() {
    const depth = this.audio?.bandDepth ?? 0;
    if (!(depth > 0) || !this.audio?.bands) return null;
    return { bands: this.audio.bands, depth, radius: this.render.U?.uBandR?.value ?? 3.5 };
  }

  _applyHF(hf) {
    if (!this._lastHFBuf || this._lastHFBuf.length !== hf.length) {
      this._lastHFBuf = new Float32Array(hf.length);
    }
    this._lastHFBuf.set(hf);
    this._lastHF = this._lastHFBuf;
    const geo = this.render.gpuMesh.geometry;
    // FIX(r11): the pristine NORMALS go with the pristine positions now — welded
    // across coincident positions, and withheld entirely for a thin body (see
    // _capturePristine). Without them the field could only push along +Y, and
    // on a closed body that moves the top and the bottom of every column the
    // same way: the shape shears and never changes thickness.
    applyHeightField(geo, hf, this._pristinePositions, FIELD_EXTENT, this._pristineNormals, this._pristineDepth,
                     this._bandLayer());
    // FIX(#52): same guard as everywhere else, through the one helper — this
    // site is where the pattern was born (FIX(r11)).
    const ptsGeo = this._ownPtsGeometry();
    if (ptsGeo) {
      applyHeightField(ptsGeo, hf, this._pristinePtsPositions, FIELD_EXTENT, this._pristinePtsNormals, this._pristineDepth,
                       this._bandLayer());
    }
  }
}
