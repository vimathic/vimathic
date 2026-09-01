// tests/band-body-curvature.test.js
//
// The body's own say in where the music lands. Until this, the band coordinate
// was a function of (x, z) alone: the FORMULA decided everything, and the shape
// it was drawn on only chose which columns of that decision got sampled. One
// formula on a gyroid and on a sphere gave two slices of one picture.
//
// Run:
//   node --test tests/band-body-curvature.test.js
//
// ── What is easy to get wrong here, and is therefore what is pinned ──────────
// Not "is the curvature right" — a curvature that is 10 % off still looks like a
// layout. The three things that would be silent:
//
//   1. A body with no curvature TEXTURE must be untouched, to the bit. A sphere
//      is equally curved everywhere and has nothing to say about which band goes
//      where; a shift applied to it anyway would move every existing shape's
//      picture for no reason at all.
//   2. The shift must stay bounded. Unbounded, the geometry would take the
//      layout over from the formula and the feature would have replaced the
//      thing it was meant to modulate.
//   3. The CPU and the GPU must apply the SAME law with the SAME constant. They
//      are never both on screen in one frame, so nothing in the product would
//      show it if they drifted — the body would simply be laid out differently
//      depending on a mode the user was not thinking about.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBodyCurvature, buildBandMap, applyBodyShift, BODY_SHIFT_BANDS, ANALYSIS_GRID,
} from '../src/band-map.js';
import { generateSurfaceFromFormula, FIELD_EXTENT } from '../src/math-collections.js';
import { BAND_COUNT } from '../src/audio.js';
import * as PARAMETRIC from '../src/parametric-surfaces.js';
import { BAND_MAP_REF_TIME } from '../src/math-visualizer.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHADER_SRC = readFileSync(path.join(ROOT, 'src/shaders.js'), 'utf8');

// ── Meshes built here rather than imported ──────────────────────────────────
// A synthetic grid is the only way to know what the answer SHOULD be: the
// catalogue's geometries are the subject, not the yardstick.

/**
 * A (n+1)² grid over [-3.5, 3.5]², lifted by h(x, z), with analytic normals from
 * the partial derivatives — not computeVertexNormals, whose own smoothing would
 * be part of what is measured.
 */
function grid(n, h, dh) {
  const V = (n + 1) * (n + 1);
  const P = new Float32Array(V * 3), N = new Float32Array(V * 3);
  const idx = [];
  const s = 7 / n;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -3.5 + i * s, z = -3.5 + j * s, v = (j * (n + 1) + i) * 3;
      P[v] = x; P[v + 1] = h(x, z); P[v + 2] = z;
      const [hx, hz] = dh(x, z);
      const len = Math.hypot(-hx, 1, -hz);
      N[v] = -hx / len; N[v + 1] = 1 / len; N[v + 2] = -hz / len;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { P, N, idx: Uint32Array.from(idx), V };
}

const FLAT   = () => grid(40, () => 0, () => [0, 0]);
// z = x² − y² : a saddle whose curvature grows with distance from the centre,
// so it has both a shape and a TEXTURE of shapes — the case the feature is for.
const SADDLE = () => grid(40, (x, z) => 0.18 * (x * x - z * z),
                              (x, z) => [0.36 * x, -0.36 * z]);
// A sphere cap, analytic: equally curved everywhere, so it must say nothing.
const CAP    = () => grid(40, (x, z) => {
  const r2 = x * x + z * z, R = 8;
  return R - Math.sqrt(Math.max(R * R - r2, 1e-6));
}, (x, z) => {
  const r2 = x * x + z * z, R = 8, d = Math.sqrt(Math.max(R * R - r2, 1e-6));
  return [x / d, z / d];
});

const curvOf = m => buildBodyCurvature(m.P, m.N, m.idx);

/**
 * One real body from the catalogue, for the two claims a synthetic grid cannot
 * carry: that the clamp actually fires somewhere, and that the result is
 * spatially structured rather than per-vertex noise. Everything else here stays
 * synthetic, because for those the expected answer has to be known in advance.
 */
