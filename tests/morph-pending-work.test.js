// tests/morph-pending-work.test.js
//
// Contract test for the work a morph carries — the callback that swaps geometry
// or arms a formula at the flat frame.
//
// Run:
//   node --test tests/morph-pending-work.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// triggerMorphTransition cancels an in-flight morph by restarting its slots, and
// a cancelled tween never runs its onDone — which is where onFlat lived. So the
// scheduled work simply vanished. It mattered because onFlat is not decoration:
// applyState puts the shape swap, the formula change and the deform-mode switch
// in there deliberately, "so they apply together at the flat frame of a single
// morph animation". Load a preset and press a shape or formula hotkey inside the
// morph window (400 ms on desktop) and the preset's geometry work was dropped
// while its UI half — dropdown values, button highlights — had already been
// written synchronously. The panel then described a scene the engine never built.
//
// Fixed by queueing the callbacks instead of closing over one: a superseded
// morph hands its pending work to the morph that replaced it, and it runs at
// that morph's flat frame. Nothing is applied early — the flat frame is the
// whole point of the mechanism, since that is when the geometry is invisible.
//
// ── The superseded-work half ──────────────────────────────────────────────────
// Carrying work forward is right for morph-to-morph, but a queued CPU formula
// must not land after a GPU shader has taken the surface (uMathMode back to 1,
// shader displacement gated off). That was first written here as
// cancelPendingMorph(), and adversarial review showed it wrong twice over: it
// dropped the whole queued closure — including the shape swap applyState bundles
// into it — and it was wired to two of the three places that switch to a shader.
// The queue is no longer cancellable; each queued callback disarms ITSELF by
// checking the live #gpu-sel value when it runs. That contract lives with the
// callers, and is pinned in tests/controls-wiring.test.js and
// tests/preset-apply.test.js. What stays here is the queue's own promise:
// everything queued gets its flat frame, in order, exactly once.
//
// ── Controls ──────────────────────────────────────────────────────────────────
// "runs at the flat frame, not on the way there" and "an uninterrupted morph
// applies its work once" pass before and after the fix. They stop the failing
// case from being satisfied by simply calling onFlat eagerly, which would apply
// geometry changes while the mesh is still at full size — visible as a pop.

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

// The morph is driven off performance.now(), so the clock is what we advance.
const realNow = performance.now.bind(performance);
let clock = 0;
before(() => { performance.now = () => clock; });
after(()  => { performance.now = realNow; });

const DUR = 400;   // _tDurShape on desktop

let host, applied;

beforeEach(() => {
  clock   = 0;
  applied = [];
  host = {
    transitions:  new TransitionManager(),
    U:            { uMorphProgress: { value: 1 } },
    _tDurShape:   DUR,
  };
});

const morph  = fn => RenderEngine.prototype.triggerMorphTransition.call(host, fn);
/** Advance the clock in frame-sized steps, ticking the manager as the loop does. */
const advance = ms => {
  for (let done = 0; done < ms; done += 16) { clock += 16; host.transitions.tick(); }
};

