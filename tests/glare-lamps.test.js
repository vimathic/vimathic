// tests/glare-lamps.test.js
//
// uGlare has to reach every LAMP and none of the rest.
//
// Run:
//   node --test tests/glare-lamps.test.js
//
// ── What this is guarding ────────────────────────────────────────────────────
// The complaint (01.09) was that the white cuts the eyes, in NIGHT most of all.
// Measured on the shipped tree — plane, Eigenvector Field, the slider values
// from the report, one camera, one position in the track, six frames per
// configuration, median:
//
//                    p99 luma   share > 0.7   mean of lit pixels
//   normal  mirror     0.566       0.226 %          0.167
//   normal  matte      0.697       1.006 %          0.276
//   NIGHT   mirror     0.409       0.000 %          0.216
//   NIGHT   matte      0.232       0.025 %          0.137
//
// Two separate sources, which the matte rows are what separate: matte has no
// reflection path at all, so the burn there is the white specular in the
// lighting block, which every material gets. The mirror rows carry that plus
// the studio soft-boxes and the material's own highlight.
//
// So the dimming multiplies the LAMPS — three soft-boxes, the material
// highlight, the lighting specular — and deliberately NOT reflMix or the
// environment gradient: dimming those would cost a mirror its reflectivity,
// which is not what was asked for and is not what "too bright" means.
//
// This file reads the shader source, because that is where the multiplication
// either is or is not. Each assertion carries a control that fails if the
// pattern it searches for has moved, so a renamed local cannot turn this file
// into a green no-op.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLARE, NIGHT_GLARE } from '../src/render.js';

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/shaders.js'), 'utf8');

/** The body of studioEnv, which is written once and included by both programs. */
function studioEnvBody() {
  const at = SRC.indexOf('vec3 studioEnv(vec3 dir){');
  assert.ok(at > 0, 'studioEnv is gone or renamed — this file is measuring nothing');
  const end = SRC.indexOf('\n}', at);
  assert.ok(end > at, 'could not find the end of studioEnv');
  return SRC.slice(at, end);
}

describe('every lamp is multiplied by uGlare', () => {
  test('the three studio soft-boxes', () => {
    const body = studioEnvBody();
    const lines = body.split('\n').filter(l => l.includes('base +='));
    assert.equal(lines.length, 3,
      `expected three soft-box lines in studioEnv, found ${lines.length} — the probe has drifted`);
    for (const l of lines) {
      assert.ok(/\*\s*uGlare/.test(l), `a soft-box is not dimmed: ${l.trim()}`);
    }
  });

  test('the environment GRADIENT is not — a mirror keeps its reflectivity', () => {
    // The other half of the design, and the one an over-eager fix would break:
    // multiplying the whole of studioEnv would dim the floor/mid/ceiling ramp
    // too, and chrome would stop reading as chrome. The gradient lines are the
    // `vec3 base = ...` assignment and the three colour constants above it.
    const body = studioEnvBody();
    const grad = body.split('\n').filter(l => /vec3 (floorC|midC|ceilC)|vec3 base =/.test(l));
    assert.equal(grad.length, 4, 'the gradient block has moved — this assertion is not reading it');
    for (const l of grad) {
      assert.ok(!/uGlare/.test(l), `the environment gradient is being dimmed as well: ${l.trim()}`);
    }
  });

  test("the material's own highlight", () => {
    const line = SRC.split('\n').find(l => l.includes('vec3(specM)'));
    assert.ok(line, 'the material highlight line is gone or renamed');
    assert.ok(/\*\s*uGlare/.test(line), `the material highlight is not dimmed: ${line.trim()}`);
  });

  test('the lighting specular', () => {
    // Comments are skipped, and that is not a convenience: the first run of
    // this test matched a comment forty lines above the code which spelled the
    // composition out WITHOUT the multiplier, and reported the shader
    // undimmed while the shader was fine. (The comment was stale and was
    // fixed — but the probe had to stop reading prose as code either way.)
    const line = SRC.split('\n').map(l => l.trim())
      .find(l => !l.startsWith('//') && /\+ vec3\(spec\)/.test(l));
    assert.ok(line, 'the lighting specular line is gone or renamed');
    assert.ok(/\*\s*uGlare/.test(line), `the lighting specular is not dimmed: ${line.trim()}`);
  });

  test('reflMix is not — dimming it would be turning the finish off', () => {
    const line = SRC.split('\n').find(l => l.includes('float reflMix'));
    assert.ok(line, 'reflMix is gone or renamed');
    assert.ok(!/uGlare/.test(line),
      `reflMix is being scaled by the glare: ${line.trim()} — that dims the reflection, not the glare`);
  });

  test('both fragment programs declare it', () => {
    // _MATERIAL_UNIFORMS is included by the main FS and by the editor template,
    // and studioEnv reads uGlare — so a declaration that lived beside the
    // lighting uniforms instead would leave the editor's shaders failing to
    // compile. Counting the includes is what says both got it.
    assert.ok(/uniform float uGlare;/.test(SRC), 'uGlare is not declared anywhere');
    const includes = (SRC.match(/\$\{_MATERIAL_UNIFORMS\}/g) || []).length;
    assert.equal(includes, 2,
      `_MATERIAL_UNIFORMS is included ${includes} times — expected the main FS and the editor template`);
  });

  test('the two shipped values are a dimming, in both modes', () => {
    assert.ok(GLARE > 0 && GLARE < 1, `GLARE is ${GLARE} — either no dimming at all, or the lamps are off`);
    assert.ok(NIGHT_GLARE > 0 && NIGHT_GLARE < GLARE,
      `NIGHT_GLARE is ${NIGHT_GLARE} against GLARE ${GLARE} — NIGHT is not the darker of the two`);
  });
});
