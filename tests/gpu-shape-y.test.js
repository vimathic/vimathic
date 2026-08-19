// tests/gpu-shape-y.test.js
//
// The vertex programs must keep the shape they were handed. Before round 10
// the GPU branch ASSIGNED the displacement into pos.y:
//
//     pos.y = mix(y, yNxt, uModeBlend) * uMorphProgress;
//
// mix(...) is a pure function of pos.xz, so every vertex sharing an (x,z)
// column landed on one point and the shape's own y was gone. Measured on the
// catalogue as render.js builds it: 12800 of the cylinder's 12960 triangles
// collapsed to zero area, the box's ±y faces landed on the same sheet, and
// 64340 of the catalogue's 270996 triangles drew nothing.
//
// There are TWO vertex programs with this branch, and round 10's fix had to
// land in both: the built-in `VS`, and `SE_VS_TEMPLATE`, the wrapper the shader
// editor interpolates a user body into. Until this file was rewritten only the
// first was measured — the mutation matrix (L-01, row D4) put the pre-round-10
// assignment back into the editor template and every guard in the repo stayed
// green. Both are checked here, by the same code.
//
// ── How strong is this, honestly ────────────────────────────────────────────
// There is no GLSL compiler in this environment (no glslangValidator, no
// glslc, no headless-gl), so nothing here executes the shipped shader. What it
// does instead:
//
//   1. reads the pos.y write out of the shipped source — comments of BOTH
//      kinds removed first, and the branch must contain exactly ONE such write,
//      so a second one cannot hide behind the first;
//   2. refuses to proceed on a write it does not have an arithmetic model for,
//      and refuses on a local whose definition it does not recognise (a
//      `float f = 0.0;` above `pos.y = (pos.y + f) * …` would otherwise read as
//      the fixed form);
//   3. models exactly that arithmetic in float32, per operation, the way a
//      GLSL highp float rounds;
//   4. runs the geometry RenderEngine.setShape really builds through it and
//      measures the picture — degenerate triangles, Y extent, the gap between
//      the box's two faces.
//
// So it is a text stencil for WHICH statement ships and a measurement for what
// that statement DOES. The stencil is the weak half: a program that computed
// the same thing in a spelling not in the table below is a hard failure rather
// than a false pass, which is the right direction to be wrong in, but it is
// still a table. It cannot see a linkage error, a precision qualifier, or a
// driver bug. A browser smoke test is the only thing that can.
//
// Two controls are in here on purpose, and neither may fire:
//   • the plane the app boots on must not move by one float32 ulp — after
//     setShape its y is exactly 0, so the fix has to be a bit-exact no-op
//     there. This control is run on the geometry setShape PRODUCES, not on a
//     hand-built one: the earlier version of this file built its own plate,
//     which still carried the 2.1e-16 rotateX residue that setShape now zeros,
//     and so certified a geometry the app no longer makes (L-gpu-model.txt:
//     25760 of 77763 floats differed). It also runs a second, hostile field
//     (x·z, which is exactly 0 on two whole grid lines rather than at one
//     point). Both halves are measured, by deleting the Y-zeroing loop from
//     setShape and re-running: with the app's own mode-0 field the control
//     stays silent — 0 of 129605 — and with x·z it fires 640 times, max
//     2.143e-16. So the control's silence on the shipped tree is a fact about
//     the geometry; with the app's field alone it would have been a fact about
//     that field's zero set instead.
//   • uMorphProgress = 0 must still flatten every shape to y = 0 exactly, or
//     the deflate → swap → inflate transition (render.js setShapeAnimated)
//     stops hiding the geometry swap and the shape change becomes a visible
//     cut.
//
// Run:
//   node --test tests/gpu-shape-y.test.js

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// setShape() schedules its geometry dispose in a rAF. Queue the callbacks
// without running them: nothing here needs the dispose, and running it would
// free the buffers this file measures.
const rafQueue = [];
globalThis.requestAnimationFrame = cb => rafQueue.push(cb);

