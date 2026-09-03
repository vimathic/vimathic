/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

// band-map.js — which of the 24 audio bands each point of the body listens to.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The first version of the band layer decided that by ONE rule: distance from
// the body's axis. It is a rule that knows nothing about what is being drawn,
// so a Mandelbrot, a Chebyshev quartic and a cellular automaton all pulsed in
// identical concentric rings, and the owner said so: "как будто под фигурой
// какая бы она ни была, пульсируют одни и те же кольца".
//
// He was right, and it is measurable. Over 24 formulas from different
// collections, the share of the field's variance explained by radius ALONE runs
// from 0.5 % (rule 90, square wave) to 99.8 % (Bessel J0). Only 8 of the 24 are
// genuinely radial. For the other two thirds the rings were imposed from
// outside — which is exactly what "no magic" feels like.
//
// ── What decides the band instead ────────────────────────────────────────────
// The formula's own LOCAL SPATIAL FREQUENCY: how finely it is corrugated at
// that point. Where a formula is broad and lazy, that place listens to the
// bass; where it is finely detailed, it listens to the cymbals. Frequency
// answers to frequency, which is the one pairing that needs no metaphor.
//
// Chosen against four alternatives, all five prototyped and measured, and this
// one won on the number that matters — how often a scheme falls BACK to rings:
//
//               distinctiveness   Mandelbrot    agreement with
//               (16x16 blocks)    -> rings      the colour ramp
//   rings today      0.000          1.00            0.295
//   field value      0.296          0.85            0.948
//   local frequency  0.291          0.30            0.180
//
// The middle column is the complaint being fixed: ranking by the field's own
// value still draws a target on the formulas where it matters most. The right
// column is why it would not have felt new anyway — the field IS what the
// palette already colours by, so that map is the same picture a third time.
//
// ── The cascade, and why there is one ────────────────────────────────────────
// Some fields have no local frequency at all. A sandpile or rule 184 is
// piecewise CONSTANT: every derivative is zero almost everywhere, and an
// estimator built on derivatives has nothing to rank. So the map is built in
// stages, each entering only to the extent the previous one has nothing to say:
//
//   K  local rms wavenumber          — the estimator proper
//   G  |grad h|                      — for a field with slope but no texture
//   H  the smoothed level itself     — for a field that is flat in patches
//   r  distance from the axis        — the old rule, as the last resort
//
// The last line is the important one: where the formula genuinely has no
// structure to spend 24 bands on, this degrades exactly into what shipped
// before, rather than into noise.

const EPS = 1e-12;

/** Analysis lattice. Not the app's 161² — the map is smooth, and 65² rebuilds
 *  inside the 30 ms budget even on the heaviest body. */
export const ANALYSIS_GRID = 65;

/** Box radius of the smoothing, in analysis cells. Measured: without it the map
 *  is grainy (neighbour roughness 0.98); at r=5 it reads 0.74 — calmer than the
 *  field-value map — while distinctiveness goes UP rather than down. */
const BOX_R = 5;

/** Histogram resolution for the equalisation. 1024 is far finer than 24 bands
 *  and costs one Int32Array. */
const BINS = 1024;

// ── lattice operators ───────────────────────────────────────────────────────

/** |grad h|² on a g×g lattice of step s, one-sided at the edges. */
function gradSq(h, g, s) {
  const out = new Float32Array(g * g);
  const inv = 1 / (2 * s);
  for (let z = 0; z < g; z++) {
    const zm = z > 0 ? z - 1 : z, zp = z < g - 1 ? z + 1 : z;
    const kz = (zp - zm) === 2 ? inv : 1 / s;
    for (let x = 0; x < g; x++) {
      const xm = x > 0 ? x - 1 : x, xp = x < g - 1 ? x + 1 : x;
      const kx = (xp - xm) === 2 ? inv : 1 / s;
      const hx = (h[z * g + xp] - h[z * g + xm]) * kx;
      const hz = (h[zp * g + x] - h[zm * g + x]) * kz;
      out[z * g + x] = hx * hx + hz * hz;
    }
  }
  return out;
}

