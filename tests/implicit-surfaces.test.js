// tests/implicit-surfaces.test.js
//
// Five bodies entered the catalogue on claims a viewer reads off the picker:
// twenty-four of twenty-seven lines, four nodes, degree four, triply periodic.
// Round 11's rule is that the picker entry IS the claim, because the caption is
// never rendered — so these are the claims, and this is where they are checked.
//
// Run:
//   node --test tests/implicit-surfaces.test.js
//
// ── What this guards ────────────────────────────────────────────────────────
//   clebsch     the 27 lines, FOUND rather than restated, and the four finite
//               Eckardt points where three of them meet
//   cayley      exactly four nodes, and that the shipped body stops short of
//               every one of them — which is what its label promises
//   chmutov     twelve nodes at degree four, and an extent that is exact
//               rather than clipped
//   gyroid      chirality: no coordinate plane is a mirror, where Schwarz P's
//               are — and each level set halves its cell
//   schwarz-p   no singular point, provable rather than sampled
//   all five    the mesh contract (components, Euler characteristic, rim) on
//               BOTH configurations, and that the field may travel along their
//               normals without folding them
//
// ── How it guards ───────────────────────────────────────────────────────────
// The polynomials are restated here rather than imported, the same rule
// tests/parametric-surfaces.test.js follows: an oracle that comes from the file
// under test moves when that file moves. What links the two is the other
// direction — every vertex of the mesh the app builds must satisfy the
// restated equation, so the shipped geometry answers to arithmetic written
// independently of it.
//
// Every property has a CONTROL that must come out the other way, and two of
// them are unusually strong because the control is another SHIPPED body: the
// line search that finds 24 on the Clebsch finds 6 on the Cayley, and the node
// search that finds 4 on the Cayley finds none on the Clebsch. They differ by
// one constant in one polynomial, so neither result can be an artefact of the
// search.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildGyroidGeo, buildSchwarzPGeo, buildChmutovGeo,
  buildClebschGeo, buildCayleyGeo,
} from '../src/implicit-surfaces.js';
import { marchingCubes } from '../src/marching-cubes.js';
import { RenderEngine } from '../src/render.js';
import { MathVisualizer } from '../src/math-visualizer.js';
import { applyHeightField } from '../src/math-collections.js';

// The worker bootstrap in MathVisualizer constructs one of these.
globalThis.Worker ??= class { postMessage() {} terminate() {} };
globalThis.requestAnimationFrame ??= (cb) => { void cb; return 0; };

// ── The oracles, restated ───────────────────────────────────────────────────
// Native coordinates. The shipped builders scale world into these; the scale is
// restated alongside each body and checked against the mesh.

/** The family both cubics come from. c = 5 is Clebsch, c = 1 is Cayley. */
const cubic = (c) => (u, v, w) => u * u + v * v + w * w - 2 * u * v * w - c;
const gradCubic = (u, v, w) => [2 * u - 2 * v * w, 2 * v - 2 * u * w, 2 * w - 2 * u * v];

const T4 = (t) => 8 * t ** 4 - 8 * t * t + 1;
const dT4 = (t) => 32 * t ** 3 - 16 * t;
const chmutov = (u, v, w) => T4(u) + T4(v) + T4(w);

const gyroid = (u, v, w) =>
  Math.sin(u) * Math.cos(v) + Math.sin(v) * Math.cos(w) + Math.sin(w) * Math.cos(u);
const schwarzP = (u, v, w) => Math.cos(u) + Math.cos(v) + Math.cos(w);

// The scales the shipped builders use, restated.
const S_CLEBSCH = 0.8;
const S_CAYLEY  = 0.5;
const S_CHMUTOV = 3.2 / Math.cosh(Math.acosh(2) / 4);
const K_TPMS    = Math.PI / 1.6;

// ── Small helpers ───────────────────────────────────────────────────────────

