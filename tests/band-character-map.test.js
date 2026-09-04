// tests/band-character-map.test.js
//
// The character map: which of the 24 bands each point listens to, when that is
// decided by the FORMULA rather than by distance from the axis.
//
// Run:
//   node --test tests/band-character-map.test.js
//
// ── What these are for ───────────────────────────────────────────────────────
// The complaint this replaces was the same rings under every shape, so
// the load-bearing property is not correctness in the usual sense — it is
// DIFFERENCE. A map that is subtly wrong still looks like magic; a map that is
// the same for every formula is the bug being fixed, wearing a new coat. So the
// first group measures how far apart two formulas' layouts are, and the second
// pins the cases where falling back to rings is the RIGHT answer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildBandMap, radialU, ANALYSIS_GRID } from '../src/band-map.js';
import { BAND_MAP_REF_TIME } from '../src/math-visualizer.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHADER_SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/shaders.js'), 'utf8');
import {
  MATH_COLLECTIONS, generateSurfaceFromFormula, bandRingValue, FIELD_EXTENT,
} from '../src/math-collections.js';

const P = { amp: 1, freq: 1, comp: 0.5 };
// Not a literal 7.0 typed here a third time. There were four of these — this
// one, the one in tests/band-body-curvature.test.js, the shipped constant and
// the shader's BAND_T — and nothing compared any of them, so a change to the
// reference instant could move the product and leave every test green.
const T_REF = BAND_MAP_REF_TIME;

/** A plane's vertices — the commonest body, and the one with an interior. */
function planeVerts(n = 81, half = 3.5) {
  const V = n * n;
  const x = new Float32Array(V), z = new Float32Array(V);
  for (let j = 0, k = 0; j < n; j++) {
    for (let i = 0; i < n; i++, k++) {
      x[k] = -half + (2 * half) * i / (n - 1);
      z[k] = -half + (2 * half) * j / (n - 1);
    }
  }
  return { x, z, R: half };
}

/** A body with NO interior: every vertex at the same radius. */
function circleVerts(n = 162, r = 3.5) {
  const x = new Float32Array(n), z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n;
    x[i] = Math.cos(a) * r; z[i] = Math.sin(a) * r;
  }
  return { x, z, R: r };
}

const fieldOf = (col, key, t = T_REF) => generateSurfaceFromFormula(
  MATH_COLLECTIONS[col].formulas[key].f, P, ANALYSIS_GRID, FIELD_EXTENT, t);

const mapOf = (col, key, verts, t = T_REF) =>
  buildBandMap(fieldOf(col, key, t), ANALYSIS_GRID, FIELD_EXTENT, verts);

const band = u => Math.round(u * 23);
/** Mean distance between two layouts, in bands out of 24. */
const layoutDistance = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(band(a[i]) - band(b[i]));
  return s / a.length;
};