/** Separable box mean, O(N) in the lattice, edges clamped. */
function boxMean(a, g, r) {
  if (r <= 0) return Float32Array.from(a);
  const tmp = new Float32Array(g * g), out = new Float32Array(g * g);
  const w = 2 * r + 1;
  const clamp = (v) => (v < 0 ? 0 : v > g - 1 ? g - 1 : v);
  for (let z = 0; z < g; z++) {
    const row = z * g;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += a[row + clamp(k)];
    for (let x = 0; x < g; x++) {
      tmp[row + x] = acc / w;
      acc += a[row + clamp(x + r + 1)] - a[row + clamp(x - r)];
    }
  }
  for (let x = 0; x < g; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k) * g + x];
    for (let z = 0; z < g; z++) {
      out[z * g + x] = acc / w;
      acc += tmp[clamp(z + r + 1) * g + x] - tmp[clamp(z - r) * g + x];
    }
  }
  return out;
}

// ── the three estimators of the cascade ─────────────────────────────────────

/**
 * K — local rms wavenumber: sqrt( <|grad h|²>_w / <(h − <h>_w)²>_w ).
 *
 * For h = A·sin(kx) this is exactly k for ANY amplitude A — the amplitude
 * cancels, which is what makes it comparable between a formula that spans 0.2
 * units and one that spans 5. In general it is the rms of the local spatial
 * power spectrum, i.e. how fine the texture is right here.
 */
function estimatorK(h, g, s, r) {
  const g2 = boxMean(gradSq(h, g, s), g, r);
  const m1 = boxMean(h, g, r);
  const hs = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) hs[i] = h[i] * h[i];
  const m2 = boxMean(hs, g, r);
  // A global floor under the local variance, so a locally flat patch cannot
  // divide by zero and cannot claim an infinite wavenumber.
  let vBar = 0;
  for (let i = 0; i < h.length; i++) vBar += Math.max(0, m2[i] - m1[i] * m1[i]);
  vBar /= h.length;
  const floor = vBar * 1e-4 + EPS;
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const v = Math.max(0, m2[i] - m1[i] * m1[i]);
    out[i] = Math.sqrt(g2[i] / (v + floor));
  }
  return out;
}

/** G — plain slope, for a field with relief but no texture. */
function estimatorG(h, g, s, r) {
  const g2 = gradSq(h, g, s);
  const out = new Float32Array(g2.length);
  for (let i = 0; i < g2.length; i++) out[i] = Math.sqrt(g2[i]);
  return boxMean(out, g, r);
}

/** H — the smoothed level itself. Not a frequency; the last resort for a field
 *  that is piecewise constant, where what survives is its level-set structure. */
function estimatorH(h, g, s, r) {
  const m = boxMean(h, g, r);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m.length; i++) { if (m[i] < lo) lo = m[i]; if (m[i] > hi) hi = m[i]; }
  const off = (hi - lo) * 1e-3 + EPS;
  const out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = (m[i] - lo) + off;
  return out;
}

// ── statistics on a subsample ───────────────────────────────────────────────
// Sorting a TypedArray uses the native numeric sort; a JS comparator on 20k
// elements measured 12 ms here, which was most of the whole rebuild.

const SUB = 8192;
const _scratch = new Float32Array(SUB);

/**
 * A subsample for the percentiles, spread by a multiplicative hash rather than
 * by a fixed stride.
 *
 * A stride is the obvious way and the wrong one here: mesh vertex buffers are
 * periodic — rings, seams, duplicated edge columns — and a stride that shares a
 * factor with that period samples the same structural position over and over.
 * In the worst case every sampled vertex sits on a seam, and the percentiles
 * describe the seam rather than the body; reordering the same geometry would
 * then change the map. Knuth's multiplicative constant is coprime with any
 * power of two and mixes the low bits, so the sample is spread over the whole
 * array while staying entirely deterministic — the same input gives the same map,
 * which presets and clip steps depend on. Found by an external review.
 */
