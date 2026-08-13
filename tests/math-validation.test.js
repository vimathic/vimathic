// tests/math-validation.test.js
//
// Numeric validation of math-collections.js against canonical reference
// values. Anchors include NIST DLMF (Digital Library of Mathematical
// Functions), Wolfram Alpha, and scipy.special — the same sources a
// numerical-methods textbook would cite.
//
// Run:
//   node --test tests/math-validation.test.js
//
// ── Test taxonomy ─────────────────────────────────────────────────────────
// Tests are tiered by the kind of guarantee they can give:
//
//   Tier A — closed-form, machine-precision (~1e-12).
//            The formula has a known exact value at the test point;
//            anything outside floating-point round-off is a bug.
//   Tier B — bounded approximation (1e-3 to 1e-7 per formula).
//            The formula is a series or polynomial that converges to a
//            known value; tolerance reflects the truncation depth.
//   Tier C — qualitative (sign, peak location, monotonicity,
//            boundedness). Used for formulas where the canonical value
//            is hard to compute but a high-level property — like
//            "Mandelbrot interior produces low iteration counts" —
//            is easy to check.
//
// Each test commented above the call chain shows the substitution that
// produces the expected value, so a failure can be diagnosed by
// re-running the substitution in a calculator rather than re-deriving
// from scratch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MATH_COLLECTIONS,
  VOLUME_FORMULAS,
  getFormula,
  generateSurfaceFromFormula,
  generateCollapseScalarField,
  applyCollapseField,
  gamma,
} from '../src/math-collections.js';
// ── Helpers ───────────────────────────────────────────────────────────────────

