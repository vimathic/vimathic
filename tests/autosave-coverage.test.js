// tests/autosave-coverage.test.js
//
// The autosave can see the two fields a user actually spends time on.
//
// bootPersist has three writers: a delegated listener on .controls-panel, a 1 s
// fingerprint tick for everything that happens off the panel, and a final
// beforeunload flush. The shader source and the camera script were outside all
// three of the first two:
//
//   • Both editor overlays are SIBLINGS of .controls-panel in index.html —
//     #shader-editor-overlay at :1547 and #cam-editor-overlay at :1574, the
//     panel at :900 — so no event inside either reached the delegated listener
//     in any phase, capture included.
//   • The fingerprint read thirteen named getters and PARAM_FIELDS, and not one
//     of them was the shader body or any camScript field.
//
// Write a shader, press APPLY, close the editor, change nothing else: nothing
// was ever scheduled. That left beforeunload as the only writer, and it does
// not run on a GPU-process crash, an OOM during a WebM take, or a background
// tab being discarded. The snapshot still on disk then said hasCustom:false,
// so the next boot came up with the built-in shader as though the work had
// never happened. The comment above the fingerprint claimed the opposite in so
// many words: "It covers what the snapshot covers now".
//
// ── How this tests it ───────────────────────────────────────────────────────
// The real bootPersist, driven under node's mock timers, with _persistNow
// replaced by a counter — this is about what SCHEDULES a save, not about what
// the snapshot serialises. Each test changes exactly one thing and asks whether
// a write followed. The controls at the end are what stop it passing vacuously:
// changing nothing must write nothing, or every assertion above it is noise.

import { test, describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const DEBOUNCE_MS = 1500;   // bootPersist's own constants
const TICK_MS     = 1000;

let PresetMixin;
before(async () => { ({ PresetMixin } = await import('../src/ui/presets.js')); });

/** Records every listener bootPersist installs, per selector. */
function makeDom() {
  const bound = new Map();
  const el = (name) => {
    const listeners = [];
    bound.set(name, listeners);
    return {
      addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
      dispatch(type) { for (const l of listeners) if (l.type === type) l.fn({ type }); },
    };
  };
  const nodes = {
    '.controls-panel':        el('.controls-panel'),
    '#shader-editor-overlay': el('#shader-editor-overlay'),
    '#cam-editor-overlay':    el('#cam-editor-overlay'),
  };
  return {
    bound,
    nodes,
    document: {
      querySelector: sel => nodes[sel] ?? null,
      getElementById: () => null,
      addEventListener() {},
    },
  };
}

let ui, dom, writes;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  dom = makeDom();
  globalThis.document = dom.document;
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

  writes = 0;
  ui = Object.assign(Object.create(null), PresetMixin, {
    audio:  { colorIdx: 3, amp: 0.7, waveInt: 1 },
    render: {
      camera: { position: { x: 1, y: 2, z: 3 }, fov: 45 },
      orbit:  { target: { x: 0, y: 0, z: 0 } },
      currentShape: 'plane', vizMode: 'surf',
      currentMaterial: 'matte', currentParticleStyle: 'dot',
      grid: { visible: true },
      U: {},
    },
    mathViz: { _collId: 'fractals', _formulaKey: 'mandelbrot', _mode: 'surface', _volumeKey: null },
    shaderEditor: { customVS: null, customFS: null, _vert: 'y = 0.0;', _frag: 'c = vec3(1.0);' },
    camera: { cpActive: false, cpSource: '', cpParams: {}, cpKeyframes: [] },
    // The subject is what schedules a write, not what a write contains.
    _persistNow() { writes++; },
  });

  ui.bootPersist();
  // The fingerprint always schedules on its first run — that is documented in
  // bootPersist and is not what any of these tests are about. Burn it here so
  // each test starts from a settled state.
  settle();
  writes = 0;
});

afterEach(() => { mock.timers.reset(); });

/** Run past one fingerprint tick and the debounce that may follow it. */
function settle() {
  mock.timers.tick(TICK_MS);
  mock.timers.tick(DEBOUNCE_MS + 50);
}

