// tests/wire-style.test.js
//
// Contract tests for the WIRE wire styles (RenderEngine.setWireStyle) and the
// fragment block they drive (_WIRE_BLOCK in src/shaders.js).
//
// Run:
//   node --test tests/wire-style.test.js
//
// ── What is worth pinning here ────────────────────────────────────────────────
// A wire style is up to five settings that only work together — a fragment
// effect and its gain, gpuMat's blending, a body drawn under the lines, and the
// afterglow pass. And gpuMat is not the wire's own material: it is the SURF
// material with its wireframe flag up. So the sharpest risk is a LEAK — a Neon
// blend, a hologram body or a trail left standing when the operator goes to
// SURF or PTS. The tests are about what moves together, what must come off,
// and the one uniform the shared block must never hold as 1.
//
// What is NOT here: how the styles look. That was tuned on real frames (the
// torus, the plane and the boot shape under the shipped Bloom), and pixels are
// for eyes; tests/e2e/wire-styles.spec.js checks in a real browser that every
// style compiles and that the row behaves.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// The harness of tests/particle-style.test.js: a fake carrying the handful of
// fields these methods touch, with the REAL prototype methods bound to it.
// three.js is imported for the materials and the blending constants, which are
// the actual subject of most of the assertions.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

// setShape schedules its geometry dispose in a rAF. Queue it without running
// it: nothing here needs the dispose, and the shape test reads the new buffers.
const rafQueue = [];
globalThis.requestAnimationFrame = cb => rafQueue.push(cb);

let RenderEngine, gridEdgeIndex, ROWS_TARGET, wireGainFor, NIGHT_WIRE_GLOW;
let VS, FS, SE_FS_TEMPLATE, THREE, mergeVertices;
before(async () => {
  ({ RenderEngine, gridEdgeIndex, ROWS_TARGET, wireGainFor, NIGHT_WIRE_GLOW } = await import('../src/render.js'));
  ({ VS, FS, SE_FS_TEMPLATE } = await import('../src/shaders.js'));
  THREE = await import('three');
  ({ mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js'));
});

function makeRender({ model = false, geometry = null } = {}) {
  const U = {
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
    uAmp: { value: 1 }, uBeat: { value: 0 }, uWI: { value: 1 },
    uPointSize: { value: 1 }, uLighting: { value: 1 }, uPtStyle: { value: 0 },
    uPtGain: { value: 1 }, uPtBand: { value: 0 },
    uMode: { value: 0 }, uMathMode: { value: 0 }, uModeNext: { value: 0 },
    uMorphProgress: { value: 1 }, uModeBlend: { value: 0 },
    uWireFx: { value: 0 }, uWirePass: { value: 0 }, uWireGain: { value: 1 },
  };
  const gpuMat  = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U });
  const gpuMesh = new THREE.Mesh(geometry ?? new THREE.PlaneGeometry(1, 1, 2, 2), gpuMat);
  const scene   = new THREE.Scene();
  scene.add(gpuMesh);
  return {
    U, gpuMat, gpuMesh, scene,
    gpuPtsProxy: null, _ptsGeo: null,
    gpuWireFill: null, _wireOccluderMat: null,
    modelMeshes: model ? [new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gpuMat)] : [],
    activeVS: VS, activeFS: FS,
    vizMode: 'surface',
    currentParticleStyle: 'squares',
    currentWireStyle: 'classic',
    // NIGHT, for the additive styles' gain. The grid half of setNightly is
    // tests/night-mode.test.js's; here it is a no-op.
    nightly: false,
    setNightly(...a) { return RenderEngine.prototype.setNightly.apply(this, a); },
    setGridLitOpacity() {},
    // The composer is out of scope; record what the styles asked of it — the
    // last request, and every request in order.
    afterglow: null, afterglowCalls: [],
    setAfterglow(on, amount) { this.afterglow = { on, amount }; this.afterglowCalls.push(on); },
    _pointsGeometry(...a)   { return RenderEngine.prototype._pointsGeometry.apply(this, a); },
    setVizModeGPU(...a)     { return RenderEngine.prototype.setVizModeGPU.apply(this, a); },
    setParticleStyle(...a)  { return RenderEngine.prototype.setParticleStyle.apply(this, a); },
    setWireStyle(...a)      { return RenderEngine.prototype.setWireStyle.apply(this, a); },
    _syncWireFill(...a)     { return RenderEngine.prototype._syncWireFill.apply(this, a); },
    _wireOccluderMaterial(...a) { return RenderEngine.prototype._wireOccluderMaterial.apply(this, a); },
    gpuWireLines: null, _wireLinesGeo: null, _wireLinesMat: null, _wireEdgeCache: new WeakMap(),
    _syncWireLines(...a)     { return RenderEngine.prototype._syncWireLines.apply(this, a); },
    _wireLineIndex(...a)     { return RenderEngine.prototype._wireLineIndex.apply(this, a); },
    _wireLinesMaterial(...a) { return RenderEngine.prototype._wireLinesMaterial.apply(this, a); },
    applyShaderSource(...a) { return RenderEngine.prototype.applyShaderSource.apply(this, a); },
  };
}

/** True when the wire style's body is what the scene draws. */
const fillOnStage = r => !!r.gpuWireFill && r.gpuWireFill.parent === r.scene;

/** gpuMat carries exactly the ShaderMaterial defaults — the wire before styles. */
function assertPlainBlend(r, why) {
  assert.equal(r.gpuMat.transparent, false, `${why}: gpuMat left transparent`);
  assert.equal(r.gpuMat.blending, THREE.NormalBlending, `${why}: gpuMat left with a non-normal blend`);
  assert.equal(r.gpuMat.depthWrite, true, `${why}: gpuMat left without depth write`);
}

