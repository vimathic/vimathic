// tests/colour-pool-step.test.js
//
// The E hotkey — "next colour scheme" — and the pool it is allowed to step in.
//
// Run:
//   node --test tests/colour-pool-step.test.js
//
// ── The defect ───────────────────────────────────────────────────────────────
// NIGHT narrows what the app picks unattended. controls.js states the invariant
// where it narrows AUTO COLOUR: doing one picker and not the other "would leave
// a bright palette one keypress away from a mode whose whole claim is that it
// does not do that". Q and R were narrowed — both draw from the shuffle bag
// main.js rebuilds on ui.onColorPoolChange, and tests/controls-wiring.test.js
// pins that hook from the panel side. E was not. It read
// `(colorIdx + 1) % COLOR_SCHEME_COUNT`, the whole catalogue, and it is the one
// colour key that walks in a straight line: the mode opens on scheme 44, so ten
// presses left the NIGHT ten and landed on scheme 0 — the brightest thing in
// the build — with the mode still on and the room still dark.
//
// It survived because it lived in main.js's keydown switch, which no test can
// reach: main.js instantiates the whole app at import time. So the rule moved
// into params.js, the same remedy controls.js applied to the four hotkeys that
// moved out of that switch before it. These tests are the reason it moved.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextInPool, ALL_SCHEMES, NIGHT_SCHEMES, NIGHT_SCHEME_FIRST, COLOR_SCHEME_COUNT,
} from '../src/params.js';

describe('E steps inside the pool it is given', () => {

  test('outside NIGHT it is bit-identical to the line it replaces', () => {
    // The whole catalogue, every scheme, against the old expression written out
    // — so "the fix changes nothing when the mode is off" is measured and not
    // asserted from the shape of the code.
    for (let i = 0; i < COLOR_SCHEME_COUNT; i++) {
      assert.equal(nextInPool(ALL_SCHEMES, i), (i + 1) % COLOR_SCHEME_COUNT,
        `scheme ${i} steps somewhere new`);
    }
  });

  test('under NIGHT every step lands inside the series', () => {
    for (const i of NIGHT_SCHEMES) {
      const next = nextInPool(NIGHT_SCHEMES, i);
      assert.ok(NIGHT_SCHEMES.includes(next),
        `from ${i}, E left the NIGHT series for ${next}`);
    }
  });

  test('the top of the series wraps to its bottom, not to scheme 0', () => {
    const last = NIGHT_SCHEMES[NIGHT_SCHEMES.length - 1];
    assert.equal(nextInPool(NIGHT_SCHEMES, last), NIGHT_SCHEME_FIRST);
    // The exact defect, in one line: this used to be scheme 0.
    assert.notEqual(nextInPool(NIGHT_SCHEMES, last), 0);
  });

  test('ten presses walk the whole series and come back — none of them escapes', () => {
    // Ten is the length of the series and the number of presses the old rule
    // needed to leave it.
    let i = NIGHT_SCHEME_FIRST;
    const seen = new Set([i]);
    for (let n = 0; n < NIGHT_SCHEMES.length; n++) {
      i = nextInPool(NIGHT_SCHEMES, i);
      assert.ok(NIGHT_SCHEMES.includes(i), `press ${n + 1} left the series at ${i}`);
      seen.add(i);
    }
    assert.equal(seen.size, NIGHT_SCHEMES.length, 'the walk repeats before it has seen the series');
    assert.equal(i, NIGHT_SCHEME_FIRST, 'the walk does not close');
  });

  test('control — the SAME walk under ALL_SCHEMES does leave the series', () => {
    // Without this the four assertions above would pass on a pool that simply
    // has nowhere else to go, rather than on a step that respects the pool.
    let i = NIGHT_SCHEME_FIRST;
    let escaped = false;
    for (let n = 0; n < NIGHT_SCHEMES.length; n++) {
      i = nextInPool(ALL_SCHEMES, i);
      if (!NIGHT_SCHEMES.includes(i)) escaped = true;
    }
    assert.ok(escaped,
      'the old rule kept the mode after all — then these tests measure nothing');
    assert.equal(i, 0, 'the escape lands on scheme 0, the brightest in the build');
  });

  test('a scheme the pool does not hold steps INTO the pool', () => {
    // Reachable and not rare: NIGHT deliberately leaves the COLOR SCHEME
    // dropdown free, and a preset or a clip step carries its own palette. From
    // a bright scheme under NIGHT, E has to move somewhere sensible rather than
    // stand still or hand back undefined.
    for (const bright of [0, 16, NIGHT_SCHEME_FIRST - 1]) {
      assert.equal(nextInPool(NIGHT_SCHEMES, bright), NIGHT_SCHEME_FIRST,
        `from bright scheme ${bright}, E did not step into the series`);
    }
  });

  test('an empty pool leaves the palette where it is', () => {
    // Not reachable from the two shipped pools, and that is the point: the
    // failure it forecloses is `pool[NaN]` reaching audio.colorIdx and the
    // shader, which is a black screen rather than an exception.
    assert.equal(nextInPool([], 16), 16);
    assert.equal(nextInPool(null, 16), 16);
    assert.equal(nextInPool(undefined, 16), 16);
  });

  test('every value it can return is a real palette', () => {
    // The ceiling the MIDI range and the <option> list share: past
    // COLOR_SCHEME_COUNT-1 there is no palette and no dropdown entry.
    for (const pool of [ALL_SCHEMES, NIGHT_SCHEMES]) {
      for (let i = -3; i < COLOR_SCHEME_COUNT + 3; i++) {
        const v = nextInPool(pool, i);
        assert.ok(Number.isInteger(v) && v >= 0 && v < COLOR_SCHEME_COUNT,
          `pool step from ${i} produced ${v}`);
      }
    }
  });
});
