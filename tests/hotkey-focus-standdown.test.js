// tests/hotkey-focus-standdown.test.js
//
// The global hotkeys stand down when the focused element already means
// something by the key that was pressed.
//
// Both keydown listeners used to carry their own copy of the rule, spelled
// `['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)`.
// That list covers what you TYPE into and misses what you ACTIVATE with a key:
// a focused <button> reports BUTTON, a focused <summary> reports SUMMARY, and
// neither was excluded. So `e.preventDefault()` in main.js cancelled the
// element's own activation and ran the hotkey instead. Measured in Chrome: tab
// to ☾ NIGHT, press Space — the button's class is unchanged, NIGHT did not
// toggle, and the transport reads ⏸ STOP. It was filed as a dead keypress; it
// was a keypress that did something else. index.html carries 63 buttons and 7
// <summary> elements, and one of those summaries is ADVANCED — audio
// sensitivity, presets, model import, both editors, video output and MIDI, all
// behind a disclosure a keyboard user could not open.
//
// The rule is per key, not per element. Standing down for every keystroke while
// a button has focus is the one-line version and it is wrong here: clicking any
// button with the mouse leaves it focused, and D / F / R / T are performance
// hotkeys that have to keep working after a click. A button consumes Space and
// Enter; it gets to keep Space and Enter and nothing more.
//
// FIX(review K1): <input> was the one element that rule never reached — any
// focused INPUT owned every key. The panel's pickers are readOnly text fields
// that keep focus after a mouse pick (index.html, makeDropdown), and Chrome
// focuses a range slider when it is dragged, so "pick a numbered shader, then
// hold Y" did nothing until the canvas was clicked, and neither did D / F / R /
// T after a slider had been touched. An input now owns what its type reads: a
// writable text field every key, a readOnly one (the pickers) the keys its
// list handler reads, a range its stepping keys, a checkbox Space, the
// button-like types Space and Enter. Letters pass through all but the writable
// field.
//
// FIX(review RR-C3 / RR-LIVE-1): "the keys its list handler reads" is ↑ ↓ Enter
// Esc. The picker used to keep the side arrows, Home, End, Page Up / Down and
// Space as well — the keys a list could in principle be driven by — and acted
// on none of them, so Space and ← / → were dead after a pick until the canvas
// was clicked. The handler in index.html is the source of truth, and a source
// read below holds dom.js's PICKER_KEYS to it, both ways.
//
// The matrix below is the contract. The two source assertions at the end are
// what stop the rule being re-inlined into one listener and drifting again.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elementOwnsKey } from '../src/dom.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * Source with comment lines removed.
 *
 * The first version of the assertion below did not do this and failed on the
 * comment that explains the fix — the replacement quotes the old spelling in
 * order to say what it replaced, and a regexp looking for that spelling found
 * it there. tests/build-pipeline-guards.test.js:188-194 records the same trap
 * from the other direction: a guard that read a glob out of a file's text
 * matched the copy inside that file's own comment, so mutating the real one
 * left the test green.
 *
 * Whole-line only, deliberately. Stripping `//` wherever it appears would eat
 * the tail of any line holding a URL, and a negative assertion that quietly
 * stops seeing code is worse than one that fails loudly.
 */
const code = p => read(p)
  .split('\n')
  .filter(line => {
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  })
  .join('\n');

// Minimal stand-ins: elementOwnsKey reads tagName, isContentEditable, disabled,
// hasAttribute, and an input's type and readOnly, and nothing else. Keeping
// them plain objects means this runs in Node with no DOM implementation.
const el = (tagName, extra = {}) => ({ tagName, ...extra });

const HOTKEYS   = [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'd', 't', 'f', 'r', 'l', 'k', 'a', 's'];
const ACTIVATES = [' ', 'Enter'];

