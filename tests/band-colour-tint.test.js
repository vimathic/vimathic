// tests/band-colour-tint.test.js
//
// The spectrum as a colour map: a zone's place on the palette says WHICH band it
// listens to, independently of how loud that band is.
//
// Run:
//   node --test tests/band-colour-tint.test.js
//
// ── Why the identity and not the level ──────────────────────────────────────
// The bands have reached the palette since the layer was built — they move the
// surface, the surface is the ramp's parameter — so a loud band already changed
// the COLOUR of its zone. What it could not say was which band it was: a kick
// and a hi-hat, equally loud, were the same colour.
//
// Driving the tint from the level instead would have been the obvious version
// and is the one this design refuses. A band moves up to 0.24 of its range in a
// single 60 Hz frame (BAND_TAU is 60 ms), the layer reaches the ramp, and
// coherent brightness modulation at hi-hat rate is the same class of risk that
// keeps uBeat pinned to 0 in the vertex program. The coordinate does not move
// with the MUSIC — the character map is frozen at a reference time and the GPU
// coordinate is computed with the audio pinned — so the tint is a legend, not a
// strobe.
//
// One thing does move it, and it is stated here because the shipped comment
// claimed otherwise until an external review corrected it: a GPU mode crossfade
// blends the two modes' coordinates, so the tint travels while the fade runs.
// That is a sub-second one-way transition following the surface's own, not a
// periodic modulation, and nothing about it is driven by an onset or a level —
// which is the part the photosensitivity argument actually rests on.
//
// The structural half (only one statement may touch the palette parameter after
// the ramp, and only these names may appear in it) lives in
// tests/colour-ramp.test.js, beside the model it protects.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  applyHeightField, applyDisplacementField, applyCollapseField,
  bandRingValue, bandCoordValue, generateSurfaceFromFormula, FIELD_EXTENT,
} from '../src/math-collections.js';
import { BAND_COUNT } from '../src/audio.js';
import * as G from './helpers/glsl.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHADER_SRC = readFileSync(path.join(ROOT, 'src/shaders.js'), 'utf8');

let VS;
before(async () => { ({ VS } = await import('../src/shaders.js')); });

const GRID = 21;
function plate(seg = 12) {
  const g = new THREE.PlaneGeometry(7, 7, seg, seg);
  g.rotateX(-Math.PI / 2);
  const n = g.attributes.position.count;
  const u = new Float32Array(n); u.fill(-1);
  g.setAttribute('aBandU', new THREE.BufferAttribute(u, 1));
  return g;
}
function bandsOnly(k, v = 1) { const b = new Float32Array(BAND_COUNT); b[k] = v; return b; }
const basePositionsOf = g => Float32Array.from(g.attributes.position.array);

// ── One source of truth for "which band" ────────────────────────────────────

describe('the coordinate the colour uses is the coordinate the geometry used', () => {
  test('bandCoordValue is the same u bandRingValue looks the band up at', () => {
    // Two spellings of "which band is this" would show up as a body coloured by
    // one layout and moving by another, with nothing thrown anywhere. So the
    // colour reads the value the displacement is derived from, and the check is
    // that a single lit band lands on the same place both ways.
    const R = 3.5;
    for (const k of [0, 7, 23]) {
      const layer = { bands: bandsOnly(k, 1), depth: 1, radius: R };
      // The radius that maps exactly onto band k under the radius rule.
      const x = R * (k / (BAND_COUNT - 1));
      const u = bandCoordValue(layer, x, 0, undefined);
      assert.ok(Math.abs(u * (BAND_COUNT - 1) - k) < 0.02,
        `the coordinate at r=${x.toFixed(2)} reads band ${(u * 23).toFixed(2)}, not ${k}`);
      // …and that is the band the displacement actually picks up.
      assert.ok(bandRingValue(layer, x, 0, undefined) > 0.9,
        'the displacement did not find the lit band at the coordinate the colour reports');
    }
  });

  test('it reads the character map by index, exactly as the displacement does', () => {
    const u = new Float32Array(6);
    u[2] = 0.75;
    const layer = { bands: bandsOnly(0, 1), depth: 1, radius: 3.5, u };
    assert.equal(bandCoordValue(layer, 99, 99, 2), 0.75,
      'the map was ignored and the radius used instead — the colour would draw rings under a ' +
      'body the geometry lays out by the formula');
    // Past the end of a shorter map (a points proxy) it falls back the same way
    // bandRingValue does, rather than reading undefined and colouring by NaN.
    const v = bandCoordValue(layer, 0, 0, 99);
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `an out-of-range index gave ${v}`);
  });

  test('a layer that is off says "none", and none is not band 0', () => {
    // 0 is a real answer: the lowest band. The shader needs to tell it from
    // "there is no layer here", or a scene with the slider at zero would be
    // tinted as though everything listened to the kick.
    for (const layer of [null, undefined, { bands: bandsOnly(0), depth: 0, radius: 3.5 }]) {
      assert.equal(bandCoordValue(layer, 1, 1, 0), -1,
        'a switched-off layer reported a band coordinate');
    }
    const on = bandCoordValue({ bands: bandsOnly(0), depth: 1, radius: 3.5 }, 0, 0, undefined);
    assert.equal(on, 0, 'a point on the axis is not band 0, so -1 and 0 are not distinguishable');
  });
});

// ── The attribute the CPU path fills ────────────────────────────────────────

