// tests/audio-band-shape.test.js
//
// The 24-band layer where it meets geometry: the radius→band mapping, the two
// paths agreeing about it, and the promise that OFF is bit-exact.
//
// Run:
//   node --test tests/audio-band-shape.test.js
//
// ── Why this file ────────────────────────────────────────────────────────────
// The first group here is about ZERO: depth 0 has to leave the field alone to
// the bit, in all three writers. That was written when the layer also SHIPPED
// at zero, and it is worth being clear that those are two different promises.
// The layer now ships at 0.30 — see AudioEngine.bandDepth — so "off is bit-
// exact" is no longer a statement about what a new user sees; it is the
// guarantee that a user who drags the slider back to 0, or loads a preset saved
// at 0, gets exactly the picture the catalogue had before the layer existed.
// That promise got MORE load-bearing when the default moved, not less.
//
// The rest is about the CPU and GPU paths computing the SAME rings: they are two
// implementations of one formula, in two languages, and nothing in the product
// would show it if they drifted apart by half a band.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyHeightField, applyDisplacementField, applyCollapseField,
  generateSurfaceFromFormula, FIELD_EXTENT,
} from '../src/math-collections.js';
import { BAND_COUNT } from '../src/audio.js';
import { BAND_GLSL } from '../src/shaders.js';
import * as G from './helpers/glsl.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHADER_SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/shaders.js'), 'utf8');

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

