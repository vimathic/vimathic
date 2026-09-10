// tests/formula-knobs.test.js
//
// The two hands on a CPU formula, checked where it matters: at the formula.
//
// Every one of the 192 CPU formulas is called as fn(x, z, t, {amp, freq, comp}).
// MathVisualizer builds those three from audio — `amp * (1 + bass*0.5)`,
// `waveInt * (1 + treble*0.3)`, `0.5 + mid*0.4` — so the first two carried the
// operator's Amplitude and Wave Intensity sliders and the third carried nothing
// of theirs. `comp` decides iteration depth, feed/kill rates and simulation
// regime in 218 destructures across math-collections.js, and it never left
// 0.5..0.9 because nothing could move it.
//
// These tests drive the real _tickSurface with the worker disabled, so what they
// observe is the argument object the formula itself receives — not a copy of the
// arithmetic restated in the test, which would pass on any tree.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let MathVisualizer, PARAMS, THREE;
before(async () => {
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
  ({ PARAMS } = await import('../src/params.js'));
  THREE = await import('three');
});

const TIME = 3.25;

/**
 * Run one surface tick with the worker off and report what the formula got.
 *
 * _workerReady = false is what forces the synchronous branch, which calls
 * generateSurfaceFromFormula directly — the same call the worker's 'tick' case
 * makes, on the same arguments.
 */
function tickWith({ detail = 0.5, phase = 0, mid = 0, beatInt = 0 } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  const render = {
    isMobile: false,
    U: { uMathMode: { value: 1 }, uMorphProgress: { value: 1 }, uVHField: { value: 0 } },
    gpuMesh: { geometry: geo },
    gpuPtsProxy: null,
    cb: {},
    formulaDetail: detail,
    formulaPhase: phase,
  };
  const viz = new MathVisualizer(render, { bass: 0, mid, treble: 0, beatInt, amp: 0.7, waveInt: 1 });
  viz._workerReady = false;
  viz.onShapeChange();

  const seen = [];
  viz._formulaFn = (x, z, t, params) => { seen.push({ t, ...params }); return 0; };
  viz._tickSurface(TIME);

  assert.ok(seen.length, 'the formula was never called — the harness no longer reaches it');
  return seen[0];
}

describe('at rest, a formula sees exactly what it always saw', () => {

  test('the knobs at their defaults reproduce the shipped arithmetic, to the bit', () => {
    // The discipline this whole branch has kept: a new control must be a no-op
    // where it rests, or it is a silent redesign wearing a feature's clothes.
    // `0.5 + mid*0.4` and `time + beatInt*0.3` are the two expressions that
    // shipped; at detail 0.5 and phase 0 they must come back unchanged.
    const mid = 0.37, beatInt = 0.62;
    const got = tickWith({ mid, beatInt });
    assert.equal(got.comp, 0.5 + mid * 0.4, 'comp at rest is not the shipped expression');
    assert.equal(got.t, TIME + beatInt * 0.3, 't at rest is not the shipped expression');
  });

  test('and the defaults in the registry ARE those rest values', () => {
    // A rest-neutral expression is only rest-neutral if the knob boots there
    // and RESET ALL returns there.
    assert.equal(PARAMS.detail.default, 0.5, 'detail no longer rests at the centre it is bipolar about');
    assert.equal(PARAMS.phase.default, 0, 'phase no longer rests at no-offset');
  });
});

