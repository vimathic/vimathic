// tests/overlay-focus.test.js
//
// A dialog that is open holds the keyboard, and gives it back when it closes.
//
// ── What was already solved ─────────────────────────────────────────────────
// The CLOSED half. index.html gives a shut overlay `visibility:hidden`, which
// removes its subtree from the focus order, from hit testing and from the
// accessibility tree at once — before that, 30 of the first 80 tab stops landed
// inside dialogs nobody could see. That is not what this file is about.
//
// ── What was not ────────────────────────────────────────────────────────────
// The OPEN half. An overlay that opened took no focus, gave none back, and held
// none: the backdrop blocks the POINTER only, so Tab walked out of the dialog
// straight into the controls panel behind it. A keyboard user reading the docs
// tabbed into sliders they could not see; closing the shader editor dropped
// focus to <body>, because `visibility:hidden` makes whatever was focused
// inside it unfocusable and the browser has nowhere else to put the ring.
//
// ── How this tests it ───────────────────────────────────────────────────────
// src/ui/overlay-focus.js touches a small, specific slice of the DOM, so the
// slice is what this file implements: class lists, parents, focus, `inert`, and
// an asynchronous MutationObserver — asynchronous on purpose, because the real
// one is a microtask and a synchronous fake would let a broken ordering pass.
//
// One deliberate simplification: the fake querySelectorAll returns the elements
// a test declared focusable rather than matching the CSS selector, because
// implementing a selector engine here would be testing the selector engine. The
// selector itself is asserted separately, against the tags it has to cover.

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── A DOM just wide enough ──────────────────────────────────────────────────

/** Every selector the module has asked for, so one of them can be checked. */
const selectorsSeen = [];

class FakeEl {
  constructor(tag, { id = '', classes = [], focusable = false, rendered = true } = {}) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this._classes = new Set(classes);
    this.childNodes = [];
    this.parent = null;
    this.inert = false;
    this.tabIndex = 0;
    this.isConnected = true;
    this.rendered = rendered;
    this._focusable = focusable;
    this._attrs = new Map();
    this._observers = [];
  }
  get children() { return this.childNodes; }
  get offsetWidth()  { return this.rendered ? 120 : 0; }
  get offsetHeight() { return this.rendered ? 24 : 0; }
  getClientRects()   { return this.rendered ? [{}] : []; }

  get classList() {
    const self = this;
    const fire = () => {
      // Real MutationObserver callbacks are microtasks, not synchronous.
      for (const cb of self._observers) queueMicrotask(cb);
    };
    return {
      contains: c => self._classes.has(c),
      add(c)    { if (!self._classes.has(c)) { self._classes.add(c); fire(); } },
      remove(c) { if (self._classes.delete(c)) fire(); },
    };
  }
  append(...kids) { for (const k of kids) { k.parent = this; this.childNodes.push(k); } return this; }
  contains(el) { for (let n = el; n; n = n.parent) if (n === this) return true; return false; }
  setAttribute(k, v) { this._attrs.set(k, v); }
  getAttribute(k) { return this._attrs.get(k) ?? null; }
  _descendants() { return this.childNodes.flatMap(c => [c, ...c._descendants()]); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    selectorsSeen.push(sel);
    if (sel.includes('data-autofocus')) return [];
    return this._descendants().filter(el => el._focusable);
  }
  focus() {
    // A hidden element cannot take focus, and .focus() on one is a silent no-op
    // — the exact behaviour the module's comment about the 70 ms button
    // transition depends on.
    if (!this.rendered) return;
    doc.activeElement = this;
  }
}

let doc, keyListeners;

function makeDoc(topLevel) {
  const body = new FakeEl('body');
  body.append(...topLevel);
  return {
    body,
    activeElement: body,
    getElementById: id => body._descendants().find(el => el.id === id) ?? null,
    addEventListener(type, fn, capture) { keyListeners.push({ type, fn, capture }); },
    removeEventListener(type, fn) {
      const i = keyListeners.findIndex(l => l.type === type && l.fn === fn);
      if (i >= 0) keyListeners.splice(i, 1);
    },
  };
}

/** Deliver a Tab press to whatever the module registered. */
function pressTab({ shift = false } = {}) {
  let defaultPrevented = false;
  const e = { key: 'Tab', shiftKey: shift, preventDefault() { defaultPrevented = true; } };
  for (const l of keyListeners) if (l.type === 'keydown') l.fn(e);
  return defaultPrevented;
}

