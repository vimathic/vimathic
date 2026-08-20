// tests/modals-wiring.test.js
//
// Contract tests for the wiring in src/ui/modals.js — the output modal and the
// camera editor. The first tests to reach this file.
//
// Run:
//   node --test tests/modals-wiring.test.js
//
// ── Defect 1: a cleared FPS field starts the camera at NaN ────────────────────
// `parseInt(el?.value ?? '60', 10)`. The `??` guards against a MISSING element,
// but a cleared <input type="number"> has value '' — a string, so the default
// never fires and parseInt('') is NaN. captureStream(NaN) then decides the
// frame rate for itself, and the feedback line reports "active @ NaNfps".
//
// ── Defect 2: STOP leaves START looking like it is running ────────────────────
// The start branch adds .active-out, which repaints the button green; the stop
// branch flips three display styles and never removes it. Nothing else clears
// it either — reopening the modal only refreshes the capability badge — so from
// the first stop onward the panel shows a running Virtual Camera that is not.
//
// ── Defect 3: "click to scrub" was never wired ────────────────────────────────
// Three things assert it: the timeline's own label, `cursor:pointer` on the bar,
// and the marker's click handler calling stopPropagation "so the click doesn't
// bubble to the bar". Nothing ever bound a listener to the bar.
//
// ── Defect 4: the camera PARAMS sliders are one-way ───────────────────────────
// Eight listeners write cpParams from the sliders and nothing writes the
// sliders from cpParams — while a preset applies its own cpParams wholesale
// (presets.js Object.assign). So after loading a preset the panel still shows
// the previous values, and the first touch of any slider does not nudge the
// value on screen: it writes whatever the stale thumb says, jumping the camera.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// Same import-order rule as tests/controls-wiring.test.js: dom.js resolves its
// element table at module load, so a document answering every id with a stub
// element is installed BEFORE the import. modals.js reaches recorder.js, which
// imports gif.worker as a raw string that node evaluates as CJS and which
// touches `self` — the same one-liner tests/recorder-gif-timing.test.js uses.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.self = globalThis;

function makeEl(id = '') {
  const el = {
    id,
    value: '', textContent: '', checked: false, disabled: false,
    style: {}, dataset: {}, options: [],
    _classes: new Set(),
    _listeners: new Map(),
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatchEvent() { return true; },
    // The timeline bar measures itself to turn a click into a fraction.
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10 }),
    querySelectorAll: () => [], querySelector: () => null, closest: () => null,
    appendChild() {}, append() {}, prepend() {}, insertBefore() {}, remove() {}, focus() {}, click() {},
    innerHTML: '', firstChild: null, children: [], parentNode: null,
  };
  el.classList = {
    add: c => el._classes.add(c),
    remove: c => el._classes.delete(c),
    contains: c => el._classes.has(c),
    toggle: (c, on) => { const want = on ?? !el._classes.has(c); want ? el._classes.add(c) : el._classes.delete(c); return want; },
  };
  return el;
}

const els = new Map();
const byId = id => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};
globalThis.document = {
  body: makeEl('body'),
  documentElement: makeEl('html'),
  getElementById: byId,
  createElement: () => makeEl(),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener() {}, removeEventListener() {},
  activeElement: { tagName: 'BODY' },
};
globalThis.requestAnimationFrame = fn => { fn(0); return 0; };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {}, open: () => null };
// navigator is a getter-only global in node; outputs.js reads userAgent at
// import time, and node's own navigator answers that.
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', platform: 'linux' }, configurable: true,
  });
}

let bindModals;
before(async () => { ({ bindModals } = await import('../src/ui/modals.js')); });

const fire = (id, type, extra = {}) => {
  const el = byId(id);
  (el._listeners.get(type) ?? []).forEach(fn => fn({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra }));
};
const hasListener = (id, type) => (byId(id)._listeners.get(type) ?? []).length > 0;