function edgeCensus(geo) {
  const ix = geo.index.array;
  const seen = new Map();
  for (let t = 0; t < ix.length; t += 3) {
    for (const [p, q] of [[ix[t], ix[t + 1]], [ix[t + 1], ix[t + 2]], [ix[t + 2], ix[t]]]) {
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  let boundary = 0, overused = 0;
  const rim = new Map();
  for (const [k, n] of seen) {
    if (n === 1) {
      boundary++;
      for (const v of k.split('_')) rim.set(v, (rim.get(v) || 0) + 1);
    } else if (n > 2) overused++;
  }
  const V = geo.attributes.position.count, E = seen.size, F = ix.length / 3;
  return { V, E, F, chi: V - E + F, boundary, overused, rim };
}

function components(geo) {
  const ix = geo.index.array, V = geo.attributes.position.count;
  const par = new Int32Array(V); for (let i = 0; i < V; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < ix.length; t += 3) {
    for (const [p, q] of [[ix[t], ix[t + 1]], [ix[t + 1], ix[t + 2]]]) {
      const ra = find(p), rb = find(q); if (ra !== rb) par[ra] = rb;
    }
  }
  const used = new Set();
  for (let i = 0; i < ix.length; i++) used.add(find(ix[i]));
  return used.size;
}

/** Worst |F| over the mesh's vertices, in native coordinates. */
function worstResidual(geo, F, scale) {
  const p = geo.attributes.position.array;
  let worst = 0;
  for (let i = 0; i < p.length; i += 3) {
    worst = Math.max(worst, Math.abs(F(p[i] * scale, p[i + 1] * scale, p[i + 2] * scale)));
  }
  return worst;
}

// ── The Clebsch cubic, and its 27 lines ─────────────────────────────────────

describe('the Clebsch cubic — the lines are found, not restated', () => {
  // The search is structural and needs nothing known in advance.
  //
  // Step one comes free from the polynomial's leading form, which is -2uvw. A
  // line u + t d lies in the surface only if the coefficient of t^3 vanishes,
  // and that coefficient IS the leading form evaluated at d: -2 d_u d_v d_w. So
  // every line on this surface has a direction with a zero component — it is
  // parallel to a coordinate plane. That turns a search over lines in space
  // into three searches inside a plane.
  //
  // Step two: a line parallel to the vw-plane lies in some slice u = a, and on
  // that slice the cubic becomes the CONIC v^2 + w^2 - 2avw + (a^2 - c). A conic
  // contains a line exactly when it is degenerate, i.e. when the determinant of
  // its matrix vanishes — and that determinant is a function of a alone, whose
  // roots this test finds by bisection rather than by being told them.

  /** The coefficients of the slice conic, read off F rather than recalled. */
  const sliceCoeffs = (F, a) => {
    const f00 = F(a, 0, 0);
    // The mixed second difference IS the vw coefficient — for k.vw it gives
    // k - 0 - 0 + 0 = k. (An earlier revision halved it here as well as in the
    // matrix below, and the search then found no lines at all on either cubic.)
    const cvw = F(a, 1, 1) - F(a, 1, 0) - F(a, 0, 1) + f00;
    const cv2 = (F(a, 1, 0) + F(a, -1, 0)) / 2 - f00;
    const cw2 = (F(a, 0, 1) + F(a, 0, -1)) / 2 - f00;
    return { f00, cvw, cv2, cw2 };
  };

  /** The conic's matrix determinant: zero exactly when it splits into lines. */
  const sliceDet = (F, a) => {
    const { f00, cvw, cv2, cw2 } = sliceCoeffs(F, a);
    //  | cv2      cvw/2    0   |
    //  | cvw/2    cw2      0   |
    //  | 0        0        f00 |
    return (cv2 * cw2 - (cvw / 2) ** 2) * f00;
  };

  /**
   * Slices whose conic degenerates, found by minimising |det| rather than by
   * hunting sign changes.
   *
   * The sign-change form works on the Clebsch, whose determinant
   * (1 - a^2)(a^2 - 5) has four simple roots, and is blind on the Cayley, whose
   * -(a^2 - 1)^2 only touches zero — which is precisely the CONTROL this search
   * has to survive. A double root is the surface having fewer distinct lines,
   * not fewer lines, so missing it would have made the control agree for the
   * wrong reason.
   */
  const degenerateSlices = (F) => {
    const roots = [];
    const N = 8000, LO = -4, HI = 4, step = (HI - LO) / N;
    const at = (i) => Math.abs(sliceDet(F, LO + i * step));
    for (let i = 1; i < N; i++) {
      if (!(at(i) <= at(i - 1) && at(i) <= at(i + 1))) continue;
      // Ternary search on |det| inside the bracket.
      let lo = LO + (i - 1) * step, hi = LO + (i + 1) * step;
      for (let k = 0; k < 200; k++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (Math.abs(sliceDet(F, m1)) < Math.abs(sliceDet(F, m2))) hi = m2; else lo = m1;
      }
      const a = (lo + hi) / 2;
      if (Math.abs(sliceDet(F, a)) > 1e-9) continue;
      if (!roots.some((r) => Math.abs(r - a) < 1e-6)) roots.push(a);
    }
    return roots;
  };

  /**
   * The two lines a degenerate slice splits into, as (point, direction) in the
   * slice's own plane. Solved from the conic, not looked up.
   */
  const linesOnSlice = (F, a) => {
    const { f00, cvw } = sliceCoeffs(F, a);
    // v^2 + w^2 + cvw.vw + f00 = 0. Write w = s.v + q and match coefficients:
    // 1 + cvw.s + s^2 = 0 gives the two slopes; then f00 + q^2 = 0 with the
    // cross terms fixing q. Both branches are covered by the discriminant.
    const disc = cvw * cvw - 4;
    if (disc < -1e-12) return [];
    const rt = Math.sqrt(Math.max(0, disc));
    const out = [];
    for (const s of [(-cvw + rt) / 2, (-cvw - rt) / 2]) {
      // Along w = s.v + q the quadratic part is (1 + cvw.s + s^2) v^2 = 0, so
      // the residual is (2s + cvw) q . v + (q^2 + f00). Both must vanish.
      const lin = 2 * s + cvw;
      if (Math.abs(lin) < 1e-9) {
        if (f00 > 1e-9) continue;
        for (const q of new Set([Math.sqrt(-f00), -Math.sqrt(-f00)])) {
          out.push({ point: [0, q], slope: s });
        }
      } else if (Math.abs(f00) < 1e-9) {
        out.push({ point: [0, 0], slope: s });
      }
    }
    return out;
  };

  /** All affine lines, in 3-space, as (point, unit direction). */
  const allLines = (c) => {
    const F3 = cubic(c);
    const lines = [];
    for (let axis = 0; axis < 3; axis++) {
      // Slice coordinate first, then the two in-plane ones, in cyclic order.
      const put = (a, p2, d2) => {
        const P = [0, 0, 0], D = [0, 0, 0];
        P[axis] = a; D[axis] = 0;
        P[(axis + 1) % 3] = p2[0]; P[(axis + 2) % 3] = p2[1];
        D[(axis + 1) % 3] = d2[0]; D[(axis + 2) % 3] = d2[1];
        const n = Math.hypot(...D);
        lines.push({ point: P, dir: D.map((x) => x / n) });
      };
      const sliced = (a, v, w) => {
        const q = [0, 0, 0];
        q[axis] = a; q[(axis + 1) % 3] = v; q[(axis + 2) % 3] = w;
        return F3(...q);
      };
      for (const a of degenerateSlices((aa, v, w) => sliced(aa, v, w))) {
        for (const L of linesOnSlice((aa, v, w) => sliced(aa, v, w), a)) {
          put(a, [L.point[0], L.point[1]], [1, L.slope]);
        }
      }
    }
    // Dedupe by a canonical (direction, moment) — the Plucker pair.
    const seen = new Map();
    for (const L of lines) {
      let d = L.dir.slice();
      const lead = d.find((x) => Math.abs(x) > 1e-9);
      if (lead < 0) d = d.map((x) => -x);
      const p = L.point;
      const m = [p[1] * d[2] - p[2] * d[1], p[2] * d[0] - p[0] * d[2], p[0] * d[1] - p[1] * d[0]];
      const key = [...d, ...m].map((x) => (Math.abs(x) < 1e-7 ? 0 : x).toFixed(6)).join(',');
      if (!seen.has(key)) seen.set(key, { point: p, dir: d });
    }
    return [...seen.values()];
  };

  test('every line on this surface is parallel to a coordinate plane', () => {
    // The leading form is -2uvw, so the t^3 coefficient of F(p + t d) is
    // -2 d_u d_v d_w and cannot vanish unless a component of d does. Checked by
    // evaluating the cubic's leading behaviour rather than by reading it off.
    const F = cubic(5);
    const big = 1e6;
    // F(s.d)/s^3 = -2 d_u d_v d_w + |d|^2/s - 5/s^3, so the whole of the
    // non-cubic part is bounded by |d|^2/s + 5/s^3 — stated rather than
    // guessed, because a tolerance pulled out of the air is how a test starts
    // measuring the size of a number instead of its identity.
    const slack = (d) => (d[0] ** 2 + d[1] ** 2 + d[2] ** 2) / big + 5 / big ** 3;
    for (const d of [[1, 1, 1], [1, 2, 3], [0.3, -0.7, 0.5]]) {
      const lead = F(d[0] * big, d[1] * big, d[2] * big) / big ** 3;
      assert.ok(Math.abs(lead + 2 * d[0] * d[1] * d[2]) < 10 * slack(d),
        `the leading form is not -2uvw (read ${lead}), and the whole search below rests on it`);
      assert.ok(Math.abs(lead) > 100 * slack(d),
        `a direction with no zero component gives leading coefficient ${lead}`);
    }
    for (const d of [[0, 1, 1], [1, 0, 2], [1, 3, 0]]) {
      assert.ok(Math.abs(F(d[0] * big, d[1] * big, d[2] * big) / big ** 3) < 10 * slack(d),
        'a direction with a zero component should kill the leading form');
    }
  });

  test('twenty-four affine lines, and every one of them lies in the surface', () => {
    const F = cubic(5);
    const lines = allLines(5);
    assert.equal(lines.length, 24, `the search found ${lines.length} affine lines, not 24`);
    let worst = 0;
    for (const L of lines) {
      for (let t = -4; t <= 4; t += 0.1) {
        const p = L.point.map((x, i) => x + t * L.dir[i]);
        worst = Math.max(worst, Math.abs(F(...p)));
      }
    }
    assert.ok(worst < 1e-9, `a "line" leaves the surface by ${worst.toExponential(2)}`);
  });

  test('twelve of them stand at sqrt(3) from the origin and twelve at sqrt(5)', () => {
    const dist = (L) => {
      const d = L.dir, p = L.point;
      const t = -(p[0] * d[0] + p[1] * d[1] + p[2] * d[2]);
      return Math.hypot(...p.map((x, i) => x + t * d[i]));
    };
    const ds = allLines(5).map(dist).sort((a, b) => a - b);
    const near = ds.filter((d) => Math.abs(d - Math.SQRT2 * Math.sqrt(1.5)) < 1e-6);
    const far  = ds.filter((d) => Math.abs(d - Math.sqrt(5)) < 1e-6);
    assert.equal(near.length, 12, `${near.length} lines at sqrt(3), not 12`);
    assert.equal(far.length, 12, `${far.length} lines at sqrt(5), not 12`);
    // The clip the app ships must reach past the farther twelve, or the label's
    // "24 of its 27 lines" is a claim about something off screen. Native 2.56.
    assert.ok(Math.sqrt(5) < 3.2 * S_CLEBSCH,
      `the shipped box reaches ${(3.2 * S_CLEBSCH).toFixed(3)} and the far lines stand at ${Math.sqrt(5).toFixed(3)}`);
  });

  test('three lines meet at each of the four finite Eckardt points', () => {
    // An Eckardt point is where three of the 27 meet, and the Clebsch is the
    // unique smooth cubic with exactly ten of them (Segre). Six are at infinity
    // and out of reach here; the four finite ones are the vertices of a regular
    // tetrahedron, which this test measures rather than assumes.
    const lines = allLines(5);
    const on = (L, p) => {
      const w = p.map((x, i) => x - L.point[i]);
      const t = w[0] * L.dir[0] + w[1] * L.dir[1] + w[2] * L.dir[2];
      return Math.hypot(...w.map((x, i) => x - t * L.dir[i])) < 1e-7;
    };
    const hits = new Map();
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        // Closest approach; keep it only if the two really meet.
        const [A, B] = [lines[i], lines[j]];
        const w0 = A.point.map((x, k) => x - B.point[k]);
        const a = 1, b = A.dir.reduce((s, x, k) => s + x * B.dir[k], 0), cc = 1;
        const d = A.dir.reduce((s, x, k) => s + x * w0[k], 0);
        const e = B.dir.reduce((s, x, k) => s + x * w0[k], 0);
        const den = a * cc - b * b;
        if (Math.abs(den) < 1e-9) continue;
        const s = (b * e - cc * d) / den, t = (a * e - b * d) / den;
        const P = A.point.map((x, k) => x + s * A.dir[k]);
        const Q = B.point.map((x, k) => x + t * B.dir[k]);
        if (Math.hypot(...P.map((x, k) => x - Q[k])) > 1e-7) continue;
        const key = P.map((x) => (Math.abs(x) < 1e-7 ? 0 : x).toFixed(5)).join(',');
        hits.set(key, P);
      }
    }
    const eckardt = [...hits.values()].filter((P) => lines.filter((L) => on(L, P)).length >= 3);
    assert.equal(eckardt.length, 4, `${eckardt.length} points carry three or more lines, not 4`);
    for (const P of eckardt) {
      assert.ok(Math.abs(Math.hypot(...P) - Math.sqrt(3)) < 1e-6,
        `an Eckardt point stands at ${Math.hypot(...P).toFixed(4)}, not sqrt(3)`);
      assert.ok(P.every((x) => Math.abs(Math.abs(x) - 1) < 1e-6),
        'an Eckardt point is not a vertex of the unit-signed tetrahedron');
      assert.equal(P.filter((x) => x < 0).length % 2, 1,
        'the finite Eckardt points are the vertices with an ODD number of minus signs');
    }
  });

  test('CONTROL — the same search on the shipped Cayley cubic finds 6, not 24', () => {
    // One constant apart. If the search were finding what it was told to find,
    // this would come back 24 as well.
    const lines = allLines(1);
    assert.equal(lines.length, 6, `the Cayley cubic gave ${lines.length} affine lines, not 6`);
    const F = cubic(1);
    let worst = 0;
    for (const L of lines) {
      for (let t = -3; t <= 3; t += 0.1) {
        worst = Math.max(worst, Math.abs(F(...L.point.map((x, i) => x + t * L.dir[i]))));
      }
    }
    assert.ok(worst < 1e-9, 'the six lines it did find do not lie in the Cayley cubic either');
  });
});