const flush = () => new Promise(r => queueMicrotask(r));

// ── Fixture ─────────────────────────────────────────────────────────────────

let bindOverlayFocus, OVERLAY_IDS;
before(async () => {
  ({ bindOverlayFocus, OVERLAY_IDS } = await import('../src/ui/overlay-focus.js'));
});

let panel, panelBtn, overlay, first, mid, last, otherOverlay;

beforeEach(() => {
  keyListeners = [];
  panelBtn = new FakeEl('button', { id: 'btn-open-editor', focusable: true });
  panel = new FakeEl('div', { classes: ['controls-panel'] }).append(panelBtn);

  first = new FakeEl('button', { id: 'se-close', focusable: true });
  mid   = new FakeEl('textarea', { id: 'se-code', focusable: true });
  last  = new FakeEl('button', { id: 'se-btn-apply', focusable: true });
  overlay = new FakeEl('div', { id: 'shader-editor-overlay' }).append(first, mid, last);

  otherOverlay = new FakeEl('div', { id: 'about-overlay' });

  doc = makeDoc([panel, overlay, otherOverlay]);
  globalThis.document = doc;
  globalThis.MutationObserver = class {
    constructor(cb) { this._cb = cb; }
    observe(el) { el._observers.push(this._cb); }
    disconnect() {}
  };

  bindOverlayFocus(['shader-editor-overlay', 'about-overlay']);
  doc.activeElement = panelBtn;          // the button that opens the editor
});

afterEach(() => { keyListeners = []; });

const open  = async () => { overlay.classList.add('open');    await flush(); };
const close = async () => { overlay.classList.remove('open'); await flush(); };

describe('opening a dialog takes the keyboard', () => {

  test('focus moves into the dialog', async () => {
    await open();
    assert.ok(overlay.contains(doc.activeElement),
      'focus stayed on the panel behind the dialog');
  });

  test('the background is made inert', async () => {
    await open();
    assert.equal(panel.inert, true,
      'the controls panel is still focusable behind the backdrop, which blocks the pointer only');
    assert.equal(overlay.inert, false, 'the dialog inerted itself');
  });

  test('the dialog itself takes focus, not a control that is still transitioning', async () => {
    // index.html records that the buttons inside carry `transition:all .15s` and
    // are still hidden for ~70 ms after the overlay opens. focus() on a hidden
    // element is a silent no-op, so aiming at the first button would leave focus
    // on the panel with the trap armed around it.
    for (const el of [first, mid, last]) el.rendered = false;
    await open();
    assert.equal(doc.activeElement, overlay,
      'focus was aimed at a control that was not focusable yet and went nowhere');
  });

  test('the dialog is given a tabindex so it can hold focus at all', async () => {
    await open();
    assert.equal(overlay.tabIndex, -1);
  });
});

describe('Tab cannot leave an open dialog', () => {

  test('Tab off the last control wraps to the first', async () => {
    await open();
    last.focus();
    assert.equal(pressTab(), true, 'Tab was allowed out of the dialog');
    assert.equal(doc.activeElement, first);
  });

  test('Shift+Tab off the first control wraps to the last', async () => {
    await open();
    first.focus();
    assert.equal(pressTab({ shift: true }), true);
    assert.equal(doc.activeElement, last);
  });

  test('Tab in the middle of the dialog is left to the browser', async () => {
    await open();
    mid.focus();
    assert.equal(pressTab(), false,
      'the trap preventDefaulted a Tab it should have let through, so the dialog ' +
      'has two focusable controls that can never be reached');
    assert.equal(doc.activeElement, mid, 'the trap moved focus when it should not have');
  });

  test('focus that has somehow escaped is pulled back in', async () => {
    await open();
    doc.activeElement = panelBtn;
    pressTab();
    assert.ok(overlay.contains(doc.activeElement));
  });

  test('a dialog with nothing focusable swallows Tab rather than releasing it', async () => {
    for (const el of [first, mid, last]) el._focusable = false;
    await open();
    assert.equal(pressTab(), true, 'Tab escaped an empty dialog into the panel behind it');
  });

  test('the trap is bound in the capture phase', async () => {
    // The editors handle keys on the way up — Ctrl+S applies, the code textarea
    // takes everything else — so the trap has to decide first.
    await open();
    const tabTrap = keyListeners.find(l => l.type === 'keydown');
    assert.ok(tabTrap, 'no keydown listener was installed');
    assert.equal(tabTrap.capture, true);
  });

  test('control — nothing is trapped while every dialog is shut', () => {
    assert.equal(keyListeners.filter(l => l.type === 'keydown').length, 0,
      'a closed dialog is holding the keyboard');
    assert.equal(panel.inert, false, 'the panel is inert with no dialog open');
  });
});

