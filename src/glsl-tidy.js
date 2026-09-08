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
 * Four kinds, and each one is a real way to turn working code into broken code:
 *   • comments — rewriting prose is noise at best
 *   • `[ … ]` — `uBands[3]` needs an int index; `uBands[3.0]` does not compile
 *   • a `for( … )` header — the counter and its bound are ints
 *   • any statement mentioning `int` — its literals are ints by construction
 *
 * The for-header is handled separately from the statement rule on purpose: a
 * for header contains two `;` of its own, so splitting statements on `;` would
 * leave `i < 5` in a segment with no `int` in it and convert the bound.
 */
export function protectedRanges(src) {
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
  const bare = code.join('');   // same length, comments blanked

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

  // Statements that mention `int`, split on the semicolons that remain.
  let from = 0;
  for (let k = 0; k <= bare.length; k++) {
    if (k === bare.length || bare[k] === ';') {
      const seg = bare.slice(from, k);
      if (/(^|[^\w])int(?![\w])/.test(seg)) push(from, k);
      from = k + 1;
    }
  }
  return out;
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
  const ranges = protectedRanges(src);
  let count = 0;
  const out = src.replace(/\d+/g, (num, at) => {
    const before = src[at - 1];
    const after  = src[at + num.length];
    if (inRanges(ranges, at, at + num.length)) return num;
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
  const ranges = protectedRanges(src);
  let count = 0;
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
    if (!left || !right) {
      // Nothing sensible on one side. Blank this caret so the loop moves on,
      // then restore it — the source keeps whatever the operator wrote.
      text = `${text.slice(0, at)}${PARKED}${text.slice(at + 1)}`;
      continue;
    }
    text = `${text.slice(0, left.start)}pow(${text.slice(left.start, left.end)}, ` +
           `${text.slice(right.start, right.end)})${text.slice(right.end)}`;
    count++;
  }
  return { text: text.split(PARKED).join('^'), count };
}

function termBefore(src, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
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
    return { start: s, end: at };
  }
  if (!isWord(src[k])) return null;
  let s = k;
  while (s > 0 && (isWord(src[s - 1]) || (src[s - 1] === '.' && isWord(src[s - 2])))) s--;
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
  if (!isWord(src[k])) return null;
  while (k < src.length && (isWord(src[k]) || (src[k] === '.' && isWord(src[k + 1])))) k++;
  if (src[k] === '(') {                          // a call: take its arguments
    let depth = 0;
    for (; k < src.length; k++) {
      if (src[k] === '(') depth++;
      else if (src[k] === ')') { depth--; if (!depth) { k++; break; } }
    }
    if (depth) return null;
  }
  return { start, end: k };
}

/** Replace spelled-out names with the ones the scaffold declares. */
export function applyAliases(src, tab = 'vert') {
  const map = ALIASES[tab] ?? ALIASES.vert;
  const ranges = protectedRanges(src);
  let count = 0;
  const text = src.replace(/[A-Za-z_]\w*/g, (word, at) => {
    if (!Object.hasOwn(map, word)) return word;
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

  const floated = floatifyIntegers(powed.text);
  if (floated.count) changes.push({ kind: 'floats', count: floated.count });

  return { text: floated.text, changed: floated.text !== src, changes };
}

/** One line for the editor's status area, or null when nothing was found. */
export function describeTidy(changes) {
  if (!changes.length) return null;
  const label = { floats: 'float literal', pow: '^ → pow()', names: 'name' };
  return '✎ Tidied: ' + changes.map(c => {
    const base = label[c.kind] ?? c.kind;
    return c.kind === 'pow' ? `${c.count}× ${base}` : `${c.count} ${base}${c.count === 1 ? '' : 's'}`;
  }).join(', ');
}
