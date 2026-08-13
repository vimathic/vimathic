// tests/controller-shell.test.js
//
// The UI shell: contracts that live in index.html, and the code that has to
// keep them. Nothing loaded either side of this before — index.html is read by
// the Playwright suite only, and the camera-editor's param rails by nothing at
// all.
//
// Run:
//   node --test tests/controller-shell.test.js
//
// ── Defect 1: closed modals stayed in the tab order ───────────────────────────
// All five overlays are permanently `display:flex` and are opened and closed by
// `opacity` + `pointer-events` alone. Neither property removes an element from
// sequential focus navigation. Measured in Chromium on the real file: 30 of the
// first 80 Tab presses from a fresh load landed inside a CLOSED overlay, and 9
// of those on an INPUT/SELECT/TEXTAREA — which is the exact tag test both
// global keydown handlers use to stand down (src/main.js, src/ui/controls.js),
// so every hotkey went dead with nothing on screen to explain it. Enter on the
// invisible APPLY button still ran compileAndApply(). The mouse was never
// affected: pointer-events blocks hit testing and only hit testing.
// The fix is `visibility:hidden` while closed, which also stops #about-overlay
// telling assistive tech that a modal dialog is open at all times. This file is
// where it is pinned: no unit test can open a browser, so what is asserted is
// that every overlay taking part in the .open pattern also takes part in the
// visibility pair — which is what a sixth overlay would forget.
//
// ── Defect 2: a value the rail cannot hold ────────────────────────────────────
// syncParamsUI (src/ui/modals.js) exists because the eight camera PARAMS rows
// were one-way: its JSDoc says an out-of-date thumb means "the first drag
// writes from THERE and jumps the camera to a number nobody chose". It wrote
// `el.value = v` with no rail-grow, and `<input type="range">` silently clamps
// anything outside [min,max] — so for a value above the rail it reproduced
// exactly that failure: the label printed the true number, the thumb sat pinned
// at the rail, and the row's own `input` listener then stored the RAIL value on
// first touch. Nothing constrains cpParams to the rails (applyParam clamps only
// at the bottom, relative-mode MIDI has no ceiling, presets Object.assign a
// whole cpParams block).
// The rails here are read out of index.html rather than invented, so the test
// fails if the markup and the code stop agreeing.
//
// ── Defect 3: #cp-rot's rail was half its parameter's range ───────────────────
// rotSpeed has no panel slider, so #cp-rot is its slider — and it said
// max="0.001" while src/params.js declares `max: 0.002` and
// documents/camera-programmer.md publishes 0–0.002 to script authors.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTML = readFileSync(ROOT + 'index.html', 'utf8');

// ── A very small CSS reader ────────────────────────────────────────────────
// Enough for flat `selector-list { declarations }` rules, which is all the
// overlay styling is. At-rule bodies contribute their inner rules and a
// nonsense outer one; nothing here looks up a selector that could collide.
function cssRules(html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');   // a comment would glue itself to the next selector
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selectors: m[1].split(',').map(s => s.trim()).filter(Boolean),
    decls: m[2].replace(/\s+/g, ''),
  }));
}
const RULES = cssRules(HTML);

/** Every rule whose declaration block sets `prop: value`. */
const rulesDeclaring = (prop, value) =>
  RULES.filter(r => new RegExp(`(^|;)${prop}:${value}(;|$)`).test(r.decls));

const selectorsDeclaring = (prop, value) =>
  new Set(rulesDeclaring(prop, value).flatMap(r => r.selectors));

