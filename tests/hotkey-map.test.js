// tests/hotkey-map.test.js
//
// The two keyboard maps — main.js's tap switch and controls.js's hold-and-drag
// table (_fsParams) — and the #hotkey-hint overlay that states both.
//
// Run:
//   node --test tests/hotkey-map.test.js
//
// ── Why these exist ───────────────────────────────────────────────────────────
// On 08.10.2026 the owner gave every knob in the formula slot a hold-and-drag
// key: B Formula Detail, N Formula Phase, Y U H J Shader Knobs 1-4. Three of
// those letters were drag keys already (J amp, N wave, B bloom) and two were
// tap keys (Y the glitch punch, H the hint overlay). A letter cannot be both:
// arming a drag calls preventDefault, and main.js would run the tap on every
// arm. So the glitch moved to P and the hint to I, which is the second time —
// S gave the glitch up the same way on 01.09.
//
// Nothing pinned any of that. The switch lives in main.js, which no test can
// import (importing it boots the app), the drag map lives inside bindControls'
// closure, and the overlay is markup — three places that each state the key
// map, and nothing held them to each other. (FIX(review S5): this said the
// overlay "had already drifted once", naming J/V, N/C and B/A after the map had
// moved on. It had not: those were the real bindings until 08.10.2026, and the
// commit that changed the map changed the overlay with it.) So this file reads
// all three as source, comment lines stripped, and holds them to each other:
//   • no letter is both a case in the switch and a key in _fsParams, and the
//     two tap actions that lost their letters live on P and I, bodies intact;
//   • the overlay names every drag letter with its param, and every tap letter
//     of the switch, and nothing else — so it can never say "H this hint" or
//     "Y glitch" again without going red here;
//   • FIX(review T1): so do the two documents that name the tap keys —
//     documents/hotkeys.md's tap table against the switch, both ways, and the
//     key quick-start.md sends a reader to for the hint against the case that
//     toggles it. Both had been moved by hand with nothing to check them.
// The behaviour of the keys themselves is driven in
// tests/controls-wiring.test.js (stub document, real bindControls) and
// tests/e2e/knob-keys.spec.js (a real browser).
//
// Each check carries its control in the same file: the readers have to find
// the real maps, and each checker has to go red on the old text it replaced.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with whole-line comments removed. Whole-line only, as in
 * tests/hotkey-focus-standdown.test.js: both files' comments quote the old
 * letters on purpose ("this listed L K J N B V C A X Z and S"), and a check
 * that read them would pass on the history instead of the code.
 */
