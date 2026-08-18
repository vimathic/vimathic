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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

// gif.js touches `self` at import time, and src/recorder.js imports it.
globalThis.self   = globalThis;
globalThis.window = globalThis;

let PARAMS, DRAG_FLOOR, gifFramePlan;
before(async () => {
  ({ PARAMS, DRAG_FLOOR } = await import('../src/params.js'));
  ({ gifFramePlan }       = await import('../src/recorder.js'));
});

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

// ── The shipped label is the label ────────────────────────────────────────────
// A document that names a button the build does not have sends the reader
// hunting. recording.md sent them to a "RECORDING" section for a "● REC"
// button; the modal has "🎞️ RECORD CLIP" and "⏺ START RECORDING". "■ STOP"
// even exists — as the clip player's button, in a different panel — which is
// how the drift survived a reading. index.html is the only place these strings
// are authored, so it is the one to compare against.

/** The text of the <button id="…"> as it ships in index.html. */
function buttonLabel(html, id) {
  const m = html.match(new RegExp(`<button[^>]*\\bid="${id}"[^>]*>([^<]*)</button>`));
  assert.ok(m, `index.html has no <button id="${id}">`);
  return m[1].trim();
}

/** Every `.out-stitle` heading in the OUTPUT modal, in document order. */
function outputSections(html) {
  return [...html.matchAll(/<div class="out-stitle">([^<]*)/g)].map(m => m[1].trim());
}

/** The `value=` list of a <select> in index.html — what the panel really offers. */
function selectValues(id) {
  const html  = read('index.html');
  const start = html.indexOf(`<select id="${id}"`);
  assert.ok(start > 0, `index.html has no #${id}`);
  const block = html.slice(start, html.indexOf('</select>', start));
  return [...block.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]);
}

describe('the documents name the controls index.html actually ships', () => {

  test('recording.md quotes the recorder\'s own section and button labels', () => {
    const html = read('index.html');
    const md   = read('documents/recording.md');

    const sections = outputSections(html);
    const recSection = sections.find(s => /RECORD/i.test(s));
    assert.ok(recSection, `no recorder section among: ${sections.join(' | ')}`);

    // Bold is how these pages quote a control, and the bold form is what makes
    // the check strict: "🎛 LEARN" is a prefix of "🎛 LEARN MODE", so a plain
    // substring test would pass on the wrong label.
    for (const label of [recSection,
                         buttonLabel(html, 'rec-btn-start'),
                         buttonLabel(html, 'rec-btn-stop')]) {
      assert.ok(md.includes(`**${label}**`),
        `documents/recording.md never names "${label}", the shipped label`);
    }
  });

  test('recording.md does not send the reader after a button that never existed', () => {
    const html = read('index.html');
    assert.ok(!/●\s*REC\b/.test(html), 'control: index.html has no ● REC button');
    assert.ok(!/●\s*REC\b/.test(read('documents/recording.md')),
      'documents/recording.md still names ● REC — the start button is #rec-btn-start');
  });

  test('midi.md quotes the LEARN button as index.html authors it', () => {
    const html = read('index.html');
    const md   = read('documents/midi.md');
    // modals.js renames this button to "🎛 LEARN MODE" once a learn cycle has
    // run, so the doc may mention that too — but the label a first-time reader
    // is looking at is the one in the markup.
    assert.ok(md.includes(`**${buttonLabel(html, 'btn-midi-learn')}**`),
      'documents/midi.md names a label the shipped markup does not use');
  });

  test('output.md does not promise a Spout control the browser build has no room for', () => {
    const html = read('index.html');
    assert.ok(!/spout/i.test(html),
      'control: index.html gained a Spout control — output.md may now describe it');

    const md = read('documents/output.md');
    assert.ok(!/\bthe Spout (button|control)\b/i.test(md),
      'documents/output.md points at a Spout button; SpoutOutput has no UI in this build');
    assert.ok(/no Spout (button|control)/i.test(md),
      'documents/output.md leaves the reader hunting the OUTPUT modal for Spout — say it is absent');
  });
});

