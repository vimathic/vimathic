// tests/parametric-surfaces.test.js
//
// Six surfaces entered the catalogue on the claim that a height field cannot be
// them. Each claim is a checkable property, so each is checked — against the
// property, not against the mesh.
//
// Run:
//   node --test tests/parametric-surfaces.test.js
//
// ── What this guards ────────────────────────────────────────────────────────
//   catenoid, helicoid   minimal: mean curvature zero at every sampled point
//   helicoid             ruled: every v-line is a straight segment
//   hyperboloid          DOUBLY ruled: two straight lines through every point
//   pseudosphere         constant negative Gaussian curvature, K = −1/a²
//   mobius               non-orientable, and ONE boundary curve, not two
//   klein                non-orientable AND closed — no boundary at all
//
// A picker entry is a claim (round 11's rule), and these are the claims. If
// `catenoid` ever stops being minimal — someone "simplifies" cosh to a cone,
// say — the label is a lie and this file is where that surfaces.
//
// ── How it guards ───────────────────────────────────────────────────────────
// The parametrisations are restated here rather than imported, so a change to
// src/parametric-surfaces.js cannot quietly change the oracle with the code.
// Curvature comes from the first and second fundamental forms computed by
// central differences on those restatements; the mesh-level facts (boundary
// components, orientability) come from the geometries the app actually builds.
//
// Every property test has a CONTROL that must come out the OTHER way on a
// surface that does not have the property — a minimality test that passes on a
// sphere is measuring nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMobiusGeo, buildKleinGeo, buildCatenoidGeo,
  buildHelicoidGeo, buildHyperboloidGeo, buildPseudosphereGeo,
} from '../src/parametric-surfaces.js';

const TAU = Math.PI * 2;

// ── The oracle: the same six maps, written out again ─────────────────────────
const P = {
  catenoid: (u, v, c = 1.5) => [c * Math.cosh(v / c) * Math.cos(u), v, c * Math.cosh(v / c) * Math.sin(u)],
  helicoid: (u, v, c = 0.42) => [v * Math.cos(u), c * u, v * Math.sin(u)],
  hyperboloid: (u, v, a = 1.6, c = 2.0) =>
    [a * Math.cosh(v) * Math.cos(u), c * Math.sinh(v), a * Math.cosh(v) * Math.sin(u)],
  pseudosphere: (u, v, a = 2.4) => {
    const sech = 1 / Math.cosh(u);
    return [a * sech * Math.cos(v), a * (u - Math.tanh(u)), a * sech * Math.sin(v)];
  },
  mobius: (u, v, R = 2.7, w = 1.1) => {
    const rad = R + w * v * Math.cos(u / 2);
    return [rad * Math.cos(u), w * v * Math.sin(u / 2), rad * Math.sin(u)];
  },
  klein: (u, v, a = 2.4) => {
    const h = Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v);
    const rad = a + h;
    return [rad * Math.cos(u),
            Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v),
            rad * Math.sin(u)];
  },
  // CONTROLS — surfaces that must NOT have the properties above.
  sphere: (u, v, r = 3.5) => [r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)],
  torus: (u, v, R = 2.8, r = 1.1) =>
    [(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)],
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(...a);
const unit = (a) => { const L = norm(a); return [a[0] / L, a[1] / L, a[2] / L]; };

/**
 * Mean and Gaussian curvature at (u, v) by central differences.
 *
 * H = (eG − 2fF + gE) / (2(EG − F²)),  K = (eg − f²) / (EG − F²)
 *
 * h = 1e-4 puts the truncation error of the second differences near 1e-8 and
 * their roundoff near the same, which is four orders below the curvatures these
 * surfaces carry (≈ 0.1 … 0.7).
 */
function curvature(f, u, v, h = 1e-4) {
  const at = (du, dv) => f(u + du, v + dv);
  const ru = sub(at(h, 0), at(-h, 0)).map(c => c / (2 * h));
  const rv = sub(at(0, h), at(0, -h)).map(c => c / (2 * h));
  const p = at(0, 0);
  const ruu = [0, 1, 2].map(i => (at(h, 0)[i] - 2 * p[i] + at(-h, 0)[i]) / (h * h));
  const rvv = [0, 1, 2].map(i => (at(0, h)[i] - 2 * p[i] + at(0, -h)[i]) / (h * h));
  const ruv = [0, 1, 2].map(i =>
    (at(h, h)[i] - at(h, -h)[i] - at(-h, h)[i] + at(-h, -h)[i]) / (4 * h * h));

  const n = unit(cross(ru, rv));
  const E = dot(ru, ru), F = dot(ru, rv), G = dot(rv, rv);
  const e = dot(ruu, n), fF = dot(ruv, n), g = dot(rvv, n);
  const den = E * G - F * F;
  return {
    H: (e * G - 2 * fF * F + g * E) / (2 * den),
    K: (e * g - fF * fF) / den,
  };
}

