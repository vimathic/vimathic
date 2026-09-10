// tests/shader-editor-guidance.test.js
//
// Two things the shader editor knew and did not say.
//
// ── 1. "Compiled" and "will be visible" are different facts ─────────────────
// The vertex scaffold discards the body's `y` whenever a CPU formula is active:
// the `else` branch of the `if(uMathMode==0)` line writes
// `pos.y = pos.y * uMorphProgress` and never reads `y`. APPLY reported the
// compile and nothing else, so an operator who wrote a displacement got a green
// "✔ Compiled & applied" and an unchanged screen, and the only reasonable
// conclusion available to them was that their code was wrong.
//
// It is not an edge case. The app boots into a CPU formula (main.js activates
// one on the first frame) and roughly 192 of the ~230 entries in SHADER MODE
// keep it there, so this is the ordinary first experience of the editor.
// documents/shader-editor.md has described the trap in prose since round 4 —
// describing it is not the same as saying it at the moment it happens.
//
// ── 2. The 24-band spectrum was reachable and unmentioned ──────────────────
// BAND_GLSL puts uBands[24], bandAtU() and bandAtRadius() in scope in any
// custom vertex body. Before this change, grepping index.html, README.md and
// all fourteen documents/*.md for those names returned zero hits: the most
// capable thing the editor can do was reachable only by reading src/.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = rel => read(rel).split('\n')
  .filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
  .join('\n');

let bodyAssignsY, BAND_GLSL, PARAMS;
before(async () => {
  ({ bodyAssignsY, BAND_GLSL } = await import('../src/shaders.js'));
  ({ PARAMS } = await import('../src/params.js'));
});

describe('bodyAssignsY — which bodies are about to be discarded', () => {

  test('a plain assignment counts', () => {
    for (const body of [
      'y = sin(r * 8.0 + T);',
      '  y=sin(r);',
      'float k = 2.0;\ny = k * b;',
      'y += turb(pos.xz) * 0.3;',
      'y *= a;',
      'if (r < 1.0) { y = 0.5; }',
    ]) {
      assert.equal(bodyAssignsY(body), true, `missed an assignment in: ${JSON.stringify(body)}`);
    }
  });

  test('a write to pos does NOT count — it survives in both modes', () => {
    // This is the whole reason the check is not simply /y\s*=/. The tail of the
    // template scales pos.y by uMorphProgress on both branches, so a body that
    // moves pos is unaffected by the discard and warning about it would be a
    // false alarm on a correct action.
    for (const body of [
      'pos.y = sin(r * 4.0);',
      'pos.y += b * 0.5;',
      'pos.xz *= 1.1;',
    ]) {
      assert.equal(bodyAssignsY(body), false, `false alarm on: ${JSON.stringify(body)}`);
    }
  });

  test('a comparison is not an assignment', () => {
    assert.equal(bodyAssignsY('if (y == 0.0) pos.x += 1.0;'), false);
    assert.equal(bodyAssignsY('float d = y >= 0.0 ? 1.0 : 0.0; pos.y = d;'), false);
  });

  test('another variable whose name starts with y is not y', () => {
    assert.equal(bodyAssignsY('float y2 = 4.0; pos.y = y2;'), false);
    assert.equal(bodyAssignsY('float yaw = ang; pos.y = yaw;'), false);
  });

  test('an assignment mentioned in a comment does not count', () => {
    assert.equal(bodyAssignsY('// y = sin(r); is what you would normally write\npos.x += 0.1;'), false);
    assert.equal(bodyAssignsY('/* y = 1.0; */ pos.z += 0.1;'), false);
  });

  test('a comment does not hide a real assignment on another line', () => {
    assert.equal(bodyAssignsY('// nothing to see\ny = 1.0;'), true);
  });

  test('empty and rubbish input are answered, not thrown on', () => {
    for (const v of ['', null, undefined, 0, {}]) {
      assert.equal(bodyAssignsY(v), false, `threw or answered true on ${String(v)}`);
    }
  });

  test('the shipped default vertex body assigns y — so the warning has a subject', () => {
    // If the default ever stops writing y, the whole warning path goes quiet
    // and this file would keep passing while testing nothing.
    const src = read('src/shaders.js');
    const m = src.match(/SE_DEFAULT_VERT\s*=\s*`([\s\S]*?)`/);
    assert.ok(m, 'SE_DEFAULT_VERT is no longer a template literal — re-read this test');
    assert.equal(bodyAssignsY(m[1]), true, 'the editor default no longer writes y');
  });
});