describe('every door into the geometry carries the layer', () => {
  // There are four, and three of them were missed at first. The slider moved,
  // its readout counted, presets stored the value — and nothing on screen
  // changed, which is the worst way for a feature to be absent.
  test('the editor template applies the layer, not just declares it', () => {
    // SE_VS_TEMPLATE interpolates BAND_GLSL, so a user shader COMPILES the
    // lookup; for a while it never called it. Spectrum Rings then worked in
    // CPU/formula mode (applyHeightField bakes the layer in before any shader
    // runs) and silently did nothing in GPU mode — one control, two answers.
    // Read the same way the other shader guards read it — the template's own
    // text, bounded by its literal delimiters, rather than a call this module
    // does not export.
    const src = G.templateLiteral(SHADER_SRC, 'SE_VS_TEMPLATE').replace(/\s+/g, ' ');
    assert.match(src, /bandAtRadius\(length\(pos\.xz\)\)\s*\*\s*uBandDepth/,
      'the editor template declares the band uniforms but never applies them');
    assert.match(src, /uBandDepth\s*>\s*0\./,
      'the template applies the layer unconditionally — "off" would stop being bit-exact');
  });

  test('VOLUME and COLLAPSE move with the layer too', () => {
    // Both DEFORM modes have their own writer into the position attribute and
    // neither took the layer at first.
    const bands = onlyBand(3, 1);
    const layer = { bands, depth: 0.8, radius: 3.5 };

    const gV = plate(24), gV0 = plate(24);
    const df = new Float32Array(gV.attributes.position.count * 3);
    applyDisplacementField(gV0, df, positionsOf(plate(24)), null);
    applyDisplacementField(gV,  df, positionsOf(plate(24)), layer);
    assert.notDeepStrictEqual(Array.from(positionsOf(gV)), Array.from(positionsOf(gV0)),
      'VOLUME ignored the band layer');

    const gC = plate(24), gC0 = plate(24);
    const base = positionsOf(plate(24));
    const nrm = new Float32Array(base.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;          // flat plate: +Y
    const sf = new Float32Array(gC.attributes.position.count);
    applyCollapseField(gC0, sf, base, nrm, 1, null);
    applyCollapseField(gC,  sf, base, nrm, 1, layer);
    assert.notDeepStrictEqual(Array.from(positionsOf(gC)), Array.from(positionsOf(gC0)),
      'COLLAPSE ignored the band layer');
  });

  test('CONTROL — with the layer off, all three writers are bit-exact', () => {
    // The other half of the claim above: reaching more doors must not mean
    // touching anything when the slider is at zero.
    const off = { bands: onlyBand(3, 1), depth: 0, radius: 3.5 };
    const base = positionsOf(plate(24));

    for (const layer of [null, off]) {
      const g = plate(24), g0 = plate(24);
      const df = new Float32Array(g.attributes.position.count * 3);
      applyDisplacementField(g0, df, base, null);
      applyDisplacementField(g,  df, base, layer);
      assert.deepStrictEqual(Array.from(positionsOf(g)), Array.from(positionsOf(g0)));
    }
  });
});

describe('the CPU and the GPU compute the same rings', () => {
  // The GLSL is not executed here — it is READ, and the one line that defines
  // the mapping is compared against the JS. That is weaker than running both,
  // and it is what can be done without a GL context; the shape tests above pin
  // the JS side's behaviour, so a drift shows up as this comparison failing.
  test('the shader interpolates between neighbouring bands, exactly as the CPU does', () => {
    // The lookup now takes a band COORDINATE rather than a radius — the radius
    // is one of the two things that can produce it, and the mode's own texture
    // is the other. What is pinned here is the part both paths must share: the
    // 0..1 coordinate spans bands 0..23 and neighbours are interpolated.
    const src = BAND_GLSL.replace(/\s+/g, ' ');
    assert.match(src, /float x = clamp\(u, 0\., 1\.\) \* float\(24 - 1\)/,
      'the shader no longer maps [0,1] onto bands 0..23 the way applyHeightField does');
    assert.match(src, /int i = int\(floor\(x\)\)/);
    assert.match(src, /int j = min\(i \+ 1, 24 - 1\)/);
    assert.match(src, /mix\(uBands\[i\], uBands\[j\], fract\(x\)\)/,
      'the shader stopped interpolating; the CPU path still does, so the two now draw different rings');
    assert.match(src, /bandAtRadius\(float r\)[\s\S]*?bandAtU\(r \/ max\(uBandR, 1e-3\)\)/,
      'the radius rule is no longer expressed through the same lookup, so the two can drift apart');
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

// ── The layer has to be VISIBLE, not merely present ─────────────────────────
// Everything above this line tests a layer that is switched on by the caller.
// None of it can tell whether anyone will ever switch it on, and for the first
// version of this feature the answer was "almost nobody": it shipped at 0 and
// its slider sat inside a collapsed <details>. A feature nobody finds has the
// same value as a feature that does not work, and the code cannot tell the
// difference — so the two facts that make it reachable are pinned here.
//
// Both assertions are about SHIPPED STATE, which is exactly the kind of thing a
// later edit undoes without noticing: dropping a default back to 0 while
// refactoring, or tidying the panel by sweeping a control into ADVANCED, both
// leave every other test in this file green.
describe('the layer arrives where a user will meet it', () => {
  const HTML = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');

  test('the engine boots with the layer already doing something', async () => {
    const { AudioEngine } = await import('../src/audio.js');
    const depth = new AudioEngine().bandDepth;
    assert.ok(depth > 0,
      `AudioEngine boots at bandDepth ${depth} — the 24-band layer is off out of the box, ` +
      'so a user who never opens a panel never sees any of it');
    // Not just "nonzero": a token 0.02 would pass the line above and be
    // invisible. The lower bound is a tenth of the plain slider range, which is
    // where the rings first read as motion rather than as dither. The upper one
    // is the promise that the FORMULA is still the thing on screen — past ~0.7
    // the layer is what you see first. (params.js carries the range reasoning.)
    assert.ok(depth >= 0.1 && depth <= 0.7,
      `bandDepth boots at ${depth}, outside the 0.1..0.7 band where the layer is ` +
      'both visible and still subordinate to the formula');
  });

  test('its slider is reachable without opening ADVANCED', () => {
    // Structural rather than positional: the ADVANCED block is the collapsed
    // one, so "before it opens" is precisely "visible on load". Comparing
    // offsets beats matching the surrounding markup, which would break on any
    // reflow of the panel and would say nothing about visibility.
    const adv = HTML.indexOf('<details class="adv-section">');
    assert.ok(adv > 0, 'the ADVANCED <details> is gone — this guard no longer measures anything');
    for (const id of ['band-depth', 'band-character']) {
      const at = HTML.indexOf(`id="${id}"`);
      assert.ok(at > 0, `index.html no longer ships a control with id="${id}"`);
      assert.ok(at < adv,
        `#${id} sits inside the collapsed ADVANCED block — the 24-band layer is ` +
        'back to being a feature only someone already looking for it can find');
    }
  });
});
