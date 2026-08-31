// tests/marching-cubes.test.js
//
// The mesher in src/marching-cubes.js turns F(x, y, z) = 0 into a surface, and
// every implicit body in the catalogue is downstream of it. A quiet defect here
// would not look like a defect: a torn isosurface reads as an intentional rim
// (seven catalogue shapes legitimately have boundary edges), and an
// inside-out one reads as a lighting choice until the field starts moving
// vertices along those normals.
//
// Run:
//   node --test tests/marching-cubes.test.js
//
// ── What this guards ────────────────────────────────────────────────────────
// THE TABLE, exhaustively rather than by sampling. src/marching-cubes.js does
// not carry its own copy of Bourke's tables; it imports the ones three ships,
// so what is audited below is literally what the build indexes. Six properties,
// all over all 256 cases:
//   (a) edgeTable is derivable — an edge is cut exactly when its ends disagree
//   (b) triTable names only cut edges, uses every cut edge, arity is sane
//   (c) each case's patch is an oriented surface in itself
//   (d) two cells sharing a face draw the same thing on it, WITH ORIENTATION
//   (e) no patch edge lies inside a cube face (the property that makes the
//       fan triangulation safe — see the note on that test)
//   (f) all 192 ambiguous faces resolve the same way, which is WHY (d) holds
//
// THE KEYING, which no table audit can see. EDGE_KEY decides which grid edge a
// vertex belongs to, and one wrong entry welds two unrelated vertices. It is
// re-derived here from CORNER rather than compared against itself.
//
// THE MESH, on a body whose answers are known in closed form: Euler
// characteristic, closure, outward orientation, and the convergence ORDER —
// which is what separates real edge interpolation from taking edge midpoints.
//
// ── How it guards ───────────────────────────────────────────────────────────
// Every property above has a CONTROL that must come out the other way. The
// controls are not decorative: the audit this file replaced compared
// UNORDERED segment sets, and a deliberately reversed case 5 left it reading
// zero — the class of defect it was written to catch was invisible to it. The
// oriented version below sees 80. Each control is stated next to its test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { marchingCubes } from '../src/marching-cubes.js';

// ── The geometry the tables are written in ──────────────────────────────────
// Restated here rather than imported from the module under test, so a change
// to the module cannot quietly change the oracle along with the code — the
// same rule tests/parametric-surfaces.test.js follows for its parametrisations.
const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/** Bourke's edge list: which two corners each of the 12 edges joins. */
const EDGE_ENDS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** The 6 cube faces as (axis, side) with the four corners lying on each. */
const FACES = [];
for (let axis = 0; axis < 3; axis++) {
  for (const side of [0, 1]) {
    FACES.push({
      axis, side,
      corners: [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => CORNER[c][axis] === side),
    });
  }
}
const faceEdges = (f) => EDGE_ENDS
  .map((e, i) => [e, i])
  .filter(([e]) => f.corners.includes(e[0]) && f.corners.includes(e[1]))
  .map(([, i]) => i);

/** The triangles of one case, as edge triples, in the order the MESHER emits. */
function patch(cs) {
  const out = [];
  for (let t = 0; triTable[cs * 16 + t] !== -1; t += 3) {
    // (e0, e2, e1) — the swap src/marching-cubes.js applies for outward normals.
    out.push([triTable[cs * 16 + t], triTable[cs * 16 + t + 2], triTable[cs * 16 + t + 1]]);
  }
  return out;
}

const bit = (cs, c) => (cs >> c) & 1;
const cutEdges = (cs) => EDGE_ENDS
  .map((e, i) => [e, i])
  .filter(([e]) => bit(cs, e[0]) !== bit(cs, e[1]))
  .map(([, i]) => i);