describe('setWireStyle — the settings move together', () => {
  let r;
  beforeEach(() => { r = makeRender(); r.setVizModeGPU('wireframe'); });

  test('classic is the wire as it shipped: nothing raised, nothing under it, no trail', () => {
    r.setWireStyle('classic');
    assert.equal(r.gpuMat.wireframe, true);
    assert.equal(r.U.uWireFx.value, 0, 'the fragment block must stay off');
    assert.equal(r.U.uWireGain.value, 1);
    assertPlainBlend(r, 'classic');
    assert.equal(fillOnStage(r), false, 'classic draws nothing under the lines');
    assert.deepEqual(r.afterglow, { on: false, amount: 0.87 });
  });

  test('neon: additive lines without depth write, at a gain below 1, and nothing else', () => {
    r.setWireStyle('neon');
    assert.equal(r.U.uWireFx.value, 1, 'gain only');
    assert.equal(r.U.uWireGain.value, RenderEngine.WIRE_STYLES.neon.gain);
    assert.equal(r.gpuMat.blending, THREE.AdditiveBlending);
    assert.equal(r.gpuMat.transparent, true);
    // A line that z-rejects the line behind it cannot add to it.
    assert.equal(r.gpuMat.depthWrite, false);
    assert.equal(fillOnStage(r), false);
    assert.equal(r.afterglow.on, false);
  });

  test('hidden: a depth-only body under the lines, pushed behind them, on the mesh\'s own geometry', () => {
    r.setWireStyle('hidden');
    assert.ok(fillOnStage(r), 'the occluder is not on stage');
    const f = r.gpuWireFill, m = f.material;
    assert.equal(f.geometry, r.gpuMesh.geometry, 'the occluder must draw the very triangles the wire outlines');
    assert.ok(f.renderOrder < 0, 'the occluder has to reach the depth buffer before the lines are tested');
    assert.equal(m.colorWrite, false, 'the occluder must not paint');
    assert.equal(m.depthWrite, true, 'the occluder IS its depth');
    assert.equal(m.polygonOffset, true);
    assert.ok(m.polygonOffsetFactor > 0 && m.polygonOffsetUnits > 0,
      'a positive offset pushes the body BEHIND its edges; zero or negative lets it eat them');
    assertPlainBlend(r, 'hidden');
    assert.equal(r.U.uWireFx.value, 0);
    assert.equal(r.afterglow.on, false);
  });

  test('the occluder keys to gpuMat\'s own program, so picking it compiles nothing', () => {
    r.setWireStyle('hidden');
    const m = r.gpuWireFill.material;
    // The program cache key is the source text plus a set of flags, "opaque"
    // among them (transparent false + normal blending). Same source, same
    // opacity, same side: the same key. colorWrite and polygonOffset are draw
    // state and do not enter it.
    assert.equal(m.vertexShader, r.gpuMat.vertexShader);
    assert.equal(m.fragmentShader, r.gpuMat.fragmentShader);
    assert.equal(m.transparent, r.gpuMat.transparent);
    assert.equal(m.blending, r.gpuMat.blending);
    assert.equal(m.side, THREE.DoubleSide);
    assert.equal(m.uniforms, r.U, 'its colour is never written, so the shared block as it is will do');
  });

  test('trails: the afterglow pass at the table\'s damp, and nothing else', () => {
    r.setWireStyle('trails');
    assert.equal(r.afterglow.on, true);
    assert.equal(r.afterglow.amount, RenderEngine.WIRE_STYLES.trails.trail);
    assert.equal(r.U.uWireFx.value, 0);
    assertPlainBlend(r, 'trails');
    assert.equal(fillOnStage(r), false);
  });

  test('depth fade and scan: a fragment effect at the plain wire\'s blending', () => {
    for (const [name, fx] of [['depth', 2], ['scan', 3]]) {
      r.setWireStyle(name);
      assert.equal(r.U.uWireFx.value, fx, `${name} raised the wrong branch`);
      assert.equal(r.U.uWireGain.value, 1, `${name} must not brighten the line`);
      assertPlainBlend(r, name);
      assert.equal(fillOnStage(r), false, `${name} draws nothing under the lines`);
      assert.equal(r.afterglow.on, false);
    }
  });

  test('hologram: additive lines over an additive body that is gpuMat itself, so nothing compiles', () => {
    r.setWireStyle('hologram');
    assert.equal(r.gpuMat.blending, THREE.AdditiveBlending);
    assert.equal(r.gpuMat.transparent, true);
    assert.equal(r.gpuMat.depthWrite, false, 'an additive body that writes depth hides the lines behind it');
    assert.equal(r.U.uWireGain.value, RenderEngine.WIRE_STYLES.hologram.gain);
    assert.ok(fillOnStage(r), 'the hologram body is not on stage');
    // The first version gave the body a material of its own; additive, it keyed
    // to a new program and the first pick froze the picture for 3.2 s while the
    // driver compiled it. Drawing gpuMat a second time cannot compile anything.
    assert.equal(r.gpuWireFill.material, r.gpuMat, 'the body has a material of its own — that is a program compile');
    assert.equal(r.gpuWireFill.geometry, r.gpuMesh.geometry);
  });

  test('hologram: the body\'s hooks make gpuMat a triangle body for one draw, and the wire again after it', () => {
    r.setWireStyle('hologram');
    const f = r.gpuWireFill;
    assert.equal(r.U.uWirePass.value, 0, 'between draws the shared block must say "line"');
    r.gpuMat.uniformsNeedUpdate = false;
    f.onBeforeRender();
    assert.equal(r.gpuMat.wireframe, false, 'the body drew as lines');
    assert.equal(r.U.uWirePass.value, 1, 'the body has to take the body branch');
    assert.equal(r.gpuMat.uniformsNeedUpdate, true,
      'three skips the upload between two draws of one material unless told');
    r.gpuMat.uniformsNeedUpdate = false;
    f.onAfterRender();
    assert.equal(r.gpuMat.wireframe, true, 'the lines after the body drew as triangles');
    assert.equal(r.U.uWirePass.value, 0, 'the lines after the body took the body branch');
    assert.equal(r.gpuMat.uniformsNeedUpdate, true, 'the 0 would not reach the lines drawn next');
  });

  test('the occluder carries no hooks, even after the hologram lent the mesh its own', () => {
    r.setWireStyle('hologram');
    r.setWireStyle('hidden');
    const f = r.gpuWireFill;
    // Object3D's own no-ops, not the hologram's flips: the occluder draws with
    // its own material, and flipping gpuMat around it would leave the lines
    // drawn as triangles on the frame something throws in between.
    assert.equal(Object.hasOwn(f, 'onBeforeRender'), false);
    assert.equal(Object.hasOwn(f, 'onAfterRender'), false);
    assert.notEqual(f.material, r.gpuMat);
  });

  test('an unknown style falls back to classic rather than blanking the look', () => {
    r.setWireStyle('neon');
    r.setWireStyle('laser-show-2000');      // a snapshot from a build with more styles
    assert.equal(r.currentWireStyle, 'classic');
    assert.equal(r.U.uWireFx.value, 0);
    assertPlainBlend(r, 'fallback');
  });

  test('no style leaves uWirePass raised between draws', () => {
    for (const name of Object.keys(RenderEngine.WIRE_STYLES)) {
      r.setWireStyle(name);
      assert.equal(r.U.uWirePass.value, 0, `${name} raised uWirePass in the shared block`);
    }
  });
});

