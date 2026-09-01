// tests/colour-ramp.test.js
//
// The fragment shader colours by ONE number:
//
//     float t = clamp((vH+.8)*.6, .03, .97);     shaders.js, FS and SE_FS_TEMPLATE
//
// so the palette's live window is vH in [-0.75, +0.8167] — 1.567 units wide, the
// size of the audio-driven displacement and nothing wider. That is what makes
// the palette the app's AUDIO channel: measured on GPU mode 0 over the desktop
// plane (planeSize 7, planeSegs 160), the field spans ±0.1400 at the boot
// uniforms in silence (uAmp 0.7, bass = mid = treble = 0, uWI 1, uTime 0) and
// -1.4933..+1.9900 with uAmp 1.5 and bass 1.0; the sweep a viewer sees is the
// music moving it. (At that loud end the ramp clips 64.4 % of the plane's area,
// and did before round 10 too — not this change's business. Probe:
// notes/audits/.../wave3/glsl/probes/P5-window.txt.)
//
// Round 10 correctly gave the shape its own y back — pos.y = (shape + field) —
// and vH was still pos.y, so the ramp was suddenly being handed a body that
// spans ±3.5. Measured on the catalogue as render.js builds it (desktop, the
// same uniforms in silence, uMorphProgress 1), the triangle area landing on a
// CLAMPED, flat colour went from 0.0 % on every one of the twenty shapes to
// 73-100 % on FIFTEEN of them, on the first frame: from 73.6 % (torusknot) to
// 100 % (octahedron), with solar at 37.7 % and the five flat shapes — plane,
// disc, circle, hex, tetrahedron — at 0.0 %. 15 + 1 + 5 = 21, and the count is
// re-derivable: notes/audits/.../wave3/glsl/probes/P4-clamped-count.txt prints
// the whole table, and the CONTROL below re-measures the same fifteen.
// (Fourteen until `sierpinski-tetra` joined the catalogue — a solid body, so it
// lands in this column like the other solids. The probe file above predates it
// and lists fourteen; the CONTROL, not the file, is what this count answers to.
// TWENTY-ONE since the six parametric surfaces arrived: mobius, klein,
// catenoid, helicoid, hyperboloid and pseudosphere are all bodies with a shape
// of their own, so they colour like the solids and not like the plates.
// 21 + 1 + 5 = 27. TWENTY-SIX since the five implicit bodies arrived — gyroid,
// schwarz-p and chmutov clear 70 % while clebsch reads 64.2 % and cayley
// 66.5 %, so the split is 21 saturating + 5 thin. 26 + 1 + 5 = 32.)
// (The header used to say "fifteen of them — 81.5 % of the boot shape". The
// count was wrong and the second half was right: fourteen shapes clear 73 %,
// and 81.5 % is pyramid-smooth, which IS the boot shape — src/shapes.js's
// DEFAULT_SHAPE, `selected` in index.html's picker. A first correction of this
// note claimed the boot shape was the plane; it is not, and the plane reads
// 0.0 % in both columns because it has no body of its own to colour by.)
//
// The fix: colour by the DISPLACEMENT on the two paths round 10 touched (GPU
// math mode, and Surface mode), and leave Volume and Collapse alone, which have
// always written base + displacement and have always coloured by the sum.
//
// ── What this file pins, and how ─────────────────────────────────────────────
// It reads the two shipped vertex programs, classifies each write against a
// table of forms it knows the arithmetic of (refusing to guess at anything
// else), models that arithmetic in float32 the way a GLSL highp float rounds,
// and runs the app's own geometry through it. Block comments are stripped
// before the scan, not just line comments: round 10's mutation matrix caught a
// sibling guard being fooled by a /* */ block that quoted the correct form
// above a defective line.
//
// Four controls are in here on purpose, and none of them may fire:
//   • Volume and Collapse — vH must stay bit-identical to what it is today, on
//     all 20 shapes at five morph positions. This fix does not touch them.
//   • the flat shapes (plane, circle) — base y is 0 there, so the whole change
//     must be a bit-exact no-op, and the clamped-area reading must stay 0.0 %
//     as it was in BOTH columns. A metric that fired on them would be measuring
//     "the shape has volume", not "the ramp is saturated".
//   • the sensitivity check — the same clamped-area metric, fed the absolute
//     height, must come back 73-100 %. A guard whose metric cannot fire is
//     worth nothing, and this codebase has shipped four of those.
//   • the editor template's GPU branch — a user shader's own y must still be
//     what colours it, bit-for-bit as before round 10.
//
// Run:
//   node --test tests/colour-ramp.test.js

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as G from './helpers/glsl.js';

const F = Math.fround;
const SRC_PATH = fileURLToPath(new URL('../src/shaders.js', import.meta.url));

let VS, THREE, RenderEngine, applyHeightField, generateSurfaceFromFormula, getFormula,
    MathVisualizer, weldNormals, SHAPE_NAMES;

// The worker bootstrap in MathVisualizer constructs one of these; without it
// node throws a ReferenceError that the constructor catches and logs.
class FakeWorker {
  constructor() { this.posted = []; }
  postMessage(m) { this.posted.push(m); }
  terminate() {}
}
globalThis.Worker = class { constructor() { return new FakeWorker(); } };
globalThis.requestAnimationFrame ??= (cb) => { void cb; return 0; };
globalThis.performance ??= { now: () => 0 };

before(async () => {
  ({ VS } = await import('../src/shaders.js'));
  THREE = await import('three');
  ({ RenderEngine } = await import('../src/render.js'));
  ({ applyHeightField, generateSurfaceFromFormula, getFormula } =
    await import('../src/math-collections.js'));
  ({ MathVisualizer, weldNormals } = await import('../src/math-visualizer.js'));
  ({ SHAPE_NAMES } = await import('../src/shapes.js'));
});

// ── Reading the shipped vertex program ───────────────────────────────────────
//
// Every piece of GLSL reading here goes through tests/helpers/glsl.js, which
// parses rather than matches: comments of both kinds gone, whitespace and line
// breaks meaningless, numeric literals canonical, redundant parentheses dropped,
// `+` and `*` compared in either operand order, and locals resolved to their
// DEFINITION rather than trusted by name. Wave 2 of round 10's review turned
// this file 11 tests red with edits that change nothing — a space in the branch
// header, `(f + pos.y)`, a local renamed from `f` to `disp`, `.6` respelled
// `0.6` — and four of those reds were this file's own CONTROL assertions.

/**
 * SE_VS_TEMPLATE's whole text, bounded by the template literal's own delimiters
 * and found by its EXACT declaration name.
 *
 * It used to be read as `src.slice(marks[1].index - 400, marks[1].index + 400)`
 * — a fixed character window around the second `if(uMathMode==0){`. Measured on
 * the shipped file, the +400 half reached 230 characters past the close of the
 * else block and every one of them was comment, against 363 characters of tail
 * that actually exist. readProgram's tail check therefore saw ZERO statements
 * for this program, and `vH=pos.y;` appended after the branch — the round-10
 * colour regression, in the editor — passed all 15 guard files (wave-2 row A14;
 * the identical mutation in the built-in VS, which is handed whole, is caught,
 * row A13). Same window, same blindness for pos.y: row A12.
 *
 * Its replacement, `lastIndexOf('const SE_VS_TEMPLATE')`, prefix-matched any
 * longer identifier and sliced to end of file, which a decoy
 * `const SE_VS_TEMPLATE_REFERENCE` walked straight through.
 */