// ── What the GIF recorder will and will not accept ────────────────────────────
// Three documents priced 720p × 30fps × 60s at "~1.5 GB" and called the limit
// something the UI "warns" about. It is a refusal, and that combination is
// priced at 5273 MB — the one setting presented as the achievable maximum was
// the one that can never run. The numbers are computable, so compute them:
// the table in recording.md is re-derived here from the recorder's own frame
// plan and its own ceiling.

/** LIMITS.maxFrameMemMb, read out of src/recorder.js (it is not exported). */
function frameMemCeilingMb() {
  const m = read('src/recorder.js').match(/maxFrameMemMb:\s*(\d[\d_]*)/);
  assert.ok(m, 'src/recorder.js no longer states maxFrameMemMb');
  return Number(m[1].replace(/_/g, ''));
}

/** Rows of the memory table in documents/recording.md. */
function memoryTableRows() {
  const rowRe = /^\|\s*(\d+)p\s*×\s*(\d+)\s*fps\s*×\s*(\d+)\s*s\s*\|\s*(\d+)\s*×\s*(\d+)\s*\|\s*(\d+)\s*MB\s*\|\s*(records|refused)\s*\|/;
  return read('documents/recording.md').split('\n').reduce((rows, line) => {
    const m = line.match(rowRe);
    if (m) rows.push({
      shortEdge: +m[1], fps: +m[2], seconds: +m[3],
      width: +m[4], height: +m[5], mb: +m[6], refused: m[7] === 'refused',
      line: line.trim(),
    });
    return rows;
  }, []);
}

describe('documents/recording.md prices GIF captures the way the recorder does', () => {

  test('every row is the estimate start() computes, and the verdict it reaches', () => {
    const ceiling = frameMemCeilingMb();

    for (const r of memoryTableRows()) {
      // start(): frames = ceil(expected ms / quantised period), 4 bytes/pixel.
      const { frameDelay } = gifFramePlan(r.fps, r.seconds * 1000);
      const frames = Math.ceil(r.seconds * 1000 / frameDelay);
      const mb     = (r.width * r.height * 4 * frames) / (1024 * 1024);

      assert.equal(Math.round(mb), r.mb, `estimate drifted — ${r.line}`);
      assert.equal(mb > ceiling, r.refused,
        `${r.line}: ${Math.round(mb)}MB against a ${ceiling}MB ceiling says ` +
        `"${mb > ceiling ? 'refused' : 'records'}"`);
    }
  });

  test('the frame sizes are the ones the OUTPUT panel derives from the p-value', () => {
    // modals.js computeDimensions(), landscape branch — the aspect the table
    // is written for. Not exported, so mirrored here; the point is that "720p"
    // and "1280 × 720" cannot drift apart inside one row.
    for (const r of memoryTableRows()) {
      assert.equal(r.height, r.shortEdge, `${r.line}: short edge is the p-value`);
      assert.equal(r.width, Math.round(r.shortEdge * 16 / 9), `${r.line}: 16:9 width`);
    }
  });

  test('the document states the ceiling the code enforces', () => {
    const ceiling = frameMemCeilingMb();
    // Not `includes(...)` over the whole file. That passed while two of the
    // three mentions in this page drifted, which is the realistic failure:
    // one paragraph gets updated and the others do not. Every page that states
    // the budget states it a fixed number of times, so a single site going
    // stale changes a count and fails here.
    const MENTIONS = {
      'documents/recording.md': 4,        // headline, the quoted refusal, the table's caption, the technical note
      'DISCLAIMER.md': 1,
      'documents/troubleshooting.md': 1,
    };
    for (const [rel, expected] of Object.entries(MENTIONS)) {
      const found = (read(rel).match(new RegExp(`${ceiling} ?MB`, 'g')) || []).length;
      assert.equal(found, expected,
        `${rel} states the ${ceiling} MB budget ${found}×, expected ${expected}× — either a ` +
        'mention went stale or a new one was added; check them all, then update this count');
    }
    // And the refusal character for character, because that string is built
    // from LIMITS at run time: a page quoting a different number is quoting a
    // message no operator will ever be shown.
    assert.ok(read('documents/recording.md').includes(`limit ${ceiling}MB`),
      `documents/recording.md must quote the refusal verbatim: "limit ${ceiling}MB"`);
  });

  test('the page is right that a 60-second clip only fits at 480p, and never at 30 fps', () => {
    const ceiling = frameMemCeilingMb();
    const fits = (shortEdge, fps, seconds) => {
      const width = Math.round(shortEdge * 16 / 9);
      const { frameDelay } = gifFramePlan(fps, seconds * 1000);
      const frames = Math.ceil(seconds * 1000 / frameDelay);
      return (width * shortEdge * 4 * frames) / (1024 * 1024) <= ceiling;
    };
    const sizes = selectValues('rec-gif-size').map(Number);
    const rates = selectValues('rec-gif-fps').map(Number);

    const at60 = sizes.filter(p => rates.some(f => fits(p, f, 60)));
    assert.deepEqual(at60, [480], `sizes that fit at 60 s: ${at60.join(', ') || 'none'}`);
    assert.deepEqual(rates.filter(f => fits(480, f, 60)), rates.filter(f => f <= 15),
      '480p at 60 s no longer fits exactly at "15 fps or below"');
    for (const p of sizes) {
      assert.ok(!fits(p, 30, 60), `${p}p × 30 fps × 60 s now fits — the page says none does`);
    }
  });

  test('control — the table still discriminates', () => {
    const rows = memoryTableRows();
    assert.ok(rows.length >= 3, `only ${rows.length} rows parsed from the memory table`);
    assert.ok(rows.some(r => r.refused),  'no refused row — the ceiling is unillustrated');
    assert.ok(rows.some(r => !r.refused), 'no accepted row — the table reads as "GIF never works"');
    assert.ok(selectValues('rec-gif-size').length >= 2, 'the SIZE selector was not read');
  });
});