let CATENOID = null;
function buildCatenoid() {
  if (CATENOID) return CATENOID;
  const geo = PARAMETRIC.buildCatenoidGeo();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal;
  const P = new Float32Array(p.count * 3), N = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    P[i * 3] = p.getX(i); P[i * 3 + 1] = p.getY(i); P[i * 3 + 2] = p.getZ(i);
    N[i * 3] = n.getX(i); N[i * 3 + 1] = n.getY(i); N[i * 3 + 2] = n.getZ(i);
  }
  CATENOID = { P, N, idx: geo.index.array, V: p.count };
  return CATENOID;
}

// ── What this file deliberately does NOT pin ────────────────────────────────
// The choice between the rms curvature that ships and the signed mean curvature
// H. Both were run over the catalogue and they are empirically interchangeable
// on it — same set of speaking bodies, quantiles within a few percent, the same
// spatial coherence — so there is no measurement to write a guard against, and a
// guard that only checked the SPELLING of the expression would be reporting on
// itself. The reasoning is in the comment on buildBodyCurvature; the hole is
// named here rather than left for someone to discover.

describe('what the body reports about itself', () => {
  test('a flat sheet has nothing to say', () => {
    assert.ok(curvOf(FLAT()) === null,
      'a plane reported a curvature texture — every flat shape in the catalogue would move');
  });

  test('a uniformly curved cap has nothing to say either, and that is the harder case', () => {
    // Not zero curvature — 1/8 everywhere. The claim is about VARIATION: a body
    // that is equally curved everywhere cannot prefer band 3 over band 19, and
    // normalising its constant curvature into a shift would move its whole
    // surface onto one part of the spectrum and waste the other bands.
    assert.ok(curvOf(CAP()) === null,
      'a uniformly curved body was given a body term');
  });

  test('a saddle does, and its values stay inside [-1, 1]', () => {
    const k = curvOf(SADDLE());
    assert.ok(k !== null, 'a saddle with growing curvature reported nothing');
    let lo = Infinity, hi = -Infinity, bad = 0;
    for (let i = 0; i < k.length; i++) {
      if (!Number.isFinite(k[i])) { bad++; continue; }
      if (k[i] < lo) lo = k[i];
      if (k[i] > hi) hi = k[i];
    }
    assert.equal(bad, 0, `${bad} vertices carry a non-finite curvature`);
    assert.ok(lo >= -1 && hi <= 1, `values run ${lo.toFixed(3)}..${hi.toFixed(3)}, outside [-1, 1]`);
    assert.ok(hi - lo > 0.2,
      `the whole body reports ${(hi - lo).toFixed(3)} of range — that is not a texture`);
  });

  test('a flat-shaded soup reports nothing, which is the honest answer', () => {
    // Every polyhedron in the catalogue is non-indexed with one normal per FACE,
    // so all three corners of a triangle agree and no edge turns. The curvature
    // is in the edges, which a normal buffer that has thrown it away cannot be
    // asked about. Saying so beats inventing a number.
    const m = SADDLE();
    const P = new Float32Array(m.idx.length * 3), N = new Float32Array(m.idx.length * 3);
    for (let t = 0; t < m.idx.length / 3; t++) {
      // Face normal from the three positions, written to all three corners.
      const a = m.idx[t * 3], b = m.idx[t * 3 + 1], c = m.idx[t * 3 + 2];
      const ux = m.P[b * 3] - m.P[a * 3], uy = m.P[b * 3 + 1] - m.P[a * 3 + 1], uz = m.P[b * 3 + 2] - m.P[a * 3 + 2];
      const vx = m.P[c * 3] - m.P[a * 3], vy = m.P[c * 3 + 1] - m.P[a * 3 + 1], vz = m.P[c * 3 + 2] - m.P[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      for (let c2 = 0; c2 < 3; c2++) {
        const src = m.idx[t * 3 + c2], dst = t * 3 + c2;
        P[dst * 3] = m.P[src * 3]; P[dst * 3 + 1] = m.P[src * 3 + 1]; P[dst * 3 + 2] = m.P[src * 3 + 2];
        N[dst * 3] = nx / l; N[dst * 3 + 1] = ny / l; N[dst * 3 + 2] = nz / l;
      }
    }
    assert.ok(buildBodyCurvature(P, N, null) === null,
      'a flat-shaded soup was given a curvature its normals do not contain');
  });

  test('a real body with a long tail is CLAMPED, and the clamp binds', () => {
    // The synthetic saddle above never reaches the clamp, so on its own it
    // cannot tell a bounded output from an unbounded one — measured: removing
    // the clamp left every assertion in this file green. The catenoid does
    // reach it, at both ends, which is what makes this the test that says the
    // bound exists. An unbounded body term would take the layout over from the
    // formula on exactly the bodies this feature is for.
    const g = buildCatenoid();
    const k = buildBodyCurvature(g.P, g.N, g.idx);
    assert.ok(k !== null, 'the catenoid reported no curvature texture');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < k.length; i++) { if (k[i] < lo) lo = k[i]; if (k[i] > hi) hi = k[i]; }
    assert.ok(lo >= -1 && hi <= 1, `the catenoid runs ${lo.toFixed(3)}..${hi.toFixed(3)}`);
    assert.ok(lo <= -0.999 || hi >= 0.999,
      `the catenoid tops out at ${lo.toFixed(3)}..${hi.toFixed(3)}, so the clamp never fires here ` +
      'and this test proves nothing about it');
  });

  test('the body term is structure, not dither', () => {
    // A curvature that came out as per-vertex noise would still pass every
    // threshold above and would still "speak" — and on screen it would be a
    // layout dithered at the mesh's own resolution rather than one that follows
    // the geometry. Neighbours on an edge have to agree more than two vertices
    // picked at random do. Measured on the shipped estimator: 0.62 on the
    // gyroid, 0.48 on schwarz-p, 0.07 on the catenoid; 1.0 would be noise.
    const g = buildCatenoid();
    const k = buildBodyCurvature(g.P, g.N, g.idx);
    let edge = 0, ec = 0;
    for (let t = 0; t < g.idx.length; t += 3) {
      const a = g.idx[t], b = g.idx[t + 1], c = g.idx[t + 2];
      edge += Math.abs(k[a] - k[b]) + Math.abs(k[b] - k[c]) + Math.abs(k[c] - k[a]);
      ec += 3;
    }
    let rnd = 0;
    const RC = 20000;
    for (let n = 0; n < RC; n++) {
      const i = (Math.imul(n, 2654435761) >>> 0) % g.V;
      const j = (Math.imul(n + 7919, 40503) >>> 0) % g.V;
      rnd += Math.abs(k[i] - k[j]);
    }
    const ratio = (edge / ec) / (rnd / RC);
    assert.ok(rnd / RC > 1e-6, 'the random pairs all agree, so the ratio measures nothing');
    assert.ok(ratio < 0.5,
      `neighbours differ ${ratio.toFixed(3)} as much as random pairs do — at 1.0 the body term ` +
      'is noise, and the layout would be dithered rather than shaped');
  });

  test('degenerate input is refused rather than propagated', () => {
    assert.ok(buildBodyCurvature(null, null, null) === null);
    assert.ok(buildBodyCurvature(new Float32Array(9), new Float32Array(6), null) === null,
      'mismatched lengths were accepted');
    // A collapsed triangle divides by an edge of length zero. Marching cubes
    // makes these wherever the surface grazes a lattice node, and one infinite
    // curvature would take a whole band with it.
    const P = new Float32Array(9), N = new Float32Array(9);
    for (let i = 0; i < 3; i++) N[i * 3 + 1] = 1;
    assert.ok(buildBodyCurvature(P, N, null) === null,
      'a degenerate triangle produced a curvature instead of nothing');
  });
});

