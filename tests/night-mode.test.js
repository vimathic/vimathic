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

let RenderEngine, TransitionManager, GRID_OPACITY, NIGHT_GRID_OPACITY, STARS_OPACITY, uiColor, THREE;
before(async () => {
  ({ RenderEngine, TransitionManager, GRID_OPACITY, NIGHT_GRID_OPACITY, STARS_OPACITY, uiColor } =
    await import('../src/render.js'));
  // Both are free variables in setTransparentBackground's body, so the
  // reinjection below has to hand them to the rebuilt copy.
  THREE = await import('three');
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
    // The starfield fades now, so it has a material like the grid does.
    stars: { visible: true, material: { opacity: STARS_OPACITY, transparent: true } },
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
    advance(600);
    assert.equal(host.stars.visible, false, 'the brightest thing in the frame is still there');
    setNightly(false);
    advance(600);
    assert.equal(host.stars.visible, true);
    assert.equal(host.stars.material.opacity, STARS_OPACITY);
  });

  test('the starfield fades rather than cuts', () => {
    // `nightly` is part of the snapshot (presets.js), so a clip whose steps
    // were saved with the mode on and off alternates it every few seconds —
    // and 1200 white points arriving between one frame and the next is exactly
    // the flashing this app damps elsewhere. The grid already fades across
    // this toggle; the two halves of the mode should arrive together.
    setNightly(true);
    advance(100);
    assert.equal(host.stars.visible, true,
      'gone within a frame of the click — that is a cut, not a fade');
    assert.ok(host.stars.material.opacity > 0 && host.stars.material.opacity < STARS_OPACITY,
      `mid-fade opacity is ${host.stars.material.opacity}, i.e. the fade is not running`);
    advance(600);
    assert.equal(host.stars.visible, false);
    assert.equal(host.stars.material.opacity, STARS_OPACITY,
      'hidden stars must rest at full opacity, or the instant restore brings back nothing');
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

  test('a NIGHT toggle inside a G fade does not lose the hide', () => {
    // fadeGrid keeps its whole bookkeeping in the tween's onDone: on the way
    // out `visible` stays true for the full 400 ms and goes false only when
    // the fade lands. setGridLitOpacity shares the slot, so starting its own
    // tween cancelled that fade and the write was discarded — leaving the grid
    // the operator had just switched off in the scene, and therefore in
    // captureStream, the second screen and the recorder, with grid.visible
    // reading the opposite of reality and swallowing the next G press.
    fadeGrid(false);        // G — 400 ms of fading out...
    advance(100);
    setNightly(true);       // ...and the mode switched inside it
    advance(600);
    assert.equal(host.grid.visible, false,
      'the grid that was switched off is still in the scene — the pre-empted fade lost its onDone');
    assert.equal(host.grid.material.opacity, NIGHT_GRID_OPACITY,
      'a hidden grid rests at the mode\'s lit opacity, so G brings it back at the right strength');
  });

  test('control — the same two actions in the other order were always fine', () => {
    // The defect is one-directional: setGridLitOpacity's tween owes no
    // handback, so fadeGrid pre-empting it loses nothing. If this ever fails,
    // the fix has broken the half that was already right.
    setNightly(true);
    advance(100);
    fadeGrid(false);
    advance(600);
    assert.equal(host.grid.visible, false);
    assert.equal(host.grid.material.opacity, NIGHT_GRID_OPACITY);
  });

  test('control — a grid hidden by a third party mid-fade still rests at the new value', () => {
    // ⊞ GRID, a preset and setTransparentBackground all write grid.visible
    // directly, so a fade can be left running over a grid that is already
    // hidden. Nothing here needs the fade cancelled — its own onDone parks at
    // gridLitOpacity, which by then is the mode's value — and this case says
    // so, because an earlier draft of the fix added a cancel that no test
    // could distinguish from its own absence.
    fadeGrid(false);
    advance(100);
    host.grid.visible = false;   // ⊞ GRID / a preset / transparent background
    setNightly(true);
    advance(600);
    assert.equal(host.grid.material.opacity, NIGHT_GRID_OPACITY);
    assert.equal(host.grid.visible, false,
      'the fade handed `visible` back over a third party that had already claimed it');
  });

  test('a settled fade does not land a second time over ⊞ GRID', () => {
    // Making the fade land is only half of it: its tween is still in the slot
    // and its onDone is still coming. If it arrives after the operator has
    // brought the grid back by hand, `claimed` no longer protects anything —
    // the fade re-runs its decision and switches off a grid switched on a
    // moment ago, with the button left reading ON. So the slot has to be taken
    // away from it, not merely settled.
    fadeGrid(false);            // G — fading out
    advance(100);
    setNightly(true);           // the mode makes that fade land: hidden, at 0.04
    host.grid.visible = true;   // ⊞ GRID — the operator brings it straight back
    advance(600);               // ...where the old fade's onDone would have landed
    assert.equal(host.grid.visible, true,
      'the settled fade landed again and switched off a grid the operator had just switched on');
  });

  test('control — a second G tap inside the fade does not cut the grid out early', () => {
    // The regression an earlier draft of this fix shipped, caught in review.
    // G reads grid.visible (src/main.js), and a fade-OUT leaves that true for
    // its whole 400 ms — so double-tapping G calls fadeGrid(false) a SECOND
    // time, and that is the reachable double-fade path, not fade-out→fade-in.
    // A draft ran the dying fade's handback at the top of every fadeGrid,
    // which hid the grid at the instant of the second tap, at nine-tenths
    // opacity, with the remaining fade running invisibly. NIGHT is not
    // involved: this is the plain G key on a plain grid.
    fadeGrid(false);
    advance(100);
    fadeGrid(false);
    assert.equal(host.grid.visible, true,
      'the grid vanished at the second tap instead of finishing its fade');
    advance(600);
    assert.equal(host.grid.visible, false);
    assert.equal(host.grid.material.opacity, GRID_OPACITY);
  });

  test('control — G pre-empted by G still ends where the second press asked', () => {
    // The handback must not be run from the pre-empted tween's onCancel: by
    // then fadeGrid(true) has already raised `visible`, and a dying fade-out
    // handing back `false` would hide the fade-in that replaced it. This is
    // the case that fails if the settle moves into start()'s onCancel alone.
    fadeGrid(false);
    advance(100);
    fadeGrid(true);
    advance(600);
    assert.equal(host.grid.visible, true, 'the second G press was swallowed');
    assert.equal(host.grid.material.opacity, GRID_OPACITY);
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

  test('reinjected — the pre-NIGHT restore, rebuilt from the real method, undoes NIGHT', () => {
    // The assertion above has to discriminate, not just pass, and this is the
    // case that proves it can.
    //
    // FIX(night): it used to prove nothing. The "unfixed restore" was a
    // two-line stand-in written here — `h.stars.visible = true` — and the
    // assertion under it read back the value that line had just written. No
    // edit to src/ could turn it red, so the alarm in its own message could
    // never print: a control that cannot fail is the thing it was guarding
    // against, one file over.
    //
    // So mutate the real source instead, the way tests/clock-rate.test.js
    // does: take setTransparentBackground's own text, put the pre-NIGHT
    // restore back into it, rebuild the method and run the same scenario
    // through THAT. If the fix is ever rewritten, RESTORE_RE stops matching
    // and the control below says so rather than going quietly green.
    const src = RenderEngine.prototype.setTransparentBackground.toString();
    const RESTORE_RE = /this\._setStarsNow\(!this\.nightly\);/;
    assert.ok(RESTORE_RE.test(src),
      'RESTORE_RE is stale — this control can no longer reinject the defect, fix the regexp');
    const mutantSrc = src.replace(RESTORE_RE, 'this._setStarsNow(true);');
    // Class bodies are strict; an object-literal method rebuilt through
    // Function is not, so say so explicitly rather than run the copy under
    // different rules than the original.
    const unfixed = new Function('THREE', 'uiColor',
      `'use strict'; return ({ ${mutantSrc} }).setTransparentBackground;`)(THREE, uiColor);

    setNightly(true);
    unfixed.call(host, true);
    assert.equal(host.stars.visible, false, 'precondition: both owners agree they are hidden');
    unfixed.call(host, false);
    assert.equal(host.stars.visible, true,
      'the defect no longer reproduces — the test above may have stopped discriminating');
  });

  test('the instant restore is not undone by a fade still running', () => {
    // The output format writes both fields itself, so it owes an abandoned
    // fade nothing — but it does have to take the slot away from it. A fade
    // left in the slot goes on writing opacity one frame later, over the value
    // just set, and the starfield dips to nothing before climbing back.
    setNightly(true);  advance(600);      // stars hidden
    setNightly(false);                    // ...and now fading back IN
    advance(100);
    transparent(true);                    // alpha output: hide, instantly
    transparent(false);                   // ...and back, instantly (NIGHT is off)
    assert.equal(host.stars.material.opacity, STARS_OPACITY, 'restored at full strength');
    advance(16);
    assert.equal(host.stars.material.opacity, STARS_OPACITY,
      'a fade nobody stopped went on writing opacity over the instant restore');
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
