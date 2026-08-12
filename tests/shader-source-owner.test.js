// tests/shader-source-owner.test.js
//
// Contract test for "which GLSL program is live": RenderEngine owns it, and
// every material that draws the GPU mesh must carry it — the surface material
// and the POINTS proxy alike.
//
// Run:
//   node --test tests/shader-source-owner.test.js
//
// ── The defects this pins ─────────────────────────────────────────────────────
// There are two materials (gpuMat and the POINTS proxy) and three writers (the
// shader editor's APPLY, its RESET, and the proxy's own construction). Each
// writer used to reach a different subset:
//   • the proxy was always built from the built-in VS/FS, so an applied custom
//     shader silently vanished on clicking ⋯ PTS and reappeared in SURF —
//     indistinguishable from a random glitch;
//   • RESET restored gpuMat only, and in POINTS mode gpuMesh.visible is false,
//     so the button reported success while the picture did not change at all;
//   • a preset with no custom shader could not undo a live one for the same
//     reason, which let one shader-carrying clip step poison a whole clip.
// applyShaderSource() is the single owner all three now go through.
//
// Also pinned: an editor vertex shader must write gl_PointSize, or the same
// program installed on the proxy draws points of undefined size.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// No GL: the renderer is a stub whose debug.onShaderError never fires, which is
// exactly the "compiled successfully" path, and setVizModeGPU only builds
// three.js objects. document is stubbed for #se-code / #se-error.

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

let RenderEngine, ShaderEditor, VS, FS, THREE;
before(async () => {
  ({ RenderEngine } = await import('../src/render.js'));
  ({ ShaderEditor, VS, FS } = await import('../src/shaders.js'));
  THREE = await import('three');
});

// Everything setVizModeGPU / applyShaderSource / compileAndApply touch.
function makeRender() {
  const U = {
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
    uAmp: { value: 1 }, uBeat: { value: 0 }, uWI: { value: 1 },
    uPointSize: { value: 1 }, uLighting: { value: 1 }, uPtStyle: { value: 0 },
    uMode: { value: 0 }, uMathMode: { value: 0 }, uModeNext: { value: 0 },
    uMorphProgress: { value: 1 }, uModeBlend: { value: 0 },
  };
  const gpuMat  = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U });
  const gpuMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 2, 2), gpuMat);
  const scene   = new THREE.Scene();
  scene.add(gpuMesh);
  const host = {
    U, gpuMat, gpuMesh, scene,
    gpuPtsProxy: null,
    // No imported model on the stage. The single owner reaches a model's
    // materials too — that half is pinned in tests/model-import-stage.test.js.
    modelMeshes: [],
    activeVS: VS, activeFS: FS,
    vizMode: 'surface',
    // A renderer that links cleanly by default: no onShaderError call, so
    // compileAndApply takes its real onSuccess branch. `failWith` makes a test
    // opt into a driver-shaped failure — the reason the compile-failure paths
    // were never exercised before is that this stub could not fail at all.
    failWith: null,
    renderer: {
      debug: {},
      compile() {},
      render() {
        if (!this._host.failWith) return;
        const log = this._host.failWith;
        this.debug.onShaderError?.(
          {
            getShaderInfoLog: sh => (sh === 'VS' ? log.vert ?? '' : log.frag ?? ''),
            getProgramInfoLog: () => '',
            // What the driver actually compiled. three.js prepends its own
            // preamble to every program, so this is not the string the editor
            // assembled — which is the whole point of asking for it.
            getShaderSource: sh => (sh === 'VS' ? log.srcVert : log.srcFrag) ?? null,
          },
          'PROGRAM', 'VS', 'FS',
        );
      },
      getRenderTarget() { return null; },
      setRenderTarget() {},
    },
    // Entering PTS applies the current particle style, which needs these two.
    // The style itself is pinned in tests/particle-style.test.js; here they
    // exist so setVizModeGPU can run its real body.
    currentParticleStyle: 'squares',
    afterglow: null,
    setAfterglow(on, amount) { this.afterglow = { on, amount }; },
    applyShaderSource(...a) { return RenderEngine.prototype.applyShaderSource.apply(this, a); },
    setVizModeGPU(...a)     { return RenderEngine.prototype.setVizModeGPU.apply(this, a); },
    setParticleStyle(...a)  { return RenderEngine.prototype.setParticleStyle.apply(this, a); },
  };
  host.renderer._host = host;
  return host;
}