// ── Counts that go stale on every added suite ─────────────────────────────────
// CONTRIBUTING.md told contributors `npm test` was "208 tests" while the run
// printed 491, then 610. Nothing enforces such a number and every new suite
// invalidates it, so the rule is the one .github/workflows/ci.yml settled on:
// state the scope, let the run print the count.

describe('no document states a fixed total for the unit suite', () => {

  test('the documented pre-push command carries no test count', () => {
    for (const rel of ['CONTRIBUTING.md']) {
      for (const line of read(rel).split('\n')) {
        if (!/\bnpm test\b/.test(line)) continue;
        assert.ok(!/\b\d+ tests?\b/.test(line),
          `${rel} states a test total that the next added suite falsifies: ${line.trim()}`);
      }
    }
  });
});

// ── Attribution ───────────────────────────────────────────────────────────────
// LICENSE.txt is the notice a redistributor must ship, so it is the list. The
// in-app License page and the README both dropped micromark-extension-gfm-table
// from it while DISCLAIMER.md and safety.md carried it.

/** Library names from the third-party block of LICENSE.txt. */
function attributedLibraries() {
  const txt   = read('LICENSE.txt');
  const start = txt.indexOf('VIMATHIC incorporates the following third-party libraries');
  assert.ok(start > 0, 'LICENSE.txt has no third-party attribution block');
  const block = txt.slice(start, txt.indexOf('makes no copyright claim to these libraries', start));
  return [...block.matchAll(/^\s+-\s+(\S[^—]*?)\s+—/gm)].map(m => m[1]);
}

describe('every document that lists the third-party libraries lists all of them', () => {

  const QUOTING = [
    'README.md',
    'DISCLAIMER.md',
    'documents/license.md',
    'documents/safety.md',
  ];

  test('no attribution list is short an entry', () => {
    const libs = attributedLibraries();
    for (const rel of QUOTING) {
      const body = read(rel);
      for (const lib of libs) {
        assert.ok(body.includes(lib),
          `${rel} omits ${lib}, which LICENSE.txt attributes and a redistributor must carry`);
      }
    }
  });

  test('control — the binding list is read, not assumed', () => {
    const libs = attributedLibraries();
    assert.ok(libs.length >= 6, `only ${libs.length} libraries parsed from LICENSE.txt`);
    assert.ok(libs.includes('micromark-extension-gfm-table'),
      'the entry that went missing is no longer in LICENSE.txt — re-read the block');
  });
});

// ── The accuracy banner ───────────────────────────────────────────────────────
// README's own HTML comment says the tier figures come from
// MATHEMATICAL_ACCURACY.md. The banner had "bounded error ≤ 10⁻⁷" where the
// cited table says "≤ 10⁻³ to 10⁻⁷" — and three Tier-B formulas are documented
// at 10⁻³/10⁻⁴, so the banner promised four orders of magnitude it cannot keep.

