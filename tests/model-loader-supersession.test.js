// tests/model-loader-supersession.test.js
//
// Two overlapping model imports leave one model on stage, not two.
//
// ModelLoader.load() had no generation token, while AudioEngine.loadPlay and
// MathVisualizer._generation both implement one in full. load() calls clear()
// first, but assigns _model LAST, after two awaits — so for the whole duration
// of a load, _model is null and clear()'s early return fired, skipping
// `this._meshes = []`. _applyShader then pushed into that same array rather
// than replacing it.
//
// Measured here against the previous revision of src/shaders.js, driving the
// real load() twice without awaiting the first:
//
//              scene children   _meshes   after CLEAR MODEL
//   before             2           2      1 group still drawn
//   after              1           1      0
//
// The group left behind is unreachable — nothing holds a reference to it — and
// CLEAR MODEL disposed its geometry and material along with the other group's,
// so it stays on screen drawn from disposed buffers that three re-uploads on
// the next frame. Only a page reload removes it.
//
// ── Why this runs in plain Node ──────────────────────────────────────────────
// OBJLoader parses through THREE.FileLoader → fetch of a blob: URL, and Node
// supports both; only ProgressEvent is missing from the global scope, and the
// loader constructs one per progress callback. Nothing here touches WebGL —
// the object graph, the disposal and the scene membership are plain JS. The
// document stub is installed AFTER the import so dom.js, if it is ever pulled
// into this module's graph, still takes its node branch.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let ModelLoader, THREE;
before(async () => {
  ({ ModelLoader } = await import('../src/shaders.js'));
  THREE = await import('three');
  globalThis.ProgressEvent ??= class ProgressEvent extends Event {
    constructor(type, init = {}) {
      super(type);
      this.lengthComputable = !!init.lengthComputable;
      this.loaded = init.loaded ?? 0;
      this.total  = init.total ?? 0;
    }
  };
  // load() writes the two status elements directly. They are not what is under
  // test; they only have to exist.
  globalThis.document ??= { getElementById: () => ({ style: {}, textContent: '' }) };
});

/** One triangle, offset in z so the two fixtures are not byte-identical. */
const obj = n => `v 0.0 0.0 ${n}\nv 1.0 0.0 ${n}\nv 0.0 1.0 ${n}\nf 1 2 3\n`;
const file = (name, n) => new File([obj(n)], name);

let scene, render, ml, external;

beforeEach(() => {
  scene = new THREE.Scene();
  external = [];
  render = {
    scene,
    U: {},
    setExternalModel(m) { external.push(m); },
  };
  ml = new ModelLoader(render);
});

const load = (name, n) =>
  ml.load(file(name, n), () => {}, () => ({ vs: null, fs: null }));

describe('two imports started inside one another', () => {

  test('leave exactly one group on stage', async () => {
    // Started back to back and awaited together: which one wins is up to the
    // loader, and the invariant does not depend on knowing.
    await Promise.all([load('a.obj', 1), load('b.obj', 2)]);

    assert.equal(scene.children.length, 1,
      `${scene.children.length} groups in the scene — an abandoned import was left on stage`);
    assert.ok(ml._model, 'no model recorded after two successful imports');
    assert.ok(scene.children.includes(ml._model),
      'the group in the scene is not the one _model points at — the other one is unreachable');
  });

  test('leave a mesh list describing only that group', async () => {
    await Promise.all([load('a.obj', 1), load('b.obj', 2)]);

    assert.equal(ml._meshes.length, 1,
      `_meshes holds ${ml._meshes.length} meshes for one group — the array accumulated across loads, ` +
      'which is what made CLEAR MODEL dispose the geometry of a model it was leaving on screen');
    for (const m of ml._meshes) {
      assert.ok(ml._model.getObjectById(m.id),
        'a mesh in _meshes does not belong to the group on stage');
    }
  });

  test('and CLEAR MODEL then empties the stage', async () => {
    await Promise.all([load('a.obj', 1), load('b.obj', 2)]);
    ml.clear();

    assert.equal(scene.children.length, 0,
      `${scene.children.length} groups still drawn after CLEAR MODEL — this is the stranded model, ` +
      'now rendering from geometry clear() has just disposed');
    assert.equal(ml._model, null);
    assert.deepEqual(ml._meshes, []);
  });

  test('the engine is handed the stage back exactly once at the end', async () => {
    await Promise.all([load('a.obj', 1), load('b.obj', 2)]);
    ml.clear();
    assert.equal(external.at(-1), null, 'clear() did not release the stage');
  });
});

describe('a single import is unaffected', () => {

  test('one load puts one group on stage and records its meshes', async () => {
    await load('only.obj', 1);
    assert.equal(scene.children.length, 1);
    assert.equal(ml._meshes.length, 1);
    assert.ok(scene.children.includes(ml._model));
    assert.equal(external.at(-1), ml._meshes, 'the engine was not given the mesh list');
  });

  test('loading again replaces rather than accumulates', async () => {
    await load('first.obj', 1);
    const first = ml._model;
    await load('second.obj', 2);

    assert.equal(scene.children.length, 1);
    assert.notEqual(ml._model, first, 'the second import did not take the stage');
    assert.ok(!scene.children.includes(first), 'the first group is still in the scene');
    assert.equal(ml._meshes.length, 1);
  });

  test('an unsupported extension reports and leaves the stage released', async () => {
    await ml.load(new File(['nope'], 'model.stl'), () => {}, () => ({ vs: null, fs: null }));
    assert.equal(scene.children.length, 0);
    assert.equal(external.at(-1), null);
  });
});

describe('clear() no longer depends on _model to reset its bookkeeping', () => {

  test('it empties the mesh list even when there is no model', () => {
    // The state a load is in for its whole duration: _model still null. The old
    // early return left _meshes untouched here, which is the entire mechanism.
    ml._model  = null;
    ml._meshes = ['a stale mesh'];
    ml.clear();
    assert.deepEqual(ml._meshes, [],
      'clear() returned early and left the previous load\'s meshes in place');
  });

  test('it is safe to call on a fresh loader', () => {
    const fresh = new ModelLoader(render);
    fresh.clear();
    assert.equal(fresh._model, null);
    assert.deepEqual(fresh._meshes, []);
  });
});

describe('_applyShader hands its meshes back instead of accumulating them', () => {

  test('the returned list is the meshes, and the field is untouched', () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));

    ml._meshes = ['untouched'];
    const got = ml._applyShader(group, 'void main(){}', 'void main(){}');

    assert.equal(got.length, 2, '_applyShader did not return the meshes it swapped');
    assert.deepEqual(ml._meshes, ['untouched'],
      '_applyShader wrote into this._meshes — that shared array is what two imports accumulated into');
  });
});
