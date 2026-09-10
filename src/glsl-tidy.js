/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

/**
 * glsl-tidy.js — the three edits that stand between maths and GLSL.
 *
 * ── What this is, and what it deliberately is not ───────────────────────────
 * It is a rewriter for the text the operator already has in the editor. It is
 * NOT a compiler for a second language, and the difference is the whole design:
 * the result is written back into #se-code, so the buffer the user is looking
 * at stays the buffer that compiles. That keeps three things that a generator
 * emitting into a hidden pipeline would each have had to rebuild —
 *
 *   • Error locations. ShaderEditor._parseErrorLine finds the body inside the
 *     driver's source with `fullShader.indexOf(userBody)`. Generated text is
 *     not the user's text, so that lookup would return -1 and every compile
 *     error would silently lose its line number and its gutter mark.
 *   • Persistence. The unit captureState stores is the GLSL body. Nothing new
 *     is saved, nothing new is restored, no preset field, no migration.
 *   • One source of truth. ShaderEditor already juggles draft buffers, live
 *     programs and applied bodies, and the third pair exists only because
 *     pairing an engine flag with a draft shipped as a bug once already.
 *
 * ── The three edits ─────────────────────────────────────────────────────────
 * Chosen because they are what actually goes wrong, not what is interesting:
 * documents/shader-editor.md's "common errors" section names the wrong-operand
 * type error, and it is nearly always a bare integer.
 *
 *   1. Integer literals become float literals.  `r * 8`  →  `r * 8.0`
 *      GLSL ES 1.00 has no implicit int→float conversion, so `r * 8` is a hard
 *      type error, and the editor's scaffold is ES 1.00 (attribute/varying/
 *      gl_FragColor, no #version 300 es).
 *   2. `^` becomes pow().  `r^2`  →  `pow(r, 2.0)`
 *      Every mathematician writes `r^2`; in GLSL `^` is bitwise XOR and does
 *      not accept floats at all.
 *   3. Spelled-out names become the scaffold's.  `bass` → `b`, `time` → `T`.
 *      Tab-aware, because the two scaffolds disagree: in the VERTEX body `t` is
 *      TREBLE and time is `T`, while in the FRAGMENT body `t` is the palette
 *      ramp and the audio arrives under its uniform names.
 *   4. FIX(r6) — an even power gets its base guarded.  `sin(r)^2` →
 *      `pow(abs(sin(r)), 2.0)`. GLSL leaves pow(x,y) undefined for x < 0, which
 *      on ANGLE is a NaN and on screen is a black rectangle; |x|^2 is x^2, so
 *      for an even integer exponent the guard costs nothing and removes the
 *      whole failure. It is the ONE thing here that adds text, which is why the
 *      status line names it separately.
 *
 * Everything here is conservative in one direction on purpose: when a rewrite
 * is not obviously safe it is not made. A missed tidy is a keystroke; a wrong
 * one is a shader that compiles and means something else.
 */

/**
 * Names a person writes, and what the scaffold actually calls them.
 *
 * The vertex and fragment maps are different and that is not an oversight.
 * `t` is TREBLE in the vertex body (`float b=…uBass…,t=…uTreble…`) and the
 * palette ramp in the fragment body, so mapping `treble → t` in the fragment
 * tab would silently rebind the colour ramp. The fragment tab gets uniform
 * names instead.
 *
 * `beat` is in neither map, deliberately. The scaffolds pin `bt` to 0 because
 * beat-driven displacement flashes the surface on every onset, which DISCLAIMER
 * warns photosensitive users about; opting in is documented as writing
 * `bt = uBeat` by hand, and a silent alias is not the place to undo a decision
 * of that kind.
 *
 * `spectrum` is vertex-only for the same reason the docs say so: BAND_GLSL is
 * not interpolated into the fragment scaffold and cannot be, since bandAtU
 * reads the `position` attribute.
 */
