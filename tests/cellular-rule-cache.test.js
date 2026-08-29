// tests/cellular-rule-cache.test.js
//
// The three cellular-automaton kernels — Rule 90, Rule 110, Rule 184 — sample a
// row of a 1D automaton grown from a single centre cell. The row depends only
// on (rule, generation); `time` is not read and `x` only picks a cell out of a
// finished row. It is now memoised.
//
// Run:
//   node --test tests/cellular-rule-cache.test.js
//
// ── What this guards ────────────────────────────────────────────────────────
// Two things, and the second is the reason the first exists.
//
//   1. VALUES. A cache is only allowed if it changes nothing. Every reachable
//      (rule, x, z) must give bit-identical output to an automaton grown from
//      scratch for that one sample — which is what the shipped code did before
//      the cache, and what the oracle below still does.
//
//   2. COST. The row used to be rebuilt from the seed on EVERY sample, two
//      Uint8Array allocations per generation. Fields are evaluated on a
//      gridSize² lattice with gridSize = sqrt(the mesh's vertex count), so the
//      per-frame cost grew with the mesh while the answer did not: at IFS depth
//      7 on `sierpinski-tetra` (196 608 vertices → grid 443) the same ≤33 rows
//      were computed 196 249 times a frame. Measured on the developer's device,
//      identical mesh and grid: rule90 4.6 FPS against mandelbrot's 31.2.
//
// ── How it guards ───────────────────────────────────────────────────────────
// The oracle is a second, deliberately naive implementation written here — not
// a copy of the shipped constants, but the same definition restated: seed the
// centre cell, apply the rule bitmask `gen` times, read cell
// floor((x+3.5)/7·64). If the shipped kernel and this disagree anywhere on the
// sweep, the cache is wrong.
//
// The sweep proves its own sensitivity: the same comparison run against a
// DELIBERATELY BROKEN cache — one keyed on the generation alone, which is the
// mistake a careless memoisation actually makes, since it looks right until two
// rules share a generation — must FAIL. If that control ever passes, the sweep
// has stopped being able to see anything and the test above it means nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getFormula } from '../src/math-collections.js';

const RULES = { rule90: 90, rule110: 110, rule184: 184 };
const WIDTH = 64;

/** Oracle: grow the automaton from scratch, no cache, nothing shared. */
function oracleRow(rule, gen) {
  let row = new Uint8Array(WIDTH);
  row[WIDTH / 2] = 1;
  for (let g = 0; g < gen; g++) {
    const next = new Uint8Array(WIDTH);
    for (let i = 0; i < WIDTH; i++) {
      const l = row[(i - 1 + WIDTH) % WIDTH], c = row[i], r = row[(i + 1) % WIDTH];
      next[i] = (rule >> ((l << 2) | (c << 1) | r)) & 1;
    }
    row = next;
  }
  return row;
}

function oracleValue(rule, x, z) {
  const gen = Math.floor((z + 3.5) / 7 * 32) + 1;
  const ix = Math.min(WIDTH - 1, Math.max(0, Math.floor((x + 3.5) / 7 * WIDTH)));
  return oracleRow(rule, gen)[ix] ? 0.4 : -0.1;
}

/**
 * The sweep, parameterised by which value-producer to trust. Returns the count
 * of disagreements so the control below can demand a non-zero one.
 *
 * The z range deliberately runs past ±3.5: a body wider than the field extent
 * reaches generations outside the cached range, and those must still be right.
 */
function sweep(valueOf) {
  let bad = 0, checked = 0;
  for (const [key, rule] of Object.entries(RULES)) {
    for (let zi = -40; zi <= 40; zi++) {
      const z = zi * 0.1;
      for (let xi = -40; xi <= 40; xi++) {
        const x = xi * 0.1;
        checked++;
        if (valueOf(key, rule, x, z) !== oracleValue(rule, x, z)) bad++;
      }
    }
  }
  return { bad, checked };
}

describe('cellular automata: the memoised row is the row', () => {
  test('every reachable sample matches an automaton grown from scratch', () => {
    const { bad, checked } = sweep((key, rule, x, z) =>
      getFormula('cellularAutomata', key).f(x, z, 0, { amp: 1 }));
    assert.equal(bad, 0, `${bad} of ${checked} samples disagree with the oracle`);
    assert.ok(checked >= 19_000, `sweep too small to mean anything: ${checked}`);
  });

  test('CONTROL: a cache keyed on the generation alone must fail this sweep', () => {
    // The plausible wrong memoisation: the row is "obviously" a function of the
    // generation, so the rule is left out of the key. Rule 90 is computed
    // first, and 110 and 184 then read its rows.
    const wrongCache = new Map();
    const wrongValue = (key, rule, x, z) => {
      const gen = Math.floor((z + 3.5) / 7 * 32) + 1;
      let row = wrongCache.get(gen);
      if (row === undefined) { row = oracleRow(rule, gen); wrongCache.set(gen, row); }
      const ix = Math.min(WIDTH - 1, Math.max(0, Math.floor((x + 3.5) / 7 * WIDTH)));
      return row[ix] ? 0.4 : -0.1;
    };
    const { bad } = sweep(wrongValue);
    assert.ok(bad > 0, 'the sweep cannot see a rule-blind cache — it guards nothing');
  });

  test('time is not an input, so repeated evaluation is stable', () => {
    const f = getFormula('cellularAutomata', 'rule90').f;
    for (const t of [0, 1.5, 97.25, 1e6]) {
      assert.equal(f(0.7, -1.2, t, { amp: 1 }), f(0.7, -1.2, 0, { amp: 1 }),
        `rule90 moved with time at t=${t}`);
    }
  });

  test('the cached row is never handed out mutable to the caller', () => {
    // The kernel returns a number, not the row — but a future refactor that
    // returned the row itself would let one caller poison every later frame.
    // This pins the contract that only numbers cross the boundary.
    const v = getFormula('cellularAutomata', 'rule90').f(0.1, 0.1, 0, { amp: 1 });
    assert.equal(typeof v, 'number');
  });

  test('amp scales the kernel and does not disturb the row', () => {
    const f = getFormula('cellularAutomata', 'rule110').f;
    for (const [x, z] of [[-2.1, 0.4], [0, 0], [3.1, -3.1]]) {
      assert.ok(Math.abs(f(x, z, 0, { amp: 2 }) - 2 * f(x, z, 0, { amp: 1 })) < 1e-12,
        `rule110 is not linear in amp at (${x}, ${z})`);
    }
  });
});
