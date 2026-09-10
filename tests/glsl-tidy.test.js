// tests/glsl-tidy.test.js
//
// The TIDY button rewrites what the operator wrote; it never invents.
//
// GLSL is stricter than the notation people think in, and documents/
// shader-editor.md's own "common errors" section names the wrong-operand type
// error, which is nearly always a bare integer. TIDY closes three such gaps —
// `r * 8` → `r * 8.0`, `r^2` → `pow(r, 2.0)`, and the spelled-out audio names —
// and closes nothing else.
//
// ── Why the result goes back into the textarea ──────────────────────────────
// Because that keeps the buffer the operator is reading and the buffer that
// compiles the same string. A generator emitting into a hidden pipeline would
// break ShaderEditor._parseErrorLine, which locates the body inside the
// driver's source with `fullShader.indexOf(userBody)` — generated text is not
// the user's text, so that returns -1 and every compile error silently loses
// its line number. It would also add a second thing to persist, in a subsystem
// whose consistency mechanisms are all hand-enumerated.
//
// ── What these tests are mostly about ──────────────────────────────────────
// Not the rewrites. The refusals. A tidy that misses something costs a
// keystroke; a tidy that turns `uBands[3]` into `uBands[3.0]`, or a loop
// counter into a float, produces code that does not compile — or worse, code
// that does and means something else. Every "left alone" case below is a way
// this could have been actively harmful.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * The VALUE of a template literal lifted out of source text.
 *
 * Reading `code: \`…\`` out of shaders.js gives the SOURCE of the literal, in
 * which `\n` is a backslash followed by an n. That matters here and not
 * academically: the shipped Ramanujan preset contains `\nfor(int n=-6;…)`, and
 * against the unescaped text there is no word boundary before `for`, so the
 * for-header protection did not fire and the test reported a rewrite the app
 * would never make.
 */
