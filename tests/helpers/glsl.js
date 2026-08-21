// tests/helpers/glsl.js — read GLSL as GLSL, not as text that happens to match.
//
// NOT a test file (no `.test.js`), and in a subdirectory besides, so the suite's
// `node --test tests/*.test.js` neither runs it nor could run it. Its own
// self-tests therefore live in the three guards that use it, where they run:
// 'the stencil that reads those writes can report a defect' and 'the program
// measured here is the program that ships' in gpu-shape-y, 'the ramp this file
// models is the ramp that ships' in colour-ramp, and 'the reader behind those
// two: statements, and no prose' in shader-source-owner. Between them they feed
// this module the eleven behaviour-preserving edits it exists to absorb and the
// wrapped, decoyed and commented-out writes it exists to refuse.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// Three guards in this repo assert on the shipped shader source: gpu-shape-y,
// colour-ramp and shader-source-owner. They did it with `indexOf` on a
// whitespace-squeezed string and tables keyed on one exact spelling. Wave 2 of
// round 10's review ran thirty edits that change no behaviour at all through
// them; eleven turned a guard red, four of those fired the guards' OWN control
// assertions, and two printed a failure message that was false of the tree it
// printed on:
//
//     if (uMathMode == 0) {          one space           gpu-shape-y 7 red, colour-ramp 11 red
//     (f + pos.y)                    IEEE-identical      15 red
//     uMorphProgress * (pos.y + f)   IEEE-identical      15 red
//     pos.y = (pos.y * uMorphProgress);  parens          15 red
//     float disp = …  (rename of f)  same value          15 red
//     .6 respelled 0.6               same number         colour-ramp's own control
//     the FS ramp split in two statements                colour-ramp 5 red
//
// A guard that fires on a line break teaches people to shape source to fit a
// regexp — and that already happened here: the author of the FIX note in
// src/shaders.js reports rewording a comment into English so a guard reading
// prose as code would stay green.
//
// ── What this module does, and where the line is ─────────────────────────────
// It is a lexer, a parser for the GLSL EXPRESSION subset these programs use,
// and a canonical printer. Programs are reduced to trees, so:
//
//   • comments (both kinds) are gone before anything else looks at the text;
//   • whitespace and line breaks carry no meaning;
//   • numeric literals are canonical — `.6`, `0.6`, `0.60` are one number, and
//     `3.` is a float while `3` stays an int (uMathMode == 0 is an int compare);
//   • parentheses that change no grouping vanish, because the tree is what is
//     compared and the printer re-adds exactly the parentheses the tree needs;
//   • `+` and `*` match in either operand order — IEEE addition and
//     multiplication ARE commutative (they are not associative, and nothing
//     here re-associates: only the two children of one node are swapped);
//   • a local is resolved by its DEFINITION, not by its name, so renaming it
//     changes nothing and `float f = 0.0;` under the name the guard expects is
//     caught rather than trusted.
//
// Where the line is drawn, said out loud:
//
//   • No preprocessor. `#ifdef`, `#define` and macro expansion are not handled;
//     none of the shipped programs use them and a program that grew one would
//     have to be read again by hand.
//   • No statement-level semantics. Control flow inside a branch is not
//     interpreted — a `for` loop or an `if` around a write makes the write
//     UNREADABLE rather than understood, and every caller here treats
//     unreadable as a failure, not as a pass.
//   • No types. `int` vs `float` is tracked only in literal spelling, and
//     implicit conversions are not modelled.
//   • Inlining is single-assignment only. A name assigned twice, assigned
//     inside a nested block, or exposed to an interpolated `${…}` region is
//     marked unsafe and stays symbolic; callers then have to accept or refuse
//     the symbol on their own terms.
//
// Everything a caller asserts on comes out of this module, so a guard can be
// written against MEANING and still fail closed on anything it cannot read.

// ── comments ────────────────────────────────────────────────────────────────

/**
 * Both comment kinds out in ONE pass, so neither can hide the other: a `//`
 * inside a block and a `/*` inside a line comment resolve the way the GLSL
 * preprocessor resolves them, by whichever opener comes first. Replaced with
 * blanks rather than removed, so line numbers survive for error messages.
 */
export function stripComments(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '));
}

// ── numeric literals ────────────────────────────────────────────────────────

/**
 * One spelling per number. `.6` → `0.6`, `3.` → `3.0`, `1.50` → `1.5`,
 * `1e-3` → `0.001`. An integer literal keeps its int form: `0` stays `0` and
 * does NOT become `0.0`, because `uMathMode == 0` is an integer comparison and
 * conflating the two would erase a real distinction.
 */
export function canonNumber(text) {
  const body = String(text).replace(/[fFuU]$/, '');
  const isFloat = /[.eE]/.test(body);
  const v = Number(body);
  if (!Number.isFinite(v)) return String(text);
  if (!isFloat) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return v.toFixed(1);
  return String(v);
}

// ── lexer ───────────────────────────────────────────────────────────────────

const MULTI_OPS = ['<<=', '>>=', '==', '!=', '<=', '>=', '&&', '||', '^^',
                   '+=', '-=', '*=', '/=', '%=', '++', '--', '<<', '>>'];
export const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

/**
 * Tokens: {t:'id'|'num'|'op'|'interp', v, p, n} where `p` is the offset of the
 * token in the string handed in (comments already blanked, so offsets line up
 * with the original) and `n` its length there. `${…}` in a JS template literal
 * is ONE opaque token — a program read out of its source carries the
 * placeholder text, and pretending to understand what will be substituted there
 * is exactly how a reader certifies a program it never saw.
 */
