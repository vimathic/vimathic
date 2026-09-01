// tests/band-turbulence-grid.test.js
//
// The turbulence behind the SHATTER gesture must not draw a lattice.
//
// Run:
//   node --test tests/band-turbulence-grid.test.js
//
// ── The defect this guards ───────────────────────────────────────────────────
// turb() used to be  sum_{i=1..4} |sin(p.x*i) * cos(p.y*i)| / i.  Two properties
// of that spelling made a rectangular grid appear over the body, brightest on a
// Mirror finish and on the loud part of a beat:
//
//   * abs() kinks the first derivative wherever its argument crosses zero, and
//     those crossings are straight lines p.x*i = k*pi;
//   * the term is separable, f(x)*g(z), so those lines run along X and Z and
//     nowhere else.
//
// A kink in the height is a jump in the normal, and the argument is the
// UNDISPLACED world (x, z) — so the same lattice appeared under every formula
// and every shape, standing still while the music scaled it. It was reported
// from a photograph of the running app, not from a test, which is why this file
// exists.
//
// ── How it is measured ───────────────────────────────────────────────────────
// The turbulence reaches the product as buildBandMap's `tb`, one value per
// vertex, so it is measured there rather than through a private function. On a
// plane whose columns are dense enough to resolve them, |d2 tb/dx2| is averaged
// over the columns that sit ON a would-be kink line and over the rest, and the
// two are compared.
//
// EVERY assertion here carries the old spelling as a CONTROL, computed in this
// file and pushed through the same measurement. A probe that cannot see the
// defect it guards against is worth nothing, and this suite has been bitten by
// exactly that before — the first version of this measurement averaged over the
// whole plane, where the RIPPLE gesture swamps it, and reported 1.03x for a
// surface that visibly had the grid on it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildBandMap, ANALYSIS_GRID } from '../src/band-map.js';
import { BAND_MAP_REF_TIME } from '../src/math-visualizer.js';
import {
  MATH_COLLECTIONS, generateSurfaceFromFormula, FIELD_EXTENT,
} from '../src/math-collections.js';

const T_REF = BAND_MAP_REF_TIME;
// The argument the two call sites use: p = 3.5 * (x, z).
const P_SCALE = 3.5;
// 257 columns over the 7-unit plate — 0.0273 world units apart, so the closest
// kink pitch the old spelling had (pi/(3.5*4) = 0.224) is still eight columns
// wide and cannot be confused with a per-sample effect.
const N = 257;

/** The old, kinked, separable spelling — the control. */
function turbOld(px, pz) {
  let t = 0;
  for (let i = 1; i < 5; i++) t += Math.abs(Math.sin(px * i) * Math.cos(pz * i)) / i;
  return t;
}

function planeVerts(n = N, half = FIELD_EXTENT) {
  const V = n * n;
  const x = new Float32Array(V), z = new Float32Array(V);
  const s = (half * 2) / (n - 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) { x[j * n + i] = -half + i * s; z[j * n + i] = -half + j * s; }
  }
  return { x, z, R: half, k: null, step: s, n };
}

function findFormula(key) {
  for (const col of Object.values(MATH_COLLECTIONS)) if (col.formulas[key]) return col.formulas[key];
  throw new Error(`no formula named ${key}`);
}

/** tb as the product computes it, for one formula. */
function shippedTb(key, verts) {
  const f = findFormula(key);
  const field = generateSurfaceFromFormula(
    f.f, { amp: 1, freq: 1, comp: 0.5 }, ANALYSIS_GRID, FIELD_EXTENT, T_REF);
  return buildBandMap(field, ANALYSIS_GRID, FIELD_EXTENT, verts).tb;
}

/** The same array the control spelling would have produced. */
function controlTb(verts) {
  const out = new Float32Array(verts.x.length);
  for (let i = 0; i < out.length; i++) out[i] = turbOld(verts.x[i] * P_SCALE, verts.z[i] * P_SCALE);
  return out;
}

/**
 * Creases on the axis-aligned kink lines of the OLD spelling, against creases
 * everywhere else. 1.0 means the lines are not special; well above 1.0 means a
 * lattice sits on them.
 */
function latticeRatio(a, verts) {
  const { n, step } = verts;
  const onLine = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = -FIELD_EXTENT + i * step;
    for (let h = 1; h < 5; h++) {
      const pitch = Math.PI / (P_SCALE * h);
      if (Math.abs(x / pitch - Math.round(x / pitch)) * pitch <= step * 0.5) { onLine[i] = 1; break; }
    }
  }
  let on = 0, onN = 0, off = 0, offN = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 1; i < n - 1; i++) {
      const idx = j * n + i;
      const c = Math.abs(a[idx - 1] - 2 * a[idx] + a[idx + 1]);
      if (onLine[i]) { on += c; onN++; } else { off += c; offN++; }
    }
  }
  assert.ok(onN > 0 && offN > 0, 'the measurement found no columns to compare');
  return (on / onN) / (off / offN);
}

