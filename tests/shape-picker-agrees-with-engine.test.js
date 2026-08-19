// tests/shape-picker-agrees-with-engine.test.js
//
// Round 10 put a whitelist behind the ENGINE: RenderEngine.setShape resolves
// its argument through normalizeShape (src/render.js), so the scene is always
// a shape this build can draw. It did not put one behind the PICKER.
// _applyStateFields wrote `DOM.shapeSel.value = s.shape` — the raw value out
// of the snapshot — so the control and the scene could show different things.
//
// Measured on the built app in real Chromium before the fix, boot with
// {shape:'retiredName'} seeded into localStorage before any app script ran:
//   scene   pyramid-smooth       (one "[shape] unknown shape" warning)
//   picker  placeholder "— select —", <select>.selectedIndex -1
// notes/audits/vimathic-round10-2026-08-19/close/shape-picker/P1-BEFORE.txt
//
// Run:
//   node --test tests/shape-picker-agrees-with-engine.test.js
//
// ── What this file guards ────────────────────────────────────────────────────
// 1. BEHAVIOUR. Every door in presets.js that carries a shape value this build
//    did not write — preset apply, importSettings, a clip step, an AUTO cycle
//    step, bootPersist's localStorage restore — is driven with hostile values
//    through the real code, against a picker stub whose `value` setter records
//    every write. Every recorded write must be a member of SHAPE_NAMES, and
//    must be the same string the engine's setShape was handed.
// 2. PROVENANCE. Every `.value =` write to the shape picker anywhere in src/
//    is classified, and only three classifications are allowed. This is what
//    makes "any door" a claim about the tree and not about the doors that
//    happened to be listed here.
//
// Both halves carry a CONTROL that must NOT fire, and the provenance census
// carries mutation controls — the census is re-run against source text that has
// been edited back to the defect, and has to fail on it. A census that cannot
// fail would pass this file for the wrong reason, which is the failure mode
// this repo keeps shipping.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Stub DOM, installed before src/ui/presets.js is imported ────────────────
// dom.js resolves its element table at import time, so DOM.shapeSel must
// already be this recording stub by then. Same arrangement as
// tests/preset-apply.test.js.
const shapeWrites = [];
function makeEl(id) {
  const el = {
    _value: '', textContent: '', checked: false, disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return true; },
    querySelectorAll: () => [], appendChild() {}, remove() {},
  };
  Object.defineProperty(el, 'value', {
    get() { return this._value; },
    set(v) {
      // Recorded, not validated, on purpose: a stub that threw would stop the
      // apply at the first bad write and hide any later one. The assertions
      // read the whole list.
      if (id === 'shape-sel') shapeWrites.push(v);
      this._value = v;
    },
  });
  return el;
}
globalThis.document = {
  _els: new Map(),
  getElementById(id) {
    if (!this._els.has(id)) this._els.set(id, makeEl(id));
    return this._els.get(id);
  },
  createElement: () => makeEl(null),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
globalThis.requestAnimationFrame = () => 0;

let PresetMixin, SHAPE_NAMES, DEFAULT_SHAPE, normalizeShape;
before(async () => {
  ({ PresetMixin } = await import('../src/ui/presets.js'));
  ({ SHAPE_NAMES, DEFAULT_SHAPE, normalizeShape } = await import('../src/shapes.js'));
});

/** Swallow the "[shape] unknown …" warnings so a hostile sweep is readable. */
function quietly(fn) {
  const real = console.warn;
  const said = [];
  console.warn = (...a) => said.push(a.join(' '));
  try { return { result: fn(), warned: said }; } finally { console.warn = real; }
}

// ── A UIController stand-in carrying only what the shape path touches ───────
function makeUi() {
  const calls = [];
  const render = {
    vizMode: 'surface', currentMaterial: 'matte', currentParticleStyle: 'squares',
    currentShape: DEFAULT_SHAPE,
    grid: { visible: true }, uMathMode: 0,
    gpuMat: { vertexShader: 'VS', fragmentShader: 'FS' },
    camera: { position: { x: 0, y: 0, z: 5 } },
    // MODELS render.js:1963 — the real setShape's first statement is
    // `shape = normalizeShape(shape)`, and everything downstream, including
    // currentShape and the onShapeChange callback, sees the resolved name.
    // Recording the raw argument instead would make the "picker and engine
    // agree" assertion unfalsifiable: measured on a mutant with the defect
    // restored, a stub that skipped this reported agreement on 'retiredName'
    // — both halves wrong in the same way reads as agreement.
    // close/shape-picker/P2-mutation-behavioural.txt
    setShape(s) { const r = normalizeShape(s); this.currentShape = r; calls.push(['setShape', r]); },
    setParticleStyle: s => calls.push(['setParticleStyle', s]),
    setColorSchemeAnimated: i => calls.push(['setColorSchemeAnimated', i]),
    setVizModeGPU: m => calls.push(['setVizModeGPU', m]),
    setSurfaceMaterial: m => calls.push(['setSurfaceMaterial', m]),
    setGPUModeAnimated(n) { calls.push(['setGPUModeAnimated', n]); this.uMathMode = 0; },
    // The real one defers onFlat by up to 400 ms. Running it straight away is
    // what lets the setShape argument be compared with the picker write in the
    // same tick; the deferral is not what this file is about.
    triggerMorphTransition(onFlat) { calls.push(['morph']); onFlat?.(); },
    tweenCameraTo(t, o = {}) { calls.push(['tweenCameraTo']); if ((o.duration ?? 800) <= 0) o.onDone?.(); },
  };
  return Object.assign(Object.create(PresetMixin), {
    calls, render,
    camera: {
      autoRot: false, cpActive: false, cpParams: {}, cpKeyframes: [], cpSelectedKf: null,
      cb: { onAutoRotChanged() {}, onSetCode() {}, onParamsChanged() {} },
      setCamPhysics() {}, loadScript() {}, buildTimeline() {},
    },
    mathViz: {
      _mode: 'surface', _volumeKey: null, _collId: null, _formulaKey: null, active: false,
      deactivate() {}, setFormula() {}, setMode() {}, setVolumeFormula() {},
    },
    shaderEditor: {
      _tab: 'frag', _vert: 'v', _frag: 'f', customVS: null, customFS: null,
      compileAndApply() {}, revertToBuiltIn() {}, reset() {},
    },
    audio: { colorIdx: 16, bassSens: 1.2, trebleSens: 1, amp: 0.7, waveInt: 1 },
    _clip: null,
    syncVizModeUI() {}, syncDeformUI() {}, _showToast() {},
    lastShapeSent() {
      const c = this.calls.filter(x => x[0] === 'setShape');
      return c.length ? c[c.length - 1][1] : undefined;
    },
  });
}

/** One apply, returning what the picker was written with and what the engine got. */
function applyAndRead(state, opts) {
  shapeWrites.length = 0;
  const ui = makeUi();
  const { result: ok, warned } = quietly(() => ui.applyState(state, opts));
  return { ok, picker: shapeWrites.slice(), engine: ui.lastShapeSent(), warned };
}

// Values a snapshot can actually carry: a retired name, a near miss, wrong
// case, trailing space, a hyphenation this build does not use, and non-strings
// that survive JSON.parse.
const HOSTILE = [
  'retiredName', 'Plane', 'plane ', 'torus-knot', 'sphere2', 'PYRAMID-SMOOTH',
  '<script>', '__proto__', 42, true, ['plane'], { toString: () => 'plane' },
];

describe('the picker cannot be written with a value this build cannot draw', () => {
  test('preset apply / import — a hostile shape lands on the fallback in BOTH halves', () => {
    for (const bad of HOSTILE) {
      const { ok, picker, engine, warned } = applyAndRead({ _version: 2, shape: bad });
      assert.equal(ok, true, `applyState refused ${JSON.stringify(bad)} outright`);
      assert.deepEqual(picker, [DEFAULT_SHAPE],
        `picker written with ${JSON.stringify(picker)} for shape ${JSON.stringify(bad)}`);
      assert.equal(engine, DEFAULT_SHAPE,
        `engine got ${JSON.stringify(engine)} for shape ${JSON.stringify(bad)}`);
      assert.equal(picker[0], engine, 'picker and engine disagree');
      // …and it was not silent. The whole defect was that nothing said so.
      assert.equal(warned.filter(w => w.includes('[shape]')).length, 1,
        `no [shape] warning for ${JSON.stringify(bad)}`);
    }
  });

  test('CONTROL — every catalogue name passes through byte for byte, in silence', () => {
    // The half that must NOT fire. A "fix" that clamped everything to the
    // fallback, or that lower-cased or trimmed on the way through, breaks here
    // and nowhere else.
    for (const good of SHAPE_NAMES) {
      const { ok, picker, engine, warned } = applyAndRead({ _version: 2, shape: good });
      assert.equal(ok, true);
      assert.deepEqual(picker, [good], `picker rewrote ${good} as ${JSON.stringify(picker)}`);
      assert.equal(engine, good);
      // Byte for byte: same length, same code units, same string.
      assert.equal(picker[0].length, good.length);
      assert.ok(Object.is(picker[0], good), `${good} came back as a different string`);
      assert.equal(warned.filter(w => w.includes('[shape]')).length, 0,
        `catalogue name ${good} produced a [shape] warning`);
    }
  });

  test('a clip step and an AUTO cycle step go through the same door', () => {
    // ClipPlayer (clip-player.js:208) and auto-cycle.js both call
    // ui.applyState(entry.state, {preserveCamera, preserveColor, preserveMaterial}).
    // The opts change what is skipped, not how the shape is resolved — pinned
    // here so a later opts-driven early-return cannot quietly reopen the door.
    for (const opts of [
      { preserveCamera: true },
      { preserveColor: true, preserveMaterial: true },
      { preserveCamera: true, preserveColor: true, preserveMaterial: true },
    ]) {
      const bad = applyAndRead({ _version: 2, shape: 'retiredName' }, opts);
      assert.deepEqual(bad.picker, [DEFAULT_SHAPE], `opts ${JSON.stringify(opts)} let a raw value through`);
      assert.equal(bad.engine, DEFAULT_SHAPE);
      // CONTROL on the same opts: a real name is still applied, so the
      // assertion above is not passing because the shape block was skipped.
      const good = applyAndRead({ _version: 2, shape: 'torusknot' }, opts);
      assert.deepEqual(good.picker, ['torusknot']);
      assert.equal(good.engine, 'torusknot');
    }
  });

  test('bootPersist — the localStorage door, driven through the real method', () => {
    // Not modelled: the real bootPersist reads the real key, scrubs, and calls
    // the real applyState. Only the browser furniture it installs afterwards
    // (a 1 s interval, a beforeunload listener) is stubbed, and both stubs are
    // removed again so nothing outlives the test.
    const store = new Map();
    const realWindow = globalThis.window;
    const realSetInterval = globalThis.setInterval;
    globalThis.localStorage = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    };
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.setInterval = () => 0;          // no timer survives this test
    try {
      for (const [shape, expected] of [['retiredName', DEFAULT_SHAPE], ['star', 'star']]) {
        store.set('vimathic_persisted_state', JSON.stringify({
          _version: 2, shape, vizMode: 'wireframe', material: 'matte',
          particleStyle: 'squares', deformMode: 'surface', gridVisible: true, colorIdx: 16,
        }));
        shapeWrites.length = 0;
        const ui = makeUi();
        ui._persistKey = 'vimathic_persisted_state';
        quietly(() => ui.bootPersist());
        assert.deepEqual(shapeWrites, [expected],
          `bootPersist wrote ${JSON.stringify(shapeWrites)} for stored shape ${JSON.stringify(shape)}`);
        assert.equal(ui.lastShapeSent(), expected);
      }
      // 'star' is the CONTROL of this test: if the restore path had been
      // skipped entirely both halves would read [] and the hostile case would
      // have "passed" without applying anything.
    } finally {
      globalThis.setInterval = realSetInterval;
      if (realWindow === undefined) delete globalThis.window; else globalThis.window = realWindow;
      delete globalThis.localStorage;
    }
  });
});

