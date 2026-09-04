// The POINTS proxy draws each vertex once.
//
// Run: node --test tests/points-proxy-geometry.test.js
//
// What went wrong. THREE.Points honours a geometry's index, and an index built
// for triangles names every vertex once per triangle around it. The proxy
// borrowed the mesh's geometry whole, so the cloud submitted ~5.7 points per
// vertex — all at the same pixel, each one running the 47 KB vertex program.
// Measured in the browser on the shipped boot shape: drawElements(POINTS,
// 38 880) for 6 883 vertices.
//
// Nothing on screen said so, because duplicates at one pixel are invisible
// under ordinary blending. The cost is invisible here too: on desktop GL a
// point is a primitive and the waste is absorbed. Through ANGLE's D3D11
// backend it is not — Direct3D has no point primitive, so every point is
// expanded by a geometry shader — which is why PTS was slow on Windows and
// fine on Linux, and why this file measures a COUNT rather than a duration.
// A timing test would pass on the machine that has no problem.
//
// The one thing duplicates did change is the additive style: `smoke` summed
// them, and that sum was its brightness. uPtGain replaces it — see the
// PTS_GLOW_GAIN block for why a constant, and not the per-shape ratio.
//
// CONTROL for every count here: run this file against the commit before the
// fix (`git archive HEAD | tar -x -C /tmp/...`, node_modules symlinked) and the
// ratio assertions must fail with 1.0 — the proxy and the mesh were the same
// object then, so "unique vertices" and "submitted vertices" could not differ.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (fn => { fn(); return 0; });

let RenderEngine, MathVisualizer, VS, FS, THREE;
before(async () => {
  ({ RenderEngine }   = await import('../src/render.js'));
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
  ({ VS, FS }         = await import('../src/shaders.js'));
  THREE = await import('three');
});

// A stand carrying only what setVizModeGPU / setParticleStyle / _pointsGeometry
// touch. The geometry is a real indexed grid, because the index is the subject.
function makeRender(segs = 8) {
  const U = {
    uPointSize: { value: 1 }, uLighting: { value: 1 }, uPtStyle: { value: 0 },
    uPtBand: { value: 0 }, uPtGain: { value: 1 },
  };
  const gpuMat  = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U });
  const gpuMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, segs, segs), gpuMat);
  const scene   = new THREE.Scene();
  scene.add(gpuMesh);
  return {
    U, gpuMat, gpuMesh, scene,
    gpuPtsProxy: null,
    _ptsGeo: null,
    modelMeshes: [],
    activeVS: VS, activeFS: FS,
    vizMode: 'surface',
    currentParticleStyle: 'squares',
    afterglow: null,
    setAfterglow(on, amount) { this.afterglow = { on, amount }; },
    _pointsGeometry(...a) { return RenderEngine.prototype._pointsGeometry.apply(this, a); },
    setVizModeGPU(...a)   { return RenderEngine.prototype.setVizModeGPU.apply(this, a); },
    setParticleStyle(...a){ return RenderEngine.prototype.setParticleStyle.apply(this, a); },
  };
}

