// tests/formula-picker.test.js
//
// Contract tests for the R / F randomiser pool (src/formula-picker.js).
//
// Run:
//   node --test tests/formula-picker.test.js
//
// ── The defect pinned here ────────────────────────────────────────────────────
// #gpu-sel offers two families — 38 GPU shaders (numeric values) and 192 CPU
// math formulas (`m:collection:key`) — and the randomiser built its bag from
// getAllFormulasList(), which knows only the second. So R and F could not land
// on a GPU shader at all: not rarely, never. A test that only asked "does it
// return something" would have passed throughout. The first test below is the
// one that would have failed.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// FormulaPicker takes both families as constructor arguments and an injectable
// RNG, so there is no DOM, no engine and no randomness to wait out. dom.js is
// reached through utils.js → params.js, and its Node guard leaves DOM an empty
// stub outside a browser — no document needed here.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let FormulaPicker, isMathValue;
before(async () => {
  ({ FormulaPicker, isMathValue } = await import('../src/formula-picker.js'));
});

const GPU = ['0', '1', '2', '3'];
const CPU = [
  { collectionId: 'fractals',        key: 'henon' },
  { collectionId: 'fractals',        key: 'julia' },
  { collectionId: 'differentialEqs', key: 'pendulumNonLinear' },
  { collectionId: 'waves',           key: 'standing' },
];

/** Deterministic RNG cycling through the given values. */
function rng(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function drawMany(picker, n) {
  return Array.from({ length: n }, () => picker.next());
}

describe('FormulaPicker — both families are in the pool', () => {
  test('draws reach GPU shaders as well as CPU formulas', () => {
    // THE regression. With the old pool every draw was an `m:` value.
    const picker = new FormulaPicker({ gpuValues: GPU, cpuFormulas: CPU });
    const seen = drawMany(picker, 60);
    assert.ok(seen.some(v => !isMathValue(v)), 'no GPU shader in 60 draws — the old bug');
    assert.ok(seen.some(v => isMathValue(v)),  'no CPU formula in 60 draws');
  });

  test('a CPU draw is shaped like the dropdown value it has to be', () => {
    // The caller feeds this straight into #gpu-sel and the same branch the
    // dropdown's change handler uses; a wrong shape would silently pick nothing.
    const picker = new FormulaPicker({ cpuFormulas: CPU });
    for (const v of drawMany(picker, 8)) {
      assert.match(v, /^m:[A-Za-z]+:[A-Za-z]+$/);
      const [, colId, key] = v.split(':');
      assert.ok(CPU.some(f => f.collectionId === colId && f.key === key),
        `${v} names a formula that is not in the catalogue`);
    }
  });

  test('a GPU draw is a numeric index, not a name', () => {
    const picker = new FormulaPicker({ gpuValues: GPU });
    for (const v of drawMany(picker, 8)) {
      assert.ok(!isMathValue(v));
      assert.ok(Number.isInteger(+v), `${v} is not a shader index`);
    }
  });
});

describe('FormulaPicker — the split between families', () => {
  test('gpuShare 1 draws only shaders, 0 only formulas', () => {
    const all = { gpuValues: GPU, cpuFormulas: CPU, random: () => 0.5 };
    const onlyGpu = new FormulaPicker({ ...all, gpuShare: 1 });
    const onlyCpu = new FormulaPicker({ ...all, gpuShare: 0 });
    assert.ok(drawMany(onlyGpu, 12).every(v => !isMathValue(v)));
    assert.ok(drawMany(onlyCpu, 12).every(v => isMathValue(v)));
  });

  test('the coin decides the family, then the family deals', () => {
    // 0.1 < 0.5 → GPU, 0.9 → CPU. Alternating gives a strict alternation of
    // families, which is what "the coin comes first" means.
    const picker = new FormulaPicker({
      gpuValues: GPU, cpuFormulas: CPU, gpuShare: 0.5, random: rng(0.1, 0.9),
    });
    const kinds = drawMany(picker, 8).map(isMathValue);
    assert.deepEqual(kinds, [false, true, false, true, false, true, false, true]);
  });
});

describe('FormulaPicker — degenerate pools', () => {
  test('no shaders: every draw is a formula, nothing throws', () => {
    // ShuffleBag throws on an empty pool; an absent family must degrade to
    // "draw from the other one", not take the hotkey down with it.
    const picker = new FormulaPicker({ gpuValues: [], cpuFormulas: CPU, random: () => 0.1 });
    assert.equal(picker.isEmpty, false);
    assert.ok(drawMany(picker, 10).every(isMathValue));
  });

  test('no formulas: every draw is a shader', () => {
    const picker = new FormulaPicker({ gpuValues: GPU, cpuFormulas: [], random: () => 0.9 });
    assert.equal(picker.isEmpty, false);
    assert.ok(drawMany(picker, 10).every(v => !isMathValue(v)));
  });

  test('nothing at all: isEmpty, and next() answers null', () => {
    const picker = new FormulaPicker({});
    assert.equal(picker.isEmpty, true);
    assert.equal(picker.next(), null);
  });
});

describe('FormulaPicker — no repeats inside a family', () => {
  test('a family deals its whole deck before repeating', () => {
    // The Spotify-shuffle property the hotkeys already had, now per family:
    // four shaders drawn four times must be four different shaders.
    const picker = new FormulaPicker({
      gpuValues: GPU, cpuFormulas: CPU, gpuShare: 1, random: () => 0,
    });
    assert.deepEqual(drawMany(picker, 4).sort(), [...GPU].sort());
  });

  test('the two decks are independent — one family cannot exhaust the other', () => {
    const picker = new FormulaPicker({
      gpuValues: GPU, cpuFormulas: CPU, gpuShare: 0.5, random: rng(0.1, 0.9),
    });
    const draws = drawMany(picker, 8);
    assert.deepEqual(draws.filter(v => !isMathValue(v)).sort(), [...GPU].sort());
    assert.equal(new Set(draws.filter(isMathValue)).size, 4);
  });
});

// The picker forwards "what is on screen" to whichever bag draws. Without it a
// draw could return the value already selected — after the dropdown, a preset
// or a clip step moved it — and F would read as a dropped keypress.
describe('FormulaPicker.next(current) — a draw is not what is already selected', () => {

  test('the GPU half does not redraw the live shader', () => {
    const picker = new FormulaPicker({ gpuValues: ['0', '1'], cpuFormulas: [], rng: undefined, random: () => 0 });
    const first  = picker.next();
    const other  = first === '0' ? '1' : '0';

    assert.notEqual(picker.next(other), other);
  });

  test('the CPU half compares on the assembled m: value, not on the record', () => {
    // The bag deals {collectionId, key} objects while the selector holds a
    // string, so the comparison has to be made on the string.
    const picker = new FormulaPicker({
      gpuValues: [],
      cpuFormulas: [
        { collectionId: 'fractals', key: 'henon' },
        { collectionId: 'waves',    key: 'standing' },
      ],
      random: () => 0.99,
    });
    const first = picker.next();
    const other = first === 'm:fractals:henon' ? 'm:waves:standing' : 'm:fractals:henon';

    assert.notEqual(picker.next(other), other);
  });

  test('control — with no argument it draws exactly as before', () => {
    const picker = new FormulaPicker({ gpuValues: GPU, cpuFormulas: CPU, random: rng(0.1, 0.9) });
    const drawn  = drawMany(picker, 20);
    assert.equal(drawn.length, 20);
    assert.ok(drawn.every(v => v != null), 'a family that is present must always yield a value');
  });
});