let VS, THREE, RenderEngine, SRC;
before(async () => {
  ({ VS } = await import('../src/shaders.js'));
  ({ RenderEngine } = await import('../src/render.js'));
  THREE = await import('three');
  SRC   = readFileSync(fileURLToPath(new URL('../src/shaders.js', import.meta.url)), 'utf8');
});

// ── reading GLSL ────────────────────────────────────────────────────────────
// Comments out first, both kinds, in ONE pass so neither can hide the other:
// a `//` inside a block and a `/*` inside a line comment both resolve the way
// the GLSL preprocessor resolves them, by whichever opener comes first.
//
// This is not a style point. Mutation D3 of the round-10 matrix put the CORRECT
// statement inside a `/* */` block directly above the broken one; the earlier
// version of this file stripped only `//` lines and then took the FIRST match,
// so it read the comment, modelled the fix, and passed a tree that shipped the
// defect. Stripping is half the repair; requiring exactly one write is the
// other half.
const stripComments = s =>
  s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '));

/**
 * True when a statement writes pos.y ANYWHERE in it, not only at its start.
 *
 * The anchored form this file shipped with — the same operator alternation as
 * below, but pinned to the start of the statement with ^ — read only a
 * statement's first characters, and statements here are produced by
 * `split(';')`, so one level of syntactic wrapping put the write out of view:
 * `if(uMathMode==0)pos.y=…` is one statement beginning `if(`, and so is
 * `{pos.y=…`. Four mutations that restore the exact pre-round-10 defect passed
 * every guard in the repo that way (wave-2 rows A1, A1b, A1c, A12; PRE-matrix.txt
 * in notes/audits/vimathic-round10-2026-08-19/wave2/guards/, all four RED=NONE).
 * The bare form WAS caught, so the check was real and only anchored wrong.
 *
 * The leading `(^|[^A-Za-z0-9_.])` keeps `foo.pos.y` and `mypos.y` out; the
 * trailing `(?!=)` keeps the comparison `pos.y==` out. Reads and multiplies —
 * `pos.y-aBaseY`, `pos.y*uMorphProgress` inside a vH write — do not match,
 * because an operator here has to be followed by `=`.
 */
const touchesY = s => /(^|[^A-Za-z0-9_.])pos\.y\s*[+\-*/]?=(?!=)/.test(s);

/**
 * The body of `if(uMathMode==0){…}`, the body of the matching `else` block, and
 * everything after it, with comments gone and whitespace squeezed out, split
 * into statements.
 *
 * The `else` body was thrown away until wave 2. That is the CPU branch — the
 * one applyHeightField and the volume writers feed — and its `pos.y =
 * pos.y * uMorphProgress` is what makes a shape swap a fade rather than a cut,
 * which is the failure this file's own header names. Breaking it left this file
 * 16/16 green (row A11).
 *
 * @param {string} src   a vertex program's source text
 * @param {string} label for failure messages
 */