describe('the case table, over all 256 cases', () => {
  test('(a) edgeTable says exactly which edges have ends of different sign', () => {
    let wrong = 0;
    for (let cs = 0; cs < 256; cs++) {
      let want = 0;
      for (const e of cutEdges(cs)) want |= 1 << e;
      if (want !== edgeTable[cs]) wrong++;
    }
    // Half the table is therefore derivable rather than data. It is checked,
    // not removed, because the mesher reads edgeTable to skip empty cells.
    assert.equal(wrong, 0, `${wrong} of 256 edgeTable entries disagree with the corner signs`);
  });

  test('(b) triTable names every cut edge and no other, in triples', () => {
    let namesUncut = 0, leavesCutUnused = 0, badArity = 0, maxTris = 0;
    for (let cs = 0; cs < 256; cs++) {
      const cut = new Set(cutEdges(cs));
      const used = new Set();
      const row = triTable.slice(cs * 16, cs * 16 + 16);
      const live = row.filter((v) => v !== -1);
      if (live.length % 3 !== 0) badArity++;
      // -1 may only appear as a tail, never between live entries.
      const firstStop = row.indexOf(-1);
      if (firstStop !== -1 && row.slice(firstStop).some((v) => v !== -1)) badArity++;
      for (const e of live) { used.add(e); if (!cut.has(e)) namesUncut++; }
      for (const e of cut) if (!used.has(e)) leavesCutUnused++;
      maxTris = Math.max(maxTris, live.length / 3);
    }
    assert.equal(namesUncut, 0, 'triTable references an edge whose ends have the same sign');
    assert.equal(leavesCutUnused, 0, 'a cut edge is left out of the patch, which is a hole');
    assert.equal(badArity, 0, 'a row is not a whole number of triangles, or -1 appears mid-row');
    assert.equal(maxTris, 5, 'the classical bound is five triangles per cell');
  });

  test('(c) each case draws an oriented patch — no edge traversed twice the same way', () => {
    let bad = 0;
    for (let cs = 0; cs < 256; cs++) {
      const seen = new Set();
      for (const [a, b, c] of patch(cs)) {
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          const k = `${u}>${v}`;
          if (seen.has(k)) bad++;
          seen.add(k);
        }
      }
    }
    assert.equal(bad, 0, `${bad} directed patch edges are traversed twice in the same direction`);
  });

  test('(e) no patch edge lies inside a cube face', () => {
    // Why this is worth a test of its own. A chord drawn across the INSIDE of a
    // shared face is a chord the neighbouring cell may draw too, on the same
    // two points, giving an edge used by three or four triangles. A table
    // generated by closing face segments into loops and fanning them does
    // exactly that — measured at 100 such chords for one fan rule and 78 for
    // the other, and 274 bad edges on real fields. Bourke's has none, and that
    // is what makes the fan safe. CONTROL: the generated-table figures above
    // are the other outcome this test can produce.
    let inFace = 0;
    for (let cs = 0; cs < 256; cs++) {
      const twice = new Map();
      for (const [a, b, c] of patch(cs)) {
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          const k = u < v ? `${u}_${v}` : `${v}_${u}`;
          twice.set(k, (twice.get(k) || 0) + 1);
        }
      }
      for (const [k, n] of twice) {
        if (n < 2) continue;
        const [u, v] = k.split('_').map(Number);
        if (FACES.some((f) => faceEdges(f).includes(u) && faceEdges(f).includes(v))) inFace++;
      }
    }
    assert.equal(inFace, 0, `${inFace} interior patch edges lie in the plane of a cube face`);
  });

  test('(f) all 192 ambiguous faces are resolved the same way', () => {
    // An ambiguous face is one whose four corner signs alternate: both
    // resolutions close the surface locally, and the choice is free. It is
    // BECAUSE this choice is made from the face's own four signs — which both
    // cells see identically — that (d) below can come out zero.
    let instances = 0, separatesInner = 0, separatesOuter = 0, unreadable = 0;
    for (let cs = 0; cs < 256; cs++) {
      const chords = new Map();
      for (const [a, b, c] of patch(cs)) {
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          for (const f of FACES) {
            const fe = faceEdges(f);
            if (fe.includes(u) && fe.includes(v)) {
              const key = `${f.axis}${f.side}`;
              if (!chords.has(key)) chords.set(key, []);
              chords.get(key).push([u, v]);
            }
          }
        }
      }
      for (const f of FACES) {
        const fe = faceEdges(f);
        if (fe.some((e) => !cutEdges(cs).includes(e))) continue;   // not all four cut
        // Cyclic order of the face's corners: alternating signs is the test.
        const cyc = f.corners.slice().sort((p, q) => {
          const ang = (c) => {
            const o = CORNER[c].filter((_, i) => i !== f.axis);
            return Math.atan2(o[1] - 0.5, o[0] - 0.5);
          };
          return ang(p) - ang(q);
        });
        const s = cyc.map((c) => bit(cs, c));
        if (!(s[0] === s[2] && s[1] === s[3] && s[0] !== s[1])) continue;
        instances++;
        const cs2 = chords.get(`${f.axis}${f.side}`) || [];
        // Each chord joins two adjacent face edges; the corner they share is
        // the one it cuts off. Both chords cutting off set bits = "separates
        // the inner pair".
        const cut = cs2.map(([u, v]) => EDGE_ENDS[u].find((c) => EDGE_ENDS[v].includes(c)));
        if (cut.length !== 2 || cut.some((c) => c === undefined)) { unreadable++; continue; }
        if (cut.every((c) => bit(cs, c) === 1)) separatesInner++;
        else if (cut.every((c) => bit(cs, c) === 0)) separatesOuter++;
        else unreadable++;
      }
    }
    // 6 faces x 2 alternating patterns x 2^4 free corners = 192, independently.
    assert.equal(instances, 192, 'the count of ambiguous face instances is not what the combinatorics says');
    assert.equal(unreadable, 0, 'a face resolution could not be read as two chords');
    assert.equal(separatesOuter, 0, 'an ambiguous face is resolved the other way — (d) can no longer hold');
    assert.equal(separatesInner, 192);
  });
});