function moments(a) {
  let s = 0, s2 = 0, mn = Infinity, mx = -Infinity;
  for (const v of a) { s += v; s2 += v * v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const mean = s / a.length;
  return { mean, sd: Math.sqrt(s2 / a.length - mean * mean), mn, mx };
}

describe('the SHATTER turbulence carries no lattice', () => {
  const verts = planeVerts();
  const control = controlTb(verts);
  const controlRatio = latticeRatio(control, verts);

  test('the control really does show the grid — the probe can fail', () => {
    // Without this the three assertions below would also pass on a turbulence
    // that is simply flat, or on a measurement that reads the wrong array.
    assert.ok(controlRatio > 1.30,
      `the old spelling should crease on its own kink lines; measured ${controlRatio.toFixed(3)}x`);
  });

  // Two formulas, because the map — and therefore which vertices the gesture
  // ever reaches — is different for each, and a lattice that survived on one of
  // them would be the same bug.
  for (const key of ['eigenField', 'determinant']) {
    test(`${key}: creases on the axis lines are no worse than off them`, () => {
      const ratio = latticeRatio(shippedTb(key, verts), verts);
      assert.ok(ratio < 1.15,
        `tb creases ${ratio.toFixed(3)}x harder on the axis-aligned lines than off them ` +
        `(control, the old spelling: ${controlRatio.toFixed(3)}x)`);
    });
  }

  test('the turbulence is smooth: no kinks at any scale', () => {
    // The structural half of the defect, and independent of where the kinks
    // happen to fall — so a future spelling that kinks along some OTHER family
    // of lines is caught here even though latticeRatio, which only knows about
    // the axes, would report 1.0.
    //
    // For a twice-differentiable f the largest second difference over a grid
    // falls off as h^2, so halving the step divides it by about 4. At a kink
    // the second difference is the size of the jump in the slope times h, so it
    // only halves. The two are far enough apart that the reading needs no
    // tuning: measured 4.00 for this spelling and 2.00 for the control.
    const orderOf = (fn) => {
      const peak = (n) => {
        const s = (FIELD_EXTENT * 2) / (n - 1);
        let mx = 0;
        for (let j = 0; j < n; j++) {
          for (let i = 1; i < n - 1; i++) {
            const z = (-FIELD_EXTENT + j * s) * P_SCALE;
            const x0 = (-FIELD_EXTENT + (i - 1) * s) * P_SCALE;
            const x1 = (-FIELD_EXTENT + i * s) * P_SCALE;
            const x2 = (-FIELD_EXTENT + (i + 1) * s) * P_SCALE;
            mx = Math.max(mx, Math.abs(fn(x0, z) - 2 * fn(x1, z) + fn(x2, z)));
          }
        }
        return mx;
      };
      return peak(401) / peak(801);
    };
    // The shipped spelling, read through the same public route the rest of this
    // file uses: tb is motionTurb evaluated at the vertices, so a plane one
    // vertex tall recovers the function itself.
    const shipped = (px, pz) => {
      const one = { x: new Float32Array([px / P_SCALE]), z: new Float32Array([pz / P_SCALE]), R: FIELD_EXTENT, k: null };
      return buildBandMap(new Float32Array(0), ANALYSIS_GRID, FIELD_EXTENT, one).tb[0];
    };
    const control = orderOf(turbOld);
    assert.ok(control < 2.6,
      `the control should only halve at its kinks; measured ${control.toFixed(2)}x — the probe is not reading kinks`);
    const now = orderOf(shipped);
    assert.ok(now > 3.5,
      `second differences fall off only ${now.toFixed(2)}x per halving (smooth is ~4, kinked ~2, ` +
      `control ${control.toFixed(2)}) — the turbulence has kinks in it`);
  });

  test('the statistics the call sites depend on are unchanged', () => {
    // bandMotion centres the turbulence on 0.9 so SHATTER shakes instead of
    // inflating, and GPU modes 0, 3 and 32 add it as relief with a fixed gain.
    // Both read its mean and spread, not its shape, so the replacement was
    // fitted to the control's moments and has to stay fitted.
    const now = moments(shippedTb('eigenField', verts));
    const was = moments(control);
    assert.ok(Math.abs(now.mean - was.mean) < 0.01,
      `mean moved ${was.mean.toFixed(4)} → ${now.mean.toFixed(4)}`);
    assert.ok(Math.abs(now.sd - was.sd) < 0.01,
      `spread moved ${was.sd.toFixed(4)} → ${now.sd.toFixed(4)}`);
    assert.ok(now.mn > -0.2 && now.mx < 2.0,
      `range ${now.mn.toFixed(3)}..${now.mx.toFixed(3)} left the control's 0..1.8`);
  });
});
