// tests/pts-band-cloud.test.js
//
// PTS is the one mode where a band can do more than push a sheet: a point may
// leave the surface and may change size. This file is about the three parts
// that have to line up for that — the uniform that says "points are on stage",
// the attribute that carries the band's own share of the displacement in CPU
// mode, and the two vertex programs that spend them.
//
// Run:
//   node --test tests/pts-band-cloud.test.js
//
// ── The failure this file is written against ─────────────────────────────────
// Not "the cloud looks wrong" — nothing here can see a picture. It is the class
// where a gate is missing or stranded: uPtBand left raised on the way out of
// PTS displaces the SURFACE too, and left raised over an imported model
// displaces the model. Both draw something plausible, both survive every other
// test in the repo, and neither is anything the user asked for.
//
// The structural half (what the shader spends it on) lives in
// tests/gpu-shape-y.test.js, which models the tail's whole-position write.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (() => 0);

let RenderEngine, VS, FS, SHADER_SRC, G, MC, THREE;
before(async () => {
  ({ RenderEngine } = await import('../src/render.js'));
  ({ VS, FS }       = await import('../src/shaders.js'));
  G                 = await import('./helpers/glsl.js');
  MC                = await import('../src/math-collections.js');
  THREE             = await import('three');
  const fs   = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  SHADER_SRC = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/shaders.js'), 'utf8');
});

/**
 * The editor's vertex template, sliced the way tests/colour-ramp.test.js slices
 * it — through the parser rather than by searching for a name, and checked to
 * reach the end of main() so the tail is inside the slice. The tail is where
 * the whole PTS block lives, so a slice that stopped early would make every
 * assertion about the template pass on an empty string.
 */
function editorTemplate(src) {
  const text = G.templateLiteral(src, 'SE_VS_TEMPLATE');
  assert.ok(/gl_Position/.test(text),
    'the slice taken for SE_VS_TEMPLATE stops before the end of main(), so the PTS tail is not in it');
  return text;
}

// Same stand as tests/particle-style.test.js, plus the band uniforms — this
// file is about one of them, so leaving it out would test nothing.
function makeRender({ model = false } = {}) {
  const U = {
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
    uAmp: { value: 1 }, uBeat: { value: 0 }, uWI: { value: 1 },
    uPointSize: { value: 1 }, uLighting: { value: 1 }, uPtStyle: { value: 0 },
    uMode: { value: 0 }, uMathMode: { value: 0 }, uModeNext: { value: 0 },
    uMorphProgress: { value: 1 }, uModeBlend: { value: 0 },
    uPtBand: { value: 0 },
  };
  const gpuMat  = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U });
  const gpuMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 2, 2), gpuMat);
  const scene   = new THREE.Scene();
  scene.add(gpuMesh);
  return {
    U, gpuMat, gpuMesh, scene,
    gpuPtsProxy: null,
    modelMeshes: model ? [new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gpuMat)] : [],
    activeVS: VS, activeFS: FS,
    vizMode: 'surface',
    currentParticleStyle: 'squares',
    afterglow: null,
    setAfterglow(on, amount) { this.afterglow = { on, amount }; },
    setVizModeGPU(...a)    { return RenderEngine.prototype.setVizModeGPU.apply(this, a); },
    setParticleStyle(...a) { return RenderEngine.prototype.setParticleStyle.apply(this, a); },
  };
}

describe('uPtBand is raised only while points are what is being drawn', () => {
  let r;
  beforeEach(() => { r = makeRender(); });

  test('surface and wireframe leave it at zero', () => {
    for (const mode of ['surface', 'wireframe']) {
      r.vizMode = mode;
      r.setVizModeGPU(mode);
      assert.equal(r.U.uPtBand.value, 0,
        `${mode} raised uPtBand — the band would push the sheet along its own normals ` +
        'on top of the displacement it already applies');
    }
  });

  test('points raises it', () => {
    r.vizMode = 'points';
    r.setVizModeGPU('points');
    assert.equal(r.U.uPtBand.value, 1);
  });

  test('a round trip out of PTS puts it down again', () => {
    // The defect class FIX(#3, r3) is about: a uniform raised on the way in and
    // not lowered on the way out keeps acting on whatever is drawn next.
    r.vizMode = 'points';   r.setVizModeGPU('points');
    assert.equal(r.U.uPtBand.value, 1, 'precondition: PTS raised it');
    r.vizMode = 'surface';  r.setVizModeGPU('surface');
    assert.equal(r.U.uPtBand.value, 0,
      'uPtBand stranded on the way out of PTS — SURF now scatters its own vertices');
  });

  test('every style click leaves it raised, not just the first entry', () => {
    r.vizMode = 'points';
    r.setVizModeGPU('points');
    for (const style of ['dots', 'smoke', 'squares', 'not-a-style']) {
      r.setParticleStyle(style);
      assert.equal(r.U.uPtBand.value, 1, `picking "${style}" dropped uPtBand`);
    }
  });

  test('an imported model on the stage keeps it down', () => {
    // The model's meshes share this uniform block and are drawn as TRIANGLES.
    // uPtStyle is already forced to 0 here for the same reason; uPtBand would
    // otherwise displace the model along its normals with no way to stop it.
    const m = makeRender({ model: true });
    m.vizMode = 'points';
    m.setVizModeGPU('points');
    assert.equal(m.U.uPtBand.value, 0,
      'a model on the stage was scattered by the band layer');
    m.setParticleStyle('smoke');
    assert.equal(m.U.uPtBand.value, 0, 'setParticleStyle raised it behind the model guard');
  });

  test('CONTROL — the stand can see the uniform move at all', () => {
    r.U.uPtBand.value = 0.5;
    r.vizMode = 'points';
    r.setVizModeGPU('points');
    assert.equal(r.U.uPtBand.value, 1,
      'the stand never wrote uPtBand, so every assertion above passes for free');
  });
});