describe('the fingerprint covers what the snapshot covers', () => {

  test('editing the shader body schedules a save', () => {
    ui.shaderEditor._vert = 'y = sin(pos.x) * 0.4;';
    settle();
    assert.equal(writes, 1,
      'an edited shader body did not schedule a save — beforeunload was the only writer, ' +
      'and it does not run on a GPU crash, an OOM during a take, or a tab discard');
  });

  test('applying a shader — the flag and the applied bodies — schedules a save', () => {
    ui.shaderEditor.customVS = 'compiled program';
    ui.shaderEditor._appliedVert = 'y = sin(pos.x) * 0.4;';
    settle();
    assert.equal(writes, 1,
      'hasCustom moved from false to true and nothing was scheduled; the snapshot on disk ' +
      'still says hasCustom:false, which is what reverts the shader on the next boot');
  });

  test('editing the fragment body schedules a save', () => {
    ui.shaderEditor._frag = 'c = vec3(0.0, 1.0, 0.0);';
    settle();
    assert.equal(writes, 1);
  });

  test('writing a camera script schedules a save', () => {
    ui.camera.cpSource = 'orbit(time * 0.2, 6);';
    settle();
    assert.equal(writes, 1, 'a camera script was invisible to the autosave');
  });

  test('arming a camera script schedules a save', () => {
    ui.camera.cpActive = true;
    settle();
    assert.equal(writes, 1);
  });

  test('a camera-programmer parameter schedules a save', () => {
    ui.camera.cpParams = { speed: 0.4 };
    settle();
    assert.equal(writes, 1);
  });

  test('a keyframe schedules a save', () => {
    ui.camera.cpKeyframes = [{ t: 0.5, code: 'cam.y = 4;' }];
    settle();
    assert.equal(writes, 1);
  });

  test('editing a keyframe body, not just adding one, schedules a save', () => {
    ui.camera.cpKeyframes = [{ t: 0.5, code: 'cam.y = 4;' }];
    settle();
    writes = 0;
    ui.camera.cpKeyframes = [{ t: 0.5, code: 'cam.y = 9;' }];
    settle();
    assert.equal(writes, 1, 'the keyframe list is fingerprinted by length or time only');
  });

  test('control — the fields that always worked still do', () => {
    ui.render.currentShape = 'torus';
    settle();
    assert.equal(writes, 1);
  });

  test('control — changing nothing writes nothing', () => {
    // Without this the suite would pass on a fingerprint that simply differs
    // every tick, which would keep the debounce armed forever and write on the
    // MAX_WAIT ceiling rather than because anything changed.
    settle();
    settle();
    settle();
    assert.equal(writes, 0,
      'the fingerprint moves on its own, so every assertion above passes for the wrong reason');
  });
});

describe('the editor overlays reach the delegated listener', () => {

  test('both overlays get the same listeners the panel does', () => {
    const types = name => (dom.bound.get(name) ?? []).map(l => l.type).sort();
    const panel = types('.controls-panel');
    assert.deepEqual(panel, ['change', 'click', 'input'], 'the panel binding changed shape');
    assert.deepEqual(types('#shader-editor-overlay'), panel,
      'the shader editor overlay is a SIBLING of .controls-panel, so nothing inside it ' +
      'reaches the panel listener in any phase — it needs its own');
    assert.deepEqual(types('#cam-editor-overlay'), panel,
      'the camera editor overlay has the same problem and needs the same binding');
  });

  test('they are bound in the capture phase, like the panel', () => {
    for (const name of ['.controls-panel', '#shader-editor-overlay', '#cam-editor-overlay']) {
      for (const l of dom.bound.get(name)) {
        assert.equal(l.opts?.capture, true, `${name} bound ${l.type} without capture`);
      }
    }
  });

  test('an event inside the shader editor schedules a save immediately', () => {
    // Not in a second, when the fingerprint next runs — the moment it happens,
    // like any control on the panel.
    dom.nodes['#shader-editor-overlay'].dispatch('input');
    mock.timers.tick(DEBOUNCE_MS + 50);
    assert.equal(writes, 1, 'typing in the shader editor scheduled nothing');
  });

  test('an event inside the camera editor schedules a save immediately', () => {
    dom.nodes['#cam-editor-overlay'].dispatch('click');
    mock.timers.tick(DEBOUNCE_MS + 50);
    assert.equal(writes, 1);
  });

  test('a missing overlay is not an error', () => {
    // second-screen.html and any trimmed HTML variant have no editors at all.
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    globalThis.document = { querySelector: () => null, getElementById: () => null, addEventListener() {} };
    assert.doesNotThrow(() => ui.bootPersist());
  });
});