function editorTemplate(src) {
  const text = G.templateLiteral(src, 'SE_VS_TEMPLATE');
  // The tail is the point of reading the whole thing, so say out loud that it
  // is in here: gl_Position is the last statement of main(), after the branch.
  assert.ok(/gl_Position/.test(text),
    'the slice taken for SE_VS_TEMPLATE stops before the end of main(); everything after the ' +
    'uMathMode branch would be invisible to the tail check, which is exactly the hole this fixed');
  return text;
}

// The arithmetic of every FORM the reader knows, keyed by what that form MEANS.
// The forms themselves — which GLSL counts as which meaning — live in
// tests/helpers/glsl.js, written once as GLSL and turned into patterns by the
// same parser that reads the shipped file, so this table cannot be a list of
// spellings. Anything the reader cannot name is a hard stop: guessing at an
// unrecognised line is how a guard comes to pass on a program it never modelled.
//
//   y0    the shape's own y, as the geometry was built
//   f     the displacement (GPU: the blended mode field; editor: the body's y)
//   p     uMorphProgress
//   posY  what the pos.y write left behind, when vH is read after it
const POS_MODEL = {
  'keeps':     (y0, f, p) => F(F(y0 + F(f)) * p),
  'keeps-out': (y0, f, p) => F(F(y0 * p) + F(F(f) * p)),
  'replaces':  (y0, f, p) => F(F(f) * p),        // pre-round-10: the shape's own y thrown away
  'no-deflate': (y0, f, p) => F(y0 + F(F(f) * p)),
  'scale':     (attrY, _f, p) => F(attrY * p),
};
// `first` is true when the vH write comes BEFORE the pos.y write in the same
// branch, which decides what `pos.y` means inside it. The shipped CPU branch
// writes vH first and the shipped GPU branch writes it second; a model that
// ignored the order would be describing a program nobody ships.
const GPU_VH_MODEL = {
  'field':          (y0, f, p, posY) => F(F(f) * p),
  'height':         (y0, f, p, posY, first) => (first ? y0 : posY),
  'height-scaled':  (y0, f, p, posY, first) => F((first ? y0 : posY) * p),
};
const CPU_VH_MODEL = {
  'field-cpu':      (attrY, base, p, field) => (field ? F(F(attrY - base) * p) : F(attrY * p)),
  // FIX(r11): the field arrives in its own attribute instead of being recovered
  // by subtraction, because the displacement follows the surface normal and
  // pos.y − aBaseY is n_y·h there. The model says exactly that: under
  // uVHField == 2 the ramp reads the field, scaled by the morph, and the
  // geometry does not enter into it at all.
  'field-cpu-attr': (attrY, base, p, field, first, fieldVal) => (field ? F(F(fieldVal) * p) : F(attrY * p)),
  // the same subtraction taken after the scaling instead of before — 3 ulps
  // rather than 1, measured, so it is modelled rather than refused
  'field-cpu-late': (attrY, base, p, field) => (field ? F(F(attrY * p) - F(base * p)) : F(attrY * p)),
  // ways of getting it wrong, modelled so the failure says WHICH:
  //   no subtraction at all (round 10), subtraction in every CPU mode
  //   (Volume and Collapse change too), subtraction without the morph scale
  'height':               (attrY, base, p, field, first) => (first ? F(attrY) : F(attrY * p)),
  'height-scaled':        (attrY, base, p, field, first) => (first ? F(attrY * p) : F(F(attrY * p) * p)),
  'field-unconditional':  (attrY, base, p) => F(F(attrY - base) * p),
  'field-cpu-unscaled':   (attrY, base, p, field) => (field ? F(attrY - base) : F(attrY * p)),
};

function pick(table, write, what) {
  assert.equal(write.count, 1,
    `${what}: expected exactly one write, found ${write.count}` +
    (write.writes ? ` — ${write.writes.join(' | ')}` : ''));
  assert.ok(!write.badDisplacement,
    `${what}: the write has the right shape ('${write.shape}') but what it carries is not the ` +
    `displacement — that operand resolves to ${write.badDisplacement}, from "${write.stmt};"`);
  assert.ok(write.kind && table[write.kind],
    `${what}: this reader cannot say what "${write.stmt ?? write.writes?.[0]};" means` +
    (write.wrapped
      ? ` — it is WRAPPED (the statement's left side is "${write.wrapped}"), so it is conditional ` +
        'or nested. This reader models unconditional writes; when one runs is not something it ' +
        'will guess at.'
      : (write.canon ? `, which resolves to ${write.canon}` : '') +
        '. Spelling, spacing, parentheses, operand order and the name of a local are all ' +
        'irrelevant here, so this is a form the guard has never been told the meaning of: add it ' +
        'to the FORMS in tests/helpers/glsl.js and a model for it beside this table.'));
  return table[write.kind];
}

/** Model the two branches of a vertex program. */
function readProgram(src, label) {
  const P = G.readVertexProgram(src);

  const gpuPos = pick(POS_MODEL, P.gpu.pos, `${label} GPU pos.y`);
  // The CPU write is checked, not modelled: pick() asserts there is exactly one
  // of it, that it carries a displacement and that this reader understands it.
  // Nothing below evaluates it — the CPU branch's geometry is applyHeightField's
  // business — so the CALL is the point and the return value is deliberately
  // dropped. Binding it to a name only made it look like an oversight.
  pick(POS_MODEL, P.cpu.pos, `${label} CPU pos.y`);

  // A vH write after the branch overrides whatever either branch wrote — that
  // is exactly the shape of the round-10 defect, so it must not be invisible.
  const tailVH = P.tail.vhWrite;
  const gpuVHw = tailVH ?? P.gpu.vh;
  const cpuVHw = tailVH ?? P.cpu.vh;
  assert.ok(gpuVHw.count === 1, `${label}: ${gpuVHw.count} writes to vH on the GPU path, expected one`);
  assert.ok(cpuVHw.count === 1, `${label}: ${cpuVHw.count} writes to vH on the CPU path, expected one`);
  const gpuVH = pick(GPU_VH_MODEL, gpuVHw, `${label} GPU vH`);
  const cpuVH = pick(CPU_VH_MODEL, cpuVHw, `${label} CPU vH`);
  // Order inside the branch: a vH write that reads pos.y means something
  // different depending on whether it runs before or after the pos.y write.
  const gpuFirst = !tailVH && P.gpu.vh.at < P.gpu.pos.at;
  const cpuFirst = !tailVH && P.cpu.vh.at < P.cpu.pos.at;

  return {
    label,
    gpuPosY: (y0, f, p) => gpuPos(y0, f, p),
    gpuVH:   (y0, f, p) => gpuVH(y0, f, p, gpuPos(y0, f, p), gpuFirst),
    cpuVH:   (attrY, base, p, field, fieldVal) => cpuVH(attrY, base, p, field, cpuFirst, fieldVal),
    text: {
      gpuPosStmt: P.gpu.pos.stmt, gpuVHStmt: gpuVHw.stmt,
      cpuPosStmt: P.cpu.pos.stmt, cpuVHStmt: cpuVHw.stmt,
    },
    kinds: { gpuPos: P.gpu.pos.kind, gpuVH: gpuVHw.kind, cpuPos: P.cpu.pos.kind, cpuVH: cpuVHw.kind },
    // Canonical text of each write: comments gone, spacing gone, parentheses
    // that change nothing gone, commutative operands in a fixed order, locals
    // resolved to their definitions. Two programs that compute the same thing
    // have the same canonical text however they are typed.
    canon: { gpuPos: P.gpu.pos.canon, gpuVH: gpuVHw.canon, cpuPos: P.cpu.pos.canon, cpuVH: cpuVHw.canon },
    // The statements AFTER the branch. Exposed so a test can assert this is
    // not empty: for SE_VS_TEMPLATE it was, because the program was read
    // through a +-400-character window that stopped inside the comment block.
    tailStmts: P.tail.stmts,
  };
}