describe('the points proxy submits each vertex once', () => {
  test('the mesh is indexed and the proxy is not', () => {
    const r = makeRender();
    // Precondition, not decoration: with an unindexed mesh there is nothing to
    // fix and every assertion below would pass vacuously.
    assert.ok(r.gpuMesh.geometry.index, 'precondition: the mesh carries an index');
    r.setVizModeGPU('points');
    assert.equal(r.gpuPtsProxy.geometry.index, null,
      'an index is a triangle\'s answer; a point cloud that honours one draws duplicates');
  });

  test('the saving is real and this file can see it', () => {
    const r = makeRender(8);
    // What WebGL is handed, which is the number that costs: an indexed draw
    // submits index.count vertices however many distinct ones exist. Counting
    // position.count instead would report the same figure before and after the
    // fix — the first draft of this test did, and passed against both.
    const submitted = g => (g.index ? g.index.count : g.attributes.position.count);

    const verts = r.gpuMesh.geometry.attributes.position.count;
    r.setVizModeGPU('points');

    assert.equal(submitted(r.gpuPtsProxy.geometry), verts,
      'the cloud submits the vertices, not the index');
    // CONTROL over the measurement itself: if the grid were degenerate the
    // ratio would be ~1 and "we saved 5.7×" would be an artefact of the stand.
    const ratio = submitted(r.gpuMesh.geometry) / verts;
    assert.ok(ratio > 3,
      `the stand must actually have duplicates to remove (ratio ${ratio.toFixed(2)})`);
  });

  test('the buffers are shared, not copied', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    const src = r.gpuMesh.geometry.attributes;
    const dst = r.gpuPtsProxy.geometry.attributes;
    assert.deepEqual(Object.keys(dst).sort(), Object.keys(src).sort(),
      'every attribute the mesh has, the cloud reads');
    for (const name of Object.keys(src)) {
      assert.equal(dst[name], src[name],
        `${name} must be the very same BufferAttribute — a copy would double the ` +
        'upload and give MathVisualizer a second array to keep in sync');
    }
  });

  test('one geometry for the lifetime, not one per entry into PTS', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    const first = r.gpuPtsProxy.geometry;
    r.setVizModeGPU('surface');
    r.setVizModeGPU('points');
    assert.equal(r.gpuPtsProxy.geometry, first,
      'it holds borrowed buffers, so it can never be disposed; a fresh one per ' +
      'entry would leak an entry in three\'s geometry bookkeeping on every click');
    // Without this the assertion above is satisfied by the old arrangement too,
    // where "the same instance" meant "the mesh's own geometry, index and all".
    assert.notEqual(r.gpuPtsProxy.geometry, r.gpuMesh.geometry,
      'same instance across entries, and its own instance — not the mesh\'s');
  });

  test('a shape swap re-points it at the new buffers', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    const proxyGeo = r.gpuPtsProxy.geometry;

    // What setShape does to the two, in its order.
    const newGeo = new THREE.PlaneGeometry(2, 2, 4, 4);
    r.gpuMesh.geometry = newGeo;
    r.gpuPtsProxy.geometry = r._pointsGeometry(newGeo);

    assert.equal(r.gpuPtsProxy.geometry, proxyGeo, 'same instance, moved');
    assert.equal(r.gpuPtsProxy.geometry.index, null, 'still no index after the swap');
    assert.equal(r.gpuPtsProxy.geometry.attributes.position, newGeo.attributes.position,
      'a stale buffer here would draw the previous body');
  });

  test('an attribute the new shape does not carry is dropped, not kept stale', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    // aBandU is optional across the catalogue — the case this guards.
    const withExtra = new THREE.PlaneGeometry(1, 1, 2, 2);
    withExtra.setAttribute('aBandU',
      new THREE.BufferAttribute(new Float32Array(withExtra.attributes.position.count), 1));
    r.gpuPtsProxy.geometry = r._pointsGeometry(withExtra);
    assert.ok(r.gpuPtsProxy.geometry.attributes.aBandU, 'precondition: it was taken');

    const without = new THREE.PlaneGeometry(1, 1, 2, 2);
    r.gpuPtsProxy.geometry = r._pointsGeometry(without);
    assert.equal(r.gpuPtsProxy.geometry.attributes.aBandU, undefined,
      'a leftover attribute would be read against the new positions');
  });
});

describe('per-vertex work is still done once', () => {
  // The guard FIX(#52) put in. It used to ask "is the proxy geometry a
  // different OBJECT", which the fix makes true for the shipped app — and that
  // would switch every "and now the same for the proxy" branch back on, walking
  // the same arrays twice per tick. It has to ask about the ARRAYS.
  const own = (render) => MathVisualizer.prototype._ownPtsGeometry.call({ render });

  test('shared buffers read as borrowed, so nothing is recomputed', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    assert.notEqual(r.gpuPtsProxy.geometry, r.gpuMesh.geometry,
      'precondition: the geometries ARE different objects now');
    assert.equal(own(r), null,
      'different object, same buffers — the work has already landed in them');
  });

  test('CONTROL — genuinely separate buffers are still served', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    // A proxy that one day owns its own arrays is the branch those call sites
    // exist for; without this the test above would pass on a helper that always
    // returned null.
    r.gpuPtsProxy.geometry = new THREE.PlaneGeometry(1, 1, 2, 2);
    assert.equal(own(r), r.gpuPtsProxy.geometry,
      'distinct arrays must be reported, or their vertices would never be written');
  });

  test('no proxy at all is not "own geometry"', () => {
    const r = makeRender();
    assert.equal(own(r), null);
  });
});