export function tokenize(src) {
  const s = stripComments(src);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '$' && s[i + 1] === '{') {
      let d = 0, k = i + 1;
      for (; k < s.length; k++) {
        if (s[k] === '{') d++;
        else if (s[k] === '}') { d--; if (d === 0) break; }
      }
      out.push({ t: 'interp', v: s.slice(i, k + 1), p: i, n: k + 1 - i });
      i = k + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const m = /^(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFuU]?/.exec(s.slice(i));
      out.push({ t: 'num', v: canonNumber(m[0]), raw: m[0], p: i, n: m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      out.push({ t: 'id', v: m[0], p: i, n: m[0].length });
      i += m[0].length;
      continue;
    }
    const op = MULTI_OPS.find(o => s.startsWith(o, i));
    out.push({ t: 'op', v: op || c, p: i, n: op ? op.length : 1 });
    i += op ? op.length : 1;
    continue;
  }
  return out;
}

/** The [start, end) span a run of tokens covers in the string they came from. */
export const span = toks => [toks[0].p, toks[toks.length - 1].p + toks[toks.length - 1].n];

/** Tokens back to text: one spelling, with a space only where one is needed. */
export function text(tokens) {
  let s = '';
  let prev = null;
  for (const tk of tokens) {
    const wordy = t => t && (t.t === 'id' || t.t === 'num');
    if (wordy(prev) && wordy(tk)) s += ' ';
    s += tk.v;
    prev = tk;
  }
  return s;
}

/** Source text → the one spelling of itself. */
export const normalise = src => text(tokenize(src));

// ── statements ──────────────────────────────────────────────────────────────

const OPENERS = new Set(['(', '{', '[']);
const CLOSERS = new Set([')', '}', ']']);

/**
 * Split on EVERY `;`, at any depth, the way the guards have always done it.
 *
 * That is deliberate and is not laziness: it keeps a write wrapped in
 * `if(…)pos.y=…` or in bare braces VISIBLE as a statement that writes pos.y —
 * one whose text then fails to be any form the caller knows, so it is refused
 * rather than stepped over. An anchored, depth-aware splitter is what let four
 * mutations reintroduce the round-10 defect past every guard in the repo.
 */
export function splitStatements(src) {
  const toks = Array.isArray(src) ? src : tokenize(src);
  const out = [];
  let buf = [];
  for (const tk of toks) {
    if (tk.t === 'op' && tk.v === ';') { if (buf.length) out.push(buf); buf = []; continue; }
    buf.push(tk);
  }
  if (buf.length) out.push(buf);
  return out;
}

/**
 * Split into top-level statements: on a `;` at depth 0, and on the `}` that
 * closes a block at depth 0 (an `if`/`else` chain stays one statement).
 */
export function splitTopLevel(src) {
  const toks = Array.isArray(src) ? src : tokenize(src);
  const out = [];
  let buf = [], depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.t === 'op' && OPENERS.has(tk.v)) depth++;
    if (tk.t === 'op' && CLOSERS.has(tk.v)) depth--;
    if (tk.t === 'op' && tk.v === ';' && depth === 0) { if (buf.length) out.push(buf); buf = []; continue; }
    buf.push(tk);
    if (tk.t === 'op' && tk.v === '}' && depth === 0) {
      const nxt = toks[i + 1];
      if (!(nxt && nxt.t === 'id' && nxt.v === 'else')) { out.push(buf); buf = []; }
    }
  }
  if (buf.length) out.push(buf);
  return out;
}

/**
 * Does this statement ASSIGN to `path` — ['pos','y'] or ['vH']?
 *
 * Token-level, so `pos.y ==` is a comparison (one `==` token) rather than a
 * near-miss for a regexp, `mypos.y=` and `foo.pos.y=` are other lvalues, and
 * `vH` inside `s.vH=` is a member of something else.
 */
export function assignsTo(stmt, path) {
  const toks = Array.isArray(stmt) ? stmt : tokenize(stmt);
  for (let i = 0; i + path.length <= toks.length; i++) {
    if (toks[i].t !== 'id' || toks[i].v !== path[0]) continue;
    const before = toks[i - 1];
    if (before && before.t === 'op' && before.v === '.') continue;   // a member of something else
    let k = i;
    let ok = true;
    for (let p = 1; p < path.length; p++) {
      if (!(toks[k + 1] && toks[k + 1].t === 'op' && toks[k + 1].v === '.' &&
            toks[k + 2] && toks[k + 2].t === 'id' && toks[k + 2].v === path[p])) { ok = false; break; }
      k += 2;
    }
    if (!ok) continue;
    const after = toks[k + 1];
    if (after && after.t === 'op' && ASSIGN_OPS.has(after.v)) return true;
  }
  return false;
}

// ── expression parser ───────────────────────────────────────────────────────
//
// expr    := ternary
// ternary := binary ('?' expr ':' ternary)?
// binary  := precedence climbing over || && | ^ & == != < > <= >= + - * / %
// unary   := ('-'|'+'|'!')* postfix
// postfix := primary ('.' ident)*
// primary := number | ident ['(' args ')'] | '(' expr ')' | interp

const PREC = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '+': 8, '-': 8,
  '*': 9, '/': 9, '%': 9,
};
const COMMUTATIVE = new Set(['+', '*', '==', '!=']);