function branches(src, label) {
  const clean = stripComments(src);
  const head = clean.indexOf('if(uMathMode==0){');
  assert.ok(head >= 0, `${label}: no if(uMathMode==0) branch — this file has nothing to measure`);
  const close = i => {                       // i points at the opening brace
    let d = 0;
    for (let k = i; k < clean.length; k++) {
      if (clean[k] === '{') d++;
      else if (clean[k] === '}') { d--; if (d === 0) return k; }
    }
    return assert.fail(`${label}: unbalanced braces in the vertex program`);
  };
  const gpuOpen = clean.indexOf('{', head), gpuClose = close(gpuOpen);
  const elseM = clean.slice(gpuClose + 1).match(/^\s*else\s*\{/);
  assert.ok(elseM, `${label}: the uMathMode branch has no else`);
  const cpuOpen  = gpuClose + elseM[0].length;   // points AT the else's '{'
  const cpuClose = close(cpuOpen);
  const gpuText = clean.slice(gpuOpen + 1, gpuClose);
  const cpuText = clean.slice(cpuOpen + 1, cpuClose);
  // Splitting on ';' is only sound while the branch has no for-loop header.
  for (const [what, text] of [['GPU', gpuText], ['CPU', cpuText]]) {
    assert.ok(!/\bfor\s*\(/.test(text),
      `${label}: the ${what} branch grew a for-loop; splitting on ';' no longer yields statements`);
  }
  const stmts = t => t.replace(/\s+/g, '').split(';').filter(Boolean);
  return { gpu: stmts(gpuText), cpu: stmts(cpuText), tail: stmts(clean.slice(cpuClose + 1)) };
}

// ── what the guard is willing to believe about a local ──────────────────────
// If the pos.y write names a local, the guard resolves it. Anything not listed
// here is a hard stop: `float f = 0.0;` above `pos.y = (pos.y + f) * …` reads
// as the fixed form to a table that only looks at the write.
const LOCAL_MEANINGS = {
  f:    ['mix(y,yNxt,uModeBlend)'],                            // the blended displacement
  y:    ['computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T)'],         // this frame's mode
  yNxt: ['computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T)'],     // the mode being blended to
};

/** Every identifier in `stmt`, with `pos.y` / `pos.xz` removed first. */
const identsOf = stmt =>
  [...stmt.replace(/pos\.[a-z]+/g, ' ').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map(m => m[0]);

/**
 * Walk every local the write depends on and refuse anything unrecognised.
 * Names the branch does not assign are left alone — in the editor template `y`
 * is written by the interpolated user body, above the branch.
 */
function checkLocals(stmts, stmt, label) {
  const assigned = new Map();
  for (const s of stmts) {
    const m = s.match(/^(?:float)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !s.startsWith('pos.') && !s.startsWith('vH')) assigned.set(m[1], m[2]);
  }
  const seen = new Set();
  const walk = from => {
    for (const id of identsOf(from)) {
      if (seen.has(id) || !assigned.has(id)) continue;
      seen.add(id);
      const rhs = assigned.get(id);
      const allowed = LOCAL_MEANINGS[id];
      assert.ok(allowed,
        `${label}: the pos.y write depends on a local '${id}' this guard has no meaning for ` +
        `(it holds "${rhs}") — refusing to certify a program it cannot read`);
      assert.ok(allowed.includes(rhs),
        `${label}: '${id}' is "${rhs}", not ${allowed.map(a => `"${a}"`).join(' or ')} — ` +
        `the write looks right only because the guard trusted the name`);
      walk(rhs);
    }
  };
  walk(stmt);
}

// ── the arithmetic of every write this file knows ───────────────────────────
//   y0  the shape's own y, as setShape built it
//   d   the displacement (VS: mix(y,yNxt,uModeBlend) or the local it is hoisted
//       into; SE_VS_TEMPLATE: the `y` the user body wrote)
//   p   uMorphProgress
const F = Math.fround;
const KEEPS     = (y0, d, p) => F(F(y0 + F(d)) * p);   // round 10's fix
const KEEPS_OUT = (y0, d, p) => F(F(y0 * p) + F(F(d) * p)); // same, distributed
const REPLACES  = (y0, d, p) => F(F(d) * p);           // pre-round-10: the shape is gone
const NO_DEFLATE = (y0, d, p) => F(y0 + F(F(d) * p));  // keeps it, never flattens
const POS_FORMS = {
  'pos.y=(pos.y+mix(y,yNxt,uModeBlend))*uMorphProgress': KEEPS,
  'pos.y=(pos.y+f)*uMorphProgress':                      KEEPS,
  'pos.y=(pos.y+y)*uMorphProgress':                      KEEPS,
  'pos.y=pos.y*uMorphProgress+mix(y,yNxt,uModeBlend)*uMorphProgress': KEEPS_OUT,
  'pos.y=pos.y*uMorphProgress+f*uMorphProgress':         KEEPS_OUT,
  'pos.y=pos.y*uMorphProgress+y*uMorphProgress':         KEEPS_OUT,
  'pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress':         REPLACES,
  'pos.y=f*uMorphProgress':                              REPLACES,
  'pos.y=y*uMorphProgress':                              REPLACES,
  'pos.y+=mix(y,yNxt,uModeBlend)*uMorphProgress':        NO_DEFLATE,
  'pos.y+=f*uMorphProgress':                             NO_DEFLATE,
  'pos.y+=y*uMorphProgress':                             NO_DEFLATE,
};

// ── the CPU branch's write ──────────────────────────────────────────────────
// One accepted form, because there is only one thing the else branch may do:
// pos.y already holds base + displacement (applyHeightField for Surface, the
// volume/collapse writers otherwise) and the branch's whole job is to scale it
// by uMorphProgress so the deflate → swap → inflate still hides the geometry
// swap. Anything else is a hard stop rather than a guess.
const CPU_FORMS = {
  'pos.y=pos.y*uMorphProgress': (attrY, p) => F(attrY * p),
};

/** The pos.y writes of one vertex program, as float32 models. */
function gpuWrite(src, label) {
  const { gpu, cpu, tail } = branches(src, label);
  const writes = gpu.filter(touchesY);
  assert.equal(writes.length, 1,
    `${label}: expected exactly one pos.y write in the GPU branch, found ${writes.length}` +
    (writes.length ? ` — ${writes.join(' | ')}` : '') +
    '; with more than one the last is what ships and the first is what a reader sees');
  const after = tail.filter(touchesY);
  assert.deepEqual(after, [],
    `${label}: pos.y is written again after the uMathMode branch (${after.join(' | ')}), ` +
    'which overrides everything both branches did');

  // The CPU half, by the same rules. Read here rather than in its own function
  // so that every caller of gpuWrite — including the four self-tests below —
  // pays for it, and a program can never be certified on one branch alone.
  const cpuWrites = cpu.filter(touchesY);
  assert.equal(cpuWrites.length, 1,
    `${label}: expected exactly one pos.y write in the CPU (else) branch, found ` +
    `${cpuWrites.length}${cpuWrites.length ? ` — ${cpuWrites.join(' | ')}` : ''}`);
  const cpuStmt = cpuWrites[0];
  const cpuApply = CPU_FORMS[cpuStmt];
  assert.ok(cpuApply,
    `${label}: the CPU branch's pos.y write is "${cpuStmt};", which this guard has no ` +
    'arithmetic for. The only accepted form is pos.y=pos.y*uMorphProgress — unscaled, the ' +
    'flat frame setShapeAnimated swaps the geometry at is not flat and every shape change ' +
    'is a visible cut between two solids');

  const stmt = writes[0];
  checkLocals(gpu, stmt, label);
  const apply = POS_FORMS[stmt];
  assert.ok(apply, `${label}: unrecognised pos.y write, refusing to guess what it means: ${stmt};`);
  return { apply, stmt, cpuApply, cpuStmt };
}

/** The two shipped vertex programs. */
function programs() {
  const editorAt = SRC.lastIndexOf('const SE_VS_TEMPLATE');
  assert.ok(editorAt >= 0, 'precondition: SE_VS_TEMPLATE is gone from shaders.js');
  // …and it is still the text the editor compiles, not a leftover. Read out of
  // the source because the template is module-private; if ShaderEditor stopped
  // calling it, everything measured below would be about dead text.
  assert.ok(/SE_VS_TEMPLATE\s*\(/.test(SRC.slice(editorAt + 20)),
    'precondition: nothing calls SE_VS_TEMPLATE any more — the editor program measured here is dead text');
  return [['VS', VS], ['SE_VS_TEMPLATE', SRC.slice(editorAt)]];
}

// ── the field ───────────────────────────────────────────────────────────────
// GPU mode 0 (shaders.js:76) at the uniforms the app boots with, in silence:
// b = t = m = 0, uAmp = 0.7, uWI = 1, uTime = 0, and bt pinned to 0 by the
// shader itself. Every audio-driven and uMid term drops out and what is left is
//     sin(r*8)*0.2*0.7
// This is also, term for term, what SE_DEFAULT_VERT evaluates to at silence —
// so the same function stands for the editor's displacement, which is what the
// user body puts in `y`. Every shipped vertex snippet (SE_DEFAULT_VERT and the
// six vert SE_PRESETS) computes that from r, ang and pos.xz alone; the test
// below checks that none of them reads pos.y, which is what makes "the
// displacement is a function of pos.xz" a fact rather than an assumption.
const field = (x, z) => Math.sin(Math.hypot(x, z) * 8) * 0.2 * 0.7;
// A hostile second field for CONTROL 1: exactly 0 on the two grid lines x = 0
// and z = 0, which is where a plate carrying rotateX residue would betray it.
const hostile = (x, z) => x * z;

// ── the geometry the app really builds ──────────────────────────────────────
// A host carrying only the fields setShape()/_buildShapeGeo() actually touch.
// isMobile:false and planeSegs:160 are the desktop numbers (src/main.js).
function makeHost() {
  return {
    CFG: { planeSize: 7, planeSegs: 160 },
    isMobile: false,
    isShapeChanging: false,
    pendingShape: null,
    currentShape: 'plane',
    gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) },
    gpuPtsProxy: null,
    cb: {},
    clearSolarSystem() {},
    _buildSolarSystem() {},
    _buildStarGeo(...a)  { return RenderEngine.prototype._buildStarGeo.apply(this, a); },
    _buildShapeGeo(...a) { return RenderEngine.prototype._buildShapeGeo.apply(this, a); },
    setShape(...a)       { return RenderEngine.prototype.setShape.apply(this, a); },
  };
}
const _cache = new Map();
const shapeGeo = name => {
  if (!_cache.has(name)) { const h = makeHost(); h.setShape(name); _cache.set(name, h.gpuMesh.geometry); }
  return _cache.get(name);
};

function displaced(name, apply, prog, f = field) {
  const g = shapeGeo(name);
  const src = g.attributes.position.array, N = g.attributes.position.count;
  const out = new Float64Array(3 * N);
  for (let i = 0; i < N; i++) {
    out[3 * i]     = src[3 * i];
    out[3 * i + 1] = apply(src[3 * i + 1], f(src[3 * i], src[3 * i + 2]), prog);
    out[3 * i + 2] = src[3 * i + 2];
  }
  const idx = g.index, n = idx ? idx.count : N;
  const tri = []; for (let i = 0; i < n; i += 3) tri.push([0, 1, 2].map(k => (idx ? idx.getX(i + k) : i + k)));
  return { out, N, tri, src };
}

const degenerate = ({ out, tri }) => {
  let d = 0;
  for (const [i, j, k] of tri) {
    const ax = out[3 * i], ay = out[3 * i + 1], az = out[3 * i + 2];
    const bx = out[3 * j] - ax, by = out[3 * j + 1] - ay, bz = out[3 * j + 2] - az;
    const cx = out[3 * k] - ax, cy = out[3 * k + 1] - ay, cz = out[3 * k + 2] - az;
    if (Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx) === 0) d++;
  }
  return d;
};
const yExtent = ({ out, N }) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) { const v = out[3 * i + 1]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi - lo;
};

