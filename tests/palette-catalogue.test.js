// tests/palette-catalogue.test.js
//
// One contract: every place that enumerates colour schemes agrees with
// COLOR_SCHEME_COUNT, with itself, and with the others — by index AND by name.
//
// Run:
//   node --test tests/palette-catalogue.test.js
//
// ── Why this exists ──────────────────────────────────────────────────────────
// Adding a palette touches six places. The recipe in src/shaders.js names three
// of them ("update three things in lockstep"), and the three it leaves out are
// the ones that fail silently:
//
//   • a missing getColor() branch falls through to `return bioluminescence(t)`,
//     the deliberate out-of-range default — so the wrong palette renders and
//     nothing anywhere reports it;
//   • a missing <option> is the defect params-wrap.test.js was written for:
//     "There is no scheme 44 and no <option value=\"44\">, so the picture froze
//     on the shader's out-of-range fallback and DOM.colorSel.selectedIndex went
//     -1, i.e. the dropdown blanked";
//   • a missing name in either comment list reads as "unsupported" to shader
//     editor users, which is what FIX(#28) is about — and there are TWO such
//     lists, the Layout block in the FS header and the one above SE_DEFAULT_FRAG.
//
// Before this file, `tests/` mentioned neither _COLOR_FUNS nor getColor and
// counted no <option> anywhere: the whole suite stayed green through any of the
// three. params-wrap.test.js pins the wrap arithmetic, not the catalogue.
//
// ── Why it parses source text instead of importing ───────────────────────────
// Four of the six places are not values a module can hand back — two are GLSL
// inside a template literal, one is markup, two are comments. Reading the text
// is the only way to compare them, so the audit takes source strings as
// arguments. That is also what makes it provably able to fail: the mutation
// tests below feed it damaged copies of the real sources and require it to
// notice, the same reinjection discipline as tests/clock-rate.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── Parsers ──────────────────────────────────────────────────────────────────

/** The _COLOR_FUNS template literal — palette functions and getColor together. */
function colorFunsBlock(shaders) {
  const start = shaders.indexOf('const _COLOR_FUNS = `');
  if (start < 0) throw new Error('_COLOR_FUNS not found — parser is stale');
  const end = shaders.indexOf('\n`;', start);
  return shaders.slice(start, end);
}

/**
 * Palette function names in declaration order. The signature filter is what
 * keeps getColor(int cm, float t) and studioEnv(vec3 dir) out: only the
 * palettes take exactly `float t`.
 */
function paletteFunctions(shaders) {
  const block = colorFunsBlock(shaders);
  return [...block.matchAll(/vec3\s+(\w+)\s*\(\s*float\s+t\s*\)\s*\{/g)].map(m => m[1]);
}

/** getColor()'s explicit branches as {index, name}; the fallback has no cm==N. */
function dispatcherBranches(shaders) {
  const block = colorFunsBlock(shaders);
  const body = block.slice(block.indexOf('vec3 getColor('));
  return [...body.matchAll(/cm\s*==\s*(\d+)\s*\)\s*return\s+(\w+)\s*\(\s*t\s*\)/g)]
    .map(m => ({ index: Number(m[1]), name: m[2] }));
}

/** <option> values under #color-sel, in document order. */
function selectOptionValues(html) {
  const sel = html.match(/<select id="color-sel">([\s\S]*?)<\/select>/);
  if (!sel) throw new Error('#color-sel not found — parser is stale');
  return [...sel[1].matchAll(/<option value="(\d+)"/g)].map(m => Number(m[1]));
}

/**
 * (index, name) pairs out of a comment region. Both catalogue comments are
 * laid out as columns of "N  name", so the same reader serves both; the region
 * bounds are what keeps them apart, and keep prose like "All 44 functions" and
 * "scheme index 0..43" — which look exactly like a pair — out of the result.
 */
