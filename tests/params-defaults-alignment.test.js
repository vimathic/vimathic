// tests/params-defaults-alignment.test.js
//
// Contract test for the three-way alignment PARAMS declares in prose and
// nothing asserted: registry default ↔ the slider index.html ships ↔ the value
// the engine boots at.
//
// Run:
//   node --test tests/params-defaults-alignment.test.js
//
// ── Why this exists ───────────────────────────────────────────────────────────
// Two of the registry's seven defaults carry a FIX comment that states the
// invariant out loud and then leaves it to prose:
//
//   params.js (bassSens) — "default was 1.0 while the engine boots at 1.2 —
//   RESET ALL silently nudged bass sensitivity below the startup value. Keep
//   the three aligned: audio.js (`this.bassSens = 1.2`) is the engine truth and
//   index.html is the visible truth (slider value="1.2", <span id="bsv">1.20)."
//
//   params.js (colorIdx) — "default was 0 — RESET ALL wrote 16 (Amber) and then
//   resetParamsToDefault() clobbered it straight back to 0 (Teal Orange) …
//   The default MUST match the startup state: main.js sets `audio.colorIdx = 16`
//   and index.html carries `<option value="16" selected>Amber</option>`."
//
// Before this file, `grep -n '\.default\b' tests/*.test.js` returned nothing:
// both fixes could be reverted verbatim with the whole suite green. RESET ALL
// is one click from a cold start and it is the only consumer of `default`, so a
// drifted default is not a cosmetic problem — it is a button that moves the
// instrument away from the state it launched in, silently.
//
// The harm is NOT a panel that disagrees with the engine: applyParam calls
// syncParamUI, so the slider and the value badge follow the engine to whatever
// the default says. The harm is that RESET ALL stops returning to the startup
// state, which is the one thing its name promises.
//
// ── How the three truths are read ─────────────────────────────────────────────
//   registry — imported from src/params.js.
//   visible  — index.html parsed as text: the <input type="range"> attributes
//              and the <span class="vd"> the label shows next to it.
//   engine   — a real AudioEngine / CameraSystem where one can be constructed
//              headless; render.js's bloom strength is read out of the source,
//              because RenderEngine needs a WebGL context.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

const HTML   = read('index.html');
const MAIN   = read('src/main.js');
const RENDER = read('src/render.js');

/** Every <input type="range"> in index.html, keyed by id. */
function parseRangeInputs(html) {
  const out = {};
  for (const tag of html.match(/<input\b[^>]*>/g) ?? []) {
    if (!/type="range"/.test(tag)) continue;
    const attr = name => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
    const id = attr('id');
    if (id) out[id] = { min: attr('min'), max: attr('max'), value: attr('value') };
  }
  return out;
}
const RANGES = parseRangeInputs(HTML);

/** The text a <span id="…"> ships with, i.e. what the panel reads before boot. */
function spanText(id) {
  const m = HTML.match(new RegExp(`<span id="${id}"[^>]*>([^<]*)</span>`));
  return m?.[1];
}

let PARAMS, applyParam, DOM, AudioEngine, CameraSystem;

before(async () => {
  // dom.js resolves its element table at module load and takes the browser
  // branch when `document` exists. A stub that answers every id with an object
  // carrying that id is enough to recover the key → element-id mapping the
  // registry's `slider`/`display` fields are written against.
  globalThis.document = { getElementById: id => ({ id, dataset: {} }) };
  globalThis.requestAnimationFrame = () => 0;
  ({ DOM } = await import('../src/dom.js'));
  ({ PARAMS, applyParam } = await import('../src/params.js'));
  ({ AudioEngine } = await import('../src/audio.js'));
  ({ CameraSystem } = await import('../src/camera.js'));
});

// ── The visible truth ────────────────────────────────────────────────────────