// ─────────────────────────────────────────────────────────────────────────────
// Both programs, same measurements. `describe` is built per program so a
// failure names which of the two shipped the defect.
for (const label of ['VS', 'SE_VS_TEMPLATE']) {
  const write = () => {
    const [, src] = programs().find(([l]) => l === label);
    return gpuWrite(src, label);
  };

  describe(`${label} keeps the shape it was handed`, () => {
    test('cylinder: its wall does not collapse into one column', () => {
      const { apply } = write();
      const d = displaced('cylinder', apply, 1.0);
      assert.equal(degenerate(d), 0,
        `${degenerate(d)} of ${d.tri.length} triangles draw nothing: every vertex of a column ` +
        `landed on one point, which is what pos.y = f(pos.xz) does`);
      assert.ok(yExtent(d) >= 4.9,
        `the cylinder is 5.0 tall; after the vertex program it spans ${yExtent(d).toFixed(3)}`);
    });

    test('box: the +y and -y faces stay 5 units apart, not z-fighting on one sheet', () => {
      const { apply } = write();
      const d = displaced('box', apply, 1.0);
      // Every (x,z) column of the box carries both faces. The spread inside a
      // column is the distance between the two sheets.
      const col = new Map();
      for (let i = 0; i < d.N; i++) {
        const k = d.src[3 * i] + '|' + d.src[3 * i + 2], y = d.out[3 * i + 1];
        const c = col.get(k);
        if (c) { if (y < c[0]) c[0] = y; if (y > c[1]) c[1] = y; } else col.set(k, [y, y]);
      }
      let worst = Infinity;
      for (const c of col.values()) worst = Math.min(worst, c[1] - c[0]);
      assert.ok(worst >= 4.9,
        `the closest pair of box faces is ${worst.toFixed(4)} apart (they were 5.0 apart in the ` +
        `geometry); at 0 the two faces are the same surface and the cube renders as z-fighting`);
      assert.equal(degenerate(d), 0, 'and no box triangle draws nothing');
    });

    test('sphere: the two hemispheres are not folded onto each other', () => {
      const { apply } = write();
      const d = displaced('sphere', apply, 1.0);
      assert.ok(yExtent(d) >= 6.9,
        `a 3.5-radius sphere spans 7.0; after the vertex program it spans ${yExtent(d).toFixed(3)}`);
    });

    // ── CONTROL 1 — must not fire ───────────────────────────────────────────
    // The plane is the boot geometry and the one shape the old write was right
    // about. setShape zeroes its Y after the quarter turn, so its own y is
    // exactly 0 and "add the field" and "replace with the field" are the same
    // number, bit for bit, at every progress and for ANY field. A fix that
    // moves it by a single float32 ulp is not a fix.
    test('control — the plane does not move, bit for bit, at any morph progress', () => {
      const { apply } = write();
      const g = shapeGeo('plane');
      const src = g.attributes.position.array, N = g.attributes.position.count;
      for (const [fname, f] of [['mode 0 in silence', field], ['x*z', hostile]]) {
        let differ = 0, maxD = 0;
        for (const p of [0, 0.25, 0.5, 0.75, 1]) {
          for (let i = 0; i < N; i++) {
            const v = F(f(src[3 * i], src[3 * i + 2]));
            const preR10 = F(v * p);                  // pos.y = displacement * uMorphProgress
            const now = apply(src[3 * i + 1], v, p);
            // Value equality, not Object.is: with the x*z field, 800 of the
            // 129605 comparisons pair a -0 against a +0 (x*z is -0 wherever one
            // coordinate is negative and the other is exactly 0, and 0 + -0 is
            // +0). That is the same point on the same plate, drawn the same
            // way; counting it would make the control fire on a distinction
            // with no picture behind it. Every other difference, including one
            // ulp, still counts.
            if (preR10 !== now) { differ++; maxD = Math.max(maxD, Math.abs(now - preR10)); }
          }
        }
        assert.equal(differ, 0,
          `field ${fname}: ${differ} of ${5 * N} plane vertices moved (max ${maxD.toExponential(3)}); ` +
          `the plane is the boot shape and its picture must be untouched`);
      }
    });

    // ── CONTROL 2 — must not fire ───────────────────────────────────────────
    // setShapeAnimated hides the geometry swap by driving uMorphProgress to 0
    // and swapping at the flat frame. If the write stops flattening, the swap
    // happens between two full-size solids and the viewer sees a cut — a plain
    // `pos.y +=` does exactly that.
    test('control — uMorphProgress = 0 still flattens every shape to exactly y = 0', () => {
      const { apply, stmt } = write();
      for (const name of ['plane', 'cylinder', 'box', 'sphere']) {
        const ext = yExtent(displaced(name, apply, 0));
        assert.equal(ext, 0,
          `${name} spans ${ext.toFixed(3)} at the flat frame; the shape swap lands there, so a ` +
          `non-flat flat frame is a visible pop between two solids — write is: ${stmt};`);
      }
    });

    // ── the CPU branch, measured the same way ───────────────────────────────
    // Surface, Volume and Collapse all arrive here with base + displacement
    // already in pos.y (applyHeightField writes it on the CPU), so the branch
    // has exactly one job. Until wave 2 branches() discarded the else block
    // entirely and dropping uMorphProgress from this write left the file
    // 16/16 green (row A11 of the round-10 matrix).
    test('the CPU branch deflates too — at the flat frame every shape is exactly y = 0', () => {
      const { cpuApply, cpuStmt } = write();
      for (const name of ['plane', 'cylinder', 'box', 'sphere']) {
        const g = shapeGeo(name);
        const src = g.attributes.position.array, N = g.attributes.position.count;
        let lo = Infinity, hi = -Infinity, moved = 0;
        for (let i = 0; i < N; i++) {
          // What the CPU path really hands the shader: the shape's own y plus
          // the field applyHeightField added to it.
          const attrY = Math.fround(src[3 * i + 1] + field(src[3 * i], src[3 * i + 2]));
          const flat  = cpuApply(attrY, 0);
          if (flat < lo) lo = flat;
          if (flat > hi) hi = flat;
          if (!Object.is(cpuApply(attrY, 1), Math.fround(attrY))) moved++;
        }
        assert.equal(hi - lo, 0,
          `${name} spans ${(hi - lo).toFixed(3)} at the flat frame on the CPU path; the geometry ` +
          `swap lands there, so this is a cut between two solids — write is: ${cpuStmt};`);
        assert.equal(moved, 0,
          `${name}: at full progress the CPU branch moved ${moved} of ${N} vertices; it must be ` +
          `the identity there or a mesh that is not morphing is drawn wrong — write is: ${cpuStmt};`);
      }
    });
  });
}