// The two references this file compares against, quoted from the sources they
// come from so a reader can check them without running anything.
//
//   c629b53:src/shaders.js  pos.y = mix(y,yNxt,uModeBlend)*uMorphProgress;  vH = pos.y;
//   round 10 (uncommitted)  pos.y = (pos.y+mix(...))*uMorphProgress;        vH = pos.y;
const PRE_R10 = { gpuVH: (y0, f, p) => F(F(f) * p) };
const ROUND10 = { gpuVH: (y0, f, p) => F(F(y0 + F(f)) * p) };

// ── GPU mode 0, at two uniform states ────────────────────────────────────────
// Only used to give the models a realistic f. Every bit-identity claim below
// holds for ANY f — both sides are fed the same numbers — so a drift between
// this model and computeMode cannot make a failing program look passing.
const turb = (px, py) => { let t = 0; for (let i = 1; i < 5; i++) t += Math.abs(Math.sin(px * i) * Math.cos(py * i)) / i; return t; };
const mode0 = (x, z, U) =>
  Math.sin(Math.hypot(x, z) * 8 * U.wi + U.T) * (0.2 + U.b * 0.8) * U.a
  + Math.sin(x * 5 * U.m * U.wi) * 0.1
  + turb(x * (2 + U.t) * U.wi, z * (2 + U.t) * U.wi) * U.b * 0.3;

const SILENCE = { name: 'silence (uAmp .7, bass=mid=treble=0)', a: 0.7, b: 0, t: 0, m: 0, wi: 1, T: 0 };
const LOUD    = { name: 'sliders up (uAmp 1.5, bass 1.0)',      a: 1.5, b: 1, t: 0, m: 0, wi: 1, T: 0 };
const PROGS   = [0, 0.25, 0.5, 0.75, 1];

// ── The catalogue, built by the app's own setShape ───────────────────────────
// Not a hand-built stand-in: round 10's worst defect was a test whose geometry
// no longer matched what the app builds. This drives RenderEngine.prototype
// .setShape over a stub with the fields it touches, so the geometry, the
// rotations, the plate Y-zeroing and the aBaseY attribute are all the shipped
// code's own work.
function shapeStub() {
  const stub = {
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
    _buildShapeGeo: RenderEngine.prototype._buildShapeGeo,
    _buildStarGeo:  RenderEngine.prototype._buildStarGeo,
    setShape:       RenderEngine.prototype.setShape,
  };
  return stub;
}

function buildShape(name) {
  const stub = shapeStub();
  stub.setShape(name);
  return stub.gpuMesh.geometry;
}

/** Every triangle of a geometry, indexed or not. */
function tris(g) {
  const idx = g.index, N = g.attributes.position.count;
  const n = idx ? idx.count : N, out = [];
  for (let i = 0; i < n; i += 3) out.push(idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2]);
  return out;
}

/** The FS ramp, in float32. */
//
// PARSED out of src/shaders.js, never copied into this file. Until wave 2 the
// model below was a HAND-WRITTEN copy — `F(F(vH + 0.8) * 0.6)` clamped to
// 0.03/0.97 — that no test ever compared to the shipped statement, so widening
// the window tenfold in either fragment shader passed all 15 guard files
// (wave-2 rows D10a and D10b, both RED=NONE). That is the same failure class as
// round 9's hand-built geometry, which is the reason round 10 exists: a model
// of the code is only worth what its link to the code is worth.
//
// Its first replacement matched a regexp against the whitespace-squeezed file,
// which is a copy of the SPELLING instead of a copy of the numbers: respelling
// `.6` as `0.6` — the same number — fired this file's own control. G.colourRamps
// parses each fragment program's main(), resolves its locals first (so splitting
// the expression across two statements changes nothing), and reads the four
// numbers off the tree.
//
// Both fragment shaders must carry the SAME ramp — a user shader that fell out
// of step with the built-in would recolour the scene the moment the editor was
// opened — so two live matches that disagree is itself the failure.
let _ramp = null;
function shippedRamp() {
  if (_ramp) return _ramp;
  const found = G.colourRamps(readFileSync(SRC_PATH, 'utf8'));
  assert.equal(found.length, 2,
    `expected the ramp clamp((vH+off)*gain,lo,hi) in exactly two shipped programs — the built-in ` +
    `FS and SE_FS_TEMPLATE — found ${found.length}` +
    (found.length ? ` (${found.map(r => r.program).join(', ')})` : '') +
    `. Comments are stripped before anything is read, so this counts programs, not prose about them`);
  assert.deepEqual(found.map(r => r.program), ['FS', 'SE_FS_TEMPLATE'],
    `the ramp was found in ${found.map(r => r.program).join(' and ')}, which are not the two ` +
    `fragment programs this file is about`);
  const key = r => [r.off, r.gain, r.lo, r.hi];
  assert.deepEqual(key(found[0]), key(found[1]),
    `the two fragment shaders ramp differently: built-in ${JSON.stringify(key(found[0]))} vs editor ` +
    `${JSON.stringify(key(found[1]))}. Opening the shader editor would change every colour on screen`);
  const { off, gain, lo, hi } = found[0];
  _ramp = { off, gain, lo, hi };
  return _ramp;
}
const RAMP_LO = () => shippedRamp().lo, RAMP_HI = () => shippedRamp().hi;
const rampT = vH => {
  const { off, gain, lo, hi } = shippedRamp();
  return Math.min(hi, Math.max(lo, F(F(vH + off) * gain)));
};

/**
 * Fraction of triangle AREA whose centroid colour is clamped flat.
 * Calibrated against notes/audits/.../L-colour-banding.txt: sampling the shape's
 * own y and the field at the centroid's own (x,z), weighting by the undisplaced
 * triangle's area, reproduces all 80 published numbers digit for digit.
 */
