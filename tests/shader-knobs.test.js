// tests/shader-knobs.test.js
//
// Four numbers that make a hand-written shader playable instead of frozen.
//
// Before them, every number in a custom shader was baked into its text.
// Changing one meant reopening a modal that blacks out the screen and — because
// the cursor sits in a TEXTAREA, which both global keydown handlers stand down
// for — disarms every hotkey; then editing; then APPLY, which builds a probe
// scene and a render target and swaps the program with needsUpdate. That is a
// CUT. Every other live change in this app is a tween: a GPU mode crossfades
// over 1200 ms, a palette over 600, a shape through a morph. So the surface the
// product calls its most powerful was the only one that could not be played.
//
// uK0..uK3 are ordinary PARAMS entries, which is the whole trick: that alone
// gives them sliders, MIDI mapping, preset capture, autosave and RESET ALL,
// with no new machinery in any of those.
//
// The assertion that matters most here is the pairing one. k0 writing uK1 would
// be invisible in every other test in this repository and in most use — the
// knob would still move something.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const IDS = ['k0', 'k1', 'k2', 'k3'];

let PARAMS, MIDI_PARAMS, REQUIRED_IDS, VS, FS, resetParamsToDefault;
before(async () => {
  ({ PARAMS, MIDI_PARAMS, resetParamsToDefault } = await import('../src/params.js'));
  ({ REQUIRED_IDS } = await import('../src/dom.js'));
  ({ VS, FS } = await import('../src/shaders.js'));
});

/** A ctx with the four uniforms and nothing else the knobs need. */
const makeCtx = () => ({
  render: { U: { uK0: { value: 0 }, uK1: { value: 0 }, uK2: { value: 0 }, uK3: { value: 0 } } },
});

/**
 * A ctx the REAL RESET ALL can be driven against.
 *
 * resetParamsToDefault walks every entry in PARAMS, not just the four here, so
 * it reaches into ctx.audio, ctx.camera and a dozen engine methods this file
 * has no interest in. Rather than enumerate them — a list that would go stale
 * the next time a parameter is added, and whose staleness would show up as a
 * failure in the shader-knob tests — anything not asked about auto-vivifies
 * into something that can be read, written and called.
 *
 * The four uniforms are real slots, so what the knobs do is measured and
 * everything else is merely tolerated.
 */
const permissive = () => new Proxy(function () {}, {
  get: (t, k) => {
    if (k === 'then' || typeof k === 'symbol') return undefined;
    if (!(k in t)) t[k] = permissive();
    return t[k];
  },
  set: (t, k, v) => { t[k] = v; return true; },
  apply: () => undefined,
});

const makeResetCtx = () => {
  // applyParam ends in syncParamUI, which coalesces its DOM writes through
  // requestAnimationFrame. There is no frame loop in Node and the writes are
  // not what is under test, so it runs them straight away.
  globalThis.requestAnimationFrame ??= (fn) => { fn(); return 0; };
  const ctx = permissive();
  // U stays permissive — every other parameter writes a uniform through it —
  // with the four this file is about seeded as real slots.
  for (let n = 0; n < 4; n++) ctx.render.U[`uK${n}`] = { value: 0 };
  return ctx;
};

describe('each knob is wired to its own uniform', () => {

  test('all four exist as params', () => {
    for (const id of IDS) assert.ok(PARAMS[id], `PARAMS.${id} is missing`);
  });

  test('k0..k3 write uK0..uK3, in that order', () => {
    // The copy-paste failure: k2 writing uK1 would still move something when
    // the knob is turned, so nothing else in this repo would notice.
    IDS.forEach((id, n) => {
      const ctx = makeCtx();
      PARAMS[id].set(ctx, 0.5);
      const written = Object.entries(ctx.render.U).filter(([, u]) => u.value === 0.5).map(([k]) => k);
      assert.deepEqual(written, [`uK${n}`],
        `PARAMS.${id}.set wrote ${written.join(', ') || 'nothing'} instead of uK${n}`);
    });
  });

  test('each reads back the uniform it wrote, and not a neighbour', () => {
    IDS.forEach((id, n) => {
      const ctx = makeCtx();
      ctx.render.U[`uK${n}`].value = 0.375;
      assert.equal(PARAMS[id].get(ctx), 0.375, `PARAMS.${id}.get does not read uK${n}`);
    });
  });

  test('the engine declares all four uniforms', () => {
    // RenderEngine needs a WebGL context to construct, so this reads the
    // declaration rather than the object.
    const src = read('src/render.js');
    for (let n = 0; n < 4; n++) {
      assert.match(src, new RegExp(`uK${n}\\s*:\\s*\\{\\s*value\\s*:`),
        `render.U does not declare uK${n}, so the slider writes into undefined`);
    }
  });
});

