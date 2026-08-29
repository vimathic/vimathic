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

  test('dragon: bounded by amp alone, and no longer a tabletop', () => {
    // History of this assertion, because it has changed shape twice. Round 8
    // replaced clamp(v·amp, 0, 0.9) with a fold whose knee sat at the old
    // bound: the cut used to pin 40.5 % of the plate at amp 2.25 / freq 1 and
    // 92.6 % at amp 2.25 / freq 0.3 / comp 0.9 to exactly 0.9 — a density drawn
    // as a table. Round 11 removed the reason for either: the drawn quantity is
    // a normalised density in [0, 1], so the height is amp·1.2 at the very
    // most and nothing has to be folded to keep it in frame. What the test
    // still asks is the half that outlived both kernels — no plateau, and no
    // value outside the band the entry claims.
    const f = getFormula('fractals', 'dragon').f;
    for (const P of [BASELINE, { amp: 2.25, freq: 0.3, comp: 0.9 }, { amp: 2.25, freq: 4.55, comp: 1 }]) {
      const vals = [];
      for (let i = 0; i < 90; i++) {
        for (let j = 0; j < 90; j++) {
          const v = f(-3.5 + 7 * i / 89, -3.5 + 7 * j / 89, 0, P);
          assert.ok(v >= 0 && v <= P.amp * 1.2 + 1e-9,
            `Dragon out of bounds at amp ${P.amp}, freq ${P.freq}: ${v}`);
          vals.push(v);
        }
      }
      // Nonzero values only: outside the attractor's box the density is 0 by
      // construction, and at freq 4.55 that is most of the plate — counting
      // those as "the top value" would make this pass for the wrong reason.
      const live = vals.filter(v => v > 1e-9);
      const peak = Math.max(...live);
      const share = live.filter(v => v > peak - 1e-9).length / live.length;
      assert.ok(share < 0.05,
        `${(share * 100).toFixed(1)} % of the drawn set sits on the top value at amp ${P.amp}, freq ${P.freq} — that is a cut, not a density`);
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
// The bug: the cache key was `t` alone. `t` then advanced 0.008 per frame against a
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
    //
    // FIX(r8, review): `Number.isFinite(sf[i])` on the OUTPUT could not fail.
    // generateCollapseScalarField ends `out[i] = isFinite(s) ? s : 0`, exactly
    // as generateSurfaceFromFormula does, so a NaN θ or φ handed to the formula
    // arrives back as a zero and the assertion passes on the failure it was
    // written to catch. The angles are what the r = 0 branch is guarding, so
    // the angles are what is read: the probe records what it was called with.
    const same = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const seen = [];
    const fn = (theta, phi) => { seen.push([theta, phi]); return phi; };
    const sf = generateCollapseScalarField(fn, {}, same, 0);
    assert.equal(seen.length, 3, `the formula was called ${seen.length} times for 3 vertices`);
    for (const [i, [theta, phi]] of seen.entries()) {
      assert.ok(Number.isFinite(theta) && Number.isFinite(phi),
        `vertex ${i} was handed θ = ${theta}, φ = ${phi} — the r = 0 guard did not hold`);
    }
    // …and the value really reached the buffer rather than being replaced by
    // the isFinite() net, which is the substitution that hid the fault.
    for (let i = 0; i < sf.length; i++) {
      assert.equal(sf[i], Math.fround(seen[i][1]),
        `vertex ${i} carries ${sf[i]} where the formula returned ${seen[i][1]}`);
    }
    // Control: the probe reads the real angles, so a non-degenerate cloud gives
    // it something other than the zeros above.
    const spread = [];
    generateCollapseScalarField((th, ph) => { spread.push(ph); return ph; },
      {}, new Float32Array([1, 2, 3, -1, 0, 1, 0.5, -2, 4]), 0);
    assert.ok(Math.max(...spread) - Math.min(...spread) > 0.1,
      `the probe read φ ∈ [${Math.min(...spread)}, ${Math.max(...spread)}] on a spread-out cloud — ` +
      'it is not reading the angles at all');
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

// main.js advances `time` at 0.48 units per second of wall clock and never
// resets it (FIX(#50) — before it, 0.008 per rendered frame, which made this
// conversion true on a 60 Hz desktop only). Ten minutes into a
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
  // main.js `time += dt * 0.48` is the only mutation of the clock in the whole
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
    // hashed the global clock, which advances ~0.008 per 60 Hz frame
    // (0.48 units/s, FIX(#50)) and moves the sine argument 2.49 rad in that
    // step. One 60 fps frame changed the height field by 95% of its own peak.
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
    // (t advances ~0.008 per 60 Hz frame; the mobile path's counted frames
    // step twice that, so 0.008 is the finest step the app takes).
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
    // overview page while this file and README.md both read 128/40/24.
    //
    // FIX(r8, review): r7 read two SHAPES — the `| 🟢 A | n |` table and the
    // `n formulas use closed-form` prose — out of every shipped markdown file,
    // and five further copies of the same counts sat outside both of them:
    // MATHEMATICAL_ACCURACY.md's own "Tier A + B = 161" summary line, its three
    // marketing blockquotes ("161 mathematical formulas…", "161 formulas.
    // Verifiable accuracy.", "Tier C is 31 formulas"), its "All 126 Tier A
    // formulas" methodology line, and README's "161 of 192" headline plus the
    // "(126 + 35 + 31 = 192)" arithmetic in its own HTML comment. Widening the
    // WALK would not have found them — they are all in files already walked.
    //
    // So the guard is widened by shape, in two halves:
    //   * SHAPES below check the number wherever they match it, in any shipped
    //     markdown file;
    //   * the CENSUS then requires that every occurrence of a number that
    //     equals one of the counts, on a line that carries tier vocabulary, is
    //     inside one of those matches. A sixth copy written in a new sentence
    //     is therefore a failure of THIS test on the day the counts next move,
    //     naming the file and the line, rather than a silent stale claim.
    //
    // The limit of the census, stated because it is real: it recognises a copy
    // by the number being one the catalogue currently states. A brand-new copy
    // that is wrong on the day it is written is caught only if its shape is
    // listed. That is the failure the review found (four worktrees holding
    // stale copies of correct-at-the-time sentences), and it is the one this
    // closes.
    //
    // Nothing here is hard-coded: A/B/C come from the section rows walked
    // above, and A+B and the total are derived from them, so a later round that
    // moves a tier only has to move it in the table.
    const truth = { A: totA, B: totB, C: totC, AB: totA + totB, ALL: totA + totB + totC };
    const EMOJI = { '🟢': 'A', '🔵': 'B', '🟡': 'C' };
    const at = (m, s, from = 0) => m.index + m[0].indexOf(s, from);
    const SHAPES = [
      ['executive-summary row', /\|\s*\*\*([ABC])\*\*[^|]*\|\s*\*\*(\d+)\*\*\s*\|/g,
        m => [[m[1], m[2], at(m, m[2])]]],
      ['tier table row', /\|\s*(🟢 A|🔵 B|🟡 C)\s*\|\s*(\d+)\s*\|/gu,
        m => [[EMOJI[[...m[1]][0]], m[2], at(m, m[2])]]],   // [...] : the emoji is a surrogate pair
      ['N closed-form', /(?:^|[\s(])(\d+)\s+(?:formulas use\s+)?closed-form/gim,
        m => [['A', m[1], at(m, m[1])]]],
      ['All N Tier A', /\bAll\s+(\d+)\s+Tier\s+A\b/gi, m => [['A', m[1], at(m, m[1])]]],
      ['N validated approximations',
        /(?:^|[\s(])(\d+)\s+(?:use bounded numerical|(?:well-)?validated approximations)/gim,
        m => [['B', m[1], at(m, m[1])]]],
      ['N visualisation-grade', /(?:^|[\s(])(\d+)\s+(?:are\s+)?visuali[sz]ation-grade/gim,
        m => [['C', m[1], at(m, m[1])]]],
      ['Tier C is N', /\bTier\s+C\s+is\s+(\d+)\s+formulas/gi, m => [['C', m[1], at(m, m[1])]]],
      ['Tier A + B = N', /\bTier\s+A\s*\+\s*B\s*=\s*(\d+)\s+formulas/gi,
        m => [['AB', m[1], at(m, m[1])]]],
      ['N formulas, verifiable accuracy',
        /\b(\d+)\s+(?:mathematical\s+)?formulas[.,]?\s+(?:with\s+)?[Vv]erifiable/g,
        m => [['AB', m[1], at(m, m[1])]]],
      ['N of M formulas at verifiable accuracy',
        /\b(\d+)\s+of\s+(\d+)\s+formulas\s+at\s+verifiable/gi,
        m => [['AB', m[1], at(m, m[1])], ['ALL', m[2], m.index + m[0].lastIndexOf(m[2])]]],
      ['All N formulas mathematically exact', /\bAll\s+(\d+)\s+formulas\s+mathematically/gi,
        m => [['ALL', m[1], at(m, m[1])]]],
      ['Implements N canonical models', /\bImplements\s+(\d+)\s+canonical/gi,
        m => [['ALL', m[1], at(m, m[1])]]],
      ['(A + B + C = total)', /\((\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)\)/g, m => {
        const out = [];
        let cursor = 0;
        for (const [k, v] of [['A', m[1]], ['B', m[2]], ['C', m[3]], ['ALL', m[4]]]) {
          const idx = at(m, v, cursor);
          out.push([k, v, idx]);
          cursor = idx - m.index + v.length;
        }
        return out;
      }],
    ];
    // Vocabulary that makes a line a claim about the tiers rather than about a
    // formula. Deliberately narrow: the per-entry rows are full of numbers.
    const TIER_WORDS = /tier\s*[ABC]\b|closed[- ]form|verifiable\s+(?:numerical\s+)?accuracy|visuali[sz]ation[- ]grade|bounded\s+(?:numerical\s+)?(?:error|approximation)|validated\s+approximation|machine\s+precision|formulas\s+mathematically\s+exact|canonical\s+mathematical\s+models/i;
    const shipped = [...readdirSync(new URL('../', import.meta.url)).filter(n => n.endsWith('.md')).map(n => '../' + n),
                     ...readdirSync(new URL('../documents/', import.meta.url)).filter(n => n.endsWith('.md')).map(n => '../documents/' + n)];
    assert.ok(shipped.length >= 15, `only ${shipped.length} markdown files found — the walk is not reaching them`);
    let claimsSeen = 0;
    for (const rel of shipped) {
      const name = rel.replace('../', '');
      const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
      const covered = new Set();
      for (const [shape, re, pick] of SHAPES) {
        for (const m of text.matchAll(re)) {
          for (const [key, got, idx] of pick(m)) {
            covered.add(idx);
            claimsSeen++;
            if (+got !== truth[key]) {
              mismatches.push(`${name}: "${shape}" states ${key} = ${got}, the catalogue is ${truth[key]}`);
            }
          }
        }
      }
      let off = 0;
      for (const line of text.split('\n')) {
        // Per-entry rows are skipped: a tier count is never stated inside one,
        // and they carry hundreds of unrelated numbers. Measured — over the
        // whole of MATHEMATICAL_ACCURACY.md, README.md and documents/, the
        // values that sit beside tier vocabulary anywhere ELSE are 2, 12, 14,
        // 60 and 64, so the census can only collide with a future tier count if
        // one of the three tiers lands on one of those five. Without the skip
        // the collision set is 23 values wide and includes 25, 30, 32 and 40,
        // which are entirely reachable counts.
        if (/^\|\s*`[^`]+`\s*\|/.test(line)) { off += line.length + 1; continue; }
        if (TIER_WORDS.test(line)) {
          // A bare integer, and bare is doing work: not part of 10⁻¹⁴, not the
          // 754 of "IEEE 754" (out of range anyway), not a percentage, and not
          // the first half of a compound like "120-term cap" or "64×64" — those
          // count something that is not formulas, and one of them will collide
          // with a tier count the moment a later round moves one.
          for (const m of line.matchAll(/(?<![\d.⁻⁰¹²³⁴⁵⁶⁷⁸⁹×·-])(\d{1,3})(?![\d.⁻⁰¹²³⁴⁵⁶⁷⁸⁹%×·-])/g)) {
            if (!Object.values(truth).includes(+m[1]) || covered.has(off + m.index)) continue;
            mismatches.push(`${name}: a count "${m[1]}" no shape in this guard recognises, so nothing ` +
              `will update it when the tiers move — ${line.trim().slice(0, 100)}`);
          }
        }
        off += line.length + 1;
      }
    }
    // Control: the shapes really did read the documents. 28 claims were found
    // when this was written (13 in MATHEMATICAL_ACCURACY.md, 12 in README.md,
    // 3 in documents/index.md); a walk that reads nothing would report zero and
    // pass every comparison it never made.
    assert.ok(claimsSeen >= 20, `only ${claimsSeen} tier-count claims matched — the shapes have stopped reading the documents`);
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
    // Round 11 moved the orbit out of the entry and into dragonDensity(), which
    // runs it once instead of once per vertex; the two contractions are the
    // same two lines and this is still the place to read them.
    const from = src.indexOf('function dragonDensity(');
    assert.ok(from > 0, 'the dragon orbit is gone');
    const body = src.slice(from, src.indexOf('\n}', from));
    assert.ok(body.length > 100, 'could not isolate the dragon orbit');
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
    //
    // FIX(r8, review): this guard read ONE plate per entry — grid 90, t = 0 —
    // and both halves of that were wrong.
    //
    //   GRID. The app builds the plane with planeSegs ∈ {80, 160} (src/main.js,
    //   halved again for the low-detail variant), i.e. grids 41, 81 and 161.
    //   Ninety is a resolution it cannot produce, and it is EVEN, so it has no
    //   vertex at x = z = 0 — which is exactly where an orbital peaks. hydrogenS
    //   escaped through that hole for a whole round: 2.947 read at grid 90
    //   against 3.293 on 25/41/81/161, out of frame on every grid a user can
    //   actually see and in frame on the only one this test looked at. The grids
    //   below cover the three the app can draw — 161 contains 41 and 81, proved
    //   below rather than assumed — plus 90 and 91 so the parity is sampled both
    //   ways and the hole cannot come back.
    //
    //   CLOCK. t = 0 is one frame of an animation that never rewinds
    //   (0.48 units/s, monotone). An entry whose amplitude breathes is at its smallest
    //   at t = 0 as often as not. Four clock values are read; measured against a
    //   dense scan (t = 0…32 step 0.2, grid 91, all 192 entries) this set
    //   under-reads the true peak by at most ×1.42, and by ×1.14 for any entry
    //   whose dense peak is above 2.
    const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };
    const GRIDS = [90, 91, 161];
    const CLOCKS = [0, 2.6, 5.236, 10.472];   // 5.236 = π/0.6, where sin(0.3t) = 1
    const peakOf = (f, g, t) => {
      const hf = generateSurfaceFromFormula(f, FACTORY, g, 3.5, t);
      let p = 0;
      for (const v of hf) p = Math.max(p, Math.abs(v));
      return p;
    };
    // Grids 41 and 81 are not swept because they cannot add anything: their
    // sample sets are subsets of grid 161's (−3.5 + i·7/40 = −3.5 + 4i·7/160,
    // and ×4 is exact in binary), so max|y| over 161 is ≥ max over either. That
    // is an argument, so it is checked rather than believed — on a kernel with a
    // narrow spike, which is the case where a missed sample point would matter.
    {
      const spike = x => Math.exp(-400 * (x - 1.4) * (x - 1.4));
      for (const g of [41, 81]) {
        const coarse = [], fine = [];
        for (let i = 0; i < g; i++) coarse.push(-3.5 + i * (7 / (g - 1)));
        for (let i = 0; i < 161; i++) fine.push(-3.5 + i * (7 / 160));
        assert.ok(coarse.every(x => fine.includes(x)),
          `grid ${g} is not a subset of grid 161, so sweeping 161 alone no longer covers it`);
        assert.ok(peakOf(spike, 161, 0) >= peakOf(spike, g, 0),
          `grid ${g} reads a spike taller than grid 161 does — the subset argument is broken`);
      }
    }
    const offenders = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        let worst = 0, atG = 0, atT = 0;
        for (const g of GRIDS) for (const t of CLOCKS) {
          const p = peakOf(entry.f, g, t);
          if (p > worst) { worst = p; atG = g; atT = t; }
        }
        if (worst > 3.0) offenders.push(`${colId}/${key} peak ${worst.toPrecision(4)} at grid ${atG}, t = ${atT}`);
      }
    }
    // Control 1 — the sweep can see a plate that is out of frame, and does not
    // flag one that is not. Without this the "no offenders" above could equally
    // mean the loop never ran.
    const flat = h => () => h;
    assert.ok(GRIDS.some(g => peakOf(flat(3.7), g, 0) > 3.0), 'the sweep cannot see a plate at 3.7');
    assert.ok(GRIDS.every(g => peakOf(flat(2.9), g, 0) <= 3.0), 'the sweep flags a plate at 2.9');
    // Control 2 — the grid list is doing the work the comment says. hydrogenS
    // peaks at the origin, so grid 90 (even, no vertex there) reads it 11.8 %
    // low: 2.5554 against 2.8560 on 41/81/161. If that gap closes, the parity
    // argument for this grid list has stopped applying and wants re-deriving.
    const hs = MATH_COLLECTIONS.quantumMechanics.formulas.hydrogenS.f;
    const odd = Math.max(peakOf(hs, 41, 0), peakOf(hs, 81, 0), peakOf(hs, 161, 0));
    const even = peakOf(hs, 90, 0);
    assert.ok(odd / even > 1.05,
      `grid 90 reads hydrogenS at ${even.toPrecision(5)} and the odd grids at ${odd.toPrecision(5)} — ` +
      'the even-grid blind spot this list exists for is gone, so re-derive the list');
    assert.deepEqual(offenders, [], `out of frame before the operator touched anything:\n  ${offenders.join('\n  ')}`);
  });

  test('the audio-reachable envelope is a written-down measurement, not a cliff', () => {
    // The frame guard above is deliberately silent about over-drive: the top of
    // the slider range is the operator's to ask for. But the audio path moves
    // the sliders WITHOUT the operator touching anything — src/math-visualizer.js
    // multiplies amp by (1 + bass·0.5), waveInt by (1 + treble·0.3) and sets
    // comp = 0.5 + mid·0.4 — so with music playing the factory sliders sit near
    // amp 1.05, freq 1.3, comp 0.9 and ten or eleven entries stand outside the
    // ~3-unit frame there. That is a fact about the catalogue, not a bug this
    // round is fixing, and the review's complaint about the old guard was that
    // nothing anywhere wrote it down.
    //
    // So this test is a RECORD, and it fails in exactly two ways: a new entry
    // joins the list, or one already on it gets taller. An entry that gets
    // SHORTER drops off silently — repairing an offender must not turn a
    // recording into a red suite. (topology/crossCap is under repair in this
    // same round for the frame guard above; its row here will go stale in the
    // safe direction and wants re-measuring next round.)
    const AUDIO = { amp: 1.05, freq: 1.3, comp: 0.9 };
    const GRIDS = [41, 91, 161];
    const CLOCKS = [0, 5.236];
    // Measured 2026-08-16 over those grids and clocks, worst over both.
    const RECORD = {
      'linearAlgebra/matrixExp': 33.7744,
      'trigonometry/hyperbolicGeom': 11.6043,
      'topology/crossCap': 7.8255,
      'linearAlgebra/determinant': 6.5210,
      'linearAlgebra/quadraticForm': 5.7817,
      'complexNumbers/cauchyRiemann': 4.6953,
      'differentialEqs/laplacePDE': 4.3475,
      'quantumMechanics/hydrogenS': 4.2840,
      'topology/hyperbolicParaboloid': 4.2791,
      'linearAlgebra/tensorField': 3.8345,
      'topology/enneperSurface': 3.5337,
    };
    const measured = {};
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        let worst = 0;
        for (const g of GRIDS) for (const t of CLOCKS) {
          const hf = generateSurfaceFromFormula(entry.f, AUDIO, g, 3.5, t);
          for (const v of hf) { const a = Math.abs(v); if (a > worst) worst = a; }
        }
        if (worst > 3.0) measured[`${colId}/${key}`] = worst;
      }
    }
    const news = Object.keys(measured).filter(k => !(k in RECORD));
    assert.deepEqual(news.map(k => `${k} ${measured[k].toPrecision(5)}`), [],
      'entries stand outside the frame at the audio envelope that this record does not ' +
      'mention. Measure them, put them in RECORD, and say so in MATHEMATICAL_ACCURACY.md ' +
      `rather than deleting this list:\n  ${news.map(k => `${k} ${measured[k].toPrecision(5)}`).join('\n  ')}`);
    const worse = [];
    for (const [k, was] of Object.entries(RECORD)) {
      if (!(k in measured)) continue;                       // repaired: the record is stale downward
      if (measured[k] > was * 1.02) worse.push(`${k} ${was} → ${measured[k].toPrecision(6)}`);
    }
    assert.deepEqual(worse, [], `already outside the frame at the audio envelope and now taller:\n  ${worse.join('\n  ')}`);
    // Control: the sweep really reached the catalogue and the envelope really is
    // over-driving. Both numbers below were measured, not assumed.
    assert.ok(Object.keys(measured).length >= 6,
      `only ${Object.keys(measured).length} entries measured over 3.0 at the audio envelope, ` +
      'where 11 were recorded — the sweep has stopped reading the catalogue');
    const q = MATH_COLLECTIONS.quantumMechanics.formulas.hydrogenS.f;
    const atFactory = generateSurfaceFromFormula(q, { amp: 0.7, freq: 1, comp: 0.5 }, 161, 3.5, 0);
    let fp = 0;
    for (const v of atFactory) fp = Math.max(fp, Math.abs(v));
    assert.ok(fp < 3.0 && measured['quantumMechanics/hydrogenS'] > 3.0,
      `hydrogenS reads ${fp.toPrecision(5)} at the factory sliders and ` +
      `${(measured['quantumMechanics/hydrogenS'] || 0).toPrecision(5)} at the audio envelope — ` +
      'the two envelopes are supposed to differ, and this control says whether they still do');
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
  // LFOs at 0.7, 0.9 and 1.1 rad/s and main.js advances the formula clock at
  // 0.48 units/s — ~0.008 per 60 Hz frame, which is what k models below
  // (FIX(#50)). So "silence" is not a constant — every parameter
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
    // FIX(r8, review): the previous version of this test stayed GREEN under the
    // exact pre-round-8 rule `ax <= 8`, and both halves of it were the reason.
    //
    //   * its bound was ABSOLUTE (1e-7) while Ai decays exponentially — |Ai(8)|
    //     is 4.7e-8, so the entire right branch could be replaced by a constant
    //     and still clear an absolute 1e-7;
    //   * its own control injected a step of 1e-6, which is 150× the largest
    //     seam this kernel can produce, so "the control fires" said nothing
    //     about the resolution at the seams that matter;
    //   * `for (xi = -24; xi <= 24; xi += 0.05)` accumulates, so the scan misses
    //     the grid point it means to land on: ξ = 8 comes out as 7.99999999…,
    //     which is on the SAME side of the ax ≤ 8 threshold as 8 − d.
    //
    // What replaces it: a table from mpmath at 50 dps, straddling both
    // handovers (±6.9 / ±7.1 around the right one, ±9.9 / ±10.1 around the
    // left, plus ±8, ±12, ±20), read at an absolute AND a relative bound; and a
    // seam statistic normalised by the local |Ai|. Measured on the shipped
    // kernel: worst abs 5.22e-9 at ξ = −10.1, worst rel 6.08e-6 at ξ = +6.9
    // (that one is the alternating series' own cancellation, not a seam), seam
    // 4.44e-6. Under `ax <= 8` the same three read 2.37e-8 / 3.58e-3 / 7.82e-4,
    // so the relative bound and the seam statistic both go red and the absolute
    // one does not — which is the point: on the decaying branch only a relative
    // bound has any grip.
    //
    // The oracle controlled itself before being written down: Ai(0) against
    // 3^(−2/3)/Γ(2/3) (agree to 0), Ai(−10) against DLMF 9.6.6 in Bessel J
    // (6.8e-51), Ai(8) against DLMF 9.6.1 in Bessel K (5.6e-58).
    const REF = [
      [-20, -0.17640612707798468959],
      [-12, -0.0665551750543731294742],
      [-10.1, -0.0597268111334541563058],
      [-9.9, 0.136235026447979751401],
      [-8, -0.0527050503563862026221],
      [-7.1, 0.254036328561978364404],
      [-6.9, 0.101687997739764515761],
      [6.9, 9.78611333926603763118e-7],
      [7.1, 5.72532288587765725851e-7],
      [8, 4.69220761609923162565e-8],
      [9.9, 1.51819581410491187114e-10],
      [10.1, 8.02650470290959510307e-11],
      [12, 1.39318468887536083905e-13],
      [20, 1.69167286867054031355e-27],
    ];
    let worstAbs = 0, atAbs = 0, worstRel = 0, atRel = 0;
    for (const [xi, want] of REF) {
      const a = Math.abs(ai(xi) - want), r = a / Math.abs(want);
      if (a > worstAbs) { worstAbs = a; atAbs = xi; }
      if (r > worstRel) { worstRel = r; atRel = xi; }
    }
    // 5e-8 is 9.6× the measured 5.22e-9; a handover moved to ξ = 6 on the
    // oscillating side (where |Ai| is O(1)) costs 8.9e-7 and trips it.
    assert.ok(worstAbs < 5e-8,
      `Ai is out by ${worstAbs.toExponential(3)} at ξ = ${atAbs}, against mpmath at 50 dps`);
    // 1e-4 is 16× the measured 6.08e-6; `ax <= 8` reads 3.6e-3 here.
    assert.ok(worstRel < 1e-4,
      `Ai is out by ${worstRel.toExponential(3)} RELATIVE at ξ = ${atRel} — the decaying ` +
      'branch has no absolute error worth measuring, only a relative one');

    // A handover between two series is discontinuous or it is not, and the way
    // to see it is against the function's own slope: over the same width, a
    // seam that steps moves further than the smooth neighbourhood beside it.
    // Scanning the whole reachable ξ finds a seam wherever it was put, which a
    // list of thresholds copied out of the kernel would not. The step is
    // measured against the local |Ai| for the same reason the table is: an
    // absolute step of 1e-10 is nothing at ξ = −10 and everything at ξ = +10.
    const d = 1e-6, STEP = 0.05, LO = -24, N = Math.round(48 / STEP) + 1;
    const xs = [], mag = [];
    for (let i = 0; i < N; i++) { const x = LO + i * STEP; xs.push(x); mag.push(Math.abs(ai(x))); }
    const localScale = i => {
      let m = 0;
      for (let k = Math.max(0, i - 4); k <= Math.min(N - 1, i + 4); k++) m = Math.max(m, mag[k]);
      return m;
    };
    const seam = g => {
      let worst = -Infinity, at = 0;
      for (let i = 0; i < N; i++) {
        const xi = xs[i];
        const jump = Math.abs(g(xi + d) - g(xi - d));
        const smooth = Math.max(Math.abs(g(xi - d) - g(xi - 3 * d)), Math.abs(g(xi + 3 * d) - g(xi + d)));
        // |·| and not (jump − smooth): on the oscillating branch the slope term
        // |Ai′|·2d ≈ 2e-6 is twenty times any real seam and the two can subtract,
        // which is how a genuine 1.16e-8 step at ξ = −8 used to read as −1.16e-8.
        const rel = Math.abs(jump - smooth) / Math.max(localScale(i), Number.MIN_VALUE);
        if (rel > worst) { worst = rel; at = xi; }
      }
      return { worst, at };
    };
    const got = seam(ai);
    assert.ok(got.worst < 1e-4,
      `Ai steps by ${got.worst.toExponential(2)} of its own local size beyond its own slope ` +
      `near ξ = ${got.at.toFixed(2)}`);
    // Control, and this time sized to the bound rather than to nothing in
    // particular: a RELATIVE step of 1e-3 injected at ξ = 5 reads ≈ 7e-4 here,
    // seven times the bound, while the unmutated kernel reads 4.4e-6. A
    // relative step is also the right shape of fault — a handover that picks
    // the worse of two series is wrong by a fraction of Ai, not by a constant,
    // and an additive 1e-6 injected where Ai is 1e-18 measures nothing but the
    // rounding of 1e-6.
    const control = seam(xi => ai(xi) * (xi > 5 ? 1 + 1e-3 : 1));
    assert.ok(control.worst > 1e-4,
      `the scan reads a deliberate 1e-3 relative step as ${control.worst.toExponential(2)}, ` +
      'so its silence on the real handovers means nothing');
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

  test('every entry touched in round 8 stays finite and in frame across grids 41/90/161', () => {
    // The finiteness half deliberately calls the kernel rather than
    // generateSurfaceFromFormula: that function ends with
    // `out[i] = isFinite(y) ? y : 0`, so a NaN check run through it can never
    // fail. Checked — with the r === 0 branch taken out of sinc, so that the
    // origin returns 0/0, the plate still reads all-finite.
    //
    // FIX(r8, review): two holes, both in what the sweep visited rather than in
    // how it looked.
    //
    //   * freq and comp were swept only at their ENDS — {0.3, 4.55} and {0, 1} —
    //     so the factory values (freq 1, comp 0.5), the ones the app boots with
    //     and the ones every reader assumes are covered, were never visited by
    //     this test at all. Both are in the lists now.
    //   * the frame bound was 25, against a swept band of 1.65e-2 … 12.01: two
    //     hundred times the peak of the smallest entry. Measured, hydrogen2p can
    //     be scaled ×60 with the whole suite still green. It is replaced by a
    //     per-entry band — the measured extreme with a 25 % margin — plus the
    //     3.0 the rest of the suite calls the frame, asserted at the factory
    //     sliders where 3.0 is the right number. Under this, ×1.3 on any of the
    //     eleven is red.
    //
    // Grid 25 is dropped for 41: the app builds the plane at planeSegs 80 or 160
    // (halved for the low-detail variant), i.e. grids 41, 81 and 161, and 25 is
    // a resolution nothing can ask for. 90 stays because it is even, and the
    // even grids are the ones with no vertex at the origin.
    const targets = [
      // col, key, [box floor, box ceiling] measured over the sweep below at t = 3.7
      ['specialFunctions', 'sinc', 0.2641, 1.3500],
      ['integralTransforms', 'fourierInverse', 0.3207, 1.1250],
      ['trigonometry', 'pythagorean', 0.3148, 1.0125],
      ['linearAlgebra', 'gram', 0.2463, 12.0067],
      ['fourierSeries', 'fejerKernel', 0.0839, 2.1600],
      ['fourierSeries', 'dirichletKernel', 0.2089, 3.9150],
      ['complexNumbers', 'complexLog', 0.4674, 1.6807],
      ['quantumMechanics', 'hydrogenS', 1.7220, 9.1800],
      ['quantumMechanics', 'hydrogen2p', 0.0165, 0.1218],
      ['quantumMechanics', 'atomicOrbitals', 0.0301, 0.1194],
      ['probability', 'entropyLandscape', 0.3148, 1.0125],
    ];
    const GRIDS = [41, 90, 161];
    for (const [col, key, floor, ceiling] of targets) {
      const f = MATH_COLLECTIONS[col].formulas[key].f;
      let boxHi = 0, boxLo = Infinity;
      for (const grid of GRIDS) {
        const step = 7 / (grid - 1);
        for (const amp of [0.7, 2.25]) {
          for (const freq of [0.3, 1, 4.55]) {
            for (const comp of [0, 0.5, 1]) {
              let peak = 0;
              for (let zi = 0; zi < grid; zi++) {
                for (let xi = 0; xi < grid; xi++) {
                  const y = f(-3.5 + xi * step, -3.5 + zi * step, 3.7, { amp, freq, comp });
                  assert.ok(Number.isFinite(y),
                    `${col}/${key} returned ${y} at grid ${grid}, amp ${amp}, freq ${freq}, comp ${comp}`);
                  peak = Math.max(peak, Math.abs(y));
                }
              }
              boxHi = Math.max(boxHi, peak);
              boxLo = Math.min(boxLo, peak);
            }
          }
        }
      }
      assert.ok(boxHi <= ceiling * 1.25 && boxLo >= floor * 0.8,
        `${col}/${key} peaks between ${boxLo.toPrecision(4)} and ${boxHi.toPrecision(4)} over the ` +
        `reachable box; the recorded band is ${floor}…${ceiling} and the test allows ±25/20 %`);
      // …and at the sliders as they boot, the frame is 3.0, not a per-entry
      // number. Measured worst here: hydrogenS 2.856 on the odd grids.
      for (const grid of GRIDS) {
        const h = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, grid, 3.5, 3.7);
        let peak = 0;
        for (let i = 0; i < h.length; i++) peak = Math.max(peak, Math.abs(h[i]));
        assert.ok(peak > 1e-3 && peak <= 3.0,
          `${col}/${key} peak ${peak} at the factory sliders, grid ${grid}`);
      }
    }
  });

  test('hydrogen2p draws R₂₁(r)²·cos²(φ + 0.3t), checked against sympy away from both nodes', () => {
    // FIX(r8, review): round 8 removed a +0.01 from the shared hydrogenPsi
    // helper, which for 2p is not a constant factor but a 0.01 a₀ inward shift
    // that fills in the node at the origin — worth 1.04e-3, over the top of
    // tier B. Nothing defended that half of the repair: restoring the epsilon in
    // the n = 2, l = 1 branch alone leaves all 917 tests green, while restoring
    // it everywhere is caught twice by the hydrogenS tests.
    //
    // The oracle is sympy.physics.hydrogen.R_nl(2,1,r,1), controlled three ways
    // before use: ∫R²r²dr = 1 symbolically, an independent mpmath assembly of
    // the associated-Laguerre form r·e^{−r/2}/√24 agreeing to 2.9e-42, and the
    // published radial maximum of r²R² at exactly 4 a₀. The kernel draws
    // R₂₁(ρ)²·cos²(θ + 0.3t)·0.6·amp·4 with ρ = ½·freq·|x, z| and θ = atan2(z, x);
    // every point below is away from the r = 0 node and away from the angular
    // node θ + 0.3t = ±π/2, which is where the removed epsilon did its damage.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.hydrogen2p.f;
    const REF = [
      // x,    z,    t,   amp,  freq, want                    ρ,    cos²
      [1.0, 0.0, 0, 1, 1, 0.0151632664928158355901],       // 0.5,  1
      [2.4, 0.0, 0, 1, 1, 0.0433719665153571019169],       // 1.2,  1
      [1.5, 2.0, 0, 0.7, 1, 0.0112811263763699852003],     // 1.25, 0.36
      [-1.2, 0.9, 3.7, 2.25, 1, 0.0476904539883177032149], // 0.75, 0.797714
      [0.8, -0.6, 0, 0.7, 2.5, 0.0200553357802133070227],  // 1.25, 0.64
    ];
    for (const [x, z, t, amp, freq, want] of REF) {
      const got = f(x, z, t, { amp, freq, comp: 0.5 });
      // measured worst 2.8e-17 absolute, 6.2e-16 relative; 1e-15 is 36× that
      assert.ok(Math.abs(got - want) <= 1e-15,
        `hydrogen2p at (${x}, ${z}), t = ${t}, amp ${amp}, freq ${freq}: got ${got}, sympy says ${want}`);
    }
    // The node at the origin is a node: R₂₁(0) = 0 exactly, which is precisely
    // what the removed +0.01 was filling in.
    assert.equal(f(0, 0, 0, { amp: 1, freq: 1, comp: 0.5 }), 0,
      '2p has a node at r = 0 — a regulariser on r fills it in');
    // …and the lobe pair turns with the clock rather than standing still.
    const a = f(2.0, 0, 0, { amp: 1, freq: 1, comp: 0.5 });
    const b = f(2.0, 0, Math.PI / 0.6, { amp: 1, freq: 1, comp: 0.5 });
    assert.ok(Math.abs(a) > 0.03 && Math.abs(b) < 1e-30,
      `the lobe at (2, 0) reads ${a} at t = 0 and ${b} a quarter turn later — it does not turn`);
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
    // Nearly every odd mesh has a vertex exactly at the origin — 13 of the 100
    // odd grids in 3…201 do not, grid 83 among them, because the app's own
    // `-extent + xi*step` makes the centre column 4.44e-16 rather than 0 — and
    // the grid is round(sqrt(vertexCount)) of the SELECTED SHAPE, 24 discrete
    // values from 3 to 198, not planeSegs, which is only ever 80 or 160. So
    // this must not depend on parity. complexPower reads 0.07 at grid 83 too,
    // measured; the grids below stay as they are because 25 and 91 are the
    // corners this test was written against.
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
    // mesh whose spacing divides 1.5 — grid 15 has it at xi = 3 — and of the 19
    // grids the app can reach (3…198, set by the selected shape, not by
    // planeSegs, which is only ever 80 or 160) exactly two land on it: 15
    // (`icosahedron-smooth`, on both platforms) and 43 (`cylinder`, `cone`,
    // `disc` and both pyramids, all on mobile). The plane's own 81 and 161 miss
    // by 0.0125. `pyramid` was named on 15 here until its faces were meshed
    // (see snapRingsToPolygon in src/render.js); it draws at 43 on mobile now,
    // which is the other of the two, so the sentence's count is unchanged.
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
    for (const dx of [0, -1e-4, 1e-4, -1e-2, 1e-2]) {
      const y = evalAt('complexNumbers', 'blaschke', xp + dx, 0, 0, P);
      assert.ok(Number.isFinite(y), `blaschke is ${y} at x = ${xp + dx}`);
      near(y, 0.85, 1e-12, `blaschke at the pole + ${dx}`);
    }

    // FIX(r8, review): what stood here was
    //     assert.equal(1 - 0.6 * xp, 0, 'the exact-zero branch is reachable…')
    // — arithmetic on two literals. It mentions no kernel, no catalogue and no
    // import, so no change to this repository could ever have made it fail; it
    // asserted a property of IEEE doubles, which is not under test.
    //
    // The measurement it was reaching for is where the pole IS, and that can be
    // read back out of the drawing rather than restated from the source. |B|
    // blows up like C/|x − x₀| at a simple pole, so the set the fold pins to its
    // ceiling is an interval centred on x₀ to second order; bisecting for its
    // two edges and taking the midpoint locates the pole. Measured at amp 0.2
    // (where the ceiling set is narrow enough to be a local statement): the
    // midpoint misses 1/(0.6·freq) by 1.1e-3 of its own coordinate at every one
    // of the three freqs below, against a plateau half-width 30 times larger.
    // 1 % is nine times the measured error, and moving |aₖ| from 0.6 to 0.5
    // moves the pole by 20 % — this fires on that.
    const LOW = { amp: 0.2, freq: 1, comp: 0.5 };
    for (const freq of [0.3, 1, 2]) {
      const p = { ...LOW, freq };
      const pole = 1 / (0.6 * freq);
      const ceiling = evalAt('complexNumbers', 'blaschke', pole, 0, 0, p);
      const on = x => evalAt('complexNumbers', 'blaschke', x, 0, 0, p) >= ceiling - 1e-12;
      const edge = side => {
        let lo = pole, hi = pole + side * 3;
        assert.ok(!on(hi), `blaschke is at its ceiling 3 units from the pole at freq ${freq}`);
        for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (on(mid)) lo = mid; else hi = mid; }
        return lo;
      };
      const hiEdge = edge(1), loEdge = edge(-1), mid = (hiEdge + loEdge) / 2;
      assert.ok(hiEdge - loEdge > 1e-3,
        `the ceiling plateau at freq ${freq} is ${hiEdge - loEdge} wide — there is no pole to locate`);
      assert.ok(Math.abs(mid - pole) < 0.01 * pole,
        `the drawn pole sits at ${mid} where 1/(0.6·freq) is ${pole} (plateau ${loEdge}…${hiEdge})`);
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

    // FIX(r8, review): the "in frame" half used to read
    //     assert(Number.isFinite(v))            on the height field
    //     assert(peak >= 0.1 && peak <= 2.5)
    //     assert(|peak − prevGridPeak| < 1e-5)
    // and the first and second of those could not fail.
    //
    //   * generateSurfaceFromFormula ends with `out[i] = isFinite(y) ? y : 0`,
    //     so a NaN kernel arrives as a flat plate and a finiteness assertion on
    //     its output is unfailable by construction. (The kernel sweep above is
    //     the one that can fail, and it is kept.)
    //   * every return path of all three kernels goes through
    //     soften(·, ·, 0.85), and soften is knee + (ceil−knee)·tanh(…) with
    //     tanh < 1, so |y| < 0.85 identically. The asserted 2.5 was unreachable
    //     arithmetic, and the measured peak is float32(0.85) = 0.85000002 for
    //     five of the six cases below — the fold ceiling, not the surface. The
    //     grid-stability assertion inherited the same defect: a clipped peak
    //     cannot drift, so "drift < 1e-5" was measuring saturation.
    //
    // What is asserted instead is unclipped: the MEAN |y| over the plate, which
    // moves continuously with the surface, and the SHARE of the plate pinned
    // within 1e-6 of the ceiling, which is the thing the reader is entitled to
    // know. Both are recorded per setting, both were measured at grid 90 on
    // 2026-08-16, and the grid-stability assertion is moved onto the mean.
    // Measured: gains ×100 on any of the three move the ceiling share from a few
    // per cent to ~100 %, and a gain small enough to leave the fold moves the
    // mean by more than the band.
    const STATS = {
      //  key            amp   freq   mean@g90   ceiling-share % @ g90
      'complexPower|0.7': [0.135149, 2.099],
      'complexPower|2.25': [0.317585, 34.988],
      'mobiusTransform|0.7': [0.371714, 0.444],
      'mobiusTransform|2.25': [0.729851, 0.025],
      'blaschke|0.7': [0.777918, 3.951],
      'blaschke|2.25': [0.848080, 99.531],
    };
    for (const key of KEYS) {
      for (const p of [{ amp: 0.7, freq: 1, comp: 0.5 }, { amp: 2.25, freq: 4.55, comp: 1 }]) {
        const [wantMean, wantCeil] = STATS[`${key}|${p.amp}`];
        const means = [];
        for (const g of [41, 90, 161]) {           // the grids the app can draw
          const hf = generateSurfaceFromFormula(
            MATH_COLLECTIONS.complexNumbers.formulas[key].f, p, g, 3.5, 0);
          let sum = 0, peak = 0, atCeil = 0;
          for (const v of hf) {
            const a = Math.abs(v);
            sum += a; atCeil += a >= 0.85 - 1e-6 ? 1 : 0;
            peak = Math.max(peak, a);
          }
          const mean = sum / hf.length, ceilShare = (100 * atCeil) / hf.length;
          means.push(mean);
          // the one live half of the old peak assertion: a NaN kernel arrives as
          // a flat zero plate, and that is what this catches
          assert.ok(peak >= 0.1, `${key} plate is blank at grid ${g}, amp ${p.amp} (peak ${peak})`);
          assert.ok(Math.abs(mean - wantMean) <= 0.08 * wantMean,
            `${key} mean |y| is ${mean.toFixed(6)} at grid ${g}, amp ${p.amp}; recorded ${wantMean} ±8 %`);
          assert.ok(Math.abs(ceilShare - wantCeil) <= Math.max(0.8, 0.25 * wantCeil),
            `${key} pins ${ceilShare.toFixed(3)} % of the plate at the fold ceiling at grid ${g}, ` +
            `amp ${p.amp}; recorded ${wantCeil} %`);
        }
        // the mean is a statistic the fold does not pin, so it is worth asking
        // whether it is the same picture at every resolution. Measured worst
        // spread ×1.031 (complexPower at the factory sliders, grids 41 → 161).
        const spread = Math.max(...means) / Math.min(...means);
        assert.ok(spread < 1.06,
          `${key} mean |y| moves ×${spread.toFixed(4)} across grids 41/90/161 at amp ${p.amp}: ` +
          `${means.map(v => v.toFixed(6)).join(' → ')}`);
      }
    }
  });

  test('every row that quotes a fold coverage quotes the one its kernel actually draws (#R8)', () => {
    // FIX(r8, review): what stood here made zero kernel calls. It read
    // MATHEMATICAL_ACCURACY.md and asserted that three rows contained three
    // literal strings — a tier letter and a percentage — so a change to the
    // KERNEL that moved the coverage from 12 % to 90 % left it green, and a
    // change to the PROSE alone made it red. It was a spell-check on a
    // measurement. It also named exactly three entries by hand while ten
    // entries in the catalogue call soften().
    //
    // FIX(r8, correction pass): that rewrite still had three holes, and all
    // three are the same mistake — the walk was driven from the KERNELS and
    // the document only ever got to ANSWER, so anything the document could
    // stop saying, or a kernel could stop doing, fell out of the walk instead
    // of failing it. This is the seventh guard on this project to be green in
    // the direction that mattered, so each hole below is written with the
    // mutation that used to pass it.
    //
    //   H1 — a reverted fold escaped the walk entirely. The loop opened with
    //        `if (!body.includes('soften(')) continue;`, so an entry that
    //        STOPS folding was dropped in silence. Measured: replacing
    //        eulerIm's `return soften(exp(-z*freq)*sin(x*freq+t*0.4)*amp*0.45,
    //        0.9, 1.8)` with a hard clamp at ±0.9 — the exact pre-round-6
    //        defect — left this test green and the suite at 920/920 while the
    //        row went on reading "The fold covers a measured 24.4 % of the
    //        plate at the factory sliders" about a literal tabletop: 24.30 %
    //        of the grid-81 plate sat bit-exactly on 0.9. The only backstop,
    //        `folders.length >= 10`, tolerated losing two of the twelve.
    //        Closed by driving the walk from BOTH ends — the kernels that
    //        call soften() and the rows that claim a coverage are now two
    //        sets that must match in both directions — and, for a clamp that
    //        keeps a soften() call in the body, by the knee-pin check below.
    //   H2 — half a claim could be deleted in silence. The maxima check was
    //        `if (statedMax && …)` and the undocumented list was appended only
    //        when the FACTORY regex missed, so deleting "and 48.1 % at the
    //        slider maxima" from a row passed while corrupting the same number
    //        failed. The maxima sentence is now required of every folding
    //        entry: deletion is as loud as corruption.
    //   H3 — only grid 90 was read, and grid 90 is a mesh the app never draws.
    //        src/main.js sets `planeSegs: isMobile ? 80 : 160`, i.e. 81 and
    //        161 vertices a side, and src/render.js drops to 41/81 for the low
    //        LOD. Every per-mesh figure the rows state — the meshes a user
    //        actually sees — was unguarded prose. The 51 figures that name
    //        their grid (or name their sliders exactly) are now re-measured at
    //        the grid they name. What is still unguarded, and why, is listed
    //        at the foot of this test rather than left to be discovered.
    //
    // FIX(r8, final): two more, both proven by mutations that left the suite at
    // 920/920 and this test green. They are written out where the net that
    // closes each one stands, with the numbers measured on 2026-08-17.
    //
    //   H4 — a clamp that KEEPS its soften() call. The knee-pin below caught a
    //        clamp AT the knee and nothing else; clamping soften's argument at
    //        0.90001, 1.0 or 1.8 left every coverage figure bit-for-bit
    //        correct — soften is monotone — while 24.30 %, 22.92 % and 15.67 %
    //        of eulerIm's grid-81 factory plate sat on ONE value.
    //   H5 — FIGURE_FLOOR was a single global count, so one row's deleted
    //        figure could be paid for by another row's added one. It is a
    //        per-row floor now.
    //
    // The measurement, and it needs no instrumentation: soften(y, knee, ceil)
    // is the IDENTITY for |y| ≤ knee, so on the drawn plate the fold is active
    // exactly where |y| > knee. The knee is read out of each kernel's own
    // source rather than listed here, so an entry that starts folding, or moves
    // its knee, is covered without anybody remembering to add it.
    //
    // CONTROL for that oracle: an instrumented copy of the module that counts
    // soften() calls whose argument exceeds the knee was compared with |y| > knee
    // on the shipped module, ten entries × two settings × 8100 vertices — worst
    // disagreement 0 vertices. (Run once, offline; the equivalent inside the
    // suite is the structural check below that every soften() in a kernel is its
    // whole return value, which is what makes the two the same question.)
    //
    // Measured 2026-08-17 at grid 90, factory sliders → slider maxima. Twelve
    // entries fold: the ten below plus `dragon` and `complexSin`, whose clamps
    // became folds in this same round.
    //   blaschke 90.9 → 99.8   breatherSurface 82.4 → 100.0   catenoid 52.1 → 97.5
    //   eulerIm 24.4 → 48.1    mobiusTransform 22.6 → 99.4    complexPower 12.3 → 36.8
    //   scherkSurface 11.5 → 3.4   lyapunov 0.2 → 6.8   pseudosphere 0.1 → 53.7
    //   manifoldCurvature 0.0 → 83.1  dragon 0.0 → 26.5   complexSin 0.0 → 84.2
    // (The 48.2 and 0.2 recorded here on 2026-08-16 were stale by one decimal;
    // the measurements are 48.1481 and 0.1481, and they survived only because
    // the tolerance below is 0.5 pp.)
    // Every one of the twelve rows now states its figure, so the ratchet at the
    // end of this test is 0: an entry that starts folding, or a row that loses
    // its sentence, fails here rather than being recorded and passed over.
    const doc = readFileSync(new URL('../MATHEMATICAL_ACCURACY.md', import.meta.url), 'utf8');
    const rowOf = key => doc.split('\n').find(l => l.startsWith(`| \`${key}\` |`));
    // top-level arguments of each soften(…) call in a kernel's own source.
    // FIX(r8, final): this read the knee alone; it now reads the (knee, ceil)
    // pair, because the net under HOLE 4 below needs to know where the fold
    // stops spreading values apart. Requiring BOTH to be numeric literals is
    // stricter than what stood here, not looser: an entry that computes its
    // ceiling now fails the parse assertion instead of being measured against
    // a knee the guard could not place in a band.
    const softenBands = body => {
      const out = [];
      for (let i = body.indexOf('soften('); i >= 0; i = body.indexOf('soften(', i + 7)) {
        let depth = 0, start = i + 7, args = [];
        for (let j = i + 6; j < body.length; j++) {
          const ch = body[j];
          if (ch === '(') { depth++; if (depth === 1) start = j + 1; }
          else if (ch === ')') { depth--; if (depth === 0) { args.push(body.slice(start, j)); break; } }
          else if (ch === ',' && depth === 1) { args.push(body.slice(start, j)); start = j + 1; }
        }
        if (args.length === 3 && Number.isFinite(+args[1]) && Number.isFinite(+args[2])) {
          out.push({ knee: +args[1], ceil: +args[2] });
        }
      }
      return out;
    };
    const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };
    const MAXIMA = { amp: 2.25, freq: 4.55, comp: 1 };
    // The audio path's own ceiling, from src/math-visualizer.js: amp is
    // multiplied by (1 + bass·0.5), waveInt by (1 + treble·0.3) and
    // comp = 0.5 + mid·0.4, so a loud passage reaches amp 1.05 / freq 1.3 /
    // comp 0.9. Unlike the maxima it is a setting a listener actually gets.
    const ENVELOPE = { amp: 1.05, freq: 1.3, comp: 0.9 };
    // amp 1 with the other two left alone — the corner two rows quote by name.
    const AMP1 = { amp: 1, freq: 1, comp: 0.5 };
    const SETTING = { f: FACTORY, m: MAXIMA, e: ENVELOPE, a: AMP1 };

    // ── the two tolerances, and what actually sets them ────────────────────
    // FIX(r8, review): the comment that used to justify the ±0.5 pp read "the
    // rows quote one decimal, and the same coverage read at grids
    // 41/81/90/91/161 spans 0.5 pp for the widest of them (complexPower
    // 12.26…12.79)". The number in the parenthesis is right — complexPower's
    // factory coverage does span 0.53 pp over those five grids — but the claim
    // around it is false: complexPower is not the widest. scherkSurface spans
    // 11.46 pp over the same five grids (0.00 % at 41, 9.39 at 81, 11.46 at 90,
    // 9.61 at 91, 10.74 at 161), 23× this tolerance, and manifoldCurvature
    // spans 5.71 pp at the maxima (77.81 at 41 → 83.52 at 91). Both measured
    // 2026-08-17.
    //
    // Cross-grid spread is not what this tolerance is for, and could not be:
    // every figure is now re-measured at the grid its own sentence names, so a
    // tolerance able to absorb the spread would be a bug, not a safety margin.
    // What sets it:
    //   * the grid-90 sentences quote ONE decimal, so rounding alone costs up
    //     to 0.05 pp, and the worst of the 24 factory/maxima ones today is
    //     dragon at 0.0494 pp (worst of the two amp-1 corners, 0.0395) — i.e.
    //     every one of them is at rounding and nothing else, and 0.5 pp is 10×
    //     looser than the shipped tree needs;
    //   * V8's Math.sin/exp/pow are not correctly rounded and have moved
    //     between releases, so a handful of vertices may cross the knee on
    //     another engine. 0.5 pp is 40 vertices of grid 90's 8100.
    // The spread does set a ceiling on what this may be RAISED to: past
    // 11.46 pp, scherkSurface's grid-41 zero would satisfy its grid-90
    // sentence and "read at the grid it names" would stop meaning anything.
    const TOL_1DP = 0.5;
    // The per-mesh sentences quote TWO decimals, so rounding costs 0.005 pp and
    // the worst of the 49 two-decimal figures today is eulerIm's grid-81
    // factory one at 0.0049 pp (the other two of the 51 are the one-decimal
    // amp-1 corners, which take TOL_1DP). 0.15 pp is 10 vertices of grid 81
    // and 39 of grid 161 — room
    // for the same engine drift — and it is tight enough to tell the two app
    // meshes apart wherever they differ at all: at 0.15 pp a grid-81 figure
    // checked against grid 161 by mistake would be caught for complexPower,
    // scherkSurface and catenoid at the factory sliders and for dragon,
    // manifoldCurvature, scherkSurface and pseudosphere at the maxima. For the
    // rest the two meshes agree to better than 0.15 pp and NO tolerance can
    // distinguish them; that is a property of those surfaces, not a gap here.
    const TOL_2DP = 0.15;

    // ── the sentence shapes, read off the rows rather than imposed on them ──
    // Nine shapes for twelve rows, every one of them copied out of a row as it
    // stood on 2026-08-17. The guard does not ask a row to adopt a house
    // style: it asks that each row state its per-mesh figures in SOME shape
    // the guard can re-measure, and it counts them (FIGURE_FLOOR) so that
    // deleting a figure is as loud as corrupting one. A row reworded into a
    // tenth shape fails below with its own name in the message, and the repair
    // is to add the shape here — not to bend the prose.
    const FACTORY_RE = /The fold covers a measured \*\*([\d.]+) %\*\* of the plate at the (?:factory|FACTORY) sliders/;
    const MAXIMA_RE = /\*?\*?([\d.]+) %\*?\*? at the slider maxima/;
    const SHAPES = [
      // "…0.15 % and 6.86 % at grid 81 and 0.08 % and 6.82 % at 161"
      { name: 'pairs-after-value', tol: TOL_2DP,
        re: /([\d.]+) % and ([\d.]+) % at grid 81(?:,| and) ([\d.]+) % and ([\d.]+) % at 161/,
        slots: [['f', 81], ['m', 81], ['f', 161], ['m', 161]] },
      // "at grid 81 it is 9.39 % and 3.84 %, at 161 10.74 % and 5.66 %"
      { name: 'pairs-after-grid', tol: TOL_2DP,
        re: /at grid 81 it is ([\d.]+) % and ([\d.]+) %, at 161 ([\d.]+) % and ([\d.]+) %/,
        slots: [['f', 81], ['m', 81], ['f', 161], ['m', 161]] },
      // "at grid 41 0.00 % and 5.47 %" — the low-LOD mesh of src/render.js
      { name: 'grid41-pair', tol: TOL_2DP,
        re: /at grid 41 ([\d.]+) % and ([\d.]+) %/,
        slots: [['f', 41], ['m', 41]] },
      // "the three grids give 12.47 % (81), 12.35 % (90) and 12.26 % (161), and grid 41 gives 12.79 %"
      { name: 'three-grids', tol: TOL_2DP,
        re: /the three grids give ([\d.]+) % \(81\), ([\d.]+) % \(90\) and ([\d.]+) % \(161\), and grid 41 gives ([\d.]+) %/,
        slots: [['f', 81], ['f', 90], ['f', 161], ['f', 41]] },
      // "99.68 % (81) and 99.73 % (161) flat at the maxima"
      { name: 'flat-at-maxima', tol: TOL_2DP,
        re: /([\d.]+) % \(81\) and ([\d.]+) % \(161\) flat at the maxima/,
        slots: [['m', 81], ['m', 161]] },
      // "at grid 81 the factory coverage runs 15.79…42.72 % over one turn of
      //  the clock (mean 25.4, and 22.73 at t = 0)" — only the t = 0 figure is
      //  re-measurable from the sentence; the range is in the unguarded list.
      { name: 'clock-range-t0', tol: TOL_2DP,
        re: /at grid 81 the factory coverage runs [\d.]+…[\d.]+ % over one turn of the clock \(mean [\d.]+, and ([\d.]+) at t = 0\)/,
        slots: [['f', 81]] },
      // "with the audio envelope in between at 2.93 % and 3.14 %"
      { name: 'envelope-pair', tol: TOL_2DP,
        re: /with the audio envelope in between at ([\d.]+) % and ([\d.]+) %/,
        slots: [['e', 81], ['e', 161]] },
      // "at the audio envelope (amp 1.05 / freq 1.3 / comp 0.9) 38.65 % of the
      //  plate is folded at grid 81 and 38.21 % at 161"
      { name: 'envelope-named', tol: TOL_2DP,
        re: /at the audio envelope \(amp 1\.05 \/ freq 1\.3 \/ comp 0\.9\) ([\d.]+) % of the plate is folded at grid 81 and ([\d.]+) % at 161/,
        slots: [['e', 81], ['e', 161]] },
      // "— 92.3 % at amp 1, …" — one decimal, so TOL_1DP; grid 90, which both
      // rows using it state explicitly ("all counted at grid 90").
      { name: 'amp1-corner', tol: TOL_1DP,
        re: /([\d.]+) % at amp 1,/,
        slots: [['a', 90]] },
    ];

    // ── side one: the kernels that fold ────────────────────────────────────
    const kernelFolders = new Map();
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        const body = entry.f.toString();
        if (!body.includes('soften(')) continue;
        const bands = softenBands(body);
        assert.ok(bands.length > 0,
          `${colId}/${key} calls soften() but its knee and ceiling could not be parsed out of the kernel`);
        // every soften() in these kernels is the whole returned value, which is
        // what makes "|y| > knee" the same question as "the fold was active"
        assert.ok(/return\s+soften\(/.test(body) || /=>\s*soften\(/.test(body),
          `${colId}/${key} calls soften() somewhere other than its return, so |y| > knee no ` +
          'longer decides whether the fold was active — this test needs rewriting for it');
        // The shoulder: soften is knee + (ceil−knee)·tanh((|y|−knee)/(ceil−knee)),
        // so at |y| = knee + 3·(ceil−knee) it is already within 0.5 % of the band
        // of its ceiling and flat for every practical purpose — the module's own
        // header says as much ("past roughly knee + 3·(ceil − knee) the fold
        // flattens too"). Below that shoulder the fold is still strictly
        // spreading values apart, which is what HOLE 4's net rests on. For the
        // two entries with two soften() calls the bands are identical, so widest
        // knee-to-shoulder window and per-call window are the same thing today;
        // taking min knee and max shoulder is the strict choice if they diverge.
        kernelFolders.set(key, {
          colId, f: entry.f,
          knee: Math.min(...bands.map(b => b.knee)),
          shoulder: Math.max(...bands.map(b => b.knee + (b.ceil - b.knee) * Math.tanh(3))),
        });
      }
    }

    // ── side two: the rows that claim a fold ───────────────────────────────
    const claimants = [];
    for (const line of doc.split('\n')) {
      if (!FACTORY_RE.test(line)) continue;
      const named = /^\| `([^`]+)` \|/.exec(line);
      assert.ok(named,
        'a line of MATHEMATICAL_ACCURACY.md states a fold coverage but is not a keyed table row, ' +
        `so no kernel can be held to it:\n  ${line.slice(0, 200)}`);
      claimants.push(named[1]);
    }

    // ── HOLE 1: the two sides must agree in BOTH directions ────────────────
    // The kernel→document direction is the `undocumented` ratchet at the end,
    // which was already here. This is the document→kernel direction, which was
    // not, and it is the one that let a reverted fold through: an entry that
    // stops calling soften() simply left the walk.
    const plateStats = (f, p, g) => {
      const hf = generateSurfaceFromFormula(f, p, g, 3.5, 0);
      let peak = 0;
      for (const v of hf) peak = Math.max(peak, Math.abs(v));
      let pinned = 0;
      for (const v of hf) if (Math.abs(v) === peak) pinned++;
      return { peak, pinnedShare: (100 * pinned) / hf.length };
    };
    const reverted = [];
    for (const key of claimants) {
      if (kernelFolders.has(key)) continue;
      const entry = Object.values(MATH_COLLECTIONS)
        .map(col => col.formulas[key]).find(Boolean);
      if (!entry) {
        reverted.push(`${key}: a row states a fold coverage for it and no kernel of that name exists`);
        continue;
      }
      const { peak, pinnedShare } = plateStats(entry.f, FACTORY, 81);
      reverted.push(`${key}: the row states a fold coverage but the kernel makes no soften() call. ` +
        `Its grid-81 factory plate peaks at ${peak.toFixed(4)} and ${pinnedShare.toFixed(2)} % of it ` +
        'sits bit-exactly on that peak — a hard clamp draws a tabletop, and the row is describing a fold');
    }
    assert.deepEqual(reverted, [],
      'a row claims a fold that its kernel no longer performs — the prose outlived the kernel:\n  ' +
      reverted.join('\n  '));

    // ── the per-entry checks ───────────────────────────────────────────────
    const folders = [], undocumented = [], mismatches = [];
    const noMaxima = [], noMeshFigure = [];
    let figures = 0;
    const perRow = [], perKey = new Map();
    for (const [key, { colId, f, knee, shoulder }] of kernelFolders) {
      const cache = new Map();
      const shareAt = (tag, g) => {
        const ck = `${tag}|${g}`;
        if (cache.has(ck)) return cache.get(ck);
        const hf = generateSurfaceFromFormula(f, SETTING[tag], g, 3.5, 0);
        let n = 0;
        for (const v of hf) if (Math.abs(v) > knee) n++;
        const r = (100 * n) / hf.length;
        cache.set(ck, r);
        return r;
      };
      const atFactory = shareAt('f', 90), atMax = shareAt('m', 90);
      folders.push(`${colId}/${key} knee ${knee}: ${atFactory.toFixed(1)} % → ${atMax.toFixed(1)} %`);

      // The clamp signature, and the second net under HOLE 1. soften(y, knee,
      // ceil) is the identity for |y| ≤ knee and knee + (ceil−knee)·tanh(·),
      // strictly greater than knee, above it — so the vertices sitting
      // bit-exactly ON the knee are the level curve |y| = knee, and in float32
      // that set is empty for all twelve entries at both settings (measured
      // 0.000 % each, 2026-08-17). A hard clamp at the same value is the
      // opposite: it PARKS the plate there. Reverting eulerIm to
      // Math.max(-0.9, Math.min(0.9, …)) pins 24.30 % of the grid-81 factory
      // plate on 0.9. This catches the variant of that mutation which keeps a
      // soften() call in the body — clamping what soften is handed — and so
      // would survive the both-directions check above.
      for (const tag of ['f', 'm']) {
        const hf = generateSurfaceFromFormula(f, SETTING[tag], 81, 3.5, 0);
        const atKnee = Math.fround(knee);
        let pinned = 0;
        for (const v of hf) if (Math.abs(v) === atKnee) pinned++;
        const pinShare = (100 * pinned) / hf.length;
        assert.ok(pinShare < 0.5,
          `${colId}/${key} parks ${pinShare.toFixed(2)} % of its grid-81 plate bit-exactly on its own ` +
          `knee ${knee} at the ${tag === 'f' ? 'factory sliders' : 'slider maxima'}. soften() is the ` +
          'identity below the knee and strictly above it beyond, so it cannot do that — this is a ' +
          'clamp wearing a fold\'s name, and the row\'s coverage figure is describing a tabletop');

        // ── HOLE 4: the clamp that KEEPS its soften() call ─────────────────
        // FIX(r8, final): the knee-pin above catches exactly one member of
        // that family — a clamp AT the knee. Everything else walked through,
        // and the coverage oracle cannot help: soften() is monotone, so
        // clamping its argument at any c above the knee leaves the set
        // {|y| > knee} bit-for-bit unchanged and every percentage in every row
        // stays correct to the last digit. Measured on eulerIm's grid-81
        // factory plate, 2026-08-17, with `soften(…, 0.9, 1.8)` left in place
        // and its argument clamped at c:
        //   c = 0.90001 → peak 0.900009989738, 24.30 % of the plate on that
        //                 one value, ONE distinct |value| above the knee
        //   c = 1.0     → 22.92 % on one value, 46 distinct
        //   c = 1.8     → 15.67 % on one value, 284 distinct
        //   shipped     → peak 1.79999995232, 1.01 % on the peak, 733 distinct
        // and coverage read 24.30 % in all four columns. All three were green
        // here and at 920/920 across the suite before this net.
        //
        // What separates a fold from a clamp is not how much mass sits on one
        // value — two entries pile up legitimately — but WHERE it sits and how
        // it is shaped:
        //   * float32 saturation ON the ceiling: blaschke 99.41 % of its
        //     maxima plate on fround(0.85), catenoid 89.16 %, complexSin
        //     54.56 %, manifoldCurvature 42.68 %, eulerIm 40.88 %;
        //   * a formula with its own asymptote: breatherSurface runs to
        //     2/a − 1 = 4 in the far field, so 42.63 % of its maxima plate is
        //     one value that is NOT the ceiling (0.949876606464).
        // Both sit past the shoulder, where soften is flat. So the window is
        // knee < |y| < shoulder — the part of the band where the fold is still
        // strictly increasing — and inside it a smooth kernel can only tie
        // along a level CURVE, O(side) vertices, while a clamp ties over an
        // AREA, O(side²). Hence the cap is a multiple of the plate's side
        // rather than a share of it, and the margin widens with the grid.
        // Measured over all twelve entries × four settings × grids 41/81/90/161:
        // the shipped tree never exceeds 1.00 × side (breatherSurface's far
        // field is exactly one column of the plate, 41/81/161 vertices at the
        // three grids). The three clamps above are 19.7, 18.6 and 12.7 × side
        // at grid 81, in that order, and 39.1, 36.9 and 25.0 × side at grid
        // 161 — the gap widens with the mesh, which is the point of measuring
        // against the side. A legitimate kernel change that makes a
        // real plateau bigger — breatherSurface reparametrised T = x·freq·3.0
        // instead of 1.5, doubling how much of the plate reaches the asymptote
        // — peaks at 1.80 × side, still under the cap; so does moving eulerIm's
        // ceiling to 2.2 or to 1.4 (0.03 % of the plate, unchanged).
        const shoulderF = Math.fround(shoulder);
        const tally = new Map();
        for (const v of hf) {
          const a = Math.abs(v);
          if (a > knee && a < shoulderF) tally.set(a, (tally.get(a) || 0) + 1);
        }
        let mode = 0, modeValue = 0;
        for (const [v, n] of tally) if (n > mode) { mode = n; modeValue = v; }
        const side = Math.round(Math.sqrt(hf.length));
        assert.ok(mode < 4 * side,
          `${colId}/${key} parks ${mode} vertices of its grid-81 plate — ` +
          `${((100 * mode) / hf.length).toFixed(2)} %, ${(mode / side).toFixed(1)} × the plate's side — ` +
          `bit-exactly on |y| = ${modeValue}, at the ` +
          `${tag === 'f' ? 'factory sliders' : 'slider maxima'}. That value is strictly inside the ` +
          `fold's own band (knee ${knee}, shoulder ${shoulder.toFixed(4)}), where soften() is strictly ` +
          'increasing, so it can tie a level curve of the plate (about one side\'s worth of vertices) ' +
          'and not an area. This is the clamp that keeps its soften() call — clamping the argument at ' +
          'any c above the knee leaves {|y| > knee} unchanged, so every coverage figure in the row ' +
          'still reads correct while the plate has become a tabletop. Cap is 4 × side; the shipped ' +
          'tree measured 1.0 × side at worst on 2026-08-17');
      }

      const row = rowOf(key);
      assert.ok(row, `${colId}/${key} folds its output and has no row in MATHEMATICAL_ACCURACY.md`);
      const stated = FACTORY_RE.exec(row);
      if (!stated) { undocumented.push(`${colId}/${key} (measured ${atFactory.toFixed(1)} % at the factory sliders)`); continue; }
      if (Math.abs(+stated[1] - atFactory) > TOL_1DP) {
        mismatches.push(`${colId}/${key}: the row says ${stated[1]} % of the plate is folded at the ` +
          `factory sliders, the kernel draws ${atFactory.toFixed(2)} %`);
      }

      // HOLE 2: the maxima half is required, not merely checked if present.
      const statedMax = MAXIMA_RE.exec(row);
      if (!statedMax) {
        noMaxima.push(`${colId}/${key}: the row states ${stated[1]} % at the factory sliders and says ` +
          `nothing about the maxima, where the kernel draws ${atMax.toFixed(2)} %`);
      } else if (Math.abs(+statedMax[1] - atMax) > TOL_1DP) {
        mismatches.push(`${colId}/${key}: the row says ${statedMax[1]} % at the slider maxima, ` +
          `the kernel draws ${atMax.toFixed(2)} % at amp 2.25 / freq 4.55 / comp 1`);
      }

      // HOLE 3: every figure that names a grid is re-measured at that grid.
      const SLIDERS = { f: 'the factory sliders', m: 'the slider maxima',
        e: 'the audio envelope', a: 'amp 1' };
      let n = 0;
      for (const shape of SHAPES) {
        const m = shape.re.exec(row);
        if (!m) continue;
        shape.slots.forEach(([tag, g], i) => {
          const drawn = shareAt(tag, g);
          if (Math.abs(+m[i + 1] - drawn) > shape.tol) {
            mismatches.push(`${colId}/${key}: the row says ${m[i + 1]} % at grid ${g} at ` +
              `${SLIDERS[tag]} (shape "${shape.name}"), the kernel draws ${drawn.toFixed(2)} %`);
          }
          n++;
        });
      }
      if (n === 0) {
        noMeshFigure.push(`${colId}/${key}: the row states a grid-90 coverage and not one figure for a ` +
          'mesh the app draws (81 or 161), or states it in a shape this test cannot re-measure');
      }
      figures += n;
      perRow.push(`${key}:${n}`);
      perKey.set(key, n);
    }
    assert.deepEqual(mismatches, [], mismatches.join('\n  '));
    // HOLE 2's ratchet. All twelve rows state their maxima figure; a row that
    // drops the sentence now fails here instead of passing quietly.
    assert.deepEqual(noMaxima, [],
      'a row states its factory coverage and drops the maxima half of the same claim — deleting a ' +
      'figure has to cost the same as corrupting one:\n  ' + noMaxima.join('\n  '));
    // HOLE 3's ratchet.
    assert.deepEqual(noMeshFigure, [],
      'a row quotes only grid 90, which the app never draws (81 on mobile, 161 on desktop):\n  ' +
      noMeshFigure.join('\n  '));

    // Controls. Eleven entries fold; if that number collapses the sweep has
    // stopped finding them, and the rows checked would silently become none.
    // Raised from 10 to 12 in the correction pass: at 10 the guard tolerated
    // two of the twelve quietly ceasing to fold, which is the whole of HOLE 1.
    // Round 11 moved it 12 → 11, and this sentence is the record of why, since
    // a floor that drifts down without one is how HOLE 1 got in: `dragon` was
    // rebuilt around a density that is normalised to [0, 1] by construction, so
    // there is nothing left for it to fold. It is the only entry that left.
    assert.ok(folders.length >= 11,
      `only ${folders.length} entries were found to call soften():\n  ${folders.join('\n  ')}`);
    // …and the same floor on the document's side, so the two ratchets cannot be
    // satisfied by deleting from both ends at once.
    assert.ok(claimants.length >= 11,
      `only ${claimants.length} rows state a fold coverage (11 since round 11 took dragon's fold away): ` +
      claimants.join(', '));
    assert.ok(folders.length - undocumented.length >= 3,
      `no row states a fold coverage any more, so this test asserts nothing:\n  ${folders.join('\n  ')}`);
    // The ratchet, tightened from 7 to 0 by the wave that wrote the missing
    // figures: every folding entry's row states its coverage, and this may only
    // ever be tightened.
    assert.deepEqual(undocumented.length <= 0, true,
      'more entries fold without their row saying so than when this was written ' +
      `(${undocumented.length} against 0):\n  ${undocumented.join('\n  ')}`);
    // HOLE 3's second ratchet: the count of re-measured figures, 51 on
    // 2026-08-17.
    //
    // FIX(r8, final) — HOLE 5. This was ONE global number, and a total hides a
    // swap: deleting scherkSurface's `, at grid 41 0.00 % and 5.47 %` (−2) while
    // adding a genuinely correct `at grid 41 52.35 % and 97.92 %` to catenoid
    // (+2) nets back to 51, and both this test and the whole suite stayed green
    // with scherkSurface's grid-41 pair gone and nothing left naming it.
    // (Controls run beside it, 2026-08-17: the deletion alone reads 49 and
    // fails; the addition alone is correct at grid 41 and passes — so the pair
    // was silent only because the two cancelled.) The floor is per row now, so
    // a row can only be credited for its own figures. It may only ever be
    // raised — and a row absent from the walk counts as zero here rather than
    // being skipped, so a kernel that quietly stops folding fails with its own
    // name as well as through the `folders.length >= 11` control above.
    //
    // Round 11 removed `dragon: 6` from this table, and that is the one edit
    // this ratchet is built to make expensive, so here is the reason in full:
    // the entry no longer folds, because its kernel no longer produces an
    // unnormalised quantity to fold. Its six figures were all coverage of a
    // compression that has nothing left to compress, and its row now states the
    // bound it does have — a density in [0, 1], height at most amp·1.2. This is
    // the guard working: it failed with dragon's own name attached, which is
    // exactly what it promises to do when a kernel stops folding.
    const FIGURE_FLOOR = {
      lyapunov: 4, manifoldCurvature: 6, eulerIm: 4, complexPower: 4,
      mobiusTransform: 2, complexSin: 4, blaschke: 3, scherkSurface: 6, catenoid: 4,
      breatherSurface: 4, pseudosphere: 4,
    };
    const shortRows = [];
    for (const [key, floor] of Object.entries(FIGURE_FLOOR)) {
      const got = perKey.get(key) ?? 0;
      if (got < floor) {
        shortRows.push(`${key}: ${got} re-measurable figures, against ${floor} when this was written`);
      }
    }
    assert.deepEqual(shortRows, [],
      'a row has lost one of the figures this test could re-measure — deleted, or reworded into a ' +
      'shape SHAPES cannot read (add the shape, do not bend the prose). A per-row floor, because a ' +
      'total lets one row\'s deletion be paid for by another row\'s addition:\n  ' +
      `${shortRows.join('\n  ')}\n  Per row now: ${perRow.join(' ')}`);
    // …and the total kept as well, unchanged at 51, as the aggregate ratchet it
    // always was. It does NOT stand in for a per-row floor on a row missing from
    // the map above: a thirteenth folding entry's figures would count toward the
    // total and have no floor of their own, so adding an entry means adding its
    // row here. What such an entry cannot do is state no re-measurable figure at
    // all — noMeshFigure above requires at least one.
    const FIGURE_FLOOR_TOTAL = Object.values(FIGURE_FLOOR).reduce((a, b) => a + b, 0);
    assert.ok(figures >= FIGURE_FLOOR_TOTAL,
      `${figures} fold figures could be re-measured from the rows, against ${FIGURE_FLOOR_TOTAL} when ` +
      'this was written — a figure has been deleted, or reworded into a shape SHAPES cannot read ' +
      `(add the shape, do not bend the prose). Per row now: ${perRow.join(' ')}`);

    // ── what is NOT guarded here, stated rather than implied ───────────────
    // Writing this down is part of the fix: the previous three versions of this
    // test each read less than the reader would assume, and none of them said so.
    //
    //   * every clock RANGE — eulerIm "24.30…27.10 % at grid 81 (mean 26.1)",
    //     blaschke "90.66…91.02 %", mobiusTransform "15.79…42.72 %" and
    //     "1.60…89.74 %" and both grid-161 ranges, breatherSurface
    //     "82.66…84.26 %", scherkSurface "9.18…12.10 %", complexSin
    //     "83.86…85.17 %". A range is only re-measurable given the sample set
    //     over the turn, and the rows do not state one; guessing a sample set
    //     would produce a guard that agrees with itself. Only the t = 0 figure
    //     inside mobiusTransform's range sentence is checked above.
    //   * the audio-envelope figures that name no grid — catenoid "66.0 %",
    //     blaschke "95.74 %", breatherSurface "97.8 %", pseudosphere "0.3 %",
    //     scherkSurface "13.7…15.1 %". catenoid's 66.0 is within 0.07 pp of
    //     BOTH grid 90 (66.07) and grid 81 (66.03), so a guard pinning it to a
    //     mesh would be reading a coincidence, not a claim. The two rows that
    //     DO name their grids at the envelope (dragon, manifoldCurvature) are
    //     checked above.
    //   * every "further than 10⁻³ from the un-compressed value" figure — the
    //     statistic that decides the tier in seven of these rows. It needs a
    //     second copy of each kernel with soften() replaced by the identity,
    //     which cannot be built from entry.f.toString() without evaluating a
    //     mutated source at test time. It was measured offline for the wave
    //     that wrote it; it is not measured here, and that is the largest
    //     unguarded number in this family.
    //   * the ceiling-pin figures (complexSin's 54.56 % on fround(1.4),
    //     manifoldCurvature's 42.68 % on fround(2.6), blaschke's 77.55 %
    //     within 10⁻³ of 0.85) and the world-unit deviations (236, 21.3, 55.7,
    //     1.1·10¹³). The complex trio's ceiling shares ARE guarded, in the
    //     "stays finite and in frame" test above; the rest are not.
    //   * a clamp of soften()'s argument placed BEYOND the shoulder, i.e. at
    //     c ≥ knee + 3·(ceil − knee). The net under HOLE 4 stops there on
    //     purpose: past the shoulder soften() is already within 0.5 % of the
    //     band of its ceiling (0.0045 world units for eulerIm), so such a clamp
    //     and the fold draw the same plate to within that, and two entries
    //     legitimately pile mass up there — blaschke on its ceiling, and
    //     breatherSurface on its own far-field asymptote 2/a − 1 = 4. Between
    //     the knee and the shoulder, where the difference is visible, it is
    //     caught.
    //   * mobiusTransform's 98.3 % and blaschke's 99.5 % at amp 1.5 / freq 3.5:
    //     the two rows state that corner in two different shapes, and one
    //     shape per row per corner is how this test stopped being readable.
    //     Their amp-1 corners are checked; these two are not.
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
      //
      // FIX(r8, review): the bound was 1.25 against a measured 1.15470054, i.e.
      // 8 % of room, which is not a bound — it is the measurement with a typo's
      // worth of slack, and it would have gone red on any legitimate change to
      // the mode mapping. The measured worst is not an accident either: at
      // freq 2, comp 0.7 → n = 4, grid 25's ξ step is 1/12 and the half-period
      // is 1/4, so the crest at ξ = 1/8 is missed by exactly 1/24 of a period —
      // cos(π/6) = √3/2, ratio 2/√3 = 1.15470053838. A denser sweep (amp × 5,
      // freq × 41, comp × 11 = 2255 settings) finds nothing above it. The bound
      // is now 1.30: the proved worst plus 12.6 %, which is room for a mode
      // mapping to change without this test having an opinion about it, and
      // still catches the ×2.387 a shrunken beam window produces (measured on
      // ξ = clamp((x·freq·1.5 + 3.5)/7, 0, 1), worst at amp 2.25 / freq 4.55 /
      // comp 0.7, peaks 0.4239 / 1.0041 / 1.0118 across grids 25 / 90 / 161).
      assert.ok(worst < 1.30, `beamBending peak moves by ×${worst} across grids at ${JSON.stringify(at)}`);
      // Control on the statistic, not on the kernel: the same ratio applied to a
      // bump narrow enough for grid 25 to miss reads ×138, so a small reading
      // above is a statement about beamBending and not about the ratio being
      // unable to notice under-sampling. (A LOWER bound on beamBending's own
      // ratio was tried and rejected: a mapping that spans the plate at every
      // freq — a repair — reads ×1.0006 and would have failed it, which is the
      // exact defect this round is here to remove.)
      const bump = (x) => Math.exp(-2000 * (x - 0.05) * (x - 0.05));
      const ratioOf = fn => {
        const v = [25, 90, 161].map(g => {
          const hf = generateSurfaceFromFormula((x, z, t, p) => fn(x), { amp: 1, freq: 1, comp: 0.5 }, g, 3.5, 0);
          let m = 0;
          for (let i = 0; i < hf.length; i++) m = Math.max(m, Math.abs(hf[i]));
          return m;
        });
        return Math.max(...v) / Math.min(...v);
      };
      assert.ok(ratioOf(bump) > 10,
        `the grid-ratio statistic reads ×${ratioOf(bump)} on a bump grid 25 cannot see — it is ` +
        'not measuring sampling at all');
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

    test('beamBending is never flatter than its own beam window allows (#R8)', () => {
      // ξ = clamp((x·freq + 3.5)/7, 0, 1) puts the two supports at x = ±3.5/freq,
      // so above freq = 1 the beam occupies only 1/freq of the plate and the rest
      // is flat — zero deflection, which is the right height for "no beam here",
      // but it is a large part of the picture and the row has to say so. The
      // same clamp is the collection's idiom (schrodingerBox is identical), and
      // freq has nothing else to mean for a static deflection.
      //
      // FIX(r8, review): this was written as a two-sided EQUALITY,
      //     |flat/N − (1 − 1/freq)| < 0.02,
      // which pins the wart in place: the round's own prose calls the flat
      // margin a thing the row "has to say so" about, and then the test makes
      // repairing it red. Measured on a copy — a mapping that spans the plate at
      // every freq (ξ = clamp((x + 3.5)/7, 0, 1)) and one that recovers half the
      // waste (x·√freq) both FAIL the equality, while a mapping that wastes MORE
      // of the plate (x·freq·1.5) fails it too. A guard that fires on repair and
      // on regression alike tells you nothing about which one happened.
      //
      // It is now the one-sided bound the equality was standing in for: the flat
      // share may not exceed what the beam window forces. Repairs are green,
      // drift is red, and the reading is still recorded below. (The mode test
      // beside this one samples x = (7ξ − 3.5)/freq and would still go red on a
      // remapping; that pin is in its sampler, not in an assertion, and is left
      // for whoever does the remapping to move.)
      const beam = MATH_COLLECTIONS.differentialEqs.formulas.beamBending;
      const N = 1401;
      const readings = [];
      for (const freq of [0.3, 1.0, 1.3, 2.0, 3.5, 4.55]) {
        let flat = 0;
        for (let i = 0; i < N; i++) {
          const x = -3.5 + 7 * i / (N - 1);
          if (Math.abs(beam.f(x, 0, 0, { amp: 2.25, freq, comp: 0.5 })) < 1e-15) flat++;
        }
        const share = flat / N, forced = Math.max(0, 1 - 1 / freq);
        readings.push(`freq ${freq}: ${share.toFixed(4)} against a forced ${forced.toFixed(4)}`);
        // Measured excess over the forced share: 0.0000 / 0.0014 / 0.0005 /
        // 0.0011 / 0.0009 / 0.0007 — all of it the 1/N sampling of the support
        // points themselves. 0.01 is seven times the worst of those.
        assert.ok(share <= forced + 0.01,
          `beamBending is flat over ${share} of the row at freq ${freq}, where the supports at ` +
          `x = ±3.5/freq force only ${forced}`);
      }
      // …and the plate is not flat everywhere, which is the failure the bound
      // above cannot see on its own (a dead kernel is "never flatter than
      // allowed" at freq 0.3 only because the bound there is 0.01).
      let live = 0;
      for (let i = 0; i < N; i++) {
        const x = -3.5 + 7 * i / (N - 1);
        if (Math.abs(beam.f(x, 0, 0, { amp: 2.25, freq: 4.55, comp: 0.5 })) > 1e-12) live++;
      }
      assert.ok(live / N > 0.15,
        `only ${live}/${N} of the row deflects at freq 4.55, where 1/4.55 = 0.22 of it should: ` +
        readings.join(' | '));
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
    // At z = 0, freq = 1, amp = 1 the kernel is 0.3·Σ pₖ|ψₖ|², so the difference
    // between consecutive comps is 0.3·pₙ·|ψₙ(x)|² — one state, on its own.
    //
    // FIX(r8, review): that difference used to be read at the single point
    // x = 1/(2n) − ½, which is where |ψₙ| = 1 for the mapping the kernel happens
    // to use today. Measured on a copy: repairing the mapping to show the well
    // once leaves the WEIGHTS byte-identical (p₁…p₅ within 9.7e-17 of e^{−k/2})
    // and still fails this test, because only its readout point moved — a false
    // red on a repair, of exactly the kind this round is removing elsewhere.
    // The maximum of the difference over x is 0.3·pₙ for ANY mapping with a unit
    // sup, so the peak is taken instead of a hard-coded abscissa: coarse scan,
    // then ternary refinement (the difference is smooth and locally unimodal, so
    // 120 iterations put the position within 1e-11 and the value, being
    // quadratic there, within 1e-19).
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.densityMatrix.f;
    const peakDiff = (compHi, compLo) => {
      const d = x => f(x, 0, 0, { amp: 1, freq: 1, comp: compHi })
                   - (compLo === null ? 0 : f(x, 0, 0, { amp: 1, freq: 1, comp: compLo }));
      const N = 20001, step = 7 / (N - 1);
      let bestI = 0, best = -Infinity;
      for (let i = 0; i < N; i++) {
        const v = d(-3.5 + i * step);
        if (v > best) { best = v; bestI = i; }
      }
      let lo = -3.5 + (bestI - 1) * step, hi = -3.5 + (bestI + 1) * step;
      for (let k = 0; k < 120; k++) {
        const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
        if (d(a) < d(b)) lo = a; else hi = b;
      }
      return d((lo + hi) / 2);
    };
    const p = [];
    for (let n = 1; n <= 5; n++) {
      p.push(peakDiff((n - 1) / 4, n === 1 ? null : (n - 2) / 4) / 0.3);
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
    //
    // FIX(r8, review): the finiteness half was written against the height field,
    // where `out[i] = isFinite(y) ? y : 0` makes it unfailable — a kernel
    // returning NaN arrives as a flat plate and the assertion passes. It is
    // moved onto the kernel; the peak stays on the height field, which is what
    // reaches the buffer and where a zero substitution cannot hide a peak.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.densityMatrix.f;
    let peak = 0;
    for (const amp of [0.7, 1.5, 2.25])
      for (const freq of [0, 1, 2.5, 4.55])
        for (const comp of [0, 0.25, 0.5, 0.75, 1]) {
          const g = 45, step = 7 / (g - 1);
          for (let zi = 0; zi < g; zi++) for (let xi = 0; xi < g; xi++) {
            const y = f(-3.5 + xi * step, -3.5 + zi * step, 0, { amp, freq, comp });
            assert.ok(Number.isFinite(y),
              `densityMatrix returns ${y} at amp ${amp} freq ${freq} comp ${comp}`);
          }
          const hf = generateSurfaceFromFormula(f, { amp, freq, comp }, g, 3.5, 0);
          for (const v of hf) if (v > peak) peak = v;
        }
    assert.ok(peak < 0.68, `peak ${peak} is at or against the 0.7 ceiling`);
    assert.ok(peak > 0.1, `peak ${peak} has fallen out of frame`);
  });

  test('densityMatrix never tiles the well finer than one well per 1/freq (#R8)', () => {
    // ψₖ = sin(kπ(x·freq + ½)): the well is x·freq ∈ [−½, ½], length 1, so the
    // plate's 7 units of x carry at most 7·freq wells — 7.00 at freq 1, 31.85 at
    // 4.55, which is what MATHEMATICAL_ACCURACY.md's row states.
    //
    // FIX(r8, review), two defects in one test.
    //
    //   * It ended with
    //         assert.equal(Math.round(7 * 1 * 100) / 100, 7);
    //         assert.equal(Math.round(7 * 4.55 * 100) / 100, 31.85);
    //     which is arithmetic on literals: no kernel, no catalogue, no import.
    //     Neither line could fail for any change to this repository, and the
    //     two numbers they "check" are the two the row quotes. They are replaced
    //     by counting the wells IN THE DRAWN ROW — the density Σpₖsin²(kπ(x·freq+½))
    //     touches zero exactly where every state has a node, so the nodes are
    //     local minima at zero and the well count is 7 / (their spacing).
    //   * The periodicity half pinned the tiling in place, and the tiling is
    //     the thing this round's own prose is uneasy about. It also passed on a
    //     dead kernel: with the plate identically zero, f(x) === f(x + 1/freq)
    //     is 0 === 0. Both are fixed by making it a BOUND — the drawn row may
    //     not repeat FASTER than one well per 1/freq — plus a liveness check
    //     that there is a row to measure. A mapping repaired to show the well
    //     once is then green (one well ≤ 7·freq), a mapping that tiles twice as
    //     fast is red, and a dead plate is red.
    const f = MATH_COLLECTIONS.quantumMechanics.formulas.densityMatrix.f;
    const N = 200001;
    for (const freq of [1, 2.5, 4.55]) {
      const y = new Float64Array(N);
      let peak = 0;
      for (let i = 0; i < N; i++) {
        y[i] = f(-3.5 + 7 * i / (N - 1), 0, 0, { amp: 0.7, freq, comp: 1 });
        peak = Math.max(peak, y[i]);
      }
      // liveness: a dead or flat kernel has no wells to count and must not pass
      // by having nothing to disagree with. Measured peak 0.19147 at every freq.
      assert.ok(peak > 0.05, `the drawn row peaks at ${peak} — there is no well here to count`);
      const nodes = [];
      for (let i = 1; i < N - 1; i++) {
        if (y[i] < y[i - 1] && y[i] < y[i + 1] && y[i] < 1e-6 * peak) nodes.push(-3.5 + 7 * i / (N - 1));
      }
      // wells = plate width / node spacing. Fewer than two nodes means the row
      // does not repeat inside the plate at all — one well, which is the
      // repaired mapping and is allowed.
      let wells = nodes.length + 1, gap = null;
      if (nodes.length >= 2) {
        gap = (nodes[nodes.length - 1] - nodes[0]) / (nodes.length - 1);
        wells = 7 / gap;
      }
      // Measured on the shipped kernel: 6 nodes at freq 1, gap 1.0000060,
      // 7.0000 wells; 32 nodes at freq 4.55, gap 0.21977968, 31.8501 wells —
      // the row's own 7.00 and 31.85. The bound is 7·freq, so those readings sit
      // exactly on it and anything finer is red.
      assert.ok(wells <= 7 * freq + 0.02,
        `the drawn row carries ${wells.toFixed(4)} wells at freq ${freq} (nodes ${nodes.length}, ` +
        `spacing ${gap}), where one well per 1/freq allows ${7 * freq}`);
      // the spacing is uniform, which is what "tiling" means as opposed to
      // "some wells here and some there"
      if (nodes.length >= 3) {
        let worst = 0;
        for (let i = 1; i < nodes.length; i++) worst = Math.max(worst, Math.abs(nodes[i] - nodes[i - 1] - gap));
        assert.ok(worst < 1e-3,
          `node spacing at freq ${freq} varies by ${worst}, so the row is not a tiling of one well`);
      }
    }
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
      // FIX(r8, review): 0.05 against a measured worst of 0.0298 at the three
      // comps this test visits is 1.68× — but comp is continuous and the app
      // reaches all of it (comp = 0.5 + mid·0.4), and swept in steps of 0.01 the
      // worst |λ − ln 2| on this corner is 0.04738 at comp 0.81. That is 5 % of
      // room, i.e. a band calibrated to the three points it happened to sample.
      // 0.08 is the measured worst over the whole comp range plus 69 %, and it
      // still forbids the ln 4 = 1.386 the degenerate seed used to give and the
      // 0.5 the next-nearest alternative seeds produce.
      [3.5, 4.0, Math.log(2), 0.08],
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
    // FIX(r8, review): two of the three assertions here could not fail.
    //
    //   * `Number.isFinite(v)` was read off generateSurfaceFromFormula's output,
    //     which ends `out[i] = isFinite(y) ? y : 0` — a NaN kernel arrives as a
    //     flat plate. It is moved onto the kernel.
    //   * `peak < 2.5` was reading the fold. Every return of this kernel goes
    //     through soften(·, 0.5, 0.9) and soften is knee + (ceil−knee)·tanh(…)
    //     with tanh < 1, so |y| < 0.9 identically and 2.5 was unreachable
    //     arithmetic. Measured peaks: 0.6322 at amp 0.7 (below the knee's reach,
    //     an honest maximum) and 0.8997 at amp 2.25 (the ceiling). What is
    //     asserted instead is the SHARE of the plate the fold takes, which is a
    //     statement about the surface: 0.2 % at the factory sliders, 6.8 % at
    //     the slider maxima, so the picture is the exponent and not the envelope.
    const f = MATH_COLLECTIONS.fractals.formulas.lyapunov.f;
    let peak = 0, foldedFactory = 0, foldedMax = 0;
    for (const amp of [0.7, 1.5, 2.25])
      for (const freq of [0, 1, 4.55])
        for (const comp of [0, 0.5, 1]) {
          const g = 45, step = 7 / (g - 1);
          for (let zi = 0; zi < g; zi++) for (let xi = 0; xi < g; xi++) {
            const y = f(-3.5 + xi * step, -3.5 + zi * step, 0, { amp, freq, comp });
            assert.ok(Number.isFinite(y),
              `lyapunov returns ${y} at amp ${amp} freq ${freq} comp ${comp}`);
          }
          const hf = generateSurfaceFromFormula(f, { amp, freq, comp }, g, 3.5, 0);
          for (const v of hf) if (Math.abs(v) > peak) peak = Math.abs(v);
        }
    assert.ok(peak > 0.1, `peak ${peak} has fallen out of frame`);
    // the fold's share of the plate, |y| > knee, which needs no instrumentation
    // because soften is the identity below the knee
    const foldShare = p => {
      const hf = generateSurfaceFromFormula(f, p, 90, 3.5, 0);
      let n = 0;
      for (const v of hf) if (Math.abs(v) > 0.5) n++;
      return (100 * n) / hf.length;
    };
    foldedFactory = foldShare({ amp: 0.7, freq: 1, comp: 0.5 });
    foldedMax = foldShare({ amp: 2.25, freq: 4.55, comp: 1 });
    // Measured 0.21 % and 6.75 %; the bands are the measured value plus 1.5
    // percentage points, and a ×4 display gain takes the factory share past 50 %.
    assert.ok(foldedFactory < 1.8,
      `the fold covers ${foldedFactory.toFixed(2)} % of the plate at the factory sliders`);
    assert.ok(foldedMax < 8.5,
      `the fold covers ${foldedMax.toFixed(2)} % of the plate at the slider maxima`);
    // the mean of |y| is the grid-stable statistic here — the peak of a fractal
    // rises as the mesh resolves more of it, and did so before this change too.
    const means = [41, 90, 161].map(g => {
      const hf = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, g, 3.5, 0);
      let s = 0;
      for (const v of hf) s += Math.abs(v);
      return s / hf.length;
    });
    const ratio = Math.max(...means) / Math.min(...means);
    assert.ok(ratio < 1.1, `mean |y| moves by ×${ratio} across grids 41/90/161`);
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
    // FIX(r8, review), two defects. The finiteness assertion was read off the
    // height field, where `out[i] = isFinite(y) ? y : 0` makes it unfailable; it
    // is moved onto the kernel below, where a NaN is still a NaN. And the empty
    // fraction was a single band, 15 %…35 %, checked at grid 90 — but the empty
    // fraction is a boundary count, so it is strongly grid-dependent: measured
    // 37.3 / 30.3 / 25.9 / 23.7 / 25.4 / 23.8 % at grids 25 / 41 / 81 / 90 / 91 /
    // 161, i.e. the band excludes grid 25 and only just contains grid 41. It is
    // per-grid now, against the continuum limit it is converging to.
    //
    // That limit is exact and needs no kernel: the drawn set is r² − 4ρ² ≥ 0 with
    // r² = 10·amp/freq = 7 at the factory sliders and t = 0, i.e. the disc of
    // radius 3.5 — the plate's inscribed circle — so the empty fraction tends to
    // 1 − π/4 = 21.460 %.
    const CONTINUUM = 100 * (1 - Math.PI / 4);
    const EMPTY = { 25: 37.280, 41: 30.280, 81: 25.926, 90: 23.704, 91: 25.420, 161: 23.784 };
    for (const [g, want] of Object.entries(EMPTY)) {
      const p = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, +g, 3.5, 0);
      let e = 0;
      for (const v of p) if (v === 0) e++;
      const pct = (100 * e) / p.length;
      assert.ok(Math.abs(pct - want) < 1.5,
        `${pct.toFixed(3)} % of the grid-${g} factory plate is empty, recorded ${want} % ` +
        `(continuum ${CONTINUUM.toFixed(3)} %)`);
    }
    // …and the sequence is converging on the continuum value rather than sitting
    // near it by luck: the finest grid the app draws is within 2.5 points of it
    // and the coarsest is not.
    const emptyAt = g => {
      const p = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, g, 3.5, 0);
      let e = 0;
      for (const v of p) if (v === 0) e++;
      return (100 * e) / p.length;
    };
    assert.ok(Math.abs(emptyAt(161) - CONTINUUM) < 2.5,
      `grid 161 reads ${emptyAt(161).toFixed(3)} % empty against a continuum ${CONTINUUM.toFixed(3)} %`);
    assert.ok(emptyAt(25) - CONTINUUM > 5,
      `grid 25 reads ${emptyAt(25).toFixed(3)} % empty, which is no longer the coarse-mesh ` +
      'over-count this convergence claim rests on');
    // the kernel itself, where a non-finite value is visible
    for (const [x, z] of lattice(91)) {
      const y = f(x, z, 0, { amp: 0.7, freq: 1, comp: 0.5 });
      assert.ok(Number.isFinite(y), `romanSurface returns ${y} at (${x}, ${z})`);
    }

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
      // FIX(r8, review): `Number.isFinite(v)` on the height field cannot fail —
      // generateSurfaceFromFormula ends `out[i] = isFinite(y) ? y : 0`, so a NaN
      // kernel arrives as a flat plate. Asked of the kernel instead; the minimum
      // stays on the plate, which is what reaches the buffer.
      const plate = generateSurfaceFromFormula(f, p, 90, 3.5, 0);
      let min = Infinity;
      for (const v of plate) min = Math.min(min, v);
      const step = 7 / 89;
      for (let zi = 0; zi < 90; zi++) for (let xi = 0; xi < 90; xi++) {
        const y = f(-3.5 + xi * step, -3.5 + zi * step, 0, p);
        assert.ok(Number.isFinite(y), `boysSurface returns ${y} at (${-3.5 + xi * step}, ${-3.5 + zi * step})`);
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
    //
    // FIX(r8, review): the finiteness assertion was read off the height field,
    // and generateSurfaceFromFormula ends `out[i] = isFinite(y) ? y : 0`, so a
    // NaN kernel arrives as a flat plate. Measured on a copy: injecting
    // `if (freq === 4.55) return NaN;` into either kernel left all 917 tests
    // green. The finiteness question goes to the kernel, where a NaN is still a
    // NaN; the peak and the frame stay on the height field, which is what
    // reaches the buffer and where the zero substitution cannot hide a peak.
    // Grid 25 is dropped for 41, the coarsest the app can draw.
    for (const key of ['romanSurface', 'boysSurface']) {
      const f = MATH_COLLECTIONS.topology.formulas[key].f;
      let worst = 0;
      for (const amp of [0.2, 0.7, 1.5, 2.25]) {
        for (const freq of [0.3, 1, 2, 4.55]) {
          for (const t of [0, 5.236, 10.472]) {
            for (const g of [41, 90, 161]) {
              const step = 7 / (g - 1);
              for (let zi = 0; zi < g; zi++) for (let xi = 0; xi < g; xi++) {
                const y = f(-3.5 + xi * step, -3.5 + zi * step, t, { amp, freq, comp: 0.5 });
                assert.ok(Number.isFinite(y),
                  `${key}: kernel returned ${y} at amp=${amp} freq=${freq} t=${t} grid=${g}`);
              }
              const plate = generateSurfaceFromFormula(f, { amp, freq, comp: 0.5 }, g, 3.5, t);
              let peak = 0;
              for (const v of plate) peak = Math.max(peak, Math.abs(v));
              assert.ok(peak <= 2.5,
                `${key}: peak ${peak} out of frame at amp=${amp} freq=${freq} grid=${g}`);
              worst = Math.max(worst, peak);
            }
          }
        }
      }
      assert.ok(worst > 0.1, `${key}: nothing anywhere in the slider box reaches 0.1`);
      for (const g of [41, 90, 161]) {
        const factory = generateSurfaceFromFormula(f, { amp: 0.7, freq: 1, comp: 0.5 }, g, 3.5, 0);
        const pk = Math.max(...Array.from(factory, Math.abs));
        assert.ok(pk > 0.1 && pk < 2.5,
          `${key}: factory peak ${pk} at grid ${g} is outside the band its neighbours occupy`);
        assert.ok(Array.from(factory).some(v => v !== 0), `${key}: blank plate at grid ${g}`);
      }
    }
  });

  test('romanSurface and boysSurface move with the clock, by a measured amount (#R8)', () => {
    // FIX(r8, review): both entries could lose their time dependence entirely
    // with the whole suite green. Nothing above reads the same plate at two
    // clock values — the equation, the preimage, the RP² glide and the edge
    // identity are all statements about one frame, and every one of them is
    // still true of a frozen surface. The clock is not decoration for these two:
    // roman breathes r² with sin(0.3t) and boys turns the immersion about its
    // own three-fold axis with t·0.2, and the rows say so.
    //
    // The statistic is the relative L2 distance between two plates a quarter of
    // the entry's own period apart, taken as the largest over four starting
    // phases — a quarter period from a phase where the motion is momentarily
    // slow moves less than one from a phase where it is fast, so a single t₀
    // would be a lottery. Floors are measured, not guessed: over the same slider
    // box and grids as the sweep above, the smallest such maximum is 0.3315 for
    // roman (amp 2.25, freq 0.3, grid 161) and 0.4534 for boys (amp 0.2, freq 1,
    // grid 41). 0.15 is a factor 2.2 and 3.0 below those.
    const relL2 = (a, b) => {
      let num = 0, den = 0;
      for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; num += d * d; den += a[i] * a[i]; }
      return den === 0 ? 0 : Math.sqrt(num / den);
    };
    for (const [key, period] of [['romanSurface', (2 * Math.PI) / 0.3],
                                 ['boysSurface', (2 * Math.PI) / (3 * 0.2)]]) {
      const f = MATH_COLLECTIONS.topology.formulas[key].f;
      let floor = Infinity, at = null;
      for (const amp of [0.2, 0.7, 1.5, 2.25]) {
        for (const freq of [0.3, 1, 2, 4.55]) {
          for (const g of [41, 90, 161]) {
            let best = 0;
            for (const phase of [0, 0.125, 0.25, 0.375]) {
              const t0 = phase * period;
              best = Math.max(best, relL2(
                generateSurfaceFromFormula(f, { amp, freq, comp: 0.5 }, g, 3.5, t0),
                generateSurfaceFromFormula(f, { amp, freq, comp: 0.5 }, g, 3.5, t0 + period / 4)));
            }
            if (best < floor) { floor = best; at = { amp, freq, g }; }
          }
        }
      }
      assert.ok(floor > 0.15,
        `${key} moves by only ${floor.toFixed(5)} of its own norm over a quarter of its ` +
        `${period.toFixed(3)}-unit period at ${JSON.stringify(at)} — the clock has stopped reaching it`);
    }
    // Control: the statistic reads 0 on a surface that ignores the clock, so a
    // green above is a statement about these two kernels and not about the
    // measurement always being large.
    const frozen = (x, z, t, { amp = 1, freq = 1 }) => Math.sin(x * freq) * Math.cos(z * freq) * amp;
    const a = generateSurfaceFromFormula(frozen, { amp: 0.7, freq: 1, comp: 0.5 }, 90, 3.5, 0);
    const b = generateSurfaceFromFormula(frozen, { amp: 0.7, freq: 1, comp: 0.5 }, 90, 3.5, 5.236);
    assert.equal(relL2(a, b), 0, 'the control moved, so this statistic is not measuring the clock');
  });
});

