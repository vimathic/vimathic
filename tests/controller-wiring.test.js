// tests/controller-wiring.test.js
//
// The first tests to reach src/ui/controller.js. Until now nothing did: a
// `throw` on its second line left the suite green, because no test file
// imported it, directly or transitively. Its DOM-facing half is driven by the
// Playwright suite (tests/e2e/clip-camera.spec.js says so in writing — the
// clip transport, the SEC/BARS toggle and the hold contract are all e2e's), so
// what is tested here is the half e2e never touches: the playlist repaint, the
// audio-callback merge, and the two lines of bindClip whose damage is layout
// rather than behaviour.
//
// Run:
//   node --test tests/controller-wiring.test.js
//
// ── Defect 1: the SEC/BARS toggle erases the rows' only layout ────────────────
// `_setMode` restored the visible row with `style.display = ''`. The empty
// string REMOVES an inline declaration, which hands the element back to the
// stylesheet — correct only when a stylesheet has something to say. Nothing in
// index.html selects .clip-time-sec or .clip-time-bars: their entire layout is
// the inline `display:flex;gap:6px;align-items:center` on the div. So the rows
// fell to the <div> default `block`, `flex:1` on #clip-hold went inert, and the
// Hold(s) input shrank from 220px to the global input[type=number] 56px —
// measured in Chromium against the real index.html. `_setMode(false)` runs
// unconditionally at the end of bindClip, so that was the state from first
// paint, before the user touched anything.
//
// ── Guards on code that has none anywhere ─────────────────────────────────────
// renderPL carries FIX(#21), the createElement/textContent rewrite that stopped
// a file called `<img src=x onerror=alert(1)>.mp3` executing as markup on every
// playlist repaint. Neither suite asserted it (the e2e specs mention the
// playlist once, in a comment), so reverting it to innerHTML was green. Same
// for the per-row click index and for the constructor's Object.assign into
// audio.cb, whose own comment names wholesale replacement as the trap.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// Same import-order rule as tests/controls-wiring.test.js and
// tests/modals-wiring.test.js: dom.js resolves every REQUIRED id at module
// load, so a document that answers with a stub element is installed BEFORE the
// import. controller.js pulls in controls.js (→ about-modal.js → two Vite
// virtual modules, answered by a resolve hook) and modals.js (→ recorder.js →
// gif.worker as a raw string that touches `self`).

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

globalThis.self = globalThis;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'virtual:vimathic-docs') {
      const DOCS = JSON.stringify([
        { slug: 'quick-start', title: 'Quick Start', group: null, html: '<p>a</p>' },
      ]);
      return {
        url: 'data:text/javascript,export default ' + encodeURIComponent(DOCS),
        shortCircuit: true,
      };
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

// Every innerHTML assignment anywhere in the stub document, in order. The
// playlist test reads this: "built with createElement, never innerHTML" is a
// statement about the whole repaint, not about one span.
const htmlWrites = [];

function makeEl(id = '') {
  const el = {
    id, tagName: 'DIV',
    textContent: '', value: '', checked: false, disabled: false,
    offsetParent: {},
    style: {}, dataset: {}, options: [],
    _classes: new Set(),
    _kids: [],
    _html: '',
    _listeners: new Map(),
    parentNode: null,
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatchEvent() { return true; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10 }),
    getAnimations: () => [],
    appendChild(c) { c.parentNode = this; this._kids.push(c); return c; },
    append(...cs) { cs.forEach(c => this.appendChild(c)); },
    prepend() {}, insertBefore() {},
    remove() {
      const p = this.parentNode;
      if (!p) return;
      p._kids = p._kids.filter(k => k !== this);
      this.parentNode = null;
    },
    // Only the selectors the code under test actually passes.
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, '');
      return this._kids.filter(k => k._classes.has(cls));
    },
    querySelector: () => null,
    // .closest() answers with one stub per selector so a test can look at the
    // element the code reached for — that is where the clip-time rows live.
    closest: sel => bySel(sel),
    focus() {}, blur() {}, click() {},
    requestFullscreen: () => Promise.resolve(),
  };
  el.classList = {
    add: c => el._classes.add(c),
    remove: c => el._classes.delete(c),
    contains: c => el._classes.has(c),
    toggle: (c, on) => {
      const want = on ?? !el._classes.has(c);
      want ? el._classes.add(c) : el._classes.delete(c);
      return want;
    },
  };
  Object.defineProperty(el, 'className', {
    get: () => [...el._classes].join(' '),
    set: v => { el._classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => el._classes.add(c)); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._html,
    set: v => { el._html = String(v); htmlWrites.push({ id: el.id, className: el.className, value: String(v) }); },
  });
  return el;
}

