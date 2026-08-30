// tests/surface-plumbing.test.js
//
// Contract test for the code between a formula and the mesh: the four exported
// functions in src/math-collections.js that every CPU formula reaches the screen
// through, and that nothing in the suite drove.
//
// Run:
//   node --test tests/surface-plumbing.test.js
//
// ── Why this exists ───────────────────────────────────────────────────────────
// tests/math-validation.test.js pins the CATALOGUE — 192 formulas, their
// arithmetic, their finiteness, their range. Its one integration section calls
// generateSurfaceFromFormula and then asserts array length, finiteness and
// boundedness. Every one of those predicates is invariant under permuting the
// output array, under freezing the `time` argument, under forcing `amp` to 1,
// and under never flagging the buffer for upload — so the function that turns
// all 192 formulas into geometry could be transposed, frozen or silenced with
// the whole suite green. That is this file's own prior art repeating: a table
// fully covered while the builder that consumes it is not.
//
// The four consumers and what a regression in each looks like on screen:
//
//   generateSurfaceFromFormula — `out[xi * G + zi]` instead of `out[zi * G + xi]`
//     renders every asymmetric surface mirrored about the diagonal, and rolls
//     travelling waves along the wrong axis. `fn(x, z, 0, …)` freezes over half
//     the catalogue into a still image.
//   applyHeightField — without `pos.needsUpdate = true` the field is recomputed
//     every frame and never reaches the GPU: the surface freezes on frame one.
//     Without computeVertexNormals the lighting stays welded to the old shape.
//   applyDisplacementField — the same two, plus the base position each
//     displacement is measured from.
//   getFormula — a fallback instead of null silently substitutes some other
//     formula for a key that does not exist.
//
// ── How the index convention is pinned ────────────────────────────────────────
// Not by re-implementing a formula: the expected value is obtained by calling
// the SAME `f` the generator calls, at the coordinates the generator's own
// documented mapping produces, and compared at the Float32 precision the output
// array stores. The sampled points all have xi !== zi, and the test proves it
// can see a transpose by counting how many shipped formulas actually differ
// across the diagonal at those points.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

// render.js and math-visualizer.js touch browser globals at import time; the
// same two stubs the other geometry-reading tests install.
globalThis.requestAnimationFrame ??= cb => { void cb; return 0; };
globalThis.performance ??= { now: () => 0 };
globalThis.Worker ??= class { postMessage() {} terminate() {} };

const { RenderEngine } = await import('../src/render.js');
const { weldNormals, MathVisualizer } = await import('../src/math-visualizer.js');
const { SHAPE_NAMES } = await import('../src/shapes.js');

/** The geometry the app itself builds for a shape name, through RenderEngine.setShape. */
const buildShape = name => {
  const stub = {
    CFG: { planeSize: 7, planeSegs: 160 }, isMobile: false, isShapeChanging: false,
    pendingShape: null, currentShape: 'plane',
    gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) }, gpuPtsProxy: null, cb: {},
    clearSolarSystem() {}, _buildSolarSystem() {},
    _buildShapeGeo: RenderEngine.prototype._buildShapeGeo,
    _buildStarGeo: RenderEngine.prototype._buildStarGeo,
    setShape: RenderEngine.prototype.setShape,
  };
  stub.setShape(name);
  return stub.gpuMesh.geometry;
};

import {
  MATH_COLLECTIONS,
  getFormula,
  generateSurfaceFromFormula,
  applyHeightField,
  applyDisplacementField,
  applyCollapseField,
  generateVolumeFromFormula,
  generateCollapseScalarField,
} from '../src/math-collections.js';

const BASELINE = { amp: 1, freq: 1, comp: 0.5 };

/** Every shipped formula, flat. */
const ALL = Object.entries(MATH_COLLECTIONS).flatMap(([colId, col]) =>
  Object.entries(col.formulas).map(([key, f]) => [`${colId}/${key}`, f]));

/** What the generator stores for one evaluation: guarded, then narrowed to f32. */
function expectedAt(f, x, z, t, params) {
  let y = 0;
  try { y = f(x, z, t, params); } catch (_) { y = 0; }
  return Math.fround(isFinite(y) ? y : 0);
}