class Parser {
  constructor(toks) { this.t = toks; this.i = 0; }
  peek(k = 0) { return this.t[this.i + k]; }
  next() { return this.t[this.i++]; }
  is(v) { const p = this.peek(); return p && p.t === 'op' && p.v === v; }
  eat(v) { if (!this.is(v)) throw new Error(`expected '${v}' at token ${this.i} of: ${text(this.t)}`); return this.next(); }

  expr() { return this.ternary(); }

  ternary() {
    const c = this.binary(0);
    if (!this.is('?')) return c;
    this.eat('?');
    const a = this.expr();
    this.eat(':');
    const b = this.ternary();
    return { k: 'tern', c, a, b };
  }

  binary(min) {
    let left = this.unary();
    for (;;) {
      const p = this.peek();
      if (!p || p.t !== 'op' || !(p.v in PREC) || PREC[p.v] < min) return left;
      const op = this.next().v;
      const right = this.binary(PREC[op] + 1);
      left = { k: 'bin', op, l: left, r: right };
    }
  }

  unary() {
    const p = this.peek();
    if (p && p.t === 'op' && (p.v === '-' || p.v === '+' || p.v === '!')) {
      const op = this.next().v;
      const a = this.unary();
      return op === '+' ? a : { k: 'un', op, a };
    }
    return this.postfix();
  }

  postfix() {
    let n = this.primary();
    while (this.is('.')) {
      this.eat('.');
      const f = this.next();
      if (!f || f.t !== 'id') throw new Error('expected a field name after "."');
      n = { k: 'field', o: n, f: f.v };
    }
    return n;
  }

  primary() {
    const p = this.peek();
    if (!p) throw new Error(`expression ended early: ${text(this.t)}`);
    if (p.t === 'num') { this.next(); return { k: 'num', v: p.v }; }
    if (p.t === 'interp') { this.next(); return { k: 'interp', v: p.v }; }
    if (p.t === 'id') {
      this.next();
      if (this.is('(')) {
        this.eat('(');
        const args = [];
        if (!this.is(')')) {
          args.push(this.expr());
          while (this.is(',')) { this.eat(','); args.push(this.expr()); }
        }
        this.eat(')');
        return { k: 'call', n: p.v, args };
      }
      return { k: 'id', v: p.v };
    }
    if (p.t === 'op' && p.v === '(') { this.eat('('); const e = this.expr(); this.eat(')'); return e; }
    throw new Error(`cannot read an expression at '${p.v}' in: ${text(this.t)}`);
  }
}

/** Parse an expression. Throws on anything this subset does not cover. */
export function parseExpr(src) {
  const toks = Array.isArray(src) ? src : tokenize(src);
  const p = new Parser(toks);
  const e = p.expr();
  if (p.i !== toks.length) {
    throw new Error(`trailing tokens after the expression: ${text(toks.slice(p.i))}`);
  }
  return e;
}

/**
 * Canonical text of a tree. Binary nodes are fully parenthesised — the point is
 * one spelling per meaning, not pretty output — and the two operands of a
 * commutative operator are printed in a fixed order.
 */
export function print(n) {
  switch (n.k) {
    case 'num': case 'id': return n.v;
    case 'interp': return '${…}';
    case 'field': return print(n.o) + '.' + n.f;
    case 'call': return n.n + '(' + n.args.map(print).join(',') + ')';
    case 'un': return n.op + print(n.a);
    case 'bin': {
      let a = print(n.l), b = print(n.r);
      if (COMMUTATIVE.has(n.op) && b < a) { const s = a; a = b; b = s; }
      return '(' + a + n.op + b + ')';
    }
    case 'tern': return '(' + print(n.c) + '?' + print(n.a) + ':' + print(n.b) + ')';
    default: throw new Error(`cannot print node kind ${n.k}`);
  }
}

/** Canonical text of an expression's source. */
export const canon = src => print(parseExpr(src));

/**
 * Structural match. A pattern identifier spelled `_NAME` is a hole that binds
 * any subtree; a hole used twice must bind the same subtree, compared by
 * canonical text. `+` and `*` are tried in both operand orders.
 *
 * @returns {object|null} the bindings, or null if the trees do not match
 */
export function match(pat, n, holes = {}) {
  if (pat.k === 'id' && /^_[A-Za-z]/.test(pat.v)) {
    if (Object.hasOwn(holes, pat.v)) return print(holes[pat.v]) === print(n) ? holes : null;
    return { ...holes, [pat.v]: n };
  }
  if (pat.k !== n.k) return null;
  switch (pat.k) {
    case 'num': case 'id': return pat.v === n.v ? holes : null;
    case 'interp': return holes;
    case 'field': return pat.f === n.f ? match(pat.o, n.o, holes) : null;
    case 'un': return pat.op === n.op ? match(pat.a, n.a, holes) : null;
    case 'call': {
      if (pat.n !== n.n || pat.args.length !== n.args.length) return null;
      let h = holes;
      for (let i = 0; i < pat.args.length; i++) {
        h = match(pat.args[i], n.args[i], h);
        if (!h) return null;
      }
      return h;
    }
    case 'bin': {
      if (pat.op !== n.op) return null;
      const straight = (() => { const h = match(pat.l, n.l, holes); return h && match(pat.r, n.r, h); })();
      if (straight) return straight;
      if (!COMMUTATIVE.has(pat.op)) return null;
      const h = match(pat.l, n.r, holes);
      return h ? match(pat.r, n.l, h) : null;
    }
    case 'tern': {
      let h = match(pat.c, n.c, holes);
      h = h && match(pat.a, n.a, h);
      return h ? match(pat.b, n.b, h) : null;
    }
    default: return null;
  }
}

