// tests/shape-fallback-and-hf-once.test.js
//
// Two contracts from round 10, family E. They share a file because they share
// a harness (real prototype methods bound to a fake carrying only the fields
// they touch, the pattern of tests/particle-style.test.js); split at the
// describe boundary if that ever stops being true.
//
// Run:
//   node --test tests/shape-fallback-and-hf-once.test.js
//
// ── 1. A shape value this build cannot draw must not reach the geometry ──────
// Shape values arrive from places this build did not write: bootPersist()
// restores vimathic_persisted_state on every page open, importSettings() reads
// a file, clip steps carry whatever was saved into them. Before round 10 an
// unknown value fell through _buildShapeGeo's `default:` to a PlaneGeometry —
// and was NOT rotated, because the rotate list in setShape keys off the NAME.
// Measured: 161 distinct (x,z) sample points against the 25921 a real 'plane'
// gives, the picker showing '— select —', and no error anywhere. That
// '— select —' is real and was measured on the built app in Chromium — it is
// makeDropdown()'s placeholder, not an <option>; see the header of
// src/shapes.js. It stopped appearing when selectShape() took over the
// picker write; tests/shape-picker-agrees-with-engine.test.js guards that.
//
// ── 2. One height field must be written into one geometry once ──────────────
// gpuPtsProxy deliberately BORROWS gpuMesh.geometry, so _applyHF's two calls
// wrote the same Y values into the same buffer twice and ran
// computeVertexNormals twice, every frame in PTS mode. Measured on a
// phone-class VM: box 9.83 ms per _applyHF against a 16.7 ms frame budget,
// halving to 4.29 ms when the second write is skipped.
//
// Both suites carry a CONTROL that must NOT fire, because a stencil that
// cannot come back clean proves nothing.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// setShape disposes the previous geometry inside a rAF callback; run it
// straight away so the test does not depend on a frame ever arriving.
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (fn => { fn(); return 0; });

let RenderEngine, MathVisualizer, THREE;
before(async () => {
  ({ RenderEngine }   = await import('../src/render.js'));
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
  THREE = await import('three');
});

// ── Harness 1: setShape on a fake stage ─────────────────────────────────────
function makeStage() {
  const fake = Object.create(RenderEngine.prototype);
  Object.assign(fake, {
    CFG: { planeSegs: 160, planeSize: 7 },
    isMobile: false,
    isShapeChanging: false,
    pendingShape: null,
    currentShape: null,
    gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) },
    gpuPtsProxy: null,
    clearSolarSystem() {},
    cb: null,
  });
  return fake;
}

/** Vertex count, and the extent of the geometry along each axis. */
function shapeOf(fake) {
  const g = fake.gpuMesh.geometry;
  g.computeBoundingBox();
  const b = g.boundingBox;
  // `sec` — the widest |x| + |z| any vertex reaches, i.e. the cross-section
  // read in the one way a bounding box cannot read it. Added when `pyramid`
  // was meshed across its faces (snapRingsToPolygon in src/render.js) and its
  // vertex count and box became those of `pyramid-smooth` exactly: the four
  // fields above stopped telling the two apart, so a `default:` aimed at the
  // wrong one of them would have fallen back silently past this stencil. A
  // square section reaches its widest at a CORNER, on an axis, so sec is the
  // radius 3.2; a circular one reaches it at 45°, so sec is 3.2·√2 = 4.5255.
  let sec = 0;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) sec = Math.max(sec, Math.abs(p.getX(i)) + Math.abs(p.getZ(i)));
  return {
    verts: g.attributes.position.count,
    x: +(b.max.x - b.min.x).toFixed(4),
    y: +(b.max.y - b.min.y).toFixed(4),
    z: +(b.max.z - b.min.z).toFixed(4),
    sec: +sec.toFixed(4),
  };
}

function build(name) {
  const fake = makeStage();
  fake.setShape(name);
  return shapeOf(fake);
}

/** Run fn with console.warn captured; returns its value and the lines. */
function withWarnings(fn) {
  const warned = [];
  const real = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try { return { got: fn(), warned }; } finally { console.warn = real; }
}

const BOOT_SHAPE = 'pyramid-smooth';