// ── aBand: the CPU half of the same quantity ────────────────────────────────

const GRID = 21;
const EXTENT = 3.5;

function plate(seg = 12) {
  const g = new THREE.PlaneGeometry(7, 7, seg, seg);
  g.rotateX(-Math.PI / 2);
  const n = g.attributes.position.count;
  g.setAttribute('aBand', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}
function bandsOnly(k, v = 1) {
  const b = new Float32Array(24);
  b[k] = v;
  return b;
}
const basePositionsOf = g => Float32Array.from(g.attributes.position.array);

describe('aBand carries the band and nothing else', () => {
  test('applyHeightField writes the band term, not the whole displacement', () => {
    // A field that is anything but flat, so "it wrote the field instead" is a
    // distinguishable answer rather than a coincidence at zero.
    const hf = MC.generateSurfaceFromFormula(
      (x, z) => Math.sin(x * 1.3) + Math.cos(z * 0.9),
      { amp: 1, freq: 1, comp: 0.5 }, GRID, EXTENT, 0);
    const g = plate();
    const layer = { bands: bandsOnly(0, 1), depth: 0.5, radius: EXTENT };
    MC.applyHeightField(g, hf, null, EXTENT, null, Infinity, layer);

    const band = g.attributes.aBand.array;
    let moved = 0, mismatched = 0;
    for (let i = 0; i < band.length; i++) {
      const x = g.attributes.position.getX(i), z = g.attributes.position.getZ(i);
      const want = MC.bandRingValue(layer, x, z, i);
      if (Math.abs(band[i]) > 1e-9) moved++;
      if (Math.abs(band[i] - want) > 1e-6) mismatched++;
    }
    assert.ok(moved > 0, 'no vertex received any band at all, so agreeing about zero proves nothing');
    assert.equal(mismatched, 0,
      `${mismatched} vertices carry something other than their own band value — most likely the ` +
      'whole displacement, which would make the points swell with the formula rather than the music');
  });

  test('with the layer off every entry is exactly zero', () => {
    const hf = MC.generateSurfaceFromFormula(
      (x, z) => Math.sin(x * 1.3), { amp: 1, freq: 1, comp: 0.5 }, GRID, EXTENT, 0);
    const g = plate();
    MC.applyHeightField(g, hf, null, EXTENT, null, Infinity, null);
    const band = g.attributes.aBand.array;
    let nonZero = 0;
    for (let i = 0; i < band.length; i++) if (band[i] !== 0) nonZero++;
    assert.equal(nonZero, 0,
      `${nonZero} vertices carry a band value with no layer — the cloud would scatter in silence`);
  });

  test('the volume and collapse writers fill it too', () => {
    // PTS is available in all three CPU modes. A writer that skipped this would
    // give the cloud in VOLUME a size and a scatter frozen at whatever SURFACE
    // last left in the buffer — stale, not absent, which is the harder bug.
    const layer = { bands: bandsOnly(0, 1), depth: 0.5, radius: EXTENT };

    const gv = plate();
    const baseV = basePositionsOf(gv);
    MC.applyDisplacementField(gv, new Float32Array(baseV.length), baseV, layer);
    let vMoved = 0;
    for (const v of gv.attributes.aBand.array) if (Math.abs(v) > 1e-9) vMoved++;
    assert.ok(vMoved > 0, 'applyDisplacementField left aBand empty');

    const gc = plate();
    const baseC = basePositionsOf(gc);
    const normals = new Float32Array(baseC.length);
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
    MC.applyCollapseField(gc, new Float32Array(baseC.length / 3), baseC, normals, 1, layer);
    let cMoved = 0;
    for (const v of gc.attributes.aBand.array) if (Math.abs(v) > 1e-9) cMoved++;
    assert.ok(cMoved > 0, 'applyCollapseField left aBand empty');
  });

  test('a geometry without the attribute is written to anyway, without throwing', () => {
    // Imported models and older proxies never went through attachBaseY. The
    // writers have to notice rather than crash, and rather than write past an
    // array of the wrong length.
    const g = new THREE.PlaneGeometry(7, 7, 6, 6);
    g.rotateX(-Math.PI / 2);
    const hf = new Float32Array(GRID * GRID);
    assert.doesNotThrow(() =>
      MC.applyHeightField(g, hf, null, EXTENT, null, Infinity,
                          { bands: bandsOnly(0, 1), depth: 0.5, radius: EXTENT }));
    // And one that is present but the wrong length is refused, not overrun.
    g.setAttribute('aBand', new THREE.BufferAttribute(new Float32Array(3), 1));
    assert.doesNotThrow(() =>
      MC.applyHeightField(g, hf, null, EXTENT, null, Infinity,
                          { bands: bandsOnly(0, 1), depth: 0.5, radius: EXTENT }));
    assert.deepEqual(Array.from(g.attributes.aBand.array), [0, 0, 0],
      'a mismatched aBand was written into anyway');
  });
});

// ── What the two vertex programs spend it on ────────────────────────────────

describe('both vertex programs grow their points with the band', () => {
  const programs = () => [
    ['VS', VS],
    ['SE_VS_TEMPLATE', editorTemplate(SHADER_SRC)],
  ];

  test('gl_PointSize is uPointSize scaled by the band, in both', () => {
    for (const [label, src] of programs()) {
      const P = G.readVertexProgram(src);
      const write = P.tail.stmts.filter(s => /^gl_PointSize/.test(s));
      assert.equal(write.length, 1,
        `${label}: expected exactly one gl_PointSize write in the tail, found ${write.length}`);
      const w = write[0];
      assert.match(w, /uPointSize/,
        `${label}: gl_PointSize stopped reading uPointSize — the style's size no longer applies`);
      assert.match(w, /abs\s*\(/,
        `${label}: the size term is signed. The gesture goes both ways, so a grain would SHRINK ` +
        'on half of every ripple and blink at the ripple\'s own rate — the flicker class ' +
        'uBeat is muted for');
      assert.match(w, /ptB/,
        `${label}: gl_PointSize does not read the band term at all — "${w};"`);
    }
  });

  test('the size term is exactly uPointSize when the band contributes nothing', () => {
    // Written as `uPointSize * (1. + k * abs(ptB))` rather than as an addition,
    // so at ptB = 0 the multiplier is exactly 1.0 and the shipped styles keep
    // the sizes tests/particle-style.test.js pins to the pixel.
    for (const [label, src] of programs()) {
      const P = G.readVertexProgram(src);
      const w = P.tail.stmts.filter(s => /^gl_PointSize/.test(s))[0];
      // The number is matched as a NUMBER, not as a spelling: the statement
      // comes back through the tokenizer, which prints `1.` as `1.0`, and a
      // guard that broke on the respelling would be reporting on itself.
      assert.match(w, /uPointSize\s*\*\s*\(\s*1(\.0*)?\s*\+/,
        `${label}: "${w};" is not of the form uPointSize * (1. + …), so with the layer off the ` +
        'point size is no longer the style\'s own');
    }
  });

  test('both declare the names the cloud reads', () => {
    // An undeclared identifier is a LINK failure: the whole scene goes black and
    // nothing else in the suite would see it.
    for (const [label, src] of programs()) {
      const d = G.declarations(src);
      for (const name of ['aBand', 'uPtBand']) {
        assert.ok(d.has(name),
          `${label} reads ${name} without declaring it — the program will not link`);
      }
    }
    // CONTROL: the same check can say no.
    assert.equal(G.declarations(VS).has('uNotAThing'), false);
  });

  test('the editor template is not left behind', () => {
    // The template had exactly this defect once already for exactly this layer:
    // Spectrum Rings worked in CPU mode and did nothing in GPU mode with a
    // custom shader live, because the template had not been mirrored. A user
    // shader runs on the points proxy too.
    const tpl = editorTemplate(SHADER_SRC);
    assert.match(tpl, /ptSpray/, 'the editor template has no scatter — one control, two answers');
    assert.match(tpl, /uPtBand/, 'the editor template never gates the scatter');
  });
});
