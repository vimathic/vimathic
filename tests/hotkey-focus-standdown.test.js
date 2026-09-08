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

// Minimal stand-ins: elementOwnsKey reads tagName, isContentEditable, disabled
// and hasAttribute, and nothing else. Keeping them plain objects means this
// runs in Node with no DOM implementation.
const el = (tagName, extra = {}) => ({ tagName, ...extra });

const HOTKEYS   = [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'd', 't', 'f', 'r', 'l', 'k', 'a', 's'];
const ACTIVATES = [' ', 'Enter'];

describe('elementOwnsKey — what the focused element consumes', () => {

  test('a text-entry element owns every key', () => {
    for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) {
      for (const key of HOTKEYS) {
        assert.equal(elementOwnsKey(el(tag), key), true,
          `${tag} must swallow ${JSON.stringify(key)} — typing into a field is not a hotkey`);
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

  test('both call elementOwnsKey with the pressed key', () => {
    for (const file of sources) {
      assert.match(code(file), /elementOwnsKey\(\s*document\.activeElement\s*,\s*e\.key\s*\)/,
        `${file} does not consult the shared rule`);
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