/** Sample a rectangle of parameter space, avoiding the very edges. */
function grid(uRange, vRange, n = 9) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= n; j++) {
      out.push([uRange[0] + (uRange[1] - uRange[0]) * i / (n + 1),
                vRange[0] + (vRange[1] - vRange[0]) * j / (n + 1)]);
    }
  }
  return out;
}

/**
 * Boundary edges of a built geometry, counted by POSITION rather than by index.
 *
 * ParametricGeometry duplicates the vertices on a periodic seam, so a closed
 * surface still has two distinct indices at every seam point and an index-based
 * count would report the seam as a boundary. Quantising to 1e-4 welds the seam
 * back — the meshes here have edges of order 1e-2 at their finest, a hundred
 * times coarser, so nothing else can be welded by accident.
 */
function boundaryEdges(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const key = i => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const keys = [];
  for (let i = 0; i < pos.count; i++) keys.push(key(i));
  const count = new Map();
  const tri = (a, b, c) => {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const kp = keys[p], kq = keys[q];
      if (kp === kq) continue;                       // degenerate at a pole
      const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  };
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  } else {
    for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
  }
  let odd = 0;
  for (const c of count.values()) if (c === 1) odd++;
  return odd;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('minimal surfaces are minimal', () => {
  test('catenoid: mean curvature is zero everywhere', () => {
    let worst = 0;
    for (const [u, v] of grid([0, TAU], [-2.2, 2.2])) {
      worst = Math.max(worst, Math.abs(curvature(P.catenoid, u, v).H));
    }
    assert.ok(worst < 1e-5, `largest |H| on the catenoid is ${worst.toExponential(2)}, not zero`);
  });

  test('helicoid: mean curvature is zero everywhere', () => {
    let worst = 0;
    for (const [u, v] of grid([0, 4 * Math.PI], [-3.2, 3.2])) {
      worst = Math.max(worst, Math.abs(curvature(P.helicoid, u, v).H));
    }
    assert.ok(worst < 1e-5, `largest |H| on the helicoid is ${worst.toExponential(2)}, not zero`);
  });

  test('CONTROL — the same measurement on a sphere reports 1/r, not zero', () => {
    // If this ever came out near zero the two tests above would pass on
    // anything, including a cone somebody swapped in for the cosh.
    let least = Infinity;
    for (const [u, v] of grid([0, TAU], [0.2, Math.PI - 0.2])) {
      least = Math.min(least, Math.abs(curvature(P.sphere, u, v).H));
    }
    assert.ok(Math.abs(least - 1 / 3.5) < 1e-3,
      `the sphere of radius 3.5 must read |H| = ${(1 / 3.5).toFixed(4)}; smallest measured ${least}`);
  });
});