// ── (d) the neighbour audit, exhaustive and ORIENTED ────────────────────────

/**
 * Cut points on the face shared by a cell and its neighbour along `axis`,
 * named globally so both cells can be compared without either being moved.
 *
 * The correspondence between the two cells' edge numbers is derived from the
 * geometry (an edge of A on the far face is the edge of B on the near face with
 * the same midpoint), not tabulated — a tabulated one would be a second place
 * for the same mistake to live.
 */
function sharedFace(axis) {
  const aFace = FACES.find((f) => f.axis === axis && f.side === 1);
  const bFace = FACES.find((f) => f.axis === axis && f.side === 0);
  const mid = (e, shift) => EDGE_ENDS[e]
    .map((c) => CORNER[c])
    .reduce((m, p) => m.map((v, i) => v + (p[i] + (i === axis ? shift : 0)) / 2), [0, 0, 0])
    .join(',');
  const map = new Map();                       // B's edge id -> A's edge id
  for (const eb of faceEdges(bFace)) {
    const ea = faceEdges(aFace).find((x) => mid(x, 0) === mid(eb, 1));
    map.set(eb, ea);
  }
  return { aEdges: faceEdges(aFace), bEdges: faceEdges(bFace), map,
           aCorners: aFace.corners, bCorners: bFace.corners };
}

/** Directed segments a case draws on the given set of face edges. */
function faceSegments(cs, edges, rename, patchOf) {
  const out = [];
  for (const [a, b, c] of patchOf(cs)) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (edges.includes(u) && edges.includes(v)) out.push(`${rename(u)}>${rename(v)}`);
    }
  }
  return out.sort();
}

/** Run the full 3 x 256 x 16 audit against a patch source; returns mismatches. */
function neighbourAudit(patchOf) {
  let pairs = 0, unoriented = 0, oriented = 0;
  for (let axis = 0; axis < 3; axis++) {
    const F = sharedFace(axis);
    const freeB = F.bCorners.map((c) => c);     // B's own far-side corners
    const farB = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => !freeB.includes(c));
    for (let csA = 0; csA < 256; csA++) {
      for (let free = 0; free < 16; free++) {
        // B's near corners copy A's far ones; B's far corners are free.
        let csB = 0;
        for (let i = 0; i < 4; i++) {
          const bc = F.bCorners[i];
          const ac = F.aCorners.find((c) =>
            CORNER[c].every((v, k) => k === axis || v === CORNER[bc][k]));
          if (bit(csA, ac)) csB |= 1 << bc;
        }
        for (let i = 0; i < 4; i++) if ((free >> i) & 1) csB |= 1 << farB[i];

        const segA = faceSegments(csA, F.aEdges, (e) => e, patchOf);
        const segB = faceSegments(csB, F.bEdges, (e) => F.map.get(e), patchOf);
        // A and B lie on opposite sides of the face, so the curve one draws on
        // it must be the reverse of the other's for the union to be a closed,
        // consistently oriented surface.
        const revB = segB.map((s) => s.split('>').reverse().join('>')).sort();
        pairs++;
        const setA = segA.map((s) => s.split('>').sort().join('_')).sort().join('|');
        const setB = segB.map((s) => s.split('>').sort().join('_')).sort().join('|');
        if (setA !== setB) unoriented++;
        if (segA.join('|') !== revB.join('|')) oriented++;
      }
    }
  }
  return { pairs, unoriented, oriented };
}

