// tests/viz-mode.test.js
//
// FIX(#51): the viz-mode whitelist. Mirrors what tests/… already hold for the
// shape whitelist: known values pass through untouched (which is what makes
// every call site a provable no-op on paths that were already correct),
// everything else resolves to the default and says so on the console —
// silent was the whole defect.
//
// Run:
//   node --test tests/viz-mode.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VIZ_MODES, DEFAULT_VIZ_MODE, isKnownVizMode, normalizeVizMode } from '../src/viz-mode.js';

describe('the viz-mode whitelist (FIX #51)', () => {
  test('the three modes the app renders are the whole list', () => {
    // index.html carries exactly #mode-surface, #mode-wireframe, #mode-points;
    // a fourth entry here without a fourth button is a claim the UI refutes.
    assert.deepEqual([...VIZ_MODES].sort(), ['points', 'surface', 'wireframe']);
    assert.ok(Object.isFrozen(VIZ_MODES), 'the whitelist must not be appendable at runtime');
    assert.ok(VIZ_MODES.includes(DEFAULT_VIZ_MODE), 'the fallback must itself be renderable');
  });

  test('known values pass through unchanged', () => {
    for (const m of VIZ_MODES) {
      assert.equal(normalizeVizMode(m), m);
      assert.equal(isKnownVizMode(m), true);
    }
  });

  test('everything else resolves to the default and warns', () => {
    const warned = [];
    const realWarn = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try {
      for (const v of ['volumetric-x', '', null, undefined, 3, { mode: 'points' }, 'Points', 'SURFACE']) {
        assert.equal(normalizeVizMode(v), DEFAULT_VIZ_MODE, `for ${JSON.stringify(v)}`);
        assert.equal(isKnownVizMode(v), false, `for ${JSON.stringify(v)}`);
      }
    } finally {
      console.warn = realWarn;
    }
    assert.equal(warned.length, 8, 'each rejection must say so — silent was the defect');
    assert.ok(warned.every(w => w.includes(DEFAULT_VIZ_MODE)), 'the warning must name where the value went');
  });
});
