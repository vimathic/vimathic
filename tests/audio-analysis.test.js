// tests/audio-analysis.test.js
//
// The analysis half of AudioEngine: band energies, beat detection, the beat
// flash. Nothing in tests/ constructed this class before — grep for
// _detectBeat, _energy or estimatedBpm found no assertion anywhere — which is
// the structural hole the three defects below sat in.
//
// Run:
//   node --test tests/audio-analysis.test.js
//
// ── Defect 1: the bass band was pinned at its ceiling ────────────────────────
// getByteFrequencyData stretches [minDecibels, maxDecibels] onto 0…255, and
// those were left at the Web Audio defaults of -100 and -30. Every bin at or
// above -30 dBFS reads 255, and mixed material's bass bins live well above it,
// so `bass` was 1.000 whatever the track did — and the 1.4 multiplier on top
// guaranteed it.
//
// ── Defect 2: the beat detector had no baseline ──────────────────────────────
// `b > 0.65 && now - last > 190` is an absolute level test. With the band
// pinned high the condition was always true, so the beat rate was the
// refractory period and nothing else: 5.3 a second, estimatedBpm ≈ 300 on any
// track. Everything music-synced inherited that number.
//
// ── Defect 3: the flash faded per frame ──────────────────────────────────────
// `beatInt -= 0.04` once per animation frame: a full fade took 208 ms at
// 120 Hz, 417 ms at 60 Hz and 833 ms on the mobile path — which main.js enters
// on window width alone. Same track, four-fold spread.
//
// ── The analyser stand-in ────────────────────────────────────────────────────
// A real AnalyserNode is not available in Node, and a hand-waved one would pin
// the stand-in rather than the code. This one implements the one operation
// under test the way the specification defines it: byte = 255·(dB − min)/(max −
// min), clamped. The spectra are given in dBFS per band, which is how the
// defect is stated.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio.js';

const BINS = 512, NYQ = 22050, FPB = NYQ / BINS;

/** dB → byte exactly as getByteFrequencyData defines it. */
const toByte = (db, min, max) =>
  Math.max(0, Math.min(255, Math.round(255 * (db - min) / (max - min))));

/**
 * A spectrum given as dBFS in three bands, rendered into the byte array the
 * engine reads. -Infinity is digital silence.
 */
function spectrum(engine, { bass = -Infinity, mid = -Infinity, treble = -Infinity }) {
  const min = engine.analyser.minDecibels, max = engine.analyser.maxDecibels;
  const bytes = new Uint8Array(BINS);
  for (let i = 0; i < BINS; i++) {
    const f = i * FPB;
    const db = f < 140 ? bass : f < 2000 ? mid : treble;
    bytes[i] = db === -Infinity ? 0 : toByte(db, min, max);
  }
  return bytes;
}

let engine, beats, nowMs, realPerf;

beforeEach(() => {
  engine = new AudioEngine();
  beats = 0;
  engine.cb.onBeat = () => { beats++; };
  engine.cb.onEQ = () => {};
  engine._updateSeek = () => {};
  // The window ensureCtx() sets, mirrored here: the constructor cannot build an
  // AudioContext in Node, and these two numbers are what the fix is about.
  engine.analyser = { minDecibels: -85, maxDecibels: -10, getByteFrequencyData(a) { a.set(this._bytes); } };
  engine.fftData = new Uint8Array(BINS);
  engine._fpb = FPB;
  engine.isPlaying = true;

  nowMs = 1_000_000;
  realPerf = globalThis.performance;
  globalThis.performance = { now: () => nowMs };
});

afterEach(() => { globalThis.performance = realPerf; });

/** Feed one frame of the given spectrum, advancing the clock by `ms`. */
function frame(engine, bands, ms = 1000 / 60) {
  engine.analyser._bytes = spectrum(engine, bands);
  nowMs += ms;
  engine.update(nowMs / 1000);
}

