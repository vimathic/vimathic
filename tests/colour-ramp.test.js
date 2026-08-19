// tests/colour-ramp.test.js
//
// The fragment shader colours by ONE number:
//
//     float t = clamp((vH+.8)*.6, .03, .97);     shaders.js, FS and SE_FS_TEMPLATE
//
// so the palette's live window is vH in [-0.75, +0.8167] — 1.567 units wide, the
// size of the audio-driven displacement and nothing wider. That is what makes
// the palette the app's AUDIO channel: measured on mode 0, the field spans
// ±0.14 in silence and reaches -1.49..+2.00 with uAmp 1.5 and bass 1.0, and the
// sweep a viewer sees is the music moving it. (At that loud end the ramp clips
// 64 % of the plane, and did before round 10 too — not this change's business.)
//
// Round 10 correctly gave the shape its own y back — pos.y = (shape + field) —
// and vH was still pos.y, so the ramp was suddenly being handed a body that
// spans ±3.5. Measured on the catalogue as render.js builds it, at boot uniforms
// with nothing playing (probe: notes/audits/.../close/colour-ramp/P0-*.txt,
// which reproduces all 80 numbers of L-colour-banding.txt digit for digit):
// the triangle area landing on a CLAMPED, flat colour went from 0.0 % on every
// one of the twenty shapes to 73-100 % on fifteen of them — 81.5 % of the boot
// shape, 100 % of the octahedron, on the first frame.
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

const F = Math.fround;
const SRC_PATH = fileURLToPath(new URL('../src/shaders.js', import.meta.url));

let VS, THREE, RenderEngine, applyHeightField, generateSurfaceFromFormula, getFormula,
    MathVisualizer, SHAPE_NAMES;

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
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
  ({ SHAPE_NAMES } = await import('../src/shapes.js'));
});

// ── Reading the shipped vertex program ───────────────────────────────────────

/** Line AND block comments out; a guard that reads prose reports the prose. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
            .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

/**
 * SE_VS_TEMPLATE's whole text, bounded by the template literal's own delimiters.
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
 * Bounding by the template's own text is what tests/gpu-shape-y.test.js already
 * does, minus the truncation.
 */
function editorTemplate(src) {
  const at = src.lastIndexOf('const SE_VS_TEMPLATE');
  assert.ok(at >= 0, 'precondition: SE_VS_TEMPLATE is gone from shaders.js');
  const end = src.indexOf('`;', at);
  assert.ok(end > at,
    'precondition: SE_VS_TEMPLATE is no longer one template literal ending in `; — ' +
    'this reader cannot find its end, and a truncated read is how the tail check went blind');
  const text = src.slice(at, end + 2);
  // The tail is the point of reading the whole thing, so say out loud that it
  // is in here: gl_Position is the last statement of main(), after the branch.
  assert.ok(/gl_Position/.test(text),
    'the slice taken for SE_VS_TEMPLATE stops before the end of main(); everything after the ' +
    'uMathMode branch would be invisible to the tail check, which is exactly the hole this fixed');
  return text;
}

/** Statements of a GLSL block, normalised to whitespace-free text. */
function statements(block) {
  return block.split(';').map(s => s.replace(/\s+/g, '')).filter(Boolean).map(s => s + ';');
}

// Does the statement WRITE this varying, anywhere in it? `pos.y-aBaseY` and
// `pos.y*uMorphProgress` inside a vH write are reads and do not match: an
// operator here has to be followed by '='. `pos.y==` is a comparison and does
// not match either.
const writesTo = name =>
  new RegExp(`(^|[^A-Za-z0-9_.])${name.replace('.', '\\.')}\\s*[+\\-*/]?=(?!=)`);
const touchesPosY = s => writesTo('pos.y').test(s);
const touchesVH   = s => writesTo('vH').test(s);

/**
 * Split a main() body at `if(uMathMode==0){ … } else { … }` by matching braces,
 * so neither an added statement nor a reflow can slip a branch past the reader.
 * @returns {{gpu: string, cpu: string, tail: string}}
 */