describe('elementOwnsKey — what the focused element consumes', () => {

  test('a text-entry element owns every key', () => {
    // An INPUT with no type is a text field, as in a browser.
    for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) {
      for (const key of HOTKEYS) {
        assert.equal(elementOwnsKey(el(tag), key), true,
          `${tag} must swallow ${JSON.stringify(key)} — typing into a field is not a hotkey`);
      }
    }
    for (const type of ['text', 'search', 'number', 'email', 'url', 'tel', 'password', 'date']) {
      for (const key of [...HOTKEYS, 'y', 'h', '5']) {
        assert.equal(elementOwnsKey(el('INPUT', { type }), key), true,
          `a writable ${type} field must swallow ${JSON.stringify(key)}`);
      }
    }
  });

  test('a button and a summary own exactly their activation keys', () => {
    for (const tag of ['BUTTON', 'SUMMARY']) {
      for (const key of ACTIVATES) {
        assert.equal(elementOwnsKey(el(tag), key), true,
          `${tag} is activated by ${JSON.stringify(key)}; preventing it steals the press`);
      }
      for (const key of HOTKEYS.filter(k => !ACTIVATES.includes(k))) {
        assert.equal(elementOwnsKey(el(tag), key), false,
          `${tag} does nothing with ${JSON.stringify(key)} — the hotkey must still fire, or ` +
          'clicking any button would disarm D / F / R / T for the rest of the set');
      }
    }
  });

  test('Space is recognised however the browser spells it', () => {
    assert.equal(elementOwnsKey(el('BUTTON'), ' '), true);
    assert.equal(elementOwnsKey(el('BUTTON'), 'Spacebar'), true);
    assert.equal(elementOwnsKey(el('BUTTON'), 'ENTER'), true, 'the comparison is case-folded');
  });

  test('a disabled button activates on nothing', () => {
    assert.equal(elementOwnsKey(el('BUTTON', { disabled: true }), ' '), false);
    assert.equal(elementOwnsKey(el('BUTTON', { disabled: true }), 'Enter'), false);
  });

  test('a link follows on Enter only, and only when it is a link', () => {
    const link   = el('A', { hasAttribute: n => n === 'href' });
    const anchor = el('A', { hasAttribute: () => false });
    assert.equal(elementOwnsKey(link, 'Enter'), true);
    assert.equal(elementOwnsKey(link, ' '), false, 'Space scrolls on a link; no listener wants that back');
    assert.equal(elementOwnsKey(anchor, 'Enter'), false, 'an <a> without href is not focusable as a link');
  });

  test('a contenteditable host owns everything whatever its tag says', () => {
    assert.equal(elementOwnsKey(el('DIV', { isContentEditable: true }), 'd'), true);
    assert.equal(elementOwnsKey(el('DIV'), 'd'), false);
  });

  test('no focus, no owner', () => {
    // document.activeElement is null during teardown, and the old rule read
    // .tagName off it unguarded.
    assert.equal(elementOwnsKey(null, ' '), false);
    assert.equal(elementOwnsKey(undefined, ' '), false);
  });
});