describe('closing gives the keyboard back', () => {

  test('focus returns to whatever opened the dialog', async () => {
    await open();
    await close();
    assert.equal(doc.activeElement, panelBtn,
      'focus was left on <body> — visibility:hidden makes the focused element inside ' +
      'the dialog unfocusable, so the ring goes to the top of the document');
  });

  test('the background is released', async () => {
    await open();
    await close();
    assert.equal(panel.inert, false, 'the panel was left inert with no dialog open');
  });

  test('the trap is removed', async () => {
    await open();
    await close();
    assert.equal(keyListeners.filter(l => l.type === 'keydown').length, 0,
      'the Tab trap outlived the dialog it belonged to');
  });

  test('an opener that has gone away does not throw', async () => {
    await open();
    panelBtn.isConnected = false;        // the preset list is rebuilt while a dialog is up
    await assert.doesNotReject(close());
  });

  test('an opener that is no longer rendered is not focused', async () => {
    await open();
    panelBtn.rendered = false;
    await close();
    assert.notEqual(doc.activeElement, panelBtn);
  });
});

describe('two dialogs do not release the background early', () => {

  test('the panel stays inert until the last one closes', async () => {
    await open();
    otherOverlay.classList.add('open');
    await flush();
    await close();
    assert.equal(panel.inert, true,
      'closing one dialog released the page while another was still up');

    otherOverlay.classList.remove('open');
    await flush();
    assert.equal(panel.inert, false, 'the page was never released');
  });
});

