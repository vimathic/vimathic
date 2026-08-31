// marching-cubes.js — the mesher for bodies given as F(x, y, z) = 0.
//
// Why this exists. Every shape in the catalogue until now was either a three
// primitive or a parametrisation r(u, v) meshed on a rectangle. Both describe a
// surface by SAYING WHERE IT IS. An algebraic surface and a triply periodic
// minimal surface say instead where it ISN'T: they are level sets of a function
// on space, and the interesting ones — a cubic carrying 27 lines, a sextic with
// 65 nodes, a labyrinth that fills space in three directions — have no
// parametrisation at all. This file is the instrument that turns the second
// description into the first, and `src/implicit-surfaces.js` is its catalogue.
//
// ── The table is imported, not copied ───────────────────────────────────────
// edgeTable and triTable come from three's own MarchingCubes addon (they are
// named exports of examples/jsm/objects/MarchingCubes.js, "straight from Paul
// Bourke's page" per its own header). Copying the 4096 numbers into this file
// was the obvious alternative and is worse: a frozen copy would still be
// audited by tests/marching-cubes.test.js, but it would be audited INSTEAD of
// the table the build actually indexes. Imported, the guard runs on whatever
// three ships, so a three upgrade that changed the table turns the guard red
// rather than passing while the mesh quietly differs. If the exports are ever
// withdrawn the import fails loudly at build time, which is the failure mode
// to want.
//
// The class in that addon is NOT usable for this and it was measured before
// being ruled out: it `extends Mesh` (an Object3D with a material, not a
// mesher), its box is hard-coded to [-1,1]^3, its field is an array filled
// through addBall/addPlane rather than a callback, its buffers are pre-sized to
// 10 000 triangles (the Barth sextic wants 28 552), it emits non-indexed
// triangles, and its update() loops 1 <= x,y,z < size-2, i.e. at resolution 64
// it never marches 23 066 of the 250 047 cells — the outermost shell — so a
// body reaching the box is open there whatever the caller does.
//
// ── Three decisions that are not free, each measured ────────────────────────
//
// 1. INDEXED OUTPUT, one vertex per cut grid edge. Non-indexed was measured to
//    be disqualifying, not merely wasteful: MathVisualizer._capturePristine
//    asks normalsDisagree() (math-visualizer.js:169) whether any two vertices
//    sharing a position carry normals more than ~11.5 degrees apart, returns on
//    the FIRST offender, and drops the whole body onto the +Y path if one
//    exists. A triangle soup makes every shared corner an offender. So the
//    vertex key is (index of the LOWER grid node of the edge, axis) and the
//    interpolation runs from that same lower end every time. Deduplicating by
//    POSITION instead would not work: the two cells meeting on an edge reach it
//    from opposite ends, and (iso-a)/(b-a) against 1-(iso-b)/(a-b) is the same
//    number in algebra and a different one in float — measured on the Barth
//    sextic at res 64, 11 007 of 14 508 cut edges (75.9 %) disagree in the last
//    bits, at res 96 78.2 %, on the gyroid 78.1 %. The gap is at most 8.9e-15
//    of a cell, invisible to an eye and fatal to a hash.
//
// 2. THE LATTICE IS OFFSET BY A DIFFERENT IRRATIONAL FRACTION ON EACH AXIS.
//    Without any offset, symmetric surfaces put grid nodes exactly on
//    themselves: the Barth sextic has 22 samples with F === 0 (at
//    (+-1,+-1,+-1) and (0,0,-1) among others), identically at res 32, 48, 64
//    and 96, because those points are symmetric and so is the lattice. Every
//    edge entering such a node interpolates to t = 0, so they all land on the
//    SAME point, and the body acquires coincident vertices with opposed
//    normals — the exact condition item 1 exists to avoid, arriving through
//    the back door. Measured: 22 merge groups on Barth, 73 on the Cayley cubic
//    at res 48, 2329 on Schwarz D.
//
//    Why the three offsets must DIFFER, which one shared offset got wrong. A
//    triply periodic surface is written F(x) + F(y) + F(z) — separable — and on
//    a cubic box with one shared offset all three arguments are drawn from the
//    SAME list of res+1 numbers. An exact zero of the sum is then a collision
//    inside a short list, not an event of probability 1e-16, and it recurs at
//    some resolutions and not others. Measured on cos x + cos y + cos z, one
//    period, cube +-3.2: exactIso 8 at res 48, 6 at 72, 24 at 96 (and 0 at 32,
//    40, 56, 64, 80 — an intermittent defect, the worst kind), and at res 96
//    three vertices came out with no normal at all, breaking this module's own
//    contract. With rationally independent offsets the three lists differ and
//    the collision cannot form. The offsets move the sampled region by 0.02 to
//    0.07 of a cell — under 0.01 world units at the sizes this app uses.
//
// 3. TRIANGLES ARE EMITTED (e0, e2, e1), NOT (e0, e1, e2). With the convention
//    used here — a corner bit is set when its value is BELOW iso, i.e. inside
//    the body for an algebraic surface written F < 0 inside — the table's own
//    order winds every triangle so its normal points INWARD. The addon does not
//    notice because a metaball field is high inside, the opposite sense. This
//    is not cosmetic: math-visualizer.js:1238 uses these normals as the
//    DIRECTION a vertex travels under the field, so an inward mesh deforms
//    inside out. Measured by the divergence theorem on a unit sphere at res 48:
//    the table order gives -4.176513, the swap +4.176513, against an exact
//    4.188790. tests/marching-cubes.test.js pins the sign.
//
// ── Cost, measured on this device (node, 8 cores) ───────────────────────────
// Sampling is (res+1)^3 calls to `field`; marching visits res^3 cells. On the
// Barth sextic, box +-1.6: res 48 sample 0.9-2.4 ms + march 3.8-6.0 ms; res 64
// 1.6-3.0 + 6.1-7.4; res 96 4.2-6.7 + 12.8-19.5. The same algorithm written
// with a Map and plain arrays instead of typed ones cost 14.3-25.5 ms at res 64
// against 4.3-7.4 here — 3-4x on data structures alone, which is why the edge
// map is an Int32Array and the output buffers grow by doubling. The build is a
// one-off at shape-change; what recurs every frame is applyHeightField over the
// vertex count, so the vertex count is the budget that matters.
//
// ── What the caller gets back ───────────────────────────────────────────────
// An indexed BufferGeometry with position, normal and index, plus a userData.mc
// block carrying the counts the guard asserts on. Those counts are the point:
// `exactIso` must be 0 (decision 2 above holds), `degenerate` must be 0 (no
// zero-area triangles), `zeroNormals` must be 0 (every vertex has a direction
// to travel). A body that cannot meet them does not belong in the catalogue.

