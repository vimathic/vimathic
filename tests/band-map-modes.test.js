// tests/band-map-modes.test.js
//
// The band character map has to describe the picture the MODE is drawing.
//
// Run:
//   node --test tests/band-map-modes.test.js
//
// ── The defect these pin ─────────────────────────────────────────────────────
// The owner's report: "при смене SURF на COLLAPSE на некоторых формулах
// Spectrum Rings не изменяют формы, а остаются как SURF". Two causes, both in
// this file's blast radius:
//
//   1. setMode() did not invalidate the map, so a switch kept the layout built
//      for the mode being left;
//   2. _rebuildBandMap() only knew ONE reading of a kernel — as a height field
//      over (x, z) — while COLLAPSE evaluates the same kernel as f(theta, phi)
//      about the body's centroid. So even a rebuild produced the SURFACE
//      layout again, and fixing (1) alone would have changed nothing.
//
// ── Why the numbers below are the ones asserted ──────────────────────────────
// Both maps are histogram-equalised, so u is uniform on [0, 1] and two
// INDEPENDENT maps of one body sit E|X-Y|*23 = 23/3 = 7.67 bands apart.
// Measured before the fix (~/notes/vimathic-collapse-band-probe.mjs, over
// sphere/torus/cylinder/plane and five kernels): 6.9 to 8.9. That is not
// "different", it is unrelated — the map COLLAPSE wore was as informative about
// its own picture as a different formula's map would have been (the probe's own
// control read 7.41 for two different kernels, 7.64 for a shuffled map).
//
// The sharpest reading is two-sidedness, and it is the one asserted hardest:
// (x, z) is a PROJECTION, so the north and the south of a closed body share it.
// On the sphere all 6339 vertex pairs that share an (x, z) column but sit on
// opposite sides landed in the SAME band, while the collapse field itself
// differs between the two sides by 0.458 world units on average. The rings
// could not tell the two halves of the body apart; the mode's own displacement
// always could.
//
// Every assertion here carries a CONTROL in the same shape — a measure that
// must read zero, or must fire on a case known to be positive — because the
// quantity is a difference and a broken difference reads as "fixed".

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBandMap, sampleLattice, radialU, ANALYSIS_GRID, buildBodyCurvature,
} from '../src/band-map.js';
import { BAND_MAP_REF_TIME } from '../src/math-visualizer.js';
import {
  getFormula, generateSurfaceFromFormula, generateCollapseScalarField,
  generateCollapseAnalysisField, collapseChart, collapseChartToAnalysis,
  collapseAnalysisToChart, FIELD_EXTENT,
} from '../src/math-collections.js';

// The class under test in the last block builds a Worker in its constructor.
// A stub that records and never answers is enough: nothing here drives a tick,
// and the alternative — leaving Worker undefined — makes the constructor warn
// on the console for a channel no assertion depends on.
globalThis.Worker = class { postMessage() {} terminate() {} };

let THREE, MathVisualizer;
before(async () => {
  THREE = await import('three');
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
});

const P = { amp: 1, freq: 1, comp: 0.5 };
const T = BAND_MAP_REF_TIME;
const G = ANALYSIS_GRID;
const E = FIELD_EXTENT;
const LAST_BAND = 23;                       // 24 bands, so u * 23 is the band

/** Mean distance between two band layouts, in bands of 24. */
function bandsApart(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]) * LAST_BAND;
  return s / a.length;
}

function verticesOf(geo) {
  const pos = geo.attributes.position.array;
  const base = Float32Array.from(pos);
  const V = base.length / 3;
  const x = new Float32Array(V), z = new Float32Array(V);
  for (let i = 0; i < V; i++) { x[i] = base[i * 3]; z[i] = base[i * 3 + 2]; }
  const nrm = geo.attributes.normal ? Float32Array.from(geo.attributes.normal.array) : null;
  const k = nrm ? buildBodyCurvature(base, nrm, geo.index?.array ?? null) : null;
  return { base, x, z, k, R: E };
}

