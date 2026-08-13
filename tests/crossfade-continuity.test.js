// tests/crossfade-continuity.test.js
//
// Contract tests for the two shader crossfades — GPU mode and colour scheme.
// Both mix exactly two slots in the shader, so both have to answer the same two
// questions honestly: what are we fading FROM, and what happens when a fade is
// interrupted.
//
// Run:
//   node --test tests/crossfade-continuity.test.js
//
// ── Defect 1: fading from a mode that was never on screen ─────────────────────
// setGPUModeAnimated() always starts the mix at uMode, assuming that mode is
// what the user is looking at. Coming out of the CPU formula path there is no
// such mode: uMathMode == 1 gated the shader's displacement off entirely
// (shaders.js:480 `if(uMathMode==0){pos.y=y;}`), so uMode still holds the boot
// default or whatever was live in some earlier GPU session. Pick a shader from
// the dropdown and the first frames drew that stale mode at full strength —
// with easeInOutCubic the chosen one stays under 10% for roughly the first
// third of a second. bootPersist restores a saved shader through the same pair
// of calls, so every reload of a saved GPU mode opened on mode 0.
//
// ── Defect 2: an interrupted fade snapping to the far end ─────────────────────
// Both methods collapsed a running fade with `if (blend > 0) uCur = uNext`,
// i.e. they jumped the frame to 100% of the mode or palette that had barely
// begun to mix, then faded away from it. The JSDoc promised the opposite
// ("the current blend value is inherited so the visual stays continuous").
// Two slots cannot express a three-way mix, so an interrupt must collapse to
// one end — but it has to be the NEARER one. Interrupt a 3 s AUTO COLOUR fade
// half a second in and the old rule cut the screen to a palette nobody chose.
//
// ── Controls ──────────────────────────────────────────────────────────────────
// "switching shaders while one is live still crossfades" and "interrupted near
// the end" pass before and after: they stop the fix from being satisfied by
// deleting the crossfade, and pin that the far end is still right when it is
// the near one. "an uninterrupted fade lands on its target" pins the commit.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => ({ value: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

let RenderEngine, TransitionManager;
before(async () => {
  ({ RenderEngine, TransitionManager } = await import('../src/render.js'));
});

// Both fades are driven off performance.now(), so the clock is what we advance.
const realNow = performance.now.bind(performance);
let clock = 0;
before(() => { performance.now = () => clock; });
after(()  => { performance.now = realNow; });

const MODE_MS  = 1200;   // _tDurMode on desktop
const COLOR_MS = 600;    // _tDurColor on desktop

// updateUniforms() is where the engine sees each frame, so the tests drive the
// real one rather than setting a flag by hand — that is the thing under test.
const SILENCE = { bass: 0, bassSens: 1, mid: 0, treble: 0, trebleSens: 1, beatInt: 0, amp: 0, waveInt: 1 };

let host;

function makeHost() {
  return {
    transitions: new TransitionManager(),
    U: {
      uMode:     { value: 0 }, uModeNext: { value: 0 }, uModeBlend: { value: 0 },
      uCM:       { value: 16 }, uCMNext:  { value: 16 }, uCMBlend:   { value: 0 },
      uMathMode: { value: 0 },
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uAmp:  { value: 0 }, uWI:  { value: 0 },
    },
    filmGrainVigPass: { enabled: false },
    _tDurMode:  MODE_MS,
    _tDurColor: COLOR_MS,
  };
}

beforeEach(() => {
  clock = 0;
  host = makeHost();
});

const setMode  = m        => RenderEngine.prototype.setGPUModeAnimated.call(host, m);
const setColor = (c, o)   => RenderEngine.prototype.setColorSchemeAnimated.call(host, c, o);
/** One animation frame: the loop advances the clock, then calls updateUniforms. */
const frame    = ()       => { clock += 16; RenderEngine.prototype.updateUniforms.call(host, clock, SILENCE); };
const advance  = ms       => { for (let done = 0; done < ms; done += 16) frame(); };
/** What the CPU formula path does on its way in and out. */
const cpuOwns  = ()       => { host.U.uMathMode.value = 1; };
const cpuLeave = ()       => { host.U.uMathMode.value = 0; };

