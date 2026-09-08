// tests/dom-id-contract.test.js
//
// Every id in index.html that app code dereferences without a guard is declared
// in dom.js, so a missing element is a named error at boot rather than a
// TypeError halfway through binding the panel.
//
// dom.js opens by stating this rule — "no `getElementById` elsewhere in app
// code" — and resolveGroup() enforces the half it can see: an id listed in
// REQUIRED that is absent from the HTML aborts boot with a message naming it.
// What nothing checked is the other direction. `btn-export` was read as
// `document.getElementById('btn-export').addEventListener(...)`, with no `?.`
// and no entry in the map, from inside bindControls — so losing that id throws
// mid-function and every binding after that line silently never happens. The
// panel comes up looking finished with half of it inert.
//
// Its sibling `btn-import` had been in the map since the beginning, which is
// how the gap survived being read: the pair looks complete. Counted over src/
// at the time this was written — 80 raw dereferences across 47 distinct ids —
// btn-export was the only one of them missing from the map.
//
// The rule below is deliberately narrower than dom.js's prose. Only ids that
// index.html actually carries are required to be declared: the `_vsc_*` ids in
// presets.js name elements that same function has just created, which dom.js's
// docblock puts out of scope ("Dynamically created elements … are owned by
// their creators"). Guarded reads are exempt as well — `?.`, or a lookup into a
// local that is null-checked, is a call site that has said what it expects.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_IDS, OPTIONAL_IDS } from '../src/dom.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const declared = new Set([...REQUIRED_IDS, ...OPTIONAL_IDS]);

const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? jsFiles(path.join(dir, e.name))
                  : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

// Immediate dereferences only: `getElementById('x').foo` and
// `querySelector('#x').foo`, and not the `?.` forms. Assigning to a local and
// null-checking it is the pattern the guarded readers use and it is fine.
const RAW = /(?:getElementById\(\s*'([^']+)'\s*\)|querySelector\(\s*'#([A-Za-z0-9_-]+)'\s*\))\s*\./g;

const sites = [];
for (const file of jsFiles(path.join(ROOT, 'src'))) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    // Comment lines describe these call sites — including this fix's own notes.
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const m of line.matchAll(RAW)) {
      sites.push({
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        id: m[1] ?? m[2],
      });
    }
  });
}

describe('the dom.js id contract covers what app code assumes', () => {

  test('the scan found the call sites it is supposed to be checking', () => {
    // A regexp that stops matching would make every assertion below vacuous.
    assert.ok(sites.length >= 50,
      `only ${sites.length} unguarded id lookups found in src/ — there were 80; the scan is broken`);
  });

  test('every id in index.html that is dereferenced unguarded is declared', () => {
    const holes = sites
      .filter(s => html.includes(`id="${s.id}"`))
      .filter(s => !declared.has(s.id));

    const report = holes.map(h => `  ${h.id} — ${h.file}:${h.line}`).join('\n');
    assert.equal(holes.length, 0,
      'these ids exist in index.html and are dereferenced with no guard, but dom.js does not ' +
      'declare them, so removing one throws mid-function instead of failing at boot:\n' + report +
      '\nAdd each to REQUIRED (or OPTIONAL, and guard the call site) in src/dom.js.');
  });

  test('an unguarded lookup of an id that is in neither place is a typo', () => {
    // Not in index.html and not in the map: either the element is created at
    // runtime by the same module, or the id is misspelled. Only the first is
    // acceptable, and it is rare enough to name.
    const DYNAMIC = new Set(['_vsc_code', '_vsc_drop', '_vsc_keep']);
    const unknown = sites
      .filter(s => !html.includes(`id="${s.id}"`))
      .filter(s => !declared.has(s.id) && !DYNAMIC.has(s.id));

    assert.deepEqual(unknown, [],
      'ids that are in neither index.html nor dom.js. If the element is built at runtime, add ' +
      'it to DYNAMIC in this test with a note saying what creates it; otherwise it is a typo ' +
      'that will throw the first time the line runs.');
  });

  test('the two ids this closed are declared, and btn-export next to its twin', () => {
    assert.ok(REQUIRED_IDS.includes('btn-export'), 'btn-export is not in REQUIRED');
    assert.ok(REQUIRED_IDS.includes('btn-import'), 'btn-import is not in REQUIRED');
    assert.ok(REQUIRED_IDS.includes('track-error'), 'track-error is not in REQUIRED');
    for (const id of ['btn-export', 'btn-import', 'track-error']) {
      assert.ok(html.includes(`id="${id}"`), `${id} is REQUIRED but index.html does not carry it`);
    }
  });

  test('nothing reads btn-export or track-error around the contract any more', () => {
    const code = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
      .split('\n')
      .filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
      .join('\n');
    assert.doesNotMatch(code('src/ui/controls.js'), /getElementById\(\s*'btn-export'\s*\)/,
      'controls.js is back to looking btn-export up by hand');
    assert.doesNotMatch(code('src/ui/controller.js'), /getElementById\(\s*'track-error'\s*\)/,
      'controller.js is back to looking track-error up by hand');
  });
});