const els    = new Map();
const selEls = new Map();
const byId = id => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};
const bySel = sel => {
  if (!selEls.has(sel)) selEls.set(sel, makeEl(sel));
  return selEls.get(sel);
};

globalThis.document = {
  body: makeEl('body'),
  documentElement: makeEl('html'),
  getElementById: byId,
  createElement: () => makeEl(),
  querySelectorAll: () => [],
  querySelector: sel => bySel(sel),
  addEventListener() {}, removeEventListener() {},
  activeElement: { tagName: 'BODY' },
  fullscreenElement: null,
};
globalThis.requestAnimationFrame = fn => { fn(0); return 0; };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', platform: 'linux' }, configurable: true,
  });
}

let UIController;
before(async () => { ({ UIController } = await import('../src/ui/controller.js')); });

/** Fire the listener the app registered, the way the browser would. */
const fire = (id, type, extra = {}) => {
  const el = byId(id);
  (el._listeners.get(type) ?? []).forEach(fn => fn({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra }));
};

/** The audio engine seeds cb with no-op defaults before the UI ever sees it. */
function makeAudio() {
  return {
    playlist: [], trackIdx: 0, isPlaying: false, estimatedBpm: 120,
    cb: {
      onLiveMode:    () => 'audio-default:onLiveMode',
      onBeat:        () => 'audio-default:onBeat',
      onTrackChange: () => 'audio-default:onTrackChange',
    },
    playAt(i) { this._played.push(i); },
    togglePlay() { this._toggles++; },
    _played: [], _toggles: 0,
  };
}

function makeUi() {
  return new UIController({
    audio: makeAudio(),
    render: {}, camera: {}, shaderEditor: {}, modelLoader: {},
    midi: {}, output: {}, mathViz: {},
  });
}

/** A ClipPlayer stand-in: bindClip only reads these at bind time. */
function makeClip() {
  return {
    barsMode: false, barsCount: 8, playing: false, camOverride: false,
    _steps: [], cb: {},
    setCameraTransitionMs(ms) { this._camMs = ms; },
    buildFromPresets() {}, play() { this.playing = true; }, stop() { this.playing = false; },
    skip() {},
  };
}

let ui;
beforeEach(() => {
  // Reset in place: dom.js resolved its table at import and holds these exact
  // objects, so replacing them would leave the app bound to elements no test
  // can reach.
  for (const el of [...els.values(), ...selEls.values()]) {
    el._classes.clear(); el._listeners.clear(); el._kids.length = 0;
    el.textContent = ''; el.value = ''; el.style = {}; el._html = '';
  }
  htmlWrites.length = 0;
  ui = makeUi();
});

describe('a track name is a name, not markup', () => {

  // FIX(#21) lives in a comment in renderPL and in no assertion anywhere.
  const HOSTILE = '<img src=x onerror=alert(1)>';

  test('a filename full of markup lands in the row as text', () => {
    ui.audio.playlist = [{ name: HOSTILE }, { name: 'quiet track' }];
    ui.renderPL();

    const rows = byId('pl-list').querySelectorAll('.pl-item');
    assert.equal(rows.length, 2, 'precondition: both tracks were drawn');
    const nameSpan = rows[0]._kids.find(k => k._classes.has('pl-name'));
    assert.ok(nameSpan, 'the row keeps its three spans');
    assert.equal(nameSpan.textContent, HOSTILE,
      'the name has to arrive verbatim as text — escaping it would be a second bug');
  });

  test('the repaint writes no innerHTML at all', () => {
    ui.audio.playlist = [{ name: HOSTILE }];
    ui.renderPL();

    assert.deepEqual(htmlWrites, [],
      'one innerHTML anywhere in the repaint is enough to execute the filename: ' +
      JSON.stringify(htmlWrites));
  });
});