describe('The display contract, clause 1 — the amplitude slider is the instrument (#R9)', () => {
  // MATHEMATICAL_ACCURACY.md, "What a caption is allowed to leave unsaid":
  // a caption may omit a factor iff `drawn ÷ named` is ONE POSITIVE CONSTANT
  // over the whole plate and over the whole reachable slider box, and — the
  // same section, spelling out which factors those are — "a fixed display scale
  // and the amplitude gain are part of the instrument, while a cancelled
  // normalisation and a comp-dependent gain are part of the mathematics".
  //
  // `named` is prose, so the clause as a whole needs an oracle and cannot run
  // in CI. Its second half does not: whether amp ACTS as one positive constant
  // is a property of two plates. Where it does not, the picture changes SHAPE
  // with a slider, and that is the thing a caption may not leave unsaid.
  //
  // This is a tripwire on the catalogue, not a reading of the captions: it says
  // which entries are ALLOWED to omit the slider. An entry joining the list is
  // a failure — measure what amp does to it and say so in its row. An entry
  // leaving the list is silence, because repairing one must not redden a suite.
  //
  // Measured 2026-08-18 at grid 41, factory 0.70/1.00/0.50 against the
  // over-drive amp 2.25 with freq and comp held: 175 of the 192 entries scale,
  // every one of them by the same 2.25/0.70 = 3.214286 at every vertex above a
  // thousandth of the plate's peak, and these 17 do not. At amp 1.00 the list
  // is 14 entries and a subset of this one; at grid 81 both lists come back
  // identical, so it is a property of the kernels and not of the mesh.
  //
  // Where the threshold comes from, because it is not zero: the buffer that
  // reaches the vertex shader is Float32, so a ratio of two of its entries
  // carries about 10⁻⁷ of rounding. The worst spread among the 175 that scale
  // is 1.53×10⁻⁷ (fractals/duffing); the smallest spread among the 17 that do
  // not is 5.13×10⁻² (specialFunctions/airy). 10⁻⁶ sits between them with six
  // times the headroom above the rounding and five orders of magnitude below
  // the nearest offender, so nothing here is decided by the tolerance.
  const RECORD = new Set([
    'fractals/lyapunov', 'fractals/dragon', 'specialFunctions/airy',
    'specialFunctions/laguerre', 'specialFunctions/polygamma',
    'linearAlgebra/manifoldCurvature', 'trigonometry/circularFunctions',
    'complexNumbers/eulerIm', 'complexNumbers/complexPower',
    'complexNumbers/mobiusTransform', 'complexNumbers/complexSin',
    'complexNumbers/blaschke', 'topology/romanSurface', 'topology/scherkSurface',
    'topology/catenoid', 'topology/breatherSurface', 'topology/pseudosphere',
  ]);
  const FACTORY = { amp: 0.7, freq: 1, comp: 0.5 };
  const LOUD = { amp: 2.25, freq: 1, comp: 0.5 };

  /** Is amp one positive constant on this kernel's drawing? */
  const ampGain = f => {
    const a = generateSurfaceFromFormula(f, FACTORY, 41, 3.5, 0);
    const b = generateSurfaceFromFormula(f, LOUD, 41, 3.5, 0);
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    if (!(peak > 0)) return { gain: 0, spread: Infinity };   // a blank plate is not a gain
    const rs = [];
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > 1e-3 * peak) rs.push(b[i] / a[i]);
    if (!rs.length) return { gain: 0, spread: Infinity };
    rs.sort((x, y) => x - y);
    const gain = rs[rs.length >> 1];
    let spread = 0;
    for (const r of rs) spread = Math.max(spread, Math.abs(r - gain) / Math.abs(gain));
    return { gain, spread };
  };
  const pure = g => g.gain > 0 && g.spread <= 1e-6;

  test('no entry has started changing shape with the amplitude slider without its row being told', () => {
    const news = [], stillThere = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        const id = `${colId}/${key}`;
        const g = ampGain(entry.f);
        if (pure(g)) continue;
        (RECORD.has(id) ? stillThere : news).push(
          `${id}: amp is not a gain — median ${g.gain.toFixed(4)}, spread ${g.spread.toExponential(2)}`);
      }
    }
    assert.deepEqual(news, [],
      'the amplitude slider changes the SHAPE of these plates, so it is not the instrument gain the ' +
      'display contract lets a caption leave unsaid. Measure what it does, say so in the row, and add ' +
      `the entry here:\n  ${news.join('\n  ')}`);
    // Control one: the detector has not gone blind. 17 were on the list when
    // this was written; a rewrite that quietly stopped measuring would report
    // none and pass every comparison it never made.
    assert.ok(stillThere.length >= 12,
      `only ${stillThere.length} of the 17 recorded entries still read as amp-dependent — the ` +
      `measurement has stopped working:\n  ${stillThere.join('\n  ')}`);
    // Control two, watched rather than assumed: the same detector on two
    // one-line kernels. amp·sin(x) reads gain 3.2142857 with spread 9.3×10⁻⁸;
    // the same kernel behind a ±0.3 clamp reads spread 2.2. That is the whole
    // difference between an instrument and a fold, and it is what makes a green
    // above a statement about the catalogue rather than about the detector.
    const clean = ampGain((x, z, t, { amp = 1, freq = 1 }) => Math.sin(x * freq) * amp);
    const clamped = ampGain((x, z, t, { amp = 1, freq = 1 }) => Math.max(-0.3, Math.min(0.3, Math.sin(x * freq) * amp)));
    assert.ok(pure(clean) && Math.abs(clean.gain - 2.25 / 0.7) < 1e-6,
      `the control kernel reads gain ${clean.gain} spread ${clean.spread}, and it is amp·sin(x)`);
    assert.ok(!pure(clamped),
      `a clamp at ±0.3 reads as a pure gain (${clamped.gain}, spread ${clamped.spread}) — this test cannot fail`);
  });
});