// FIX(review K1): an input owns what its type reads, not every key. The two
// that matter in this app are the panel's pickers — readOnly text fields that
// keep focus after a mouse pick — and the range sliders a mouse drag focuses.
describe('elementOwnsKey — an input owns the keys its type reads, and only those', () => {
  // What index.html's makeDropdown builds for 3D SHAPE, SHADER MODE, COLOR
  // SCHEME and VOLUME FORMULA: type text, readOnly, focusable.
  const picker = () => el('INPUT', { type: 'text', readOnly: true });
  // What the picker's keydown handler in index.html acts on (the source read in
  // the next describe holds dom.js to the handler; this holds the answers).
  const PICKER_KEYS = ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'];
  // The keys main.js plays the music with, and the rest of the keys a list
  // could be driven by — none of which the picker reads.
  const NOT_READ = [' ', 'Spacebar', 'ArrowLeft', 'ArrowRight', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown'];
  // The drag letters (Y U H J among them), the tap letters and a digit.
  const LETTERS = ['y', 'u', 'h', 'j', 'b', 'n', 'l', 'd', 'f', 'r', 't', 'i', 'p', '5', 'Y'];

  test('a readOnly picker lets every letter and digit through', () => {
    for (const key of LETTERS) {
      assert.equal(elementOwnsKey(picker(), key), false,
        `the picker took ${JSON.stringify(key)} — after a pick with the mouse, that hotkey is dead ` +
        'until the canvas is clicked');
    }
  });

  test('…and Space, the side arrows, Home, End and the Page keys, which it does nothing with', () => {
    // FIX(review RR-LIVE-1): measured in Chrome after a mouse pick in SHADER
    // MODE — Space, ← and → reached neither main.js nor the picker, so the
    // music could not be paused or skipped until the canvas was clicked.
    for (const key of NOT_READ) {
      assert.equal(elementOwnsKey(picker(), key), false,
        `the picker took ${JSON.stringify(key)} and does nothing with it — that hotkey is dead ` +
        'after a pick until the canvas is clicked');
    }
  });

  test('control — it keeps exactly the keys its list handler reads', () => {
    for (const key of PICKER_KEYS) {
      assert.equal(elementOwnsKey(picker(), key), true,
        `the picker gave up ${JSON.stringify(key)}, which it acts on`);
    }
    assert.equal(elementOwnsKey(picker(), 'Esc'), true, 'Escape in its old spelling');
    assert.equal(elementOwnsKey(picker(), 'Up'), true, 'ArrowUp in its old spelling');
    assert.equal(elementOwnsKey(picker(), 'Down'), true, 'ArrowDown in its old spelling');
    assert.equal(elementOwnsKey(picker(), 'ENTER'), true, 'the comparison is case-folded');
  });

  test('control — a writable text field still owns the same letters', () => {
    // The picker passes letters because it is readOnly, not because it is an
    // INPUT of type text: the preset name and a value badge being typed into
    // are the same element without the flag.
    for (const key of LETTERS) {
      assert.equal(elementOwnsKey(el('INPUT', { type: 'text', readOnly: false }), key), true,
        `a writable field let ${JSON.stringify(key)} through — typing a name would play the knobs`);
    }
  });

  test('a range slider keeps its stepping keys and lets letters through', () => {
    const range = () => el('INPUT', { type: 'range' });
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      assert.equal(elementOwnsKey(range(), key), true, `a slider gave up ${JSON.stringify(key)}, which steps it`);
    }
    for (const key of ['h', 'y', 'd', 'r', ' ', 'Enter']) {
      assert.equal(elementOwnsKey(range(), key), false,
        `a slider took ${JSON.stringify(key)}, which it does nothing with`);
    }
    assert.equal(elementOwnsKey(el('INPUT', { type: 'RANGE' }), 'h'), false, 'the type is read case-folded');
  });

  test('a checkbox owns Space, a radio Space and the arrows, and neither a letter', () => {
    const box = () => el('INPUT', { type: 'checkbox' });
    assert.equal(elementOwnsKey(box(), ' '), true);
    for (const key of ['y', 'Enter', 'ArrowDown']) assert.equal(elementOwnsKey(box(), key), false, key);
    const radio = () => el('INPUT', { type: 'radio' });
    for (const key of [' ', 'ArrowDown', 'ArrowRight']) assert.equal(elementOwnsKey(radio(), key), true, key);
    assert.equal(elementOwnsKey(radio(), 'y'), false);
  });

  test('the button-like inputs own Space and Enter, as a <button> does', () => {
    for (const type of ['button', 'submit', 'reset', 'image', 'color', 'file']) {
      for (const key of ACTIVATES) assert.equal(elementOwnsKey(el('INPUT', { type }), key), true, `${type} ${key}`);
      for (const key of ['y', 'd', 'ArrowLeft']) assert.equal(elementOwnsKey(el('INPUT', { type }), key), false, `${type} ${key}`);
    }
  });

  test('control — SELECT still owns letters (native type-ahead), and the BUTTON rule is unchanged', () => {
    assert.equal(elementOwnsKey(el('SELECT'), 'y'), true);
    assert.equal(elementOwnsKey(el('TEXTAREA'), 'y'), true);
    assert.equal(elementOwnsKey(el('BUTTON'), 'y'), false);
    assert.equal(elementOwnsKey(el('BUTTON'), ' '), true);
    assert.equal(elementOwnsKey(el('BUTTON'), 'Enter'), true);
  });

  test('control — a disabled input owns nothing, readOnly or not', () => {
    // It takes no focus and no key, like a disabled button. Without this the
    // readOnly branch could answer for an element that is not live at all.
    const off = el('INPUT', { type: 'text', readOnly: true, disabled: true });
    for (const key of ['y', 'ArrowDown', 'Enter', ' ']) {
      assert.equal(elementOwnsKey(off, key), false, `a disabled picker owned ${JSON.stringify(key)}`);
    }
    assert.equal(elementOwnsKey(el('INPUT', { type: 'range', disabled: true }), 'ArrowLeft'), false);
  });
});