function clampedArea(g, vhOf, U) {
  const pos = g.attributes.position;
  let area = 0, clamped = 0;
  for (const [i, j, k] of tris(g)) {
    const bx = pos.getX(j) - pos.getX(i), by = pos.getY(j) - pos.getY(i), bz = pos.getZ(j) - pos.getZ(i);
    const cx = pos.getX(k) - pos.getX(i), cy = pos.getY(k) - pos.getY(i), cz = pos.getZ(k) - pos.getZ(i);
    const A = 0.5 * Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx);
    const xc = (pos.getX(i) + pos.getX(j) + pos.getX(k)) / 3;
    const yc = (pos.getY(i) + pos.getY(j) + pos.getY(k)) / 3;
    const zc = (pos.getZ(i) + pos.getZ(j) + pos.getZ(k)) / 3;
    const t  = rampT(vhOf(yc, mode0(xc, zc, U), 1));
    area += A;
    if (t <= RAMP_LO() || t >= RAMP_HI()) clamped += A;
  }
  return area > 0 ? clamped / area : 0;
}

// The five shapes whose own y is small enough that the ramp never noticed it —
// the controls. 'solar' is a 1.2-radius sphere and does clamp (37.7 %), so it
// is NOT in here.
const FLAT = ['plane', 'disc', 'circle', 'hex', 'tetrahedron'];

// Bodies that are neither plates nor saturating solids under the OLD
// absolute-height ramp: measured 10.4 % (mobius), 30.9 % (klein) and 50.4 %
// (pseudosphere) of triangle area on a clamped colour, against 70-100 % for
// every other solid. The quantity is where a body's AREA sits, not how tall it
// is — see the CONTROL that pins all three from both sides. Under the ramp the
// app actually ships they read 0.0 % like everything else, which is the test
// above this one.
// The two cubics joined them in wave B — clebsch 64.2 %, cayley 66.5 % — and
// they are this list's clearest demonstration of its own rule that the quantity
// is WHERE THE AREA SITS and not how tall the body is. The two sit at opposite
// ends of the height range: clebsch is 3.21 half-tall, taller than the sphere's
// own reach, and cayley only 2.00, yet they read within two points of each
// other. Both are algebraic bodies whose area is carried by four arms leaving
// the middle of the frame, so neither banks enough area near its own extremes
// to clamp. The two triply periodic bodies, which look far more like the
// original THIN members, do clamp — see the note in the CONTROL below.
const THIN = ['mobius', 'klein', 'pseudosphere', 'clebsch', 'cayley'];

