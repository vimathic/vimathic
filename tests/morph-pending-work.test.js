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
// ── The deliberate-drop half ──────────────────────────────────────────────────
// Carrying work forward is right for morph-to-morph, but wrong in one case:
// switching to a GPU shader supersedes a queued CPU formula outright. Without a
// way to say so, a queued setFormula would land after the shader was applied and
// re-arm the CPU path over it (uMathMode back to 1, shader displacement gated
// off). cancelPendingMorph() is that way to say so, and main.js's GPU branch
// calls it.
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
const drop   = ()  => RenderEngine.prototype.cancelPendingMorph.call(host);
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

  test('cancelPendingMorph drops queued work on purpose', () => {
    morph(() => applied.push('cpu-formula'));
    advance(100);

    drop();                                        // a GPU shader supersedes it
    morph(() => applied.push('shape'));
    advance(DUR + 32);

    assert.deepEqual(applied, ['shape'],
      'a formula the shader replaced must not re-arm at the next flat frame');
  });

  test('control — cancelPendingMorph on an idle engine is harmless', () => {
    drop();
    morph(() => applied.push('work'));
    advance(DUR + 32);

    assert.deepEqual(applied, ['work']);
  });
});
