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

// ── What a step costs beyond its hold ─────────────────────────────────────────
// _morphMs() is the one place the player charges for the morph a step animates
// through before its hold window opens, and it charged 1600 ms on desktop for a
// morph the engine runs in 800: triggerMorphTransition deflates for at most
// render._tDurShape and inflates for the same again, and _tDurShape is 400
// (300 on mobile) — its own comment calls it "half the morph". The class header
// of clip-player.js states the right figure, "≈800ms after step start", so the
// constant contradicted the file it lives in. Two things ran long: the step
// period (holdMs + this, so a "5 s" step occupied 6.6 s) and the countdown bar,
// which controller.js draws as remain/holdMs — above 100%, i.e. visually frozen
// full, for as long as the overcharge lasts.
describe('ClipPlayer._morphMs — the charge is the morph the engine runs', () => {

  test('desktop: two halves of _tDurShape, not four', () => {
    const ui = makeUi();
    ui.render._tDurShape = 400;          // render.js: "half the morph (deflate or inflate)"
    const clip = new ClipPlayer(ui);
    try {
      assert.equal(clip._morphMs(), 800);
    } finally { clip.stop(); }
  });

  test('mobile is charged its own, shorter morph', () => {
    const ui = makeUi();
    ui.render.isMobile = true;
    ui.render._tDurShape = 300;
    const clip = new ClipPlayer(ui);
    try {
      assert.equal(clip._morphMs(), 600);
    } finally { clip.stop(); }
  });

  test('the schedule and the countdown are charged the same 800 ms', () => {
    const ui = makeUi();
    ui.render._tDurShape = 400;
    const clip = new ClipPlayer(ui);
    const realSetTimeout = globalThis.setTimeout;
    const armed = [];
    globalThis.setTimeout = (fn, ms) => { armed.push(ms); return realSetTimeout(() => {}, 0); };
    const t0 = performance.now();
    try {
      clip.buildFromPresets(5000);
      clip.play();
      assert.deepEqual(armed, [5800],
        'a step advertised as 5.0s must not occupy 6.6s');
      const countdownOpensIn = clip._stepStartMs - t0;
      assert.ok(countdownOpensIn <= 900,
        `the countdown bar reads remain/holdMs, so it sits pinned above 100% for `
        + `this long: ${Math.round(countdownOpensIn)}ms`);
    } finally { globalThis.setTimeout = realSetTimeout; clip.stop(); }
  });

  // Control: the step period is still LONGER than the hold. The header's design
  // is that hold counts from the end of the morph, so a fix that stopped
  // charging for the morph at all — _morphMs() → 0 — would make every step
  // start its countdown while the mesh is still inflating, and would silently
  // change what _catchUp spends per skipped step.
  test('control — the morph is still charged, and mobile still charges less', () => {
    const ui = makeUi();
    ui.render._tDurShape = 400;
    const clip = new ClipPlayer(ui);
    const mobileUi = makeUi();
    mobileUi.render.isMobile = true; mobileUi.render._tDurShape = 300;
    const mobileClip = new ClipPlayer(mobileUi);
    try {
      assert.ok(clip._morphMs() > 0, 'hold counts from the END of the morph');
      assert.ok(mobileClip._morphMs() < clip._morphMs(),
        'the mobile morph is the shorter one, before and after');
    } finally { clip.stop(); mobileClip.stop(); }
  });

  // Control: a build whose engine does not expose the duration still gets a
  // usable number rather than NaN — every arithmetic user of this method (the
  // timeout, _stepStartMs, the catch-up walk) would otherwise go junk.
  test('control — no engine figure to read still yields a usable charge', () => {
    const ui = makeUi();                 // makeUi's render carries no _tDurShape
    const clip = new ClipPlayer(ui);
    try {
      assert.ok(Number.isFinite(clip._morphMs()) && clip._morphMs() > 0);
    } finally { clip.stop(); }
  });
});

// ── Catching up after a hidden tab ────────────────────────────────────────────
// The scheduler's period per step is hold + morph: _runStep pushes _stepStartMs
// past the morph and arms its timeout at holdMs + morphMs. The catch-up walk
// subtracted only the hold, so every step it skipped over lost the morph's worth
// of time — 1.6 s each on desktop. Come back to a backgrounded tab after a
// couple of minutes and the clip resumes several steps behind where the music
// is, and the longer the tab was hidden the further behind it lands.
describe('ClipPlayer._catchUp — a hidden tab lands where the music is', () => {

  test('each skipped step costs its hold AND its morph', () => {
    const ui = makeUi();
    ui._loadPresetList = () => ['A', 'B', 'C', 'D', 'E'].map(name => ({ name, state: {} }));
    const clip = new ClipPlayer(ui);
    try {
      clip.buildFromPresets(5000);
      clip.playing      = true;
      clip._idx         = 0;
      clip._stepHoldMs  = 5000;
      // 20 s behind. A step costs hold + morph = 6.6 s, so the overshoot of
      // 15 s past the first hold covers two whole steps and lands in the third.
      clip._stepStartMs = performance.now() - 20000;

      let landed = null;
      clip._runStep = function () { landed = this._idx; };
      clip._catchUp();

      assert.equal(landed, 3,
        'counting the hold alone makes every skipped step look 1.6 s cheaper than it was');
    } finally { clip.stop(); }
  });

  test('control — still inside the current step, nothing moves', () => {
    const clip = new ClipPlayer(makeUi());
    try {
      clip.buildFromPresets(5000);
      clip.playing      = true;
      clip._idx         = 1;
      clip._stepHoldMs  = 5000;
      clip._stepStartMs = performance.now() - 1000;

      let ran = false;
      clip._runStep = () => { ran = true; };
      clip._catchUp();

      assert.equal(ran, false, 'a catch-up that fires inside the step would restart it');
      assert.equal(clip._idx, 1);
    } finally { clip.stop(); }
  });

  test('control — one step overdue advances by exactly one', () => {
    const clip = new ClipPlayer(makeUi());
    try {
      clip.buildFromPresets(5000);
      clip.playing      = true;
      clip._idx         = 0;
      clip._stepHoldMs  = 5000;
      clip._stepStartMs = performance.now() - 6000;   // 1 s past the hold

      let landed = null;
      clip._runStep = function () { landed = this._idx; };
      clip._catchUp();

      assert.equal(landed, 1);
    } finally { clip.stop(); }
  });
});
