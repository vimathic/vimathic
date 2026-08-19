// tests/model-abasey-default.test.js
//
// Round 10, wave 3. One property: every material that installs a vertex
// program reading `aBaseY` declares `defaultAttributeValues.aBaseY = [0]`.
//
// Run:
//   node --test tests/model-abasey-default.test.js
//
// ── Why this file exists ─────────────────────────────────────────────────────
// Round 10 gave the vertex program a static `aBaseY` attribute and wrote the
// fallback for geometries that lack it as `defaultAttributeValues.aBaseY = [0]`
// on the two materials in render.js. attachBaseY's docblock names imported
// OBJ/GLTF meshes as the real case for a missing attribute — and those meshes
// get their material from ModelLoader._applyShader in shaders.js, which
// declared nothing. So the round covered two materials that can never exhibit
// the bug (both draw gpuMesh.geometry, which always passes through attachBaseY)
// and missed the one that can.
//
// The old check lived in tests/blend-from-state.test.js and read only
// src/render.js, so no change to shaders.js could make it red.
//
// ── Why the census is built, not read ────────────────────────────────────────
// A `grep -c defaultAttributeValues` over the sources is satisfied by a
// declaration sitting anywhere in the file, including on a material that is
// not the one drawing. Every row below is a REAL material object produced by
// the shipped code path, and every row is paired with the question that makes
// the declaration matter: does the program it carries actually read aBaseY.
//
// Nothing in this VM links GLSL — no glslangValidator, no headless GL, and the
// browser here cannot create a WebGL context — so what three does with the
// declaration is argued from three 0.169.0's own source, quoted in
// attachBaseY's docblock and re-checked by the last test in this file.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let THREE, VS, FS, ShaderEditor, ModelLoader, RenderEngine;

before(async () => {
  THREE = await import('three');
  globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (fn => { fn(); return 0; });
  ({ VS, FS, ShaderEditor, ModelLoader } = await import('../src/shaders.js'));
  ({ RenderEngine } = await import('../src/render.js'));
});

/** The declared default for aBaseY on a real material, or null. */
const declared = m => {
  const d = m.defaultAttributeValues;
  return d && Object.prototype.hasOwnProperty.call(d, 'aBaseY') ? d.aBaseY : null;
};

/**
 * Does this program READ aBaseY, as opposed to merely declaring it?
 * The declaration line is removed before the second search so that a program
 * which declares the attribute and never uses it does not count — that shape
 * would not need a default and should not be allowed to satisfy this file.
 */
const declaresBaseY = src => /\battribute\s+float\s+aBaseY\s*;/.test(src);
const usesBaseY = src => /\baBaseY\b/.test(src.replace(/attribute\s+float\s+aBaseY\s*;/, ''));
const readsBaseY = src => declaresBaseY(src) && usesBaseY(src);

/**
 * Why readsBaseY said no. It is a conjunction of two different facts, and the
 * first draft reported both failures with the same sentence — "no longer reads
 * aBaseY" — which is false of a program that reads it and has lost only the
 * `attribute` line. A guard is allowed to be narrow; it is not allowed to
 * describe the tree it just read incorrectly.
 */
const whyNotBaseY = src =>
  !declaresBaseY(src) && !usesBaseY(src) ? 'neither declares nor reads aBaseY'
  : !declaresBaseY(src) ? 'reads aBaseY but no longer declares `attribute float aBaseY;`'
  : 'declares aBaseY but no longer reads it';

/** The uniform block the materials share, with the fields these paths touch. */
const uniforms = () => ({
  uMathMode:{value:0}, uVHField:{value:0}, uMorphProgress:{value:1},
  uPointSize:{value:1}, uPtStyle:{value:0}, uLighting:{value:1}, uTime:{value:0},
});

// ── The four materials, each built by the code that really builds it ────────

/** render.js:1876 — the POINTS proxy, through the real setVizModeGPU. */
function pointsProxyMaterial() {
  const U = uniforms();
  const stage = Object.create(RenderEngine.prototype);
  Object.assign(stage, {
    U, CFG:{ planeSegs:160, planeSize:7 }, isMobile:false,
    isShapeChanging:false, pendingShape:null, currentShape:null,
    gpuMesh:{ geometry:new THREE.PlaneGeometry(1,1,1,1), visible:true },
    gpuPtsProxy:null, scene:new THREE.Scene(), cb:{},
    clearSolarSystem(){}, _buildSolarSystem(){},
    activeVS:VS, activeFS:FS, vizMode:'surface', modelMeshes:[],
    currentParticleStyle:'round', setParticleStyle(){}, setAfterglow(){},
    gpuMat:new THREE.ShaderMaterial({ vertexShader:VS, fragmentShader:FS, uniforms:U }),
  });
  stage.setShape('plane');
  stage.setVizModeGPU('points');
  return stage.gpuPtsProxy.material;
}

