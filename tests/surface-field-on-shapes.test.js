// tests/surface-field-on-shapes.test.js
//
// Round 10, family C. The surface path used to hand heightField[i] to vertex i.
// That identity is true of exactly one geometry in the catalogue — the rotated
// PlaneGeometry, whose vertices ARE the lattice in that order — and every test
// this repo had was written on a mock in that same order, so nine rounds of
// work never saw that the other nineteen shapes were being handed a
// PERMUTATION of the function. Measured before the fix: Pearson r between the
// drawn height and f at the vertex's own (x, z) was <= 0.19 on all nineteen and
// negative on five; the five PolyhedronGeometry solids came apart, because
// their coincident corner vertices carry different indices and so took
// different heights (spread up to 7.0 world units on a body of radius 3.5); and
// `heightField[i] ?? 0` pinned 321 vertices past gridSize^2 flat at y = 0.
//
// The stencils below are catalogue-wide and each carries a CONTROL that must
// NOT fire — on a catalogue where nineteen of twenty entries were wrong, a
// stencil that always says "bad" is indistinguishable from one that always says
// "good".
//
// Run: node --test tests/surface-field-on-shapes.test.js

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let THREE, RenderEngine, applyHeightField, generateSurfaceFromFormula, SHAPE_NAMES,
    FIELD_EXTENT;
before(async () => {
  THREE = await import('three');
  ({ RenderEngine }       = await import('../src/render.js'));
  ({ SHAPE_NAMES }        = await import('../src/shapes.js'));
  ({ applyHeightField, generateSurfaceFromFormula, FIELD_EXTENT } =
    await import('../src/math-collections.js'));
});

const EXTENT = 3.5;

// The geometry the app actually builds, desktop numbers. It drives the REAL
// RenderEngine.setShape on a stand-in carrying only the fields that method
// touches — not _buildShapeGeo plus a hand-copied rotation. The first draft of
// this file did copy the rotation, and it went stale within the hour when
// setShape learned to zero the plate's Y: the test kept measuring a geometry
// the app no longer builds. That is the same mistake as the defect this file
// guards, one level up.
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (fn => { fn(); return 0; });

function build(shape) {
  const stage = Object.create(RenderEngine.prototype);
  Object.assign(stage, {
    CFG: { planeSegs: 160, planeSize: 7 },
    isMobile: false,
    isShapeChanging: false,
    pendingShape: null,
    currentShape: null,
    gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) },
    gpuPtsProxy: null,
    clearSolarSystem() {},
    // 'solar' adds planet meshes to the scene, which this stand-in has not
    // got. They are not on the height-field path — _applyHF writes
    // gpuMesh.geometry and the points proxy, nothing else — so the sun sphere
    // setShape has already assigned is the whole of what this file measures.
    _buildSolarSystem() {},
    cb: null,
  });
  stage.setShape(shape);
  return stage.gpuMesh.geometry;
}

const pristineOf = g => Float32Array.from(g.attributes.position.array);

// A field with no flat region and no symmetry, so a permutation of it cannot
// pass for the thing itself.
const F = (x, z) => Math.sin(1.3 * x) + Math.cos(0.9 * z) + 0.2 * x * z;

function fieldFor(count) {
  const grid = Math.round(Math.sqrt(count));
  return { hf: generateSurfaceFromFormula((x, z) => F(x, z), {}, grid, EXTENT, 0), grid };
}

function pearson(a, b) {
  const n = a.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const u = a[i] - ma, v = b[i] - mb;
    num += u * v; da += u * u; db += v * v;
  }
  return (da === 0 || db === 0) ? NaN : num / Math.sqrt(da * db);
}