function sortedSample(a) {
  const n = a.length;
  const take = Math.min(SUB, n);
  let m = 0;
  for (let k = 0; k < take; k++) {
    const i = (Math.imul(k, 2654435761) >>> 0) % n;
    const v = a[i];
    if (Number.isFinite(v)) _scratch[m++] = v;
  }
  const s = _scratch.subarray(0, m);
  s.sort();
  return s;
}

/** p90 − p10 — a spread that a single pole cannot dominate. */
function robustSpread(a) {
  const s = sortedSample(a);
  return s.length < 4 ? 0 : s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)];
}

function percentile(a, p) {
  const s = sortedSample(a);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
};

/**
 * Bilinear read of a lattice quantity at an analysis coordinate, edges clamped.
 *
 * Exported for the same reason radialU is: it defines WHERE a coordinate lands
 * on the lattice, and COLLAPSE now has a second chart that has to land on the
 * same cells (collapseChartToAnalysis / collapseAnalysisToChart in
 * math-collections.js). A chart whose inverse is only argued rather than
 * measured is how a map ends up describing the right field in the wrong place,
 * so tests/band-map-modes.test.js reads the round trip through THIS function
 * rather than through a second copy of its arithmetic.
 */
export function sampleLattice(a, g, extent, x, z) {
  const step = (extent * 2) / (g - 1);
  const fx = Math.min(g - 1, Math.max(0, (x + extent) / step));
  const fz = Math.min(g - 1, Math.max(0, (z + extent) / step));
  const i0 = Math.min(g - 2, Math.floor(fx)), j0 = Math.min(g - 2, Math.floor(fz));
  const tx = fx - i0, tz = fz - j0;
  const a00 = a[j0 * g + i0],     a10 = a[j0 * g + i0 + 1];
  const a01 = a[(j0 + 1) * g + i0], a11 = a[(j0 + 1) * g + i0 + 1];
  return (a00 * (1 - tx) + a10 * tx) * (1 - tz) + (a01 * (1 - tx) + a11 * tx) * tz;
}

/** The old rule, kept as a named function because it is still the fallback. */
export function radialU(x, z, R) {
  return Math.min(1, Math.sqrt(x * x + z * z) / Math.max(R, 1e-3));
}