export const ALIASES = {
  vert: {
    time: 'T', bass: 'b', mid: 'm', treble: 't', amp: 'a', wave: 'wi',
    spectrum: 'bandAtRadius',
  },
  frag: {
    time: 'uTime', bass: 'uBass', mid: 'uMid', treble: 'uTreble',
  },
};

/** Identifier characters, for deciding whether a match is a whole word. */
const isWord = ch => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

/**
 * Character ranges no rewrite may enter.
 *
 * Six kinds, and each one is a real way to turn working code into broken code:
 *   • comments — rewriting prose is noise at best
 *   • preprocessor lines — `#define N 4` names an int; floating it breaks every
 *     array size and loop bound spelled with it, and the directive is not a
 *     statement, so the `;` split below never reaches it
 *   • `[ … ]` — `uBands[3]` needs an int index; `uBands[3.0]` does not compile
 *   • a `for( … )` header — the counter and its bound are ints
 *   • any statement mentioning `int` — its literals are ints by construction
 *   • any statement mentioning `ivec2` / `ivec3` / `ivec4` — FIX(r6): the word
 *     `int` is not a substring of `ivec2`, so `ivec2(1, 2)` was floated to
 *     `ivec2(1.0, 2.0)`, which is a hard type error. The constructor names are
 *     spelled out rather than matched loosely because `i` and `vec2` are both
 *     ordinary things to write.
 *
 * The for-header is handled separately from the statement rule on purpose: a
 * for header contains two `;` of its own, so splitting statements on `;` would
 * leave `i < 5` in a segment with no `int` in it and convert the bound.
 *
 * What is deliberately NOT here: a variable declared `int` earlier and merely
 * USED later — `int n = 3;` followed by `n = n + 2;`. Protecting every statement
 * that mentions such a name is too coarse; it would also protect
 * `y = float(n) * 2;`, where the 2 genuinely has to become 2.0. That case is
 * handled one literal at a time in floatifyIntegers(), which looks at the
 * operand actually beside the number.
 */
export function protectedRanges(src) {
  return analyse(src).ranges;
}

/**
 * The ranges, and the comment- and directive-blanked view of the same string.
 *
 * Both come out of ONE pass, and that is a repair rather than tidiness. The
 * first version of scan() re-derived which ranges were comments by testing
 * their text with `/^\s*(?:\/\/|\/\*|#)/` — but a STATEMENT range runs from the
 * previous `;` to the next one, so a declaration with a comment on the line
 * above it starts with `//` and matched too. The whole statement, declaration
 * included, was then blanked out of the name view, and every name the body
 * declared went unseen the moment anyone wrote a comment above it:
 *
 *     // how many ripples          →  TIDY emits `rings = rings + 2.0;`
 *     int rings = 3;                  which is int + float, and does not compile
 *     rings = rings + 2;
 *
 * Delete the comment and the same body was handled correctly, which is the
 * signature of a classifier guessing at something it could simply have been
 * told. Here nothing is guessed: `bare` is built by the same loop that finds
 * the comments, so it blanks exactly them and exactly the directives.
 */
