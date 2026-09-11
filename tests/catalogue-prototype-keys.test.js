// tests/catalogue-prototype-keys.test.js
//
// A formula id that arrives from outside cannot reach Object.prototype.
//
// Every catalogue in math-collections.js is an object literal, so it inherits
// Object.prototype and `map[key]` answers for "constructor", "__proto__",
// "toString" and the rest. Both ids the app looks up this way come from
// untrusted places: `volumeKey` and the (collection, formula) pair are written
// into an exported preset file and into localStorage, and both are read back
// verbatim on import and on boot.
//
// Reproduced end to end before the fix, with a real exported snapshot with two
// fields changed to {"deformMode":"volume","volumeKey":"constructor"}:
//
//   panel        ⬡ VOLUME [ACTIVE]
//   console      completely silent — "Unknown volume formula" never fired
//   body         flat and frozen
//   localStorage vimathic_persisted_state.volumeKey = "constructor", survives reload
//
// The guard that should have caught it is `if (!f)`, and `VOLUME_FORMULAS
// ['constructor']` is truthy. getFormula was the same hole with a louder
// failure available: it returned the Object CONSTRUCTOR — a live function whose
// `.name` is "Object" — to a caller that had asked for a formula, and callers
// go on to read `.f` off it.
//
// Two checks are needed and neither is sufficient alone: hasOwnProperty rejects
// the inherited key, and the `.f` shape test rejects an own key holding
// something that is not a formula. The count assertions below are what make the
// second check safe to have — if some real formula ever ships without `.f`,
// this file fails rather than the catalogue silently losing an entry.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MATH_COLLECTIONS,
  VOLUME_FORMULAS,
  catalogueEntry,
  getFormula,
} from '../src/math-collections.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Every key an object literal answers for without owning it. Written out rather
// than derived from Object.getOwnPropertyNames(Object.prototype) so that a
// future runtime adding one does not quietly shrink what this test covers.
const INHERITED = [
  'constructor', '__proto__', 'toString', 'toLocaleString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
];

const anyCollection = Object.keys(MATH_COLLECTIONS)[0];

describe('catalogueEntry refuses what the catalogue does not own', () => {

  test('every inherited key is rejected on VOLUME_FORMULAS', () => {
    for (const key of INHERITED) {
      // The raw lookup is what the code used to do; assert it is still the
      // trap, so this test keeps meaning what it says if a runtime changes.
      assert.notEqual(VOLUME_FORMULAS[key], undefined,
        `${key} no longer resolves on a plain object — re-read this file`);
      assert.equal(catalogueEntry(VOLUME_FORMULAS, key), null,
        `volumeKey:"${key}" reached the engine`);
    }
  });

  test('every inherited key is rejected inside a formulas map', () => {
    const formulas = MATH_COLLECTIONS[anyCollection].formulas;
    for (const key of INHERITED) {
      assert.equal(catalogueEntry(formulas, key), null, `formulaKey:"${key}" resolved`);
    }
  });

  test('a non-string, a missing map and an unknown id are all null', () => {
    for (const bad of [undefined, null, 0, 1, {}, [], Symbol.iterator, () => {}]) {
      assert.equal(catalogueEntry(VOLUME_FORMULAS, bad), null, `key ${String(bad)} resolved`);
    }
    assert.equal(catalogueEntry(undefined, 'lorenzField'), null);
    assert.equal(catalogueEntry(null, 'lorenzField'), null);
    assert.equal(catalogueEntry(VOLUME_FORMULAS, 'no-such-formula'), null);
  });

  test('an own key whose value is not a formula is rejected too', () => {
    // hasOwnProperty alone would pass this. A preset cannot create one, but a
    // half-written catalogue entry can, and the caller reads .f either way.
    const map = { real: { f: () => 0 }, shapeless: { name: 'no f here' }, nulled: null };
    assert.equal(catalogueEntry(map, 'shapeless'), null);
    assert.equal(catalogueEntry(map, 'nulled'), null);
    assert.equal(catalogueEntry(map, 'real'), map.real);
  });
});

describe('nothing real was refused by the new checks', () => {

  test('all 6 volume formulas still resolve, and to the same object', () => {
    const keys = Object.keys(VOLUME_FORMULAS);
    assert.equal(keys.length, 6, 'the volume catalogue changed size — update this count deliberately');
    for (const key of keys) {
      assert.equal(catalogueEntry(VOLUME_FORMULAS, key), VOLUME_FORMULAS[key], `${key} was refused`);
    }
  });

  test('all 192 surface formulas still resolve through getFormula', () => {
    let n = 0;
    for (const [cid, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        assert.equal(getFormula(cid, key), entry, `${cid}/${key} was refused`);
        n++;
      }
    }
    assert.equal(n, 192, 'the catalogue changed size — the app states 192 formulas in several places');
  });
});

describe('getFormula guards both halves of the id', () => {

  test('an inherited formula key no longer returns the Object constructor', () => {
    for (const key of INHERITED) {
      const got = getFormula(anyCollection, key);
      assert.equal(got, null,
        `getFormula(${anyCollection}, "${key}") returned ${typeof got}` +
        (typeof got === 'function' ? ` named "${got.name}"` : ''));
    }
  });

  test('an inherited collection id is rejected on its own account', () => {
    // This half used to be safe by accident: MATH_COLLECTIONS['constructor'] is
    // the Object constructor, and only the `?.formulas` that followed stopped
    // it. Anything that later reached for a different property would have been
    // handed a function.
    for (const key of INHERITED) {
      assert.equal(getFormula(key, 'lorenzField'), null, `collection "${key}" resolved`);
      assert.equal(getFormula(key, key), null, `collection "${key}" resolved`);
    }
    assert.equal(getFormula(undefined, 'x'), null);
    assert.equal(getFormula(42, 'x'), null);
  });
});

describe('the lookups themselves went through the guard', () => {

  test('setVolumeFormula does not index the catalogue directly', () => {
    const src = read('src/math-visualizer.js')
      .split('\n')
      .filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
      .join('\n');
    assert.doesNotMatch(src, /VOLUME_FORMULAS\s*\[/,
      'a bare VOLUME_FORMULAS[...] lookup is back — that is the truthy-on-constructor bug');
    assert.match(src, /catalogueEntry\(\s*VOLUME_FORMULAS\s*,/,
      'setVolumeFormula no longer goes through catalogueEntry');
  });
});