/** Does any node of the tree satisfy `pred`? */
export function some(n, pred) {
  if (pred(n)) return true;
  switch (n.k) {
    case 'field': return some(n.o, pred);
    case 'call': return n.args.some(a => some(a, pred));
    case 'un': return some(n.a, pred);
    case 'bin': return some(n.l, pred) || some(n.r, pred);
    case 'tern': return some(n.c, pred) || some(n.a, pred) || some(n.b, pred);
    default: return false;
  }
}

/** True when the tree reads `pos.y` (or whatever member you name). */
export const reads = (n, base, field) =>
  some(n, x => x.k === 'field' && x.f === field && x.o.k === 'id' && x.o.v === base);

// ── locals, resolved by definition ──────────────────────────────────────────

const TYPE_WORDS = new Set([
  'const', 'lowp', 'mediump', 'highp', 'attribute', 'varying', 'uniform', 'in', 'out', 'inout',
  'void', 'bool', 'int', 'uint', 'float', 'double',
  'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4',
  'mat2', 'mat3', 'mat4', 'sampler2D', 'samplerCube',
]);
const BLOCK_WORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'return', 'discard', 'break', 'continue']);

/**
 * What every local NAME means at the point `limit` (a token offset; by default
 * the end of the run).
 *
 * Values are `{ expr: tokens }` when the name is assigned exactly once, in a
 * straight line, by code this reader can see; otherwise `{ unsafe: why }`:
 *
 *   'reassigned'  written more than once — no single definition to substitute
 *   'conditional' written inside a nested block, so the value depends on flow
 *   'member'      only a member of it is written (`pos.y = …`), so the name is
 *                 not a value this reader may replace
 *   'interp'      a `${…}` region ran between the definition and here; the
 *                 substituted text is not in this file and may have rewritten it
 *   'declared'    declared without an initialiser
 *
 * The unsafe cases are the point of the function, not an edge: an unresolvable
 * local has to stay a symbol so the caller can decide, rather than quietly
 * resolving to whatever the last thing with that name was.
 */
export function collectEnv(src, base = new Map(), limit = Infinity) {
  const env = new Map(base);

  // Pre-pass over the WHOLE run, `limit` ignored: a name written more than
  // once, or one of whose MEMBERS is written (`pos.y = …`), is an accumulator
  // rather than a definition, and substituting it would make the reading depend
  // on where in the program you happened to stand. `vec3 pos = position;` is the
  // case that matters — before the first `pos.y = …` the two really are equal,
  // so a positional reader would rewrite the shipped write as
  // `position.y = (position.y + f) * uMorphProgress` and no pattern about pos.y
  // would match it.
  const seen = new Map();
  for (const s of splitStatements(src)) {
    const info = lvalueInfo(s);
    if (!info) continue;
    const c = seen.get(info.name) || { n: 0, member: false };
    c.n++;
    c.member = c.member || info.member;
    seen.set(info.name, c);
  }
  for (const [name, c] of seen) {
    if (c.member) env.set(name, { unsafe: 'member' });
    else if (c.n > 1) env.set(name, { unsafe: 'reassigned' });
  }
  const poison = why => {
    for (const [k, v] of env) if (!v.unsafe) env.set(k, { unsafe: why });
  };
  const set = (name, val) => {
    const prev = env.get(name);
    if (!prev) env.set(name, val);
    else if (!prev.unsafe) env.set(name, { unsafe: 'reassigned' });   // a second definition
    // …and an already-unsafe name stays unsafe, for the reason it first was.
  };

  for (const stmt of splitTopLevel(src)) {
    // `limit` is the offset of the statement being resolved. Statements at or
    // after it have not run yet, and reading them would be wrong in one
    // direction that matters: an interpolated `${…}` LATER in the program does
    // not invalidate a local that was used BEFORE it. Without this, splitting
    // the fragment ramp into two statements made the first one unresolvable —
    // because a `${…}` further down the same main() poisoned everything.
    if (stmt.length && stmt[0].p >= limit) break;
    if (stmt.some(t => t.t === 'interp')) poison('interp');

    // A nested block: everything it assigns becomes conditional.
    if (stmt.some(t => t.t === 'op' && t.v === '{') ||
        (stmt[0] && stmt[0].t === 'id' && BLOCK_WORDS.has(stmt[0].v))) {
      for (const inner of splitStatements(stmt)) {
        const name = lvalueName(inner);
        if (name) env.set(name, { unsafe: 'conditional' });
      }
      continue;
    }

    // Declarations and plain assignments.
    let i = 0;
    let isDecl = false;
    while (stmt[i] && stmt[i].t === 'id' && TYPE_WORDS.has(stmt[i].v)) { i++; isDecl = true; }
    if (isDecl) {
      // type name [= expr] (, name [= expr])*
      while (i < stmt.length) {
        const nameTok = stmt[i];
        if (!nameTok || nameTok.t !== 'id') break;
        i++;
        if (stmt[i] && stmt[i].t === 'op' && stmt[i].v === '=') {
          i++;
          const start = i;
          let depth = 0;
          while (i < stmt.length) {
            const tk = stmt[i];
            if (tk.t === 'op' && OPENERS.has(tk.v)) depth++;
            if (tk.t === 'op' && CLOSERS.has(tk.v)) depth--;
            if (tk.t === 'op' && tk.v === ',' && depth === 0) break;
            i++;
          }
          set(nameTok.v, { expr: stmt.slice(start, i) });
        } else {
          set(nameTok.v, { unsafe: 'declared' });
        }
        if (stmt[i] && stmt[i].t === 'op' && stmt[i].v === ',') { i++; continue; }
        break;
      }
      continue;
    }

    // `name = expr`, or a member/compound write, which is not a definition.
    if (stmt[0] && stmt[0].t === 'id') {
      if (stmt[1] && stmt[1].t === 'op' && stmt[1].v === '=') {
        set(stmt[0].v, { expr: stmt.slice(2) });
      } else {
        const name = lvalueName(stmt);
        if (name) env.set(name, { unsafe: stmt[1] && stmt[1].t === 'op' && stmt[1].v === '.' ? 'member' : 'reassigned' });
      }
    }
  }
  return env;
}