// ── The body's own share of the coordinate ──────────────────────────────────
//
// Everything above measures the FORMULA. The body was in it only passively: it
// decided which (x, z) columns got sampled, and nothing else. So one formula on
// a gyroid and on a sphere produced two slices of the same picture rather than
// two pictures — the geometry the viewer is actually looking at had no say in
// where the music landed on it.
//
// What the body contributes is the same quantity the formula does: a local
// spatial FREQUENCY. For a surface that is a curvature, and the estimate needs
// no adjacency and no welding — the signed normal curvature along a triangle's
// edge is
//
//     k_n = ((n_i - n_j) · (v_i - v_j)) / |v_i - v_j|²
//
// and the RMS of the three is the surface's own rms wavenumber, the analogue of
// the estimator K above. For a sphere of radius R it is 1/R for any
// triangulation; for a plane, 0.
//
// ── What was measured, and what was only argued ─────────────────────────────
// Three candidates were prototyped and run over the real catalogue. Only one of
// the two rejections is backed by a measurement, and saying which is which
// matters more than the choice:
//
//   * max |Δn| / |Δv| over a triangle's edges — REJECTED BY MEASUREMENT. It
//     reports the LARGEST principal curvature, which on any tube is constant
//     along the tube: torus read 0.909 at every vertex and torusknot 1.538, a
//     p10-to-p90 range of exactly zero. Blind to the second principal direction
//     by construction.
//   * the signed MEAN curvature H — rejected on an ARGUMENT that the
//     measurements do NOT support, and the argument is left here only so that
//     nobody re-derives it and believes it. The theory says H cancels on a
//     saddle and is identically 0 on a minimal surface, so the gyroid, the
//     catenoid and the helicoid would vanish. On the catalogue's actual
//     triangulations it does not happen: discretised H is nowhere near zero,
//     |mean H| and the rms give the same set of speaking bodies, quantiles
//     within a few percent of each other, and the same spatial coherence on the
//     gyroid (edge-to-random ratio 0.66 against 0.62). The two are empirically
//     interchangeable here. The rms ships because it is the surface analogue of
//     the rms wavenumber the FORMULA's estimator K already computes, which is a
//     reason of consistency, not of measured behaviour — and no test pins the
//     difference, because there is no difference to pin.
//
// What the measurement does establish is which bodies have something to say.
// Thirteen speak — cylinder, cone, mobius, klein, catenoid, helicoid,
// hyperboloid, pseudosphere and all five implicit bodies — while plane, sphere,
// icosahedron-smooth, box and the flat-shaded polyhedra correctly say nothing.
// Torus and torusknot sit under the threshold at a p10-to-p90 range of 1.21x
// and 1.14x: a tube of those proportions really is nearly uniformly curved.
// Fatten it (r 1.1 -> 1.9 at R 2.4) and it speaks.
//
// ── What this cannot see, said plainly ──────────────────────────────────────
// A flat-shaded body — every polyhedron, sierpinski-tetra — carries one normal
// per FACE, so all three corners of a triangle agree and k is 0 everywhere. Its
// curvature lives entirely in the edges, which a per-triangle estimate cannot
// reach and which no amount of arithmetic can recover from a normal buffer that
// has thrown it away. Those bodies get no body term, which is the same answer
// they would get from a smooth estimator applied to a flat face: honest, and
// the same graceful degradation the K → G → H cascade already performs.

/** How far the body may move a point, in bands out of 24. */
export const BODY_SHIFT_BANDS = 4;

/**
 * The body's contribution to the band coordinate, per vertex, in [-1, 1].
 *
 * NORMALISED AGAINST THE BODY'S OWN SPREAD, which is the decision worth
 * defending. An absolute scale — "a tighter body listens higher" — is tempting
 * and wrong here: it would move a sphere's whole surface onto one part of the
 * spectrum and waste the other bands, which is exactly the failure the
 * histogram equalisation above exists to prevent. Normalised, a body with no
 * curvature TEXTURE contributes nothing (a sphere is equally curved everywhere,
 * and has nothing to say about where band 3 should go rather than band 19),
 * while a body whose geometry varies redistributes the layout by that variation.
 *
 * So under one formula a gyroid and a sphere differ in the way that can actually
 * be seen: the gyroid's necks and saddles pull the layout around, the sphere's
 * uniform dome leaves it to the formula. That is the honest version of "the
 * body has a say", not "every body is shifted by a constant".
 *
 * @param {Float32Array} positions  xyz per vertex, undisplaced
 * @param {Float32Array} normals    xyz per vertex, as the geometry was built
 * @param {?ArrayLike<number>} index  triangle indices, or null for a soup
 * @returns {?Float32Array} one value per vertex, or null when the body has no
 *          curvature texture to report — a plane, a flat-shaded polyhedron, a
 *          geometry with no triangles.
 */
