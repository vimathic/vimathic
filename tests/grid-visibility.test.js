// tests/grid-visibility.test.js
//
// Contract tests for the ground grid — who owns its opacity, and what leaving
// transparent-background mode restores.
//
// Run:
//   node --test tests/grid-visibility.test.js
//
// ── The two defects pinned here ───────────────────────────────────────────────
// 1. G faded the grid out and left the material at ~0.1% opacity for good. The
//    fade lived in main.js as a bare rAF loop approaching its target
//    geometrically (0.1 · 0.8^20 ≈ 0.0012), then set visible = false. Every
//    other way of showing the grid — the ⊞ GRID button, applying a preset,
//    leaving transparent background — writes only `visible`. So after one G the
//    grid could be switched "on" and stay invisible while the button lit up and
//    reported ON. Recovery took a G press (which reads visible === true and
//    fades further DOWN) followed by another one.
//    The same loop set `visible` only at the END, so a fade-IN ran entirely on a
//    hidden object: no fade at all, just a pop at full strength 330 ms later.
//
// 2. Leaving transparent background switched the grid ON rather than restoring
//    it. The grid ships hidden (the constructor's last statement, matching
//    #btn-toggle-grid's shipped 0.45 opacity = OFF), so one on→off round trip of
//    TRANSPARENT BG put a grid into the scene the user never enabled — and into
//    everything reading the same canvas: captureStream, the second screen, the
//    WebM recorder. The ⊞ GRID button then read the opposite of reality, and
//    stayed inverted.
//
// Stars are deliberately left alone: nothing else writes stars.visible, so
// restoring them to true is always the right answer. The control case below
// pins that, so a future "symmetry" cleanup does not add state it doesn't need.
//
// ── What "run against the unfixed code first" means in each half ──────────────
// The transparent-background cases are a true before/after: run against the old
// setTransparentBackground, "a grid that was off stays off" fails while both its
// controls pass, so the assertions discriminate rather than pin current
// behaviour.
// The fade cases cannot be, honestly: before the fix there was no fadeGrid() to
// call — the loop lived inside main.js's key switch, unreachable without booting
// the app. They fail against the old tree only because the method is missing.
// The old end state was established by reading instead: the loop ran 20 steps of
// `opacity += (0 - opacity) * 0.2`, i.e. 0.1 · 0.8^20 ≈ 0.0012, and set
// visible = false without ever restoring opacity.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => ({ value: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

let RenderEngine, TransitionManager, GRID_OPACITY, THREE;
before(async () => {
  ({ RenderEngine, TransitionManager, GRID_OPACITY } = await import('../src/render.js'));
  THREE = await import('three');
});

const realNow = performance.now.bind(performance);
let clock = 0;
before(() => { performance.now = () => clock; });
after(()  => { performance.now = realNow; });

let host;

beforeEach(() => {
  clock = 0;
  // Object.create rather than a bare literal, for the reason
  // tests/night-mode.test.js gives: setTransparentBackground now reaches a
  // sibling method (_setStarsNow, which displaces a NIGHT star fade instead of
  // racing it), so `this` has to carry the prototype. A literal made every
  // transparent-background case here die with "not a function".
  host = Object.assign(Object.create(RenderEngine.prototype), {
    transitions: new TransitionManager(),
    grid:  { visible: false, material: { opacity: GRID_OPACITY, transparent: true } },
    // The starfield fades across a NIGHT toggle now, so it carries a material
    // the way the grid does; setTransparentBackground parks its opacity.
    stars: { visible: true, material: { opacity: 0.35, transparent: true } },
    scene: {}, renderer: { setClearColor() {} },
    // What a shown grid rests at. The engine sets this in its constructor and
    // fadeGrid lands on it in both directions; NIGHT is the one thing that
    // moves it (setGridLitOpacity). Stated here rather than defaulted inside
    // fadeGrid on purpose — a `?? GRID_OPACITY` fallback there would let an
    // engine that never initialised the field look correct in every test.
    gridLitOpacity: GRID_OPACITY,
    // Read by setTransparentBackground's restore branch, which now asks the
    // mode instead of writing `true`: the stars have two owners.
    nightly: false,
  });
});

const fadeGrid    = on => RenderEngine.prototype.fadeGrid.call(host, on);
const transparent = on => RenderEngine.prototype.setTransparentBackground.call(host, on);
const advance = ms => { for (let d = 0; d < ms; d += 16) { clock += 16; host.transitions.tick(); } };

describe('the G fade leaves the grid usable by everything else', () => {

  test('after fading out, switching the grid on actually shows something', () => {
    host.grid.visible = true;

    fadeGrid(false);
    advance(600);

    assert.equal(host.grid.visible, false);
    assert.equal(host.grid.material.opacity, GRID_OPACITY,
      'opacity must be back at rest, or the next "show" produces an invisible grid');

    host.grid.visible = true;                     // what #btn-toggle-grid does
    assert.ok(host.grid.material.opacity > 0.05, 'the grid the button turned on is visible');
  });

  test('fading in shows the grid while it fades, not after', () => {
    fadeGrid(true);

    assert.equal(host.grid.visible, true, 'a hidden object cannot fade in');
    advance(200);
    assert.ok(host.grid.material.opacity > 0 && host.grid.material.opacity < GRID_OPACITY,
      'precondition: mid-fade');

    advance(600);
    assert.equal(host.grid.material.opacity, GRID_OPACITY);
    assert.equal(host.grid.visible, true);
  });

  test('control — two fades in a row settle, they do not stack', () => {
    fadeGrid(true);
    advance(600);
    fadeGrid(false);
    advance(600);
    fadeGrid(true);
    advance(600);

    assert.equal(host.grid.visible, true);
    assert.equal(host.grid.material.opacity, GRID_OPACITY);
  });
});