const literalValue = raw => raw
  .replace(/\\n/g, '\n')
  .replace(/\\t/g, '\t')
  .replace(/\\`/g, '`')
  .replace(/\\\\/g, '\\');

let tidyGlsl, describeTidy, ALIASES, floatifyIntegers, expandCarets, applyAliases;
before(async () => {
  ({ tidyGlsl, describeTidy, ALIASES, floatifyIntegers, expandCarets, applyAliases } =
    await import('../src/glsl-tidy.js'));
});

const tidy = (src, tab = 'vert') => tidyGlsl(src, tab).text;

describe('integers become floats, because GLSL ES 1.00 will not do it for you', () => {

  test('an integer used as an arithmetic operand', () => {
    assert.equal(tidy('y = sin(r*8 + T);'), 'y = sin(r*8.0 + T);');
    assert.equal(tidy('y = 2 * r;'), 'y = 2.0 * r;');
    assert.equal(tidy('y = r / 3;'), 'y = r / 3.0;');
  });

  test('numbers that are already floats are untouched', () => {
    for (const src of ['y = r * 8.0;', 'y = r * .5;', 'y = r * 8.;', 'y = 1e3 * r;', 'y = 1.5e-3 * r;']) {
      assert.equal(tidy(src), src, `rewrote an existing float in: ${src}`);
    }
  });

  test('an exponent keeps its integer digits', () => {
    assert.equal(tidy('y = 1e-3 * 4;'), 'y = 1e-3 * 4.0;',
      'the exponent digits were floated, which is a syntax error');
  });

  test('digits inside an identifier are not numbers', () => {
    for (const src of ['y = vec3(1.0).x;', 'float x2 = r; y = x2;', 'y = uBands[0] * uBandR;']) {
      assert.doesNotMatch(tidy(src), /vec3\.0|x2\.0|uBands\.0/, `mangled an identifier in: ${src}`);
    }
  });
});

describe('and the integers that must stay integers are left alone', () => {

  test('an array subscript', () => {
    // uBands[3.0] does not compile. This is the one that would have shipped a
    // broken tidy for the exact API the docs have just started advertising.
    assert.equal(tidy('y = uBands[3] * 2;'), 'y = uBands[3] * 2.0;');
    assert.equal(tidy('y = uBandPan[12];'), 'y = uBandPan[12];');
  });

  test('a nested subscript', () => {
    assert.match(tidy('y = uBands[int(k[1])] * 2;'), /uBands\[int\(k\[1\]\)\]/);
  });

  test('a for-loop header, counter and bound', () => {
    // The header carries two semicolons of its own, so a rule that split
    // statements on `;` would leave `i < 5` in a segment with no `int` in it.
    assert.equal(
      tidy('for (int i = 0; i < 5; i++) { y += 1; }'),
      'for (int i = 0; i < 5; i++) { y += 1.0; }');
  });

  test('any statement that mentions int', () => {
    assert.equal(tidy('int n = 3;'), 'int n = 3;');
    assert.equal(tidy('int n = 3;\ny = float(n) * 2;'), 'int n = 3;\ny = float(n) * 2.0;',
      'the int statement was protected but its neighbour was not tidied');
  });

  test('an int variable used on a line that names no type', () => {
    // The statement rule reads the segment it is in, and `n = n + 2;` mentions
    // no type at all — so the 2 was floated and the addition stopped compiling.
    // Checked per literal now, against the operand actually beside it.
    assert.equal(tidy('int n = 3;\nn = n + 2;'), 'int n = 3;\nn = n + 2;');
    assert.equal(tidy('int n = 3;\nn = 2 + n;'), 'int n = 3;\nn = 2 + n;');
    assert.equal(tidy('int n = 3;\nn = 2;'), 'int n = 3;\nn = 2;');
    // …and the same body's genuinely-float arithmetic is still tidied. This is
    // the pair that rules out protecting the whole statement instead.
    assert.equal(tidy('int n = 3;\ny = float(n) * 2;'), 'int n = 3;\ny = float(n) * 2.0;');
  });

  test('an integer vector constructor', () => {
    // `ivec2` does not contain the word `int`, so the statement rule never saw
    // it and `ivec2(1, 2)` became `ivec2(1.0, 2.0)` — a hard type error.
    assert.equal(tidy('ivec2 q = ivec2(1, 2);'), 'ivec2 q = ivec2(1, 2);');
    assert.equal(tidy('y = float(ivec3(1, 2, 3).x);'), 'y = float(ivec3(1, 2, 3).x);');
  });

  test('a preprocessor directive', () => {
    // Not a statement, so the `;` split never reached it: `#define N 4` became
    // `#define N 4.0`, and every array size and loop bound spelled with N broke.
    assert.equal(tidy('#define N 4\ny = r * 2;'), '#define N 4\ny = r * 2.0;');
    assert.equal(tidy('  #define K 8'), '  #define K 8');
  });

  test('a comment above a declaration does not hide the declaration', () => {
    // Found by an adversarial review of the fix itself. scan() re-derived which
    // protected ranges were comments by testing their TEXT — and a statement
    // range runs from the previous `;`, so a declaration with a comment on the
    // line above started with `//` and matched. The whole statement was blanked
    // out of the name view, every protection below went blind, and TIDY handed
    // back `int + float`. Delete the comment and the same body was handled
    // correctly, which is what a guessing classifier looks like from outside.
    assert.equal(tidy('// how many ripples\nint rings = 3;\nrings = rings + 2;'),
                 '// how many ripples\nint rings = 3;\nrings = rings + 2;');
    assert.equal(tidy('/* ripples */\nint n = 3;\nn = n + 2;'),
                 '/* ripples */\nint n = 3;\nn = n + 2;');
    assert.equal(tidy('#define K 4\nint n = 3;\nn = n + 2;'),
                 '#define K 4\nint n = 3;\nn = n + 2;');
    assert.equal(tidy('y = 0.0;\n// counter\nint n = 3;\nn = n + 2;'),
                 'y = 0.0;\n// counter\nint n = 3;\nn = n + 2;');
    // The same blanking also blinded declaredNames, and that half was SILENT:
    // the declaration survived and only the USE was rebound to the scaffold.
    assert.equal(tidy('// step count\nint time = 3;\ny = float(time)*0.1;'),
                 '// step count\nint time = 3;\ny = float(time)*0.1;');
  });

  test('a declarator list with initialisers registers every name in it', () => {
    // The comma-continuation in the old regex only matched an UNINITIALISED
    // list, so the second declarator here was not registered as a name the body
    // owns and TIDY rewrote it — declaration and all — onto the scaffold's T.
    assert.equal(tidy('float base = 0.2, time = T * 0.5;\ny = sin(r * 8. + time) * base;'),
                 'float base = 0.2, time = T * 0.5;\ny = sin(r * 8. + time) * base;');
    assert.equal(tidy('int a = 1, n = 2;\nn = n + 2;'), 'int a = 1, n = 2;\nn = n + 2;');
    // …and a comma INSIDE an initialiser is not a declarator boundary.
    assert.equal(tidy('vec3 p = vec3(1.0, 2.0, 3.0), q = p;\ny = q.x;'),
                 'vec3 p = vec3(1.0, 2.0, 3.0), q = p;\ny = q.x;');
  });

  test('a preprocessor directive continued with a backslash', () => {
    assert.equal(tidy('#define SIZE \\\n  4\ny = r * 2;'), '#define SIZE \\\n  4\ny = r * 2.0;');
  });

  test('a for-counter does not protect the whole loop body', () => {
    // The counter is declared inside a header that is already protected as a
    // range; registering it as an int name too would protect `y += 1;` here,
    // which is a float and has to be floated.
    assert.equal(tidy('for (int i = 0; i < 5; i++) { y += float(i) * 2; }'),
                 'for (int i = 0; i < 5; i++) { y += float(i) * 2.0; }');
  });

  test('anything inside a comment', () => {
    assert.equal(tidy('// y = 8 is the usual shape\ny = r * 4;'),
                 '// y = 8 is the usual shape\ny = r * 4.0;');
    assert.equal(tidy('/* y = 8; */ y = r * 4;'), '/* y = 8; */ y = r * 4.0;');
  });

  test('a comment does not protect the code after it', () => {
    assert.equal(tidy('// note\ny = 2;'), '// note\ny = 2.0;');
    assert.equal(tidy('/* a */ y = 2; /* b */'), '/* a */ y = 2.0; /* b */');
  });
});

describe('^ becomes pow, and only where that is unambiguous', () => {

  test('the shapes people actually write', () => {
    // INVERTED in round 6. These four assertions used to pin the UNGUARDED
    // output — `pow(sin(r), 2.0)` — and pinning it is what let it ship. GLSL
    // leaves pow(x, y) undefined for x < 0; on ANGLE/D3D11 that is a NaN, and
    // sin is negative half the time, so TIDY's headline example generated the
    // exact black-rectangle class that cost this branch four commits. The app's
    // own GPU formula writes `pow(abs(sin(...)),2.)` — src/shaders.js — and TIDY
    // now agrees with it. Even exponents only, where |x|^n IS x^n.
    assert.equal(tidy('y = r^2;'), 'y = pow(abs(r), 2.0);');
    assert.equal(tidy('y = (r + 1.0)^2;'), 'y = pow(abs((r + 1.0)), 2.0);');
    assert.equal(tidy('y = sin(r)^2 + cos(r)^2;'),
                 'y = pow(abs(sin(r)), 2.0) + pow(abs(cos(r)), 2.0);');
    assert.equal(tidy('y = pos.x^2;'), 'y = pow(abs(pos.x), 2.0);');
  });

  test('the guard goes on only where it cannot change the answer', () => {
    // Odd exponent: abs() would flip a sign, so the caret expands bare and the
    // operator keeps what they wrote.
    assert.equal(tidy('y = r^3;'), 'y = pow(r, 3.0);');
    // Fractional exponent: a negative base has no real answer to preserve.
    assert.equal(tidy('y = r^.5;'), 'y = pow(r, .5);');
    // Already non-negative by construction — no point wrapping it twice.
    assert.equal(tidy('y = abs(r)^2;'), 'y = pow(abs(r), 2.0);');
    assert.equal(tidy('y = length(pos.xz)^2;'), 'y = pow(length(pos.xz), 2.0);');
    assert.equal(tidy('y = 2^2;'), 'y = pow(2.0, 2.0);');
    // …but a call that merely STARTS with abs( is not an abs() call.
    assert.equal(tidy('y = (abs(r)*x)^2;'), 'y = pow(abs((abs(r)*x)), 2.0);');
  });

  test('a float literal keeps the dot that belongs to it', () => {
    // Both of these shipped broken. The walk over a `.` only stepped across it
    // when a word character sat on BOTH sides — the member-access rule — so a
    // leading- or trailing-dot float lost its dot to the outside of the call.
    // `.pow(5.0, 2.0)` and `pow(x, 2.0).` are not GLSL; neither compiles, and
    // nothing in the suite saw it because nothing compiles what TIDY emits.
    assert.equal(tidy('y = .5^2;'), 'y = pow(.5, 2.0);');
    assert.equal(tidy('y = x^2.;'), 'y = pow(abs(x), 2.);');
    assert.doesNotMatch(tidy('y = .5^2;'), /\.pow\(/, 'the leading dot was left outside the call');
    assert.doesNotMatch(tidy('y = x^2.;'), /\)\./, 'the trailing dot was left outside the call');
  });

  test('it nests to the right, the way maths reads it', () => {
    assert.equal(tidy('y = 2^3^2;'), 'y = pow(2.0, pow(3.0, 2.0));',
      '2^3^2 must be 2^(3^2), not (2^3)^2');
  });

  test('a caret with nothing usable beside it is left exactly as written', () => {
    // The sentinel used internally to step past such a caret must not leak,
    // and the text must come back byte for byte.
    for (const src of ['y = a^;', 'y = ^2;', 'y = a ^ ;']) {
      const out = tidy(src);
      // The caret has to come back and must never be guessed at. The float pass
      // may still tidy a number alongside it — that is a different rule doing
      // its own job — so this checks the caret, not the whole line.
      assert.equal((out.match(/\^/g) ?? []).length, (src.match(/\^/g) ?? []).length,
        `an ambiguous caret was consumed in: ${src} -> ${out}`);
      assert.doesNotMatch(out, /pow\(/, `guessed at an ambiguous caret in: ${src} -> ${out}`);
      assert.doesNotMatch(out, /\u0000/, 'the internal sentinel leaked into the source');
    }
  });

  test('an operand may not reach into a comment', () => {
    // The term finders consult no protected ranges, so the left walk skipped a
    // newline as ordinary whitespace and took a word out of a `//` comment.
    // Once the operands were trimmed, `pow(` was spliced INSIDE the comment and
    // swallowed the rest of the statement — the semicolon with it.
    const src = 'y = sin(r*8. + T) // the ripple\n  ^2 * a;';
    const out = tidy(src);
    assert.doesNotMatch(out, /pow\(/, 'an operand was taken from inside a comment');
    assert.ok(out.includes('// the ripple\n'), 'the comment lost its newline and ate the code after it');
    assert.ok(out.trimEnd().endsWith(';'), 'the statement lost its semicolon');
  });

  test('a member of a call result keeps the call', () => {
    // The member walk stepped over a `.` only when a word sat on BOTH sides, so
    // the rewrite was spliced after the dot: `.pow(abs(x), 2.0)` is not GLSL.
    // Which side of the dot mattered depended on whether a `)` preceded it —
    // `pos.x^2` was right and `vec2(r,r).x^2` was not.
    assert.equal(tidy('y = normalize(pos).x^2;'), 'y = pow(abs(normalize(pos).x), 2.0);');
    assert.equal(tidy('y = vec2(r,r).x^2;'), 'y = pow(abs(vec2(r,r).x), 2.0);');
    // The mirror image on the right-hand side.
    assert.equal(tidy('y = x^normalize(pos).y;'), 'y = pow(x, normalize(pos).y);');
    // The plain member form still reads the same way it always did.
    assert.equal(tidy('y = pos.x^2;'), 'y = pow(abs(pos.x), 2.0);');
  });

  test('and where there is nothing else to tidy, the line comes back byte for byte', () => {
    for (const src of ['y = a^;', 'y = a ^ ;']) {
      assert.equal(tidy(src), src);
    }
  });

  test('two unexpandable carets both survive', () => {
    const src = 'y = a^; z = b^;';
    assert.equal(tidy(src), src);
  });

  test('the module source carries no literal NUL', () => {
    // The first draft parked unexpandable carets on an actual NUL byte written
    // into the file. It reads as nothing in an editor and does not survive
    // tooling that assumes text; the sentinel is an escape now.
    const src = read('src/glsl-tidy.js');
    assert.doesNotMatch(src, /\u0000/, 'src/glsl-tidy.js contains a literal NUL byte');
    assert.match(src, /const PARKED = '\\u0000'/, 'the sentinel is no longer declared as an escape');
  });
});

describe('names expand to what the scaffold actually declares', () => {

  test('the vertex tab gets the short locals', () => {
    assert.equal(tidy('y = bass * amp + time;'), 'y = b * a + T;');
    assert.equal(tidy('y = spectrum(r);'), 'y = bandAtRadius(r);');
  });

  test('the fragment tab gets the uniforms instead — because t means something else there', () => {
    // This is the trap the two maps exist for. In the vertex body `t` is
    // treble; in the fragment body `t` is the palette ramp, so mapping
    // treble → t there would silently rebind the colour.
    assert.equal(tidy('c = vec3(bass, mid, treble);', 'frag'), 'c = vec3(uBass, uMid, uTreble);');
    assert.equal(tidy('c = getColor(uCM, t) * time;', 'frag'), 'c = getColor(uCM, t) * uTime;');
    assert.ok(!Object.hasOwn(ALIASES.frag, 'treble') || ALIASES.frag.treble !== 't',
      'the fragment map rebinds t, which is the palette ramp in that scaffold');
  });

  test('spectrum is vertex-only, like the function it stands for', () => {
    assert.ok(!Object.hasOwn(ALIASES.frag, 'spectrum'),
      'the fragment map aliases spectrum, but BAND_GLSL is not in the fragment scaffold');
  });

  test('beat is deliberately absent from both maps', () => {
    // bt is pinned to 0 for photosensitivity, and opting in is documented as
    // something the operator writes by hand. A silent alias is not the place
    // to undo a decision of that kind.
    for (const tab of ['vert', 'frag']) {
      assert.ok(!Object.hasOwn(ALIASES[tab], 'beat'),
        `the ${tab} map aliases beat, which the scaffold mutes on purpose`);
    }
    assert.equal(tidy('bt = beat;'), 'bt = beat;');
  });

  test('every name a map expands to exists in the scaffold it targets', () => {
    // The guard that matters: if the scaffold renames a local, TIDY must fail
    // here rather than start emitting an undeclared identifier.
    const src = read('src/shaders.js');
    const vs = src.slice(src.indexOf('const SE_VS_TEMPLATE'), src.indexOf('const SE_FS_TEMPLATE'));
    const fs_ = src.slice(src.indexOf('const SE_FS_TEMPLATE'), src.indexOf('SE_DEFAULT_VERT'));
    const bandNames = ['bandAtRadius', 'bandAtU'];
    for (const target of Object.values(ALIASES.vert)) {
      const found = bandNames.includes(target)
        ? read('src/shaders.js').includes(`float ${target}(`)
        : new RegExp(`[,(\\s]${target}\\s*[=,;)]`).test(vs);
      assert.ok(found, `the vertex map expands to "${target}", which the vertex scaffold does not declare`);
    }
    for (const target of Object.values(ALIASES.frag)) {
      assert.ok(fs_.includes(target),
        `the fragment map expands to "${target}", which the fragment scaffold does not declare`);
    }
  });

  test('a member with the same name is not an alias', () => {
    assert.equal(tidy('y = pos.time;'), 'y = pos.time;');
  });

  test('a name the body declares itself is never renamed', () => {
    // This shipped as a redefinition. `float time = T * 2.0;` had its own
    // declaration rewritten to the scaffold's local — `float T = T * 2.0;` —
    // against a T the template already declares, so nothing compiled.
    //
    // Renaming only the USES and leaving the declaration alone would have been
    // worse than a compile error: it compiles and silently reads the scaffold's
    // time instead of the operator's variable. So the whole alias is dropped
    // for a name the body owns, declaration and uses together.
    assert.equal(tidy('float time = T*2.0;\ny = sin(time);'),
                 'float time = T*2.0;\ny = sin(time);');
    assert.equal(tidy('float bass = 0.5; y = bass;'), 'float bass = 0.5; y = bass;');
    assert.equal(tidy('vec2 mid = pos.xz; y = mid.x;'), 'vec2 mid = pos.xz; y = mid.x;');
    // A body that does NOT declare the name still gets the alias.
    assert.equal(tidy('y = bass;'), 'y = b;');
  });

  test('a longer word that merely contains an alias is untouched', () => {
    assert.equal(tidy('y = bassSens;'), 'y = bassSens;');
    assert.equal(tidy('float timer = T; y = timer;'), 'float timer = T; y = timer;');
  });
});

describe('the pass as a whole', () => {

  test('the steps run in an order where each one still sees what it needs', () => {
    // Aliases before carets, so `spectrum(r)^2` has become a call by the time
    // the caret looks left; carets before floats, so the `2` they introduce is
    // still an integer when the float pass arrives.
    // INVERTED in round 6 with the three assertions above: the base is guarded.
    assert.equal(tidy('y = spectrum(r)^2 * bass;'), 'y = pow(abs(bandAtRadius(r)), 2.0) * b;');
  });

  test('a body that needs nothing is reported as unchanged', () => {
    const clean = 'y = sin(r * 8.0 + T) * (0.2 + b * 0.8) * a;';
    const r = tidyGlsl(clean);
    assert.equal(r.text, clean);
    assert.equal(r.changed, false);
    assert.deepEqual(r.changes, []);
    assert.equal(describeTidy(r.changes), null, 'an unchanged body must report nothing to say');
  });

  test('the shipped default body needs nothing', () => {
    // If TIDY would rewrite what the editor opens with, one of them is wrong.
    const m = read('src/shaders.js').match(/SE_DEFAULT_VERT\s*=\s*`([\s\S]*?)`/);
    assert.ok(m, 'SE_DEFAULT_VERT is no longer a template literal');
    const body = literalValue(m[1]);
    assert.equal(tidyGlsl(body, 'vert').changed, false,
      'TIDY wants to rewrite the editor default:\n' + tidy(body));
  });

  test('every shipped preset body needs nothing either', () => {
    const src = read('src/shaders.js');
    const block = src.slice(src.indexOf('SE_PRESETS'), src.indexOf('SE_PRESETS') + 4000);
    const bodies = [...block.matchAll(/code:\s*`([\s\S]*?)`/g)].map(m => literalValue(m[1]));
    assert.ok(bodies.length >= 6, `expected the shipped presets, found ${bodies.length}`);
    for (const body of bodies) {
      const tab = /(^|[^\w.])c\s*=/.test(body) ? 'frag' : 'vert';
      assert.equal(tidyGlsl(body, tab).changed, false,
        `TIDY wants to rewrite a shipped preset (${tab}):\n${body}\n→\n${tidy(body, tab)}`);
    }
  });

  test('rubbish input is answered, not thrown on', () => {
    for (const v of [null, undefined, '', 0, {}]) {
      assert.doesNotThrow(() => tidyGlsl(v), `threw on ${String(v)}`);
    }
  });

  test('the summary counts what it did', () => {
    const r = tidyGlsl('y = bass * 2 + r^2;');
    // 'guard' joined the list in round 6. It is reported on its own line rather
    // than folded into 'pow' because it is the only edit here that ADDS text:
    // the operator should read that abs() went in, not discover it in their
    // own buffer.
    assert.deepEqual(r.changes.map(c => c.kind).sort(), ['floats', 'guard', 'names', 'pow']);
    const line = describeTidy(r.changes);
    assert.match(line, /Tidied/);
    assert.match(line, /pow/);
    assert.match(line, /abs\(\) guard/, 'the added abs() is not named in the status line');
  });

  test('the sub-passes are exported so each can be checked on its own', () => {
    assert.equal(typeof floatifyIntegers, 'function');
    assert.equal(typeof expandCarets, 'function');
    assert.equal(typeof applyAliases, 'function');
    assert.equal(floatifyIntegers('y = 2;').count, 1);
    assert.equal(expandCarets('y = r^2;').count, 1);
    assert.equal(applyAliases('y = bass;', 'vert').count, 1);
  });
});

describe('it is wired to a button that does not compile', () => {

  const modals = read('src/ui/modals.js');
  const html = read('index.html');

  test('the button exists and is separate from APPLY', () => {
    assert.match(html, /id="se-btn-tidy"/, 'no TIDY button in the editor');
    assert.match(html, /id="se-btn-apply"/, 'APPLY is gone');
    assert.match(modals, /se-btn-tidy'\)\?\.addEventListener/, 'the TIDY button is not bound');
  });

  test('pressing it does not compile', () => {
    const handler = modals.slice(modals.indexOf("se-btn-tidy'"), modals.indexOf("se-btn-tidy'") + 1600);
    assert.doesNotMatch(handler, /compileAndApply/,
      'TIDY compiles, which removes the operator\'s chance to read the edit before it runs');
  });

  test('the result goes back into the textarea the compiler reads', () => {
    const handler = modals.slice(modals.indexOf("se-btn-tidy'"), modals.indexOf("se-btn-tidy'") + 1600);
    assert.match(handler, /seCode/, 'the tidied text does not reach #se-code');
    assert.match(handler, /insertText/,
      'assigning .value wipes the undo stack and fires no input event, so Ctrl+Z cannot ' +
      'take a tidy back and the autosave listener never sees it');
    assert.match(handler, /dispatchEvent\(new Event\('input'/,
      'the fallback path does not tell the autosave listener anything changed');
  });

  test('it uses the tab the operator is on', () => {
    const handler = modals.slice(modals.indexOf("se-btn-tidy'"), modals.indexOf("se-btn-tidy'") + 1600);
    assert.match(handler, /se\._tab/,
      'TIDY does not read the current tab, so it would apply the vertex name map to ' +
      'fragment code, where t means the palette ramp');
  });

  test('the document describes it', () => {
    const doc = read('documents/shader-editor.md');
    assert.match(doc, /## TIDY/, 'shader-editor.md does not document the button');
    assert.match(doc, /pow\(abs\(r\), 2\.0\)/, 'the doc does not show what ^ becomes');
    assert.ok(doc.includes('even'), 'the doc does not say when the abs() guard applies');
    assert.ok(doc.includes('`beat` is not in the name table'),
      'the doc does not say why beat is excluded');
  });
});
