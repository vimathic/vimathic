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
//   1. PARSES the pos.y write out of the shipped source with tests/helpers/
//      glsl.js — comments of both kinds gone, whitespace and line breaks
//      meaningless, numeric literals canonical, redundant parentheses dropped,
//      `+` and `*` matched in either operand order, and every local resolved to
//      its DEFINITION rather than trusted by its name;
//   2. classifies that tree against five forms, and refuses anything else —
//      including a write whose shape is right but whose displacement is not the
//      blended mode field (a `float f = 0.0;` under the expected name);
//   3. models exactly that arithmetic in float32, per operation, the way a
//      GLSL highp float rounds;
//   4. runs the geometry RenderEngine.setShape really builds through it and
//      measures the picture — degenerate triangles, Y extent, the gap between
//      the box's two faces.
//
// So it is a MEANING stencil for which statement ships and a measurement for
// what that statement does. The stencil is still the weak half — a program that
// computed the same thing in a form not among the five is a hard failure rather
// than a false pass, which is the right direction to be wrong in — but it is no
// longer a table of spellings. It cannot see a linkage error, a precision
// qualifier, or a driver bug. A browser smoke test is the only thing that can.
//
// Why that rewrite happened: wave 2 of round 10's review ran thirty edits that
// change nothing at all through the old readers, and eleven turned a guard red
// — a space in `if (uMathMode == 0) {`, addends commuted, a redundant pair of
// parentheses, a local renamed. Four of them fired this file's or colour-ramp's
// OWN control assertions, and the message printed on the first was "the vertex
// program still branches on uMathMode", which was false: it did. A guard that
// fires on a line break teaches people to shape source to fit a regexp, and
// that had already happened once here (see the note in src/shaders.js about an
// example rewritten into English to keep a guard green).
//
// Two controls are in here on purpose, and neither may fire:
//   • the plane — not the boot shape, which is pyramid-smooth, but the one
//     geometry the pre-round assignment was RIGHT for — must not move by one
//     float32 ulp — after
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
import * as G from './helpers/glsl.js';

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

// ── the arithmetic of every form the reader knows ───────────────────────────
//   y0  the shape's own y, as setShape built it
//   d   the displacement (VS: the blended mode field; SE_VS_TEMPLATE: the `y`
//       the interpolated user body wrote)
//   p   uMorphProgress
//
// The FORMS live in tests/helpers/glsl.js, written once as GLSL and turned into
// patterns by the same parser that reads the shipped file. Here is only what
// each one computes.
const F = Math.fround;
const MODEL = {
  'keeps':      (y0, d, p) => F(F(y0 + F(d)) * p),         // round 10's fix
  'keeps-out':  (y0, d, p) => F(F(y0 * p) + F(F(d) * p)),  // the same, distributed
  'replaces':   (y0, d, p) => F(F(d) * p),                 // pre-round-10: the shape is gone
  'no-deflate': (y0, d, p) => F(y0 + F(F(d) * p)),         // keeps it, never flattens
};
// The CPU (else) branch has exactly one job: pos.y already holds base +
// displacement (applyHeightField for Surface, the volume/collapse writers
// otherwise) and the branch scales it by uMorphProgress so the deflate → swap →
// inflate still hides the geometry swap. Anything else is a hard stop.
const CPU_MODEL = { 'scale': (attrY, p) => F(attrY * p) };

const UNKNOWN =
  'This guard models five forms of the write and refuses the rest. If the line above is ' +
  'arithmetically right, it is the FORM list in tests/helpers/glsl.js that needs the new ' +
  'form and a model for it here — spelling, spacing, parentheses, operand order and the ' +
  'name of a local are already irrelevant to the reader.';

/**
 * Read one vertex program into the two models this file measures with.
 * Every refusal below names what was read and what would have been accepted.
 */
