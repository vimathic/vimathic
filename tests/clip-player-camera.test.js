// tests/clip-player-camera.test.js
//
// Contract tests for camera ownership in ClipPlayer (src/ui/clip-player.js):
// who gets to move the camera while a clip of presets is cycling.
//
// Run:
//   node --test tests/clip-player-camera.test.js
//
// ── Why this can run in plain Node ────────────────────────────────────────────
// clip-player.js imports nothing. Its only browser touch-points are
// `document.addEventListener('visibilitychange', …)` in the constructor and
// the timer/`performance.now()` pair driving the schedule — so a three-line
// document stub plus a fake UIController is the whole harness. Every test
// stops the player in a finally block: play() arms a setTimeout and a
// setInterval, and a leaked interval keeps `node --test` alive forever.
//
// ── What is pinned here ───────────────────────────────────────────────────────
// The rule stated in the class header:
//   1. by default the player owns the camera — each step applies its preset's
//      camera block (preserveCamera: false reaches ui.applyState);
//   2. claimCamera() during playback flips every later step to look-only
//      (preserveCamera: true) — this is the regression that let the next
//      preset switch a hand-armed Camera Programmer back off;
//   3. releaseCamera() gives it back;
//   4. play() always starts owning the camera, whatever the previous clip
//      ended on;
//   5. claimCamera() outside playback is a no-op, so it cannot disarm the
//      camera of a clip that hasn't started yet.

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The constructor registers a visibilitychange listener. Stub before import so
// the module's own load order can never matter.
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
};

let ClipPlayer;
before(async () => {
  ({ ClipPlayer } = await import('../src/ui/clip-player.js'));
});

// ── Fake UIController ────────────────────────────────────────────────────────
// Records every applyState call so a test can assert what the step asked for.
// The three other members are what _runStep / _resolveHoldMs read.
function makeUi() {
  const presets = [
    { name: 'A', state: { camera: { autoRot: false } } },
    { name: 'B', state: { camera: { autoRot: false } } },
  ];
  return {
    applies: [],
    _loadPresetList: () => presets,
    applyState(state, opts) { this.applies.push({ state, opts }); return true; },
    render: { isMobile: false },
    audio:  { estimatedBpm: 120 },
  };
}

describe('ClipPlayer — camera ownership', () => {
  let ui, clip, overrideEvents;

  beforeEach(() => {
    ui   = makeUi();
    clip = new ClipPlayer(ui);
    clip.buildFromPresets(5000);
    overrideEvents = [];
    clip.cb.onCamOverride = active => overrideEvents.push(active);
  });

  // play() leaves a hold timer and a 100ms tick interval running.
  afterEach(() => clip.stop());

  test('a fresh player owns the camera', () => {
    assert.equal(clip.camOverride, false);
    clip.play();
    assert.equal(ui.applies.length, 1);
    assert.equal(ui.applies[0].opts.preserveCamera, false);
  });

  test('claimCamera makes every later step look-only', () => {
    clip.play();
    clip.claimCamera();
    assert.equal(clip.camOverride, true);
    assert.deepEqual(overrideEvents, [true]);

    clip.skip();
    clip.skip();
    // The step that ran before the claim kept the camera; both after it are
    // look-only — this is the "next preset kills my Camera Programmer" bug.
    assert.deepEqual(ui.applies.map(a => a.opts.preserveCamera), [false, true, true]);
  });

  test('the camera transition duration still reaches applyState', () => {
    // preserveCamera rides alongside cameraTransitionMs; a claim must not cost
    // the tween its duration for the steps that DO own the camera.
    clip.setCameraTransitionMs(750);
    clip.play();
    assert.equal(ui.applies[0].opts.cameraTransitionMs, 750);
  });

  test('releaseCamera hands it back', () => {
    clip.play();
    clip.claimCamera();
    clip.releaseCamera();
    assert.equal(clip.camOverride, false);
    assert.deepEqual(overrideEvents, [true, false]);

    clip.skip();
    assert.equal(ui.applies.at(-1).opts.preserveCamera, false);
  });

  test('both calls are idempotent — no duplicate callbacks', () => {
    clip.play();
    clip.claimCamera();
    clip.claimCamera();
    clip.releaseCamera();
    clip.releaseCamera();
    assert.deepEqual(overrideEvents, [true, false]);
  });

  test('play() starts owning the camera even after a claimed clip', () => {
    clip.play();
    clip.claimCamera();
    assert.equal(clip.camOverride, true);

    clip.play();
    assert.equal(clip.camOverride, false);
    assert.equal(ui.applies.at(-1).opts.preserveCamera, false);
  });

  test('stop() clears the flag without announcing a handover', () => {
    clip.play();
    clip.claimCamera();
    overrideEvents.length = 0;

    clip.stop();
    assert.equal(clip.camOverride, false);
    assert.deepEqual(overrideEvents, [], 'stop() must not fire onCamOverride');
  });

  test('claimCamera outside playback is a no-op', () => {
    clip.claimCamera();
    assert.equal(clip.camOverride, false);
    assert.deepEqual(overrideEvents, []);

    // …and the clip that starts next still owns its camera.
    clip.play();
    assert.equal(ui.applies[0].opts.preserveCamera, false);
  });

  test('the catch-up path inherits the claim', () => {
    clip.play();
    clip.claimCamera();
    // Simulate a long throttled background period: the current step's hold
    // window opened well over one hold ago, so _catchUp() jumps to a fresh
    // step. That jump must not restore the preset's camera either.
    clip._stepStartMs = performance.now() - 60_000;
    clip._onVisibility();
    assert.equal(ui.applies.at(-1).opts.preserveCamera, true);
  });
});