describe('applyShaderSource — one owner, every material', () => {
  let render, se;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
  });

  test('a custom shader applied in SURF survives the switch to PTS', () => {
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();
    assert.ok(se.customFS, 'compileAndApply did not take its success path');

    render.setVizModeGPU('points');
    assert.ok(render.gpuPtsProxy, 'points proxy was not built');
    assert.equal(render.gpuPtsProxy.material.vertexShader,   se.customVS);
    assert.equal(render.gpuPtsProxy.material.fragmentShader, se.customFS);
  });

  test('a custom shader applied while already in PTS reaches the visible material', () => {
    render.setVizModeGPU('points');
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(0.0, 1.0, 0.0);';
    se.compileAndApply();
    assert.equal(render.gpuPtsProxy.material.fragmentShader, se.customFS);
  });

  test('RESET puts the built-ins back on the points proxy, not just on gpuMat', () => {
    render.setVizModeGPU('points');
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();
    se.reset();
    assert.equal(se.customVS, null);
    assert.equal(render.gpuMat.vertexShader,   VS);
    assert.equal(render.gpuMat.fragmentShader, FS);
    assert.equal(render.gpuPtsProxy.material.vertexShader,   VS);
    assert.equal(render.gpuPtsProxy.material.fragmentShader, FS);
  });

  test('revertToBuiltIn restores the program without touching the editor text', () => {
    se._tab = 'frag';
    const body = 'c = vec3(1.0, 0.0, 0.0);';
    document.getElementById('se-code').value = body;
    se.compileAndApply();
    const textBefore = se._frag;
    se.revertToBuiltIn();
    assert.equal(render.gpuMat.fragmentShader, FS);
    assert.equal(se.customFS, null);
    assert.equal(se._frag, textBefore, 'revertToBuiltIn must not stomp the buffers');
  });

  test('a proxy built after a revert inherits the built-ins', () => {
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();
    se.revertToBuiltIn();
    render.setVizModeGPU('points');
    assert.equal(render.gpuPtsProxy.material.fragmentShader, FS);
  });

  test('an editor vertex program writes gl_PointSize', () => {
    // Without it the same program on the POINTS proxy draws undefined-size
    // points — one visible glitch traded for another.
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = sin(r*3.0)*a;';
    se.compileAndApply();
    assert.match(se.customVS, /gl_PointSize\s*=/);
    assert.match(se.customVS, /uniform float[^;]*uPointSize/);
  });
});

// ── Compile feedback ──────────────────────────────────────────────────────────
// Neither of these could be reached before: the stub renderer above always
// linked cleanly, so every failure path in compileAndApply was unexecuted by the
// whole suite. That is why both defects survived two audits.
//
// 1. The 2 s "✔ Compiled & applied" tidy-up was armed and never cancelled, so a
//    failure arriving within two seconds — including the ordinary case of
//    pressing APPLY twice while fixing a typo — had its red message and its
//    line number wiped by the previous run's timer. Same defect as the camera
//    programmer's status line, in the other editor.
// 2. The error-line highlight was computed against the VERTEX body whatever tab
//    was on screen: _parseErrorLine got `fullFS` as the source and `vertBody` as
//    the user text, so the preamble length was the difference between two
//    unrelated buffers and the gutter marked a line the operator never wrote.
describe('compile feedback survives the run that came before it', () => {
  let render, se, results;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
    results = [];
    se.cb.onCompileResult = r => results.push(r);
  });

  test('a failure is not blanked by the previous success timer', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    se._tab = 'frag';

    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();                                   // ✔, arms the 2 s timer
    assert.equal(results.at(-1).ok, true);

    render.failWith = { frag: "ERROR: 0:99: 'nope' : undeclared identifier" };
    document.getElementById('se-code').value = 'c = nope;';
    se.compileAndApply();                                   // ⚠ one keystroke later
    assert.equal(results.at(-1).ok, false, 'precondition: the failure was reported');

    t.mock.timers.tick(2000);

    assert.equal(results.at(-1).ok, false,
      'the timer belongs to the message that armed it, not to the status line');
    assert.notEqual(document.getElementById('se-error').textContent, '',
      'the red message is the only thing telling the operator what broke');
  });

  test('control — an uninterrupted success still tidies itself away', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();

    t.mock.timers.tick(2000);

    assert.equal(results.at(-1).ok, true);
    assert.equal(results.at(-1).message, '', '"✔ Compiled & applied" is transient by design');
    assert.equal(document.getElementById('se-error').textContent, '');
  });
});