/** The base identifier a statement writes to, and whether it wrote a member. */
function lvalueInfo(stmt) {
  for (let i = 0; i < stmt.length; i++) {
    if (stmt[i].t !== 'id') continue;
    let k = i;
    while (stmt[k + 1] && stmt[k + 1].t === 'op' && stmt[k + 1].v === '.' && stmt[k + 2] && stmt[k + 2].t === 'id') k += 2;
    const after = stmt[k + 1];
    if (after && after.t === 'op' && ASSIGN_OPS.has(after.v)) {
      const before = stmt[i - 1];
      if (before && before.t === 'op' && before.v === '.') return null;
      return { name: stmt[i].v, member: k > i };
    }
  }
  return null;
}
const lvalueName = stmt => lvalueInfo(stmt)?.name ?? null;

/**
 * Substitute every local the tree depends on by its DEFINITION, recursively.
 * Names marked unsafe are left as symbols — a caller that cares must say what
 * it will accept a symbol to mean, which is the only honest thing to do with a
 * name whose value this reader cannot see.
 *
 * @returns {{tree: object, symbols: Map<string,string>}} symbols maps each
 *          surviving symbol to why it could not be resolved ('' = never defined)
 */
export function resolve(tree, env, depth = 0) {
  const symbols = new Map();
  const walk = (n, d) => {
    if (d > 32) throw new Error('local definitions are cyclic or nested past any sane depth');
    switch (n.k) {
      case 'id': {
        const def = env.get(n.v);
        if (!def) { symbols.set(n.v, ''); return n; }
        if (def.unsafe) { symbols.set(n.v, def.unsafe); return n; }
        const sub = walk(parseExpr(def.expr), d + 1);
        return sub;
      }
      case 'field': return { ...n, o: walk(n.o, d) };
      case 'call': return { ...n, args: n.args.map(a => walk(a, d)) };
      case 'un': return { ...n, a: walk(n.a, d) };
      case 'bin': return { ...n, l: walk(n.l, d), r: walk(n.r, d) };
      case 'tern': return { ...n, c: walk(n.c, d), a: walk(n.a, d), b: walk(n.b, d) };
      default: return n;
    }
  };
  return { tree: walk(tree, depth), symbols };
}

// ── finding a program in its source file ────────────────────────────────────

/**
 * The text of `const NAME = …\`…\`` — the WHOLE template literal, and the one
 * declared under exactly that name.
 *
 * Both halves are repairs of a measured hole. `lastIndexOf('const SE_VS_TEMPLATE')`
 * prefix-matches any longer identifier, so appending a decoy
 * `const SE_VS_TEMPLATE_REFERENCE = \`…correct text…\`` after the real one made
 * gpu-shape-y certify text that is not the shipped program (21/0 green on a tree
 * carrying the pre-round-10 defect). And the slice ran to end of file, which
 * pulls in every later program.
 */
export function templateLiteral(rawSrc, name) {
  // Comments blanked first (offsets preserved), so a commented-out declaration
  // is not a second declaration and prose inside the literal is not program.
  const src = stripComments(rawSrc);
  const decls = [...src.matchAll(new RegExp(`(^|[^A-Za-z0-9_$])(?:const|let|var)\\s+${name}(?![A-Za-z0-9_$])`, 'g'))];
  if (decls.length !== 1) {
    throw new Error(`expected exactly one declaration of ${name} in the source, found ${decls.length} — ` +
      `a second one is either dead text or a decoy, and this reader must not have to guess which`);
  }
  const at = decls[0].index + decls[0][1].length;
  const tick = src.indexOf('`', at);
  if (tick < 0) throw new Error(`${name} is not a template literal any more; this reader cannot bound it`);
  let i = tick + 1;
  for (; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '$' && src[i + 1] === '{') {           // an interpolation may hold backticks
      let d = 0;
      for (i = i + 1; i < src.length; i++) {
        if (src[i] === '{') d++;
        else if (src[i] === '}') { d--; if (d === 0) break; }
      }
      continue;
    }
    if (src[i] === '`') break;
  }
  if (i >= src.length) throw new Error(`${name}'s template literal is never closed`);
  return src.slice(tick + 1, i);
}

