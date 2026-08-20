// tests/autosave-debounce.test.js
//
// bootPersist's auto-save loop: the debounce that writes the snapshot, and the
// periodic tick that notices changes the panel's own listeners cannot see.
// Neither had a test.
//
// Run:
//   node --test tests/autosave-debounce.test.js
//
// ── Defect 1: the debounce starved itself ───────────────────────────────────
// One timer, re-armed by every caller, 1500 ms — and one of the callers is a
// setInterval running every 1000 ms. 1000 < 1500, so any state that keeps
// changing faster than once a second re-armed the timer before it could fire
// and NOTHING was ever written. A running camera script moves the camera every
// frame, which moves the fingerprint every tick, which re-arms the debounce
// every tick: the only snapshot that survived was whatever beforeunload
// managed to catch.
//
// ── Defect 2: the fingerprint saw six values out of thirteen ────────────────
// It was colour, formula and camera position. captureState() writes thirteen
// top-level keys. So D, T and G (deform, viz mode, grid), a hold-and-drag on a
// slider, a MIDI CC on anything but colour, a shape change from R — none of
// them moved it, and none scheduled a save.
//
// ── The stand-ins ───────────────────────────────────────────────────────────
// Timers are hand-driven rather than real: the defect is about the ORDER of a
// 1000 ms tick against a 1500 ms debounce, and a test that waited on wall-clock
// timers would be both slow and flaky. `now` is advanced explicitly and the due
// callbacks run, which is the same thing a scheduler does and nothing more.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// dom.js resolves every REQUIRED id at import, so a stub document goes in first.
const el = () => ({
  value: '', style: {}, textContent: '', options: [],
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, removeEventListener() {}, appendChild() {}, querySelectorAll: () => [],
});
globalThis.document = {
  getElementById: () => el(),
  querySelector: () => el(),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: el(), documentElement: el(),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { PresetMixin } = await import('../src/ui/presets.js');

// ── Hand-driven clock ───────────────────────────────────────────────────────
let now, timeouts, intervals, realSetTimeout, realSetInterval, realClearTimeout, realDateNow;

function installClock() {
  now = 1_000_000;
  timeouts = [];
  intervals = [];
  realSetTimeout = globalThis.setTimeout;
  realSetInterval = globalThis.setInterval;
  realClearTimeout = globalThis.clearTimeout;
  realDateNow = Date.now;
  globalThis.setTimeout = (fn, ms) => { const h = { fn, at: now + ms, dead: false }; timeouts.push(h); return h; };
  globalThis.clearTimeout = h => { if (h) h.dead = true; };
  globalThis.setInterval = (fn, ms) => { const h = { fn, every: ms, next: now + ms }; intervals.push(h); return h; };
  Date.now = () => now;
}
function restoreClock() {
  globalThis.setTimeout = realSetTimeout;
  globalThis.setInterval = realSetInterval;
  globalThis.clearTimeout = realClearTimeout;
  Date.now = realDateNow;
}
/** Advance the clock in `stepMs` slices, firing whatever comes due. */
function advance(totalMs, stepMs = 100) {
  for (let done = 0; done < totalMs; done += stepMs) {
    now += stepMs;
    for (const h of intervals) while (h.next <= now) { h.next += h.every; h.fn(); }
    for (const h of timeouts) if (!h.dead && h.at <= now) { h.dead = true; h.fn(); }
  }
}

/** A UI with just enough surface for bootPersist, and a moving camera. */
function makeUi() {
  const writes = [];
  const camera = { position: { x: 0, y: 0, z: 0 }, fov: 45 };
  const ui = Object.assign(Object.create(PresetMixin), {
    _persistKey: 'vimathic_persisted_state',
    _persistNow() { writes.push(now); },
    _clearPersisted() {},
    audio: { colorIdx: 16, bassSens: 1.2, trebleSens: 1, amp: 0.7, waveInt: 1 },
    render: { camera, orbit: { target: { x: 0, y: 0, z: 0 } }, grid: { visible: true },
              currentShape: 'plane', vizMode: 'surface', currentMaterial: 'matte',
              currentParticleStyle: 'squares', bloom: 0.5 },
    camera: { cpParams: { rotSpeed: 0.00002 } },
    mathViz: { _collId: 'trigonometry', _formulaKey: 'travelingWave', _mode: 'surface', _volumeKey: null },
    writes,
  });
  return ui;
}

beforeEach(installClock);
afterEach(restoreClock);

describe('the auto-save debounce cannot be starved', () => {

  test('a camera that moves every tick still gets written', () => {
    const ui = makeUi();
    ui.bootPersist();
    // A running camera script: the position changes continuously, so the 1 s
    // fingerprint tick schedules a save on every one of its runs.
    intervals.push({ fn: () => { ui.render.camera.position.x += 0.5; }, every: 100, next: now + 100 });

    advance(12_000);

    assert.ok(ui.writes.length >= 2,
      `${ui.writes.length} writes in 12 s of continuous movement — the debounce was re-armed faster than it could fire`);
    const gaps = ui.writes.slice(1).map((t, i) => t - ui.writes[i]);
    for (const g of gaps) assert.ok(g <= 6000, `a gap of ${g} ms between writes`);
  });

  test('control — a single change is still debounced rather than written at once', () => {
    const ui = makeUi();
    ui.bootPersist();
    ui.render.camera.position.x = 3;      // one change, then stillness
    advance(1000, 100);
    const early = ui.writes.length;
    advance(2000, 100);
    assert.equal(early, 0, 'the write landed before the debounce elapsed');
    assert.ok(ui.writes.length >= 1, 'and it never landed at all');
  });
});

describe('the periodic tick sees what the snapshot stores', () => {

  const scheduled = (mutate) => {
    const ui = makeUi();
    ui.bootPersist();
    // The first tick always schedules — the fingerprint starts empty — so the
    // baseline is taken after that write has actually landed. At 1500 ms it had
    // not, and the control below counted it as a spurious save.
    advance(5000, 100);
    const before = ui.writes.length;
    mutate(ui);
    advance(4000, 100);
    return ui.writes.length - before;
  };

  for (const [what, mutate] of [
    ['the deform mode (D)',        ui => { ui.mathViz._mode = 'collapse'; }],
    ['the viz mode (T)',           ui => { ui.render.vizMode = 'wireframe'; }],
    ['the grid (G)',               ui => { ui.render.grid.visible = false; }],
    ['the shape (R)',              ui => { ui.render.currentShape = 'torus'; }],
    ['a slider held and dragged',  ui => { ui.audio.amp = 1.4; }],
    ['the material',               ui => { ui.render.currentMaterial = 'glass'; }],
  ]) {
    test(`${what} schedules a save`, () => {
      assert.ok(scheduled(mutate) > 0, `${what} moved nothing the fingerprint watches`);
    });
  }

  test('control — with nothing changing, nothing is written', () => {
    assert.equal(scheduled(() => {}), 0, 'the tick writes on its own, so the six above prove nothing');
  });
});
