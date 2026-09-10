// tests/shader-light-block.test.js
//
// What a custom shader loses, and what it should not.
//
// Three things were declared in the editor's scaffolds and never used, so a
// custom body silently dropped out of the app's own animation model:
//
//   uCM / uCMNext / uCMBlend   declared, never mixed  → a palette change CUT
//                                                       instead of fading
//   uLighting                  not declared at all    → SURF's sun, diffuse,
//                                                       rim and specular gone
//   uMode / uModeNext          declared, never read   → a design boundary, and
//                                                       the only one of the
//                                                       three that is not a bug
//
// The first two are repaired here. The third is not repairable — a custom body
// REPLACES computeMode, so "which of 38" has no meaning while one is live — so
// it is said out loud in #se-ref instead, and this file checks that it is said.
//
// ── Read as programs, not as source text ────────────────────────────────────
// Everything below assembles SE_VS_TEMPLATE / SE_FS_TEMPLATE and reads the
// result. That is the whole point of exporting them: a guard that greps the
// template's own source can be satisfied by a comment, and this subsystem has
// already shipped two tests that were.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let FS_, SE_VS_TEMPLATE, SE_FS_TEMPLATE, SE_PRESETS;
before(async () => {
  ({ FS: FS_, SE_VS_TEMPLATE, SE_FS_TEMPLATE, SE_PRESETS } = await import('../src/shaders.js'));
});

/** The `if (uLighting == 1) { … }` block of a program, braces matched. */
function lightBlock(program) {
  const at = program.indexOf('if (uLighting == 1) {');
  if (at < 0) return null;
  const open = program.indexOf('{', at);
  let d = 0;
  for (let k = open; k < program.length; k++) {
    if (program[k] === '{') d++;
    else if (program[k] === '}') { d--; if (!d) return program.slice(at, k + 1); }
  }
  return null;
}

const editorFS = (body = 'c = vec3(1.0);') => SE_FS_TEMPLATE(body);
const editorVS = (body = 'y = 0.0;')       => SE_VS_TEMPLATE(body);

describe('the SURF lighting model is SHARED, not copied', () => {

  test('both fragment programs carry it, character for character', () => {
    const builtIn = lightBlock(FS_);
    const editor  = lightBlock(editorFS());
    assert.ok(builtIn, 'the built-in fragment program has no lighting block at all');
    assert.ok(editor,  'a custom fragment body still loses SURF lighting');
    assert.equal(editor, builtIn,
      'the two lighting blocks have drifted — which is exactly what copying it would have caused');
  });

  test('and it is a real block, so an empty match cannot pass the test above', () => {
    // The control. Without it, lightBlock() returning '' from both programs
    // would satisfy the equality and report that everything is fine.
    const builtIn = lightBlock(FS_);
    assert.ok(builtIn.split('\n').length > 20, 'the lighting block is suspiciously short');
    for (const term of ['dFdx', 'normalize', 'uGlare', 'uTreble', 'uBass']) {
      assert.ok(builtIn.includes(term), `the lighting block no longer mentions ${term}`);
    }
  });

  test('the editor scaffold declares every name that block reads', () => {
    // An undeclared identifier is a link failure — the whole visualisation goes
    // black — and this is the check that would have caught the omission that
    // started this: uLighting was simply not there.
    const program = editorFS();
    for (const name of ['uLighting', 'uGlare', 'uTime', 'uTreble', 'uBass', 'vWorldPos', 'vViewDir']) {
      assert.match(program, new RegExp(`(uniform|varying)[^;]*\\b${name}\\b`),
        `the editor's fragment scaffold does not declare ${name}`);
    }
  });

  test('it runs after the body and before the material, as it does in the built-in', () => {
    const program = editorFS('c = vec3(0.5);');
    const body = program.indexOf('c = vec3(0.5);');
    const light = program.indexOf('if (uLighting == 1) {');
    const material = program.indexOf('if (uMaterial > 0)');
    assert.ok(body < light, 'the lighting runs before the body has chosen a colour');
    assert.ok(material < 0 || light < material, 'the finish is applied before the light');
  });
});

describe('a palette CHANGE reaches a custom fragment body', () => {

  test('paletteAt mixes the two schemes by the blend the app is tweening', () => {
    const program = editorFS();
    assert.match(program, /vec3\s+paletteAt\s*\(\s*float\s+\w+\s*\)/,
      'the scaffold offers no crossfading palette lookup');
    const at = program.indexOf('vec3 paletteAt');
    const decl = program.slice(at, program.indexOf('\n', at));
    for (const name of ['uCM', 'uCMNext', 'uCMBlend', 'mix']) {
      assert.ok(decl.includes(name), `paletteAt does not use ${name}: ${decl}`);
    }
  });

  test('getColor still means what it always did, so saved shaders keep working', () => {
    // The compatibility half. Every custom fragment body written before this
    // commit calls getColor(uCM, t); it must still compile and still produce
    // the same colour, cut and all. The fade is opt-in by rewriting one call.
    const program = editorFS('c = getColor(uCM, t);');
    assert.match(program, /vec3\s+getColor\s*\(/, 'getColor is gone from the scaffold');
    assert.ok(program.includes('c = getColor(uCM, t);'), 'the body was rewritten under the user');
  });

  test('the shipped default and the knob example use the fading one', () => {
    const src = read('src/shaders.js');
    const def = src.match(/SE_DEFAULT_FRAG\s*=\s*`([\s\S]*?)`/)[1];
    const code = def.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.match(code, /paletteAt\(/, 'the default fragment body still cuts on a palette change');
    const tint = SE_PRESETS.find(p => p.id === 'knobs-frag');
    assert.match(tint.code, /paletteAt\(/, 'the knob colour example still cuts');
  });
});

describe('the boundary that is not a bug is stated where it applies', () => {

  test('uMode is still declared and still unread — this is the design, not an oversight', () => {
    // Pinned deliberately. A custom vertex body REPLACES computeMode, so there
    // is no meaning to give the 38 numbered entries while one is live; the
    // honest fix is to say so, not to invent a blend. If a future change makes
    // uMode live, this test should fail and the #se-ref line below should go.
    const program = editorVS();
    assert.match(program, /uniform int uMode/, 'uMode is no longer declared');
    const main = program.slice(program.indexOf('void main()'));
    assert.doesNotMatch(main, /\buMode\b/,
      'the vertex scaffold now reads uMode — if that is deliberate, the #se-ref line ' +
      'saying SHADER MODE does nothing is now false and must be removed');
  });

  test('and the editor says so, in the editor', () => {
    const strip = read('index.html').match(/<div id="se-ref">([\s\S]*?)<\/div>/)[1];
    assert.match(strip, /SHADER MODE/,
      '#se-ref does not warn that the numbered modes are inert under a custom vertex body');
    assert.match(strip, /paletteAt/, '#se-ref does not mention the crossfading palette lookup');
  });
});
