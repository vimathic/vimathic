// tests/photosensitivity-mutes.test.js
//
// The deliberate mutes. This app detects beats and then refuses to drive the
// default scene from them, and DISCLAIMER.md tells photosensitive readers so.
// The decision lives in nine lines of comment above one character of code:
//
//     float b=…,t=…,m=…,bt=0./*intentional, see note above*/;
//
// Run:
//   node --test tests/photosensitivity-mutes.test.js
//
// ── Why this file exists ─────────────────────────────────────────────────────
// Because nothing pinned it. Before this file, changing `bt=0.` to `bt=uBeat`
// in both shipped vertex programs turned the whole surface into an onset-driven
// strobe and the entire suite stayed green — `grep uBeat tests/` found only
// fixture values in stand-in uniform blocks and prose in other files' failure
// messages. The one assertion that mentions it,
// tests/frame-uniform-writes.test.js:105, pins that uBeat is UPLOADED every
// frame, which is the opposite fact: the value is available on purpose so an
// editor shader can opt in knowingly.
//
// A comment is not a guard. Nine lines of reasoning are worth exactly as much
// as the next person's willingness to read them before deleting the zero.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './helpers/glsl.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'src/shaders.js'), 'utf8');

let VS;
before(async () => { ({ VS } = await import('../src/shaders.js')); });

/**
 * The initialiser `bt` is declared with, as tokens. Returns null when nothing
 * in main() declares it.
 *
 * Read out of the declaring STATEMENT rather than through collectEnv, and the
 * reason is worth stating: in SE_VS_TEMPLATE every local declared above the
 * `${body}` interpolation comes back as `{unsafe: 'interp'}`, because a
 * substitution ran between the definition and its use and the resolver
 * correctly refuses to guess. `bt` is one of those. Reading the declarator is
 * the one form that works on both programs, and it is also the narrower claim:
 * what this file is about is the character that was typed, not what the
 * compiler would fold it into.
 *
 * `float b=…,t=…,m=…,bt=0.;` is one statement with four declarators, so the
 * initialiser is the run of tokens after `bt =` up to the next top-level comma.
 */
function btOf(programSrc) {
  const bodies = G.mainBodies(programSrc);
  assert.equal(bodies.length, 1, `expected one main() in the program, found ${bodies.length}`);
  for (const stmt of G.splitStatements(bodies[0].body)) {
    for (let i = 0; i < stmt.length - 1; i++) {
      if (!(stmt[i].t === 'id' && stmt[i].v === 'bt')) continue;
      if (!(stmt[i + 1].t === 'op' && stmt[i + 1].v === '=')) continue;
      const out = [];
      let depth = 0;
      for (let k = i + 2; k < stmt.length; k++) {
        const t = stmt[k];
        if (t.t === 'op' && '([{'.includes(t.v)) depth++;
        else if (t.t === 'op' && ')]}'.includes(t.v)) depth--;
        else if (depth === 0 && t.t === 'op' && t.v === ',') break;
        out.push(t);
      }
      return out;
    }
  }
  return null;
}

const isLiteralZero = expr =>
  Array.isArray(expr) && expr.length === 1 && expr[0].t === 'num' && Number(expr[0].v) === 0;

const programs = () => {
  const tpl = G.templateLiteral(SRC, 'SE_VS_TEMPLATE');
  assert.ok(/gl_Position/.test(tpl), 'the SE_VS_TEMPLATE slice stops before the end of main()');
  return [['VS', VS], ['SE_VS_TEMPLATE', tpl]];
};

describe('the beat drives nothing in either shipped vertex program', () => {
  test('bt is the literal zero, in both', () => {
    for (const [label, src] of programs()) {
      const expr = btOf(src);
      assert.ok(expr, `${label}: main() no longer defines bt at all. Every "+ bt * .5" term in ` +
        'computeMode would then read an undeclared name and the program would not link');
      assert.ok(isLiteralZero(expr),
        `${label}: bt is defined as "${expr.map(t => t.raw ?? t.v).join('')}", not 0. ` +
        'Driving displacement from the beat snaps the whole surface on every onset — the rapid ' +
        'flashing DISCLAIMER.md warns photosensitive users about, and the reason this line has ' +
        'nine lines of comment above it');
    }
  });

  test('and it is not written again further down', () => {
    // collectEnv classifies a name written twice as an accumulator and refuses
    // to resolve it, so the test above would go red on a second write — but it
    // would go red saying "bt is not defined", which names the wrong problem.
    // This says the right one.
    for (const [label, src] of programs()) {
      const body = G.mainBodies(src)[0].body;
      const writes = G.splitStatements(body).filter(s => G.assignsTo(s, ['bt']));
      assert.ok(writes.length <= 1,
        `${label}: bt is assigned ${writes.length} times — the later write is what ships, and ` +
        `the zero above it is decoration: ${writes.map(G.text).join(' | ')}`);
    }
  });

  test('CONTROL — the reader can see a non-zero, and can see a missing name', () => {
    // Without this the two tests above could be passing on a parser that
    // returns "0" for anything, or on a slice that contains no code at all.
    const wrap = decl => `uniform float uBeat;\nvoid main(){${decl}\n  gl_Position=vec4(0.);}`;
    assert.ok(isLiteralZero(btOf(wrap('float b=1.,bt=0.;'))),
      'the reader cannot recognise the shipped form');
    assert.equal(isLiteralZero(btOf(wrap('float b=1.,bt=uBeat;'))), false,
      'the reader calls bt=uBeat a literal zero — every assertion in this file is worthless');
    assert.equal(isLiteralZero(btOf(wrap('float b=1.,bt=uBeat*0.5;'))), false,
      'a scaled beat reads as zero');
    assert.equal(btOf(wrap('float b=1.;')), null,
      'the reader invents a definition for a name that is absent');
  });

  test('uBeat stays declared, because the mute is per-shader and not at the source', () => {
    // The choice is meant to be reversible BY A USER in their own shader, which
    // is why the beat is still detected, still uploaded every frame
    // (tests/frame-uniform-writes.test.js pins that), and still in scope here.
    // Removing the declaration would turn a deliberate opt-in into an
    // impossibility, and the DISCLAIMER's framing — that the app warns rather
    // than forbids — would stop being true of the product.
    for (const [label, src] of programs()) {
      assert.ok(G.declarations(src).has('uBeat'),
        `${label} no longer declares uBeat, so an editor shader cannot opt into beat response ` +
        'even knowingly');
    }
  });
});