describe('an unknown shape value cannot reach the geometry', () => {
  test('index.html still boots the shape this suite calls the fallback', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const block = html.match(/<select id="shape-sel">([\s\S]*?)<\/select>/)[1];
    const selected = block.match(/<option value="([^"]+)"[^>]*\sselected/)[1];
    assert.equal(selected, BOOT_SHAPE);
  });

  test('CONTROL — the values the picker offers are unchanged', () => {
    // These are the measured signatures of the current catalogue. They are the
    // half of the stencil that must NOT fire: a fallback that swallowed real
    // names, or a `default:` that changed what 'plane' builds, breaks here
    // first. ('plane' had no `case` of its own before round 10 — it WAS the
    // default — which is exactly how a careless fix breaks it.)
    assert.deepEqual(build('plane'),  { verts: 25921, x: 7, y: 0, z: 7, sec: 7 });
    assert.deepEqual(build('sphere'), { verts: 25921, x: 7, y: 7, z: 7, sec: 4.9497 });
    // disc is 0.08 thick along Y: round 10 took it out of the rotate list, so
    // it lies flat like the plane instead of standing on its rim.
    assert.deepEqual(build('disc'),   { verts: 6883,  x: 7, y: 0.08, z: 7, sec: 4.9497 });
    // 6883, not 6722: the boot shape is built through CylinderGeometry with a
    // 1 mm top radius since round 10, which is what closes its mesh.
    assert.deepEqual(build(BOOT_SHAPE), { verts: 6883, x: 6.4, y: 5, z: 6.4, sec: 4.5255 });
    // The one that made `sec` necessary, and the reason it is asserted here
    // rather than only in the fallback test: `pyramid` now differs from the
    // boot shape in this field ALONE — 3.2 against 4.5255, a square section
    // against a round one — everything else about the two meshes is identical.
    assert.deepEqual(build('pyramid'),  { verts: 6883, x: 6.4, y: 5, z: 6.4, sec: 3.2 });
  });

  test('an unknown value builds the boot shape, not a plate on edge — and says so', () => {
    const boot = build(BOOT_SHAPE);
    for (const bad of ['retiredName', 'Plane', 'plane ', 'torus-knot', '', 'sphere2', null, 42]) {
      const { got, warned } = withWarnings(() => build(bad));
      assert.deepEqual(got, boot, `shape ${JSON.stringify(bad)} did not fall back to ${BOOT_SHAPE}`);
      // The failure mode in its own words, in case the equality above is ever
      // relaxed: a plane that setShape never rotated has no extent in z.
      assert.ok(got.z > 0.001, `shape ${JSON.stringify(bad)} produced a plate lying in XY`);

      // Resolving quietly is only half the contract. src/shapes.js states the
      // other half in as many words — "silent was the whole defect" — and until
      // wave 2 nothing in this file, the file that owns the fallback, checked
      // it: deleting the console.warn from normalizeShape left this suite 8/8
      // green (round-10 matrix row A5), and the only red in the repo came from
      // a picker guard that asserts the warning for a different reason.
      const lines = warned.filter(w => w.includes('[shape]'));
      assert.equal(lines.length, 1,
        `${lines.length} [shape] warnings for ${JSON.stringify(bad)}; a fallback nobody is told ` +
        'about is the defect, not the fix');
      assert.ok(lines[0].includes(JSON.stringify(bad)),
        `the warning for ${JSON.stringify(bad)} does not name the value it rejected: ${lines[0]}`);
      assert.ok(lines[0].includes(BOOT_SHAPE),
        `the warning for ${JSON.stringify(bad)} does not name what it fell back to: ${lines[0]}`);
    }
  });

  test('CONTROL — a catalogue name resolves in silence', () => {
    // The half that must NOT fire. A warning on every shape change would be
    // noise, and it would also mean the check above is measuring the console
    // rather than the fallback.
    for (const good of ['plane', 'sphere', 'disc', BOOT_SHAPE]) {
      const { warned } = withWarnings(() => build(good));
      assert.deepEqual(warned.filter(w => w.includes('[shape]')), [],
        `${good} is a catalogue name and produced a [shape] warning`);
    }
    // …and the capture itself is not simply blind: a warning raised inside it
    // does arrive.
    const { warned } = withWarnings(() => console.warn('[shape] probe'));
    assert.deepEqual(warned, ['[shape] probe'],
      'withWarnings did not record a warning raised inside it, so every silence it reports ' +
      'above is a fact about the capture and not about the code');
  });

  test('setShape reports the resolved name, so the picker and engine agree', () => {
    const seen = [];
    const fake = makeStage();
    fake.cb = { onShapeChange: n => seen.push(n) };
    fake.setShape('retiredName');
    fake.isShapeChanging = false;
    fake.setShape('disc');            // CONTROL: a real name passes through
    assert.deepEqual(seen, [BOOT_SHAPE, 'disc']);
    assert.equal(fake.currentShape, 'disc');
  });
});

