// tests/shape-hook-lifetime.test.js
//
// Round 10, wave 3. Three lines that round 10's headline fix rests on and that
// nothing in the suite could tell you had been deleted.
//
// Run:
//   node --test tests/shape-hook-lifetime.test.js
//
// ── The three ───────────────────────────────────────────────────────────────
//   1. src/main.js          render.cb.onShapeChange = () => mathViz.onShapeChange()
//   2. src/math-visualizer.js, setMode()        this._blendActive = false
//   3. src/math-visualizer.js, onShapeChange()  this._lastHF = null
//
// Each was deleted in a sandbox copy and the whole suite stayed green. The
// costs, measured on the shipped tree against the mutant
// (notes/audits/vimathic-round10-2026-08-19/wave3/holes/H8-*, H9-*):
//
//   1. boot on the plane, run a formula, switch to the sphere: with the hook
//      the drawn height correlates 0.998 with the sphere's own y and spans
//      -4.30 … 3.34; without it the correlation is -8e-18 and the span is
//      -0.80 … 0.00 — a flat graph standing where a sphere should be, because
//      the pristine snapshot is still the plane's.
//   2. arm a formula transition, trip the mode and come back: with the line the
//      first frame is 0.9657 away from the abandoned formula's plate; without
//      it, 0.0000 — the ghost its own comment describes, bit for bit.
//   3. run a formula, change shape, pick a new formula: with the line the first
//      frame sits exactly on the new shape; without it, 0.9640 world units off.
//
// ── How this file avoids the two ways a guard like this goes wrong ──────────
//
// It does not assert that main.js contains a particular sentence. It takes
// whatever main.js ASSIGNS to render.cb.onShapeChange, installs that, and then
// asserts the consequence. Rewiring it as `mathViz.onShapeChange.bind(mathViz)`
// or as a named function still passes; deleting it, or wiring it to something
// that does not refresh the snapshot, fails.
//
// Every property is paired with a run that must read the OTHER way, so none of
// them can be satisfied by breaking the machinery outright.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let THREE, RenderEngine, MathVisualizer;

before(async () => {
  THREE = await import('three');
  globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (fn => { fn(); return 0; });
  ({ RenderEngine }   = await import('../src/render.js'));
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
});

// ── The stage: the real setShape on a stand-in carrying what it touches ─────
function makeStage(shape) {
  const st = Object.create(RenderEngine.prototype);
  Object.assign(st, {
    CFG: { planeSegs: 160, planeSize: 7 },
    isMobile: false, isShapeChanging: false, pendingShape: null, currentShape: null,
    gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) },
    gpuPtsProxy: null,
    clearSolarSystem() {}, _buildSolarSystem() {},
    U: { uMathMode: { value: 0 }, uVHField: { value: 0 }, uMorphProgress: { value: 1 } },
    cb: {},
  });
  st.setShape(shape);
  return st;
}

const ys = st => {
  const p = st.gpuMesh.geometry.attributes.position;
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = p.getY(i);
  return a;
};
const baseYs = st => {
  const b = st.gpuMesh.geometry.attributes.aBaseY;
  const a = new Float32Array(b.count);
  for (let i = 0; i < b.count; i++) a[i] = b.getX(i);
  return a;
};
const maxdiff = (a, b) => {
  let m = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};
