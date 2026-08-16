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
import { readFileSync, readdirSync } from 'node:fs';

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
    // Round 6 moved the window off the pole: s = (x+3.5)/7·4.75 + 0.35, which
    // starts at 0.35 instead of 0.1. Starting at 0.1 put the left edge of the
    // plate at 1/0.1 = 10, i.e. 3.5 world units at the factory sliders against
    // a ~3-unit frame — the entry left the frame purely because the window was
    // pushed up against the pole, not because the transform is large.
    // For s = 1: (x+3.5)/7 = 0.65/4.75 → x = −2.5421052631578946.
    // 1/1 · 0.9 = 0.9.
    const xForS1 = 7 * (0.65 / 4.75) - 3.5;
    near(evalAt('integralTransforms', 'laplaceTransform', xForS1, 0, 0), 0.9, 1e-12);
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
    // dist = √(x²+z²) - R = √(2.25) - 1.5 = 0 at x=1.5, so the height is the
    // tube radius itself: r = 0.5 + 0.3·comp = 0.65 at comp = 0.5.
    // FIX(r8): this used to expect r/2, pinning the very factor that made the
    // section an ellipse of aspect 2:1 while the caption promised the circle
    // (√(x²+z²)−R)² + y² = r². A test can hold a defect in place as firmly as
    // it holds a contract.
    const params = { amp: 1, freq: 1, comp: 0.5 };
    const v = evalAt('topology', 'torusSection', 1.5, 0, 0, params);
    near(v, 0.65, 1e-12);
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

  test('hydrogenS at r=0: |ψ|² is R₁₀(0)²·0.6, with no regulariser', () => {
    // Round 8 removed the r = sqrt(x²+z²) + 0.01 that used to stand here: the
    // radial factor is a polynomial times e^{−r} and θ comes from atan2, so
    // nothing in the helper was ever divided by r. This test asserted the
    // regulariser by name and so held it in place.
    // R₁₀(0) = 2, R² = 4; Y = cos(0) = 1; hydrogenPsi returns R²·Y²·0.6 = 2.4;
    // then · amp · 1.7 = 4.08.
    const expected = 4 * 0.6 * 1.7;
    near(evalAt('quantumMechanics', 'hydrogenS', 0, 0, 0), expected, 1e-13);
  });

  test('quantumZeno: P(T=0) = 1 (no decay yet)', () => {
    // T = (x+3.5)/7·4; at x=-3.5: T=0
    // cos(0)² ^N = 1; · amp · 0.5 · exp(0) = 0.5
    near(evalAt('quantumMechanics', 'quantumZeno', -3.5, 0, 0), 0.5, 1e-12);
  });

  test('feynmanPath carries the −π/4 of (1/i)^{1/2}', () => {
    // x=0: phase = 0 − π/4, so the value is cos(−π/4) = 1/√2 of what it was.
    // T = 0.5 + 0·0.05 = 0.5; · amp · 0.4 / sqrt(0.5) · exp(0).
    // Round 6 restored the factor: (1/i)^{1/2} = e^{−iπ/4}, so the real part of
    // the free propagator is cos(x²/2T − π/4), not cos(x²/2T). Forty-five
    // degrees moves every fringe — it changes the pattern, not its scale — and
    // this entry was rated "exact" without it.
    near(evalAt('quantumMechanics', 'feynmanPath', 0, 0, 0),
      Math.cos(-Math.PI / 4) * 0.4 / Math.sqrt(0.5), 1e-12);
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

  test('breatherSurface bounded |output| < 0.95', () => {
    // Round 6 replaced the ±0.6 clamp with `soften(0.45, 0.95)`: the clamp was
    // pinning 66.3 % of the mesh at the bound at the default sliders and 100 %
    // of it at the top of the range, so the entry drew a flat tabletop. The
    // bound asserted here is the ceiling of the fold, and it is a strict one —
    // tanh approaches it without reaching it (measured maximum 0.9455 over the
    // whole plate with both sliders at maximum under loud audio).
    for (const x of [-2, -1, 0, 1, 2]) {
      for (const z of [-2, 0, 2]) {
        const v = evalAt('topology', 'breatherSurface', x, z, 0);
        assert.ok(Math.abs(v) < 0.95, `Output ${v} exceeded the fold ceiling at (${x},${z})`);
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
      // Round 6 changed this profile on purpose: the logistic drawn here is not
      // a travelling-wave solution of Fisher–KPP at any speed, and it was
      // replaced by the Ablowitz–Zeppetella solution (1+e^{ξ√(r/6D)})⁻² at its
      // own speed 5√(rD/6). The value below is the new t = 0 baseline; the
      // assertion is unchanged and still pins it to 1e-12, which is what this
      // test is for — it guards the clock wrap, not the choice of profile.
      ['differentialEqs',  'fishersEquation',    0.5, 0, 0.0850867873741434],
      ['quantumMechanics', 'wavePacket',         0.7, 0, 0.187642285592130],
      // Round 6 restored the A² in the soliton's amplitude: an NLS soliton ties
      // height to width (peak A², width 1/A), and the code carried sech²(Aξ)
      // with no A², so the width rode `comp` and the height did not — the
      // relation that makes a soliton a soliton was cut. New t = 0 baseline;
      // the assertion is unchanged and still pins it to 1e-12.
      ['quantumMechanics', 'schrodingerSoliton', 0.5, 0, 0.335579517158249],
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

  test('gamma survives on the NEGATIVE axis too', () => {
    // Second pass: the log fallback was added to the n >= 0.5 branch only. The
    // reflection branch computes gamma(1-n) with the same Math.pow, and
    // pi/Infinity is 0 — so gamma(n) returned exactly zero for every n <~ -141.5,
    // where the value is comfortably representable.
    const lgPos = n => (n - 0.5) * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI)
      + 1 / (12 * n) - 1 / (360 * n ** 3) + 1 / (1260 * n ** 5) - 1 / (1680 * n ** 7);
    const ref = n => {
      const s = Math.sin(Math.PI * n);
      return Math.sign(s) * Math.exp(Math.log(Math.PI) - Math.log(Math.abs(s)) - lgPos(1 - n));
    };
    for (const n of [-141.5, -142.5, -150.5, -170.5]) {
      const got = gamma(n);
      assert.notEqual(got, 0, `gamma(${n}) collapsed to zero; true value is ${ref(n)}`);
      assert.ok(Math.abs((got - ref(n)) / ref(n)) < 1e-11,
        `gamma(${n}) = ${got} against ${ref(n)}`);
    }
    // The fallback reaches into the subnormals: gamma(-175.5) = 2.1e-319. Far
    // enough out it really does underflow, and zero is then the right answer —
    // compared with === rather than assert.equal, which is Object.is under
    // node:assert/strict and would reject the -0 that comes back here.
    assert.ok(gamma(-175.5) !== 0, 'the subnormal range is still reachable');
    assert.ok(gamma(-200.5) === 0, `gamma(-200.5) should underflow, got ${gamma(-200.5)}`);
  });

  test('control — gamma is unmoved where it always worked', () => {
    near(gamma(5), 24, 1e-12, 'gamma(5)');
    near(gamma(0.5), Math.sqrt(Math.PI), 1e-14, 'gamma(1/2)');
    near(gamma(-0.5), -3.5449077018110322, 1e-13, 'gamma(-1/2)');
    near(gamma(-2.5), -0.9453087204829419, 1e-14, 'gamma(-5/2)');
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

  test('control — feynmanPath at t = 0 is what the clock wrap left it', () => {
    // This guards the clock wrap, not the propagator: replayTime(0, 24) is 0,
    // so T is 0.5 exactly and t = 0 must be untouched by the folding. The
    // baseline moved once, in round 6, when the −π/4 of (1/i)^{1/2} was
    // restored — cos(−π/4)·amp·0.4/√0.5 — and the assertion is still pinned to
    // 1e-15.
    near(evalAt('quantumMechanics', 'feynmanPath', 0, 0, 0),
      Math.cos(-Math.PI / 4) * 0.4 / Math.sqrt(0.5), 1e-15);
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
    // FIX(r6): the window used to span 5.6 units, and every entry repaired by
    // folding the clock replays on a 24-unit period — so the guard sampled a
    // twentieth of the cycle and called it the whole. Worse, the uptimes it
    // checks are 864 and 6912, both exact multiples of 24, so for those entries
    // it re-measured t = 0 three times and could not fail by construction.
    // Twelve samples 2.617 apart span 28.8 units, more than one period, and the
    // step is deliberately not a divisor of it.
    //
    // FIX(r7): that widening fixes the zero-crossing case and NOT the one the
    // sentence above claims. The offset i·2.617 is added to every sample, so
    // for an entry that really is 24-periodic the window at t₀ = 864 samples
    // the same twelve phases as the window at t₀ = 0 and returns an identical
    // double — measured: six of the eight folded entries, feynmanPath among
    // them, give born === later bit for bit. What that costs is nothing, and
    // the honest statement is why: an entry that folds cannot drift, so a
    // guard that cannot fail on it hides nothing, and the failure it could
    // hide instead — dying inside the period — is what the sibling test below
    // measures. This guard's real job is the entry that does NOT fold, and
    // there the uptimes being multiples of 24 is irrelevant.
    const windowPeak = (colId, key, t0) => {
      let m = 0;
      for (let i = 0; i < 12; i++) m = Math.max(m, peakOf(colId, key, BOOT, t0 + i * 2.617, 25));
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

  test('an entry that replays its clock stays alive across the whole period', () => {
    // The entries this applies to are found by reading the kernels for
    // replayTime rather than by keeping a list — the list is what let
    // feynmanPath through a whole round. Within one period the quietest
    // instant must still be within an order of magnitude of the loudest, which
    // is the same convention the drift guard above uses between uptimes.
    const quiet = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        if (!/replayTime\s*\(/.test(entry.f.toString())) continue;
        let lo = Infinity, hi = 0, at = 0;
        for (let t = 0; t < 24; t += 0.25) {
          const p = peakOf(colId, key, BOOT, t, 21);
          if (p > hi) hi = p;
          if (p < lo) { lo = p; at = t; }
        }
        if (hi > 1e-9 && lo < hi * 0.1) {
          quiet.push(`${colId}/${key}: ${lo.toExponential(2)} at t=${at.toFixed(2)} against ${hi.toExponential(2)} in the same period`);
        }
      }
    }
    assert.deepEqual(quiet, [], `a replayed solution goes quiet inside its own period:\n  ${quiet.join('\n  ')}`);
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
      // Round 6 replaced the ±1.5 clamp with soften(1.2, 1.9): the clamp held
      // this bound by flattening 49.6 % of the mesh at the default slider and
      // 95.8 % at the maximum. 1.9 is the ceiling of the fold and is never
      // reached, and it is still well inside the camera half-frame of ~2.9.
      if (p >= 1.9) worst.push(`freq=${freq}: ${p.toExponential(2)}`);
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
  // FIX(r7): this used to end the branch at the first `}` followed by
  // `else`/`// FIX`/`return`. Mode 36 closes into a five-line comment, so the
  // `\s*` failed there and the match ran on through mode 37's body — the guard
  // below then read mode 37's uniforms and passed while mode 36 could stop
  // reading uBass entirely (verified by deleting its only `b` term: still
  // green). A branch ends where the next one begins, whatever sits between
  // them, and the extractor now proves it took only one.
  const branch = n => {
    const start = vs.indexOf(`mode==${n})`);
    assert.ok(start >= 0, `could not find branch mode==${n}`);
    const open = vs.indexOf('{', start);
    const rest = vs.slice(open + 1);
    const stop = rest.search(/else\s*(?:if\s*\(\s*mode\s*==|\{)|\n\s*return\b/);
    const src = stop >= 0 ? rest.slice(0, stop) : rest;
    assert.ok(!/mode\s*==/.test(src),
      `the extractor ran past the end of mode ${n} and into another branch`);
    return src;
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

  test('mode 11 keeps a floor when there is no treble, without gaining a ceiling', () => {
    // sin(fn*t*2.) with t = uTreble is exactly zero in silence, and this branch
    // had no (0.3 + b·.7)-style floor to fall back on: span 0.0 with no audio.
    // The offset has to sit OUTSIDE the harmonic index. Written as
    // sin(fn*(0.35+t*2.)) it phases all seven harmonics together and they add:
    // span went 2.046 → 3.290 loud and 3.070 → 4.935 with the sliders up,
    // against a camera half-frame of about 3.26. Written as sin(fn*t*2.+0.6) it
    // shifts each harmonic by the same amount and the ceiling stays put.
    const src = branch(11).replace(/\s/g, '');
    assert.ok(/t\*2\.\+0\.6/.test(src), 'mode 11 still vanishes when uTreble is zero');
    assert.ok(!/fn\*\(0?\.\d+\+t/.test(src),
      'the offset is inside the harmonic index again — that is what raised the peak out of frame');
  });
});

describe('Linear algebra — the three kernels that computed something else (#R6)', () => {
  const LA = MATH_COLLECTIONS.linearAlgebra.formulas;
  // Factory sliders in silence, which is where the viewer starts:
  // amp = ampSlider·(1+bass·0.5), freq = waveInt·(1+treble·0.3), comp = 0.5+mid·0.4.
  const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };
  const UNIT    = { amp: 1,   freq: 1, comp: 0.5 };

  // Share of a real 90×90 plate sitting at the extreme value. A clamp is
  // invisible to a peak assertion — it is the number a clamp fixes — so the
  // plateau has to be measured directly or a flat tabletop passes as a repair.
  const plateauShare = (fn, params, time = 0) => {
    const hf = generateSurfaceFromFormula(fn, params, 90, 3.5, time);
    let peak = 0;
    for (const v of hf) peak = Math.max(peak, Math.abs(v));
    if (peak === 0) return 1;
    let at = 0;
    for (const v of hf) if (Math.abs(Math.abs(v) - peak) < 1e-9) at++;
    return at / hf.length;
  };

  test('spectralRadius returns ρ(A), not the spread |λ₁ − λ₂|', () => {
    // x = 1, z = 0, t = 0, comp = 0.5 → A = [[1.5, 0], [0, −1]], a diagonal
    // matrix: λ = {1.5, −1}, so ρ = 1.5 and the height is 1.5·0.27 = 0.405.
    // The old kernel returned √|disc|·0.3 = √|(0.5)² + 6|·0.3 = 0.75, which the
    // 0.8 clamp then nearly hid.
    assert.ok(Math.abs(LA.spectralRadius.f(1, 0, 0, UNIT) - 0.405) < 1e-12,
      `expected 0.405 (ρ = 1.5), got ${LA.spectralRadius.f(1, 0, 0, UNIT)}`);

    // The complex branch needs its own point, because there ρ is not a root of
    // the real characteristic polynomial: x = 0, z = −1, t = π gives
    // tr = 0, det = 0.5, disc = −2, so λ = ±i/√2 and ρ = √det = √0.5.
    const want = Math.sqrt(0.5) * 0.27;
    assert.ok(Math.abs(LA.spectralRadius.f(0, -1, Math.PI, UNIT) - want) < 1e-12,
      `complex pair: expected ${want}, got ${LA.spectralRadius.f(0, -1, Math.PI, UNIT)}`);

    // ρ is a spectral radius: never negative, and never below the modulus of
    // either diagonal entry of a diagonal matrix.
    assert.ok(LA.spectralRadius.f(2.3, 0, 0, FACTORY) > 0, 'ρ must be non-negative');
  });

  test('spectralRadius no longer stands on a clamp for most of the plate', () => {
    // Measured before the fix: 57.8 % of the mesh at the default slider,
    // 97.8 % with both sliders at maximum under loud audio.
    assert.ok(plateauShare(LA.spectralRadius.f, FACTORY) < 0.05,
      `plateau at factory sliders is ${(plateauShare(LA.spectralRadius.f, FACTORY) * 100).toFixed(1)}%`);
    assert.ok(plateauShare(LA.spectralRadius.f, { amp: 2.25, freq: 4.55, comp: 0.9 }) < 0.05,
      'plateau at the slider maximum');
  });

  test('manifoldCurvature divides by the first fundamental form', () => {
    // F = (sin x + sin z)·0.45 at (0.6, −1.1), freq 1, comp 0.5. By hand:
    //   F_x = 0.45·cos(0.6) = 0.371417,  F_z = 0.45·cos(−1.1) = 0.204100
    //   F_xx = −0.45·sin(0.6) = −0.254088, F_zz = −0.45·sin(−1.1) = 0.401045
    //   K = F_xx·F_zz/(1 + F_x² + F_z²)² = −0.10190074/1.391460 = −0.07323280
    // times amp 0.7 and the display constant 6.0 → −0.30757774.
    // Without the denominator the same point gives −0.42798, i.e. 1.391× too
    // large — the shape, not just the scale, is wrong.
    const got = LA.manifoldCurvature.f(0.6, -1.1, 0, FACTORY);
    assert.ok(Math.abs(got - (-0.30757774)) < 5e-4,
      `expected ≈ −0.30757774 (exact K times the display constant), got ${got}`);
    // The tolerance is the h = 0.05 stencil error, not slack: tighten it to
    // 1e-6 and this still passes on the exact K while the numerator-only form
    // misses by 0.12 — two hundred times the tolerance.
  });

  test('manifoldCurvature is a visible surface, not a 1%-of-frame plate', () => {
    // The old display constant was calibrated against the numerator alone and
    // left the peak at 0.021 world units against a frame about 3 units high.
    const hf = generateSurfaceFromFormula(LA.manifoldCurvature.f, FACTORY, 90, 3.5, 0);
    let peak = 0;
    for (const v of hf) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.3 && peak < 1.5, `peak at factory sliders is ${peak}`);
  });

  test('eigenField vanishes exactly on the eigenvectors and nowhere else in bulk', () => {
    // A(t) = R(0.3t)·diag(1+comp, −1)·R(0.3t)ᵀ, so the eigenvectors are the
    // axes turned by θ = 0.3t. The height is (v × Av)/|v|, which is zero iff
    // Av ∥ v — the definition the label 'Av = λv' states.
    for (const t of [0, 2.7, 5 * Math.PI, 40]) {
      const th = t * 0.3, r = 2;
      const along = LA.eigenField.f(r * Math.cos(th), r * Math.sin(th), t, FACTORY);
      assert.ok(Math.abs(along) < 1e-12,
        `t=${t}: on the eigenvector the height should be 0, got ${along}`);
      // Halfway between the two eigenvectors the cross product is largest:
      // r·(λ₁−λ₂)/2·amp·0.23 = 2·1.25·0.7·0.23 = 0.4025, and it does not
      // depend on t — the pattern turns rigidly rather than breathing.
      const across = LA.eigenField.f(r * Math.cos(th + Math.PI / 4), r * Math.sin(th + Math.PI / 4), t, FACTORY);
      assert.ok(Math.abs(Math.abs(across) - 0.4025) < 1e-9,
        `t=${t}: expected 0.4025 midway between eigenvectors, got ${across}`);
    }
  });

  test('eigenField never goes flat, including at t = 5π where it used to die', () => {
    // The old matrix was exactly zero whenever cos(0.3t) and sin(0.4t) vanished
    // together — t = 5π + 10πk, once every 65 s of playback — and the whole
    // plate collapsed to 7.5e-17. Sampling two distant uptimes, as the round-4
    // test did, steps straight over a dip that narrow, so this walks the
    // neighbourhood of the known zero at the resolution the app renders at
    // (t advances 0.008 per frame).
    let worst = Infinity, worstT = 0;
    for (let t = 5 * Math.PI - 0.5; t <= 5 * Math.PI + 0.5; t += 0.008) {
      const hf = generateSurfaceFromFormula(LA.eigenField.f, FACTORY, 25, 3.5, t);
      let peak = 0;
      for (const v of hf) peak = Math.max(peak, Math.abs(v));
      if (peak < worst) { worst = peak; worstT = t; }
    }
    assert.ok(worst > 0.3, `eigenField collapses to ${worst} at t=${worstT}`);
  });
});

describe('Captions and counts, asked of the whole catalogue (#R6)', () => {
  // Four guards with no handwritten list in them. Each one exists because the
  // thing it checks drifted while a list of what to check stood right next to
  // it and stayed silent.

  test('no entry is named after a function its kernel never calls', () => {
    // The viewer reads the name. `sec / csc / cot Landscape` computed no
    // cotangent in any form; `Chebyshev via cos(n·arccos)` called no arccos and
    // formed no Chebyshev polynomial of the coordinate; `Arcsin / Arccos
    // Surface` drew arcsin alone. The formula string is deliberately NOT
    // scanned: it states identities, and an identity may legitimately name the
    // side that is not evaluated.
    const NAMED = {
      cot: /\bcot\b/i, arccos: /\barccos\b|\bacos\b/i, arcsin: /\barcsin\b|\basin\b/i,
      arctan: /\barctan\b|\batan\b/i, sec: /\bsec\b/i, csc: /\bcsc\b/i,
      tanh: /\btanh\b/i, sech: /\bsech\b/i,
    };
    // A reciprocal is often taken of a local rather than of the call itself
    // (`const c = Math.cos(u); … 1/c`), so sec/csc/sech are recognised as
    // "the base function is called AND something is inverted", not by a
    // literal `1/Math.cos`. The rule stays strict where it matters: an entry
    // that names cot without computing a tangent or a cos/sin ratio anywhere,
    // or names arccos without calling one, is still caught.
    const has = (src, re) => re.test(src);
    const CALLED = {
      // FIX(r7): the fallback here used to be "calls cos AND calls sin AND
      // contains a slash", which 34 of the 192 kernels satisfy — including
      // trigonometry/circularFunctions, the very kernel this rule was written
      // about. Putting its old name back left the guard green, so the rule
      // could not fail on the caption it exists to protect. A cotangent is a
      // tangent inverted or a cos/sin ratio written out; nothing else is.
      cot: src => has(src, /\bcot\s*\(|Math\.tan\s*\(/) ||
                  has(src, /Math\.cos\s*\([^;]{0,80}\)\s*\/\s*Math\.sin\s*\(/),
      arccos: src => has(src, /Math\.acos\s*\(/),
      arcsin: src => has(src, /Math\.asin\s*\(/),
      arctan: src => has(src, /Math\.atan2?\s*\(/),
      sec: src => has(src, /Math\.cos\s*\(/) && has(src, /1\s*\//),
      csc: src => has(src, /Math\.sin\s*\(/) && has(src, /1\s*\//),
      tanh: src => has(src, /Math\.tanh\s*\(/),
      sech: src => has(src, /Math\.cosh\s*\(/) && has(src, /1\s*\//),
    };
    const offenders = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        const src = entry.f.toString();
        for (const [fn, inName] of Object.entries(NAMED)) {
          if (inName.test(entry.name) && !CALLED[fn](src)) {
            offenders.push(`${colId}/${key} — the name says ${fn}, the kernel does not compute it`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], offenders.join('\n  '));

    // Control, and the reason the rule above was rewritten: the kernel this
    // round renamed must still be reported if the old name comes back. A guard
    // over a catalogue is only worth its runtime if it fails on the entry it
    // was written for, and this one did not.
    const cf = MATH_COLLECTIONS.trigonometry.formulas.circularFunctions;
    assert.ok(cf, 'trigonometry/circularFunctions is gone — this control needs rewriting');
    assert.ok(!CALLED.cot(cf.f.toString()),
      'the cot rule accepts a kernel that computes sec·csc, so the caption it renamed is unguarded');
  });

  test('anything captioned as a probability or a density is non-negative', () => {
    // `poisson` multiplied an exact PMF by (−1)^k for contrast, so 48.3 % of
    // the surface lay below zero under a caption reading P(k;λ) = λᵏe^{−λ}/k!.
    // Asked of every entry whose own caption makes the claim, so a new one
    // cannot arrive without being asked too.
    const CLAIMS = /\bPMF\b|\bPDF\b|probability|density|\|ψ.*\|²|\|ψ.*\|\^2/i;
    const offenders = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        if (!CLAIMS.test(`${entry.name} ${entry.formula}`)) continue;
        const hf = generateSurfaceFromFormula(entry.f, BASELINE, 60, 3.5, 0);
        let min = Infinity, peak = 0;
        for (const v of hf) { min = Math.min(min, v); peak = Math.max(peak, Math.abs(v)); }
        if (min < -1e-9 * Math.max(1, peak) && min < -0.01 * peak) {
          offenders.push(`${colId}/${key} reaches ${min.toPrecision(4)} against a peak of ${peak.toPrecision(4)}`);
        }
      }
    }
    assert.deepEqual(offenders, [], offenders.join('\n  '));
  });

  test('every tier header agrees with the rows under it, and with the summary', () => {
    // The §2 header read 11 A · 5 B while its own rows read 10 A · 6 B. The
    // counts are typed in fourteen places; nothing was comparing them.
    const doc = readFileSync(new URL('../MATHEMATICAL_ACCURACY.md', import.meta.url), 'utf8');
    const lines = doc.split('\n');
    const header = /^### (\d+)\. (.+?) \((\d+)\) — (\d+) A · (\d+) B · (\d+) C · (\d+) D$/;
    // The Name cell may contain an escaped pipe (\|ψ\|²), so the tier is read
    // by position from the end of the row rather than by splitting on '|'.
    const row = /^\| `[^`]+` \| .*? \| (🟢 A|🔵 B|🟡 C|🔴 D) \|/;
    let cur = null;
    const mismatches = [];
    let totA = 0, totB = 0, totC = 0;
    for (const line of lines) {
      const h = header.exec(line);
      if (h) {
        if (cur) mismatches.push(...check(cur));
        cur = { h, A: 0, B: 0, C: 0, D: 0 };
        continue;
      }
      if (cur && line.startsWith('## ')) { mismatches.push(...check(cur)); cur = null; continue; }
      if (!cur) continue;
      const r = row.exec(line);
      if (r) cur[r[1].split(' ')[1]]++;
    }
    if (cur) mismatches.push(...check(cur));
    function check(sec) {
      const [, num, , total, a, b, c, d] = sec.h;
      totA += sec.A; totB += sec.B; totC += sec.C;
      const out = [];
      if (+a !== sec.A || +b !== sec.B || +c !== sec.C || +d !== sec.D) {
        out.push(`§${num}: header says ${a}A/${b}B/${c}C/${d}D, its rows say ${sec.A}A/${sec.B}B/${sec.C}C/${sec.D}D`);
      }
      if (+total !== sec.A + sec.B + sec.C + sec.D) {
        out.push(`§${num}: header claims ${total} entries, ${sec.A + sec.B + sec.C + sec.D} rows`);
      }
      return out;
    }
    const sumA = /\| \*\*A\*\* — machine precision \| \*\*(\d+)\*\* \|/.exec(doc);
    const sumB = /\| \*\*B\*\* — bounded approximation \| \*\*(\d+)\*\* \|/.exec(doc);
    const sumC = /\| \*\*C\*\* — visualization-grade \| \*\*(\d+)\*\* \|/.exec(doc);
    assert.ok(sumA && sumB && sumC, 'the Executive Summary tier table is missing');
    if (+sumA[1] !== totA || +sumB[1] !== totB || +sumC[1] !== totC) {
      mismatches.push(`Executive Summary says ${sumA[1]}/${sumB[1]}/${sumC[1]}, the sections sum to ${totA}/${totB}/${totC}`);
    }
    assert.equal(totA + totB + totC, 192, `the sections describe ${totA + totB + totC} formulas, not 192`);

    // FIX(r7): the counts are also stated outside this document, and nothing
    // compared them — documents/index.md shipped 123/43/26 to the public
    // overview page while this file and README.md both read 128/40/24. Both
    // shapes the project uses to state them are read out of every markdown
    // file it ships, so a third copy in a fourth file is covered too.
    for (const rel of [...readdirSync(new URL('../', import.meta.url)).filter(n => n.endsWith('.md')).map(n => '../' + n),
                       ...readdirSync(new URL('../documents/', import.meta.url)).filter(n => n.endsWith('.md')).map(n => '../documents/' + n)]) {
      const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
      const table = [/\| 🟢 A \| (\d+) \|/, /\| 🔵 B \| (\d+) \|/, /\| 🟡 C \| (\d+) \|/].map(re => re.exec(text));
      const prose = [/(\d+) formulas use closed-form/, /(\d+) use bounded numerical/, /(\d+) are visualisation-grade/].map(re => re.exec(text));
      for (const [shape, got] of [['table', table], ['prose', prose]]) {
        if (!got[0] && !got[1] && !got[2]) continue;
        const said = got.map(m => (m ? +m[1] : null));
        if (said[0] !== totA || said[1] !== totB || said[2] !== totC) {
          mismatches.push(`${rel.replace('../', '')} (${shape}) says ${said.join('/')}, the catalogue is ${totA}/${totB}/${totC}`);
        }
      }
    }
    assert.deepEqual(mismatches, [], mismatches.join('\n  '));
  });

  test('no document states a test count', () => {
    // Four places in MATHEMATICAL_ACCURACY.md and one in roadmap.md said 184
    // while the file held 209, and the existing guard could not see them: it
    // only forbids a count on a line that also mentions `npm test`. A number
    // that has to be maintained by hand in five places will drift, so the fix
    // is to state none of them.
    // FIX(r7): the list was four filenames and a `catch { continue }`, in a
    // guard whose own describe block calls itself "four guards with no
    // handwritten list in them". documents/roadmap.md was in it and the other
    // documents were not, so a count could be written anywhere else and pass.
    // Every markdown file the project ships is asked instead, and a file that
    // cannot be read is a failure rather than a silent skip.
    const dir = rel => readdirSync(new URL(rel, import.meta.url))
      .filter(n => n.endsWith('.md')).map(n => rel + n);
    const files = [...dir('../'), ...dir('../documents/')];
    assert.ok(files.length >= 15, `only ${files.length} markdown files found — the walk is not reaching them`);
    const offenders = [];
    for (const rel of files) {
      const text0 = readFileSync(new URL(rel, import.meta.url), 'utf8');
      let text = text0;
      // Strip HTML comments first: a note explaining why a count must not be
      // written down is not itself a count. Line numbers are preserved by
      // replacing the comment body with blanks rather than removing it.
      text = text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
      text.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('//')) return;
        if (/\b\d{2,}\b[^.\n]{0,40}\btests?\b/i.test(line) || /\btests?\b[^.\n]{0,40}\b\d{2,}\b/i.test(line)) {
          offenders.push(`${rel.replace('../', '')}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `a test count will drift the moment a test is added:\n  ${offenders.join('\n  ')}`);
  });
});

describe('Attractors and states that were drawn as something simpler (#R6)', () => {
  const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };
  const FR = MATH_COLLECTIONS.fractals.formulas;

  // How much of a plate is explained by a plane. An ODE integrated for a
  // two-hundredth of one loop is indistinguishable from its own linearisation,
  // and that is exactly what these two entries were showing.
  const planeR2 = (fn, params) => {
    const g = 45, hf = generateSurfaceFromFormula(fn, params, g, 3.5, 0);
    let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0, n = 0;
    for (let zi = 0; zi < g; zi++) for (let xi = 0; xi < g; xi++) {
      const x = -3.5 + xi * 7 / (g - 1), z = -3.5 + zi * 7 / (g - 1), y = hf[zi * g + xi];
      sx += x; sz += z; sy += y; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * y; szy += z * y; n++;
    }
    // Solve the 3×3 normal equations for y = a·x + b·z + c.
    const A = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], B = [sxy, szy, sy];
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      [A[i], A[p]] = [A[p], A[i]]; [B[i], B[p]] = [B[p], B[i]];
      for (let k = i + 1; k < 3; k++) {
        const f = A[k][i] / A[i][i];
        for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j];
        B[k] -= f * B[i];
      }
    }
    const c = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      let s = B[i];
      for (let j = i + 1; j < 3; j++) s -= A[i][j] * c[j];
      c[i] = s / A[i][i];
    }
    const mean = sy / n;
    let ssRes = 0, ssTot = 0;
    for (let zi = 0; zi < g; zi++) for (let xi = 0; xi < g; xi++) {
      const x = -3.5 + xi * 7 / (g - 1), z = -3.5 + zi * 7 / (g - 1), y = hf[zi * g + xi];
      const p = c[0] * x + c[1] * z + c[2];
      ssRes += (y - p) ** 2; ssTot += (y - mean) ** 2;
    }
    return ssTot > 0 ? 1 - ssRes / ssTot : 1;
  };

  for (const key of ['rossler', 'chua']) {
    test(`${key} draws its attractor, not the tangent plane at one point`, () => {
      // Twelve Euler steps of dt = 0.003 is T = 0.036 — about a two-hundredth
      // of one loop from a starting point sitting on a mesh vertex. Measured
      // before the repair: least-squares plane R² = 1.000000 for rossler and
      // 0.999904 for chua, with peaks of 0.019 and 0.012 against a ~3-unit
      // frame, i.e. a tilted sheet at half a percent of the frame height.
      const r2 = planeR2(FR[key].f, FACTORY);
      assert.ok(r2 < 0.5, `${key} is still a plane: R² = ${r2.toFixed(6)}`);
      const hf = generateSurfaceFromFormula(FR[key].f, FACTORY, 90, 3.5, 0);
      let peak = 0;
      for (const v of hf) peak = Math.max(peak, Math.abs(v));
      assert.ok(peak > 0.3, `${key} peak is ${peak.toPrecision(4)} — invisible against the frame`);
    });
  }

  test('the dragon branch is the Heighway map, not its conjugate', () => {
    // f₂ = 1 − (1−i)w/2 is what the caption, this document and Heighway all
    // name; the code had 1 − (1+i)w/2, whose attractor is a different set —
    // centrally symmetric about z = 1/2, box x ∈ [−1/3, 4/3] against the
    // dragon's [−1/3, 7/6]. Against a dragon built with no IFS at all (the
    // paper-folding sequence) the Jaccard index goes 0.536 → 0.967.
    //
    // This is asserted on the source, not on a value: the two maps are complex
    // conjugates and the entry only ever reads |w|², so almost nothing the
    // entry returns separates them. Saying that plainly is better than an
    // assertion that looks numeric and is not.
    const src = readFileSync(new URL('../src/math-collections.js', import.meta.url), 'utf8');
    const from = src.indexOf('dragon: {');
    assert.ok(from > 0, 'the dragon entry is gone');
    const body = src.slice(from, src.indexOf('chua: {', from));
    assert.ok(body.length > 100, 'could not isolate the dragon entry');
    assert.ok(/nx\s*=\s*1\s*-\s*cosA\s*\*\s*px\s*-\s*sinA\s*\*\s*pz/.test(body),
      'the second contraction is not 1 − (1−i)w/2');
    assert.ok(!/nx\s*=\s*-\s*cosA\s*\*\s*px\s*\+\s*sinA\s*\*\s*pz\s*\+\s*1/.test(body),
      'the conjugate map is back');
  });

  test('harmonicOscillator normalisation stops the height jumping with the music', () => {
    // √(2ⁿn!√π) was replaced by the constant 0.003, and n = round(comp·6) is
    // driven by the mid band, so the surface changed height by ×74 across one
    // sweep of the slider. Restoring it stabilises rather than shrinks the
    // picture: max|ψ_n|² is 0.3456, 0.3288, 0.3163 for the reachable n.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.harmonicOscillator.f;
    let lo = Infinity, hi = 0;
    for (let comp = 0.5; comp <= 0.9001; comp += 0.02) {
      const hf = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp }, 90, 3.5, 0);
      let peak = 0;
      for (const v of hf) peak = Math.max(peak, Math.abs(v));
      lo = Math.min(lo, peak); hi = Math.max(hi, peak);
    }
    assert.ok(hi / lo < 1.25, `height still moves ×${(hi / lo).toFixed(1)} across the mid band`);
    assert.ok(hi > 0.5 && hi < 1.5, `peak ${hi.toPrecision(3)} is outside the frame-friendly range`);
  });

  test('tunneling decays through the barrier instead of growing into it', () => {
    // Inside the barrier the amplitude was e^{−κ|ξ|}·0.7 — a symmetric tent
    // with its maximum at the CENTRE — so on the entry half the wave grew by
    // ×2.718 where the exact scattering solution decays monotonically. The
    // transmitted intensity was 1.353e-1 against the 1.832e-2 = e^{−2κL} the
    // entry's own caption implies.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.tunneling.f;
    // The carrier is cos(freq²·4·x + t), which is known exactly, so the
    // envelope can be divided out rather than guessed at by windowing — a
    // window wide enough to catch a carrier maximum is also wide enough to
    // smooth over the growth being looked for.
    const carrier = x => Math.cos(FACTORY.freq * (x * FACTORY.freq) * 4);
    let prev = null, worst = 1, at = 0;
    for (let x = -1.2; x <= 1.2; x += 0.004) {
      const c = carrier(x);
      if (Math.abs(c) < 0.5) continue;                    // stay away from the nodes
      const e = Math.abs(f(x, 0, 0, FACTORY) / (c * 0.45 * FACTORY.amp));
      if (prev !== null && prev > 1e-9 && e / prev > worst) { worst = e / prev; at = x; }
      prev = e;
    }
    assert.ok(worst < 1.02, `the envelope grows by ×${worst.toFixed(4)} at x=${at.toFixed(3)}`);
  });
});

describe('Accuracy — entries that did not hold the tier they claimed (#R6)', () => {
  const BASE = { amp: 1, freq: 1, comp: 0.5 };

  test('inverseTrig is exact on the saturated rim, not 4e-4 below it', () => {
    // The argument was held off ±1 by 1e-6 and again by 1e-9, and asin(±1)
    // needs neither. At freq 1.5 the rim is 31.9 % of the row, and every point
    // on it sat 4.243e-4 world units low — on an entry rated A.
    const f = MATH_COLLECTIONS.trigonometry.formulas.inverseTrig.f;
    for (const freq of [1.5, 3, 4.55]) {
      for (const x of [-3.5, -3.0, 3.0, 3.5]) {
        const want = Math.asin(Math.max(-1, Math.min(1, x * freq * 0.28))) * 0.3;
        assert.ok(Math.abs(f(x, 0, 0, { amp: 1, freq }) - want) < 1e-15,
          `freq ${freq}, x ${x}: ${f(x, 0, 0, { amp: 1, freq })} vs ${want}`);
      }
    }
  });

  test('vectorField and jacobian are closed form, not a stencil', () => {
    // Central differences with h = 0.01 give 4–5 correct digits and degrade
    // with frequency: measured 3.3e-5 / 6.9e-4 for the curl and 9.1e-5 / 3.9e-2
    // for the Jacobian at the default slider and at the top of it. Both maps
    // are elementary, so there is nothing here to approximate.
    const LA = MATH_COLLECTIONS.linearAlgebra.formulas;
    for (const freq of [1, 2, 4.55]) {
      for (const [x, z] of [[0.4, -1.1], [-2.7, 2.2], [3.5, 0]]) {
        const curl = (Math.cos(x * freq) + Math.cos(z * freq)) * 0.25;
        assert.ok(Math.abs(LA.vectorField.f(x, z, 0, { amp: 1, freq }) - curl) < 1e-15,
          `curl at freq ${freq}, (${x}, ${z})`);
        // u = cos(f(x+z)), v = sin(1.3fx) + sin(1.9fz)/1.9 — the map the old
        // stencil was actually differentiating, kept as it was.
        const J = freq * freq * Math.sin(freq * (x + z)) *
          (1.3 * Math.cos(1.3 * freq * x) - Math.cos(1.9 * freq * z)) * 0.1;
        assert.ok(Math.abs(LA.jacobian.f(x, z, 0, { amp: 1, freq }) - J) < 1e-14,
          `jacobian at freq ${freq}, (${x}, ${z})`);
      }
    }
  });

  test('convolution integrates where the kernel is, not where it was', () => {
    // The window was fixed at τ ∈ [−2, 2] while the evaluation point runs to
    // x·freq = ±15.9, so for most of the plate the Gaussian sat entirely
    // outside the interval being summed: error 106 % of the peak at the
    // default slider, 259 % at freq 2.
    const f = MATH_COLLECTIONS.fourierSeries.formulas.convolution.f;
    const ref = (x, freq) => {
      const N = 4000, lo = x * freq - 8, hi = x * freq + 8, h = (hi - lo) / N;
      let s = 0;
      for (let i = 0; i < N; i++) {
        const tau = lo + (i + 0.5) * h;
        s += Math.sin(tau * freq * 3) * 0.5 * Math.exp(-((x * freq - tau) ** 2) * 4) * h;
      }
      return s;
    };
    for (const freq of [1, 2, 4.55]) {
      for (const x of [-3.2, -0.7, 1.4, 3.5]) {
        assert.ok(Math.abs(f(x, 0, 0, { amp: 1, freq }) / 0.4 - ref(x, freq)) < 1e-7,
          `freq ${freq}, x ${x}: ${f(x, 0, 0, { amp: 1, freq }) / 0.4} vs ${ref(x, freq)}`);
      }
    }
  });

  test('poissonIntegral reproduces the closed form it can be checked against', () => {
    // For boundary data cos(3φ + s) the Poisson integral is exactly
    // r³cos(3θ + s) — no quadrature needed for the reference. A trapezoid on N
    // nodes also picks up the modes N ± 3, weighted r^(N∓3); at N = 16 and
    // r = 0.95 that was a worst error of 1.52 on a quantity bounded by 1.
    const f = MATH_COLLECTIONS.integralTransforms.formulas.poissonIntegral.f;
    for (const [x, z] of [[0.5, 0.3], [-1.2, 1.7], [2.0, -0.4], [3.5, 3.5]]) {
      const r = Math.min(0.9, Math.hypot(x, z) * 0.4), theta = Math.atan2(z, x);
      const want = r ** 3 * Math.cos(3 * theta) * 0.35;
      assert.ok(Math.abs(f(x, z, 0, BASE) - want) < 1e-3,
        `(${x}, ${z}): ${f(x, z, 0, BASE)} vs ${want}`);
    }
  });

  test('stieltjesTransform integrates the tail instead of truncating it', () => {
    // ∫₀^∞ e^{−t}/(z+t)dt = e^z·E₁(z). The sum used to stop at t = 5 on a
    // midpoint rule with h = 0.25: worst error 1.6e-2 at z = 0.5, and the tier
    // bound failed at every reachable z. The substitution t = u/(1−u) carries
    // the whole half-line into [0, 1).
    const f = MATH_COLLECTIONS.integralTransforms.formulas.stieltjesTransform.f;
    const E1 = z => {                       // series, exact to double for z ≤ 5
      let s = -0.5772156649015329 - Math.log(z), term = 1;
      for (let k = 1; k <= 60; k++) { term *= -z / k; s -= term / k; }
      return s;
    };
    for (const zv of [0.5, 1, 2, 4.5]) {
      const x = 7 * (zv - 0.5) / 4 - 3.5;
      const want = Math.exp(zv) * E1(zv) * 0.4;
      assert.ok(Math.abs(f(x, 0, 0, BASE) - want) < 1e-4,
        `z=${zv}: ${f(x, 0, 0, BASE)} vs ${want}`);
    }
  });

  test('continuousWavelet resolves the scale it is drawing', () => {
    // Twenty samples with step 0.3 cannot see a wavelet of width 0.1 — its
    // oscillation has period 0.126 in τ — and at the wide end the same fixed
    // window cut the wavelet off. Errors measured 0.39 and 0.62 on a quantity
    // of order 1. Integrating in ξ makes the window follow the scale.
    const f = MATH_COLLECTIONS.integralTransforms.formulas.continuousWavelet.f;
    const ref = (b, a, comp) => {
      const N = 20000, lo = b - 12 * a, hi = b + 12 * a, h = (hi - lo) / N;
      let v = 0;
      for (let i = 0; i < N; i++) {
        const tau = lo + (i + 0.5) * h, xi = (tau - b) / a;
        v += Math.sin(tau * (2 + comp) * 2) * Math.exp(-xi * xi / 2) * Math.cos(5 * xi) * h;
      }
      return v / Math.sqrt(a);
    };
    for (const zc of [-3.5, -1.2, 1.0, 3.5]) {
      const a = 0.1 + Math.max(0, Math.min(1, (zc + 3.5) / 7)) * 2;
      for (const x of [-2, 0.4, 1.8]) {
        // z enters only through the scale, so compare at the same z.
        const got = f(x, zc, 0, BASE) / 0.15;
        assert.ok(Math.abs(got - ref(x, a, 0.5)) < 1e-4,
          `scale ${a.toFixed(2)}, b=${x}: ${got} vs ${ref(x, a, 0.5)}`);
      }
    }
  });
});

describe('Fourier waveforms — the clock is a shift, not a common phase (#R6)', () => {
  const FS = MATH_COLLECTIONS.fourierSeries.formulas;
  const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };

  // Adding t to every harmonic alike turns Σ sin((2k−1)u + t) into
  // cos(t)·(the series) + sin(t)·(its conjugate), so the surface rotates into
  // the Hilbert transform of the waveform it is named after. Putting t inside
  // the index makes the sum a rigid translation — which is an identity, not an
  // approximation, and so can be asserted exactly.
  for (const key of ['squareWave', 'sawtoothWave', 'triangleWave', 'pulseWave']) {
    test(`${key} is the same waveform at every instant, only moved`, () => {
      for (const t of [0.3, 1.0, Math.PI / 2, 2.4, 5.0]) {
        for (let i = 0; i < 60; i++) {
          const x = -3.5 + 7 * i / 59;
          const here  = FS[key].f(x, 0.4, t, FACTORY);
          const there = FS[key].f(x + t / (2 * FACTORY.freq), 0.4, 0, FACTORY);
          assert.ok(Math.abs(here - there) < 1e-12,
            `${key} at x=${x.toFixed(3)}, t=${t}: ${here} ≠ ${there} — the surface is not a translate of itself`);
        }
      }
    });
  }

  test('the family stops breathing: the peak is steady across a full cycle', () => {
    // Measured before the fix, as the ratio of the largest to the smallest peak
    // over one 2π cycle: square 2.179, sawtooth 1.624, pulse 1.556,
    // triangle 1.315. A travelling wave has no reason to change height at all.
    for (const key of ['squareWave', 'sawtoothWave', 'triangleWave', 'pulseWave']) {
      let lo = Infinity, hi = 0;
      for (let t = 0; t < 2 * Math.PI; t += 0.05) {
        let peak = 0;
        for (let i = 0; i < 200; i++) peak = Math.max(peak, Math.abs(FS[key].f(-3.5 + 7 * i / 199, 0, t, FACTORY)));
        lo = Math.min(lo, peak); hi = Math.max(hi, peak);
      }
      assert.ok(hi / lo < 1.02, `${key} peak swings ×${(hi / lo).toFixed(3)} over a cycle`);
    }
  });
});

describe('Cellular automata — exact rules fed an input they cannot work on (#R6)', () => {
  const CA = MATH_COLLECTIONS.cellularAutomata.formulas;
  const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };

  const raisedShare = (fn, params, time) => {
    const hf = generateSurfaceFromFormula(fn, params, 90, 3.5, time);
    let n = 0;
    for (const v of hf) if (Math.abs(v) > 1e-6) n++;
    return n / hf.length;
  };

  test('Game of Life is seeded with a soup, not a lattice', () => {
    // The seed was `(i·2654435761) >>> 0 % 100 < density` — a Weyl sequence,
    // equidistributed rather than independent, so nearly every live cell was
    // isolated and generation 1 killed 97 % of the population. At t = 1.5
    // (generation 2 at the default complexity) the plate measured a peak of
    // exactly zero. Life on a real soup at this density settles around 5 %.
    for (const t of [1.5, 4.0, 9.0]) {
      const share = raisedShare(CA.gameOfLifeDensity.f, FACTORY, t);
      assert.ok(share > 0.02, `t=${t}: only ${(share * 100).toFixed(2)}% of the plate is alive`);
    }
  });

  test('cyclic CA is not vertical stripes', () => {
    // `(i·2246822519) >>> 0 % N` is degenerate when N divides a power of two:
    // the state depends on the column alone, so the variance down every column
    // was exactly 0. N = 4 + round(comp·4), so comp 0 and comp 1 are the two
    // powers of two in range and the two cases that were broken.
    for (const comp of [0, 1]) {
      const hf = generateSurfaceFromFormula(CA.cyclicCA.f, { amp: 0.7, freq: 1, comp }, 90, 3.5, 6);
      let uniformCols = 0;
      for (let c = 0; c < 90; c++) {
        const first = hf[c];
        let same = true;
        for (let r = 1; r < 90; r++) if (Math.abs(hf[r * 90 + c] - first) > 1e-9) { same = false; break; }
        if (same) uniformCols++;
      }
      assert.ok(uniformCols < 9,
        `comp=${comp} (N=${4 + Math.round(comp * 4)}): ${uniformCols} of 90 columns are a single flat value`);
    }
  });

  test('the turmite uses both of its states and keeps building', () => {
    // Both state-0 rows of the old table wrote state 0, so the state-1 rows
    // were unreachable: a one-state ant with period 8, leaving 4 raised cells
    // out of 3136 — 0.13 % of the plate. The replacement is the rule that
    // survived a search over all 65 536 rules of the family, and it is still
    // growing at the end of its run rather than closing into a cycle.
    const low  = raisedShare(CA.turmite.f, { amp: 0.7, freq: 1, comp: 0 }, 0);
    const high = raisedShare(CA.turmite.f, { amp: 0.7, freq: 1, comp: 1 }, 0);
    assert.ok(low > 0.10, `at minimum complexity only ${(low * 100).toFixed(2)}% of the plate is raised`);
    // The complexity slider drives the step count, so it has to be visible.
    assert.ok(high > low * 1.3,
      `complexity does not change the structure: ${(low * 100).toFixed(1)}% → ${(high * 100).toFixed(1)}%`);
  });
});

describe('Singularities — the peak must not depend on where the mesh samples (#R6)', () => {
  // The display grid is not a constant: math-visualizer derives it from the
  // plane geometry, which the renderer sizes by GPU capability — 60 on a
  // phone, 200 on a desktop. An entry with a pole inside the drawn region has
  // its peak set by whichever vertex lands nearest the pole, so the same
  // formula at the same settings is a different picture on different hardware,
  // and no assertion on a single grid can see it. Measured before the repairs:
  // doubleSlitProbability ×1926, cauchyIntegral ×27.3, windingNumber ×12.8,
  // zTransform ×10.6 across grids 25…400.
  const GRIDS = [25, 49, 90, 161];
  const peakAt = (fn, params, grid, time = 0) => {
    const hf = generateSurfaceFromFormula(fn, params, grid, 3.5, time);
    let p = 0;
    for (const v of hf) p = Math.max(p, Math.abs(v));
    return p;
  };
  const spread = (fn, params, time = 0) => {
    const ps = GRIDS.map(g => peakAt(fn, params, g, time));
    return { ratio: Math.max(...ps) / Math.min(...ps), ps };
  };
  const BASE = { amp: 1, freq: 1, comp: 0.5 };

  for (const [collection, key] of [
    ['quantumMechanics',   'doubleSlitProbability'],
    ['integralTransforms', 'cauchyIntegral'],
    ['integralTransforms', 'zTransform'],
    ['complexNumbers',     'windingNumber'],
  ]) {
    test(`${key} draws the same surface at every mesh density`, () => {
      const { ratio, ps } = spread(MATH_COLLECTIONS[collection].formulas[key].f, BASE);
      assert.ok(ratio < 1.05,
        `${key} peak varies ×${ratio.toFixed(1)} across grids ${GRIDS.join('/')}: ${ps.map(v => v.toPrecision(4)).join(', ')}`);
    });
  }

  test('cauchyIntegral is now Cauchy’s formula exactly, inside and outside', () => {
    // Singularity subtraction leaves no quadrature error at all for f = z² + c:
    // the regular integrand is the polynomial z + z₀ and integrates to zero
    // around a closed contour, so what remains is the analytic term.
    const f = MATH_COLLECTIONS.integralTransforms.formulas.cauchyIntegral.f;
    for (const [x, z] of [[1, 0], [0.5, 0.3], [-3.5, 0], [2.0, -1.2]]) {
      const z0re = x * 0.5, z0im = z * 0.5;
      const inside = Math.hypot(z0re, z0im) < 2;
      const want = (inside ? z0re * z0re - z0im * z0im + 0.15 : 0) * 0.4;
      assert.ok(Math.abs(f(x, z, 0, BASE) - want) < 1e-12,
        `z₀=(${z0re}, ${z0im}) ${inside ? 'inside' : 'outside'}: got ${f(x, z, 0, BASE)}, expected ${want}`);
    }
  });

  test('windingNumber returns the integer it is defined to be', () => {
    // n_loops = round(1 + comp·3) = 3 at comp 0.5. Summing argument increments
    // gives the integer to round-off; integrating 1/(z−z₀) on 12–16 nodes per
    // loop did not, and carried a ring of spurious poles at |z₀| = 1.
    const f = MATH_COLLECTIONS.complexNumbers.formulas.windingNumber.f;
    for (const [x, z, want] of [[0, 0, 3], [0.8, 0.6, 3], [-3.5, 3.5, 0], [6, 0, 0]]) {
      assert.ok(Math.abs(f(x, z, 0, BASE) / 0.18 - want) < 1e-9,
        `(${x}, ${z}): expected winding ${want}, got ${f(x, z, 0, BASE) / 0.18}`);
    }
  });

  test('doubleSlit draws the interference its caption states, bounded', () => {
    // |ψ₁+ψ₂|² = 2I₀(1 + cos δ) is the equal-amplitude statement. The 1/r
    // factors the code carried are a near-field detail the caption never
    // claimed, and both sources sit inside the plate, so they were poles.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.doubleSlitProbability.f;
    let peak = 0, trough = Infinity;
    for (let i = 0; i < 500; i++) {
      const v = f(-3.5 + 7 * i / 499, 1.3, 0, BASE);
      peak = Math.max(peak, v); trough = Math.min(trough, v);
    }
    assert.ok(peak <= 1 + 1e-12, `intensity exceeds its own maximum: ${peak}`);
    assert.ok(peak > 0.99, `no bright fringe on the line z = 1.3: peak ${peak}`);
    // Fringe visibility (I_max − I_min)/(I_max + I_min). Two waves of equal
    // amplitude interfere with visibility 1; the true minima are exactly zero,
    // and the shortfall here is only that 500 samples do not land on one.
    const visibility = (peak - trough) / (peak + trough);
    assert.ok(visibility > 0.99, `fringes have no contrast: visibility ${visibility}`);
    // On the perpendicular bisector the paths are equal, so it is always bright.
    for (const z of [0.4, 1.1, 2.7, -3.0]) {
      assert.ok(Math.abs(f(0, z, 0, BASE) - 1) < 1e-12,
        `central fringe at (0, ${z}) is ${f(0, z, 0, BASE)}, not the maximum`);
    }
  });

  test('no entry in the catalogue has a pole inside the drawn region', () => {
    // Asked of all 192 rather than of a list. Every handwritten list in this
    // project has eventually missed the thing it was written for — the drifting
    // formulas, the entries that leave the frame — because a list records what
    // was known when it was typed.
    //
    // What is being detected is unboundedness, not merely mesh sensitivity: a
    // chaotic map sampled on a lattice moves its peak around too (tinkerbell
    // varies ×17 across grids), but it is bounded by its own escape guard and
    // settles. A pole does not settle — refine around the worst point and the
    // value keeps climbing. Measured on the pre-round-6 code this separates the
    // two cleanly: doubleSlitProbability ×790 per refinement, zTransform ×59,
    // windingNumber ×20, cauchyIntegral ×15, complexLog ×7.2, and no false
    // positive anywhere in the other 187.
    const offenders = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        const f = entry.f;
        // Worst vertex on the display mesh, then four rounds of local refinement.
        const g = 90, s = 7 / (g - 1);
        let best = 0, bx = 0, bz = 0;
        for (let zi = 0; zi < g; zi++) for (let xi = 0; xi < g; xi++) {
          const x = -3.5 + xi * s, z = -3.5 + zi * s;
          let y = 0;
          try { y = f(x, z, 0, BASELINE); } catch { /* the app swallows these too */ }
          if (Number.isFinite(y) && Math.abs(y) > best) { best = Math.abs(y); bx = x; bz = z; }
        }
        let prev = best, half = s, growth = 1;
        for (let round = 0; round < 4; round++) {
          let m = 0, mx = bx, mz = bz;
          const n = 41, step = 2 * half / (n - 1);
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const x = bx - half + i * step, z = bz - half + j * step;
            let y = 0;
            try { y = f(x, z, 0, BASELINE); } catch { /* ditto */ }
            if (Number.isFinite(y) && Math.abs(y) > m) { m = Math.abs(y); mx = x; mz = z; }
          }
          if (prev > 0) growth = Math.max(growth, m / prev);
          prev = m; bx = mx; bz = mz; half = step * 2;
        }
        if (growth > 2) offenders.push(`${colId}/${key} grows ×${growth.toFixed(1)} per refinement`);
      }
    }
    assert.deepEqual(offenders, [],
      `unbounded inside the drawn region, so the picture differs per GPU:\n  ${offenders.join('\n  ')}`);
  });

  test('no entry leaves the frame at the factory sliders', () => {
    // Factory means the sliders as they boot, in silence: amp 0.7, freq 1.0,
    // comp 0.5. The suite deliberately exempts the top of the slider range —
    // that over-drive is the operator's to ask for — but nothing should leave
    // the frame before the operator has touched anything. Round 5 measured the
    // camera half-frame at 2.90–3.25 world units; 3.0 is the conservative end.
    const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };
    const offenders = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        const hf = generateSurfaceFromFormula(entry.f, FACTORY, 90, 3.5, 0);
        let p = 0;
        for (const v of hf) p = Math.max(p, Math.abs(v));
        if (p > 3.0) offenders.push(`${colId}/${key} peak ${p.toPrecision(4)}`);
      }
    }
    assert.deepEqual(offenders, [], `out of frame before the operator touched anything:\n  ${offenders.join('\n  ')}`);
  });

  test('no continuous surface is mostly a flat tabletop', () => {
    // The failure mode a clamp creates, and the one no peak assertion can see:
    // the peak is exactly what a clamp fixes. Discrete-valued entries — the
    // escape-time fractals, the cellular automata, a winding number — are
    // supposed to repeat one value over large areas, and they are told apart
    // here by how many distinct values they take rather than by being listed.
    const offenders = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        const hf = generateSurfaceFromFormula(entry.f, { amp: 0.7, freq: 1, comp: 0.5 }, 90, 3.5, 0);
        let peak = 0;
        for (const v of hf) peak = Math.max(peak, Math.abs(v));
        if (peak === 0) continue;
        let atPeak = 0;
        const seen = new Set();
        for (const v of hf) {
          if (Math.abs(Math.abs(v) - peak) < 1e-9) atPeak++;
          if (seen.size <= 50) seen.add(v.toFixed(9));
        }
        if (seen.size <= 50) continue;              // genuinely discrete-valued
        const share = atPeak / hf.length;
        if (share > 0.35) offenders.push(`${colId}/${key} ${(share * 100).toFixed(1)}% at |y|=${peak.toPrecision(4)}`);
      }
    }
    assert.deepEqual(offenders, [],
      `a clamp is standing in for the surface:\n  ${offenders.join('\n  ')}`);
  });

  test('fishersEquation draws a solution of the equation in its own caption', () => {
    // The strongest test available for a PDE entry: put the drawn profile back
    // into ∂u/∂t = D u_xx + r u(1−u) as a travelling wave u = U(ξ), ξ = x − ct,
    // and measure the residual −cU′ − DU″ − rU(1−U). The logistic drawn before
    // round 6 leaves 1.29 at the speed the code claimed and 0.48 at the best
    // speed any logistic could have — it is not a solution at all. The
    // Ablowitz–Zeppetella profile leaves 6e-8, which is the finite-difference
    // error of the check itself.
    const f = MATH_COLLECTIONS.differentialEqs.formulas.fishersEquation.f;
    const D = 0.5, comp = 0.5, r = 1 + comp;
    const c = 5 * Math.sqrt(r * D / 6);
    // Read the profile straight off the surface along z = 0, where the
    // Gaussian envelope is 1, and undo the display constant.
    const U = xi => f(xi, 0, 0, { amp: 1, freq: 1, comp }) / 0.5;
    const h = 1e-4;
    let worst = 0;
    for (let xi = -3; xi <= 3; xi += 0.1) {
      const u0 = U(xi), up = U(xi + h), um = U(xi - h);
      const d1 = (up - um) / (2 * h), d2 = (up - 2 * u0 + um) / (h * h);
      worst = Math.max(worst, Math.abs(-c * d1 - D * d2 - r * u0 * (1 - u0)));
    }
    assert.ok(worst < 1e-5, `the drawn front is not a solution: residual ${worst}`);
  });

  test('juliaPotential draws the Green’s function, not its logarithm', () => {
    // G(z) = lim log|fⁿ(z)|/2ⁿ. Dropping the 2⁻ⁿ leaves log₂(log|z_n|), which
    // is the logarithm of the potential plus the escape index — a different
    // surface, and off by up to 2.158 on a range whose maximum is 1.612.
    // The oracle here runs the same limit far past the entry's twelve
    // iterations, to an escape radius of 10⁵⁰, and is therefore converged.
    const f = MATH_COLLECTIONS.complexNumbers.formulas.juliaPotential.f;
    const green = (zx0, zy0, cr, ci) => {
      let zx = zx0, zy = zy0;
      for (let n = 0; n < 200; n++) {
        const r2 = zx * zx + zy * zy;
        if (!Number.isFinite(r2)) return null;
        if (r2 > 1e100) return Math.log(Math.sqrt(r2)) / Math.pow(2, n);
        const nx = zx * zx - zy * zy + cr; zy = 2 * zx * zy + ci; zx = nx;
      }
      return 0;
    };
    let worst = 0, checked = 0;
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
      const x = -3.5 + 7 * i / 39, z = -3.5 + 7 * j / 39;
      const g = green(x, z, -0.4, 0.6);
      if (g === null || g <= 0) continue;
      checked++;
      worst = Math.max(worst, Math.abs(f(x, z, 0, { amp: 1, freq: 1, comp: 0 }) / 0.55 - g));
    }
    assert.ok(checked > 500, `only ${checked} escaping points were checked`);
    assert.ok(worst < 5e-3, `worst deviation from G(z) is ${worst} over ${checked} points`);
  });

  test('ornsteinUhlenbeck draws a path with noise in it', () => {
    // The old seed advanced ~8 per vertex out of a 65536 period read through
    // &0xffff, so every vertex on the row was driven by the same twenty
    // increments and what varied along it was the initial condition relaxing
    // smoothly. Total variation over span is 1 for a monotone curve; the old
    // row measured 1.09, which is the signature of no noise at all.
    const f = MATH_COLLECTIONS.probability.formulas.ornsteinUhlenbeck.f;
    const row = [];
    for (let i = 0; i < 90; i++) row.push(f(-3.5 + 7 * i / 89, 0, 0, { amp: 1, freq: 1, comp: 0.5 }));
    let tv = 0;
    for (let i = 1; i < row.length; i++) tv += Math.abs(row[i] - row[i - 1]);
    const span = Math.max(...row) - Math.min(...row);
    assert.ok(tv / span > 4, `the row is smooth, not a sample path: total variation over span ${(tv / span).toFixed(2)}`);
    // And it is still an OU path: mean-reverting, so it stays bounded rather
    // than wandering like a random walk.
    assert.ok(span < 1, `the path is not mean-reverting: span ${span}`);
  });

  test('zTransform is drawn only where it converges', () => {
    // Z{aⁿ}(z) = z/(z−a) is the sum of Σaⁿz⁻ⁿ, which exists for |z| > a. The
    // plate used to start at Re z = 0.5 while a reaches 0.9, so part of the
    // picture stood outside the region of convergence and straddled the pole.
    const f = MATH_COLLECTIONS.integralTransforms.formulas.zTransform.f;
    for (const comp of [0, 0.5, 1]) {
      const a = 0.7 + comp * 0.2;
      // FIX(r7): this used to read `const zrMin = a + 0.2; assert.ok(zrMin > a)`,
      // which is `a + 0.2 > a` — true for every finite a, and it never touched
      // the kernel. The distance to the pole has to be read off the surface the
      // kernel actually draws, so a mapping that walked back onto the pole would
      // be caught. |z − a| is bounded below by the real part alone, and the
      // closest approach is the left edge of the plate at every freq, so a
      // vertex-by-vertex minimum over a real plate is the honest measurement.
      let closest = Infinity;
      for (const freq of [1, 2, 4.55]) {
        for (let i = 0; i < 90; i++) {
          const x = -3.5 + i * 7 / 89;
          for (let j = 0; j < 90; j++) {
            const zz = -3.5 + j * 7 / 89;
            const zr = a + 0.2 + (x + 3.5) / 7 * 2.5, zi = zz * freq * 0.4;
            closest = Math.min(closest, Math.hypot(zr - a, zi));
          }
        }
      }
      assert.ok(closest > 0.15,
        `comp=${comp}: the plate reaches within ${closest.toFixed(3)} of the pole at z = a`);
      const { ratio } = spread(f, { amp: 1, freq: 1, comp });
      assert.ok(ratio < 1.05, `comp=${comp}: peak varies ×${ratio.toFixed(2)} with mesh density`);
    }
  });
});

describe('Round 7 — repairs that cost more than they bought (#R7)', () => {
  // The audio the app feeds itself with nothing playing: audio.js drives three
  // LFOs at 0.7, 0.9 and 1.1 rad/s and main.js advances the formula clock by
  // 0.008 per rendered frame. So "silence" is not a constant — every parameter
  // is moving, always, and a kernel that cannot take a small parameter step
  // flickers on an idle machine.
  const idleFrame = k => {
    const time = k * 0.008;
    const bass = 0.2 + Math.sin(time * 0.7) * 0.1;
    const mid = 0.2 + Math.sin(time * 0.9) * 0.09;
    const treble = 0.15 + Math.cos(time * 1.1) * 0.08;
    return { time, params: { amp: 0.7 * (1 + bass * 0.5), freq: 1 + treble * 0.3, comp: 0.5 + mid * 0.4 } };
  };
  const relChange = (a, b) => {
    let num = 0, den = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; num += d * d; den += a[i] * a[i]; }
    return den > 1e-24 ? Math.sqrt(num / den) : 0;
  };

  test('no cached simulation redraws itself from scratch between frames', () => {
    // The entries drawn through createCachedHeavySampler are selected by what
    // they are rather than by name: their kernel is the wrapper, so the wrapper's
    // own identifiers appear in every one of them and in nothing else. Thirteen
    // today; a fourteenth is covered the day it is added.
    //
    // A rebuild is meant to advance a simulation, not to draw a new one. rossler
    // fed `comp` into the chaotic parameter c = 5.7 + comp, and this cache
    // rebuilds about every third frame, so every rebuild integrated thousands of
    // RK4 steps under a c that had moved and came back with a different sample
    // of the same attractor: 75.4 % of the plate's own norm between consecutive
    // frames, with nothing playing. The measurement has to be the WORST step and
    // not the median — two frames in three change nothing at all, so the median
    // is 0.00 % for a plate that is flashing.
    //
    // 25 % sits between the two populations with room on both sides: the worst
    // legitimate mover is Langton's Ant at 11.7 % (a discrete ant that really
    // does jump), and the defect measured 75.4 %.
    const offenders = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        if (!/cachedGrid|sampleGrid/.test(entry.f.toString())) continue;
        let prev = null, worst = 0;
        for (let k = 0; k < 24; k++) {
          const { time, params } = idleFrame(k);
          const cur = generateSurfaceFromFormula(entry.f, params, 41, 3.5, time);
          if (prev) worst = Math.max(worst, relChange(prev, cur));
          prev = cur;
        }
        if (worst > 0.25) offenders.push(`${colId}/${key} changes by ${(worst * 100).toFixed(1)} % between frames`);
      }
    }
    assert.deepEqual(offenders, [], `a cached simulation is resampling, not evolving:\n  ${offenders.join('\n  ')}`);
  });

  test('ornsteinUhlenbeck keeps the whole path on screen above the factory wave intensity', () => {
    // The domain map scaled x by freq and left the recentring offset alone, so
    // above freq = 1 both ends of every row ran off the path and were held by
    // the clamp — and the left one returned a literal zero, the loop never
    // having been entered. Share of a plate sitting at its own row's edge
    // value: 0.022 at freq 1 (which is the metric's floor — the edge columns
    // are two of ninety), then 0.178, 0.356 and 0.511 at freq 1.2, 1.5 and 2.
    const f = MATH_COLLECTIONS.probability.formulas.ornsteinUhlenbeck.f;
    const edgeShare = freq => {
      const g = 90, hf = generateSurfaceFromFormula(f, { amp: 0.7, freq, comp: 0.5 }, g, 3.5, 0);
      let pinned = 0;
      for (let zi = 0; zi < g; zi++) {
        const row = hf.subarray(zi * g, (zi + 1) * g);
        const l = row[0], r = row[g - 1];
        for (const v of row) if (v === l || v === r) pinned++;
      }
      return pinned / hf.length;
    };
    for (const freq of [1, 1.2, 1.5, 2, 4.55]) {
      const share = edgeShare(freq);
      assert.ok(share < 0.05,
        `freq ${freq}: ${(share * 100).toFixed(1)} % of the plate is pinned to the edge of the path`);
    }
  });

  test('ornsteinUhlenbeck is a pure function of position, memoised or not', () => {
    // The path moved out of the kernel into a one-slot cache, so the thing that
    // has to be proved is that nothing changed but the arithmetic's location:
    // the same vertex under the same parameters must give the same value after
    // an intervening call with different parameters has evicted the slot.
    const f = MATH_COLLECTIONS.probability.formulas.ornsteinUhlenbeck.f;
    const at = (x, params) => f(x, 0.25, 0, params);
    const A = { amp: 0.7, freq: 1, comp: 0.5 }, B = { amp: 0.7, freq: 1.7, comp: 0.9 };
    const first = [-2, -0.5, 0.3, 2.8].map(x => at(x, A));
    [-2, 0, 1].forEach(x => at(x, B));
    const again = [-2, -0.5, 0.3, 2.8].map(x => at(x, A));
    assert.deepEqual(again, first, 'the memoised path is not reproducing its own values');
  });

  test('randomWalk keeps the size its own note promises', () => {
    // "the same LCG and step size are kept so the surface stays the same size it
    // was" — it did not: one walk of 410 steps travels further than the 16 the
    // per-vertex seed accumulated, and the 0.12 that was supposed to pay that
    // back left the peak 3.820× small at every t and every slider.
    const f = MATH_COLLECTIONS.probability.formulas.randomWalk.f;
    for (const [time, want] of [[0, 0.2959], [0.7, 0.3082], [3.1, 0.3433]]) {
      const hf = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, 90, 3.5, time);
      let peak = 0;
      for (const v of hf) peak = Math.max(peak, Math.abs(v));
      assert.ok(Math.abs(peak - want) / want < 0.01,
        `t=${time}: peak ${peak.toFixed(4)} against the ${want} it had before the walk was rebuilt`);
    }
  });

  test('hydrogen2p turns the way its caption says it does', () => {
    // The caption added in round 6 reads cos²(φ − 0.3t) and the kernel computes
    // cos(l·θ + 0.3t)²; the sign is the direction the lobe pair turns, so the
    // two disagreed about the picture. Read the direction off the surface and
    // require the caption to carry the matching sign, rather than pinning the
    // string on its own.
    const entry = MATH_COLLECTIONS.quantumMechanics.formulas.hydrogen2p;
    const lobeAzimuth = time => {
      let best = -Infinity, at = 0;
      for (let i = 0; i < 720; i++) {
        const a = -Math.PI + i * 2 * Math.PI / 720;
        const y = entry.f(Math.cos(a) * 1.5, Math.sin(a) * 1.5, time, { amp: 1, freq: 1, comp: 0.5 });
        if (y > best) { best = y; at = a; }
      }
      return at;
    };
    // |ψ|² carries cos², so the lobe pattern has period π: wrap the step there.
    let d = lobeAzimuth(0.5) - lobeAzimuth(0);
    while (d > Math.PI / 2) d -= Math.PI;
    while (d <= -Math.PI / 2) d += Math.PI;
    assert.ok(Math.abs(d) > 0.05, `the lobe pair does not turn at all (Δφ = ${d.toFixed(4)})`);
    const capturedSign = /cos²\(φ ([+−-]) 0\.3t\)/.exec(entry.formula);
    assert.ok(capturedSign, `hydrogen2p's caption no longer states a rotation: ${entry.formula}`);
    // cos²(φ + 0.3t) peaks where φ = −0.3t, so a '+' in the caption means the
    // lobe travels toward negative azimuth.
    const capturedForward = capturedSign[1] === '+';
    assert.equal(capturedForward, d < 0,
      `the caption says ${capturedSign[1]}0.3t but the lobe turns ${d < 0 ? 'toward negative' : 'toward positive'} azimuth`);
  });

  test('mode 11 has a floor without a ceiling, measured across the whole treble range', () => {
    // The claim "a ceiling now slightly under what the branch had before either
    // repair" was measured at one value of uTreble. A constant offset gives all
    // seven harmonics the same phase, so near t = 0.1 they still add: sweeping
    // uTreble across [0, 1] with the sliders up gives 6.653 for the shipped
    // branch against 5.663 for the one before either repair. The scale carries
    // the repair now, so it is read out of the shader rather than assumed.
    const vs = readFileSync(new URL('../src/shaders.js', import.meta.url), 'utf8');
    const seg = vs.slice(vs.indexOf('mode==11)'), vs.indexOf('mode==12)'));
    const scale = /y=s\*(\.\d+|\d+\.\d*)\*\(0\.3\+b\*\.7\)\*a;/.exec(seg);
    assert.ok(scale, 'mode 11 no longer has the shape this measurement transliterates');
    const k = parseFloat(scale[1]);
    const peakAt = (treble, b, a) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 81; i++) for (let j = 0; j < 81; j++) {
        const x = -3.5 + 7 * i / 80, z = -3.5 + 7 * j / 80;
        const r = Math.hypot(x, z), ang = Math.atan2(z, x);
        let s = 0;
        for (let n = 1; n <= 7; n++) s += Math.exp(-n * r * 0.3) * Math.cos(ang * n * 2) * Math.sin(n * treble * 2 + 0.6);
        const y = s * k * (0.3 + b * 0.7) * a;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      return { peak: Math.max(Math.abs(lo), Math.abs(hi)), span: hi - lo };
    };
    let worst = 0;
    for (let i = 0; i <= 40; i++) worst = Math.max(worst, peakAt(i / 40, 0.9, 2.25).peak);
    assert.ok(worst <= 5.70, `mode 11 peaks at ${worst.toFixed(3)}, above the 5.663 it had before either repair`);
    assert.ok(peakAt(0, 0.2, 0.7).span > 0.3,
      'mode 11 has lost the floor that made it visible with no treble at all');
  });

  test('the two spectrum modes still have a surface with nothing playing', () => {
    // Wiring uBass/uMid/uTreble in was the repair; paying for them out of the
    // constant term was not. In silence the spans fell to 0.297 and 0.300 from
    // 0.362 and 0.452 — a VJ who has not started the track sees a flat sheet.
    const vs = readFileSync(new URL('../src/shaders.js', import.meta.url), 'utf8');
    const coeffs = n => {
      const start = vs.indexOf(`mode==${n})`);
      const stop = vs.indexOf('mode==', vs.indexOf('{', start) + 1);
      const body = vs.slice(start, stop < 0 ? undefined : stop);
      return [...body.matchAll(/\((0?\.\d+)\+([bmt])\*(\.\d+)\)/g)].map(m => [parseFloat(m[1]), m[2], parseFloat(m[3])]);
    };
    const silent = { b: 0.20, m: 0.20, t: 0.15 };
    for (const [n, harm, mult, outer, floor] of [[35, 8, false, 0.4, 0.35], [36, 10, true, 0.5, 0.40]]) {
      const c = coeffs(n);
      assert.equal(c.length, 4, `mode ${n} no longer has four band terms`);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 81; i++) for (let j = 0; j < 81; j++) {
        const x = -3.5 + 7 * i / 80, z = -3.5 + 7 * j / 80;
        const r = Math.hypot(x, z), ang = Math.atan2(z, x);
        let v = 0;
        c.forEach(([base, band, w], idx) => {
          const term = Math.sin(r * harm * (idx + 1)) * (base + silent[band] * w);
          v += mult && idx > 0 ? term * Math.cos(ang * (idx + 1)) : term;
        });
        const y = v * outer * 0.7;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      assert.ok(hi - lo > floor,
        `mode ${n} spans only ${(hi - lo).toFixed(3)} in silence — the plate is nearly flat before the music starts`);
    }
  });
});