function analyse(src) {
  const out = [];
  const push = (a, b) => { if (b > a) out.push([a, b]); };

  // Comments first — a `[` or the word `int` inside one must not open a range.
  let i = 0;
  const code = src.split('');
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i); if (j < 0) j = src.length;
      push(i, j); for (let k = i; k < j; k++) code[k] = ' ';
      i = j; continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2;
      push(i, j); for (let k = i; k < j; k++) code[k] = ' ';
      i = j; continue;
    }
    i++;
  }
  // Preprocessor lines, on the comment-blanked text so a `#` inside a comment
  // does not start one. The whole directive goes — and a directive is not
  // necessarily one physical line: a trailing backslash continues it, and the
  // continuation carries the macro's body. Left at one line, `#define SIZE \`
  // followed by `  4` had the 4 floated to 4.0 on the next line, so every
  // `uBands[SIZE]` and every loop bound spelled with the macro stopped
  // compiling — and the error pointed at a line the operator never edited.
  {
    const blanked = code.join('');
    const re = /^[ \t]*#(?:\\\r?\n|[^\n])*/gm;
    for (const m of blanked.matchAll(re)) {
      push(m.index, m.index + m[0].length);
      for (let k = m.index; k < m.index + m[0].length; k++) code[k] = ' ';
    }
  }

  const bare = code.join('');   // same length, comments and directives blanked

  // Bracketed subscripts, nesting included.
  const stack = [];
  for (let k = 0; k < bare.length; k++) {
    if (bare[k] === '[') stack.push(k);
    else if (bare[k] === ']' && stack.length) push(stack.pop(), k + 1);
  }

  // for( … ) headers — the whole parenthesised part.
  for (const m of bare.matchAll(/\bfor\s*\(/g)) {
    let depth = 0;
    for (let k = m.index + m[0].length - 1; k < bare.length; k++) {
      if (bare[k] === '(') depth++;
      else if (bare[k] === ')') { depth--; if (!depth) { push(m.index, k + 1); break; } }
    }
  }

  // Statements that mention an integer TYPE, split on the semicolons that
  // remain. `ivec[234]` is listed beside `int` because it does not contain it.
  let from = 0;
  for (let k = 0; k <= bare.length; k++) {
    if (k === bare.length || bare[k] === ';') {
      const seg = bare.slice(from, k);
      if (/(^|[^\w])(?:int|ivec[234])(?![\w])/.test(seg)) push(from, k);
      from = k + 1;
    }
  }
  return { ranges: out, bare };
}

/** The ranges plus the name view — see analyse(). */
const scan = src => analyse(src);

/**
 * The names one declaration statement introduces, from the position just after
 * its type keyword.
 *
 * Written as a walk rather than a regex because the regex it replaces —
 * `([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)` — only continued across a comma when
 * the previous declarator had NO initialiser. So in
 *
 *     float base = 0.2, time = T * 0.5;
 *
 * it captured `base` and stopped, `time` was not registered as a name the body
 * owns, and applyAliases rewrote it to the scaffold's `T` — declaration and all,
 * producing `float base = 0.2, T = T * 0.5;` against a `T` the template already
 * declares. Exactly the defect declaredNames() exists to prevent, one comma
 * further along.
 *
 * Commas are split at depth 0 only, so `vec3 a = mix(x, y, 0.5), b;` is two
 * declarators and not four.
 */
function declaratorNames(bare, from) {
  const names = [];
  let depth = 0;
  let i = from;
  let start = from;
  const take = (a, b) => {
    const m = /^\s*([A-Za-z_]\w*)/.exec(bare.slice(a, b));
    if (m) names.push(m[1]);
  };
  for (; i < bare.length; i++) {
    const ch = bare[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0 && ch === ',') { take(start, i); start = i + 1; }
    else if (depth === 0 && ch === ';') break;
  }
  take(start, i);
  return names;
}

/**
 * Every name the body declares, whatever the type.
 *
 * FIX(r6): applyAliases used to rewrite these. A body opening with
 * `float time = T * 2.0;` had its own declaration renamed to the scaffold's
 * local — `float T = T * 2.0;` — which is a redefinition of a variable declared
 * at src/shaders.js's `float r=…,y=0.,a=uAmp,wi=uWI,T=uTime;` line and does not
 * compile. Renaming only the USES and leaving the declaration alone would have
 * been worse: that compiles, and silently reads the scaffold's time instead of
 * the operator's variable. So the whole alias is dropped for a name the body
 * owns, which is the conservative direction this module is built around.
 */
function declaredNames(bare) {
  const TYPE = '(?:float|int|bool|void|vec[234]|ivec[234]|bvec[234]|mat[234]|sampler2D|samplerCube)';
  const QUAL = '(?:const|uniform|varying|attribute|lowp|mediump|highp)';
  const re = new RegExp(`\\b(?:${QUAL}\\s+)*${TYPE}\\s+(?=[A-Za-z_])`, 'g');
  const names = new Set();
  for (const m of bare.matchAll(re)) {
    for (const n of declaratorNames(bare, m.index + m[0].length)) names.add(n);
  }
  return names;
}

