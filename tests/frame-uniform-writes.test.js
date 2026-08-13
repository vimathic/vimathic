// tests/frame-uniform-writes.test.js
//
// Contract test for what one animation frame hands the GPU: the eight writes in
// RenderEngine.updateUniforms, which main.js calls once per frame with the live
// AudioEngine and which every one of the 38 GPU shaders reads.
//
// Run:
//   node --test tests/frame-uniform-writes.test.js
//
// ── Why this exists ───────────────────────────────────────────────────────────
// updateUniforms had exactly one caller in the whole suite — the crossfade
// contract test, which drives it to advance the fade and reads uModeBlend and
// uCMBlend back. Nothing anywhere asserted uTime, uBass, uMid, uTreble, uBeat,
// uAmp or uWI after a frame, so all eight writes could be replaced by a constant
// with the suite green.
//
// The loud one is the clock: `uTime = 0` stops every animated shader. That is
// not the dangerous one — nobody ships a still picture. The dangerous ones are
// the two multiplications and the pass-through:
//
//   uBass = audio.bass * audio.bassSens   — this line is the ONLY consumer of
//     what PARAMS.bassSens.set writes, so dropping the multiplier makes the
//     BASS SENSITIVITY slider move a number that never reaches the shader.
//   uTreble = audio.treble * audio.trebleSens — the same for TREBLE SENSITIVITY.
//   uWI = audio.waveInt — the same for WAVE INTENSITY.
//
// A slider that moves a value the picture ignores is exactly the kind of quiet
// death that ships unnoticed, so the fixture below gives every input a distinct
// non-zero value and every expected output a value no other input can produce.
// (The crossfade file's fixture is all zeros and its sensitivities are 1, which
// makes `bass * bassSens` indistinguishable from `bass` even if it did assert.)

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => ({ value: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

let RenderEngine, TransitionManager;
before(async () => {
  ({ RenderEngine, TransitionManager } = await import('../src/render.js'));
});

// Every value distinct, and every product distinct from both its factors:
//   bass   0.3 × 2.0 = 0.6      treble 0.4 × 0.5 = 0.2
// so an assertion on uBass cannot pass on `audio.bass` and one on uTreble
// cannot pass on `audio.treble`.
const AUDIO = {
  bass: 0.3, bassSens: 2.0,
  mid: 0.1,
  treble: 0.4, trebleSens: 0.5,
  beatInt: 0.85,
  amp: 0.9,
  waveInt: 1.7,
};
const TIME = 1234;

let host;
beforeEach(() => {
  host = {
    transitions: new TransitionManager(),
    U: {
      uTime: { value: -1 }, uBass: { value: -1 }, uMid: { value: -1 },
      uTreble: { value: -1 }, uBeat: { value: -1 }, uAmp: { value: -1 },
      uWI: { value: -1 },
      uMathMode: { value: 0 },
      uCM: { value: 16 }, uCMNext: { value: 16 }, uCMBlend: { value: 0 },
      uMode: { value: 4 }, uModeNext: { value: 4 }, uModeBlend: { value: 0 },
    },
    filmGrainVigPass: { enabled: false, uniforms: { uTime: { value: -1 } } },
  };
});

const frame = (time = TIME, audio = AUDIO) =>
  RenderEngine.prototype.updateUniforms.call(host, time, audio);

describe('one frame hands the shaders the values the panel is holding', () => {

  test('the clock the shaders animate off is the frame time', () => {
    frame();
    assert.equal(host.U.uTime.value, TIME);
  });

  test('bass reaches the shader through the sensitivity slider', () => {
    frame();
    assert.equal(host.U.uBass.value, 0.6,
      'BASS SENSITIVITY moves a value that never reaches the shader');
  });

  test('treble reaches the shader through the sensitivity slider', () => {
    frame();
    assert.equal(host.U.uTreble.value, 0.2,
      'TREBLE SENSITIVITY moves a value that never reaches the shader');
  });

  test('mid is passed through with no sensitivity of its own', () => {
    frame();
    assert.equal(host.U.uMid.value, AUDIO.mid);
  });

  test('the beat, the amplitude and the wave intensity arrive unchanged', () => {
    frame();
    assert.equal(host.U.uBeat.value, AUDIO.beatInt);
    assert.equal(host.U.uAmp.value,  AUDIO.amp);
    assert.equal(host.U.uWI.value,   AUDIO.waveInt,
      'the WAVE INTENSITY slider is inert if this write stops following waveInt');
  });

  test('moving a sensitivity slider moves what the shader sees', () => {
    // The end-to-end shape of the slider's contract: same audio, different
    // sensitivity, different uniform — proportionally.
    frame(TIME, { ...AUDIO, bassSens: 1.0 });
    const atOne = host.U.uBass.value;
    frame(TIME, { ...AUDIO, bassSens: 3.0 });
    const atThree = host.U.uBass.value;

    assert.equal(atOne, AUDIO.bass);
    assert.equal(atThree, AUDIO.bass * 3);
    assert.ok(atThree > atOne, 'turning the slider up must brighten the response');
  });

  test('a silent frame writes silence, not the values from the frame before', () => {
    // Control: the writes are unconditional, so a stale frame cannot linger.
    frame();
    assert.equal(host.U.uBass.value, 0.6, 'precondition');
    frame(TIME + 16, { bass: 0, bassSens: 2, mid: 0, treble: 0, trebleSens: 0.5, beatInt: 0, amp: 0, waveInt: 1 });
    assert.equal(host.U.uBass.value, 0);
    assert.equal(host.U.uTreble.value, 0);
    assert.equal(host.U.uBeat.value, 0);
  });
});

describe('the film-grain pass gets the same clock, and only when it is on', () => {

  test('an enabled grain pass advances with the frame', () => {
    host.filmGrainVigPass.enabled = true;
    frame();
    assert.equal(host.filmGrainVigPass.uniforms.uTime.value, TIME,
      'grain frozen in place is a static dirt overlay, not grain');
  });

  test('control — a disabled pass is left alone', () => {
    frame();
    assert.equal(host.filmGrainVigPass.uniforms.uTime.value, -1);
  });
});

describe('the frame records who owned the surface, for the crossfade to read', () => {

  test('with the GPU drawing, the mode on screen counts as seen', () => {
    host.U.uMathMode.value = 0;
    frame();
    assert.equal(host._gpuModeWasShown, true);
  });

  test('with a CPU formula drawing, no GPU mode was on screen', () => {
    // shaders.js applies a GPU mode only under `if (uMathMode == 0)`, so while
    // the CPU formula owns the surface there is nothing to fade from.
    host.U.uMathMode.value = 1;
    frame();
    assert.equal(host._gpuModeWasShown, false);
  });
});

describe('the colour uniforms are left to their own crossfade', () => {

  test('a frame does not touch uCM, uCMNext or uCMBlend', () => {
    // updateUniforms documents this: "uCM is NOT updated here during a color
    // crossfade — setColorSchemeAnimated() manages uCM/uCMNext/uCMBlend
    // directly." A frame that wrote uCM would flatten every palette fade.
    host.U.uCM.value = 16; host.U.uCMNext.value = 7; host.U.uCMBlend.value = 0.42;
    frame();
    assert.equal(host.U.uCM.value, 16);
    assert.equal(host.U.uCMNext.value, 7);
    assert.equal(host.U.uCMBlend.value, 0.42);
  });
});