// ── FIX(review RR-C3 / RR-LIVE-1): the picker keeps what its handler reads ─────
// PICKER_KEYS in dom.js and the picker's keydown handler in index.html
// (makeDropdown) are two statements of one fact, in two files nothing tied
// together — which is how the set came to hold seven keys the widget ignores.
// The handler is the source of truth: this reads the keys it compares e.key
// against and the set dom.js keeps, and holds them to each other both ways.

/** index.html's makeDropdown, from its declaration to the `}` that closes it at column 0. */
function makeDropdownSrc(html = read('index.html')) {
  const at = html.indexOf('function makeDropdown(');
  assert.ok(at >= 0, 'index.html no longer declares makeDropdown');
  const end = html.indexOf('\n}', at);
  assert.ok(end > at, 'makeDropdown has no closing `}` at column 0');
  return html.slice(at, end);
}

/**
 * The keys the picker's keydown handler reads: the literals it compares
 * `e.key` against, and any other read of the key it makes (`e.code`, a
 * `switch`, another operator), which this reader would not see and so reports.
 */
function pickerHandlerKeys(fn = makeDropdownSrc()) {
  const listeners = [...fn.matchAll(/addEventListener\(\s*'(key\w*)'/g)].map(m => m[1]);
  assert.deepEqual(listeners, ['keydown'],
    `makeDropdown listens for ${listeners.join(', ') || 'no key event'}; this reader expects one keydown handler`);
  const at = fn.indexOf("input.addEventListener('keydown'");
  assert.ok(at >= 0, "makeDropdown's keydown handler is no longer on the picker's `input`");
  const end = fn.indexOf('\n  });', at);
  assert.ok(end > at, "the picker's keydown handler has no closing `});` where this reader expects it");
  const body = fn.slice(at, end);
  const COMPARE = /\be\.key\s*===\s*'([^']+)'/g;
  const keys = [...body.matchAll(COMPARE)].map(m => m[1]);
  const other = body.replace(COMPARE, '').match(/\be\.(?:key|code|keyCode|which|charCode)\b/g) ?? [];
  return { keys, other };
}

/** dom.js's PICKER_KEYS, as the literal list it is declared with. */
function pickerKeysListed(src = code('src/dom.js')) {
  const m = src.match(/const PICKER_KEYS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'dom.js no longer declares PICKER_KEYS as a literal list this test can read');
  assert.doesNotMatch(m[1], /\.\.\./, 'PICKER_KEYS spreads another set — list its keys, so they can be read here');
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}