describe('a GPU mode crossfade fades from what is actually on screen', () => {

  test('leaving the CPU formula path, the chosen shader is what gets drawn', () => {
    cpuOwns();
    advance(100);          // the CPU formula owns the surface; no mode is visible
    cpuLeave();            // mathViz.deactivate()
    setMode(20);           // ...and the dropdown's handler, in that order

    assert.equal(host.U.uModeBlend.value, 0,
      'nothing to fade from, so no mix may be left standing');
    assert.equal(host.U.uMode.value, 20,
      'the very first frame must draw mode 20, not the mode uMode happened to hold');
  });

  test('a shader restored at boot does not open on mode 0', () => {
    // bootPersist runs before the animation loop has drawn anything at all.
    cpuLeave();
    setMode(20);

    assert.equal(host.U.uMode.value, 20);
    assert.equal(host.U.uModeBlend.value, 0);
  });

  // Both tests above read the uniforms in the same tick as the call and never
  // advance another frame, so they see the write and not the tween that outlives
  // it. `transitions.cancel('mode')` is the line that makes the write stick: an
  // in-flight fade in that slot keeps writing uModeBlend every frame and commits
  // its own target in onDone, about a second later. Deleting the cancel left the
  // whole suite green.
  test('a fade abandoned in the CPU path does not come back and take the screen', () => {
    advance(32);
    setMode(5);                    // a 1.2 s crossfade towards shader 5 begins
    cpuOwns();                     // ...and the operator picks a CPU formula instead
    advance(100);
    cpuLeave();
    setMode(20);                   // then picks shader 20 from the dropdown

    assert.equal(host.U.uMode.value, 20, 'precondition: the chosen shader is on');

    advance(16);
    assert.equal(host.U.uModeBlend.value, 0,
      'the abandoned tween is still mixing into the frame the operator is watching');

    advance(MODE_MS * 2);
    assert.equal(host.U.uMode.value, 20,
      'shader 20 was replaced, unasked, by the one from the fade that was left behind');
    assert.equal(host.U.uModeNext.value, 20);
    assert.equal(host.U.uModeBlend.value, 0);
  });

  test('control — with a shader live, switching to another one still crossfades', () => {
    advance(32);           // GPU owns the surface (uMathMode == 0)
    setMode(5);

    assert.equal(host.U.uMode.value, 0,     'the live mode stays the "from" end');
    assert.equal(host.U.uModeNext.value, 5, 'and the new one is the "to" end');

    advance(MODE_MS / 2);
    const mid = host.U.uModeBlend.value;
    assert.ok(mid > 0 && mid < 1, `mid-fade the mix is partial, got ${mid}`);

    advance(MODE_MS);
    assert.equal(host.U.uMode.value, 5,      'and it commits to the target');
    assert.equal(host.U.uModeBlend.value, 0, 'with the mix cleared so one branch runs');
  });
});