// ── The Cayley cubic, and the nodes it stops short of ───────────────────────

describe('the Cayley cubic — four nodes, and a body that stops before them', () => {
  /** Points where F and all three partials vanish, found by search. */
  const nodes = (c) => {
    const F = cubic(c);
    const found = [];
    // The critical points of this family are (0,0,0) and the eight signed unit
    // triples; search rather than assert, over a lattice wide enough to hold
    // anything the family can produce.
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        for (let k = -3; k <= 3; k++) {
          let p = [i / 2, j / 2, k / 2];
          for (let n = 0; n < 200; n++) {
            const g = gradCubic(...p);
            // Newton on grad F = 0; the Hessian of this family is explicit.
            const H = [[2, -2 * p[2], -2 * p[1]],
                       [-2 * p[2], 2, -2 * p[0]],
                       [-2 * p[1], -2 * p[0], 2]];
            const det = H[0][0] * (H[1][1] * H[2][2] - H[1][2] * H[2][1])
                      - H[0][1] * (H[1][0] * H[2][2] - H[1][2] * H[2][0])
                      + H[0][2] * (H[1][0] * H[2][1] - H[1][1] * H[2][0]);
            if (Math.abs(det) < 1e-12) break;
            const inv = (r, cc) => {
              const m = [0, 1, 2].filter((x) => x !== cc), n2 = [0, 1, 2].filter((x) => x !== r);
              const s = ((r + cc) % 2 ? -1 : 1);
              return s * (H[m[0]][n2[0]] * H[m[1]][n2[1]] - H[m[0]][n2[1]] * H[m[1]][n2[0]]) / det;
            };
            const step = [0, 1, 2].map((r) => [0, 1, 2].reduce((s, cc) => s + inv(r, cc) * g[cc], 0));
            p = p.map((x, r) => x - step[r]);
            if (Math.hypot(...step) < 1e-14) break;
          }
          if (!p.every(Number.isFinite) || Math.hypot(...p) > 5) continue;
          if (Math.hypot(...gradCubic(...p)) > 1e-8) continue;
          if (Math.abs(F(...p)) > 1e-8) continue;
          if (!found.some((q) => Math.hypot(...q.map((x, r) => x - p[r])) < 1e-5)) found.push(p);
        }
      }
    }
    return found;
  };

  test('exactly four points where the value and all three partials vanish', () => {
    const ns = nodes(1);
    assert.equal(ns.length, 4, `found ${ns.length} nodes on the Cayley cubic, not 4`);
    for (const p of ns) {
      assert.ok(Math.abs(Math.hypot(...p) - Math.sqrt(3)) < 1e-6,
        `a node stands at ${Math.hypot(...p).toFixed(6)}, not sqrt(3)`);
      assert.equal(p.filter((x) => x < 0).length % 2, 0,
        'the nodes are the signed unit triples with an EVEN number of minus signs');
    }
  });

  test('CONTROL — the same search finds no node on the Clebsch', () => {
    // Four is the most a cubic surface can have, and a surface with any at all
    // cannot have 27 distinct lines — so this control and the line count above
    // are two readings of the same fact.
    assert.equal(nodes(5).length, 0, 'the Clebsch is supposed to be smooth');
  });

  test('the shipped body stops short of every node, as its label says', () => {
    const geo = buildCayleyGeo(64);
    const ns = nodes(1).map((p) => p.map((x) => x / S_CAYLEY));   // native -> world
    const pos = geo.attributes.position.array;
    let closest = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      for (const n of ns) {
        closest = Math.min(closest, Math.hypot(pos[i] - n[0], pos[i + 1] - n[1], pos[i + 2] - n[2]));
      }
    }
    // The clip is at world 3.2 and the nodes are at world sqrt(3)/0.5 = 3.464,
    // so nothing drawn may come within their difference of a node.
    assert.ok(closest > 0.2,
      `the mesh reaches within ${closest.toFixed(4)} of a node; the label promises it does not reach one`);
    assert.ok(closest < 0.6,
      `the mesh stops ${closest.toFixed(4)} short — that is not "clipped before its nodes", it is a different body`);
  });
});

