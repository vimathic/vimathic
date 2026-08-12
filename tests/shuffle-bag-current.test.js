// tests/shuffle-bag-current.test.js
//
// Contract test for ShuffleBag's no-repeat guarantee when something OTHER than
// the bag has moved the value.
//
// Run:
//   node --test tests/shuffle-bag-current.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// The bag guards its own seam only: it remembers the value IT last dealt and
// never deals it twice in a row. But R, Q and F are not the only writers of the
// things they draw — E steps the palette, D steps the shape, and the dropdowns,
// presets and clip steps write both. After any of those, the bag's memory names
// a value that is no longer on screen, so its next draw can hand back exactly
// what is already there and the keypress does nothing at all. On a two-item
// pool that is every other press; on the shipped pools it is the ordinary
// "pressed R and nothing happened" that reads as a dropped input.
//
// The sibling subsystem already solves this the same way: AutoCycler._draw
// draws once, compares against what is live, and redraws once.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let ShuffleBag;
// No document stub: utils.js reaches dom.js, which resolves its whole element
// table when `document` exists and aborts if the ids do not. Its node branch
// leaves DOM an empty stub when there is no document at all, which is what this
// file wants — the same rule tests/params-wrap.test.js records.
before(async () => { ({ ShuffleBag } = await import('../src/utils.js')); });

describe('ShuffleBag.next(current) — the deck is not the only writer', () => {

  test('a value set by something else is not dealt straight back', () => {
    // With two items, one draw leaves exactly one in the deck — so without the
    // check the next draw is forced to repeat whatever we name here.
    const bag   = new ShuffleBag(['a', 'b']);
    const first = bag.next();
    const other = first === 'a' ? 'b' : 'a';

    // The operator pressed E / D / picked from the dropdown, landing on `other`.
    assert.notEqual(bag.next(other), other,
      'the draw the bag was about to make is already on screen — the keypress would do nothing');
  });

  test('it holds round after round, deck boundaries included', () => {
    // Two items keeps this deterministic: after any draw the deck holds exactly
    // the other one, so naming that other one as "what is on screen" forces the
    // repeat the guard has to catch. Naming the value the BAG just dealt would
    // prove nothing — its own no-repeat guard already covers that case, which
    // is exactly how this defect stayed invisible.
    const bag = new ShuffleBag(['a', 'b']);
    for (let i = 0; i < 8; i++) {
      const dealt = bag.next();
      const other = dealt === 'a' ? 'b' : 'a';
      assert.notEqual(bag.next(other), other, `repeat on round ${i}`);
    }
  });

  test('control — with no argument it behaves exactly as before', () => {
    const bag = new ShuffleBag(['a', 'b', 'c']);
    const seen = new Set();
    let prev = null;
    for (let i = 0; i < 30; i++) {
      const v = bag.next();
      assert.notEqual(v, prev, 'the original no-repeat-across-decks guard');
      seen.add(v); prev = v;
    }
    assert.equal(seen.size, 3, 'and it still deals the whole pool');
  });

  test('control — a single-item pool cannot avoid repeating, and must not hang', () => {
    const bag = new ShuffleBag(['only']);
    assert.equal(bag.next('only'), 'only', 'there is nothing else to deal');
    assert.equal(bag.next('only'), 'only');
  });

  test('control — the pool is still dealt exhaustively', () => {
    const bag = new ShuffleBag([1, 2, 3, 4, 5]);
    const counts = new Map();
    for (let i = 0; i < 100; i++) {
      const v = bag.next();
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    assert.equal(counts.size, 5, 'every item comes up');
    for (const [v, n] of counts) assert.ok(n >= 15, `${v} dealt only ${n} times in 100`);
  });
});