function gpuWrite(src, label) {
  const P = G.readVertexProgram(src);

  assert.equal(P.gpu.pos.count, 1,
    `${label}: expected exactly one pos.y write in the GPU branch, found ${P.gpu.pos.count}` +
    (P.gpu.pos.count ? ` — ${(P.gpu.pos.writes || [P.gpu.pos.stmt]).join(' | ')}` : '') +
    '; with more than one the last is what ships and the first is what a reader sees');
  assert.deepEqual(P.tail.pos, [],
    `${label}: pos.y is written again after the uMathMode branch (${P.tail.pos.join(' | ')}), ` +
    'which overrides everything both branches did');

  // ── The whole-vector tail write, which the line above never could see ──────
  // assignsTo(stmt, ['pos','y']) matches `pos.y = …` and nothing else, so
  // `pos += …` walked past the guard above for as long as the guard existed.
  // The PTS cloud needs exactly that write — it moves the vertex along its
  // normal, which is not a y-only displacement — and the honest way to add it
  // was to close the gap and model the one form that is allowed, not to slip
  // through it.
  //
  // What has to hold: at most one such write, an ADDITION (a plain `=` would
  // discard everything both branches computed), and three names in it. Without
  // uPtBand the scatter runs on triangles and on imported models; without
  // bandHere it is not the band doing the scattering; without normal it is not
  // leaving the surface, which is the whole difference between a cloud and a
  // lumpier sheet.
  const pv = P.tail.posVecWrite;
  if (pv) {
    assert.ok(!pv.unreadable && !pv.wrapped && pv.count === 1,
      `${label}: the tail writes the whole position in a form this guard cannot read — ` +
      `${pv.unreadable ?? pv.wrapped ?? `${pv.count} writes: ${(pv.writes || []).join(' | ')}`}`);
    assert.equal(pv.op, '+=',
      `${label}: the tail assigns to pos with '${pv.op}' — "${pv.stmt};" — which throws away ` +
      'both branches instead of adding to what they wrote');
    for (const name of ['normal', 'uPtBand', 'bandHere']) {
      assert.ok(pv.names.has(name),
        `${label}: the tail's whole-position write "${pv.stmt};" does not read ${name}. ` +
        (name === 'uPtBand'
          ? 'Ungated, it displaces triangles, wireframes and imported models too.'
          : name === 'bandHere'
            ? 'Then it is not the audio band moving these points.'
            : 'Then the points never leave the surface, which is the point of the mode.'));
    }
  }

  assert.ok(!P.gpu.pos.badDisplacement,
    `${label}: the GPU branch's write has the right shape ('${P.gpu.pos.shape}') but the thing it ` +
    `adds is not the field — that operand resolves to ${P.gpu.pos.badDisplacement}, from ` +
    `"${P.gpu.pos.stmt};". A displacement has to be the blend of computeMode(uMode, pos.xz, …) and ` +
    'computeMode(uModeNext, pos.xz, …), or the interpolated body\'s own y in the editor template; ' +
    'anything else (a local holding 0.0, or pos.y itself) makes the measurements below meaningless');
  assert.ok(P.gpu.pos.kind,
    `${label}: the GPU branch's pos.y write reads as "${P.gpu.pos.stmt ?? P.gpu.pos.writes?.[0]};"` +
    (P.gpu.pos.wrapped
      ? ` — and it is WRAPPED (the statement's left side is "${P.gpu.pos.wrapped}"), so it is ` +
        'conditional or nested. This guard models unconditional writes; when one runs is not ' +
        'something it will guess at.'
      : (P.gpu.pos.canon ? `, which resolves to ${P.gpu.pos.canon}` : '') + '. ' + UNKNOWN));
  const apply = MODEL[P.gpu.pos.kind];
  assert.ok(apply, `${label}: no float32 model here for the form '${P.gpu.pos.kind}'`);
  assert.ok(P.gpu.pos.displacement,
    `${label}: the write is '${P.gpu.pos.kind}' but nothing identified its displacement — ${P.gpu.pos.canon}`);

  // The CPU half, read by the same code so that a program can never be
  // certified on one branch alone. Until wave 2 the else block was discarded
  // entirely and dropping uMorphProgress from this write left the file green.
  assert.equal(P.cpu.pos.count, 1,
    `${label}: expected exactly one pos.y write in the CPU (else) branch, found ` +
    `${P.cpu.pos.count}${P.cpu.pos.count ? ` — ${(P.cpu.pos.writes || [P.cpu.pos.stmt]).join(' | ')}` : ''}`);
  const cpuApply = CPU_MODEL[P.cpu.pos.kind];
  assert.ok(cpuApply,
    `${label}: the CPU branch's pos.y write is "${P.cpu.pos.stmt ?? P.cpu.pos.writes?.[0]};", which ` +
    'this guard has no arithmetic for. The only accepted form is pos.y = pos.y * uMorphProgress ' +
    '(however it is spelled) — unscaled, the flat frame setShapeAnimated swaps the geometry at is ' +
    'not flat and every shape change is a visible cut between two solids');

  return { apply, stmt: P.gpu.pos.stmt, cpuApply, cpuStmt: P.cpu.pos.stmt, program: P };
}