describe('Round 8 — what the whole catalogue said against what an oracle says (#R8)', () => {
  const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };
  const EULER_GAMMA = 0.5772156649015328606;

  test('no entry in the catalogue is an affine plane', () => {
    // Round 6 repaired rossler and chua, whose ODEs were integrated for a
    // two-hundredth of one loop, so the flow map was indistinguishable from its
    // own linearisation. It repaired them by name, and lorenz and duffing —
    // sitting in the same collection with the same defect — went another two
    // rounds untouched at plane R² 0.998 and 0.999905. That is the fourth time a
    // handwritten list has missed the thing it was written for, so this one
    // asks all 192 and names nobody.
    //
    // 0.95 sits between the two populations with room on each side: after the
    // repairs the most plane-like entry in the catalogue is predatorPrey at
    // 0.833, and the defects measured 0.998 and 0.999905.
    const G = 45;
    const planeR2 = hf => {
      let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0, n = 0;
      for (let zi = 0; zi < G; zi++) for (let xi = 0; xi < G; xi++) {
        const v = hf[zi * G + xi];
        if (!Number.isFinite(v)) continue;
        const x = -3.5 + xi * 7 / (G - 1), z = -3.5 + zi * 7 / (G - 1);
        sx += x; sz += z; sy += v; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * v; szy += z * v; n++;
      }
      if (n < 10) return 0;
      // Gaussian elimination on the 3×3 normal equations for y = a·x + b·z + c.
      const M = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], B = [sxy, szy, sy];
      for (let i = 0; i < 3; i++) {
        let p = i;
        for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
        [M[i], M[p]] = [M[p], M[i]]; [B[i], B[p]] = [B[p], B[i]];
        if (Math.abs(M[i][i]) < 1e-12) return 0;
        for (let r = 0; r < 3; r++) {
          if (r === i) continue;
          const f = M[r][i] / M[i][i];
          for (let c = i; c < 3; c++) M[r][c] -= f * M[i][c];
          B[r] -= f * B[i];
        }
      }
      const a = B[0] / M[0][0], b = B[1] / M[1][1], c = B[2] / M[2][2];
      const mean = sy / n;
      let tot = 0, res = 0;
      for (let zi = 0; zi < G; zi++) for (let xi = 0; xi < G; xi++) {
        const v = hf[zi * G + xi];
        if (!Number.isFinite(v)) continue;
        const x = -3.5 + xi * 7 / (G - 1), z = -3.5 + zi * 7 / (G - 1);
        tot += (v - mean) ** 2; res += (v - (a * x + b * z + c)) ** 2;
      }
      return tot > 1e-24 ? 1 - res / tot : 0;
    };
    const offenders = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        let hf;
        try { hf = generateSurfaceFromFormula(entry.f, FACTORY, G, 3.5, 0); } catch { continue; }
        let peak = 0;
        for (const v of hf) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
        if (peak < 1e-9) continue;               // a dead entry is another test's business
        const r2 = planeR2(hf);
        if (r2 > 0.95) offenders.push(`${colId}/${key} is a plane to R² ${r2.toFixed(6)}`);
      }
    }
    assert.deepEqual(offenders, [],
      `an entry whose ODE is integrated too briefly draws its own linearisation:\n  ${offenders.join('\n  ')}`);
  });

  test('polygamma reproduces the closed forms of ψ, not a tier-B number under a tier-A letter', () => {
    // ψ(1) = −γ, ψ(½) = −γ − 2ln2, ψ(2) = 1 − γ, ψ(3) = 3/2 − γ. Closed forms
    // are the right oracle inside a test suite: no dependency, and they cannot
    // drift with the implementation they are checking.
    const f = MATH_COLLECTIONS.specialFunctions.formulas.polygamma.f;
    // The entry maps x ∈ [−3.5, 3.5] onto xv ∈ [0.2, 4.2] and scales by 0.2.
    const at = xv => f((xv - 0.2) / 4 * 7 - 3.5, 0, 0, { amp: 1, freq: 1 }) / 0.2;
    const cases = [[1, -EULER_GAMMA], [0.5, -EULER_GAMMA - 2 * Math.log(2)],
                   [2, 1 - EULER_GAMMA], [3, 1.5 - EULER_GAMMA]];
    for (const [xv, want] of cases) {
      const got = at(xv);
      assert.ok(Math.abs(got - want) < 1e-13,
        `ψ(${xv}) = ${got} against the closed form ${want} (Δ ${Math.abs(got - want).toExponential(2)})`);
    }
  });

  test('complexLog is the logarithm outside its disc, not a smoothed stand-in', () => {
    // Round 6 replaced a +1e-9 regulariser with ln√(r²+0.08²), which is not
    // ln|z| anywhere: the bias ½ln(1+ε²/r²) is small but never zero, so the row
    // promising "ln|z| outside a disc of radius 0.08" was false on every vertex.
    const f = MATH_COLLECTIONS.complexNumbers.formulas.complexLog.f;
    let worst = 0;
    for (let i = 1; i <= 400; i++) {
      const r = 0.08 + (3.5 - 0.08) * i / 400;
      const got = f(r, 0, 0, { amp: 1, freq: 1 });
      worst = Math.max(worst, Math.abs(got - Math.log(r) * 0.2));
    }
    assert.ok(worst < 1e-14, `outside the disc the surface is off ln|z| by ${worst.toExponential(2)}`);
    // Inside it stays finite and monotone, which is the whole point of the disc.
    const inside = [0, 0.02, 0.05, 0.079].map(r => f(r, 0, 0, { amp: 1, freq: 1 }));
    assert.ok(inside.every(Number.isFinite), 'the disc no longer bounds the pole');
    for (let i = 1; i < inside.length; i++) {
      assert.ok(inside[i] > inside[i - 1], 'the patch inside the disc is not monotone');
    }
  });

  test('scherkSurface is minimal, which is the one thing its name promises', () => {
    // y = k·ln(cos(a·x)/cos(a·z)) is Scherk's surface only for k = 1/a. The
    // prefactor was a flat 0.25 against a = 2·freq. Mean curvature of a graph
    // vanishes iff (1+y_z²)y_xx − 2y_x·y_z·y_xz + (1+y_x²)y_zz = 0; measured by
    // central differences well away from the asymptotic walls.
    const f = MATH_COLLECTIONS.topology.formulas.scherkSurface.f;
    const P = { amp: 1, freq: 1 };
    const h = 1e-4;
    let worst = 0;
    for (const x of [-0.5, -0.2, 0.2, 0.5]) for (const z of [-0.5, -0.2, 0.2, 0.5]) {
      const y = (u, v) => f(u, v, 0, P);
      const yx = (y(x + h, z) - y(x - h, z)) / (2 * h);
      const yz = (y(x, z + h) - y(x, z - h)) / (2 * h);
      const yxx = (y(x + h, z) - 2 * y(x, z) + y(x - h, z)) / (h * h);
      const yzz = (y(x, z + h) - 2 * y(x, z) + y(x, z - h)) / (h * h);
      const yxz = (y(x + h, z + h) - y(x + h, z - h) - y(x - h, z + h) + y(x - h, z - h)) / (4 * h * h);
      const H2 = (1 + yz * yz) * yxx - 2 * yx * yz * yxz + (1 + yx * yx) * yzz;
      worst = Math.max(worst, Math.abs(H2));
    }
    assert.ok(worst < 1e-3, `mean curvature is ${worst.toExponential(2)} where a minimal surface requires 0`);
  });

  test('pseudosphere draws the tractrix profile its row quotes', () => {
    // The profile was ln tan(T/2) + sech T. The tractrix is ln tan(T/2) + cos T;
    // the two agree to first order at T = 0 and part company by 0.571 over the
    // drawn range, so the difference is the curve, not a rounding.
    const f = MATH_COLLECTIONS.topology.formulas.pseudosphere.f;
    let worst = 0, control = 0;
    for (let i = 1; i < 400; i++) {
      const rho = 3.5 * i / 399;
      const T = Math.PI * rho / (rho + 2.5);
      const want = (Math.log(Math.tan(T / 2)) + Math.cos(T)) * 0.35;
      control = Math.max(control, Math.abs(Math.cos(T) - 1 / Math.cosh(T)));
      if (Math.abs(want) > 0.35) continue;                 // above the knee the fold takes over
      worst = Math.max(worst, Math.abs(f(rho, 0, 0, { amp: 1, freq: 1 }) - want));
    }
    assert.ok(worst < 1e-12, `the drawn profile is off the tractrix by ${worst.toExponential(2)}`);
    assert.ok(control > 0.5,
      'cos and sech barely differ over this range — this test could not tell the two profiles apart');
  });

  test('airy hands over between its two branches on the side that needs it', () => {
    // One threshold served both signs and they fail in opposite directions: the
    // alternating series loses everything to cancellation where Ai decays, and
    // holds where Ai oscillates. Ai(0) and the published zeros are closed-form
    // oracles that no implementation can drift away from.
    const f = MATH_COLLECTIONS.specialFunctions.formulas.airy.f;
    // The entry draws 0.7·Ai(ξ) at z = 0, ξ = x·freq·1.5, so ξ is reachable
    // through x and the scale comes back out by division.
    const ai = xi => f(xi / 1.5, 0, 0, { amp: 1, freq: 1 }) / 0.7;
    assert.ok(Math.abs(ai(0) - 0.3550280538878172) < 1e-15,
      `Ai(0) = ${ai(0)} against the closed form 3^(−2/3)/Γ(2/3)`);
    for (const zero of [-2.33810741045976704, -4.08794944413097062, -5.52055982809555106]) {
      assert.ok(Math.abs(ai(zero)) < 1e-13, `Ai(${zero}) = ${ai(zero)}, and it is a zero of Ai`);
    }
    // A handover between two series is discontinuous or it is not, and the way
    // to see it is against the function's own slope: over the same width, a
    // seam that steps moves further than the smooth neighbourhood beside it.
    // Scanning the whole reachable ξ finds a seam wherever it was put, which a
    // list of thresholds copied out of the kernel would not.
    const d = 1e-6;
    const seam = g => {
      let worst = -Infinity, at = 0;
      for (let xi = -24; xi <= 24; xi += 0.05) {
        const jump = Math.abs(g(xi + d) - g(xi - d));
        const smooth = Math.max(Math.abs(g(xi - d) - g(xi - 3 * d)), Math.abs(g(xi + 3 * d) - g(xi + d)));
        if (jump - smooth > worst) { worst = jump - smooth; at = xi; }
      }
      return { worst, at };
    };
    const got = seam(ai);
    assert.ok(got.worst < 1e-7,
      `Ai steps by ${got.worst.toExponential(2)} beyond its own slope near ξ = ${got.at.toFixed(2)}`);
    // Control: the same scan against the same kernel with one step of 1e-6
    // injected at ξ = 6 must fail, or it could not have seen a real seam either.
    const control = seam(xi => ai(xi) + (xi > 6 ? 1e-6 : 0));
    assert.ok(control.worst > 1e-7,
      'the scan cannot see a 1e-6 step, so its silence on the real handovers means nothing');
  });

  // ── guard epsilons, swept across all 192 ─────────────────
  test('sinc draws the sinc of the argument its caption names, not of the argument plus 1e-8', () => {
    // Reference: mpmath.sincpi at 40 dps, times the entry's own 0.6 display
    // scale. The old kernel read r = sqrt(x²+z²)·freq·2 + 1e-8, which is the
    // whole error of a tier-A row: 8.22e-9 at amp 1 near r = 0.66, and −6.0e-9
    // on the ring r = 1 where sinc is exactly zero.
    const f = MATH_COLLECTIONS.specialFunctions.formulas.sinc.f;
    const P = { amp: 1, freq: 1, comp: 0.5 };
    const cases = [
      [0.33, 0.25357916326077971516],  // r = 0.66, where |d sinc/dr| is largest
      [1.25, 0.07639437268410976117],  // r = 2.5
    ];
    for (const [x, want] of cases) {
      const got = f(x, 0, 0, P);
      assert.ok(Math.abs(got - want) <= 1e-14,
        `sinc at x=${x}: got ${got}, mpmath says ${want} (diff ${Math.abs(got - want)})`);
    }
    // r = 1 is a zero of sinc. The guard put -6.0e-9 there.
    for (const [x, z] of [[0.5, 0], [0, 0.5], [0.5 / Math.SQRT2, 0.5 / Math.SQRT2]]) {
      assert.ok(Math.abs(f(x, z, 0, P)) <= 1e-15,
        `sinc must vanish on the ring r=1, got ${f(x, z, 0, P)} at (${x},${z})`);
    }
    // r = 0 is the one point that needs a special case, and its value is 1.
    assert.equal(f(0, 0, 0, P), 0.6, 'sinc(0)·0.6 must be exactly 0.6, not 0.5999999999999999');
  });

  test('fourierInverse draws sin(u)/u of u itself, and its caption says which sinc that is', () => {
    // sin(u)/u with u = 4·x·freq. u = π at x = π/4 with freq 1, a true zero;
    // the old +1e-9 on u put -1.59e-10 there.
    const e = MATH_COLLECTIONS.integralTransforms.formulas.fourierInverse.f;
    const P = { amp: 1, freq: 1, comp: 0.5 };
    for (const k of [1, 2, 3]) {
      const x = k * Math.PI / 4;
      assert.ok(Math.abs(e(x, 0, 0, P)) <= 1e-15,
        `sin(u)/u must vanish at u=${k}π, got ${e(x, 0, 0, P)}`);
    }
    assert.equal(e(0, 0, 0, P), 0.5, 'sin(u)/u → 1 at u = 0, times the 0.5 display scale');

    // Two sinc conventions live in this catalogue under one word. A reader must
    // be able to tell from the caption which one is on screen.
    const capInv = MATH_COLLECTIONS.integralTransforms.formulas.fourierInverse.formula;
    const capSinc = MATH_COLLECTIONS.specialFunctions.formulas.sinc.formula;
    assert.ok(capInv.includes('sin(u)/u'), `unnormalised sinc must be named as such: ${capInv}`);
    assert.ok(capInv.includes('W'), `the rect's half-width must appear in the caption: ${capInv}`);
    assert.ok(capSinc.includes('sin(πr)/(πr)'), `normalised sinc must be named as such: ${capSinc}`);
    assert.notEqual(capInv, capSinc);
  });

  test('pythagorean is -cos(2(r+t)) with no epsilon on r', () => {
    // sin²A − cos²A = −cos 2A is an identity, so cos is an independent
    // expression, not the kernel re-typed. The old +1e-9 on r cost 2.03e-9.
    const f = MATH_COLLECTIONS.trigonometry.formulas.pythagorean.f;
    for (const [x, z, t, amp, freq] of [[0, 0, 0, 1, 1], [1.3, -0.7, 3.7, 2.25, 1],
                                        [0.08, 0.08, 3.7, 2.25, 1], [-3.5, 2.1, 41.3, 0.7, 4.55]]) {
      const r = Math.sqrt(x * x + z * z) * freq * 2;
      const want = -Math.cos(2 * (r + t)) * amp * 0.45;
      const got = f(x, z, t, { amp, freq, comp: 0.5 });
      assert.ok(Math.abs(got - want) <= 1e-13,
        `pythagorean at (${x},${z},t=${t}): got ${got}, −cos(2(r+t))·amp·0.45 = ${want}`);
    }
  });

  test('gram normalises by |v1| and not by |v1| + 1e-9', () => {
    // |e2| is the perpendicular distance from v to the line through e1, i.e.
    // |v × e1| — a cross product, which is not the projection the kernel runs.
    // v1 = (cos 0.3t, sin 0.3t) is already a unit vector, so the guard could
    // never fire; all it did was cost 1.79e-8.
    const f = MATH_COLLECTIONS.linearAlgebra.formulas.gram.f;
    for (const [x, z, t, amp, freq] of [[3.5, 0, 0, 2.25, 4.55], [-1.2, 2.4, 3.7, 1, 1],
                                        [0, 0, 41.3, 0.7, 0.3], [3.5, -3.5, 5.1, 2.25, 2]]) {
      const want = Math.abs(x * freq * Math.sin(t * 0.3) - z * freq * Math.cos(t * 0.3)) * amp * 0.25;
      const got = f(x, z, t, { amp, freq, comp: 0.5 });
      assert.ok(Math.abs(got - want) <= 1e-13,
        `gram at (${x},${z},t=${t}): got ${got}, |v × e1|·amp·0.25 = ${want}`);
    }
  });

  test('the Fejér and Dirichlet kernels match their defining sums, singular point included', () => {
    // Both kernels used to shift x by +1e-6 to step around sin(x/2) = 0, which
    // cost 9.3e-6 and 2.5e-5 under rows rated A. The singularities are
    // removable: F_N(2πk) = N and D_N(2πk) = 2N+1. Reference here is the
    // DEFINING sum in each case, not the closed form the kernel evaluates.
    const fej = MATH_COLLECTIONS.fourierSeries.formulas.fejerKernel.f;
    const dir = MATH_COLLECTIONS.fourierSeries.formulas.dirichletKernel.f;
    for (const comp of [0, 0.5, 1]) {
      const NF = 2 + Math.round(comp * 14), ND = 2 + Math.round(comp * 12);
      for (const [x, amp, freq] of [[0, 1, 1], [-0.018, 2.25, 4.55], [-0.072, 2.25, 1],
                                    [1.7, 0.7, 1], [Math.PI, 1, 1], [-2.9, 2.25, 0.3]]) {
        const xv = x * freq * 2;
        let re = 0, im = 0;
        for (let k = 0; k < NF; k++) { re += Math.cos(k * xv); im += Math.sin(k * xv); }
        const wantF = (re * re + im * im) / NF * amp * 0.06;
        const gotF = fej(x, 0, 0, { amp, freq, comp });
        assert.ok(Math.abs(gotF - wantF) <= 1e-12,
          `Fejér N=${NF} at x=${x}: got ${gotF}, (1/N)|Σe^{ikx}|² = ${wantF}`);

        let s = 1;
        for (let k = 1; k <= ND; k++) s += 2 * Math.cos(k * xv);
        const wantD = s * amp * 0.06;
        const gotD = dir(x, 0, 0, { amp, freq, comp });
        assert.ok(Math.abs(gotD - wantD) <= 1e-12,
          `Dirichlet N=${ND} at x=${x}: got ${gotD}, 1+2Σcos kx = ${wantD}`);
      }
    }
  });

  // complexLog is covered above, by the test that pairs "exact outside the disc"
  // with "monotone inside it". The sweep for guard epsilons arrived at this entry
  // independently and proposed ln max(r, 0.08) — a flat floor — which measures the
  // same outside the disc and differs inside. The repair already in this round is
  // the quadratic that meets the logarithm in value and slope at the rim, so the
  // sweep's version was not taken and its test with it.

  test('hydrogen 1s is 4e^{-2r} at r, not at r + 0.01', () => {
    // Height is R₁₀(r)²·0.6·amp·1.7 = 4e^{−2r}·1.02·amp, so f(0,0) = 4.08·amp
    // and f(r)/f(0) = e^{−2r} exactly. The +0.01 in the shared helper scaled the
    // first by e^{−0.02} = 0.9802 and left the second alone, which is how a 2 %
    // error hides under a free amplitude slider. (The display constant is 1.7
    // rather than 2 because the true peak, once the offset was gone, stood on
    // the frame limit — see the note on the entry.)
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.hydrogenS.f;
    assert.ok(Math.abs(f(0, 0, 0, { amp: 1, freq: 1, comp: 0.5 }) - 4.08) <= 1e-14,
      `1s peak must be 4·0.6·1.7 = 4.08 at amp 1, got ${f(0, 0, 0, { amp: 1, freq: 1, comp: 0.5 })}`);
    for (const [x, z, freq] of [[1, 0, 1], [-2, 1.5, 0.3], [0.5, -0.5, 4.55]]) {
      const r = Math.hypot(x, z) * freq;
      const want = 4.08 * Math.exp(-2 * r);
      const got = f(x, z, 3.7, { amp: 1, freq, comp: 0.5 });
      assert.ok(Math.abs(got - want) <= 1e-13,
        `1s at r=${r}: got ${got}, 4.08·e^{−2r} = ${want}`);
    }
  });

  test('the sp² hybrid has its exact value at the origin', () => {
    // At r = 0 both p lobes vanish and psi = psi_s/√3 = 2/(√(32π)·√3), so the
    // height is 4·amp·psi² = amp/(6π) — a number, not the kernel re-typed. The
    // +1e-6 on r moved it by 6e-8.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.atomicOrbitals.f;
    for (const amp of [0.7, 1, 2.25]) {
      for (const comp of [0, 0.5, 1]) {
        const got = f(0, 0, 0, { amp, freq: 1, comp });
        assert.ok(Math.abs(got - amp / (6 * Math.PI)) <= 1e-14,
          `sp² at the origin, amp=${amp}: got ${got}, amp/(6π) = ${amp / (6 * Math.PI)}`);
      }
    }
  });

  test('binary entropy reaches its endpoints, where H is 0 and defined', () => {
    // p was clamped to [0.001, 0.999], so the two end columns drew H(0.001) =
    // 0.0114 bits. H(0) = H(1) = 0 — the endpoints are in the domain; only the
    // NaN from 0·log 0 needed handling.
    const f = MATH_COLLECTIONS.probability.formulas.entropyLandscape.f;
    for (const amp of [0.7, 1, 2.25]) {
      const P = { amp, freq: 1, comp: 0.5 };
      assert.equal(f(-3.5, 0, 0, P), 0, 'H(0) must be exactly 0 at the left edge');
      assert.equal(f(3.5, 0, 0, P), 0, 'H(1) must be exactly 0 at the right edge');
      // H(1/2) = 1 bit, at x = 0
      assert.ok(Math.abs(f(0, 0, 0, P) - amp * 0.45) <= 1e-15,
        `H(1/2) = 1 bit, so the height is amp·0.45; got ${f(0, 0, 0, P)}`);
      // H(1/4) = 2 − (3/4)log₂3 = 0.8112781244591328 (published)
      const want = 0.8112781244591328 * amp * 0.45;
      assert.ok(Math.abs(f(-1.75, 0, 0, P) - want) <= 1e-14,
        `H(1/4) height: got ${f(-1.75, 0, 0, P)}, want ${want}`);
    }
  });

  test('every entry touched in round 8 stays finite and in frame across grids 25/90/161', () => {
    // The finiteness half deliberately calls the kernel rather than
    // generateSurfaceFromFormula: that function ends with
    // `out[i] = isFinite(y) ? y : 0`, so a NaN check run through it can never
    // fail. Checked — with the r === 0 branch taken out of sinc, so that the
    // origin returns 0/0, the plate still reads all-finite. The peak half does
    // go through it, because a peak is what actually reaches the buffer and
    // the zero substitution cannot hide one.
    const targets = [
      ['specialFunctions', 'sinc'], ['integralTransforms', 'fourierInverse'],
      ['trigonometry', 'pythagorean'], ['linearAlgebra', 'gram'],
      ['fourierSeries', 'fejerKernel'], ['fourierSeries', 'dirichletKernel'],
      ['complexNumbers', 'complexLog'], ['quantumMechanics', 'hydrogenS'],
      ['quantumMechanics', 'hydrogen2p'], ['quantumMechanics', 'atomicOrbitals'],
      ['probability', 'entropyLandscape'],
    ];
    for (const [col, key] of targets) {
      const f = MATH_COLLECTIONS[col].formulas[key].f;
      for (const grid of [25, 90, 161]) {
        const step = 7 / (grid - 1);
        for (const amp of [0.7, 2.25]) {
          for (const freq of [0.3, 4.55]) {
            for (const comp of [0, 1]) {
              for (let zi = 0; zi < grid; zi++) {
                for (let xi = 0; xi < grid; xi++) {
                  const y = f(-3.5 + xi * step, -3.5 + zi * step, 3.7, { amp, freq, comp });
                  assert.ok(Number.isFinite(y),
                    `${col}/${key} returned ${y} at grid ${grid}, amp ${amp}, freq ${freq}, comp ${comp}`);
                }
              }
              const h = generateSurfaceFromFormula(f, { amp, freq, comp }, grid, 3.5, 3.7);
              let peak = 0;
              for (let i = 0; i < h.length; i++) peak = Math.max(peak, Math.abs(h[i]));
              assert.ok(peak > 1e-3 && peak < 25,
                `${col}/${key} peak ${peak} at grid ${grid}, amp ${amp}, freq ${freq}, comp ${comp}`);
            }
          }
        }
      }
    }
  });

  // ── the complex trio: epsilons and what the fold is allowed to claim ─────────────────
  test('complexPower: |z^z| exact once the guard epsilon is gone (#R8)', () => {
    // The kernel carried `r = |z|·freq + 1e-9` under a tier-A row, and that
    // constant WAS the entry's whole residual: against mpmath's
    // abs(mpc(x,z)**mpc(x,z)) at 50 dps the drawn value was out by 4.77e-10,
    // while against the same expression with the epsilon put back it agreed to
    // 1.29e-16. mpmath's control points are |i^i| = e^{−π/2} =
    // 0.20787957635076190855 and |(1+i)^{1+i}| = exp(ln√2 − π/4), both
    // reproduced to 1e-51 and cross-checked in PARI/GP.
    //
    // Factory sliders: amp 0.7, freq 1. drawn = 0.1·amp·|w^w| and every point
    // below sits under the fold knee (0.5), so soften() is the identity there.
    const P = { amp: 0.7, freq: 1, comp: 0.5 };
    const REF = [
      [1,    0.5,  0.0620687854745680828],
      [-1.2, 0.8,  0.00584860087392065372],
      [0.4,  -1.5, 0.0116946291450614525],
      [2.0,  1.0,  0.220144807445025933],
      [-2.5, -0.3, 0.0028101775410455395],
    ];
    for (const [x, z, want] of REF) {
      near(evalAt('complexNumbers', 'complexPower', x, z, 0, P), want, 1e-14,
        `|z^z| at (${x}, ${z})`);
    }
  });

  test('complexPower: r = 0 is removable, so the origin carries the limit (#R8)', () => {
    // |z^z| = exp(x·ln r − y·arg z) and both terms vanish with r (|x| ≤ r,
    // |y·arg z| ≤ πr), so the limit is 1 from every direction — mpmath over
    // eight directions gives a spread of 9.2e-2 at |z| = 1e-2 falling to
    // 1.4e-28 at |z| = 1e-30. Handing the origin the display bound instead
    // would put back the grid-parity needle round 6 removed from complexLog,
    // and dropping the guard altogether gives 0·(−Infinity) = NaN.
    for (const amp of [0.2, 0.7, 1, 2.25]) {
      const y = evalAt('complexNumbers', 'complexPower', 0, 0, 0, { amp, freq: 1, comp: 0.5 });
      assert.ok(Number.isFinite(y), `origin is ${y} at amp ${amp}`);
      near(y, 0.1 * amp, 1e-15, `|z^z| → 1 at the origin, amp ${amp}`);
    }
    // Every odd mesh has a vertex exactly at the origin; the app's grid floats
    // 60–200, so this must not depend on parity.
    for (const g of [25, 91, 161]) {
      const hf = generateSurfaceFromFormula(
        MATH_COLLECTIONS.complexNumbers.formulas.complexPower.f,
        { amp: 0.7, freq: 1, comp: 0.5 }, g, 3.5, 0);
      const c = ((g - 1) / 2) * g + (g - 1) / 2;
      near(hf[c], 0.07, 1e-6, `centre vertex at grid ${g}`);
    }
  });

  test('mobiusTransform: complex division exact once the guard epsilon is gone (#R8)', () => {
    // The +1e-9 on |cz+d|² was the whole residual here too: 1.45e-9 against
    // mpmath complex division at 50 dps outside the fold, 4.52e-17 against the
    // same division with the epsilon restored. mpmath's controls are
    // f(0) = b/d exactly and the invariance of the cross-ratio of four points
    // under the map, held to 3.3e-51.
    // Factory sliders; b = sin(0.4t)·comp, c = cos(0.3t)·comp, a = d = 1.
    const P = { amp: 0.7, freq: 1, comp: 0.5 };
    const REF = {                      // t → [x, z, Re((w+b)/(cw+1))·amp·0.35]
      0: [
        [1,    0.5,  0.172162162162162162],
        [-1.2, 0.8,  -0.1225],
        [0.4,  -1.5, 0.196367041198501873],
        [2.0,  1.0,  0.259411764705882353],
      ],
      2.5: [                            // b = 0.420735492403948253, c = 0.365844434436910443
        [1,    0.5,  0.262155651941268464],
        [-1.2, 0.8,  -0.124234276027834364],
        [0.4,  -1.5, 0.267563254658907423],
        [2.0,  1.0,  0.356466310072501948],
      ],
    };
    for (const [t, rows] of Object.entries(REF)) {
      for (const [x, z, want] of rows) {
        near(evalAt('complexNumbers', 'mobiusTransform', x, z, +t, P), want, 1e-14,
          `Möbius at (${x}, ${z}), t = ${t}`);
      }
    }
  });

  test('mobiusTransform: the exact pole draws the display bound, not a hole (#R8)', () => {
    // At t = 0 the map is (z)/(comp·z + 1), so the pole sits at
    // x = −1/(comp·freq); at the FACTORY sliders that is x = −2, and
    // 0.5·(−2) + 1 is exactly 0 in IEEE double. It is a lattice point of every
    // mesh whose spacing divides 1.5 — grid 15 has it at xi = 3 — and the app's
    // grid floats 60–200.
    //
    // With the epsilon the numerator was 0 and the denominator 1e-9, so the
    // pole vertex was drawn at exactly 0: a hole punched through a ridge whose
    // two sides are ±0.85. |Re f| → ∞ from both sides, so the bound is the
    // honest height; the sign is not determined by the map.
    const P = { amp: 0.7, freq: 1, comp: 0.5 };
    const at = x => evalAt('complexNumbers', 'mobiusTransform', x, 0, 0, P);
    assert.equal(at(-2), 0.85, 'the pole vertex must sit at the fold ceiling');
    assert.equal(at(-2.01), 0.85, 'left of the pole is saturated');
    assert.equal(at(-1.99), -0.85, 'right of the pole is saturated with the other sign');
    const hf = generateSurfaceFromFormula(
      MATH_COLLECTIONS.complexNumbers.formulas.mobiusTransform.f, P, 15, 3.5, 0);
    near(hf[7 * 15 + 3], 0.85, 1e-6, 'the pole lands on the grid-15 mesh at (xi 3, zi 7)');
  });

  test('blaschke: |B| = 1 on the unit circle, so the height there is exactly amp·0.45 − 0.2 (#R8)', () => {
    // This reference needs no implementation at all. For |a_k| < 1 each factor
    // (z − a_k)/(1 − ā_k z) has modulus 1 on |z| = 1, because there
    // |1 − ā_k z| = |z|·|z̄ − ā_k| = |z − a_k|. So the drawn height on the unit
    // circle is soften(amp·0.45 − 0.2) with no arithmetic left in it. The
    // +1e-9 in the denominator showed up here as a 3.65e-9 deviation at amp 1 —
    // exactly the size of the guard, under a row claiming 1e-14.
    // At amp 1.5 the circle value 0.475 is just past the knee, so the expected
    // number is soften(0.475, 0.45, 0.85) = 0.45 + 0.4·tanh(0.0625) — the fold
    // is not being undone here, only accounted for.
    for (const [amp, want] of [[0.7, 0.115], [1, 0.25], [1.5, 0.4749674986990050058]]) {
      for (const comp of [0, 0.5, 1]) {                 // n = 2, 4, 5 factors
        for (const t of [0, 2.5]) {
          for (let j = 0; j < 17; j++) {
            const th = (2 * Math.PI * j) / 17;
            near(evalAt('complexNumbers', 'blaschke', Math.cos(th), Math.sin(th), t,
                        { amp, freq: 1, comp }), want, 1e-14,
              `|B| on the unit circle, amp ${amp}, comp ${comp}, t ${t}, j ${j}`);
          }
        }
      }
    }
  });

  test('blaschke: interior values exact against mpmath (#R8)', () => {
    // Inside the disc |B| < 1, so these all sit under the knee (0.45) and
    // soften() is the identity. Reference: mpmath at 50 dps, n = round(2+comp·3).
    const P = { amp: 0.7, freq: 1, comp: 0.5 };         // n = 4
    const REF = {
      0: [
        [0.3,  0.2,   -0.15533644032877818],
        [-0.5, 0.4,   -0.11024377859902077],
        [0.1,  -0.7,  -0.149156064630656426],
        [0.62, 0.05,  -0.18429098296789095],
      ],
      2.5: [
        [0.3,  0.2,   -0.16405218848971736],
        [-0.5, 0.4,   -0.132741485322984907],
        [0.1,  -0.7,  -0.116114786675961175],
        [0.62, 0.05,  -0.134555672574715787],
      ],
    };
    for (const [t, rows] of Object.entries(REF)) {
      for (const [x, z, want] of rows) {
        near(evalAt('complexNumbers', 'blaschke', x, z, +t, P), want, 1e-14,
          `|B| at (${x}, ${z}), t = ${t}`);
      }
    }
  });

  test('blaschke: the pole at z = 1/ā_k draws the display bound and stays finite (#R8)', () => {
    // 1 − ā_k z vanishes at |z| = 1/0.6 = 1.667, inside the plate at every
    // reachable freq, and 1 − 0.6·(1/0.6) is exactly 0 in IEEE double. No other
    // factor can be zero there (|a_j| = 0.6 ≠ 1.667), so |B| really is infinite
    // and the fold ceiling is the honest height.
    //
    // With the epsilon the quotient came out 0, which zeroed the whole product
    // and drew −0.2 — a pit at the one point where the surface is highest.
    const P = { amp: 0.7, freq: 1, comp: 0.5 };
    const xp = 1 / 0.6;
    assert.equal(1 - 0.6 * xp, 0, 'the exact-zero branch is reachable in double arithmetic');
    for (const dx of [0, -1e-4, 1e-4, -1e-2, 1e-2]) {
      const y = evalAt('complexNumbers', 'blaschke', xp + dx, 0, 0, P);
      assert.ok(Number.isFinite(y), `blaschke is ${y} at x = ${xp + dx}`);
      near(y, 0.85, 1e-12, `blaschke at the pole + ${dx}`);
    }
  });

  test('the complex trio stays finite and in frame across the reachable slider box (#R8)', () => {
    // Removing a guard constant is exactly the change that can put a NaN into
    // the vertex buffer, and generateSurfaceFromFormula's isFinite() net would
    // hide it as a zero. So the raw kernel is swept too, not just the mesh.
    // amp/freq are the slider ranges in src/params.js widened to what the audio
    // path can push them to; comp is taken over its whole 0..1.
    const KEYS = ['complexPower', 'mobiusTransform', 'blaschke'];
    const bad = [];
    for (const key of KEYS) {
      const f = MATH_COLLECTIONS.complexNumbers.formulas[key].f;
      for (const amp of [0.2, 0.7, 1.5, 2.25]) {
        for (const freq of [0.3, 1, 3.5, 4.55]) {
          for (const comp of [0, 0.5, 1]) {
            for (const t of [0, 3.1, 47.3]) {
              const N = 41, ext = 3.5, step = (ext * 2) / (N - 1);
              for (let zi = 0; zi < N; zi++) for (let xi = 0; xi < N; xi++) {
                const y = f(-ext + xi * step, -ext + zi * step, t, { amp, freq, comp });
                if (!Number.isFinite(y) && bad.length < 6) {
                  bad.push(`${key} = ${y} @ amp ${amp} freq ${freq} comp ${comp} t ${t}`);
                }
              }
            }
          }
        }
      }
    }
    assert.deepEqual(bad, [], bad.join('\n  '));

    // In frame, and the same frame at every resolution the app can ask for.
    for (const key of KEYS) {
      for (const p of [{ amp: 0.7, freq: 1, comp: 0.5 }, { amp: 2.25, freq: 4.55, comp: 1 }]) {
        let prev = null;
        for (const g of [25, 90, 161]) {
          const hf = generateSurfaceFromFormula(
            MATH_COLLECTIONS.complexNumbers.formulas[key].f, p, g, 3.5, 0);
          let peak = 0;
          for (const v of hf) {
            assert.ok(Number.isFinite(v), `${key} put ${v} in the buffer at grid ${g}`);
            peak = Math.max(peak, Math.abs(v));
          }
          assert.ok(peak >= 0.1 && peak <= 2.5,
            `${key} peak ${peak} out of frame at grid ${g}, amp ${p.amp}`);
          if (prev !== null) {
            assert.ok(Math.abs(peak - prev) < 1e-5,
              `${key} peak moves with grid density: ${prev} → ${peak}`);
          }
          prev = peak;
        }
      }
    }
  });

  test('the complex trio rows state the tier their measured fold coverage allows (#R8)', () => {
    // The fold is a monotone tanh rescaling, so inside it the drawn height is
    // not the computed value — the deviation runs to whole world units. The
    // rule this round applied: keep the letter and disclose the measured
    // coverage while the fold stays a minority of the plate everywhere the
    // sliders reach; move to C, on this document's own "output is decorated by
    // an envelope … that breaks direct correspondence" bullet, when the fold
    // takes the plate somewhere reachable. Measured at grid 90, factory sliders
    // → slider maxima: complexPower 12.4 % → 36.8 % (and eulerIm, which round 8
    // already ruled keeps A, 24.4 % → 48.2 %); mobiusTransform 22.6 % → 99.4 %;
    // blaschke 90.9 % → 99.8 %.
    const doc = readFileSync(new URL('../MATHEMATICAL_ACCURACY.md', import.meta.url), 'utf8');
    const rowOf = key => doc.split('\n').find(l => l.startsWith(`| \`${key}\` |`));
    for (const [key, tier, coverage] of [['complexPower', '🟢 A', '12.4'],
                                         ['mobiusTransform', '🟡 C', '22.6'],
                                         ['blaschke', '🟡 C', '90.9']]) {
      const row = rowOf(key);
      assert.ok(row, `no row for ${key}`);
      assert.ok(row.includes(`| ${tier} |`), `${key} should be rated ${tier}: ${row.slice(0, 120)}`);
      assert.ok(row.includes(`${coverage} %`),
        `${key} must state its measured factory fold coverage (${coverage} %)`);
    }
  });

  // ── the beam that drew a flat plate ─────────────────
    // ── differentialEqs/beamBending — a flat plate that was mathematically right ──
    //
    // Round 8. The kernel drew the exact modal deflection of a simply-supported
    // beam under q(ξ) = 0.8·sin(nπξ) and nobody could see it: the modal
    // denominator (nπ/L)⁴ was never compensated, and comp = 0.5 + mid·0.4 reaches
    // n = 3..5, i.e. 7.9e3..6.1e4. Measured before the repair, on grid 90 over the
    // reachable slider box: the tallest point on the whole plate was 5.54e-2 world
    // units (and 6.8e-4 anywhere inside the comp window the audio can actually
    // reach), against 0.42..2.28 for twelve of the other fifteen entries in this
    // collection — the other three peak at 8.7, 114 and 539, which is a separate
    // complaint and not this one.
    //
    // The repair is in the load, not in a display gain the row hides: the load
    // amplitude is scaled with the mode, q̂ₙ = EI·(nπ/L)⁴·δ, so the exact
    // deflection q̂ₙ·sin(nπξ)/(EI·(nπ/L)⁴) is δ·sin(nπξ) for every n. Verified
    // against two independent solvers of EI·y'''' = q with y(0)=y(L)=y''(0)=
    // y''(L)=0 — sympy dsolve with the four conditions fitted symbolically, and a
    // finite-difference BVP solved as two tridiagonal systems in numpy — both
    // first shown to reproduce the textbook 5qL⁴/384EI for a uniform load
    // (0.013020833333, error 0 and 2.6e-9). Drawn row against sympy: max
    // difference 5.7e-16 to 2.1e-15, i.e. 2e-15 of the peak.

    test('beamBending is visible: its peak sits in the same band as its collection (#R8)', () => {
      // The reachable slider box. src/params.js: amp 0.2..1.5 (extendedMax 2.0),
      // waveInt 0.3..3.5 (extendedMax 5.0); src/math-visualizer.js multiplies amp
      // by (1 + bass·0.5) and waveInt by (1 + treble·0.3), and sets
      // comp = 0.5 + mid·0.4 — so comp 0..1 here is wider than the app can reach.
      const AMP = [0.7, 1.0, 1.5, 2.25];
      const FREQ = [0.3, 0.7, 1.0, 1.3, 2.0, 3.5, 4.55];
      const COMP = [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      const peak = (f, p) => {
        const hf = generateSurfaceFromFormula(f, p, 90, 3.5, 0);
        let m = 0;
        for (let i = 0; i < hf.length; i++) m = Math.max(m, Math.abs(hf[i]));
        return m;
      };
      const boxPeaks = f => {
        let hi = 0, lo = Infinity;
        for (const amp of AMP) for (const freq of FREQ) for (const comp of COMP) {
          const v = peak(f, { amp, freq, comp });
          hi = Math.max(hi, v); lo = Math.min(lo, v);
        }
        return { hi, lo };
      };

      const beam = MATH_COLLECTIONS.differentialEqs.formulas.beamBending;
      const { hi, lo } = boxPeaks(beam.f);
      // Measured after the repair: hi 1.0120 (1.0125 on grids 25 and 161),
      // lo 0.2547 at amp 0.7, freq 0.3, comp 0.2 — that lowest corner is n = 2
      // seen through the freq-0.3 window ξ ∈ [0.35, 0.65], which excludes the
      // crests at ξ = 0.25 and 0.75, so the visible maximum is sin(0.7π)·0.315.
      // Before the repair hi was 0.0554.
      assert.ok(hi > 0.30 && hi < 2.5, `beamBending peaks at ${hi} over the slider box`);
      assert.ok(lo > 0.15, `beamBending falls to ${lo} somewhere in the slider box`);

      // …and in the band of the fifteen entries it is drawn next to. The median
      // is used rather than the extremes because three entries in this collection
      // (dampedOscillator, laplacePDE, predatorPrey) run to 8.7, 114 and 539 and
      // would widen any min/max window to uselessness.
      const others = Object.entries(MATH_COLLECTIONS.differentialEqs.formulas)
        .filter(([k]) => k !== 'beamBending')
        .map(([, e]) => boxPeaks(e.f).hi)
        .sort((a, b) => a - b);
      const median = others[Math.floor(others.length / 2)];
      // Measured: median 1.20, ratio 0.84. Before the repair the ratio was 0.046.
      assert.ok(hi / median > 0.1 && hi / median < 10,
        `beamBending peaks at ${hi} against a collection median of ${median}`);
    });

    test('beamBending draws a single beam mode, so it still solves EI·y⁗ = q̂·sin(nπξ) (#R8)', () => {
      // The drawn row is put back into the beam equation instead of being compared
      // with a second copy of the kernel. sin(mπξ) is the eigenbasis of the
      // simply-supported operator — EI·y⁗ = q is diagonal there with eigenvalue
      // (mπ/L)⁴ — so projecting the drawn deflection onto it and multiplying by
      // (mπ)⁴ reads off the load that deflection implies. If that load is one
      // pure sine, the drawn shape is the exact solution for it; energy in any
      // other mode is the residual of the equation.
      const beam = MATH_COLLECTIONS.differentialEqs.formulas.beamBending;
      const N = 2001, MMAX = 40;
      // The kernel maps ξ = clamp((x·freq + 3.5)/7, 0, 1), so x = (7ξ − 3.5)/freq
      // samples the beam coordinate uniformly between the two supports.
      const row = (p, z) => {
        const y = new Float64Array(N);
        for (let i = 0; i < N; i++) y[i] = beam.f((7 * (i / (N - 1)) - 3.5) / p.freq, z, 0, p);
        return y;
      };
      const load = y => {
        const h = 1 / (y.length - 1), Q = [];
        for (let m = 1; m <= MMAX; m++) {
          let s = 0;
          for (let i = 0; i < y.length; i++) s += y[i] * Math.sin(m * Math.PI * i * h);
          Q.push(2 * h * s * Math.pow(m * Math.PI, 4));   // trapezoid; y = 0 at both ends
        }
        return Q;
      };

      for (const [p, z] of [[{ amp: 0.7, freq: 1, comp: 0.5 }, 0], [{ amp: 2.25, freq: 1, comp: 0.9 }, 0],
                            [{ amp: 0.7, freq: 1, comp: 0 }, 0], [{ amp: 1.5, freq: 0.3, comp: 0.7 }, 0.8],
                            [{ amp: 1.0, freq: 4.55, comp: 1.0 }, -1.2]]) {
        const y = row(p, z), Q = load(y);
        let n = 0;
        for (let m = 0; m < Q.length; m++) if (Math.abs(Q[m]) > Math.abs(Q[n])) n = m;
        let off = 0;
        for (let m = 0; m < Q.length; m++) if (m !== n) off += Q[m] * Q[m];
        const rel = Math.sqrt(off) / Math.abs(Q[n]);
        // Measured 6.5e-13 to 2.1e-10 (the n = 1 corner is the loosest, because
        // the projection's round-off is weighted by (mπ)⁴ against the smallest
        // q̂). A 2 % second harmonic added to the shape scores 3.2e-1 here.
        assert.ok(rel < 1e-8, `beamBending at ${JSON.stringify(p)}: load energy ${rel} outside mode ${n + 1}`);
        // Simply-supported: zero deflection at both supports. Measured ≤ 6.2e-16.
        assert.ok(Math.abs(y[0]) < 1e-12 && Math.abs(y[N - 1]) < 1e-12,
          `beamBending does not vanish at the supports: ${y[0]}, ${y[N - 1]}`);
      }
    });

    test('beamBending scales the load with the mode, q̂ₙ ∝ (nπ)⁴, at constant deflection (#R8)', () => {
      // This is the row's claim, and it is the whole reason the entry is visible:
      // each mode is drawn under the load that gives it the same peak deflection,
      // so the picture shows mode shape and not the 1/n⁴ softening. If anyone
      // puts a fixed load back, the deflections stop matching and the ratio of
      // recovered loads collapses to 1.
      const beam = MATH_COLLECTIONS.differentialEqs.formulas.beamBending;
      const N = 2001;
      const row = p => {
        const y = new Float64Array(N);
        for (let i = 0; i < N; i++) y[i] = beam.f((7 * (i / (N - 1)) - 3.5) / p.freq, 0, 0, p);
        return y;
      };
      const coeff = (y, m) => {
        const h = 1 / (y.length - 1);
        let s = 0;
        for (let i = 0; i < y.length; i++) s += y[i] * Math.sin(m * Math.PI * i * h);
        return 2 * h * s * Math.pow(m * Math.PI, 4);
      };
      const peakOf = y => { let d = 0; for (const v of y) d = Math.max(d, Math.abs(v)); return d; };

      // comp → n = round(1 + comp·4): 0 → 1, 0.5 → 3, 0.9 → 5.
      const y1 = row({ amp: 0.7, freq: 1, comp: 0 });
      const y3 = row({ amp: 0.7, freq: 1, comp: 0.5 });
      const y5 = row({ amp: 0.7, freq: 1, comp: 0.9 });
      // Recovered loads: 30.6839, 2485.39, 19177.4 — ratios (3/1)⁴ = 81 and
      // (5/3)⁴ = 7.716049382716. Measured 7.7160493827160455, error 7e-16.
      assert.ok(Math.abs(coeff(y5, 5) / coeff(y3, 3) / Math.pow(5 / 3, 4) - 1) < 1e-9,
        `q̂₅/q̂₃ = ${coeff(y5, 5) / coeff(y3, 3)}, expected ${Math.pow(5 / 3, 4)}`);
      assert.ok(Math.abs(coeff(y3, 3) / coeff(y1, 1) / Math.pow(3, 4) - 1) < 1e-9,
        `q̂₃/q̂₁ = ${coeff(y3, 3) / coeff(y1, 1)}, expected 81`);
      // …and the deflection those loads produce is the same for every mode:
      // 0.315 = 0.45·amp at amp 0.7. Under the fixed load this entry used to
      // carry, the three peaks were 2.46e-2, 3.04e-4 and 3.94e-5.
      const d = [y1, y3, y5].map(peakOf);
      assert.ok(Math.abs(d[1] / d[0] - 1) < 1e-12 && Math.abs(d[2] / d[0] - 1) < 1e-12,
        `beamBending peak deflection varies with the mode: ${d.join(', ')}`);
    });

    test('beamBending is finite and grid-independent across 25 / 90 / 161 (#R8)', () => {
      const beam = MATH_COLLECTIONS.differentialEqs.formulas.beamBending;
      const AMP = [0.7, 1.0, 1.5, 2.25];
      const FREQ = [0.3, 0.7, 1.0, 1.3, 2.0, 3.5, 4.55];
      const COMP = [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      const peak = (p, g) => {
        const hf = generateSurfaceFromFormula(beam.f, p, g, 3.5, 0);
        let m = 0;
        for (let i = 0; i < hf.length; i++) m = Math.max(m, Math.abs(hf[i]));
        return m;
      };
      // Finiteness has to be read off the KERNEL, not off the height field:
      // generateSurfaceFromFormula ends with `isFinite(y) ? y : 0`, so a NaN
      // arrives as a flat 0 and an assertion on its output can never fail.
      // Checked: injecting `NaN` for freq > 4 leaves this test green when the
      // check is written against the height field, and red when it is written
      // against beam.f.
      for (const amp of AMP) for (const freq of FREQ) for (const comp of COMP) {
        for (let i = 0; i < 41; i++) for (let j = 0; j < 41; j++) {
          const x = -3.5 + 7 * i / 40, z = -3.5 + 7 * j / 40;
          const v = beam.f(x, z, 0, { amp, freq, comp });
          assert.ok(Number.isFinite(v),
            `beamBending returns ${v} at x=${x}, z=${z}, ${JSON.stringify({ amp, freq, comp })}`);
        }
      }
      let worst = 1, at = null;
      for (const amp of AMP) for (const freq of FREQ) for (const comp of COMP) {
        const v = [25, 90, 161].map(g => peak({ amp, freq, comp }, g));
        const r = Math.max(...v) / Math.min(...v);
        if (r > worst) { worst = r; at = { amp, freq, comp, v }; }
      }
      // Measured 1.1547, at freq 2 / comp 0.7 (n = 4 squeezed into half the
      // plate: grid 25 has 24 intervals over 7 world units and simply misses the
      // crest). This is sampling of a fixed smooth shape, not a grid-dependent
      // formula — the same 1.1547 was measured before the repair, since the
      // change is a per-mode constant.
      assert.ok(worst < 1.25, `beamBending peak moves by ×${worst} across grids at ${JSON.stringify(at)}`);
    });

    test('beamBending is static in the clock and moves only through the sliders (#R8)', () => {
      // A static load on a static beam has a time-independent deflection, so the
      // absence of t is correct rather than an omission — nothing was added to
      // make it move. What the audio moves is the load (amp, from bass) and the
      // mode (comp = 0.5 + mid·0.4, from mid), so the surface is not frozen in
      // the app even though the kernel ignores the clock.
      const beam = MATH_COLLECTIONS.differentialEqs.formulas.beamBending;
      const p = { amp: 1.2, freq: 1.0, comp: 0.6 };
      const base = generateSurfaceFromFormula(beam.f, p, 61, 3.5, 0);
      for (const t of [1, 60, 3600]) {
        const hf = generateSurfaceFromFormula(beam.f, p, 61, 3.5, t);
        for (let i = 0; i < hf.length; i++) {
          assert.equal(hf[i] === base[i], true,
            `beamBending moved with the clock at t=${t}: ${hf[i]} vs ${base[i]}`);
        }
      }
      const rel = (a, b) => {
        let num = 0, den = 0;
        for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; num += d * d; den += a[i] * a[i]; }
        return Math.sqrt(num / den);
      };
      // Measured against the plate's own norm: mid 0 → comp 0.5 (n = 3) against
      // mid 1 → comp 0.9 (n = 5) changes it by 1.414 (two modes that share no
      // crest), and bass 0 → amp 0.7 against bass 1 → amp 1.05 by 0.333 (the
      // deflection is linear in the load). A static kernel is not a still picture.
      const midLo = generateSurfaceFromFormula(beam.f, { amp: 0.7, freq: 1, comp: 0.5 }, 61, 3.5, 0);
      const midHi = generateSurfaceFromFormula(beam.f, { amp: 0.7, freq: 1, comp: 0.9 }, 61, 3.5, 0);
      const bassHi = generateSurfaceFromFormula(beam.f, { amp: 1.05, freq: 1, comp: 0.5 }, 61, 3.5, 0);
      assert.ok(rel(midHi, midLo) > 0.2, `mid does not move beamBending: ${rel(midHi, midLo)}`);
      assert.ok(rel(bassHi, midLo) > 0.2, `bass does not move beamBending: ${rel(bassHi, midLo)}`);
    });

    test('beamBending is flat exactly where there is no beam, and that is most of the plate at high freq (#R8)', () => {
      // ξ = clamp((x·freq + 3.5)/7, 0, 1) puts the two supports at x = ±3.5/freq,
      // so above freq = 1 the beam occupies only 1/freq of the plate and the rest
      // is flat — zero deflection, which is the right height for "no beam here",
      // but it is a large part of the picture and the row has to say so. This is
      // measured rather than repaired: the same clamp is the collection's idiom
      // (schrodingerBox is identical), and freq has nothing else to mean for a
      // static deflection. Recorded so a future change to the mapping is a
      // decision and not an accident.
      const beam = MATH_COLLECTIONS.differentialEqs.formulas.beamBending;
      const N = 1401;
      for (const [freq, want] of [[1.0, 0], [1.3, 1 - 1 / 1.3], [2.0, 0.5], [3.5, 1 - 1 / 3.5], [4.55, 1 - 1 / 4.55]]) {
        let flat = 0;
        for (let i = 0; i < N; i++) {
          const x = -3.5 + 7 * i / (N - 1);
          if (Math.abs(beam.f(x, 0, 0, { amp: 2.25, freq, comp: 0.5 })) < 1e-15) flat++;
        }
        // Measured 0.002 / 0.232 / 0.503 / 0.716 / 0.782 against 1 − 1/freq.
        assert.ok(Math.abs(flat / N - want) < 0.02,
          `beamBending flat fraction at freq ${freq} is ${flat / N}, expected ${want}`);
      }
    });

  // ── a word that was not measured, and a degenerate plate edge ─────────────────
  test('densityMatrix draws geometric weights, not Boltzmann weights of the box spectrum', () => {
    // The row used to say "thermal". The states are particle-in-a-box states,
    // whose energies go as k² (sympy on −ħ²/2m ψ″ = Eψ over [0, L] gives
    // Eₙ = π²ħ²n²/2mL²), so a thermal mixture of them would weight them
    // e^{−βk²} — ratios pₖ₊₁/pₖ = e^{−β(2k+1)}, falling with k. What is drawn
    // is e^{−k/2}: a constant ratio. This test reads the weights back out of the
    // kernel rather than trusting the source line.
    //
    // comp sets n = round(1 + 4·comp), so comp = (n−1)/4 adds exactly one state.
    // At z = 0, freq = 1, amp = 1 the kernel is 0.3·Σ pₖ sin²(kπ(x + ½)), so the
    // difference between consecutive comps, read at x = 1/(2n) − ½ where
    // sin²(nπ(x + ½)) = 1, is 0.3·pₙ.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.densityMatrix.f;
    const at = (n, comp) => f(1 / (2 * n) - 0.5, 0, 0, { amp: 1, freq: 1, comp });
    const p = [];
    for (let n = 1; n <= 5; n++) {
      const here = at(n, (n - 1) / 4);
      const before = n === 1 ? 0 : at(n, (n - 2) / 4);
      p.push((here - before) / 0.3);
    }
    for (let k = 1; k <= 5; k++) {
      assert.ok(Math.abs(p[k - 1] - Math.exp(-k / 2)) < 1e-12,
        `p_${k} is ${p[k - 1]}, the kernel's stated e^{-k/2} is ${Math.exp(-k / 2)}`);
    }
    // constant ratio ⇒ geometric ⇒ Boltzmann for a ladder LINEAR in k
    for (let k = 0; k < 4; k++) {
      assert.ok(Math.abs(p[k + 1] / p[k] - Math.exp(-0.5)) < 1e-12,
        `ratio p_${k + 2}/p_${k + 1} is ${p[k + 1] / p[k]}, not the constant e^{-1/2}`);
    }
    // and NOT box-thermal: β fitted to the drawn p₂/p₁ is 1/6, and then the
    // box ratio p₃/p₂ would be e^{−5/6} = 0.434598, a long way from 0.606531.
    const boxRatio = Math.exp(-5 / 6);
    assert.ok(Math.abs(p[2] / p[1] - boxRatio) > 0.1,
      'the drawn ratio p₃/p₂ has become the box-thermal one — the row says geometric');
  });

  test('densityMatrix stays clear of its 0.7 ceiling over the whole slider box', () => {
    // This is the measurement that decided round 8 to fix the word rather than
    // the weights: e^{−k²/6} would pin 5.5–5.8 % of the plate at the ceiling,
    // while e^{−k/2} peaks at 0.6154 and never touches it.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.densityMatrix.f;
    let peak = 0;
    for (const amp of [0.7, 1.5, 2.25])
      for (const freq of [0, 1, 2.5, 4.55])
        for (const comp of [0, 0.25, 0.5, 0.75, 1]) {
          const hf = generateSurfaceFromFormula(f, { amp, freq, comp }, 45, 3.5, 0);
          for (const v of hf) {
            assert.ok(Number.isFinite(v), `non-finite height at amp ${amp} freq ${freq} comp ${comp}`);
            if (v > peak) peak = v;
          }
        }
    assert.ok(peak < 0.68, `peak ${peak} is at or against the 0.7 ceiling`);
    assert.ok(peak > 0.1, `peak ${peak} has fallen out of frame`);
  });

  test('densityMatrix tiles the well rather than showing it once', () => {
    // ψₖ = sin(kπ(x·freq + ½)): the well is x·freq ∈ [−½, ½], length 1, so the
    // plate's 7 units of x carry 7·freq wells — 7.00 at freq 1, 31.85 at 4.55.
    // The claim is checked as a periodicity, which is what tiling means.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.densityMatrix.f;
    for (const freq of [1, 2.5, 4.55])
      for (const x of [-2.3, -0.7, 0.11, 1.9])
        for (const z of [0, 0.3, -1.2]) {
          const a = f(x, z, 0, { amp: 0.7, freq, comp: 1 });
          const b = f(x + 1 / freq, z, 0, { amp: 0.7, freq, comp: 1 });
          assert.ok(Math.abs(a - b) < 1e-12,
            `period 1/freq broken at x ${x} freq ${freq}: ${a} vs ${b}`);
        }
    assert.equal(Math.round(7 * 1 * 100) / 100, 7);
    assert.equal(Math.round(7 * 4.55 * 100) / 100, 31.85);
  });

  test('lyapunov: the a = 4 edge is no longer the degenerate fixed-point value', () => {
    // With x₀ = 0.5 and a = 4 the orbit lands on the repelling fixed point 0 and
    // stays: 4·½·½ = 1, r·1·(1−1) = 0. Every |f′| is then exactly r, so λ becomes
    // the closed form ½(ln a + ln b) — a value that has nothing to do with the
    // attractor. That closed form is what this test forbids.
    const f = MATH_COLLECTIONS.fractals.formulas.lyapunov.f;
    const amp = 0.7, n = 21, step = 7 / (n - 1);
    for (const comp of [0, 0.5, 1]) {
      let minGap = Infinity;
      for (let i = 0; i < n; i++) {
        const z = -3.5 + i * step;
        const b = ((z + 3.5) / 7) * 1.4 + 2.6;
        const lam = f(3.5, z, 0, { amp, freq: 1, comp }) / (0.25 * amp);
        const degenerate = 0.5 * (Math.log(4) + Math.log(b));
        minGap = Math.min(minGap, Math.abs(lam - degenerate));
      }
      assert.ok(minGap > 0.5,
        `some vertex of the a = 4 edge sits on ½(ln a + ln b) (closest gap ${minGap}) at comp ${comp}`);
    }
  });

  test('lyapunov reproduces the published closed forms along a = b, r = 4 included', () => {
    // On x = z the driving sequence is constant, so the exponent has a closed
    // form: ln|2 − r| on the stable fixed point, ½ln|4 + 2r − r²| in the period-2
    // window, and ln 2 at r = 4 by the tent-map conjugacy. The tolerances are the
    // measured sampling scatter of 48–96 iterates, not a hope: the first four
    // land within 1.3e-5, and r = 4 within 0.03 at comp 0 and 0.0009 at comp 1.
    const f = MATH_COLLECTIONS.fractals.formulas.lyapunov.f;
    const amp = 0.7;
    const cases = [
      [-3.5, 2.6, Math.log(Math.abs(2 - 2.6)), 1e-9],
      [-2.5, 2.8, Math.log(Math.abs(2 - 2.8)), 1e-5],
      [-0.5, 3.2, 0.5 * Math.log(Math.abs(4 + 2 * 3.2 - 3.2 * 3.2)), 1e-9],
      [0.5, 3.4, 0.5 * Math.log(Math.abs(4 + 2 * 3.4 - 3.4 * 3.4)), 1e-3],
      [3.5, 4.0, Math.log(2), 0.05],
    ];
    for (const comp of [0, 0.5, 1])
      for (const [x, r, want, tol] of cases) {
        const got = f(x, x, 0, { amp, freq: 1, comp }) / (0.25 * amp);
        assert.ok(Math.abs(got - want) < tol,
          `r = ${r} at comp ${comp}: λ = ${got}, closed form ${want}, tolerance ${tol}`);
      }
    // and the corner is not the old ln 4
    const corner = f(3.5, 3.5, 0, { amp, freq: 1, comp: 1 }) / (0.25 * amp);
    assert.ok(Math.abs(corner - Math.log(4)) > 0.5,
      `the corner still reads ln 4 = ${Math.log(4)} (got ${corner})`);
  });

  test('lyapunov stays in frame, finite and grid-stable after the seed change', () => {
    const f = MATH_COLLECTIONS.fractals.formulas.lyapunov.f;
    let peak = 0;
    for (const amp of [0.7, 1.5, 2.25])
      for (const freq of [0, 1, 4.55])
        for (const comp of [0, 0.5, 1]) {
          const hf = generateSurfaceFromFormula(f, { amp, freq, comp }, 45, 3.5, 0);
          for (const v of hf) {
            assert.ok(Number.isFinite(v), `non-finite height at amp ${amp} freq ${freq} comp ${comp}`);
            if (Math.abs(v) > peak) peak = Math.abs(v);
          }
        }
    assert.ok(peak > 0.1 && peak < 2.5, `peak ${peak} is out of frame`);
    // the mean of |y| is the grid-stable statistic here — the peak of a fractal
    // rises as the mesh resolves more of it, and did so before this change too.
    const means = [25, 90, 161].map(g => {
      const hf = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, g, 3.5, 0);
      let s = 0;
      for (const v of hf) s += Math.abs(v);
      return s / hf.length;
    });
    const ratio = Math.max(...means) / Math.min(...means);
    assert.ok(ratio < 1.1, `mean |y| moves by ×${ratio} across grids 25/90/161`);
  });

  // ── the two kernels replaced wholesale, now with tests ─────────────────
  // Round 8 — topology/romanSurface and topology/boysSurface.
  //
  // Both entries were replaced wholesale and neither had a test. Every check below
  // is a property recovered FROM THE DRAWING: no test reads a constant out of the
  // kernel it is testing, so none of them would survive the entry being swapped
  // back for its predecessor. Verified by mutation — see
  // ~/notes/audits/vimathic-round8-2026-08-16/roman-boys.md for which mutation each
  // assertion catches, and for the mpmath/sympy work that fixed the tolerances.
  //
  // Helpers are inlined per test on purpose: this fragment shares a describe block
  // with other round-8 fragments and must not claim any names at block scope.

  test('romanSurface: every drawn point satisfies x²y²+y²z²+z²x² = r²xyz, with r² recovered from the drawing', () => {
    // Divide the entry's own equation by xyz and the left side becomes
    // xy/z + yz/x + zx/y, which is also a1²+a2²+a3² of the sphere preimage under
    // (a1,a2,a3) ↦ (a2a3, a3a1, a1a2). One quantity therefore carries both the
    // equation and the preimage, and on the surface it is the constant r² — so the
    // test can recover r² from the picture instead of being told it.
    // sympy solves the equation (it is quadratic in y, not quartic) and its lower
    // root is the shipped expression exactly; mpmath at 30 digits puts the kernel
    // 3.7e-16 from that root, and the worst residual below is 5.9e-16 of its own
    // scale over the slider box. 1e-12 leaves three decades of headroom and still
    // catches a kernel one part in 1e9 off the root.
    const f = MATH_COLLECTIONS.topology.formulas.romanSurface.f;
    const lattice = (n, rng = 3.5) => {
      const step = (2 * rng) / (n - 1), out = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push([-rng + i * step, -rng + j * step]);
      return out;
    };
    for (const [amp, freq, t] of [[0.7, 1, 0], [1.5, 1, 3.7], [1, 2, 9.1], [0.35, 1.7, 20]]) {
      const q = [], pts = [];
      for (const [x, z] of lattice(61)) {
        if (Math.abs(x) < 1e-9 || Math.abs(z) < 1e-9) continue;   // the double lines: y ≡ 0
        const y = f(x, z, t, { amp, freq, comp: 0.5 });
        assert.ok(Number.isFinite(y), `non-finite at ${x},${z}`);
        if (y === 0) continue;                                    // outside the surface's own disc
        q.push((x * y) / z + (y * z) / x + (z * x) / y);
        pts.push([x, y, z]);
      }
      assert.ok(q.length > 100, `only ${q.length} drawn points at amp=${amp} freq=${freq}`);
      const mean = q.reduce((a, b) => a + b, 0) / q.length;
      const spread = Math.max(...q) - Math.min(...q);
      assert.ok(mean > 0, `recovered r² is ${mean}, must be positive`);
      assert.ok(spread / mean < 1e-11,
        `r² recovered from the drawing is not constant: spread ${spread} on mean ${mean} ` +
        `(${(spread / mean).toExponential(3)} relative) at amp=${amp} freq=${freq} t=${t}`);
      // and the equation itself, in its own units, against that one recovered r²
      let worst = 0;
      for (const [x, y, z] of pts) {
        const t1 = x * x * y * y, t2 = y * y * z * z, t3 = z * z * x * x;
        const rhs = mean * x * y * z;
        worst = Math.max(worst, Math.abs(t1 + t2 + t3 - rhs) / Math.max(t1, t2, t3, Math.abs(rhs)));
      }
      assert.ok(worst < 1e-12,
        `quartic residual ${worst.toExponential(3)} of its own scale at amp=${amp} freq=${freq}`);
    }
  });

  test('romanSurface is compact: the drawn set is a disc, and its rim is finite', () => {
    // Steiner's surface is the image of a sphere, so it ends at the fold circle
    // ρ = r²/2 where the two sheets meet vertically. At the factory sliders that
    // circle is the plate's inscribed circle, so part of the mesh has no height to
    // carry — 23.70 % of it at grid 90, 23.78 % at 161. A kernel that draws
    // something everywhere is not this surface.
    const f = MATH_COLLECTIONS.topology.formulas.romanSurface.f;
    const lattice = (n, rng = 3.5) => {
      const step = (2 * rng) / (n - 1), out = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push([-rng + i * step, -rng + j * step]);
      return out;
    };
    const plate = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, 90, 3.5, 0);
    let empty = 0;
    for (const v of plate) {
      assert.ok(Number.isFinite(v), 'non-finite value reached the vertex buffer');
      if (v === 0) empty++;
    }
    const frac = empty / plate.length;
    assert.ok(frac > 0.15 && frac < 0.35,
      `${(100 * frac).toFixed(1)} % of the factory plate is empty; the fold circle is the ` +
      "plate's inscribed circle there, so it should be about 23.7 %");

    // drawn-ness depends on the radius alone: nothing beyond the outermost drawn
    // point, nothing missing inside it. The tolerance is one part in 1e9 because at
    // the factory sliders the fold circle passes exactly through lattice points,
    // where hypot and x*x+z*z disagree in the last bit.
    let rIn = 0, rOut = Infinity;
    for (const [x, z] of lattice(61)) {
      if (Math.abs(x) < 1e-9 || Math.abs(z) < 1e-9) continue;
      const y = f(x, z, 0, { amp: 0.7, freq: 1, comp: 0.5 });
      const r = Math.hypot(x, z);
      if (y === 0) rOut = Math.min(rOut, r); else rIn = Math.max(rIn, r);
    }
    assert.ok(rIn <= rOut * (1 + 1e-9),
      `drawn out to ${rIn} but empty already at ${rOut}: the drawn set is not a disc`);

    // the rim is a fold, not a singularity: 2xz/(r²+√…) never divides by the √, so
    // a fine radial scan across it stays finite and in frame
    for (const th of [0.3, Math.PI / 4, 1.1, 2.0]) {
      for (let k = 0; k <= 2000; k++) {
        const r = 3.3 + (0.4 * k) / 2000;
        const y = f(r * Math.cos(th), r * Math.sin(th), 0, { amp: 0.7, freq: 1, comp: 0.5 });
        assert.ok(Number.isFinite(y), `non-finite at radius ${r}, angle ${th}`);
        assert.ok(Math.abs(y) <= 2.5, `|y| = ${y} at the rim, out of frame`);
      }
    }
  });

  test('romanSurface: the drawn point has a real sphere preimage, and amp/freq move r² not the height', () => {
    // The preimage is what makes this Steiner's surface and not just a solution of
    // the quartic: a2² = xz/y must be positive, and the parametrisation
    // (a1,a2,a3) ↦ (a2a3, a3a1, a1a2) must give the drawn height back. The sphere's
    // radius then has to be one number per plate — and, because the entry grows the
    // surface rather than stretching it, r²·freq/amp has to be one number for the
    // whole slider box.
    const f = MATH_COLLECTIONS.topology.formulas.romanSurface.f;
    const lattice = (n, rng = 3.5) => {
      const step = (2 * rng) / (n - 1), out = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push([-rng + i * step, -rng + j * step]);
      return out;
    };
    const recovered = [];
    for (const [amp, freq] of [[0.7, 1], [1.5, 1], [0.7, 2], [2.25, 1.4], [0.2, 0.3], [1, 1]]) {
      const rs = [];
      for (const [x, z] of lattice(41)) {
        if (Math.abs(x) < 1e-9 || Math.abs(z) < 1e-9) continue;
        const y = f(x, z, 0, { amp, freq, comp: 0.5 });
        if (y === 0) continue;
        const a2sq = (x * z) / y;
        assert.ok(a2sq > 0, `no real preimage: a2² = ${a2sq} at ${x},${z}`);
        const a2 = Math.sqrt(a2sq), a3 = x / a2, a1 = z / a2;
        assert.ok(Math.abs(a1 * a3 - y) <= 1e-12 * (Math.abs(y) + 1),
          `the parametrisation does not return the drawn height: a3a1 = ${a1 * a3}, y = ${y}`);
        rs.push(a1 * a1 + a2 * a2 + a3 * a3);
      }
      assert.ok(rs.length > 100, `only ${rs.length} drawn points at amp=${amp} freq=${freq}`);
      const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      assert.ok((Math.max(...rs) - Math.min(...rs)) / mean < 1e-11,
        `the preimage sphere has no single radius at amp=${amp} freq=${freq}`);
      recovered.push([amp, freq, mean]);
    }
    const ks = recovered.map(([amp, freq, r2]) => (r2 * freq) / amp);
    for (let i = 0; i < ks.length; i++) {
      assert.ok(Math.abs(ks[i] - ks[0]) <= 1e-12 * ks[0],
        `r²·freq/amp is ${ks[i]} at amp=${recovered[i][0]} freq=${recovered[i][1]}, ` +
        `but ${ks[0]} at the factory sliders — the sliders are stretching the height`);
    }
  });

  test('boysSurface is a function on RP², not on a torus: the antipodal glide moves nothing', () => {
    // The plate is the sphere — θ across x, φ down z — so RP²'s antipodal map is the
    // glide (x, z) → (x + 3.5/freq, −z), and a height field on RP² cannot move under
    // it. Measured on the shipped kernel the residual is 5.6e-16 to 1.7e-15 on sups
    // of 0.34 to 1.51, i.e. about 1.2e-15 relative and exactly 0 once the plate is
    // rounded into the Float32 vertex buffer. The entry this replaced was invariant
    // under the torus's group instead and moved 0.5643 on a sup of 0.4928; it is
    // kept below as the negative control, so this guard cannot quietly stop working.
    const f = MATH_COLLECTIONS.topology.formulas.boysSurface.f;
    const torusStandIn = (x, z, t, { amp = 1, freq = 1 }) => {
      const u = x * freq * 2, v = z * freq * 2;
      const y = (Math.sin(u) * Math.cos(v / 2) + Math.sin(2 * u) * Math.cos(v / 2) ** 2) * 0.4;
      return y * amp * (1 + Math.sin(t * 0.3) * 0.15);
    };
    const glide = (fn, amp, freq, t) => {
      const dx = 3.5 / freq, step = 7 / 60;
      let res = 0, sup = 0;
      for (let j = 0; j <= 60; j++) {
        for (let i = 0; i <= 60; i++) {
          const x = -3.5 + i * step, z = -3.5 + j * step;
          const y = fn(x, z, t, { amp, freq, comp: 0.5 });
          assert.ok(Number.isFinite(y), `non-finite at ${x},${z}`);
          sup = Math.max(sup, Math.abs(y));
          if (x + dx > 3.5 + 1e-12) continue;
          res = Math.max(res, Math.abs(y - fn(x + dx, -z, t, { amp, freq, comp: 0.5 })));
        }
      }
      return { res, sup, ratio: res / sup };
    };
    for (const [amp, freq, t] of [[0.7, 1, 0], [1, 1, 0], [2.25, 1, 11.3], [1, 2, 0], [0.5, 0.7, 4]]) {
      const { res, sup, ratio } = glide(f, amp, freq, t);
      assert.ok(sup > 0.05, `nothing is drawn at amp=${amp} freq=${freq}`);
      assert.ok(ratio < 1e-11,
        `the height moves by ${res.toExponential(3)} on a sup of ${sup.toFixed(4)} under the ` +
        `antipodal identification at amp=${amp} freq=${freq} t=${t}: two-valued on RP²`);
    }
    const bad = glide(torusStandIn, 0.7, 1, 0);
    assert.ok(bad.ratio > 0.5,
      'the negative control did not fire: the doubly periodic stand-in moved only ' +
      `${bad.res.toExponential(3)} on a sup of ${bad.sup.toFixed(4)}`);
  });

  test('boysSurface: both edges of the plate are the single point where RP² closes', () => {
    // z = ∓3.5 is φ = 0 and φ = π, i.e. w = 0 and w = ∞ — antipodal on the sphere and
    // therefore ONE point of RP². The Bryant–Kusner immersion sends it to (0,0,−2)
    // in closed form (g = (0,0,−1/2), so g/|g|² = (0,0,−2)), which is also the lowest
    // point the immersion reaches; mpmath at 50 digits gives −2 to every digit and
    // the shipped kernel returns the two edges bit-identical.
    const f = MATH_COLLECTIONS.topology.formulas.boysSurface.f;
    const torusStandIn = (x, z, t, { amp = 1, freq = 1 }) => {
      const u = x * freq * 2, v = z * freq * 2;
      const y = (Math.sin(u) * Math.cos(v / 2) + Math.sin(2 * u) * Math.cos(v / 2) ** 2) * 0.4;
      return y * amp * (1 + Math.sin(t * 0.3) * 0.15);
    };
    for (const amp of [0.7, 1, 2.25]) {
      const p = { amp, freq: 1, comp: 0.5 };
      const lo = [], hi = [];
      for (let k = 0; k <= 40; k++) {
        const x = -3.5 + (7 * k) / 40;
        lo.push(f(x, -3.5, 0, p));
        hi.push(f(x, 3.5, 0, p));
      }
      const all = lo.concat(hi);
      const spread = Math.max(...all) - Math.min(...all);
      assert.ok(spread <= 1e-14,
        'the two z edges are φ = 0 and φ = π — one point of RP² — but the height ' +
        `spreads by ${spread.toExponential(3)} across them at amp=${amp}`);
      const plate = generateSurfaceFromFormula(f, p, 90, 3.5, 0);
      let min = Infinity;
      for (const v of plate) {
        assert.ok(Number.isFinite(v), 'non-finite value reached the vertex buffer');
        min = Math.min(min, v);
      }
      assert.ok(Math.abs(min - lo[0]) <= 1e-6 * Math.abs(lo[0]),
        `the edge sits at ${lo[0]} but the plate reaches ${min}: the edge is not the ` +
        'lowest point of the immersion');
    }
    const bad = [];
    for (let k = 0; k <= 40; k++) {
      bad.push(torusStandIn(-3.5 + (7 * k) / 40, -3.5, 0, { amp: 0.7, freq: 1 }));
    }
    assert.ok(Math.max(...bad) - Math.min(...bad) > 0.1,
      'the negative control did not fire: the stand-in was already constant along the edge');
  });

  test('romanSurface and boysSurface stay finite and in frame across the slider box and the grids', () => {
    // Both kernels are new and both have a branch the old ones did not: roman
    // returns a literal 0 where its discriminant goes negative, boys divides by a
    // denominator that vanishes at the triple point. Neither produces a non-finite
    // anywhere in the reachable box (amp 0.2..2.25, freq 0.3..4.55), and the peaks
    // measured there are 2.4504 for roman — against the closed-form ceiling r²/4 at
    // r² = 2√2·3.5, i.e. 2.4749 — and 1.5129 for boys, whose height is bounded by
    // (2 + 0.78)·amp·0.55 for every slider. The predecessor of romanSurface reached
    // 5.0939 at amp 0.7, freq 4.55 and would fail this.
    for (const key of ['romanSurface', 'boysSurface']) {
      const f = MATH_COLLECTIONS.topology.formulas[key].f;
      let worst = 0;
      for (const amp of [0.2, 0.7, 1.5, 2.25]) {
        for (const freq of [0.3, 1, 2, 4.55]) {
          for (const t of [0, 5.236, 10.472]) {
            for (const g of [25, 90, 161]) {
              const plate = generateSurfaceFromFormula(f, { amp, freq, comp: 0.5 }, g, 3.5, t);
              let peak = 0;
              for (const v of plate) {
                assert.ok(Number.isFinite(v),
                  `${key}: non-finite at amp=${amp} freq=${freq} t=${t} grid=${g}`);
                peak = Math.max(peak, Math.abs(v));
              }
              assert.ok(peak <= 2.5,
                `${key}: peak ${peak} out of frame at amp=${amp} freq=${freq} grid=${g}`);
              worst = Math.max(worst, peak);
            }
          }
        }
      }
      assert.ok(worst > 0.1, `${key}: nothing anywhere in the slider box reaches 0.1`);
      for (const g of [25, 90, 161]) {
        const factory = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, g, 3.5, 0);
        const pk = Math.max(...Array.from(factory, Math.abs));
        assert.ok(pk > 0.1 && pk < 2.5,
          `${key}: factory peak ${pk} at grid ${g} is outside the band its neighbours occupy`);
        assert.ok(Array.from(factory).some(v => v !== 0), `${key}: blank plate at grid ${g}`);
      }
    }
  });
});
