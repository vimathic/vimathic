// tests/auto-cycle.test.js
//
// Contract tests for AUTO COLOUR / AUTO MATERIAL — the ⟳ AUTO toggles beside
// the Color Scheme and Surface Material dropdowns.
//
// Run:
//   node --test tests/auto-cycle.test.js
//
// Two halves, and they are deliberately in one file because they are two halves
// of the same feature:
//   1. AutoCycler (src/ui/auto-cycle.js) — when it changes, to what, and how
//      long the fade should take;
//   2. the ownership handoff in ClipPlayer — while AUTO is on, a clip's preset
//      steps must stop writing the parameter AUTO is cycling. That is the
//      behaviour the feature was asked for: a clip that keeps resetting the
//      palette to each snapshot's colour makes AUTO look broken.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// auto-cycle.js touches no DOM at all — every device-specific thing (is music
// playing, what is on screen, can the change be shown right now) is a callback.
// The schedule is the one exception, and node:test's mock timers drive it, so
// a "16 bars at 120 BPM" assertion costs no wall-clock. clip-player.js needs the
// same three-line document stub its own test uses, installed before the import.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Two reasons for a document here, and they need different amounts of it:
// ClipPlayer's constructor registers a visibilitychange listener, and
// auto-cycle.js reaches ShuffleBag through utils.js → params.js → dom.js, whose
// module body resolves every REQUIRED id at import and aborts boot if one is
// missing. Answering every id with a stub element satisfies it — the same
// approach tests/preset-apply.test.js takes, for the same import.
function makeEl() {
  return {
    value: '', textContent: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
  };
}
globalThis.document = {
  visibilityState: 'visible',
  _els: new Map(),
  getElementById(id) {
    if (!this._els.has(id)) this._els.set(id, makeEl());
    return this._els.get(id);
  },
  addEventListener() {},
  removeEventListener() {},
};

let AutoCycler, ClipPlayer;
before(async () => {
  ({ AutoCycler } = await import('../src/ui/auto-cycle.js'));
  ({ ClipPlayer } = await import('../src/ui/clip-player.js'));
});

// A cycler over a 4-value pool, recording what it applied and with what fade.
// Every injected fact is overridable per test.
function makeCycler(over = {}) {
  const applied = [];
  const state = { playing: false, bpm: 120, current: null, canFire: true };
  const cycler = new AutoCycler({
    pool:      over.pool ?? ['a', 'b', 'c', 'd'],
    apply:     (v, ms) => { state.current = v; applied.push({ v, ms }); },
    current:   () => state.current,
    isPlaying: () => state.playing,
    bpm:       () => state.bpm,
    canFire:   () => state.canFire,
    ...over.opts,
  });
  return { cycler, applied, state };
}