/** The Executive Summary rows of MATHEMATICAL_ACCURACY.md: tier → count. */
function tierCounts() {
  const rows = [...read('MATHEMATICAL_ACCURACY.md')
    .matchAll(/^\|\s*\*\*([ABC])\*\*[^|]*\|\s*\*\*(\d+)\*\*\s*\|/gm)];
  return Object.fromEntries(rows.map(m => [m[1], Number(m[2])]));
}

/** The error range MATHEMATICAL_ACCURACY.md documents for Tier B. */
function tierBRange() {
  const m = read('MATHEMATICAL_ACCURACY.md').match(/Documented error ≤ ([^.|]+)\./);
  assert.ok(m, 'MATHEMATICAL_ACCURACY.md no longer documents a Tier B error bound');
  return m[1].trim();
}

describe('README quotes MATHEMATICAL_ACCURACY.md, the file it says it quotes', () => {

  test('the banner states the Tier B error range, not its best end', () => {
    const range  = tierBRange();
    const banner = read('README.md').split('\n')
      .find(l => l.includes('validated approximations with bounded error'));
    assert.ok(banner, 'README lost the accuracy banner');
    assert.ok(banner.includes(range),
      `the banner says "${banner.trim()}" where MATHEMATICAL_ACCURACY.md documents ${range}`);
  });

  test('the tier table carries the same counts as the file it cites', () => {
    const expected = tierCounts();
    const readme   = Object.fromEntries(
      [...read('README.md').matchAll(/^\|\s*[^\s|]+\s*([ABC])\s*\|\s*(\d+)\s*\|/gm)]
        .map(m => [m[1], Number(m[2])]));
    assert.deepEqual(readme, expected, 'README tier table and MATHEMATICAL_ACCURACY.md disagree');
  });

  test('the banner headline is the sum of the tiers it summarises', () => {
    const { A, B, C } = tierCounts();
    const readme = read('README.md');
    assert.ok(readme.includes(`${A + B} of ${A + B + C} formulas`),
      `the headline is not "${A + B} of ${A + B + C} formulas"`);
    assert.ok(readme.includes(`${B} validated approximations`), `Tier B count is ${B}`);
  });

  test('control — the cited numbers were really read from the cited file', () => {
    const t = tierCounts();
    assert.deepEqual(Object.keys(t).sort(), ['A', 'B', 'C']);
    assert.match(tierBRange(), /10⁻/);
  });
});

// ── What is on the user's disk ────────────────────────────────────────────────
// The Safety & Privacy page enumerates what VIMATHIC keeps in localStorage. It
// listed five of the six keys, and the missing one was the biggest: the session
// snapshot, which carries any Camera Programmer script and custom shader source
// the user applied. A privacy page's list has to be the whole list.

/** Every localStorage key the app writes. DOM ids use a leading underscore. */
function storageKeys() {
  const src = path.join(ROOT, 'src');
  const keys = new Set();
  for (const f of readdirSync(src, { recursive: true })) {
    if (typeof f !== 'string' || !f.endsWith('.js')) continue;
    for (const m of readFileSync(path.join(src, f), 'utf8').matchAll(/'(vimathic_[a-z_]+)'/g)) {
      keys.add(m[1]);
    }
  }
  return [...keys].sort();
}

describe('documents/safety.md accounts for everything VIMATHIC stores locally', () => {

  test('every key the app writes is named on the privacy page', () => {
    const md = read('documents/safety.md');
    for (const key of storageKeys()) {
      assert.ok(md.includes(key),
        `documents/safety.md never mentions ${key} — its "what we store" list reads as exhaustive`);
    }
  });

  test('control — the keys come from the source, and the snapshot is among them', () => {
    const keys = storageKeys();
    assert.ok(keys.length >= 6, `only ${keys.length} storage keys found in src/`);
    assert.ok(keys.includes('vimathic_persisted_state'),
      'the auto-persist key moved — re-read src/ui/presets.js before trusting this test');
  });
});