describe('the shape whitelist is the only list of shape values', () => {
  test('src/shapes.js names exactly what the picker offers and render can build', async () => {
    const { SHAPE_NAMES, DEFAULT_SHAPE, normalizeShape } = await import('../src/shapes.js');

    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const block = html.match(/<select id="shape-sel">([\s\S]*?)<\/select>/)[1];
    const options = [...block.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);

    const render = readFileSync(join(ROOT, 'src/render.js'), 'utf8');
    const geoSrc = render.match(/_buildShapeGeo\(shape\) \{[\s\S]*?\n  \}\n/)[0];
    const cases  = [...geoSrc.matchAll(/case '([^']+)':/g)].map(m => m[1]);

    assert.deepEqual([...SHAPE_NAMES].sort(), [...options].sort(),
      'whitelist and <option value> list disagree');
    assert.deepEqual([...SHAPE_NAMES].sort(), [...cases].sort(),
      'whitelist and _buildShapeGeo case labels disagree');
    // The `default:` branch recurses into DEFAULT_SHAPE; without its own case
    // label that is a stack overflow on the first unknown value.
    assert.ok(cases.includes(DEFAULT_SHAPE), 'DEFAULT_SHAPE has no case label');
    assert.equal(DEFAULT_SHAPE, BOOT_SHAPE);

    // CONTROL: known values pass through untouched — the property that makes
    // every call site a no-op on the paths that already worked.
    for (const s of SHAPE_NAMES) assert.equal(normalizeShape(s), s);
    assert.equal(normalizeShape('retiredName'), DEFAULT_SHAPE);

    // The R-hotkey pool is the whitelist, not a copy of part of it.
    //
    // It used to be a nine-name literal in main.js, and asserting only that its
    // entries WERE shapes is what let that stand: a subset check cannot see
    // what fell out. Eleven of the twenty were unreachable by R — disc, ring,
    // circle, hex, pyramid-smooth, tetrahedron, octahedron,
    // icosahedron-smooth, dodecahedron, star and solar — while documents/
    // hotkeys.md described a deck in which "every shape will appear before any
    // repeats". Reading the construction rather than a literal is the point:
    // there is no fourth list left to drift.
    const main = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
    assert.match(main, /const _shapeBag = new ShuffleBag\(SHAPE_NAMES\)/,
      'the R pool must be built from the whitelist, not from a copy of part of it');
    assert.match(main, /import \{ SHAPE_NAMES \} from '\.\/shapes\.js'/,
      'and that SHAPE_NAMES must be the imported whitelist, not a local of the same name');
  });
});

// ── Harness 2: _applyHF, counting executions per geometry object ────────────
// A stand-in geometry carrying exactly what applyHeightField touches. One
// execution = one computeVertexNormals on the geometry it was handed, so
// counting those counts calls without stubbing an import.
function countingGeo(count, tag) {
  const ys = new Float32Array(count);
  return {
    tag, applied: 0, ys,
    // Since round 10 applyHeightField samples the field at the vertex's own
    // (x, z), so the stand-in has to have coordinates. Vertex i is put on
    // lattice point i of the grid the field implies over the default extent
    // 3.5 — the one arrangement under which the written Y still equals hf[i],
    // which is what lets the value assertions below stay this direct.
    attributes: { position: {
      count,
      getX(i) { const g = Math.round(Math.sqrt(count)); return -3.5 + (i % g) * (7 / (g - 1)); },
      getZ(i) { const g = Math.round(Math.sqrt(count)); return -3.5 + Math.floor(i / g) * (7 / (g - 1)); },
      getY(i) { return ys[i]; },
      setY(i, v) { ys[i] = v; },
      needsUpdate: false,
    } },
    computeVertexNormals() { this.applied++; },
  };
}
function applyOnce(meshGeo, ptsGeo, hf) {
  const mv = Object.create(MathVisualizer.prototype);
  mv.render = { gpuMesh: { geometry: meshGeo }, gpuPtsProxy: ptsGeo ? { geometry: ptsGeo } : null };
  mv._applyHF(hf);
}

describe('a height field is applied at most once per geometry object', () => {
  // Four values on a 2x2 lattice: the smallest field that is a real grid, so
  // the stand-in's vertices can sit on it and the written Y is hf[i] exactly.
  const hf = Float32Array.from({ length: 4 }, (_, i) => i * 0.5);

  test('proxy sharing gpuMesh.geometry — the only arrangement render.js builds', () => {
    const geo = countingGeo(4, 'shared');
    applyOnce(geo, geo, hf);
    assert.equal(geo.applied, 1,
      'applyHeightField ran more than once on one geometry in one frame');
    // …and it still ran: a guard that passes by doing nothing is worthless.
    assert.deepEqual([...geo.ys], [...hf]);
  });

  test('CONTROL — a proxy with a geometry of its own is still filled', () => {
    const mesh = countingGeo(4, 'mesh');
    const pts  = countingGeo(4, 'pts');
    applyOnce(mesh, pts, hf);
    assert.equal(mesh.applied, 1);
    assert.equal(pts.applied, 1);
    assert.deepEqual([...pts.ys], [...hf]);
  });

  test('CONTROL — no proxy at all, the mesh is written exactly once', () => {
    const mesh = countingGeo(4, 'mesh');
    applyOnce(mesh, null, hf);
    assert.equal(mesh.applied, 1);
    assert.deepEqual([...mesh.ys], [...hf]);
  });
});