describe('different formulas get different layouts', () => {
  const verts = planeVerts();

  test('four formulas of different character lay the bands out differently', () => {
    // The number to beat is 0.00 — that is what the radius rule scores for
    // EVERY pair, because it never reads the formula. Two statistically
    // independent layouts would score 23/3 = 7.67, so anything past ~4 means
    // the maps genuinely disagree about most of the surface.
    const picks = [
      ['fractals', 'mandelbrot'],
      ['cellularAutomata', 'rule90'],
      ['probability', 'gaussian'],
      ['trigonometry', 'lissajous'],
    ].filter(([c, k]) => MATH_COLLECTIONS[c]?.formulas?.[k]);
    assert.ok(picks.length >= 3, 'the fixtures no longer name formulas this build has');

    const maps = picks.map(([c, k]) => [k, mapOf(c, k, verts).u]);
    let worst = Infinity, worstPair = '';
    for (let i = 0; i < maps.length; i++) {
      for (let j = i + 1; j < maps.length; j++) {
        const d = layoutDistance(maps[i][1], maps[j][1]);
        if (d < worst) { worst = d; worstPair = `${maps[i][0]} / ${maps[j][0]}`; }
      }
    }
    assert.ok(worst > 2,
      `the closest pair (${worstPair}) is only ${worst.toFixed(2)} bands apart — ` +
      'these formulas would pulse in nearly the same places');
  });

  test('and they are far from the rings they replace', () => {
    const rad = new Float32Array(verts.x.length);
    for (let i = 0; i < rad.length; i++) rad[i] = radialU(verts.x[i], verts.z[i], verts.R);
    const m = mapOf('cellularAutomata', 'rule90', verts).u;
    const d = layoutDistance(m, rad);
    assert.ok(d > 3,
      `rule 90's layout sits ${d.toFixed(2)} bands from the radius rule — that is still a target`);
  });

  test('CONTROL — the radius rule scores zero against itself, whatever the formula', () => {
    // Without this the thresholds above could be met by a metric that simply
    // reports large numbers for everything.
    const rad = new Float32Array(verts.x.length);
    for (let i = 0; i < rad.length; i++) rad[i] = radialU(verts.x[i], verts.z[i], verts.R);
    assert.equal(layoutDistance(rad, rad), 0);
  });

  test('every band gets a share of the surface — no formula collapses onto one', () => {
    // The layout is equalised over the body's own vertices, so this is true by
    // construction; it is pinned because losing it is how the effect would turn
    // into "one ring pumps and the rest is dead" without any error anywhere.
    for (const [c, k] of [['fractals', 'mandelbrot'], ['cellularAutomata', 'rule90']]) {
      if (!MATH_COLLECTIONS[c]?.formulas?.[k]) continue;
      const { u } = mapOf(c, k, verts);
      const occ = new Int32Array(24);
      for (let i = 0; i < u.length; i++) occ[band(u[i])]++;
      const used = Array.from(occ).filter(n => n / u.length >= 0.005).length;
      assert.ok(used >= 16, `${k} spends only ${used} of 24 bands on 0.5 % of the surface or more`);
    }
  });
});

describe('falling back to rings, where rings are the right answer', () => {
  const verts = planeVerts();

  test('a perfectly flat field gives exactly the radius rule', () => {
    const flat = new Float32Array(ANALYSIS_GRID * ANALYSIS_GRID);
    const { u, conf, stages } = buildBandMap(flat, ANALYSIS_GRID, FIELD_EXTENT, verts);
    assert.equal(conf, 0);
    assert.deepEqual(stages, ['radius']);
    let worst = 0;
    for (let i = 0; i < u.length; i++) {
      worst = Math.max(worst, Math.abs(u[i] - radialU(verts.x[i], verts.z[i], verts.R)));
    }
    assert.ok(worst < 1e-6, `a flat field drifted ${worst} from the rings it should reproduce`);
  });

  test('no field at all is not an error', () => {
    for (const bad of [null, undefined, new Float32Array(0)]) {
      const { u, stages } = buildBandMap(bad, ANALYSIS_GRID, FIELD_EXTENT, verts);
      assert.equal(stages[0], 'radius');
      assert.equal(u.length, verts.x.length);
    }
  });

  test('a body with no interior still spends the spectrum', () => {
    // On `circle` every vertex is at one radius, so the radius rule has nothing
    // to say and puts all 162 of them on ONE band. The map's tie-break is what
    // rescues that case — measured, not asserted.
    const circ = circleVerts();
    const radial = new Int32Array(24);
    for (let i = 0; i < circ.x.length; i++) radial[band(radialU(circ.x[i], circ.z[i], circ.R))]++;
    const radialUsed = Array.from(radial).filter(n => n > 0).length;
    assert.equal(radialUsed, 1, 'the fixture no longer reproduces the degenerate case it is about');

    const { u } = mapOf('cellularAutomata', 'rule90', circ);
    const occ = new Int32Array(24);
    for (let i = 0; i < u.length; i++) occ[band(u[i])]++;
    const used = Array.from(occ).filter(n => n > 0).length;
    assert.ok(used >= 8, `the map spends only ${used} bands on a body the radius rule reduces to 1`);
  });
});