describe('detail is bipolar, and both halves reach the formula', () => {

  test('below centre it coarsens, above centre it sharpens', () => {
    const at = d => tickWith({ detail: d, mid: 0.5 }).comp;
    const rest = at(0.5);
    assert.ok(at(0.2) < rest, 'turning detail down changed nothing the formula can see');
    assert.ok(at(0.8) > rest, 'turning detail up changed nothing the formula can see');
    // The offset is the knob's distance from centre, not some rescaling of it.
    assert.equal(at(0.2), rest - 0.3);
    assert.equal(at(0.8), rest + 0.3);
  });

  test('the low half is the point, not a consolation prize', () => {
    // `npm run bench:formulas`: Winding Number Field costs 46 ms per tick at
    // comp 0 against 188 ms at comp 0.9, on a 16.7 ms tick. Turning detail down
    // is how an operator buys back the update rate on a heavy formula, so the
    // bottom of `comp` has to be REACHABLE — it never was before, because
    // `0.5 + mid*0.4` has a floor of 0.5 whatever the music does.
    assert.equal(tickWith({ detail: 0, mid: 0 }).comp, 0,
      'the bottom of the range is still unreachable');
    assert.ok(tickWith({ detail: 0, mid: 1 }).comp < 0.5,
      'a loud mid pins comp above the old floor even with detail at zero');
  });

  test('it is clamped, so no formula receives a comp outside 0..1', () => {
    // Formulas clamp defensively (`clamp(comp, 0, 1)` appears throughout
    // math-collections.js) but not all of them do — `maxIt = 6 + comp*10` does
    // not — so the clamp belongs here, before the call.
    for (const [detail, mid] of [[1, 1], [1, 0], [0, 0], [0, 1]]) {
      const c = tickWith({ detail, mid }).comp;
      assert.ok(c >= 0 && c <= 1, `comp left the unit range: ${c} at detail ${detail}, mid ${mid}`);
    }
  });
});

describe('phase slides the formula clock', () => {

  test('a full sweep is a full turn', () => {
    const rest = tickWith({ phase: 0 }).t;
    assert.equal(tickWith({ phase: 1 }).t, rest + Math.PI * 2,
      'one sweep of the knob is not one cycle');
    assert.equal(tickWith({ phase: 0.5 }).t, rest + Math.PI,
      'the offset is not linear in the knob');
  });

  test('it adds to the beat nudge rather than replacing it', () => {
    // `t = time + beatInt*0.3` was there first and is what makes the surface
    // move with the track; the knob is the same nudge in a hand, not a switch
    // that takes the track's away.
    const beatInt = 0.9;
    assert.equal(tickWith({ phase: 0.25, beatInt }).t,
                 TIME + beatInt * 0.3 + Math.PI / 2);
  });
});

describe('they are ordinary parameters, so everything else comes free', () => {

  test('MIDI-mappable, like every other performance control', () => {
    for (const id of ['detail', 'phase']) {
      assert.equal(PARAMS[id].midi, true, `${id} cannot be put on a CC`);
    }
  });

  test('captured in presets and in the autosave — a hand position IS the look', () => {
    const presets = read('src/ui/presets.js');
    const m = presets.match(/const PARAM_FIELDS = \[([\s\S]*?)\]/);
    assert.ok(m, 'PARAM_FIELDS is no longer an array literal');
    for (const id of ['detail', 'phase']) {
      assert.match(m[1], new RegExp(`'${id}'`),
        `${id} is not in PARAM_FIELDS, so a preset recalls the formula without it`);
    }
  });

  test('a slider and a readout exist, and boot verifies them', async () => {
    const { REQUIRED_IDS } = await import('../src/dom.js');
    const html = read('index.html');
    for (const [slider, display] of [['formula-detail', 'fdv'], ['formula-phase', 'fpv']]) {
      assert.match(html, new RegExp(`id="${slider}"`), `no slider for ${slider}`);
      assert.match(html, new RegExp(`id="${display}"`), `no readout for ${display}`);
      assert.ok(REQUIRED_IDS.includes(slider), `${slider} is outside the dom.js contract`);
      assert.ok(REQUIRED_IDS.includes(display), `${display} is outside the dom.js contract`);
    }
  });

  test('the shipped slider markup starts where the knob rests', () => {
    // A slider whose HTML value disagrees with PARAMS.default shows the thumb in
    // one place while the engine is in another until something writes it.
    const html = read('index.html');
    const valueOf = id => Number(html.match(new RegExp(`id="${id}"[^>]*value="([\\d.]+)"`))[1]);
    assert.equal(valueOf('formula-detail'), PARAMS.detail.default);
    assert.equal(valueOf('formula-phase'), PARAMS.phase.default);
  });
});