/** The body of `void main(){ … }` in a program, braces matched. */
export function mainBody(program) {
  const clean = stripComments(program);
  const head = clean.search(/void\s+main\s*\(\s*\)\s*\{/);
  if (head < 0) throw new Error('this program has no void main(){ … } for the reader to enter');
  const open = clean.indexOf('{', head);
  let d = 0;
  for (let k = open; k < clean.length; k++) {
    if (clean[k] === '{') d++;
    else if (clean[k] === '}') { d--; if (d === 0) return clean.slice(open + 1, k); }
  }
  throw new Error('void main() has unbalanced braces');
}

/**
 * `if (uMathMode == 0) { … } else { … }`, found on TOKENS so that spacing, line
 * breaks and the spelling of the literal are all irrelevant, plus everything
 * after it.
 *
 * The header used to be found with `indexOf('if(uMathMode==0){')` on a
 * whitespace-squeezed string. One space in `if (uMathMode == 0) {` turned
 * gpu-shape-y 7 red and colour-ramp 11 red — four of those being the two files'
 * own control assertions — under the message "the vertex program still branches
 * on uMathMode", which was false: it did.
 */
export function uMathModeBranch(program) {
  const toks = tokenize(mainBody(program));
  const found = findIfs(toks, 'uMathMode == 0');
  if (found.length === 0) {
    throw new Error('this vertex program has no if (uMathMode == 0) branch — spacing, line breaks, ' +
      'the spelling of the literal and the order of the comparison are all irrelevant to this ' +
      'reader, so the branch is genuinely not there');
  }
  const { close } = found[0];
  if (!(toks[close + 1] && toks[close + 1].v === '{')) {
    throw new Error('the uMathMode branch is not a { … } block; this reader will not guess how far ' +
      'a braceless branch reaches');
  }
  const gpuOpen = close + 1;                      // index of '{'
  const gpuClose = matchBrace(toks, gpuOpen);
  const elseTok = toks[gpuClose + 1];
  if (!(elseTok && elseTok.t === 'id' && elseTok.v === 'else' &&
        toks[gpuClose + 2] && toks[gpuClose + 2].v === '{')) {
    throw new Error('the uMathMode branch has no else block; the CPU path is where applyHeightField ' +
      'and the volume writers arrive, and it cannot be left unread');
  }
  const cpuOpen = gpuClose + 2;
  const cpuClose = matchBrace(toks, cpuOpen);
  return {
    gpu: toks.slice(gpuOpen + 1, gpuClose),
    cpu: toks.slice(cpuOpen + 1, cpuClose),
    tail: toks.slice(cpuClose + 1),
    preamble: toks.slice(0, found[0].at),
    // Everything the tail runs after, branch included: a statement out here
    // cannot resolve `pos` back to `position`, because both branches wrote to
    // it. Reading the tail against the PREAMBLE's environment instead would
    // quietly turn `vH = pos.y` into `vH = position.y` — a different claim.
    beforeTail: toks.slice(0, cpuClose + 1),
  };
}

/**
 * Every `if (…)` in the token stream whose CONDITION means the same thing as
 * `cond`, compared as parsed expressions. `if (0 == uMathMode)` counts, and so
 * does any amount of whitespace: what is being counted is the branch, not a
 * string somebody typed.
 */
export function findIfs(src, cond) {
  const toks = Array.isArray(src) ? src : tokenize(src);
  const want = print(parseExpr(cond));
  const out = [];
  for (let i = 0; i + 2 < toks.length; i++) {
    if (!(toks[i].t === 'id' && toks[i].v === 'if' && toks[i + 1].t === 'op' && toks[i + 1].v === '(')) continue;
    let d = 0, k = i + 1;
    for (; k < toks.length; k++) {
      if (toks[k].t === 'op' && toks[k].v === '(') d++;
      else if (toks[k].t === 'op' && toks[k].v === ')') { d--; if (d === 0) break; }
    }
    if (k >= toks.length) continue;
    let got;
    try { got = print(parseExpr(toks.slice(i + 2, k))); } catch { continue; }
    if (got === want) out.push({ at: i, close: k });
  }
  return out;
}

function matchBrace(toks, open) {
  let d = 0;
  for (let k = open; k < toks.length; k++) {
    if (toks[k].t !== 'op') continue;
    if (toks[k].v === '{') d++;
    else if (toks[k].v === '}') { d--; if (d === 0) return k; }
  }
  throw new Error('unbalanced braces in the vertex program');
}

/**
 * Every `void main(){ … }` body in a file, in source order — the fragment
 * shaders included. Used to find the colour ramp in the programs that SHIP it
 * rather than in prose that quotes it.
 *
 * @returns {{label: string, body: string, at: number}[]} `at` is the body's
 *          offset in stripComments(src), so a caller can splice the file and
 *          hand the result back to this same reader; `label` is the nearest
 *          preceding `const NAME =`, so a failure can name the program.
 */
export function mainBodies(src) {
  const clean = stripComments(src);
  const out = [];
  const re = /void\s+main\s*\(\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(clean))) {
    const open = clean.indexOf('{', m.index);
    let d = 0;
    for (let k = open; k < clean.length; k++) {
      if (clean[k] === '{') d++;
      else if (clean[k] === '}') {
        d--;
        if (d === 0) {
          const before = [...clean.slice(0, m.index).matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g)].pop();
          out.push({ label: before ? before[1] : '(unnamed)', body: clean.slice(open + 1, k), at: open + 1 });
          re.lastIndex = k;
          break;
        }
      }
    }
  }
  return out;
}

// ── the shipped vertex programs, read as MEANINGS ───────────────────────────
//
// Everything above is about GLSL in general. This last section is about the two
// programs this repository ships, and it lives here so that the two guards that
// read them cannot drift into disagreeing about what a write means.
//
// A form is written ONCE, as the source a human would write, and turned into a
// pattern by the same parser that reads the shipped file — so the table cannot
// be a list of spellings, and adding a space or a parenthesis to it changes
// nothing. `_D` is a hole: whatever the displacement happens to be.