describe('AutoCycler — cadence', () => {
  test('silence is measured in wall time', () => {
    const { cycler, state } = makeCycler({ opts: { idleMs: 12000 } });
    state.playing = false;
    assert.equal(cycler.periodMs(), 12000);
  });

  test('music is measured in bars of the detected tempo', () => {
    const { cycler, state } = makeCycler({ opts: { bars: 8 } });
    state.playing = true;
    state.bpm     = 120;
    // 120 BPM → 500 ms a beat → 2000 ms a 4/4 bar → 8 bars = 16 s.
    assert.equal(cycler.periodMs(), 16000);

    // Tempo is read per tick, not cached: a faster track turns the visual over
    // faster on its own.
    state.bpm = 140;
    assert.equal(cycler.periodMs(), Math.round((60000 / 140) * 4 * 8));
  });

  test('music with no tempo detected yet falls back to wall time', () => {
    const { cycler, state } = makeCycler({ opts: { idleMs: 9000 } });
    state.playing = true;
    for (const bpm of [0, NaN, undefined, -60]) {
      state.bpm = bpm;
      assert.equal(cycler.periodMs(), 9000, `bpm=${bpm} must not set the period`);
    }
  });

  test('the fade is a share of the period, clamped at both ends', () => {
    const { cycler } = makeCycler({
      opts: { fadeRatio: 0.35, minFadeMs: 600, maxFadeMs: 3000 },
    });
    assert.equal(cycler.fadeMs(10000), 3000);  // 3500 asked for → ceiling
    assert.equal(cycler.fadeMs(1000),   600);  //  350 asked for → floor
    assert.equal(cycler.fadeMs(4000),  1400);  // in between, untouched
  });

  test('by default the fade IS the period — the palette never stands still', () => {
    // The shipped defaults changed: 0.35 under a 3 s ceiling meant 3 s of
    // crossfade and 13 s of a still picture at the 8-bar cadence, which reads
    // as a switch rather than as drift. Pinned because it is a look decision,
    // not an implementation detail — anyone restoring a ceiling here is
    // restoring the dwell.
    const { cycler } = makeCycler();
    for (const period of [4000, 16000, 32000, 120000]) {
      assert.equal(cycler.fadeMs(period), period,
        `a ${period} ms period left ${period - cycler.fadeMs(period)} ms of dwell`);
    }
  });

  test('the floor survives, because a fade longer than its period cancels itself', () => {
    // Nothing reaches a sub-600 ms cadence in practice — 8 bars at 3200 BPM —
    // but with no ceiling the floor is the only clamp left, and without it a
    // fast enough cadence would have every change pre-empt the one before it
    // half way through.
    const { cycler } = makeCycler();
    assert.equal(cycler.fadeMs(100), 600);
  });
});

describe('AutoCycler — swapping the pool', () => {
  // NIGHT narrows AUTO COLOUR to its own palettes and widens it again.
  test('draws come only from the new pool', () => {
    const { cycler } = makeCycler({ opts: { pool: [0, 1, 2, 3] } });
    cycler.setPool([44, 45, 46]);
    for (let i = 0; i < 30; i++) {
      const v = cycler.next?.() ?? cycler._bag.next();
      assert.ok([44, 45, 46].includes(v), `dealt ${v}, which is not in the new pool`);
    }
  });

  test('the old deck does not keep dealing after the swap', () => {
    // The reason setPool rebuilds instead of filtering: a ShuffleBag's
    // no-repeat guard is a dealt deck. Filtering the pool would leave the deck
    // holding values that had just left it, and they would keep coming out
    // until it emptied — worst case a full deck of bright palettes inside a
    // mode whose one claim is that it does not choose them.
    const { cycler } = makeCycler({ opts: { pool: [0, 1, 2, 3, 4, 5, 6, 7] } });
    cycler._bag.next(); cycler._bag.next();       // part-way through a deck
    cycler.setPool([44, 45]);
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(cycler._bag.next());
    assert.deepEqual([...seen].sort((a, b) => a - b), [44, 45]);
  });

  test('an empty pool makes AUTO a no-op instead of throwing', () => {
    // Same contract the constructor already keeps: ShuffleBag throws on an
    // empty pool, and that must not escape from a UI event handler.
    const { cycler } = makeCycler({ opts: { pool: [0, 1] } });
    cycler.setPool([]);
    assert.equal(cycler._bag, null);
    assert.doesNotThrow(() => cycler.enable());
    cycler.disable();
  });
});