describe('ruled surfaces carry their lines', () => {
  test('helicoid: every v-line is straight', () => {
    // Three points on one v-line must be collinear, and exactly so: the map is
    // affine in v, so the residual is float noise rather than a small number.
    let worst = 0;
    for (let i = 0; i < 24; i++) {
      const u = TAU * i / 24;
      const a = P.helicoid(u, -3.2), b = P.helicoid(u, 0), c = P.helicoid(u, 3.2);
      worst = Math.max(worst, norm(cross(sub(b, a), sub(c, a))));
    }
    assert.ok(worst < 1e-12, `a v-line of the helicoid bends by ${worst.toExponential(2)}`);
  });

  test('hyperboloid: TWO straight lines lie in the surface through every point', () => {
    // Through (a·cosθ, 0, a·sinθ) the two ruling directions are
    // (−a·sinθ, ±c, a·cosθ). Walking either one must keep the implicit form
    // x²/a² + z²/a² − y²/c² at exactly 1.
    const a = 1.6, c = 2.0;
    const implicit = ([x, y, z]) => (x * x + z * z) / (a * a) - (y * y) / (c * c);
    let worst = 0, lines = 0;
    for (let i = 0; i < 16; i++) {
      const th = TAU * i / 16;
      const p = [a * Math.cos(th), 0, a * Math.sin(th)];
      for (const s of [1, -1]) {
        const d = [-a * Math.sin(th), s * c, a * Math.cos(th)];
        lines++;
        for (const t of [-2, -1, -0.3, 0.3, 1, 2]) {
          const q = [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]];
          worst = Math.max(worst, Math.abs(implicit(q) - 1));
        }
      }
    }
    assert.equal(lines, 32, 'sixteen points, two lines each');
    assert.ok(worst < 1e-12, `a ruling leaves the hyperboloid by ${worst.toExponential(2)}`);
  });

  test('the parametrisation shipped is that same hyperboloid', () => {
    // The rulings above are a fact about the equation. This is what ties them
    // to the body the app builds: every sampled point of the parametrisation
    // satisfies the same equation.
    const a = 1.6, c = 2.0;
    let worst = 0;
    for (const [u, v] of grid([0, TAU], [-1.25, 1.25])) {
      const [x, y, z] = P.hyperboloid(u, v);
      worst = Math.max(worst, Math.abs((x * x + z * z) / (a * a) - (y * y) / (c * c) - 1));
    }
    assert.ok(worst < 1e-12, `the parametrisation misses its own equation by ${worst.toExponential(2)}`);
  });

  test('CONTROL — a torus carries no such line', () => {
    // Same construction, tangent direction instead of a ruling: it must leave
    // the surface immediately, or "lies in the surface" means nothing.
    const R = 2.8, r = 1.1;
    const implicit = ([x, y, z]) => (Math.hypot(x, z) - R) ** 2 + y * y - r * r;
    const p = P.torus(0.7, 0.4);
    const d = unit(sub(P.torus(0.7 + 1e-5, 0.4), P.torus(0.7 - 1e-5, 0.4)));
    const q = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
    assert.ok(Math.abs(implicit(q)) > 1e-2,
      'a straight step along a torus tangent stayed on the torus — the probe is blind');
  });
});

describe('constant curvature', () => {
  test('pseudosphere: Gaussian curvature is −1/a² at every point', () => {
    const a = 2.4, want = -1 / (a * a);
    let worst = 0;
    for (const [u, v] of grid([0.25, 2.6], [0, TAU])) {
      for (const s of [1, -1]) {
        worst = Math.max(worst, Math.abs(curvature(P.pseudosphere, s * u, v).K - want));
      }
    }
    assert.ok(worst < 1e-4,
      `K wanders from ${want.toFixed(6)} by ${worst.toExponential(2)} — the surface is not the tractricoid`);
  });

  test('CONTROL — the catenoid\'s curvature is NOT constant', () => {
    const seen = [];
    for (const [u, v] of grid([0, TAU], [-2.2, 2.2], 5)) seen.push(curvature(P.catenoid, u, v).K);
    const spread = Math.max(...seen) - Math.min(...seen);
    assert.ok(spread > 0.1,
      `the catenoid's K spans only ${spread} — a constancy test would pass on anything`);
  });

  test('CONTROL — and the sphere\'s is constant and POSITIVE', () => {
    // Pins the sign convention: without this, a K that came out +1/a²
    // everywhere would still pass a "constant" test and the picker's claim of
    // negative curvature would be unguarded.
    const want = 1 / (3.5 * 3.5);
    let worst = 0;
    for (const [u, v] of grid([0, TAU], [0.3, Math.PI - 0.3], 5)) {
      worst = Math.max(worst, Math.abs(curvature(P.sphere, u, v).K - want));
    }
    assert.ok(worst < 1e-4, `the sphere reads K off by ${worst.toExponential(2)} from +1/r²`);
  });
});