describe('a closed modal is closed for the keyboard too', () => {

  // Derived, not listed: an overlay joins this set by having an `#id.open`
  // rule, which is how every one of them is opened and closed.
  const OVERLAY_IDS = [...new Set(
    RULES.flatMap(r => r.selectors)
      .map(s => s.match(/^#([a-z0-9-]+)\.open$/))
      .filter(Boolean)
      .map(m => m[1]),
  )];

  test('the overlays were found at all', () => {
    // Sensitivity guard: if the reader above stops matching, every assertion
    // below would pass over an empty list.
    assert.ok(OVERLAY_IDS.length >= 5,
      `expected the five overlays and found ${OVERLAY_IDS.length}: ${OVERLAY_IDS.join(', ')}`);
    assert.ok(OVERLAY_IDS.includes('about-overlay'));
    assert.ok(OVERLAY_IDS.includes('shader-editor-overlay'));
  });

  test('every overlay is out of the focus order while it is closed', () => {
    const hidden = selectorsDeclaring('visibility', 'hidden');
    const missing = OVERLAY_IDS.filter(id => !hidden.has('#' + id));
    assert.deepEqual(missing, [],
      'opacity and pointer-events do not take an element out of sequential focus ' +
      'navigation; these overlays would keep their buttons, selects and textareas ' +
      'tabbable while invisible: ' + missing.join(', '));
  });

  test('and back in it the moment it opens', () => {
    const shown = selectorsDeclaring('visibility', 'visible');
    const missing = OVERLAY_IDS.filter(id => !shown.has(`#${id}.open`));
    assert.deepEqual(missing, [],
      'an overlay hidden while closed and never made visible again would open ' +
      'as an empty rectangle: ' + missing.join(', '));
  });

  test('the fade survives: visibility waits for the opacity transition', () => {
    // `visibility:hidden` with no transition would make a dismissed dialog
    // vanish instantly instead of fading out.
    const closed = rulesDeclaring('visibility', 'hidden')
      .find(r => r.selectors.includes('#about-overlay'));
    assert.match(closed.decls, /transition:opacity\.25s,visibility0s\.25s/,
      'the close direction has to hold visibility for the length of the fade');
    const open = rulesDeclaring('visibility', 'visible')
      .find(r => r.selectors.includes('#about-overlay.open'));
    assert.match(open.decls, /transition:opacity\.25s,visibility0s0s/,
      'the open direction has to hand focus over immediately');
  });

  test('no overlay ships already open', () => {
    for (const id of OVERLAY_IDS) {
      const tag = HTML.match(new RegExp(`<div id="${id}"[^>]*>`));
      assert.ok(tag, `#${id} has no <div> in the markup`);
      assert.ok(!/class="[^"]*\bopen\b/.test(tag[0]),
        `#${id} is authored open, which the closed-state styling above assumes it is not`);
    }
  });
});

describe('the clip-time rows have nowhere else to get their layout', () => {

  // src/ui/controller.js `_setMode` writes 'flex' rather than '' precisely
  // because of what this test asserts. If the declarations are ever hoisted
  // into a rule, '' becomes the correct restore and the controller should go
  // back to it — this test failing is the signal to do that, not to delete it.
  for (const cls of ['clip-time-sec', 'clip-time-bars']) {
    test(`.${cls} is styled by its own style attribute and nothing else`, () => {
      const tag = HTML.match(new RegExp(`<div class="${cls}"[^>]*>`));
      assert.ok(tag, `.${cls} is not in the markup`);
      assert.match(tag[0], /style="display:(flex|none);gap:6px;align-items:center"/,
        'the row is authored as a flex row with a 6px gap');
      const styled = RULES.filter(r => r.selectors.some(s => s.includes(cls)));
      assert.deepEqual(styled.map(r => r.selectors.join(',')), [],
        `a stylesheet rule now selects .${cls}; removing the inline display would ` +
        'fall back to it, so controller.js may go back to style.display = ""');
    });
  }

  test('#clip-hold only fills the row while the row is a flex container', () => {
    const input = HTML.match(/<input id="clip-hold"[^>]*>/)[0];
    assert.match(input, /style="[^"]*flex:1/,
      'the input asks for the remaining width, which `display:block` on the row ' +
      'silently ignores — measured: 220px as authored, 56px without');
  });
});

