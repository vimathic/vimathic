// tests/recorder-gif-timing.test.js
//
// Contract test for GIF export length: the file must play for as long as the
// user asked.
//
// Run:
//   node --test tests/recorder-gif-timing.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// A GIF stores its per-frame delay in centiseconds. The recorder captured at
// 1000/fps ms and handed that unrounded number to gif.js, which writes
// round(delay/10) centiseconds — while the frame COUNT was computed from the
// requested fps. The two disagreed, so the written file was the wrong length:
// at the default 15 fps ("recommended") a 10-second export became a 10.50 s
// file whose motion runs 5% slow, at 24 fps 9.60 s, at 30 fps ("max") 9.00 s
// running 11% fast. In BEATS mode the same drift walked the loop out of the bar
// it was cut to, which is the one place a VJ notices immediately.
//
// The fix quantises the period to a multiple of 10 ms and derives the frame
// budget from that same period. This test is the arithmetic contract; the
// encoder path around it needs a browser, so it is checked through the exported
// helper that start() uses.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// gif.js touches `self` at import time.
globalThis.self   = globalThis;
globalThis.window = globalThis;

let gifFramePlan;
before(async () => { ({ gifFramePlan } = await import('../src/recorder.js')); });

// Exactly the values the OUTPUT panel offers.
const FPS_CHOICES = [10, 15, 20, 24, 30];

describe('gifFramePlan — the file plays for as long as the user asked', () => {
  test('every offered fps yields a period a GIF can express', () => {
    for (const fps of FPS_CHOICES) {
      const { frameDelay } = gifFramePlan(fps, 10_000);
      assert.equal(frameDelay % 10, 0,
        `fps ${fps}: ${frameDelay} ms cannot be written in centiseconds`);
      assert.ok(frameDelay >= 10, `fps ${fps}: period below the format's resolution`);
    }
  });

  test('frames × written delay lands within one frame of the requested length', () => {
    for (const fps of FPS_CHOICES) {
      for (const ms of [3_000, 10_000, 30_000]) {
        const { frameDelay, frames } = gifFramePlan(fps, ms);
        const played = frames * (Math.round(frameDelay / 10) * 10);  // what gif.js writes
        assert.ok(Math.abs(played - ms) <= frameDelay,
          `fps ${fps}, ${ms}ms asked: file plays ${played}ms`);
      }
    }
  });

  test('the default 15 fps no longer overshoots by half a second', () => {
    const { frameDelay, frames } = gifFramePlan(15, 10_000);
    assert.equal(frameDelay, 70);
    assert.equal(frames * frameDelay, 10_010);   // was 150 × 70 = 10_500 written
  });

  test('30 fps no longer loses a whole second', () => {
    const { frameDelay, frames } = gifFramePlan(30, 10_000);
    assert.equal(frameDelay, 40);
    assert.ok(Math.abs(frames * frameDelay - 10_000) <= 40);
  });

  test('capture never runs faster than the user asked for', () => {
    // Rounding the period to the NEAREST 10 ms would push 24 fps to 25 and
    // 30 fps to 33.3 — the latter above LIMITS.maxFps, which clampOptions
    // enforces before start() is even called.
    for (const fps of FPS_CHOICES) {
      const { frameDelay } = gifFramePlan(fps, 10_000);
      assert.ok(1000 / frameDelay <= fps + 1e-9,
        `fps ${fps}: capture runs at ${1000 / frameDelay}`);
      assert.ok(1000 / frameDelay <= 30, 'capture must stay inside LIMITS.maxFps');
    }
  });

  test('never asks for more frames than the pre-quantisation arithmetic did', () => {
    // The memory pre-flight prices a run at this frame count. If quantisation
    // could raise it, combinations that used to record would start being
    // refused with "Estimated …MB of frames (limit 1500MB)".
    for (const fps of FPS_CHOICES) {
      for (const ms of [3_000, 10_000, 30_000, 60_000]) {
        const { frames } = gifFramePlan(fps, ms);
        const before = Math.ceil((ms / 1000) * fps);
        assert.ok(frames <= before,
          `fps ${fps}, ${ms}ms: ${frames} frames vs ${before} before quantisation`);
      }
    }
  });

  test('a beat-synced loop keeps its bar', () => {
    // 8 beats at 128 BPM = 3750 ms.
    const beatMs = 8 * (60_000 / 128);
    for (const fps of FPS_CHOICES) {
      const { frameDelay, frames } = gifFramePlan(fps, beatMs);
      assert.ok(Math.abs(frames * frameDelay - beatMs) <= frameDelay,
        `fps ${fps}: loop plays ${frames * frameDelay}ms instead of ${beatMs}ms`);
    }
  });

  test('a degenerate request still produces one frame, not zero', () => {
    const { frames } = gifFramePlan(30, 1);
    assert.ok(frames >= 1);
  });
});
