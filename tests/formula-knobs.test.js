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

/**
 * The same reading, taken at the OTHER two doors into the geometry.
 *
 * There are three ticks — Surface, Collapse and Volume — and each reaches the
 * formula by its own road. The knobs were wired into _tickSurface alone, so in
 * VOLUME and COLLAPSE they moved nothing: the slider moved, the readout
 * counted, presets stored the value and not one pixel changed. The band layer
 * had gone the same way before them, which is why _formulaParams exists and why
 * these two harnesses do.
 *
 * Collapse calls fn(theta, phi, t, params) and Volume calls
 * fn(x, y, z, t, params) — different arities, same last two arguments, which is
 * all these tests read.
 */
function baseFor(viz, geo) {
  viz._basePositions = Float32Array.from(geo.attributes.position.array);
  viz._baseNormals   = Float32Array.from(geo.attributes.normal.array);
  viz._frame = 0;
  viz._throttle = 1;
}

function tickCollapseWith({ detail = 0.5, phase = 0, mid = 0, beatInt = 0 } = {}) {
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
  baseFor(viz, geo);

  const seen = [];
  viz._formulaFn = (theta, phi, t, params) => { seen.push({ t, ...params }); return 0; };
  viz._tickCollapse(TIME);

  assert.ok(seen.length, 'the collapse tick never reached the formula — the harness is broken');
  return seen[0];
}

function tickVolumeWith({ detail = 0.5, phase = 0, mid = 0, accum = 2.5 } = {}) {
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
  const viz = new MathVisualizer(render, { bass: 0, mid, treble: 0, beatInt: 0, amp: 0.7, waveInt: 1 });
  viz._workerReady = false;
  viz.onShapeChange();
  baseFor(viz, geo);
  // Volume reads its own pause-aware accumulator rather than the frame time,
  // and _lastTickTime = null keeps this single call from advancing it — so the
  // clock under test is exactly `accum` plus whatever the knob adds.
  viz._volumeAccumTime = accum;
  viz._lastTickTime = null;

  const seen = [];
  viz._volumeFn = (x, y, z, t, params) => { seen.push({ t, ...params }); return { dx: 0, dy: 0, dz: 0 }; };
  viz._tickVolume(TIME);

  assert.ok(seen.length, 'the volume tick never reached the formula — the harness is broken');
  return seen[0];
}

describe('all three doors into the geometry, not only the one', () => {

  test('COLLAPSE: detail reaches the formula', () => {
    const at = d => tickCollapseWith({ detail: d, mid: 0.5 }).comp;
    const rest = at(0.5);
    assert.equal(rest, 0.5 + 0.5 * 0.4, 'collapse no longer rests on the shipped expression');
    assert.equal(at(0.2), rest - 0.3, 'Formula Detail does nothing in COLLAPSE');
    assert.equal(at(0.8), rest + 0.3, 'Formula Detail does nothing in COLLAPSE');
  });

  test('COLLAPSE: phase reaches the clock, and still adds to the beat nudge', () => {
    const beatInt = 0.9;
    const rest = tickCollapseWith({ beatInt }).t;
    assert.equal(rest, TIME + beatInt * 0.3, 'collapse no longer rests on the shipped clock');
    assert.equal(tickCollapseWith({ phase: 1, beatInt }).t, rest + Math.PI * 2,
      'Formula Phase does nothing in COLLAPSE');
  });

  test('VOLUME: detail reaches the formula', () => {
    const at = d => tickVolumeWith({ detail: d, mid: 0.5 }).comp;
    const rest = at(0.5);
    assert.equal(rest, 0.5 + 0.5 * 0.4, 'volume no longer rests on the shipped expression');
    assert.equal(at(0.2), rest - 0.3, 'Formula Detail does nothing in VOLUME');
    assert.equal(at(0.8), rest + 0.3, 'Formula Detail does nothing in VOLUME');
  });

  test('VOLUME: phase slides its own accumulator without corrupting it', () => {
    // The offset is applied at the call, not folded into _volumeAccumTime —
    // folding it in would make every later frame inherit the offset again and
    // the formula would run away from the track instead of sitting beside it.
    const accum = 2.5;
    assert.equal(tickVolumeWith({ accum }).t, accum, 'volume no longer rests on its own clock');
    assert.equal(tickVolumeWith({ phase: 0.5, accum }).t, accum + Math.PI,
      'Formula Phase does nothing in VOLUME');
  });

  test('every mode is still a no-op at rest, at the same three arguments', () => {
    const mid = 0.37;
    const rest = { comp: 0.5 + mid * 0.4, amp: 0.7, freq: 1 };
    for (const [name, got] of [
      ['surface',  tickWith({ mid })],
      ['collapse', tickCollapseWith({ mid })],
      ['volume',   tickVolumeWith({ mid })],
    ]) {
      assert.equal(got.comp, rest.comp, `${name} changed what a formula sees at rest`);
      assert.equal(got.amp,  rest.amp,  `${name} changed amp`);
      assert.equal(got.freq, rest.freq, `${name} changed freq`);
    }
  });

  test('the expression lives in one place, so a fourth tick cannot miss it', () => {
    // This is the guard the previous two divergences did not have. WAVE
    // INTENSITY was fixed in VOLUME by copying the other modes' line (FIX r11);
    // the copy is how the knobs then went missing there. Counting the
    // expression is crude and that is the point — it fails the moment someone
    // writes it out a second time.
    const src = read('src/math-visualizer.js');
    const copies = (src.match(/mid \* 0\.4/g) || []).length;
    assert.equal(copies, 1,
      `'mid * 0.4' appears ${copies} times — the formula params are being built in more than one place again`);
  });
});

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

  test('the app says on screen when the pair is inert, not only in a comment', () => {
    // The boundary is real and deliberate; the silence was not. What a unit
    // test can hold here is that the parts exist and are wired — the visible
    // behaviour is carried by tests/e2e/smoke.spec.js, because _syncFormulaKnobs
    // is a closure and the question is what an operator sees after a selection.
    const html = read('index.html');
    assert.match(html, /id="formula-knobs-wrap"/, 'the pair has no wrapper to dim');
    assert.match(html, /id="fk-note"/, 'nothing on screen can say why they are inert');
    assert.match(html, /#formula-knobs-wrap\.fk-inert .cg\{opacity/,
      'the dim rule is gone, so the class would toggle nothing');

    const controls = read('src/ui/controls.js');
    assert.match(controls, /const _syncFormulaKnobs = /, 'the sync is gone');
    // applyFormulaValue is the one funnel every selection passes through — the
    // dropdown, R and F, and applyState. Wiring anywhere else would leave a
    // road that dims nothing, which is how this class of bug arrives.
    const funnel = controls.slice(controls.indexOf('ui.applyFormulaValue = '));
    assert.match(funnel.slice(0, 400), /_syncFormulaKnobs\(val\)/,
      'applyFormulaValue no longer syncs the pair, so some roads leave it lying');
  });

  test('both new ids are inside the dom.js contract', async () => {
    const { REQUIRED_IDS } = await import('../src/dom.js');
    for (const id of ['formula-knobs-wrap', 'fk-note']) {
      assert.ok(REQUIRED_IDS.includes(id), `${id} is dereferenced by app code but not in the contract`);
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