// ── The Chmutov surface ─────────────────────────────────────────────────────

describe('the Chmutov surface of degree four', () => {
  /**
   * The critical points of T_4, found by minimising |T_4'| rather than solved.
   *
   * Hunting sign changes on a scan misses t = 0 whenever the scan lands on it
   * exactly, which a symmetric grid does — that cost this file a false reading
   * of "two critical points, both of value -1", from which "the level-0 set has
   * no nodes" followed for the wrong reason. Minimising catches all three.
   */
  const critT4 = () => {
    const N = 20000, LO = -1.2, step = 2.4 / N;
    const at = (i) => Math.abs(dT4(LO + i * step));
    const out = [];
    for (let i = 1; i < N; i++) {
      if (!(at(i) <= at(i - 1) && at(i) <= at(i + 1))) continue;
      let lo = LO + (i - 1) * step, hi = LO + (i + 1) * step;
      for (let k = 0; k < 200; k++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (Math.abs(dT4(m1)) < Math.abs(dT4(m2))) hi = m2; else lo = m1;
      }
      const t = (lo + hi) / 2;
      if (Math.abs(dT4(t)) < 1e-9 && !out.some((r) => Math.abs(r - t) < 1e-6)) out.push(t);
    }
    return out.sort((a, b) => a - b);
  };

  test('the level SHIPPED is the smooth one, and that is provable in one line', () => {
    // T_4 has three critical points: 0 with value +1, and +-1/sqrt2 with value
    // -1. Three of those sum to 3, 1, -1 or -3 — never to 0 — so the level-0
    // set has no singular point at all. This is the claim the picker's
    // "(smooth level set)" is making, and it is exact rather than sampled.
    const crit = critT4();
    assert.equal(crit.length, 3, `T_4 has ${crit.length} critical points, not 3`);
    const vals = crit.map((t) => T4(t));
    assert.deepEqual(vals.map((v) => Math.round(v * 1e9) / 1e9), [-1, 1, -1],
      'the critical values of T_4 are not (-1, +1, -1)');
    const sums = new Set();
    for (const a of vals) for (const b of vals) for (const c of vals) sums.add(Math.round(a + b + c));
    assert.deepEqual([...sums].sort((x, y) => x - y), [-3, -1, 1, 3],
      'the reachable sums of three critical values are not what the smoothness argument needs');
    assert.ok(!sums.has(0), 'a sum of three critical values reaches zero, so the shipped level is NOT smooth');
  });

  test('CONTROL — the nodal level is level -1, and it carries exactly twelve', () => {
    // Without this, the test above would read as "this polynomial has no nodes
    // anywhere", which is false and would make the smoothness claim sound like
    // an accident rather than a choice of level. Twelve is Chmutov's own count
    // for d = 4: three choices of which coordinate sits at 0, times 2 x 2 for
    // the other two.
    const crit = critT4();
    let n = 0;
    for (const a of crit) for (const b of crit) for (const c of crit) {
      if (Math.abs(T4(a) + T4(b) + T4(c) + 1) < 1e-9) n++;
    }
    assert.equal(n, 12, `the level -1 set carries ${n} nodes, not the twelve Chmutov's count gives`);
  });

  test('and the nodal level is why it is not shipped — it will not stand still', () => {
    // Measured, because "nodes are hard to mesh" is not a reason, it is a
    // rumour. The level -1 body gives 6, 8, 6, 8, 7, 8, 7, 7 connected
    // components over resolutions 32 to 96, so desktop (7) and mobile (6) would
    // draw different surfaces. The level shipped gives one component at every
    // one of them. Two resolutions are enough to show the split here; the full
    // sweep is in notes/audits/vimathic-wave-b-2026-08-30/params/CHMUTOV.mjs.
    const sNodal = 3.2 / Math.cosh(Math.acosh(3) / 4);
    const nodal = (x, y, z) => T4(x / sNodal) + T4(y / sNodal) + T4(z / sNodal) + 1;
    const comps = [64, 48].map((res) => {
      const geo = marchingCubes(nodal, { res, bounds: 3.3 });
      const n = components(geo);
      geo.dispose();
      return n;
    });
    assert.notEqual(comps[0], comps[1],
      `the nodal level gave ${comps[0]} components at res 64 and ${comps[1]} at 48 — if these ever agree, ` +
      'the reason for shipping level 0 has gone and this body should be revisited');
    for (const res of [64, 48]) {
      const geo = buildChmutovGeo(res);
      assert.equal(components(geo), 1, `the shipped level gave ${components(geo)} components at res ${res}`);
      geo.dispose();
    }
  });

  test('the body ends exactly where its scale says, with no clip involved', () => {
    // T_d exceeds 1 outside [-1, 1] at even degree, and the equation needs the
    // three terms to sum to zero, so no point of the surface can leave the cube.
    // The scale is chosen so the extreme point lands exactly on 3.2, which is
    // why this body needs no clipping shell and has no rim.
    const geo = buildChmutovGeo(64);
    const p = geo.attributes.position.array;
    let worst = 0;
    for (let i = 0; i < p.length; i++) worst = Math.max(worst, Math.abs(p[i]));
    assert.ok(worst <= 3.2 + 1e-6, `the body reaches ${worst.toFixed(6)}, past the 3.2 its scale allows`);
    assert.ok(worst > 3.15, `the body only reaches ${worst.toFixed(6)}; the scale is meant to make it exactly 3.2`);
    assert.equal(edgeCensus(geo).boundary, 0, 'this body closes on its own and must have no rim');
  });
});