describe('every slider-backed param matches the <input> index.html ships', () => {
  test('control — the registry still has slider-backed params to check', () => {
    // Guards the loops below against silently passing on an empty set.
    const withSliders = Object.values(PARAMS).filter(p => p.slider);
    assert.ok(withSliders.length >= 5,
      `expected the registry to still declare sliders, found ${withSliders.length}`);
  });

  test('the slider geometry and its start position are the registry\'s', () => {
    for (const [id, p] of Object.entries(PARAMS)) {
      if (!p.slider) continue;
      const elId = DOM[p.slider]?.id;
      assert.ok(elId, `PARAMS.${id}.slider = '${p.slider}' is not a key in dom.js`);
      const el = RANGES[elId];
      assert.ok(el, `index.html has no <input type="range" id="${elId}"> for PARAMS.${id}`);

      assert.equal(Number(el.min), p.min,
        `${id}: index.html slider min=${el.min} vs PARAMS.min=${p.min}`);
      assert.equal(Number(el.max), p.max,
        `${id}: index.html slider max=${el.max} vs PARAMS.max=${p.max}`);
      // The shipped `value` is where the thumb sits before a single frame has
      // run, so it is the startup state RESET ALL has to be able to return to.
      assert.equal(Number(el.value), p.default,
        `${id}: index.html slider value=${el.value} vs PARAMS.default=${p.default} — ` +
        'RESET ALL would move the instrument away from where it launched');
    }
  });

  test('the value badge beside each slider reads the formatted default', () => {
    for (const [id, p] of Object.entries(PARAMS)) {
      if (!p.display) continue;
      const spanId = DOM[p.display]?.id;
      assert.ok(spanId, `PARAMS.${id}.display = '${p.display}' is not a key in dom.js`);
      const shown = spanText(spanId);
      assert.ok(shown != null, `index.html has no <span id="${spanId}">`);
      assert.equal(shown.trim(), p.format(p.default),
        `${id}: <span id="${spanId}"> ships "${shown}" but the default formats as ` +
        `"${p.format(p.default)}"`);
    }
  });
});

// ── The engine truth ─────────────────────────────────────────────────────────

describe('every default matches the value the engine boots at', () => {
  test('AudioEngine starts on the registry defaults it owns', () => {
    const audio = new AudioEngine();
    // FIX(#19)'s invariant, in the terms the comment states it.
    assert.equal(audio.bassSens,   PARAMS.bassSens.default);
    assert.equal(audio.trebleSens, PARAMS.trebleSens.default);
    assert.equal(audio.waveInt,    PARAMS.waveInt.default);
    assert.equal(audio.amp,        PARAMS.amp.default);
  });

  test('CameraSystem starts on the registry default for rotSpeed', () => {
    const camera = { position: { x: 0, y: 0, z: 0, set() {} }, fov: 45, updateProjectionMatrix() {} };
    const orbit  = { target: { x: 0, y: 0, z: 0, set() {} }, update() {} };
    const cam = new CameraSystem(camera, orbit, { autoRotRadius: 7.2 });
    assert.equal(cam.cpParams.rotSpeed, PARAMS.rotSpeed.default);
  });

  test('colorIdx matches the palette the app boots on, in main.js and in the markup', () => {
    // colorIdx is the one param whose startup value is not in its engine's
    // constructor: AudioEngine boots at 0 and main.js overrides it.
    const m = MAIN.match(/audio\.colorIdx\s*=\s*(\d+)\s*;/);
    assert.ok(m, 'main.js no longer sets audio.colorIdx at boot');
    assert.equal(Number(m[1]), PARAMS.colorIdx.default,
      `main.js boots on palette ${m[1]} but RESET ALL writes ${PARAMS.colorIdx.default}`);
    // FIX(#2)'s third leg: the <select> has to agree, or the dropdown names a
    // palette that is not on screen.
    const sel = HTML.match(/<option value="(\d+)" selected>/);
    assert.ok(sel, 'the colour <select> no longer marks an option selected');
    assert.equal(Number(sel[1]), PARAMS.colorIdx.default,
      `index.html pre-selects palette ${sel[1]} but RESET ALL writes ${PARAMS.colorIdx.default}`);
  });

  test('bloom matches the strength the composer\'s bloom pass is built with', () => {
    // RenderEngine needs a WebGL context, so the boot value is read from the
    // one line that sets it.
    const m = RENDER.match(/new UnrealBloomPass\(\s*new THREE\.Vector2\([^)]*\)\s*,\s*([\d.]+)\s*,/);
    assert.ok(m, 'the UnrealBloomPass construction line has moved or changed shape');
    assert.equal(Number(m[1]), PARAMS.bloom.default,
      `render.js builds the bloom pass at ${m[1]} but RESET ALL writes ${PARAMS.bloom.default}`);
  });
});