/**
 * Names the body declares as integer-typed.
 *
 * A for-header declaration is skipped on purpose: the header is protected as a
 * whole range already, and registering its counter would protect every
 * statement in the loop body that mentions it — including `y += float(i) * 2;`,
 * where the 2 has to become 2.0.
 */
function intNames(bare, ranges) {
  const forRanges = ranges.filter(([a]) => /^\s*for\b/.test(bare.slice(a, a + 8)));
  const re = /\b(?:const\s+)?(?:lowp\s+|mediump\s+|highp\s+)?(?:int|ivec[234])\s+(?=[A-Za-z_])/g;
  const names = new Set();
  for (const m of bare.matchAll(re)) {
    if (forRanges.some(([a, b]) => m.index >= a && m.index < b)) continue;
    for (const n of declaratorNames(bare, m.index + m[0].length)) names.add(n);
  }
  return names;
}

const inRanges = (ranges, a, b) => ranges.some(([s, e]) => a < e && b > s);

/**
 * Add the decimal point GLSL ES 1.00 insists on.
 *
 * Left alone: anything already a float (`8.0`, `.5`, `8.`, `1e3`), anything
 * that is part of an identifier (`vec3`, `x2`, `uBands`), a hex literal, and
 * anything inside a protected range.
 */
export function floatifyIntegers(src) {
  const { ranges, bare } = scan(src);
  const ints = intNames(bare, ranges);
  /**
   * Is this literal sitting directly beside an integer-typed variable?
   *
   * FIX(r6): `int n = 3;` is protected by the statement rule, but the line after
   * it — `n = n + 2;` — mentions no type, so the 2 became 2.0 and the addition
   * stopped compiling. Looked at per literal rather than per statement, because
   * the same body may hold `y = float(n) * 2;`, where the 2 must be floated.
   * The test is deliberately narrow: one operator (or an assignment) between the
   * name and the number, nothing else. `float(n) * 2` fails it — the character
   * before the operator is `)`, not an identifier — and that is the point.
   */
  const besideAnInt = (at, len) => {
    if (!ints.size) return false;
    const left = bare.slice(Math.max(0, at - 64), at)
      .match(/([A-Za-z_]\w*)\s*(?:[-+*/%]?=|[-+*/%]|[<>]=?|[=!]=)\s*[-+]?\s*$/);
    if (left && ints.has(left[1])) return true;
    const right = bare.slice(at + len, at + len + 64)
      .match(/^\s*(?:[-+*/%]|[<>]=?|[=!]=)\s*([A-Za-z_]\w*)/);
    return !!right && ints.has(right[1]);
  };
  let count = 0;
  const out = src.replace(/\d+/g, (num, at) => {
    const before = src[at - 1];
    const after  = src[at + num.length];
    if (inRanges(ranges, at, at + num.length)) return num;
    if (besideAnInt(at, num.length)) return num;
    if (isWord(before) || before === '.') return num;          // x2, 1.5, vec3
    if (after === '.' || isWord(after)) return num;            // 8.0, 1e3, 2u
    // An exponent's digits: `1e-3` — the sign and the `e` sit to the left.
    if (before === '-' || before === '+') {
      const e = src[at - 2];
      if (e === 'e' || e === 'E') return num;
    }
    count++;
    return `${num}.0`;
  });
  return { text: out, count };
}

/**
 * Rewrite `a ^ b` as `pow(a, b)`.
 *
 * The operands are found by walking outward from the `^` and taking one
 * balanced term on each side: a parenthesised group (with its function name if
 * it has one), or a single identifier, number or member expression, optionally
 * signed on the right. Anything more complicated is LEFT ALONE — `a + b ^ c`
 * without brackets is ambiguous to a reader too, and guessing at precedence is
 * exactly the way to produce a shader that compiles and is wrong.
 *
 * Right-associative, so `2^3^2` becomes pow(2, pow(3, 2)), which is how it is
 * read in mathematics.
 */