// ── The two triply periodic surfaces ────────────────────────────────────────

describe('the gyroid and Schwarz P', () => {
  // Every walk below steps the same lattice inline: 24^3 points at 0.31 apart,
  // offset off the grid so no sample lands on a zero of either field.

  test('both fields are invariant under the 3-cycle (x, y, z) -> (y, z, x)', () => {
    for (const [name, F] of [['gyroid', gyroid], ['schwarz-p', schwarzP]]) {
      let worst = 0, scale = 0;
      for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) for (let k = 0; k < 24; k++) {
        const p = [0.017 + i * 0.31, 0.031 + j * 0.31, 0.043 + k * 0.31];
        worst = Math.max(worst, Math.abs(F(...p) - F(p[1], p[2], p[0])));
        scale = Math.max(scale, Math.abs(F(...p)));
      }
      assert.ok(worst / scale < 1e-12, `${name} moves by ${(worst / scale).toExponential(2)} under the 3-cycle`);
    }
  });

  test('CONTROL — one term rewritten breaks that invariance', () => {
    const broken = (u, v, w) =>
      Math.sin(u) * Math.cos(v) + Math.sin(v) * Math.cos(w) + Math.sin(w) * Math.sin(u);
    let worst = 0;
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) for (let k = 0; k < 24; k++) {
      const p = [0.017 + i * 0.31, 0.031 + j * 0.31, 0.043 + k * 0.31];
      worst = Math.max(worst, Math.abs(broken(...p) - broken(p[1], p[2], p[0])));
    }
    assert.ok(worst > 0.5, 'the invariance check cannot tell a broken field from the real one');
  });

  test('each level set halves its cell', () => {
    for (const [name, F] of [['gyroid', gyroid], ['schwarz-p', schwarzP]]) {
      let below = 0, n = 0;
      const N = 60, TAU = Math.PI * 2;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
        const p = [(i + 0.5) / N * TAU, (j + 0.5) / N * TAU, (k + 0.5) / N * TAU];
        if (F(...p) < 0) below++;
        n++;
      }
      assert.ok(Math.abs(below / n - 0.5) < 2e-3,
        `${name} puts ${(100 * below / n).toFixed(3)} % of its cell below zero, not half`);
    }
  });

  test('CONTROL — the same count on a shifted level is not a half', () => {
    let below = 0, n = 0;
    const N = 60, TAU = Math.PI * 2;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      if (gyroid((i + 0.5) / N * TAU, (j + 0.5) / N * TAU, (k + 0.5) / N * TAU) < 0.5) below++;
      n++;
    }
    assert.ok(Math.abs(below / n - 0.5) > 0.05, 'the volume count would read a half on anything');
  });

  test('Schwarz P has coordinate mirror planes and the gyroid has none', () => {
    // The chirality of the gyroid, stated as something checkable. Reflecting a
    // coordinate leaves Schwarz P identical, because cos is even. The gyroid is
    // neither identical nor negated, so that reflection is not a symmetry of it
    // — which is why the mirror image of a gyroid is the OTHER gyroid.
    const pts = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) for (let k = 0; k < 12; k++) {
      pts.push([0.017 + i * 0.53, 0.031 + j * 0.53, 0.043 + k * 0.53]);
    }
    let worstP = 0;
    for (const [x, y, z] of pts) worstP = Math.max(worstP, Math.abs(schwarzP(-x, y, z) - schwarzP(x, y, z)));
    assert.ok(worstP < 1e-12, `Schwarz P is meant to be mirror-symmetric and moves by ${worstP.toExponential(2)}`);

    let same = 0, negated = 0;
    for (const [x, y, z] of pts) {
      same = Math.max(same, Math.abs(gyroid(-x, y, z) - gyroid(x, y, z)));
      negated = Math.max(negated, Math.abs(gyroid(-x, y, z) + gyroid(x, y, z)));
    }
    assert.ok(same > 0.5 && negated > 0.5,
      `the gyroid matches its own reflection to ${Math.min(same, negated).toExponential(2)} — it would not be chiral`);
  });

  test('Schwarz P has no singular point, and the proof is one line', () => {
    // grad P = (-sin x, -sin y, -sin z) vanishes only where every coordinate is
    // a multiple of pi, and there P is +-1 +-1 +-1, which is never 0. Checked by
    // enumerating those points rather than by sampling for near-misses, which is
    // what makes this the strongest smoothness claim in the file.
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
      const p = [a * Math.PI, b * Math.PI, c * Math.PI];
      assert.ok(Math.hypot(Math.sin(p[0]), Math.sin(p[1]), Math.sin(p[2])) < 1e-12,
        'these are supposed to be exactly the critical points');
      assert.ok(Math.abs(schwarzP(...p)) >= 1 - 1e-9,
        `a critical point of Schwarz P has value ${schwarzP(...p)}, so the surface passes through it`);
    }
  });
});