/** Assert two numbers agree within absolute tolerance. */
function near(actual, expected, tol, msg) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? ''}: got ${actual}, expected ${expected} ± ${tol} (diff=${Math.abs(actual - expected)})`
  );
}

// Baseline parameters: amp=1, freq=1, comp=0.5. Audio modulation is
// deliberately off so each test exercises the formula's canonical form
// rather than the reactive scaling. Tests that need a specific knob
// position override BASELINE inline.
const BASELINE = { amp: 1, freq: 1, comp: 0.5 };

/** Look up a formula by collection/key and evaluate it at one (x, z, t) point. */
function evalAt(colId, key, x, z, time = 0, params = BASELINE) {
  const f = getFormula(colId, key);
  assert.ok(f, `Formula not found: ${colId}/${key}`);
  return f.f(x, z, time, params);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER A — Machine-precision tests (tolerance: 1e-12)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tier A — Trigonometry (closed-form)', () => {
  test('sinCos at origin is zero', () => {
    near(evalAt('trigonometry', 'sinCos', 0, 0), 0, 1e-15);
  });

  test('pythagorean identity: sin²-cos² = -cos(2x) at x=0 → -1', () => {
    // Implementation: (sin(r+t)² - cos(r+t)²) where r=0, t=0 → 0 - 1 = -1.
    // Output is multiplied by amp · 0.45.
    const v = evalAt('trigonometry', 'pythagorean', 0, 0, 0);
    near(v, -1 * 0.45, 1e-12);
  });

  test('doublAngle: sin(2x) at x=π/4 with freq=1, comp=0.5 → max', () => {
    // sin(2 · π/4 · 1.5) = sin(3π/4) ≈ 0.7071
    // Output: 0.7071 · 0.5 (amp factor).
    const x = Math.PI / 4;
    const v = evalAt('trigonometry', 'doublAngle', x, 0, 0);
    near(v, Math.sin(2 * x * 1.5) * 0.5, 1e-12);
  });

  test('travelingWave at x=0, t=0 is zero', () => {
    near(evalAt('trigonometry', 'travelingWave', 0, 0, 0), 0, 1e-15);
  });

  test('inverseTrig at x=0 is zero (asin(0)=0)', () => {
    near(evalAt('trigonometry', 'inverseTrig', 0, 0, 0), 0, 1e-15);
  });

  test('atan2Field at x=1,z=0 → atan2(0,1) = 0', () => {
    // sin(0·3 + 1·2 - 0) = sin(2)
    near(evalAt('trigonometry', 'atan2Field', 1, 0, 0), Math.sin(2) * 0.45, 1e-12);
  });

  test('chebyshevTrig at θ=0 → cos(0) = 1', () => {
    // x=0 → theta=0, cos(n·0)=1, output 1 · 0.45 · exp(0)
    near(evalAt('trigonometry', 'chebyshevTrig', 0, 0, 0, { amp: 1, freq: 1, comp: 0 }), 1 * 0.45, 1e-12);
  });
});

describe('Tier A — Probability & Statistics (closed-form PDFs)', () => {
  test('gaussian peak: f(0,0) ≈ 1 (centered, normalized envelope removed)', () => {
    // gaussian formula: normalPDF · sigma · sqrt(TAU) — peak-normalized envelope = 1.
    // At x=0, z=0, t=0: mu=0, sigma = 0.6 + 0.5·0.3 = 0.75.
    // normalPDF(0, 0, 0.75) = 1/(0.75·√(2π)); multiplied by 0.75·√(2π) → 1; then · 0.55.
    near(evalAt('probability', 'gaussian', 0, 0, 0), 0.55, 1e-12);
  });

  test('cauchy peak: 1/π at x=0', () => {
    // 1/(π·(1+0)) = 1/π → · amp · 0.5 · exp(0) → 0.5/π
    near(evalAt('probability', 'cauchy', 0, 0, 0), 0.5 / Math.PI, 1e-15);
  });

  test('laplace peak: 1/(2b) at x=0', () => {
    // b = 0.5 + comp·0.5 = 0.75 with comp=0.5
    // exp(0) / (2·0.75) = 1/1.5; · 0.5 → 1/3
    near(evalAt('probability', 'laplace', 0, 0, 0), 1 / 3, 1e-12);
  });

  test('entropyLandscape: H(p=0.5) = 1', () => {
    // p = 0.5 corresponds to x=0 (p = (x+3.5)/7 = 0.5)
    // H = -(0.5·log2(0.5) + 0.5·log2(0.5)) = 1; · 0.45 = 0.45
    near(evalAt('probability', 'entropyLandscape', 0, 0, 0), 0.45, 1e-12);
  });

  test('entropyLandscape: H(p=1) → 0 (deterministic)', () => {
    // p = (3.5+3.5)/7 = 1, clamped to 0.999. H ≈ 0 (close, not exact).
    // Tolerance is generous to allow for the clamp(0.001, 0.999) edge.
    const v = evalAt('probability', 'entropyLandscape', 3.5, 0, 0);
    near(v, 0, 1e-2);
  });

  test('chiSquare with k=2 reduces to exponential at x=2', () => {
    // For comp=0.5, k = round(1 + 0.5·7) = round(4.5) = 5 — not 2.
    // To pin k=2 we need comp=1/7 → round(1 + 1) = 2.
    // χ²(x; 2) = (1/2)·exp(-x/2). At x=2: (1/2)·exp(-1) ≈ 0.1839.
    // Input x is mapped via (x+3.5)/7·10 → for xv=2, raw x=-2.1.
    const params = { amp: 1, freq: 1, comp: 1/7 };
    const v = evalAt('probability', 'chiSquare', -2.1, 0, 0, params);
    near(v, 0.5 * Math.exp(-1), 5e-3);
  });
});

describe('Tier A — Complex Numbers (closed-form)', () => {
  test('euler at θ=0 → cos(0) = 1', () => {
    near(evalAt('complexNumbers', 'euler', 0, 0, 0), 1 * 0.45, 1e-12);
  });

  test('eulerIm: at z=0 → sin(x)', () => {
    // exp(0) · sin(x·1 + 0) = sin(x). At x=π/2: sin(π/2)=1, · 0.45
    near(evalAt('complexNumbers', 'eulerIm', Math.PI / 2, 0, 0), 0.45, 1e-12);
  });

  test('moivre at θ=0, n=1 → cos(0+0) = 1', () => {
    // n = round(1 + 0·6) = 1
    const params = { amp: 1, freq: 1, comp: 0 };
    near(evalAt('complexNumbers', 'moivre', 0, 0, 0, params), 0.45, 1e-12);
  });

  test('riemannSphere: r=0 → -1 (south pole)', () => {
    // (0-1)/(0+1) = -1, · 0.5
    near(evalAt('complexNumbers', 'riemannSphere', 0, 0, 0), -0.5, 1e-15);
  });

  test('riemannSphere: r²=1 → 0 (equator)', () => {
    // x=1, z=0, freq=1: r²=1, (1-1)/(1+1) = 0
    near(evalAt('complexNumbers', 'riemannSphere', 1, 0, 0), 0, 1e-15);
  });

  test('cauchyRiemann: x²-z² is harmonic — verify at unit point', () => {
    // x=1, z=0: 1 - 0 = 1, · 0.18 · (1 + sin(0)·0.2) = 0.18
    near(evalAt('complexNumbers', 'cauchyRiemann', 1, 0, 0), 0.18, 1e-12);
  });

  test('argandField: at z=0,x=1, n=1 → sin(0)=0', () => {
    const params = { amp: 1, freq: 1, comp: 0 };
    near(evalAt('complexNumbers', 'argandField', 1, 0, 0, params), 0, 1e-15);
  });
});

describe('Tier A — Fourier Series (truncated but exact)', () => {
  test('squareWave: at x=0 should be ~0 (zero crossing of square wave)', () => {
    // 4/π · Σ sin(0)/(2k-1) = 0 since sin(0) = 0
    near(evalAt('fourierSeries', 'squareWave', 0, 0, 0), 0, 1e-12);
  });

  test('triangleWave: at x=0 → 0 (zero crossing)', () => {
    near(evalAt('fourierSeries', 'triangleWave', 0, 0, 0), 0, 1e-12);
  });

  test('parseval: Σ|cₙ|² Fourier coefficients at n=1 (k=1) > 0', () => {
    // For square wave c_1 = 4/π, magnitude > 0.
    // x = (1-1)/14·7 - 3.5 — for n=1, x such that (x+3.5)/7·14 ≈ 0 → x ≈ -3.5.
    const v = evalAt('fourierSeries', 'parseval', -3.5, 0, 0);
    assert.ok(v > 0, 'Parseval coefficient at n=1 must be positive');
  });

  test('dirichletKernel: D_N(0) = 2N+1 (peak)', () => {
    // sin((N+0.5)·0) / sin(0/2) → 0/0; implementation adds +1e-6 to avoid the
    // division, so we check just below the peak.
    // N = 2 + round(1·12) = 14
    // D_14(near 0) ≈ 2N+1 = 29, scaled by amp · 0.06 · exp(0) = 1.74.
    // Concretely: sin(14.5·1e-6) / sin(0.5e-6) ≈ 14.5/0.5 = 29.
    const params = { amp: 1, freq: 1, comp: 1.0 };
    const v = evalAt('fourierSeries', 'dirichletKernel', 0, 0, 0, params);
    near(v, 29 * 0.06, 0.5);
  });

  test('fejerKernel: F_N(0) ≈ 1 (peak normalized)', () => {
    // (sin(N·1e-6/2) / sin(1e-6/2))² / N → N²/N = N
    // N = 2 + round(14) = 16; peak ≈ N · 0.06 = 0.96
    const params = { amp: 1, freq: 1, comp: 1.0 };
    const v = evalAt('fourierSeries', 'fejerKernel', 0, 0, 0, params);
    near(v, 16 * 0.06, 0.3);
  });
});

describe('Tier A — Differential Equations (closed-form solutions)', () => {
  test('exponentialDecay at T=0 → 1', () => {
    // T = clamp((-3.5+3.5)/7·8, 0, 8) = 0
    // exp(-λ·0) = 1, · 0.55 · exp(0) = 0.55
    near(evalAt('differentialEqs', 'exponentialDecay', -3.5, 0, 0), 0.55, 1e-12);
  });

  test('logisticGrowth at T=∞ → carrying capacity K=1', () => {
    // T=8: K/(1 + (K/x0 - 1)·exp(-r·8)) → 1 (exp(-8r) is small).
    // · 0.5 · exp(0) = 0.5
    near(evalAt('differentialEqs', 'logisticGrowth', 3.5, 0, 0), 0.5, 1e-2);
  });

  test('simpleHarmonic: cos(0) = 1 at x=0,t=0', () => {
    // ω = 1 + comp·2 = 2 with comp=0.5
    // cos(2·(0+0)) = 1, · 0.45
    near(evalAt('differentialEqs', 'simpleHarmonic', 0, 0, 0), 0.45, 1e-12);
  });

  test('schrodingerBox: ψ_1 vanishes at x=±L/2 (boundary)', () => {
    // n=1 with comp=0: round(1 + 0·5) = 1
    // xi = clamp((x·1+3.5)/7, 0, 1); for x=-3.5: xi=0; sin(π·0)=0
    const params = { amp: 1, freq: 1, comp: 0 };
    near(evalAt('differentialEqs', 'schrodingerBox', -3.5, 0, 0, params), 0, 1e-12);
  });

  test('schrodingerBox: ψ_1 peak at x=0 (xi=0.5)', () => {
    // sin(π·0.5) = 1, · sqrt(2/L) = sqrt(2) ≈ 1.414, · cos(0) = 1, · 0.45
    const params = { amp: 1, freq: 1, comp: 0 };
    near(evalAt('differentialEqs', 'schrodingerBox', 0, 0, 0, params), Math.SQRT2 * 0.45, 1e-12);
  });

  test('laplacePDE: x²-z² is harmonic, max at axis', () => {
    // (1²-0²)·0.2 = 0.2 at x=1, z=0
    near(evalAt('differentialEqs', 'laplacePDE', 1, 0, 0), 0.2, 1e-12);
  });

  test('pendulumNonLinear: H = ½ω²-cos(θ) symmetric', () => {
    // At θ=0, ω=0: H = -1; output = sin(-2 + 0) · 0.35
    const v1 = evalAt('differentialEqs', 'pendulumNonLinear', 0, 0, 0);
    near(v1, Math.sin(-2) * 0.35, 1e-12);
  });
});

describe('Tier A — Integral Transforms', () => {
  test('fourierTransform of Gaussian at ω=0: √(π/a)', () => {
    // a = 0.5 + 0.5·0.5 = 0.75, ω = 0
    // √(π/0.75) · exp(0) · 0.25 ≈ 2.0466 · 0.25 ≈ 0.5117
    near(evalAt('integralTransforms', 'fourierTransform', 0, 0, 0), Math.sqrt(Math.PI / 0.75) * 0.25, 1e-12);
  });

  test('fourierInverse: sinc(0) = 1', () => {
    // sin(r)/r as r→0 → 1; implementation has +1e-9 to avoid the singularity.
    const v = evalAt('integralTransforms', 'fourierInverse', 0, 0, 0);
    near(v, 1 * 0.5, 1e-4);
  });

  test('laplaceTransform: L{1}(s=1) = 1', () => {
    // s clamped: (x+3.5)/7·5 + 0.1; for s=1: x = -2.24
    // 1/1 · 0.5 = 0.5
    const xForS1 = -2.24;
    near(evalAt('integralTransforms', 'laplaceTransform', xForS1, 0, 0), 0.5, 1e-2);
  });

  test('hilbertTransform: H[sin(ωx)] returns sin+(-cos) structure', () => {
    // At x=0, t=0: sin(0) + (-cos(0)) = -1; · 0.5 = -0.5; · 0.45
    // ω = 1 + comp·2 = 2 with comp=0.5
    near(evalAt('integralTransforms', 'hilbertTransform', 0, 0, 0), -0.5 * 0.45, 1e-12);
  });
});

describe('Tier A — Topology & Geometry', () => {
  test('hyperbolicParaboloid at origin → 0 (saddle point)', () => {
    near(evalAt('topology', 'hyperbolicParaboloid', 0, 0, 0), 0, 1e-15);
  });

  test('catenoid at z=0: r = a·cosh(0) = a', () => {
    // a=0.5, cosh(0)=1, r=0.5; (0.5 - 0)·0.3 = 0.15 at x=0, z=0 (rxy=0)
    near(evalAt('topology', 'catenoid', 0, 0, 0), 0.15, 1e-12);
  });

  test('helicoid: linear in θ', () => {
    // x=1, z=0: theta = atan2(0,1) = 0
    // c = 0.3 + 0.5·0.3 = 0.45; c·(0+0)·0.25 = 0
    near(evalAt('topology', 'helicoid', 1, 0, 0), 0, 1e-15);
  });

  test('torusSection: implicit torus equation', () => {
    // dist = √(x²+z²) - R = √(2.25) - 1.5 = 0 at x=1.5
    // sqrt(max(0, r²-0)) · sign(1.5) = sqrt(r²) = r = 0.65 (with comp=0.5); · 0.5
    const params = { amp: 1, freq: 1, comp: 0.5 };
    const v = evalAt('topology', 'torusSection', 1.5, 0, 0, params);
    near(v, 0.65 * 0.5, 1e-12);
  });
});

describe('Tier A — Quantum Mechanics', () => {
  test('particleBox1D: ψ vanishes at boundary x=-3.5', () => {
    // xi = clamp(0, 0, 1) = 0; sin(nπ·0) = 0
    near(evalAt('quantumMechanics', 'particleBox1D', -3.5, 0, 0), 0, 1e-12);
  });

  test('particleBox1D: ψ_1 peak at center x=0 (xi=0.5)', () => {
    // n=1 (comp=0 → round(1 + 0·5) = 1)
    // sin(π·0.5)=1, |ψ|² = (2/L)·sin² = 2
    // · amp · 0.5 · exp(0) · (0.8 + cos(0)·0.2) = 2 · 0.5 · 1.0 = 1.0
    const params = { amp: 1, freq: 1, comp: 0 };
    near(evalAt('quantumMechanics', 'particleBox1D', 0, 0, 0, params), 1.0, 1e-12);
  });

  test('hydrogenS at r=0: |ψ|² near origin (with ε=0.01 reg)', () => {
    // Implementation has r = sqrt(x²+z²) + 0.01 to avoid the singularity.
    // R = 2·exp(-0.01) ≈ 1.98010, R² ≈ 3.9208
    // Y = cos(0 + 0·t) = 1, Y² = 1
    // hydrogenPsi returns R²·Y²·0.6 ≈ 2.3525; then · amp · 2 ≈ 4.7050
    const expected = 4 * Math.exp(-0.02) * 0.6 * 2;
    near(evalAt('quantumMechanics', 'hydrogenS', 0, 0, 0), expected, 1e-6);
  });

  test('quantumZeno: P(T=0) = 1 (no decay yet)', () => {
    // T = (x+3.5)/7·4; at x=-3.5: T=0
    // cos(0)² ^N = 1; · amp · 0.5 · exp(0) = 0.5
    near(evalAt('quantumMechanics', 'quantumZeno', -3.5, 0, 0), 0.5, 1e-12);
  });

  test('feynmanPath: cos(0)·1 at x=0', () => {
    // x=0: phase = 0, cos(0) = 1
    // T = 0.5 + 0·0.05 = 0.5
    // · amp · 0.4 / sqrt(0.5) · exp(0) = 0.4/0.7071 ≈ 0.5657
    near(evalAt('quantumMechanics', 'feynmanPath', 0, 0, 0), 0.4 / Math.sqrt(0.5), 1e-12);
  });

  test('bellState: E(0,0) = -cos(0) = -1', () => {
    // phi1 = phi2 = 0, t = 0; -cos(0+0) = -1, · 0.45
    near(evalAt('quantumMechanics', 'bellState', 0, 0, 0), -0.45, 1e-12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS — direct tests
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests for math helpers used by multiple formulas (gamma, bessel, erf, etc.)
// at canonical input points. Catching errors here is cheaper than chasing them
// through every formula that depends on them — see audit Day 1 where a
// reflection-formula bug in gamma() rendered Γ(n) wrong for 0 < n < 0.5 while
// every formula-level test still passed because none exercised that range.

describe('Helpers — gamma function vs canonical references', () => {
  // Reference values from Python math.gamma (C library, ~16-digit precision).
  // Coverage: both branches of the implementation — the n>=0.5 Lanczos path,
  // and the n<0.5 reflection-formula path that was previously broken.
  const cases = [
    // [n,    Γ(n),                   label]
    [1,       1.0,                    'Γ(1) = 0! = 1'],
    [2,       1.0,                    'Γ(2) = 1! = 1'],
    [5,       24.0,                   'Γ(5) = 4! = 24'],
    [10,      362880.0,               'Γ(10) = 9!'],
    [0.5,     1.7724538509055160,     'Γ(1/2) = √π — boundary of branches'],
    [1.5,     0.8862269254527581,     'Γ(3/2) = √π/2'],
    [2.5,     1.3293403881791370,     'Γ(5/2) = 3√π/4'],
    [4.5,     11.631728396567448,     'Γ(4.5)'],
    // Small-n: reflection-formula branch (the path that had the bug).
    [0.1,     9.513507698668732,      'Γ(0.1) — reflection branch'],
    [0.25,    3.625609908221909,      'Γ(0.25) — reflection branch'],
    [0.3,     2.991568987687591,      'Γ(0.3) — reflection branch'],
    [0.49,    1.808051288923893,      'Γ(0.49) — just below boundary'],
    [0.75,    1.225416702465178,      'Γ(0.75) — just above boundary'],
    // Negative non-integers: also through reflection.
    [-0.5,    -3.544907701811032,     'Γ(-0.5) — reflection, negative'],
    [-1.5,    2.363271801207354,      'Γ(-1.5) — reflection, negative'],
  ];

  for (const [n, expected, label] of cases) {
    test(label, () => {
      const got = gamma(n);
      const rel = Math.abs((got - expected) / expected);
      assert.ok(
        rel < 1e-13,
        `gamma(${n}): got ${got}, expected ${expected}, rel.err=${rel.toExponential(2)}`
      );
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER B — Bounded approximation tests (tolerance per formula)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tier B — Special Functions (polynomial/series approximations)', () => {
  test('bessel0: J₀(0) = 1 — boundary case', () => {
    // r = 0, J₀(0) = 1; · amp · 0.6 · (1 + sin(0)·0.2) = 0.6
    near(evalAt('specialFunctions', 'bessel0', 0, 0, 0), 0.6, 1e-6);
  });

  test('bessel0: J₀(2.4048) ≈ 0 — first zero of J₀', () => {
    // First zero at r ≈ 2.4048
    // r = √(x²+z²)·freq·3 = 2.4048 → x = 2.4048/3 ≈ 0.8016
    // Result should be very close to 0 (the 0.6 envelope still multiplies, but ×0 = 0).
    const xForFirstZero = 2.4048255576957728 / 3;
    const v = evalAt('specialFunctions', 'bessel0', xForFirstZero, 0, 0);
    near(v, 0, 1e-5);
  });

  test('hypergeometric ₂F₁ at z=0 = 1', () => {
    // ₂F₁(a, b; c; 0) = 1
    // At x=0: zv=0, sum=1; · 0.15 · exp(0) = 0.15
    near(evalAt('specialFunctions', 'hypergeometric', 0, 0, 0), 0.15, 1e-7);
  });

  test('clausen Cl₂(π) = 0 (zero of Clausen)', () => {
    // θ = TAU·(x+3.5)/7; for θ=π: TAU·0.5=π, so (x+3.5)/7 = 0.5 → x=0
    // Σ sin(k·π)/k² = 0 since sin(kπ) = 0 for integer k
    near(evalAt('specialFunctions', 'clausen', 0, 0, 0), 0, 1e-12);
  });

  test('ellipticK: K(0) = π/2 ≈ 1.5708', () => {
    // kk = clamp((x+3.5)/7·0.98, 0.01, 0.99); for kk=0.01: x = (0.01/0.98)·7 - 3.5 ≈ -3.43
    // K(0) = π/2 ≈ 1.5708
    // Output: clamp(K·0.2 - 0.3, ...) · amp · exp(0)
    // K(0.01) ≈ π/2 → 1.5708·0.2 - 0.3 ≈ 0.0142
    const v = evalAt('specialFunctions', 'ellipticK', -3.43, 0, 0);
    near(v, 1.5708 * 0.2 - 0.3, 5e-3);
  });
});

describe('Tier B — Linear Algebra', () => {
  test('hessian of sin(2x)+sin(2z) at origin: fxx·fzz at x=z=0', () => {
    // fxx = -4·sin(0) = 0, similarly fzz = 0; 0·0 - 0 = 0
    near(evalAt('linearAlgebra', 'hessian', 0, 0, 0), 0, 1e-12);
  });

  test('vectorField: curl is non-zero away from the origin — F must not be conservative', () => {
    // The field is F = (Fx, Fz) = (−sin(z·f), sin(x·f)), whose curl is
    // f·(cos(x·f) + cos(z·f)); the formula divides by f and scales by 0.25.
    //
    // The previous field was F = (sin(x·f)·cos(z·f), cos(x·f)·sin(z·f)) — a
    // gradient field, and the curl of a gradient is identically zero, so the
    // formula returned ~1e-14 for every (x, z) and drew a dead-flat plate.
    // The old assertion sampled the origin only, where sin(0)=0 kills both
    // stencils, so any field of that shape satisfied it. Sample off-origin AND
    // assert the whole grid is not flat: no conservative field can pass that.
    near(evalAt('linearAlgebra', 'vectorField', 0.7, -1.3, 0),
         0.25 * (Math.cos(0.7) + Math.cos(1.3)), 1e-3);

    const hf = generateSurfaceFromFormula(
      getFormula('linearAlgebra', 'vectorField').f, BASELINE, 121, 3.5, 0);
    let lo = Infinity, hi = -Infinity;
    for (const v of hf) { if (v < lo) lo = v; if (v > hi) hi = v; }
    assert.ok(hi - lo > 0.1, `height field is flat: spread=${hi - lo}`);
  });

  test('quadraticForm at origin → 0', () => {
    near(evalAt('linearAlgebra', 'quadraticForm', 0, 0, 0), 0, 1e-15);
  });
});

describe('Tier B — Topology & Geometry', () => {
  test('enneperSurface at origin → 0', () => {
    // u² - v² with u = v = 0
    near(evalAt('topology', 'enneperSurface', 0, 0, 0), 0, 1e-15);
  });

  test('breatherSurface bounded |output| ≤ 0.6', () => {
    // Sweep a small grid; output is clamped at ±0.6 by the implementation.
    for (const x of [-2, -1, 0, 1, 2]) {
      for (const z of [-2, 0, 2]) {
        const v = evalAt('topology', 'breatherSurface', x, z, 0);
        assert.ok(Math.abs(v) <= 0.6 + 1e-12, `Output ${v} exceeded clamp at (${x},${z})`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER C — Qualitative tests (peak location, sign, monotonicity)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tier C — Fractals (qualitative)', () => {
  test('mandelbrot: center of cardioid (x=−0.5/0.6 ≈ −0.83) is bounded', () => {
    // Inside the Mandelbrot set → high iteration count → output near 0.
    // Implementation: cx = x·0.6, so cx=-0.5 needs x ≈ -0.833.
    // Tolerance is generous because the iteration budget is small in-app.
    const v = evalAt('fractals', 'mandelbrot', -0.83, 0, 0);
    near(v, 0, 0.5);
  });

  test('mandelbrot: exterior point escapes quickly', () => {
    // x=3, far outside the set → escapes immediately, output ≈ 1·0.7 = 0.7
    const v = evalAt('fractals', 'mandelbrot', 3, 0, 0);
    assert.ok(v > 0.5, `Exterior point should escape quickly, got ${v}`);
  });

  test('lorenz: bounded output (attractor confined region)', () => {
    // 8 Euler steps from various starting x; output should stay within the
    // Lorenz attractor's bounding box.
    for (const x of [-2, -1, 0, 1, 2]) {
      const v = evalAt('fractals', 'lorenz', x, 0, 0);
      assert.ok(Math.abs(v) < 5, `Lorenz unbounded at x=${x}: ${v}`);
    }
  });

  test('logistic: peak at x where logistic value matches z target', () => {
    // For r in the chaotic regime, output peaks where xn ≈ target.
    // The qualitative test just checks the output is bounded in [0, 0.5].
    const v = evalAt('fractals', 'logistic', 0, 0, 0);
    assert.ok(v >= 0 && v <= 0.5, `Logistic out of bounds: ${v}`);
  });
});

describe('Tier C — Probability (statistical sanity)', () => {
  test('randomWalk: deterministic — same x, same output', () => {
    const v1 = evalAt('probability', 'randomWalk', 1.5, 0, 0);
    const v2 = evalAt('probability', 'randomWalk', 1.5, 0, 0);
    near(v1, v2, 1e-15, 'Determinism violated');
  });

  test('randomWalk: bounded magnitude (≤ steps · max-step)', () => {
    // 16 steps, max each 0.075 → upper bound ≈ 1.2 before envelopes.
    for (const x of [-3, -1, 1, 3]) {
      const v = evalAt('probability', 'randomWalk', x, 0, 0);
      assert.ok(Math.abs(v) < 2, `Random walk out of bounds at x=${x}: ${v}`);
    }
  });
});

describe('Tier C — Cellular Automata sanity', () => {
  test('rule30: produces non-trivial output (not all zeros)', () => {
    // Sweep the grid; at least one cell must light up. An all-zero output
    // would mean the rule-evaluation loop never advanced.
    let found = false;
    for (let xi = -3; xi <= 3; xi += 0.5) {
      for (let zi = -3; zi <= 3; zi += 0.5) {
        if (Math.abs(evalAt('cellularAutomata', 'rule30', xi, zi, 0)) > 1e-9) {
          found = true; break;
        }
      }
      if (found) break;
    }
    assert.ok(found, 'Rule 30 produced all zeros');
  });

  test('voronoiCA: output is one of seed values', () => {
    // 5 + round(0.5·8) = 9 seeds; v ∈ {0/9, 1/9, ..., 8/9} · 0.7
    const v = evalAt('cellularAutomata', 'voronoiCA', 0, 0, 0);
    assert.ok(v >= 0 && v <= 0.7, `Voronoi out of seed range: ${v}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIER C UPGRADES — formulas with real implementations of named special