/** Pearson correlation — 1 means the drawn height follows the shape's own y. */
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  return cov / Math.sqrt(va * vb);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the shape-change hook main.js installs', () => {

  /**
   * The wiring, taken from main.js's own text and evaluated.
   *
   * The regexp finds the assignment; the Function evaluates whatever it assigns
   * with `render` and `mathViz` bound, so the SHAPE of the wiring is not what is
   * being pinned — only that main.js assigns something, and that what it assigns
   * does the job.
   */
  /**
   * Pull one balanced `function NAME(…){…}` declaration out of a source text.
   * Needed because the assignment is allowed to name a function defined
   * elsewhere in main.js — see the control below.
   */
  function functionNamed(src, name) {
    const at = src.search(new RegExp(`(?:^|[^\\w.])function\\s+${name}\\s*\\(`, 'm'));
    if (at < 0) return null;
    const open = src.indexOf('{', at);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0)
        return src.slice(src.indexOf('function', at), i + 1);
    }
    return null;
  }

  /**
   * main.js is JavaScript and this reader has to tell code from prose.
   * Commenting a line out is the ordinary way to disable it, and a reader that
   * matches the commented text certifies a hook that is not installed — that is
   * blind spot D3 of this round's own mutation matrix, and the first draft of
   * this file reintroduced it. Strings are walked through rather than scanned,
   * so a `//` inside one is not mistaken for a comment. Regex literals are NOT
   * tracked; the hit-count assertion below is what keeps that from passing
   * silently, since a scanner that lost its place finds zero or two, not one.
   */
  function stripJsComments(src) {
    let out = '', i = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const q = c; out += src[i++];
        while (i < src.length && src[i] !== q) {
          if (src[i] === '\\') { out += src[i++]; if (i < src.length) out += src[i++]; continue; }
          out += src[i++];
        }
        if (i < src.length) out += src[i++];
        continue;
      }
      out += src[i++];
    }
    return out;
  }

  /**
   * The right-hand side of an assignment, read to its own end rather than to
   * the first semicolon. `() => { mathViz.onShapeChange(); }` is the same
   * function as `() => mathViz.onShapeChange()`, and a reader that truncates at
   * the inner `;` turns a legal refactor into a SyntaxError — a guard failing
   * on a no-op, which is the habit this round spent a wave removing.
   */
  function rhsAfter(src, from) {
    let i = from, depth = 0, start = -1;
    while (i < src.length) {
      const c = src[i];
      if (start < 0 && !/\s/.test(c)) start = i;
      if (c === '"' || c === "'" || c === '`') {
        const q = c; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      } else if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ';' && depth === 0) return start < 0 ? null : src.slice(start, i);
      i++;
    }
    return null;
  }

  function wiringFromMain() {
    const src = stripJsComments(readFileSync(join(ROOT, 'src', 'main.js'), 'utf8'));
    const hits = [...src.matchAll(/(?:^|[^\w.])render\.cb\.onShapeChange\s*=(?!=)/gm)];
    assert.equal(hits.length, 1,
      `src/main.js has ${hits.length} live assignments to render.cb.onShapeChange, expected one. ` +
      'At zero — which is also what commenting the line out gives — a shape change leaves ' +
      'MathVisualizer holding the previous shape\'s pristine snapshot: the field then lands on ' +
      'the old coordinates and the new shape is drawn flat. Every other guard in this suite ' +
      'wires the hook by hand and so cannot see this. Above one, this reader cannot tell which ' +
      'assignment survives, and neither can a reader of the file.');
    const raw = rhsAfter(src, hits[0].index + hits[0][0].length);
    assert.ok(raw, 'the assignment to render.cb.onShapeChange has no terminating semicolon');
    const rhs = raw.trim();
    // If main.js hands over a name rather than an expression, bring that
    // definition along; the point of this file is the consequence, not the
    // spelling, and a guard that only accepts one spelling teaches people to
    // write for the guard.
    let preamble = '';
    if (/^[A-Za-z_$][\w$]*$/.test(rhs)) {
      const decl = functionNamed(src, rhs);
      assert.ok(decl,
        `src/main.js assigns \`${rhs}\` to render.cb.onShapeChange but this file cannot ` +
        `find a top-level \`function ${rhs}\` to evaluate. Either inline the wiring or ` +
        'teach this reader about the form used.');
      preamble = decl + '\n';
    }
    return new Function('render', 'mathViz', `${preamble}return (${rhs});`);
  }

  /**
   * Boot on the plane, run a formula, switch to the sphere, keep ticking.
   * @param {boolean} wired — install main.js's hook, or leave cb empty
   */
  function planeThenSphere(wired) {
    const st = makeStage('plane');
    const mv = new MathVisualizer(st, { bass:0, mid:0, treble:0, beatInt:0, amp:1, waveInt:1 });
    if (wired) st.cb.onShapeChange = wiringFromMain()(st, mv);
    mv.onShapeChange();                       // main.js's own boot call
    let t = 0; const tick = () => { t += 0.008; mv.tick(t); };
    mv.setFormula('topology', 'pseudosphere');
    for (let i = 0; i < 5; i++) tick();
    st.setShape('sphere');
    for (let i = 0; i < 5; i++) tick();
    return { st, mv };
  }

  test('a shape change while a formula runs lands the field on the NEW shape', () => {
    const { st } = planeThenSphere(true);
    const drawn = ys(st), body = baseYs(st);

    assert.ok(maxdiff(drawn, body) > 0.05,
      'precondition: a field must actually be running, or "the drawn height is the ' +
      'sphere" would be trivially true');

    assert.ok(corr(drawn, body) > 0.9,
      `the drawn height correlates ${corr(drawn, body).toFixed(4)} with the sphere's own y. ` +
      'Below ~0.9 the mesh is not the sphere any more: the field is being applied over the ' +
      'previous shape\'s pristine snapshot, which flattens the sphere into a graph.');

    let lo = Infinity, hi = -Infinity;
    for (const v of drawn) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assert.ok(hi - lo > 3,
      `the drawn mesh spans only ${(hi - lo).toFixed(3)} world units; the sphere alone is ` +
      'about 7 across, so this is the flat plate again');
  });

  test('CONTROL — with the hook removed, the same run reads the other way', () => {
    // Without this, the test above could be passing for a reason that has
    // nothing to do with main.js — e.g. if setShape refreshed the snapshot by
    // itself. Here the callback is simply not installed.
    const { st } = planeThenSphere(false);
    const drawn = ys(st), body = baseYs(st);
    assert.ok(Math.abs(corr(drawn, body)) < 0.5,
      `an unwired run still correlates ${corr(drawn, body).toFixed(4)} with the sphere — ` +
      'the property above is not caused by the hook and this file is measuring nothing');
  });

  test('main.js also fires it once at boot, for the geometry built before the wiring', () => {
    // RenderEngine's constructor calls setShape before main.js can install the
    // callback, so the boot shape gets no pristine unless main.js asks for one.
    // This is the one assertion in the file that reads main.js as text; the
    // consequence is not reachable without booting the real engine.
    const src = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const standalone = /(?:^|[^\w.=])mathViz\.onShapeChange\s*\(\s*\)\s*;/m;
    // The assignment's own right-hand side mentions the same call, so strip the
    // assignment before looking for a bare one.
    const withoutAssignment = body.replace(/render\.cb\.onShapeChange\s*=\s*[^;]+;/g, ' ');
    assert.match(withoutAssignment, standalone,
      'main.js never calls mathViz.onShapeChange() on its own, so the boot geometry — ' +
      'built by RenderEngine\'s constructor before the callback exists — has no pristine ' +
      'snapshot, and the first mode switch after boot has nothing to restore from');
  });

  test('CONTROL — that reader does not find the call inside the assignment', () => {
    // The assertion above would be vacuous if the arrow body counted.
    const onlyAssignment = 'render.cb.onShapeChange = () => mathViz.onShapeChange();\n';
    const stripped = onlyAssignment.replace(/render\.cb\.onShapeChange\s*=\s*[^;]+;/g, ' ');
    assert.doesNotMatch(stripped, /(?:^|[^\w.=])mathViz\.onShapeChange\s*\(\s*\)\s*;/m);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('state that has to be dropped when the mesh is put back', () => {

  const A = ['fractals', 'lorenz'];
  const B = ['fractals', 'chua'];

  /**
   * Stretch the blend so the first frame after a formula change sits at blend
   * parameter ~4e-27. Then "the first frame is the from-state" can be asserted
   * at 1e-6 instead of with a tolerance that would hide a pop.
   */
  function build(shape) {
    const st = makeStage(shape);
    const mv = new MathVisualizer(st, { bass:0, mid:0, treble:0, beatInt:0, amp:1, waveInt:1 });
    st.cb.onShapeChange = () => mv.onShapeChange();
    mv.onShapeChange();
    mv._blendDuration = 1e9;
    return { st, mv };
  }

  test('setMode cancels an in-flight blend, so the abandoned formula does not come back', () => {
    const { st, mv } = build('plane');
    let t = 0; const tick = () => { t += 0.008; mv.tick(t); };

    mv.setFormula(...A);
    for (let i = 0; i < 5; i++) tick();
    const plateA = ys(st);

    mv.setFormula(...B);          // arms a blend: from A, toward B
    tick();
    assert.ok(mv._blendActive,
      'precondition: a blend must be running when the mode is tripped, or there is ' +
      'nothing for setMode to cancel and this test cannot fail');

    mv.setMode('collapse');
    tick();
    mv.setMode('surface');
    tick();
    const frame1 = ys(st);

    // The property. The blend's from-state was A's plate, and the mesh was put
    // back to pristine while the mode was away; resuming that blend paints A's
    // plate onto a mesh that no longer carries it.
    assert.ok(maxdiff(frame1, plateA) > 0.5,
      `the first frame back in Surface is ${maxdiff(frame1, plateA).toFixed(4)} from the ` +
      'plate of the formula the user walked away from — at 0.0000 it IS that plate, which ' +
      'is the ghost setMode\'s blend cancellation exists to prevent');

    assert.equal(mv._blendActive, false,
      'the blend survived the mode round trip; the next frames will keep animating out of ' +
      'a field the mesh no longer carries');

    // Paired: this must not be passing because the field died. The frame has to
    // be the NEW formula's own plate, computed fresh.
    const ref = build('plane');
    let rt = 0;
    ref.mv.setFormula(...B);
    for (let i = 0; i < 1; i++) { rt += 0.008; ref.mv.tick(rt); }
    assert.ok(maxdiff(frame1, ys(ref.st)) < 1e-6,
      'the first frame back is neither the old formula nor the new one — the mode trip ' +
      'left the Surface tick writing something else entirely');
  });

  test('CONTROL — with no mode trip the blend does resume, and from A', () => {
    // The opposite expectation on the same machinery: a fix that cancelled
    // blends too eagerly would pass the test above and fail this one.
    const { st, mv } = build('plane');
    let t = 0; const tick = () => { t += 0.008; mv.tick(t); };
    mv.setFormula(...A);
    for (let i = 0; i < 5; i++) tick();
    const plateA = ys(st);
    mv.setFormula(...B);
    tick();
    assert.ok(mv._blendActive, 'the blend must still be running');
    assert.ok(maxdiff(ys(st), plateA) < 1e-6,
      `an ordinary formula change jumped ${maxdiff(ys(st), plateA).toFixed(4)} world units ` +
      'away from the field the mesh is carrying');
  });

  test('a shape change drops the field the old geometry carried', () => {
    // The gap tests/blend-from-state.test.js's own table leaves: it lists the
    // five paths that go through _restorePristineToMesh and not onShapeChange,
    // which clears _lastHF for a different reason — the geometry is gone.
    const { st, mv } = build('plane');
    let t = 0; const tick = () => { t += 0.008; mv.tick(t); };

    mv.setFormula(...A);
    for (let i = 0; i < 5; i++) tick();
    const plateA = ys(st);

    st.setShape('sphere');
    // `assert.ok(x === null)` and not `assert.equal(x, null)`: _lastHF is a
    // 25921-element Float32Array, and node's equality assertion renders both
    // sides through util.inspect at depth 1000 to build a diff. On the one run
    // that matters — the failing one — that pins the machine. Measured: the
    // first draft of this line hung the mutation run at G-MUT-4 until it was
    // killed, which is the same failure this file exists to prevent, in a test.
    assert.ok(mv._lastHF === null,
      'onShapeChange left _lastHF pointing at the field of a geometry that has been ' +
      'thrown away');
    const fresh = ys(st);
    assert.ok(maxdiff(fresh, plateA) > 0.5,
      'precondition: the new shape must actually differ from the plate that was on screen');

    mv.setFormula(...B);
    tick();
    assert.ok(maxdiff(ys(st), fresh) < 1e-6,
      `the first frame after picking a formula on the new shape jumped ` +
      `${maxdiff(ys(st), fresh).toFixed(4)} world units — the blend started from the ` +
      'field the PREVIOUS shape was carrying');

    // The length check cannot be what saves this: both shapes round to the same
    // grid, so `_lastHF.length === hfLen` holds either way.
    assert.equal(mv._gridSize, 161);
  });

  test('CONTROL — plane and sphere really do share a grid size', () => {
    // If they ever stop doing so, the test above starts passing for the wrong
    // reason (a length mismatch making _applyHFWithBlend give up) and stops
    // measuring the clear.
    const p = build('plane'), s = build('sphere');
    assert.equal(p.mv._gridSize, s.mv._gridSize,
      'plane and sphere no longer round to the same grid; pick another pair or the ' +
      'shape-change test above is no longer pinning _lastHF');
  });
});