function commentPairs(shaders, from, to) {
  const i = shaders.indexOf(from);
  if (i < 0) throw new Error(`comment region "${from}" not found — parser is stale`);
  const j = shaders.indexOf(to, i);
  if (j < 0) throw new Error(`comment region end "${to}" not found — parser is stale`);
  return shaders.slice(i, j).split('\n')
    .filter(l => /^\/\/\s/.test(l))
    .flatMap(l => [...l.matchAll(/\b(\d+)\s+([A-Za-z]\w*)/g)]
      .map(m => ({ index: Number(m[1]), name: m[2] })));
}

const layoutList = shaders => commentPairs(shaders, '// Layout:', '// ── _COLOR_FUNS');
const editorList = shaders =>
  commentPairs(shaders, 'functions are callable by name', 'const SE_DEFAULT_FRAG');

/** COLOR_SCHEME_COUNT read as text, so a mutation can move it. */
function schemeCount(params) {
  const m = params.match(/COLOR_SCHEME_COUNT\s*=\s*(\d+)/);
  if (!m) throw new Error('COLOR_SCHEME_COUNT not found — parser is stale');
  return Number(m[1]);
}

// ── The audit ────────────────────────────────────────────────────────────────

/**
 * Returns a list of human-readable problems; empty means the catalogue agrees.
 * A list rather than a throw so one run reports every disagreement at once —
 * adding ten palettes and missing two places should not need ten runs.
 */
function auditCatalogue({ params, shaders, html }) {
  const count = schemeCount(params);
  const problems = [];

  const fns = paletteFunctions(shaders);
  if (fns.length !== count) {
    problems.push(`_COLOR_FUNS defines ${fns.length} palette functions, COLOR_SCHEME_COUNT is ${count}`);
  }

  const branches = dispatcherBranches(shaders);
  if (branches.length !== count) {
    problems.push(`getColor() has ${branches.length} branches, COLOR_SCHEME_COUNT is ${count}`);
  }
  branches.forEach((b, i) => {
    if (b.index !== i) {
      problems.push(`getColor() branch ${i} tests cm==${b.index} — indices must be a run 0..${count - 1}`);
    }
    if (fns[i] && b.name !== fns[i]) {
      problems.push(`getColor() maps ${b.index} to ${b.name}, but _COLOR_FUNS declares ${fns[i]} there`);
    }
  });

  const opts = selectOptionValues(html);
  if (opts.length !== count) {
    problems.push(`#color-sel has ${opts.length} options, COLOR_SCHEME_COUNT is ${count}`);
  }
  opts.forEach((v, i) => {
    if (v !== i) {
      problems.push(`#color-sel option ${i} has value="${v}" — values must be a run 0..${count - 1}`);
    }
  });

  for (const [label, list] of [['Layout comment', layoutList(shaders)],
                               ['SE_DEFAULT_FRAG list', editorList(shaders)]]) {
    if (list.length !== count) {
      problems.push(`${label} names ${list.length} palettes, COLOR_SCHEME_COUNT is ${count}`);
    }
    list.forEach((p, i) => {
      if (p.index !== i) {
        problems.push(`${label} entry ${i} is numbered ${p.index} — must be a run 0..${count - 1}`);
      }
      if (fns[i] && p.name !== fns[i]) {
        problems.push(`${label} calls ${p.index} "${p.name}", but _COLOR_FUNS declares ${fns[i]}`);
      }
    });
  }

  return problems;
}

// ── Control: the catalogue as shipped ────────────────────────────────────────

const REAL = {
  params:  read('src/params.js'),
  shaders: read('src/shaders.js'),
  html:    read('index.html'),
};

describe('palette catalogue', () => {
  test('every enumeration of colour schemes agrees', () => {
    assert.deepEqual(auditCatalogue(REAL), [],
      'the six places that enumerate palettes have drifted apart');
  });

  test('control — the parsers found something to compare', () => {
    // A parser that silently matches nothing would make the audit above pass
    // for the worst possible reason. Pin the shapes, not the count: this file
    // must not need editing when a palette is added.
    const count = schemeCount(REAL.params);
    assert.ok(count >= 44, `COLOR_SCHEME_COUNT reads ${count}`);
    assert.equal(paletteFunctions(REAL.shaders).length, count);
    assert.equal(dispatcherBranches(REAL.shaders).length, count);
    assert.equal(selectOptionValues(REAL.html).length, count);
    assert.equal(layoutList(REAL.shaders).length, count);
    assert.equal(editorList(REAL.shaders).length, count);
  });
});