describe('the camera PARAMS rails say what the parameters say', () => {

  let PARAMS;
  before(async () => { ({ PARAMS } = await import('../src/params.js')); });

  const rail = id => {
    const tag = HTML.match(new RegExp(`<input type="range" id="${id}"[^>]*>`));
    assert.ok(tag, `#${id} is not in the markup`);
    return {
      min:  +tag[0].match(/min="([^"]*)"/)[1],
      max:  +tag[0].match(/max="([^"]*)"/)[1],
      step: +tag[0].match(/step="([^"]*)"/)[1],
    };
  };

  test('#cp-rot is rotSpeed\'s only slider, so it carries rotSpeed\'s range', () => {
    const r = rail('cp-rot');
    assert.equal(r.min, PARAMS.rotSpeed.min);
    assert.equal(r.max, PARAMS.rotSpeed.max,
      'a rail at half the parameter\'s range pins the thumb over the top half of ' +
      'a mapped encoder\'s travel');
  });

  test('and the range the camera-programmer document publishes is that one', () => {
    const doc = readFileSync(ROOT + 'documents/camera-programmer.md', 'utf8');
    const row = doc.split('\n').find(l => l.includes('`p.rotSpeed`'));
    assert.ok(row, 'the parameter table no longer lists p.rotSpeed');
    assert.ok(row.includes(`${PARAMS.rotSpeed.min}–${PARAMS.rotSpeed.max}`),
      `the document publishes a different range from src/params.js: ${row.trim()}`);
  });

  test('every rail can hold its slider\'s own default', () => {
    for (const id of ['cp-rot', 'cp-radius', 'cp-height', 'cp-grav',
                      'cp-bass-react', 'cp-damp', 'cp-fov', 'cp-roll']) {
      const r = rail(id);
      const tag = HTML.match(new RegExp(`<input type="range" id="${id}"[^>]*>`))[0];
      const v = +tag.match(/value="([^"]*)"/)[1];
      assert.ok(v >= r.min && v <= r.max, `#${id} opens on ${v}, outside ${r.min}..${r.max}`);
    }
  });
});

// ── The rail-grow half needs modals.js, so the stub document goes in here ────
//
// Same import-order rule as tests/modals-wiring.test.js: dom.js resolves every
// REQUIRED id at module load, so the document has to exist before the import.
// The difference from that file's stub is deliberate — the range inputs here
// carry the real min/max out of index.html and clamp on assignment the way a
// real <input type="range"> does. That clamp is the whole defect; a stub that
// stores whatever it is given cannot see it.

globalThis.self = globalThis;

const RAILS = Object.fromEntries(
  [...HTML.matchAll(/<input type="range" id="(cp-[a-z-]+)" min="([^"]*)" max="([^"]*)"/g)]
    .map(m => [m[1], { min: m[2], max: m[3] }]),
);

function makeEl(id = '') {
  const el = {
    id, textContent: '', checked: false, disabled: false,
    min: '', max: '', _value: '', _isRange: false,
    style: {}, dataset: {}, options: [],
    _classes: new Set(),
    _listeners: new Map(),
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    },
    removeEventListener() {}, dispatchEvent() { return true; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10 }),
    querySelectorAll: () => [], querySelector: () => null, closest: () => null,
    appendChild() {}, append() {}, prepend() {}, insertBefore() {}, remove() {},
    focus() {}, click() {},
    innerHTML: '', firstChild: null, children: [], parentNode: null,
  };
  // The HTML5 value sanitization algorithm, the part that matters: a value
  // outside [min,max] is clamped to the rail, silently.
  Object.defineProperty(el, 'value', {
    get: () => el._value,
    set: v => {
      let n = v;
      if (el._isRange && Number.isFinite(+v) && v !== '') {
        n = Math.min(Math.max(+v, +el.min), +el.max);
      }
      el._value = String(n);
    },
  });
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
  body: makeEl('body'), documentElement: makeEl('html'),
  getElementById: byId, createElement: () => makeEl(),
  querySelectorAll: () => [], querySelector: () => null,
  addEventListener() {}, removeEventListener() {},
  activeElement: { tagName: 'BODY' },
};
globalThis.requestAnimationFrame = fn => { fn(0); return 0; };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {}, open: () => null };
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', platform: 'linux' }, configurable: true,
  });
}