describe('a morph carries its scheduled work', () => {

  test('work survives being superseded before the flat frame', () => {
    morph(() => applied.push('preset'));
    advance(100);                                  // still deflating
    morph(() => applied.push('hotkey'));           // user presses D mid-morph
    advance(DUR + 32);

    assert.deepEqual(applied, ['preset', 'hotkey'],
      'the preset\'s geometry work must not be dropped by the hotkey\'s morph');
  });

  test('work from several superseded morphs all lands, in order', () => {
    morph(() => applied.push('one'));
    advance(50);
    morph(() => applied.push('two'));
    advance(50);
    morph(() => applied.push('three'));
    advance(DUR + 32);

    assert.deepEqual(applied, ['one', 'two', 'three']);
  });

  test('control — an uninterrupted morph applies its work exactly once', () => {
    morph(() => applied.push('only'));
    advance(DUR * 3);

    assert.deepEqual(applied, ['only']);
  });

  test('control — work runs at the flat frame, not on the way there', () => {
    morph(() => applied.push('geometry'));

    advance(DUR / 2);
    assert.deepEqual(applied, [], 'nothing may be applied while the mesh is still visible');
    assert.ok(host.U.uMorphProgress.value > 0 && host.U.uMorphProgress.value < 1,
      'precondition: the morph is mid-deflate');

    advance(DUR * 2);   // finish the deflate, then the inflate back to full size
    assert.deepEqual(applied, ['geometry']);
    assert.equal(host.U.uMorphProgress.value, 1, 'and the mesh inflates again afterwards');
  });

  test('a callback that disarms itself does not take its neighbours with it', () => {
    // What the callers now do instead of cancelling the queue: the work that a
    // shader supersedes checks a live value and returns; everything else queued
    // for that flat frame still runs.
    let armed = true;
    morph(() => { if (armed) applied.push('cpu-formula'); });
    advance(100);

    armed = false;                                 // a GPU shader took the surface
    morph(() => applied.push('shape'));
    advance(DUR + 32);

    assert.deepEqual(applied, ['shape'],
      'the formula disarmed itself; the shape swap queued beside it must still land');
  });

  test('nothing can empty the queue behind the caller\'s back', () => {
    // There is deliberately no cancel on this API. A blunt one existed briefly
    // and threw away the shape swap that applyState bundles with the formula.
    assert.equal(RenderEngine.prototype.cancelPendingMorph, undefined,
      'work is disarmed one callback at a time, by the caller that queued it');
  });
});

// ── The ramp, not just the payload ───────────────────────────────────────────
// The JSDoc over setShapeAnimated used to promise "the in-flight tween is
// cancelled and the geometry is swapped immediately so the new shape starts
// inflating" — it now describes what these tests pin instead, which is that a
// superseded morph keeps collapsing from where it is.
// triggerMorphTransition did the opposite: it hard-wrote uMorphProgress back to
// 1.0 and ran a fresh full-length deflate. So a shape pressed mid-morph made the
// half-collapsed surface jump back to full size and start over — the biggest
// visible discontinuity available, in the one place whose whole job is to avoid
// a cut — and pushed the flat frame a full duration further away.
describe('an interrupted morph continues from where it is', () => {

  test('the surface does not spring back to full size', () => {
    morph(() => applied.push('first'));
    advance(DUR * 0.48);
    const mid = host.U.uMorphProgress.value;
    assert.ok(mid > 0.1 && mid < 0.9, `precondition: mid-deflate, got ${mid}`);

    morph(() => applied.push('second'));

    assert.ok(host.U.uMorphProgress.value <= mid,
      `the mesh is half collapsed; jumping it back to ${host.U.uMorphProgress.value} is a cut`);
    advance(16);
    assert.ok(host.U.uMorphProgress.value <= mid, 'and it keeps collapsing, not re-inflating');
  });

  test('and the flat frame does not run away', () => {
    morph(() => applied.push('first'));
    advance(DUR * 0.5);
    morph(() => applied.push('second'));

    // Half the surface is already gone, so the rest of the deflate is half a
    // duration — not a whole one measured from here.
    advance(DUR * 0.5 + 32);

    assert.deepEqual(applied, ['first', 'second'],
      'restarting the ramp also pushes the work a full duration further away');
  });

  test('control — a morph from rest still takes the full duration', () => {
    morph(() => applied.push('work'));

    advance(DUR / 2);
    const mid = host.U.uMorphProgress.value;
    assert.ok(mid > 0 && mid < 1, `mid-deflate value out of range: ${mid}`);
    assert.deepEqual(applied, [], 'nothing lands before the flat frame');

    advance(DUR * 2);
    assert.deepEqual(applied, ['work']);
    assert.equal(host.U.uMorphProgress.value, 1, 'and it inflates back to full');
  });

  test('control — a morph triggered from the flat frame itself still works', () => {
    // uMorphProgress is 0 there, so a deflate scaled by "where we are" has
    // nothing to travel — it must not divide by zero or stall.
    morph(() => { applied.push('outer'); morph(() => applied.push('inner')); });
    advance(DUR * 3);

    assert.deepEqual(applied, ['outer', 'inner']);
    assert.equal(host.U.uMorphProgress.value, 1);
  });
});