// ── Mechanisms the code rejected by name ──────────────────────────────────────
// SECURITY.md and shader-editor.md credited shader error feedback to
// compileAsync(), which src/shaders.js documents at length as unusable —
// "it does not reject on a link failure, so every broken shader was reported
// to the user as 'compiled & applied'". A security page naming the mechanism
// whose failure mode was "broken looks valid" is worse than naming none.

describe('the documents describe the shader compile path the code takes', () => {

  test('control — the code hook is onShaderError and compileAsync survives only in a comment', () => {
    const src = read('src/shaders.js');
    assert.ok(src.includes('renderer.debug.onShaderError = '), 'the error hook is no longer installed');
    for (const line of src.split('\n')) {
      if (line.includes('compileAsync')) {
        assert.match(line.trim(), /^\/\//,
          `src/shaders.js now calls compileAsync — the documents may say so again: ${line.trim()}`);
      }
    }
  });

  test('no document credits compileAsync for the error feedback', () => {
    for (const rel of ['SECURITY.md', 'documents/shader-editor.md']) {
      const body = read(rel);
      assert.ok(!body.includes('compileAsync'),
        `${rel} credits compileAsync, which src/shaders.js rejects by name`);
      assert.ok(body.includes('onShaderError'),
        `${rel} describes the shader error feedback without naming the hook that provides it`);
    }
  });
});

// ── The recovery that does not recover ────────────────────────────────────────
// shader-editor.md told a user whose GPU had hung to refresh, on the grounds
// that customVS/customFS "don't persist across reloads". They do: the applied
// shader is part of the auto-saved snapshot and bootPersist recompiles it on
// the next load, so the documented escape reproduces the freeze.