describe('the stencil that reads those writes can report a defect', () => {
  // Every assertion above is only worth what the reader underneath it is worth.
  // These four cases feed the reader text it must refuse or classify correctly;
  // without them the reader could be returning KEEPS unconditionally and the
  // whole file would be green on any tree.
  const wrap = body => `void main(){vec3 pos=position;
  if(uMathMode==0){${body}} else { pos.y=pos.y*uMorphProgress; }
  gl_Position=vec4(pos,1.);}`;

  test('the pre-round-10 assignment is classified as REPLACES, not accepted', () => {
    const { apply } = gpuWrite(wrap('float y=computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T);' +
      'float yNxt=computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T);' +
      'pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;'), 'probe');
    assert.equal(apply(3, 0.1, 1), F(0.1), 'the reader did not model the assignment as a replacement');
  });

  test('D3: a block comment quoting the fixed form does not hide the broken one', () => {
    const src = wrap(
      'float y=computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T);' +
      'float yNxt=computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T);' +
      '/* pos.y = (pos.y + mix(y, yNxt, uModeBlend)) * uMorphProgress; */' +
      'pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;');
    const { apply, stmt } = gpuWrite(src, 'probe');
    assert.equal(stmt, 'pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress',
      'the reader picked the comment instead of the statement');
    assert.equal(apply(3, 0.1, 1), F(0.1));
  });

  test('two writes in one branch are refused rather than silently resolved', () => {
    assert.throws(() => gpuWrite(wrap(
      'float y=computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T);' +
      'float yNxt=computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T);' +
      'float f=mix(y,yNxt,uModeBlend);' +
      'pos.y=(pos.y+f)*uMorphProgress;' +
      'pos.y=f*uMorphProgress;'), 'probe'),
      /exactly one pos\.y write/);
  });

  test('a tail override WRAPPED in an if is refused, not stepped over', () => {
    // The hole this suite was missing. `t.replace(/\s+/g,'').split(';')` makes
    // `if(uMathMode==0)pos.y=…` ONE statement whose first characters are `if(`,
    // so the anchored filter this file shipped with saw a tail of length 0 and
    // certified a program that puts the pre-round-10 assignment back after the
    // branch (rows A1 and A12).
    const body = 'float y=computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T);' +
      'float yNxt=computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T);' +
      'float f=mix(y,yNxt,uModeBlend);pos.y=(pos.y+f)*uMorphProgress;';
    const tail = 'if(uMathMode==0)pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;';
    assert.throws(() => gpuWrite(wrap(body).replace('gl_Position', tail + 'gl_Position'), 'probe'),
      /pos\.y is written again after the uMathMode branch/);
    // …and in a bare block, which is the same evasion without the condition
    // (row A1b).
    assert.throws(() => gpuWrite(
      wrap(body).replace('gl_Position', '{pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;}gl_Position'),
      'probe'), /pos\.y is written again after the uMathMode branch/);
    // CONTROL — the same program without the tail is accepted, so the two
    // refusals above are about the tail and not about the wrapper text.
    assert.equal(gpuWrite(wrap(body), 'probe').stmt, 'pos.y=(pos.y+f)*uMorphProgress');
  });

  test('a second write hidden inside the GPU branch by an if is counted', () => {
    // Row A1c: the correct write stays and a conditional one after it in the
    // SAME branch overrides it. Anchored, the count stayed 1.
    assert.throws(() => gpuWrite(wrap(
      'float y=computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T);' +
      'float yNxt=computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T);' +
      'float f=mix(y,yNxt,uModeBlend);' +
      'pos.y=(pos.y+f)*uMorphProgress;' +
      'if(uMorphProgress>-1.0)pos.y=f*uMorphProgress;'), 'probe'),
      /expected exactly one pos\.y write in the GPU branch, found 2/);
  });

  test('an unscaled CPU write is refused, not ignored', () => {
    // The else block was not read at all until wave 2 (row A11).
    assert.throws(() => gpuWrite(
      wrap('float y=computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T);' +
        'float yNxt=computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T);' +
        'float f=mix(y,yNxt,uModeBlend);pos.y=(pos.y+f)*uMorphProgress;')
        .replace('pos.y=pos.y*uMorphProgress;', 'pos.y=pos.y;'), 'probe'),
      /the CPU branch's pos\.y write is "pos\.y=pos\.y;"/);
  });

  test('a hoisted local with the wrong contents is refused, not trusted by name', () => {
    assert.throws(() => gpuWrite(wrap(
      'float f=0.0;' +
      'pos.y=(pos.y+f)*uMorphProgress;'), 'probe'),
      /'f' is "0\.0"/);
  });

  test('CONTROL — the same reader passes the shipped VS unchanged', () => {
    // If the four cases above fired on everything, they would prove nothing.
    for (const [label, src] of programs()) {
      const { apply } = gpuWrite(src, label);
      assert.equal(apply(3, 0.1, 1), F(F(3 + F(0.1)) * 1),
        `${label}: the reader no longer models the shipped write as "keep the shape and deflate"`);
    }
  });
});

describe('the editor snippets displace from pos.xz, which is what makes the collapse a collapse', () => {
  test('no shipped vertex snippet reads pos.y', () => {
    // SE_DEFAULT_VERT and the vert entries of SE_PRESETS are the bodies
    // SE_VS_TEMPLATE interpolates. If one of them read pos.y the "pure function
    // of pos.xz" argument above would not hold for it — the field function this
    // file substitutes would then be modelling the wrong thing, and the honest
    // move is to fail here rather than to keep measuring.
    const from = SRC.indexOf('const SE_DEFAULT_VERT');
    const to   = SRC.indexOf('export class ShaderEditor');
    assert.ok(from >= 0 && to > from, 'precondition: SE_DEFAULT_VERT / ShaderEditor moved');
    const snippets = SRC.slice(from, to);
    assert.ok(!/pos\.y/.test(stripComments(snippets)),
      'a shipped vertex snippet reads pos.y; the displacement is no longer a function of pos.xz alone');
    // CONTROL — the same search finds pos.xz, which those snippets DO use, so
    // the silence above is a fact about the text and not about the regexp.
    assert.ok(/pos\.xz/.test(stripComments(snippets)),
      'the search that reported no pos.y cannot find pos.xz either, so it proves nothing');
  });
});