// ── The meshes the app actually builds ──────────────────────────────────────

describe('the five meshes, on both configurations', () => {
  const BODIES = [
    { key: 'gyroid',    build: buildGyroidGeo,   F: (u, v, w) => gyroid(u, v, w),   s: K_TPMS, tol: 0.09 },
    { key: 'schwarz-p', build: buildSchwarzPGeo, F: (u, v, w) => schwarzP(u, v, w), s: K_TPMS, tol: 0.09 },
    { key: 'chmutov',   build: buildChmutovGeo,  F: chmutov,                        s: 1 / S_CHMUTOV, tol: 0.09 },
    { key: 'clebsch',   build: buildClebschGeo,  F: cubic(5),                       s: S_CLEBSCH, tol: 0.09 },
  ];

  test('every vertex satisfies the equation restated in this file', () => {
    // This is the link between the independent oracle above and the shipped
    // code: the polynomials here were written without reading the module, and
    // the module's own meshes have to answer to them. `cayley` is left out
    // because its clipping ball contributes vertices that are deliberately NOT
    // on the cubic — the test below counts those instead.
    for (const b of BODIES) {
      const geo = b.build(64);
      const worst = worstResidual(geo, b.F, b.s);
      assert.ok(worst < b.tol,
        `${b.key}: a vertex sits ${worst.toFixed(5)} off its own surface, past the ${b.tol} a cell can explain`);
      geo.dispose();
    }
  });

  test('the clipped Cayley is the cubic everywhere except on its ball', () => {
    const geo = buildCayleyGeo(64);
    const p = geo.attributes.position.array;
    let onCubic = 0, onBall = 0, neither = 0;
    for (let i = 0; i < p.length; i += 3) {
      const cub = Math.abs(cubic(1)(p[i] * S_CAYLEY, p[i + 1] * S_CAYLEY, p[i + 2] * S_CAYLEY)) < 0.09;
      const ball = Math.abs(Math.hypot(p[i], p[i + 1], p[i + 2]) - 3.2) < 0.09;
      if (cub) onCubic++; else if (ball) onBall++; else neither++;
    }
    assert.equal(neither, 0, `${neither} vertices are on neither the cubic nor the clipping ball`);
    // The clip is a formality on this body, which is why it may be closed while
    // the gyroid may not: measured 0.2 % of its area.
    assert.ok(onBall / (onCubic + onBall) < 0.02,
      `${(100 * onBall / (onCubic + onBall)).toFixed(1)} % of the vertices are the clipping ball, not the cubic`);
    geo.dispose();
  });

  test('components, Euler characteristic and rim agree on desktop and mobile', () => {
    // A body that is topologically different on a phone is not one body. This
    // retired the Barth sextic from wave B: its 50 nodes gave component counts
    // of 4, 23, 23, 4, 17, 26, 10, 29 and 29 across resolutions 32 to 128.
    const WANT = {
      gyroid:      { comp: 1, chi: -53, bnd: [2272, 1704] },
      'schwarz-p': { comp: 1, chi: -32, bnd: [1600, 1216] },
      chmutov:     { comp: 1, chi:  -8, bnd: [0, 0] },
      clebsch:     { comp: 1, chi:  -2, bnd: [660, 500] },
      cayley:      { comp: 1, chi:   2, bnd: [0, 0] },
    };
    const builders = { gyroid: buildGyroidGeo, 'schwarz-p': buildSchwarzPGeo,
                       chmutov: buildChmutovGeo, clebsch: buildClebschGeo, cayley: buildCayleyGeo };
    for (const [key, want] of Object.entries(WANT)) {
      for (const [i, res] of [64, 48].entries()) {
        const geo = builders[key](res);
        const c = edgeCensus(geo);
        assert.equal(c.overused, 0, `${key} res ${res}: ${c.overused} edges belong to more than two triangles`);
        assert.equal(components(geo), want.comp, `${key} res ${res}: ${components(geo)} components, not ${want.comp}`);
        assert.equal(c.chi, want.chi, `${key} res ${res}: chi ${c.chi}, not ${want.chi}`);
        assert.equal(c.boundary, want.bnd[i], `${key} res ${res}: ${c.boundary} boundary edges, not ${want.bnd[i]}`);
        // A rim is a set of closed curves; a hole is not. Every boundary vertex
        // sitting on exactly two boundary edges is what tells them apart, and
        // it is the check that makes pinning the count above meaningful.
        for (const [, deg] of c.rim) {
          assert.equal(deg, 2, `${key} res ${res}: a boundary vertex has ${deg} boundary edges, so the rim is torn`);
        }
        geo.dispose();
      }
    }
  });

  test('the mesher reports nothing to worry about on any of them', () => {
    const builders = [buildGyroidGeo, buildSchwarzPGeo, buildChmutovGeo, buildClebschGeo, buildCayleyGeo];
    for (const b of builders) {
      for (const res of [64, 48]) {
        const geo = b(res);
        const mc = geo.userData.mc;
        assert.equal(mc.exactIso, 0, 'a sample landed exactly on the isolevel');
        assert.equal(mc.degenerate, 0, 'a zero-area triangle was emitted');
        assert.equal(mc.zeroNormals, 0, 'a vertex has no normal, so the field cannot move it');
        geo.dispose();
      }
    }
  });
});