describe('the lookup uses the map when there is one', () => {
  test('bandRingValue reads the map by vertex index, and the radius without it', () => {
    const bands = new Float32Array(24);
    bands[23] = 1;                       // only the top band is lit
    const u = new Float32Array([0, 0.5, 1]);

    // With a map: vertex 2 carries u = 1, so it hears band 23 whatever its (x, z).
    const withMap = bandRingValue({ bands, depth: 1, radius: 3.5, u }, 0, 0, 2);
    assert.ok(Math.abs(withMap - 1) < 1e-6, `a mapped vertex read ${withMap}, not the lit band`);

    // Same call at the same coordinates without a map: the origin is band 0,
    // which is dark, so it reads 0.
    const noMap = bandRingValue({ bands, depth: 1, radius: 3.5 }, 0, 0, 2);
    assert.ok(Math.abs(noMap) < 1e-6, `the radius rule read ${noMap} at the axis with only band 23 lit`);
  });

  test('the map does not change what OFF means', () => {
    const bands = new Float32Array(24).fill(1);
    const u = new Float32Array([1, 1, 1]);
    for (const layer of [{ bands, depth: 0, radius: 3.5, u }, { bands, depth: 0, radius: 3.5 }]) {
      assert.equal(bandRingValue(layer, 2, 2, 0), 0);
    }
  });
});

