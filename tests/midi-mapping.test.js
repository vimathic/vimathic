// tests/midi-mapping.test.js
//
// Contract tests for the MIDI mapping table: what setMapping keeps and what it
// throws away.
//
// Run:
//   node --test tests/midi-mapping.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// setMapping enforces one CC per param by deleting every entry bound to the
// incoming paramId — including the entry for the very CC being written. It then
// read `const existing = this._map[cc]` to carry the mode forward, but its own
// loop had just deleted it, so `mode ?? existing?.mode ?? 'relative'` fell all
// the way through to 'relative'. The JSDoc directly above promises the
// opposite: "When omitted on an update, preserves any existing mode for that
// CC."
//
// The mode is lost precisely when the update keeps the same paramId — which is
// what the row's ⊙ re-learn button does when the operator wiggles the fader
// that is already bound. And the loss is not cosmetic: a fader silently
// switched to REL is decoded as an encoder, so its absolute position is read as
// a signed delta. Position 100 decodes as 100 & 0x3F = 36 ticks with the 0x40
// sign bit set, i.e. -36 — the top half of the fader's travel slams the param
// to its floor and the bottom half pushes it up.
//
// ── Controls ──────────────────────────────────────────────────────────────────
// "a CC re-pointed at another param keeps its mode" and "the older CC is still
// dropped" pass before and after: the first shows the harness can observe a
// preserved mode at all, the second pins that the dedupe rule the loop exists
// for is still enforced.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// Same import-order caveat as tests/params-wrap.test.js: dom.js resolves its
// element table at module load and throws when `document` exists but the ids do
// not, so the modules are imported BEFORE the document stub is installed.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let MIDIController, MIDI_PARAMS;

before(async () => {
  ({ MIDI_PARAMS } = await import('../src/params.js'));
  ({ MIDIController } = await import('../src/utils.js'));

  globalThis.requestAnimationFrame = () => 0;
  globalThis.document = { getElementById: () => null };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
});

/** A controller attached to one fake input, wired as main.js wires it. */
async function makeMidi() {
  const input  = { onmidimessage: null };
  const access = { inputs: new Map([['in-1', input]]), onstatechange: null };
  Object.defineProperty(globalThis, 'navigator', {
    value: { requestMIDIAccess: async () => access },
    configurable: true,
  });

  const midi = new MIDIController();
  const set  = [];
  midi.cb.onParamSet    = (id, val) => set.push({ id, val });
  midi.cb.getParamValue = () => 0.5;
  for (let i = 0; i < 50 && !input.onmidimessage; i++) await new Promise(r => setImmediate(r));
  assert.ok(input.onmidimessage, 'MIDI input was never attached');
  return { midi, input, set };
}

let midi, input, set;
beforeEach(async () => { ({ midi, input, set } = await makeMidi()); });

describe('setMapping keeps the mode the operator chose', () => {

  test('re-learning the same fader does not revert ABS to REL', () => {
    midi.setMapping(20, 'bloom');
    midi.setMappingMode(20, 'absolute');       // the row's REL badge, clicked

    midi.setMapping(20, 'bloom');              // ⊙ re-learn, mode omitted
    assert.equal(midi.getMappingEntry(20).mode, 'absolute',
      'the fader is still a fader; nothing asked for it to become an encoder');
  });

  test('and the fader keeps being decoded as a fader', () => {
    const def = MIDI_PARAMS.find(p => p.id === 'bloom');
    midi.setMapping(20, 'bloom');
    midi.setMappingMode(20, 'absolute');
    midi.setMapping(20, 'bloom');              // ⊙ re-learn

    input.onmidimessage({ data: [0xB0, 20, 100] });   // fader at 100/127
    assert.equal(set.length, 1);
    const expected = def.min + (100 / 127) * (def.max - def.min);
    assert.ok(Math.abs(set[0].val - expected) < 1e-9,
      `absolute travel must map to ${expected}, got ${set[0].val} — a relative ` +
      'decode reads position 100 as -36 ticks and slams the param down');
  });

  test('control — a CC re-pointed at another param keeps its mode', () => {
    midi.setMapping(20, 'bloom');
    midi.setMappingMode(20, 'absolute');

    midi.setMapping(20, 'bassSens');           // dropdown, mode omitted
    assert.equal(midi.getMappingEntry(20).mode, 'absolute');
  });

  test('control — one CC per param is still enforced', () => {
    midi.setMapping(20, 'bloom');
    midi.setMapping(30, 'bloom');              // the same param, a different CC

    assert.equal(midi.getMapping(20), 'none', 'the older binding has to go');
    assert.equal(midi.getMapping(30), 'bloom');
  });

  test('control — a brand-new binding is relative, the default for encoders', () => {
    midi.setMapping(20, 'bloom');
    assert.equal(midi.getMappingEntry(20).mode, 'relative');
  });

  test('control — an explicit mode still wins over the remembered one', () => {
    midi.setMapping(20, 'bloom');
    midi.setMappingMode(20, 'absolute');

    midi.setMapping(20, 'bloom', 'relative');
    assert.equal(midi.getMappingEntry(20).mode, 'relative');
  });
});