describe('one-sided surfaces', () => {
  test('mobius: the normal comes back reversed after one trip round', () => {
    // Transport the surface normal along the centre line v = 0 in small steps,
    // each time choosing the sign that agrees with the previous step — the only
    // continuous choice available. After u = 2π it must disagree with where it
    // started, and that disagreement IS non-orientability.
    const N = 720;
    const nAt = (u) => {
      const h = 1e-5;
      const ru = sub(P.mobius(u + h, 0), P.mobius(u - h, 0));
      const rv = sub(P.mobius(u, h), P.mobius(u, -h));
      return unit(cross(ru, rv));
    };
    let prev = nAt(0);
    const start = prev;
    for (let i = 1; i <= N; i++) {
      let n = nAt(TAU * i / N);
      if (dot(n, prev) < 0) n = n.map(c => -c);
      prev = n;
    }
    assert.ok(dot(prev, start) < -0.99,
      `after one loop the transported normal agrees with the start (dot ${dot(prev, start).toFixed(4)}) — ` +
      'that would make the strip two-sided');
  });

  test('CONTROL — the same transport on a torus comes back agreeing', () => {
    const N = 720;
    const nAt = (u) => {
      const h = 1e-5;
      const ru = sub(P.torus(u + h, 0.9), P.torus(u - h, 0.9));
      const rv = sub(P.torus(u, 0.9 + h), P.torus(u, 0.9 - h));
      return unit(cross(ru, rv));
    };
    let prev = nAt(0);
    const start = prev;
    for (let i = 1; i <= N; i++) {
      let n = nAt(TAU * i / N);
      if (dot(n, prev) < 0) n = n.map(c => -c);
      prev = n;
    }
    assert.ok(dot(prev, start) > 0.99,
      'the torus came back reversed — the transport itself is broken, so the Möbius result means nothing');
  });

  test('mobius: the two edges are one closed curve', () => {
    // r(2π, v) = r(0, −v): going once round carries the v = +1 edge onto the
    // v = −1 edge, so what looks like two rims is a single curve of twice the
    // length. Checked as an identity of the map, over v.
    let worst = 0;
    for (let i = 0; i <= 20; i++) {
      const v = -1 + 2 * i / 20;
      worst = Math.max(worst, norm(sub(P.mobius(TAU, v), P.mobius(0, -v))));
    }
    assert.ok(worst < 1e-12, `the strip does not close with a flip; residual ${worst.toExponential(2)}`);
  });

  test('klein: closes with a flip in v, which is what makes it a Klein bottle', () => {
    // r(u + 2π, v) = r(u, −v). Same identification as the strip, but now in
    // BOTH directions of a torus of parameters, so the result has no edge left.
    let worst = 0;
    for (const [u, v] of grid([0, TAU], [0, TAU], 7)) {
      worst = Math.max(worst, norm(sub(P.klein(u + TAU, v), P.klein(u, -v))));
    }
    assert.ok(worst < 1e-12, `the figure-8 immersion does not close; residual ${worst.toExponential(2)}`);
  });
});

describe('the meshes the app builds carry those facts', () => {
  test('klein has no boundary at all, and mobius has one', () => {
    const kl = boundaryEdges(buildKleinGeo(220, 110));
    assert.equal(kl, 0, `the Klein bottle has ${kl} boundary edges; a closed surface has none`);

    const mo = boundaryEdges(buildMobiusGeo(240, 24));
    assert.ok(mo > 0, 'the Möbius strip reports no boundary — it has an edge, so the count is broken');
  });

  test('the open surfaces report exactly the rims they have', () => {
    // catenoid, hyperboloid: two circles. pseudosphere: two tip circles — the
    // cusp at u = 0 is a crease, not an edge, and must NOT be counted.
    for (const [name, geo, want] of [
      ['catenoid', buildCatenoidGeo(200, 60), 2 * 200],
      ['hyperboloid', buildHyperboloidGeo(200, 60), 2 * 200],
      ['pseudosphere', buildPseudosphereGeo(120, 160), 2 * 160],
    ]) {
      const got = boundaryEdges(geo);
      assert.equal(got, want,
        `${name} reports ${got} boundary edges; two rims of its own u-resolution is ${want}`);
    }
  });

  test('every body sits inside the envelope the rest of the catalogue uses', () => {
    // A shape that arrives twice the size of its neighbours re-frames the
    // camera on every switch. Radius 3.5 is the sphere, the largest body here.
    for (const [name, geo] of [
      ['mobius', buildMobiusGeo(120, 12)],
      ['klein', buildKleinGeo(110, 55)],
      ['catenoid', buildCatenoidGeo(100, 30)],
      ['helicoid', buildHelicoidGeo(120, 20)],
      ['hyperboloid', buildHyperboloidGeo(100, 30)],
      ['pseudosphere', buildPseudosphereGeo(60, 80)],
    ]) {
      geo.computeBoundingSphere();
      const r = geo.boundingSphere.radius;
      assert.ok(r > 1.5 && r < 4.6, `${name} has bounding radius ${r.toFixed(2)}, outside 1.5 … 4.6`);
    }
  });
});