/** The map as SURFACE builds it — the shipped path, untouched by this change. */
function surfaceMap(fn, v) {
  const field = generateSurfaceFromFormula(fn, P, G, E, T);
  return buildBandMap(field, G, E, { x: v.x, z: v.z, R: v.R, k: v.k });
}

/** The map as COLLAPSE builds it — kernel read on its own chart. */
function collapseMap(fn, v) {
  const field = generateCollapseAnalysisField(fn, P, G, T);
  const { theta, phi } = collapseChart(v.base);
  const V = v.x.length;
  const ax = new Float32Array(V), az = new Float32Array(V);
  for (let i = 0; i < V; i++) {
    const [a, b] = collapseChartToAnalysis(theta[i], phi[i], E);
    ax[i] = a; az[i] = b;
  }
  return buildBandMap(field, G, E, { x: v.x, z: v.z, R: v.R, k: v.k, ax, az });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the chart COLLAPSE reads a kernel on is one chart', () => {

  test('collapseChart hands back exactly the angles the field is evaluated at', () => {
    const geo = new THREE.SphereGeometry(3.5, 24, 24);
    const base = Float32Array.from(geo.attributes.position.array);
    const { theta, phi } = collapseChart(base);

    // generateCollapseScalarField calls fn(theta, phi, …). Two probe kernels
    // that return their own arguments therefore reproduce the chart — if the
    // two ever spelled the chart differently, these would disagree.
    const th = generateCollapseScalarField((a) => a, P, base, T);
    const ph = generateCollapseScalarField((_a, b) => b, P, base, T);

    assert.equal(th.length, theta.length);
    for (let i = 0; i < th.length; i++) {
      assert.equal(th[i], theta[i], `theta differs at vertex ${i}`);
      assert.equal(ph[i], phi[i],   `phi differs at vertex ${i}`);
    }
  });

  test('control — the probe kernels do vary, so agreement is not two constants', () => {
    const geo = new THREE.SphereGeometry(3.5, 24, 24);
    const base = Float32Array.from(geo.attributes.position.array);
    const { theta, phi } = collapseChart(base);
    const spread = a => Math.max(...a) - Math.min(...a);
    assert.ok(spread(theta) > 6, `theta spans ${spread(theta)}, expected ~2pi`);
    assert.ok(spread(phi)   > 3, `phi spans ${spread(phi)}, expected ~pi`);
  });

  test('the reusable buffers are filled, and a wrong-length pair is not half-used', () => {
    // The per-frame path hands collapseChart a scratch pair rather than
    // allocating two Float32Arrays of the vertex count every frame — 1.6 MB a
    // call on the largest body. What must not follow is a buffer of the wrong
    // length being written into, which would silently truncate the chart.
    const geo = new THREE.SphereGeometry(3.5, 16, 16);
    const base = Float32Array.from(geo.attributes.position.array);
    const N = base.length / 3;

    const fresh = collapseChart(base);
    const mine = { theta: new Float32Array(N), phi: new Float32Array(N) };
    const filled = collapseChart(base, mine);
    assert.ok(filled.theta === mine.theta, 'the caller’s buffer was not used');
    assert.ok(filled.phi === mine.phi);
    assert.deepEqual(Array.from(filled.theta), Array.from(fresh.theta));

    const wrong = { theta: new Float32Array(3), phi: new Float32Array(3) };
    const safe = collapseChart(base, wrong);
    assert.equal(safe.theta.length, N, 'a short buffer was written into anyway');
    assert.ok(safe.theta !== wrong.theta);
    assert.deepEqual(Array.from(safe.theta), Array.from(fresh.theta));
  });

  test('the shared scratch survives a change of body size', () => {
    // The per-frame path keeps ONE scratch pair for the whole module, and the
    // app changes vertex count under it — a shape swap, and the points proxy
    // when it owns geometry. A scratch that resized only on growth would leave
    // the tail of a bigger body's chart in a smaller one's field.
    const big = Float32Array.from(new THREE.SphereGeometry(3.5, 24, 24).attributes.position.array);
    const small = Float32Array.from(new THREE.SphereGeometry(3.5, 8, 8).attributes.position.array);
    const probe = (_th, ph) => ph;

    const smallAlone = generateCollapseScalarField(probe, P, small, T);
    generateCollapseScalarField(probe, P, big, T);          // …now poison the scratch
    const smallAfter = generateCollapseScalarField(probe, P, small, T);

    assert.deepEqual(Array.from(smallAfter), Array.from(smallAlone));
    // …and the other order, so neither direction is the untested one.
    const bigAlone = generateCollapseScalarField(probe, P, big, T);
    generateCollapseScalarField(probe, P, small, T);
    assert.deepEqual(Array.from(generateCollapseScalarField(probe, P, big, T)), Array.from(bigAlone));
  });

  test('a vertex at (theta, phi) reads the lattice cell evaluated at (theta, phi)', () => {
    // A lattice whose every cell carries its own index, read back through the
    // very function buildBandMap uses. This is the inverse pinned rather than
    // argued: chart -> analysis coordinate -> lattice cell has to close.
    const field = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) field[j * G + i] = i + j * 1000;

    for (const j of [0, 1, 7, 32, G - 2, G - 1]) {
      for (const i of [0, 1, 7, 32, G - 2, G - 1]) {
        const [theta, phi] = collapseAnalysisToChart(i, j, G);
        const [ax, az] = collapseChartToAnalysis(theta, phi, E);
        const read = sampleLattice(field, G, E, ax, az);
        assert.ok(Math.abs(read - (i + j * 1000)) < 1e-3,
          `cell (${i},${j}) read back as ${read}`);
      }
    }
  });

  test('the analysis field is the kernel evaluated at those same angles', () => {
    const f = (th, ph) => th * 3 + ph;
    const field = generateCollapseAnalysisField(f, P, G, T);
    for (const j of [0, 5, 33, G - 1]) {
      for (const i of [0, 5, 33, G - 1]) {
        const [theta, phi] = collapseAnalysisToChart(i, j, G);
        assert.ok(Math.abs(field[j * G + i] - Math.fround(theta * 3 + phi)) < 1e-4,
          `cell (${i},${j})`);
      }
    }
  });

  test('the chart covers its whole domain and nothing outside the lattice', () => {
    // Every angle the chart can produce has to land inside [-extent, extent],
    // or sampleLattice would clamp a real part of the body onto the rim — the
    // "rings on the edge" half of the complaint, one level down.
    for (const theta of [-Math.PI, -1.3, 0, 1.3, Math.PI]) {
      for (const phi of [0, 0.4, Math.PI / 2, 2.9, Math.PI]) {
        const [ax, az] = collapseChartToAnalysis(theta, phi, E);
        assert.ok(ax >= -E - 1e-6 && ax <= E + 1e-6, `theta ${theta} -> ax ${ax}`);
        assert.ok(az >= -E - 1e-6 && az <= E + 1e-6, `phi ${phi} -> az ${az}`);
      }
    }
    // …and the two ends of each range reach the two ends of the lattice, so no
    // part of it is left unused.
    assert.deepEqual(collapseChartToAnalysis(-Math.PI, 0, E), [-E, -E]);
    assert.deepEqual(collapseChartToAnalysis(Math.PI, Math.PI, E), [E, E]);
  });

  test('the mapping fills a caller-owned pair, and allocates one when it is not given', () => {
    // The map builder passes one array for the whole vertex loop rather than
    // one per vertex. What must not follow is a shared default that carries a
    // previous answer into a caller that omitted it.
    const mine = [9, 9];
    const back = collapseChartToAnalysis(Math.PI, Math.PI, E, mine);
    assert.ok(back === mine, 'the caller’s array was not the one filled');
    assert.deepEqual(mine, [E, E]);

    const a = collapseChartToAnalysis(0, 0, E);
    const b = collapseChartToAnalysis(0, 0, E);
    assert.ok(a !== b, 'two calls without `out` shared one array');
    assert.deepEqual(a, [0, -E]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the surface path is untouched', () => {

  test('omitting ax/az is the same map as passing x/z', () => {
    const geo = new THREE.SphereGeometry(3.5, 24, 24);
    const v = verticesOf(geo);
    const field = generateSurfaceFromFormula(getFormula('fractals', 'mandelbrot').f, P, G, E, T);
    const a = buildBandMap(field, G, E, { x: v.x, z: v.z, R: v.R, k: v.k });
    const b = buildBandMap(field, G, E, { x: v.x, z: v.z, R: v.R, k: v.k, ax: v.x, az: v.z });
    assert.deepEqual(Array.from(a.u), Array.from(b.u));
    assert.deepEqual(a.stages, b.stages);
  });

  test('an ax of the wrong length is ignored rather than half-applied', () => {
    const geo = new THREE.SphereGeometry(3.5, 16, 16);
    const v = verticesOf(geo);
    const field = generateSurfaceFromFormula(getFormula('fractals', 'julia').f, P, G, E, T);
    const a = buildBandMap(field, G, E, { x: v.x, z: v.z, R: v.R, k: v.k });
    const b = buildBandMap(field, G, E, {
      x: v.x, z: v.z, R: v.R, k: v.k, ax: new Float32Array(3), az: new Float32Array(3),
    });
    assert.deepEqual(Array.from(a.u), Array.from(b.u));
  });

  test('control — ax/az DO move the map when they are the right length', () => {
    // Otherwise the two tests above would pass on a parameter that is ignored
    // outright, which is the failure they are meant to exclude.
    const geo = new THREE.SphereGeometry(3.5, 16, 16);
    const v = verticesOf(geo);
    const field = generateSurfaceFromFormula(getFormula('fractals', 'julia').f, P, G, E, T);
    const a = buildBandMap(field, G, E, { x: v.x, z: v.z, R: v.R, k: v.k });
    const flip = Float32Array.from(v.z), flop = Float32Array.from(v.x);
    const b = buildBandMap(field, G, E, { x: v.x, z: v.z, R: v.R, k: v.k, ax: flip, az: flop });
    assert.ok(bandsApart(a.u, b.u) > 0.5,
      `swapping the analysis axes moved the map by ${bandsApart(a.u, b.u).toFixed(3)} bands`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('COLLAPSE gets its own layout, not the surface one', () => {

  // Five kernels of different character: a fractal, a genuinely radial special
  // function, a piecewise-constant automaton, one with structure in phi, and
  // one with structure in a single direction.
  const KERNELS = [
    ['fractals', 'mandelbrot'],
    ['specialFunctions', 'bessel0'],
    ['cellularAutomata', 'rule90'],
    ['quantumMechanics', 'hydrogen2p'],
    ['fourierSeries', 'squareWave'],
  ];

  const BODIES = {
    sphere:   () => new THREE.SphereGeometry(3.5, 40, 40),
    torus:    () => new THREE.TorusGeometry(2.8, 1.1, 32, 40),
    cylinder: () => new THREE.CylinderGeometry(2.5, 2.5, 5, 40, 32),
  };

  for (const [bodyName, make] of Object.entries(BODIES)) {
    test(`${bodyName}: every kernel lays the spectrum out differently in the two modes`, () => {
      const v = verticesOf(make());
      for (const [coll, key] of KERNELS) {
        const f = getFormula(coll, key);
        assert.ok(f, `${coll}:${key} is not in this build`);
        const S = surfaceMap(f.f, v);
        const C = collapseMap(f.f, v);
        const d = bandsApart(S.u, C.u);
        // 4 of 24, well under the 6.9 measured, so this asserts the DEFECT is
        // gone rather than pinning the exact numbers a kernel edit would move.
        assert.ok(d > 4,
          `${coll}:${key} on ${bodyName}: only ${d.toFixed(3)} bands apart`);
      }
    });
  }

  test('control — the same map against itself is exactly zero', () => {
    const v = verticesOf(BODIES.sphere());
    const f = getFormula('fractals', 'mandelbrot').f;
    assert.equal(bandsApart(surfaceMap(f, v).u, surfaceMap(f, v).u), 0);
    assert.equal(bandsApart(collapseMap(f, v).u, collapseMap(f, v).u), 0);
  });

  test('control — both maps are real layouts, not the radius rule in disguise', () => {
    // If either had fallen through the whole cascade they would BOTH be
    // radialU and the difference above would have to come from somewhere else.
    const v = verticesOf(BODIES.sphere());
    const f = getFormula('fractals', 'mandelbrot').f;
    for (const [name, m] of [['surface', surfaceMap(f, v)], ['collapse', collapseMap(f, v)]]) {
      assert.ok(m.conf > 0.5, `${name} map fell back to radius (conf ${m.conf})`);
      let ringLike = 0;
      for (let i = 0; i < m.u.length; i++) {
        if (Math.abs(m.u[i] - radialU(v.x[i], v.z[i], v.R)) * LAST_BAND < 1) ringLike++;
      }
      assert.ok(ringLike < m.u.length * 0.6,
        `${name} map is ${(100 * ringLike / m.u.length).toFixed(0)}% the plain radius rule`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the two sides of a closed body', () => {

  /** Vertex pairs sharing an (x, z) column but sitting on opposite sides. */
  function twoSidedPairs(base) {
    const N = base.length / 3;
    const cell = new Map();
    const q = value => Math.round(value * 40) / 40;
    for (let i = 0; i < N; i++) {
      const k = q(base[i * 3]) + '|' + q(base[i * 3 + 2]);
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push(i);
    }
    const out = [];
    for (const ids of cell.values()) {
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          if (Math.abs(base[ids[a] * 3 + 1] - base[ids[b] * 3 + 1]) < 0.4) continue;
          out.push([ids[a], ids[b]]);
        }
      }
    }
    return out;
  }

  test('the surface map cannot tell them apart, and the collapse map can', () => {
    const geo = new THREE.SphereGeometry(3.5, 40, 40);
    const v = verticesOf(geo);
    const pairs = twoSidedPairs(v.base);
    assert.ok(pairs.length > 500, `only ${pairs.length} two-sided pairs found`);

    const f = getFormula('fractals', 'mandelbrot').f;
    const S = surfaceMap(f, v).u, C = collapseMap(f, v).u;

    let sameUnderSurface = 0, differUnderCollapse = 0;
    for (const [i, j] of pairs) {
      if (Math.abs(S[i] - S[j]) * LAST_BAND < 1) sameUnderSurface++;
      if (Math.abs(C[i] - C[j]) * LAST_BAND >= 1) differUnderCollapse++;
    }
    // The projection is exact, so this is 100% and not a threshold in disguise;
    // asserted at 99 only to survive a body whose vertex quantisation differs.
    assert.ok(sameUnderSurface > pairs.length * 0.99,
      `${(100 * sameUnderSurface / pairs.length).toFixed(1)}% of pairs shared a band under the SURF map`);
    assert.ok(differUnderCollapse > pairs.length * 0.5,
      `only ${(100 * differUnderCollapse / pairs.length).toFixed(1)}% of pairs separate under the COLLAPSE map`);
  });

  test('control — the collapse field itself really does differ between the sides', () => {
    // Without this the test above would be asserting that a map separates
    // vertices the MODE treats identically, which would be a new defect rather
    // than a fix.
    const geo = new THREE.SphereGeometry(3.5, 40, 40);
    const v = verticesOf(geo);
    const pairs = twoSidedPairs(v.base);
    const s = generateCollapseScalarField(getFormula('fractals', 'mandelbrot').f, P, v.base, T);
    let gap = 0;
    for (const [i, j] of pairs) gap += Math.abs(s[i] - s[j]);
    gap /= pairs.length;
    assert.ok(gap > 0.05,
      `the collapse field separates the two sides by only ${gap.toFixed(4)} world units`);
  });

  test('control — a FLAT body has no two sides, so nothing is claimed about it', () => {
    const geo = new THREE.PlaneGeometry(7, 7, 40, 40);
    geo.rotateX(-Math.PI / 2);
    assert.equal(twoSidedPairs(Float32Array.from(geo.attributes.position.array)).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The wiring, through the class the app actually uses. This is the block that
// fails on the old tree: there, setMode() left the map alone AND the rebuild
// knew only one reading, so the layer handed back the identical `u` in both
// modes. Everything above measures the two maps; this measures whether the app
// ever asks for the right one.
describe('the app swaps the layout when the DEFORM mode changes', () => {

  function makeViz() {
    const geometry = new THREE.SphereGeometry(3.5, 40, 40);
    const render = {
      isMobile: false,
      U: {
        uMathMode: { value: 0 }, uMorphProgress: { value: 1 },
        uVHField: { value: 0 }, uBandR: { value: E },
      },
      gpuMesh: { geometry },
      gpuPtsProxy: null,
      cb: {},
    };
    const audio = {
      bass: 0.4, mid: 0.3, treble: 0.2, beatInt: 0, amp: 0.7, waveInt: 1,
      // The layer is only built when the slider is up and the character map is
      // wanted — both are the shipped defaults.
      bandDepth: 0.3,
      bandCharacter: true,
      bands: new Float32Array(24).fill(0.5),
      bandsShaped: new Float32Array(24).fill(0.5),
      bandPan: new Float32Array(24),
    };
    const viz = new MathVisualizer(render, audio);
    viz.onShapeChange();                       // pristine snapshot, as main.js does
    viz.setFormula('fractals', 'mandelbrot');
    return viz;
  }

  test('SURF and COLLAPSE hand the layer two different layouts', () => {
    const viz = makeViz();
    const surf = Float32Array.from(viz._bandLayer().u);

    viz.setMode('collapse');
    const coll = Float32Array.from(viz._bandLayer().u);

    assert.equal(surf.length, coll.length);
    const d = bandsApart(surf, coll);
    assert.ok(d > 4, `the layer did not change with the mode: ${d.toFixed(3)} bands apart`);
  });

  test('and going back gives the SURF layout back, bit for bit', () => {
    // A mode swap must be reversible: a layout that drifted every round trip
    // would break preset and clip reproducibility, which is the reason the map
    // is built at a frozen reference time in the first place.
    const viz = makeViz();
    const first = Float32Array.from(viz._bandLayer().u);
    viz.setMode('collapse');
    viz._bandLayer();
    viz.setMode('surface');
    const again = Float32Array.from(viz._bandLayer().u);
    assert.deepEqual(Array.from(again), Array.from(first));
  });

  test('control — asking twice in one mode is not a rebuild', () => {
    // The layer is read once for the mesh and once for the points proxy every
    // frame. If the mode guard fired on identity rather than on value it would
    // rebuild the map on every read, which is 4.8-17.1 ms of the frame.
    const viz = makeViz();
    const a = viz._bandLayer().u;
    const b = viz._bandLayer().u;
    assert.ok(a === b, 'the second read rebuilt the map');
  });

  test('control — the layer is genuinely on, so `u` is a map and not a fallback', () => {
    const viz = makeViz();
    const layer = viz._bandLayer();
    assert.ok(layer, 'the band layer is off in this harness');
    assert.ok(layer.u instanceof Float32Array, 'no character map was built');
    assert.equal(layer.u.length, viz._pristinePositions.length / 3);
  });
});
