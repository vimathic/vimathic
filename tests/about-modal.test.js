// tests/about-modal.test.js
//
// Contract tests for the About modal's tab strip and the two ways out of it.
//
// Run:
//   node --test tests/about-modal.test.js
//
// ── Defect 1: Escape left the group dropdown on screen ────────────────────────
// A group's menu is appended to document.body at z-index 2147483647, precisely
// so it can escape the modal's clipping. close() hides those menus — and the
// Escape handler in controls.js stripped `.open` off the overlay by id without
// ever calling it, so a menu left open stayed over the visualisation with
// nothing left to dismiss it.
//
// ── Defect 2: a group's items never highlighted ───────────────────────────────
// The active-tab highlight searched inside the tab strip. A group's items are
// never in the tab strip — they are in that body-level menu — so the query
// matched nothing: an item never lit up when selected, and the un-highlight
// loop could not reach one either. The comment above it claimed it "works for
// both standalone tabs and group items"; it worked for neither.
//
// ── Why this is its own file ──────────────────────────────────────────────────
// bindAboutModal wires itself once per module instance (`_wired`), so a suite
// that re-binds between tests loses these listeners after the first one. Here
// the binding happens once, and the tests share the modal the way a session
// does.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The docs bundle is a Vite virtual module. One standalone doc and one inside a
// group: the grouped one is what goes into document.body rather than the strip.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'virtual:vimathic-docs') {
      const DOCS = JSON.stringify([
        { slug: 'quick-start', title: 'Quick Start', group: null,         html: '<p>a</p>' },
        { slug: 'recording',   title: 'Recording',   group: 'production', html: '<p>b</p>' },
        { slug: 'presets',     title: 'Presets',     group: 'production', html: '<p>c</p>' },
      ]);
      return { url: 'data:text/javascript,export default ' + encodeURIComponent(DOCS), shortCircuit: true };
    }
    if (specifier === 'virtual:vimathic-build-info') {
      return {
        url: 'data:text/javascript,export const VIMATHIC_VERSION="test";'
           + 'export const VIMATHIC_BUILD_HASH="0000000";'
           + 'export const VIMATHIC_BUILD_DATE="1970-01-01";'
           + 'export const VIMATHIC_REPO_URL="";',
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});

const created = [];

function makeEl(id = '') {
  const el = {
    id, value: '', textContent: '', innerHTML: '',
    style: {}, dataset: {}, options: [],
    _classes: new Set(), _listeners: new Map(),
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatchEvent() { return true; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10, bottom: 10, right: 100 }),
    // Scoped to this element's own subtree — the whole point of the highlight
    // defect is that a group's items are NOT under the tab strip, so a stub
    // whose element queries search the whole document would hide it.
    querySelectorAll: sel => created.filter(e => isUnder(e, el) && matches(e, sel)),
    querySelector: sel => created.find(e => isUnder(e, el) && matches(e, sel)) ?? null,
    closest: () => null,
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    append(...kids) { kids.forEach(k => el.appendChild(k)); },
    prepend(...kids) { kids.forEach(k => el.appendChild(k)); },
    insertBefore(k) { return el.appendChild(k); },
    remove() {},
    focus() {}, click() {}, blur() {},
    children: [], firstChild: null, parentNode: null,
  };
  el.classList = {
    add: c => el._classes.add(c),
    remove: c => el._classes.delete(c),
    contains: c => el._classes.has(c),
    toggle: (c, on) => { const want = on ?? !el._classes.has(c); want ? el._classes.add(c) : el._classes.delete(c); return want; },
  };
  Object.defineProperty(el, 'className', {
    get: () => [...el._classes].join(' '),
    set: v => { el._classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => el._classes.add(c)); },
  });
  created.push(el);
  return el;
}

/** Is `node` inside `root`? Walks the parent chain the stub records. */
function isUnder(node, root) {
  for (let p = node.parentNode; p; p = p.parentNode) if (p === root) return true;
  return false;
}

/** Matches '.cls' and '.cls[data-x="y"]' — all these tests need. */
function matches(el, sel) {
  const m = String(sel).match(/^\.([\w-]+)(?:\[data-([\w-]+)="([^"]*)"\])?$/);
  if (!m) return false;
  const [, cls, attr, val] = m;
  if (!el._classes.has(cls)) return false;
  if (!attr) return true;
  const key = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return String(el.dataset?.[key]) === val;
}

const els = new Map();
const byId = id => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};
const docLtnr = new Map();