describe('setWireStyle — nothing leaks out of WIRE', () => {
  test('outside WIRE the style is remembered, not applied', () => {
    const r = makeRender();                 // vizMode: 'surface'
    r.setWireStyle('hologram');
    assert.equal(r.currentWireStyle, 'hologram', 'the choice is kept');
    assert.equal(r.U.uWireFx.value, 0, 'but the fragment block stays off');
    assertPlainBlend(r, 'SURF');
    assert.equal(fillOnStage(r), false);
    assert.equal(r.afterglow, null, 'and the composer is left alone');
  });

  test('entering WIRE applies whatever was remembered', () => {
    const r = makeRender();
    r.setWireStyle('hologram');             // chosen while in SURF
    r.setVizModeGPU('wireframe');
    assert.equal(r.gpuMat.blending, THREE.AdditiveBlending);
    assert.ok(fillOnStage(r));
    assert.equal(r.U.uWireFx.value, 1);
  });

  test('leaving WIRE for SURF takes every part of every style off', () => {
    for (const name of Object.keys(RenderEngine.WIRE_STYLES)) {
      const r = makeRender();
      r.setVizModeGPU('wireframe');
      r.setWireStyle(name);
      r.setVizModeGPU('surface');
      assert.equal(r.gpuMat.wireframe, false);
      assert.equal(r.U.uWireFx.value, 0, `${name}: the fragment effect followed the user into SURF`);
      assert.equal(r.U.uWireGain.value, 1, `${name}: the gain followed the user into SURF`);
      assertPlainBlend(r, `${name} → SURF`);
      assert.equal(fillOnStage(r), false, `${name}: the body under the lines stayed in SURF`);
      assert.equal(r.afterglow.on, false, `${name}: a trail would smear the whole surface`);
      assert.equal(r.currentWireStyle, name, 'the choice survives');
    }
  });

  test('leaving WIRE for PTS: the points get their own style, not the wire\'s', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('trails');
    r.setWireStyle('hologram');
    r.setWireStyle('trails');
    r.setVizModeGPU('points');              // squares — no trail of its own
    assert.equal(r.afterglow.on, false, 'the wire\'s trail stayed armed over the point cloud');
    assert.equal(r.U.uWireFx.value, 0);
    assert.equal(fillOnStage(r), false);
    // And the points' trail is the points' business: smoke turns it back on.
    r.setParticleStyle('smoke');
    assert.equal(r.afterglow.on, true);
  });

  test('a mode round-trip brings the style back, body and all', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('hologram');
    const body = r.gpuWireFill.material;
    r.setVizModeGPU('surface');
    r.setVizModeGPU('wireframe');
    assert.ok(fillOnStage(r));
    assert.equal(r.gpuWireFill.material, body, 'the body was rebuilt instead of reused');
    assert.equal(r.gpuMat.blending, THREE.AdditiveBlending);
    assert.equal(r.U.uWireGain.value, RenderEngine.WIRE_STYLES.hologram.gain);
  });

  // FIX(review W-2): the pass was switched off only on the way into SURF, so a
  // trail crossed straight from one mode into the other without being cleared.
  test('a trail does not carry from PTS into WIRE, or back', () => {
    const r = makeRender();
    r.setWireStyle('trails');               // remembered for WIRE
    r.setVizModeGPU('points');
    r.setParticleStyle('smoke');
    assert.equal(r.afterglow.on, true, 'precondition: the smoke trail runs');
    r.afterglowCalls.length = 0;
    r.setVizModeGPU('wireframe');
    assert.deepEqual(r.afterglowCalls, [false, true],
      'the pass was never switched off between the modes, so it was never cleared — ' +
      'the point cloud\'s wake fades out over the wire');
    r.afterglowCalls.length = 0;
    r.setVizModeGPU('points');
    assert.deepEqual(r.afterglowCalls, [false, true], 'and the wire\'s trail over the points');
  });

  test('re-running WIRE does not blank a live trail and start it over', () => {
    // A preset re-applying the same mode, a clip step, a model leaving the
    // stage: each one re-runs setVizModeGPU with the mode already on screen.
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('trails');
    r.afterglowCalls.length = 0;
    r.setVizModeGPU('wireframe');
    assert.deepEqual(r.afterglowCalls, [true],
      'the trail was switched off on the way through — setAfterglow clears the buffer on a genuine off→on');
  });

  test('an imported model: remembered, nothing applied', () => {
    // The model draws triangles through this very uniform block; the guard is
    // setParticleStyle's, for the same reason.
    const r = makeRender({ model: true });
    r.setVizModeGPU('wireframe');
    r.setWireStyle('hologram');
    assert.equal(r.currentWireStyle, 'hologram');
    assert.equal(r.U.uWireFx.value, 0);
    assertPlainBlend(r, 'model');
    assert.equal(fillOnStage(r), false, 'a body was built under a model that hides the mesh it outlines');
  });
});