export function buildBodyCurvature(positions, normals, index) {
  if (!positions || !normals || positions.length !== normals.length) return null;
  const V = positions.length / 3;
  if (!(V > 2)) return null;
  const tri = index && index.length >= 3 ? index : null;
  const T = tri ? Math.floor(tri.length / 3) : Math.floor(V / 3);
  if (!(T > 0)) return null;

  const sum = new Float32Array(V), cnt = new Float32Array(V);
  const at = (t, c) => (tri ? tri[t * 3 + c] : t * 3 + c);
  for (let t = 0; t < T; t++) {
    const a = at(t, 0), b = at(t, 1), c = at(t, 2);
    if (a >= V || b >= V || c >= V) continue;
    let acc = 0, m = 0;
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const dnx = normals[i * 3]     - normals[j * 3];
      const dny = normals[i * 3 + 1] - normals[j * 3 + 1];
      const dnz = normals[i * 3 + 2] - normals[j * 3 + 2];
      const dvx = positions[i * 3]     - positions[j * 3];
      const dvy = positions[i * 3 + 1] - positions[j * 3 + 1];
      const dvz = positions[i * 3 + 2] - positions[j * 3 + 2];
      const l2 = dvx * dvx + dvy * dvy + dvz * dvz;
      // A degenerate edge divides by nothing and would report an infinite
      // curvature — marching cubes produces them wherever the surface grazes a
      // lattice node, and one such vertex would take a whole band with it.
      if (!(l2 > 1e-12)) continue;
      const kn = (dnx * dvx + dny * dvy + dnz * dvz) / l2;
      if (Number.isFinite(kn)) { acc += kn * kn; m++; }
    }
    if (!m) continue;
    // The rms over the triangle's own directions, spread to its corners.
    // Squared first: signed curvatures of opposite sign would otherwise cancel,
    // and a saddle is precisely where they do.
    const r = Math.sqrt(acc / m);
    sum[a] += r; cnt[a]++;
    sum[b] += r; cnt[b]++;
    sum[c] += r; cnt[c]++;
  }

  const k = new Float32Array(V);
  for (let i = 0; i < V; i++) k[i] = cnt[i] > 0 ? sum[i] / cnt[i] : 0;

  // Log space and a RELATIVE floor, for the same reason the cascade uses them:
  // curvature is a ratio quantity, and a floor in absolute units would make the
  // answer depend on how big the body happens to be built.
  const hi = percentile(k, 0.9);
  if (!(hi > 0)) return null;                 // a plane, or a flat-shaded soup
  const flr = hi * 0.01;
  const e = new Float32Array(V);
  for (let i = 0; i < V; i++) e[i] = Math.log((k[i] > 0 ? k[i] : 0) + flr);

  const spread = robustSpread(e);
  // The same two thresholds the cascade uses for "how much has this stage to
  // say", on the same quantity in the same units, and a smoothstep rather than a
  // cut: at a hard boundary a body whose spread sat on the line would flip
  // between two layouts on a parameter nobody touched. Measured over the
  // catalogue this leaves torus at 0.189 and torusknot at 0.133 contributing
  // essentially nothing, and the gyroid at 1.93 contributing in full.
  const say = smoothstep(0.25, 0.9, spread);
  if (!(say > 0.001) || !(spread > 1e-9)) return null;
  const mid = percentile(e, 0.5);
  const out = new Float32Array(V);
  for (let i = 0; i < V; i++) {
    const v = (e[i] - mid) / spread;
    out[i] = say * (v < -1 ? -1 : v > 1 ? 1 : v);
  }
  return out;
}

/**
 * The one law both paths apply, so that "the body has a say" means the same
 * thing on the CPU and in the shader.
 *
 * The two paths build their base coordinate differently and always have — the
 * CPU equalises a cascade over the body's vertices, the shader reads a clamped
 * log-ratio of two finite differences — and neither is convertible into the
 * other. What IS shared is the measurement (one buildBodyCurvature, uploaded
 * once as an attribute and passed once to buildBandMap) and this law, which is
 * why it is written here in one place and mirrored in bandTermOfMode by name.
 *
 * The cost of applying it after the coordinate is formed, stated rather than
 * hidden: on the CPU the histogram above hands every band an equal share of the
 * surface, and a shift applied afterwards perturbs that. Bounded at four bands
 * of twenty-four it redistributes rather than collapses — but "every band gets
 * an equal share" becomes "every band gets a share", and the test that measures
 * it is written to the weaker claim on purpose.
 */