describe('an interrupted crossfade collapses to the nearer end', () => {

  test('a shader fade interrupted early keeps the mode that is on screen', () => {
    advance(32);
    setMode(5);
    advance(MODE_MS * 0.1);       // ~0.4% mixed in — the screen is still mode 0
    assert.ok(host.U.uModeBlend.value < 0.5, 'precondition: barely into the fade');

    setMode(9);
    assert.equal(host.U.uMode.value, 0,
      'mode 5 was never really shown; cutting to it at full strength is the worst option');
    assert.equal(host.U.uModeNext.value, 9);
  });

  test('a palette fade interrupted early keeps the palette that is on screen', () => {
    advance(32);
    setColor(3, { duration: 3000 });   // AUTO COLOUR asks for a long, slow drift
    advance(500);                      // half a second in: almost entirely palette 16
    assert.ok(host.U.uCMBlend.value < 0.5, 'precondition: barely into the fade');

    setColor(7);                       // user picks one by hand, or presses Q/E
    assert.equal(host.U.uCM.value, 16,
      'the screen shows palette 16, so the new fade has to start there — no cut');
    assert.equal(host.U.uCMNext.value, 7);
  });

  test('control — interrupted near the end, the far mode IS the near one', () => {
    advance(32);
    setMode(5);
    advance(MODE_MS * 0.9);
    assert.ok(host.U.uModeBlend.value > 0.5, 'precondition: nearly arrived');

    setMode(9);
    assert.equal(host.U.uMode.value, 5, 'mode 5 is what is on screen by now');
    assert.equal(host.U.uModeBlend.value, 0);
  });

  // The colour half had no late-interrupt twin, so its collapse branch was
  // bounded from below only — `if (false)` on it survived the whole suite while
  // the same mutation on the mode branch was caught, and coverage listed the
  // branch body as never executed.
  test('control — a palette fade interrupted near the end takes the palette it arrived at', () => {
    advance(32);
    setColor(3, { duration: 3000 });
    advance(2700);                     // 90% through: the screen is essentially palette 3
    assert.ok(host.U.uCMBlend.value > 0.5, 'precondition: nearly arrived');

    setColor(7);
    assert.equal(host.U.uCM.value, 3,
      'palette 3 is what the eye is on by now; starting the new fade from 16 is the cut');
    assert.equal(host.U.uCMNext.value, 7);
    assert.equal(host.U.uCMBlend.value, 0);
  });

  test('control — an uninterrupted palette fade lands on its target', () => {
    advance(32);
    setColor(7);
    advance(COLOR_MS * 2);

    assert.equal(host.U.uCM.value, 7);
    assert.equal(host.U.uCMNext.value, 7);
    assert.equal(host.U.uCMBlend.value, 0);
  });
});

// The two interrupt tests above sample the rule at 10% and 90% of the duration,
// which easeInOutCubic maps to blends of 0.005 and 0.997 — so every threshold
// between those two satisfies both, and the middle of the fade, where an
// operator actually interrupts, is never probed. These sweep the fraction and
// assert the RULE rather than two samples of it: whichever end is nearer the
// blend on screen is the end that must be kept.
describe('the near-end rule holds across the whole fade, not just at its ends', () => {

  const FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9];

  test('a shader fade keeps the nearer mode wherever it is interrupted', () => {
    const blends = [];
    for (const frac of FRACTIONS) {
      clock = 0;
      host = makeHost();
      advance(32);
      setMode(5);
      advance(MODE_MS * frac);

      const blend = host.U.uModeBlend.value;
      blends.push(blend);
      const nearer = blend > 0.5 ? 5 : 0;   // 5 is the "to" end, 0 the "from" end

      setMode(9);
      assert.equal(host.U.uMode.value, nearer,
        `interrupted ${frac * 100}% in the mix reads ${blend.toFixed(4)}, so the nearer ` +
        `end is mode ${nearer} — kept mode ${host.U.uMode.value} instead`);
      assert.equal(host.U.uModeNext.value, 9);
    }
    // The sweep is only a rule test if it actually crossed the halfway point.
    assert.ok(blends.some(b => b < 0.5) && blends.some(b => b > 0.5),
      `the sweep never straddled the halfway blend: ${blends.map(b => b.toFixed(3))}`);
  });

  test('a palette fade keeps the nearer palette wherever it is interrupted', () => {
    const DUR = 3000;                       // what AUTO COLOUR asks for on a slow track
    const blends = [];
    for (const frac of FRACTIONS) {
      clock = 0;
      host = makeHost();
      advance(32);
      setColor(3, { duration: DUR });
      advance(DUR * frac);

      const blend = host.U.uCMBlend.value;
      blends.push(blend);
      const nearer = blend > 0.5 ? 3 : 16;

      setColor(7);
      assert.equal(host.U.uCM.value, nearer,
        `interrupted ${frac * 100}% in the mix reads ${blend.toFixed(4)}, so the nearer ` +
        `palette is ${nearer} — kept ${host.U.uCM.value} instead`);
      assert.equal(host.U.uCMNext.value, 7);
    }
    assert.ok(blends.some(b => b < 0.5) && blends.some(b => b > 0.5),
      `the sweep never straddled the halfway blend: ${blends.map(b => b.toFixed(3))}`);
  });
});