describe('documents/shader-editor.md describes what a reload actually restores', () => {

  test('control — the applied shader is captured and re-applied at boot', () => {
    const src = read('src/ui/presets.js');
    assert.match(src, /shader:\s*\{/,   'captureState no longer records the shader');
    assert.match(src, /s\.shader\.vert/, 'applyState no longer restores the shader source');
    assert.match(src, /_persistKey:\s*'vimathic_persisted_state'/, 'the auto-persist key moved');
  });

  test('the page does not call the custom shader runtime-only', () => {
    const md = read('documents/shader-editor.md');
    assert.ok(!/don't persist across reloads/.test(md),
      'shader-editor.md still says the custom shader does not survive a reload');
    assert.ok(md.includes('vimathic_persisted_state'),
      'shader-editor.md sends a frozen user to a reload without saying what the reload restores');
  });
});

// ── Which engine runs which formula ───────────────────────────────────────────
// The research pages credited the GPU shaders with Bessel functions and
// reaction-diffusion PDEs. Both are `m:` entries — CPU formulas evaluated in
// the math Web Worker — and the split is the thing troubleshooting.md spends
// paragraphs teaching.

/** The numbered GPU shader labels of #gpu-sel, as index.html ships them. */
function gpuShaderLabels() {
  const html  = read('index.html');
  const start = html.indexOf('<select id="gpu-sel">');
  assert.ok(start > 0, 'index.html has no #gpu-sel');
  const block = html.slice(start, html.indexOf('</select>', start));
  return [...block.matchAll(/>(\d+\.\s*[^<]*)</g)].map(m => m[1].trim());
}

describe('the research pages put each formula on the engine that runs it', () => {

  test('control — no GPU shader mode is Bessel or reaction-diffusion', () => {
    const labels = gpuShaderLabels();
    assert.ok(labels.length >= 30, `only ${labels.length} numbered GPU modes parsed`);
    for (const label of labels) {
      assert.ok(!/bessel|reaction|gray-scott/i.test(label),
        `a GPU mode now IS one of these: ${label} — the science pages may claim it`);
    }
    const html = read('index.html');
    assert.match(html, /m:specialFunctions:bessel0/, 'Bessel J₀ is a CPU formula');
    assert.match(html, /m:cellularAutomata:reactionDiffusion/, 'Gray-Scott is a CPU formula');
  });

  test('Bessel and reaction-diffusion are named as CPU work', () => {
    // Neither page has to mention a given term — but between them they must,
    // or the assertion below is satisfied by deleting the sentence instead of
    // correcting it.
    for (const term of ['Bessel', 'reaction-diffusion']) {
      assert.ok(['SCIENCE.md', 'documents/science.md'].some(rel => read(rel).includes(term)),
        `neither science page mentions ${term} any more — the claim was dropped, not fixed`);
    }
    for (const rel of ['SCIENCE.md', 'documents/science.md']) {
      const body = read(rel).replace(/\s+/g, ' ');
      for (const term of ['Bessel', 'reaction-diffusion']) {
        const at = body.indexOf(term);
        if (at < 0) continue;   // this page need not mention it; the pair must
        const sentence = body.slice(body.lastIndexOf('.', at) + 1, body.indexOf('.', at) + 1);
        assert.ok(/CPU/.test(sentence),
          `${rel} mentions ${term} without placing it on the CPU path: "${sentence.trim()}"`);
      }
    }
  });
});

describe('MATHEMATICAL_ACCURACY.md survives its own arithmetic (#R9)', () => {
  // Round 8 left a guard whose only hold on the numbers it cannot re-measure is
  // a COUNT: math-validation.test.js keeps a per-row floor (FIGURE_FLOOR) on how
  // many figures its SHAPES could read back out of a row. A count catches a
  // figure moved BETWEEN rows — that is the mutation it was built for, and it
  // still fails on it — and cannot catch two numbers exchanged WITHIN one row,
  // because the count does not move. Measured on 2026-08-18 over the twelve
  // rows that state a fold coverage: 1087 numeric tokens, 75 of them re-measured
  // by a shape, 1012 read by nobody. Exchanging two of the 1012 left the fold
  // guard green, math-validation.test.js at 283/283 and this file at 27/27.
  //
  // The demonstration, which is the control at the foot of this block: in
  // `eulerIm`'s row, exchange the top of the clock range with the mean quoted
  // beside it — "runs 24.30…27.10 % at grid 81 (mean 26.1)" becomes
  // "runs 24.30…26.1 % at grid 81 (mean 27.10)". Every count is unchanged; the
  // sentence now puts the mean of a set outside the range of the same set.
  //
  // So this guard is a threshold on the SHAPE of the sentence rather than on a
  // count of its digits. It re-measures nothing — it asks the arithmetic a
  // sentence carries in its own shape:
  //   * a range reads low-first;
  //   * a mean quoted with a range lies inside it;
  //   * a t = 0 figure quoted with a range lies inside it;
  //   * "N of M vertices" has N ≤ M, and M is a mesh the app lays down.
  // It costs one pass over one file and calls no kernel.
  //
  // What it deliberately does NOT do is require a row to CARRY any of those
  // shapes. A guard that fires on ordinary rewording gets deleted, and deletion
  // is already the count's job. The floors below are controls on the walk, not
  // a house style imposed on the prose.

  // a…b with plain decimals on both sides. The lookarounds keep scientific
  // ranges out: "1e-3…1e-7" is legitimately decreasing, and its "3…1" is not a
  // range at all.
  const RANGE = /(?<![\w.−-])(\d+(?:\.\d+)?)…(\d+(?:\.\d+)?)(?![\w.])/g;
  // the meshes the app lays down (src/main.js 81/161, src/render.js 41/81),
  // the suite's 90, and their vertex counts
  const LATTICE = new Set([41, 81, 90, 161, 1681, 6561, 8100, 25921]);

  /** Every self-contradiction the shape of a sentence can be asked for. */
  const scan = text => {
    const bad = [];
    let ranges = 0, quoted = 0, counts = 0;
    text.split('\n').forEach((line, i) => {
      const found = [...line.matchAll(RANGE)];
      found.forEach((m, k) => {
        ranges++;
        const lo = +m[1], hi = +m[2];
        if (!(lo < hi)) bad.push(`line ${i + 1}: the range "${m[0]}" reads high-first`);
        // The window a figure has to sit in to be quoted ABOUT this range: up to
        // the next range, the end of the clause, or 80 characters, whichever
        // comes first. Short on purpose — a wider window picks up figures about
        // something else. At 80 it reads the five sites in the file today and
        // stops before romanSurface's "r² = 75 at t = 0", which is 150
        // characters and one dash away from the range it would have been
        // attached to.
        const from = m.index + m[0].length;
        const cut = s => { const j = line.indexOf(s, from); return j < 0 ? line.length : j; };
        const clause = line.slice(from, Math.min(cut(';'), cut('. '), cut('—'),
          found[k + 1] ? found[k + 1].index : line.length, from + 80));
        for (const [what, re] of [['mean', /\(mean (\d+(?:\.\d+)?)/],
                                  ['t = 0 figure', /(\d+(?:\.\d+)?) at t = 0/]]) {
          const q = re.exec(clause);
          if (!q) continue;
          quoted++;
          if (+q[1] < lo || +q[1] > hi) {
            bad.push(`line ${i + 1}: the ${what} ${q[1]} is outside the range ${m[0]} it is quoted with`);
          }
        }
      });
      for (const m of line.matchAll(/(?<![\w.])(\d+) of (?:the )?(\d+) vertices/g)) {
        counts++;
        if (+m[1] > +m[2]) bad.push(`line ${i + 1}: "${m[0]}" counts more vertices than the mesh has`);
        if (!LATTICE.has(+m[2])) {
          bad.push(`line ${i + 1}: "${m[0]}" counts out of ${m[2]}, which is no mesh the app lays down`);
        }
      }
    });
    return { bad, ranges, quoted, counts };
  };

  test('no sentence in it contradicts its own numbers', () => {
    const r = scan(read('MATHEMATICAL_ACCURACY.md'));
    assert.deepEqual(r.bad, [],
      'a sentence states numbers that cannot all be true of the same measurement — two of them have ' +
      `most likely been exchanged inside the line, which no count can see:\n  ${r.bad.join('\n  ')}`);
    // Controls on the walk, not a shape asked of the prose: 47 ranges, 5 figures
    // quoted with one and 5 vertex counts were read on 2026-08-18. They are set
    // well below those so that an editor who drops a parenthetical mean does not
    // turn this red — the relations are the guard, and these only catch the walk
    // going quiet, which is how the last three versions of the fold guard failed.
    assert.ok(r.ranges >= 40 && r.quoted >= 2 && r.counts >= 3,
      `the walk read ${r.ranges} ranges, ${r.quoted} figures quoted with one and ${r.counts} vertex ` +
      'counts, against 47/5/5 when this was written — it has stopped reading the document');
  });

  test('control — the scan goes red on the swap that motivated it, and stays quiet on a rewrite', () => {
    // the exact mutation: eulerIm's mean and the top of its own range exchanged
    const swapped = 'the factory figure runs 24.30…26.1 % at grid 81 (mean 27.10) and 24.30…26.94 % at 161';
    assert.equal(scan(swapped).bad.length, 1, `the mean-outside-its-range swap reads clean: ${swapped}`);
    assert.match(scan(swapped).bad[0], /mean 27\.10 is outside/);
    // the other three shapes, each with the smallest edit that breaks it
    assert.equal(scan('the coverage runs 27.10…24.30 % over one turn').bad.length, 1, 'a backwards range reads clean');
    assert.equal(scan('runs 15.79…42.72 % (mean 25.4, and 92.73 at t = 0)').bad.length, 1, 'a t = 0 figure outside its range reads clean');
    assert.equal(scan('8100 of 4 vertices move at grid 90').bad.length, 2, 'an impossible vertex count reads clean');
    // …and the same sentences, said differently and still true, are silent —
    // a guard that fires on rewording is a guard that gets deleted
    for (const ok of [
      'the factory figure runs 24.30…27.10 % at grid 81 (mean 26.1) and 24.30…26.94 % at 161',
      'over one turn of the clock it spans 24.30…27.10 % of the plate, averaging 26.1 %, at grid 81',
      'runs 15.79…42.72 % (mean 25.4, and 22.73 at t = 0), so the boot instant is under half the mean',
      'the fold covers 24.30 % at grid 81 and 24.30 % at 161, both read at t = 0',
      '4 of 8100 vertices move at grid 90, and 1341 of 6561 at grid 81',
      'tier B asserts a bounded 1e-3…1e-7 approximation',            // decreasing on purpose
      'r² runs 0.35…90 over the reachable box — amp 2.25 / freq 0.3 gives r² = 75 at t = 0',
    ]) assert.deepEqual(scan(ok).bad, [], `a legitimate sentence was flagged: ${ok}`);
  });
});