describe('aBandU carries it to the shader', () => {
  const hf = () => generateSurfaceFromFormula(
    (x, z) => Math.sin(x * 1.3) + Math.cos(z * 0.9),
    { amp: 1, freq: 1, comp: 0.5 }, GRID, FIELD_EXTENT, 0);

  test('applyHeightField writes the coordinate, not the level', () => {
    const g = plate();
    const layer = { bands: bandsOnly(0, 1), depth: 0.5, radius: FIELD_EXTENT };
    applyHeightField(g, hf(), null, FIELD_EXTENT, null, Infinity, layer);
    const a = g.attributes.aBandU.array;
    let mismatched = 0, spread = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < a.length; i++) {
      const x = g.attributes.position.getX(i), z = g.attributes.position.getZ(i);
      if (Math.abs(a[i] - bandCoordValue(layer, x, z, i)) > 1e-6) mismatched++;
      if (a[i] < lo) lo = a[i];
      if (a[i] > hi) hi = a[i];
    }
    spread = hi - lo;
    assert.equal(mismatched, 0, `${mismatched} vertices carry something other than the coordinate`);
    assert.ok(spread > 0.5,
      `the whole plate reports a ${spread.toFixed(3)} range of bands — the colour map would be flat`);
  });

  test('with the layer off every entry is -1', () => {
    const g = plate();
    applyHeightField(g, hf(), null, FIELD_EXTENT, null, Infinity, null);
    const a = g.attributes.aBandU.array;
    let wrong = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== -1) wrong++;
    assert.equal(wrong, 0, `${wrong} vertices claim a band with no layer — the scene would be tinted`);
  });

  test('the volume and collapse writers fill it too', () => {
    const layer = { bands: bandsOnly(0, 1), depth: 0.5, radius: FIELD_EXTENT };
    const gv = plate();
    const bv = basePositionsOf(gv);
    applyDisplacementField(gv, new Float32Array(bv.length), bv, layer);
    let vOk = 0;
    for (const v of gv.attributes.aBandU.array) if (v >= 0) vOk++;
    assert.ok(vOk > 0, 'VOLUME left aBandU at -1 — the tint would vanish in that mode only');

    const gc = plate();
    const bc = basePositionsOf(gc);
    const nrm = new Float32Array(bc.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    applyCollapseField(gc, new Float32Array(bc.length / 3), bc, nrm, 1, layer);
    let cOk = 0;
    for (const v of gc.attributes.aBandU.array) if (v >= 0) cOk++;
    assert.ok(cOk > 0, 'COLLAPSE left aBandU at -1');
  });

  test('a geometry whose attribute is the wrong length is refused, not overrun', () => {
    const g = new THREE.PlaneGeometry(7, 7, 6, 6);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('aBandU', new THREE.BufferAttribute(Float32Array.from([-1, -1, -1]), 1));
    assert.doesNotThrow(() => applyHeightField(
      g, hf(), null, FIELD_EXTENT, null, Infinity,
      { bands: bandsOnly(0, 1), depth: 0.5, radius: FIELD_EXTENT }));
    assert.deepEqual(Array.from(g.attributes.aBandU.array), [-1, -1, -1],
      'a mismatched aBandU was written into anyway');
  });
});

// ── Both vertex programs hand it over ───────────────────────────────────────

describe('the varying is written in every branch of both vertex programs', () => {
  const programs = () => {
    const tpl = G.templateLiteral(SHADER_SRC, 'SE_VS_TEMPLATE');
    assert.ok(/gl_Position/.test(tpl), 'the SE_VS_TEMPLATE slice stops before the end of main()');
    return [['VS', VS], ['SE_VS_TEMPLATE', tpl]];
  };

  test('declared and written, in both', () => {
    for (const [label, src] of programs()) {
      const d = G.declarations(src);
      for (const name of ['vBandU', 'aBandU']) {
        assert.ok(d.has(name), `${label} reads ${name} without declaring it — the program will not link`);
      }
      const P = G.readVertexProgram(src);
      const writes = P.tail.stmts.filter(s => /^vBandU\s*=/.test(s));
      assert.equal(writes.length, 1,
        `${label}: expected one vBandU write after the branch, found ${writes.length}`);
    }
    // CONTROL — the declaration check can say no.
    assert.equal(G.declarations(VS).has('uNotAThing'), false);
  });

  test('the CPU branch takes it from the attribute and the GPU branch from the coordinate', () => {
    for (const [label, src] of programs()) {
      const P = G.readVertexProgram(src);
      assert.ok(P.cpu.stmts.some(s => /bandU\s*=\s*aBandU/.test(s)),
        `${label}: the CPU branch never reads aBandU, so in CPU mode the tint is whatever the ` +
        'GPU branch happened to leave behind');
      assert.ok(P.gpu.stmts.some(s => /bandU\s*=/.test(s)),
        `${label}: the GPU branch never sets the band coordinate`);
    }
  });

  test('the fragment shader is told nothing when the layer is off', () => {
    // -1 has to reach the fragment program unchanged: the tint's step(0., vBandU)
    // is what makes depth 0 bit-identical rather than nearly so, and it needs a
    // negative to gate on.
    assert.match(SHADER_SRC, /float bandU\s*=\s*-1\./,
      'the band coordinate no longer starts at -1, so "no layer" is indistinguishable from band 0');
    assert.match(SHADER_SRC, /step\(0\.,\s*vBandU\)/,
      'the tint no longer gates on the sign of the coordinate');
  });
});