import { BufferGeometry, BufferAttribute } from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';

/**
 * Corner offsets in Bourke's numbering, which is the numbering edgeTable and
 * triTable are written in. Bit i of the case index belongs to corner i.
 *
 *      3-------2        y
 *     /|      /|        |
 *    7-------6 |        +-- x
 *    | 0-----|-1       /
 *    |/      |/       z
 *    4-------5
 */
const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/**
 * Each of the 12 cube edges as (offset of its LOWER grid node, axis).
 *
 * "Lower" is meant literally — the endpoint whose index along the edge's axis
 * is the smaller one — and that is what makes the key global: two cells sharing
 * an edge name it identically because they name the same grid node and the same
 * axis, without either of them knowing about the other. Derived from Bourke's
 * edge list (edge 0 is corner 0 to corner 1, edge 1 is 1 to 2, ... edge 11 is 3
 * to 7) rather than transcribed; tests/marching-cubes.test.js re-derives it
 * from CORNER and checks all twelve, because a single wrong entry here would
 * weld two unrelated vertices and tear the mesh in a way no case-table audit
 * could see.
 */
const EDGE_KEY = [
  [0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 1],
  [0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1],
  [0, 0, 0, 2], [1, 0, 0, 2], [1, 1, 0, 2], [0, 1, 0, 2],
];

/**
 * See decision 2 in the header. Irrational on purpose, and DIFFERENT per axis
 * on purpose: sqrt(2), sqrt(3) and sqrt(5) are rationally independent, so no
 * separable field can line its three sample lists up.
 */