describe('they behave like every other parameter', () => {

  test('0 to 1, defaulting to 0 — the range a MIDI CC maps onto with no curve', () => {
    for (const id of IDS) {
      const p = PARAMS[id];
      assert.equal(p.min, 0, `${id} does not start at 0`);
      assert.equal(p.max, 1, `${id} does not end at 1`);
      assert.equal(p.default, 0, `${id} defaults to something nobody chose`);
    }
  });

  test('they reach the MIDI dropdown', () => {
    for (const id of IDS) {
      const entry = MIDI_PARAMS.find(p => p.id === id);
      assert.ok(entry, `${id} is not offered for MIDI mapping, which is the point of it`);
      assert.match(entry.label, /Knob/, `${id}'s label does not say what it is: ${entry.label}`);
    }
  });

  test('each has a distinct label, so the dropdown is usable', () => {
    const labels = IDS.map(id => PARAMS[id].label);
    assert.equal(new Set(labels).size, 4, `two knobs share a label: ${labels.join(', ')}`);
  });

  test('they travel in presets and in the autosave', () => {
    // A knob position IS part of a look: the preset carries the shader that
    // reads uK0, so it has to carry where uK0 was.
    const presets = read('src/ui/presets.js');
    const m = presets.match(/const PARAM_FIELDS = \[([\s\S]*?)\]/);
    assert.ok(m, 'PARAM_FIELDS is no longer an array literal');
    for (const id of IDS) {
      assert.match(m[1], new RegExp(`'${id}'`),
        `${id} is not in PARAM_FIELDS, so a preset restores the shader without its knobs`);
    }
  });

  test('a slider and a readout exist, and boot verifies them', () => {
    const html = read('index.html');
    for (let n = 0; n < 4; n++) {
      assert.match(html, new RegExp(`id="shader-k${n}"`), `no slider for uK${n}`);
      assert.match(html, new RegExp(`id="k${n}v"`), `no value readout for uK${n}`);
      assert.ok(REQUIRED_IDS.includes(`shader-k${n}`),
        `shader-k${n} is outside the dom.js contract, so losing it fails silently`);
      assert.ok(REQUIRED_IDS.includes(`k${n}v`), `k${n}v is outside the dom.js contract`);
    }
  });

  test('the sliders are what the params name', () => {
    // dom.js keys, not raw ids — bindParamSliders looks the element up by key.
    IDS.forEach((id, n) => {
      assert.equal(PARAMS[id].slider, `shaderK${n}`);
      assert.equal(PARAMS[id].display, `k${n}v`);
    });
  });

  test('RESET ALL puts them back to 0', () => {
    // FIX(r6): this used to set each knob to its own `default` by hand and then
    // assert the uniform was 0 — which is `set(0)` followed by `expect 0`, and
    // says nothing whatever about RESET ALL. It never touched
    // resetParamsToDefault, so a knob dropped from the reset path, or a reset
    // that skipped anything without a slider element present, would have gone
    // unnoticed by the one test named after it.
    const ctx = makeResetCtx();
    for (const id of IDS) PARAMS[id].set(ctx, 0.9);
    for (let n = 0; n < 4; n++) {
      assert.equal(ctx.render.U[`uK${n}`].value, 0.9, `precondition: uK${n} was not moved`);
    }

    resetParamsToDefault(ctx);

    for (let n = 0; n < 4; n++) {
      assert.equal(ctx.render.U[`uK${n}`].value, 0,
        `RESET ALL left uK${n} where the operator had put it`);
    }
  });
});

describe('they are visible to a custom shader and to nothing else', () => {

  const src = read('src/shaders.js');
  const between = (from, to) => src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined);

  test('both editor scaffolds declare them', () => {
    const vs = between('const SE_VS_TEMPLATE', 'const SE_FS_TEMPLATE');
    const fs_ = between('const SE_FS_TEMPLATE', 'SE_DEFAULT_VERT');
    for (const scaffold of [['vertex', vs], ['fragment', fs_]]) {
      assert.match(scaffold[1], /uniform float uK0,uK1,uK2,uK3;/,
        `the ${scaffold[0]} scaffold does not declare the knobs, so uK0 is an undeclared identifier`);
    }
  });

  test('the built-in programs do not', () => {
    // A uniform nothing reads is a uniform that drifts. The built-ins have no
    // use for these, and declaring them there would invite one.
    for (const [name, prog] of [['VS', VS], ['FS', FS]]) {
      assert.doesNotMatch(prog, /uK0/,
        `the built-in ${name} declares uK0, which nothing in it reads`);
    }
  });

  test('nothing writes them per frame', () => {
    // They are written by applyParam and by nothing else. A per-frame writer
    // would fight the slider and the MIDI knob for the same value.
    const render = read('src/render.js')
      .split('\n')
      .filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*')); })
      .join('\n');
    const writes = [...render.matchAll(/U\.uK\d\.value\s*=/g)];
    assert.deepEqual(writes.map(m => m[0]), [],
      'render.js assigns a knob uniform outside the params registry');
  });
});

describe('a user can find out they exist', () => {

  test('the editor reference strip names them', () => {
    const strip = read('index.html').match(/<div id="se-ref">([\s\S]*?)<\/div>/)[1];
    for (let n = 0; n < 4; n++) {
      assert.ok(strip.includes(`uK${n}`), `#se-ref does not mention uK${n}`);
    }
  });

  test('the document explains what they are for', () => {
    const doc = read('documents/shader-editor.md');
    assert.match(doc, /uK0/, 'shader-editor.md does not mention the knobs');
    assert.match(doc, /MIDI/, 'the doc does not say they can go on a controller');
    assert.match(doc, /```glsl[\s\S]*?uK0[\s\S]*?```/,
      'the doc names the knobs without showing one used in a shader');
  });

  test('the panel says which names to type', () => {
    // The sliders are useless if the operator cannot guess what to write.
    const html = read('index.html');
    const section = html.slice(html.indexOf('SHADER KNOBS'), html.indexOf('SHADER KNOBS') + 900);
    assert.match(section, /uK0/, 'the panel group does not name the uniforms it drives');
  });
});