// The old spellings dom.js accepts beside the standard names (IE / old Edge).
const OLD_SPELLING = { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', esc: 'escape', spacebar: ' ' };

/** Every way the handler and PICKER_KEYS disagree, as sentences. */
function pickerDisagreements(handler, listed) {
  const reads = new Set(handler.keys.map(k => k.toLowerCase()));
  const bad = handler.other.map(o => `the picker's handler reads the key through \`${o}\`, which this test cannot follow`);
  for (const k of reads) {
    if (!listed.includes(k)) bad.push(`the picker's handler reads ${JSON.stringify(k)}, and PICKER_KEYS lets it through to the hotkeys`);
  }
  for (const k of listed) {
    if (!reads.has(OLD_SPELLING[k] ?? k)) {
      bad.push(`PICKER_KEYS keeps ${JSON.stringify(k)} from the hotkeys, and the picker's handler does nothing with it`);
    }
  }
  return bad;
}

describe('PICKER_KEYS is the picker\'s own keydown handler, read from index.html', () => {
  const picker = () => el('INPUT', { type: 'text', readOnly: true });

  test('the keys dom.js keeps for a picker are the keys its handler reads, both ways', () => {
    const handler = pickerHandlerKeys();
    const bad = pickerDisagreements(handler, pickerKeysListed());
    assert.deepEqual(bad, [], 'src/dom.js PICKER_KEYS and index.html makeDropdown disagree:\n  ' + bad.join('\n  '));
    // …and elementOwnsKey answers from that set, in the handler's own spelling.
    for (const key of handler.keys) {
      assert.equal(elementOwnsKey(picker(), key), true, `a focused picker let ${JSON.stringify(key)} through, which it acts on`);
    }
  });

  test('control — the readers find the real handler and the real set, and the check sees either one move', () => {
    const handler = pickerHandlerKeys();
    for (const key of ['ArrowDown', 'ArrowUp', 'Escape']) {
      assert.ok(handler.keys.includes(key), `the handler reader did not find ${key}, which index.html handles`);
    }
    assert.deepEqual(handler.other, []);
    assert.ok(pickerKeysListed().includes('arrowdown'), 'the PICKER_KEYS reader did not find the set');

    // A line added at the top of the handler — the one anchor the reader
    // itself needs, so rewording any line of the handler leaves this standing.
    const fn = makeDropdownSrc();
    const OPEN = "input.addEventListener('keydown', e => {\n";
    const withLine = line => fn.replace(OPEN, OPEN + line + '\n');
    assert.notEqual(withLine('x'), fn, 'precondition: the handler opens where the reader expects it');

    // A key the handler learns, and dom.js does not.
    assert.ok(pickerDisagreements(pickerHandlerKeys(withLine("    if (e.key === 'Home') { step(-1e9); return; }")), pickerKeysListed())
      .some(s => s.includes('reads "home"')), 'a key the handler reads and dom.js lets through was not noticed');

    // The set as it stood at acc6a4c: seven keys the widget ignores.
    const OLD = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'up', 'down', 'left', 'right',
                 'home', 'end', 'pageup', 'pagedown', 'enter', 'escape', 'esc', ' ', 'spacebar'];
    const bad = pickerDisagreements(handler, OLD);
    for (const want of ['keeps " "', 'keeps "arrowright"', 'keeps "arrowleft"', 'keeps "home"', 'keeps "pagedown"']) {
      assert.ok(bad.some(s => s.includes(want)), `the check did not notice: ${want}\n  ${bad.join('\n  ')}`);
    }

    // A handler that reads the key some other way is reported, not trusted.
    assert.ok(pickerDisagreements(pickerHandlerKeys(withLine("    if (e.code === 'KeyQ') { open(); return; }")), pickerKeysListed())
      .some(s => s.includes('cannot follow')), 'a key read through e.code was skipped silently');
  });
});

// ── FIX(review RR-C1): what the plain drop-downs still do, and what the docs say ─
// A native <select> keeps every key (dom.js: a closed one jumps to the option a
// typed letter starts), and after a mouse pick it keeps focus. The panel's
// selects that index.html's makeDropdown does not wrap therefore stand the
// hotkeys down until the canvas is clicked, and documents/hotkeys.md has to say
// so by name. That behaviour is an owner decision; the test only holds the
// document to it, and goes red when a new plain drop-down joins the panel.