// ── Proof that it can fail ───────────────────────────────────────────────────
// Each mutation is a real way to half-add a palette. The audit has to notice
// every one of them, and the assertion names which source was damaged so a
// green run cannot be mistaken for coverage of a different place.

describe('palette catalogue guard — reinjected defects', () => {
  /** Drop the last occurrence of `needle` from one source. */
  const without = (src, needle) => {
    const at = src.lastIndexOf(needle);
    assert.ok(at >= 0, `precondition: "${needle.slice(0, 40)}" is present`);
    return src.slice(0, at) + src.slice(at + needle.length);
  };

  test('a forgotten <option> is caught', () => {
    const last = schemeCount(REAL.params) - 1;
    const html = REAL.html.replace(new RegExp(`\\s*<option value="${last}"[^>]*>[^<]*</option>`), '');
    const problems = auditCatalogue({ ...REAL, html });
    assert.ok(problems.some(p => p.includes('#color-sel')),
      `expected an option complaint, got: ${problems.join(' | ') || '(none)'}`);
  });

  test('a forgotten getColor() branch is caught', () => {
    const last = schemeCount(REAL.params) - 1;
    const shaders = REAL.shaders.replace(new RegExp(`\\n\\s*else if\\(cm==${last}\\)[^\\n]*`), '');
    const problems = auditCatalogue({ ...REAL, shaders });
    assert.ok(problems.some(p => p.includes('getColor()')),
      `expected a dispatcher complaint, got: ${problems.join(' | ') || '(none)'}`);
  });

  test('a branch pointing at the wrong function is caught', () => {
    // The nastiest of the six, because the count still matches: a copy-pasted
    // branch that returns its neighbour renders a plausible wrong palette.
    const shaders = REAL.shaders.replace('cm==43) return coalPlum(t)',
                                         'cm==43) return midnightForest(t)');
    const problems = auditCatalogue({ ...REAL, shaders });
    assert.ok(problems.some(p => p.includes('getColor() maps')),
      `expected a name-mapping complaint, got: ${problems.join(' | ') || '(none)'}`);
  });

  test('a name missing from the SE_DEFAULT_FRAG list is caught', () => {
    const shaders = without(REAL.shaders, ' 43 coalPlum');
    const problems = auditCatalogue({ ...REAL, shaders });
    assert.ok(problems.some(p => p.includes('SE_DEFAULT_FRAG list')),
      `expected an editor-list complaint, got: ${problems.join(' | ') || '(none)'}`);
  });

  test('a name missing from the Layout comment is caught', () => {
    const shaders = REAL.shaders.replace(' 42 midnightForest 43 coalPlum', ' 42 midnightForest');
    const problems = auditCatalogue({ ...REAL, shaders });
    assert.ok(problems.some(p => p.includes('Layout comment')),
      `expected a layout-list complaint, got: ${problems.join(' | ') || '(none)'}`);
  });

  test('bumping COLOR_SCHEME_COUNT alone is caught everywhere', () => {
    // The most likely half-edit of all: the count moves first, the five
    // enumerations follow later — or do not.
    const count = schemeCount(REAL.params);
    const params = REAL.params.replace(`COLOR_SCHEME_COUNT = ${count}`,
                                       `COLOR_SCHEME_COUNT = ${count + 10}`);
    const problems = auditCatalogue({ ...REAL, params });
    for (const place of ['_COLOR_FUNS', 'getColor()', '#color-sel',
                         'Layout comment', 'SE_DEFAULT_FRAG list']) {
      assert.ok(problems.some(p => p.includes(place)),
        `${place} did not complain; got: ${problems.join(' | ') || '(none)'}`);
    }
  });
});