// functions; previously approximated, now matched to known reference values.
// They sit on Tier A/B by tolerance but stay grouped here because they share
// the same upgrade-from-Tier-C lineage.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tier C upgrade — Special Functions (real implementations)', () => {
  test('bessel1: J₁(0) = 0 (boundary value)', () => {
    // J₁ is odd, J₁(0) = 0; r = 0 → besselJ1(0) → 0
    near(evalAt('specialFunctions', 'bessel1', 0, 0, 0), 0, 1e-7);
  });

  test('bessel1: J₁(3.8317) ≈ 0 (first positive zero of J₁)', () => {
    // First zero of J₁ at r ≈ 3.83171.
    // r = √(x²+z²)·freq·3 = 3.83171 → x = 3.83171/3 ≈ 1.2772.
    // Tolerance reflects the polynomial approximation accuracy (~1e-7).
    const xForFirstZero = 3.83170597020751 / 3;
    const v = evalAt('specialFunctions', 'bessel1', xForFirstZero, 0, 0);
    near(v, 0, 1e-5);
  });

  test('bessel1: J₁(1.8412) ≈ max ≈ 0.5819 (first positive max)', () => {
    // First max of J₁ at r ≈ 1.84118, value ≈ 0.581865.
    // Output is besselJ1(r) · amp · 0.5 · (1 + cos(0)·0.2) = J₁ · 0.6
    const xForMax = 1.84118378134066 / 3;
    const v = evalAt('specialFunctions', 'bessel1', xForMax, 0, 0);
    near(v, 0.581865 * 0.5 * 1.2, 1e-5);
  });

  test('polygamma ψ(1) ≈ -γ ≈ -0.5772 (Euler-Mascheroni)', () => {
    // xv = clamp(0.2 + (x+3.5)/7·4, 0.2, 4.2); for xv=1: x = (1-0.2)/4·7 - 3.5 = -2.1
    // ψ(1) = -γ ≈ -0.57721566
    // Output: clamp(ψ · 0.2 · amp, -0.6, 0.6) · exp(-z²·0.4)
    const v = evalAt('specialFunctions', 'polygamma', -2.1, 0, 0);
    near(v, -0.57721566 * 0.2, 1e-7);
  });

  test('polygamma ψ(2) = 1 - γ ≈ 0.4228', () => {
    // xv=2: x = (2-0.2)/4·7 - 3.5 = -0.35
    // ψ(2) = 1 - γ ≈ 0.4227843351
    const v = evalAt('specialFunctions', 'polygamma', -0.35, 0, 0);
    near(v, 0.4227843351 * 0.2, 1e-7);
  });

  test('polygamma ψ(3) = 1.5 - γ ≈ 0.9228', () => {
    // xv=3: x = (3-0.2)/4·7 - 3.5 = 1.4
    // ψ(3) = 3/2 - γ ≈ 0.9227843351
    const v = evalAt('specialFunctions', 'polygamma', 1.4, 0, 0);
    near(v, 0.9227843351 * 0.2, 1e-7);
  });

  test('dawson: F(0) = 0 (boundary)', () => {
    // x=0 → xv=0 → ax=0 < 2.5 path → x·(1+0)/(1+0) = 0
    near(evalAt('specialFunctions', 'dawson', 0, 0, 0), 0, 1e-12);
  });

  test('dawson: F(1) ≈ 0.5380 (canonical value)', () => {
    // xv = x·freq·1.5 = 1 → x = 1/1.5
    // F(1) ≈ 0.5380795; output · 0.4 · amp · exp(0)
    const v = evalAt('specialFunctions', 'dawson', 1/1.5, 0, 0);
    near(v, 0.5380795 * 0.4, 1e-3);
  });

  test('dawson: F(0.5) ≈ 0.4244 (canonical value)', () => {
    // xv = 0.5 → x = 0.5/1.5; F(0.5) ≈ 0.4244364
    const v = evalAt('specialFunctions', 'dawson', 0.5/1.5, 0, 0);
    near(v, 0.4244364 * 0.4, 1e-3);
  });

  test('dawson: F(2) ≈ 0.3013 — at edge of Pade region', () => {
    // F(2) ≈ 0.30134
    const v = evalAt('specialFunctions', 'dawson', 2/1.5, 0, 0);
    near(v, 0.30134 * 0.4, 1e-3);
  });

  test('dawson: F(3) ≈ 0.1782 — asymptotic region', () => {
    // |xv|=3 ≥ 2.5 → asymptotic series; F(3) ≈ 0.17828
    const v = evalAt('specialFunctions', 'dawson', 3/1.5, 0, 0);
    near(v, 0.17828 * 0.4, 5e-3);
  });
});

describe('Tier C upgrade — Quantum Mechanics', () => {
  test('landauLevels n=0: |ψ_0|² = e^(-r²) at r=0 is max', () => {
    // n = round(comp·5) = 0 with comp=0
    // r²=0, L_0(0)=1, exp(0)=1, cos(0)=1
    // |ψ|² = 1²·1·1 = 1, · amp · 0.4 = 0.4
    const params = { amp: 1, freq: 1, comp: 0 };
    near(evalAt('quantumMechanics', 'landauLevels', 0, 0, 0, params), 0.4, 1e-12);
  });

  test('landauLevels n=1: L_1(r²) = 1 - r²; ψ vanishes where r²=1', () => {
    // n = round(0.2·5) = 1
    // L_1(r²) = 1 - r²; at r²=1, L_1=0 → ψ=0 → |ψ|²=0
    // x·freq=1, z=0, freq=1: x=1
    const params = { amp: 1, freq: 1, comp: 0.2 };
    const v = evalAt('quantumMechanics', 'landauLevels', 1, 0, 0, params);
    near(v, 0, 1e-12);
  });

  test('landauLevels n=2: L_2(r²) = 1 - 2r² + r⁴/2; verify shape', () => {
    // n = round(0.4·5) = 2
    // At r²=0: L_2=1, |ψ|² = 1·1·cos²(2·atan2(0,0) + ωc·0) = 1·cos²(0) = 1
    // atan2(0,0) is undefined mathematically but evaluates to 0 in JS.
    // ψ = 1·1·cos(0+0) = 1, |ψ|² = 1, · 0.4
    const params = { amp: 1, freq: 1, comp: 0.4 };
    const v_at_origin = evalAt('quantumMechanics', 'landauLevels', 0, 0, 0, params);
    near(v_at_origin, 0.4, 1e-12);
  });
});

describe('Tier C upgrade — Integral Transforms', () => {
  test('radonTransform: at ρ=0, both Gaussians on axis → 2 lobes summed', () => {
    // x=0, z=0: rho=0, theta = 0 + t·0.1 = 0
    // proj1 = exp(0) = 1
    // proj2 = exp(-3·c²) where c = 0.5 + 0.5·1.2 = 1.1
    // norm = √(π/3) ≈ 1.0233
    // Output: (1 + exp(-3·1.21)) · 1.0233 · 1 · 0.35
    const expected = (1 + Math.exp(-3*1.21)) * Math.sqrt(Math.PI/3) * 0.35;
    near(evalAt('integralTransforms', 'radonTransform', 0, 0, 0), expected, 1e-10);
  });

  test('cauchyIntegral: f(z₀)=z₀² for z₀ inside R=2 contour', () => {
    // For z₀ inside the contour (|z₀|<R=2), Cauchy gives f(z₀) = z₀² + c.
    // z₀ = 0.5·x at z=0 (real-axis test).
    // x=1, z=0, t=0 → z₀_re=0.5, z₀_im=0 → f(0.5) = 0.25 + c, c=comp·0.3=0.15.
    // Re(f(z₀)) = 0.4; output = 0.4 · amp · 0.4 = 0.16.
    // Tolerance is wider because the contour is discretised at N=24.
    const v = evalAt('integralTransforms', 'cauchyIntegral', 1, 0, 0);
    near(v, 0.4 * 0.4, 5e-2);
  });

  test('cauchyIntegral: returns ~0 for z₀ far outside contour', () => {
    // For |z₀| > R, Cauchy's theorem gives integral = 0.
    // x=6, z=0 → z₀_re=3 (outside R=2 contour).
    const v = evalAt('integralTransforms', 'cauchyIntegral', 6, 0, 0);
    near(v, 0, 0.05);
  });
});