describe('APPLY says when a valid shader will do nothing', () => {

  const src = code('src/shaders.js');

  test('the discard the warning is about still exists', () => {
    // The warning is only honest while the template really does drop `y` in CPU
    // mode. If that branch changes, this file should fail before the message
    // starts lying.
    assert.match(src, /uMathMode\s*==\s*0/,
      'the template no longer branches on uMathMode');
    const branch = src.match(/if\(uMathMode==0\)\{[\s\S]{0,600}?\}else\{([\s\S]{0,400}?)\}/);
    assert.ok(branch, 'the uMathMode branch is no longer in the shape this test reads');
    assert.doesNotMatch(branch[1], /(^|[^\w.])y(?![\w])/,
      'the CPU branch now reads `y`, so a custom displacement may no longer be discarded — ' +
      'if that is deliberate, the APPLY warning and documents/shader-editor.md are both stale');
  });

  test('success reads the mode before it reports', () => {
    assert.match(src, /uMathMode\?\.value\s*!==\s*0/,
      'compileAndApply no longer checks whether the displacement will be discarded');
    assert.match(src, /bodyAssignsY\(vertBody\)/,
      'the warning is no longer gated on the body actually writing y');
    // FIX(r6): this assertion is the one that was missing, and its absence is
    // why the paragraph above shipped describing behaviour the code did not
    // have. `bodyAssignsY(vertBody)` alone is true whichever tab is on screen,
    // because the vertex buffer holds SE_DEFAULT_VERT and that assigns y — so
    // every APPLY made while colouring got the geometry warning. The BEHAVIOUR
    // is pinned in tests/shader-editor-status.test.js; this stays as the
    // source-level tripwire beside its own paragraph.
    assert.match(src, /this\._tab === 'vert' && bodyAssignsY\(vertBody\)/,
      'the warning is no longer gated on the visible tab, so a fragment-only edit ' +
      'will be nagged about the vertex half');
  });

  test('the message names the mode and the way out of it', () => {
    assert.match(src, /CPU formula is active/, 'the warning does not say what is wrong');
    assert.match(src, /SHADER MODE/, 'the warning does not say where to fix it');
    assert.match(src, /1–38|1-38/, 'the warning does not say which entries are GPU shaders');
  });

  test('it reports as a warning, not as an error and not as plain success', () => {
    assert.match(src, /level:\s*wasted\s*\?\s*'warn'\s*:\s*'ok'/,
      'the compile result no longer distinguishes "compiled but invisible"');
    assert.match(src, /ok:\s*true,\s*level:/,
      'a warning must still report ok:true — the GLSL did compile');
  });

  test('the warning stays on screen longer than the tick', () => {
    assert.match(src, /wasted\s*\?\s*10000\s*:\s*2000/,
      'the warning is cleared on the 2 s success timer, which is not long enough to read it');
  });

  test('the editor paints by level, so the warning is not green', () => {
    const modals = code('src/ui/modals.js');
    assert.match(modals, /const kind = level \?\? \(ok \? 'ok' : 'error'\)/,
      'modals.js still paints the status line from the boolean alone');
    assert.match(modals, /kind === 'warn'/, 'there is no warn colour');
    assert.doesNotMatch(modals, /onCompileResult = \(\{ ok, message, line \}\)/,
      'the callback signature no longer receives level');
  });
});

