// tests/audio-band-shape.test.js
//
// The 24-band layer where it meets geometry: the radius→band mapping, the two
// paths agreeing about it, and the promise that OFF is bit-exact.
//
// Run:
//   node --test tests/audio-band-shape.test.js
//
// ── Why this file ────────────────────────────────────────────────────────────
// The layer ships switched off, so the thing most likely to go wrong is not a
// wrong picture — it is a picture that changes for everyone who never asked for
// one. The first group here is therefore about zero, and the rest is about the
// CPU and GPU paths computing the SAME rings: they are two implementations of
// one formula, in two languages, and nothing in the product would show it if
// they drifted apart by half a band.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyHeightField, generateSurfaceFromFormula, FIELD_EXTENT } from '../src/math-collections.js';
import { BAND_COUNT } from '../src/audio.js';
import { BAND_GLSL } from '../src/shaders.js';

const GRID = 41;

/** A field with some structure, so a bug cannot hide behind a flat plate. */
function field(t = 0) {
  return generateSurfaceFromFormula(
    (x, z) => Math.sin(x * 1.3) + Math.cos(z * 0.9) + 0.2 * x * z,
    { amp: 1, freq: 1, comp: 0.5 }, GRID, FIELD_EXTENT, t);
}

function plate(seg = 24) {
  const g = new THREE.PlaneGeometry(7, 7, seg, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

const positionsOf = g => Float32Array.from(g.attributes.position.array);

/** Bands with a single band lit, so a mapping error names itself. */
function onlyBand(k, v = 1) {
  const b = new Float32Array(BAND_COUNT);
  b[k] = v;
  return b;
}

describe('off is off, to the bit', () => {
  test('a null layer and a zero-depth layer both leave the field alone', () => {
    const base = plate();
    applyHeightField(base, field(), null, FIELD_EXTENT, null, Infinity, null);
    const want = positionsOf(base);

    for (const layer of [
      undefined,
      null,
      { bands: onlyBand(0), depth: 0, radius: 3.5 },
      { bands: onlyBand(12), depth: 0, radius: 3.5 },
    ]) {
      const g = plate();
      applyHeightField(g, field(), null, FIELD_EXTENT, null, Infinity, layer);
      const got = positionsOf(g);
      let diff = -1;
      for (let i = 0; i < want.length; i++) if (!Object.is(got[i], want[i])) { diff = i; break; }
      assert.equal(diff, -1,
        `a layer at depth 0 moved word ${diff}: ${want[diff]} -> ${got[diff]}`);
    }
  });

  test('CONTROL — the same call at a non-zero depth does move it', () => {
    // Without this the test above would pass just as well against a layer that
    // had been deleted, and "off is bit-exact" would mean nothing.
    const a = plate(), b = plate();
    applyHeightField(a, field(), null, FIELD_EXTENT, null, Infinity, null);
    applyHeightField(b, field(), null, FIELD_EXTENT, null, Infinity,
                     { bands: onlyBand(0), depth: 0.5, radius: 3.5 });
    assert.notDeepStrictEqual(Array.from(positionsOf(b)), Array.from(positionsOf(a)));
  });
});

describe('the radius picks the band', () => {
  // The mapping the shader states: r/R across [0,1] spans bands 0..23, so the
  // axis is band 0 and the rim is band 23.
  const RADIUS = 3.5;

  /** Vertices sorted into "near the axis" and "out at the rim". */
  function ringSplit(geo) {
    const p = geo.attributes.position;
    const near = [], far = [];
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (r < RADIUS * 0.12) near.push(i);
      else if (r > RADIUS * 0.94 && r <= RADIUS) far.push(i);
    }
    return { near, far };
  }

  test('band 0 moves the middle and leaves the rim alone', () => {
    const flat = new Float32Array(GRID * GRID);      // no formula, only the rings
    const g = plate(40);
    const { near, far } = ringSplit(g);
    assert.ok(near.length && far.length, 'the plate has no middle or no rim to compare');
    applyHeightField(g, flat, null, FIELD_EXTENT, null, Infinity,
                     { bands: onlyBand(0), depth: 1, radius: RADIUS });
    const p = g.attributes.position;
    const midY  = Math.max(...near.map(i => Math.abs(p.getY(i))));
    const rimY  = Math.max(...far.map(i => Math.abs(p.getY(i))));
    assert.ok(midY > 0.9, `band 0 lifted the middle by only ${midY.toFixed(3)}`);
    assert.ok(rimY < 0.05, `band 0 also moved the rim by ${rimY.toFixed(3)}`);
  });

  test('band 23 moves the rim and leaves the middle alone', () => {
    const flat = new Float32Array(GRID * GRID);
    const g = plate(40);
    const { near, far } = ringSplit(g);
    applyHeightField(g, flat, null, FIELD_EXTENT, null, Infinity,
                     { bands: onlyBand(BAND_COUNT - 1), depth: 1, radius: RADIUS });
    const p = g.attributes.position;
    const midY = Math.max(...near.map(i => Math.abs(p.getY(i))));
    const rimY = Math.max(...far.map(i => Math.abs(p.getY(i))));
    assert.ok(rimY > 0.7, `band 23 lifted the rim by only ${rimY.toFixed(3)}`);
    assert.ok(midY < 0.05, `band 23 also moved the middle by ${midY.toFixed(3)}`);
  });

  test('past the radius the outermost band holds, rather than wrapping to the first', () => {
    // clamp, not repeat: a vertex beyond R — every body whose p95 radius is not
    // its maximum has some — must not suddenly answer to the kick.
    const flat = new Float32Array(GRID * GRID);
    const g = plate(40);
    applyHeightField(g, flat, null, FIELD_EXTENT, null, Infinity,
                     { bands: onlyBand(BAND_COUNT - 1), depth: 1, radius: 1.0 });
    const p = g.attributes.position;
    let worst = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.hypot(p.getX(i), p.getZ(i)) > 2.0) worst = Math.min(worst, p.getY(i) - 1);
    }
    assert.ok(Math.abs(worst) < 1e-6,
      `a vertex well beyond the radius read ${(1 + worst).toFixed(3)} instead of the top band's 1.0`);
  });
});