// The plain drop-downs of the panel, with the name hotkeys.md gives each.
const PLAIN_DROPDOWNS = {
  'surface-material-sel': 'Surface Material',
  'particle-style-sel':   'Particle Style',
  'wire-style-sel':       'Wire Style',
  'clip-bars':            'Bars',
  'clip-cam-mode':        'Camera',
};
// The visible label of MIDI mapping's add row, src/ui/modals.js _makeAddRow.
const MIDI_ADD_LABEL = '+ Add parameter…';
// What plainPanelSelects puts in place of the id of a <select> that has none.
const NO_ID = 'no id: ';

/**
 * The <select> ids inside #controls-panel that makeDropdown does not wrap.
 *
 * FIX(review RR3-C3): this matched `<select id="…"` only, so a select written
 * with another attribute first (`<select class="x" id="clip-new">`) was not
 * seen and could join the panel unnamed. Any attribute order is read now, and
 * a <select> with no id at all — which this test could neither name nor check
 * against makeDropdown — comes back as NO_ID followed by its tag, and the
 * check below reports it. (`\sid=`, not `\bid=`, so a `data-id` is not read
 * as the id.)
 */
function plainPanelSelects(html = read('index.html')) {
  const from = html.indexOf('id="controls-panel"');
  const to = html.indexOf('id="shader-editor-overlay"', from);
  assert.ok(from >= 0 && to > from, 'index.html no longer has #controls-panel followed by the editor overlay');
  const ids = [...html.slice(from, to).matchAll(/<select\b[^>]*>/g)].map(([tag]) =>
    tag.match(/\sid="([^"]+)"/)?.[1] ?? `${NO_ID}${tag}`);
  const wrapped = new Set([...html.matchAll(/makeDropdown\('([^']+)'\)/g)].map(m => m[1]));
  return ids.filter(id => !wrapped.has(id));
}

/** hotkeys.md's first paragraph: the one under the title. */
function hotkeysIntro(md = read('documents/hotkeys.md')) {
  const at = md.indexOf('\n# Hotkeys\n');
  assert.ok(at >= 0, 'documents/hotkeys.md has no "# Hotkeys" title');
  return md.slice(at).split('\n\n')[1] ?? '';
}

/** Every way the intro and the panel's plain drop-downs disagree, as sentences. */
function plainDropdownDisagreements(selects, intro, modalsSrc) {
  const bad = [];
  for (const id of selects) {
    if (id.startsWith(NO_ID)) bad.push(`a <select> in the panel has no id, so this test cannot tell whether makeDropdown wraps it or what hotkeys.md calls it: ${id.slice(NO_ID.length)}`);
    else if (!(id in PLAIN_DROPDOWNS)) bad.push(`#${id} is a plain drop-down in the panel, and this test does not know what hotkeys.md calls it`);
  }
  for (const [id, name] of Object.entries(PLAIN_DROPDOWNS)) {
    if (!selects.includes(id)) bad.push(`#${id} is no longer a plain drop-down in the panel`);
    else if (!intro.includes(name)) bad.push(`hotkeys.md does not name ${name} (#${id}) among the drop-downs that keep every key`);
  }
  if (!intro.includes('clip player')) bad.push('hotkeys.md does not say Bars and Camera are the clip player\'s');
  // FIX(review RR3-C2): this asked only for the words "MIDI mapping", and the
  // paragraph said "the lists in MIDI mapping" keep every key. A CC row's list
  // gives them back once a pick changes its value: its change handler
  // re-renders the mapping list, the focused <select> leaves the page and
  // focus falls back to the body (a pick of the same option fires no change
  // and keeps focus, like any plain drop-down — FIX(review RR4-2)). The add row's
  // list (labelled "+ Add parameter…", no change handler) is the one that
  // keeps focus, so that is the one the paragraph has to name.
  if (/createElement\('select'\)/.test(modalsSrc)) {
    if (!modalsSrc.includes(`'${MIDI_ADD_LABEL}'`)) {
      bad.push(`src/ui/modals.js builds a <select> and none is labelled "${MIDI_ADD_LABEL}" any more — this test does not know what hotkeys.md calls it`);
    } else if (!intro.includes(MIDI_ADD_LABEL) || !/MIDI mapping/i.test(intro)) {
      bad.push(`hotkeys.md does not name the "${MIDI_ADD_LABEL}" list in MIDI mapping, a plain drop-down that keeps every key after a pick (src/ui/modals.js)`);
    }
  }
  if (/\blists in MIDI mapping\b|\bMIDI mapping lists\b/i.test(intro)) {
    bad.push('hotkeys.md says the MIDI mapping lists keep every key — a CC row\'s list gives the keys back once a pick changes its value; only the add row\'s list keeps them after every pick');
  }
  if (!/click the canvas/i.test(intro)) bad.push('hotkeys.md does not say how to give the keys back after one of them');
  return bad;
}

describe('hotkeys.md names the drop-downs that still stand the hotkeys down', () => {

  test('every plain drop-down in the panel is named in the first paragraph, with the way back', () => {
    // Only true while a <select> owns every key; if that changes, so does the paragraph.
    assert.equal(elementOwnsKey(el('SELECT'), 'y'), true, 'precondition: a focused <select> owns letters');
    const bad = plainDropdownDisagreements(plainPanelSelects(), hotkeysIntro(), code('src/ui/modals.js'));
    assert.deepEqual(bad, [], 'documents/hotkeys.md and the panel disagree:\n  ' + bad.join('\n  '));
  });

  test('control — a new plain drop-down, in any attribute order or with no id, or a name dropped from the paragraph, is caught', () => {
    assert.ok(plainPanelSelects().includes('surface-material-sel'), 'the select reader did not read the panel');
    assert.ok(!plainPanelSelects().includes('gpu-sel'), 'the reader counted a picker makeDropdown wraps');
    assert.ok(!plainPanelSelects().some(id => id.startsWith(NO_ID)), 'precondition: every select in the panel has an id today');
    const modals = code('src/ui/modals.js');
    const findsIn = (html, needle) =>
      plainDropdownDisagreements(plainPanelSelects(html), hotkeysIntro(), modals).some(s => s.includes(needle));
    // A select put in right where the panel opens, the reader's own anchor.
    const html = read('index.html');
    const top = html.indexOf('>', html.indexOf('id="controls-panel"')) + 1;
    const added = html.slice(0, top) + '\n  <select id="clip-new"><option>1</option></select>' + html.slice(top);
    assert.ok(findsIn(added, '#clip-new'), 'a new plain drop-down went unnoticed');
    // FIX(review RR3-C3): the same select with an attribute before its id, put
    // in mid-panel right before the clip player's Camera select; and one with
    // no id at all.
    const cam = html.lastIndexOf('<select', html.indexOf('id="clip-cam-mode"'));
    assert.ok(cam > top, 'precondition: #clip-cam-mode is a <select> inside the panel');
    const insert = tag => html.slice(0, cam) + `${tag}<option>1</option></select>\n      ` + html.slice(cam);
    assert.ok(findsIn(insert('<select class="x" id="clip-new">'), '#clip-new'),
      'a plain drop-down with an attribute before its id went unnoticed');
    assert.ok(findsIn(insert('<select class="x">'), '<select class="x">'),
      'a plain drop-down with no id went unnoticed');
    const intro = hotkeysIntro();
    const dropped = intro.replace(/Particle Style/g, 'the particle list');
    assert.notEqual(dropped, intro, 'precondition: the paragraph names Particle Style');
    assert.ok(plainDropdownDisagreements(plainPanelSelects(), dropped, modals)
      .some(s => s.includes('Particle Style')), 'a drop-down dropped from the paragraph went unnoticed');
    // FIX(review RR3-C2): the add row's list dropped from the paragraph, and
    // the old claim that every MIDI mapping list keeps the keys put back.
    const noAdd = intro.split(MIDI_ADD_LABEL).join('');
    assert.notEqual(noAdd, intro, `precondition: the paragraph names the "${MIDI_ADD_LABEL}" list`);
    assert.ok(plainDropdownDisagreements(plainPanelSelects(), noAdd, modals)
      .some(s => s.includes(MIDI_ADD_LABEL)), 'the add-parameter list dropped from the paragraph went unnoticed');
    assert.ok(plainDropdownDisagreements(plainPanelSelects(), `${intro} The lists in MIDI mapping keep every key too.`, modals)
      .some(s => s.includes('a CC row')), 'the paragraph saying every MIDI mapping list keeps the keys went unnoticed');
  });
});

describe('both global listeners use the shared rule', () => {

  const sources = ['src/main.js', 'src/ui/controls.js'];

  test('neither listener carries its own tag list any more', () => {
    for (const file of sources) {
      const src = code(file);
      assert.doesNotMatch(src, /\[\s*'INPUT'\s*,\s*'SELECT'\s*,\s*'TEXTAREA'\s*\]\s*\.includes/,
        `${file} still tests the focused element against its own tag list — that list ` +
        'omits BUTTON and SUMMARY, which is the bug this replaced');
    }
  });

  test('both call elementOwnsKey with the pressed key AND act on the answer', () => {
    // FIX(r6): this used to assert only that the CALL appeared. So the
    // one-character mutation that reopens the bug — ask the shared rule and
    // throw the answer away — left the whole suite green, which was measured
    // rather than supposed. What carries the behaviour is the guard: the answer
    // has to reach a `return`.
    //
    // Both shapes a reasonable author would write are accepted, the inline
    // guard and a named intermediate, so a refactor that changes nothing does
    // not go red. What is refused is a call whose result goes nowhere.
    const GUARD = new RegExp(
      'if\\s*\\(\\s*elementOwnsKey\\(\\s*document\\.activeElement\\s*,\\s*e\\.key\\s*\\)\\s*\\)\\s*return' +
      '|(?:const|let)\\s+(\\w+)\\s*=\\s*elementOwnsKey\\(\\s*document\\.activeElement\\s*,\\s*e\\.key\\s*\\)' +
      '[\\s\\S]{0,300}?if\\s*\\(\\s*\\1\\s*\\)\\s*return',
    );
    for (const file of sources) {
      const src = code(file);
      assert.match(src, /elementOwnsKey\(\s*document\.activeElement\s*,\s*e\.key\s*\)/,
        `${file} does not consult the shared rule`);
      assert.match(src, GUARD,
        `${file} calls elementOwnsKey and does not stand down on the answer — the call is ` +
        'there and the protection is not');
    }
  });

  test('both stand down for every dialog, not only About', () => {
    // The sibling rule, and it belonged in this file: a hotkey must not fire
    // through a modal either. Gated on isAboutModalOpen(), four of the five
    // overlays left D, F, R, T and Space live — see tests/overlay-focus.test.js
    // for the behavioural half of this.
    for (const file of sources) {
      assert.match(code(file), /if\s*\(\s*isAnyOverlayOpen\(\)\s*\)\s*return/,
        `${file} does not stand its hotkeys down for an open dialog`);
    }
  });

  test('both import it rather than redefining it', () => {
    for (const file of sources) {
      assert.match(code(file), /import\s*\{[^}]*\belementOwnsKey\b[^}]*\}\s*from\s*'\.\.?\/dom\.js'/,
        `${file} must import elementOwnsKey from dom.js`);
    }
  });

  test('the ADVANCED disclosure is still a <summary>, which is why this matters', () => {
    // If ADVANCED ever stops being a <summary>, the SUMMARY branch above is no
    // longer load-bearing and this file should be re-read rather than trusted.
    const html = read('index.html');
    assert.match(html, /<summary[^>]*>[\s\S]{0,120}ADVANCED/i,
      'ADVANCED is no longer a <summary> — recheck what the keyboard needs to open');
  });
});