// ── Round 11: the label is the claim, because the caption is not on screen ───
// bindMathCollectionUI() is exported and called by nothing, so `formula` never
// reaches the DOM: the only text a viewer reads for an entry is its <option>
// label in index.html, which mirrors `name`. Four names were therefore claims
// the plate could not keep, and two kernels contradicted a ruling this
// repository had already written down.
describe('Round 11 — the visible label against the drawn object', () => {

  // The label and the field are two hand-maintained copies of one string. This
  // is the guard that keeps them one string; it is also what makes the renames
  // below meaningful rather than cosmetic.
  test('every catalogue name is exactly the option label the viewer reads', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const labels = new Map();
    for (const m of html.matchAll(/<option value="m:([^:"]+):([^"]+)"[^>]*>([^<]*)<\/option>/g)) {
      labels.set(`${m[1]}:${m[2]}`, m[3].trim());
    }
    const missing = [], differ = [];
    let checked = 0;
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        const id = `${colId}:${key}`;
        const label = labels.get(id);
        if (label === undefined) { missing.push(id); continue; }
        checked++;
        if (label !== entry.name) differ.push(`${id}: <option> "${label}" vs name "${entry.name}"`);
      }
    }
    assert.deepEqual(missing, [], `entries with no <option> at all: ${missing.join(', ')}`);
    assert.deepEqual(differ, [], `the picker and the catalogue disagree:\n  ${differ.join('\n  ')}`);
    // Control: the comparison actually ran over the whole catalogue. A regexp
    // that stopped matching would leave `checked` at 0 and pass both asserts.
    assert.equal(checked, 192, `only ${checked} of 192 entries were compared`);
  });

  test('the four renamed entries no longer name objects the plate does not draw', () => {
    const forbidden = [
      ['topology', 'crossCap', /RP²|Cross-Cap \(/, 'a graph over the plane is embedded and orientable; RP² admits no embedding in R³'],
      ['topology', 'enneperSurface', /^Enneper Surface$/, 'the plate is the quadric 0.0896(x²−z²), whose |H| reaches 0.0214 where Enneper is minimal'],
      ['topology', 'hopfFibration', /Hopf Fibration/, 'no S³, no fibre and no fibration in sin(2θ+4r−0.5t)·e^{−4(r−1)²}'],
      ['trigonometry', 'pythagorean', /Pythagorean/, 'the kernel forms sin²−cos² = −cos 2(r+t), the double-angle identity, not sin²+cos² = 1'],
    ];
    for (const [col, key, pattern, why] of forbidden) {
      const name = getFormula(col, key).name;
      assert.ok(!pattern.test(name), `${col}:${key} still reads "${name}" — ${why}`);
    }
    // Control: the same probe on an entry whose name IS honest still matches,
    // so a broken regexp cannot pass this test by matching nothing.
    assert.match(getFormula('topology', 'kleinBottle').name, /Klein/);
  });

  test('a stationary state does not breathe', () => {
    // |ψ_n|² of an energy eigenstate has no time dependence at all: the phase
    // e^{−iE_n t/ħ} cancels in the modulus. Both entries used to carry a
    // ×(0.8+0.2cos(...)) pulse — ×1.666667 peak to trough, 54.5 s and 218 s of
    // wall clock per period at the app's 0.48 units/s.
    for (const [col, key] of [['quantumMechanics', 'particleBox1D'], ['quantumMechanics', 'harmonicOscillator']]) {
      const f = getFormula(col, key).f;
      const at = t => Array.from(generateSurfaceFromFormula(f, { amp: 1, freq: 1, comp: 0.5 }, 41, 3.5, t));
      const base = at(0);
      for (const t of [13.09, 52.36, 104.72, 419.0]) {
        assert.deepEqual(at(t), base, `${key} moved between t = 0 and t = ${t}`);
      }
    }
    // Control: the probe can see a clock. wavePacket carries one by design, so
    // a comparison that had stopped comparing would fail here.
    const wp = getFormula('quantumMechanics', 'wavePacket').f;
    const w0 = Array.from(generateSurfaceFromFormula(wp, { amp: 1, freq: 1, comp: 0.5 }, 41, 3.5, 0));
    const w1 = Array.from(generateSurfaceFromFormula(wp, { amp: 1, freq: 1, comp: 0.5 }, 41, 3.5, 13.09));
    assert.notDeepEqual(w1, w0, 'the probe cannot see time passing, so the two greens above mean nothing');
  });

  test('the dragon plate is the Heighway dragon, not per-vertex speckle', () => {
    // Reference built with no IFS at all: the paper-folding sequence, the
    // dragon's other definition. Twelve levels is 4 095 turns.
    const paperFolding = levels => {
      let seq = [];
      for (let i = 0; i < levels; i++) seq = [...seq, 1, ...seq.map(s => -s).reverse()];
      let x = 0, y = 0, dx = 1, dy = 0;
      const pts = [[0, 0]];
      const scale = 1 / Math.pow(2, levels / 2);
      for (const turn of seq) {
        x += dx; y += dy; pts.push([x, y]);
        [dx, dy] = turn > 0 ? [-dy, dx] : [dy, -dx];
      }
      const ang = -Math.PI / 4 * levels, ca = Math.cos(ang), sa = Math.sin(ang);
      // The y flip is not cosmetic: without it this reference is a mirror of
      // the dragon and reads Jaccard 0.179 against a correct kernel. The first
      // measurement of this fix hit exactly that and blamed the kernel.
      return pts.map(([px, py]) => [(px * ca - py * sa) * scale, -(px * sa + py * ca) * scale]);
    };

    const G = 48, X0 = -0.4, X1 = 1.25, Z0 = -0.4, Z1 = 0.75;
    const cell = (x, z) => {
      const c = Math.floor((x - X0) / (X1 - X0) * G), r = Math.floor((z - Z0) / (Z1 - Z0) * G);
      return (c >= 0 && c < G && r >= 0 && r < G) ? r * G + c : -1;
    };

    const truth = new Uint8Array(G * G);
    for (const [x, z] of paperFolding(12)) { const i = cell(x, z); if (i >= 0) truth[i] = 1; }

    // The drawn plate, read in the dragon's own coordinates: the kernel puts
    // the attractor's centre at the plate centre with u = 0.41667 + x·freq·0.26.
    const f = getFormula('fractals', 'dragon').f;
    const drawn = new Uint8Array(G * G);
    const peak = (() => {
      let m = 0;
      for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
        const u = X0 + (c + 0.5) / G * (X1 - X0), v = Z0 + (r + 0.5) / G * (Z1 - Z0);
        const y = f((u - 0.41667) / 0.26, (v - 0.16667) / 0.26, 0, { amp: 1, freq: 1, comp: 0.5 });
        if (y > m) m = y;
      }
      return m;
    })();
    for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
      const u = X0 + (c + 0.5) / G * (X1 - X0), v = Z0 + (r + 0.5) / G * (Z1 - Z0);
      const y = f((u - 0.41667) / 0.26, (v - 0.16667) / 0.26, 0, { amp: 1, freq: 1, comp: 0.5 });
      if (y > peak * 0.05) drawn[r * G + c] = 1;
    }

    let inter = 0, uni = 0;
    for (let i = 0; i < truth.length; i++) { if (truth[i] || drawn[i]) uni++; if (truth[i] && drawn[i]) inter++; }
    const jaccard = inter / uni;
    assert.ok(jaccard > 0.7, `drawn set against the paper-folding dragon: Jaccard ${jaccard.toFixed(3)}`);

    // The other half of the old defect: neighbouring vertices used to be
    // independent samples of the attractor — measured neighbour correlation
    // 0.027 across x on grid 90, with 83.1 % of the plate at exactly 0.
    const grid = 90;
    const hf = generateSurfaceFromFormula(f, { amp: 1, freq: 1, comp: 0.5 }, grid, 3.5, 0);
    let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (let r = 0; r < grid; r++) for (let c = 0; c + 1 < grid; c++) {
      const a = hf[r * grid + c], b = hf[r * grid + c + 1];
      n++; sx += a; sy += b; sxy += a * b; sxx += a * a; syy += b * b;
    }
    const corr = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    assert.ok(corr > 0.5, `neighbouring vertices correlate at ${corr.toFixed(3)} — a picture, not speckle`);

    const zeros = Array.from(hf).filter(v => v === 0).length / hf.length;
    assert.ok(zeros < 0.8, `${(zeros * 100).toFixed(1)} % of the plate is exactly zero`);
  });
});