// ── The two named promises the payload tests walk past ───────────────────────
// Everything above reads `applied` — WHAT ran and in what order. Both halves of
// the animation the mechanism exists for were asserted only at their endpoints:
// "runs at the flat frame, not on the way there" never reads uMorphProgress
// inside the callback, and every inflate assertion is `=== 1` after the fact.
// So the height the swap happens at, and whether the new shape rises at all,
// were both unpinned — an inflate replaced by a bare `uMorphProgress = 1.0`
// made every shape change, formula change and preset apply pop the new surface
// into existence at full size, with the suite green.
describe('the ramp the morph exists to draw', () => {

  test('the queued work sees a surface that is actually flat', () => {
    // triggerMorphTransition's JSDoc: "@param onFlat — called at the flat frame
    // (uMorphProgress === 0)". The mesh is invisible only at 0; a swap at any
    // other height is the cut the whole two-phase dance exists to avoid.
    let seen = null;
    morph(() => { seen = host.U.uMorphProgress.value; });
    advance(DUR * 2);

    assert.ok(seen !== null, 'precondition: the queued work ran at all');
    assert.equal(seen, 0,
      `the geometry was swapped with the mesh ${(seen * 100).toFixed(1)}% tall`);
  });

  test('work carried over from a superseded morph also sees a flat surface', () => {
    // The carry-forward path reaches the flat frame through a different tween,
    // so it needs its own reading.
    const heights = [];
    morph(() => heights.push(host.U.uMorphProgress.value));
    advance(100);
    morph(() => heights.push(host.U.uMorphProgress.value));
    advance(DUR * 2);

    assert.equal(heights.length, 2, 'precondition: both callbacks ran');
    assert.deepEqual(heights, [0, 0]);
  });

  test('the new shape rises over the duration instead of popping into place', () => {
    // setShapeAnimated's JSDoc: "Phase 2 (inflate): animate uMorphProgress 0→1
    // as the new shape rises up."
    morph(() => applied.push('geometry'));
    advance(DUR + 16);                       // just past the flat frame
    assert.deepEqual(applied, ['geometry'], 'precondition: the swap has happened');
    assert.ok(host.U.uMorphProgress.value < 1,
      'the surface is already at full size one frame after the swap — that is a pop, not a rise');

    advance(DUR / 2);
    const mid = host.U.uMorphProgress.value;
    assert.ok(mid > 0 && mid < 1,
      `mid-inflate the surface is part-grown; got ${mid}`);

    advance(DUR);
    assert.equal(host.U.uMorphProgress.value, 1, 'and it does arrive at full size');
  });

  test('the inflate is monotonic — the surface only ever grows back', () => {
    // A rise that dips or overshoots reads as a wobble on every shape change.
    morph(() => {});
    advance(DUR + 16);
    let prev = host.U.uMorphProgress.value;
    const trace = [prev];
    for (let i = 0; i < Math.ceil(DUR / 16) + 2; i++) {
      advance(16);
      const now = host.U.uMorphProgress.value;
      assert.ok(now >= prev,
        `the surface shrank mid-inflate: ${prev} → ${now} (trace ${trace.join(' ')})`);
      trace.push(now);
      prev = now;
    }
    assert.equal(prev, 1);
    assert.ok(trace.filter(v => v > 0 && v < 1).length >= 4,
      `the inflate was over in ${trace.filter(v => v > 0 && v < 1).length} frames — it is a cut`);
  });
});