describe('AutoCycler — what it draws', () => {
  test('switching on changes something immediately', () => {
    // The button has to show it did something; with the fade in place that
    // first change reads as the feature introducing itself, not as a jump.
    const { cycler, applied } = makeCycler();
    cycler.enable();
    assert.equal(applied.length, 1);
    assert.ok(cycler.pool.includes(applied[0].v));
    assert.ok(applied[0].ms > 0, 'a change always gets a fade duration');
    cycler.disable();
  });

  test('never hands back what is already on screen', () => {
    // The bag guards its own seams, but a value set by hand between two draws
    // is invisible to it — switching AUTO on right after picking Mirror would
    // otherwise "change" to Mirror.
    for (let i = 0; i < 50; i++) {
      const { cycler, applied, state } = makeCycler({ pool: ['x', 'y'] });
      state.current = 'x';
      cycler.enable();
      assert.equal(applied[0].v, 'y');
      cycler.disable();
    }
  });

  test('walks the whole pool before repeating a value', t => {
    // The point of drawing from a bag instead of Math.random(): over a short
    // set the operator sees the range, not the same three palettes.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cycler, applied } = makeCycler({ opts: { idleMs: 1000 } });
    cycler.enable();                       // draw 1
    // One tick per period: each fire arms the next timer from inside the
    // callback, and the mock clock hands those out on the following tick.
    for (let i = 0; i < 3; i++) t.mock.timers.tick(1000);   // draws 2-4
    cycler.disable();

    assert.equal(applied.length, 4);
    assert.deepEqual([...applied.map(a => a.v)].sort(), ['a', 'b', 'c', 'd']);
  });

  test('an empty pool makes AUTO a no-op instead of a boot error', () => {
    // A build variant without the material dropdown reaches here with [].
    const { cycler, applied } = makeCycler({ pool: [] });
    cycler.enable();
    assert.equal(cycler.enabled, true);
    assert.deepEqual(applied, []);
    cycler.disable();
  });
});

describe('AutoCycler — the schedule', () => {
  test('keeps firing on the period, and re-reads it every time', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cycler, applied, state } = makeCycler({ opts: { idleMs: 10000, bars: 8 } });

    cycler.enable();                 // fire #1, immediate
    assert.equal(applied.length, 1);

    t.mock.timers.tick(9999);
    assert.equal(applied.length, 1, 'not a millisecond early');
    t.mock.timers.tick(1);
    assert.equal(applied.length, 2, 'fires on the idle period while silent');

    // Music starts mid-countdown. The wait already armed stays as it was — the
    // regime is chosen when a timer is armed, not retroactively — and the fade
    // is chosen at fire time, so this change lands with the musical fade.
    state.playing = true;
    state.bpm     = 120;
    t.mock.timers.tick(10000);
    assert.equal(applied.length, 3, 'the armed idle wait still runs out');
    assert.equal(applied[2].ms, cycler.fadeMs(16000), 'fade scales with the period');

    // From here the cadence is musical: 8 bars @ 120 BPM = 16 s.
    t.mock.timers.tick(15999);
    assert.equal(applied.length, 3, 'no longer on the 10 s clock');
    t.mock.timers.tick(1);
    assert.equal(applied.length, 4);

    cycler.disable();
  });

  test('switching off stops the clock and leaves the value alone', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cycler, applied, state } = makeCycler({ opts: { idleMs: 5000 } });
    cycler.enable();
    const shownAfterEnable = state.current;

    cycler.disable();
    t.mock.timers.tick(60000);
    assert.equal(applied.length, 1, 'no further changes once off');
    assert.equal(state.current, shownAfterEnable, 'whatever was reached stays');
  });

  test('a change that cannot be shown is skipped, not switched off', t => {
    // WIRE/PTS hide the material dropdown and force Matte. AUTO holds its
    // breath there and picks up again on the way back to SURF.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cycler, applied, state } = makeCycler({ opts: { idleMs: 5000 } });
    state.canFire = false;

    cycler.enable();
    assert.deepEqual(applied, [], 'vetoed');
    t.mock.timers.tick(5000);
    assert.deepEqual(applied, [], 'still vetoed, still scheduled');

    state.canFire = true;
    t.mock.timers.tick(5000);
    assert.equal(applied.length, 1, 'resumes on its own');
    cycler.disable();
  });

  test('a hand-picked value gets a full period before the next change', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cycler, applied } = makeCycler({ opts: { idleMs: 10000 } });
    cycler.enable();                 // fire #1

    t.mock.timers.tick(9000);        // 1 s left on the countdown
    cycler.defer();                  // user picked something from the dropdown
    t.mock.timers.tick(1000);
    assert.equal(applied.length, 1, 'the old countdown was dropped');
    t.mock.timers.tick(9000);
    assert.equal(applied.length, 2, 'the new one runs a full period');
    cycler.disable();
  });

  test('defer() on a switched-off cycler does not start one', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cycler, applied } = makeCycler({ opts: { idleMs: 1000 } });
    cycler.defer();
    t.mock.timers.tick(60000);
    assert.deepEqual(applied, []);
  });
});

