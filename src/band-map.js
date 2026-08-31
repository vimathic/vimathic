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
function sortedSample(a) {
  const step = Math.max(1, Math.ceil(a.length / SUB));
  let m = 0;
  for (let i = 0; i < a.length; i += step) { const v = a[i]; if (Number.isFinite(v)) _scratch[m++] = v; }
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

/** Bilinear read of a lattice quantity at a world (x, z), edges clamped. */
function sampleLattice(a, g, extent, x, z) {
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

/**
 * Build the band coordinate for every vertex of a body.
 *
 * @param {Float32Array} field   the formula sampled on a g×g lattice at a FIXED
 *                               reference time — see the note on freezing below
 * @param {number} g             lattice size (ANALYSIS_GRID)
 * @param {number} extent        half-width the lattice covers, in world units
 * @param {{x: Float32Array, z: Float32Array, R: number}} verts
 * @returns {{u: Float32Array, r: Float32Array, tb: Float32Array, conf: number, stages: string[]}}
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
    return { u, r: rr, tb, conf: 0, stages: ['radius'] };
  };
  if (!field || !field.length || !V) return fallbackToRadius();

  // The cascade, in log space. Spatial frequency is a ratio quantity, so ranking
  // it linearly would let one sharp cliff swamp everything gentler.
  const acc = new Float32Array(g * g);
  let conf = 0;
  for (const [name, fn] of [['K', estimatorK], ['G', estimatorG], ['H', estimatorH]]) {
    if (conf >= 0.999) break;
    const raw = fn(field, g, s, BOX_R);
    // A soft floor in the estimator's own units: an exactly flat patch makes the
    // estimator 0, and log(0) would hand the whole range to one degenerate value.
    const med = percentile(raw, 0.5);
    const flr = (Number.isFinite(med) && med > 0 ? med : 1) * 0.01;
    const e = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      e[i] = Math.log((Number.isFinite(v) && v > 0 ? v : 0) + flr);
    }
    const spread = robustSpread(e);
    // How much this stage has to say. Below 0.25 of a decade it is noise; above
    // 0.9 it is a genuine range of scales.
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
  const eV = new Float32Array(V);
  for (let i = 0; i < V; i++) eV[i] = sampleLattice(acc, g, extent, verts.x[i], verts.z[i]);

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
  for (let i = 0; i < V; i++) {
    const mapped = cdf[bin[i]];
    u[i] = conf * mapped + (1 - conf) * radialU(verts.x[i], verts.z[i], verts.R);
  }
  return { u, r: rr, tb, conf, stages };
}

/**
 * The same four-harmonic turbulence src/shaders.js uses, term for term. Sampled
 * once per vertex per map: it depends on position only, because time enters the
 * gesture as a phase rather than as a spatial slide.
 */
function motionTurb(px, pz) {
  let t = 0;
  for (let i = 1; i < 5; i++) t += Math.abs(Math.sin(px * i) * Math.cos(pz * i)) / i;
  return t;
}