// ── The deformation path ────────────────────────────────────────────────────

describe('the field may travel along these bodies\' own normals', () => {
  const vizFor = (name, isMobile) => {
    const stub = {
      CFG: { planeSize: 7, planeSegs: isMobile ? 80 : 160 }, isMobile,
      isShapeChanging: false, pendingShape: null, currentShape: 'plane',
      gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) }, gpuPtsProxy: null, cb: {},
      clearSolarSystem() {}, _buildSolarSystem() {},
      _buildShapeGeo: RenderEngine.prototype._buildShapeGeo,
      _buildStarGeo: RenderEngine.prototype._buildStarGeo,
      setShape: RenderEngine.prototype.setShape,
    };
    stub.setShape(name);
    const render = {
      isMobile,
      U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 }, uVHField: { value: 0 } },
      gpuMesh: { geometry: stub.gpuMesh.geometry }, gpuPtsProxy: null, cb: {},
    };
    const viz = new MathVisualizer(render, { bass: 0, mid: 0, treble: 0, beatInt: 0, amp: 0.7, waveInt: 1 });
    viz._workerReady = false;
    viz.onShapeChange();
    return { viz, geo: stub.gpuMesh.geometry };
  };

  const faceNormals = (geo) => {
    const p = geo.attributes.position, idx = geo.index, out = [];
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
      const ux = p.getX(b) - ax, uy = p.getY(b) - ay, uz = p.getZ(b) - az;
      const vx = p.getX(c) - ax, vy = p.getY(c) - ay, vz = p.getZ(c) - az;
      out.push([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
    }
    return out;
  };

  const NAMES = ['gyroid', 'schwarz-p', 'chmutov', 'clebsch', 'cayley'];

  test('all five keep the VERTICAL rule, the same way on desktop and mobile', () => {
    // Not the outcome this wave expected. All five clear the first two gates —
    // none is a thin plate, and none has hard edges, which is the return on the
    // mesher emitting INDEXED geometry — and all five cleared the medial-radius
    // cap too, at 0.507 to 1.485 against a threshold of 0.3. They fold anyway;
    // the test below is the measurement that settles it. What puts them here is
    // foldRadius in src/math-visualizer.js.
    //
    // A body that took a different path on a phone than on a desktop would be a
    // defect of its own, so both are asserted rather than one.
    //
    // `assert.ok(x === null)` and never `assert.equal(x, null)` — the rule three
    // other files in this suite already carry (shape-hook-lifetime.test.js:384,
    // recorder-capture-lifetime, blend-from-state), and the one place it was
    // forgotten cost two VMs. _pristineNormals is a Float32Array of 121 569
    // floats on the desktop gyroid, so the FAILING branch of assert.equal
    // formats it through util.inspect and diffs it: measured 2.4 GB of resident
    // memory in under six seconds, which is enough for the host to kill the
    // whole guest before node reaches its own heap limit. The trap only springs
    // when the test is RIGHT, which is the worst possible time for it.
    for (const name of NAMES) {
      for (const isMobile of [false, true]) {
        const { viz } = vizFor(name, isMobile);
        const where = isMobile ? 'mobile' : 'desktop';
        assert.ok(viz._pristineNormals === null,
          `${name} (${where}) went down the normal path with a cap of ${viz._pristineDepth}`);
      }
    }
  });

  test('and they would fold if they had not — which is why that rule is right', () => {
    // The justification, measured on the shipped geometry rather than asserted.
    // Each body is pushed along its own normals by the amount the medial cap
    // alone would have allowed, and the inverted AREA is counted.
    //
    // Area-weighted, not counted: a marching-cubes mesh carries slivers whose
    // normals are numerically unstable, and by triangle count every one of
    // these bodies "folds" at 1e-4 including one whose real limit is 1.3. The
    // CONTROL is the sphere, which is on the normal path and folds nothing.
    const foldedArea = (geo, amp) => {
      const nrm = geo.attributes.normal, pos = geo.attributes.position;
      const before = faceNormals(geo);
      const areas = before.map((n) => Math.hypot(...n) / 2);
      const orig = Float32Array.from(pos.array);
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, orig[i * 3] + amp * nrm.getX(i),
                      orig[i * 3 + 1] + amp * nrm.getY(i),
                      orig[i * 3 + 2] + amp * nrm.getZ(i));
      }
      const after = faceNormals(geo);
      let bad = 0, tot = 0;
      for (let i = 0; i < before.length; i++) {
        tot += areas[i];
        if (before[i][0] * after[i][0] + before[i][1] * after[i][1] + before[i][2] * after[i][2] < 0) bad += areas[i];
      }
      pos.array.set(orig);
      return bad / tot;
    };

    const builders = { gyroid: buildGyroidGeo, 'schwarz-p': buildSchwarzPGeo,
                       chmutov: buildChmutovGeo, clebsch: buildClebschGeo, cayley: buildCayleyGeo };
    for (const [name, build] of Object.entries(builders)) {
      const geo = build(64);
      const frac = foldedArea(geo, -0.4);
      assert.ok(frac > 0.005,
        `${name} inverts only ${(100 * frac).toFixed(3)} % of its area at -0.4 — if this body has ` +
        'stopped folding, the vertical rule is no longer earned and its classification should be revisited');
      geo.dispose();
    }

    // CONTROL. The same probe on a body that IS on the normal path, at the same
    // amplitude, must come back at zero — otherwise it is measuring "a field
    // was applied" rather than "the surface turned over".
    const { geo: sphere } = vizFor('sphere', false);
    assert.equal(foldedArea(sphere, -0.4), 0,
      'the sphere folds too, so this probe cannot tell folding from displacement');
  });

  test('a NEGATIVE field inverts no triangle on any of them', () => {
    // The sign is the whole test — a fold that is invisible at +0.4 shows at
    // -0.4 on the same mesh, which is how this guard is written elsewhere in
    // the suite. Run here directly rather than through that file's FOLLOWS
    // table, because that table is a hand-written literal that has not kept up
    // with the catalogue.
    for (const name of NAMES) {
      for (const isMobile of [false, true]) {
        const { viz, geo } = vizFor(name, isMobile);
        const grid = Math.round(Math.sqrt(geo.attributes.position.count));
        for (const amp of [-0.4, 0.4]) {
          const before = faceNormals(geo);
          applyHeightField(geo, new Float32Array(grid * grid).fill(amp),
            viz._pristinePositions, 3.5, viz._pristineNormals, viz._pristineDepth);
          const after = faceNormals(geo);
          let flipped = 0;
          for (let i = 0; i < before.length; i++) {
            if (before[i][0] * after[i][0] + before[i][1] * after[i][1] + before[i][2] * after[i][2] < 0) flipped++;
          }
          assert.equal(flipped, 0,
            `${name} (${isMobile ? 'mobile' : 'desktop'}) turned ${flipped} triangles inside out at ${amp}`);
        }
      }
    }
  });
});