/** The two shipped vertex programs. */
function programs() {
  // Read by exact declaration name and bounded by the template literal's own
  // backticks. `lastIndexOf('const SE_VS_TEMPLATE')` prefix-matched any longer
  // identifier and sliced to end of file: wave 2 reverted the real branch to the
  // pre-round-10 form, appended a decoy `const SE_VS_TEMPLATE_REFERENCE` holding
  // the correct text, and this file went 21/0 green on a tree shipping the
  // defect.
  const editor = G.templateLiteral(SRC, 'SE_VS_TEMPLATE');
  // …and it is still the text the editor compiles, not a leftover. If
  // ShaderEditor stopped calling it, everything measured below would be about
  // dead text.
  assert.ok(/\bSE_VS_TEMPLATE\s*\(/.test(G.stripComments(SRC)),
    'precondition: nothing calls SE_VS_TEMPLATE any more — the editor program measured here is dead text');
  return [['VS', VS], ['SE_VS_TEMPLATE', editor]];
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
    // has exactly one job. Until wave 2 the else block was discarded entirely
    // and dropping uMorphProgress from this write left the file green.
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
  // These cases feed the reader text it must refuse or classify correctly;
  // without them the reader could be returning 'keeps' unconditionally and the
  // whole file would be green on any tree.
  const wrap = body => `void main(){vec3 pos=position;
  if(uMathMode==0){${body}} else { pos.y=pos.y*uMorphProgress; }
  gl_Position=vec4(pos,1.);}`;
  const MODES = 'float y=computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T);' +
                'float yNxt=computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T);';
  const FIXED = MODES + 'float f=mix(y,yNxt,uModeBlend);pos.y=(pos.y+f)*uMorphProgress;';

  test('the pre-round-10 assignment is classified as a replacement, not accepted', () => {
    const { apply } = gpuWrite(wrap(MODES + 'pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;'), 'probe');
    assert.equal(apply(3, 0.1, 1), F(0.1), 'the reader did not model the assignment as a replacement');
  });

  test('D3: a block comment quoting the fixed form does not hide the broken one', () => {
    const src = wrap(MODES +
      '/* pos.y = (pos.y + mix(y, yNxt, uModeBlend)) * uMorphProgress; */' +
      'pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;');
    const { apply, stmt } = gpuWrite(src, 'probe');
    assert.equal(stmt, 'pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress',
      'the reader picked the comment instead of the statement');
    assert.equal(apply(3, 0.1, 1), F(0.1));
  });

  test('two writes in one branch are refused rather than silently resolved', () => {
    assert.throws(() => gpuWrite(wrap(FIXED + 'pos.y=f*uMorphProgress;'), 'probe'),
      /exactly one pos\.y write/);
  });

  test('a tail override WRAPPED in an if is refused, not stepped over', () => {
    // The hole this suite was missing. Statements are split on every `;`, at any
    // depth, precisely so that `if(uMathMode==0)pos.y=…` and `{pos.y=…}` stay
    // VISIBLE as statements that write pos.y — an anchored, depth-aware filter
    // saw a tail of length 0 and certified a program that puts the pre-round-10
    // assignment back after the branch (rows A1 and A12).
    const tail = 'if(uMathMode==0)pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;';
    assert.throws(() => gpuWrite(wrap(FIXED).replace('gl_Position', tail + 'gl_Position'), 'probe'),
      /pos\.y is written again after the uMathMode branch/);
    // …and in a bare block, which is the same evasion without the condition
    // (row A1b).
    assert.throws(() => gpuWrite(
      wrap(FIXED).replace('gl_Position', '{pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;}gl_Position'),
      'probe'), /pos\.y is written again after the uMathMode branch/);
    // CONTROL — the same program without the tail is accepted, so the two
    // refusals above are about the tail and not about the wrapper text.
    assert.equal(gpuWrite(wrap(FIXED), 'probe').stmt, 'pos.y=(pos.y+f)*uMorphProgress');
  });

  test('a second write hidden inside the GPU branch by an if is counted', () => {
    // Row A1c: the correct write stays and a conditional one after it in the
    // SAME branch overrides it. Anchored, the count stayed 1.
    assert.throws(() => gpuWrite(wrap(FIXED + 'if(uMorphProgress>-1.0)pos.y=f*uMorphProgress;'), 'probe'),
      /expected exactly one pos\.y write in the GPU branch, found 2/);
  });

  test('the one write there IS, wrapped in an if, is refused rather than modelled', () => {
    // Not the same case as above: here there is exactly one write and it is
    // conditional, so the count says nothing. The reader reports that the
    // statement's left side is not pos.y and refuses.
    assert.throws(() => gpuWrite(wrap(MODES + 'float f=mix(y,yNxt,uModeBlend);' +
      'if(uMorphProgress>-1.0)pos.y=(pos.y+f)*uMorphProgress;'), 'probe'),
      /WRAPPED/);
  });

  test('an unscaled CPU write is refused, not ignored', () => {
    // The else block was not read at all until wave 2 (row A11).
    assert.throws(() => gpuWrite(
      wrap(FIXED).replace('pos.y=pos.y*uMorphProgress;', 'pos.y=pos.y;'), 'probe'),
      /the CPU branch's pos\.y write is "pos\.y=pos\.y;"/);
  });

  test('a hoisted local with the wrong contents is refused, not trusted by name', () => {
    // The old reader kept a table of local NAMES, so this was caught only
    // because somebody listed `f`, and renaming `f` to `disp` broke the guard on
    // a tree that had changed nothing. Now the name is irrelevant and the
    // DEFINITION is what is read: both spellings of the fixed form pass, and
    // both spellings of this one are refused.
    for (const name of ['f', 'disp']) {
      assert.throws(() => gpuWrite(wrap(`float ${name}=0.0;pos.y=(pos.y+${name})*uMorphProgress;`), 'probe'),
        /the thing it adds is not the field/,
        `a local named ${name} holding 0.0 was accepted as the displacement`);
      assert.throws(() => gpuWrite(wrap(`float ${name}=pos.y;pos.y=(pos.y+${name})*uMorphProgress;`), 'probe'),
        /the thing it adds is not the field/);
    }
  });

  test('renaming the local, commuting, or adding parentheses changes nothing', () => {
    // The eleven behaviour-preserving edits of wave 2, in their smallest form.
    // Each of these turned this file red before the reader was rewritten.
    const same = [
      ['shipped',        FIXED],
      ['renamed local',  MODES + 'float disp=mix(y,yNxt,uModeBlend);pos.y=(pos.y+disp)*uMorphProgress;'],
      ['addends commuted', MODES + 'float f=mix(y,yNxt,uModeBlend);pos.y=(f+pos.y)*uMorphProgress;'],
      ['product commuted', MODES + 'float f=mix(y,yNxt,uModeBlend);pos.y=uMorphProgress*(pos.y+f);'],
      ['extra parentheses', MODES + 'float f=mix(y,yNxt,uModeBlend);pos.y=(((pos.y)+(f))*(uMorphProgress));'],
      ['inlined local',  MODES + 'pos.y=(pos.y+mix(y,yNxt,uModeBlend))*uMorphProgress;'],
      ['reflowed',       MODES + 'float f = mix( y , yNxt , uModeBlend );\n  pos.y = ( pos.y + f )\n     * uMorphProgress;'],
    ];
    for (const [what, body] of same) {
      const { apply } = gpuWrite(wrap(body), `probe (${what})`);
      assert.equal(apply(3, 0.1, 1), F(F(3 + F(0.1)) * 1),
        `${what}: the reader no longer models this as "keep the shape and deflate", though it is ` +
        'the shipped arithmetic written another way');
    }
    // …and the branch header itself, spelled four ways.
    for (const header of ['if (uMathMode == 0) {', 'if( uMathMode==0 ){', 'if(0==uMathMode){',
                          'if\n(uMathMode\n==\n0)\n{']) {
      const src = wrap(FIXED).replace('if(uMathMode==0){', header);
      assert.equal(gpuWrite(src, 'probe').apply(3, 0.1, 1), F(F(3 + F(0.1)) * 1),
        `the reader lost the branch when its header was written "${header}"`);
    }
  });

  test('CONTROL — the same reader passes the shipped VS unchanged', () => {
    // If the cases above fired on everything, they would prove nothing.
    for (const [label, src] of programs()) {
      const { apply } = gpuWrite(src, label);
      assert.equal(apply(3, 0.1, 1), F(F(3 + F(0.1)) * 1),
        `${label}: the reader no longer models the shipped write as "keep the shape and deflate"`);
    }
  });
});

describe('the program measured here is the program that ships', () => {
  test('shaders.js declares SE_VS_TEMPLATE exactly once, and the reader takes THAT one', () => {
    // Wave 2's decoy: revert the real template to the pre-round-10 form and
    // append `const SE_VS_TEMPLATE_REFERENCE = \`…correct text…\`` after it.
    // `lastIndexOf('const SE_VS_TEMPLATE')` prefix-matches the longer name and
    // the old slice ran to end of file, so this file read the decoy and went
    // 21/0 green on a tree that shipped the defect.
    const decoyed = SRC + '\nconst SE_VS_TEMPLATE_REFERENCE = `' +
      G.templateLiteral(SRC, 'SE_VS_TEMPLATE') + '`;\n';
    assert.equal(G.templateLiteral(decoyed, 'SE_VS_TEMPLATE'),
                 G.templateLiteral(SRC, 'SE_VS_TEMPLATE'),
      'a longer identifier beginning with SE_VS_TEMPLATE moved the reader off the shipped program');
    // CONTROL — the reader does find the decoy when asked for it by its own
    // name, so the equality above is about which declaration was chosen and not
    // about the reader failing to see anything.
    assert.ok(G.templateLiteral(decoyed, 'SE_VS_TEMPLATE_REFERENCE').includes('uMathMode'));
    // …and two declarations of the SAME name are a refusal, not a guess.
    assert.throws(() => G.templateLiteral(SRC + '\nconst SE_VS_TEMPLATE = `x`;\n', 'SE_VS_TEMPLATE'),
      /exactly one declaration/);
  });

  test('there are exactly two uMathMode branches in shaders.js', () => {
    // The census colour-ramp also keeps, duplicated on purpose so neither guard
    // depends on the other: a third vertex program with this branch is either a
    // decoy or a program nothing here measures.
    const n = G.findIfs(SRC, 'uMathMode == 0').length;
    assert.equal(n, 2,
      `expected exactly two if (uMathMode == 0) branches — the built-in VS and the editor ` +
      `template — and found ${n}. This counts branches, not text: spacing, line breaks and ` +
      `the order of the comparison do not affect it, and comments are stripped first`);
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
    const snippets = G.normalise(SRC.slice(from, to));
    assert.ok(!/pos\.y/.test(snippets),
      'a shipped vertex snippet reads pos.y; the displacement is no longer a function of pos.xz alone');
    // CONTROL — the same search finds pos.xz, which those snippets DO use, so
    // the silence above is a fact about the text and not about the regexp.
    assert.ok(/pos\.xz/.test(snippets),
      'the search that reported no pos.y cannot find pos.xz either, so it proves nothing');
  });
});
