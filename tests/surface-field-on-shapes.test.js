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
    // Ten and eight since `pyramid` was meshed across its faces: it read
    // 0.999966 on 423 vertices standing on two lines, and reads 0.9999998 on
    // the 6883 it has now. The body is the same one — same planes, same box,
    // same volume — so this pair moving is a fact about the sampling, not about
    // the shape. See snapRingsToPolygon in src/render.js.
    //
    // Sixteen and nine since the six parametric surfaces arrived: five of them
    // land on 1.000000 and one on the 0.997 shelf. That is the answer worth
    // having from this census — a body that no height field can BE still takes
    // a height field faithfully, because the field is applied along the normal
    // and does not care how the body was authored. The two that fall short are
    // still the same two, with the same values.
    assert.equal(ones, 16, `the document says sixteen shapes round to 1.000000; this tree gives ${ones}`);
    assert.equal(near, 9, `the document says nine more clear 0.997; this tree gives ${near}`);
    assert.deepEqual(below, ['tetrahedron 0.407', 'star 0.954'],
      'the document names exactly these two as falling short, with these values');
  });

  test('the grid list MATHEMATICAL_ACCURACY.md publishes is the one this tree produces', () => {
    // The document names every `gridSize` the catalogue can produce, and until
    // this test the list was kept by hand. It had drifted: the revision before
    // this one published 22 values including 9 and 13, which NO shape produced
    // on either configuration — walking the tree at 5d13eeb gives 20. A list
    // maintained by hand in a file that also states three times over what the
    // odd ones are is a list that will drift again, so it gets a home here.
    //
    // Both configurations, because the document's list is the union: `lo` and
    // `planeSegs` both move with isMobile, and half these values exist only on
    // one side (43 and 45 are mobile-only, 83 and 114 desktop-only).
    const grids = new Set();
    for (const isMobile of [false, true]) {
      for (const shape of SHAPE_NAMES) {
        const stage = Object.create(RenderEngine.prototype);
        Object.assign(stage, {
          CFG: { planeSegs: isMobile ? 80 : 160, planeSize: 7 },
          isMobile,
          isShapeChanging: false, pendingShape: null, currentShape: null,
          gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) },
          gpuPtsProxy: null,
          clearSolarSystem() {}, _buildSolarSystem() {}, cb: null,
        });
        stage.setShape(shape);
        // The same expression MathVisualizer uses — five places in that file,
        // all of them `Math.round(Math.sqrt(pos.count))`.
        grids.add(Math.round(Math.sqrt(stage.gpuMesh.geometry.attributes.position.count)));
      }
    }
    const produced = [...grids].sort((a, b) => a - b);

    // Same idiom the shader-source check at the foot of this file uses: this
    // file has no path helper, and a URL relative to the module cannot go stale.
    const doc = readFileSync(new URL('../MATHEMATICAL_ACCURACY.md', import.meta.url), 'utf8');
    const m = doc.match(/\*\*(\d+) distinct grids — ([\d,\s]+)\*\*/);
    assert.ok(m, 'the document no longer publishes a grid list in the form this test reads');
    const published = m[2].split(',').map(s => Number(s.trim())).sort((a, b) => a - b);

    assert.deepEqual(produced, published,
      `the document publishes ${published.join(', ')}; this tree produces ${produced.join(', ')}`);
    assert.equal(Number(m[1]), produced.length,
      `the document counts ${m[1]} grids and then lists ${produced.length}`);
    // The sentence also states the parity split, and that is the half that went
    // stale silently last time — the count was right while the members were not.
    // The word table used to stop at "thirteen", which was every count the
    // catalogue could reach when it was written. The six parametric surfaces
    // took the split to fifteen and sixteen, and `words[15]` was `undefined` —
    // so the regexp became `** — undefined odd and undefined even` and the test
    // failed while BOTH the document and the tree were right. A guard that
    // cannot express the answer is not a stricter guard, it is a broken one.
    const words = ('zero one two three four five six seven eight nine ten eleven twelve thirteen ' +
                   'fourteen fifteen sixteen seventeen eighteen nineteen twenty').split(' ');
    const odd = produced.filter(g => g % 2).length;
    const even = produced.length - odd;
    assert.ok(words[odd] && words[even],
      `this split is ${odd}/${even} and the word table only reaches ${words.length - 1} — extend it ` +
      'rather than loosening the match');
    assert.match(doc, new RegExp(`\\*\\* — ${words[odd]} odd and ${words[even]} even`),
      `this tree gives ${odd} odd and ${even} even grids; the sentence after the list disagrees`);
  });

  test('a faceted body has interior vertices for the field to move', async () => {
    // The census above scores how FAITHFULLY a shape draws a field. This asks
    // the question under it: whether the shape has anywhere to draw one at all.
    // `pyramid` did not. Built as CylinderGeometry(…, 4, lo) its 423 vertices
    // stood on the two lines x = 0 and z = 0 — a face had two bounding edges
    // and no interior sample — so the height field could vary along the four
    // rays and nowhere across a face.
    //
    // `rule90` is the probe because it is the case where "nearly invisible"
    // became exactly nothing: the field lattice was round(√423) = 21, x = 0 is
    // the automaton's seed column and its centre cell C(g, g/2) is even for
    // every g ≥ 1, and z = 0 is generation 17, whose live cells sit at 15, 17,
    // 47, 49 of 64 and a 21-node lattice steps over all four. Both sampled
    // lines dead, one constant, and the pyramid sank as a rigid body.
    const { getFormula } = await import('../src/math-collections.js');
    const rule90 = getFormula('cellularAutomata', 'rule90');

    const heights = (geo) => {
      const pos  = geo.attributes.position;
      const base = pristineOf(geo);
      const grid = Math.round(Math.sqrt(pos.count));
      applyHeightField(
        geo, generateSurfaceFromFormula(rule90.f, { amp: 0.7 }, grid, EXTENT, 0),
        base, EXTENT);
      const levels = new Set();
      let lifted = 0;
      for (let i = 0; i < pos.count; i++) {
        const h = pos.getY(i) - base[i * 3 + 1];
        levels.add(h.toFixed(4));
        if (h > 0.1) lifted++;                       // the automaton's live level is +0.4·amp
      }
      return { levels: levels.size, lifted, count: pos.count };
    };

    const now = heights(build('pyramid'));
    assert.ok(now.levels > 1,
      `rule90 draws ${now.levels} distinct heights on pyramid; a body that draws one is drawing nothing`);
    // 11.6 % of the automaton's own cells are live, and the shape's footprint is
    // a diamond inside the square domain, so the two figures do not have to
    // match — but a shape carrying the pattern cannot be an order off it.
    assert.ok(now.lifted / now.count > 0.05,
      `only ${(100 * now.lifted / now.count).toFixed(1)} % of pyramid vertices reach the live level`);

    // CONTROL, and this is the half that makes the assertions above mean
    // something: the geometry this replaced fails them, on the identical probe.
    const before = heights(new THREE.CylinderGeometry(0.001, 3.2, 5, 4, 80));
    assert.equal(before.levels, 1,
      'the four-column pyramid is supposed to read exactly one height — if it does not, ' +
      'this control is no longer measuring the defect the test is named for');
    assert.equal(before.lifted, 0);

    // …and the repair added vertices without moving the body. Same four planes,
    // same box, same volume — measured rather than asserted by construction,
    // because "more vertices" is one edit away from "different shape".
    const volume = (geo) => {
      const p = geo.attributes.position, idx = geo.index;
      const tris = idx ? idx.count / 3 : p.count / 3;
      let v = 0;
      for (let t = 0; t < tris; t++) {
        const i = idx ? [idx.getX(3*t), idx.getX(3*t+1), idx.getX(3*t+2)] : [3*t, 3*t+1, 3*t+2];
        const a = [p.getX(i[0]), p.getY(i[0]), p.getZ(i[0])];
        const b = [p.getX(i[1]), p.getY(i[1]), p.getZ(i[1])];
        const c = [p.getX(i[2]), p.getY(i[2]), p.getZ(i[2])];
        v += (a[0]*(b[1]*c[2] - b[2]*c[1]) - a[1]*(b[0]*c[2] - b[2]*c[0])
                                           + a[2]*(b[0]*c[1] - b[1]*c[0])) / 6;
      }
      return Math.abs(v);
    };
    const box = (geo) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      return [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z].map(v => +v.toFixed(6));
    };
    const drawn = build('pyramid');
    const was   = new THREE.CylinderGeometry(0.001, 3.2, 5, 4, 80);
    assert.deepEqual(box(drawn), box(was), 'the meshed pyramid does not occupy the same box');
    assert.ok(Math.abs(volume(drawn) - volume(was)) < 1e-3,
      `volume moved: ${volume(drawn).toFixed(4)} against ${volume(was).toFixed(4)}`);
    assert.equal(drawn.attributes.position.count, 6883);

    // And the section is still a SQUARE, which is the property the other three
    // assertions cannot see on their own. The corners sit on the axes, so the
    // cross-section at height y is the diamond |x| + |z| = r(y); a body left as
    // an 80-gon, or snapped onto one with any other corner count, fails this by
    // seven orders of magnitude while passing the box unchanged.
    //
    // The three are complementary rather than redundant, and the numbers say
    // which catches what: a cone or an octagon reads 1.325 here and 34.14 →
    // 53.58 / 48.29 on volume, but an identical box; a snap onto 4 corners with
    // a segment count that is not a multiple of 4 reads 2.3e-7 here — the
    // vertices still land on the square's EDGES, only the corners go unclaimed —
    // and is caught by the box instead (max x 2.977 against 3.2).
    const rAt = y => 3.2 + (0.001 - 3.2) * (y + 2.5) / 5;
    const pos = drawn.attributes.position;
    let offSquare = 0, onSection = 0;
    for (let i = 0; i < pos.count; i++) {
      const s = Math.abs(pos.getX(i)) + Math.abs(pos.getZ(i));
      if (s < 1e-6) continue;                       // the axis: cap centres
      onSection++;
      offSquare = Math.max(offSquare, Math.abs(s - rAt(pos.getY(i))));
    }
    assert.ok(onSection > 6000, `only ${onSection} vertices are off the axis to measure`);
    assert.ok(offSquare < 1e-5,
      `the section is not a square: worst |(|x|+|z|) - r(y)| is ${offSquare.toExponential(3)}`);
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