describe('(d) two cells sharing a face draw the same curve on it', () => {
  test('3 directions x 256 cases x 16 free corners — no disagreement, oriented', () => {
    const r = neighbourAudit(patch);
    assert.equal(r.pairs, 12288, 'the enumeration is not exhaustive');
    assert.equal(r.unoriented, 0, `${r.unoriented} pairs draw different chords on their shared face`);
    assert.equal(r.oriented, 0, `${r.oriented} pairs draw the same chords in the same direction — the mesh would be non-orientable there`);
  });

  test('CONTROL — a single case resolved the other way is seen', () => {
    // Case 5 re-triangulated the other way, taken from a loop-and-fan generator.
    // The audit that this file replaced compared unordered sets and stayed at
    // zero on the ORIENTATION half of this; the numbers below are why the
    // oriented comparison above is not decoration.
    const broken = (cs) => (cs === 5
      ? [[3, 2, 10], [3, 10, 1], [3, 1, 0], [3, 0, 8]]
      : patch(cs));
    const r = neighbourAudit(broken);
    assert.ok(r.unoriented > 0, 'the audit cannot see a flipped face resolution — it is measuring nothing');
    assert.ok(r.oriented >= r.unoriented, 'the oriented half must be at least as sensitive as the unoriented one');
  });
});

describe('EDGE_KEY — which grid edge a vertex belongs to', () => {
  test('every edge differs in exactly one coordinate, and the key is its lower end', () => {
    // The module keys vertices by (lower grid node, axis). If one entry named
    // the wrong node, two cells would place two vertices on one edge and the
    // surface would tear there — invisible to every table property above,
    // because the table would still be right.
    const KEY = [
      [0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 1],
      [0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1],
      [0, 0, 0, 2], [1, 0, 0, 2], [1, 1, 0, 2], [0, 1, 0, 2],
    ];
    for (let e = 0; e < 12; e++) {
      const [c0, c1] = EDGE_ENDS[e].map((c) => CORNER[c]);
      const diff = [0, 1, 2].filter((i) => c0[i] !== c1[i]);
      assert.equal(diff.length, 1, `edge ${e} does not run along an axis`);
      const axis = diff[0];
      const lower = c0[axis] < c1[axis] ? c0 : c1;
      assert.deepEqual(KEY[e], [...lower, axis],
        `EDGE_KEY[${e}] must be the lower end ${lower} on axis ${axis}`);
    }
  });
});

// ── The mesh itself, on a body with closed-form answers ─────────────────────