/** shaders.js:873 — the editor's compile probe, through the real compileAndApply. */
function editorProbeMaterial() {
  const store = new Map();
  const el = () => ({ style:{}, textContent:'', value:'',
                      classList:{ add(){}, remove(){}, toggle(){} },
                      appendChild(){}, set innerHTML(_v){} });
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById: id => { if (!store.has(id)) store.set(id, el()); return store.get(id); },
    querySelectorAll: () => [],
    createElement: () => el(),
  };
  let captured = null;
  const render = {
    U: uniforms(),
    renderer: {
      debug: {},
      // The probe is compiled by rendering a one-mesh scene; walking it is how
      // this test gets hold of the material without reaching into the method.
      compile(scene) { scene.traverse(o => { if (o.isMesh) captured = o.material; }); },
      getRenderTarget() { return null; }, setRenderTarget() {}, render() {},
    },
    applyShaderSource() {},
  };
  const se = new ShaderEditor(render);
  document.getElementById('se-code').value = 'y = sin(pos.x) * 0.2;';
  se.compileAndApply();
  globalThis.document = prevDoc;
  return captured;
}

/** shaders.js:1161 — an imported mesh, through the real _applyShader. */
function modelMeshMaterial(vs = VS, fs = FS) {
  const group = new THREE.Group();
  const mesh  = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial());
  group.add(mesh);
  const ml = Object.create(ModelLoader.prototype);
  ml._render = { U: uniforms() };
  ml._meshes = [];
  ml._applyShader(group, vs, fs);
  return { material: ml._meshes[0].material, mesh, meshes: ml._meshes };
}