describe('the wiring is complete', () => {

  test('the selector covers every tag a dialog here uses', async () => {
    // The fake querySelectorAll ignores the selector — implementing a selector
    // engine here would be testing the selector engine — so the string itself
    // is what gets checked. It is the one used to find focusables, not the
    // [data-autofocus] probe that runs alongside it.
    await open();
    last.focus();
    pressTab();
    const focusableSel = selectorsSeen.filter(s => !s.includes('data-autofocus')).at(-1);
    assert.ok(focusableSel, 'the module never asked for the focusable elements');
    for (const needle of ['a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'tabindex']) {
      assert.ok(focusableSel.includes(needle),
        `the focusable selector does not mention ${needle}: ${focusableSel}`);
    }
    assert.ok(focusableSel.includes(':not([disabled])'),
      'a disabled control is not a tab stop, and the trap would stop on one');
    assert.ok(focusableSel.includes('[tabindex="-1"]'),
      'tabindex="-1" elements are focusable by script but are not tab stops');
  });

  test('every dialog the Escape handler closes is also focus-managed', () => {
    const controls = fs.readFileSync(path.join(ROOT, 'src/ui/controls.js'), 'utf8');
    const escapeList = controls.match(/\[([^\]]*?overlay[^\]]*?)\]\.forEach/s);
    assert.ok(escapeList, 'the Escape handler no longer closes a list of overlay ids');
    const ids = [...escapeList[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert.ok(ids.length >= 4, `only found ${ids.length} ids in the Escape list`);
    for (const id of ids) {
      assert.ok(OVERLAY_IDS.includes(id),
        `${id} is closed by Escape but never had its focus managed — the two lists have drifted`);
    }
    assert.ok(OVERLAY_IDS.includes('about-overlay'),
      'About goes through closeAbout() rather than that list, and still needs the trap');
  });

  test('every managed dialog declares itself a dialog in the HTML', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const id of OVERLAY_IDS) {
      const tag = html.match(new RegExp(`<div id="${id}"[^>]*>`));
      assert.ok(tag, `${id} is not in index.html`);
      assert.match(tag[0], /role="dialog"/, `${id} has no role="dialog"`);
      assert.match(tag[0], /aria-modal="true"/, `${id} does not claim to be modal`);
      assert.match(tag[0], /aria-labelledby="/, `${id} is a dialog with no accessible name`);
    }
  });

  test('each aria-labelledby points at an element that exists', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const id of OVERLAY_IDS) {
      const label = html.match(new RegExp(`<div id="${id}"[^>]*aria-labelledby="([^"]+)"`))[1];
      assert.ok(html.includes(`id="${label}"`),
        `${id} is labelled by #${label}, which is not in the document`);
    }
  });

  test('controls.js binds it', () => {
    const controls = fs.readFileSync(path.join(ROOT, 'src/ui/controls.js'), 'utf8');
    assert.match(controls, /bindOverlayFocus\(\)/);
    // The IMPORT, not one exact spelling of it. This used to pin a single-name
    // braces group, so importing a SECOND name from the same module — which is
    // what isAnyOverlayOpen needed — turned it red for a change that broke
    // nothing. A guard that fires on a comma teaches people to shape source to
    // fit a regexp, which is the lesson tests/helpers/glsl.js exists to record
    // one level down.
    assert.match(controls, /import\s*\{[^}]*\bbindOverlayFocus\b[^}]*\}\s*from\s*'\.\/overlay-focus\.js'/);
  });

  test('the hotkey listeners stand down for EVERY dialog, not just About', () => {
    // The defect: both global keydown listeners asked isAboutModalOpen(), so
    // D, F, R, T and Space stayed live over the other four overlays. The worst
    // of them is the shader editor — overlay-focus parks focus on the overlay
    // container, dom.js does not treat a bare DIV as owning a key, and the
    // overlay blacks the canvas out at 82%, so the scene was randomised behind
    // a screen the operator could not see.
    const main     = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
    const controls = fs.readFileSync(path.join(ROOT, 'src/ui/controls.js'), 'utf8');
    for (const [name, src] of [['src/main.js', main], ['src/ui/controls.js', controls]]) {
      assert.match(src, /isAnyOverlayOpen\(\)/,
        `${name} does not stand its hotkeys down for every overlay`);
      assert.doesNotMatch(src, /if \(isAboutModalOpen\(\)\) return;/,
        `${name} still gates on About alone`);
    }
    // And a modified key belongs to the browser: Ctrl+R ran the randomise-all
    // hotkey before the reload it was asking for, and autosave stored it.
    assert.match(main, /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/,
      'a modified key still reaches the hotkey switch');
  });

  test('a dialog may own a part outside itself, and it is not made inert', () => {
    // About's tab-group dropdowns are appended to document.body on purpose, to
    // escape the overlay's overflow and stacking context. refreshBackground
    // took "a body child that is not the dialog" to mean "background" and
    // inerted them — so eleven of the thirteen documentation tabs were
    // unreachable in the dialog that opens itself on a new profile.
    const focus = fs.readFileSync(path.join(ROOT, 'src/ui/overlay-focus.js'), 'utf8');
    const about = fs.readFileSync(path.join(ROOT, 'src/ui/about-modal.js'), 'utf8');
    assert.match(focus, /overlayPart/,
      'refreshBackground no longer recognises a dialog part outside the dialog');
    assert.match(about, /dataset\.overlayPart\s*=\s*'about-overlay'/,
      'the About group menu no longer marks itself as part of the dialog');
  });
});

describe('isAnyOverlayOpen', () => {
  let isAnyOverlayOpen, OVERLAY_IDS;
  before(async () => {
    ({ isAnyOverlayOpen, OVERLAY_IDS } = await import('../src/ui/overlay-focus.js'));
  });

  const withOpen = (openIds) => {
    globalThis.document = {
      getElementById: id => ({ classList: { contains: c => c === 'open' && openIds.includes(id) } }),
    };
  };

  test('false when every dialog is shut', () => {
    withOpen([]);
    assert.equal(isAnyOverlayOpen(), false);
  });

  test('true for each one of them in turn — not just About', () => {
    for (const id of OVERLAY_IDS) {
      withOpen([id]);
      assert.equal(isAnyOverlayOpen(), true, `${id} being open was not noticed`);
    }
  });

  test('an overlay missing from a trimmed build is not an open one', () => {
    // second-screen.html carries none of these.
    globalThis.document = { getElementById: () => null };
    assert.equal(isAnyOverlayOpen(), false);
  });
});