describe('the gesture: how a band moves a point, not only how far', () => {
  const bands = new Float32Array(24).fill(1);          // every band at full
  const layerAt = (u, r, tb, time) => ({
    bands, depth: 1, radius: 3.5,
    u: new Float32Array([u]), r: new Float32Array([r]), tb: new Float32Array([tb]), time,
  });

  test('a smooth place breathes: one sign, no oscillation', () => {
    // u = 0 is the broad end of the map. Over a whole cycle of the gesture's
    // clock the value must never change sign — a swell, not a shake.
    let neg = 0;
    for (let t = 0; t < 12; t += 0.25) {
      if (bandRingValue(layerAt(0.05, 2.0, 1.2, t), 2, 2, 0) < 0) neg++;
    }
    assert.equal(neg, 0, 'the smooth end of the map oscillates instead of breathing');
  });

  test('a finely corrugated place shakes: zero-mean, both signs', () => {
    // u = 1 is the fine end. It has to go both ways, or it is just a lumpier
    // breathe — which is what the first draft of this was.
    let neg = 0, pos = 0, sum = 0, n = 0;
    for (let t = 0; t < 12; t += 0.1) {
      const v = bandRingValue(layerAt(0.98, 2.0, 1.6, t), 2, 2, 0);
      if (v < 0) neg++; else if (v > 0) pos++;
      sum += v; n++;
    }
    assert.ok(neg > 10 && pos > 10, `the fine end moved ${neg} down and ${pos} up — it is not shaking`);
    assert.ok(Math.abs(sum / n) < 0.25, `the fine end has a mean of ${(sum / n).toFixed(3)}, so it swells rather than vibrates`);
  });

  test('the gesture needs the map — under the radius rule it stays a plain push', () => {
    // Nothing about the radius says anything about the formula, so there is no
    // character to give a gesture to. Same amplitude every frame.
    const plain = { bands, depth: 1, radius: 3.5 };
    const a = bandRingValue(plain, 2, 2, 0);
    const b = bandRingValue(plain, 2, 2, 0);
    assert.equal(a, b);
    assert.ok(a > 0);
  });

  test('CPU and GPU evaluate the SAME gesture — checked numerically', () => {
    // The first version of this test matched regexes against the shader text
    // and claimed, in its own comment, that "the CPU half is checked
    // numerically below". It was not: every assertion read SHADER_SRC, so any
    // coefficient could be changed on the CPU side and the test stayed green.
    // An external review pointed that out.
    //
    // Now the shader's numbers are PARSED out of its own bandMotion body and
    // fed to an independent model, which is compared against what the CPU
    // actually computes through bandRingValue. A change on either side that is
    // not matched on the other turns this red.
    const body = SHADER_SRC.slice(SHADER_SRC.indexOf('float bandMotion('));
    const num = (re, what) => {
      const m = body.match(re);
      assert.ok(m, `could not find ${what} in the shader's bandMotion`);
      return Number(m[1]);
    };
    const rk   = num(/ripple\s*=\s*amp \* sin\(rr \* ([\d.]+)/, 'the ripple wavenumber');
    const rw   = num(/ripple[^;]*- T \* ([\d.]+)/, 'the ripple time rate');
    const ru   = num(/ripple[^;]*\+ u \* ([\d.]+)/, 'the ripple phase-by-u');
    const tbC  = num(/shatter\s*=\s*amp \* \(turb\([^)]*\) - ([\d.]+)/, 'the turbulence centre');
    const tbG  = num(/shatter[^;]*\) \* ([\d.]+) \* sin/, 'the shatter gain');
    const shw  = num(/shatter[^;]*sin\(T \* ([\d.]+)/, 'the shatter time rate');
    const shu  = num(/shatter[^;]*\+ u \* ([\d.]+)\)/, 'the shatter phase-by-u');
    // The ripple crossfade lives inside the return's nested mix(); the shatter
    // one is hoisted into toShatter so the noise can be skipped.
    const t1a  = num(/mix\(breathe, ripple, smoothstep\(([\d.]+),/, 'the ripple crossfade start');
    const t1b  = num(/mix\(breathe, ripple, smoothstep\([\d.]+, ([\d.]+),/, 'the ripple crossfade end');
    const t2a  = num(/toShatter = smoothstep\(([\d.]+)/, 'the shatter crossfade start');
    const t2b  = num(/toShatter = smoothstep\([\d.]+, ([\d.]+)/, 'the shatter crossfade end');

    const ss = (a0, b0, x) => { const t = Math.min(1, Math.max(0, (x - a0) / (b0 - a0))); return t * t * (3 - 2 * t); };
    const model = (amp, u, rr, tb, t) => {
      const breathe = amp;
      const ripple  = amp * Math.sin(rr * rk - t * rw + u * ru);
      const shatter = amp * (tb - tbC) * tbG * Math.sin(t * shw + u * shu);
      const mid = breathe + (ripple - breathe) * ss(t1a, t1b, u);
      return mid + (shatter - mid) * ss(t2a, t2b, u);
    };

    const bands = new Float32Array(24).fill(1);   // amplitude 1 at every band
    let worst = 0, worstAt = '';
    for (const u of [0, 0.13, 0.3, 0.5, 0.62, 0.8, 1]) {
      for (const rr of [0.4, 2.1, 3.5]) {
        for (const tb of [0.2, 0.9, 1.7]) {
          for (const t of [0, 1.7, 9.4]) {
            const layer = {
              bands, depth: 1, radius: 3.5,
              u: new Float32Array([u]), r: new Float32Array([rr]), tb: new Float32Array([tb]), time: t,
            };
            const got = bandRingValue(layer, 0, 0, 0);
            const want = model(1, u, rr, tb, t);
            const d = Math.abs(got - want);
            if (d > worst) { worst = d; worstAt = `u=${u} rr=${rr} tb=${tb} t=${t}: cpu ${got.toFixed(5)} vs shader-model ${want.toFixed(5)}`; }
          }
        }
      }
    }
    assert.ok(worst < 1e-6,
      `the CPU gesture differs from the shader's own numbers — worst ${worst.toExponential(2)} at ${worstAt}`);
  });
});