describe('transparent background restores what it hid', () => {

  test('a grid that was off stays off after a round trip', () => {
    host.grid.visible = false;                    // the shipped state

    transparent(true);
    assert.equal(host.grid.visible, false);
    transparent(false);

    assert.equal(host.grid.visible, false,
      'leaving transparent mode must not switch on a grid the user never enabled');
  });

  test('control — a grid that was on comes back on', () => {
    host.grid.visible = true;

    transparent(true);
    assert.equal(host.grid.visible, false, 'hidden while transparent, as documented');
    transparent(false);

    assert.equal(host.grid.visible, true);
  });

  test('control — stars always come back, they have no other owner', () => {
    host.stars.visible = true;

    transparent(true);
    assert.equal(host.stars.visible, false);
    transparent(false);

    assert.equal(host.stars.visible, true);
  });
});

// ── Regression on the fix itself (found by adversarial review of 49c69cd) ─────
// Snapshotting on the way in and restoring on the way out is right for a bare
// round trip, and wrong the moment anything writes grid.visible in between —
// ⊞ GRID, the G fade and a preset all do. Restoring then switched OFF a grid the
// operator had just switched on, with the button left lit: the same class of
// lie the original fix set out to remove, pointing the other way. A second
// enable made it worse by re-snapshotting the value we had forced ourselves.
describe('leaving transparent background gives the grid back, but does not take it away', () => {

  test('a grid switched on inside transparent mode stays on', () => {
    host.grid.visible = false;                       // shipped state
    transparent(true);
    assert.equal(host.grid.visible, false, 'precondition: transparent mode hides it');

    host.grid.visible = true;                        // ⊞ GRID, pressed in there
    transparent(false);

    assert.equal(host.grid.visible, true,
      'the operator turned it on and the button says ON — leaving must not undo that');
  });

  test('a second enable does not overwrite the snapshot with its own doing', () => {
    host.grid.visible = true;                        // the operator had it on
    transparent(true);
    transparent(true);                               // e.g. the panel button and the modal
    transparent(false);

    assert.equal(host.grid.visible, true, 'the state that came in is the state that comes back');
  });

  test('control — the plain round trip still restores what it found', () => {
    host.grid.visible = false;
    transparent(true);
    transparent(false);
    assert.equal(host.grid.visible, false, 'the grid ships hidden and must come back hidden');

    host.grid.visible = true;
    transparent(true);
    transparent(false);
    assert.equal(host.grid.visible, true);
  });

  test('control — stars come back either way', () => {
    transparent(true);
    assert.equal(host.stars.visible, false);
    transparent(false);
    assert.equal(host.stars.visible, true, 'nothing else writes stars.visible');
  });
});

// ── The same question asked of the fade ───────────────────────────────────────
// setTransparentBackground's restore asks "did anything claim the grid while I
// was away" before writing `visible`. The fade is the ONE writer that lands up
// to 400 ms after the fact, and it wrote `visible = on` unconditionally — so a
// ⊞ GRID click or a TRANSPARENT BG enable inside the fade window was undone by
// a tween the operator had already changed their mind about, leaving the grid
// on screen with its button reading OFF, or a grid in an alpha capture that was
// deliberately cleared of one.
//
// ⊞ GRID lives in main.js (`render.grid.visible = !render.grid.visible` plus the
// button's opacity), which cannot be imported without booting the app; the bare
// write below is that handler's whole effect on the engine.
describe('the G fade does not overrule what happened while it ran', () => {

  test('⊞ GRID pressed inside the fade window has the last word', () => {
    host.grid.visible = false;

    fadeGrid(true);                      // G: raises visible up front, fades in
    advance(100);
    host.grid.visible = false;           // ⊞ GRID, 100 ms later: OFF
    advance(600);

    assert.equal(host.grid.visible, false,
      'the button says OFF; a tween landing 300 ms later must not put the grid back on');
  });

  test('a grid forced off for transparent output is not handed back by the fade', () => {
    host.grid.visible = false;

    fadeGrid(true);
    advance(100);
    transparent(true);                   // forces visible = false for a clean alpha frame
    advance(600);

    assert.equal(host.grid.visible, false,
      'the fade would otherwise push the grid into captureStream, the second screen ' +
      'and the recorder, which is exactly what transparent mode took it out of');
    assert.equal(host.transparentBg, true, 'precondition: still in transparent mode');
  });

  test('control — a fade nobody interrupts still writes what it was asked for', () => {
    host.grid.visible = true;

    fadeGrid(false);
    advance(600);
    assert.equal(host.grid.visible, false, 'G off still switches the grid off');
    assert.equal(host.grid.material.opacity, GRID_OPACITY, 'and still parks the opacity');

    fadeGrid(true);
    advance(600);
    assert.equal(host.grid.visible, true, 'and G on still switches it on');
  });

  test('control — the opacity still comes back even when the write is dropped', () => {
    host.grid.visible = true;

    fadeGrid(false);
    advance(100);
    host.grid.visible = false;           // ⊞ GRID got there first
    advance(600);

    assert.equal(host.grid.material.opacity, GRID_OPACITY,
      'a grid left at 0 opacity comes back invisible for the next path that shows it');
  });
});