// ── The set() bodies ─────────────────────────────────────────────────────────
//
// The registry's field reference promises: "set(ctx, v) — Apply value to the
// engine. Some params write to multiple places (audio + render uniform) —
// that's all encapsulated here." Half of those writes had no reader in the
// suite, so a set() that dropped its uniform write left the slider moving a
// number that never reached the shader.

/** A context recording every engine field the registry's set() bodies touch. */
function makeCtx() {
  const schemes = [];
  return {
    schemes,
    audio:  { amp: 0, waveInt: 0, bassSens: 0, trebleSens: 0, colorIdx: 0 },
    render: {
      U: { uAmp: { value: 0 }, uWI: { value: 0 } },
      bloomPass: { strength: 0 },
      setColorSchemeAnimated: i => schemes.push(i),
    },
    camera: { cpParams: { rotSpeed: 0 }, cb: {} },
  };
}

describe('each set() reaches every engine field the registry says it owns', () => {
  test('amp writes both the audio engine and the vertex uniform', () => {
    const ctx = makeCtx();
    PARAMS.amp.set(ctx, 1.23);
    assert.equal(ctx.audio.amp, 1.23);
    assert.equal(ctx.render.U.uAmp.value, 1.23,
      'the AMPLITUDE slider stops reaching the shader');
  });

  test('waveInt writes both the audio engine and the wave uniform', () => {
    const ctx = makeCtx();
    PARAMS.waveInt.set(ctx, 2.75);
    assert.equal(ctx.audio.waveInt, 2.75);
    assert.equal(ctx.render.U.uWI.value, 2.75,
      'the WAVE INTENSITY slider stops reaching the shader');
  });

  test('bloom writes the composer pass, not a copy of it', () => {
    const ctx = makeCtx();
    PARAMS.bloom.set(ctx, 1.4);
    assert.equal(ctx.render.bloomPass.strength, 1.4);
  });

  test('the sensitivity params write the engine fields updateUniforms multiplies by', () => {
    const ctx = makeCtx();
    PARAMS.bassSens.set(ctx, 2.1);
    PARAMS.trebleSens.set(ctx, 0.4);
    assert.equal(ctx.audio.bassSens, 2.1);
    assert.equal(ctx.audio.trebleSens, 0.4);
  });

  test('every param round-trips through its own get()', () => {
    // get and set have to name the same storage; a set() that wrote a shadow
    // field would make preset capture record a value the engine never held.
    const probe = { amp: 1.1, waveInt: 2.2, bassSens: 0.9, trebleSens: 1.7,
                    bloom: 0.8, colorIdx: 7, rotSpeed: 0.0007 };
    for (const [id, p] of Object.entries(PARAMS)) {
      const ctx = makeCtx();
      assert.ok(id in probe, `PARAMS.${id} has no probe value — add one`);
      p.set(ctx, probe[id]);
      assert.equal(p.get(ctx), probe[id], `PARAMS.${id}: get() does not read what set() wrote`);
    }
  });
});

// ── RESET ALL, end to end ────────────────────────────────────────────────────

describe('RESET ALL lands every param on its declared default', () => {
  test('resetParamsToDefault writes the default through set(), for all of them', async () => {
    const { resetParamsToDefault } = await import('../src/params.js');
    const ctx = makeCtx();
    resetParamsToDefault(ctx);
    for (const [id, p] of Object.entries(PARAMS)) {
      assert.equal(p.get(ctx), p.default, `RESET ALL left ${id} off its default`);
    }
  });

  test('a non-finite value falls back to the default rather than poisoning the engine', () => {
    const ctx = makeCtx();
    applyParam(ctx, 'amp', NaN);
    assert.equal(ctx.audio.amp, PARAMS.amp.default);
  });
});