// ── Round 11: the two simulations that never advanced ────────────────────────
// createCachedHeavySampler calls its simulator on every rebuild — 16-20 per
// second — and both of these allocated and re-seeded their fields each time, so
// neither medium ever got past its first hundred Euler steps whatever the clock
// said. Gray-Scott showed one round blob; the Barkley medium that replaced
// FitzHugh-Nagumo showed a barely-relaxed initial condition, bit-identical at
// every t.
describe('Round 11 — the media advance, and they carry a pattern', () => {

  const plate = (key, comp, t) => Array.from(generateSurfaceFromFormula(
    getFormula('cellularAutomata', key).f, { amp: 1, freq: 1, comp }, 64, 3.5, t));

  // Interface length at half the peak: a blob and a flooded lattice both read
  // near zero, a pattern reads in the hundreds. Counting cells above a
  // threshold cannot tell those three apart, which is how the shipped
  // Gray-Scott passed for a pattern at 1.95 % coverage.
  const interfaceLength = (p, g = 64) => {
    const peak = Math.max(...p), thr = peak * 0.5;
    let n = 0;
    for (let r = 0; r < g; r++) for (let c = 0; c < g; c++) {
      const i = r * g + c, rp = ((r + 1) % g) * g + c, cp = r * g + (c + 1) % g;
      if ((p[i] > thr) !== (p[rp] > thr)) n++;
      if ((p[i] > thr) !== (p[cp] > thr)) n++;
    }
    return n;
  };

  for (const key of ['reactionDiffusion', 'excitableMedia']) {
    test(`${key} draws a pattern across the whole reachable comp band`, () => {
      for (const comp of [0.5, 0.7, 0.9]) {
        const len = interfaceLength(plate(key, comp, 0));
        assert.ok(len > 200, `${key} at comp ${comp}: interface length ${len} — that is a blob or a flood, not a pattern`);
      }
    });

    test(`${key} moves with the clock`, () => {
      const a = plate(key, 0.5, 0), b = plate(key, 0.5, 40);
      let worst = 0;
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
      assert.ok(worst > 0.05, `${key} moved by ${worst.toExponential(2)} between t = 0 and t = 40`);
      for (const v of b) assert.ok(Number.isFinite(v), `${key} produced a non-finite value at t = 40`);
    });
  }

  test('continuing a medium gives the same field as computing it cold', () => {
    // The continuation cache is keyed by (regime bucket, step count), so the
    // field at a clock value must not depend on which clock values were asked
    // for on the way there. Sampling t = 0, 10, 40 walks the cache forward;
    // crossing into another comp bucket drops it; coming back recomputes t = 40
    // from the seed. The two have to agree, or the cache is inventing history.
    plate('excitableMedia', 0.5, 0);
    plate('excitableMedia', 0.5, 10);
    const continued = plate('excitableMedia', 0.5, 40);
    plate('excitableMedia', 0.9, 40.5);           // different bucket — state dropped
    const cold = plate('excitableMedia', 0.5, 40);

    let worst = 0;
    for (let i = 0; i < cold.length; i++) worst = Math.max(worst, Math.abs(cold[i] - continued[i]));
    assert.equal(worst, 0, `continued and cold fields differ by ${worst}`);
  });
});


