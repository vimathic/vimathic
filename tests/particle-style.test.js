// tests/particle-style.test.js
//
// Contract tests for the PTS particle styles (RenderEngine.setParticleStyle).
//
// Run:
//   node --test tests/particle-style.test.js
//
// ── What is worth pinning here ────────────────────────────────────────────────
// A style is four settings that only work together — sprite size, the fragment
// mask, blending, and the afterglow behind it. Any one of them applied without
// the others gives a look nobody asked for: a mask with no transparency is a
// square again, additive blending with depth writes z-rejects its own cloud,
// and an afterglow left armed on the way out of PTS smears the surface the user
// switched to. So the tests are about what moves together, and what must not
// leak out of POINTS mode.
//
// The gate on uPtStyle matters beyond looks: gl_PointCoord is undefined for
// triangle primitives, so the mask must be provably off whenever anything but
// the points proxy is drawing.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// Same harness idea as tests/shader-source-owner.test.js: a fake carrying the
// handful of fields these methods touch, with the REAL prototype methods bound
// to it. three.js is imported for the material and blending constants, which
// are the actual subject of half the assertions.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// render.js reaches for requestAnimationFrame in setShape's dispose path; not
// on any path here, but the import must not explode either way.
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (() => 0);

let RenderEngine, VS, FS, THREE;
before(async () => {
  ({ RenderEngine } = await import('../src/render.js'));
  ({ VS, FS }       = await import('../src/shaders.js'));
  THREE = await import('three');
});

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
  return {
    U, gpuMat, gpuMesh, scene,
    gpuPtsProxy: null,
    activeVS: VS, activeFS: FS,
    vizMode: 'surface',
    currentParticleStyle: 'squares',
    // The composer is out of scope here; record what the style asked of it.
    afterglow: null,
    setAfterglow(on, amount) { this.afterglow = { on, amount }; },
    setVizModeGPU(...a)    { return RenderEngine.prototype.setVizModeGPU.apply(this, a); },
    setParticleStyle(...a) { return RenderEngine.prototype.setParticleStyle.apply(this, a); },
  };
}

describe('setParticleStyle — the four settings move together', () => {
  let r;
  beforeEach(() => { r = makeRender(); r.setVizModeGPU('points'); });

  test('squares is the untouched original: no mask, no transparency, no trail', () => {
    r.setParticleStyle('squares');
    assert.equal(r.U.uPtStyle.value, 0, 'the FS mask must stay off');
    assert.equal(r.U.uPointSize.value, RenderEngine.PARTICLE_STYLES.squares.size);
    assert.equal(r.gpuPtsProxy.material.transparent, false);
    assert.equal(r.gpuPtsProxy.material.blending, THREE.NormalBlending);
    assert.equal(r.gpuPtsProxy.material.depthWrite, true);
    assert.deepEqual(r.afterglow, { on: false, amount: 0.87 });
  });

  test('dots: round mask, smaller, and transparent so the rim can be soft', () => {
    r.setParticleStyle('dots');
    assert.equal(r.U.uPtStyle.value, 1);
    assert.ok(r.U.uPointSize.value < RenderEngine.PARTICLE_STYLES.squares.size,
      'the point of this style is that the particles are small');
    // A masked sprite has partial alpha at its rim; opaque would square it off.
    assert.equal(r.gpuPtsProxy.material.transparent, true);
    assert.equal(r.gpuPtsProxy.material.blending, THREE.NormalBlending);
    assert.equal(r.gpuPtsProxy.material.depthWrite, true);
    assert.equal(r.afterglow.on, false, 'only the smoke style trails');
  });

  test('smoke: soft mask, additive, no depth write, and a trail behind it', () => {
    r.setParticleStyle('smoke');
    assert.equal(r.U.uPtStyle.value, 2);
    assert.equal(r.gpuPtsProxy.material.transparent, true);
    assert.equal(r.gpuPtsProxy.material.blending, THREE.AdditiveBlending);
    // Additive has to accumulate; depth writes would make the cloud reject
    // its own fragments and the glow would come out patchy.
    assert.equal(r.gpuPtsProxy.material.depthWrite, false);
    assert.equal(r.afterglow.on, true);
    assert.equal(r.afterglow.amount, RenderEngine.PARTICLE_STYLES.smoke.trail);
  });

  test('an unknown style falls back to squares rather than blanking the look', () => {
    // A snapshot from a build with more styles, or a hand-edited preset.
    r.setParticleStyle('glitter-explosion');
    assert.equal(r.currentParticleStyle, 'squares');
    assert.equal(r.U.uPtStyle.value, 0);
    assert.equal(r.U.uPointSize.value, RenderEngine.PARTICLE_STYLES.squares.size);
  });
});

describe('setParticleStyle — nothing leaks out of POINTS mode', () => {
  test('outside PTS the style is remembered, not applied', () => {
    // gl_PointCoord is undefined for triangles: the mask must not be armed
    // while the mesh is what draws.
    const r = makeRender();               // vizMode: 'surface'
    r.setParticleStyle('smoke');
    assert.equal(r.currentParticleStyle, 'smoke', 'the choice is kept');
    assert.equal(r.U.uPtStyle.value, 0,   'but the mask stays off');
    assert.equal(r.afterglow, null,       'and the composer is left alone');
  });

  test('entering PTS applies whatever was remembered', () => {
    const r = makeRender();
    r.setParticleStyle('smoke');          // chosen while in SURF
    r.setVizModeGPU('points');
    assert.equal(r.U.uPtStyle.value, 2);
    assert.equal(r.gpuPtsProxy.material.blending, THREE.AdditiveBlending);
    assert.equal(r.afterglow.on, true);
  });

  test('leaving PTS clears the mask and disarms the trail', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    r.setParticleStyle('smoke');
    assert.equal(r.U.uPtStyle.value, 2);

    r.setVizModeGPU('surface');
    assert.equal(r.U.uPtStyle.value, 0, 'the mask must not run over triangles');
    assert.equal(r.afterglow.on, false, 'a trail would smear the whole surface');
    assert.equal(r.currentParticleStyle, 'smoke', 'the choice still survives');
  });

  test('a mode round-trip brings the style back', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    r.setParticleStyle('dots');
    r.setVizModeGPU('wireframe');
    r.setVizModeGPU('points');
    assert.equal(r.U.uPtStyle.value, 1);
    assert.equal(r.U.uPointSize.value, RenderEngine.PARTICLE_STYLES.dots.size);
    assert.equal(r.gpuPtsProxy.material.transparent, true);
  });
});

describe('the style table matches the dropdown it is driven by', () => {
  test('every style names a distinct mask the fragment shader implements', () => {
    // _POINT_MASK in shaders.js branches on 0 / 1 / 2 — a style carrying any
    // other number would silently render as a square.
    const masks = Object.values(RenderEngine.PARTICLE_STYLES).map(s => s.mask);
    assert.deepEqual(masks.sort(), [0, 1, 2]);
  });

  test('exactly one style is the no-cost default', () => {
    const plain = Object.entries(RenderEngine.PARTICLE_STYLES)
      .filter(([, s]) => s.mask === 0 && !s.glow && !s.trail);
    assert.deepEqual(plain.map(([k]) => k), ['squares']);
  });
});