function makeUi() {
  const calls = [];
  return {
    calls,
    called: name => calls.filter(c => c[0] === name),
    audio: {
      seek: p => calls.push(['seek', p]),
      getElapsedFraction: () => 0,
      isPlaying: false, playlist: [], liveMode: 'file',
      cb: {},
    },
    render: {
      grid: { visible: false }, stars: { visible: true },
      transparentBg: false,
      setTransparentBackground: on => calls.push(['transparent', on]),
      renderer: { domElement: {} },
    },
    camera: { getDefaultCode: () => [], 
      cpParams: { rotSpeed: 0.001, radius: 7.2, height: 3, gravity: 0.01,
                  bassReact: 1, damping: 0.9, fov: 45, roll: 0 },
      cpKeyframes: [], cpSelectedKf: null, autoRot: false, cpActive: false,
      cb: {},
      buildTimeline() {}, loadScript() {}, resetScript() {},
      addKeyframeAtPlayhead() {}, deleteKeyframe() {}, selectKeyframe() {},
      getPresets: () => [],
    },
    shaderEditor: { cb: {}, _tab: 'frag', compileAndApply() {}, reset() {}, switchTab() {} },
    midi: { cb: {}, getMappings: () => [], setMapping() {}, startLearn() {}, cancelLearn() {}, clearAllMappings() {} },
    output: {
      capabilities: { virtualCamera: true, ndi: false, spout: false, obsSource: true },
      vcam: {
        start: fps => { calls.push(['vcam.start', fps]); return { ok: true }; },
        stop:  () => calls.push(['vcam.stop']),
        hidePreview() {}, showPreview() {},
      },
      startNDI() {}, stopNDI() {},
    },
    secondScreen: { open() {}, close() {}, active: false, cb: {} },
    // The recorder pair, with just enough surface for the STOP path: which
    // phase it is in, and which of the two exits was taken.
    gifRec: {
      cb: {}, encoding: false,
      stop()  { calls.push(['gif.stop']); },
      abort() { calls.push(['gif.abort']); },
    },
    webmRec: { cb: {}, stop() { calls.push(['webm.stop']); } },
    _showToast() {},
  };
}

let ui;
beforeEach(() => {
  for (const el of els.values()) {
    el._classes.clear(); el._listeners.clear();
    el.textContent = ''; el.value = ''; el.style = {};
  }
  ui = makeUi();
  bindModals(ui);
});

describe('the Virtual Camera controls say what is true', () => {

  test('a cleared frame-rate field falls back to the coded default', () => {
    byId('out-vcam-fps').value = '';            // the operator selected all, deleted

    fire('out-btn-vcam-start', 'click');

    assert.deepEqual(ui.called('vcam.start')[0], ['vcam.start', 60],
      'parseInt("") is NaN — the ?? guards a missing element, not an empty one, ' +
      'and captureStream(NaN) picks its own rate while the panel reports NaNfps');
  });

  test('a typed zero does not start a stream that never advances', () => {
    // captureStream(0) is legal — it means "a frame only when something asks
    // for one" — so nothing threw, the panel went green, and the picture sat
    // still. Number.isFinite(0) is true, which is what the old guard asked.
    byId('out-vcam-fps').value = '0';

    fire('out-btn-vcam-start', 'click');

    assert.deepEqual(ui.called('vcam.start')[0], ['vcam.start', 60],
      'zero reached captureStream and the feedback line reported "active @ 0fps"');
  });

  test('a frame rate outside anything a canvas can do falls back too', () => {
    byId('out-vcam-fps').value = '100000';
    fire('out-btn-vcam-start', 'click');
    assert.deepEqual(ui.called('vcam.start')[0], ['vcam.start', 60]);
  });

  test('control — a frame rate that was typed is the one used', () => {
    byId('out-vcam-fps').value = '30';
    fire('out-btn-vcam-start', 'click');
    assert.deepEqual(ui.called('vcam.start')[0], ['vcam.start', 30]);
  });

  test('STOP returns START to its idle styling', () => {
    byId('out-vcam-fps').value = '60';
    fire('out-btn-vcam-start', 'click');
    assert.equal(byId('out-btn-vcam-start').classList.contains('active-out'), true,
      'precondition: START paints itself green while running');

    fire('out-btn-vcam-stop', 'click');

    assert.equal(byId('out-btn-vcam-start').classList.contains('active-out'), false,
      'nothing else clears it, so the panel shows a camera that is not running');
  });

  test('control — STOP still stops the camera and restores the buttons', () => {
    byId('out-vcam-fps').value = '60';
    fire('out-btn-vcam-start', 'click');
    fire('out-btn-vcam-stop', 'click');

    assert.equal(ui.called('vcam.stop').length, 1);
    assert.equal(byId('out-btn-vcam-start').style.display, '');
    assert.equal(byId('out-btn-vcam-stop').style.display, 'none');
  });
});

