// tests/clip-hold.test.js
//
// Contract test for how long a clip step is held on screen.
//
// Run:
//   node --test tests/clip-hold.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// The bars branch of _startClip passed buildFromPresets(0) — "holdMs unused in
// bars mode" — and _setMode does not rebuild the steps. Click ♩ BARS, ▶ PLAY,
// then ⏱ SEC while it is still playing and every step's hold was 0 ms: the clip
// strobed through presets at morph speed (~1.6 s, 0.8 s on mobile) while the
// Hold(s) box still read 5, the status line said "— 0.0s" and the countdown bar
// stayed empty. Nothing on the panel explained it.
//
// Fixed on both sides. The controller now passes a real hold in both branches;
// that branch is DOM-only, so it is pinned by "flipping ♩ BARS → ⏱ SEC mid-clip
// keeps the Hold(s) value" in tests/e2e/clip-camera.spec.js. This file pins the
// other side: _resolveHoldMs tests holdMs for positivity rather than for
// null-ness, so no step — hand-built, legacy or sentinel — can ever schedule a
// hold shorter than the morph it contains.

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {}, removeEventListener() {},
};

let ClipPlayer;
before(async () => { ({ ClipPlayer } = await import('../src/ui/clip-player.js')); });

function makeUi() {
  const presets = [{ name: 'A', state: {} }, { name: 'B', state: {} }];
  return {
    applies: [],
    _loadPresetList: () => presets,
    applyState(state, opts) { this.applies.push({ state, opts }); return true; },
    render: { isMobile: false },
    audio:  { estimatedBpm: 128 },
  };
}

describe('ClipPlayer._resolveHoldMs', () => {
  let clip;

  beforeEach(() => { clip = new ClipPlayer(makeUi()); });
  afterEach(() => clip.stop());

  test('a sentinel 0 hold never reaches the schedule', () => {
    clip.buildFromPresets(0);
    clip.barsMode = false;
    assert.ok(clip._resolveHoldMs(clip._steps[0]) >= 500,
      'a 0 ms hold makes the clip strobe at morph speed');
  });

  test('bars mode still computes from the bar clock, untouched', () => {
    clip.barsMode  = true;
    clip.barsCount = 8;
    clip.buildFromPresets(5000);
    // 8 bars at 128 BPM = 8 × (60000/128)×4 = 15000 ms
    assert.equal(clip._resolveHoldMs(clip._steps[0]), 15000);
  });

  test('flipping ♩ BARS → ⏱ SEC mid-clip lands on the Hold(s) value, not 0', () => {
    clip.barsMode  = true;
    clip.barsCount = 8;
    clip.buildFromPresets(5000);      // what _startClip now passes in BOTH modes
    assert.equal(clip._resolveHoldMs(clip._steps[0]), 15000);
    clip.barsMode = false;            // the user clicks ⏱ SEC while playing
    assert.equal(clip._resolveHoldMs(clip._steps[0]), 5000);
  });

  test('a per-row Hold(s) override still wins', () => {
    clip.buildFromPresets(5000);
    clip.setStepHold(0, 1200);
    assert.equal(clip._resolveHoldMs(clip._steps[0]), 1200);
    assert.equal(clip._resolveHoldMs(clip._steps[1]), 5000);
  });

  test('a hand-built step with no hold at all falls back, not to zero', () => {
    clip.setSteps([{ name: 'X' }]);
    clip.barsMode = false;
    assert.equal(clip._resolveHoldMs(clip._steps[0]), 5000);
  });
});
