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
//
// The last group is about where the pair sits: one slot in the panel that it
// shares with the four Shader Knobs, by engine. Under a numbered GPU shader the
// pair moves nothing, so the knobs take its place (see "The slot swaps banks").

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Source with its comment lines removed, so an assertion reads the code and not
// the prose about it. src/ui/presets.js is read with fs on purpose: it carries
// a NUL byte that makes ripgrep treat it as binary, and fs does not care.
const code = rel => read(rel).split('\n')
  .filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
  .join('\n');

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

  // ── The slot swaps banks; it does not dim one ─────────────────────────────
  // REVERSED (shader knobs): the test that stood here held the r6 arrangement —
  // the pair dimmed under a numbered GPU shader by a .fk-inert rule, with a
  // NO EFFECT line (#fk-note) under it. The boundary it described is still
  // real (nothing reads Detail / Phase under a numbered shader); what changed
  // is the answer to it. The slot now shows the pair on a CPU formula and the
  // four Shader Knobs on a numbered shader — the knobs that DO act there, and
  // that used to sit three clicks deep in ADVANCED → SHADER EDITOR.
  //
  // What a source read can hold is that the parts exist and every road is
  // wired. The behaviour is driven for real in tests/controls-wiring.test.js
  // (the closure, through bindControls) and tests/e2e/smoke.spec.js (what an
  // operator sees).
  test('the slot has both banks, and the second ships hidden', () => {
    const html = read('index.html');
    assert.match(html, /id="formula-knobs-wrap"/, 'the pair has no wrapper to swap');
    const wrap = html.match(/<div id="shader-knobs-wrap"[^>]*>/);
    assert.ok(wrap, 'the Shader Knobs have no wrapper in the slot');
    // Hidden in the markup: the boot selection is a CPU formula, and a wrapper
    // that shipped visible would show both banks until the module ran.
    assert.match(wrap[0], /style="display:none"/,
      '#shader-knobs-wrap ships visible, so both banks flash on before controls.js runs');
    assert.ok(html.indexOf('id="shader-knobs-wrap"') > html.indexOf('id="formula-knobs-wrap"'),
      'the knobs come before the pair — the slot reads upside down');
  });

  test('control — the pair ships visible, because the boot selection is a formula', () => {
    // Without this, a slot that shipped with BOTH banks hidden would pass the
    // test above.
    const html = read('index.html');
    const wrap = html.match(/<div id="formula-knobs-wrap"[^>]*>/);
    assert.ok(wrap);
    assert.doesNotMatch(wrap[0], /display:\s*none/, 'the pair ships hidden on a CPU formula');
  });

  test('the dropdown, R and F swap it on their way through applyFormulaValue', () => {
    const controls = read('src/ui/controls.js');
    assert.match(controls, /const _syncFormulaKnobs = /, 'the sync is gone');
    // applyFormulaValue is the funnel the dropdown and R / F share. (It is not
    // applyState's: the comment over this call claimed it was until the swap,
    // and the slot went stale on every preset — see the next test.)
    const funnel = controls.slice(controls.indexOf('ui.applyFormulaValue = '));
    assert.match(funnel.slice(0, 400), /_syncFormulaKnobs\(val\)/,
      'applyFormulaValue no longer syncs the slot, so the dropdown leaves it lying');
  });

  test('applyState swaps it right after it writes #gpu-sel', () => {
    // A preset click, an import, a clip step and the boot restore all write
    // #gpu-sel here, directly. Passing s.gpuSelVal (not the select read back)
    // is the contract: a value this build does not ship blanks the select.
    //
    // FIX(review R1/R3): the value is normalised into `sel` first (a number
    // from a hand-edited file is that number as a string), and between the
    // write and the sync sits one check: an `m:` value the select refused
    // puts the previous value back and skips the sync. This used to pin the
    // two statements as adjacent; it pins the order, the value handed over,
    // and that nothing between them touches the engine.
    const presets = code('src/ui/presets.js');
    const write = 'DOM.gpuSel.value = sel;';
    const at = presets.indexOf(write);
    assert.ok(at > 0, 'applyState no longer writes #gpu-sel the way this test reads it');
    const sync = presets.indexOf('this.syncFormulaKnobsUI?.(sel);', at);
    assert.ok(sync > at, 'the slot is not synced after the #gpu-sel write, with the snapshot\'s value');
    const between = presets.slice(at + write.length, sync);
    assert.match(between, /DOM\.gpuSel\.value\s*!==\s*sel/, 'the check that the select took the value is gone');
    assert.doesNotMatch(between, /setGPUModeAnimated|deactivate\(|setFormula|setVolumeFormula|syncFormulaKnobsUI/,
      'something between the write and the sync drives the engine or the slot');
    assert.doesNotMatch(presets, /syncFormulaKnobsUI\?\.\(\s*DOM\.gpuSel\.value\s*\)/,
      'the slot is handed the select read back, which a value this build does not ship has blanked');
    const controls = code('src/ui/controls.js');
    assert.match(controls, /ui\.syncFormulaKnobsUI = _syncFormulaKnobs;/,
      'the adapter applyState calls is not the sync itself');
  });

  test('RESET ALL swaps it after both of its writes that decide it', () => {
    // #gpu-sel back to the boot formula, and the custom shader cleared — the
    // knobs show over a formula while a custom shader is applied, so a sync
    // between the two would be undone by the second.
    const controls = code('src/ui/controls.js');
    const from = controls.indexOf("DOM.btnResetAll.addEventListener('click'");
    assert.ok(from > 0, 'the RESET ALL handler moved');
    const handler = controls.slice(from, controls.indexOf("ui._showToast('⟳ Reset to defaults')", from));
    const gpu   = handler.indexOf('DOM.gpuSel.value = bootSel;');
    const reset = handler.indexOf('se.reset?.()');
    const sync  = handler.lastIndexOf('_syncFormulaKnobs(bootSel);');
    assert.ok(gpu > 0 && reset > 0, 'RESET ALL no longer writes #gpu-sel or resets the shader the way this test reads it');
    assert.ok(sync > gpu && sync > reset,
      'RESET ALL does not sync the slot after both its #gpu-sel write and its shader reset');
  });

  test('both wrapper ids are inside the dom.js contract', async () => {
    const { REQUIRED_IDS } = await import('../src/dom.js');
    for (const id of ['formula-knobs-wrap', 'shader-knobs-wrap']) {
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
