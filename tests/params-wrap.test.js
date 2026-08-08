// tests/params-wrap.test.js
//
// Contract test for the one enumerated param in the registry: colorIdx must
// WRAP, every other param must keep the "extended values stay extended"
// policy that applyParam documents.
//
// Run:
//   node --test tests/params-wrap.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// A rotary encoder mapped to "Color Scheme (step)" — REL is the default mode
// for a new mapping — kept incrementing past the last palette. There is no
// scheme 44 and no <option value="44">, so the picture froze on the shader's
// out-of-range fallback and DOM.colorSel.selectedIndex went -1, i.e. the
// dropdown blanked and the operator could not see where they were. The lower
// clamp existed; the ceiling did not.
//
// The fix belongs in applyParam, not in the MIDI decoder: applyParam is the one
// funnel every writer goes through (MIDI relative mode, preset and autosave
// restore, RESET ALL, the E hotkey), so fixing it in utils.js would have left
// a re-applied preset still writing 56.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// dom.js resolves its element table at module load and throws when `document`
// exists but the ids do not, so params.js and utils.js are imported BEFORE any
// document stub is installed — that is dom.js's own node branch. The stubs go
// in afterwards, because MIDIController._init() reads #midi-badge and
// syncParamUI coalesces its writes through requestAnimationFrame.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let PARAMS, applyParam, COLOR_SCHEME_COUNT, MIDIController;

before(async () => {
  ({ PARAMS, applyParam, COLOR_SCHEME_COUNT } = await import('../src/params.js'));
  ({ MIDIController } = await import('../src/utils.js'));

  globalThis.requestAnimationFrame = () => 0;
  globalThis.document = { getElementById: () => null };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
});

// Minimal ctx: only the paths the two params under test read and write.
function makeCtx() {
  const schemes = [];
  return {
    schemes,
    audio:  { colorIdx: 16, bassSens: 1.2 },
    render: { setColorSchemeAnimated: i => schemes.push(i) },
  };
}

describe('applyParam — enumerated params wrap', () => {
  test('colorIdx wraps at COLOR_SCHEME_COUNT instead of running away', () => {
    const ctx = makeCtx();
    applyParam(ctx, 'colorIdx', COLOR_SCHEME_COUNT);          // one past the last
    assert.equal(ctx.audio.colorIdx, 0);
    applyParam(ctx, 'colorIdx', COLOR_SCHEME_COUNT + 12);
    assert.equal(ctx.audio.colorIdx, 12);
    // Every value handed to the engine must be a real scheme index.
    for (const i of ctx.schemes) {
      assert.ok(i >= 0 && i < COLOR_SCHEME_COUNT, `scheme index out of range: ${i}`);
    }
  });

  test('colorIdx wraps downwards too — an encoder is endless in both directions', () => {
    const ctx = makeCtx();
    applyParam(ctx, 'colorIdx', -1);
    assert.equal(ctx.audio.colorIdx, COLOR_SCHEME_COUNT - 1);
  });

  test('a corrupted preset value cannot persist an out-of-range scheme', () => {
    const ctx = makeCtx();
    applyParam(ctx, 'colorIdx', 56);
    assert.ok(PARAMS.colorIdx.get(ctx) <= PARAMS.colorIdx.max);
    assert.ok(PARAMS.colorIdx.get(ctx) >= PARAMS.colorIdx.min);
  });

  test('continuous params are NOT clamped — the wrap must not be over-applied', () => {
    // applyParam's doc block promises a VJ who types 500 gets 500. A fix that
    // clamped or wrapped every param would break that, and this is the guard.
    const ctx = makeCtx();
    applyParam(ctx, 'bassSens', 500);
    assert.equal(ctx.audio.bassSens, 500);
    applyParam(ctx, 'bassSens', -3);          // lower clamp still applies
    assert.equal(ctx.audio.bassSens, PARAMS.bassSens.min);
  });
});

describe('MIDI relative mode — the path a user actually turns', () => {
  test('an encoder on Color Scheme stays inside the palette range', async () => {
    const ctx = makeCtx();

    const input  = { onmidimessage: null };
    const inputs = new Map([['in-1', input]]);
    const access = { inputs, onstatechange: null };
    Object.defineProperty(globalThis, 'navigator', {
      value: { requestMIDIAccess: async () => access },
      configurable: true,
    });

    const midi = new MIDIController();
    // Wired exactly as main.js does it.
    midi.cb.onParamSet    = (id, val) => applyParam(ctx, id, val);
    midi.cb.getParamValue = id => PARAMS[id].get(ctx);
    // _init() is async — wait for the input to be attached.
    for (let i = 0; i < 50 && !input.onmidimessage; i++) await new Promise(r => setImmediate(r));
    assert.ok(input.onmidimessage, 'MIDI input was never attached');

    midi.setMapping(21, 'colorIdx');          // REL is the default mode
    for (let turn = 0; turn < 60; turn++) {
      input.onmidimessage({ data: [0xB0, 21, 0x01] });   // one click clockwise
      const v = ctx.audio.colorIdx;
      assert.ok(v >= 0 && v < COLOR_SCHEME_COUNT,
        `colorIdx left the palette range after ${turn + 1} clicks: ${v}`);
    }
    // And it kept moving rather than sticking at the top.
    assert.ok(ctx.schemes.length > 1);
    assert.ok(new Set(ctx.schemes).size > 1, 'palette froze instead of cycling');
  });
});
