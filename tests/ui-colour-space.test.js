// tests/ui-colour-space.test.js
//
// The few colours in this app that are authored as sRGB bytes and expected to
// be SEEN as those bytes: the background, the fog and the grid.
//
// ── The defect ───────────────────────────────────────────────────────────────
// three converts a colour given as sRGB bytes into the working linear space on
// construction — ColorManagement.enabled has been true by default since r152 —
// and the matching conversion back out lives in the <colorspace_fragment> chunk
// that only three's own materials carry. VIMATHIC draws its frame through its
// own GLSL, so nothing performs it, and an authored colour reaches the screen
// linearised: darker and more saturated than written.
//
// The 44 shader palettes never pass through THREE.Color and land exactly as
// authored, which is why this went unnoticed — and also why the repair is
// narrow. A global output transform would fix these three colours and shift all
// 44 palettes, which is a change to the look of the whole app rather than a fix.
//
// Run:
//   node --test tests/ui-colour-space.test.js

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let THREE;
before(async () => { THREE = await import('three'); });

const byte = v => Math.round(v * 255);
const hex  = c => '#' + [c.r, c.g, c.b].map(v => byte(v).toString(16).padStart(2, '0')).join('');

/** The same expression src/render.js uses. */
const uiColor = (T, h) => new T.Color().setRGB(
  ((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255, T.LinearSRGBColorSpace);

describe('colours meant to be seen as written reach the screen as written', () => {

  test('the plain constructor is the thing that moves them', () => {
    // This is the measurement the fix rests on, kept here so the next reader
    // does not have to take it on trust.
    assert.equal(THREE.ColorManagement.enabled, true,
      'if this is ever turned off the fix below becomes unnecessary rather than wrong');
    for (const [h, seen] of [[0x050515, '#000002'], [0x88aaff, '#3f67ff'], [0x3355aa, '#081767']]) {
      assert.equal(hex(new THREE.Color(h)), seen,
        `#${h.toString(16).padStart(6, '0')} written through the plain constructor`);
    }
  });

  test('declared in the space they are written to, they survive', () => {
    for (const h of [0x050515, 0x88aaff, 0x3355aa, 0xfff1dd, 0x808080]) {
      assert.equal(hex(uiColor(THREE, h)), '#' + h.toString(16).padStart(6, '0'));
    }
  });

  test('the background, the fog and the grid go through it', () => {
    // A source check, because constructing RenderEngine needs a WebGL context.
    // It is worth having: this is a one-token regression — someone writing
    // `new THREE.Color(0x…)` for a new UI colour reintroduces it silently, and
    // the symptom is "the background looks a bit dark", which nobody files.
    const src = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
    assert.match(src, /export const uiColor = hex => new THREE\.Color\(\)\.setRGB\(/,
      'the helper is gone — the sites below cannot be right without it');

    const sites = [
      [/this\.scene\.background = uiColor\(0x050515\)/g, 2, 'scene.background'],
      [/new THREE\.FogExp2\(uiColor\(0x050515\)/g,       2, 'fog'],
      [/setClearColor\(uiColor\(0x050515\)/g,            2, 'clear colour'],
      [/new THREE\.GridHelper\(9, 28, uiColor\(0x88aaff\), uiColor\(0x3355aa\)\)/g, 1, 'grid'],
    ];
    for (const [re, count, what] of sites) {
      assert.equal((src.match(re) || []).length, count,
        `${what}: expected ${count} site(s) declared in the written space`);
    }
    // And the raw form is gone from those colours entirely, which is the half a
    // count cannot see — a second site added later would pass the check above.
    assert.equal((src.match(/new THREE\.Color\(0x050515\)/g) || []).length, 0,
      'a background is still constructed the way that darkens it');
  });
});