export function applyBodyShift(u, bodyK) {
  const s = BODY_SHIFT_BANDS / 23;
  const v = u + s * bodyK;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Build the band coordinate for every vertex of a body.
 *
 * @param {Float32Array} field   the formula sampled on a g×g lattice at a FIXED
 *                               reference time — see the note on freezing below
 * @param {number} g             lattice size (ANALYSIS_GRID)
 * @param {number} extent        half-width the lattice covers, in world units
 * @param {{x: Float32Array, z: Float32Array, R: number, k: ?Float32Array,
 *          ax: ?Float32Array, az: ?Float32Array}} verts
 *        k is the body's own curvature term from buildBodyCurvature, in
 *        [-1, 1], or null/absent for a body that has no curvature texture.
 *
 *        ax/az are the ANALYSIS coordinates — where each vertex sits in the
 *        chart `field` was sampled over — and they default to x/z, which is
 *        what SURFACE mode wants: it reads the formula as a height field over
 *        (x, z), so the lattice and the body share one coordinate system.
 *        COLLAPSE does not. It reads the same kernel as f(theta, phi) about the
 *        body's centroid, so its lattice is that chart and a vertex's place in
 *        it is its own (theta, phi) — see MathVisualizer._rebuildBandMap. The
 *        world (x, z) stay in verts because three things still need them and
 *        none of them is the chart: the radius rule (the fallback, the
 *        tie-break, and the low-confidence blend below), the gesture's rr, and
 *        the stereo tilt in bandRingValue. Passing the chart for those instead
 *        would move the rings off the body and onto an abstraction of it.
 * @returns {{u: Float32Array, r: Float32Array, tb: Float32Array, conf: number,
 *            stages: string[], body: boolean}}
 *          u ∈ [0,1] per vertex — multiply by 23 to get the band;
 *          r and tb are the two time-independent halves of the gesture (the
 *          vertex's radius and the turbulence sampled there), precomputed here
 *          so the per-frame path multiplies rather than evaluates trigonometry.
 *          Measured: 25.2 ms per frame on 196 608 vertices with the noise live
 *          against 4.6 ms with it cached.
 *
 * ── Why the field is frozen ──────────────────────────────────────────────────
 * The map is built once per formula/shape change from the field at a fixed
 * reference time, not from the live one. Two reasons, and the second is the one
 * that would not have been obvious:
 *   1. A map recomputed every frame crawls: the layout would slide across the
 *      surface while the music plays through it.
 *   2. The formula READS the audio parameters (amp and freq are audio-driven).
 *      A live map would let the sound choose which sound it is modulated by —
 *      a feedback loop, and one that would be very hard to read as a bug.
 *
 * ── And why it is not merely SLOWED, which is the obvious next idea ──────────
 * "Rebuild every few seconds and crossfade" was the standing proposal. It is
 * measured and it does not work, and the numbers are worth keeping because the
 * idea is an easy one to have twice.
 *
 * How far the layout moves when the reference time moves, on a 161² plane under
 * one formula, in bands of 24:
 *
 *     +0.1 s  0.33     +1 s  2.67     +4 s  8.65
 *     +0.5 s  1.41     +2 s  4.90     +8 s  9.60
 *
 * So the two ends of the idea fail for opposite reasons. A step small enough to
 * read as a breath (0.1 s, a third of a band) needs ten rebuilds a second, and
 * one rebuild costs 4.8 ms on the gyroid and 17.1 ms on a 196 608-vertex body —
 * synchronous, on the frame path, so that is 170 ms of every second spent
 * relaying the map. A step cheap enough to afford moves the layout by three to
 * nine bands, which is not a breath; it is the whole spectrum changing places.
 *
 * Two further costs, neither of them about frames. The layout would stop being
 * reproducible, and presets and clip steps depend on the same formula drawing
 * the same picture. And the colour tint's photosensitivity argument rests on
 * vBandU being static — a map that breathed would make it periodic, and the
 * guard in tests/colour-ramp.test.js checks the tint's FORM, not its motion, so
 * that sentence would quietly stop being true with every test green.
 *
 * ── Where this still degrades to rings, honestly ─────────────────────────────
 * Four kernels of 192 (rule184, langtonAnt, wiredFire, sandpile) have no local
 * frequency anywhere and fall through the whole cascade. A genuinely radial
 * function (Bessel J0) lands 0.91 of the way to the radius rule — and that is
 * the right answer, not a failure: it really is a function of r alone.
 */
export function buildBandMap(field, g, extent, verts) {
  const V = verts.x.length;
  const u = new Float32Array(V);
  const stages = [];
  const s = (extent * 2) / (g - 1);

  // The gesture's time-independent halves, filled for every path out of here.
  const rr = new Float32Array(V), tb = new Float32Array(V);
  for (let i = 0; i < V; i++) {
    const x = verts.x[i], z = verts.z[i];
    rr[i] = Math.sqrt(x * x + z * z);
    tb[i] = motionTurb(x * 3.5, z * 3.5);
  }
  const fallbackToRadius = () => {
    for (let i = 0; i < V; i++) u[i] = radialU(verts.x[i], verts.z[i], verts.R);
    // No body term here, deliberately. This is the path a formula with no
    // structure takes, and the promise it carries is that the layer degrades
    // into exactly the rings that shipped before the map existed — a body shift
    // on top of that would be a new picture in the one place the code promises
    // an old one. The body speaks when the formula does.
    return { u, r: rr, tb, conf: 0, stages: ['radius'], body: false };
  };
  if (!field || !field.length || !V) return fallbackToRadius();

  // The cascade, in log space. Spatial frequency is a ratio quantity, so ranking
  // it linearly would let one sharp cliff swamp everything gentler.
  const acc = new Float32Array(g * g);
  let conf = 0;
  for (const [name, fn] of [['K', estimatorK], ['G', estimatorG], ['H', estimatorH]]) {
    if (conf >= 0.999) break;
    const raw = fn(field, g, s, BOX_R);
    // A formula that returns NaN or Infinity somewhere (a pole, a domain edge)
    // contaminates its whole box neighbourhood. Those cells are counted, and if
    // there are enough of them the stage is refused outright rather than having
    // its non-finite cells quietly become the estimator's minimum — which is
    // what happened before, and which turned an invalid region into a coherent
    // band stripe that looked deliberate. Found by an external review.
    let bad = 0;
    for (let i = 0; i < raw.length; i++) if (!Number.isFinite(raw[i])) bad++;
    if (bad > raw.length * 0.02) continue;
    // A soft floor in the estimator's own units: an exactly flat patch makes the
    // estimator 0, and log(0) would hand the whole range to one degenerate value.
    // The floor has to stay RELATIVE to the estimator, or the map starts
    // depending on the formula's amplitude rather than on its shape. A
    // piecewise-flat field has a zero median — more than half its slopes are
    // exactly zero — and falling back to an absolute 1 there meant the same
    // spatial pattern at 1e-3 and at 1e3 produced different maps. The 90th
    // percentile is the scale of what the estimator DID find.
    const med = percentile(raw, 0.5);
    const scale = Number.isFinite(med) && med > 0 ? med : percentile(raw, 0.9);
    const flr = (Number.isFinite(scale) && scale > 0 ? scale : 1) * 0.01;
    const e = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      e[i] = Math.log((Number.isFinite(v) && v > 0 ? v : 0) + flr);
    }
    const spread = robustSpread(e);
    // How much this stage has to say, in NATURAL logs — not decades, which is
    // what an earlier version of this comment claimed. 0.25 is a factor of 1.28
    // between the 10th and 90th percentile of local frequency, which is noise;
    // 0.9 is a factor of 2.46, which is a real range of scales. Measured over
    // the catalogue those thresholds put 3 formulas of 12 at full confidence on
    // K alone and leave the rest to the cascade, which is the intended shape.
    const stageConf = smoothstep(0.25, 0.9, spread);
    if (stageConf <= 0.001) continue;
    const w = (1 - conf) * stageConf / (spread + 1e-9);
    for (let i = 0; i < acc.length; i++) acc[i] += w * e[i];
    conf = conf + (1 - conf) * stageConf;
    stages.push(name);
  }
  if (conf <= 0.001) return fallbackToRadius();

  // Sample the accumulated ranking where the body's vertices actually are, then
  // equalise over THOSE vertices — so every band gets the same share of the
  // surface no matter how the field's values are distributed.
  //
  // "Where they are" means where they are IN THE CHART the field was sampled
  // over, which is x/z for a height field and (theta, phi) for COLLAPSE. Same
  // arrays when the caller passes neither, so the surface path is unchanged.
  const ax = (verts.ax && verts.ax.length === V) ? verts.ax : verts.x;
  const az = (verts.az && verts.az.length === V) ? verts.az : verts.z;
  const eV = new Float32Array(V);
  for (let i = 0; i < V; i++) eV[i] = sampleLattice(acc, g, extent, ax[i], az[i]);

  const lo = percentile(eV, 0.005), hi = percentile(eV, 0.995);
  const span = hi - lo;
  if (!(span > 1e-9)) return fallbackToRadius();

  // Radius is the tie-break, and it is what rescues the bodies with no interior.
  // On `circle` every vertex sits at one radius and on `tetrahedron` there are
  // twelve of them; without a second key they would all land on one band. The
  // weight is a thousandth of the span, so it orders only what the estimator
  // calls equal.
  const tie = span * 1e-3;
  for (let i = 0; i < V; i++) eV[i] += tie * radialU(verts.x[i], verts.z[i], verts.R);

  const hist = new Int32Array(BINS);
  const bin = new Int32Array(V);
  const kb = (BINS - 1) / (span + tie);
  for (let i = 0; i < V; i++) {
    let b = Math.round((eV[i] - lo) * kb);
    if (!(b >= 0)) b = 0; else if (b > BINS - 1) b = BINS - 1;
    bin[i] = b; hist[b]++;
  }
  const cdf = new Float32Array(BINS);
  let run = 0;
  for (let b = 0; b < BINS; b++) { const c = hist[b]; cdf[b] = (run + c * 0.5) / V; run += c; }

  // Blend toward the radius rule by confidence: a field the cascade barely
  // understood keeps most of the old behaviour rather than inventing structure.
  //
  // The body's shift is applied LAST, to the finished coordinate, because that
  // is the only form the shader also has — see applyBodyShift. A body with no
  // curvature texture (a plane, a flat-shaded polyhedron, a uniform sphere)
  // hands back null and this loop is bit-for-bit what it was.
  const bk = verts.k && verts.k.length === V ? verts.k : null;
  for (let i = 0; i < V; i++) {
    const mapped = cdf[bin[i]];
    const base = conf * mapped + (1 - conf) * radialU(verts.x[i], verts.z[i], verts.R);
    u[i] = bk ? applyBodyShift(base, bk[i]) : base;
  }
  return { u, r: rr, tb, conf, stages, body: !!bk };
}

/**
 * The same four-harmonic turbulence src/shaders.js uses, term for term. Sampled
 * once per vertex per map: it depends on position only, because time enters the
 * gesture as a phase rather than as a spatial slide.
 *
 * Four PLANE WAVES, each with its own direction and phase — not the separable
 * sum |sin(px*i) * cos(pz*i)| / i this used to be. That spelling put a kink
 * (from the abs) on lines that ran along X and Z (from the separability), and a
 * kink in the height is a jump in the normal: on a mirror finish the band layer
 * drew a rectangular GRID over the body, at pitch pi/3.5 and its harmonics,
 * identical under every formula and every shape, brightening with the music
 * because the whole gesture scales with the band. The full reasoning and the
 * numbers are in the comment on turb() in src/shaders.js — this is the CPU half
 * of the same expression and the two must not drift.
 */
function motionTurb(px, pz) {
  let t = 0;
  for (let i = 1; i < 5; i++) {
    const a = i * 1.7 + 0.4;
    t += Math.sin((px * Math.cos(a) + pz * Math.sin(a)) * i + i * 2.3) / i;
  }
  return t * 0.408 + 0.846;
}
