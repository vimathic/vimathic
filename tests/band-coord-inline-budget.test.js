// tests/band-coord-inline-budget.test.js
//
// How many copies of the 38-branch ladder the uber vertex program compiles.
//
// ── Why this is a test and not a comment ────────────────────────────────────
// A GLSL compiler inlines: there are no function calls in the machine code it
// produces, so every CALL SITE of computeMode is a separate copy of all 38
// branches in the program it links. Nothing in the language makes that visible,
// nothing in the build reports it, and no runtime guard removes it — an
// `if (uModeBlend > 0.)` around a call still costs the copy, because the text
// is compiled either way.
//
// It has already gone wrong once and nothing turned red: the band layer arrived
// with eight taps inside a coordinate that is evaluated twice, which took the
// program from 2 live copies to 18 in a single commit (80c3e75, #64). What that
// costs is driven by the count but is NOT proportional to it, and the two
// toolchains measured so far bend in opposite directions (numbers in
// src/shaders.js beside the stencil): through SwiftShader here, 4.5x the copies
// bought 2.2x–3.5x the compile time — 4433 ms of mean against 1605 — which is
// sublinear, while this device's own driver reads all three variants as noise;
// on the Windows toolchain the complaint came from, 18 copies took 28.7 s to
// load and both 4 copies and 2 copies were indistinguishable from instant,
// which is steeply superlinear. Direction known, shape unknown, and the knee
// between 4 and 18 copies unmeasured on the platform that hurts.
//
// ── What is pinned, and what deliberately is not ────────────────────────────
// Not the shape of the stencil: how many taps the estimator wants is a question
// about the layout, and this test has no opinion on it. What is pinned is the
// number of LIVE COPIES the program ends up with, which is the thing that costs
// compile time and the thing that is invisible in review:
//
//     live = (computeMode call sites in bandCoordOfMode) x (bandCoordOfMode
//             call sites reached from main) + (computeMode call sites in main)
//
// Eight taps can cost eight copies or one, depending only on whether they are
// spelled out or gathered through a loop. So take as many taps as the layout
// needs — and keep them behind one call site.
//
// ── The control arms ────────────────────────────────────────────────────────
// A counter that always reports a small number is not a guard, so the same
// counter is shown reacting, on the real program text, to each of the three
// things it claims to measure: a call site added inside the coordinate, one
// added to main, and — the distinction that makes this "live" rather than
// textual — one added to a function nobody calls, which must NOT count.
//
// Run:
//   node --test tests/band-coord-inline-budget.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './helpers/glsl.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHADER_SRC = readFileSync(path.join(ROOT, 'src/shaders.js'), 'utf8');

/**
 * The budget. 4 rather than "fewer than it was" because the cost is not linear:
 * of the three shapes that have been put in front of a browser on the reported
 * toolchain, 2 copies and 4 copies were both indistinguishable from instant and
 * 18 was tens of seconds. Where between 4 and 18 it turns is not known, so the
 * ceiling sits on the measured point rather than on a guess between two.
 */
const BUDGET = 4;

/** The body of `float name(…){ … }`, braces matched, comments already blank. */
function bodyOf(program, name) {
  const at = program.search(new RegExp(`\\bfloat\\s+${name}\\s*\\(`));
  assert.notEqual(at, -1, `${name} is not declared in the vertex program`);
  const open = program.indexOf('{', at);
  let d = 0;
  for (let i = open; i < program.length; i++) {
    if (program[i] === '{') d++;
    else if (program[i] === '}') { d--; if (d === 0) return program.slice(open + 1, i); }
  }
  throw new Error(`${name} has unbalanced braces`);
}

/**
 * Call sites of `name` inside a body. Inside a body there are no declarations,
 * so every `name(` is a call — and the bodies handed here have had their
 * comments blanked by templateLiteral, so prose about a call is not a call.
 */
const callSites = (body, name) => (body.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) || []).length;

function liveCopies(program) {
  const coord = callSites(bodyOf(program, 'bandCoordOfMode'), 'computeMode');
  const main = G.mainBody(program);
  const coordCalls = callSites(bodyOf(program, 'bandTermOfMode'), 'bandCoordOfMode');
  // A call site inside bandTermOfMode only costs anything if main() reaches it.
  const termCalls = callSites(main, 'bandTermOfMode');
  const mainDirect = callSites(main, 'computeMode');
  return {
    coord, coordCalls, termCalls, mainDirect,
    live: (termCalls > 0 ? coord * coordCalls : 0) + mainDirect,
  };
}

