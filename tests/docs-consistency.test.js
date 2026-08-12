// tests/docs-consistency.test.js
//
// Contract tests between the shipped documentation and the code it describes.
//
// Run:
//   node --test tests/docs-consistency.test.js
//
// ── Why these exist ───────────────────────────────────────────────────────────
// The audit that produced this branch found the hold-and-drag table in
// documents/hotkeys.md describing ranges the code had moved away from — and
// then the finding itself named the wrong rows, which is the same failure one
// level up. Prose cannot be checked, but a table of numbers can: these tests
// read the numbers out of the document and compare them with the registry the
// drag path actually consults, so the two cannot drift again in silence.
//
// The drag floor is exported from params.js for the same reason. It used to be
// a literal 0.1 inside controls.js, invisible to anything that wanted to state
// the range.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

let PARAMS, DRAG_FLOOR;
before(async () => { ({ PARAMS, DRAG_FLOOR } = await import('../src/params.js')); });

// The same key → param map controls.js binds the drag to (_fsParams).
const ROWS = [
  ['Bass sensitivity',   'bassSens'],
  ['Treble sensitivity', 'trebleSens'],
  ['Amplitude',          'amp'],
  ['Wave intensity',     'waveInt'],
  ['Bloom',              'bloom'],
];

/** The "Range" cell of a row in the hold-and-drag table, as two numbers. */
function documentedRange(md, label) {
  const row = md.split('\n').find(l => l.includes('| ' + label + ' |'));
  assert.ok(row, `no row for ${label} in the hold-and-drag table`);
  const cells = row.split('|').map(c => c.trim());
  const range = cells[cells.length - 2];
  const m = range.match(/([\d.]+)\s*[–-]\s*([\d.]+)/);
  assert.ok(m, `unreadable range for ${label}: ${range}`);
  return [parseFloat(m[1]), parseFloat(m[2])];
}

describe('documents/hotkeys.md describes the drag the code performs', () => {

  test('every documented range is the range the drag actually covers', () => {
    const md = read('documents/hotkeys.md');

    for (const [label, id] of ROWS) {
      const p = PARAMS[id];
      const expected = [Math.max(p.min, DRAG_FLOOR), p.extendedMax ?? p.max];
      assert.deepEqual(documentedRange(md, label), expected,
        `${label} (${id}): the table and params.js disagree`);
    }
  });

  test('control — the table still has a row for every drag key', () => {
    const md = read('documents/hotkeys.md');
    for (const [label] of ROWS) assert.ok(md.includes('| ' + label + ' |'), label);
  });
});

describe('documents/midi.md describes the MIDI the code implements', () => {

  test('it names both modes the panel shows', () => {
    const md = read('documents/midi.md');

    assert.match(md, /\bREL\b/, 'a new mapping ships in relative mode and the row badge says REL');
    assert.match(md, /\bABS\b/,
      'the linear 0–127 mapping the document describes is the ABSOLUTE mode, ' +
      'which the operator has to switch a row into');
  });
});