describe('the playlist rows point at their own track', () => {

  test('clicking the third row plays the third track', () => {
    ui.audio.playlist = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    ui.renderPL();

    const rows = byId('pl-list').querySelectorAll('.pl-item');
    rows[2].onclick();
    rows[0].onclick();

    assert.deepEqual(ui.audio._played, [2, 0],
      'each row closes over its own index — a shared one plays the same track from every row');
  });

  test('the row for the playing track is the one marked active', () => {
    ui.audio.playlist = [{ name: 'a' }, { name: 'b' }];
    ui.audio.trackIdx = 1;
    ui.audio.isPlaying = true;
    ui.renderPL();

    const rows = byId('pl-list').querySelectorAll('.pl-item');
    assert.equal(rows[0]._classes.has('active'), false);
    assert.equal(rows[1]._classes.has('active'), true);
    assert.equal(rows[1]._kids.find(k => k._classes.has('pl-play')).textContent, '▶',
      'the ▶ marks the row that is sounding');
    assert.equal(byId('pl-count').textContent, '2 tracks');
  });
});

describe('injecting the audio callbacks keeps the ones already there', () => {

  test('the engine defaults survive the UI wiring', () => {
    // The constructor's own comment: a wholesale replacement would drop the
    // no-op defaults AudioEngine seeded and leave a TypeError window for any
    // audio event that fires before bindAll() finishes.
    assert.equal(ui.audio.cb.onBeat(), 'audio-default:onBeat');
    assert.equal(ui.audio.cb.onLiveMode(), 'audio-default:onLiveMode');
    assert.equal(ui.audio.cb.onTrackChange(), 'audio-default:onTrackChange');
  });

  test('and the UI callbacks are the ones now installed', () => {
    ui.audio.playlist = [{ name: 'a' }];
    ui.audio.cb.onPlaylistChange();
    assert.equal(byId('pl-list').querySelectorAll('.pl-item').length, 1,
      'onPlaylistChange has to reach renderPL');

    ui.audio.cb.onPlayState(true);
    assert.equal(byId('play-btn').textContent, '⏸ STOP');
    ui.audio.cb.onPlayState(false);
    assert.equal(byId('play-btn').textContent, '▶ PLAY');
    assert.equal(byId('seek-fill').style.width, '0%', 'stopping resets the seek bar');
  });
});

describe('the SEC / BARS toggle hands the rows a layout they can use', () => {

  // The rows have no stylesheet rule: `display:flex;gap:6px;align-items:center`
  // on the div is the only declaration either of them ever gets, so '' — which
  // removes the declaration — drops them to `block` and takes `flex:1` on the
  // input down with it. tests/controller-shell.test.js pins the other half of
  // this: that index.html really is the only place that display comes from.
  const secRow  = () => bySel('.clip-time-sec');
  const barsRow = () => bySel('.clip-time-bars');

  test('binding the clip leaves the SEC row a flex row', () => {
    ui.bindClip(makeClip());

    assert.equal(secRow().style.display, 'flex',
      "_setMode(false) runs at the end of bindClip, so '' would be the state at first paint");
    assert.equal(barsRow().style.display, 'none');
  });

  test('switching to BARS and back keeps both rows flex when shown', () => {
    ui.bindClip(makeClip());

    fire('clip-mode-bars', 'click');
    assert.equal(secRow().style.display, 'none');
    assert.equal(barsRow().style.display, 'flex');

    fire('clip-mode-sec', 'click');
    assert.equal(secRow().style.display, 'flex');
    assert.equal(barsRow().style.display, 'none');
  });

  test('control — the toggle still moves the mode and the button lights', () => {
    const clip = makeClip();
    ui.bindClip(clip);

    fire('clip-mode-bars', 'click');
    assert.equal(clip.barsMode, true);
    assert.equal(byId('clip-mode-bars')._classes.has('active'), true);
    assert.equal(byId('clip-mode-sec')._classes.has('active'), false);

    fire('clip-mode-sec', 'click');
    assert.equal(clip.barsMode, false);
    assert.equal(byId('clip-mode-sec')._classes.has('active'), true);
  });
});

describe('sync-with-music decorates the play-state callback, it does not take it', () => {

  test('the play button still follows the transport once the clip is bound', () => {
    ui.bindClip(makeClip());

    ui.audio.cb.onPlayState(true);

    assert.equal(byId('play-btn').textContent, '⏸ STOP',
      'bindClip wraps audio.cb.onPlayState; dropping the original call leaves the ' +
      'button, the seek fill and the playlist frozen on whatever they last said');
  });

  test('control — with sync armed, starting the audio starts the clip', () => {
    const clip = makeClip();
    ui.bindClip(clip);
    byId('clip-sync-music').checked = true;
    ui._loadPresetList = () => [{ name: 'p1' }];

    ui.audio.cb.onPlayState(true);
    assert.equal(clip.playing, true);

    ui.audio.cb.onPlayState(false);
    assert.equal(clip.playing, false);
  });
});