/** Splice a statement into a function body without disturbing anything else. */
function inject(program, fnName, stmt, times = 1) {
  const at = program.search(new RegExp(`\\bfloat\\s+${fnName}\\s*\\(`));
  const open = program.indexOf('{', at);
  return program.slice(0, open + 1) + '\n' + stmt.repeat(times) + program.slice(open + 1);
}

const TAP = '  float vDecoy = computeMode(mode, xz, .5,.5,.5, 0., a, wi, BAND_T);\n';

describe('the ladder is inlined once per call site, and the program pays for every copy', () => {
  const VS = G.templateLiteral(SHADER_SRC, 'VS');

  test(`the loaded vertex program compiles at most ${BUDGET} copies of computeMode`, () => {
    const n = liveCopies(VS);
    assert.ok(n.live <= BUDGET,
      `the vertex program inlines the 38-branch ladder ${n.live} times, budget ${BUDGET}: ` +
      `${n.coord} call site(s) inside bandCoordOfMode x ${n.coordCalls} coordinate(s) in ` +
      `bandTermOfMode, plus ${n.mainDirect} direct call(s) in main(). Compile time is driven ` +
      `by this number but is not proportional to it: on the toolchain this budget comes from, ` +
      `18 copies loaded in 28.7 s while 4 and 2 were both instant, and where between 4 and 18 ` +
      `it turns is unmeasured — take the taps the layout needs, but gather them behind one ` +
      `call site.`);
  });

  test('every part of the count is a real call site, not a spelling', () => {
    const n = liveCopies(VS);
    assert.ok(n.coord >= 1, 'bandCoordOfMode no longer evaluates the formula at all');
    assert.ok(n.coordCalls >= 1, 'bandTermOfMode no longer asks for a coordinate');
    assert.equal(n.termCalls, 1, 'main() no longer reaches bandTermOfMode exactly once');
    assert.equal(n.mainDirect, 2,
      'main() evaluates the mode other than twice (uMode and uModeNext) — the arithmetic ' +
      'of this budget assumes those two');
  });

  // ── control arms: the same counter, shown reacting ────────────────────────

  test('CONTROL: a tap added inside the coordinate costs one copy per coordinate', () => {
    const base = liveCopies(VS);
    const one = liveCopies(inject(VS, 'bandCoordOfMode', TAP));
    assert.equal(one.live, base.live + base.coordCalls,
      'adding one call site inside bandCoordOfMode did not move the count by the number of ' +
      'coordinates that call it — the counter is not measuring what it claims to');
    const seven = liveCopies(inject(VS, 'bandCoordOfMode', TAP, 7));
    assert.equal(seven.live, base.live + 7 * base.coordCalls);
    // The shape this branch started from: eight taps spelled out, two
    // coordinates, two direct calls in main. It has to come out over budget,
    // or the budget above is not holding anything up.
    const spelledOut = liveCopies(inject(VS, 'bandCoordOfMode', TAP, 8 - base.coord));
    assert.equal(spelledOut.live, 18);
    assert.ok(spelledOut.live > BUDGET);
  });

  test('CONTROL: a call added to main costs exactly one copy', () => {
    const base = liveCopies(VS);
    const mainAt = VS.search(/void\s+main\s*\(\s*\)\s*\{/);
    const open = VS.indexOf('{', mainAt);
    const mutated = VS.slice(0, open + 1) +
      '\n  float yDecoy = computeMode(uMode, position.xz, .5,.5,.5, 0., 1., 1., 7.0);\n' +
      VS.slice(open + 1);
    assert.equal(liveCopies(mutated).live, base.live + 1);
  });

  test('CONTROL: a call in code nobody reaches costs nothing — this counts copies, not text', () => {
    const base = liveCopies(VS);
    const dead = 'float deadWeight(int mode, vec2 xz, float a, float wi){\n' + TAP +
                 '  return vDecoy;\n}\n';
    const mainAt = VS.search(/void\s+main\s*\(\s*\)\s*\{/);
    const mutated = VS.slice(0, mainAt) + dead + VS.slice(mainAt);
    assert.equal(liveCopies(mutated).live, base.live,
      'an uncalled function changed the copy count — a textual grep would say it did, and ' +
      'that is exactly the difference this counter exists to keep');
    assert.ok(callSites(mutated, 'computeMode') > callSites(VS, 'computeMode'),
      'the mutation did not actually add any text, so this control proves nothing');
  });
});