globalThis.document = {
  body: makeEl('body'),
  documentElement: makeEl('html'),
  getElementById: byId,
  createElement: () => makeEl(),
  querySelectorAll: sel => created.filter(el => matches(el, sel)),
  querySelector: sel => created.find(el => matches(el, sel)) ?? byId(String(sel).replace(/^[.#]/, '')),
  addEventListener(type, fn) {
    if (!docLtnr.has(type)) docLtnr.set(type, []);
    docLtnr.get(type).push(fn);
  },
  removeEventListener() {},
  activeElement: { tagName: 'BODY' },
};
globalThis.requestAnimationFrame = fn => { fn(0); return 0; };
globalThis.localStorage = { _s: new Map(), getItem(k) { return this._s.get(k) ?? null; }, setItem(k, v) { this._s.set(k, v); }, removeItem(k) { this._s.delete(k); } };
globalThis.window = { addEventListener() {}, removeEventListener() {}, open: () => null };
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', platform: 'linux' }, configurable: true });
}

const fire = (id, type, extra = {}) => {
  const el = byId(id);
  (el._listeners.get(type) ?? []).forEach(fn => fn({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra }));
};
const fireEl = (el, type, extra = {}) =>
  (el._listeners.get(type) ?? []).forEach(fn => fn({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra }));
const fireDoc = (type, extra = {}) =>
  (docLtnr.get(type) ?? []).forEach(fn => fn({ type, preventDefault() {}, stopPropagation() {}, ...extra }));

const menus = () => created.filter(el => el._classes.has('about-tab-group-menu'));
const tabFor = slug => created.find(el => el._classes.has('about-tab') && el.dataset.slug === slug);

before(async () => {
  const { bindAboutModal } = await import('../src/ui/about-modal.js');
  const { bindControls }   = await import('../src/ui/controls.js');
  // controls.js owns the Escape handler; bind it against a fake app, then wire
  // the modal itself. bindControls also calls bindAboutModal, so this is the
  // same order the app boots in.
  bindControls(makeUi());
  bindAboutModal();
  fire('btn-about', 'click');            // lazily builds the tab strip
});

function makeUi() {
  const noop = () => {};
  return {
    audio: { cb: {}, togglePlay: noop, prevTrack: noop, nextTrack: noop, clearPlaylist: noop, addFiles: noop, seek: noop },
    render: {
      vizMode: 'surface', currentMaterial: 'matte', currentParticleStyle: 'squares',
      grid: { visible: false }, orbit: { addEventListener: noop, target: { set: noop } },
      setSurfaceMaterialAnimated: noop, setParticleStyle: noop, setVizModeGPU: noop,
      setGPUModeAnimated: noop, setColorSchemeAnimated: noop, triggerMorphTransition: noop,
      setShape: noop, fadeGrid: noop, camera: { position: { set: noop }, updateProjectionMatrix: noop, up: { set: noop } },
    },
    camera: { autoRot: false, cb: {}, cpParams: {}, cpKeyframes: [], setCamPhysics: noop },
    shaderEditor: { customVS: null, customFS: null },
    modelLoader: { clear: noop },
    mathViz: { setFormula: noop, setVolumeFormula: noop, setMode: noop, deactivate: noop },
    renderPL: noop, _showToast: noop, _renderPresets: noop, savePreset: () => true,
    setLoading: noop, syncVizModeUI: noop, syncDeformUI: noop,
  };
}

describe('the About modal puts everything away', () => {

  test('Escape closes the group dropdown, not just the overlay', () => {
    const menu = menus()[0];
    assert.ok(menu, 'precondition: the grouped docs built a body-level menu');
    menu.style.display = 'block';                      // the trigger opens it
    byId('about-overlay').classList.add('open');

    fireDoc('keydown', { key: 'Escape' });

    assert.equal(byId('about-overlay').classList.contains('open'), false, 'the overlay closes');
    assert.equal(menu.style.display, 'none',
      'the menu lives in document.body, so removing .open from the overlay leaves it on screen');
  });

  test('control — the × button put it away before and still does', () => {
    const menu = menus()[0];
    menu.style.display = 'block';
    byId('about-overlay').classList.add('open');

    fire('about-close', 'click');

    assert.equal(menu.style.display, 'none');
    assert.equal(byId('about-overlay').classList.contains('open'), false);
  });
});

describe('the active tab is highlighted wherever it lives', () => {

  test('an item inside a group gets the highlight', () => {
    const item = tabFor('recording');
    assert.ok(item, 'precondition: the grouped doc built an item');

    fireEl(item, 'click');

    assert.equal(item._classes.has('active'), true,
      'the highlight was looked up inside the tab strip, which a group item is never in');
  });

  test('and loses it again when a standalone tab is chosen', () => {
    const item = tabFor('recording');
    const tab  = tabFor('quick-start');
    fireEl(item, 'click');
    assert.equal(item._classes.has('active'), true, 'precondition');

    fireEl(tab, 'click');

    assert.equal(item._classes.has('active'), false, 'the un-highlight loop must reach it too');
    assert.equal(tab._classes.has('active'), true);
  });

  test('control — the group trigger is highlighted while one of its docs is open', () => {
    fireEl(tabFor('recording'), 'click');
    const trigger = created.find(el => el._classes.has('about-tab-group-trigger'));
    assert.ok(trigger);
    assert.equal(trigger._classes.has('active'), true);
  });
});
