// tests/audio-playhead.test.js
//
// Contract test for AudioEngine.getElapsedFraction() — the playhead the Camera
// Programmer reads when the user clicks "＋ Add keyframe at playhead".
//
// Run:
//   node --test tests/audio-playhead.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// getElapsedFraction() guarded on audioBuffer/audioCtx but not on isPlaying,
// while its twin _updateSeek() guards on all three. audioCtx.currentTime keeps
// advancing after stopAudio() — it is the context clock, not the track clock —
// so with playback stopped the transport showed "▶ PLAY" and 0:00 while the
// camera-editor playhead kept sliding right on its own and eventually pinned at
// 100%. Every keyframe added from a stopped track therefore landed at a time
// that depended on how long the user had spent writing the script.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// Nothing here touches the Web Audio graph: the engine's own fields are set to
// the state loadPlay() leaves behind (a decoded buffer, a context whose clock
// runs, a track start stamp), and the test then drives the real stopAudio() and
// reads the real getElapsedFraction(). audio.js is imported before any document
// stub so dom.js takes its node branch.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let AudioEngine;
before(async () => { ({ AudioEngine } = await import('../src/audio.js')); });

// A context clock that only ever moves forward, like the real one.
function makeClock() {
  const clock = { now: 0 };
  return {
    clock,
    ctx: {
      get currentTime() { return clock.now; },
      state: 'running',
      close() {},
      resume() {},
    },
  };
}

describe('AudioEngine.getElapsedFraction', () => {
  let eng, clock, seeks;

  beforeEach(() => {
    const c = makeClock();
    clock = c.clock;
    seeks = [];
    eng = new AudioEngine({ onSeek: (pct, cur) => seeks.push([pct, cur]) });
    // The state loadPlay() leaves behind for a 200 s track started at t=0.
    eng.audioCtx    = c.ctx;
    eng.audioBuffer = { duration: 200 };
    eng.trackStart  = 0;
    eng.trackOfs    = 0;
    eng.isPlaying   = true;
  });

  test('tracks the context clock while playing', () => {
    clock.now = 66.7;
    assert.ok(Math.abs(eng.getElapsedFraction() - 0.3335) < 1e-3,
      `expected ~0.3335, got ${eng.getElapsedFraction()}`);
  });

  test('does not crawl on after stopAudio()', () => {
    clock.now = 66.7;
    eng.stopAudio();
    const atStop = eng.getElapsedFraction();
    clock.now += 120;                      // two minutes writing a camera script
    assert.equal(eng.getElapsedFraction(), atStop,
      'the playhead moved while playback was stopped');
    assert.equal(eng.getElapsedFraction(), 0,
      'a stopped transport reports 0:00 — the playhead must agree with it');
  });

  test('a keyframe stamped from a stopped track does not depend on wall clock', () => {
    clock.now = 66.7;
    eng.stopAudio();
    clock.now += 5;   const early = eng.getElapsedFraction();
    clock.now += 300; const late  = eng.getElapsedFraction();
    assert.equal(early, late);
  });

  test('the seek callback still fires exactly once on stop, and never after', () => {
    // Guards the other half: the fix must not make _updateSeek chatty.
    clock.now = 10;
    eng.stopAudio();
    const afterStop = seeks.length;
    clock.now += 60;
    eng._updateSeek();
    assert.equal(seeks.length, afterStop);
  });

  test('an unloaded engine reports 0, not NaN', () => {
    const fresh = new AudioEngine();
    assert.equal(fresh.getElapsedFraction(), 0);
  });
});
