// tests/preset-migrations.test.js
//
// Contract tests for migratePreset() in src/ui/presets.js — the single gate
// every preset / autosave / imported .json passes through before applyState()
// touches the engine. src/ui/presets.js names this file in its design notes as
// the place those fixtures live.
//
// Run:
//   node --test tests/preset-migrations.test.js
//
// ── Why this can run in plain Node ────────────────────────────────────────────
// src/ui/presets.js imports src/dom.js (via params.js as well), but dom.js has
// an explicit Node guard: `const HAS_DOCUMENT = typeof document !== 'undefined'`
// short-circuits resolveGroup(), so importing outside a browser yields a stub
// DOM object instead of throwing. migratePreset() itself is a pure object
// transform — it never reads DOM, the renderer or the audio engine — which is
// exactly the property the design notes claim makes it "trivially testable with
// snapshot fixtures". No jsdom, no stubbing, no refactor needed.
//
// ── What is pinned here ───────────────────────────────────────────────────────
// The four bullets of the "Contract" block in presets.js:
//   1. the return value ALWAYS carries _version === CURRENT_PRESET_VERSION;
//   2. the input is never mutated (shallow copy; nested objects are shared);
//   3. missing / non-numeric / sub-1 _version is read as v1, not rejected;
//   4. a snapshot from a newer build loads best-effort with a warning.
// Points 3 and 4 are the behaviour change from defect #18 — before the fix a
// snapshot without _version was dropped on the floor (`return null`) and one
// from the future was returned unstamped. Both are regression-guarded below.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { migratePreset, CURRENT_PRESET_VERSION } from '../src/ui/presets.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run `fn` with console.warn silenced, returning the captured messages.
 * migratePreset warns on future-version snapshots by design; the test asserts
 * the warning happened without spraying it over the runner's output.
 */
function captureWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try { fn(); } finally { console.warn = original; }
  return warnings;
}

/**
 * A representative snapshot body, minus the version stamp. Field names mirror
 * captureState() in presets.js so a rename there surfaces here as a stale
 * fixture rather than as a silently-narrower test.
 */