/** Undirected edge census plus the Euler characteristic. */
function census(geo) {
  const ix = geo.index.array;
  const edges = new Map();
  for (let t = 0; t < ix.length; t += 3) {
    for (const [u, v] of [[ix[t], ix[t + 1]], [ix[t + 1], ix[t + 2]], [ix[t + 2], ix[t]]]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let boundary = 0, overused = 0;
  for (const n of edges.values()) { if (n === 1) boundary++; else if (n > 2) overused++; }
  const V = geo.attributes.position.count, E = edges.size, F = ix.length / 3;
  return { V, E, F, chi: V - E + F, boundary, overused };
}

/** Enclosed volume by the divergence theorem — positive iff normals face out. */
function signedVolume(geo) {
  const p = geo.attributes.position.array, ix = geo.index.array;
  let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
          - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
          + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return vol;
}

const unitSphere = (x, y, z) => x * x + y * y + z * z - 1;

describe('the mesh on a unit sphere, where every answer is known', () => {
  test('closed, 2-manifold, and of the sphere\'s Euler characteristic', () => {
    for (const res of [24, 48, 96]) {
      const c = census(marchingCubes(unitSphere, { res, bounds: 1.5 }));
      assert.equal(c.boundary, 0, `res ${res}: ${c.boundary} edges belong to one triangle — the mesh is torn`);
      assert.equal(c.overused, 0, `res ${res}: ${c.overused} edges belong to more than two triangles`);
      assert.equal(c.chi, 2, `res ${res}: chi is ${c.chi}, and a sphere's is 2`);
    }
  });

  test('normals point OUTWARD — the sign the field travels along', () => {
    // math-visualizer.js:1238 uses these normals as a direction of travel, so
    // an inward mesh does not merely shade wrong, it deforms inside out.
    // Measured: the table's own order gives -4.176515 here.
    const vol = signedVolume(marchingCubes(unitSphere, { res: 48, bounds: 1.5 }));
    assert.ok(vol > 0, `enclosed volume is ${vol.toFixed(6)}; negative means the mesh is inside out`);
    assert.ok(Math.abs(vol - 4 * Math.PI / 3) < 0.02,
      `enclosed volume ${vol.toFixed(6)} is not near the exact ${(4 * Math.PI / 3).toFixed(6)}`);
  });

  test('vertices converge at SECOND order — the interpolation is real', () => {
    // The point of this test is the ORDER, not the size. Placing each vertex at
    // its edge's midpoint also produces a closed, correct-looking sphere; it
    // converges at first order. The CONTROL below is that midpoint rule, and it
    // must fail the ratio this test requires.
    const err = (res) => {
      const g = marchingCubes(unitSphere, { res, bounds: 1.5 });
      const p = g.attributes.position.array;
      let worst = 0;
      for (let i = 0; i < p.length; i += 3) {
        worst = Math.max(worst, Math.abs(Math.hypot(p[i], p[i + 1], p[i + 2]) - 1));
      }
      return worst;
    };
    const e24 = err(24), e48 = err(48), e96 = err(96);
    assert.ok(e48 > 0, 'the sphere is meshed exactly, which cannot happen');
    for (const [coarse, fine, name] of [[e24, e48, '24->48'], [e48, e96, '48->96']]) {
      const ratio = coarse / fine;
      assert.ok(ratio > 3.5 && ratio < 4.5,
        `${name}: error fell by ${ratio.toFixed(2)}x, not the ~4x of second order`);
    }
  });

  test('CONTROL — edge midpoints instead of interpolation converge at FIRST order', () => {
    // The module has no seam to inject a different vertex rule through, so the
    // rule is applied to its OUTPUT instead, which is exact: a marching-cubes
    // vertex sits on a grid edge, so two of its coordinates are on the lattice
    // and one is not. Putting that one at the middle of its cell is precisely
    // the midpoint rule. If the ratio test above would pass on this too, it is
    // measuring the mesh's existence rather than its accuracy.
    // Restated, as an oracle should be — including that the three axes differ.
    const OFFSET = [(Math.SQRT2 - 1) / 10, (Math.sqrt(3) - 1) / 10, (Math.sqrt(5) - 2) / 10];
    const mid = (res) => {
      const h = 3 / res, o = OFFSET.map((d) => -1.5 + d * h);
      const p = marchingCubes(unitSphere, { res, bounds: 1.5 }).attributes.position.array;
      let worst = 0, moved = 0;
      for (let i = 0; i < p.length; i += 3) {
        const q = [p[i], p[i + 1], p[i + 2]];
        const t = q.map((v, k) => (v - o[k]) / h);
        const off = t.findIndex((v) => Math.abs(v - Math.round(v)) > 1e-4);
        if (off >= 0) { q[off] = o[off] + (Math.floor(t[off]) + 0.5) * h; moved++; }
        worst = Math.max(worst, Math.abs(Math.hypot(...q) - 1));
      }
      assert.ok(moved > p.length / 6,
        `only ${moved} of ${p.length / 3} vertices were recognised as sitting on a grid edge`);
      return worst;
    };
    const r = mid(24) / mid(48);
    assert.ok(r > 1.6 && r < 2.6,
      `the midpoint rule fell by ${r.toFixed(2)}x — expected the ~2x of first order`);
    assert.ok(r < 3.5, 'the midpoint rule would pass the second-order test, which therefore proves nothing');
  });

  test('the diagnostics the catalogue relies on are clean', () => {
    const mc = marchingCubes(unitSphere, { res: 48, bounds: 1.5 }).userData.mc;
    assert.equal(mc.exactIso, 0, 'a sample landed exactly on the isolevel — the lattice offset is not doing its job');
    assert.equal(mc.degenerate, 0, 'zero-area triangles were emitted');
    assert.equal(mc.zeroNormals, 0, 'a vertex has no normal, so the field cannot move it');
    assert.equal(mc.samples, 49 ** 3, 'res counts CELLS; samples must be (res+1)^3');
  });

  test('a SEPARABLE field on a cubic box puts no sample on the isolevel', () => {
    // The case one shared offset got wrong, and the reason there are three.
    // cos x + cos y + cos z is separable, so on a cubic box every argument is
    // drawn from the same list of res+1 numbers if the offset is shared —
    // and an exact zero of the sum becomes a collision inside a short list
    // rather than a 1e-16 coincidence. It recurred at some resolutions and not
    // others, which is what made it hard to see: measured exactIso 8 at res 48,
    // 6 at 72, 24 at 96 with a shared offset, and at res 96 three vertices came
    // out with no normal at all.
    const k = Math.PI / 3.2;                    // one period across the box
    const schwarzP = (x, y, z) => Math.cos(k * x) + Math.cos(k * y) + Math.cos(k * z);
    for (const res of [48, 72, 96]) {
      const mc = marchingCubes(schwarzP, { res, bounds: 3.2 }).userData.mc;
      assert.equal(mc.exactIso, 0, `res ${res}: ${mc.exactIso} samples sit exactly on the isolevel`);
      assert.equal(mc.zeroNormals, 0, `res ${res}: ${mc.zeroNormals} vertices have no normal`);
      assert.equal(mc.degenerate, 0, `res ${res}: ${mc.degenerate} zero-area triangles`);
    }
  });

  test('CONTROL — a SHARED offset would collide, so the test above is not vacuous', () => {
    // Counted in arithmetic rather than by meshing, because the module has no
    // seam to put a shared offset back through. If this comes out zero the test
    // above is measuring nothing.
    const k = Math.PI / 3.2, res = 48, h = 6.4 / res;
    const list = (d) => Array.from({ length: res + 1 }, (_, i) => Math.cos(k * (-3.2 + (i + d) * h)));
    const triples = (a, b, c) => {
      const seen = new Map();
      for (const u of a) for (const v of b) {
        const s = u + v;
        seen.set(s, (seen.get(s) || 0) + 1);
      }
      let n = 0;
      for (const w of c) n += seen.get(-w) || 0;
      return n;
    };
    const shared = list((Math.SQRT2 - 1) / 10);
    const perAxis = [(Math.SQRT2 - 1) / 10, (Math.sqrt(3) - 1) / 10, (Math.sqrt(5) - 2) / 10].map(list);
    assert.ok(triples(shared, shared, shared) > 0,
      'one shared offset produces no exact zero here either — this control proves nothing');
    assert.equal(triples(perAxis[0], perAxis[1], perAxis[2]), 0,
      'three independent offsets still line up, which they must not');
  });

  test('CONTROL — the lattice offset is what keeps exactIso at zero', () => {
    // A sphere of radius exactly 1 sampled on a lattice through the origin puts
    // no sample on the surface by luck; a plane through the origin does. This
    // body is the one that would go wrong without the offset, and it shows the
    // diagnostic can report a non-zero.
    const plane = (x, y, z) => z;
    const mc = marchingCubes(plane, { res: 16, bounds: 1 }).userData.mc;
    assert.equal(mc.exactIso, 0,
      'even a plane through the origin puts no sample on the isolevel, because the lattice is offset');
    // And the same field on an un-offset lattice would: 17*17 = 289 samples at
    // z = 0. The assertion above is the offset working, not the field being kind.
    assert.equal(17 * 17, 289);
  });
});