describe('every material that reads aBaseY declares a default for it', () => {

  test('the shipped vertex programs read the attribute at all', () => {
    // Precondition for the whole file. If a future edit removes the read, the
    // declarations below stop meaning anything and this says so first.
    assert.ok(readsBaseY(VS), `the built-in VS ${whyNotBaseY(VS)}`);
    const probe = editorProbeMaterial();
    assert.ok(probe, 'the editor probe material was not built');
    assert.ok(readsBaseY(probe.vertexShader),
      `SE_VS_TEMPLATE ${whyNotBaseY(probe.vertexShader)}`);
  });

  test('an imported model mesh — the case the docblock calls the real one', () => {
    const { material, mesh } = modelMeshMaterial();
    // The premise: imported geometry has no aBaseY, because it never went
    // through RenderEngine.setShape and so never reached attachBaseY.
    // `ok(x === undefined)`, not `equal(x, undefined)`: on failure the second
    // form renders a BufferAttribute and its typed array through util.inspect
    // to build a diff, which is a way of hanging the one run that matters.
    assert.ok(mesh.geometry.attributes.aBaseY === undefined,
      'precondition: an imported geometry must NOT carry aBaseY — if it does, ' +
      'this whole file is testing a case that cannot happen');
    assert.ok(readsBaseY(material.vertexShader),
      'precondition: the material an imported mesh gets must read aBaseY');
    assert.deepEqual(declared(material), [0],
      'ModelLoader._applyShader builds the material that carries every imported ' +
      'OBJ/GLTF mesh, and it declares no aBaseY default — so three writes nothing ' +
      'into that generic location and the mesh is coloured by whatever the last ' +
      'program left there (three r169 keeps color at [1,1,1])');
  });

  test('the editor compile probe', () => {
    const probe = editorProbeMaterial();
    assert.deepEqual(declared(probe), [0],
      'the editor probe draws a bare PlaneGeometry that never saw attachBaseY');
  });

  test('the two materials in render.js', () => {
    const pts = pointsProxyMaterial();
    assert.ok(readsBaseY(pts.vertexShader));
    assert.deepEqual(declared(pts), [0], 'the POINTS proxy (render.js:1876)');

    // gpuMat is built in the RenderEngine constructor, which wants a canvas and
    // a GL context. Read the declaration off the constructor's own source
    // instead, and pair it with the two behavioural rows above so this is the
    // only textual row in the file.
    // Comments stripped, because a commented-out declaration is not a
    // declaration and this is the only row here that reads text at all; and
    // both spellings accepted, because Object.assign builds the same material
    // and a guard that punishes the choice teaches people to write for it.
    const raw = readFileSync(join(ROOT, 'src', 'render.js'), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(src.length < raw.length, 'CONTROL: the comment stripper ran');
    assert.match(src,
      /this\.gpuMat\.defaultAttributeValues(?:\.aBaseY\s*=\s*\[\s*0\s*\]|\s*,\s*\{[^}]*\baBaseY\s*:\s*\[\s*0\s*\])/,
      'gpuMat must declare the same default as the proxy that shares its program. If it does ' +
      'and this pattern cannot see the spelling, widen the pattern rather than respelling ' +
      'render.js.');
  });

  test('the declaration survives the shader editor swapping the program', () => {
    // applyShaderSource mutates .vertexShader in place. If it were ever changed
    // to rebuild the material instead, the model meshes would silently lose the
    // default and this file would still pass without this case.
    const { material, meshes } = modelMeshMaterial();
    const eng = Object.create(RenderEngine.prototype);
    eng.gpuMat = null; eng.gpuPtsProxy = null; eng.modelMeshes = meshes;
    eng.applyShaderSource('/* a user program */\n' + VS, FS);
    assert.deepEqual(declared(material), [0],
      'an APPLY in the shader editor dropped the aBaseY default off the model meshes');
  });

  test('CONTROL — the census can see an absence', () => {
    // Every assertion above is `deepEqual(declared(m), [0])`. If `declared`
    // returned [0] for a material that has no such declaration, all of them
    // would be vacuous. Build the model material the way it was built before
    // this round's fix — no declaration — and require the reading to differ.
    const bare = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: uniforms(),
      side: THREE.DoubleSide,
    });
    assert.equal(declared(bare), null,
      'a material with no aBaseY declaration must read as null, or every ' +
      'assertion in this file passes for free');
    assert.ok(readsBaseY(bare.vertexShader),
      'the control material carries the same program as the real ones');
    // three's own default table is what fills the gap when nothing is declared,
    // and it is exactly the leftover the docblock warns about.
    assert.deepEqual(bare.defaultAttributeValues.color, [1, 1, 1],
      "three's Material default table no longer holds color:[1,1,1] — the " +
      'docblock in render.js quotes it and would need rewriting');
  });

  test('CONTROL — the "reads it" test can say no', () => {
    // readsBaseY gates three of the assertions above. A version of it that
    // always returned true would let a program that dropped the attribute pass.
    assert.equal(readsBaseY('void main(){ gl_Position = vec4(0.); }'), false);
    assert.equal(readsBaseY('attribute float aBaseY;\nvoid main(){ gl_Position = vec4(0.); }'), false,
      'a program that declares aBaseY and never reads it needs no default');
    assert.equal(readsBaseY('attribute float aBaseY;\nvoid main(){ float h = aBaseY; }'), true);
  });
});

describe('the three source lines attachBaseY argues from', () => {
  // The docblock's whole case for `[0]` is three's behaviour, and nothing here
  // can run GLSL to check it. What CAN be checked is that the lines it cites
  // still say what it says they say — the citation was off by one before this
  // wave, and a version bump would silently move all three.
  const THREE_SRC = join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
  let lines;
  before(() => { lines = readFileSync(THREE_SRC, 'utf8').split('\n'); });

  test('the version the citations were taken on', async () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'three', 'package.json'), 'utf8'));
    assert.equal(pkg.version, '0.169.0',
      'three moved; the line numbers cited in attachBaseY were read on 0.169.0 ' +
      'and must be re-read before they can be trusted');
  });

  test(':15589 is the defaultAttributeValues arm, :15610 its scalar case', () => {
    assert.match(lines[15589 - 1], /materialDefaultAttributeValues\s*!==\s*undefined/);
    assert.match(lines[15610 - 1], /gl\.vertexAttrib1fv\(/);
  });

  test(':15480 is the buffer branch that a missing attribute skips', () => {
    assert.match(lines[15480 - 1], /geometryAttribute\s*!==\s*undefined/);
  });

  test(':12325 is the Material default table the docblock quotes', () => {
    assert.match(lines[12325 - 1], /this\.defaultAttributeValues\s*=\s*\{/);
    assert.match(lines.slice(12325, 12329).join('\n'), /'color'\s*:\s*\[\s*1,\s*1,\s*1\s*\]/);
  });

  test('CONTROL — a wrong line number is rejected', () => {
    // The failure this whole describe exists to catch is an off-by-one, so the
    // reader has to be able to produce one.
    assert.doesNotMatch(lines[15588 - 1], /materialDefaultAttributeValues\s*!==\s*undefined/,
      'if :15588 also matches, these assertions cannot tell a right citation from a wrong one');
  });
});