// ── Ownership: clip steps vs AUTO ────────────────────────────────────────────
// The rule the feature was asked for. ClipPlayer reads the toggles per step, so
// there is no handover call and no state of its own to get out of sync.
describe('ClipPlayer — colour / material ownership', () => {
  let ui, clip;

  function makeUi() {
    const presets = [
      { name: 'A', state: { colorIdx: 3, material: 'metal' } },
      { name: 'B', state: { colorIdx: 7, material: 'glass' } },
    ];
    return {
      applies: [],
      autoColor:    { enabled: false },
      autoMaterial: { enabled: false },
      _loadPresetList: () => presets,
      applyState(state, opts) { this.applies.push({ state, opts }); return true; },
      render: { isMobile: false },
      audio:  { estimatedBpm: 120 },
    };
  }

  beforeEach(() => {
    ui   = makeUi();
    clip = new ClipPlayer(ui);
    clip.buildFromPresets(5000);
  });

  // play() leaves a hold timer and a 100 ms tick interval running.
  const stop = () => clip.stop();

  test('with both toggles off, every step applies the preset look', () => {
    clip.play();
    assert.equal(ui.applies[0].opts.preserveColor, false);
    assert.equal(ui.applies[0].opts.preserveMaterial, false);
    stop();
  });

  test('AUTO COLOUR on: steps stop writing colour — and only colour', () => {
    ui.autoColor.enabled = true;
    clip.play();
    clip.skip();
    assert.deepEqual(ui.applies.map(a => a.opts.preserveColor), [true, true]);
    assert.deepEqual(ui.applies.map(a => a.opts.preserveMaterial), [false, false]);
    stop();
  });

  test('AUTO MATERIAL on: steps stop writing the material', () => {
    ui.autoMaterial.enabled = true;
    clip.play();
    assert.equal(ui.applies[0].opts.preserveMaterial, true);
    assert.equal(ui.applies[0].opts.preserveColor, false);
    stop();
  });

  test('switching AUTO off mid-clip hands the parameter back next step', () => {
    ui.autoColor.enabled = true;
    clip.play();
    ui.autoColor.enabled = false;   // user clicked ⟳ AUTO off
    clip.skip();
    assert.deepEqual(ui.applies.map(a => a.opts.preserveColor), [true, false]);
    stop();
  });

  test('the camera claim is untouched by all of this', () => {
    // Three independent ownerships riding in the same opts object; a step that
    // preserves colour must still apply the preset camera.
    ui.autoColor.enabled = true;
    ui.autoMaterial.enabled = true;
    clip.play();
    assert.equal(ui.applies[0].opts.preserveCamera, false);
    clip.claimCamera();
    clip.skip();
    assert.equal(ui.applies[1].opts.preserveCamera, true);
    assert.equal(ui.applies[1].opts.preserveColor, true);
    stop();
  });

  test('a build without the toggles still plays clips', () => {
    // ui.autoColor / ui.autoMaterial are wired by bindControls; a stripped
    // harness (or an HTML variant without the buttons) has neither.
    delete ui.autoColor;
    delete ui.autoMaterial;
    clip.play();
    assert.equal(ui.applies[0].opts.preserveColor, false);
    assert.equal(ui.applies[0].opts.preserveMaterial, false);
    stop();
  });
});