describe('the body under the lines', () => {
  test('one mesh for both kinds, and one occluder material, built once and reused', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('hidden');
    const mesh = r.gpuWireFill, occ = mesh.material;
    r.setWireStyle('classic');
    assert.equal(fillOnStage(r), false, 'classic left the occluder up');
    r.setWireStyle('hologram');
    r.setWireStyle('hidden');
    assert.equal(r.gpuWireFill, mesh, 'a second body mesh was built');
    assert.equal(r.gpuWireFill.material, occ, 'the occluder was rebuilt — a new material per click');
    assert.equal(r._wireOccluderMat, occ);
  });

  test('applyShaderSource reaches the occluder, on stage or not', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('hidden');
    r.setWireStyle('hologram');             // the occluder is now off stage, but kept
    const occ = r._wireOccluderMat, v0 = occ.version;
    r.applyShaderSource('/* vs */', '/* fs */');
    assert.equal(occ.vertexShader, '/* vs */', 'the occluder kept the old vertex program');
    assert.equal(occ.fragmentShader, '/* fs */', 'the occluder kept the old fragment program');
    assert.ok(occ.version > v0, 'needsUpdate was not raised');
    // The hologram body needs nothing of its own: it is gpuMat.
    assert.equal(r.gpuWireFill.material, r.gpuMat);
    assert.equal(r.gpuMat.vertexShader, '/* vs */');
    // And back to the built-ins — the editor's RESET.
    r.applyShaderSource();
    assert.equal(occ.vertexShader, VS);
    assert.equal(occ.fragmentShader, FS);
  });

  test('a body built after an editor APPLY starts from the live program', () => {
    const r = makeRender();
    r.applyShaderSource('/* vs */', '/* fs */');
    r.setVizModeGPU('wireframe');
    r.setWireStyle('hidden');
    assert.equal(r.gpuWireFill.material.vertexShader, '/* vs */');
  });

  test('it follows the shape, on stage or not', () => {
    // The host of tests/shape-orientation.test.js — what setShape and
    // _buildShapeGeo touch — plus a body to follow.
    const host = {
      CFG: { planeSize: 7, planeSegs: 16 }, isMobile: false,
      isShapeChanging: false, pendingShape: null, currentShape: 'plane',
      gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) },
      gpuPtsProxy: null, cb: {},
      gpuWireFill: new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1)),
      clearSolarSystem() {}, _buildSolarSystem() {},
      _buildStarGeo(...a)  { return RenderEngine.prototype._buildStarGeo.apply(this, a); },
      _buildShapeGeo(...a) { return RenderEngine.prototype._buildShapeGeo.apply(this, a); },
      setShape(...a)       { return RenderEngine.prototype.setShape.apply(this, a); },
    };
    host.setShape('sphere');
    assert.equal(host.gpuWireFill.geometry, host.gpuMesh.geometry,
      'the body still draws the old shape — whose buffers the next frame disposes');
  });
});

// ── The fragment block ────────────────────────────────────────────────────────
// Read as programs, the way tests/shader-light-block.test.js reads the lighting
// model: assembled FS and an assembled editor program, not the template's text.

/** The `if (uWirePass > 0) { … } else if (uWireFx == 1) { … } …` chain, braces matched. */
function wireBlock(program) {
  const at = program.indexOf('if (uWirePass > 0) {');
  if (at < 0) return null;
  let k = program.indexOf('{', at), d = 0, end = -1;
  // Walk the whole if / else-if chain: stop at the first top-level close that
  // is not followed by `else`.
  for (; k < program.length; k++) {
    if (program[k] === '{') d++;
    else if (program[k] === '}' && --d === 0) {
      const rest = program.slice(k + 1).trimStart();
      if (!rest.startsWith('else')) { end = k + 1; break; }
    }
  }
  return end > 0 ? program.slice(at, end) : null;
}
const editorFS = () => SE_FS_TEMPLATE('c = vec3(1.0);');

/** The two bodies' halves of the block's first branch: { holo, glass }. */
function bodyHalves(b) {
  const h = b.indexOf('if (uWirePass == 1) {');
  const e = b.indexOf('} else {', h);
  const end = b.indexOf('\n  } else if (', e);
  assert.ok(h > 0 && e > h && end > e, 'the body branch is not shaped the way this test reads it');
  return { holo: b.slice(h, e), glass: b.slice(e, end) };
}

/** Aurora's snippet — the `if (uWireFx == 7) { … }` that swings t — out of a program. */
function auroraSnippet(program) {
  const at = program.indexOf('if (uWireFx == 7) {');
  if (at < 0) return null;
  return program.slice(at, program.indexOf('\n  }', at) + 4);
}