const POS_FORMS = [
  // kind          assignment operator   right-hand side
  ['keeps',        '=',  '(pos.y + _D) * uMorphProgress'],
  ['keeps-out',    '=',  'pos.y * uMorphProgress + _D * uMorphProgress'],
  ['scale',        '=',  'pos.y * uMorphProgress'],
  ['replaces',     '=',  '_D * uMorphProgress'],
  ['no-deflate',   '+=', '_D * uMorphProgress'],
];
const VH_FORMS = [
  ['field',                '=', '_D * uMorphProgress'],
  ['height',               '=', 'pos.y'],
  ['height-scaled',        '=', 'pos.y * uMorphProgress'],
  ['field-cpu',            '=', '(uVHField == 1) ? (pos.y - aBaseY) * uMorphProgress : pos.y * uMorphProgress'],
  // FIX(r11): the three-state form. 2 says the CPU path left the field in its
  // own attribute, which is what it does now that the displacement follows the
  // surface normal — the subtraction under 1 would hand the ramp n_y·h. The
  // guard is told the meaning here, in one place, exactly as its own failure
  // message asks; the model that says what the meaning IS sits beside the table
  // in tests/colour-ramp.test.js.
  ['field-cpu-attr',       '=', '(uVHField == 2) ? aField * uMorphProgress : (uVHField == 1) ? (pos.y - aBaseY) * uMorphProgress : pos.y * uMorphProgress'],
  ['field-cpu-late',       '=', '(uVHField == 1) ? (pos.y - aBaseY * uMorphProgress) : pos.y'],
  ['field-cpu-unscaled',   '=', '(uVHField == 1) ? (pos.y - aBaseY) : pos.y * uMorphProgress'],
  ['field-unconditional',  '=', '(pos.y - aBaseY) * uMorphProgress'],
];
const compiled = forms => forms.map(([kind, op, src]) => ({ kind, op, pat: parseExpr(src) }));
const POS_PATS = compiled(POS_FORMS);
const VH_PATS = compiled(VH_FORMS);

/**
 * What a displacement expression is allowed to BE.
 *
 * The old guard kept a table of local names — `f` means the blended mode, `y`
 * means this frame's mode — so renaming the local broke it, and a local under
 * an expected name holding `0.0` was caught only because somebody thought to
 * list that one case. Here the name is irrelevant: the expression is resolved to
 * its definition first and then has to be one of two things.
 */
export function displacementKind(tree, symbols, interpName) {
  if (reads(tree, 'pos', 'y')) return null;              // that is a height, not a displacement
  if (tree.k === 'id' && symbols.get(tree.v) === 'interp') {
    // `interp` means only "a ${…} ran between this name's definition and here",
    // and in the editor template that is true of EVERY local declared above the
    // body — b, t, m, a, wi, T as well as y. Accepting any of them let the
    // colour write be pointed at the bass level while the geometry write still
    // used the body, and every guard stayed green. So the two writes of a
    // branch have to name the SAME interpolated local: the geometry write goes
    // first and fixes the name, the colour write has to agree with it.
    //
    // What this still does not catch, stated rather than hidden: changing BOTH
    // writes to the same other pre-body local. That program is self-consistent
    // and this reader cannot tell it from the shipped one; it would be drawing
    // and colouring by the bass level instead of the body, which is a different
    // defect from the one this file owns.
    if (interpName !== undefined && tree.v !== interpName) return null;
    return "the interpolated body's own y";
  }
  const isMode = (n, uniform) =>
    n.k === 'call' && n.n === 'computeMode' && n.args.length >= 2 &&
    n.args[0].k === 'id' && n.args[0].v === uniform &&
    n.args[1].k === 'field' && n.args[1].f === 'xz' && n.args[1].o.k === 'id' && n.args[1].o.v === 'pos';
  if (tree.k === 'call' && tree.n === 'mix' && tree.args.length === 3 &&
      isMode(tree.args[0], 'uMode') && isMode(tree.args[1], 'uModeNext') &&
      tree.args[2].k === 'id' && tree.args[2].v === 'uModeBlend') {
    return 'the blend of computeMode(uMode, pos.xz, …) and computeMode(uModeNext, pos.xz, …)';
  }
  return null;
}

function classify(pats, write, interpName) {
  if (!write.tree) return { ...write, kind: null };
  let near = null;                          // right shape, wrong thing in the hole
  for (const { kind, op, pat } of pats) {
    if (op !== write.op) continue;
    const holes = match(pat, write.tree);
    if (!holes) continue;
    if (!Object.hasOwn(holes, '_D')) return { ...write, kind, canon: print(write.tree) };
    const d = displacementKind(holes._D, write.symbols, interpName);
    if (!d) { near ??= { shape: kind, badDisplacement: print(holes._D) }; continue; }
    return { ...write, kind, displacement: d, dTree: holes._D, canon: print(write.tree) };
  }
  return { ...write, ...(near || {}), kind: null, canon: print(write.tree) };
}

/**
 * Read one vertex program: both branches of `if (uMathMode == 0)`, the pos.y
 * and vH write of each, and everything after the branch.
 *
 * Nothing here throws on a program it does not understand — it reports `kind:
 * null` and the caller decides. Every caller in this repo treats that as a
 * failure, which is the direction to be wrong in: an unrecognised write is a
 * refusal to certify, never a pass.
 */