// ── Round 11 tail: three copies of one name, and none of them free to drift ──
describe('the catalogue, the picker and the accuracy report agree on every name', () => {

  test("the report's Name column is the entry's name", () => {
    // The column header says "Name" and 146 of the 192 rows held an older or
    // shortened caption; three named an object the row's own text says the
    // entry does not draw. This is the guard that keeps the third copy in step
    // with the two the app itself uses.
    const doc = readFileSync(new URL('../MATHEMATICAL_ACCURACY.md', import.meta.url), 'utf8');
    const CELL = String.raw`((?:\\\||[^|])*)`;
    const rowRe = new RegExp(String.raw`^\| \`([A-Za-z0-9_]+)\` \| ${CELL}\| (🟢 A|🔵 B|🟡 C|🔴 D) \| `, 'gm');
    const rows = new Map();
    for (const m of doc.matchAll(rowRe)) rows.set(m[1], m[2].trim().replace(/\\\|/g, '|'));

    const wrong = [], missing = [];
    for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
      for (const [key, entry] of Object.entries(col.formulas)) {
        const cell = rows.get(key);
        if (cell === undefined) { missing.push(`${colId}/${key}`); continue; }
        if (cell !== entry.name) wrong.push(`${key}: report "${cell}" vs name "${entry.name}"`);
      }
    }
    assert.deepEqual(missing, [], `entries with no catalogue row: ${missing.join(', ')}`);
    assert.deepEqual(wrong, [], `the report names them differently:\n  ${wrong.join('\n  ')}`);
    // Control: the walk actually found the tables. A regexp that stopped
    // matching would report nothing wrong about nothing read.
    assert.equal(rows.size, 192, `${rows.size} catalogue rows were read`);
  });

  test('the renamed entries no longer name what they do not draw', () => {
    const gone = [
      ['complexNumbers', 'complexSin', /Re(al)? Part/i, 'Re of a holomorphic function is harmonic; this one has Δu = −0.75u'],
      ['complexNumbers', 'argandField', /Argand Phase Color/, 'the height is sin(n·arg z), two-valued in the phase it claimed'],
      ['differentialEqs', 'reynoldsFlow', /Stokes/, 'a Poiseuille profile times a travelling sine is no Stokes solution'],
      ['integralTransforms', 'hankelTransform', /^Hankel Kernel/, 'the drawn envelope e^{−0.3ρ} is not part of the kernel'],
      ['integralTransforms', 'continuousWavelet', /Scalogram/, 'a scalogram is |W|; the plate is the signed W'],
      ['trigonometry', 'hyperbolicGeom', /Cosh²|Sinh²/, 'the identity in the old name is computed nowhere'],
      ['cellularAutomata', 'langtonAnt', /density/, 'the height is the cell colour — two values, not a count'],
    ];
    for (const [col, key, pattern, why] of gone) {
      const name = getFormula(col, key).name;
      assert.ok(!pattern.test(name), `${col}:${key} still reads "${name}" — ${why}`);
    }
    // Control, as above: a pattern that matches nothing would pass silently.
    assert.match(getFormula('cellularAutomata', 'gameOfLifeDensity').name, /density/i);
  });
});