// ── The law ─────────────────────────────────────────────────────────────────

describe('the shift is bounded, and bounded by one number', () => {
  test('it moves a coordinate by at most BODY_SHIFT_BANDS of the range', () => {
    const s = BODY_SHIFT_BANDS / (BAND_COUNT - 1);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      for (const k of [-1, -0.5, 0, 0.5, 1]) {
        const v = applyBodyShift(u, k);
        assert.ok(v >= 0 && v <= 1, `u=${u} k=${k} left the range at ${v}`);
        assert.ok(Math.abs(v - u) <= s + 1e-9,
          `u=${u} k=${k} moved by ${Math.abs(v - u).toFixed(4)}, past the ${s.toFixed(4)} bound`);
      }
    }
    assert.equal(applyBodyShift(0.5, 0), 0.5, 'a body with nothing to say still moved the coordinate');
  });

  test('four bands of twenty-four is what the constant says', () => {
    assert.equal(BODY_SHIFT_BANDS, 4);
    assert.ok(Math.abs(applyBodyShift(0.5, 1) - (0.5 + 4 / 23)) < 1e-9);
  });

  test('the shader carries the identical constant, spelled as a ratio', () => {
    // The two paths build their base coordinate differently and cannot be
    // compared value for value. What CAN drift silently is the size of the
    // body's say, so that is compared directly — and as the same ratio of two
    // integers rather than as a decimal, so a reader can see it is 4 of 23
    // rather than a number somebody tuned.
    const m = SHADER_SRC.match(/u\s*=\s*clamp\s*\(\s*u\s*\+\s*\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\)\s*\*\s*bodyK/);
    assert.ok(m, 'bandTermOfMode no longer applies the body shift as (n / m) * bodyK');
    assert.equal(Number(m[1]), BODY_SHIFT_BANDS,
      `the shader shifts by ${m[1]} bands, band-map.js by ${BODY_SHIFT_BANDS}`);
    assert.equal(Number(m[2]), BAND_COUNT - 1,
      `the shader divides by ${m[2]}, but there are ${BAND_COUNT} bands`);
  });

  test('both paths sample the formula at the SAME instant', () => {
    // BAND_T in the shader and BAND_MAP_REF_TIME in the visualiser are the same
    // number by intent and were unrelated literals in fact — four of them, once
    // the two test files are counted, and nothing compared any pair. Changing
    // either one alone turned no test red, and the symptom would have been the
    // CPU and GPU laying the spectrum out from two different frames of one
    // formula: visible only by switching math mode, and not something a viewer
    // would connect to a number in a shader.
    const m = SHADER_SRC.match(/const float BAND_T = ([\d.]+);/);
    assert.ok(m, 'bandCoordOfMode no longer pins the clock at a named constant');
    assert.equal(Number(m[1]), BAND_MAP_REF_TIME,
      `the shader samples at t = ${m[1]} and the CPU map at t = ${BAND_MAP_REF_TIME}`);
  });

  test('the shader passes the body attribute, and not something audio-driven', () => {
    // The whole map is frozen at a reference time and its audio arguments are
    // pinned, so that the sound cannot choose which sound it is modulated by.
    // A live value in this argument would reopen exactly that loop.
    // The fifth argument, whatever comes after it. A sixth was added for the
    // colour tint's out-parameter, and the guard is about which value decides
    // where a vertex listens — not about how many arguments the call has.
    assert.match(SHADER_SRC, /bandTermOfMode\(pos\.xz,\s*a,\s*wi,\s*T,\s*aBodyK\s*[,)]/,
      'the GPU call no longer hands bandTermOfMode the body attribute');
    assert.match(SHADER_SRC, /attribute float aBodyK;/,
      'aBodyK is not declared in VS — the program would not link');
  });
});