describe('the 24-band spectrum is documented where it is usable', () => {

  const strip = read('index.html').match(/<div id="se-ref">([\s\S]*?)<\/div>/)[1];
  const doc   = read('documents/shader-editor.md');

  test('the editor reference strip names the band API', () => {
    for (const name of ['bandAtRadius', 'bandAtU', 'uBands']) {
      assert.ok(strip.includes(name),
        `#se-ref does not mention ${name}, which is in scope in every custom vertex body`);
    }
  });

  test('the document names it too', () => {
    for (const name of ['bandAtRadius', 'bandAtU', 'uBands', 'uBandR']) {
      assert.ok(doc.includes(name), `shader-editor.md does not mention ${name}`);
    }
  });

  test('every name they advertise actually exists in the scaffold', () => {
    // The point of the guard: a rename in BAND_GLSL must break the docs, not
    // leave them advertising a function nobody can call.
    for (const name of ['bandAtRadius', 'bandAtU', 'uBands', 'uBandR', 'uBandDepth']) {
      assert.ok(BAND_GLSL.includes(name),
        `the docs advertise ${name}, which BAND_GLSL no longer defines`);
    }
  });

  test('BAND_GLSL really is in the vertex scaffold and not the fragment one', () => {
    // Both documents call the band API "vertex only". That claim is only true
    // while the interpolation sites are what they are.
    const src = read('src/shaders.js');
    const vsTemplate = src.slice(src.indexOf('const SE_VS_TEMPLATE'), src.indexOf('const SE_FS_TEMPLATE'));
    const fsTemplate = src.slice(src.indexOf('const SE_FS_TEMPLATE'));
    assert.match(vsTemplate, /\$\{BAND_GLSL\}/, 'the vertex scaffold no longer includes BAND_GLSL');
    assert.doesNotMatch(fsTemplate, /\$\{BAND_GLSL\}/,
      'the fragment scaffold now includes BAND_GLSL — both documents say it is vertex-only');
    for (const rel of ['index.html', 'documents/shader-editor.md']) {
      assert.match(read(rel), /vertex[- ]only|Vertex only|vertex only/i,
        `${rel} advertises the band API without saying it is vertex-only`);
    }
  });

  test('the double-counting warning is still true', () => {
    // Both documents tell the reader that Spectrum Rings already adds a band
    // term, so calling bandAtRadius by hand doubles it. That holds only while
    // the scaffold adds one itself.
    const src = read('src/shaders.js');
    assert.match(src, /uBandDepth>0\.\?y\+bandAtRadius\(length\(pos\.xz\)\)\*uBandDepth:y/,
      'the scaffold no longer adds its own band term, so the doubling caveat in ' +
      'index.html and shader-editor.md is now wrong');
  });

  test("and so is the claim that the slider's default is not zero", () => {
    // shader-editor.md states the default is 0.30, not 0 — which is why the
    // doubling is what a reader meets rather than something they opt into.
    assert.equal(PARAMS.bandDepth.label, 'Spectrum Rings',
      'the slider named in both documents has been renamed');
    assert.ok(PARAMS.bandDepth.default > 0,
      'Spectrum Rings now defaults to 0, so the documents overstate the doubling risk');
    assert.match(doc, new RegExp(PARAMS.bandDepth.default.toFixed(2)),
      `shader-editor.md states a default that is no longer ${PARAMS.bandDepth.default.toFixed(2)}`);
  });

  test('the examples it gives use only names that are in scope', () => {
    // A doc example that does not compile is worse than no example. Every
    // identifier in the fenced GLSL under the spectrum section must be either a
    // scaffold local, a band name, or GLSL itself.
    // To the next TOP-level heading, not to a named one: the first version of
    // this ran to "## Eight starter presets" and swept up the fragment tab's
    // examples on the way, which use getColor and uCM and have nothing to do
    // with the spectrum.
    const from = doc.indexOf('### The 24-band spectrum');
    assert.notEqual(from, -1, 'the spectrum section has been renamed or removed');
    const rest = doc.slice(from);
    const to = rest.indexOf('\n## ');
    const section = to < 0 ? rest : rest.slice(0, to);
    const examples = [...section.matchAll(/```glsl\n([\s\S]*?)```/g)].map(m => m[1]);
    assert.ok(examples.length >= 3, `expected the spectrum section to carry examples, found ${examples.length}`);

    const SCAFFOLD = new Set(['y', 'r', 'ang', 'pos', 'b', 't', 'm', 'bt', 'a', 'wi', 'T', 'position']);
    const GLSL = new Set(['sin', 'cos', 'tan', 'exp', 'pow', 'abs', 'length', 'atan', 'clamp', 'mix',
                          'float', 'vec2', 'vec3', 'int', 'if', 'else', 'return']);
    for (const ex of examples) {
      for (const m of ex.matchAll(/(^|[^\w.])([A-Za-z_]\w*)/g)) {
        const id = m[2];
        if (SCAFFOLD.has(id) || GLSL.has(id)) continue;
        assert.ok(BAND_GLSL.includes(id),
          `the spectrum example uses "${id}", which is neither a scaffold local nor in BAND_GLSL:\n${ex}`);
      }
    }
  });
});