export function expandCarets(src) {
  // A caret this pass declines to expand is parked on a sentinel so the scan
  // moves past it, and restored verbatim at the end. Written as an ESCAPE and
  // never as a literal: the first draft of this file carried an actual NUL byte
  // in its source, which reads as nothing in an editor and does not survive
  // tooling that assumes text. GLSL cannot contain one, which is what makes it
  // a safe marker.
  const PARKED = '\u0000';
  let count = 0;
  let guarded = 0;
  let text = src;

  for (;;) {
    // Rightmost first: that is what makes the nesting right-associative.
    let at = -1;
    for (let k = text.length - 1; k >= 0; k--) {
      if (text[k] === '^' && !inRanges(protectedRanges(text), k, k + 1)) { at = k; break; }
    }
    if (at < 0) break;

    const left = termBefore(text, at);
    const right = termAfter(text, at);
    // FIX(r6): a term may not reach into a protected range. Only the caret's own
    // position was checked, and the term finders consult no ranges at all, so an
    // operand was free to be a word inside a comment:
    //
    //     y = sin(r*8. + T) // the ripple
    //       ^2 * a;
    //
    // The left walk skipped the newline as ordinary whitespace, took `ripple`,
    // and — once the operands were trimmed — spliced `pow(` INSIDE the comment,
    // where it swallowed the rest of the statement including its semicolon. The
    // caret is parked instead, so the operator keeps exactly what they wrote.
    const ranges = protectedRanges(text);
    const reaches = t => t && inRanges(ranges, t.start, t.end);
    if (!left || !right || reaches(left) || reaches(right)) {
      // Nothing sensible on one side. Blank this caret so the loop moves on,
      // then restore it — the source keeps whatever the operator wrote.
      text = `${text.slice(0, at)}${PARKED}${text.slice(at + 1)}`;
      continue;
    }
    const base = text.slice(left.start, left.end).trim();
    const exp  = text.slice(right.start, right.end).trim();
    // FIX(r6): guard the base. GLSL leaves pow(x, y) UNDEFINED for x < 0 — on
    // ANGLE/D3D11 that is a NaN, and a NaN in the vertex or colour path is the
    // black-rectangle class that cost this branch four commits (see the
    // FIX(r6) note at src/shaders.js's fresnel clamp). The flagship thing a
    // person writes here is `sin(r)^2`, and sin is negative half the time, so
    // TIDY's own headline example was a NaN generator. The app's one shipped
    // GPU formula that raises a sinusoid already writes it the guarded way:
    // `pow(abs(sin(...)),2.)` in src/shaders.js.
    //
    // Only for an EVEN integer exponent, where abs() cannot change the answer —
    // |x|^2 IS x^2. For an odd or fractional exponent abs() would flip a sign or
    // invent a value, so the caret is expanded unguarded and the operator keeps
    // what they wrote; a negative base under a fractional power has no real
    // answer to preserve in the first place.
    const guard = isEvenIntegerLiteral(exp) && !isNonNegative(base);
    if (guard) guarded++;
    text = `${text.slice(0, left.start)}pow(${guard ? `abs(${base})` : base}, ` +
           `${exp})${text.slice(right.end)}`;
    count++;
  }
  return { text: text.split(PARKED).join('^'), count, guarded };
}

/** `2`, `2.`, `2.0`, `+4` — an even integer, however it is spelled. */
function isEvenIntegerLiteral(s) {
  const m = /^\+?(\d+)(?:\.0*)?$/.exec(s.trim());
  return !!m && Number(m[1]) % 2 === 0;
}

