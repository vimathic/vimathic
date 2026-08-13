// tests/license-date-consistency.test.js
//
// Contract test between LICENSE.txt and every document that quotes a date
// from it.
//
// Run:
//   node --test tests/license-date-consistency.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// LICENSE.txt states the Change Date as a rule with two halves — "Four years
// after the date each version of the Licensed Work is published, or
// 2031-05-09, whichever comes first" — and seven documents quoted the second
// half as though it were the answer. It is not: 1.0.0-beta was published
// 2026-05-18, four years later is 2030-05-18, and that comes first. The fixed
// backstop binds nothing for any version published before 2027-05-09, so every
// promise of "GPL v3 on 2031-05-09" was a year late against the license that
// actually governs.
//
// Prose cannot be checked, but a date computed from a rule can. This test reads
// the rule out of LICENSE.txt, reads the release date out of CHANGELOG.md,
// computes the Change Date the same way a reader with the license in hand
// would, and requires every document to agree. LICENSE.txt is the binding text
// and stays the source of truth: change the rule there and this test tells you
// which documents have gone stale.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Every file that states, or could state, when the code turns GPL v3.
 *
 * This list is hand-written, which is its own failure mode: the first fix
 * corrected seven documents and pinned them here, and CONTRIBUTING.md — the
 * page that sets the contribution terms, and the page the PR template sends
 * contributors to — was not one of them. It went on promising the backstop
 * date for another two commits with the suite green. When a new document
 * states a conversion date, add it here in the same change.
 */
const QUOTING_FILES = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'documents/license.md',
  'documents/index.md',
  'documents/roadmap.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'plugins/vimathic-docs.js',        // the llms.txt body lives here
];

const WORD_YEARS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * The Change Date clause of LICENSE.txt, as a rule rather than a date.
 * Reads the Parameters block, not the GPL v3 text bundled below it.
 */
function changeDateRule() {
  const txt = read('LICENSE.txt');
  const block = txt.slice(txt.indexOf('Change Date:'), txt.indexOf('Change License:'));
  assert.ok(block.length > 0, 'LICENSE.txt has no Change Date clause');

  const clause = block.replace(/\s+/g, ' ').trim();

  const years = clause.match(/Change Date:\s*(\w+) years after/i);
  assert.ok(years, `unreadable term in the Change Date clause: ${clause}`);
  const term = WORD_YEARS[years[1].toLowerCase()] ?? Number(years[1]);
  assert.ok(Number.isFinite(term), `unreadable year count: ${years[1]}`);

  const backstop = clause.match(/or (\d{4}-\d{2}-\d{2})/);
  const order = clause.match(/whichever comes (first|last)/i);

  return {
    term,
    backstop: backstop ? backstop[1] : null,
    picks: order ? order[1].toLowerCase() : 'first',
  };
}

/** The date CHANGELOG.md records for the release currently in package.json. */
function releaseDate() {
  const version = JSON.parse(read('package.json')).version;
  const row = read('CHANGELOG.md')
    .split('\n')
    .find(l => l.startsWith(`## [${version}]`));
  assert.ok(row, `CHANGELOG.md has no released section for ${version}`);

  const m = row.match(/(\d{4}-\d{2}-\d{2})/);
  assert.ok(m, `no date on the ${version} heading: ${row}`);
  return m[1];
}

/** `iso` moved forward by whole years, kept in UTC so no timezone shifts it. */
function addYears(iso, years) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** The Change Date of the shipped release, computed the way LICENSE.txt reads. */
function computedChangeDate() {
  const { term, backstop, picks } = changeDateRule();
  const fromRelease = addYears(releaseDate(), term);
  if (!backstop) return fromRelease;
  return picks === 'last'
    ? (fromRelease > backstop ? fromRelease : backstop)
    : (fromRelease < backstop ? fromRelease : backstop);
}

describe('the documents quote the Change Date LICENSE.txt actually sets', () => {

  test('every document that names a conversion date names the computed one', () => {
    const expected = computedChangeDate();

    for (const rel of QUOTING_FILES) {
      assert.ok(read(rel).includes(expected),
        `${rel} does not mention ${expected}, the Change Date LICENSE.txt computes ` +
        `for the shipped release`);
    }
  });

  test('the backstop is never quoted as the answer, only as the ceiling', () => {
    const { backstop } = changeDateRule();
    if (!backstop) return;
    const expected = computedChangeDate();

    for (const rel of QUOTING_FILES) {
      const body = read(rel);
      if (!body.includes(backstop)) continue;
      assert.ok(body.includes(expected),
        `${rel} mentions the backstop ${backstop} without the Change Date ${expected} — ` +
        `a reader takes the only date on the page as the answer`);
    }
  });

  test('no document falls back to a bare year for the conversion', () => {
    // "open-source in 2031" was the form that hid the error longest: no day to
    // check against the license, so nobody checked.
    const wrongYear = computedChangeDate().slice(0, 4) === '2030' ? '2031' : null;
    if (!wrongYear) return;

    for (const rel of QUOTING_FILES) {
      assert.ok(!new RegExp(`\\bin ${wrongYear}\\b`).test(read(rel)),
        `${rel} still promises conversion "in ${wrongYear}"`);
    }
  });

  // ── controls: the probe has to be able to fail ──────────────────────────────

  test('control — the rule really is two-part, so the check is not vacuous', () => {
    const { term, backstop, picks } = changeDateRule();
    assert.equal(term, 4, 'LICENSE.txt term changed — re-read the clause before trusting this file');
    assert.equal(backstop, '2031-05-09');
    assert.equal(picks, 'first');
  });

  test('control — the computed date differs from the backstop', () => {
    // If these ever coincide the assertions above pass for free and prove
    // nothing. That is exactly the state the documents were wrongly assuming.
    assert.notEqual(computedChangeDate(), changeDateRule().backstop,
      'computed Change Date equals the backstop — the tests above stop discriminating');
  });

  test('control — the arithmetic is year arithmetic, not string surgery', () => {
    assert.equal(addYears('2026-05-18', 4), '2030-05-18');
    assert.equal(addYears('2024-02-29', 1), '2025-03-01'); // leap day rolls, not NaN
  });

  test('control — the release date is read from the version being shipped', () => {
    assert.equal(releaseDate(), '2026-05-18');
    assert.equal(computedChangeDate(), '2030-05-18');
  });
});