describe('Tier C upgrade — Complex Numbers', () => {
  test('windingNumber: returns ~n_loops for z₀ inside unit circle', () => {
    // n_loops = round(1 + comp·3) = round(1+1.5) = 3 with comp=0.5
    // z₀ = 0.5·x with x=0, z=0 → z₀=(0,0), inside the unit circle.
    // Result: n_loops = 3, scaled by amp·0.18 = 0.54.
    // Tolerance reflects N=48 contour discretisation noise.
    const v = evalAt('complexNumbers', 'windingNumber', 0, 0, 0);
    near(v, 3 * 0.18, 5e-2);
  });

  test('windingNumber: returns ~0 for z₀ outside unit circle', () => {
    // x=4 → z₀_re=2, |z₀|=2 > R=1 → winding = 0
    const v = evalAt('complexNumbers', 'windingNumber', 4, 0, 0);
    near(v, 0, 1e-2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION GUARDS — pin behaviour for formulas with a history of numeric
// bugs (overflow, partial scaling, RNG drift). Each test corresponds to a
// specific previously-broken behaviour that must not return.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — Tier D defects (fixed)', () => {
  test('tinkerbell never returns Infinity (post-loop guard)', () => {
    // The map can blow up if iteration is unbounded; the implementation
    // guards against that. Sweep the full input domain to confirm.
    const f = getFormula('fractals', 'tinkerbell').f;
    for (let xi = -3.5; xi <= 3.5; xi += 0.25) {
      for (let zi = -3.5; zi <= 3.5; zi += 0.25) {
        const v = f(xi, zi, 0, BASELINE);
        assert.ok(Number.isFinite(v),
          `tinkerbell returned non-finite at (${xi}, ${zi}): ${v}`);
      }
    }
  });

  test('jacobian: amp scaling applies to whole determinant', () => {
    // Pins linear amp scaling: doubling amp must double the output.
    // The implementation previously scaled only the second product term,
    // which broke this proportionality at amp≠1.
    const f = getFormula('linearAlgebra', 'jacobian').f;
    const v_amp1 = f(0.5, 0.5, 0, { amp: 1, freq: 1 });
    const v_amp2 = f(0.5, 0.5, 0, { amp: 2, freq: 1 });
    if (Math.abs(v_amp1) > 1e-12) {
      const ratio = v_amp2 / v_amp1;
      near(ratio, 2.0, 1e-10, 'amp scaling not linear after jacobian fix');
    }
  });

  test('dragon: deterministic — same input gives same output', () => {
    // The IFS construction uses a pseudo-random walk; determinism means
    // it's seeded from (x, z, t) rather than Math.random(). Without this
    // property the visual would flicker frame-to-frame.
    const f = getFormula('fractals', 'dragon').f;
    const v1 = f(1.5, 0.7, 5.2, BASELINE);
    const v2 = f(1.5, 0.7, 5.2, BASELINE);
    near(v1, v2, 1e-15, 'Dragon non-deterministic');
  });

  test('dragon: produces non-zero density across grid', () => {
    // An all-zero output means the IFS isn't iterating — a regression
    // we hit when the inner loop was accidentally short-circuited.
    const f = getFormula('fractals', 'dragon').f;
    let foundNonzero = false;
    let allFinite = true;
    for (let xi = -2; xi <= 2; xi += 0.5) {
      for (let zi = -2; zi <= 2; zi += 0.5) {
        const v = f(xi, zi, 0, BASELINE);
        if (!Number.isFinite(v)) { allFinite = false; break; }
        if (Math.abs(v) > 1e-6) foundNonzero = true;
      }
    }
    assert.ok(allFinite, 'Dragon produced non-finite output');
    assert.ok(foundNonzero, 'Dragon produced all-zero output (broken IFS)');
  });

  test('dragon: output stays in clamp range [0, 0.9]', () => {
    // Implementation clamps to [0, 0.9]; the range maps to the height
    // field's safe band. Out-of-band values would cause clipping or
    // z-fighting in the renderer.
    const f = getFormula('fractals', 'dragon').f;
    for (let xi = -3.5; xi <= 3.5; xi += 0.5) {
      for (let zi = -3.5; zi <= 3.5; zi += 0.5) {
        const v = f(xi, zi, 0, BASELINE);
        assert.ok(v >= 0 && v <= 0.9,
          `Dragon out of bounds at (${xi},${zi}): ${v}`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION — heavy-simulator cache invalidation (defect #12)
//
// The eleven Cellular Automata formulas below are wrapped in
// createCachedHeavySampler(): the simulator runs ONCE per tick and every vertex
// bilinearly samples the cached res×res grid. That wrapper is module-private
// (not exported), so it is exercised the only way production does — through the
// public formula objects in MATH_COLLECTIONS.
//
// The bug: the cache key was `t` alone. `t` advances 0.008 per frame against a
// 0.016 staleness threshold, so only ~1 frame in 3 rebuilt and the rest sampled
// a grid computed from stale audio params. Undersampled, not deaf — the eleven
// formulas did track the music, at ~16-20Hz.
//
// The fix has two halves. amp and comp join the cache key, with a
// HEAVY_PARAM_EPS = 0.05 dead-band so analyser jitter doesn't rebuild every
// frame. HEAVY_MIN_RECOMPUTE_TICKS then caps param-driven rebuilds at ~30Hz,
// because unbounded they fire on ~83% of frames of real music — ~3× the old
// load, more than the main-thread collapse path can absorb.
//
// Every test here fixes `t` and varies only the params: on the old code they
// all return a bit-identical grid, which is precisely the failure being pinned.
// A fixed `t` is also the ceiling's exemption (same instant + new params = a
// grid that never existed), so the rate limit can't mask the cache-key half.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — heavy sampler: params in the cache key + rebuild-rate ceiling (#12)', () => {
  // Sampling a grid rather than one point: an automaton can legitimately be
  // flat at any single (x, z), so a single probe would be a coin flip. The
  // whole surface can only be identical if the cached grid was reused.
  function surfaceAt(formulaKey, t, params) {
    const f = getFormula('cellularAutomata', formulaKey);
    assert.ok(f, `Formula not found: cellularAutomata/${formulaKey}`);
    const out = [];
    for (let x = -3; x <= 3; x += 0.5)
      for (let z = -3; z <= 3; z += 0.5)
        out.push(f.f(x, z, t, params));
    return out;
  }

  function maxAbsDiff(a, b) {
    assert.equal(a.length, b.length, 'sample grids differ in length');
    return a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
  }

  // Fixed instant shared by every case — the point is that t never moves.
  const T = 2.5;

  // Formulas whose output provably swings with amp / comp at this t. Chosen by
  // measurement, not by reading the sources: `wiredFire` is flat over parts of
  // the t domain and would make a hard assertion flaky.
  //
  // FIX(#0, r4): `briansBrain` used to be exempt here for the same stated
  // reason, and the measurement was right — but the flatness was a defect, not
  // a property. Its seed was a 1,0,2 stripe on which the birth rule could never
  // fire, so the board was empty from generation 2 onward and no parameter
  // could move a field of zeros. With the seed decorrelated it belongs in both
  // lists like any other simulator; the regression for the emptiness itself is
  // further down this file.
  const AMP_SENSITIVE  = ['reactionDiffusion', 'conway3D', 'excitableMedia', 'cyclicCA', 'briansBrain'];
  const COMP_SENSITIVE = ['gameOfLifeDensity', 'conway3D', 'cyclicCA', 'briansBrain'];

  test('changing amp at a fixed t recomputes the simulation', () => {
    for (const key of AMP_SENSITIVE) {
      const quiet = surfaceAt(key, T, { amp: 1, comp: 0.5 });
      const loud  = surfaceAt(key, T, { amp: 2, comp: 0.5 });
      assert.ok(maxAbsDiff(quiet, loud) > 1e-9,
        `${key}: amp 1 → 2 produced an identical surface at t=${T} — cache ignored params`);
    }
  });

  test('changing comp at a fixed t recomputes the simulation', () => {
    // comp = 0.5 + mid·0.4, so it is the mid-band's only route into these
    // simulators (it drives generation counts and regime constants).
    for (const key of COMP_SENSITIVE) {
      const low  = surfaceAt(key, T, { amp: 1, comp: 0.5 });
      const high = surfaceAt(key, T, { amp: 1, comp: 0.9 });
      assert.ok(maxAbsDiff(low, high) > 1e-9,
        `${key}: comp 0.5 → 0.9 produced an identical surface at t=${T} — cache ignored params`);
    }
  });

  test('sub-tolerance param jitter still hits the cache (HEAVY_PARAM_EPS)', () => {
    // The other half of the fix: invalidating on every analyser wobble would
    // run a full simulation per frame. Deltas below 0.05 must be absorbed, so
    // the result is byte-identical, not merely close.
    for (const key of [...new Set([...AMP_SENSITIVE, ...COMP_SENSITIVE])]) {
      const base   = surfaceAt(key, T, { amp: 1,    comp: 0.5  });
      const jitter = surfaceAt(key, T, { amp: 1.02, comp: 0.51 });
      assert.equal(maxAbsDiff(base, jitter), 0,
        `${key}: a 0.02/0.01 param wobble rebuilt the simulation — dead-band lost`);
    }
  });

  test('identical (t, params) is deterministic across calls', () => {
    // Guards the cache itself: a hit must return what the miss computed.
    // Also rules out Math.random() creeping into any of these simulators,
    // which would flicker the surface frame to frame.
    for (const key of AMP_SENSITIVE) {
      const first  = surfaceAt(key, T, { amp: 1.3, comp: 0.7 });
      const second = surfaceAt(key, T, { amp: 1.3, comp: 0.7 });
      assert.equal(maxAbsDiff(first, second), 0, `${key}: non-deterministic output`);
    }
  });

  test('every heavy sampler stays finite across the param range', () => {
    // Sweeping amp/comp now actually re-runs the simulators, so this covers
    // eleven code paths that the old cache made unreachable after the first
    // call at a given t.
    const HEAVY = [
      'gameOfLifeDensity', 'briansBrain', 'langtonAnt', 'cyclicCA', 'wiredFire',
      'sandpile', 'excitableMedia', 'reactionDiffusion', 'forestFire',
      'conway3D', 'turmite',
    ];
    for (const key of HEAVY) {
      for (const params of [{ amp: 0, comp: 0.5 }, { amp: 1, comp: 0.5 }, { amp: 2, comp: 0.9 }]) {
        for (const v of surfaceAt(key, T, params)) {
          assert.ok(Number.isFinite(v),
            `${key} returned non-finite at amp=${params.amp} comp=${params.comp}: ${v}`);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION — Surface generation end-to-end
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration — generateSurfaceFromFormula', () => {
  test('produces correct grid size', () => {
    const f = getFormula('trigonometry', 'sinCos').f;
    const hf = generateSurfaceFromFormula(f, BASELINE, 32, 3.5, 0);
    assert.equal(hf.length, 32 * 32, 'Grid size mismatch');
  });

  test('output is finite for all canonical formulas', () => {
    // Catalog-wide smoke test: every shipped formula must produce a
    // finite height field at the baseline parameters. NaN/Infinity in
    // the heightfield blows up the WebGL buffer upload.
    let collectionFails = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, formula] of Object.entries(col.formulas)) {
        const hf = generateSurfaceFromFormula(formula.f, BASELINE, 16, 3.5, 0);
        let allFinite = true;
        for (let i = 0; i < hf.length; i++) {
          if (!Number.isFinite(hf[i])) { allFinite = false; break; }
        }
        if (!allFinite) collectionFails.push(`${colId}/${key}`);
      }
    }
    assert.equal(collectionFails.length, 0,
      `Non-finite outputs in: ${collectionFails.join(', ')}`);
  });

  test('output bounded for all canonical formulas (no |y| > 100)', () => {
    // Boundedness is a downstream contract: extreme heights make the
    // mesh visually unusable (vertices fly off-screen). 100 is the
    // tolerance under which every shipped formula must operate; it
    // gives plenty of headroom over the typical [-2, 2] range.
    let unbounded = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, formula] of Object.entries(col.formulas)) {
        const hf = generateSurfaceFromFormula(formula.f, BASELINE, 16, 3.5, 0);
        let max = 0;
        for (let i = 0; i < hf.length; i++) {
          if (Math.abs(hf[i]) > max) max = Math.abs(hf[i]);
        }
        if (max > 100) unbounded.push(`${colId}/${key} (max=${max.toFixed(2)})`);
      }
    }
    assert.equal(unbounded.length, 0,
      `Unbounded outputs in: ${unbounded.join(', ')}`);
  });

  test('finite and bounded across the parameter envelope the app actually drives', () => {
    // The two guards above evaluate the catalogue at BASELINE and grid 16 only,
    // and that is not the envelope the running app produces: comp is
    // `0.5 + audio.mid*0.4` → [0.5, 0.9], freq follows the wave-intensity
    // slider, and the shipped mesh is 161×161 on desktop. Hénon diverged for
    // comp > ~0.55 and shipped ±Infinity into the vertex buffer at plain boot
    // defaults, which BASELINE-at-16 could not see: its isFinite() test ran on
    // the double, while the height field is Float32, so 1e38 became Infinity
    // only on the way into the buffer.
    //
    // Both checks share one pass — 192 formulas × params × grids is enough
    // arithmetic that running it twice would be felt in the suite's runtime.
    // Corners of the reachable envelope only: amp ∈ [0.2, 1.5] and freq ∈
    // [0.3, 3.5] are the slider ranges in src/params.js, comp ∈ [0.5, 0.9] is
    // what the audio path produces. Typed/MIDI values above a slider's max are
    // deliberately not clamped (see applyParam), and a dozen formulas do exceed
    // |y| = 100 out there — that is the documented "extended values stay
    // extended" policy, not a contract this test gets to assert against.
    const ENVELOPE = [
      { amp: 1,    freq: 1,     comp: 0.5  },
      { amp: 0.77, freq: 1.069, comp: 0.58 },  // idle boot values
      { amp: 1,    freq: 1,     comp: 0.6  },
      { amp: 1,    freq: 1,     comp: 0.9  },  // audio.mid saturated
      { amp: 1.5,  freq: 3.5,   comp: 0.9  },  // both sliders at max
      { amp: 0.2,  freq: 0.3,   comp: 0.5  },  // both sliders at min
    ];
    // Two different contracts, deliberately:
    //   • FINITE — absolute. A non-finite entry tears the mesh and is the
    //     defect this test exists for.
    //   • DIVERGENCE — orders of magnitude, not the strict |y| ≤ 100 the
    //     BASELINE guard above enforces. Several formulas are exponential
    //     (catenoid's cosh, matrixExp, eulerIm, hyperbolicGeom) and legitimately
    //     reach 1e4…1e9 with both sliders at max, while catenoid grazes 1.03e2
    //     at plain boot defaults. Flagging those would be a policy change on
    //     the catalogue, not a regression guard, so the ceiling here is set to
    //     catch a diverging iteration (Hénon reached 5e37 at boot defaults)
    //     rather than a steep-but-intended surface.
    const DIVERGENCE = 1e4;
    const bad = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, formula] of Object.entries(col.formulas)) {
        for (const params of ENVELOPE) {
          for (const [gs, t] of [[16, 0], [16, 2.5], [90, 0]]) {
            const hf = generateSurfaceFromFormula(formula.f, params, gs, 3.5, t);
            let worst = 0, nonFinite = 0;
            for (let i = 0; i < hf.length; i++) {
              if (!Number.isFinite(hf[i])) { nonFinite++; continue; }
              const a = Math.abs(hf[i]);
              if (a > worst) worst = a;
            }
            const slidersAtMax = params.amp > 1 && params.freq > 3;
            if (nonFinite || (worst > DIVERGENCE && !slidersAtMax)) {
              bad.push(`${colId}/${key} @amp=${params.amp} freq=${params.freq} `
                + `comp=${params.comp} grid=${gs} t=${t}: ${nonFinite} non-finite, `
                + `max=${worst.toExponential(2)}`);
            }
          }
        }
      }
    }
    assert.equal(bad.length, 0, `Out-of-contract outputs:\n  ${bad.join('\n  ')}`);
  });

  test('henon stays bounded where it used to overflow to ±1e38', () => {
    // Sharpest single case: the boot-default corner of the envelope above.
    const f  = getFormula('fractals', 'henon').f;
    const hf = generateSurfaceFromFormula(f, { amp: 0.77, freq: 1.069, comp: 0.58 }, 161, 3.5, 0);
    let nonFinite = 0, over = 0;
    for (let i = 0; i < hf.length; i++) {
      if (!Number.isFinite(hf[i])) nonFinite++;
      else if (Math.abs(hf[i]) > 100) over++;
    }
    assert.equal(nonFinite, 0, `${nonFinite} vertices are ±Infinity`);
    assert.equal(over, 0, `${over} vertices exceed |y| > 100`);
    // Direct call, past the Float32 narrowing: a diverging orbit returns 0.
    assert.ok(Math.abs(f(3.5, 3.5, 0, { amp: 1, freq: 1, comp: 0.6 })) <= 100);
    // And the attractor itself is untouched — this is the value the escape
    // must not change, since the canonical orbit lives inside |x| ≤ 1.3.
    assert.ok(Math.abs(f(0.4, -0.2, 0, BASELINE)) > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VOLUME FORMULAS — vector-field smoke tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Volume formulas — vector field smoke tests', () => {
  test('lorenzField returns {dx,dy,dz}', () => {
    // Volume-formula contract: f(x, y, z, t, params) → { dx, dy, dz }.
    // The smoke test pins the return shape so downstream apply* code
    // can rely on it without defensive checks.
    const r = VOLUME_FORMULAS.lorenzField.f(1, 0, 1, 0, BASELINE);
    assert.ok('dx' in r && 'dy' in r && 'dz' in r, 'Missing displacement components');
    assert.ok(Number.isFinite(r.dx + r.dy + r.dz), 'Non-finite displacement');
  });

  test('breathe field is radial (dx,dy,dz parallel to position)', () => {
    // For position (1,0,0), breathe should give dx pointing along x,
    // with dy=dz=0 — i.e. radial outward, no shear component.
    const r = VOLUME_FORMULAS.breathe.f(1, 0, 0, 0, BASELINE);
    near(r.dy, 0, 1e-12);
    near(r.dz, 0, 1e-12);
    assert.ok(Math.abs(r.dx) > 0, 'Breathe field has zero radial component');
  });

  test('twist field at y=0 leaves y-axis alone (sin(0)=0)', () => {
    // dy = sin(t·0.5 + y) where y=0 → sin(t·0.5); for t=0: dy = 0.
    const r = VOLUME_FORMULAS.twist.f(1, 0, 1, 0, BASELINE);
    near(r.dy, 0, 1e-12);
  });

  test('magneticDipole has 1/r² type falloff', () => {
    // At r=10, field strength should be ~100× weaker than at r=1 —
    // the canonical inverse-square decay of a dipole's near field.
    // 50× threshold (not 100×) absorbs the implementation's smoothing
    // and ε-regularisation without false positives.
    const near_field = VOLUME_FORMULAS.magneticDipole.f(1, 0, 0, 1, BASELINE);
    const far_field  = VOLUME_FORMULAS.magneticDipole.f(10, 0, 0, 1, BASELINE);
    const near_mag = Math.hypot(near_field.dx, near_field.dy, near_field.dz);
    const far_mag  = Math.hypot(far_field.dx,  far_field.dy,  far_field.dz);
    assert.ok(near_mag > far_mag * 50,
      `Magnetic dipole falloff insufficient: near=${near_mag}, far=${far_mag}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COLLAPSE MODE — spherical (θ, φ) parametrisation, normal-direction displacement
// ═══════════════════════════════════════════════════════════════════════════════

describe('Collapse mode — generateCollapseScalarField', () => {
  test('returns Float32Array of correct length', () => {
    const basePositions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    const fn = (theta, phi, t, p) => 1;
    const sf = generateCollapseScalarField(fn, {}, basePositions, 0);
    assert.equal(sf.length, 3);
  });

  test('constant formula produces uniform output', () => {
    const basePositions = new Float32Array([1,0,0, 0,1,0, -1,0,0, 0,-1,0]);
    const fn = () => 0.5;
    const sf = generateCollapseScalarField(fn, {}, basePositions, 0);
    for (let i = 0; i < sf.length; i++) {
      near(sf[i], 0.5, 1e-12, `vertex ${i} should be 0.5`);
    }
  });

  test('θ varies with x,z position relative to centroid', () => {
    // Four vertices arranged symmetrically so centroid lands at (0,0,0).
    // After centroid subtraction, each vertex maps to a known atan2:
    //   ( 1, 0, 0): θ = atan2(0,  1) = 0
    //   ( 0, 0, 1): θ = atan2(1,  0) = π/2
    //   (-1, 0, 0): θ = atan2(0, -1) = π
    //   ( 0, 0,-1): θ = atan2(-1, 0) = -π/2
    // Tolerance 1e-6 because Float32Array storage adds ~1e-7 noise.
    const basePositions = new Float32Array([1,0,0, 0,0,1, -1,0,0, 0,0,-1]);
    const fn = (theta) => theta;
    const sf = generateCollapseScalarField(fn, {}, basePositions, 0);
    near(sf[0], 0, 1e-6);
    near(sf[1], Math.PI/2, 1e-6);
    near(sf[2], Math.PI, 1e-6);
    near(sf[3], -Math.PI/2, 1e-6);
  });

  test('φ varies with y position (polar angle from +Y)', () => {
    // Same symmetric arrangement; φ is acos of normalised y.
    //   ( 0, 1, 0): φ = acos( 1) = 0       (top)
    //   ( 1, 0, 0): φ = acos( 0) = π/2     (equator)
    //   ( 0,-1, 0): φ = acos(-1) = π       (bottom)
    //   (-1, 0, 0): φ = acos( 0) = π/2     (equator)
    const basePositions = new Float32Array([0,1,0, 1,0,0, 0,-1,0, -1,0,0]);
    const fn = (theta, phi) => phi;
    const sf = generateCollapseScalarField(fn, {}, basePositions, 0);
    near(sf[0], 0, 1e-6);
    near(sf[1], Math.PI/2, 1e-6);
    near(sf[2], Math.PI, 1e-6);
    near(sf[3], Math.PI/2, 1e-6);
  });

  test('handles vertex at centroid (r=0) without NaN', () => {
    // Degenerate case: every vertex at the same point → centroid = that
    // point → relative position is (0,0,0) → r=0. Implementation must
    // guard against division by r in the spherical conversion.
    const same = new Float32Array([1,1,1, 1,1,1, 1,1,1]);
    const fn = (theta, phi) => phi;
    const sf = generateCollapseScalarField(fn, {}, same, 0);
    for (let i = 0; i < sf.length; i++) {
      assert.ok(Number.isFinite(sf[i]), `vertex ${i} produced ${sf[i]}`);
    }
  });

  test('formula errors are caught and return 0', () => {
    // A throwing formula must not propagate — collapse mode runs on the
    // render hot path; a single exception would crash the visualizer.
    const basePositions = new Float32Array([1,0,0, 0,1,0]);
    const fn = () => { throw new Error('boom'); };
    const sf = generateCollapseScalarField(fn, {}, basePositions, 0);
    near(sf[0], 0, 1e-12);
    near(sf[1], 0, 1e-12);
  });

  test('non-finite formula output replaced with 0', () => {
    // Same hot-path safety as the throw case: NaN/Infinity in the scalar
    // field would propagate into the GPU buffer and crash the upload.
    const basePositions = new Float32Array([1,0,0, 0,1,0]);
    const fn = (theta, phi) => phi === 0 ? Infinity : NaN;
    const sf = generateCollapseScalarField(fn, {}, basePositions, 0);
    near(sf[0], 0, 1e-12);
    near(sf[1], 0, 1e-12);
  });
});

describe('Collapse mode — applyCollapseField', () => {
  // Minimal stand-in for a three.js BufferAttribute. Implements the
  // subset of the surface that applyCollapseField actually touches —
  // enough to verify the math without bringing in three.js.
  function makeMockGeo(n) {
    const data = new Float32Array(n * 3);
    return {
      attributes: {
        position: {
          count: n,
          _data: data,
          getX(i)        { return this._data[i*3]; },
          getY(i)        { return this._data[i*3+1]; },
          getZ(i)        { return this._data[i*3+2]; },
          setXYZ(i,x,y,z){ this._data[i*3]=x; this._data[i*3+1]=y; this._data[i*3+2]=z; },
          needsUpdate: false,
        },
      },
      computeVertexNormals() {},
    };
  }

  test('zero scalar field leaves geometry unchanged', () => {
    const basePos     = new Float32Array([1,0,0, 0,1,0, 0,0,1]);
    const baseNormals = new Float32Array([1,0,0, 0,1,0, 0,0,1]);
    const sf          = new Float32Array([0, 0, 0]);
    const geo         = makeMockGeo(3);
    applyCollapseField(geo, sf, basePos, baseNormals, 1);
    for (let i = 0; i < basePos.length; i++) {
      near(geo.attributes.position._data[i], basePos[i], 1e-15);
    }
  });

  test('unit scalar with outward normals expands geometry', () => {
    // Sphere-like vertex layout: six axis points with normals pointing
    // outward. With strength=1 and scalar=0.5, each vertex moves 0.5
    // along its normal, so the radius from origin becomes 1 + 0.5 = 1.5.
    const basePos     = new Float32Array([1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1]);
    const baseNormals = new Float32Array([1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1]);
    const sf          = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const geo         = makeMockGeo(6);
    applyCollapseField(geo, sf, basePos, baseNormals, 1);
    for (let i = 0; i < 6; i++) {
      const px = geo.attributes.position._data[i*3];
      const py = geo.attributes.position._data[i*3+1];
      const pz = geo.attributes.position._data[i*3+2];
      const r  = Math.sqrt(px*px + py*py + pz*pz);
      near(r, 1.5, 1e-12, `vertex ${i} expanded to wrong radius`);
    }
  });

  test('negative scalar contracts geometry along normals', () => {
    // Vertex 0: (1,0,0) + (1,0,0)·(-0.3) = (0.7, 0, 0)
    // Vertex 1: (0,1,0) + (0,1,0)·(-0.3) = (0, 0.7, 0)
    // Tolerance 1e-7 because Float32 storage in BufferAttribute loses precision.
    const basePos     = new Float32Array([1,0,0, 0,1,0]);
    const baseNormals = new Float32Array([1,0,0, 0,1,0]);
    const sf          = new Float32Array([-0.3, -0.3]);
    const geo         = makeMockGeo(2);
    applyCollapseField(geo, sf, basePos, baseNormals, 1);
    near(geo.attributes.position._data[0], 0.7, 1e-7);
    near(geo.attributes.position._data[4], 0.7, 1e-7);
  });

  test('strength multiplier scales displacement linearly', () => {
    // Doubling the strength must double the displacement away from base
    // — pins the linear relationship the math-visualizer relies on for
    // morph-progress blending.
    const basePos     = new Float32Array([1,0,0]);
    const baseNormals = new Float32Array([1,0,0]);
    const sf          = new Float32Array([0.5]);

    const geo1 = makeMockGeo(1);
    applyCollapseField(geo1, sf, basePos, baseNormals, 1);
    const x1 = geo1.attributes.position._data[0];

    const geo2 = makeMockGeo(1);
    applyCollapseField(geo2, sf, basePos, baseNormals, 2);
    const x2 = geo2.attributes.position._data[0];

    const d1 = x1 - 1, d2 = x2 - 1;
    near(d2, 2 * d1, 1e-12);
  });

  test('strength=0 returns to base positions exactly', () => {
    // Even with large scalar values, zero strength must produce a
    // pristine copy of base positions — this is what setMode('surface')
    // relies on when leaving collapse mode.
    const basePos     = new Float32Array([1,2,3, 4,5,6]);
    const baseNormals = new Float32Array([1,0,0, 0,1,0]);
    const sf          = new Float32Array([100, 200]);
    const geo         = makeMockGeo(2);
    applyCollapseField(geo, sf, basePos, baseNormals, 0);
    for (let i = 0; i < basePos.length; i++) {
      near(geo.attributes.position._data[i], basePos[i], 1e-15);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION — round-4 catalogue defects
//
// Entries whose arithmetic contradicted the entry's own name, its displayed
// `formula` string, or its MATHEMATICAL_ACCURACY.md row. Two habits let all of
// them past the suite above. Every assertion in this file was evaluated at
// t = 0 — MATHEMATICAL_ACCURACY.md pins validation to `time: 0` — and t = 0 is
// the one instant at which a solution that decays with the session clock is
// still alive. And the catalogue-wide guards only ever ask for `isFinite` and
// `|y| ≤ 100`, both of which a field of exact zeros passes. So the tests below
// deliberately evaluate at a realistic session age, and assert that something
// is on screen rather than merely that nothing is NaN.
//
// Everything goes through the shipped entry point — getFormula(...).f and
// generateSurfaceFromFormula — never a re-implementation of a formula body.
// ═══════════════════════════════════════════════════════════════════════════════

// What the app renders with before a track is loaded: amp is the slider
// default, freq the wave-intensity default, comp = 0.5 + mid·0.4 with the idle
// LFO driving mid. Several of these defects are invisible at BASELINE and
// obvious here, so the drift tests use these rather than the unmodulated pair.
const BOOT = { amp: 0.77, freq: 1.069, comp: 0.58 };

// main.js advances `time` by 0.008 per animation frame and never resets it, so
// at 60 fps one second of uptime is 0.48 in formula-time. Ten minutes into a
// set is t ≈ 288 — a value no test in this file had ever used.
const uptime = seconds => seconds * 0.48;

/** The real height field, as generateSurfaceFromFormula hands it to the mesh. */
function fieldOf(colId, key, params, t, gridSize = 49) {
  const f = getFormula(colId, key);
  assert.ok(f, `Formula not found: ${colId}/${key}`);
  return generateSurfaceFromFormula(f.f, params, gridSize, 3.5, t);
}

/** Peak |y| of that field — the height a viewer actually sees. */
function peakOf(colId, key, params, t, gridSize = 49) {
  const hf = fieldOf(colId, key, params, t, gridSize);
  let peak = 0;
  for (let i = 0; i < hf.length; i++) peak = Math.max(peak, Math.abs(hf[i]));
  return peak;
}

describe('Regression — the session clock is not a physical time (#5, #6)', () => {
  // main.js `time += 0.008` is the only mutation of the clock in the whole
  // app: STOP MOTION pauses it, nothing rewinds it, and no formula is handed a
  // per-entry zero. Seven entries read that number as the age of a decaying or
  // translating solution, so they went out one or two minutes into a set and
  // never came back — dampedOscillator fell from a 0.39 peak to 2·10⁻⁵ after
  // two minutes of uptime, wavePacket and schrodingerSoliton to exactly zero
  // as their packets translated off the domain. Recovery needed a page reload.
  const DRIFTERS = [
    ['fourierSeries',    'heat2D'],
    ['differentialEqs',  'dampedOscillator'],
    ['differentialEqs',  'heatEquation'],
    ['differentialEqs',  'fishersEquation'],
    ['quantumMechanics', 'wavePacket'],
    ['quantumMechanics', 'schrodingerSoliton'],
    ['complexNumbers',   'complexHeat'],
  ];

  test('every time-evolving entry is still drawing after 30 minutes of uptime', () => {
    // An order of magnitude below the boot peak is the line: these solutions
    // are meant to decay visibly, they are not meant to reach the floor and
    // stay there.
    const dead = [];
    for (const [colId, key] of DRIFTERS) {
      const born = peakOf(colId, key, BOOT, 0);
      for (const secs of [30, 60, 120, 300, 600, 1800]) {
        // Four instants a fraction of a second apart, so an oscillator caught
        // at a zero crossing is not mistaken for a dead surface.
        let alive = 0;
        for (const d of [0, 0.13, 0.29, 0.47]) {
          alive = Math.max(alive, peakOf(colId, key, BOOT, uptime(secs) + d));
        }
        if (alive < born * 0.1) {
          dead.push(`${colId}/${key} @${secs}s uptime: peak ${alive.toExponential(2)}`
            + ` against ${born.toExponential(2)} at boot`);
        }
      }
    }
    assert.equal(dead.length, 0, `Collapsed over the length of a set:\n  ${dead.join('\n  ')}`);
  });

  test('control — t = 0 renders exactly what it rendered before the wrap', () => {
    // Replaying the solution must not move it. These are the values the
    // pre-fix code produced at t = 0, so an over-eager wrap — one that shifted
    // the phase, rescaled the clock or clamped the argument — shows up here
    // even though the test above would still be happy.
    const at0 = [
      ['fourierSeries',    'heat2D',             0,   0, 0.399655647258448],
      ['differentialEqs',  'dampedOscillator',   0,   0, 0.0895990196292607],
      ['differentialEqs',  'heatEquation',       0,   0, 0.496563422446714],
      ['differentialEqs',  'fishersEquation',    0.5, 0, 0.365529289315002],
      ['quantumMechanics', 'wavePacket',         0.7, 0, 0.187642285592130],
      ['quantumMechanics', 'schrodingerSoliton', 0.5, 0, 0.298292904140666],
      ['complexNumbers',   'complexHeat',        0.5, 0, 0.0861491219772305],
      ['topology',         'helicoid',           1,   0, 0],
    ];
    for (const [colId, key, x, z, expected] of at0) {
      near(evalAt(colId, key, x, z, 0), expected, 1e-12, `${colId}/${key} at t=0`);
    }
  });

  test('control — the wrap replays the solution, it does not freeze it', () => {
    // The cheap way to pass the drift test would be to drop the clock from
    // these bodies altogether. Each must still evolve within its own cycle.
    for (const [colId, key] of [...DRIFTERS, ['topology', 'helicoid']]) {
      const a = fieldOf(colId, key, BOOT, 0);
      const b = fieldOf(colId, key, BOOT, 1.5);
      let moved = 0;
      for (let i = 0; i < a.length; i++) moved = Math.max(moved, Math.abs(a[i] - b[i]));
      assert.ok(moved > 1e-6, `${colId}/${key} does not move between t=0 and t=1.5`);
    }
  });

  test('helicoid stays inside the framed volume for the whole session (#6)', () => {
    // `c·(theta + t·0.3)` translated the entire mesh upward without limit —
    // theta is bounded to (−π, π] but the clock is not, so the surface sat at
    // y ≈ 8 after ten minutes and 24 after thirty, against a framed volume
    // about 3 units high. Rotating the azimuth instead keeps the height inside
    // the c·(−π, π] the helicoid actually spans.
    const born = peakOf('topology', 'helicoid', BOOT, 0);
    for (const secs of [60, 600, 1800]) {
      const later = peakOf('topology', 'helicoid', BOOT, uptime(secs));
      assert.ok(later <= born * 1.5,
        `helicoid peak ${later.toFixed(3)} after ${secs}s against ${born.toFixed(3)} at boot`);
      assert.ok(later >= born * 0.5,
        `helicoid peak ${later.toFixed(3)} after ${secs}s — the surface flattened instead`);
    }
  });

  test('control — helicoid is still c·θ at t = 0, seam included', () => {
    // c = 0.3 + comp·0.3 = 0.45 at BASELINE; height is c·θ·amp·0.25.
    //   x= 1, z=0 → θ = atan2(0,  1) = 0    → 0
    //   x=-1, z=0 → θ = atan2(0, -1) = π    → 0.45·π·0.25
    //   x= 0, z=1 → θ = atan2(1,  0) = π/2  → 0.45·(π/2)·0.25
    // The θ = π row is the seam atan2 already puts in the mesh; folding the
    // spun azimuth back into (−π, π] must leave it exactly where it was.
    near(evalAt('topology', 'helicoid',  1, 0, 0), 0, 1e-15);
    near(evalAt('topology', 'helicoid', -1, 0, 0), 0.45 * Math.PI * 0.25, 1e-15);
    near(evalAt('topology', 'helicoid',  0, 1, 0), 0.45 * (Math.PI / 2) * 0.25, 1e-15);
  });
});

describe('Regression — catalogue arithmetic against the entry’s own promise (#0-#4, #8)', () => {
  test("Brian's Brain has a live population in all 20 of its generations (#0)", () => {
    // gen = round(t·comp·2) % 20, so at comp = 0.5 the integer t IS the
    // generation number. The seed was grid[i] = (i·1664525 + 1013904223) % 3,
    // which lays a repeating 1,0,2 stripe along every row; the grid is 48 wide
    // and 48 is a multiple of 3, so the stripe lines up between rows and every
    // OFF cell sees 3 ON neighbours (4 where the 32-bit wrap shifts the phase),
    // never the 2 the birth rule needs. The board was therefore empty from
    // generation 2 onward — a dead-flat plate for 18 of the 20 phases, and the
    // only entry in the catalogue that ignored AMPLITUDE.
    const params = { amp: 1, freq: 1, comp: 0.5 };
    const empty = [];
    for (let gen = 0; gen < 20; gen++) {
      if (peakOf('cellularAutomata', 'briansBrain', params, gen) <= 0) empty.push(gen);
    }
    assert.equal(empty.length, 0, `empty board at generation(s): ${empty.join(', ')}`);
  });

  test('AMPLITUDE moves the surface at a generation that used to be empty (#0)', () => {
    const quiet = peakOf('cellularAutomata', 'briansBrain', { amp: 1, freq: 1, comp: 0.5 }, 5);
    const loud  = peakOf('cellularAutomata', 'briansBrain', { amp: 2, freq: 1, comp: 0.5 }, 5);
    assert.ok(quiet > 0, 'generation 5 is an empty board');
    near(loud, quiet * 2, 1e-9, 'heights are linear in amp');
  });

  test('control — the seed is still a dense three-state soup (#0)', () => {
    // Decorrelating the seed must not thin it out: generation 0 is a board
    // with roughly a third of its cells in each state, and after bilinear
    // interpolation nearly every vertex of the mesh is off the floor. Bounded
    // by amp·0.45, which is the DYING level.
    const hf = fieldOf('cellularAutomata', 'briansBrain', { amp: 1, freq: 1, comp: 0.5 }, 0);
    let nonZero = 0, peak = 0;
    for (let i = 0; i < hf.length; i++) {
      if (Math.abs(hf[i]) > 1e-12) nonZero++;
      peak = Math.max(peak, Math.abs(hf[i]));
    }
    assert.ok(nonZero > hf.length * 0.5, `generation 0 is sparse: ${nonZero}/${hf.length} vertices`);
    assert.ok(peak <= 0.45 + 1e-9, `generation 0 exceeds the DYING level: ${peak}`);
    // …and a live population is not the same thing as a live board: a seed
    // that saturated every cell would satisfy every assertion above while
    // rendering a plate at the DYING level rather than a cellular automaton.
    const late = fieldOf('cellularAutomata', 'briansBrain', { amp: 1, freq: 1, comp: 0.5 }, 5);
    assert.ok(new Set(late).size > 2, `generation 5 is uniform: ${new Set(late).size} distinct heights`);
  });

  test('dct really is the DCT-II of a signal — the inverse round-trips (#1)', () => {
    // The body summed the k-th basis vector over n with no x[n] anywhere in
    // it: Σₙ cos(π(n+½)k/N) is the DCT-II of the constant 1, which is exactly
    // 0 for every k ≥ 1 by orthogonality. Seven of the eight bands were
    // identically zero — 94% of the mesh a flat plate, invariant under t, amp,
    // freq and comp — while the entry's displayed formula string reads
    // 'DCT-II: X[k] = Σ x[n]cos(π(n+½)k/N)'.
    //
    // Checked without re-implementing the transform: read the eight band
    // heights off the shipped surface, undo the display scaling, and run the
    // inverse (DCT-III) over them. If X[] is the DCT-II of x[], the inverse
    // returns x[] — here the two-harmonic test signal the body documents.
    const N = 8, comp = 0.5, f0 = 1 + comp * 3;
    const p = { amp: 1, freq: 1, comp };
    // Band k is the x-column with round((x+3.5)/7·N) = k, i.e. x = 7k/8 − 3.5.
    // Display scaling at z = 0, amp = 1 is X[k]·(2/N)·0.5, so X[k] = y·N.
    const X = [];
    for (let k = 0; k < N; k++) X.push(evalAt('fourierSeries', 'dct', 7 * k / 8 - 3.5, 0, 0, p) * N);
    for (let k = 0; k < N; k++) {
      assert.ok(Math.abs(X[k]) > 1e-9, `band k=${k} is identically zero — no signal is being transformed`);
    }
    for (let n = 0; n < N; n++) {
      let inv = X[0] / N;
      for (let k = 1; k < N; k++) inv += (2 / N) * X[k] * Math.cos(Math.PI * (n + 0.5) * k / N);
      const signal = Math.sin(2 * Math.PI * f0 * (n + 0.5) / N)
                   + 0.5 * Math.sin(2 * Math.PI * 2 * f0 * (n + 0.5) / N);
      near(inv, signal, 1e-12, `inverse DCT at n=${n}`);
    }
  });

  test('control — dct still bands in x and still decays in z (#1)', () => {
    // Both hold on the old code too: k is quantised from x, so the surface is
    // piecewise constant inside a band, and the z profile is the same
    // exp(−z²·0.3) envelope the neighbouring entries use.
    const p = { amp: 1, freq: 1, comp: 0.5 };
    const a = evalAt('fourierSeries', 'dct', -3.5, 0, 0, p);
    const b = evalAt('fourierSeries', 'dct', -3.3, 0, 0, p);
    near(b, a, 1e-15, 'x=-3.5 and x=-3.3 are both band k=0');
    near(evalAt('fourierSeries', 'dct', -3.5, 1, 0, p), a * Math.exp(-0.3), 1e-12);
  });

  test('complexPower is |z^z| on the negative real axis too (#2)', () => {
    // |z^z| = exp(Re(z·Log z)) = exp(x·ln|z| − y·arg z). The body used the
    // modulus where the real part belongs, so it agreed with |z^z| only where
    // x = |z| — the positive real axis — and the whole x < 0 half came out
    // exponentially too large.
    // At (x, z) = (−2, 0): |z| = 2, arg = π, y = 0
    //   exp(−2·ln2 − 0·π) = 2⁻² = 0.25;  · 0.1 · amp = 0.025
    near(evalAt('complexNumbers', 'complexPower', -2, 0, 0, { amp: 1, freq: 1 }), 0.025, 1e-9);
    // At (x, z) = (−1, −1): |z| = √2, arg = atan2(−1, −1) = −3π/4
    //   exp(−1·½ln2 − (−1)(−3π/4)) = exp(−0.3465736 − 2.3561945) = 0.06701949
    near(evalAt('complexNumbers', 'complexPower', -1, -1, 0, { amp: 1, freq: 1 }),
      Math.exp(-0.5 * Math.LN2 - 3 * Math.PI / 4) * 0.1, 1e-9);
  });

  test('control — complexPower is unchanged on the positive real axis (#2)', () => {
    // Where x = |z| the modulus and the real part are the same number, so
    // these two values are what the old code returned as well: they pin the
    // fix to the substitution and nothing else.
    near(evalAt('complexNumbers', 'complexPower', 2,   0, 0, { amp: 1, freq: 1 }), 0.4, 1e-8);
    near(evalAt('complexNumbers', 'complexPower', 0.5, 0, 0, { amp: 1, freq: 1 }),
      Math.exp(0.5 * Math.log(0.5)) * 0.1, 1e-9);
  });

  test('airy integrates Ai, not some other solution of the same ODE (#3)', () => {
    // The integrator marched from xx = −3 but seeded ai, dai with Ai(0) and
    // Ai′(0), so it followed a different combination of Ai and Bi: at x = 0 it
    // returned −0.365 where Ai(0) = +0.355, sign and all. And `while (xx < xi)`
    // never ran for xi < −3, so a quarter of the domain was a constant shelf
    // at the seed value.
    //
    // xi = x·freq·1.5, and the rendered value at z = 0, amp = 1 is 0.7·Ai(xi)
    // (inside the ±0.8 clamp). Reference values from NIST DLMF.
    const raw = xi => evalAt('specialFunctions', 'airy', xi / 1.5, 0, 0, { amp: 1, freq: 1 }) / 0.7;
    near(raw( 0),  0.3550280539, 1e-9, 'Ai(0)');
    near(raw( 1),  0.1352924163, 1e-3, 'Ai(1)');
    near(raw( 3),  0.0065911393, 1e-3, 'Ai(3)');
    near(raw(-1),  0.5355608833, 1e-3, 'Ai(-1)');
    near(raw(-3), -0.3788142936, 1e-3, 'Ai(-3)');
    near(raw(-5),  0.3507610090, 1e-3, 'Ai(-5)');
  });

  test('airy has no constant shelf left of xi = −3, and decays on the right (#3)', () => {
    // Tier C for this entry is "sign, monotonicity, asymptotic limit": the
    // left tail must oscillate rather than sit still, and the right tail must
    // decay to zero rather than run into the −0.8 clamp.
    const raw = xi => evalAt('specialFunctions', 'airy', xi / 1.5, 0, 0, { amp: 1, freq: 1 }) / 0.7;
    const shelf = [raw(-3.2), raw(-4), raw(-5), raw(-6)];
    for (let i = 1; i < shelf.length; i++) {
      assert.ok(Math.abs(shelf[i] - shelf[0]) > 1e-3,
        `Ai is constant at xi=${[-3.2, -4, -5, -6][i]} — the integrator never ran`);
    }
    assert.ok(raw(0) > 0, 'Ai(0) must be positive');
    assert.ok(Math.abs(raw(5.25)) < 0.05, `right tail does not decay: ${raw(5.25)}`);
  });

  test('control — airy keeps its z envelope and its clamp (#3)', () => {
    // Both true of the old code: the height is Ai·0.7·exp(−z²·0.3), clamped to
    // ±0.8 so a diverging march cannot tear the mesh.
    const at00 = evalAt('specialFunctions', 'airy', 0, 0, 0, { amp: 1, freq: 1 });
    near(evalAt('specialFunctions', 'airy', 0, 1, 0, { amp: 1, freq: 1 }),
      at00 * Math.exp(-0.3), 1e-12);
    const far = evalAt('specialFunctions', 'airy', 3.5, 0, 0, { amp: 1.5, freq: 3.5, comp: 0.9 });
    assert.ok(Number.isFinite(far) && Math.abs(far) <= 0.8 + 1e-12, `clamp lost: ${far}`);
  });

  test('metropolisWalk does not re-roll its acceptance coin every frame (#4)', () => {
    // The comment above the acceptance test promises a surface "reproducible
    // frame to frame instead of flickering as Math.random() would" — and then
    // hashed the global clock, which advances 0.008 per frame and moves the
    // sine argument 2.49 rad in that step. One 60 fps frame changed the height
    // field by 95% of its own peak.
    const a = fieldOf('probability', 'metropolisWalk', BOOT, 12.0);
    const b = fieldOf('probability', 'metropolisWalk', BOOT, 12.008);
    let moved = 0;
    for (let i = 0; i < a.length; i++) moved = Math.max(moved, Math.abs(a[i] - b[i]));
    assert.equal(moved, 0, `one 60 fps frame moved the surface by ${moved.toFixed(4)}`);
  });

  test('control — metropolisWalk still has a chain and still answers the mid band (#4)', () => {
    // An acceptance test that always rejects (or always accepts) would also
    // stop flickering, and would be a worse entry than the one we started
    // with. The walk must still put a structured ridge on the mesh, and comp —
    // which sets the proposal width — must still change where it lands.
    const hf = fieldOf('probability', 'metropolisWalk', BOOT, 12.0);
    const distinct = new Set();
    let peak = 0;
    for (let i = 0; i < hf.length; i++) { distinct.add(hf[i].toFixed(6)); peak = Math.max(peak, Math.abs(hf[i])); }
    assert.ok(peak > 0.05, `the walk produced no ridge at all: peak ${peak}`);
    assert.ok(distinct.size > 10, `the surface is constant: ${distinct.size} distinct heights`);
    const low  = fieldOf('probability', 'metropolisWalk', { amp: 1, freq: 1, comp: 0.5 }, 12.0);
    const high = fieldOf('probability', 'metropolisWalk', { amp: 1, freq: 1, comp: 0.9 }, 12.0);
    let spread = 0;
    for (let i = 0; i < low.length; i++) spread = Math.max(spread, Math.abs(low[i] - high[i]));
    assert.ok(spread > 1e-3, `comp 0.5 → 0.9 changed nothing: ${spread}`);
  });

  test('legendre2 is not labelled with a degree the audio path cannot select (#8)', () => {
    // n = round(1 + comp·4), and comp is `0.5 + mid·0.4` at all three sites
    // that build it, so comp ∈ [0.5, 0.9] and n ∈ {3, 4, 5}. P₂ would need
    // comp < 0.375, which nothing in the app produces — the label named a
    // surface the entry never draws. MATHEMATICAL_ACCURACY.md had already been
    // corrected to "Legendre P_n Surface"; the code label was left behind.
    for (const comp of [0.5, 0.58, 0.7, 0.9]) {
      assert.ok([3, 4, 5].includes(Math.round(1 + comp * 4)), `comp=${comp} selects P₂`);
    }
    const entry = getFormula('specialFunctions', 'legendre2');
    assert.ok(!/₂/.test(entry.name), `name still promises a fixed degree: ${entry.name}`);
    assert.ok(!/₂/.test(entry.formula), `formula string still promises P₂: ${entry.formula}`);
  });

  test('control — legendre2 still renders P₃ at the bottom of the comp range (#8)', () => {
    // Renaming must not touch the arithmetic. u = clamp(x·freq·0.28, −1, 1) =
    // 0.28 at x = 1; P₃(u) = (5u³ − 3u)/2 = (5·0.021952 − 0.84)/2 = −0.36512;
    // · amp · 0.5 · exp(−z²·0.3) = −0.18256 at z = 0.
    near(evalAt('specialFunctions', 'legendre2', 1, 0, 0, { amp: 1, freq: 1, comp: 0.5 }),
      -0.18256, 1e-12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOG SCHEMA — invariants over the whole formula registry
// ═══════════════════════════════════════════════════════════════════════════════

describe('Catalog statistics', () => {
  test('exactly 12 collections registered', () => {
    // Pin the collection count so an accidental rename or delete shows
    // up as a clean failure rather than a silently-missing menu entry.
    assert.equal(Object.keys(MATH_COLLECTIONS).length, 12);
  });

  test('total formula count matches expected (between 180-200)', () => {
    // Loose bound rather than exact pin: formulas can be added or
    // tweaked without thrashing this test, but a wholesale loss of an
    // entire collection (say, 24 formulas) will fail it.
    let total = 0;
    for (const col of Object.values(MATH_COLLECTIONS)) {
      total += Object.keys(col.formulas).length;
    }
    assert.ok(total >= 180 && total <= 200,
      `Expected 180–200 formulas, got ${total}`);
  });

  test('every formula has name, formula string, and f function', () => {
    // Schema invariant for math-collections.js. The UI dropdown reads
    // `name`, the info pane shows `formula`, and the engine calls `f`;
    // a missing field breaks one of those silently otherwise.
    let missing = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, formula] of Object.entries(col.formulas)) {
        if (!formula.name)    missing.push(`${colId}/${key}: name`);
        if (!formula.formula) missing.push(`${colId}/${key}: formula`);
        if (typeof formula.f !== 'function') missing.push(`${colId}/${key}: f`);
      }
    }
    assert.equal(missing.length, 0,
      `Schema violations: ${missing.join(', ')}`);
  });

  test('every volume formula has name, description, and f function', () => {
    // Parallel schema invariant for VOLUME_FORMULAS — same reasoning
    // as above, plus `description` is what the volume formula picker
    // shows next to the name.
    let missing = [];
    for (const [key, formula] of Object.entries(VOLUME_FORMULAS)) {
      if (!formula.name)        missing.push(`${key}: name`);
      if (!formula.description) missing.push(`${key}: description`);
      if (typeof formula.f !== 'function') missing.push(`${key}: f`);
    }
    assert.equal(missing.length, 0,
      `Volume schema violations: ${missing.join(', ')}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUND 5 — the 2026-08-13 audit
//
// Every test below fails on the code as it stood before that audit. Where a
// defect was found by a probe that a hand-written list could not have found,
// the test is written list-free for the same reason.
// ═══════════════════════════════════════════════════════════════════════════════

/** Independent quadrature — five-node Gauss–Legendre on `seg` panels. */
function gaussLegendre(f, a, b, seg) {
  const nodes = [
    [-0.9061798459386640, 0.2369268850561891],
    [-0.5384693101056831, 0.4786286704993665],
    [0,                   0.5688888888888889],
    [ 0.5384693101056831, 0.4786286704993665],
    [ 0.9061798459386640, 0.2369268850561891],
  ];
  let s = 0;
  const h = (b - a) / seg;
  for (let i = 0; i < seg; i++) {
    const c = a + h * (i + 0.5);
    for (const [xi, w] of nodes) s += w * f(c + xi * h / 2);
  }
  return s * h / 2;
}

describe('Regression — special functions rewritten to their documented tier (#R5)', () => {
  // erf: was the Abramowitz & Stegun §7.1.26 Horner fit, whose error bound is
  // 1.5e-7 by construction — measured 1.394e-7 at x = 0.045 — while the entry
  // is rated tier A. The wrapper at z = 0, amp = freq = 1 is a factor 0.5.
  test('erf holds machine precision, not the 1.5e-7 of the polynomial fit', () => {
    const ref = x => 2 / Math.sqrt(Math.PI) * gaussLegendre(u => Math.exp(-u * u), 0, x, 400);
    let worst = 0, worstX = 0;
    for (let x = 0.005; x <= 4; x += 0.005) {
      const got = evalAt('specialFunctions', 'erf', x, 0) / 0.5;
      const d = Math.abs(got - ref(x));
      if (d > worst) { worst = d; worstX = x; }
    }
    assert.ok(worst < 1e-12,
      `erf is off by ${worst.toExponential(3)} at x=${worstX.toFixed(3)}; tier A allows 1e-12`);
  });

  test('erf at the canonical points', () => {
    // erf(1) and erf(2) to sixteen digits, NIST DLMF 7.1.
    near(evalAt('specialFunctions', 'erf', 1, 0) / 0.5, 0.8427007929497149, 1e-14, 'erf(1)');
    near(evalAt('specialFunctions', 'erf', 2, 0) / 0.5, 0.9953222650189527, 1e-14, 'erf(2)');
    near(evalAt('specialFunctions', 'erf', 0, 0), 0, 1e-16, 'erf(0)');
  });

  // dawson: Taylor below |x| = 3.5 and a five-term asymptotic above it. The
  // asymptotic series for F is divergent, so the seam could not be closed by
  // adding terms — measured 1.9e-12 at x = 3.4 against 3.2e-5 at x = 3.5, and
  // xv = x·freq·1.5 reaches 5.25 at the default wave intensity.
  test('dawson has no step at the old 3.5 seam', () => {
    const ref = x => Math.exp(-x * x) * gaussLegendre(u => Math.exp(u * u), 0, x, 1200);
    let worst = 0, worstX = 0;
    for (let x = 0.02; x <= 5.25; x += 0.01) {
      const got = evalAt('specialFunctions', 'dawson', x / 1.5, 0) / 0.4;
      const d = Math.abs(got - ref(x));
      if (d > worst) { worst = d; worstX = x; }
    }
    assert.ok(worst < 1e-12,
      `Dawson is off by ${worst.toExponential(3)} at x=${worstX.toFixed(3)}`);
  });

  test('dawson at the canonical points', () => {
    const at = x => evalAt('specialFunctions', 'dawson', x / 1.5, 0) / 0.4;
    near(at(0.5), 0.4244363835020223, 1e-14, 'F(0.5)');
    near(at(1),   0.5380795069127684, 1e-14, 'F(1)');
    near(at(2),   0.3013403889237920, 1e-14, 'F(2)');
    near(at(3),   0.1782710306105583, 1e-14, 'F(3)');
    near(at(5),   0.1021340744242768, 1e-14, 'F(5)');
  });

  // clausen: twelve terms of Σ sin(kθ)/k², which converges like 1/N and so had
  // no accuracy at all near the ends of the period, where Cl₂ has infinite slope.
  test('clausen matches Catalan and the other canonical values', () => {
    const xOf = th => 7 * th / (2 * Math.PI) - 3.5;
    const at = th => evalAt('specialFunctions', 'clausen', xOf(th), 0) / 0.3;
    // Cl₂(π/2) is Catalan's constant; Cl₂(π/3) is its maximum; Cl₂(π) = 0.
    near(at(Math.PI / 2),     0.9159655941772190, 1e-13, 'Cl2(pi/2) = Catalan');
    near(at(Math.PI / 3),     1.0149416064096537, 1e-13, 'Cl2(pi/3)');
    near(at(2 * Math.PI / 3), 0.6766277376064358, 1e-13, 'Cl2(2pi/3)');
    near(at(Math.PI),         0,                  1e-15, 'Cl2(pi)');
  });

  // zeta: 14–22 terms of Σn^{-s} against a window starting at s = 1.05, where
  // the truncated sum is 85 % low. The display map is a log now, so the test
  // inverts it to read back the ζ the surface is actually drawn from.
  test('zeta is ζ, not a truncated sum 85 % below it', () => {
    const sumFromHeight = h => Math.exp((h + 0.35) / 0.25);
    const xOf = s => ((s - 1.05) / 4) * 7 - 3.5;      // comp = 0.5 window
    const cases = [
      [2,    Math.PI ** 2 / 6],
      [4,    Math.PI ** 4 / 90],
      [3,    1.2020569031595943],   // Apéry
      [1.5,  2.6123753486854883],
    ];
    for (const [s, exact] of cases) {
      const got = sumFromHeight(evalAt('specialFunctions', 'zeta', xOf(s), 0));
      assert.ok(Math.abs(got - exact) / exact < 1e-9,
        `zeta(${s}) reads back ${got} against ${exact}`);
    }
  });

  // hypergeometric: the early exit at 1e-8 never fired — the twelfth term at
  // z = 0.875 is 2.5e-2 — so the loop always stopped at its cap of twelve.
  test('hypergeometric reaches its tier-B floor at the right-hand edge', () => {
    const ref = (zv, comp) => {
      const a = 0.5, b = 0.5 + comp, c = 1.5;
      let sum = 1, term = 1;
      for (let n = 1; n <= 200000; n++) {
        term *= ((a + n - 1) * (b + n - 1)) / ((c + n - 1) * n) * zv;
        sum += term;
        if (Math.abs(term) < 1e-18) break;
      }
      return sum;
    };
    let worst = 0;
    for (const comp of [0.5, 0.7, 0.9]) {
      for (const zv of [-0.95, -0.5, 0, 0.5, 0.875, 0.95]) {
        const got = evalAt('specialFunctions', 'hypergeometric', zv / 0.25, 0, 0,
          { amp: 1, freq: 1, comp }) / 0.15;
        worst = Math.max(worst, Math.abs(got - ref(zv, comp)) / Math.abs(ref(zv, comp)));
      }
    }
    assert.ok(worst < 1e-3, `2F1 relative error ${worst.toExponential(3)} exceeds tier B`);
  });

  // chebyshev: the ±(1−1e-9) guard inside acos cost 2.5e-8 at |x| = 1, and xv is
  // clamped to [−1, 1], so that was the whole rim of the surface and not a point.
  test('chebyshev is exact on the saturated rim', () => {
    // freq = 2 puts x·freq·0.28 at 1.96, so the clamp delivers exactly ±1 —
    // the rim the entry saturates against, where T_n(±1) = (±1)ⁿ. Solving for
    // the freq that lands on 1.0 arithmetically would not do: it lands one ulp
    // short and the test would be measuring its own rounding.
    const P = { amp: 1, freq: 2, comp: 0.5 };   // comp 0.5 → n = 4
    near(evalAt('specialFunctions', 'chebyshev',  3.5, 0, 0, P) / 0.45, 1, 1e-15, 'T4(1)');
    near(evalAt('specialFunctions', 'chebyshev', -3.5, 0, 0, P) / 0.45, 1, 1e-15, 'T4(-1)');
  });

  // gamma_fn: drew 0.12·ln|Γ(n)| under the caption Γ(n) = (n−1)!. It plots Γ now,
  // so the surface carries the feature that makes Γ recognisable.
  test('gamma_fn plots Γ, and has its minimum where Γ does', () => {
    // n = 0.2 + (x+3.5)/7·3.6, so x = (n − 0.2)/3.6·7 − 3.5.
    const xOf = n => (n - 0.2) / 3.6 * 7 - 3.5;
    const at = n => evalAt('specialFunctions', 'gamma_fn', xOf(n), 0);
    // The height is gamma(n)·0.22 − 0.6, read back at three points.
    for (const n of [0.5, 1, 2, 3.5]) {
      near(at(n), gamma(n) * 0.22 - 0.6, 1e-12, `gamma_fn at n=${n}`);
    }
    // Γ has a single minimum on the positive axis at n = 1.4616321449683623,
    // where Γ = 0.8856031944108887 — the surface's lowest point must be there.
    let lowest = Infinity, lowestN = 0;
    for (let n = 0.2; n <= 3.8; n += 0.001) {
      const v = at(n);
      if (v < lowest) { lowest = v; lowestN = n; }
    }
    near(lowestN, 1.4616321449683623, 2e-3, 'position of the gamma minimum');
    near(lowest, 0.8856031944108887 * 0.22 - 0.6, 1e-6, 'depth of the gamma minimum');
  });

  // sinc: exact all along; the caption said sinc(x) for a surface that is the
  // radial sombrero. The zeros are the check that fixes which one it is.
  test('sinc is the radial sinc, with its zeros on circles', () => {
    // r = sqrt(x²+z²)·freq·2 + 1e-8, so r = k at radius k/2 when freq = 1.
    for (const k of [1, 2, 3]) {
      const onAxis = evalAt('specialFunctions', 'sinc', k / 2, 0);
      const offAxis = evalAt('specialFunctions', 'sinc', k / 2 / Math.SQRT2, k / 2 / Math.SQRT2);
      near(onAxis, 0, 1e-7, `sinc zero at r=${k} on the x axis`);
      near(offAxis, 0, 1e-7, `sinc zero at r=${k} on the diagonal — a circle, not a stripe`);
    }
    near(evalAt('specialFunctions', 'sinc', 0, 0), 0.6, 1e-7, 'sinc(0) = 1');
  });

  // airy: an RK4 march of y″ = xy amplifies the growing Bi solution whatever the
  // step size. Measured on the marching code, Ai came back negative from
  // ξ ≈ 4.88, inside the ξ ≤ 5.25 the default wave intensity reaches.
  test('airy never returns a negative Ai on the positive axis', () => {
    let negatives = 0, firstAt = null;
    for (let xi = 0.01; xi <= 24; xi += 0.01) {
      if (evalAt('specialFunctions', 'airy', xi / 1.5, 0) < 0) {
        negatives++;
        if (firstAt === null) firstAt = xi;
      }
    }
    assert.equal(negatives, 0,
      `Ai(x) > 0 for every x > 0; got ${negatives} negative samples, first at xi=${firstAt}`);
  });

  test('airy at the canonical points, both sides of the origin', () => {
    const at = xi => evalAt('specialFunctions', 'airy', xi / 1.5, 0) / 0.7;
    near(at(0),  0.3550280538878172, 1e-15, 'Ai(0)');
    near(at(1),  0.1352924163128814, 1e-14, 'Ai(1)');
    near(at(2),  0.0349241304232744, 1e-14, 'Ai(2)');
    near(at(-1), 0.5355608832923521, 1e-14, 'Ai(-1)');
    near(at(-2), 0.2274074282016538, 1e-13, 'Ai(-2)');
    // First zero of Ai, DLMF 9.9.1.
    near(at(-2.338107410459767), 0, 1e-13, 'Ai(a1) = 0');
  });

  test('control — airy keeps its clamp and its z envelope', () => {
    const v0 = evalAt('specialFunctions', 'airy', 0, 0);
    const vz = evalAt('specialFunctions', 'airy', 0, 1.5);
    near(vz / v0, Math.exp(-1.5 * 1.5 * 0.3), 1e-12, 'z envelope');
    assert.ok(Math.abs(evalAt('specialFunctions', 'airy', -3.4, 0, 0,
      { amp: 8, freq: 1, comp: 0.5 })) <= 0.8, 'clamp still holds');
  });

  // gamma: Math.pow(t, n+0.5) overflowed at n ≈ 142.2 while the product it sits
  // in did not — the exp(-t) that brings it back is applied afterwards.
  test('gamma survives to the true double overflow, not to 142', () => {
    assert.ok(Number.isFinite(gamma(150)), 'gamma(150) overflowed');
    assert.ok(Number.isFinite(gamma(171)), 'gamma(171) overflowed');
    assert.ok(!Number.isFinite(gamma(172)), 'gamma(172) should overflow — 171! is the last one that fits');
    // Value check via Stirling with three correction terms, in logs.
    const lg = n => (n - 0.5) * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI)
      + 1 / (12 * n) - 1 / (360 * n ** 3) + 1 / (1260 * n ** 5);
    assert.ok(Math.abs(Math.log(gamma(150)) - lg(150)) < 1e-9,
      `ln gamma(150) = ${Math.log(gamma(150))} against Stirling ${lg(150)}`);
  });

  test('control — gamma is unmoved where it always worked', () => {
    near(gamma(5), 24, 1e-12, 'gamma(5)');
    near(gamma(0.5), Math.sqrt(Math.PI), 1e-14, 'gamma(1/2)');
  });
});

describe('Regression — surfaces that went out over the length of a set (#R5)', () => {
  // hydrogenS drew |ψ₁₀₀|² multiplied by cos²(l·θ + 0.3t) with l = 0, i.e. by
  // cos²(0.3t): the 1s orbital blinked out completely every π/0.3 = 10.47
  // formula units, 21.8 s of wall clock. An s state is spherically symmetric
  // AND stationary — the entry's own caption is |ψ₁₀₀|² = 1/π·e^{−2r}, with no
  // t in it. The drift test above could not catch this: it samples uptimes far
  // apart, and this surface always came back.
  test('hydrogenS is stationary — it does not depend on the clock at all', () => {
    const v0 = evalAt('quantumMechanics', 'hydrogenS', 0.8, 0.3, 0);
    for (const t of [0.5, 5.236, 10.472, 15.708, 100, 864]) {
      assert.equal(evalAt('quantumMechanics', 'hydrogenS', 0.8, 0.3, t), v0,
        `1s orbital moved between t=0 and t=${t}`);
    }
  });

  test('hydrogenS never collapses to a flat plate', () => {
    let lo = Infinity, hi = 0, loAt = 0;
    for (let t = 0; t <= 42; t += 0.05) {
      const p = peakOf('quantumMechanics', 'hydrogenS', BOOT, t, 25);
      if (p < lo) { lo = p; loAt = t; }
      if (p > hi) hi = p;
    }
    assert.ok(lo > hi * 0.9,
      `1s peak fell to ${lo.toExponential(2)} at t=${loAt} against ${hi.toExponential(2)}`);
  });

  test('control — hydrogen2p keeps the angular factor l = 1 gives it', () => {
    // l = 1 is a real angular dependence and must stay. cos(θ + 0.3t) sweeps the
    // azimuth, so some vertex is always near the maximum and nothing collapses,
    // but the surface must still move with t.
    const a = evalAt('quantumMechanics', 'hydrogen2p', 1.2, 0.4, 0);
    const b = evalAt('quantumMechanics', 'hydrogen2p', 1.2, 0.4, 5.2);
    assert.notEqual(a, b, '2p should still rotate with the clock');
  });

  // feynmanPath is the eighth entry that read the session clock as a physical
  // age. It is not in the DRIFTERS list above because that list is written by
  // hand — which is the actual defect this second test is here to cover.
  test('feynmanPath replays instead of fading out', () => {
    const born = peakOf('quantumMechanics', 'feynmanPath', BOOT, 0);
    for (const secs of [1800, 3600, 14400]) {
      let alive = 0;
      for (const d of [0, 0.13, 0.29, 0.47]) {
        alive = Math.max(alive, peakOf('quantumMechanics', 'feynmanPath', BOOT, uptime(secs) + d));
      }
      assert.ok(alive > born * 0.1,
        `feynmanPath at ${secs}s uptime: peak ${alive.toExponential(2)} against ${born.toExponential(2)} at boot`);
    }
  });

  test('control — feynmanPath at t = 0 is what it always was', () => {
    // cos(0)·amp·0.4/sqrt(0.5), the value the pre-fix code produced.
    near(evalAt('quantumMechanics', 'feynmanPath', 0, 0, 0), 0.4 / Math.sqrt(0.5), 1e-15);
  });

  // The list-free version of the drift guard. Written this way on purpose: the
  // hand-written DRIFTERS array is what let feynmanPath through for a whole
  // round, so this one asks the same question of all 192 entries and needs no
  // maintenance when an entry is added.
  test('no entry in the catalogue fades out over the length of a set', () => {
    // Sampled over a window rather than at an instant, so an oscillator caught
    // at a zero crossing is not mistaken for a dead surface. Four hours as well
    // as thirty minutes: feynmanPath cleared the thirty-minute line by 7 % and
    // failed at every longer uptime, which is exactly the shape of decay a
    // single checkpoint misses.
    const windowPeak = (colId, key, t0) => {
      let m = 0;
      for (let i = 0; i < 9; i++) m = Math.max(m, peakOf(colId, key, BOOT, t0 + i * 0.7, 25));
      return m;
    };
    const dead = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const key of Object.keys(col.formulas)) {
        const born = windowPeak(colId, key, 0);
        if (born < 1e-9) continue;               // an entry that never draws is another test's business
        for (const secs of [1800, 14400]) {
          const later = windowPeak(colId, key, uptime(secs));
          if (later < born * 0.1) {
            dead.push(`${colId}/${key} @${secs}s: ${later.toExponential(2)}`
              + ` against ${born.toExponential(2)} at boot`);
          }
        }
      }
    }
    assert.equal(dead.length, 0, `Faded out over a set:\n  ${dead.join('\n  ')}`);
  });
});

describe('Regression — surfaces that left the frame (#R5)', () => {
  // catenoid is exact — a·cosh(z/a) — and unwatchable: cosh(2·z·freq) with
  // |z| ≤ 3.5 measured a peak of 8.2e1 at the DEFAULT wave intensity against a
  // frame about 3 units high, 3.3e9 at the top of the slider and 5.1e12 with
  // treble on top. The value stays finite, so the isFinite guard in
  // generateSurfaceFromFormula passed it straight to the mesh.
  test('catenoid stays inside the frame across the whole slider', () => {
    const worst = [];
    for (const freq of [0.3, 0.6, 1, 2, 3.5, 4.55, 6.5]) {
      const hf = generateSurfaceFromFormula(getFormula('topology', 'catenoid').f,
        { amp: 1.5, freq, comp: 0.9 }, 49, 3.5, 0);
      let p = 0;
      for (let i = 0; i < hf.length; i++) p = Math.max(p, Math.abs(hf[i]));
      if (p > 1.5 + 1e-9) worst.push(`freq=${freq}: ${p.toExponential(2)}`);
    }
    assert.equal(worst.length, 0, `catenoid left the frame at ${worst.join(', ')}`);
  });

  test('control — catenoid is untouched where it was always legible', () => {
    // The neck, and the value the pre-fix code produced there.
    near(evalAt('topology', 'catenoid', 0, 0, 0), 0.15, 1e-12);
    // A point well inside the clamp must be bit-identical to a·cosh(z/a) − |x|.
    const x = 0.4, z = 0.7;
    near(evalAt('topology', 'catenoid', x, z, 0),
      (0.5 * Math.cosh(z / 0.5) - Math.abs(x)) * 0.3, 1e-15);
  });
});

describe('Regression — volume fields say what they do (#R5)', () => {
  const H = 1e-5;
  const V = (key, x, y, z, t) => VOLUME_FORMULAS[key].f(x, y, z, t, BASELINE);
  const divergence = (key, x, y, z, t) =>
    ((V(key, x + H, y, z, t).dx - V(key, x - H, y, z, t).dx)
   + (V(key, x, y + H, z, t).dy - V(key, x, y - H, z, t).dy)
   + (V(key, x, y, z + H, t).dz - V(key, x, y, z - H, t).dz)) / (2 * H);

  const SAMPLE = [];
  for (const a of [-2, -0.7, 0.4, 1.6]) for (const b of [-1.3, 0.5, 2.1]) for (const c of [-1.1, 0.9, 2.4]) {
    SAMPLE.push([a, b, c]);
  }

  test('fluidVortex is incompressible, which is what its description claims', () => {
    // Before: ∇·v = −amp·0.1·freq·sin(y·freq+t), from the vertical component
    // alone — |∇·v|/|v| averaged 0.80 over this sample.
    let worst = 0, at = null;
    for (const t of [0, 0.7, 3.1]) {
      for (const p of SAMPLE) {
        const d = Math.abs(divergence('fluidVortex', p[0], p[1], p[2], t));
        if (d > worst) { worst = d; at = [...p, t]; }
      }
    }
    assert.ok(worst < 1e-8,
      `div v = ${worst.toExponential(3)} at (x,y,z,t)=${JSON.stringify(at)}`);
  });

  test('control — the divergence stencil can read a zero', () => {
    // A field that is solenoidal by construction. Without this the test above
    // would pass just as well on a stencil that always returns something small.
    const probe = { f: (x, y, z) => ({ dx: -z, dy: 0, dz: x }) };
    VOLUME_FORMULAS.__divProbe = probe;
    try {
      let worst = 0;
      for (const p of SAMPLE) worst = Math.max(worst, Math.abs(divergence('__divProbe', p[0], p[1], p[2], 0)));
      assert.ok(worst === 0, `stencil noise on a solenoidal field: ${worst}`);
      // And it can read a non-zero: ∇·(x,y,z) = 3.
      VOLUME_FORMULAS.__divProbe = { f: (x, y, z) => ({ dx: x, dy: y, dz: z }) };
      near(divergence('__divProbe', 0.4, 0.5, 0.9, 0), 3, 1e-6, 'div of the identity field');
    } finally {
      delete VOLUME_FORMULAS.__divProbe;
    }
  });

  test('magneticDipole has the dipole shape at every radius', () => {
    // B_axis/B_equator = −2 for a dipole, at any r. ε regularises the
    // denominator and must cancel out of the ratio; before the fix it did not,
    // because ε was also inside the numerator's m·r² term — measured −1.667 at
    // r = 2 against the −2 a dipole gives.
    for (const R of [0.5, 1, 2, 4, 8, 16]) {
      const axis = VOLUME_FORMULAS.magneticDipole.f(0, 0, R, 1, BASELINE).dz;
      const equator = VOLUME_FORMULAS.magneticDipole.f(R, 0, 0, 1, BASELINE).dz;
      near(axis / equator, -2, 1e-12, `axis/equator at r=${R}`);
    }
  });

  test('magneticDipole is finite at the origin the mesh passes through', () => {
    const v = VOLUME_FORMULAS.magneticDipole.f(0, 0, 0, 1, BASELINE);
    assert.ok(Number.isFinite(v.dx) && Number.isFinite(v.dy) && Number.isFinite(v.dz));
  });

  test('lorenzField is the Lorenz field, not three fields glued together', () => {
    // The three components carried three different scales — 1.2e-2, 1.8e-3,
    // 1.2e-3 — so the direction of the vector was wrong at every point.
    const sigma = 10, rho = 28, beta = 8 / 3;
    for (const [x, y, z] of [[1, 2, 3], [-4, 5, 20], [0.5, -0.5, 1]]) {
      const v = VOLUME_FORMULAS.lorenzField.f(x, y, z, 0, BASELINE);
      const kx = v.dx / (sigma * (y - x));
      const ky = v.dy / (x * (rho - z) - y);
      const kz = v.dz / (x * y - beta * z);
      near(ky / kx, 1, 1e-12, `dy scale against dx at (${x},${y},${z})`);
      near(kz / kx, 1, 1e-12, `dz scale against dx at (${x},${y},${z})`);
    }
  });
});

describe('Regression — the label the viewer reads is the entry that draws (#R5)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // The `formula` string on every catalogue entry is never rendered anywhere —
  // buildMathCollectionUI() would show it and nothing calls it (see dom.js, the
  // three ids under OPTIONAL). What a viewer actually reads is the <option>
  // text in index.html, which is a second, hand-maintained copy of the name.
  // Nothing checked the two against each other, which is how index.html came to
  // say "Legendre P₂ Surface" for an entry that can only draw P₃…P₅.
  test('every m: option text matches the catalogue name it selects', () => {
    const opts = [...html.matchAll(/<option value="m:([A-Za-z]+):([A-Za-z0-9_]+)"[^>]*>([^<]+)<\/option>/g)];
    assert.equal(opts.length, 192, `expected 192 m: options, found ${opts.length}`);
    const drift = [], seen = new Set();
    for (const [, colId, key, text] of opts) {
      seen.add(`${colId}:${key}`);
      const entry = MATH_COLLECTIONS[colId]?.formulas?.[key];
      if (!entry) { drift.push(`option m:${colId}:${key} selects nothing`); continue; }
      if (entry.name.trim() !== text.trim()) {
        drift.push(`m:${colId}:${key}: markup "${text.trim()}" against catalogue "${entry.name}"`);
      }
    }
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const key of Object.keys(col.formulas)) {
        if (!seen.has(`${colId}:${key}`)) drift.push(`${colId}:${key} has no option`);
      }
    }
    assert.equal(drift.length, 0, `Label drift:\n  ${drift.join('\n  ')}`);
  });

  test('every volume option text matches its VOLUME_FORMULAS name', () => {
    const drift = [];
    for (const [key, entry] of Object.entries(VOLUME_FORMULAS)) {
      const m = html.match(new RegExp(`<option value="${key}">([^<]+)</option>`));
      if (!m) { drift.push(`${key} has no option`); continue; }
      if (m[1].trim() !== entry.name.trim()) {
        drift.push(`${key}: markup "${m[1].trim()}" against "${entry.name}"`);
      }
    }
    assert.equal(drift.length, 0, `Volume label drift:\n  ${drift.join('\n  ')}`);
  });
});

describe('Regression — GPU displacement branches that drew nothing (#R5)', () => {
  // GLSL cannot be evaluated here, so these read the shader source. Both defects
  // are visible in the text once you know what to look for, and both were
  // invisible for as long as nobody looked: the modes rendered a flat plate in a
  // flat colour, because main() assigns pos.y rather than accumulating it.
  const vs = readFileSync(new URL('../src/shaders.js', import.meta.url), 'utf8');
  const branch = n => {
    const m = vs.match(new RegExp(`mode==${n}\\)\\{([\\s\\S]*?)\\}\\n?\\s*(?:else|// FIX|return)`));
    assert.ok(m, `could not find branch mode==${n}`);
    return m[1];
  };

  test('mode 10 no longer multiplies every term by sin(nπ)', () => {
    const src = branch(10);
    assert.ok(!/sin\(fn\*3\.14159\)/.test(src),
      'sin(fn*3.14159) is sin(n·π) = 0 for integer n — the whole sum was zero');
    // And it carries the tau coefficients its label names.
    for (const c of ['0.001', '-0.024', '0.252', '-1.472', '4.830', '-6.048', '-16.744']) {
      assert.ok(src.includes(c), `tau coefficient ${c} missing from mode 10`);
    }
  });

  test('mode 30 weights the negative half of the sum with the sign of n', () => {
    const src = branch(30);
    // The summand sin(5n·x)cos(5n·z) is odd in n. With an even weight every pair
    // cancels exactly — measured span 1.1e-16. The n = −4 term must therefore
    // carry exp(+1.2), not the exp(−1.2) its mirror carries.
    assert.ok(/exp\(4\.\*\.3\)/.test(src), 'the n = -4 term still uses the positive-n weight');
    assert.ok(/exp\(-4\.\*\.3\)/.test(src), 'the n = +4 term should keep its own weight');
  });

  test('the two spectrum modes read the spectrum', () => {
    // "EQ 3D" and "Vocoder" used neither uBass nor uMid nor uTreble: their
    // surface span was identical to the digit in silence and under loud music.
    for (const n of [35, 36]) {
      const src = branch(n);
      for (const uniform of ['b', 'm', 't']) {
        assert.ok(new RegExp(`[+*(]\\s*${uniform}\\s*\\*`).test(src),
          `mode ${n} does not read uniform ${uniform}`);
      }
    }
  });

  test('mode 11 keeps a floor when there is no treble', () => {
    // sin(fn*t*2.) with t = uTreble is exactly zero in silence, and this branch
    // had no (0.3 + b·.7)-style floor to fall back on: span 0.0 with no audio.
    assert.ok(/0\.35\+t\*2\./.test(branch(11).replace(/\s/g, '')),
      'mode 11 still vanishes when uTreble is zero');
  });
});