export function readVertexProgram(programSrc) {
  const B = uMathModeBranch(programSrc);
  const outer = collectEnv(B.preamble);
  const branch = (block) => {
    // The geometry write is read first because it is the one that fixes which
    // interpolated local means "the body's own y"; the colour write then has to
    // agree with it. See displacementKind for why agreeing matters.
    const pos = classify(POS_PATS, assignmentIn(block, ['pos', 'y'], outer));
    const interpName = pos.dTree && pos.dTree.k === 'id' ? pos.dTree.v : undefined;
    return {
      pos,
      vh: classify(VH_PATS, assignmentIn(block, ['vH'], outer), interpName),
      stmts: splitStatements(block).map(text),
    };
  };
  return {
    gpu: branch(B.gpu),
    cpu: branch(B.cpu),
    tail: {
      stmts: splitStatements(B.tail).map(text),
      pos: splitStatements(B.tail).filter(s => assignsTo(s, ['pos', 'y'])).map(text),
      vh: splitStatements(B.tail).filter(s => assignsTo(s, ['vH'])).map(text),
      vhWrite: (() => {
        const w = splitStatements(B.tail).filter(s => assignsTo(s, ['vH']));
        if (!w.length) return null;
        return classify(VH_PATS, assignmentIn(w[w.length - 1], ['vH'], collectEnv(B.beforeTail)));
      })(),
    },
  };
}

/**
 * The palette ramp — `t = clamp((vH + off) * gain, lo, hi)` — as the FRAGMENT
 * PROGRAMS ship it, one entry per `void main(){…}` that computes one.
 *
 * Derived, never copied. colour-ramp.test.js used to carry a hand-written model
 * of this line and compare nothing to the source, so widening the window tenfold
 * in either fragment shader passed all fifteen guard files (wave-2 rows D10a and
 * D10b). Its replacement matched a regexp against the squeezed file text, which
 * failed the moment `.6` was respelled `0.6` — and it was the guard's own
 * control that failed, reporting that the parser was inventing numbers.
 *
 * Here the statement is parsed, its locals are resolved first (so splitting the
 * expression into two statements changes nothing), and the four numbers come out
 * of the tree. `span` is the statement's [start, end) in stripComments(src), so
 * a control can splice the real file and hand it back to this same reader.
 */
export function colourRamps(src) {
  const PAT = parseExpr('clamp((vH + _OFF) * _GAIN, _LO, _HI)');
  const out = [];
  for (const { label, body, at } of mainBodies(src)) {
    for (const stmt of splitStatements(body)) {
      const eq = stmt.findIndex(t => t.t === 'op' && t.v === '=');
      if (eq < 0) continue;
      let rhs;
      try { rhs = parseExpr(stmt.slice(eq + 1)); } catch { continue; }
      const { tree } = resolve(rhs, collectEnv(body, new Map(), stmt[0].p));
      const h = match(PAT, tree);
      if (!h) continue;
      const nums = ['_OFF', '_GAIN', '_LO', '_HI'].map(k => h[k]);
      if (nums.some(n => n.k !== 'num')) continue;
      const [s, e] = span(stmt);
      out.push({
        program: label,
        lhs: text(stmt.slice(0, eq)),
        off: Number(nums[0].v), gain: Number(nums[1].v),
        lo: Number(nums[2].v), hi: Number(nums[3].v),
        span: [at + s, at + e],
      });
    }
  }
  return out;
}

/**
 * The statement that assigns `path`, with every local it depends on resolved,
 * returned as a tree. `null` when nothing there assigns it.
 *
 * @param {Array} block   tokens of a block (a branch body, say)
 * @param {Array} path    ['pos','y'] or ['vH']
 * @param {Map}   env     what names mean on entry to the block
 */
export function assignmentIn(block, path, env = new Map()) {
  const writes = splitStatements(block).filter(s => assignsTo(s, path));
  if (writes.length !== 1) return { count: writes.length, writes: writes.map(text) };
  const stmt = writes[0];
  const inner = collectEnv(block, env, stmt[0].p);
  const eq = stmt.findIndex(t => t.t === 'op' && ASSIGN_OPS.has(t.v));
  const op = stmt[eq].v;
  const lhs = text(stmt.slice(0, eq));
  let rhs;
  try {
    rhs = parseExpr(stmt.slice(eq + 1));
  } catch (e) {
    return { count: 1, writes: [text(stmt)], unreadable: e.message };
  }
  if (lhs !== path.join('.')) {
    // A wrapped write — `if(…)pos.y=…` or `{pos.y=…` — is one statement whose
    // left side is not the lvalue. Report it rather than reading past it.
    return { count: 1, writes: [text(stmt)], wrapped: lhs };
  }
  const { tree, symbols } = resolve(rhs, inner);
  const at = splitStatements(block).findIndex(s => s === stmt);
  return { count: 1, stmt: text(stmt), op, tree, symbols, env: inner, raw: rhs, at };
}

/**
 * Every name a program DECLARES, and with which qualifier. An undeclared
 * identifier is a link failure — the whole visualisation goes black — and no
 * other test in this repo would see it, so the two guards that check for one
 * read the declarations rather than grepping for the word.
 */
export function declarations(programSrc) {
  const out = new Map();
  const QUAL = new Set(['uniform', 'attribute', 'varying', 'in', 'out', 'const']);
  for (const stmt of splitStatements(programSrc)) {
    if (!stmt.length || stmt[0].t !== 'id' || !QUAL.has(stmt[0].v)) continue;
    let i = 1;
    while (stmt[i] && stmt[i].t === 'id' && TYPE_WORDS.has(stmt[i].v)) i++;
    for (let k = i; k < stmt.length; k++) {
      if (stmt[k].t === 'id' && (k === i || (stmt[k - 1].t === 'op' && stmt[k - 1].v === ',')))
        out.set(stmt[k].v, stmt[0].v);
    }
  }
  return out;
}
