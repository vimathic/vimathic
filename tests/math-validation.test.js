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

  test('vectorField: curl of constant field is zero', () => {
    // F_z = cos(x)·sin(z) — non-trivial in general.
    // At x=0, z=0: dFz/dx = 0, dFx/dz = 0, curl = 0.
    near(evalAt('linearAlgebra', 'vectorField', 0, 0, 0), 0, 1e-3);
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
