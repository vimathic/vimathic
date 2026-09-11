// tests/factory-preset.test.js
//
// The one shipped demonstration that a custom shader is a look you can PLAY.
//
// 2493a98 wired uK0..uK3 all the way through — uniforms, sliders, MIDI CCs,
// preset capture, RESET ALL — and then shipped nothing that used them. Not a
// gallery entry, not a default body, not a preset; src/params.js could say
// "Nothing in the app reads these" and be exactly right. Meanwhile the preset
// list seeds from '[]', so the first thing a new visitor reads in that panel is
// "No saved presets".
//
// This file is about the row that fixes that, and mostly about the two ways it
// must NOT behave: seeding twice, and seeding over a decision.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let PresetMixin, SE_PRESETS;
before(async () => {
  ({ PresetMixin } = await import('../src/ui/presets.js'));
  ({ SE_PRESETS }  = await import('../src/shaders.js'));
});

/** localStorage with a real backing store, so a write is observable. */
function makeStorage(initial) {
  const store = new Map();
  if (initial !== undefined) store.set('vimathic_presets', initial);
  return {
    store,
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
}

const seedInto = storage => {
  globalThis.localStorage = storage;
  const ui = Object.assign(Object.create(null), PresetMixin, { _renderPresets() {} });
  return { wrote: ui._seedFactoryPresets(), list: JSON.parse(storage.getItem('vimathic_presets') ?? 'null') };
};

describe('the factory preset is written once, on a browser that has never had one', () => {

  test('a browser with no preset key gets exactly one', () => {
    const { wrote, list } = seedInto(makeStorage(undefined));
    assert.equal(wrote, true, 'nothing was written on a fresh profile');
    assert.equal(list.length, 1, 'the seed is one row, not a library');
    assert.match(list[0].name, /Knobs/);
  });

  test('an EMPTY list is a decision and is left alone', () => {
    // The distinction the whole gate rests on. A user who deletes the example
    // has said what they think of it; '[]' must not read as "never seeded", or
    // the row comes back on the next reload and there is no way to be rid of
    // it. That is why the check reads the raw key rather than _loadPresetList().
    const storage = makeStorage('[]');
    const { wrote, list } = seedInto(storage);
    assert.equal(wrote, false, 'the example was re-seeded over a deletion');
    assert.deepEqual(list, []);
  });

  test('a list the user has built is left alone', () => {
    const mine = JSON.stringify([{ name: 'my set', state: {} }]);
    const { wrote, list } = seedInto(makeStorage(mine));
    assert.equal(wrote, false);
    assert.deepEqual(list.map(p => p.name), ['my set']);
  });

  test('running it twice writes once', () => {
    const storage = makeStorage(undefined);
    assert.equal(seedInto(storage).wrote, true);
    assert.equal(seedInto(storage).wrote, false, 'the second boot seeded again');
    assert.equal(JSON.parse(storage.getItem('vimathic_presets')).length, 1);
  });

  test('storage that throws is survived, not crashed on', () => {
    globalThis.localStorage = { getItem() { throw new Error('blocked for this origin'); } };
    const ui = Object.assign(Object.create(null), PresetMixin, { _renderPresets() {} });
    assert.doesNotThrow(() => ui._seedFactoryPresets());
    assert.equal(ui._seedFactoryPresets(), false);
  });
});

describe('what the row carries', () => {
  let state;
  beforeEach(() => { state = seedInto(makeStorage(undefined)).list[0].state; });

  test('a NUMBERED GPU mode, because a formula would discard the body', () => {
    // The trap this walks around: 192 of the ~230 SHADER MODE entries put the
    // app in uMathMode != 0, where the vertex template drops the body's `y` —
    // and boot is one of them. A shipped example that loads to no visible
    // change teaches the operator that the feature does not work.
    assert.equal(typeof state.gpuSelVal, 'string');
    assert.doesNotMatch(state.gpuSelVal, /^m:/, 'the example loads into a CPU formula');
    assert.match(state.gpuSelVal, /^\d+$/);
  });

  test('a custom shader, in both stages, marked live', () => {
    assert.equal(state.shader.hasCustom, true);
    for (const k of ['vert', 'frag']) {
      assert.ok(state.shader[k]?.length > 0, `the ${k} body is empty`);
      assert.match(state.shader[k], /uK[0-3]/, `the ${k} body does not read a knob`);
    }
  });

  test('and the knob positions those bodies are meant to be seen at', () => {
    for (const k of ['k0', 'k1', 'k2', 'k3']) {
      assert.equal(typeof state[k], 'number', `${k} is missing, so the look is not reproducible`);
      assert.ok(state[k] >= 0 && state[k] <= 1, `${k} is outside the 0..1 the slider spans`);
    }
    assert.ok(state.k0 > 0 || state.k1 > 0 || state.k2 > 0,
      'every knob is at rest, so loading the example shows nothing a knob did');
  });

  test('it omits exactly the fields that are SKIPPED when absent', () => {
    // These are guarded on the apply side — `if (s.camera && camOwned)`,
    // `if (s.shape)`, `if (s.vizMode)`, and a PARAM_FIELDS entry is applied only
    // when it is not null. Leaving them out really does mean "leave it alone".
    for (const skipped of ['camera', 'camScript', 'shape', 'vizMode', 'bassSens', 'trebleSens', 'amp', 'bloom']) {
      assert.ok(!(skipped in state), `the example carries ${skipped} and would overwrite it`);
    }
  });

  test('and states the ones that would otherwise be DEFAULTED under the operator', () => {
    // The correction. `s.material ?? 'matte'` and `s.particleStyle ?? 'squares'`
    // mean an absent field is not "leave it alone" — it is "set it to the
    // default", which is a change the operator did not ask for and could not
    // predict. deformMode is the sharper one: with a numeric gpuSelVal and no
    // deform field, no branch writes the mode at all and mathViz._mode can stay
    // stuck at 'volume' under a GPU shader that carries none.
    for (const stated of ['material', 'particleStyle', 'deformMode']) {
      assert.ok(stated in state, `${stated} is absent, so applying the example defaults it silently`);
    }
    assert.equal(state.deformMode, 'surface', 'the example displaces a surface, not a volume');
    assert.equal(state.volumeKey, null);
  });

  test('every field it carries is one applyState actually reads', () => {
    // A field nobody reads is a promise the row cannot keep. STATE_FIELDS plus
    // PARAM_FIELDS is applyState's own definition of "looks like a preset".
    const src = read('src/ui/presets.js');
    const known = new Set([
      ...JSON.parse('[' + src.match(/const STATE_FIELDS = \[([\s\S]*?)\]/)[1]
        .replace(/\/\/[^\n]*/g, '').replace(/,\s*$/, '').replace(/'/g, '"') + ']'),
      ...JSON.parse(src.match(/const PARAM_FIELDS = \[([\s\S]*?)\]/)[1]
        .replace(/\/\/[^\n]*/g, '').replace(/'/g, '"').replace(/^/, '[').replace(/$/, ']')),
      '_version', 'gpuMode',
    ]);
    for (const k of Object.keys(state)) {
      assert.ok(known.has(k), `the example carries "${k}", which applyState never reads`);
    }
  });

  test('the GLSL has one home: the row quotes the gallery, it does not copy it', () => {
    const vert = SE_PRESETS.find(p => p.id === 'knobs-vert');
    const frag = SE_PRESETS.find(p => p.id === 'knobs-frag');
    assert.ok(vert && frag, 'the knob examples lost their ids, so the seed cannot find them');
    assert.equal(state.shader.vert, vert.code);
    assert.equal(state.shader.frag, frag.code);
  });
});

describe('the knobs are demonstrated where someone will actually meet them', () => {

  test('the gallery has an example on each tab', () => {
    const usingK = SE_PRESETS.filter(p => /uK[0-3]/.test(p.code));
    assert.ok(usingK.some(p => p.tab === 'vert'), 'no vertex example reads a knob');
    assert.ok(usingK.some(p => p.tab === 'frag'), 'no fragment example reads a knob');
  });

  test('both default bodies read one, so the first thing anyone opens shows it', () => {
    const src = read('src/shaders.js');
    for (const name of ['SE_DEFAULT_VERT', 'SE_DEFAULT_FRAG']) {
      const m = src.match(new RegExp(`${name}\\s*=\\s*\`([\\s\\S]*?)\``));
      assert.ok(m, `${name} is no longer a template literal`);
      assert.match(m[1], /uK[0-3]/, `${name} does not mention the knobs at all`);
    }
  });

  test('and they read one at REST-neutral scale, so the shipped look is unchanged', () => {
    // A default body that looked different from the one people know would be a
    // silent redesign smuggled in behind a demonstration. Both are written so
    // that at knob 0 the expression collapses to what it was: `* (1.0 + uK0 *
    // 2.0)` is `* 1.0`, and `* (1.0 + uK1 * 1.5)` is `* 1.0`.
    const src = read('src/shaders.js');
    for (const name of ['SE_DEFAULT_VERT', 'SE_DEFAULT_FRAG']) {
      const body = src.match(new RegExp(`${name}\\s*=\\s*\`([\\s\\S]*?)\``))[1];
      const code = body.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      assert.match(code, /\(\s*1\.0\s*\+\s*uK[0-3]\s*\*/,
        `${name} reads a knob in a form that changes the look at rest`);
    }
  });

  test('the boot path calls the seed', () => {
    const controls = read('src/ui/controls.js');
    assert.match(controls, /_seedFactoryPresets\?\.\(\)/,
      'nothing seeds the example on boot, so it exists and nobody receives it');
    assert.ok(controls.indexOf('_seedFactoryPresets') < controls.indexOf('ui._renderPresets()'),
      'the seed runs after the list is drawn, so the first boot shows an empty panel');
  });
});