describe('the surface field lands where the vertex actually is', () => {

  test('the drawn displacement is the field at the vertex own (x,z), on every shape', () => {
    const weak = [];
    for (const shape of SHAPE_NAMES) {
      const g    = build(shape);
      const base = pristineOf(g);
      const pos  = g.attributes.position;
      const { hf } = fieldFor(pos.count);
      applyHeightField(g, hf, base, EXTENT);

      const drawn = [], wanted = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        if (Math.abs(x) > EXTENT || Math.abs(z) > EXTENT) continue;  // clamped, not sampled
        drawn.push(pos.getY(i) - base[i * 3 + 1]);
        wanted.push(F(x, z));
      }
      const r = pearson(drawn, wanted);
      // Shapes whose footprint is a handful of points (tetrahedron has four
      // distinct (x,z) columns) cannot support a correlation; they are covered
      // by the tearing and coverage stencils below instead.
      if (drawn.length >= 32 && !(r > 0.99)) weak.push(`${shape} r=${Number(r).toFixed(3)}`);
    }
    assert.deepEqual(weak, [], `these shapes are not drawing the field they were given: ${weak.join(', ')}`);
  });

  test('CONTROL — the plane is untouched, bit for bit', () => {
    // The one shape the old index identity was right for. If the fix moved
    // this, it moved the shape the whole app is built around, and every number
    // in MATHEMATICAL_ACCURACY.md with it.
    //
    // TWO fields on purpose. The first has no exact zeros, and a field like
    // that hides the only way the plane could still move: rotateX(-PI/2) left
    // the plate's own Y at 6.12e-17*y rather than flat, and since the field is
    // now ADDED, that residue would show through exactly where the field is
    // zero — nowhere, for a field that never is. The second field is x*z,
    // exactly zero along both centre lines: 321 of the plane's 25921 vertices.
    // setShape now zeroes the plate's Y after the turn, so both come back at
    // zero difference; take that out and only the second field notices.
    for (const [label, fn] of [['no exact zeros', F], ['zero on both axes', (x, z) => x * z]]) {
      const g    = build('plane');
      const pos  = g.attributes.position;
      const base = pristineOf(g);
      const grid = Math.round(Math.sqrt(pos.count));
      const hf   = generateSurfaceFromFormula(fn, {}, grid, EXTENT, 0);

      let exactZeros = 0;
      for (let i = 0; i < hf.length; i++) if (hf[i] === 0) exactZeros++;
      if (label === 'zero on both axes') {
        assert.ok(exactZeros > 300, `precondition: this field must carry exact zeros, it has ${exactZeros}`);
      }

      const was = new Float32Array(pos.count);          // what the old code wrote
      for (let i = 0; i < pos.count; i++) was[i] = Math.fround(hf[i] ?? 0);

      applyHeightField(g, hf, base, EXTENT);

      let differing = 0, worst = 0;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.abs(pos.getY(i) - was[i]);
        if (d !== 0) differing++;
        if (d > worst) worst = d;
      }
      assert.equal(differing, 0, `${label}: the plane moved in ${differing} vertices, worst ${worst}`);
    }
  });

  test('coincident vertices take the same height — no shape is torn apart', () => {
    const torn = [];
    for (const shape of SHAPE_NAMES) {
      const g    = build(shape);
      const base = pristineOf(g);
      const pos  = g.attributes.position;
      const { hf } = fieldFor(pos.count);
      applyHeightField(g, hf, base, EXTENT);

      // Group by position as it was BEFORE the field, so "the same corner"
      // means the same point of the solid, not the same drawn height.
      const seen = new Map();
      let spread = 0;
      for (let i = 0; i < pos.count; i++) {
        const k = `${base[i * 3].toFixed(6)},${base[i * 3 + 1].toFixed(6)},${base[i * 3 + 2].toFixed(6)}`;
        const y = pos.getY(i) - base[i * 3 + 1];
        const p = seen.get(k);
        if (p === undefined) seen.set(k, y);
        else spread = Math.max(spread, Math.abs(y - p));
      }
      if (spread > 1e-5) torn.push(`${shape} ${spread.toFixed(4)}`);
    }
    assert.deepEqual(torn, [], `coincident vertices took different heights: ${torn.join(', ')}`);
  });

  test('CONTROL — the tearing stencil can see tearing when it is there', () => {
    // The old rule, run on the shape it damaged most, through the same
    // measurement. If this stops reporting a spread the stencil above has
    // stopped meaning anything.
    const g    = build('tetrahedron');
    const base = pristineOf(g);
    const pos  = g.attributes.position;
    const { hf } = fieldFor(pos.count);
    for (let i = 0; i < pos.count; i++) pos.setY(i, hf[i] ?? 0);   // the old code, verbatim

    const seen = new Map();
    let spread = 0;
    for (let i = 0; i < pos.count; i++) {
      const k = `${base[i * 3].toFixed(6)},${base[i * 3 + 1].toFixed(6)},${base[i * 3 + 2].toFixed(6)}`;
      const y = pos.getY(i);
      const p = seen.get(k);
      if (p === undefined) seen.set(k, y);
      else spread = Math.max(spread, Math.abs(y - p));
    }
    assert.ok(spread > 1, `the stencil no longer detects the defect it was built for (spread ${spread})`);
  });

  test('every vertex is fed — nothing past gridSize squared is pinned flat', () => {
    // `heightField[i] ?? 0` read as insurance and worked as a silent truncation:
    // the field is gridSize^2 long, the loop runs to pos.count, and three's
    // vertex order is per-face, so the unfed tail was CONTIGUOUS — on box, two
    // whole rows of the -Z face sitting at y = 0 while everything around them
    // moved.
    const unfed = [];
    for (const shape of SHAPE_NAMES) {
      const g    = build(shape);
      const base = pristineOf(g);
      const pos  = g.attributes.position;
      const grid = Math.round(Math.sqrt(pos.count));
      const c    = 1.75;
      applyHeightField(g, new Float32Array(grid * grid).fill(c), base, EXTENT);

      let bad = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs((pos.getY(i) - base[i * 3 + 1]) - c) > 1e-5) bad++;
      }
      if (bad) unfed.push(`${shape} ${bad}/${pos.count}`);
    }
    assert.deepEqual(unfed, [], `vertices that did not take the constant field: ${unfed.join(', ')}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two things the file above never touched, both of them on the app's own path.
//
//   • Every call in it passes a base, so applyHeightField's NO-BASE branch —
//     the one its docstring promises never falls back to the old index
//     identity — was uncovered by the file that owns the sampling contract.
//     Reverting exactly that branch left this file 5/5 green (round-10 matrix
//     row A4; caught only by surface-plumbing and, incidentally, colour-ramp).
//   • Every call also passes an extent, so the DEFAULT was pinned by nothing,
//     while the app relies on it: math-visualizer applies the field with three
//     arguments and generates it with an explicit half-width, and the two
//     agreed only because two numbers in different files happened to match.
//     Moving the default left this file green too (row A24).
describe('the paths the app takes and the guards above do not', () => {

  test('with no base, the field is added to zero — never the old index identity', () => {
    // A CONSTANT field first: exact, and it is what the `heightField[i] ?? 0`
    // fallback gets wrong most visibly. The field is grid^2 long and the loop
    // runs to pos.count, so under the identity every vertex past the end of the
    // array sits at 0 while the rest sit at c.
    const c = 1.75;
    const flat = [];
    for (const shape of SHAPE_NAMES) {
      const g   = build(shape);
      const pos = g.attributes.position;
      const grid = Math.round(Math.sqrt(pos.count));
      applyHeightField(g, new Float32Array(grid * grid).fill(c), null, EXTENT);
      let bad = 0;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) !== Math.fround(c)) bad++;
      if (bad) flat.push(`${shape} ${bad}/${pos.count}`);
    }
    assert.deepEqual(flat, [],
      `with no base every vertex must sit at the constant field: ${flat.join(', ')}`);

    // …and a field with no flat region and no symmetry, so a PERMUTATION of it
    // cannot pass for the thing itself. This is the half that fails under the
    // index identity on every shape whose vertex order is not the lattice.
    const weak = [];
    for (const shape of SHAPE_NAMES) {
      const g    = build(shape);
      const pos  = g.attributes.position;
      const { hf } = fieldFor(pos.count);
      applyHeightField(g, hf, null, EXTENT);
      const drawn = [], wanted = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        if (Math.abs(x) > EXTENT || Math.abs(z) > EXTENT) continue;
        drawn.push(pos.getY(i));
        wanted.push(F(x, z));
      }
      const r = pearson(drawn, wanted);
      if (drawn.length >= 32 && !(r > 0.99)) weak.push(`${shape} r=${Number(r).toFixed(3)}`);
    }
    assert.deepEqual(weak, [],
      `the no-base path is not drawing the field it was given: ${weak.join(', ')}`);
  });

  test('the census MATHEMATICAL_ACCURACY.md publishes is the census this tree produces', () => {
    // A number in that document had been written three ways across this round —
    // "ten and eight", then "eight and ten", then back — because each revision
    // was measured in a private sandbox and none of them had a home here. This
    // is the home. Per the document's own rule for numbers in comments, the
    // conditions are named and they are the ones the sentence names:
    //
    //   geometry   the real RenderEngine.setShape, desktop planeSegs 160
    //   grid       round(sqrt(vertexCount)) — the shape's own grid
    //   field      f = sin(1.3x) + cos(0.9z) + 0.2xz via generateSurfaceFromFormula
    //   vertices   ALL of them, including those outside the domain. The two
    //              tests above deliberately drop those, because they ask a
    //              different question; the document does not, so neither does
    //              this. Measuring the same shapes on the two bases gives two
    //              different tables, which is exactly how a number ends up
    //              unreproducible.
    //   threshold  "1.000000" means r >= 0.9999995, i.e. what rounds to six
    //              nines. Only plane and octahedron read a bit-exact 1.
    let ones = 0, near = 0;
    const below = [];
    for (const shape of SHAPE_NAMES) {
      const g    = build(shape);
      const pos  = g.attributes.position;
      const base = pristineOf(g);
      const { hf } = fieldFor(pos.count);
      applyHeightField(g, hf, base, EXTENT);

      const drawn = [], wanted = [];
      for (let i = 0; i < pos.count; i++) {
        drawn.push(pos.getY(i) - base[i * 3 + 1]);
        wanted.push(F(base[i * 3], base[i * 3 + 2]));
      }
      const r = pearson(drawn, wanted);
      if (r >= 0.9999995) ones++;
      else if (r >= 0.997) near++;
      else below.push(`${shape} ${Number(r).toFixed(3)}`);
      g.dispose();
    }
    assert.equal(ones, 9, `the document says nine shapes round to 1.000000; this tree gives ${ones}`);
    assert.equal(near, 9, `the document says nine more clear 0.997; this tree gives ${near}`);
    assert.deepEqual(below, ['tetrahedron 0.407', 'star 0.954'],
      'the document names exactly these two as falling short, with these values');
  });

  test('CONTROL — that census is not something every rule produces', () => {
    // Without this the census above could be read as "any sane implementation
    // scores like that". It cannot: the rule this round replaced scores nothing
    // like it, on the identical basis.
    let ones = 0, near = 0, belowCount = 0;
    for (const shape of SHAPE_NAMES) {
      const g    = build(shape);
      const pos  = g.attributes.position;
      const base = pristineOf(g);
      const { hf } = fieldFor(pos.count);
      for (let i = 0; i < pos.count; i++) pos.setY(i, hf[i] ?? 0);   // the old index identity

      const drawn = [], wanted = [];
      for (let i = 0; i < pos.count; i++) {
        drawn.push(pos.getY(i));
        wanted.push(F(base[i * 3], base[i * 3 + 2]));
      }
      const r = pearson(drawn, wanted);
      if (r >= 0.9999995) ones++;
      else if (r >= 0.997) near++;
      else belowCount++;
      g.dispose();
    }
    assert.ok(belowCount >= 15,
      `the index identity should fail almost every shape on this basis; only ${belowCount} of ` +
      `${SHAPE_NAMES.length} fell short (${ones} at 1.000000, ${near} above 0.997)`);
  });

  test('CONTROL — the same stencil DOES report the index identity', () => {
    // Sensitivity, on the same shape and the same measurement: if this stops
    // failing, the test above has stopped meaning anything. 'box' because
    // three's per-face vertex order is nothing like the lattice.
    const g   = build('box');
    const pos = g.attributes.position;
    const { hf } = fieldFor(pos.count);
    for (let i = 0; i < pos.count; i++) pos.setY(i, hf[i] ?? 0);   // the old rule, verbatim
    const drawn = [], wanted = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x) > EXTENT || Math.abs(z) > EXTENT) continue;
      drawn.push(pos.getY(i));
      wanted.push(F(x, z));
    }
    assert.ok(drawn.length >= 32, `precondition: only ${drawn.length} vertices inside the lattice`);
    const r = pearson(drawn, wanted);
    assert.ok(!(r > 0.99),
      `the index identity correlates at r=${Number(r).toFixed(3)} on the box, so the stencil ` +
      'above cannot tell the two apart');
  });

  test('the app calls it with three arguments; the default extent is the one it means', () => {
    // src/math-visualizer.js applies the field as applyHeightField(geo, hf,
    // base) — no fourth argument. Nothing exercised that arity until now.
    for (const shape of ['pyramid-smooth', 'sphere', 'box']) {
      const a = build(shape), b = build(shape);
      const baseA = pristineOf(a), baseB = pristineOf(b);
      const { hf } = fieldFor(a.attributes.position.count);
      applyHeightField(a, hf, baseA);                    // the app's own arity
      applyHeightField(b, hf, baseB, FIELD_EXTENT);      // spelled out
      const pa = a.attributes.position, pb = b.attributes.position;
      let differing = 0;
      for (let i = 0; i < pa.count; i++) if (!Object.is(pa.getY(i), pb.getY(i))) differing++;
      assert.equal(differing, 0,
        `${shape}: the defaulted call and the explicit one drew different surfaces in ` +
        `${differing} of ${pa.count} vertices`);
    }
    assert.equal(FIELD_EXTENT, EXTENT,
      `this file measures at ${EXTENT}; the module's own half-width is ${FIELD_EXTENT}`);
  });

  test('every extent in the chain is the same number, or the surface is silently rescaled', () => {
    // The field is generated on a lattice of half-width E and then sampled on
    // the mesh at half-width E. A mismatch does not throw: it draws the right
    // function at the wrong scale, on the right geometry, which is the failure
    // mode this whole family of bugs is made of. Three of the four sites are in
    // files this test does not own, so it reads them.
    const read = rel => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
    const sites = [];
    const take = (file, src, re, what) => {
      const m = src.match(re);
      assert.ok(m, `precondition: cannot find ${what} in src/${file} — this guard has gone ` +
        `stale and would pass on anything; ${re}`);
      sites.push({ where: `${file}: ${what}`, token: m[1] });
    };
    const vis = read('math-visualizer.js');
    // Whitespace carries nothing in JavaScript, so it must carry nothing here
    // either: `extent : 3.5,` and `…, (t))` are the same code, and the first
    // draft of these two patterns went red on both while reporting that the
    // guard had "gone stale". A guard that fails on a space and blames the
    // source is how source ends up written for the guard.
    take('math-visualizer.js', vis, /extent\s*:\s*([A-Za-z_0-9.]+)\s*,/,
      'the extent posted to the worker');
    take('math-visualizer.js', vis,
      /generateSurfaceFromFormula\([^;]*?,\s*([A-Za-z_0-9.]+)\s*,\s*\(?\s*t\s*\)?\s*\)/,
      'the extent of the synchronous fallback');
    // The worker's destructuring default is OPTIONAL. Dropping it is the
    // stronger fix — a message that omits the extent would then fail loudly
    // instead of silently rescaling — so its absence must not be a failure
    // here. What must not happen is a default that is a different number.
    const wk = read('math-worker.js');
    assert.match(wk, /\bextent\b/,
      'precondition: src/math-worker.js no longer mentions an extent at all, so this guard is ' +
      'reading a chain that has moved');
    const wm = wk.match(/\bextent\s*=\s*([A-Za-z_0-9.]+)/);
    if (wm) sites.push({ where: "math-worker.js: the worker's default extent", token: wm[1] });

    const wrong = sites.filter(s =>
      s.token !== 'FIELD_EXTENT' && Number(s.token) !== FIELD_EXTENT);
    assert.deepEqual(wrong.map(s => `${s.where} = ${s.token}`), [],
      `FIELD_EXTENT is ${FIELD_EXTENT}; these sites disagree with it, so the field is generated ` +
      'at one half-width and sampled at another and the drawn surface is rescaled against the ' +
      'mesh it is drawn on — with nothing thrown and no test failing');
  });
});
