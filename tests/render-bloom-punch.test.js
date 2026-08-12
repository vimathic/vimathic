// tests/render-bloom-punch.test.js
//
// Contract test for the S hotkey's bloom flash.
//
// Run:
//   node --test tests/render-bloom-punch.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// The punch captured bloom's strength on the first press and wrote it back
// 200 ms later without asking what the value was by then. Every other writer
// goes through PARAMS.bloom.set — the panel slider, a MIDI CC, a clip step, a
// preset apply, RESET ALL — and nothing modulates bloom per frame, so a write
// inside that window is somebody's fresh intent. It was silently overwritten,
// and the slider was dragged back with it.
//
// It also moved out of main.js's key handler on the way, for the same reason
// the G fade did: the engine owns bloom, and nothing in main.js can be tested.
// So the failing-first run for this one is "the method did not exist" — the
// same honest caveat tests/grid-visibility.test.js records for fadeGrid.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let RenderEngine;
before(async () => { ({ RenderEngine } = await import('../src/render.js')); });

function makeHost(strength = 0.55) {
  const restored = [];
  return {
    restored,
    bloomPass: { strength },
    cb: { onBloomRestored: v => restored.push(v) },
    punchBloom(...a) { return RenderEngine.prototype.punchBloom.apply(this, a); },
  };
}

describe('a bloom punch gives back only what it took', () => {

  test('it raises bloom and puts it back', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const host = makeHost(0.55);

    host.punchBloom();
    assert.ok(host.bloomPass.strength > 0.55, 'the flash is the point');

    t.mock.timers.tick(200);
    assert.equal(host.bloomPass.strength, 0.55);
    assert.deepEqual(host.restored, [0.55], 'and the panel is told, so the slider follows');
  });

  test('a value set during the punch is not overwritten', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const host = makeHost(0.55);

    host.punchBloom();
    host.bloomPass.strength = 1.2;        // the slider, a CC, a clip step, a preset

    t.mock.timers.tick(200);
    assert.equal(host.bloomPass.strength, 1.2,
      'somebody asked for 1.2 while the flash was up — that is fresher than what we captured');
    assert.deepEqual(host.restored, [], 'and the panel must not be dragged back either');
  });

  test('control — rapid presses do not accumulate, and restore the value before the first', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const host = makeHost(0.4);

    host.punchBloom();
    const first = host.bloomPass.strength;
    t.mock.timers.tick(50);
    host.punchBloom();
    assert.equal(host.bloomPass.strength, first, 'the second press captured the punched value');

    t.mock.timers.tick(200);
    assert.equal(host.bloomPass.strength, 0.4);
  });

  test('control — the punch is clamped', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const host = makeHost(1.4);

    host.punchBloom();
    assert.equal(host.bloomPass.strength, 1.5, 'past this the bloom pass clips to flat white');

    t.mock.timers.tick(200);
    assert.equal(host.bloomPass.strength, 1.4);
  });

  test('control — an engine with no bloom pass is a no-op', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const host = makeHost();
    host.bloomPass = null;

    host.punchBloom();
    t.mock.timers.tick(200);

    assert.deepEqual(host.restored, []);
  });
});