/**
 * Can this expression be proved non-negative without knowing any types?
 *
 * Only two shapes qualify, and both are syntactic: a non-negative numeric
 * literal, and a single call to a function whose range is non-negative. Anything
 * else — an identifier, a member, an arithmetic expression — gets the guard,
 * because `r` looking like a radius is not the same as knowing it is one.
 */
function isNonNegative(s) {
  const t = s.trim();
  if (/^\+?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(t)) return true;
  const m = /^(abs|length|exp|sqrt|distance)\s*\(/.exec(t);
  if (!m || !t.endsWith(')')) return false;
  // The call has to BE the whole term, not merely start it: `abs(x)*y` opens
  // with abs( and ends with ) and is not non-negative.
  let depth = 0;
  for (let i = m[0].length - 1; i < t.length; i++) {
    if (t[i] === '(') depth++;
    else if (t[i] === ')') { depth--; if (!depth) return i === t.length - 1; }
  }
  return false;
}

/**
 * One link of a postfix chain, walked right to left from `k`: a parenthesised
 * group with the function name in front of it, or an identifier / number.
 * Returns where that link starts, or null when there is nothing walkable.
 */
function linkBefore(src, k) {
  if (k < 0) return null;
  if (src[k] === ')') {
    let depth = 0;
    for (; k >= 0; k--) {
      if (src[k] === ')') depth++;
      else if (src[k] === '(') { depth--; if (!depth) break; }
    }
    if (k < 0) return null;
    let s = k;                                   // take a function name with it
    while (s > 0 && isWord(src[s - 1])) s--;
    return s;
  }
  if (!isWord(src[k])) return null;
  let s = k;
  while (s > 0 && isWord(src[s - 1])) s--;
  return s;
}

function termBefore(src, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (k < 0) return null;
  let s = linkBefore(src, k);
  if (s === null) return null;
  // FIX(r6): keep walking back through `.` links, whatever is on the far side of
  // the dot. The old walk stepped over a `.` only when a WORD character sat on
  // both sides, so a member of a call result stopped at the member and the
  // rewrite was spliced after the dot: `normalize(pos).x^2` came out as
  // `normalize(pos).pow(abs(x), 2.0)`, which is not GLSL. `pos.x^2` was correct
  // and `vec2(r,r).x^2` was not — the failure depended on whether a `)` happened
  // to precede the dot, which is not a distinction the operator can see.
  while (s > 0 && src[s - 1] === '.') {
    let j = s - 2;
    while (j >= 0 && /\s/.test(src[j])) j--;
    const prev = linkBefore(src, j);
    if (prev === null) break;
    s = prev;
  }
  // FIX(r6): a leading-dot float. The walk above steps over a `.` only when a
  // word character sits on BOTH sides of it — that is the member-access rule,
  // `pos.x`. In `.5^2` there is nothing to the left of the dot, so the term came
  // back as `5` and the dot was left outside: `.5^2` became `.pow(5.0, 2.0)`,
  // which is not GLSL. The dot belongs to the number whenever the term is all
  // digits and the character before it cannot be the end of an identifier.
  if (src[s - 1] === '.' && /^\d+\s*$/.test(src.slice(s, at)) && !isWord(src[s - 2])) s--;
  return { start: s, end: at };
}

function termAfter(src, at) {
  let k = at + 1;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (k >= src.length) return null;
  const start = k;
  if (src[k] === '-' || src[k] === '+') { k++; while (k < src.length && /\s/.test(src[k])) k++; }
  if (src[k] === '(') {
    let depth = 0;
    for (; k < src.length; k++) {
      if (src[k] === '(') depth++;
      else if (src[k] === ')') { depth--; if (!depth) { k++; break; } }
    }
    if (depth) return null;
    return { start, end: k };
  }
  // FIX(r6): a leading-dot float on the right — `r^.5`. Declined before, which
  // was safe but meant the commonest way to write a square root stayed a caret.
  if (src[k] === '.' && /\d/.test(src[k + 1] ?? '')) {
    k++;
    while (k < src.length && /\d/.test(src[k])) k++;
    return { start, end: k };
  }
  if (!isWord(src[k])) return null;
  const numStart = k;
  while (k < src.length && (isWord(src[k]) || (src[k] === '.' && isWord(src[k + 1])))) k++;
  // FIX(r6): a trailing-dot float — `x^2.`. The walk steps over a `.` only when
  // a word character follows it, so the term stopped at the digits and the dot
  // was orphaned outside the call: `x^2.` became `pow(x, 2.0).`, which is not
  // GLSL. Same rule as the left side, mirrored: the dot is part of the number
  // when what precedes it is all digits and no identifier character follows.
  if (src[k] === '.' && /^\d+$/.test(src.slice(numStart, k)) && !isWord(src[k + 1])) k++;
  // A call, and then whatever hangs off it. FIX(r6): the member chain AFTER a
  // call was not consumed, so `x^normalize(pos).y` became `pow(x, normalize(pos)).y`
  // — the mirror image of the left-hand defect above, and just as invalid.
  for (;;) {
    if (src[k] === '(') {
      let depth = 0;
      for (; k < src.length; k++) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')') { depth--; if (!depth) { k++; break; } }
      }
      if (depth) return null;
      continue;
    }
    if (src[k] === '.' && isWord(src[k + 1])) {
      k++;
      while (k < src.length && isWord(src[k])) k++;
      continue;
    }
    break;
  }
  return { start, end: k };
}