describe('the error line points at the line the operator wrote', () => {
  let render, se, results;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
    results = [];
    se.cb.onCompileResult = r => results.push(r);
  });

  /** Where the body starts inside the assembled program, learned from a clean compile. */
  const preambleFor = (se, tab, body) => {
    se._tab = tab;
    document.getElementById('se-code').value = body;
    se.compileAndApply();
    const assembled = tab === 'vert' ? se.customVS : se.customFS;
    return assembled.slice(0, assembled.indexOf(body)).split('\n').length - 1;
  };

  test('on the FRAGMENT tab it counts from the fragment body', () => {
    const body = ['float a = 1.0;', 'float b = 2.0;', 'c = vec3(BAD);'].join('\n');
    const preamble = preambleFor(se, 'frag', body);

    render.failWith = { frag: `ERROR: 0:${preamble + 3}: 'BAD' : undeclared identifier` };
    se.compileAndApply();

    assert.equal(results.at(-1).line, 3,
      'the gutter marks this line in the editor — off by the wrong buffer it marks nothing useful');
  });

  test('on the VERTEX tab it counts from the vertex body', () => {
    const body = ['float k = 1.0;', 'y = BAD;'].join('\n');
    const preamble = preambleFor(se, 'vert', body);

    render.failWith = { vert: `ERROR: 0:${preamble + 2}: 'BAD' : undeclared identifier` };
    se.compileAndApply();

    assert.equal(results.at(-1).line, 2);
  });

  test('control — a log with no line number reports none', () => {
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0);';
    render.failWith = { frag: 'Shader failed to link' };
    se.compileAndApply();

    assert.equal(results.at(-1).ok, false);
    assert.equal(results.at(-1).line, null);
  });

  test('a line outside the body reports none rather than a wrong one', () => {
    const body = 'c = vec3(1.0);';
    const preamble = preambleFor(se, 'frag', body);

    render.failWith = { frag: `ERROR: 0:${preamble + 40}: something in the template` };
    se.compileAndApply();

    assert.equal(results.at(-1).line, null,
      'a number the gutter cannot paint is worse than no number at all');
  });
});

// The driver numbers its message against the source IT compiled, and three.js
// prepends a preamble (precision qualifiers, defines, built-in uniforms) to
// everything it hands to the GL. Counting from the editor's own assembled
// string therefore lands short by that preamble's length — in a browser, by
// enough to push every reported line outside the body and paint nothing at all.
describe('the error line survives the preamble three.js adds', () => {
  let render, se, results;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
    results = [];
    se.cb.onCompileResult = r => results.push(r);
  });

  const DRIVER_PREAMBLE = ['#version 300 es', 'precision highp float;', '#define USE_FOG 1', ''].join('\n');

  test('a line is reported relative to the body, preamble and all', () => {
    const body = ['float a = 1.0;', 'c = vec3(BAD);'].join('\n');
    se._tab = 'frag';
    document.getElementById('se-code').value = body;
    se.compileAndApply();                                  // clean run: learn our own assembly
    const driverSrc = DRIVER_PREAMBLE + se.customFS;
    const before    = driverSrc.slice(0, driverSrc.indexOf(body)).split('\n').length - 1;

    render.failWith = {
      frag: `ERROR: 0:${before + 2}: 'BAD' : undeclared identifier`,
      srcFrag: driverSrc,
    };
    se.compileAndApply();

    assert.equal(results.at(-1).line, 2,
      'counted from the editor\'s own string this lands outside the body and paints nothing');
  });

  test('a failure in the other tab paints no line at all', () => {
    const body = 'c = vec3(1.0);';
    se._tab = 'frag';
    document.getElementById('se-code').value = body;
    se.compileAndApply();
    const driverSrc = DRIVER_PREAMBLE + se.customVS;

    // The vertex stage failed while the operator is looking at FRAGMENT, and
    // the number it reports is deliberately one that WOULD land on line 1 of
    // the fragment body if it were misattributed — so "null" here can only come
    // from noticing the stage, not from the range check downstream.
    const fragPreamble = se.customFS.slice(0, se.customFS.indexOf(body)).split('\n').length - 1;
    render.failWith = {
      vert: `ERROR: 0:${fragPreamble + 1}: something in the vertex program`,
      srcVert: driverSrc,
    };
    se.compileAndApply();

    assert.equal(results.at(-1).ok, false, 'the failure is still reported');
    assert.equal(results.at(-1).line, null,
      'a line number counted through the other buffer marks text the operator did not write');
  });
});

// An editor vertex program replaces the built-in one wholesale, so it also
// inherits the built-in's responsibilities. The template declared
// uMorphProgress and never read it, so with a custom shader live the shape
// morph — which drives that uniform 1 → 0 → 1 and swaps the geometry at the
// flat frame — did nothing visible: no deflate, no inflate, just a hard cut
// mid-animation. Every path that changes shape goes through it: D, R, a preset,
// a clip step.
describe('an editor vertex program still morphs', () => {
  let render, se;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
  });

  const yWrites = src => src.split('\n').filter(l => /pos\.y\s*=/.test(l));

  test('every pos.y it writes is scaled by uMorphProgress', () => {
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = sin(r*3.0)*a;';
    se.compileAndApply();

    const writes = yWrites(se.customVS);
    assert.ok(writes.length, 'precondition: the template writes pos.y at all');
    for (const line of writes) {
      assert.match(line, /uMorphProgress/,
        `a shape swap deflates through this uniform; unscaled, the morph is a cut: ${line.trim()}`);
    }
  });

  test('control — the built-in VS it mirrors satisfies the same rule', () => {
    const writes = yWrites(VS);
    assert.ok(writes.length);
    for (const line of writes) assert.match(line, /uMorphProgress/);
  });
});