const LATTICE_OFFSET = [
  (Math.SQRT2 - 1) / 10,        // 0.0414213562...
  (Math.sqrt(3) - 1) / 10,      // 0.0732050807...
  (Math.sqrt(5) - 2) / 10,      // 0.0236067977...
];

/**
 * Accept a box as a half-size, a per-axis half-size, or explicit corners.
 *
 * @param {number|number[]} b
 * @returns {number[]} [x0, y0, z0, x1, y1, z1]
 */
function normaliseBounds(b) {
  if (typeof b === 'number') return [-b, -b, -b, b, b, b];
  if (Array.isArray(b) && b.length === 3) return [-b[0], -b[1], -b[2], b[0], b[1], b[2]];
  if (Array.isArray(b) && b.length === 6) return b.slice();
  throw new TypeError('[marching-cubes] bounds must be a number, or 3 or 6 numbers');
}

/** A Float32Array that doubles rather than a JS array that reallocates. */
function grow(buf, need) {
  if (need <= buf.length) return buf;
  let cap = buf.length || 1024;
  while (cap < need) cap *= 2;
  const next = new buf.constructor(cap);
  next.set(buf);
  return next;
}

/**
 * Mesh the level set { p : field(p) = iso } inside a box.
 *
 * @param {(x:number, y:number, z:number)=>number} field
 * @param {object}   [opts]
 * @param {number}   [opts.res=64]     cells along each axis; (res+1)^3 samples
 * @param {number|number[]} [opts.bounds=1]  half-size, per-axis, or corners
 * @param {number}   [opts.iso=0]      the level to mesh
 * @returns {BufferGeometry} indexed, with position, normal, and userData.mc
 */