describe('the wire block is SHARED by both fragment programs, not copied', () => {
  test('the built-in program and the editor scaffold carry it character for character', () => {
    const builtIn = wireBlock(FS), editor = wireBlock(editorFS());
    assert.ok(builtIn, 'the built-in fragment program has no wire block');
    assert.ok(editor, 'a custom fragment body loses the wire styles');
    assert.equal(editor, builtIn, 'the two wire blocks have drifted');
  });

  test('and it is a real block — the control for the equality above', () => {
    const b = wireBlock(FS);
    assert.ok(b.split('\n').length > 15, 'the wire block is suspiciously short');
    for (const term of ['uWireFx == 2', 'uWireFx == 3', 'uWireFx == 5', 'uWireFx == 6',
                        'uWirePass == 1', 'uWireGain', 'cameraPosition', 'uBandR', 'uTime', 'fwidth',
                        '_wEdgeOn()', '_wNoise(']) {
      assert.ok(b.includes(term), `the wire block no longer mentions ${term}`);
    }
  });

  test('its helpers are defined in both programs, once, before main', () => {
    for (const [name, prog] of [['FS', FS], ['editor FS', editorFS()]]) {
      for (const fn of ['float _wEdgeOn(', 'float _wHash(', 'float _wNoise(']) {
        const at = prog.indexOf(fn);
        assert.ok(at >= 0, `${name} does not define ${fn}…) — the block calls it, and an undefined function is a black canvas`);
        assert.equal(prog.indexOf(fn, at + 1), -1, `${name} defines ${fn}…) twice`);
        assert.ok(at < prog.indexOf('void main('), `${name} defines ${fn}…) after main`);
      }
    }
  });

  test('both programs declare every uniform it reads, with the type the engine writes', () => {
    for (const [name, prog] of [['FS', FS], ['editor FS', editorFS()]]) {
      for (const decl of [/uniform\s+int\s+uWireFx\s*;/, /uniform\s+int\s+uWirePass\s*;/,
                          /uniform\s+float\s+uWireGain\s*;/, /uniform\s+float\s+uBandR\s*;/]) {
        assert.match(prog, decl, `${name} does not declare ${decl} — an undeclared name is a link failure and a black canvas`);
      }
    }
    // uBandR is the vertex program's uniform too: one name, two stages, one type.
    assert.match(VS, /uniform\s+float[^;]*\buBandR\b/, 'VS no longer declares uBandR as a float');
  });

  test('it runs after the particle mask and before the finite guard', () => {
    // After the mask, because it multiplies the colour the mask leaves; before
    // the guard, because nothing non-finite may leave a fragment (see FIX(r6)).
    for (const [name, prog] of [['FS', FS], ['editor FS', editorFS()]]) {
      const mask = prog.indexOf('if (uPtStyle > 0)');
      const wire = prog.indexOf('if (uWirePass == 1)');
      const guard = prog.indexOf('!(color.r >= 0.0');
      assert.ok(mask > 0 && wire > mask && guard > wire, `${name}: the wire block is out of place`);
    }
  });

  test('depth fade and scan only ever dim — the nearest line and the ring\'s peak are the plain wire', () => {
    const b = wireBlock(FS);
    // wK *= mix(NEAR, FAR, smoothstep(...)) — the near end must be exactly 1.
    const d = b.match(/wK \*= mix\(([\d.]+), ([\d.]+), smoothstep/);
    assert.ok(d, 'the depth-fade line is not where this test reads it');
    assert.equal(Number(d[1]), 1, 'the nearest line is no longer the plain wire\'s colour');
    assert.ok(Number(d[2]) >= 0 && Number(d[2]) < 1, 'the far end does not fade');
    // wK *= BASE + PEAK * exp(...) — base + peak must not pass 1.
    const s = b.match(/wK \*= ([\d.]+) \+ ([\d.]+) \* exp\(/);
    assert.ok(s, 'the scan line is not where this test reads it');
    assert.ok(Number(s[1]) + Number(s[2]) <= 1 + 1e-9,
      `the scan ring peaks at ${Number(s[1]) + Number(s[2])}× the palette — the NIGHT contract is a ceiling`);
    assert.ok(Number(s[1]) > 0 && Number(s[1]) < 1, 'the lines between rings vanish or do not dim');
  });

  // FIX(review W-1): every factor went into the colour, and over TRANSPARENT BG
  // the hologram's body came out a near-black opaque shape hiding the camera
  // and faded lines dark opaque lines. three's additive blend is (SRC_ALPHA,
  // ONE) on colour and alpha alike; a plain wire draws with no blending.
  test('additive draws put their factor into the alpha, plain draws into colour and alpha alike', () => {
    const b = wireBlock(FS);
    // From a branch's head to the next one at the chain's own depth; the last
    // branch, which nests an else-if of its own, runs to the end of the block.
    const branch = (head, last = false) => {
      const at = b.indexOf(head);
      assert.ok(at >= 0, `the block has no branch "${head}"`);
      const next = last ? -1 : b.indexOf('\n  } else if (', at + head.length);
      return b.slice(at, next < 0 ? b.length : next);
    };
    const body = bodyHalves(b).holo;
    assert.match(body, /_pAlpha \*=/, 'the hologram body does not weight its alpha');
    assert.doesNotMatch(body, /color \*=/, 'the body dims its colour too — under (SRC_ALPHA, ONE) that is the factor squared');
    const glow = branch('else if (uWireFx == 1)');
    assert.match(glow, /_pAlpha \*= uWireGain;/);
    assert.doesNotMatch(glow, /color \*=/, 'the additive lines dim their colour — the light added is then gain²');
    const plain = branch('else if (uWireFx > 1 && uWireFx < 4)', true);
    assert.match(plain, /color\s+\*= wK;/, 'depth fade / scan no longer dim the line');
    assert.match(plain, /_pAlpha \*= wK;/,
      'depth fade / scan leave the alpha at 1 — over a transparent background a faded line is a dark opaque line');
  });
});

describe('the style table matches the dropdown it is driven by', () => {
  const optionValues = () => {
    const html = read('index.html');
    const at = html.indexOf('<select id="wire-style-sel">');
    assert.ok(at > 0, 'index.html has no #wire-style-sel');
    const body = html.slice(at, html.indexOf('</select>', at));
    return [...body.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  };

  test('every key is an option, in the table\'s order, and the first is selected', () => {
    assert.deepEqual(optionValues(), Object.keys(RenderEngine.WIRE_STYLES));
    const html = read('index.html');
    assert.match(html, /<select id="wire-style-sel">\s*<option value="classic" selected>/,
      'the row must open on Classic — the wire before styles, and the engine\'s own default');
  });

  test('every key has a description in controls.js, and nothing else does', () => {
    const src = read('src/ui/controls.js');
    const at = src.indexOf('const _wireDescriptions = {');
    assert.ok(at > 0, 'controls.js has no _wireDescriptions');
    const body = src.slice(at, src.indexOf('};', at));
    const keys = [...body.matchAll(/^\s*(\w+):\s*'/gm)].map(m => m[1]);
    assert.deepEqual(keys, Object.keys(RenderEngine.WIRE_STYLES));
  });

  test('exactly one style is the identity, and it is classic', () => {
    const plain = Object.entries(RenderEngine.WIRE_STYLES)
      .filter(([, s]) => s.fx === 0 && s.gain === 1 && !s.glow && s.fill === 'none' && !s.trail && s.lines === 'wire');
    assert.deepEqual(plain.map(([k]) => k), ['classic']);
  });

  test('every field names something the engine and the block implement', () => {
    for (const [k, s] of Object.entries(RenderEngine.WIRE_STYLES)) {
      assert.ok([0, 1, 2, 3, 4, 5, 6, 7].includes(s.fx), `${k}: fx ${s.fx} is no branch of the wire block`);
      assert.ok(['none', 'occlude', 'holo', 'glass'].includes(s.fill), `${k}: fill '${s.fill}' is no body _syncWireFill builds`);
      assert.ok(['wire', 'rows', 'grid', 'frag'].includes(s.lines), `${k}: lines '${s.lines}' is nothing setWireStyle draws`);
      // Lines drawn on the body ARE the fragment effect (contours, lattice):
      // one without the other is a body of triangles with nothing drawn on it,
      // or a fragment pattern run over a wire.
      assert.equal([4, 5].includes(s.fx), s.lines === 'frag', `${k}: fx 4 / 5 and lines drawn on the body go together`);
      // The hologram's body is gpuMat drawn as triangles between two wire
      // draws; its hooks flip the wireframe flag back on after it.
      if (s.fill === 'holo') assert.equal(s.lines, 'wire', `${k}: a hologram body needs the wire to flip back to`);
      assert.ok(s.trail === 0 || (s.trail > 0.5 && s.trail <= 0.98), `${k}: trail ${s.trail} is outside what setAfterglow keeps`);
      // The additive styles sum overlapping lines, so they start below the
      // plain wire; the others must not brighten it at all.
      if (s.glow) assert.ok(s.gain > 0 && s.gain < 1, `${k}: an additive style at gain ${s.gain}`);
      else assert.equal(s.gain, 1, `${k}: a non-additive style brightens the line`);
      // fx 1, 5 and 6 put their factor into the alpha, which only an additive
      // blend turns into light: on a plain wire they would draw the full colour
      // at partial alpha — a line BRIGHTER than its premultiplied self. And an
      // additive style with any other fx would add its lines at gain 1.
      assert.equal([1, 5, 6].includes(s.fx), s.glow, `${k}: fx 1 / 5 / 6 and additive blending go together`);
    }
  });
});

// ── Rows and grid: which edges a grid body keeps ─────────────────────────────
describe('gridEdgeIndex — the grid read off the vertex order', () => {
  /** Index differences of the pairs it returned. */
  const diffs = idx => { const d = new Set(); for (let i = 0; i < idx.length; i += 2) d.add(idx[i + 1] - idx[i]); return d; };

  test('a plate: rows are the edges one apart, grid adds the columns, no diagonal survives', () => {
    const g = new THREE.PlaneGeometry(1, 1, 4, 4);       // 5 × 5 vertices, S = 5
    const rows = gridEdgeIndex(g, 'rows'), grid = gridEdgeIndex(g, 'grid');
    assert.equal(rows.length / 2, 5 * 4, 'five rows of four edges');
    assert.equal(grid.length / 2, 2 * 5 * 4, 'and as many columns');
    assert.deepEqual([...diffs(rows)], [1]);
    assert.deepEqual([...diffs(grid)].sort((a, b) => a - b), [1, 5]);
  });

  test('three\'s sphere and cylinder are grids too, read the same way', () => {
    for (const g of [new THREE.SphereGeometry(1, 12, 8), new THREE.CylinderGeometry(1, 1, 2, 12, 6)]) {
      const grid = gridEdgeIndex(g, 'grid');
      assert.ok(grid && grid.length > 0, `${g.type} was not recognised as a grid`);
      assert.equal(diffs(grid).size, 2, `${g.type}: a diagonal or a stray edge got through`);
    }
  });

  test('rows are thinned to about ROWS_TARGET, every kept row whole', () => {
    const g = new THREE.PlaneGeometry(7, 7, 160, 160);   // the shipped plate: 161 rows
    const rows = gridEdgeIndex(g, 'rows');
    const kept = new Set();
    for (let i = 0; i < rows.length; i += 2) kept.add(Math.floor(rows[i] / 161));
    const step = Math.round(161 / ROWS_TARGET);
    assert.ok(step > 1, 'precondition: the plate has more rows than the target');
    assert.equal(kept.size, Math.ceil(161 / step));
    for (const r of kept) assert.equal(r % step, 0, `row ${r} is not on the thinning step`);
    assert.equal(rows.length / 2, kept.size * 160, 'a kept row lost edges');
    assert.ok(rows instanceof Uint16Array || rows instanceof Uint32Array);
  });

  test('a body that is not a grid is turned away rather than drawn as scraps', () => {
    // Not indexed at all — the polyhedra.
    assert.equal(gridEdgeIndex(new THREE.IcosahedronGeometry(1, 2), 'rows'), null);
    // Indexed, but its vertex order is no grid: the same icosahedron, merged.
    const merged = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
    assert.ok(merged.index, 'precondition: the merged body is indexed');
    assert.equal(gridEdgeIndex(merged, 'grid'), null);
  });

  test('an index past 65535 vertices comes back 32-bit', () => {
    const g = new THREE.PlaneGeometry(1, 1, 300, 300);   // 90 601 vertices
    assert.ok(gridEdgeIndex(g, 'grid') instanceof Uint32Array);
  });
});

describe('rows, grid and contour in the engine', () => {
  /** True when the rows / grid lines are what the scene draws. */
  const linesOnStage = r => !!r.gpuWireLines && r.gpuWireLines.parent === r.scene;

  test('rows: a line proxy over the mesh\'s own buffers replaces the wire, over a hidden-line body', () => {
    const r = makeRender({ geometry: new THREE.PlaneGeometry(1, 1, 8, 8) });
    r.setVizModeGPU('wireframe');
    r.setWireStyle('rows');
    assert.ok(linesOnStage(r), 'the rows are not on stage');
    const l = r.gpuWireLines;
    assert.ok(l.isLineSegments);
    assert.equal(l.geometry.attributes.position, r.gpuMesh.geometry.attributes.position,
      'the proxy copied the positions — the CPU formulas write the mesh\'s buffer, not a copy');
    assert.equal(r.gpuMesh.visible, false, 'the full wire still draws under the rows');
    assert.ok(fillOnStage(r), 'rows hide what is behind the body — the occluder is missing');
    // Keys to gpuMat's program: same source, side and opacity.
    const m = l.material;
    assert.equal(m.vertexShader, r.gpuMat.vertexShader);
    assert.equal(m.fragmentShader, r.gpuMat.fragmentShader);
    assert.equal(m.side, THREE.DoubleSide);
    assert.equal(m.transparent, false);
    assert.equal(m.uniforms, r.U);
  });

  test('grid: the lines without the body, and the index is walked once per body', () => {
    const r = makeRender({ geometry: new THREE.PlaneGeometry(1, 1, 8, 8) });
    r.setVizModeGPU('wireframe');
    r.setWireStyle('grid');
    assert.ok(linesOnStage(r));
    assert.equal(fillOnStage(r), false, 'grid draws nothing under its lines');
    const first = r.gpuWireLines.geometry.index;
    r.setWireStyle('classic');
    assert.equal(linesOnStage(r), false, 'classic left the grid up');
    assert.equal(r.gpuMesh.visible, true, 'classic did not give the wire back');
    r.setWireStyle('grid');
    assert.equal(r.gpuWireLines.geometry.index, first, 'the edges were walked again for the same body');
  });

  test('a body that is not a grid keeps the full wire under rows and grid', () => {
    const r = makeRender({ geometry: new THREE.IcosahedronGeometry(1, 2) });
    r.setVizModeGPU('wireframe');
    for (const name of ['rows', 'grid']) {
      r.setWireStyle(name);
      assert.equal(linesOnStage(r), false, `${name} drew scraps on a non-grid body`);
      assert.equal(r.gpuMesh.visible, true, `${name} left a non-grid body with no lines at all`);
      assert.equal(r.gpuMat.wireframe, true);
    }
  });

  test('contour: the body drawn as triangles, blended, over the occluder, with the contour branch raised', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('contour');
    assert.equal(r.gpuMat.wireframe, false, 'the contours are drawn on triangles, not on lines');
    assert.equal(r.U.uWireFx.value, 4);
    assert.equal(r.gpuMat.transparent, true, 'the antialiased rim needs blending');
    assert.equal(r.gpuMat.blending, THREE.NormalBlending);
    assert.equal(r.gpuMat.depthWrite, false, 'the occluder already holds the body\'s depth');
    assert.ok(fillOnStage(r), 'contours on a closed body would show its back without the occluder');
    assert.equal(linesOnStage(r), false);
  });

  test('leaving WIRE takes rows and contour off: the mesh back, its flags back', () => {
    for (const name of ['rows', 'grid', 'contour']) {
      const r = makeRender({ geometry: new THREE.PlaneGeometry(1, 1, 8, 8) });
      r.setVizModeGPU('wireframe');
      r.setWireStyle(name);
      r.setVizModeGPU('surface');
      assert.equal(linesOnStage(r), false, `${name}: the lines followed the user into SURF`);
      assert.equal(r.gpuMesh.visible, true, `${name}: SURF has no surface`);
      assert.equal(r.gpuMat.wireframe, false);
      assertPlainBlend(r, `${name} → SURF`);
      assert.equal(r.U.uWireFx.value, 0);
    }
  });

  test('the lines follow a shape change — a new index, the new body\'s buffers', () => {
    const r = makeRender();
    Object.assign(r, {
      CFG: { planeSize: 7, planeSegs: 16 }, isMobile: false,
      isShapeChanging: false, pendingShape: null, currentShape: 'plane', cb: {},
      clearSolarSystem() {}, _buildSolarSystem() {},
      _buildStarGeo(...a)  { return RenderEngine.prototype._buildStarGeo.apply(this, a); },
      _buildShapeGeo(...a) { return RenderEngine.prototype._buildShapeGeo.apply(this, a); },
      setShape(...a)       { return RenderEngine.prototype.setShape.apply(this, a); },
    });
    r.setVizModeGPU('wireframe');
    r.setWireStyle('rows');
    r.setShape('sphere');
    assert.ok(linesOnStage(r), 'the rows left the stage on a shape change');
    assert.equal(r.gpuWireLines.geometry.attributes.position, r.gpuMesh.geometry.attributes.position,
      'the rows still draw the old body — whose buffers the next frame disposes');
    // And to a body that is no grid: the rows give the wire back.
    r.isShapeChanging = false;
    r.setShape('icosahedron');
    assert.equal(linesOnStage(r), false);
    assert.equal(r.gpuMesh.visible, true);
  });

  test('applyShaderSource reaches the lines, on stage or not', () => {
    const r = makeRender({ geometry: new THREE.PlaneGeometry(1, 1, 8, 8) });
    r.setVizModeGPU('wireframe');
    r.setWireStyle('rows');
    r.setWireStyle('classic');
    const m = r._wireLinesMat, v0 = m.version;
    r.applyShaderSource('/* vs */', '/* fs */');
    assert.equal(m.vertexShader, '/* vs */');
    assert.equal(m.fragmentShader, '/* fs */');
    assert.ok(m.version > v0);
  });
});

// ── NIGHT dims the additive styles (owner's call, 22.11.2026) ───────────────
describe('NIGHT and the additive wire styles', () => {
  test('wireGainFor scales the additive styles under NIGHT and nothing else', () => {
    for (const s of Object.values(RenderEngine.WIRE_STYLES)) {
      assert.equal(wireGainFor(s, false), s.gain);
      assert.equal(wireGainFor(s, true), s.glow ? s.gain * NIGHT_WIRE_GLOW : s.gain);
    }
    assert.ok(NIGHT_WIRE_GLOW > 0 && NIGHT_WIRE_GLOW < 1, 'NIGHT has to DIM them');
  });

  test('switching NIGHT in WIRE retunes a live additive style both ways', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('neon');
    r.setNightly(true);
    assert.equal(r.U.uWireGain.value, RenderEngine.WIRE_STYLES.neon.gain * NIGHT_WIRE_GLOW);
    r.setNightly(false);
    assert.equal(r.U.uWireGain.value, RenderEngine.WIRE_STYLES.neon.gain);
  });

  test('a style picked under NIGHT starts dimmed, and NIGHT outside WIRE leaves the gain at rest', () => {
    const r = makeRender();
    r.setNightly(true);                     // in SURF
    assert.equal(r.U.uWireGain.value, 1, 'NIGHT raised a wire gain while no wire was drawn');
    r.setVizModeGPU('wireframe');
    r.setWireStyle('hologram');
    assert.equal(r.U.uWireGain.value, RenderEngine.WIRE_STYLES.hologram.gain * NIGHT_WIRE_GLOW);
    r.setWireStyle('depth');
    assert.equal(r.U.uWireGain.value, 1, 'a dimming style was dimmed again');
  });

  test('the hologram body answers the gain too, so NIGHT dims body and lines together', () => {
    const b = wireBlock(FS);
    const body = b.slice(b.indexOf('if (uWirePass == 1)'), b.indexOf('} else if (uWireFx == 1)'));
    assert.match(body, /_pAlpha \*= \([^;]*\) \* uWireGain;/, 'the body ignores uWireGain');
  });
});

// ── The second batch (owner, 23.11.2026: "more, and more of a wow") ──────────
describe('lattice, electric, aurora, light painting and glass', () => {
  const linesOnStage = r => !!r.gpuWireLines && r.gpuWireLines.parent === r.scene;
  /** One branch of the wire block, head to the next branch at the chain's depth. */
  const branchOf = head => {
    const b = wireBlock(FS);
    const at = b.indexOf(head);
    assert.ok(at >= 0, `the block has no branch "${head}"`);
    const next = b.indexOf('\n  } else if (', at + head.length);
    return b.slice(at, next < 0 ? b.length : next);
  };

  test('lattice: drawn on the body, additively, seen through, with its own branch', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('lattice');
    assert.equal(r.U.uWireFx.value, 5);
    assert.equal(r.gpuMat.wireframe, false, 'the lattice is drawn on triangles');
    assert.equal(r.gpuMat.blending, THREE.AdditiveBlending);
    assert.equal(r.gpuMat.transparent, true);
    assert.equal(r.gpuMat.depthWrite, false);
    assert.equal(fillOnStage(r), false, 'the lattice is meant to be seen through the body');
    assert.equal(linesOnStage(r), false);
  });

  test('electric and light painting: additive wire, the second with a long trail', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('electric');
    assert.equal(r.U.uWireFx.value, 6);
    assert.equal(r.gpuMat.blending, THREE.AdditiveBlending);
    assert.equal(r.gpuMat.wireframe, true);
    assert.equal(r.afterglow.on, false);
    r.setWireStyle('paint');
    assert.equal(r.U.uWireFx.value, 1);
    assert.equal(r.gpuMat.blending, THREE.AdditiveBlending);
    assert.equal(r.afterglow.on, true, 'light painting without its trail is neon');
    assert.equal(r.afterglow.amount, RenderEngine.WIRE_STYLES.paint.trail);
    assert.ok(RenderEngine.WIRE_STYLES.paint.trail > RenderEngine.WIRE_STYLES.trails.trail,
      'the painting trail should outlast the plain one');
  });

  test('aurora: the plain wire with its own branch, at gain 1', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('aurora');
    assert.equal(r.U.uWireFx.value, 7);
    assert.equal(r.U.uWireGain.value, 1);
    assertPlainBlend(r, 'aurora');
    assert.equal(r.gpuMat.wireframe, true);
  });

  test('glass: the occluder paints for its one draw, with the body branch, and goes back to depth-only', () => {
    const r = makeRender();
    r.setVizModeGPU('wireframe');
    r.setWireStyle('glass');
    assert.ok(fillOnStage(r), 'the glass body is not on stage');
    const f = r.gpuWireFill, occ = r._wireOccluderMat;
    assert.equal(f.material, occ, 'glass builds a material of its own — the occluder already keys to gpuMat\'s program');
    assert.equal(occ.colorWrite, false, 'between draws the occluder must stay depth-only');
    assert.equal(r.gpuMat.blending, THREE.AdditiveBlending, 'the lines over the glass glow');
    occ.uniformsNeedUpdate = false;
    f.onBeforeRender();
    assert.equal(occ.colorWrite, true, 'the glass body drew nothing');
    assert.equal(r.U.uWirePass.value, 2, 'the glass body took the wrong branch');
    assert.equal(occ.uniformsNeedUpdate, true);
    f.onAfterRender();
    assert.equal(occ.colorWrite, false, 'the occluder kept painting after the glass draw');
    assert.equal(r.U.uWirePass.value, 0);
    // And the hidden-line style that shares the material sees none of it.
    r.setWireStyle('hidden');
    assert.equal(Object.hasOwn(r.gpuWireFill, 'onBeforeRender'), false, 'hidden kept the glass hooks');
    assert.equal(occ.colorWrite, false);
  });

  test('NIGHT dims the three new additive styles and leaves aurora alone', () => {
    const r = makeRender();
    r.setNightly(true);
    r.setVizModeGPU('wireframe');
    for (const name of ['lattice', 'electric', 'paint', 'glass']) {
      r.setWireStyle(name);
      assert.equal(r.U.uWireGain.value, RenderEngine.WIRE_STYLES[name].gain * NIGHT_WIRE_GLOW, `${name} is not dimmed`);
    }
    r.setWireStyle('aurora');
    assert.equal(r.U.uWireGain.value, 1);
  });

  test('the additive branches put their factor into the alpha only', () => {
    for (const head of ['else if (uWireFx == 5)', 'else if (uWireFx == 6)']) {
      const b = branchOf(head);
      assert.match(b, /_pAlpha \*= [^;]*uWireGain[^;]*;/, `${head} does not weight its alpha by the gain`);
      assert.doesNotMatch(b, /color \*=/, `${head} dims its colour too — under (SRC_ALPHA, ONE) that squares it`);
    }
  });

  test('aurora swings t inside the palette window, in both programs, before the palette is read', () => {
    for (const [name, prog] of [['FS', FS], ['editor FS', editorFS()]]) {
      const a = auroraSnippet(prog);
      assert.ok(a, `${name} has no aurora snippet`);
      assert.match(a, /t = clamp\(t \+ [\d.]+ \* sin\([^;]*\), \.03, \.97\);/,
        `${name}: the swung ramp parameter left the [.03, .97] window every palette is written in`);
      const at = prog.indexOf(a);
      const read = name === 'FS' ? prog.indexOf('getColor(uCM,    t)') : prog.indexOf('vec3 c=vec3(0.0);');
      assert.ok(read > at, `${name}: the palette is read before aurora has moved t`);
    }
    assert.equal(auroraSnippet(FS), auroraSnippet(editorFS()), 'the two aurora snippets have drifted');
  });

  // The measured lesson (23.11.2026): two more getColor calls in the block — a
  // 54-palette ladder the Windows toolchain inlines per call — doubled the time
  // eight editor programs took to compile (23.4 s → 47.0 s). Not a pixel's
  // worth of difference, so it has to be pinned where a reviewer cannot miss it.
  test('the wire block reads no palette of its own', () => {
    assert.doesNotMatch(wireBlock(FS), /getColor\s*\(/,
      'a getColor call in the wire block compiles another copy of the 54-palette ladder into every program');
    assert.doesNotMatch(auroraSnippet(FS), /getColor\s*\(/);
  });

  test('the glass body is never brighter than the palette and leaves the alpha alone', () => {
    const g = bodyHalves(wireBlock(FS)).glass;
    const m = g.match(/color \*= ([\d.]+) \+ ([\d.]+) \* hFres;/);
    assert.ok(m, 'the glass line is not where this test reads it');
    assert.ok(Number(m[1]) + Number(m[2]) <= 1, 'the glass body outshines the palette');
    assert.doesNotMatch(g, /_pAlpha/, 'the glass body is a solid: its alpha has to stay 1');
  });

  test('the moving styles move with the clock and nothing else', () => {
    // The photosensitivity rule this app keeps everywhere: nothing here may be
    // driven by an onset or a band level. Each reads uTime and none of the audio.
    for (const head of ['else if (uWireFx == 5)', 'else if (uWireFx == 6)']) {
      const b = branchOf(head);
      assert.match(b, /uTime/, `${head} does not move`);
      assert.doesNotMatch(b, /\b(uBass|uTreble|uMid|uBeat|uBands)\b/, `${head} reads the audio`);
    }
    const a = auroraSnippet(FS);
    assert.match(a, /uTime/);
    assert.doesNotMatch(a, /\b(uBass|uTreble|uMid|uBeat|uBands)\b/, 'aurora reads the audio');
  });
});
