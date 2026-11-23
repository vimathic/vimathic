// tests/bloom-alpha.test.js
//
// The bloom pass's last step, made honest about alpha (makeBloomBlendMaterial
// in src/render.js).
//
// Run:
//   node --test tests/bloom-alpha.test.js
//
// ── The defect ────────────────────────────────────────────────────────────────
// three's UnrealBloomPass lays its composite over the frame with a copy shader
// under AdditiveBlending — (SRC_ALPHA, ONE) on colour and alpha alike — and its
// blur writes alpha 1 everywhere, so the composite's alpha is a constant
// (strength × Σ mip factors, ~2.3 at the shipped 0.55). That constant was added
// to every pixel's alpha. Over TRANSPARENT BG — VIMATHIC into OBS over a camera
// — the whole frame came out opaque at the shipped Bloom: measured, 100 % of
// pixels at alpha 1, corners included. tests/e2e/transparent-bg.spec.js checks
// the real thing; this file pins the arithmetic, which a browser cannot show
// to a test except by pixels.
//
// ── What has to hold ──────────────────────────────────────────────────────────
// 1. The COLOUR added is the stock blend's colour, so the opaque stage looks the
//    same (the measured difference is ≤ 1/255 on 0.016 % of channel values —
//    the multiply moved from the blend unit into the shader).
// 2. The ALPHA added is the light's own brightness, capped at 1, so a pixel the
//    glow does not reach keeps the alpha it had — 0 over a transparent stage.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (() => 0);

let makeBloomBlendMaterial, THREE;
before(async () => {
  ({ makeBloomBlendMaterial } = await import('../src/render.js'));
  THREE = await import('three');
});

const uniforms = () => ({ tDiffuse: { value: null }, opacity: { value: 1 } });

// The two blends, written out as the GPU applies them to one pixel.
// stock: src = opacity·texel, blend (SRC_ALPHA, ONE) on colour and alpha.
const stock = (texel, dst, opacity = 1) => {
  const s = texel.map(v => v * opacity);
  return {
    rgb: [0, 1, 2].map(i => dst.rgb[i] + s[i] * s[3]),
    a: dst.a + s[3] * s[3],
  };
};
// new: the shader folds the alpha into the colour; blend (ONE, ONE) on both.
const fresh = (texel, dst, opacity = 1) => {
  const t = texel.map(v => v * opacity);
  const light = [t[0] * t[3], t[1] * t[3], t[2] * t[3]];
  const a = Math.min(1, Math.max(0, Math.max(...light)));
  return { rgb: [0, 1, 2].map(i => dst.rgb[i] + light[i]), a: dst.a + a };
};

describe('makeBloomBlendMaterial', () => {
  test('blends (ONE, ONE) on colour and alpha, over the pass\'s own uniforms', () => {
    const u = uniforms();
    const m = makeBloomBlendMaterial(u, 'void main(){}');
    assert.equal(m.uniforms, u, 'a copy of the uniforms would never see the pass\'s per-frame composite');
    assert.equal(m.blending, THREE.CustomBlending);
    for (const k of ['blendSrc', 'blendDst', 'blendSrcAlpha', 'blendDstAlpha']) {
      assert.equal(m[k], THREE.OneFactor, `${k} is not ONE`);
    }
    assert.equal(m.blendEquation, THREE.AddEquation);
    assert.equal(m.blendEquationAlpha, THREE.AddEquation);
    assert.equal(m.depthTest, false);
    assert.equal(m.depthWrite, false);
    assert.equal(m.transparent, true);
  });

  test('its fragment program folds the alpha into the colour and caps the alpha at the light', () => {
    const fs = makeBloomBlendMaterial(uniforms(), '').fragmentShader;
    assert.match(fs, /vec3 light = texel\.rgb \* texel\.a;/);
    assert.match(fs, /gl_FragColor = vec4\( light, clamp\( max\( light\.r, max\( light\.g, light\.b \) \), 0\.0, 1\.0 \) \);/);
    assert.match(fs, /vec4 texel = opacity \* texture2D\( tDiffuse, vUv \);/);
  });

  // The arithmetic, on the values the pass actually produces: a composite whose
  // alpha is the constant the blur makes it (≈ 2.31 at strength 0.55), with
  // colour from nothing (a dark pixel) to a hot core.
  const COMPOSITE_ALPHA = 0.55 * (1.08 + 0.96 + 0.84 + 0.72 + 0.60);   // strength × Σ mix(f, 1.2 − f, 0.4)
  const texels = [[0, 0, 0], [0.01, 0.005, 0.002], [0.2, 0.1, 0.05], [0.6, 0.45, 0.3]]
    .map(rgb => [...rgb, COMPOSITE_ALPHA]);

  test('the colour it adds is the stock blend\'s colour', () => {
    const dst = { rgb: [0.1, 0.2, 0.3], a: 1 };
    for (const t of texels) for (const opacity of [1, 0.5]) {
      const s = stock(t, dst, opacity), n = fresh(t, dst, opacity);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(s.rgb[i] - n.rgb[i]) < 1e-12, `channel ${i} differs for ${t}`);
    }
  });

  test('over a transparent stage, a pixel the glow does not reach stays clear — the stock blend made it opaque', () => {
    const clear = { rgb: [0, 0, 0], a: 0 };
    const dark = texels[0];
    assert.ok(stock(dark, clear).a >= 1, 'precondition: the stock blend makes even a dark pixel opaque');
    assert.equal(fresh(dark, clear).a, 0, 'a pixel with no glow gained coverage');
  });

  test('and a glow covers in proportion to its brightness, never past 1', () => {
    const clear = { rgb: [0, 0, 0], a: 0 };
    let last = -1;
    for (const t of texels) {
      const a = fresh(t, clear).a;
      assert.ok(a >= last, 'a brighter glow covered less than a dimmer one');
      assert.ok(a <= 1, `the glow alone pushed alpha to ${a}`);
      last = a;
    }
  });

  test('the engine puts it on the bloom pass, and lets the stock one go', () => {
    const src = readFileSync(join(ROOT, 'src/render.js'), 'utf8');
    assert.match(src, /this\.bloomPass\.blendMaterial = makeBloomBlendMaterial\(this\.bloomPass\.copyUniforms, stockBlend\.vertexShader\);/,
      'the bloom pass still blends with three\'s stock material');
    assert.match(src, /stockBlend\.dispose\(\);/, 'the stock material is left compiled and orphaned');
  });
});