function fixtureBody() {
  return {
    shape:      'icosahedron',
    gpuSelVal:  'm:differentialEqs:pendulumNonLinear',
    vizMode:    'wireframe',
    deformMode: 'surface',
    params:     { amp: 0.7, waveInt: 1.0, bassSens: 1.2, colorIdx: 16 },
    camera:     { pos: [5.5, 4.2, 6.8], target: [0, 0.1, 0], fov: 45 },
    camScript:  { active: false, code: '', params: {}, keyframes: [] },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. THE VERSION STAMP — the promise every caller relies on
// ═══════════════════════════════════════════════════════════════════════════════

describe('migratePreset — always stamps the current version', () => {
  test('CURRENT_PRESET_VERSION is a usable integer ≥ 1', () => {
    // Guards the constant itself: a stray `undefined` or a string would make
    // every assertion below vacuously true.
    assert.ok(Number.isInteger(CURRENT_PRESET_VERSION),
      `CURRENT_PRESET_VERSION must be an integer, got ${CURRENT_PRESET_VERSION}`);
    assert.ok(CURRENT_PRESET_VERSION >= 1);
  });

  test('snapshot with NO _version migrates to CURRENT_PRESET_VERSION', () => {
    // Regression guard for defect #18. Before the fix this path did
    // `if (v < 1) return null` — every pre-stamp snapshot and every
    // hand-written .json was silently rejected on import.
    const input  = fixtureBody();
    const out    = migratePreset(input);

    assert.notEqual(out, null, 'unversioned snapshot was rejected');
    assert.equal(out._version, CURRENT_PRESET_VERSION);
  });

  test('snapshot with _version: 1 migrates to CURRENT_PRESET_VERSION', () => {
    const out = migratePreset({ _version: 1, ...fixtureBody() });
    assert.notEqual(out, null);
    assert.equal(out._version, CURRENT_PRESET_VERSION);
  });

  test('snapshot already at CURRENT_PRESET_VERSION stays there', () => {
    const out = migratePreset({ _version: CURRENT_PRESET_VERSION, ...fixtureBody() });
    assert.equal(out._version, CURRENT_PRESET_VERSION);
  });

  test('garbage _version values are read as v1, not rejected', () => {
    // "Non-numeric / below-1 → treat as v1" from the contract block. Each of
    // these used to fall into the `v < 1` reject branch (or, for the string
    // and NaN cases, produce a NaN comparison that rejected too).
    const garbage = [undefined, null, 0, -3, NaN, Infinity, '2', 'two', {}, [], true, 1.5];
    for (const bad of garbage) {
      const out = migratePreset({ _version: bad, ...fixtureBody() });
      assert.notEqual(out, null, `_version: ${String(bad)} was rejected outright`);
      assert.equal(out._version, CURRENT_PRESET_VERSION,
        `_version: ${String(bad)} did not end up stamped`);
    }
  });

  test('empty object is rejected — it carries nothing applyState can read', () => {
    // #18 loosened the version check so unversioned snapshots load; the r2
    // follow-up re-tightened *content* recognition so that loosening does not
    // turn every parsed object into a "loaded preset". `{}` carries none of
    // PARAM_FIELDS / STATE_FIELDS, so it is not a snapshot and importing it
    // must report failure rather than a silent no-op the user reads as success.
    assert.equal(migratePreset({}), null);
  });

  test('an unversioned snapshot with real content still loads', () => {
    // The other half of the same rule: content, not the version stamp, is what
    // makes something a preset. This is the case #18 exists for.
    const out = migratePreset(fixtureBody());
    assert.notEqual(out, null, 'unversioned snapshot with real fields was rejected');
    assert.equal(out._version, CURRENT_PRESET_VERSION);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FORWARD COMPATIBILITY — snapshots written by a newer build
// ═══════════════════════════════════════════════════════════════════════════════

describe('migratePreset — snapshot from a newer build', () => {
  const FUTURE = CURRENT_PRESET_VERSION + 7;

  test('is loaded best-effort rather than rejected', () => {
    let out;
    captureWarnings(() => { out = migratePreset({ _version: FUTURE, ...fixtureBody() }); });

    assert.notEqual(out, null, 'future snapshot was rejected');
    assert.equal(out.shape, 'icosahedron', 'payload was dropped');
  });

  test('is stamped DOWN to CURRENT_PRESET_VERSION on the returned copy', () => {
    // This is the behaviour the agent settled on: the in-memory copy is
    // normalised so downstream code never sees an unknown version, while the
    // original record (on disk / in localStorage) keeps its own stamp.
    let out;
    const input = { _version: FUTURE, ...fixtureBody() };
    captureWarnings(() => { out = migratePreset(input); });

    assert.equal(out._version, CURRENT_PRESET_VERSION);
    assert.equal(input._version, FUTURE,
      'the stored snapshot must keep its own version — only the copy is stamped');
  });

  test('warns exactly once, naming both versions', () => {
    const warnings = captureWarnings(() => migratePreset({ _version: FUTURE, ...fixtureBody() }));

    assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
    assert.match(warnings[0], /\[preset\]/);
    assert.match(warnings[0], new RegExp(`v${FUTURE}`), 'warning omits the file version');
    assert.match(warnings[0], new RegExp(`v${CURRENT_PRESET_VERSION}`),
      'warning omits the current version');
  });

  test('does NOT warn for current or older snapshots', () => {
    const quiet = captureWarnings(() => {
      migratePreset(fixtureBody());
      migratePreset({ _version: 1, ...fixtureBody() });
      migratePreset({ _version: CURRENT_PRESET_VERSION, ...fixtureBody() });
    });
    assert.deepEqual(quiet, [], `unexpected warnings: ${quiet.join(' | ')}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. UNUSABLE INPUT — the one path that still returns null
// ═══════════════════════════════════════════════════════════════════════════════

describe('migratePreset — rejects non-objects', () => {
  test('null / undefined / primitives return null', () => {
    // The `!s || typeof s !== 'object'` guard. These come from
    // JSON.parse of a truncated or non-preset file.
    for (const bad of [null, undefined, 0, 1, '', 'preset', true, false, NaN]) {
      assert.equal(migratePreset(bad), null,
        `expected null for ${JSON.stringify(bad) ?? String(bad)}`);
    }
  });

  test('arrays are rejected — `typeof [] === "object"` must not be a loophole', () => {
    // An array passes the `typeof s !== 'object'` guard, so it is turned away
    // explicitly. Both the empty and the populated case: a JSON array is never
    // a snapshot, whatever it holds.
    assert.equal(migratePreset([]), null);
    assert.equal(migratePreset([fixtureBody()]), null);
  });

  test('a foreign config is rejected, not reported as a loaded preset', () => {
    // The concrete scenario the content check exists for: the user picks the
    // wrong .json in the import dialog. It parses, it is a non-array object —
    // and before the content check it came back stamped as a current preset.
    const packageJsonish = { name: 'vimathic', version: '1.0.0-beta', scripts: { test: 'node --test' } };
    assert.equal(migratePreset(packageJsonish), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PURITY — the caller's object must come back untouched
// ═══════════════════════════════════════════════════════════════════════════════

describe('migratePreset — never mutates its input', () => {
  test('input object is byte-identical after migration', () => {
    // _renderPresets keeps the parsed record in a closure and re-serialises
    // it later; a mutating migration would write the migrated shape back into
    // localStorage as a side effect of merely *loading* a preset.
    const input  = fixtureBody();
    const before = JSON.stringify(input);

    migratePreset(input);

    assert.equal(JSON.stringify(input), before, 'migratePreset mutated its argument');
    assert.equal('_version' in input, false, 'migratePreset stamped the input in place');
  });

  test('returns a NEW object, never the same reference', () => {
    const input = { _version: CURRENT_PRESET_VERSION, ...fixtureBody() };
    const out   = migratePreset(input);
    assert.notEqual(out, input,
      'identity migratePreset(s) === s would let callers mutate stored records');
  });

  test('payload fields survive the copy intact', () => {
    const input = fixtureBody();
    const out   = migratePreset(input);
    for (const key of Object.keys(input)) {
      assert.deepEqual(out[key], input[key], `field '${key}' was lost or altered`);
    }
  });

  test('nested objects are SHARED, not deep-cloned (documented contract)', () => {
    // presets.js states this explicitly: "Nested objects (camera, camScript,
    // shader) are shared, not deep-cloned; applyState only reads them."
    // Pinned so switching to a deep clone is a conscious decision — it would
    // change the memory profile of loading a preset with many keyframes.
    const input = fixtureBody();
    const out   = migratePreset(input);
    assert.equal(out.camera,    input.camera);
    assert.equal(out.camScript, input.camScript);
  });
});