describe('a camera parameter the rail cannot hold still reaches the panel', () => {

  let bindModals, ui;
  before(async () => { ({ bindModals } = await import('../src/ui/modals.js')); });

  const fire = (id, type, extra = {}) => {
    const el = byId(id);
    (el._listeners.get(type) ?? []).forEach(fn => fn({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra }));
  };

  function makeUi() {
    return {
      audio: { seek() {}, getElapsedFraction: () => 0, isPlaying: false, playlist: [], liveMode: 'file', cb: {} },
      render: { grid: { visible: false }, stars: { visible: true }, transparentBg: false,
                setTransparentBackground() {}, renderer: { domElement: {} } },
      camera: {
        getDefaultCode: () => '',
        cpParams: { rotSpeed: 0.00002, radius: 7.2, height: 3.2, gravity: 0.0004,
                    bassReact: 1, damping: 0.996, fov: 45, roll: 0 },
        cpKeyframes: [], cpSelectedKf: null, autoRot: false, cpActive: false, cb: {},
        buildTimeline() {}, loadScript() {}, resetScript() {},
        addKeyframeAtPlayhead() {}, deleteKeyframe() {}, selectKeyframe() {},
        getPresets: () => [],
      },
      shaderEditor: { cb: {}, _tab: 'frag', compileAndApply() {}, reset() {}, switchTab() {} },
      midi: { cb: {}, getMappings: () => [], setMapping() {}, startLearn() {}, cancelLearn() {}, clearAllMappings() {} },
      output: { capabilities: { virtualCamera: true, ndi: false, spout: false, obsSource: true },
                vcam: { start: () => ({ ok: true }), stop() {}, hidePreview() {}, showPreview() {} },
                startNDI() {}, stopNDI() {} },
      secondScreen: { open() {}, close() {}, active: false, cb: {} },
      gifRec: { cb: {} }, webmRec: { cb: {} },
      _showToast() {},
    };
  }

  beforeEach(() => {
    for (const el of els.values()) {
      el._classes.clear(); el._listeners.clear();
      el.textContent = ''; el._value = ''; el.style = {};
      el.min = ''; el.max = ''; el._isRange = false;
    }
    // The rails as index.html authors them — reset every time, because the
    // fix moves el.max and the next test must start from the markup again.
    for (const [id, r] of Object.entries(RAILS)) {
      const el = byId(id);
      el.min = r.min; el.max = r.max; el._isRange = true;
    }
    ui = makeUi();
    bindModals(ui);
  });

  test('the rails were seeded from the markup', () => {
    // Sensitivity guard: with no rails, nothing below can clamp and every
    // assertion passes for the wrong reason.
    assert.equal(Object.keys(RAILS).length, 8, JSON.stringify(RAILS));
    assert.equal(byId('cp-radius').max, '20');
  });

  test('a preset radius past the end of the rail arrives whole', () => {
    ui.camera.cpParams.radius = 30;          // rail is 2..20
    ui.camera.cb.onParamsChanged();

    assert.equal(+byId('cp-radius').value, 30,
      'the browser clamps .value to the rail, so without growing it first the thumb ' +
      'says 20 while the label says 30');
    assert.equal(byId('cp-radius-v').textContent, '30.0');
  });

  test('and the first touch of that slider does not halve the value', () => {
    ui.camera.cpParams.radius = 30;
    ui.camera.cb.onParamsChanged();

    // The row's own listener, exactly as a nudge of the thumb would fire it.
    fire('cp-radius', 'input');

    assert.equal(ui.camera.cpParams.radius, 30,
      'this is the failure syncParamsUI was added to prevent: the first drag writes ' +
      'from where the thumb is, and a pinned thumb writes the rail value');
  });

  test('a value under the bottom of the rail survives too', () => {
    ui.camera.cpParams.damping = 0.5;        // rail is 0.9..1
    ui.camera.cb.onParamsChanged();

    assert.equal(+byId('cp-damp').value, 0.5);
    fire('cp-damp', 'input');
    assert.equal(ui.camera.cpParams.damping, 0.5);
  });

  test('a MIDI CC beyond rotSpeed\'s declared range keeps its number', () => {
    // Relative-mode MIDI has no upper clamp at all — params.js says so.
    ui.camera.cpParams.rotSpeed = 0.005;     // rail is 0..0.002
    ui.camera.cb.onParamsChanged();

    assert.equal(+byId('cp-rot').value, 0.005);
    assert.equal(byId('cp-rot-v').textContent, '0.00500');
  });

  test('control — a value inside the rail leaves the rail alone', () => {
    ui.camera.cpParams.radius = 12;
    ui.camera.cb.onParamsChanged();

    assert.equal(byId('cp-radius').min, '2', 'nothing to widen, so nothing widens');
    assert.equal(byId('cp-radius').max, '20');
    assert.equal(+byId('cp-radius').value, 12);
    assert.equal(byId('cp-radius-v').textContent, '12.0');
  });

  test('control — the eight rows still write cpParams when they are dragged', () => {
    byId('cp-fov').value = '77';
    fire('cp-fov', 'input');
    assert.equal(ui.camera.cpParams.fov, 77);
    assert.equal(byId('cp-fov-v').textContent, '77°');
  });
});
