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
    uPointSize: { value: 1 }, uLighting: { value: 1 },
    uMode: { value: 0 }, uMathMode: { value: 0 }, uModeNext: { value: 0 },
    uMorphProgress: { value: 1 }, uModeBlend: { value: 0 },
  };
  const gpuMat  = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U });
  const gpuMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 2, 2), gpuMat);
  const scene   = new THREE.Scene();
  scene.add(gpuMesh);
  return {
    U, gpuMat, gpuMesh, scene,
    gpuPtsProxy: null,
    activeVS: VS, activeFS: FS,
    vizMode: 'surface',
    // A renderer that always links cleanly: no onShaderError call, so
    // compileAndApply takes its real onSuccess branch.
    renderer: {
      debug: {},
      compile() {},
      render() {},
      getRenderTarget() { return null; },
      setRenderTarget() {},
    },
    applyShaderSource(...a) { return RenderEngine.prototype.applyShaderSource.apply(this, a); },
    setVizModeGPU(...a)     { return RenderEngine.prototype.setVizModeGPU.apply(this, a); },
  };
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