/** Replace spelled-out names with the ones the scaffold declares. */
export function applyAliases(src, tab = 'vert') {
  const map = ALIASES[tab] ?? ALIASES.vert;
  const { ranges, bare } = scan(src);
  // A name the body declares belongs to the body — see declaredNames().
  const owned = declaredNames(bare);
  let count = 0;
  const text = src.replace(/[A-Za-z_]\w*/g, (word, at) => {
    if (!Object.hasOwn(map, word)) return word;
    if (owned.has(word)) return word;
    if (inRanges(ranges, at, at + word.length)) return word;
    // `pos.time` is a member of something else, not the alias.
    if (src[at - 1] === '.') return word;
    count++;
    return map[word];
  });
  return { text, count };
}

/**
 * The whole pass, in the order the steps depend on each other.
 *
 * Aliases first, so `spectrum(r)^2` has become `bandAtRadius(r)^2` before the
 * caret looks for its left operand. Carets next, so the `2` they introduce is
 * still an integer when the float pass arrives. Floats last.
 *
 * @param {string} source the operator's body, exactly as typed
 * @param {'vert'|'frag'} tab which scaffold it will be spliced into
 * @returns {{text: string, changed: boolean, changes: Array<{kind: string, count: number}>}}
 */
export function tidyGlsl(source, tab = 'vert') {
  const src = String(source ?? '');
  const changes = [];

  const aliased = applyAliases(src, tab);
  if (aliased.count) changes.push({ kind: 'names', count: aliased.count });

  const powed = expandCarets(aliased.text);
  if (powed.count) changes.push({ kind: 'pow', count: powed.count });
  // Reported separately from the pow itself: abs() is the one thing on this
  // list that TIDY adds rather than rewrites, and the operator should see it
  // said out loud rather than find it in their own buffer.
  if (powed.guarded) changes.push({ kind: 'guard', count: powed.guarded });

  const floated = floatifyIntegers(powed.text);
  if (floated.count) changes.push({ kind: 'floats', count: floated.count });

  return { text: floated.text, changed: floated.text !== src, changes };
}

/** One line for the editor's status area, or null when nothing was found. */
export function describeTidy(changes) {
  if (!changes.length) return null;
  const label = { floats: 'float literal', pow: '^ → pow()', names: 'name', guard: 'abs() guard' };
  return '✎ Tidied: ' + changes.map(c => {
    const base = label[c.kind] ?? c.kind;
    return c.kind === 'pow' ? `${c.count}× ${base}` : `${c.count} ${base}${c.count === 1 ? '' : 's'}`;
  }).join(', ');
}
