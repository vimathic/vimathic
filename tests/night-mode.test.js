// tests/night-mode.test.js
//
// NIGHT — what the mode is allowed to touch, and what it must leave alone.
//
// Run:
//   node --test tests/night-mode.test.js
//
// ── The claim ────────────────────────────────────────────────────────────────
// NIGHT is a dark-room mode that writes no shader uniform, no bloom setting and
// no palette number. Everything it does is furniture: the starfield off, the
// grid dimmed, and — in controls.js, not here — the unattended palette pickers
// narrowed. That restraint is the whole reason there is nothing to prove about
// the frame being unchanged when the mode is off, so it is worth pinning: a
// later "while we're in here" edit that reaches into bloom or the specular
// should turn this file red.
//
// ── Why the starfield needs a test at all ────────────────────────────────────
// It now has two owners. setTransparentBackground hides it for its own reason
// (alpha output) and used to restore it by writing `true` unconditionally,
// under a comment saying "nothing else writes stars.visible, so true is always
// the right answer for them". That sentence stopped being true the moment NIGHT
// existed, and the failure it describes is silent: leave transparent background
// while NIGHT is on and 1200 white points come back into a mode whose entire
// point is that they are gone. The same class of defect the grid half of
// tests/grid-visibility.test.js was written for, one field over.
//
// The numbers behind the two choices — starfield composites to bloom-luma 0.366
// and so clears the 0.15 bloom gate at all times, a grid line at 0.1 opacity
// reads about 1.5× the body of the darkest NIGHT palette at rest — are recorded
// in notes/26-dark-palettes-v2. They are why these two and not, say, the
// vignette.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => ({ value: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

let RenderEngine, TransitionManager, GRID_OPACITY, NIGHT_GRID_OPACITY;
before(async () => {
  ({ RenderEngine, TransitionManager, GRID_OPACITY, NIGHT_GRID_OPACITY } =
    await import('../src/render.js'));
});

const realNow = performance.now.bind(performance);
let clock = 0;
before(() => { performance.now = () => clock; });

let host;
beforeEach(() => {
  clock = 0;
  // Object.create rather than a bare literal: setNightly calls a sibling method
  // (setGridLitOpacity), so `this` has to carry the prototype. The fields below
  // are the whole of what these three methods read — if that list grows, this
  // stub should fail loudly rather than quietly model a different engine.
  host = Object.assign(Object.create(RenderEngine.prototype), {
    transitions: new TransitionManager(),
    grid:  { visible: true, material: { opacity: GRID_OPACITY, transparent: true } },
    stars: { visible: true },
    scene: {}, renderer: { setClearColor() {} },
    gridLitOpacity: GRID_OPACITY,
    nightly: false,
    transparentBg: false,
  });
});

const setNightly  = on => RenderEngine.prototype.setNightly.call(host, on);
const fadeGrid    = on => RenderEngine.prototype.fadeGrid.call(host, on);
const transparent = on => RenderEngine.prototype.setTransparentBackground.call(host, on);
const advance = ms => { for (let d = 0; d < ms; d += 16) { clock += 16; host.transitions.tick(); } };

describe('NIGHT moves the furniture', () => {
  test('the starfield goes, and comes back on the way out', () => {
    setNightly(true);
    assert.equal(host.stars.visible, false, 'the brightest thing in the frame is still there');
    setNightly(false);
    assert.equal(host.stars.visible, true);
  });

  test('a shown grid is dimmed, not hidden — it is how the surface is read', () => {
    setNightly(true);
    advance(600);
    assert.equal(host.grid.visible, true, 'NIGHT must not hide the grid; G decides that');
    assert.equal(host.grid.material.opacity, NIGHT_GRID_OPACITY);
    assert.ok(NIGHT_GRID_OPACITY > 0, 'a grid dimmed to nothing is a hidden grid with extra steps');
    assert.ok(NIGHT_GRID_OPACITY < GRID_OPACITY,
      'the two rest values are equal, so every grid assertion in this file passes vacuously');
  });

  test('leaving NIGHT puts the grid back at full strength', () => {
    setNightly(true);  advance(600);
    setNightly(false); advance(600);
    assert.equal(host.grid.material.opacity, GRID_OPACITY);
  });

  test('a hidden grid is parked at the new rest value, not tweened', () => {
    // fadeGrid's own rule: a hidden grid rests at full opacity so that every
    // path which writes only `visible` brings back something visible. "Full"
    // has to follow the mode, or leaving a grid off across a NIGHT toggle
    // brings it back at the wrong strength.
    host.grid.visible = false;
    setNightly(true);
    assert.equal(host.grid.material.opacity, NIGHT_GRID_OPACITY,
      'parked immediately — there is nothing on screen to fade');
  });

  test('G still lands on whatever NIGHT decided rest means', () => {
    setNightly(true); advance(600);
    fadeGrid(false);  advance(600);
    assert.equal(host.grid.visible, false);
    assert.equal(host.grid.material.opacity, NIGHT_GRID_OPACITY,
      'the fade parked at the shipped default and would come back too bright');
    fadeGrid(true);   advance(600);
    assert.equal(host.grid.material.opacity, NIGHT_GRID_OPACITY);
  });
});

describe('NIGHT and transparent background share the starfield', () => {
  test('leaving transparent background does not undo NIGHT', () => {
    setNightly(true);
    transparent(true);
    assert.equal(host.stars.visible, false);
    transparent(false);
    assert.equal(host.stars.visible, false,
      'the starfield came back into NIGHT — the restore wrote true instead of asking the mode');
  });

  test('control — without NIGHT the round trip still restores them', () => {
    transparent(true);
    assert.equal(host.stars.visible, false);
    transparent(false);
    assert.equal(host.stars.visible, true);
  });

  test('reinjected — the old unconditional restore undoes NIGHT', () => {
    // The assertion above has to discriminate, not just pass. This is the
    // restore branch as it was before NIGHT existed, verbatim in effect:
    // `this.stars.visible = true`, under a comment explaining that nothing else
    // writes the field. Run the same scenario through it and the starfield
    // comes back — which is the failure the test above is there to catch.
    const unfixedRestore = h => { h.transparentBg = false; h.stars.visible = true; };

    setNightly(true);
    transparent(true);
    assert.equal(host.stars.visible, false, 'precondition: both owners agree they are hidden');
    unfixedRestore(host);
    assert.equal(host.stars.visible, true,
      'the defect no longer reproduces — the test above may have stopped discriminating');
  });

  test('switching NIGHT off under transparent background leaves them hidden', () => {
    // The output format wins over the look: alpha capture must not gain 1200
    // white points because someone toggled a mode.
    transparent(true);
    setNightly(true);
    setNightly(false);
    assert.equal(host.stars.visible, false);
  });
});

describe('NIGHT leaves the picture itself alone', () => {
  // Not a style preference: the mode's darkness comes from the NIGHT palettes
  // sitting under the bloom gate at rest, not from turning anything down. The
  // owner asked for bloom to stay reachable so the dark can be lifted with it,
  // and for the specular to stay as it is until it is seen to be bad.
  test('it writes no uniform, no bloom setting and no palette', () => {
    const touched = [];
    host.U = new Proxy({}, { get: (_, k) => { touched.push(String(k)); return { value: 0 }; } });
    host.bloomPass = new Proxy({}, { get: (_, k) => { touched.push(`bloom.${String(k)}`); return 0; },
                                     set: (_, k) => { touched.push(`bloom.${String(k)}=`); return true; } });
    setNightly(true);
    advance(600);
    assert.deepEqual(touched, [],
      `NIGHT reached into the render state: ${touched.join(', ')}`);
  });
});