describe('the CPU and the GPU compute the same rings', () => {
  // The GLSL is not executed here — it is READ, and the one line that defines
  // the mapping is compared against the JS. That is weaker than running both,
  // and it is what can be done without a GL context; the shape tests above pin
  // the JS side's behaviour, so a drift shows up as this comparison failing.
  test('the shader interpolates between neighbouring bands, exactly as the CPU does', () => {
    const src = BAND_GLSL.replace(/\s+/g, ' ');
    assert.match(src, /float x = clamp\(r \/ max\(uBandR, 1e-3\), 0\., 1\.\) \* float\(24 - 1\)/,
      'the shader no longer maps [0,R] onto bands 0..23 the way applyHeightField does');
    assert.match(src, /int i = int\(floor\(x\)\)/);
    assert.match(src, /int j = min\(i \+ 1, 24 - 1\)/);
    assert.match(src, /mix\(uBands\[i\], uBands\[j\], fract\(x\)\)/,
      'the shader stopped interpolating; the CPU path still does, so the two now draw different rings');
  });

  test('the JS half of that pair is linear between bands, not stepped', () => {
    // Half-way between two lit bands must read half-way between their values.
    const flat = new Float32Array(GRID * GRID);
    const bands = new Float32Array(BAND_COUNT);
    bands[10] = 0;  bands[11] = 1;
    const R = 3.5;
    const g = plate(80);
    applyHeightField(g, flat, null, FIELD_EXTENT, null, Infinity, { bands, depth: 1, radius: R });
    // r that lands exactly on band 10.5
    const target = R * (10.5 / (BAND_COUNT - 1));
    const p = g.attributes.position;
    let best = Infinity, got = null;
    for (let i = 0; i < p.count; i++) {
      const d = Math.abs(Math.hypot(p.getX(i), p.getZ(i)) - target);
      if (d < best) { best = d; got = p.getY(i); }
    }
    assert.ok(best < 0.05, 'no vertex close enough to the midpoint to test');
    assert.ok(Math.abs(got - 0.5) < 0.12,
      `midway between a dark band and a lit one reads ${got.toFixed(3)}, not ~0.5 — stepped, not interpolated`);
  });
});