const stripComments = text => text.split('\n')
  .filter(line => { const t = line.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
  .join('\n');
const code = rel => stripComments(read(rel));

// ── Readers ──────────────────────────────────────────────────────────────────

/** controls.js's _fsParams: letter → PARAMS id, as the source states it. */
function dragKeys(src = code('src/ui/controls.js')) {
  const at = src.indexOf('const _fsParams = {');
  assert.ok(at >= 0, 'controls.js no longer declares _fsParams the way this test reads it');
  const body = src.slice(at, src.indexOf('};', at));
  return new Map([...body.matchAll(/'([a-z])'\s*:\s*'(\w+)'/g)].map(m => [m[1], m[2]]));
}

/** The body of main.js's keydown listener, from the listener to its `});`. */
function keydownBody(src = code('src/main.js')) {
  const at = src.indexOf("window.addEventListener('keydown'");
  assert.ok(at >= 0, 'main.js no longer installs its keydown listener the way this test reads it');
  const end = src.indexOf('\n});', at);
  assert.ok(end > at, 'the keydown listener in main.js has no closing `});` at column 0');
  return src.slice(at, end);
}

/** Every `case '…':` label of the hotkey switch, in source order. */
function tapKeys(body = keydownBody()) {
  return [...body.matchAll(/case '([^']+)'\s*:/g)].map(m => m[1]);
}

/** The text of one case, from its label to the next label (or the switch's end). */
function caseBody(body, key) {
  const at = body.indexOf(`case '${key}':`);
  if (at < 0) return null;
  const next = body.slice(at + 1).search(/case '[^']+'\s*:/);
  return next < 0 ? body.slice(at) : body.slice(at, at + 1 + next);
}

/** #hotkey-hint as plain text lines: tags gone, <br> a line break. */
function hintLines(html = read('index.html')) {
  const at = html.indexOf('<div id="hotkey-hint">');
  assert.ok(at >= 0, 'index.html has no #hotkey-hint');
  const inner = html.slice(at + '<div id="hotkey-hint">'.length, html.indexOf('</div>', at));
  return inner.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
    .split('\n').map(l => l.trim()).filter(Boolean);
}

/** The overlay split at its "Hold + drag" heading into its two halves. */
function hintHalves(lines = hintLines()) {
  const cut = lines.findIndex(l => /^Hold \+ drag/.test(l));
  assert.ok(cut > 0, 'the overlay has no "Hold + drag" heading between its tap and drag lines');
  const segments = ls => ls.flatMap(l => l.split('·')).map(s => s.trim()).filter(Boolean);
  return { tap: segments(lines.slice(0, cut)), drag: segments(lines.slice(cut + 1)) };
}

// How the overlay's tap half spells a key that is not a letter.
const TAP_TOKENS = { 'SPACE': ' ', '←': 'arrowleft', '→': 'arrowright' };

/** The tap half: key → what the overlay says it does. */
function hintTaps(segments) {
  const out = new Map();
  for (const seg of segments) {
    const words = seg.split(/\s+/);
    const keys = [];
    while (words.length && (/^[A-Z]$/.test(words[0]) || words[0] in TAP_TOKENS)) {
      const w = words.shift();
      keys.push(TAP_TOKENS[w] ?? w.toLowerCase());
    }
    for (const k of keys) out.set(k, words.join(' '));
  }
  return out;
}

// What the overlay's drag half calls each param. A name with several params
// lists their letters in order: "shader knobs Y U H J" is Knob 1 to Knob 4.
const HINT_NAMES = {
  'amp':            ['amp'],
  'wave':           ['waveInt'],
  'bloom':          ['bloom'],
  'bass':           ['bassSens'],
  'treble':         ['trebleSens'],
  'rings':          ['bandDepth'],
  'formula detail': ['detail'],
  'phase':          ['phase'],
  'shader knobs':   ['k0', 'k1', 'k2', 'k3'],
};

/** The drag half: { key, id } per letter, or a problem for a segment it cannot read. */
function hintDrags(segments) {
  const out = [], problems = [];
  for (const seg of segments) {
    const m = seg.match(/^(.*?)\s+([A-Z](?:\s*[/ ]\s*[A-Z])*)$/);
    const ids = m && HINT_NAMES[m[1]];
    if (!ids) { problems.push(`the overlay names a drag this test cannot read: "${seg}"`); continue; }
    const letters = m[2].split(/[\s/]+/).map(l => l.toLowerCase());
    if (ids.length > 1 && letters.length !== ids.length) {
      problems.push(`"${seg}" lists ${letters.length} letters for ${ids.length} params`);
      continue;
    }
    letters.forEach((key, i) => out.push({ key, id: ids.length > 1 ? ids[i] : ids[0] }));
  }
  return { out, problems };
}

/** Every way the overlay disagrees with the two maps, as sentences. */
function hintDisagreements(lines, drag, taps) {
  const { tap, drag: dragSegs } = hintHalves(lines);
  const bad = [];
  const { out, problems } = hintDrags(dragSegs);
  bad.push(...problems);
  const said = new Map();
  for (const { key, id } of out) {
    const K = key.toUpperCase();
    if (said.has(key)) bad.push(`the overlay lists ${K} twice`);
    said.set(key, id);
    if (!drag.has(key)) bad.push(`the overlay says ${K} drags ${id}, and _fsParams has no ${K}`);
    else if (drag.get(key) !== id) bad.push(`the overlay says ${K} drags ${id}; it drags ${drag.get(key)}`);
  }
  for (const [key, id] of drag) {
    if (!said.has(key)) bad.push(`${key.toUpperCase()} drags ${id}, and the overlay does not say so`);
  }
  const shown = hintTaps(tap);
  for (const key of taps) {
    if (!shown.has(key)) bad.push(`the switch has a case for ${JSON.stringify(key)}, and the overlay does not show it`);
  }
  for (const [key, what] of shown) {
    if (!taps.includes(key)) bad.push(`the overlay offers ${JSON.stringify(key)} for "${what}", and the switch has no such case`);
  }
  return bad;
}

// How hotkeys.md's tap table spells a key that is not a letter. Esc is the one
// documented key outside the switch: it lives in controls.js's own Escape
// listener, which closes the dialogs and leaves full screen.
const DOC_TOKENS = { 'Space': ' ', '←': 'arrowleft', '→': 'arrowright', 'Esc': 'escape' };
const OUTSIDE_SWITCH = ['escape'];

/**
 * hotkeys.md's "## Tap shortcuts" table: the keys of its KEY column, and the
 * cells it could not read.
 *
 * FIX(review RR-C4): this skipped every line that did not start with
 * '| <kbd>', so a stale row in another spelling — '| `H` | …', or
 * '| Shift+<kbd>H</kbd> | …' — was never seen, and the table could document a
 * key the switch does not have while every test stayed green. Every body row
 * of the table is read now: each line starting with '|' that is neither a
 * |---| separator nor the header right above one. A KEY cell must be <kbd>
 * tokens and nothing else, with ' / ' allowed between two of them
 * ('<kbd>←</kbd> / <kbd>→</kbd>'); any other cell is reported as unread, whole.
 */
function docTapKeys(md = read('documents/hotkeys.md')) {
  const from = md.indexOf('## Tap shortcuts');
  assert.ok(from >= 0, 'documents/hotkeys.md has no "## Tap shortcuts" section');
  const section = md.slice(from, md.indexOf('\n## ', from + 1));
  const rows = section.split('\n').filter(line => line.startsWith('|'));
  const SEPARATOR = /^\|\s*:?-{3,}/;
  assert.ok(rows.some(r => SEPARATOR.test(r)), 'the tap section has no table this reader can find');
  const keys = [], unread = [];
  rows.forEach((line, i) => {
    if (SEPARATOR.test(line) || SEPARATOR.test(rows[i + 1] ?? '')) return;   // separator, or the header above it
    const cell = line.split('|')[1];
    const KBD = /<kbd>([^<]*)<\/kbd>/g;
    const tokens = [...cell.matchAll(KBD)].map(m => m[1].trim());
    const between = cell.trim().split(KBD).filter((_, j) => j % 2 === 0);   // the text around the tokens
    const plain = tokens.length > 0 && between[0] === '' && between.at(-1) === '' &&
                  between.slice(1, -1).every(s => s === ' / ');
    if (!plain) { unread.push(cell.trim()); return; }
    for (const k of tokens) {
      if (/^[A-Z]$/.test(k)) keys.push(k.toLowerCase());
      else if (k in DOC_TOKENS) keys.push(DOC_TOKENS[k]);
      else unread.push(k);
    }
  });
  return { keys, unread };
}

/** Every way the tap table and the switch disagree, as sentences. */
function docTapDisagreements(doc, taps) {
  const bad = doc.unread.map(k => `the tap table names a key this test cannot read: "${k}"`);
  for (const k of doc.keys) {
    if (!taps.includes(k) && !OUTSIDE_SWITCH.includes(k)) {
      bad.push(`hotkeys.md documents ${JSON.stringify(k)}, and main.js's switch has no such case`);
    }
  }
  for (const k of taps) {
    if (!doc.keys.includes(k)) bad.push(`main.js has a case for ${JSON.stringify(k)}, and hotkeys.md's tap table does not list it`);
  }
  return bad;
}

/** The key quick-start.md names on its "show the full hotkey hint" line, lowercased. */
function quickStartHintKey(md = read('documents/quick-start.md')) {
  const m = md.match(/^- `([A-Z])` — show the full hotkey hint/m);
  assert.ok(m, 'quick-start.md has no "- `X` — show the full hotkey hint" line');
  return m[1].toLowerCase();
}

/** The cases of the switch whose bodies toggle the hint overlay. */
const hintCases = (body = keydownBody()) =>
  tapKeys(body).filter(k => caseBody(body, k).includes("DOM.hotkeyHint.classList.toggle('visible')"));

// ── The maps ─────────────────────────────────────────────────────────────────

describe('a letter is a tap or a drag, never both', () => {

  test('the glitch punch is on P and the hint overlay on I, and neither Y nor H is a case any more', () => {
    const body = keydownBody();
    const taps = tapKeys(body);
    assert.ok(taps.includes('p'), 'main.js has no case for P');
    assert.ok(taps.includes('i'), 'main.js has no case for I');
    assert.ok(!taps.includes('y'), "main.js still has case 'y' — Y arms Shader Knob 1, so the tap would fire on every arm");
    assert.ok(!taps.includes('h'), "main.js still has case 'h' — H arms Shader Knob 3, so the tap would fire on every arm");
    // The bodies moved with the labels — a case 'p' that did something else
    // would satisfy the four lines above.
    const p = caseBody(body, 'p');
    for (const call of ['render.triggerGlitch(200)', 'render.punchBloom()', "classList.add('flash')"]) {
      assert.ok(p.includes(call), `case 'p' no longer does ${call}`);
    }
    assert.ok(caseBody(body, 'i').includes("DOM.hotkeyHint.classList.toggle('visible')"),
      "case 'i' does not toggle the hint overlay");
  });

  test('no letter is both a case in main.js and a key in _fsParams', () => {
    const drag = dragKeys();
    const both = tapKeys().filter(k => drag.has(k));
    assert.deepEqual(both, [],
      `these letters both tap (main.js) and drag (controls.js): ${both.join(', ')} — arming the drag ` +
      'calls preventDefault and the tap fires on every arm');
  });

  test('the formula slot\'s six are on the letters the owner asked for, and the three they left keep one each', () => {
    const drag = dragKeys();
    for (const [key, id] of [['b', 'detail'], ['n', 'phase'], ['y', 'k0'], ['u', 'k1'], ['h', 'k2'], ['j', 'k3'],
                             ['v', 'amp'], ['c', 'waveInt'], ['a', 'bloom']]) {
      assert.equal(drag.get(key), id, `${key.toUpperCase()} should drag ${id}, and it drags ${drag.get(key)}`);
    }
    for (const id of ['amp', 'waveInt', 'bloom', 'detail', 'phase', 'k0', 'k1', 'k2', 'k3']) {
      const letters = [...drag].filter(([, v]) => v === id).map(([k]) => k.toUpperCase());
      assert.equal(letters.length, 1, `${id} answers to ${letters.join(' and ')}, not one letter`);
    }
  });

  test('control — the readers find the real maps, and the overlap check sees a reinjected case', () => {
    const taps = tapKeys();
    for (const k of [' ', 'arrowleft', 'arrowright', 'd', 't', 'f', 'r', 'q', 'e', 'w', 'g']) {
      assert.ok(taps.includes(k), `the switch reader lost ${JSON.stringify(k)} — it is not reading the switch`);
    }
    const drag = dragKeys();
    assert.equal(drag.get('l'), 'bassSens', 'the _fsParams reader is not reading the map');
    assert.equal(drag.get('s'), 'bandDepth', 'the _fsParams reader is not reading the map');

    // main.js as it stood before the move, in one line: Y back in the switch.
    const src = code('src/main.js').replace("case 'p': {", "case 'y': {");
    assert.ok(tapKeys(keydownBody(src)).filter(k => drag.has(k)).includes('y'),
      'a switch with the glitch back on Y reads clean');
  });
});

// ── The documents ────────────────────────────────────────────────────────────
// FIX(review T1): the tap rows that moved on 08.10.2026 (P and I) were moved in
// the docs by hand, and a revert of either document left every test green.

describe('the documents name the tap keys the switch has', () => {

  test('hotkeys.md\'s tap table is the switch, both ways, with Esc as the one key outside it', () => {
    const bad = docTapDisagreements(docTapKeys(), tapKeys());
    assert.deepEqual(bad, [], 'documents/hotkeys.md and main.js disagree about the tap keys:\n  ' + bad.join('\n  '));
  });

  test('Esc, the one documented key outside the switch, is handled where the table says', () => {
    // Allowing it is only honest while controls.js really has its listener.
    assert.match(code('src/ui/controls.js'), /addEventListener\('keydown',\s*e\s*=>\s*\{\s*if\s*\(e\.key\s*!==\s*'Escape'\)\s*return;/,
      'controls.js no longer has the Escape listener hotkeys.md documents');
    assert.ok(docTapKeys().keys.includes('escape'), 'the tap table no longer lists Esc');
  });

  test('the key quick-start.md gives for the hint is the case that toggles it', () => {
    const cases = hintCases();
    assert.equal(cases.length, 1, `expected one case toggling the hint, found ${cases.join(', ') || 'none'}`);
    assert.equal(quickStartHintKey(), cases[0],
      `quick-start.md sends the reader to ${quickStartHintKey().toUpperCase()} for the hint, and it is on ${cases[0].toUpperCase()}`);
  });

  test('the hint key cancels the boot flash before it toggles', () => {
    // FIX(review L2): controls.js's flash is behaviour-tested against
    // ui.cancelHintFlash in tests/controls-wiring.test.js; this is the other
    // half, which only a source read can see — that I calls it, first.
    const body = caseBody(keydownBody(), 'i');
    const cancel = body.indexOf('ui.cancelHintFlash');
    assert.ok(cancel >= 0, "case 'i' does not cancel the hint's boot flash, so the flash can undo the press");
    assert.ok(cancel < body.indexOf("DOM.hotkeyHint.classList.toggle('visible')"),
      "case 'i' toggles the hint before it cancels the flash");
  });

  test('control — the old Y and H rows, put back, are caught in both documents', () => {
    const md = read('documents/hotkeys.md');
    const taps = tapKeys();
    // The reader read the real table: every tap key, Esc and the arrows included.
    assert.deepEqual([...new Set(docTapKeys(md).keys)].sort(), [...taps, 'escape'].sort(),
      'the tap-table reader did not find the table it checks');

    // FIX(review, fixer note on d2514b4): this substituted into the literal P
    // and I rows ('| <kbd>P</kbd> | Glitch', '| <kbd>I</kbd> | Toggle'), so
    // rewording the start of either description turned the control red for
    // its own reasons while the guard was fine. The rows are found by their KEY
    // cell now, and only that cell is replaced; the same injection is also made
    // into a copy whose every description is reworded, and must still be caught.
    const rekey = (text, swaps) => {
      const from = text.indexOf('## Tap shortcuts');
      const to = text.indexOf('\n## ', from + 1);
      const hits = Object.fromEntries(Object.keys(swaps).map(k => [k, 0]));
      const section = text.slice(from, to).split('\n').map(line => {
        if (!line.startsWith('|')) return line;
        const cells = line.split('|');
        const key = cells[1].trim().match(/^<kbd>([A-Z])<\/kbd>$/)?.[1];
        if (!key || !(key in swaps)) return line;
        hits[key]++;
        cells[1] = ` <kbd>${swaps[key]}</kbd> `;
        return cells.join('|');
      }).join('\n');
      for (const [k, n] of Object.entries(hits)) {
        assert.equal(n, 1, `precondition: the tap table has one row whose key cell is <kbd>${k}</kbd>, found ${n}`);
      }
      return text.slice(0, from) + section + text.slice(to);
    };
    const rewordAll = text => text.replace(/^(\| <kbd>[^|\n]*\|[^|\n]*?)\s*\|$/gm, '$1 (reworded) |');
    const reworded = rewordAll(md);
    assert.notEqual(reworded, md, 'precondition: the rewording reached the table');
    assert.deepEqual(docTapDisagreements(docTapKeys(reworded), taps), [], 'rewording every description put the guard out');
    for (const base of [md, reworded]) {
      const old = rekey(base, { P: 'Y', I: 'H' });
      assert.notEqual(old, base, 'precondition: the P and I rows were rewritten');
      const bad = docTapDisagreements(docTapKeys(old), taps);
      for (const want of ['documents "y"', 'documents "h"', 'case for "p"', 'case for "i"']) {
        assert.ok(bad.some(s => s.includes(want)), `the check did not notice: ${want}\n  ${bad.join('\n  ')}`);
      }
    }
    // A key the reader cannot place is reported rather than skipped.
    const odd = md.replace('| <kbd>Space</kbd> |', '| <kbd>Spacebar</kbd> |');
    assert.notEqual(odd, md, 'precondition: the Space row is where this control expects it');
    assert.ok(docTapDisagreements(docTapKeys(odd), taps).some(s => s.includes('cannot read')),
      'an unreadable key cell was skipped silently');

    const qs = read('documents/quick-start.md');
    const oldQs = qs.replace('- `I` — show the full hotkey hint', '- `H` — show the full hotkey hint');
    assert.notEqual(oldQs, qs, 'precondition: quick-start\'s hint line is where this control expects it');
    assert.notEqual(quickStartHintKey(oldQs), hintCases()[0], 'quick-start sending the reader to H reads clean');

    // …and the hint-case reader sees the toggle wherever it is put.
    const moved = code('src/main.js').replace("case 'i':", "case 'h':");
    assert.deepEqual(hintCases(keydownBody(moved)), ['h'], 'the hint-case reader does not follow the toggle');
  });

  test('control — a row in another spelling is read and reported, and a description edit reads clean', () => {
    // FIX(review RR-C4): the reader used to skip any row not starting with
    // '| <kbd>', so both of these stale rows stayed green.
    // Both edits are made without quoting a row of today's table, so that
    // rewording a row cannot turn this control red for its own reasons: a
    // stale row goes in right under the table's |---| line, and the rewording
    // is applied to every row's description at once.
    const md = read('documents/hotkeys.md');
    const taps = tapKeys();
    const sep = md.indexOf('\n|---', md.indexOf('## Tap shortcuts'));
    assert.ok(sep > 0, 'precondition: the tap table has a |---| line');
    const under = md.indexOf('\n', sep + 1) + 1;
    const withRow = row => md.slice(0, under) + row + md.slice(under);
    for (const stale of ['| `H` | Toggle this hotkey hint overlay |\n',
                         '| Shift+<kbd>H</kbd> | Toggle this hotkey hint overlay |\n']) {
      const bad = docTapDisagreements(docTapKeys(withRow(stale)), taps);
      const cell = stale.split('|')[1].trim();
      assert.ok(bad.some(s => s.includes('cannot read') && s.includes(cell)),
        `a stale row spelt ${cell} was skipped:\n  ${bad.join('\n  ') || '(nothing reported)'}`);
    }
    // The separator and the header are not rows, and a row's description is
    // not read: rewording every one of them changes nothing.
    const reworded = md.replace(/^(\| <kbd>[^|\n]*\|[^|\n]*?)\s*\|$/gm, '$1 (reworded) |');
    assert.notEqual(reworded, md, 'precondition: the rewording reached the table');
    assert.deepEqual(docTapDisagreements(docTapKeys(reworded), taps), []);
  });
});

// ── The overlay ──────────────────────────────────────────────────────────────

describe('#hotkey-hint says what the keys do', () => {

  test('it names every drag letter with its param, every tap letter of the switch, and nothing else', () => {
    const bad = hintDisagreements(hintLines(), dragKeys(), tapKeys());
    assert.deepEqual(bad, [], 'index.html #hotkey-hint and the two key maps disagree:\n  ' + bad.join('\n  '));
  });

  test('it no longer offers H for the hint or Y for the glitch', () => {
    const text = hintLines().join('\n');
    assert.doesNotMatch(text, /\bH this hint\b/, 'the overlay still sends the reader to H, which drags Shader Knob 3');
    assert.doesNotMatch(text, /\bY glitch\b/, 'the overlay still sends the reader to Y, which drags Shader Knob 1');
    assert.match(text, /\bI this hint\b/);
    assert.match(text, /\bP glitch\b/);
  });

  test('control — the overlay as it shipped before 08.10.2026 fails the check', () => {
    // A verbatim copy of the old block. Its drag line puts J, N and B on amp,
    // wave and bloom, and its tap line offers H and Y — every one of which the
    // check above has to see.
    const OLD = `
  SPACE play/pause · ← → tracks<br>
  F random formula · D next shape · T material · R random all<br>
  Q random color · E next color<br>
  W flip camera · G grid · H this hint · Y glitch<br>
  <span style="color:#445">Hold + drag (mouse / touchpad / wheel):<br>
  amp J/V · wave N/C · bloom B/A · bass L/X · treble K/Z · rings S</span>`;
    const bad = hintDisagreements(hintLines(`<div id="hotkey-hint">${OLD}</div>`), dragKeys(), tapKeys());
    for (const want of ['J drags amp', 'N drags waveInt', 'B drags bloom', '"h"', '"y"', 'Y drags k0', 'H drags k2']) {
      assert.ok(bad.some(s => s.includes(want)), `the check did not notice: ${want}\n  ${bad.join('\n  ')}`);
    }
    // …and the reader really read the current overlay, both halves of it.
    const { tap, drag } = hintHalves();
    assert.ok(tap.length >= 10 && drag.length >= 9, `read ${tap.length} tap and ${drag.length} drag segments`);
  });
});
