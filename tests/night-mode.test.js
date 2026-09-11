// tests/night-mode.test.js
//
// NIGHT — what the mode is allowed to touch, and what it must leave alone.
//
// Run:
//   node --test tests/night-mode.test.js
//
// ── The claim ────────────────────────────────────────────────────────────────
// NIGHT is a dark-room mode that writes ONE shader uniform — uGlare, how much
// white the surface throws back — plus the furniture: the starfield off, the
// grid dimmed, and, in controls.js rather than here, the unattended palette
// pickers narrowed. It writes no bloom setting, and RenderEngine.setNightly —
// the entry point this file drives — writes no palette number. The write lives in
// controls.js next to the pool narrowing: switched on over a scheme below
// NIGHT_SCHEME_FIRST it moves the choice to the first NIGHT palette; over a
// NIGHT palette it leaves the choice alone. That restraint is still worth
// pinning.
//
// Until 01.09 it wrote no uniform at all, and the specular was left white and
// keyed to treble deliberately, to be revisited if it looked wrong on real
// frames. It did: measured on the shipped tree at one camera and one
// position in the track, a mirror in NIGHT came out well above the same body in
// matte — on the mode whose whole promise is a dark picture. The figures and
// the reasoning behind them are in the note on studioEnv in src/shaders.js and
// are not restated here.
//
// Open, and not for this file to settle: that note and the header of
// tests/glare-lamps.test.js both claim the SAME measurement — plane, Eigenvector
// Field, the same sliders, six frames per configuration, median — and give
// different numbers (NIGHT mirror mean 0.233 against 0.216, NIGHT matte 0.139
// against 0.137, normal mirror p99 0.467 against 0.566). The ratio quoted for
// the mode therefore comes out 1.67x from one table and 1.58x from the other.
// One re-measurement retires the wrong table; until then, neither number should
// be copied into a third place.
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
let GLARE, NIGHT_GLARE;
before(async () => {
  ({ RenderEngine, TransitionManager, GRID_OPACITY, NIGHT_GRID_OPACITY, STARS_OPACITY, uiColor,
     GLARE, NIGHT_GLARE } = await import('../src/render.js'));
  // Both are free variables in setTransparentBackground's body, so the
  // reinjection below has to hand them to the rebuilt copy.
  THREE = await import('three');
});

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
    // The uniform block, as much of it as setNightly touches. Written through
    // `this.U?.uGlare`, so an engine that has not built its uniforms yet is not
    // a crash — and a stub that forgot this field would silently assert nothing.
    U: { uGlare: { value: GLARE } },
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
  test('the starfield stays — the night sky keeps its stars', () => {
    // REVERSED in r6, and the measurement that put the old behaviour here is
    // not in dispute: the starfield composites to bloom-luma 0.366 and clears
    // the 0.15 bloom gate at every moment of a mode that exists to keep the
    // picture dark. What the number could not decide is whether a night sky
    // with no stars in it reads as the mode working or as the mode broken, and
    // that is a question about the look. Both states are checked, and the way
    // back too, so "always on" cannot be satisfied by a starfield that was
    // never built.
    assert.equal(host.stars.visible, true, 'precondition: the stars are up before the mode');
    setNightly(true);
    advance(600);
    assert.equal(host.stars.visible, true, 'NIGHT took the stars out of the sky again');
    assert.equal(host.stars.material.opacity, STARS_OPACITY,
      'NIGHT left the stars up but dimmed them — the mode no longer touches them at all');
    setNightly(false);
    advance(600);
    assert.equal(host.stars.visible, true);
    assert.equal(host.stars.material.opacity, STARS_OPACITY);
  });

  test('and nothing fades them, because nothing alternates them', () => {
    // The 400 ms cross-fade existed for one reason: `nightly` travels in
    // presets and in clip steps, so a clip alternating the mode cut 1200 white
    // points in and out every few seconds. With NIGHT out of the picture the
    // only writer left is setTransparentBackground, which is instant on
    // purpose. A fade appearing here again would mean a second owner came back.
    setNightly(true);
    advance(16);
    assert.equal(host.stars.visible, true, 'something is taking the stars down within a frame');
    assert.equal(host.stars.material.opacity, STARS_OPACITY,
      `opacity moved to ${host.stars.material.opacity} — something is fading the starfield`);
    advance(600);
    assert.equal(host.stars.material.opacity, STARS_OPACITY);
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

  test('the white the surface throws back is turned down, and put back on the way out', () => {
    setNightly(true);
    assert.equal(host.U.uGlare.value, NIGHT_GLARE,
      'NIGHT left the glare where the bright palettes have it');
    setNightly(false);
    assert.equal(host.U.uGlare.value, GLARE,
      'leaving the mode did not restore the glare — every palette after it stays dimmed');
  });

  test('the two glare values are ordered, and neither is a no-op', () => {
    // Both halves matter and they fail differently. Equal values make the
    // assertion above pass while the mode does nothing; a GLARE of 1.0 means
    // the normal palettes were never dimmed at all, which is half the request.
    assert.ok(NIGHT_GLARE < GLARE,
      `NIGHT_GLARE ${NIGHT_GLARE} is not below GLARE ${GLARE} — the mode dims nothing`);
    assert.ok(GLARE < 1,
      `GLARE is ${GLARE}: the normal palettes are at the pre-01.09 brightness`);
    assert.ok(NIGHT_GLARE > 0,
      'a glare of zero is not a dimmer, it is deleting the highlights');
  });

  test('the glare is written straight, not faded', () => {
    // The two things that DO fade across this toggle fade because they would
    // otherwise blink 1200 white points in and out. A highlight easing down
    // over 400 ms is just a slower version of the same brightness, and a test
    // that advances the clock would hide a fade if one were ever added.
    setNightly(true);
    assert.equal(host.U.uGlare.value, NIGHT_GLARE, 'the value arrives on the next frame, not this one');
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

// r6: the two owners became one. NIGHT no longer touches the starfield, so
// setTransparentBackground is the only writer and the tests that pinned the
// shared expression are gone with it — named here rather than deleted quietly,
// because one of them was a control:
//
//   • "leaving transparent background does not undo NIGHT" — it asserted the
//     opposite of the contract now: the restore gives the stars back, full
//     stop. Rewritten below rather than dropped.
//   • "reinjected — the pre-NIGHT restore … undoes NIGHT" — a real mutation
//     control, and a good one: it rebuilt setTransparentBackground from its own
//     source with `_setStarsNow(true)` put back, to prove the assertion above
//     could discriminate. That mutant IS the shipped code now, so the control
//     has nothing left to reinject.
//   • "the instant restore is not undone by a fade still running" — there is no
//     fade to race any more; the slot, the duration and the cancel are gone.
describe('the starfield has one owner now, and it is the output format', () => {
  test('leaving transparent background gives the stars back, mode or no mode', () => {
    setNightly(true);
    transparent(true);
    assert.equal(host.stars.visible, false, 'alpha capture must not carry white points');
    transparent(false);
    assert.equal(host.stars.visible, true,
      'the restore asked the mode — it has no business asking anyone');
    assert.equal(host.stars.material.opacity, STARS_OPACITY, 'given back at half strength');
  });

  test('control — without NIGHT the round trip still restores them', () => {
    transparent(true);
    assert.equal(host.stars.visible, false);
    transparent(false);
    assert.equal(host.stars.visible, true);
  });

  test('no writer but this one — NIGHT cannot move them, in either direction', () => {
    // The half that still has to hold: alpha capture must not gain 1200 white
    // points because someone toggled a mode, and it must not lose them either.
    // Both directions, and a frame allowed to pass after each, so a fade
    // reintroduced by a later edit shows up here as movement.
    transparent(true);
    setNightly(true);  advance(600);
    assert.equal(host.stars.visible, false, 'a mode put stars into an alpha capture');
    setNightly(false); advance(600);
    assert.equal(host.stars.visible, false, 'a mode put stars into an alpha capture');
    transparent(false);
    setNightly(true);  advance(600);
    assert.equal(host.stars.visible, true, 'NIGHT is writing the starfield again');
    assert.equal(host.stars.material.opacity, STARS_OPACITY);
  });
});

describe('NIGHT leaves the rest of the picture alone', () => {
  // The mode's darkness comes from the NIGHT palettes sitting under the bloom
  // gate at rest, not from turning things down wholesale, and bloom stays
  // reachable so the dark can be lifted with it deliberately.
  //
  // This test read `deepEqual(touched, [])` until 01.09 — NIGHT touched nothing
  // at all — and it went red on the uGlare change, which is what it was for.
  // The list is the contract now: exactly one uniform, named, and nothing else.
  // Widening it is a decision someone has to make in this file, rather than
  // something an edit can do quietly.
  test('it writes uGlare and nothing else — no other uniform, no bloom, no palette', () => {
    const touched = [];
    host.U = new Proxy({}, { get: (_, k) => { touched.push(String(k)); return { value: 0 }; } });
    host.bloomPass = new Proxy({}, { get: (_, k) => { touched.push(`bloom.${String(k)}`); return 0; },
                                     set: (_, k) => { touched.push(`bloom.${String(k)}=`); return true; } });
    setNightly(true);
    advance(600);
    // The optional chain reads the key once to test it and once to write it,
    // so the same name twice is the whole of one write.
    const distinct = [...new Set(touched)];
    assert.deepEqual(distinct, ['uGlare'],
      `NIGHT reached into the render state beyond the glare: ${distinct.join(', ')}`);
  });

  test('control — the bloom pass is genuinely reachable through this stub', () => {
    // Without this the test above passes just as well against a proxy nothing
    // could ever have touched, which is how a restraint test quietly stops
    // being one. Reading a bloom field by hand must show up in the list.
    const touched = [];
    host.bloomPass = new Proxy({}, { get: (_, k) => { touched.push(`bloom.${String(k)}`); return 0; } });
    void host.bloomPass.strength;
    assert.deepEqual(touched, ['bloom.strength']);
  });
});