// ─────────────────────────────────────────────────────────────────────────────
describe('the built-in vertex program hands the ramp a displacement', () => {

  test('GPU math mode reproduces the pre-round-10 vH bit for bit', () => {
    const P = readProgram(VS, 'VS');
    // -0 prints as "0", so a message quoting the first difference has to say
    // which zero it means or it reads as "these two identical numbers differ".
    const fmt = v => (Object.is(v, -0) ? '-0' : String(v));
    let checked = 0, differing = 0, signedZeroOnly = 0, worst = null;
    for (const name of SHAPE_NAMES) {
      const g = buildShape(name);
      const pos = g.attributes.position;
      for (const U of [SILENCE, LOUD]) {
        for (const p of PROGS) {
          for (let i = 0; i < pos.count; i++) {
            const y0 = pos.getY(i), f = mode0(pos.getX(i), pos.getZ(i), U);
            const now = P.gpuVH(y0, f, p), was = PRE_R10.gpuVH(y0, f, p);
            checked++;
            if (Object.is(now, was)) continue;
            differing++;
            if (now === was) signedZeroOnly++;      // +0 against -0: same colour
            else worst ??= `${name} vertex ${i} ${U.name} progress ${p}: ${fmt(now)} vs ${fmt(was)}`;
          }
        }
      }
      g.dispose();
    }
    // 147 136 vertices over the twenty shapes, two uniform states, five morph
    // positions — 1 471 360 comparisons. The floor is here so a sweep that
    // silently stopped building shapes cannot pass by comparing nothing.
    assert.ok(checked > 1.4e6, `precondition: the sweep is the whole catalogue, checked only ${checked}`);
    assert.equal(differing, 0,
      `${differing} of ${checked} float32 words differ from the pre-round-10 colour value` +
      (worst ? ` — first one that differs in VALUE: ${worst}` : '') +
      (signedZeroOnly ? ` (${signedZeroOnly} of them are a +0 against a -0, which is the same colour)` : '') +
      `. The write is: ${P.text.gpuPosStmt}; ${P.text.gpuVHStmt};`);
  });

  test('CONTROL — the same comparison DOES fire on round 10, and not on the flat shapes', () => {
    // Sensitivity: the identity above is not vacuous. Against round 10's
    // vH = pos.y the same sweep must differ on every shape with a body, and
    // must NOT differ on the shapes whose own y is zero.
    const fired = [], quiet = [];
    for (const name of SHAPE_NAMES) {
      const g = buildShape(name);
      const pos = g.attributes.position;
      let diff = 0;
      for (let i = 0; i < pos.count; i++) {
        const y0 = pos.getY(i), f = mode0(pos.getX(i), pos.getZ(i), SILENCE);
        if (!Object.is(ROUND10.gpuVH(y0, f, 1), PRE_R10.gpuVH(y0, f, 1))) diff++;
      }
      (diff > 0 ? fired : quiet).push(name);
      g.dispose();
    }
    assert.ok(fired.length >= 15,
      `the comparison only distinguishes ${fired.length} shapes; it cannot be trusted to catch a regression`);
    for (const name of ['plane', 'circle']) {
      assert.ok(quiet.includes(name), `${name}'s own y is 0, so nothing about it should differ — control fired`);
    }
  });

  test('the flat frame stays flat and stays mid-palette', () => {
    // uMorphProgress = 0 is the frame every shape swap hides its geometry
    // change in. Colour has to go with it: t = clamp(0.8*0.6) = 0.48, the
    // middle of the palette, on every vertex of every shape.
    const P = readProgram(VS, 'VS');
    for (const name of SHAPE_NAMES) {
      const g = buildShape(name);
      const pos = g.attributes.position;
      let maxAbs = 0;
      for (let i = 0; i < pos.count; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(P.gpuVH(pos.getY(i), mode0(pos.getX(i), pos.getZ(i), LOUD), 0)));
      }
      g.dispose();
      assert.equal(maxAbs, 0, `${name} still colours by ${maxAbs} at the flat frame`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the ramp is back inside its window on the whole catalogue', () => {

  test('no shape puts any of its surface on a clamped colour in silence', () => {
    const P = readProgram(VS, 'VS');
    const bad = [];
    for (const name of SHAPE_NAMES) {
      const g = buildShape(name);
      const frac = clampedArea(g, P.gpuVH, SILENCE);
      g.dispose();
      if (frac > 0.005) bad.push(`${name} ${(frac * 100).toFixed(1)} %`);
    }
    assert.deepEqual(bad, [],
      'these shapes colour a flat band with nothing playing, which is what the ramp is calibrated to avoid: ' + bad.join(', '));
  });

  test('CONTROL — the same metric reads 73-100 % when fed the absolute height', () => {
    // If this ever comes back quiet, the reading above proves nothing.
    const solid = SHAPE_NAMES.filter(n => !FLAT.includes(n) && !THIN.includes(n) && n !== 'solar');
    // The count in this file's header, pinned here so the two cannot drift:
    // twenty-one shapes clear 70 %, five read in between, solar reads 37.7 %,
    // the five flat ones 0.0 %. 21 + 5 + 1 + 5 = 32.
    //
    // Eighteen until the five implicit bodies arrived, and the split among them
    // came out the opposite way from the expectation — which had a reason, so
    // the correction is worth keeping. A triply periodic surface crowds its area
    // near y = 0 by construction, which is what put `mobius` and `klein` in
    // THIN, so `gyroid` and `schwarz-p` looked like the THIN candidates and the
    // two cubics like solids. It went the other way: the TPMS pair clamps,
    // because the old ramp clamps on |y| and a TPMS is periodic in y as well —
    // its area is spread over every band rather than banked in the middle one —
    // while both cubics fall short. Predicting this from the shape's
    // description does not work; measuring it does.
    assert.equal(solid.length, 21,
      `the header says twenty-one shapes saturate the ramp under absolute-height colouring; this ` +
      `control measures ${solid.length} of them (${SHAPE_NAMES.length} shapes, minus ${FLAT.length} ` +
      `flat ones, minus ${THIN.length} thin ones, minus solar)`);
    for (const name of solid) {
      const g = buildShape(name);
      const frac = clampedArea(g, ROUND10.gpuVH, SILENCE);
      g.dispose();
      assert.ok(frac >= 0.70,
        `${name} reads only ${(frac * 100).toFixed(1)} % under absolute-height colouring — the metric has gone blind`);
    }
  });

  test('CONTROL — and the three thin surfaces read in between, not at either end', () => {
    // Not an exemption. THIN is a measured fact about where a body's AREA sits,
    // not about how tall it is: the old ramp coloured by |y|, so a surface whose
    // area crowds the y = 0 band never reached the clamp however far its
    // extremes ran. The pseudosphere is ±3.87 tall and still reads 50.4 %,
    // because most of its area is the wide collar at the cusp.
    // Pinned at both ends so neither drift can pass: a THIN shape that climbs
    // past 70 % belongs in `solid`, and one that falls to 0 belongs in FLAT.
    for (const [name, want] of [['mobius', 10.4], ['klein', 30.9], ['pseudosphere', 50.4],
                                ['clebsch', 64.2], ['cayley', 66.5]]) {
      const g = buildShape(name);
      const frac = clampedArea(g, ROUND10.gpuVH, SILENCE) * 100;
      g.dispose();
      assert.ok(frac > 1 && frac < 70,
        `${name} reads ${frac.toFixed(1)} %, outside the band that put it here`);
      assert.ok(Math.abs(frac - want) < 1.5,
        `${name} read ${want} % when it was classified and reads ${frac.toFixed(1)} % now`);
    }
  });

  test('CONTROL — the flat shapes read 0.0 % under BOTH, before and after', () => {
    for (const name of FLAT) {
      const g = buildShape(name);
      const after  = clampedArea(g, readProgram(VS, 'VS').gpuVH, SILENCE);
      const before = clampedArea(g, ROUND10.gpuVH, SILENCE);
      g.dispose();
      assert.ok(after < 0.005 && before < 0.005,
        `${name} is a plate; a metric that fires on it (${(before * 100).toFixed(1)} % / ${(after * 100).toFixed(1)} %) ` +
        'is measuring the body, not the saturation');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Surface mode gets the field back out of base + field', () => {

  test('vH is f(x,z)*uMorphProgress on all 20 shapes, to float32 precision', () => {
    const P = readProgram(VS, 'VS');
    const f = getFormula('trigonometry', 'standingWave');
    assert.ok(f, 'precondition: the formula this drives with still exists');

    for (const name of SHAPE_NAMES) {
      const g = buildShape(name);
      const pos = g.attributes.position, n = pos.count;
      const base = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { base[i * 3] = pos.getX(i); base[i * 3 + 1] = pos.getY(i); base[i * 3 + 2] = pos.getZ(i); }
      const grid = Math.round(Math.sqrt(n));
      const hf = generateSurfaceFromFormula(f.f, { amp: 0.7, freq: 1, comp: 0.5 }, grid, 3.5, 1.234);

      // The field ALONE, written by the same sampler on the same vertices —
      // this is literally what applyHeightField wrote before round 10.
      applyHeightField(g, hf, null, 3.5);
      const fieldOnly = new Float32Array(n);
      for (let i = 0; i < n; i++) fieldOnly[i] = pos.getY(i);
      for (let i = 0; i < n; i++) pos.setY(i, base[i * 3 + 1]);
      // …and what it writes now: base + field along the surface normal, called
      // with the SAME arity the app calls it with. FIX(r11): this line used to
      // pass four arguments while src/math-visualizer.js passed five, so the
      // guard was measuring a branch the app no longer takes — and it stayed
      // green while the ramp went blind on every non-flat shape.
      if (!g.attributes.normal) g.computeVertexNormals();
      const nrmAttr = g.attributes.normal;
      const rawN = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        rawN[i * 3] = nrmAttr.getX(i); rawN[i * 3 + 1] = nrmAttr.getY(i); rawN[i * 3 + 2] = nrmAttr.getZ(i);
      }
      applyHeightField(g, hf, base, 3.5, weldNormals(base, rawN));

      let scale = 0, body = 0;
      for (let i = 0; i < n; i++) {
        scale = Math.max(scale, Math.abs(fieldOnly[i]));
        body  = Math.max(body,  Math.abs(base[i * 3 + 1]));
      }
      // The only error the algebra can carry is the rounding of (base + field)
      // into the float32 attribute, so the bound is float32 eps times the
      // magnitudes involved — not a tolerance chosen to fit the answer.
      const EPS32 = 2 ** -23;
      const tol   = 8 * EPS32 * (body + scale);
      // …and the bound has to be far below the signal, or passing it would
      // mean nothing. Tightest ratio over the catalogue is the tetrahedron:
      // body 2.02, field 3.2e-3, tol 2.0e-6 — still 1600x smaller.
      assert.ok(tol < scale / 100,
        `precondition: on ${name} the rounding bound (${tol.toExponential(2)}) is not small against the field ` +
        `(${scale.toExponential(2)}), so this comparison cannot tell a wrong algebra from rounding`);

      let worst = 0;
      for (const p of PROGS) {
        for (let i = 0; i < n; i++) {
          const got   = P.cpuVH(pos.getY(i), base[i * 3 + 1], p, true, fieldOnly[i]);
          const ideal = F(fieldOnly[i] * p);
          worst = Math.max(worst, Math.abs(got - ideal));
        }
      }
      g.dispose();
      assert.ok(worst <= tol,
        `${name}: vH is off the field by ${worst.toExponential(2)}, past the float32 rounding bound ` +
        `${tol.toExponential(2)} (body ${body.toFixed(3)}, field ${scale.toExponential(2)}) — ` +
        `that is not rounding, the algebra is wrong. Write: ${P.text.cpuVHStmt}`);
    }
  });

  test('CONTROL — Volume and Collapse are bit-identical, all 20 shapes', () => {
    // uVHField stays 0 for them, and vH must be exactly the scaled attribute:
    // what round 10 ships and what c629b53 shipped. Not close — identical.
    const P = readProgram(VS, 'VS');
    let checked = 0, differing = 0;
    for (const name of SHAPE_NAMES) {
      const g = buildShape(name);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        // whatever the volume/collapse writers left in the attribute
        const attrY = F(pos.getY(i) + Math.sin(i * 0.37) * 1.7);
        for (const p of PROGS) {
          const now = P.cpuVH(attrY, pos.getY(i), p, false);
          const was = F(attrY * p);
          checked++;
          if (!Object.is(now, was)) differing++;
        }
      }
      g.dispose();
    }
    assert.ok(checked > 5e5, `precondition: the sweep is the catalogue, checked only ${checked}`);
    assert.equal(differing, 0,
      `${differing} of ${checked} float32 words moved in a mode this change does not touch`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the plumbing that carries the base y', () => {

  test('setShape freezes the shape\'s own y into aBaseY, on every shape', () => {
    for (const name of SHAPE_NAMES) {
      const g = buildShape(name);
      const a = g.attributes.aBaseY;
      assert.ok(a, `${name}: no aBaseY — the ramp would subtract 0 and colour by the body`);
      assert.equal(a.itemSize, 1);
      assert.equal(a.count, g.attributes.position.count, `${name}: aBaseY is the wrong length`);
      let diff = 0;
      for (let i = 0; i < a.count; i++) if (!Object.is(a.getX(i), g.attributes.position.getY(i))) diff++;
      assert.equal(diff, 0, `${name}: ${diff} of ${a.count} aBaseY values are not the geometry's own y`);
      g.dispose();
    }
  });

  test('aBaseY is uploaded on the shape change and on no frame after it', () => {
    const geometry = buildShape('plane');
    const render = {
      isMobile: false,
      U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 }, uVHField: { value: 0 } },
      gpuMesh: { geometry },
      gpuPtsProxy: null,
      cb: {},
    };
    const audio = { bass: 0.4, mid: 0.3, treble: 0.2, beatInt: 0, amp: 0.7, waveInt: 1 };
    const viz = new MathVisualizer(render, audio);
    viz.onShapeChange();
    viz.setFormula('trigonometry', 'standingWave');

    const baseVersion = geometry.attributes.aBaseY.version;
    const posVersion  = geometry.attributes.position.version;
    for (let frame = 0; frame < 60; frame++) viz.tick(1 + frame / 60);

    assert.ok(geometry.attributes.position.version > posVersion,
      'precondition: 60 frames of Surface mode did upload the positions — otherwise this proves nothing');
    assert.equal(geometry.attributes.aBaseY.version - baseVersion, 0,
      'aBaseY was re-uploaded during the frame loop; it is a per-shape constant');
  });

  test('uVHField says WHERE the field is, and only where the CPU put one there', () => {
    const geometry = buildShape('sphere');
    const render = {
      isMobile: false,
      U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 }, uVHField: { value: 0 } },
      gpuMesh: { geometry },
      gpuPtsProxy: null,
      cb: {},
    };
    const audio = { bass: 0, mid: 0, treble: 0, beatInt: 0, amp: 0.7, waveInt: 1 };
    const viz = new MathVisualizer(render, audio);
    viz.onShapeChange();

    assert.equal(render.U.uVHField.value, 0, 'nothing armed yet');

    viz.setFormula('trigonometry', 'standingWave');
    // FIX(r11): 2, not 1. The displacement follows the surface normal now, so
    // pos.y − aBaseY is n_y·h rather than h, and the ramp reads the field out
    // of its own attribute instead. 1 remains the meaning "subtract the base",
    // for a geometry that carries no aField — pinned by its own case below.
    assert.equal(render.U.uVHField.value, 2, 'Surface mode leaves the field in aField — the ramp must read it');

    viz.setMode('collapse');
    assert.equal(render.U.uVHField.value, 0, 'CONTROL — Collapse writes base + displacement and colours by the sum');

    viz.setMode('surface');
    assert.equal(render.U.uVHField.value, 2);

    viz.setVolumeFormula('twist');
    assert.equal(render.U.uVHField.value, 0, 'CONTROL — Volume, likewise');

    viz.setMode('surface');
    viz.deactivate();
    assert.equal(render.U.uVHField.value, 0, 'CONTROL — the GPU owns pos.y again');

    // A geometry with no aField — an imported model — keeps the old meaning
    // rather than going flat: the default attribute value is 0, and a ramp that
    // read 0 everywhere would be a black screen dressed as a fix.
    const bare = buildShape('sphere');
    bare.deleteAttribute('aField');
    const r2 = {
      isMobile: false,
      U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 }, uVHField: { value: 0 } },
      gpuMesh: { geometry: bare }, gpuPtsProxy: null, cb: {},
    };
    const viz2 = new MathVisualizer(r2, audio);
    viz2.onShapeChange();
    viz2.setFormula('trigonometry', 'standingWave');
    assert.equal(r2.U.uVHField.value, 1, 'without the attribute the ramp must fall back to the subtraction');

    // The one case where Surface must NOT subtract: no pristine snapshot, so
    // applyHeightField wrote the field alone and there is no base in there.
    viz.setFormula('trigonometry', 'standingWave');
    assert.equal(render.U.uVHField.value, 2);
    viz._pristinePositions = null;
    viz.setMode('collapse'); viz.setMode('surface');
    assert.equal(render.U.uVHField.value, 0,
      'with no base captured applyHeightField writes the field alone; subtracting aBaseY would take out a body that is not there');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('both programs declare what they read', () => {
  // There is no GLSL compiler in this suite, and an undeclared identifier is a
  // LINK failure — the whole visualisation goes black, and no other test in the
  // repo would see it. This is the cheap half of that check: every name the new
  // colour writes use has to be declared in the same program's preamble. The
  // editor's fragment template already carries a comment about exactly this
  // failure ("without the uniforms those two failed to compile at all").
  // Comments out FIRST. Mutation M11 commented the declaration out and this
  // check stayed green until it did: `// uniform int uVHField;` matched the
  // pattern happily, and a commented-out declaration is exactly the link
  // failure the check is for. It now reads the program's DECLARATIONS rather
  // than searching for a shape of words near the name, so a mention of aBaseY
  // in an unrelated statement cannot stand in for declaring it either.
  const declares = (src, name) => G.declarations(src).has(name);

  const programs = () => [
    ['VS', VS],
    ['SE_VS_TEMPLATE', editorTemplate(readFileSync(SRC_PATH, 'utf8'))],
  ];

  test('uVHField and aBaseY are declared in both vertex programs', () => {
    for (const [label, src] of programs()) {
      for (const name of ['uVHField', 'aBaseY']) {
        assert.ok(declares(src, name),
          `${label} reads ${name} without declaring it — the program would fail to link and the scene goes black`);
      }
    }
  });

  test('CONTROL — the same check reports a name that is genuinely absent', () => {
    for (const [label, src] of programs()) {
      assert.equal(declares(src, 'uNotAThing'), false,
        `${label}: the declaration check claims to find a name nothing declares, so it proves nothing`);
    }
  });

  test('the uniform exists on the engine that feeds these programs', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/render.js', import.meta.url)), 'utf8');
    assert.match(src, /uVHField:\s*\{\s*value:/,
      'RenderEngine.U has no uVHField — three would leave the uniform unset and the CPU colour path undefined');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the editor template gets the same two channels', () => {

  test('a user shader\'s own y is what colours it, as before round 10', () => {
    // SE_VS_TEMPLATE is module-private; tests/shader-source-owner.test.js drives
    // the real ShaderEditor over it. Here it is read out of the source, which is
    // the same text the template interpolates the user body into.
    const src = readFileSync(SRC_PATH, 'utf8');
    const marks = G.findIfs(src, 'uMathMode == 0');
    assert.equal(marks.length, 2,
      `expected exactly two uMathMode branches (built-in VS and the editor template), found ` +
      `${marks.length}. This counts branches rather than a string: spacing, line breaks and the ` +
      `order of the comparison do not affect it, and comments are stripped first`);
    const P = readProgram(editorTemplate(src), 'SE_VS_TEMPLATE');

    // GPU branch: bit-for-bit c629b53's `pos.y=y*uMorphProgress; vH=pos.y;`
    let differing = 0, checked = 0;
    const g = buildShape('sphere');
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y0 = pos.getY(i), f = mode0(pos.getX(i), pos.getZ(i), SILENCE);
      for (const p of PROGS) {
        checked++;
        if (!Object.is(P.gpuVH(y0, f, p), PRE_R10.gpuVH(y0, f, p))) differing++;
      }
    }
    // …and it still ADDS to the shape rather than replacing it (round 10's fix)
    let flat = 0;
    for (let i = 0; i < pos.count; i++) {
      const y0 = pos.getY(i), f = mode0(pos.getX(i), pos.getZ(i), SILENCE);
      if (Object.is(P.gpuPosY(y0, f, 1), F(F(f) * 1))) flat++;
    }
    g.dispose();
    assert.equal(differing, 0, `${differing} of ${checked} colour words differ from the pre-round-10 editor shader`);
    assert.ok(flat < pos.count * 0.01,
      'the editor template is back to flattening the shape into the graph of the body');
  });

  test('CONTROL — the editor CPU branch is the built-in\'s, meaning for meaning', () => {
    // Compared as MEANINGS, not as text. This assertion used to compare the two
    // statements character for character, so putting redundant parentheses on
    // one of them — `pos.y = (pos.y * uMorphProgress);`, wave-2 row C06 — turned
    // this control red while changing nothing whatsoever about either program.
    const src = readFileSync(SRC_PATH, 'utf8');
    const editor = readProgram(editorTemplate(src), 'SE_VS_TEMPLATE');
    const builtin = readProgram(VS, 'VS');
    assert.equal(editor.canon.cpuVH, builtin.canon.cpuVH,
      `the two programs colour CPU modes differently — editor ${editor.canon.cpuVH} against ` +
      `built-in ${builtin.canon.cpuVH}; a preset that switches between them would change colour`);
    assert.equal(editor.canon.cpuPos, builtin.canon.cpuPos,
      `the two programs deflate differently — editor ${editor.canon.cpuPos} against built-in ` +
      `${builtin.canon.cpuPos}`);
    assert.equal(editor.kinds.cpuVH, builtin.kinds.cpuVH);
    assert.equal(editor.kinds.cpuPos, builtin.kinds.cpuPos);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ramp itself, and the reader that finds the writes feeding it. Both were
// unguarded: the ramp because this file carried a hand-written copy of it that
// nothing compared to the shipped statement, and the tail because the editor
// program was read through a fixed character window that stopped inside a
// comment block. Rows D10a, D10b, A12 and A14 of the round-10 matrix all
// passed every guard in the repo before this suite existed.
describe('the ramp this file models is the ramp that ships', () => {

  test('both fragment shaders carry it, identically, and it is the one modelled here', () => {
    const r = shippedRamp();     // parses src/shaders.js; asserts two live, equal matches
    // The numbers, so a failure says which one moved rather than only "differs".
    assert.deepEqual(r, { off: 0.8, gain: 0.6, lo: 0.03, hi: 0.97 },
      'the shipped ramp moved. Every clamped-area number in this file and in the header ' +
      'comment was measured against clamp((vH+.8)*.6,.03,.97); re-measure them before ' +
      'changing this line');
    // …and the window that follows from it, which is the sentence at the top of
    // this file. Measured, not asserted: wave2/guards/M1-ramp-window.txt.
    const lo = r.lo / r.gain - r.off, hi = r.hi / r.gain - r.off;
    assert.equal(lo.toFixed(4), '-0.7500');
    assert.equal(hi.toFixed(4), '0.8167');
    assert.equal((hi - lo).toFixed(4), '1.5667');
  });

  test('nothing else touches the palette parameter except the band tint', () => {
    // The ramp pattern is anchored on vH, so a SECOND statement rewriting `t`
    // is invisible to it — and every clamped-area figure in this file is
    // computed from the model, not from the shader. A model of the code is only
    // worth what its link to the code is worth, which is the sentence this
    // whole describe block exists for; one level down, the same hole.
    //
    // Exactly one further write is allowed, in both programs, and it is the
    // band tint. What is checked about it is what the rest of the file depends
    // on: it re-clamps into the SAME window, so no pixel can leave the ramp and
    // every conclusion here about clamped area and about the NIGHT contract
    // still holds — and it reads vBandU, which is static per vertex, so it adds
    // no temporal modulation to a channel this app damps on purpose.
    const found = G.colourRamps(readFileSync(SRC_PATH, 'utf8'));
    const r = shippedRamp();
    for (const f of found) {
      assert.ok(f.after.length <= 1,
        `${f.program}: ${f.after.length} statements rewrite the palette parameter after the ` +
        `ramp (${f.after.join(' | ')}). This file models one`);
      if (!f.after.length) continue;
      const s = f.after[0];
      assert.match(s, /vBandU/,
        `${f.program}: "${s};" rewrites the palette parameter with something other than the ` +
        'band coordinate. Anything audio-driven here is coherent brightness modulation at the ' +
        'rate the band moves, which is the class of flicker uBeat is pinned to 0 for');
      const num = n => String(n).replace('.', '\\.');
      assert.match(s, new RegExp(`=\\s*clamp\\s*\\(.*,\\s*${num(r.lo)}\\s*,\\s*${num(r.hi)}\\s*\\)\\s*$`),
        `${f.program}: "${s};" does not re-clamp into the shipped window ` +
        `[${r.lo}, ${r.hi}] — a pixel could land on a colour the palette never declares, and ` +
        'the NIGHT darkness contract is stated over the ramp, not over arbitrary parameters');
      // An ALLOWLIST, not a list of banned names. A banlist was tried and let
      // the worst case through: `bandAtU(vBandU)` mentions none of uBands,
      // uBeat or uBass and yet returns a band LEVEL, which is precisely the
      // loudness-driven tint this design refuses. Naming what may appear is the
      // only form of this check that cannot be walked around by indirection.
      const ALLOWED = new Set(['t', 'clamp', 'step', 'vBandU']);
      const names = new Set((s.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []));
      for (const n of names) {
        assert.ok(ALLOWED.has(n),
          `${f.program}: the tint reads "${n}" — "${s};". Only ${[...ALLOWED].join(', ')} may ` +
          'appear here. Anything else can carry a level, and a level in this statement is ' +
          'coherent brightness modulation at the rate the band moves — the class of flicker ' +
          'uBeat is pinned to 0 for');
      }
    }
    assert.ok(found.some(f => f.after.length === 1),
      'neither fragment program applies the band tint any more, so this guard reports on nothing');
  });

  test('CONTROL — the parser moves when the ramp moves', () => {
    // Without this the equality above could be reading a constant it invented.
    // Same parser, same file, one number changed the way row D10a changes it:
    // the gain a tenth of what it is, i.e. a window ten times as wide.
    //
    // The edit is DERIVED, not typed. Its predecessor did
    // `clean.replace('clamp((vH+.8)*.6,.03,.97)', …)`, a literal copy of one
    // spelling of the statement, and when `.6` was respelled `0.6` — the same
    // number — the replace silently matched nothing and this control failed
    // saying the parser invents numbers. Here the four numbers come out of the
    // parse, one is divided by ten, and the statement is written back over its
    // own span; nothing in it is a copy of how the source happens to be typed.
    const src   = readFileSync(SRC_PATH, 'utf8');
    const clean = G.stripComments(src);
    const first = G.colourRamps(src)[0];
    const [s, e] = first.span;
    const rewritten = `${first.lhs}=clamp((vH+${first.off})*${first.gain / 10},${first.lo},${first.hi})`;
    const widened = clean.slice(0, s) + rewritten + clean.slice(e);
    assert.notEqual(widened, clean, 'precondition: the rewrite changed nothing, so it tests nothing');
    const found = G.colourRamps(widened);
    assert.equal(found.length, 2, 'the rewrite broke one of the two programs rather than editing it');
    // Expected values derived from what was read, not typed: with the gain
    // hardcoded here, moving the shipped ramp for a real reason would fire this
    // CONTROL as well as the assertion above — two failures, one of them saying
    // something false about the reader.
    assert.deepEqual([found[0].off, found[0].gain, found[0].lo, found[0].hi],
                     [first.off, first.gain / 10, first.lo, first.hi],
      'the reader reports the numbers it read before, not the numbers in the text it was given');
    // "It moved" is the whole claim, and it is stated against what this reader
    // itself read a moment ago. Comparing the two programs to each other here
    // instead was wrong in one case that matters: if the OTHER fragment shader
    // has already been widened — which is the tree row D10b produces — the
    // rewrite makes them agree, and the control failed saying a one-sided change
    // must leave them disagreeing. That sentence was false of that tree.
    assert.notEqual(found[0].gain, first.gain,
      'the reader reports the same gain for text that no longer carries that number');
    const w = (found[0].hi - found[0].lo) / found[0].gain;
    const wantW = 10 * (first.hi - first.lo) / first.gain;
    assert.equal(w.toFixed(3), wantW.toFixed(3),
      `the widened window is ${w}, not ten times the shipped ${((first.hi - first.lo) / first.gain).toFixed(4)}`);
  });

  test('CONTROL — the same numbers survive being respelled, and a split statement', () => {
    // The other direction, and the one that mattered: an edit that changes no
    // number must change no reading. Both of these turned this file red before
    // the reader was rewritten (wave-2 rows C04 and C17).
    const r = shippedRamp();
    const prog = body => `const A = \`void main(){${body}}\`;`;
    // The four numbers are the SHIPPED ones, spelled several ways — not typed
    // in. Hardcoding `.6` here would make this control fail the day the ramp
    // moves for a good reason, saying the reader misread text that it read
    // perfectly well; that is the same mistake its predecessor made.
    const bare = v => String(v).replace(/^(-?)0\./, '$1.');   // 0.6 -> .6
    const pad  = v => v.toFixed(4);                           // 0.6 -> 0.6000
    const { off, gain, lo, hi } = r;
    const cases = {
      'as shipped':        `float t=clamp((vH+${bare(off)})*${bare(gain)},${bare(lo)},${bare(hi)});`,
      'leading zeros':     `float t=clamp((vH+${off})*${gain},${lo},${hi});`,
      'trailing zeros':    `float t=clamp((vH+${pad(off)})*${pad(gain)},${pad(lo)},${pad(hi)});`,
      'reflowed':          `float t = clamp( (vH + ${bare(off)}) * ${bare(gain)} ,\n   ${bare(lo)} , ${bare(hi)} );`,
      'operands commuted': `float t=clamp(${bare(gain)}*(${bare(off)}+vH),${bare(lo)},${bare(hi)});`,
      'split in two':      `float u=(vH+${bare(off)})*${bare(gain)};float t=clamp(u,${bare(lo)},${bare(hi)});`,
    };
    for (const [what, body] of Object.entries(cases)) {
      const got = G.colourRamps(prog(body));
      assert.equal(got.length, 1, `${what}: the reader found ${got.length} ramps, not one`);
      assert.deepEqual({ off: got[0].off, gain: got[0].gain, lo: got[0].lo, hi: got[0].hi }, r,
        `${what}: the same ramp written another way read as a different ramp`);
    }
  });

  test('both programs have statements AFTER the branch for the tail check to read', () => {
    // The measurement that would have failed before the +-400 window went: for
    // SE_VS_TEMPLATE the tail was empty, so `vH=pos.y;` appended there was
    // invisible and row A14 passed the whole repo.
    const src = readFileSync(SRC_PATH, 'utf8');
    for (const [label, text] of [['VS', VS], ['SE_VS_TEMPLATE', editorTemplate(src)]]) {
      const P = readProgram(text, label);
      assert.ok(P.tailStmts.length >= 3,
        `${label}: only ${P.tailStmts.length} statements after the uMathMode branch — ` +
        `the program is being read through a window that stops short of its end`);
      assert.ok(P.tailStmts.some(s => /gl_Position/.test(s)),
        `${label}: gl_Position is not in the tail, so main() is not being read to its end`);
    }
  });

  test('a vH write after the branch overrides both branches, and the reader says so', () => {
    // Self-test of the tail rule, on text this test owns, so it holds whatever
    // the shipped programs happen to look like.
    const prog = body => `void main(){vec3 pos=position;
      float y=mix(computeMode(uMode,pos.xz,b,t,m,bt,a,wi,T),computeMode(uModeNext,pos.xz,b,t,m,bt,a,wi,T),uModeBlend);
      if(uMathMode==0){pos.y=(pos.y+y)*uMorphProgress;vH=y*uMorphProgress;}
      else{vH=(uVHField==1)?(pos.y-aBaseY)*uMorphProgress:pos.y*uMorphProgress;pos.y=pos.y*uMorphProgress;}
      ${body}gl_Position=vec4(pos,1.);}`;
    // CONTROL — with nothing in the tail the branch's own write is what is read.
    assert.equal(readProgram(prog(''), 'probe').kinds.gpuVH, 'field');
    // The regression, appended: it must be what the reader reports for BOTH paths.
    const over = readProgram(prog('vH=pos.y;'), 'probe');
    assert.equal(over.text.gpuVHStmt, 'vH=pos.y');
    assert.equal(over.text.cpuVHStmt, 'vH=pos.y');
    assert.equal(over.kinds.gpuVH, 'height');
    // …and wrapped, which is how the anchored filter used to be evaded: the
    // statement is not a form this file has arithmetic for, so it is refused
    // rather than stepped over.
    assert.throws(() => readProgram(prog('if(uMathMode==0)vH=pos.y;'), 'probe'),
      /this reader cannot say what/);
    assert.throws(() => readProgram(prog('{vH=pos.y;}'), 'probe'),
      /this reader cannot say what/);
  });
});