// ── Provenance census over the whole tree ───────────────────────────────────
// Two ways to put a value into the picker, and the census has to see both or
// it would report the fixed door as no door at all:
//   direct  `DOM.shapeSel.value = …` / `getElementById('shape-sel').value = …`
//   through `selectShape(DOM.shapeSel, …)` — shapes.js does the assignment
const PICKER = String.raw`(?:DOM\.shapeSel|(?:document\.)?getElementById\(\s*['"]shape-sel['"]\s*\))`;
const WRITE_RE = new RegExp(PICKER + String.raw`\s*\.value\s*=\s*([^;\n]+)`, 'g');
const VIA_RE   = new RegExp(String.raw`selectShape\(\s*` + PICKER + String.raw`\s*,`, 'g');

/**
 * Classify one right-hand side. Only three verdicts are acceptable; everything
 * else is 'unproven' and fails the census.
 *
 * @param {string} rhs   source text to the right of the `=`
 * @param {(id: string) => boolean} justified  is this bare identifier vouched for?
 */
function classify(rhs, names, justified) {
  const t = rhs.trim();
  const lit = t.match(/^(['"])(.*?)\1$/);
  if (lit) return names.includes(lit[2]) ? 'literal-in-catalogue' : 'unproven';
  if (/\b(?:selectShape|normalizeShape)\s*\(/.test(t)) return 'resolved-here';
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return justified(t) ? 'justified-identifier' : 'unproven';
  return 'unproven';
}

/**
 * Blank out comments, keeping line structure, so the census reads code and
 * only code. String LITERALS are kept intact — the census has to be able to
 * read `'pyramid-smooth'` out of a write — but the scanner tracks quoting so
 * that a `//` or `/*` inside a string cannot start a phantom comment.
 *
 * Needed because the fix's own comment in presets.js quotes the defective line
 * verbatim, and without this the census reported that prose as a door: the
 * "a document mentioning a command is not the command" trap in miniature.
 * Regex literals are NOT tracked; there is no `/…/` on any shape path, and the
 * census asserts its own hit count below, so a scan that lost its place would
 * fail rather than pass quietly.
 */
function stripNonCode(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      // Quotes are kept so a literal RHS is still recognisable as a literal;
      // only the body is blanked, which is enough to hide prose inside it.
      out += c; i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : src[i];
        i++;
      }
      out += c; i++;
    } else { out += c; i++; }
  }
  return out;
}

/** Every shape-picker write in one source string, classified. */
function census(text, file, names, justified) {
  const out = [];
  const code = stripNonCode(text);
  WRITE_RE.lastIndex = 0;
  let m;
  while ((m = WRITE_RE.exec(code)) !== null) {
    out.push({ file, rhs: m[1].trim(), verdict: classify(m[1], names, justified) });
  }
  VIA_RE.lastIndex = 0;
  while ((m = VIA_RE.exec(code)) !== null) {
    // selectShape's argument does not need proving: whatever goes in, what the
    // picker receives is its return value, and normalizeShape's own contract
    // (SHAPE_NAMES membership) is pinned in tests/shape-fallback-and-hf-once.
    out.push({ file, rhs: 'selectShape(DOM.shapeSel, …)', verdict: 'resolved-here' });
  }
  return out;
}

describe('every door that writes the shape picker has a provenance', () => {
  // The two bare identifiers in main.js, and the assertion that vouches for
  // each. Both are re-derived from source below — a justification nobody checks
  // is just an allowlist.
  const JUSTIFIED = {
    'src/main.js': {
      // _cycleShape: the D hotkey steps through the picker's own <option>
      // values, so `next` is by construction one of them.
      next: src => /_shapeCycle\s*=\s*Array\.from\(DOM\.shapeSel\.options\)\.map\(o\s*=>\s*o\.value\)/.test(src),
      // The R hotkey draws from _shapeBag, a ShuffleBag over the SHAPES const.
      // Checked against the catalogue, not merely asserted to exist.
      shape: (src, names) => {
        if (!/_shapeBag\s*=\s*new ShuffleBag\(SHAPES\)/.test(src)) return false;
        const m = src.match(/const SHAPES = \[([^\]]+)\]/);
        if (!m) return false;
        return m[1].split(',').map(s => s.trim().replace(/'/g, '')).every(s => names.includes(s));
      },
    },
  };

  const FILES = [
    'src/main.js', 'src/ui/presets.js', 'src/ui/controls.js',
    'src/ui/clip-player.js', 'src/ui/auto-cycle.js', 'src/ui/controller.js',
    'src/ui/modals.js', 'src/render.js', 'src/dom.js', 'src/utils.js',
  ];

  function auditFile(file, text) {
    const rules = JUSTIFIED[file] ?? {};
    return census(text, file, SHAPE_NAMES, id => !!rules[id]?.(text, SHAPE_NAMES));
  }

  test('the tree as it stands: every write is literal, resolved, or vouched for', () => {
    const rows = [];
    for (const f of FILES) {
      let text;
      try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
      rows.push(...auditFile(f, text));
    }
    const bad = rows.filter(r => r.verdict === 'unproven');
    assert.deepEqual(bad, [],
      'a shape-picker write with no proof its value is in the catalogue:\n' +
      bad.map(r => `  ${r.file}: .value = ${r.rhs}`).join('\n'));

    // A census that found nothing would also report no bad rows. Pin that it
    // is actually looking at the writes it is meant to look at.
    assert.ok(rows.length >= 4,
      `census found only ${rows.length} shape-picker writes: ${JSON.stringify(rows)}`);
    assert.ok(rows.some(r => r.file === 'src/ui/presets.js' && r.verdict === 'resolved-here'),
      'the preset door is no longer resolved where it is written');
    assert.ok(rows.some(r => r.verdict === 'literal-in-catalogue'), 'no literal write found');
    assert.ok(rows.some(r => r.verdict === 'justified-identifier'), 'no vouched-for write found');
  });

  test('selectShape is the only place allowed to assign an unproven value', () => {
    // The census lets `selectShape(DOM.shapeSel, …)` through without looking at
    // its argument. That is only sound while selectShape assigns normalizeShape's
    // result and nothing else — pinned here, at the one line the whole census
    // leans on.
    const body = stripNonCode(readFileSync(join(ROOT, 'src/shapes.js'), 'utf8'))
      .match(/export function selectShape\([\s\S]*?\n\}/)[0];
    assert.match(body, /const shape = normalizeShape\(v\)/);
    assert.deepEqual(
      [...body.matchAll(/\.value\s*=\s*([^;\n]+)/g)].map(m => m[1].trim()), ['shape'],
      'selectShape assigns something other than normalizeShape(v)');
    // CONTROL: the same extraction on a body that assigns the raw value must
    // fail the check above, so the check is not just reading an empty match.
    const broken = body.replace('sel.value = shape', 'sel.value = v');
    assert.notEqual(broken, body);
    assert.deepEqual([...broken.matchAll(/\.value\s*=\s*([^;\n]+)/g)].map(m => m[1].trim()), ['v']);
  });

  test('MUTATION — the census fails on the round-10 defect it was written for', () => {
    // The exact line as it stood before this fix.
    const mutated = 'if (s.shape) {\n  DOM.shapeSel.value = s.shape;\n' +
                    '  onFlatActions.push(() => r.setShape(s.shape));\n}';
    const rows = auditFile('src/ui/presets.js', mutated);
    assert.equal(rows.length, 1, 'the write regex missed the defect it was written for');
    assert.equal(rows[0].verdict, 'unproven');
  });

  test('MUTATION — an unvouched identifier and a bogus literal both fail', () => {
    // A new door someone adds in a file with no justification table.
    assert.equal(auditFile('src/ui/clip-player.js',
      'DOM.shapeSel.value = entry.state.shape;')[0].verdict, 'unproven');
    assert.equal(auditFile('src/ui/clip-player.js',
      'DOM.shapeSel.value = whateverThisIs;')[0].verdict, 'unproven');
    // A literal that is not in the catalogue — the retired-name case.
    assert.equal(auditFile('src/ui/controls.js',
      "DOM.shapeSel.value = 'torus-knot';")[0].verdict, 'unproven');
    // And the getElementById spelling is seen too, not just DOM.shapeSel.
    assert.equal(auditFile('src/ui/controls.js',
      "document.getElementById('shape-sel').value = s.shape;")[0].verdict, 'unproven');
  });

  test('CONTROL — the comment stripper hides prose without hiding code', () => {
    // Both halves matter. Hiding too much is how this census would become a
    // guard that cannot fail; hiding too little is what made it fire on the
    // fix's own comment.
    assert.deepEqual(
      auditFile('src/ui/presets.js', '// DOM.shapeSel.value = s.shape;\n'), [],
      'a write quoted in a line comment was counted as a door');
    assert.deepEqual(
      auditFile('src/ui/presets.js', '/* was: DOM.shapeSel.value = s.shape; */\n'), [],
      'a write quoted in a block comment was counted as a door');
    const kept = auditFile('src/ui/presets.js',
      '// was: DOM.shapeSel.value = s.shape;\nconst shape = selectShape(DOM.shapeSel, s.shape);');
    assert.equal(kept.length, 1, 'the stripper swallowed the real write beside the comment');
    assert.equal(kept[0].verdict, 'resolved-here');
    // A string body carrying `//` must not blind the scanner to the write
    // that follows it on the next line.
    const afterUrl = auditFile('src/ui/controls.js',
      "const u = 'http://x';\nDOM.shapeSel.value = 'plane';");
    assert.equal(afterUrl.length, 1);
    assert.equal(afterUrl[0].verdict, 'literal-in-catalogue');
  });

  test('MUTATION — a justification that stops being true stops vouching', () => {
    // main.js with the SHAPES const carrying a name the catalogue does not
    // have. `shape` must lose its vouching, which is the whole point of
    // re-deriving the justification instead of listing the identifier.
    const real = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
    const broken = real.replace(/const SHAPES = \[([^\]]+)\]/,
      "const SHAPES = ['plane','torus-knot']");
    assert.notEqual(broken, real, 'the SHAPES const moved — this mutation no longer bites');
    const rows = auditFile('src/main.js', broken);
    const shapeRow = rows.find(r => r.rhs === 'shape');
    assert.ok(shapeRow, 'the R-hotkey write disappeared from main.js');
    assert.equal(shapeRow.verdict, 'unproven');
    // CONTROL: the D-hotkey write in the SAME mutated file is untouched by
    // this mutation and must still be vouched for.
    assert.equal(rows.find(r => r.rhs === 'next').verdict, 'justified-identifier');
  });
});