function splitBranches(src) {
  const clean = stripComments(src);
  const head = clean.indexOf('if(uMathMode==0){');
  assert.ok(head >= 0, 'precondition: the vertex program still branches on uMathMode');
  const matchFrom = i => {                      // i points at the opening brace
    let depth = 0;
    for (let k = i; k < clean.length; k++) {
      if (clean[k] === '{') depth++;
      else if (clean[k] === '}') { depth--; if (depth === 0) return k; }
    }
    assert.fail('unbalanced braces in the vertex program');
  };
  const gpuOpen  = clean.indexOf('{', head);
  const gpuClose = matchFrom(gpuOpen);
  const after    = clean.slice(gpuClose + 1);
  const elseM    = after.match(/^\s*else\s*\{/);
  assert.ok(elseM, 'precondition: the uMathMode branch still has an else');
  const cpuOpen  = gpuClose + 1 + elseM[0].length - 1;
  const cpuClose = matchFrom(cpuOpen);
  return {
    gpu:  clean.slice(gpuOpen + 1, gpuClose),
    cpu:  clean.slice(cpuOpen + 1, cpuClose),
    tail: clean.slice(cpuClose + 1),
  };
}

// The arithmetic of every write this file knows how to read. Anything else is a
// hard stop: guessing at an unrecognised line is how a guard comes to pass on a
// program it never modelled.
//
//   y0    the shape's own y, as the geometry was built
//   f     the displacement (GPU: mix(y,yNxt,uModeBlend); editor: the body's y)
//   p     uMorphProgress
const POS_FORMS = {
  'pos.y=(pos.y+f)*uMorphProgress;':                      (y0, f, p) => F(F(y0 + F(f)) * p),
  'pos.y=(pos.y+mix(y,yNxt,uModeBlend))*uMorphProgress;': (y0, f, p) => F(F(y0 + F(f)) * p),
  'pos.y=(pos.y+y)*uMorphProgress;':                      (y0, f, p) => F(F(y0 + F(f)) * p),
  // pre-round-10 (c629b53) — the shape's own y thrown away
  'pos.y=mix(y,yNxt,uModeBlend)*uMorphProgress;':         (y0, f, p) => F(F(f) * p),
  'pos.y=y*uMorphProgress;':                              (y0, f, p) => F(F(f) * p),
  'pos.y=pos.y*uMorphProgress;':                          (attrY, _f, p) => F(attrY * p),
};
const GPU_VH_FORMS = {
  'vH=f*uMorphProgress;':                      (y0, f, p, posY) => F(F(f) * p),
  'vH=y*uMorphProgress;':                      (y0, f, p, posY) => F(F(f) * p),
  'vH=mix(y,yNxt,uModeBlend)*uMorphProgress;': (y0, f, p, posY) => F(F(f) * p),
  // round 10 as shipped: the ramp is handed the body plus the field
  'vH=pos.y;':                                 (y0, f, p, posY) => posY,
};
const CPU_VH_FORMS = {
  'vH=(uVHField==1)?(pos.y-aBaseY)*uMorphProgress:pos.y*uMorphProgress;':
    (attrY, base, p, field) => (field ? F(F(attrY - base) * p) : F(attrY * p)),
  // the same subtraction taken after the scaling instead of before — 3 ulps
  // rather than 1, measured, so it is modelled rather than refused
  'vH=(uVHField==1)?(pos.y-aBaseY*uMorphProgress):pos.y;':
    (attrY, base, p, field) => (field ? F(F(attrY * p) - F(base * p)) : F(attrY * p)),
  // three ways of getting it wrong, modelled so the failure says WHICH:
  //   no subtraction at all (round 10), subtraction in every CPU mode
  //   (Volume and Collapse change too), subtraction without the morph scale
  'vH=pos.y;':                (attrY, base, p) => F(attrY * p),
  'vH=pos.y*uMorphProgress;': (attrY, base, p) => F(attrY * p),
  'vH=(pos.y-aBaseY)*uMorphProgress;': (attrY, base, p) => F(F(attrY - base) * p),
  'vH=(uVHField==1)?(pos.y-aBaseY):pos.y*uMorphProgress;':
    (attrY, base, p, field) => (field ? F(attrY - base) : F(attrY * p)),
};

function pick(table, stmt, what) {
  const fn = table[stmt];
  assert.ok(fn, `${what}: unrecognised write, refusing to guess what it means — ${stmt}`);
  return fn;
}

/** Model the two branches of a vertex program. */
function readProgram(src, label) {
  const { gpu, cpu, tail } = splitBranches(src);
  const gpuS = statements(gpu), cpuS = statements(cpu), tailS = statements(tail);

  // Containment, not `^`. A statement here is whatever `split(';')` produced,
  // so `if(uMathMode==0)vH=pos.y` and `{vH=pos.y` are single statements that an
  // anchored filter steps straight over — the same evasion measured on the
  // sibling guard in wave 2 (rows A1, A1b, A1c, A12). A wrapped write found this
  // way will not be a key of the tables below, and `pick` then refuses to guess
  // rather than certifying it, which is the direction to be wrong in.
  const gpuPosAll = gpuS.filter(touchesPosY);
  const cpuPosAll = cpuS.filter(touchesPosY);
  assert.equal(gpuPosAll.length, 1,
    `${label}: expected exactly one pos.y write in the GPU branch, found ${gpuPosAll.length}` +
    (gpuPosAll.length ? ` — ${gpuPosAll.join(' ')}` : ''));
  assert.equal(cpuPosAll.length, 1,
    `${label}: expected exactly one pos.y write in the CPU branch, found ${cpuPosAll.length}` +
    (cpuPosAll.length ? ` — ${cpuPosAll.join(' ')}` : ''));
  const gpuPosStmt = gpuPosAll[0];
  const cpuPosStmt = cpuPosAll[0];

  // A vH write after the branch overrides whatever either branch wrote — that
  // is exactly the shape of the round-10 defect, so it must not be invisible.
  const tailVH = tailS.filter(touchesVH).pop();
  const gpuVHStmt = tailVH ?? gpuS.filter(touchesVH).pop();
  const cpuVHStmt = tailVH ?? cpuS.filter(touchesVH).pop();
  assert.ok(gpuVHStmt, `${label}: nothing writes vH on the GPU path`);
  assert.ok(cpuVHStmt, `${label}: nothing writes vH on the CPU path`);

  const gpuPos = pick(POS_FORMS,    gpuPosStmt, `${label} GPU pos.y`);
  const cpuPos = pick(POS_FORMS,    cpuPosStmt, `${label} CPU pos.y`);
  const gpuVH  = pick(GPU_VH_FORMS, gpuVHStmt,  `${label} GPU vH`);
  const cpuVH  = pick(CPU_VH_FORMS, cpuVHStmt,  `${label} CPU vH`);

  return {
    label,
    gpuPosY: (y0, f, p) => gpuPos(y0, f, p),
    gpuVH:   (y0, f, p) => gpuVH(y0, f, p, gpuPos(y0, f, p)),
    cpuVH:   (attrY, base, p, field) => cpuVH(attrY, base, p, field),
    text: { gpuPosStmt, gpuVHStmt, cpuPosStmt, cpuVHStmt },
    // The statements AFTER the branch. Exposed so a test can assert this is
    // not empty: for SE_VS_TEMPLATE it was, because the program was read
    // through a +-400-character window that stopped inside the comment block.
    tailStmts: tailS,
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
// Read out of src/shaders.js rather than copied into this file. Until wave 2
// the model below was a HAND-WRITTEN copy — `F(F(vH + 0.8) * 0.6)` clamped to
// 0.03/0.97 — that no test ever compared to the shipped statement, so widening
// the window tenfold in either fragment shader passed all 15 guard files
// (wave-2 rows D10a and D10b, both RED=NONE). That is the same failure class as
// round 9's hand-built geometry, which is the reason round 10 exists: a model
// of the code is only worth what its link to the code is worth.
//
// Both fragment shaders must carry the SAME ramp — a user shader that fell out
// of step with the built-in would recolour the scene the moment the editor was
// opened — so two live matches that disagree is itself the failure.
const RAMP_RE = /clamp\(\(vH\+([\d.]+)\)\*([\d.]+),([\d.]+),([\d.]+)\)/g;
let _ramp = null;
function shippedRamp() {
  if (_ramp) return _ramp;
  const clean = stripComments(readFileSync(SRC_PATH, 'utf8')).replace(/\s+/g, '');
  const found = [...clean.matchAll(RAMP_RE)].map(m => m.slice(1, 5).map(Number));
  assert.equal(found.length, 2,
    `expected the ramp clamp((vH+off)*gain,lo,hi) in exactly two live places — the built-in FS ` +
    `and SE_FS_TEMPLATE — found ${found.length}. Comments are stripped first, so this counts ` +
    `shipped statements, not prose about them`);
  assert.deepEqual(found[0], found[1],
    `the two fragment shaders ramp differently: built-in ${JSON.stringify(found[0])} vs editor ` +
    `${JSON.stringify(found[1])}. Opening the shader editor would change every colour on screen`);
  const [off, gain, lo, hi] = found[0];
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

// ─────────────────────────────────────────────────────────────────────────────
describe('the built-in vertex program hands the ramp a displacement', () => {

  test('GPU math mode reproduces the pre-round-10 vH bit for bit', () => {
    const P = readProgram(VS, 'VS');
    let checked = 0, differing = 0, worst = null;
    for (const name of SHAPE_NAMES) {
      const g = buildShape(name);
      const pos = g.attributes.position;
      for (const U of [SILENCE, LOUD]) {
        for (const p of PROGS) {
          for (let i = 0; i < pos.count; i++) {
            const y0 = pos.getY(i), f = mode0(pos.getX(i), pos.getZ(i), U);
            const now = P.gpuVH(y0, f, p), was = PRE_R10.gpuVH(y0, f, p);
            checked++;
            if (!Object.is(now, was)) { differing++; worst ??= `${name} vertex ${i} ${U.name} progress ${p}: ${now} vs ${was}`; }
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
      `${differing} of ${checked} float32 words differ from the pre-round-10 colour value — first: ${worst}. ` +
      `The write is: ${P.text.gpuPosStmt} ${P.text.gpuVHStmt}`);
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
    const solid = SHAPE_NAMES.filter(n => !FLAT.includes(n) && n !== 'solar');
    for (const name of solid) {
      const g = buildShape(name);
      const frac = clampedArea(g, ROUND10.gpuVH, SILENCE);
      g.dispose();
      assert.ok(frac >= 0.70,
        `${name} reads only ${(frac * 100).toFixed(1)} % under absolute-height colouring — the metric has gone blind`);
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
      // …and what it writes now: base + field.
      applyHeightField(g, hf, base, 3.5);

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
          const got   = P.cpuVH(pos.getY(i), base[i * 3 + 1], p, true);
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

  test('uVHField is 1 only where the CPU actually added a base', () => {
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
    assert.equal(render.U.uVHField.value, 1, 'Surface mode adds the field to the base — the ramp must subtract it');

    viz.setMode('collapse');
    assert.equal(render.U.uVHField.value, 0, 'CONTROL — Collapse writes base + displacement and colours by the sum');

    viz.setMode('surface');
    assert.equal(render.U.uVHField.value, 1);

    viz.setVolumeFormula('twist');
    assert.equal(render.U.uVHField.value, 0, 'CONTROL — Volume, likewise');

    viz.setMode('surface');
    viz.deactivate();
    assert.equal(render.U.uVHField.value, 0, 'CONTROL — the GPU owns pos.y again');

    // The one case where Surface must NOT subtract: no pristine snapshot, so
    // applyHeightField wrote the field alone and there is no base in there.
    viz.setFormula('trigonometry', 'standingWave');
    assert.equal(render.U.uVHField.value, 1);
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
  // failure the check is for.
  const declares = (src, name) =>
    new RegExp(`(uniform|attribute|varying)\\s+[a-zA-Z0-9_]+\\s+[^;]*\\b${name}\\b`)
      .test(stripComments(src));

  const programs = () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    const marks = [...src.matchAll(/if\(uMathMode==0\)\{/g)];
    // SE_VS_TEMPLATE runs from the template literal's start; take a generous
    // slice back from its branch, bounded by the previous program's end.
    const editorStart = src.lastIndexOf('const SE_VS_TEMPLATE');
    return [
      ['VS', VS],
      ['SE_VS_TEMPLATE', src.slice(editorStart, marks[1].index + 400)],
    ];
  };

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
    const marks = [...src.matchAll(/if\(uMathMode==0\)\{/g)];
    assert.equal(marks.length, 2,
      `expected exactly two uMathMode branches (built-in VS and the editor template), found ${marks.length}`);
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

  test('CONTROL — the editor CPU branch is the built-in\'s, statement for statement', () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    const editor = readProgram(editorTemplate(src), 'SE_VS_TEMPLATE');
    const builtin = readProgram(VS, 'VS');
    assert.equal(editor.text.cpuVHStmt, builtin.text.cpuVHStmt,
      'the two programs colour CPU modes differently; a preset that switches between them would change colour');
    assert.equal(editor.text.cpuPosStmt, builtin.text.cpuPosStmt);
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

  test('CONTROL — the parser moves when the ramp moves', () => {
    // Without this the equality above could be reading a constant it invented.
    // Same parser, same source, one character changed the way row D10a changes
    // it: the gain a tenth of what it is, i.e. a window ten times as wide.
    const clean = stripComments(readFileSync(SRC_PATH, 'utf8')).replace(/\s+/g, '');
    const widened = clean.replace('clamp((vH+.8)*.6,.03,.97)', 'clamp((vH+.8)*.06,.03,.97)');
    assert.notEqual(widened, clean, 'precondition: the shipped statement is not where it was');
    const found = [...widened.matchAll(RAMP_RE)].map(m => m.slice(1, 5).map(Number));
    assert.equal(found.length, 2);
    assert.deepEqual(found[0], [0.8, 0.06, 0.03, 0.97],
      'the parser reports the shipped numbers even when they are not the shipped numbers');
    assert.notDeepEqual(found[0], found[1],
      'a one-sided change leaves the two fragment shaders disagreeing, and the parser must see it');
    const w = (found[0][3] - found[0][2]) / found[0][1];
    assert.equal(w.toFixed(3), '15.667', `the widened window is ${w}, not ten times 1.5667`);
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
    const prog = body => `void main(){vec3 pos=position;float y=0.;
      if(uMathMode==0){pos.y=(pos.y+y)*uMorphProgress;vH=y*uMorphProgress;}
      else{vH=(uVHField==1)?(pos.y-aBaseY)*uMorphProgress:pos.y*uMorphProgress;pos.y=pos.y*uMorphProgress;}
      ${body}gl_Position=vec4(pos,1.);}`;
    // CONTROL — with nothing in the tail the branch's own write is what is read.
    assert.equal(readProgram(prog(''), 'probe').text.gpuVHStmt, 'vH=y*uMorphProgress;');
    // The regression, appended: it must be what the reader reports for BOTH paths.
    const over = readProgram(prog('vH=pos.y;'), 'probe');
    assert.equal(over.text.gpuVHStmt, 'vH=pos.y;');
    assert.equal(over.text.cpuVHStmt, 'vH=pos.y;');
    // …and wrapped, which is how the anchored filter used to be evaded: the
    // statement is not a form this file has arithmetic for, so it is refused
    // rather than stepped over.
    assert.throws(() => readProgram(prog('if(uMathMode==0)vH=pos.y;'), 'probe'),
      /unrecognised write, refusing to guess/);
  });
});