export function marchingCubes(field, { res = 64, bounds = 1, iso = 0 } = {}) {
  if (!Number.isInteger(res) || res < 2) {
    throw new RangeError(`[marching-cubes] res must be an integer >= 2, got ${res}`);
  }
  const [x0, y0, z0, x1, y1, z1] = normaliseBounds(bounds);
  const n = res + 1;                          // samples per axis
  const hx = (x1 - x0) / res, hy = (y1 - y0) / res, hz = (z1 - z0) / res;
  // The offset shifts the sampling lattice, not the surface: the same level set
  // is being meshed either way. See decision 2.
  const ox = x0 + LATTICE_OFFSET[0] * hx;
  const oy = y0 + LATTICE_OFFSET[1] * hy;
  const oz = z0 + LATTICE_OFFSET[2] * hz;

  // Float64 on purpose. float32 halves this array but cannot hold these fields:
  // |F| on the Barth sextic runs to 356 while the values that decide a case sit
  // at 1e-16, and rounding the small ones to zero re-creates exactly the
  // coincident-vertex failure the lattice offset removes.
  const val = new Float64Array(n * n * n);
  let exactIso = 0;
  for (let k = 0; k < n; k++) {
    const z = oz + k * hz;
    for (let j = 0; j < n; j++) {
      const y = oy + j * hy;
      let idx = (k * n + j) * n;
      for (let i = 0; i < n; i++, idx++) {
        const v = field(ox + i * hx, y, z);
        val[idx] = v;
        if (v === iso) exactIso++;
      }
    }
  }

  // edgeVert[nodeIndex * 3 + axis] — the emitted vertex on that grid edge, or
  // -1. This is the whole of the deduplication: it is keyed by the edge, so the
  // four cells around an edge cannot disagree about where its vertex is.
  const edgeVert = new Int32Array(3 * n * n * n).fill(-1);

  let pos = new Float32Array(4096);
  let nVerts = 0;
  let idxBuf = new Uint32Array(8192);
  let nIdx = 0;

  const cval = new Float64Array(8);
  const corner = new Int32Array(8);            // sample index of each corner

  for (let k = 0; k < res; k++) {
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const co = CORNER[c];
          const ci = ((k + co[2]) * n + (j + co[1])) * n + (i + co[0]);
          corner[c] = ci;
          const v = val[ci];
          cval[c] = v;
          if (v < iso) cubeIndex |= 1 << c;
        }
        const cut = edgeTable[cubeIndex];
        if (cut === 0) continue;

        // Place a vertex on every cut edge that has not been placed yet.
        // vertOf[e] is filled lazily below rather than in a loop over all 12,
        // because triTable never names an uncut edge (the guard checks that).
        for (let e = 0; e < 12; e++) {
          if ((cut & (1 << e)) === 0) continue;
          const ek = EDGE_KEY[e];
          const li = i + ek[0], lj = j + ek[1], lk = k + ek[2], axis = ek[3];
          const key = (((lk * n + lj) * n + li) * 3) + axis;
          if (edgeVert[key] !== -1) continue;

          // Always from the lower end — see decision 1.
          const lower = (lk * n + lj) * n + li;
          const step = axis === 0 ? 1 : axis === 1 ? n : n * n;
          const a = val[lower], b = val[lower + step];
          const denom = b - a;
          // denom === 0 needs both endpoints exactly at iso, which the lattice
          // offset is there to prevent; halving is the neutral answer if it
          // ever happens, and userData.mc.exactIso is what reports that it did.
          const t = denom === 0 ? 0.5 : (iso - a) / denom;

          const px = ox + (li + (axis === 0 ? t : 0)) * hx;
          const py = oy + (lj + (axis === 1 ? t : 0)) * hy;
          const pz = oz + (lk + (axis === 2 ? t : 0)) * hz;

          pos = grow(pos, (nVerts + 1) * 3);
          pos[nVerts * 3] = px; pos[nVerts * 3 + 1] = py; pos[nVerts * 3 + 2] = pz;
          edgeVert[key] = nVerts++;
        }

        const row = cubeIndex * 16;
        for (let t = 0; triTable[row + t] !== -1; t += 3) {
          const e0 = triTable[row + t], e1 = triTable[row + t + 1], e2 = triTable[row + t + 2];
          idxBuf = grow(idxBuf, nIdx + 3);
          // (e0, e2, e1): outward with the "bit set below iso" convention.
          idxBuf[nIdx++] = vertexOn(edgeVert, n, i, j, k, e0);
          idxBuf[nIdx++] = vertexOn(edgeVert, n, i, j, k, e2);
          idxBuf[nIdx++] = vertexOn(edgeVert, n, i, j, k, e1);
        }
      }
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos.slice(0, nVerts * 3), 3));
  geo.setIndex(new BufferAttribute(idxBuf.slice(0, nIdx), 1));
  geo.computeVertexNormals();

  geo.userData.mc = {
    res,
    samples: n * n * n,
    vertices: nVerts,
    triangles: nIdx / 3,
    exactIso,
    degenerate: countDegenerate(pos, idxBuf, nIdx),
    zeroNormals: countZeroNormals(geo.attributes.normal.array),
  };
  return geo;
}

/** The vertex sitting on edge `e` of the cell at (i, j, k). */
function vertexOn(edgeVert, n, i, j, k, e) {
  const ek = EDGE_KEY[e];
  return edgeVert[((((k + ek[2]) * n + (j + ek[1])) * n + (i + ek[0])) * 3) + ek[3]];
}

/**
 * Triangles of vanishing area.
 *
 * Not a stylistic check: a zero-area triangle contributes a zero normal to each
 * of its corners, and computeVertexNormals normalises the SUM, so one of these
 * can leave a vertex with no direction to travel under the field. The threshold
 * is on twice the area (the cross product's length) and is far below anything
 * a real triangle of this mesh reaches — cells are 0.05-0.13 world units wide
 * at the resolutions the app uses.
 */
function countDegenerate(pos, idx, nIdx) {
  let bad = 0;
  for (let t = 0; t < nIdx; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-28) bad++;
  }
  return bad;
}

/** Vertices computeVertexNormals could not give a direction. */
function countZeroNormals(nrm) {
  let bad = 0;
  for (let i = 0; i < nrm.length; i += 3) {
    if (nrm[i] === 0 && nrm[i + 1] === 0 && nrm[i + 2] === 0) bad++;
  }
  return bad;
}