// ── Minimal BufferAttribute stand-in ─────────────────────────────────────────
// The subset the three appliers touch, plus a record of the two calls that make
// the result visible: the upload flag and the normal recompute.
function makeMockGeo(n, fill = 0) {
  const data = new Float32Array(n * 3).fill(fill);
  return {
    normalsComputed: 0,
    attributes: {
      position: {
        count: n,
        _data: data,
        getX(i) { return this._data[i * 3]; },
        getY(i) { return this._data[i * 3 + 1]; },
        getZ(i) { return this._data[i * 3 + 2]; },
        setY(i, y) { this._data[i * 3 + 1] = y; },
        setXYZ(i, x, y, z) { this._data[i * 3] = x; this._data[i * 3 + 1] = y; this._data[i * 3 + 2] = z; },
        needsUpdate: false,
      },
    },
    computeVertexNormals() { this.normalsComputed++; },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// generateSurfaceFromFormula
// ═════════════════════════════════════════════════════════════════════════════

describe('generateSurfaceFromFormula — the mapping from formula to grid', () => {

  // A probe formula makes every argument readable in the output: each input
  // lands in its own decade, so one stored value names the whole call.
  const probe = (x, z, t, p) => x + 100 * z + 10000 * t + 1000000 * p.amp
                                + 100000000 * p.freq + 10000000000 * p.comp;

  test('the array is row-major: index zi*G + xi holds f(x(xi), z(zi))', () => {
    const G = 8, extent = 3.5, step = (extent * 2) / (G - 1);
    const hf = generateSurfaceFromFormula((x, z) => x + 100 * z, {}, G, extent, 0);
    for (const [xi, zi] of [[0, 3], [3, 0], [1, 6], [6, 1], [2, 7], [7, 2]]) {
      const x = -extent + xi * step;
      const z = -extent + zi * step;
      assert.equal(hf[zi * G + xi], Math.fround(x + 100 * z),
        `index ${zi}*${G}+${xi} does not hold f(x=${x}, z=${z}) — the surface is transposed`);
    }
  });

  test('the grid spans exactly [-extent, +extent] on both axes', () => {
    const G = 9, extent = 2;
    const xs = generateSurfaceFromFormula((x) => x, {}, G, extent, 0);
    const zs = generateSurfaceFromFormula((_x, z) => z, {}, G, extent, 0);
    assert.equal(xs[0], -extent, 'the first column is not at -extent');
    assert.equal(xs[G - 1], extent, 'the last column is not at +extent');
    assert.equal(zs[0], -extent, 'the first row is not at -extent');
    assert.equal(zs[(G - 1) * G], extent, 'the last row is not at +extent');
  });

  test('time and the three params reach the formula as given', () => {
    const G = 4;
    const hf = generateSurfaceFromFormula(probe, { amp: 2, freq: 3, comp: 4 }, G, 3.5, 5);
    // Read the sample at the grid centre-ish and strip the coordinate part.
    const xi = 1, zi = 2, extent = 3.5, step = (extent * 2) / (G - 1);
    const coords = (-extent + xi * step) + 100 * (-extent + zi * step);
    const rest = hf[zi * G + xi] - Math.fround(coords);
    assert.ok(Math.abs(rest - (10000 * 5 + 1000000 * 2 + 100000000 * 3 + 10000000000 * 4)) < 1e5,
      `the formula was called with the wrong time/params bundle (residual ${rest})`);
  });

  test('an omitted params bundle still arrives as the documented defaults', () => {
    // The signature's `{ amp = 1, freq = 1, comp = 0.5 }` is the contract the
    // worker and the sync path both rely on when a caller passes nothing.
    const seen = [];
    generateSurfaceFromFormula((x, z, t, p) => { seen.push(p); return 0; }, undefined, 2, 1, 0);
    assert.ok(seen.length, 'precondition: the formula was called at all');
    assert.deepEqual(seen[0], { amp: 1, freq: 1, comp: 0.5 });
  });

  test('the field moves when the clock moves, for most of the catalogue', () => {
    // Freezing `time` is invisible to any finiteness or range check, and it
    // stops the visualiser dead in CPU-formula mode.
    const G = 12;
    let moved = 0;
    for (const [, f] of ALL) {
      const a = generateSurfaceFromFormula(f.f, BASELINE, G, 3.5, 0);
      const b = generateSurfaceFromFormula(f.f, BASELINE, G, 3.5, 1.5);
      for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { moved++; break; } }
    }
    assert.ok(moved >= 50,
      `only ${moved} of ${ALL.length} formulas responded to the clock — ` +
      'the time argument is not reaching them');
  });

  test('the field responds to amp, for most of the catalogue', () => {
    const G = 12;
    let moved = 0;
    for (const [, f] of ALL) {
      const a = generateSurfaceFromFormula(f.f, { amp: 1, freq: 1, comp: 0.5 }, G, 3.5, 0);
      const b = generateSurfaceFromFormula(f.f, { amp: 1.5, freq: 1, comp: 0.5 }, G, 3.5, 0);
      for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { moved++; break; } }
    }
    assert.ok(moved >= 100,
      `only ${moved} of ${ALL.length} formulas responded to amp — ` +
      'the AMPLITUDE slider is not reaching the surface');
  });

  test('every shipped formula lands where the row-major convention says', () => {
    // The catalogue-wide form of the first test: the expected value is the same
    // `f` evaluated at the coordinates the mapping produces, so this cannot
    // pass on a re-implementation and cannot pass on a transposed write.
    const G = 11, extent = 3.5, T = 0.75, step = (extent * 2) / (G - 1);
    const SAMPLES = [[0, 4], [4, 0], [2, 9], [9, 2], [1, 7], [7, 1]];
    let asymmetric = 0;
    for (const [name, f] of ALL) {
      const hf = generateSurfaceFromFormula(f.f, BASELINE, G, extent, T);
      let differs = false;
      for (const [xi, zi] of SAMPLES) {
        const x = -extent + xi * step;
        const z = -extent + zi * step;
        assert.equal(hf[zi * G + xi], expectedAt(f.f, x, z, T, BASELINE),
          `${name}: hf[${zi}*${G}+${xi}] is not f(${x}, ${z})`);
        if (hf[zi * G + xi] !== hf[xi * G + zi]) differs = true;
      }
      if (differs) asymmetric++;
    }
    // Sensitivity: if nothing in the catalogue were asymmetric at these points,
    // the loop above would pass on a transposed generator too.
    assert.ok(asymmetric >= 20,
      `only ${asymmetric} formulas differ across the diagonal at the sampled ` +
      'points — the check above could not see a transpose');
  });

  test('a formula that throws or returns nonsense stores a flat 0, not a hole', () => {
    const thrown = generateSurfaceFromFormula(() => { throw new Error('boom'); }, {}, 4, 1, 0);
    const nan    = generateSurfaceFromFormula(() => NaN, {}, 4, 1, 0);
    const inf    = generateSurfaceFromFormula(() => Infinity, {}, 4, 1, 0);
    for (const hf of [thrown, nan, inf]) {
      assert.equal(hf.length, 16);
      for (let i = 0; i < hf.length; i++) assert.equal(hf[i], 0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// applyHeightField — the only uploader on the surface path
// ═════════════════════════════════════════════════════════════════════════════

describe('applyHeightField — the height field reaching the mesh', () => {

  // Until round 10 this file asserted the opposite: vertex i takes
  // heightField[i]. That identity is true of exactly one geometry in the
  // catalogue — the rotated PlaneGeometry, whose vertices ARE the lattice in
  // this order — and the test used a mock in that same order, so it could
  // never see that the other nineteen shapes were being handed a PERMUTATION
  // of the function. The contract is now stated in terms a mesh cannot
  // accidentally satisfy: a vertex takes the field at the point where the
  // vertex actually is.
  test('a vertex takes the field sampled at its own (x,z), whatever its index', () => {
    // A 2×2 lattice over extent 1: x and z run over {−1, +1}, row-major with
    // z outer — the layout generateSurfaceFromFormula writes.
    const hf = new Float32Array([10, 20,     // z = −1 :  x = −1 , x = +1
                                 30, 40]);   // z = +1 :  x = −1 , x = +1
    const geo = makeMockGeo(4);
    const p   = geo.attributes.position;
    // Index order and lattice order deliberately disagree. Under the old rule
    // vertex 0 would take 10; it sits at (+1, +1), so it must take 40.
    p.setXYZ(0, +1, -99, +1);
    p.setXYZ(1, -1, -99, -1);
    p.setXYZ(2, +1, -99, -1);
    p.setXYZ(3, -1, -99, +1);
    applyHeightField(geo, hf, null, 1);

    assert.equal(p.getY(0), 40, 'vertex 0 sits at (+1,+1)');
    assert.equal(p.getY(1), 10, 'vertex 1 sits at (−1,−1)');
    assert.equal(p.getY(2), 20, 'vertex 2 sits at (+1,−1)');
    assert.equal(p.getY(3), 30, 'vertex 3 sits at (−1,+1)');
    assert.equal(p.getX(0), +1, 'X must not move — this is a height field');
    assert.equal(p.getZ(0), +1, 'Z must not move');
  });

  test('control — on a mesh that IS the lattice in order, this is the old index identity', () => {
    // The one arrangement the old rule was right for. It must still hold, or
    // the fix would have moved the plane, which is the shape the whole app is
    // built around.
    const hf  = new Float32Array([10, 20, 30, 40]);
    const geo = makeMockGeo(4);
    const p   = geo.attributes.position;
    p.setXYZ(0, -1, -99, -1);
    p.setXYZ(1, +1, -99, -1);
    p.setXYZ(2, -1, -99, +1);
    p.setXYZ(3, +1, -99, +1);
    applyHeightField(geo, hf, null, 1);
    for (let i = 0; i < 4; i++) assert.equal(p.getY(i), hf[i]);
  });

  test('the field is a displacement from the base, not a replacement of it', () => {
    // Why it must be: on every shape but the plane the vertex has a height of
    // its own, and overwriting it deleted the shape — a sphere became the
    // graph of f over the sphere's shadow. basePositions is the pristine
    // geometry; the plane's is zero, which is what makes this a no-op there.
    const hf   = new Float32Array([10, 20, 30, 40]);
    const geo  = makeMockGeo(4);
    const p    = geo.attributes.position;
    p.setXYZ(0, -1, -99, -1);
    p.setXYZ(1, +1, -99, -1);
    p.setXYZ(2, -1, -99, +1);
    p.setXYZ(3, +1, -99, +1);
    const base = new Float32Array([-1, 5, -1,  +1, 6, -1,  -1, 7, +1,  +1, 8, +1]);
    applyHeightField(geo, hf, base, 1);
    assert.equal(p.getY(0), 15);
    assert.equal(p.getY(1), 26);
    assert.equal(p.getY(2), 37);
    assert.equal(p.getY(3), 48);
  });

  test('two vertices at the same point get the same height — nothing is torn', () => {
    // The five PolyhedronGeometry solids carry each corner three to seven
    // times over, with different indices. Under the old rule those copies took
    // different heights and the solid came apart: measured spread up to 7.0
    // world units on a body of radius 3.5.
    const hf  = new Float32Array([10, 20, 30, 40]);
    const geo = makeMockGeo(3);
    const p   = geo.attributes.position;
    p.setXYZ(0, +1, -99, -1);
    p.setXYZ(1, +1, -99, -1);   // same point, different index
    p.setXYZ(2, +1, -99, -1);   // and again
    applyHeightField(geo, hf, null, 1);
    assert.equal(p.getY(0), p.getY(1));
    assert.equal(p.getY(1), p.getY(2));
  });

  test('the buffer is flagged for upload, or the surface freezes on frame one', () => {
    const geo = makeMockGeo(3);
    applyHeightField(geo, new Float32Array([1, 2, 3]));
    assert.equal(geo.attributes.position.needsUpdate, true,
      'without this the field is recomputed every frame and never reaches the GPU');
  });

  test('normals are recomputed, or the lighting stays welded to the old shape', () => {
    const geo = makeMockGeo(3);
    applyHeightField(geo, new Float32Array([1, 2, 3]));
    assert.equal(geo.normalsComputed, 1);
  });

  test('a field that is not gridSize² still writes a number, never NaN', () => {
    // The app cannot produce one — generateSurfaceFromFormula returns exactly
    // gridSize² — but the old code's `heightField[i] ?? 0` was the guard here,
    // and dropping it must not open a hole. The grid is read off the field's
    // own length, so a length below 4 degenerates to a single sample and
    // anything longer is sampled on the largest lattice that fits.
    for (const len of [0, 1, 2, 3, 5, 7]) {
      const geo = makeMockGeo(4);
      const p   = geo.attributes.position;
      p.setXYZ(0, -1, -99, -1);
      p.setXYZ(1, +1, -99, -1);
      p.setXYZ(2, -1, -99, +1);
      p.setXYZ(3, +9, -99, -9);          // far outside the domain, clamps
      applyHeightField(geo, new Float32Array(len).fill(7), null, 1);
      for (let i = 0; i < 4; i++) {
        assert.ok(Number.isFinite(p.getY(i)), `len ${len}, vertex ${i} is not finite`);
      }
    }
  });

  test('a vertex outside the domain takes the edge value, not a hole', () => {
    const hf  = new Float32Array([10, 20, 30, 40]);
    const geo = makeMockGeo(2);
    const p   = geo.attributes.position;
    p.setXYZ(0, -50, -99, -50);   // beyond the −1 corner
    p.setXYZ(1, +50, -99, +50);   // beyond the +1 corner
    applyHeightField(geo, hf, null, 1);
    assert.equal(p.getY(0), 10);
    assert.equal(p.getY(1), 40);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// applyDisplacementField — the volume path's uploader
// ═════════════════════════════════════════════════════════════════════════════

describe('applyDisplacementField — displacement measured from the base', () => {

  test('each axis is base + its own displacement component', () => {
    const geo  = makeMockGeo(2);
    const base = new Float32Array([1, 2, 3, 10, 20, 30]);
    const df   = new Float32Array([0.1, 0.2, 0.3, -1, -2, -3]);
    applyDisplacementField(geo, df, base);

    const p = geo.attributes.position;
    assert.equal(Math.fround(p.getX(0)), Math.fround(1.1));
    assert.equal(Math.fround(p.getY(0)), Math.fround(2.2));
    assert.equal(Math.fround(p.getZ(0)), Math.fround(3.3));
    assert.equal(p.getX(1), 9);
    assert.equal(p.getY(1), 18);
    assert.equal(p.getZ(1), 27);
  });

  test('a zero field returns the base positions exactly', () => {
    // The base is what the volume path restores to when the deform is removed;
    // dropping it would drift the mesh a little further every frame.
    const geo  = makeMockGeo(2);
    const base = new Float32Array([1, 2, 3, 4, 5, 6]);
    applyDisplacementField(geo, new Float32Array(6), base);
    for (let i = 0; i < 6; i++) assert.equal(geo.attributes.position._data[i], base[i]);
  });

  test('the buffer is flagged and the normals recomputed', () => {
    const geo = makeMockGeo(1);
    applyDisplacementField(geo, new Float32Array(3), new Float32Array([1, 1, 1]));
    assert.equal(geo.attributes.position.needsUpdate, true);
    assert.equal(geo.normalsComputed, 1);
  });
});

// applyCollapseField's arithmetic is pinned in tests/math-validation.test.js;
// the two calls that make the result visible were not, and a mutation dropping
// its needsUpdate survived the whole suite exactly as applyHeightField's did.
describe('applyCollapseField — the same two visibility calls', () => {

  test('the buffer is flagged and the normals recomputed', () => {
    const geo = makeMockGeo(1);
    applyCollapseField(geo, new Float32Array([0.5]), new Float32Array([1, 0, 0]),
      new Float32Array([1, 0, 0]), 1);
    assert.equal(geo.attributes.position.needsUpdate, true);
    assert.equal(geo.normalsComputed, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getFormula
// ═════════════════════════════════════════════════════════════════════════════

describe('getFormula — a key that does not exist resolves to nothing', () => {

  test('an unknown collection or key returns null, never a stand-in', () => {
    // A fallback here would draw some other formula under the name the operator
    // picked, and every downstream check (finite, bounded) would still pass.
    assert.equal(getFormula('no-such-collection', 'sinCos'), null);
    assert.equal(getFormula('trigonometry', 'no-such-formula'), null);
    assert.equal(getFormula(undefined, undefined), null);
  });

  test('control — a real key still resolves to that formula', () => {
    const hit = getFormula('trigonometry', 'sinCos');
    assert.ok(hit, 'precondition: the catalogue still has trigonometry/sinCos');
    assert.equal(hit, MATH_COLLECTIONS.trigonometry.formulas.sinCos);
  });
});


// ── Round 11: the deform paths, measured on geometry they actually meet ──────
describe('the volume field covers every vertex, not the first gridSize² of them', () => {

  test('a mesh whose vertex count is not a perfect square has no frozen tail', () => {
    // 130 vertices: round(√130) = 11, so the old field was 121 long and the
    // last 9 vertices read `df[i*3] ?? 0`. On the shipped meshes that tail was
    // 162 vertices on box, 56 on ring, 45 on torus, 20 on star, 17 on hex, 15
    // on icosahedron-smooth, 8 on dodecahedron and 3 on tetrahedron.
    const N = 130;
    const base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { base[i * 3] = (i % 13) - 6; base[i * 3 + 1] = 0.5; base[i * 3 + 2] = Math.floor(i / 13) - 5; }
    const field = () => ({ dx: 0.25, dy: -0.5, dz: 0.75 });

    const df = generateVolumeFromFormula(field, BASELINE, 11, 3.5, 0, base);

    assert.equal(df.length, N * 3, `the field is ${df.length / 3} vertices long against ${N} in the mesh`);
    const frozen = [];
    for (let i = 0; i < N; i++) if (df[i * 3] === 0 && df[i * 3 + 1] === 0 && df[i * 3 + 2] === 0) frozen.push(i);
    assert.deepEqual(frozen, [], `vertices left unmoved by a field that displaces everything: ${frozen.join(', ')}`);
  });

  test('control — with no geometry the flat lattice is still gridSize²', () => {
    // The synthetic path has no vertices to speak of, and callers that pass no
    // basePositions still expect the square lattice.
    const df = generateVolumeFromFormula(() => ({ dx: 1, dy: 0, dz: 0 }), BASELINE, 9, 3.5, 0, null);
    assert.equal(df.length, 9 * 9 * 3);
  });
});

describe('collapse keeps two coordinates on a flat figure', () => {

  // The kernel is called as f(theta, phi): this one returns phi, so the field
  // IS the second coordinate and a degenerate chart shows up as a constant.
  const phiOf = base => Array.from(generateCollapseScalarField((theta, phi) => phi, BASELINE, base, 0));

  test('a disc does not hand every vertex the same phi', () => {
    const N = 200, base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2, r = 0.2 + 3 * (i % 17) / 17;
      base[i * 3] = Math.cos(a) * r; base[i * 3 + 1] = 0; base[i * 3 + 2] = Math.sin(a) * r;
    }
    const phi = phiOf(base);
    const spread = Math.max(...phi) - Math.min(...phi);
    assert.ok(spread > 1, `phi spans ${spread.toFixed(4)} across a flat figure — it used to be exactly 0, at pi/2`);
    assert.ok(Math.max(...phi) <= Math.PI + 1e-6, 'the substitute coordinate stays inside phi\'s own band');
  });

  test('control — a body with height still gets the spherical phi', () => {
    // Antipodal pairs, so the centroid is the origin exactly and the expected
    // value stays acos(y) rather than acos((y − cy)/r) — the first version of
    // this control failed on its own sampling, not on the code.
    const N = 400, base = new Float32Array(N * 3);
    for (let i = 0; i < N / 2; i++) {
      const u = (i + 0.5) / (N / 2) * Math.PI, v = i * 2.399963;
      const x = Math.sin(u) * Math.cos(v), y = Math.cos(u), z = Math.sin(u) * Math.sin(v);
      base[i * 6] = x;     base[i * 6 + 1] = y;  base[i * 6 + 2] = z;
      base[i * 6 + 3] = -x; base[i * 6 + 4] = -y; base[i * 6 + 5] = -z;
    }
    const phi = phiOf(base);
    // On a unit sphere about its own centroid, phi = acos(y) exactly.
    let worst = 0;
    for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(phi[i] - Math.acos(base[i * 3 + 1])));
    // 1e-4, not 1e-6: basePositions is a Float32Array and acos has slope
    // 1/√(1−y²) near the poles, so the storage alone accounts for 3.4e-6 here.
    // The claim is that the chart is unchanged, not that it is bit-exact.
    assert.ok(worst < 1e-4, `the solid-body chart moved by ${worst}`);
  });
});


// ── Round 11: the field follows the surface, not the vertical ────────────────
//
// Measured on the geometry the app builds, through RenderEngine.setShape — not
// on a hand-made PlaneGeometry. The first version of this block used one, and
// it is precisely why it missed that `disc` is a plate 0.08 units thick with
// 95 % of its vertices carrying a horizontal normal.
describe('a height field deforms a closed body instead of shearing it', () => {


  /** Pristine positions and normals, exactly as MathVisualizer takes them. */
  const snapshot = geo => {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position, n = geo.attributes.normal;
    const pos = new Float32Array(p.count * 3), nrm = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      pos[i * 3] = p.getX(i); pos[i * 3 + 1] = p.getY(i); pos[i * 3 + 2] = p.getZ(i);
      nrm[i * 3] = n.getX(i); nrm[i * 3 + 1] = n.getY(i); nrm[i * 3 + 2] = n.getZ(i);
    }
    return { pos, nrm: weldNormals(pos, nrm) };
  };
  const spanY = geo => {
    const p = geo.attributes.position;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
    return hi - lo;
  };
  const field = (grid, h) => new Float32Array(grid * grid).fill(h);

  test('a sphere gains thickness where it used to shear', () => {
    const geo = buildShape('sphere');
    const { pos, nrm } = snapshot(geo);
    const before = spanY(geo);

    applyHeightField(geo, field(64, 0.3), pos, 3.5);            // +Y, what shipped
    const yOnly = spanY(geo);
    applyHeightField(geo, field(64, 0.3), pos, 3.5, nrm);       // along the normal
    const alongNormal = spanY(geo);

    assert.ok(Math.abs(yOnly - before) < 1e-5,
      `a uniform field moved the sphere's span by ${(yOnly - before).toExponential(2)} under the old rule — ` +
      'the premise here is that it shears rather than thickens');
    assert.ok(alongNormal - before > 0.5,
      `along the normal the span grew by ${(alongNormal - before).toFixed(4)}; a 0.3 field on a sphere owes about 0.6`);
  });

  test('no shape is torn apart: coincident vertices stay coincident', () => {
    // Round 10's rule, re-measured through the call the app now makes. Without
    // the weld this reads 0.405 on box and 0.493 on pyramid-smooth.
    for (const name of ['box', 'pyramid-smooth', 'cone', 'cylinder', 'dodecahedron', 'octahedron', 'tetrahedron']) {
      const geo = buildShape(name);
      const { pos, nrm } = snapshot(geo);
      const n = geo.attributes.position.count;
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        const k = `${Math.round(pos[i * 3] * 1e6)},${Math.round(pos[i * 3 + 1] * 1e6)},${Math.round(pos[i * 3 + 2] * 1e6)}`;
        const g = groups.get(k); if (g) g.push(i); else groups.set(k, [i]);
      }
      const seams = [...groups.values()].filter(g => g.length > 1);
      assert.ok(seams.length > 0, `precondition: ${name} has no coincident vertices, so this proves nothing about it`);

      applyHeightField(geo, field(64, 0.4), pos, 3.5, nrm);
      const q = geo.attributes.position;
      let worst = 0;
      for (const g of seams) for (let a = 1; a < g.length; a++) {
        worst = Math.max(worst, Math.hypot(
          q.getX(g[0]) - q.getX(g[a]), q.getY(g[0]) - q.getY(g[a]), q.getZ(g[0]) - q.getZ(g[a])));
      }
      assert.ok(worst < 1e-9, `${name} opened by ${worst.toExponential(3)} at a seam — the mesh is torn`);
    }
  });

  test('the plane is untouched, to sixteen orders below anything it can show', () => {
    // The app rotates its plane flat, so its normal IS +Y and the two rules are
    // one rule. Not "to the bit": rotateX(-PI/2) leaves 6.123e-17 in the
    // normal's z, so where the base z is exactly 0 the displaced z comes out
    // -2.446e-17 instead of +0. That is the worst disagreement over the plane.
    const geo = buildShape('plane');
    const { pos, nrm } = snapshot(geo);
    const grid = Math.round(Math.sqrt(geo.attributes.position.count));
    const f = new Float32Array(grid * grid);
    for (let i = 0; i < f.length; i++) f[i] = Math.sin(i * 0.37) * 0.4;

    applyHeightField(geo, f, pos, 3.5);
    const yOnly = Array.from(geo.attributes.position.array);
    applyHeightField(geo, f, pos, 3.5, nrm);
    const alongNormal = Array.from(geo.attributes.position.array);

    let worst = 0;
    for (let i = 0; i < yOnly.length; i++) worst = Math.max(worst, Math.abs(alongNormal[i] - yOnly[i]));
    assert.ok(worst < 1e-12, `the default shape moved by ${worst.toExponential(3)}`);
  });

  test('control — the field is read at the base coordinate, so it does not creep', () => {
    const geo = buildShape('sphere');
    const { pos, nrm } = snapshot(geo);
    const f = new Float32Array(64 * 64);
    for (let i = 0; i < f.length; i++) f[i] = Math.cos(i * 0.21) * 0.35;

    applyHeightField(geo, f, pos, 3.5, nrm);
    const once = Array.from(geo.attributes.position.array);
    applyHeightField(geo, f, pos, 3.5, nrm);
    const twice = Array.from(geo.attributes.position.array);

    assert.deepEqual(twice, once, 'the same field applied twice from the same base moved the mesh');
  });
});


// ── Round 11, second pass: which bodies the field may follow ────────────────
//
// The first pass let it follow every body and two adversarial reviews measured
// what that costs: seams opening on 12 of 20 shapes, a fold in the strip beside
// each hard edge under a NEGATIVE field, `disc` inside out, `torusknot` past
// its own axis. The rule is narrow now, and it is decided by measuring the
// geometry rather than by naming shapes.
describe('the field follows the surface only where that is safe', () => {

  const vizFor = name => {
    const stub = {
      CFG: { planeSize: 7, planeSegs: 160 }, isMobile: false, isShapeChanging: false,
      pendingShape: null, currentShape: 'plane',
      gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) }, gpuPtsProxy: null, cb: {},
      clearSolarSystem() {}, _buildSolarSystem() {},
      _buildShapeGeo: RenderEngine.prototype._buildShapeGeo,
      _buildStarGeo: RenderEngine.prototype._buildStarGeo,
      setShape: RenderEngine.prototype.setShape,
    };
    stub.setShape(name);
    const render = {
      isMobile: false,
      U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 }, uVHField: { value: 0 } },
      gpuMesh: { geometry: stub.gpuMesh.geometry }, gpuPtsProxy: null, cb: {},
    };
    const viz = new MathVisualizer(render, { bass: 0, mid: 0, treble: 0, beatInt: 0, amp: 0.7, waveInt: 1 });
    viz._workerReady = false;
    viz.onShapeChange();
    return { viz, geo: stub.gpuMesh.geometry };
  };

  const faceNormals = geo => {
    const p = geo.attributes.position, idx = geo.index, out = [];
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
      const ux = p.getX(b) - ax, uy = p.getY(b) - ay, uz = p.getZ(b) - az;
      const vx = p.getX(c) - ax, vy = p.getY(c) - ay, vz = p.getZ(c) - az;
      out.push([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
    }
    return out;
  };
  const flipped = (before, after) => {
    let n = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i][0] * after[i][0] + before[i][1] * after[i][1] + before[i][2] * after[i][2] < 0) n++;
    }
    return n;
  };

  // The table is PRODUCED by walking the catalogue, not written by hand.
  //
  // It was two hand-written literals of four and sixteen names until wave B,
  // and by then the tree held twenty-seven shapes and seven followers. Nothing
  // went red: the lists simply stopped covering the catalogue, and seven bodies
  // — sierpinski-tetra, mobius, klein, catenoid, helicoid, hyperboloid,
  // pseudosphere — appeared in neither. That is not a cosmetic gap. The
  // negative-field guard below iterates FOLLOWS, so it did not run on `helicoid`
  // at all, and `helicoid` was inverting 20 of its 19 200 triangles under 33 of
  // the 192 shipped kernels. A list that has to be edited by hand when the
  // catalogue grows is a list that will be forgotten again, so this one is
  // derived the same way the grid list in tests/surface-field-on-shapes.test.js
  // is: by asking the shipped code.
  const classify = () => {
    const follows = [], vertical = [];
    for (const name of SHAPE_NAMES) {
      const { viz } = vizFor(name);
      (viz._pristineNormals ? follows : vertical).push(name);
    }
    return { follows, vertical };
  };
  const { follows: FOLLOWS, vertical: VERTICAL } = classify();

  test('every shape is on one of the two rules, and the split is the measured one', () => {
    assert.equal(FOLLOWS.length + VERTICAL.length, SHAPE_NAMES.length,
      'a shape reached neither rule, which cannot happen unless the walk is broken');
    // Pinned by name, because WHICH bodies follow their normals is a product
    // fact and not an implementation detail: a body silently changing rules is
    // a body that starts deforming differently on screen.
    assert.deepEqual(FOLLOWS,
      ['sphere', 'torus', 'icosahedron-smooth', 'catenoid', 'hyperboloid', 'solar'],
      'the set of bodies that carry the field along their own normals has changed');
    for (const name of FOLLOWS) {
      const { viz } = vizFor(name);
      assert.ok(viz._pristineDepth > 0.3, `${name}: depth cap ${viz._pristineDepth}`);
    }
  });

  test('a NEGATIVE field inverts no triangle on the bodies that follow the surface', () => {
    // The sign is the whole test. The fold the second review found shows up at
    // −0.4 and is invisible at +0.4: 3744 inverted faces against 0, on the same
    // mesh with the same magnitude.
    for (const name of FOLLOWS) {
      const { viz, geo } = vizFor(name);
      const before = faceNormals(geo);
      const grid = Math.round(Math.sqrt(geo.attributes.position.count));
      applyHeightField(geo, new Float32Array(grid * grid).fill(-0.4),
        viz._pristinePositions, 3.5, viz._pristineNormals, viz._pristineDepth);
      assert.equal(flipped(before, faceNormals(geo)), 0, `${name} turned triangles inside out`);
    }
  });

  test('the bodies on the vertical rule are bit-identical to what main draws', () => {
    // Not "close": the same numbers. This is the guarantee that narrowing the
    // change left everything else where it was.
    for (const name of VERTICAL) {
      const { viz, geo } = vizFor(name);
      const grid = Math.round(Math.sqrt(geo.attributes.position.count));
      const f = new Float32Array(grid * grid);
      for (let i = 0; i < f.length; i++) f[i] = Math.sin(i * 0.31) * 0.5;

      applyHeightField(geo, f, viz._pristinePositions, 3.5, viz._pristineNormals, viz._pristineDepth);
      const branch = Array.from(geo.attributes.position.array);
      applyHeightField(geo, f, viz._pristinePositions, 3.5, null);   // the rule main ships
      const mainRule = Array.from(geo.attributes.position.array);

      assert.deepEqual(branch, mainRule, `${name} moved away from the vertical rule`);
    }
  });

  test('disc keeps its thickness — the reason the plate rule exists', () => {
    const { viz, geo } = vizFor('disc');
    const p = geo.attributes.position;
    const grid = Math.round(Math.sqrt(p.count));
    // Top and bottom cap vertices sharing an (x, z): their gap is the plate.
    const cols = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
      const c = cols.get(k); if (c) c.push(i); else cols.set(k, [i]);
    }
    const pairs = [...cols.values()].filter(c => c.length > 1).slice(0, 200);
    assert.ok(pairs.length > 20, 'precondition: the disc has vertical pairs to measure');

    applyHeightField(geo, new Float32Array(grid * grid).fill(-0.5),
      viz._pristinePositions, 3.5, viz._pristineNormals, viz._pristineDepth);

    let thinnest = Infinity;
    for (const c of pairs) {
      let lo = Infinity, hi = -Infinity;
      for (const i of c) { const y = p.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
      thinnest = Math.min(thinnest, hi - lo);
    }
    assert.ok(thinnest > 0.07,
      `the plate is ${thinnest.toFixed(4)} thick after the field — it was 0.08, and following its own ` +
      'normals measured −0.606, i.e. inside out');
  });
});


// ── Round 11, cost: the grouping rewrite has to be the SAME grouping ─────────
//
// hasHardEdges and weldNormals each built their own Map keyed by a string
// `"${qx},${qy},${qz}"`, twice per shape change, and that pair was most of the
// hitch: 64.6 ms of capture on `sphere` and 18.4 ms on `box`, with 6.6 % of the
// profile spent collecting the keys. One hashed pass replaced both. A hash
// bucket resolves ties by comparing the quantised triple exactly, so a
// collision may cost a comparison but must never merge two different points —
// which is exactly what this measures, against the string-keyed original.
describe('the hashed vertex grouping equals the string-keyed one it replaced', () => {

  /** The implementation this replaced, kept here as the reference. */
  const weldByStringKey = (positions, normals) => {
    const n = positions.length / 3;
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(positions[i * 3] * 1e6)},${Math.round(positions[i * 3 + 1] * 1e6)},${Math.round(positions[i * 3 + 2] * 1e6)}`;
      const g = groups.get(k);
      if (g) g.push(i); else groups.set(k, [i]);
    }
    const out = Float32Array.from(normals);
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      let x = 0, y = 0, z = 0;
      for (const i of g) { x += normals[i * 3]; y += normals[i * 3 + 1]; z += normals[i * 3 + 2]; }
      const len = Math.hypot(x, y, z);
      if (len < 1e-6) continue;
      x /= len; y /= len; z /= len;
      for (const i of g) { out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; }
    }
    return out;
  };

  // Bodies with seams to weld, plates whose groups cancel, and smooth bodies
  // with almost none — the three cases the weld distinguishes.
  for (const name of ['box', 'pyramid-smooth', 'disc', 'cylinder', 'sphere', 'torus', 'solar']) {
    test(`${name}: every welded normal matches the reference`, () => {
      const geo = buildShape(name);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const p = geo.attributes.position, nAttr = geo.attributes.normal;
      const pos = new Float32Array(p.count * 3), nrm = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        pos[i * 3] = p.getX(i); pos[i * 3 + 1] = p.getY(i); pos[i * 3 + 2] = p.getZ(i);
        nrm[i * 3] = nAttr.getX(i); nrm[i * 3 + 1] = nAttr.getY(i); nrm[i * 3 + 2] = nAttr.getZ(i);
      }
      const mine = weldNormals(pos, nrm);
      const ref  = weldByStringKey(pos, nrm);
      let worst = 0, at = -1;
      for (let i = 0; i < mine.length; i++) {
        const d = Math.abs(mine[i] - ref[i]);
        if (d > worst) { worst = d; at = i; }
      }
      // Not "close enough": the two differ only by hypot(x,y,z) against
      // sqrt(x²+y²+z²) on the same sums, which is a last-bit affair in float32.
      assert.ok(worst < 1e-6,
        `${name}: welded normal ${at} differs from the reference by ${worst}`);
    });
  }
});

// ── The round surface ────────────────────────────────────────────────────────
//
// `circle` was THREE.CircleGeometry: a triangle fan of 162 vertices with
// exactly ONE — the centre — off the rim. Every displacement this app performs
// is per vertex, so the picker offered a circle that could not carry a formula:
// 160 triangles each spanning a radius of the disc. It is built from the square
// grid now, through the elliptical grid mapping, so the round surface is the
// square surface with a different outline.
describe('circle is a surface, not an outline', () => {

  const R = 3.5;

  /** The field the mesh is asked to draw, analytic so the test can ask for its
   *  value anywhere rather than only where the mesh happens to sample it. */
  const f = (x, z) => Math.sin(1.7 * x) * Math.cos(1.3 * z);

  /** f on the app's own sampling grid, in the layout applyHeightField expects. */
  const fieldFor = grid => {
    const hf = new Float32Array(grid * grid);
    const step = (R * 2) / (grid - 1);
    for (let iz = 0; iz < grid; iz++) {
      for (let ix = 0; ix < grid; ix++) hf[iz * grid + ix] = f(-R + ix * step, -R + iz * step);
    }
    return hf;
  };

  const basePositions = geo => {
    const p = geo.attributes.position;
    const base = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      base[i * 3] = p.getX(i); base[i * 3 + 1] = p.getY(i); base[i * 3 + 2] = p.getZ(i);
    }
    return base;
  };

  /**
   * How badly the mesh misrepresents the field it was given: for every triangle,
   * the gap between the field's true value at the centroid and what the surface
   * shows there, which is the average of its three corners.
   */
  const worstMisdrawn = (geo, base) => {
    const p = geo.attributes.position, idx = geo.index;
    let worst = 0;
    const n = idx ? idx.count : p.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      const cx = (base[a * 3] + base[b * 3] + base[c * 3]) / 3;
      const cz = (base[a * 3 + 2] + base[b * 3 + 2] + base[c * 3 + 2]) / 3;
      const shown = (p.getY(a) + p.getY(b) + p.getY(c)) / 3;
      worst = Math.max(worst, Math.abs(shown - f(cx, cz)));
    }
    return worst;
  };

  test('the same grid the square plane has', () => {
    const circle = buildShape('circle'), plane = buildShape('plane');
    assert.equal(circle.attributes.position.count, plane.attributes.position.count,
      'the round surface must offer the square one\'s resolution, not a fan\'s');
    assert.equal(circle.index.count, plane.index.count);
  });

  test('round to the last float, with nothing outside the rim', () => {
    const geo = buildShape('circle');
    const p = geo.attributes.position;
    const segs = Math.round(Math.sqrt(p.count)) - 1;
    let worstRim = 0, worstOver = 0, interior = 0;
    for (let iy = 0; iy <= segs; iy++) {
      for (let ix = 0; ix <= segs; ix++) {
        const i = iy * (segs + 1) + ix;
        const r = Math.hypot(p.getX(i), p.getZ(i));
        if (ix === 0 || iy === 0 || ix === segs || iy === segs) worstRim = Math.max(worstRim, Math.abs(r - R));
        else { interior++; worstOver = Math.max(worstOver, r - R); }
      }
    }
    assert.ok(worstRim < 1e-5, `the outline is off the circle by ${worstRim}`);
    assert.ok(worstOver <= 0, `${worstOver} of surface pokes outside its own rim`);
    // The whole point: the old fan had one.
    assert.ok(interior > 25000, `only ${interior} vertices carry the interior`);
  });

  test('a formula reaches the interior — measured against the fan it replaced', () => {
    const geo  = buildShape('circle');
    const base = basePositions(geo);
    const grid = Math.round(Math.sqrt(geo.attributes.position.count));
    applyHeightField(geo, fieldFor(grid), base, R);
    const mine = worstMisdrawn(geo, base);

    // CONTROL — the geometry this replaced, built and displaced by the same code.
    const fan = new THREE.CircleGeometry(R, 160);
    fan.rotateX(-Math.PI / 2);                       // what setShape does to it
    const fanBase = basePositions(fan);
    applyHeightField(fan, fieldFor(grid), fanBase, R);
    const theirs = worstMisdrawn(fan, fanBase);

    assert.ok(mine < 0.02, `the round surface misdraws the field by ${mine.toFixed(4)}`);
    assert.ok(theirs > 0.5,
      `precondition: the fan should be unable to draw this field, but it is off by only ${theirs.toFixed(4)}`);
    assert.ok(theirs / mine > 50,
      `the fan misdraws by ${theirs.toFixed(4)} and the grid by ${mine.toFixed(4)} — expected a far wider gap`);
  });
});
