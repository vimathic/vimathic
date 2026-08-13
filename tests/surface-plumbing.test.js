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

import {
  MATH_COLLECTIONS,
  getFormula,
  generateSurfaceFromFormula,
  applyHeightField,
  applyDisplacementField,
  applyCollapseField,
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

  test('vertex i takes heightField[i] on Y and keeps its X and Z', () => {
    const geo = makeMockGeo(4);
    for (let i = 0; i < 4; i++) geo.attributes.position.setXYZ(i, i + 1, -99, (i + 1) * 10);
    applyHeightField(geo, new Float32Array([0.5, 1.5, 2.5, 3.5]));

    for (let i = 0; i < 4; i++) {
      assert.equal(geo.attributes.position.getY(i), 0.5 + i, `vertex ${i} took the wrong height`);
      assert.equal(geo.attributes.position.getX(i), i + 1, 'X must not move — this is a height field');
      assert.equal(geo.attributes.position.getZ(i), (i + 1) * 10, 'Z must not move');
    }
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

  test('a short height field leaves the rest of the mesh flat rather than NaN', () => {
    const geo = makeMockGeo(4);
    applyHeightField(geo, new Float32Array([7, 8]));
    assert.equal(geo.attributes.position.getY(2), 0);
    assert.equal(geo.attributes.position.getY(3), 0);
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