describe('the camera timeline does what its own label promises', () => {

  test('clicking the bar scrubs the track', () => {
    assert.ok(hasListener('ce-tl-bar', 'click'),
      'the label says "click to scrub", the CSS sets cursor:pointer, and the marker ' +
      'stops propagation so the click can reach the bar — which listens to nothing');

    fire('ce-tl-bar', 'click', { clientX: 25 });

    assert.deepEqual(ui.called('seek')[0], ['seek', 0.25],
      'keyframe t and the playhead are both track fractions, so the track is what scrubs');
  });

  test('a click past the end of the bar does not seek outside the track', () => {
    fire('ce-tl-bar', 'click', { clientX: 300 });
    const [, pct] = ui.called('seek').at(-1) ?? [];
    assert.ok(pct <= 1 && pct >= 0, `a fraction outside [0,1] would seek nowhere: ${pct}`);
  });
});

describe('the camera PARAMS sliders are told when something else changes them', () => {

  test('a preset that rewrites cpParams moves the sliders and their labels', () => {
    Object.assign(ui.camera.cpParams, { radius: 15, fov: 90 });
    ui.camera.cb.onParamsChanged?.();

    assert.equal(byId('cp-radius').value, 15);
    assert.equal(byId('cp-radius-v').textContent, '15.0');
    assert.equal(byId('cp-fov-v').textContent, '90°');
  });

  test('so the next touch of a slider does not jump the camera back', () => {
    // The damage this actually causes: the thumb still sits where the previous
    // state left it, so the first drag writes from there instead of from the
    // value the preset installed.
    byId('cp-radius').value = '4';
    Object.assign(ui.camera.cpParams, { radius: 15 });
    ui.camera.cb.onParamsChanged?.();

    assert.equal(byId('cp-radius').value, 15, 'the thumb has to be where the value is');
  });

  test('control — the sliders still write cpParams as they always did', () => {
    byId('cp-radius').value = '9.5';
    fire('cp-radius', 'input');

    assert.equal(ui.camera.cpParams.radius, 9.5);
    assert.equal(byId('cp-radius-v').textContent, '9.5');
  });
});


// ── Round 11: STOP means stop ───────────────────────────────────────────────
describe('the recorder STOP button does what the documentation promises', () => {

  test('during capture it aborts rather than saving a partial GIF', () => {
    // documents/recording.md:131 — "For GIF, this aborts the worker and
    // discards partial frames — no file is saved". During capture
    // gif.encoding is false, so the old branch called stop(), and
    // GifRecorder.stop() with frames collected renders and downloads them.
    ui.gifRec.encoding = false;

    fire('rec-btn-stop', 'click');

    assert.equal(ui.called('gif.abort').length, 1, 'STOP saved the partial take the docs say it discards');
    assert.equal(ui.called('gif.stop').length, 0);
  });

  test('control — while encoding it still aborts, which was already true', () => {
    ui.gifRec.encoding = true;
    fire('rec-btn-stop', 'click');
    assert.equal(ui.called('gif.abort').length, 1);
  });
});

describe('SIZE cannot show a value the take will ignore', () => {

  test('ASPECT: Native disables it, and says why', () => {
    byId('rec-aspect').value = 'native';
    fire('rec-aspect', 'change');

    assert.equal(byId('rec-gif-size').disabled, true,
      'Native sends no dimensions at all (deliberately — see FIX(#23, r3)), so a live SIZE selector is a lie');
    assert.match(byId('rec-gif-size').title, /Native/);
  });

  test('control — any other aspect leaves it usable', () => {
    byId('rec-aspect').value = 'native';
    fire('rec-aspect', 'change');
    byId('rec-aspect').value = 'portrait';
    fire('rec-aspect', 'change');

    assert.equal(byId('rec-gif-size').disabled, false);
    assert.equal(byId('rec-gif-size').title, '');
  });
});