describe('the additive style keeps its brightness', () => {
  test('smoke asks for the gain, the blended styles do not', () => {
    const r = makeRender();
    r.setVizModeGPU('points');

    r.setParticleStyle('squares');
    assert.equal(r.U.uPtGain.value, 1, 'ordinary blending never saw the duplicates');
    r.setParticleStyle('dots');
    assert.equal(r.U.uPtGain.value, 1);
    r.setParticleStyle('smoke');
    assert.equal(r.U.uPtGain.value, RenderEngine.PTS_GLOW_GAIN_EFFECTIVE,
      'additive blending summed them, and that sum is what the style is drawn from');
  });

  test('the gain is the measured ratio, not a number someone liked', () => {
    // Measured over all 32 catalogue shapes: 26 indexed run 4.92…6.00, six carry
    // no index. Pinned as a band rather than a literal so a re-measure can move
    // it, and pinned at all so it cannot drift to an arbitrary value.
    assert.ok(RenderEngine.PTS_GLOW_GAIN > 4.9 && RenderEngine.PTS_GLOW_GAIN < 6.1,
      `PTS_GLOW_GAIN=${RenderEngine.PTS_GLOW_GAIN} is outside the catalogue's ratio range`);
  });

  test('the measurement and the level it is drawn at stay separate numbers', () => {
    // The gain answers "what were the duplicates worth"; the dim answers "how
    // much of that do we keep". Folding them into one literal would lose which
    // half a future edit is changing.
    assert.ok(Math.abs(RenderEngine.PTS_SMOKE_DIM - 1 / 3) < 1e-12,
      `PTS_SMOKE_DIM=${RenderEngine.PTS_SMOKE_DIM}, expected a third`);
    assert.ok(Math.abs(RenderEngine.PTS_GLOW_GAIN_EFFECTIVE
                       - RenderEngine.PTS_GLOW_GAIN / 3) < 1e-12,
      'the effective gain is the measured one at a third');
  });

  test('the wake dims with the particles and keeps its length', () => {
    // Additive blending is linear in coverage and the AfterimagePass accumulates
    // the frames the particles are drawn into, so one factor dims both. The trail
    // damp is what sets LENGTH, and dimming must not have touched it.
    const r = makeRender();
    r.setVizModeGPU('points');
    r.setParticleStyle('smoke');
    assert.equal(RenderEngine.PARTICLE_STYLES.smoke.trail, 0.93,
      'the wake is dimmer, not shorter');
    assert.equal(r.U.uPtGain.value, RenderEngine.PTS_GLOW_GAIN_EFFECTIVE);
  });

  test('it does not leak out of PTS', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    r.setParticleStyle('smoke');
    assert.equal(r.U.uPtGain.value, RenderEngine.PTS_GLOW_GAIN_EFFECTIVE, 'precondition');
    r.setVizModeGPU('surface');
    assert.equal(r.U.uPtGain.value, 1,
      'a gain left standing would multiply a surface that never asked for one');
  });

  test('a round trip brings it back', () => {
    const r = makeRender();
    r.setVizModeGPU('points');
    r.setParticleStyle('smoke');
    r.setVizModeGPU('wireframe');
    r.setVizModeGPU('points');
    assert.equal(r.U.uPtGain.value, RenderEngine.PTS_GLOW_GAIN_EFFECTIVE,
      'the style is remembered, so its gain has to come back with it');
  });

  test('an imported model owns the stage and gets no gain', () => {
    const r = makeRender();
    r.modelMeshes = [{ material: {} }];
    r.setVizModeGPU('points');
    r.setParticleStyle('smoke');
    assert.equal(r.U.uPtGain.value, 1,
      'a model draws triangles through this uniform block — same rule as uPtStyle');
  });
});

describe('the shader carries the gain', () => {
  const src = readFileSync(new URL('../src/shaders.js', import.meta.url), 'utf8');

  test('declared once, in the block both templates include', () => {
    const decls = src.match(/uniform float uPtGain;/g) || [];
    assert.equal(decls.length, 1,
      'a second declaration means the built-in and the editor template can drift');
    assert.ok(/const _POINT_UNIFORMS = `[\s\S]*?uniform float uPtGain;/.test(src),
      'it belongs to _POINT_UNIFORMS, which SE_FS_TEMPLATE shares');
  });

  test('applied inside the mask, where the style gate already is', () => {
    assert.ok(/_pAlpha \*= uPtGain;/.test(src), 'the gain has to reach _pAlpha');
    const mask = src.match(/const _POINT_MASK = `([\s\S]*?)`;/)[1];
    assert.ok(/if \(uPtStyle > 0\)[\s\S]*_pAlpha \*= uPtGain;/.test(mask),
      'outside the gate it would run for triangles, where gl_PointCoord is undefined');
  });

  test('a program that uses it declares it', () => {
    // Keyed on the USE, not on a mention: VS names uPtStyle in a comment and
    // has no mask at all, and an earlier draft of this test failed on that.
    for (const [name, program] of [['VS', VS], ['FS', FS]]) {
      const uses = /_pAlpha \*= uPtGain;/.test(program);
      assert.equal(/uniform float uPtGain;/.test(program), uses,
        uses ? `${name} multiplies by uPtGain without declaring it`
             : `${name} declares uPtGain but never uses it`);
    }
    // CONTROL: exactly one of the two must use it, or the loop above is
    // asserting nothing at all.
    assert.equal(Number(/_pAlpha \*= uPtGain;/.test(VS)) + Number(/_pAlpha \*= uPtGain;/.test(FS)), 1,
      'the mask lives in the fragment program and only there');
  });

  test('the editor template gets it too', () => {
    // SE_FS_TEMPLATE is not exported, so this reads the source: a user shader is
    // installed on the points proxy as well, and leaving the gain out would make
    // smoke look one way with the built-in program and another with a custom
    // one — the exact class of drift _POINT_UNIFORMS exists to prevent.
    const at = src.indexOf('const SE_FS_TEMPLATE =');
    assert.ok(at > 0, 'the editor fragment template moved; this check needs rewriting');
    const tpl = src.slice(at);
    assert.ok(/\$\{_POINT_UNIFORMS\}/.test(tpl) && /\$\{_POINT_MASK\}/.test(tpl),
      'the template must include both halves, or the uniform and its use separate');
  });
});