describe('the band energies track the level instead of sitting on the ceiling', () => {

  test('bass rises monotonically across the range music occupies', () => {
    const read = db => {
      const e = new AudioEngine();
      e.cb.onEQ = () => {}; e._updateSeek = () => {};
      e.analyser = { minDecibels: -85, maxDecibels: -10, getByteFrequencyData(a) { a.set(this._bytes); } };
      e.fftData = new Uint8Array(BINS); e._fpb = FPB; e.isPlaying = true;
      // Twenty frames so the 0.3/0.7 smoothing settles.
      for (let i = 0; i < 20; i++) { e.analyser._bytes = spectrum(e, { bass: db, mid: db - 10, treble: db - 22 }); e.update(i / 60); }
      return e.bass;
    };
    const levels = [-70, -55, -40, -25, -14];
    const vals = levels.map(read);
    for (let i = 1; i < vals.length; i++) {
      assert.ok(vals[i] > vals[i - 1] + 0.02,
        `bass did not rise from ${levels[i - 1]} dBFS to ${levels[i]} dBFS: ${vals[i - 1].toFixed(3)} → ${vals[i].toFixed(3)}`);
    }
    assert.ok(vals[vals.length - 1] < 1,
      `the loudest reading is ${vals[vals.length - 1]} — the band is still pinned at its ceiling`);
    assert.ok(vals[0] < 0.35, `the quietest reading is ${vals[0]}, which leaves no room below it`);
  });

  test('digital silence reads zero on every band', () => {
    for (let i = 0; i < 20; i++) frame(engine, {});
    assert.ok(engine.bass < 1e-6 && engine.mid < 1e-6 && engine.treble < 1e-6,
      `silence reads ${engine.bass}, ${engine.mid}, ${engine.treble}`);
  });
});

describe('the beat detector follows the music rather than the refractory period', () => {

  // A kick every 500 ms is 120 BPM. Between kicks the bass sits at a normal
  // playing level — which is exactly the case the old absolute threshold could
  // not tell from a beat.
  const playKicks = (engine, { bpm = 120, seconds = 8, kickDb = -12, bedDb = -26 } = {}) => {
    const period = 60000 / bpm, frameMs = 1000 / 60;
    let sinceKick = 0;
    for (let t = 0; t < seconds * 1000; t += frameMs) {
      sinceKick += frameMs;
      const onKick = sinceKick >= period;
      if (onKick) sinceKick -= period;
      frame(engine, { bass: onKick ? kickDb : bedDb, mid: -30, treble: -42 }, frameMs);
    }
  };

  test('a 120 BPM kick pattern is heard as 120 BPM, not as the cooldown', () => {
    // estimatedBpm starts life at 120, so it has to be spoiled first: without
    // this the assertion below passes on a detector that fires nothing at all,
    // which is exactly what the first run of this test did.
    engine.estimatedBpm = -1;
    playKicks(engine);
    assert.ok(beats > 0, 'no beats at all — the BPM assertion below would pass on the default');
    assert.ok(engine.estimatedBpm > 100 && engine.estimatedBpm < 145,
      `estimatedBpm is ${engine.estimatedBpm.toFixed(1)} for a 120 BPM pattern`);
    // 8 seconds at 120 BPM is 16 kicks; the old detector fired 5.3 a second.
    assert.ok(beats >= 10 && beats <= 22, `${beats} beats in 8 s of 120 BPM`);
  });

  test('a loud steady bed with no kicks in it is not a stream of beats', () => {
    for (let t = 0; t < 8000; t += 1000 / 60) frame(engine, { bass: -12, mid: -24, treble: -36 });
    assert.ok(beats <= 2, `${beats} beats detected in 8 s of unvarying bass`);
  });

  test('silence produces no beats at all', () => {
    for (let t = 0; t < 4000; t += 1000 / 60) frame(engine, {});
    assert.equal(beats, 0, `${beats} beats detected in silence`);
  });
});

describe('the beat flash fades in wall-clock time, not in frames', () => {

  test('the same 200 ms of fade at 60 Hz and at 120 Hz', () => {
    const fadeAfter = (hz, ms) => {
      const e = new AudioEngine();
      e.cb.onEQ = () => {}; e._updateSeek = () => {};
      e.analyser = { minDecibels: -85, maxDecibels: -10, getByteFrequencyData(a) { a.set(this._bytes); } };
      e.fftData = new Uint8Array(BINS); e._fpb = FPB; e.isPlaying = false;
      e.beatInt = 1;
      const step = 1000 / hz;
      for (let t = 0; t < ms; t += step) { nowMs += step; e.update(nowMs / 1000); }
      return e.beatInt;
    };
    const at60 = fadeAfter(60, 200), at120 = fadeAfter(120, 200);
    assert.ok(Math.abs(at60 - at120) < 0.05,
      `200 ms of fade leaves ${at60.toFixed(3)} at 60 Hz and ${at120.toFixed(3)} at 120 Hz`);
    // 0.4 s to fall from 1 to 0, so 200 ms is halfway.
    assert.ok(Math.abs(at60 - 0.5) < 0.08, `half a fade should be near 0.5, not ${at60.toFixed(3)}`);
  });
});
