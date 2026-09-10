// tests/shader-editor-status.test.js
//
// The two moments the shader editor speaks, and the one place it can leave the
// renderer pointing somewhere the user cannot see.
//
// Everything here is BEHAVIOURAL — it drives compileAndApply on a stub renderer
// and reads what came back — rather than a regex over source text. That is
// deliberate: this subsystem already carries three tests that assert the
// presence of a line rather than the survival of a value, and all three of the
// defects below sat under them, green, for the life of the branch.
//
// ── Why this runs in plain Node ──────────────────────────────────────────────
// Same shape as tests/shader-source-owner.test.js: no GL, a renderer stub whose
// debug.onShaderError never fires — which is exactly the "linked cleanly" path
// — and a document stubbed down to #se-code and #se-error.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  _els: new Map(),
  getElementById(id) {
    if (!this._els.has(id)) {
      this._els.set(id, { value: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } });
    }
    return this._els.get(id);
  },
  querySelectorAll: () => [],
};

let ShaderEditor, VS, FS, THREE;
before(async () => {
  ({ ShaderEditor, VS, FS } = await import('../src/shaders.js'));
  THREE = await import('three');
});

/**
 * The smallest host compileAndApply will run against.
 *
 * `throwOnRender` is what makes the render-target test possible: the previous
 * stub could not fail, so the failure path it guards had never been executed by
 * anything.
 */
function makeRender({ mathMode = 0, throwOnRender = false } = {}) {
  const U = {
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
    uAmp: { value: 1 }, uBeat: { value: 0 }, uWI: { value: 1 },
    uPointSize: { value: 1 }, uLighting: { value: 1 }, uPtStyle: { value: 0 },
    uPtGain: { value: 1 }, uK0: { value: 0 }, uK1: { value: 0 }, uK2: { value: 0 }, uK3: { value: 0 },
    uMode: { value: 0 }, uMathMode: { value: mathMode }, uModeNext: { value: 0 },
    uMorphProgress: { value: 1 }, uModeBlend: { value: 0 },
  };
  const gpuMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U });
  const LIVE = { _tag: 'the target the app was drawing into' };
  const calls = [];
  return {
    U,
    gpuMat,
    gpuPtsProxy: null,
    modelMeshes: [],
    activeVS: VS,
    activeFS: FS,
    _setTargets: calls,
    _current: LIVE,
    applyShaderSource(vs, fs) { this.activeVS = vs; this.activeFS = fs; },
    renderer: {
      debug: {},
      compile() {},
      render() { if (throwOnRender) throw new Error('context lost mid-probe'); },
      getRenderTarget() { return LIVE; },
      setRenderTarget(t) { calls.push(t); },
    },
  };
}

const results = se => {
  const seen = [];
  se.cb.onCompileResult = r => seen.push(r);
  return seen;
};

describe('the APPLY warning fires where it is actionable and nowhere else', () => {
  let render, se;

  beforeEach(() => { document._els.clear(); });

  test('vertex tab, CPU formula active, body writes y — the operator is warned', () => {
    render = makeRender({ mathMode: 1 });
    se = new ShaderEditor(render);
    const seen = results(se);
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = sin(r * 8.0 + T) * a;';

    assert.equal(se.compileAndApply(), true, 'the probe did not take the success path');
    assert.equal(seen[0].level, 'warn');
    assert.match(seen[0].message, /CPU formula is active/);
  });

  test('fragment tab, same CPU formula — nothing is said about geometry', () => {
    // The defect this test exists for: `wasted` read the VERTEX body whichever
    // tab was on screen, and the vertex buffer holds SE_DEFAULT_VERT, which
    // assigns y. So every APPLY made while colouring — in the mode roughly 192
    // of the ~230 SHADER MODE entries hold, and the one the app boots into —
    // printed a ten-second amber warning about code the operator had not
    // touched. compileAndApply's own comment already claimed this did not
    // happen.
    render = makeRender({ mathMode: 1 });
    se = new ShaderEditor(render);
    const seen = results(se);
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = getColor(uCM, t);';

    assert.equal(se.compileAndApply(), true);
    assert.equal(seen[0].level, 'ok', 'a fragment-only edit was nagged about the vertex half');
    assert.equal(seen[0].message, '✔ Compiled & applied');
  });

  test('vertex tab under a numbered GPU shader — the displacement is visible, so no warning', () => {
    render = makeRender({ mathMode: 0 });
    se = new ShaderEditor(render);
    const seen = results(se);
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = sin(r * 8.0 + T) * a;';

    assert.equal(se.compileAndApply(), true);
    assert.equal(seen[0].level, 'ok');
  });

  test('vertex tab, CPU formula, a body that writes no y — still nothing to warn about', () => {
    render = makeRender({ mathMode: 1 });
    se = new ShaderEditor(render);
    const seen = results(se);
    se._tab = 'vert';
    document.getElementById('se-code').value = 'pos.x += 0.1;';

    assert.equal(se.compileAndApply(), true);
    assert.equal(seen[0].level, 'ok');
  });
});

describe('whoever writes the status line owns it', () => {

  test('claimStatus cancels the timer APPLY armed, so the next message survives', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    document._els.clear();
    const render = makeRender({ mathMode: 0 });
    const se = new ShaderEditor(render);
    const seen = results(se);
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = 0.0;';
    se.compileAndApply();
    assert.equal(seen.length, 1, 'the success report did not arrive');

    // TIDY's first act. Without it the timer below blanks whatever TIDY writes.
    se.claimStatus();
    t.mock.timers.tick(11000);
    assert.equal(seen.length, 1, 'the previous run\'s timer still fired and blanked the line');
  });

  test('and without claiming it, the timer does blank the line — the fix is load-bearing', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    document._els.clear();
    const render = makeRender({ mathMode: 0 });
    const se = new ShaderEditor(render);
    const seen = results(se);
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = 0.0;';
    se.compileAndApply();

    t.mock.timers.tick(11000);
    assert.equal(seen.length, 2, 'the success timer no longer clears the status line at all');
    assert.equal(seen[1].message, '');
  });
});

describe('the compile probe hands the renderer back', () => {

  test('a throw during the probe render still restores the previous target', () => {
    // Left inside the try, this leaked: the renderer stayed bound to the 1x1
    // probe target and every frame after it went into a one-pixel buffer. The
    // canvas stops updating, nothing says why, and a reload is the only way
    // out — on paths that reach here with the overlay CLOSED, which is a preset
    // click or a clip step.
    document._els.clear();
    const render = makeRender({ mathMode: 0, throwOnRender: true });
    const se = new ShaderEditor(render);
    results(se);
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = 0.0;';

    assert.equal(se.compileAndApply(), false, 'a throwing probe must report failure');
    const calls = render._setTargets;
    assert.ok(calls.length >= 2, 'the renderer was never handed a target back');
    assert.equal(calls.at(-1), render._current,
      'the renderer was left bound to the probe target after the throw');
  });

  test('and the ordinary path restores it too, then disposes the probe', () => {
    document._els.clear();
    const render = makeRender({ mathMode: 0 });
    const se = new ShaderEditor(render);
    results(se);
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = 0.0;';

    assert.equal(se.compileAndApply(), true);
    const calls = render._setTargets;
    assert.equal(calls.at(-1), render._current);
    assert.ok(calls.at(-2) && calls.at(-2) !== render._current,
      'the probe target was never bound, so the link check never ran');
  });
});