// ── Where it lands: the map ─────────────────────────────────────────────────

const FIELD = generateSurfaceFromFormula(
  (x, z) => Math.sin(x * 1.7) * Math.cos(z * 1.3) + 0.35 * Math.sin(x * 5.1),
  { amp: 1, freq: 1, comp: 0.5 }, ANALYSIS_GRID, FIELD_EXTENT, BAND_MAP_REF_TIME);

function mapOf(mesh, withBody) {
  const V = mesh.V;
  const x = new Float32Array(V), z = new Float32Array(V);
  for (let i = 0; i < V; i++) { x[i] = mesh.P[i * 3]; z[i] = mesh.P[i * 3 + 2]; }
  const k = withBody ? curvOf(mesh) : null;
  return buildBandMap(FIELD, ANALYSIS_GRID, FIELD_EXTENT, { x, z, R: 3.5, k });
}

describe('the body reaches the layout, and only where it has something to say', () => {
  test('a plane and a cap are bit-for-bit what they were', () => {
    for (const [name, make] of [['plane', FLAT], ['sphere cap', CAP]]) {
      const m = make();
      const a = mapOf(m, false), b = mapOf(m, true);
      assert.equal(b.body, false, `${name} reports a body term`);
      let differing = 0;
      for (let i = 0; i < a.u.length; i++) if (!Object.is(a.u[i], b.u[i])) differing++;
      assert.equal(differing, 0,
        `${name}: ${differing} of ${a.u.length} vertices moved on a body with no curvature texture`);
    }
  });

  test('a saddle moves, by about a band', () => {
    const m = SADDLE();
    const a = mapOf(m, false), b = mapOf(m, true);
    assert.equal(b.body, true, 'the saddle contributed nothing');
    let sum = 0, worst = 0;
    for (let i = 0; i < a.u.length; i++) {
      const d = Math.abs(a.u[i] - b.u[i]);
      sum += d; if (d > worst) worst = d;
    }
    const meanBands = (sum / a.u.length) * (BAND_COUNT - 1);
    assert.ok(meanBands > 0.3,
      `the body moved the layout by ${meanBands.toFixed(3)} bands on average — not enough to see`);
    assert.ok(worst * (BAND_COUNT - 1) <= BODY_SHIFT_BANDS + 1e-6,
      `one vertex moved ${(worst * (BAND_COUNT - 1)).toFixed(2)} bands, past the bound`);
  });

  test('every band still gets a share of the surface', () => {
    // The equalisation hands out equal shares BEFORE the shift; afterwards the
    // claim is the weaker one, and it is written weaker on purpose rather than
    // being quietly dropped.
    const b = mapOf(SADDLE(), true);
    const hist = new Int32Array(BAND_COUNT);
    for (let i = 0; i < b.u.length; i++) {
      hist[Math.min(BAND_COUNT - 1, Math.max(0, Math.round(b.u[i] * (BAND_COUNT - 1))))]++;
    }
    let used = 0;
    for (let i = 0; i < BAND_COUNT; i++) if (hist[i] >= b.u.length * 0.005) used++;
    assert.ok(used >= 16,
      `only ${used} of ${BAND_COUNT} bands carry half a percent of the surface — the shift ` +
      'collapsed the layout instead of redistributing it');
  });

  test('two different bodies under ONE formula now differ more than before', () => {
    // The feature, stated as the thing a viewer would notice. The bodies do not
    // share vertices, so they are compared as distributions over the 24 bands;
    // the control is the same comparison with the body term switched off.
    const A = SADDLE();
    const B = grid(40, (x, z) => 0.10 * Math.sin(x * 1.1) * Math.sin(z * 1.1) * (x * x + z * z) * 0.15,
                       (x, z) => {
                         const e = 0.001;
                         const f = (X, Z) => 0.10 * Math.sin(X * 1.1) * Math.sin(Z * 1.1) * (X * X + Z * Z) * 0.15;
                         return [(f(x + e, z) - f(x - e, z)) / (2 * e), (f(x, z + e) - f(x, z - e)) / (2 * e)];
                       });
    const dist = (m1, m2, withBody) => {
      const h = m => {
        const u = mapOf(m, withBody).u;
        const g = new Float64Array(BAND_COUNT);
        for (let i = 0; i < u.length; i++) {
          g[Math.min(BAND_COUNT - 1, Math.max(0, Math.round(u[i] * (BAND_COUNT - 1))))]++;
        }
        for (let i = 0; i < BAND_COUNT; i++) g[i] /= u.length;
        return g;
      };
      const g1 = h(m1), g2 = h(m2);
      let s = 0;
      for (let i = 0; i < BAND_COUNT; i++) s += Math.abs(g1[i] - g2[i]);
      return s / 2;
    };
    const off = dist(A, B, false), on = dist(A, B, true);
    assert.ok(on > off,
      `the two bodies are no further apart with the body term (${off.toFixed(4)} -> ${on.toFixed(4)}) — ` +
      'the geometry is still passive');
    assert.ok(on - off > 0.01,
      `the separation grew by only ${((on - off) * 100).toFixed(2)} points of distribution, which is noise`);
  });

  test('the visualiser measures it once and hands it to both consumers', async () => {
    // The producer runs in _capturePristine, which is the only hook that fires
    // on a shape change in BOTH math modes — in GPU mode this visualiser is
    // deactivated, and a lazier home would have left the shader, which is
    // exactly where the body's say is most missing, with a buffer of zeros.
    globalThis.document ??= {
      getElementById: () => ({ value: '', style: {}, textContent: '',
                               classList: { add() {}, remove() {}, toggle() {} } }),
      querySelectorAll: () => [],
    };
    globalThis.Worker ??= class {
      constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; }
      postMessage() {} terminate() {}
    };
    const { MathVisualizer } = await import('../src/math-visualizer.js');
    const THREE = await import('three');

    // A catenoid, because it is one of the bodies that DOES report a curvature
    // texture — with a silent body the interesting half of this test (the
    // attribute and the CPU map holding the same numbers) would never run, and
    // the test would be pinning nothing but a buffer of zeros. Measured: a
    // torus knot at these proportions is silent, which is how that hole was
    // found.
    const geometry = PARAMETRIC.buildCatenoidGeo();
    const n = geometry.attributes.position.count;
    geometry.setAttribute('aBodyK', new THREE.BufferAttribute(new Float32Array(n), 1));
    // Poison it first: the buffer is REUSED when a shape swap happens to keep
    // the vertex count, and a stale curvature map from the previous body is a
    // picture that looks deliberate.
    geometry.attributes.aBodyK.array.fill(0.77);

    const render = {
      isMobile: false,
      U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 }, uBandR: { value: 3.5 } },
      gpuMesh: { geometry }, gpuPtsProxy: null, cb: {},
    };
    const viz = new MathVisualizer(render, { bass: 0, mid: 0, treble: 0, beatInt: 0, amp: 0.7, waveInt: 1 });
    viz._workerReady = true;
    viz.onShapeChange();

    const a = geometry.attributes.aBodyK.array;
    let poisoned = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === 0.77) poisoned++;
    assert.equal(poisoned, 0,
      `${poisoned} entries still hold the previous shape's value — the attribute is not rewritten ` +
      'on a shape change, so a body would wear another body\'s curvature');

    assert.ok(viz._bodyCurv,
      'the catenoid reported no curvature texture, so this test would only be checking zeros — ' +
      'pick a body that speaks or the wiring is unmeasured');
    let differing = 0, nonZero = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== viz._bodyCurv[i]) differing++;
      if (a[i] !== 0) nonZero++;
    }
    assert.ok(nonZero > 0, 'the attribute is all zeros on a body that speaks');
    assert.equal(differing, 0,
      `${differing} entries differ: the attribute the shader reads and the array the CPU map is ` +
      'given are not the same numbers, so the two paths lay one body out differently');

    // And the case a speaking body cannot reach: swapping TO a silent one. The
    // buffer is reused whenever the vertex count happens to match, so a body
    // with nothing to say has to overwrite the previous body's numbers rather
    // than simply not writing. Left out, the sphere after a catenoid would wear
    // the catenoid's curvature and there would be no error anywhere.
    geometry.attributes.aBodyK.array.fill(0.77);
    viz._bodyCurv = null;
    viz._uploadBodyCurv(geometry, n);
    let stale = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== 0) stale++;
    assert.equal(stale, 0,
      `${stale} entries survived a shape change to a body with no curvature texture — the new ` +
      'shape is wearing the old one\'s layout');
  });

  test('a formula with no structure keeps the rings, body or no body', () => {
    // The cascade's promise: where the formula has nothing to say the layer
    // degrades into exactly the concentric rings that shipped before the map
    // existed. A body shift on top of that would be a NEW picture in the one
    // place the code promises an old one.
    const m = SADDLE();
    const V = m.V;
    const x = new Float32Array(V), z = new Float32Array(V);
    for (let i = 0; i < V; i++) { x[i] = m.P[i * 3]; z[i] = m.P[i * 3 + 2]; }
    const flat = new Float32Array(ANALYSIS_GRID * ANALYSIS_GRID);
    const r = buildBandMap(flat, ANALYSIS_GRID, FIELD_EXTENT, { x, z, R: 3.5, k: curvOf(m) });
    assert.equal(r.conf, 0);
    assert.deepEqual(r.stages, ['radius']);
    assert.equal(r.body, false, 'the body shifted a layout that had fallen back to the radius rule');
    let worst = 0;
    for (let i = 0; i < V; i++) {
      const want = Math.min(1, Math.hypot(x[i], z[i]) / 3.5);
      const d = Math.abs(r.u[i] - want);
      if (d > worst) worst = d;
    }
    assert.ok(worst < 1e-6, `the fallback is off the radius rule by ${worst}`);
  });
});
