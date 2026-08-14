## MATHEMATICAL_ACCURACY.md


# VIMATHIC — Mathematical Accuracy Report

**Scope:** All 192 formulas across 12 collections, shared helper functions, the
6 volume vector fields, and — since round 5 — the 38 GPU displacement branches
in `computeMode()`. Those 38 were outside every earlier revision of this
document, which is how two of them came to render nothing at all and how
SCIENCE.md came to name four modular forms of which one was implemented.
**Date:** 2026-05-10
**Method:** Per-formula classification by numerical method, comparison of stated formula vs implementation, audit of failure modes (truncation, modulation, approximation error).

---

## Executive Summary

| Tier | Count | Definition | Marketing-defensible? |
|------|------:|------------|:---------------------:|
| **A** — machine precision | **127** | Closed-form analytic expressions evaluated at IEEE 754 double precision (~10⁻¹⁰ to 10⁻¹⁴ accuracy). | ✓ Yes |
| **B** — bounded approximation | **34** | Polynomial fits, finite-converged series, well-behaved iterative methods, real PDE/ODE simulations on adaptive grids. Documented error ≤ 10⁻³ to 10⁻⁷. | ✓ Yes |
| **C** — visualization-grade | **31** | Truncated chaotic iterations, decorative modulations, simplified models. Qualitatively faithful but not numerically exact. | Conditional |
| **D** — defects | **0** | All previously identified defects fixed and verified by automated tests. | n/a |

**Tier A + B = 168 formulas with verifiable numerical accuracy.**

**Round 1 — D-tier defects fixed (3):** `tinkerbell`, `dragon`, `jacobian` — all moved up to A or B with regression tests.

**Round 2 — C-tier formulas rewritten with canonical implementations (11):**
- `bessel1` — finite-difference replaced with Numerical Recipes J₁ polynomial. C → **B**, ~10⁻⁷ accuracy.
- `polygamma` — single asymptotic term replaced with full Bernoulli series + recurrence. C → **A**, ~10⁻¹⁰ accuracy.
- `dawson` — naive Riemann sum replaced with Taylor (|x|<3.5) + asymptotic series (|x|≥3.5). C → **A**, ~10⁻⁷ accuracy verified against mpmath.
- `landauLevels` — hardcoded `1-r²/2` replaced with proper generalized Laguerre L_n^0 recurrence. C → **A**, exact for any n.
- `atomicOrbitals` — was mislabeled "sp³" with broken angular structure. Renamed to honest "sp² (xz-plane)". C → **A**. (Round 8: the "3-lobe geometry at 120°" claimed here is not what the entry draws — see its row below.)
- `radonTransform` — decorative rotated Gaussian replaced with analytic Radon transform of two Gaussians (closed form). C → **A**.
- `cauchyIntegral` — Gaussian peak replaced with numerical contour integral, N=24 quadrature. Verified to give f(z₀) inside contour, 0 outside. C → **B**.
- `windingNumber` — `sin(2θ)` replaced with numerical winding count via `∮dz/(z-z₀)/(2πi)`. Returns ~n_loops inside, ~0 outside. C → **B**.
- `conway3D` — 1D Wolfram rule replaced with real 3D B5-7/S6 simulation on 18³ grid, 3–5 generations. C → **B**.
- `excitableMedia` — sin-spiral replaced with FitzHugh-Nagumo PDE on an optimised internal grid, bilinearly interpolated onto the display mesh. C → **B**.
- `reactionDiffusion` — threshold-of-oscillators replaced with Gray-Scott reaction-diffusion on an optimised internal grid, bilinearly interpolated onto the display mesh, with configurable F/k regimes. C → **B**.

**Round 5 — the 2026-08-13 audit.** Every entry below was re-derived against an
independent reference (Gauss–Legendre quadrature of the defining integral, a
second algorithm, or a canonical constant), not against the implementation.

- `erf` — the Abramowitz & Stegun §7.1.26 Horner fit was rated A while its own
  error bound is 1.5·10⁻⁷; measured 1.394·10⁻⁷ at x = 0.045. Replaced by the
  all-positive series 2/√π·e^{−x²}·Σ2ⁿx^{2n+1}/(2n+1)!!, which has no
  alternating cancellation. Now 7.7·10⁻¹⁵ over the reachable domain. Stays **A**,
  and now earns it.
- `dawson` — Taylor below |x| = 3.5, five-term asymptotic above: 1.9·10⁻¹² at
  x = 3.4 against **3.2·10⁻⁵** at x = 3.5, a seam inside the domain the entry
  reaches at the default wave intensity. The asymptotic series for F is
  divergent, so no term count closes it. Replaced by Rybicki's lattice sum,
  ~3·10⁻¹⁵ over |x| ≤ 24. Stays **A**.
- `clausen` — twelve terms of Σ sin(kθ)/k², which converges like 1/N and had no
  accuracy at the ends of the period. Replaced by the log-sine expansion
  θ − θ ln θ + θ·Σ ζ(2n)/(n(2n+1))·(θ/2π)^{2n}. Exact to 10⁻¹⁶ at Catalan's
  constant and at Cl₂(π/3). B → **A**.
- `airy` — no forward march of y″ = xy survives, whatever the step size: the
  growing Bi solution takes over. Measured, Ai came back **negative** from
  ξ ≈ 4.88, inside the ξ ≤ 5.25 the default wave intensity reaches, where the
  true Ai is positive everywhere. Marching replaced by the Maclaurin series on
  |x| ≤ 8 and the standard asymptotics beyond (u₀…u₅), and cheaper than the RK4
  loop it replaces. C → **B**, absolute error ≤10⁻¹³ over the default window
  |x| ≤ 5.25 and ≤10⁻⁸ over the whole reachable |x| ≤ 24.

  *Second pass.* This entry was first written up here as C → A on a claimed
  10⁻¹⁴. An adversarial re-derivation — Decimal series at 130+ digits, a contour
  integral through the saddle, and the Bessel identity
  Ai(−y) = √(y/3)·(J_{1/3}+J_{−1/3}), all three agreeing — showed that is not
  what the series delivers: it alternates, so it loses digits exactly where |Ai|
  is smallest. At x = 8 the largest partial is 1.34·10⁶ against |Ai| = 4.7·10⁻⁸,
  leaving about 2.5 significant digits, and the measured worst absolute error is
  1.1·10⁻¹⁰ at the positive seam and 1.2·10⁻⁸ at the negative one. Invisible on
  a mesh (10⁻⁸ against a frame ~3 units high) — but the tier and the number in
  this document have to be the ones that were measured, so both are corrected.
- `zeta` — 14–22 terms of Σn^{−s} is 85 % below ζ(1.05); shifting the window to
  start at 1.05 removes the divergence and nothing else. Euler–Maclaurin closes
  it in the same budget, ~10⁻¹⁰ across the window. C → **B**.
- `hypergeometric` — the early exit at 10⁻⁸ never fired (the twelfth term at
  z = 0.875 is 2.5·10⁻²), so the truncation was hard at twelve terms and two
  orders outside tier B. Euler's transformation plus a 120-term cap brings the
  worst reachable point to 6.5·10⁻⁵. Stays **B**.
- `chebyshev` — the ±(1−10⁻⁹) guard inside acos cost 2.5·10⁻⁸ on the entire
  saturated rim, not at one point. Removed; the argument was already clamped.
  Stays **A**.
- `gamma_fn` — drew 0.12·ln|Γ(n)| under the caption Γ(n) = (n−1)!. Over the
  window it shows, Γ runs 4.591 → 0.8856 → 4.694 and fits the frame directly,
  so the log was not even buying headroom. Now plots Γ. Stays **A**.
- `hydrogenS` — |ψ₁₀₀|² was multiplied by cos²(l·θ + 0.3t) with l = 0, i.e. by
  cos²(0.3t): the 1s orbital blinked out completely every 21.8 s of wall clock,
  peak falling from 3.623 to 4.9·10⁻¹¹. An s state is spherically symmetric and
  stationary. The angular factor is now applied only for l ≥ 1. Stays **A**.
- `feynmanPath` — the eighth entry reading the session clock as a physical age,
  missed by round 4 because that fix worked from a hand-written list. Amplitude
  1/√(0.5+0.05t) fell to 0.107 of boot at thirty minutes and 0.038 at four
  hours. Now folded to a 24-unit period; t = 0 is bit-identical. Stays **A**.
- `catenoid` — exact and unwatchable: peak |y| of 8.2·10¹ at the **default**
  wave intensity against a frame ~3 units high, 5.1·10¹² at the top of the
  range. Output clamped to ±1.5, which leaves the neck and the zero level set
  untouched. Stays **A**.
- `legendre2` / `sinc` — captions corrected to the surface actually drawn
  (Pₙ with n ∈ {3,4,5}; the radial sinc, not sinc of x).

Volume fields: `fluidVortex` was described as incompressible and had
∇·v = −amp·0.1·freq·sin(y·freq+t) — its vertical component is now driven by the
cylindrical radius, so ∇·v ≡ 0 exactly. `magneticDipole` applied its
regularising ε to the numerator as well as the denominator, which made the
axis-to-equator ratio −1.667 instead of the −2 a dipole gives at any radius;
the true r² is restored and the ratio is now exact. `lorenzField` scaled its
three components by three different constants, so the direction of the vector
was wrong everywhere; one scale now, and β = 8/3 rather than 2.667.

<!-- This counts tests/math-validation.test.js alone. `npm test`
     runs every other suite in tests/ as well. -->
Test suite: the validation file passes in full, including the regression tests that fail
on the pre-round-5 code and pass on this one.

### A note on grid resolution

Formulas labelled as running "on a 64×64 grid" or similar in this document refer to the **internal simulation grid** used by heavy CPU formulas (cellular automata, reaction-diffusion PDEs, etc.). These internal grids are bilinearly interpolated onto the main display mesh, whose resolution is adaptive:

- Desktop with discrete GPU: up to **160×160 segments**
- Desktop with integrated GPU: **120–160 segments**
- Mobile: **60–80 segments**
- High-end GPU (RTX-class): up to **200 segments**

The interpolation ensures smooth visual output at the display mesh's full resolution regardless of the internal simulation resolution. The internal grid sizes (40×40 to 64×64) were chosen as the sweet spot where simulation accuracy meets real-time performance — doubling them would exceed the frame budget on mid-range hardware.

---

## Tier Definitions

### Tier A — Machine Precision (Exact)

The formula is implemented as a closed-form analytic expression, or as an iterative method that converges to machine precision well within the iteration budget. Validation: direct comparison against reference implementation (scipy, mpmath, Wolfram) yields agreement to ~14 significant digits for non-pathological inputs.

Examples: `gaussian` (direct PDF formula), `chebyshev` (cos(n·acos(x))), `lambertW` (Halley iteration converges quadratically — 6 steps gives ~10⁻¹⁴).

### Tier B — Bounded Approximation

The formula uses a numerical method whose error is documented in the literature and bounded within stated parameter ranges. Truncated series, polynomial fits (e.g. Abramowitz & Stegun), midpoint integration, well-converged iterative maps, PDE simulations on adaptive grids with bilinear interpolation to display resolution.

Examples: `besselJ0` (Numerical Recipes polynomial — max error 1.5×10⁻⁷), `erf` (Abramowitz Horner — max error 1.5×10⁻⁷), `henon` (20-iteration map, attractor reached), `reactionDiffusion` (Gray-Scott PDE on optimised internal grid, ~10⁻³ accuracy limited by grid discretisation and Euler integration).

### Tier C — Visualization-Grade

The formula is qualitatively faithful — it produces visually correct shape and structure — but cannot be numerically validated against canonical references because of one or more of:
- Iteration budget too low for chaotic system convergence (e.g. Lorenz attractor with 8 Euler steps).
- Audio modulation alters core formula parameters (e.g. magnetic dipole moment `m = amp·sin(t)`).
- Output is decorated by an envelope or threshold function that breaks direct correspondence.
- Simplified model that captures qualitative behaviour but omits canonical normalization or higher-order terms.

These formulas are honest **artistic interpretations** of mathematical structures, not measurements of them.

### Tier D — Defect

Either the implementation does not match the stated formula at all, or there is a numerical bug. Must be fixed before any accuracy claim is made. Currently zero.

---

## Per-Collection Breakdown

Tier ratings shown as: 🟢 A · 🔵 B · 🟡 C · 🔴 D

### 1. Fractals & Chaos (16) — 0 A · 6 B · 10 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `mandelbrot` | Mandelbrot Escape | 🟡 C | maxIt = 6–16. Canonical fractal needs 100–10000 iter for crisp boundary. |
| `julia` | Julia Set (animated) | 🟡 C | Same as above + time-varying c. |
| `burningShip` | Burning Ship | 🟡 C | Same iteration budget issue. |
| `lorenz` | Lorenz Attractor Slice | 🟡 C | 8 Euler steps with dt=0.004. RK4 + dt=0.001 needed for reliable trajectories. `freq` modulates initial conditions, drifting from canonical (σ=10, ρ=28, β=8/3) Lorenz attractor. |
| `rossler` | Rössler Attractor | 🟡 C | 12 Euler steps. |
| `newtonFractal` | Newton Fractal z³−1 | 🟡 C | 4–12 iterations. Inside basins converges fast; near boundary needs much more. |
| `sierpinski` | Sierpiński IFS | 🔵 B | Math is exact; depth 2–6 limits resolution. |
| `lyapunov` | Lyapunov Exponent Map | 🟡 C | Round 6 fixed three things. The parameter window ran to 5.6, where the logistic orbit escapes to −∞ and the exponent is not an exponent of anything — 73.6 % of the plate sat pinned at the +0.8 clamp, i.e. most of the picture was the clamp. It is now [2.6, 4.0]. The average began at the first iterate with no transient discarded, which put the wrong SIGN on 10.2 % of vertices (order reported as chaos); 48 iterations are now burned in first. And `if (isFinite(lam)) n++` counted a step whose own term was infinite; the guard is now on the term. Clamp → `soften(0.5, 0.9)`. Round 8: 48 iterations at comp = 0 and 96 at comp = 1 cannot pin a chaotic Lyapunov average to a bounded error — the ~1/√n scatter puts 10 % of the plate above 1.5e-2 in drawn units against a limit computed by mpmath quadrature of the exact invariant density (control: λ(r=4) = ln 2 to 8.8e-23). Truncated chaotic iteration is the definition of tier C in this document's own table. |
| `dragon` | Dragon Curve Density | 🔵 B | Heighway IFS via deterministic bit-pattern branch selection. Attractor convergent at depth 8–14. |
| `chua` | Chua Circuit Attractor | 🟡 C | 10 Euler steps. |
| `cantorDust` | Cantor Dust | 🔵 B | Base-3 decomposition exact; depth 2–6 limits resolution. |
| `ikeda` | Ikeda Map | 🔵 B | 8 iterations adequate. |
| `logistic` | Logistic Map Bifurcation | 🟡 C | 40–80 iterations sufficient for attractor, but output `exp(-50·(x-target)²)` is decorative envelope, not direct map value. |
| `duffing` | Duffing Oscillator | 🟡 C | 15 Euler steps with dt=0.01. |
| `henon` | Hénon Map | 🔵 B | 20 iterations on canonical attractor. |
| `tinkerbell` | Tinkerbell Map | 🔵 B | 12-iteration map on canonical Tinkerbell attractor. Post-loop `isFinite` guard added — no longer returns `Infinity`. |

### 2. Special Functions (16) — 10 A · 6 B · 0 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `bessel0` | Bessel J₀ | 🔵 B | Numerical Recipes polynomial fit, max error ~10⁻⁷. |
| `bessel1` | Bessel J₁ | 🔵 B | Numerical Recipes J₁ polynomial fit, max error ~10⁻⁷. Replaced finite-difference approximation. |
| `legendre2` | Legendre Pₙ Surface | 🟢 A | Closed-form polynomials P₀–P₆. n = round(1 + comp·4), so the reachable comp range renders P₃–P₅. |
| `gamma_fn` | Gamma Function | 🟢 A | Lanczos g=7, ~10⁻¹⁴. Plots Γ(n) itself over n ∈ [0.2, 3.8], including the minimum 0.8856 at n = 1.4616 — it used to plot 0.12·ln\|Γ(n)\| under this caption. |
| `erf` | Error Function | 🟢 A | All-positive series 2/√π·e^{−x²}·Σ2ⁿx^{2n+1}/(2n+1)!!, measured 7.7×10⁻¹⁵. Replaced an Abramowitz & Stegun Horner fit whose own bound is 1.5×10⁻⁷ — a tier-B number under a tier-A rating. |
| `zeta` | Riemann Zeta (real axis) | 🔵 B | Euler–Maclaurin: 15 direct terms, integral tail, two Bernoulli corrections. ~10⁻¹⁰ across the window. Replaced a 14–22 term Σ 1/n^s that was 85 % below ζ(1.05) — the domain shift to [1.05, 5.05] removed the divergence and left the convergence rate untouched. `comp` now stretches the s-window instead of setting the term count. |
| `airy` | Airy Function Ai(x) | 🔵 B | Maclaurin series from the exact (Ai(0), Ai′(0)) seed, six-term DLMF 9.7 asymptotics beyond, with the handover at \|x\| = 7 on the right and 10 on the left. Worst absolute error against mpmath: 1.8e-13 over the default window \|x\| ≤ 5.25, 1.2e-11 on the right branch, 3.3e-8 on the left. Round 8: one handover served both signs, and they fail in opposite directions — Ai decays on the right, so the alternating series loses everything to cancellation (relative error 1.1e-3 at x = +8), while on the left it oscillates at O(1) and the series still beats the asymptotic out to \|x\| = 10. That single threshold left 1.26e-7 under a row claiming ≤10⁻⁸. |
| `hypergeometric` | ₂F₁(a,b;c;z) | 🔵 B | Euler transformation (1−z)^{c−a−b}·₂F₁(c−a,c−b;c;z), 120-term cap, relative early exit at 10⁻¹². Worst reachable point 6.5×10⁻⁵. The previous 12-term cut never reached its 10⁻⁸ exit: the twelfth term at z = 0.875 is 2.5×10⁻². |
| `laguerre` | Laguerre L_n | 🟢 A | Closed-form three-term recurrence. |
| `chebyshev` | Chebyshev T_n | 🟢 A | Direct cos(n·acos(x)), \|x\| ≤ 1. Exact on the rim now: the ±(1−10⁻⁹) guard inside acos cost 2.5×10⁻⁸ across the whole saturated edge, and the argument was already clamped. |
| `sinc` | Cardinal Sinc (radial) | 🟢 A | sin(πr)/(πr) with r = √(x²+z²)·freq·2 — the "sombrero", which is what it always drew. The caption said sinc(x). |
| `ellipticK` | Elliptic K(k) | 🔵 B | Midpoint rule N=16. ~10⁻⁴ accuracy for k<0.95. |
| `dawson` | Dawson F(x) | 🟢 A | Rybicki lattice sum, one algorithm for the whole line, ~3×10⁻¹⁵ over \|x\| ≤ 24. Replaced a Taylor/asymptotic pair with a 3.2×10⁻⁵ step at their |x| = 3.5 seam, inside the reachable domain. |
| `clausen` | Clausen Cl₂(θ) | 🟢 A | Log-sine expansion θ − θ ln θ + θ·Σ ζ(2n)/(n(2n+1))·(θ/2π)^{2n}, exact to 10⁻¹⁶ at Catalan's constant. Replaced a 12-term Fourier sum, which converges like 1/N and so had no accuracy at the ends of the period. |
| `polygamma` | Digamma ψ(x) | 🟢 A | Recurrence lifting x to ≥ 12, then the Bernoulli asymptotic through B₁₀. Worst error 3.6e-15 against mpmath over the drawn range (control: ψ(1) = −γ and ψ(½) = −γ−2ln2 to 40 digits). Round 8: the lift stopped at 8 with four terms, leaving the first dropped term B₁₀/(10·8¹⁰) = 7.06e-12 — and the measured error was 6.77e-12, that term and nothing else, under a letter promising ~10⁻¹⁴ while this row's own prose said ~10⁻¹⁰. The left 3.7 % of the plate (x ≤ −3.245) still rests on the ±0.6 display clamp, since ψ(0.2)·0.2 = −1.06. |
| `lambertW` | Lambert W(x) | 🟢 A | Halley iteration converges quadratically — 6 steps → machine precision. |

### 3. Probability & Statistics (16) — 9 A · 5 B · 2 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `gaussian` | Gaussian Bell | 🔵 B | Not a PDF: the wrapper is exactly σ√(2π)·0.55, which cancels the 1/(σ√2π) the formula string names. The omitted factor is not a constant either — σ rides `comp`, so it runs 1.034 → 1.199 (+16 %) across one sweep of the mid band. Same criterion this file already applies to `studentT` and `vonMises`. |
| `bivariate` | Bivariate Gaussian | 🟢 A | Closed-form 2D Gaussian with correlation. |
| `cauchy` | Cauchy | 🟢 A | 1/(π(1+x²)). |
| `laplace` | Laplace | 🟢 A | (1/2b)·exp(-\|x\|/b). |
| `maxwellBoltzmann` | Maxwell–Boltzmann | 🔵 B | v²·exp(−v²/2a²) — the kernel, not the density: the wrapper is exactly 0.6·a³·√(π/2)... i.e. the √(2/π)/a³ of the distribution is cancelled. The omitted factor rides `comp` too, 0.548 → 0.896 (+63 %). |
| `poisson` | Poisson PMF | 🟢 A | Log-domain stable computation. **Note**: output multiplied by `(k%2===0?1:-1)` for visual contrast — sign-flipped, not the PMF. |
| `randomWalk` | Brownian Motion (seeded) | 🟡 C | LCG-driven walk — statistically not Wiener process realisation, just a deterministic path with similar shape. |
| `ornsteinUhlenbeck` | Ornstein–Uhlenbeck | 🔵 B | Round 6: there was no noise in what was drawn. The seed advanced ~8 per vertex out of a 65536 period read through `&0xffff`, so every vertex on the row got the same twenty increments and what varied was the initial condition relaxing smoothly — total variation over span 1.09, the signature of a monotone curve. x is now the time axis of one sample path integrated from the left edge, so neighbouring vertices share history: total variation over span 9.91, stationary variance 1.84e-2 against σ²/(2θ) = 1.78e-2, autocorrelation at lag 1.0 of 0.194 against e^{−θ} = 0.223. B rather than A because explicit Euler at dt = 0.05 with uniform increments is what leaves those two gaps. Round 8: the generator is sound — the hash32 increments pass a KS test against U(−1,1) at p = 0.86 — but explicit Euler at dt = 0.05 does not reproduce the process exactly: stationary variance 2.17e-2 against the AR(1) value 1.85e-2 and lag-1 autocorrelation 0.246 against 0.210, both about 17 % out. That is the discretisation, not the noise, and it is what tier B here means. |
| `chiSquare` | Chi-Squared | 🟢 A | Closed-form via gamma. |
| `studentT` | Student's t | 🔵 B | Missing normalization constant Γ((ν+1)/2)/(√(νπ)Γ(ν/2)). Shape exact, scale off by const. |
| `entropyLandscape` | Shannon Entropy | 🟢 A | Standard binary entropy. |
| `mixtureGaussians` | Gaussian Mixture | 🔵 B | Sum of normal PDFs with wᵢ = 1, not weights summing to 1, so the height is n times a mixture density: measured multiplier 1.600000000 at n = 4 and 2.000000000 at n = 5 (= 0.4·n, spread ≤2.9e-15). `comp` crossing 0.7 adds a component and lifts the whole surface 25 % — the same missing-normalisation criterion the file already applies to `studentT` and `vonMises`. |
| `pareto` | Pareto | 🟢 A | α·xm^α/x^(α+1). |
| `kernelDensity` | KDE | 🟢 A | Sum of fixed-kernel evaluations. |
| `vonMises` | von Mises | 🟢 A | Round 6 restored 1/(2πI₀(κ)) — and the point is that it is not a constant: κ = 1 + comp·4 with comp riding the mid band, so the omitted factor ran 30.7 at comp 0.5 and 120.0 at comp 0.9 and the surface changed height by ×3.9 with the music while calling itself a density. It also stood 3.5 world units tall at the factory sliders against a ~3-unit frame. Now the density itself, whose peak e^κ/(2πI₀(κ)) grows only as √(κ/2π). I₀ by ascending series, twenty terms. |
| `metropolisWalk` | MCMC Metropolis | 🟡 C | 40-step deterministic Metropolis + decorative output `exp(-3·(v-x)²)` — not direct sample density. |

### 4. Linear Algebra (16) — 10 A · 4 B · 2 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `eigenField` | Eigenvector Field | 🟢 A | Round 6: A(t) = R(0.3t)·diag(1+comp, −1)·R(0.3t)ᵀ and the height is (v × Av)/\|v\|, the signed distance from Av to the line through v. It is exactly zero on the eigenvectors and nowhere else, so the surface is the statement `Av = λv` rather than a decoration of it. Previously a fixed linear functional of Av, and the old matrix was identically zero at t = 5π + 10πk — the plate went flat once every 65 s. |
| `determinant` | Determinant | 🟢 A | ad-bc exact. |
| `svdSpectrum` | SVD Singular Value | 🟢 A | Closed-form 2×2 singular value formula. |
| `trace` | Matrix Trace | 🟡 C | `cos(r)ⁿ` is exactly tr(Aⁿ) for a rank-one A of trace cos r — checked by multiplying an explicitly built matrix, not by quoting the identity: agreement 4.4·10⁻¹⁶ over the plate. C stands because the entry names no particular A, and the reading a reader reaches for first — A a rotation by r — gives 2cos(nr), which differs from the drawn surface by up to 1.13 against its own peak of 0.5. |
| `tensorField` | 2D Tensor Field | 🔵 B | x²+xz+z² is sum of T components, not tensor norm — but scalar functional of T. |
| `hessian` | Hessian Determinant | 🔵 B | Analytic Hessian of sin(x)+sin(z). Exact. |
| `rotationMatrix` | Rotation Matrix Flow | 🟢 A | Rotation matrix exact. |
| `gram` | Gram–Schmidt | 🟢 A | Exact 2D Gram-Schmidt projection. |
| `quadraticForm` | xᵀAx | 🟢 A | Direct quadratic form evaluation. |
| `nullspace` | Nullspace Projection | 🟢 A | Exact orthogonal complement projection. |
| `spectralRadius` | Spectral Radius | 🟢 A | Round 6: ρ = (\|tr\| + √disc)/2 for a real pair and √det for a complex one — both branches closed-form and exact. The previous kernel returned √\|disc\|·0.3, which is 0.3·\|λ₁ − λ₂\|, the spread rather than the radius; the trace here is not zero (tr = x·freq·comp), so the ratio to ρ ran across [0.220, 0.600] and no constant could absorb it. The 0.8 clamp went with it — it was pinning 57.8 % of the mesh flat at the default slider. |
| `matrixExp` | Matrix Exponential | 🟡 C | `cosh(r·comp)·cos(r) - 1` is a stylized substitute, not general e^A. |
| `kronecker` | Kronecker Product | 🔵 B | Grid+sub-grid product structure correct conceptually. |
| `vectorField` | Curl ∇×F | 🟢 A | Closed form. F = (−sin(z·f), sin(x·f)) has curl f·(cos(x·f) + cos(z·f)), divided by f so a derivative-valued formula does not scale with the frequency slider. The field has to be named: the stencil that used to stand here was correct, but it was applied to a gradient field, whose curl is identically zero — the formula rendered a flat plate until the field was replaced. Round 6 removed the stencil itself: central differences with h = 0.01 give 4–5 correct digits, measured 3.3e-5 at the default slider and 6.9e-4 at the top of it, which is not the ~10⁻¹⁰ this row claimed. |
| `jacobian` | Jacobian Det | 🟢 A | Closed form for u = cos(f(x+z)), v = sin(1.3fx) + sin(1.9fz)/1.9 — which is the map the old stencil was in fact differentiating: it varied only the second occurrence of z in `sin(z·f·0.9 + z·f)`, so the derivative it formed was f·cos(1.9fz) rather than 1.9f·cos(1.9fz). The drawn surface is unchanged; it is now exact rather than 9.1e-5 out at the default slider and 3.9e-2 at the top. (Round 1 fixed an operator-precedence bug here; round 6 removed the stencil.) |
| `manifoldCurvature` | Gaussian Curvature | 🔵 B | Round 6: now the full K = (F_xx·F_zz − F_xz²)/(1 + F_x² + F_z²)², h = 0.05 central differences, worst deviation from the closed-form K 8.4e-5 over the plate. The denominator — named in the formula string — was absent, so the drawn quantity was the Hessian determinant, off by up to 1.39× in shape, not scale. The display constant rose 0.15 → 6.0 with it (the old one left the peak at 0.021 units against a ~3-unit frame) and the ±0.6 clamp became `soften(±1.2, ±2.6)`: K grows as freq⁴ where both slopes vanish, so the over-drive range is folded instead of cut. Round 8: the 8.4e-5 above holds at freq = 1 and only there — the h = 0.05 stencil is fixed while the surface it differentiates steepens with the slider, so the error on K is 4.0e-4 at freq 2 and 2.8e-3 at freq 3.5. Tier B is met across the range; the single number was not the whole story. |

### 5. Trigonometry (16) — 15 A · 0 B · 1 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `sinCos` | sin·cos product | 🟢 A | Trivially exact. |
| `pythagorean` | Pythagorean wave | 🟢 A | sin²-cos² = -cos(2x), exact. |
| `sumAngle` | Sum of angles identity | 🟢 A | Validates identity sin(α+β)=sinα·cosβ+cosα·sinβ. |
| `doublAngle` | Double angle | 🟢 A | Exact. |
| `halfAngle` | Half-angle | 🟢 A | sin(x/2), and the identity the caption states is the same number: max \| \|sin(u/2)\| − √((1−cos u)/2) \| = 7.955e-15 over 2000 samples × four wave intensities. The old B asked that the caption name the side that is evaluated; applied consistently that demotes `doublAngle`, `productSum` and `chebyshevTrig` too, and all four state identities whose two sides agree with what is drawn. The one entry where they do not — `inverseTrig`, whose identity is the constant π/2 while the surface runs ±0.411 — is repaired in the caption instead. |
| `productSum` | Product-to-sum | 🟢 A | 2sinAsinB = cos(A-B)-cos(A+B), exact. |
| `tangentWave` | Tanh | 🟢 A | Built-in Math.tanh. |
| `lissajous` | Lissajous | 🟢 A | Exact. |
| `hyperbolicGeom` | Cosh²-Sinh² | 🟢 A | cosh(r)-1, exact. |
| `chebyshevTrig` | Chebyshev identity cos(nθ) | 🟢 A | The right-hand side of T_n(cos θ) = cos(nθ), instantiated exactly: the surface is cos(n·π·0.9·x)·0.45 to 6.3e-15. NOT the same formula as `specialFunctions.chebyshev` — that one applies acos to the clamped coordinate and draws the polynomial with its plateau rim; this one has no acos anywhere and is a plain sinusoid, the same kernel as `complexNumbers.moivre` up to constants. |
| `standingWave` | Standing wave | 🟢 A | sin(kx)·cos(ωt). |
| `travelingWave` | Traveling wave | 🟢 A | sin(kx-ωt). |
| `modeInterference` | Mode interference | 🟢 A | Σ sin(nx)·cos(nωt)/n. |
| `circularFunctions` | sec·csc | 🟡 C | Outside the guard band the surface is clamp(sec·csc·0.04·amp, ±0.7) exactly — residual 0.000e+0 against an independent sec·csc, so it is genuine sec/csc there, not decorative. C is for the guard itself: `\|cos\|>0.1` returns 0 at the poles, where the clamp had already capped the value, so instead of saturated ridges the mesh gets a hole — 12.3 % of vertices sit at exactly 0 and the largest step between neighbouring vertices is 0.7000, the whole half-height, in one mesh step. |
| `atan2Field` | atan2 phase | 🟢 A | Exact. |
| `inverseTrig` | arcsin | 🟢 A | Math.asin clamped to exactly ±1. Round 6: the argument was held off ±1 by 1e-6 and then again by 1e-9, and asin(±1) = ±π/2 needs neither — the whole saturated rim sat 4.243e-4 world units below where it belongs, and the rim is 31.9 % of the row at freq 1.5, not one vertex. |

### 6. Complex Numbers (16) — 14 A · 1 B · 1 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `euler` | Re(e^iθ) | 🟢 A | cos(θ). |
| `eulerIm` | Im(e^iz) | 🟢 A | e^(−z)·sin(x), exact. Round 6 folded the display: e^{−z·freq} has no envelope, so the z = −3.5 edge stood 10.4 world units high at the FACTORY sliders — the largest such offender in the catalogue — and grew without limit across the slider range. `soften(0.9, 1.8)` leaves the oscillation exactly as computed wherever it is legible. Round 8: the fold is not a rim effect — at the factory sliders it already covers 24.4 % of the plate, and inside it the surface is a tanh compression of e^{−z}·sin x rather than the function itself. Outside the fold the agreement is 1.9e-16. |
| `moivre` | De Moivre | 🟢 A | cos(nθ). |
| `complexPower` | \|z^z\| | 🟢 A | Direct via log/exp identity. Round 6: clamp → `soften(0.5, 0.85)`; exp is unbounded, so the cut left 10.2 % of the mesh flat at the default slider. |
| `rootsOfUnity` | n-th roots of unity | 🟢 A | Sum of Gaussians at exact roots. |
| `complexLog` | Log(z) | 🟢 A | ln\|z\| exactly, outside a disc of radius 0.08; inside it, the quadratic meeting the logarithm in value and slope at the rim. Worst deviation outside the disc 1.1e-16 against mpmath. Round 6 replaced a +1e-9 regulariser that fixed the pole's depth rather than removing it — one vertex sat 4.14 units below a surface whose own peak is 0.58, on every odd grid size, and the app's grid floats 60–200 with the GPU. Round 8: its replacement, ln√(r²+0.08²), is not ln\|z\| anywhere — the bias ½ln(1+ε²/r²) is small but never zero, so this row's own claim was false on 100 % of the vertices and by 5.8e-2 at r = 0.07. |
| `riemannSphere` | Stereographic | 🟢 A | (r²-1)/(r²+1) — exact projection. |
| `mobiusTransform` | Möbius (az+b)/(cz+d) | 🟢 A | Direct complex division. Round 6: clamp → `soften(0.5, 0.85)`. The map has a pole at z = −d/c, which enters the plate for large |c|, so the cut was doing real work (10.8 % of the mesh flat at the default slider) — a fold does the same work without erasing the neighbourhood of the pole. |
| `cauchyRiemann` | Re(z²) | 🟢 A | x²-z² is harmonic by construction. |
| `complexSin` | sin(x)cosh(z) | 🟢 A | Re(sin(x+iz)) exact. |
| `juliaPotential` | Julia escape time | 🔵 B | Round 6: the 2⁻ⁿ that defines G(z) = lim log\|fⁿ(z)\|/2ⁿ was missing — the code returned log₂(log\|z_n\|), the logarithm of the potential plus the escape index. Against G run to convergence (200 iterations, escape radius 10⁵⁰) the old expression was off by up to 2.158 on a range whose own maximum is 1.612. Now 1.8e-3, which is the truncation left by stopping at twelve iterations. |
| `windingNumber` | Winding number | 🟢 A | Round 6: argument increments accumulated along the contour rather than 1/(z−z₀) integrated. The old form shared N = 48 nodes across n_loops traversals — 12–16 per loop — which is right deep inside and far outside but carries a ring of spurious poles at \|z₀\| = 1, where the value was set by whichever vertex landed nearest: peak 0.62 / 1.39 / 7.87 / 6.22 across grids 25 / 90 / 161 / 400. Now exactly n_loops inside and exactly 0 outside, identical at every mesh density. |
| `blaschke` | Blaschke product | 🟢 A | Direct iterative complex division. Round 6: the ±0.6 clamp swallowed the surface — 89.7 % of the mesh pinned flat at the bound at the default wave intensity and 99.6 % at the top of the slider, so the viewer got a small disc on a table. `soften(0.45, 0.85)`. |
| `complexHeat` | Heat kernel ℂ | 🟢 A | exp(-r²/4t)/(4πt) exact. |
| `argandField` | sin(arg(zⁿ)) | 🟢 A | sin(n·θ), exact. Round 8: the in-app caption said `arg(z^n)` while this column already said sin(n·θ) — the sine is two-to-one in the phase and spans ±0.45, where the argument itself spans ±π, so the caption now names the sine. |
| `riemannZetaStrip` | ζ on critical strip | 🟡 C | Truncated Dirichlet series — **diverges** on Re(s)=½. Real critical-line ζ needs Riemann-Siegel formula. |

### 7. Fourier Series (16) — 15 A · 1 B · 0 C · 0 D

This is the cleanest collection — every wave is a real truncated Fourier series, exhibiting genuine convergence behaviour including the Gibbs phenomenon.

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `sineWave` | Fundamental sine | 🟢 A | sin(2πx/L). |
| `squareWave` | Square wave Fourier | 🟢 A | Truncated 4/π·Σ sin((2k-1)(x+t))/(2k-1). Round 6 moved the clock inside the harmonic index: added as a common phase it made the sum cos(t)·(series) + sin(t)·(conjugate series), and the best achievable correlation with a square wave fell 0.986 → 0.000 at t = π/2 while the peak swung ×2.18 per cycle. The surface is now a rigid translate of itself — asserted as an identity, not a tolerance. |
| `sawtoothWave` | Sawtooth Fourier | 🟢 A | 2/π·Σ(-1)^(k+1)sin(k(x+t))/k. Same round-6 repair; this was the worst case — at t = π/2 the sawtooth was replaced outright by (2/π)ln(2cos(u/2)), correlation 0.000, peak ×1.62 per cycle. |
| `triangleWave` | Triangle Fourier | 🟢 A | 8/π²·Σ(-1)^k·sin((2k+1)(x+t))/(2k+1)². Same round-6 repair; softest case, since this conjugate series converges absolutely — correlation 1.000 → 0.976 mid-cycle, peak ×1.32. |
| `pulseWave` | Pulse with duty cycle | 🟢 A | Standard pulse Fourier formula, with the round-6 repair. The common phase cost the duty cycle itself: correlation with a pulse of the stated duty fell 0.985 → 0.735 at t = π/2. |
| `gibbsPhenomenon` | Gibbs ~9% overshoot | 🟢 A | Real Gibbs constant ≈ 0.0894 at first overshoot — exhibited correctly. |
| `heat2D` | Heat equation Fourier | 🟢 A | Σ bₙ·sin(nπx)·exp(-n²π²t). |
| `parseval` | Parseval spectrum | 🟢 A | \|cₙ\|² for square wave. |
| `wavelets` | Haar wavelet | 🟢 A | ±1 indicator on dyadic intervals. |
| `dct` | DCT-II | 🔵 B | Full DCT-II, X[k] = Σₙ x[n]cos(π(n+½)k/N) over N=8 samples of a two-harmonic test signal with f₀ = 1 + comp·3. Exact to float64; kept at B because the signal is synthetic rather than a canonical function. Replaced a sum of the basis vector alone, which is the transform of the constant 1 and therefore exactly 0 for every k ≥ 1. |
| `convolution` | (f*g) | 🟢 A | Midpoint rule, 32 nodes, over a window that follows the evaluation point. Round 6: the window was fixed at τ ∈ [−2, 2] while x·freq runs to ±15.9, so for most of the plate the Gaussian kernel sat entirely outside the interval being summed — measured error 106 % of the peak at the default slider and 259 % at freq 2. Worst error now 1.4e-10 across the whole slider range. |
| `spectralLeakage` | Hann + DFT | 🟢 A | Real Hann window + DFT magnitude. |
| `harmonics` | Σ aₙ sin(nx) | 🟢 A | Standard harmonic sum. |
| `stochasticFourier` | Random-phase Fourier | 🟢 A | Despite "random" naming — fully deterministic seeded phases, exactly reproducible. |
| `fejerKernel` | Fejér kernel | 🟢 A | (sin(Nx/2)/sin(x/2))²/N exact. |
| `dirichletKernel` | Dirichlet kernel | 🟢 A | sin((N+½)x)/sin(x/2) exact. |

### 8. Differential Equations (16) — 12 A · 1 B · 3 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `simpleHarmonic` | SHO | 🟢 A | A·cos(ωt+φ). |
| `dampedOscillator` | Damped oscillator | 🟢 A | exp(-γt)·cos(ωt). |
| `forcedOscillator` | Driven resonance | 🟢 A | Steady-state amplitude formula F/√((ω₀²-ω²)²+(2γω)²) — exact. |
| `exponentialDecay` | Exp decay | 🟢 A | x₀·exp(-λt). |
| `logisticGrowth` | Logistic growth | 🟢 A | K/(1+(K/x₀-1)·exp(-rt)) closed-form. |
| `predatorPrey` | Lotka–Volterra | 🟡 C | 5–25 Euler steps — does not conserve invariant H. |
| `heatEquation` | Heat 1D | 🟢 A | Truncated Fourier solution. |
| `waveEquation` | Wave 1D | 🟢 A | Truncated d'Alembert sum. |
| `laplacePDE` | Laplace solution | 🟢 A | Re(z²)=x²-z² is harmonic by construction. |
| `eulerMethod` | Euler method | 🟡 C | Demonstrates Euler — by definition O(h) error. Faithful demonstration of an inaccurate method. |
| `rungeKutta4` | RK4 | 🔵 B | Standard RK4, error O(h⁴). |
| `beamBending` | Euler-Bernoulli beam | 🟢 A | Sinusoidal-load modal solution exact. |
| `schrodingerBox` | Particle in box | 🟢 A | √(2/L)·sin(nπx/L)·cos(Et). |
| `reynoldsFlow` | Stokes/Poiseuille | 🟡 C | The parabolic profile (1−r²) is exact to 5.6e-17 in cross-section. Round 8: the sin(x·freq·0.5 + t·0.3) factor multiplying it makes the streamwise velocity depend on x, and for the unidirectional flow this row names that is a violation of incompressibility — ∂u/∂x reaches 0.225 against max \|u\| = 0.450, i.e. half the field. Exact profile, decorative modulation, and the modulation is what the viewer sees moving; C rather than a bounded-error claim about a flow the field does not satisfy. |
| `fishersEquation` | Fisher wave front | 🟢 A | Round 6: the logistic ansatz is not a travelling-wave solution of Fisher–KPP at any speed — substituting u = σ(kξ) into −cu′ = Du″ + ru(1−u) requires Dk² = 0. Measured residual 1.29 at the speed the code claimed and 0.48 at the best speed any logistic could have. Replaced by the Ablowitz–Zeppetella closed form u = (1 + e^{ξ√(r/6D)})⁻² travelling at c = 5√(rD/6), residual 6e-8. The test puts the drawn profile back into the equation rather than comparing it with another implementation. |
| `pendulumNonLinear` | Phase portrait | 🟢 A | Energy contour H = ½ω² - cos(θ) exact. |

### 9. Integral Transforms (16) — 10 A · 4 B · 2 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `fourierTransform` | FT of Gaussian | 🟢 A | √(π/a)·exp(-ω²/4a) exact. |
| `fourierInverse` | F⁻¹ of rect | 🟢 A | sinc(x). |
| `laplaceTransform` | L{1} | 🟢 A | 1/s on s ∈ [0.35, 5.1]. Round 6 moved the window off the pole: L{1} converges for every Re s > 0, so where the window starts is free, and starting it at 0.1 put the left edge of the plate at 1/0.1 = 10 — 3.5 world units at the factory sliders against a ~3-unit frame, purely because the window was pushed against the pole. |
| `laplaceDecay` | L{e^(-at)} | 🟢 A | 1/(s+a). |
| `zTransform` | Z{a^n} | 🟢 A | z/(z−a) direct, drawn on its region of convergence. Round 6 moved the plate: it used to start at Re z = 0.5 while a reaches 0.9, so part of the picture stood where Σaⁿz⁻ⁿ does not converge and the pole was crossed exactly (Im z = 0 is a row of the mesh). Peak measured 22.8 / 8.4 / 89.2 across grids 25 / 90 / 161 — ×10.6, a different picture per GPU. The plate now starts at \|z\| = a + 0.2. |
| `waveletTransform` | Morlet | 🟢 A | exp(-x²/2)·cos(ω₀x). |
| `hilbertTransform` | (f + H[f])/2 | 🟢 A | Both halves are exact — H[sin ωu] = −cos ωu, verified against the principal-value integral (residual halves with the cut-off: 7.75e-4 → 3.88e-4 → 1.94e-4 at T = 200π/400π/800π, so that is the reference truncating, not a disagreement). What is drawn is their mean, (f + H[f])/2 = sin(ωu − π/4)/√2, not the real part of the analytic signal: Re(f + iH[f]) is f itself. Agreement with (f+H)/2 is exactly 0.0 over all 841 nodes and all 12 sweeps. |
| `radonTransform` | Sinogram | 🟢 A | Analytic Radon transform of two Gaussians (closed form). Replaced decorative rotated Gaussian. |
| `hankelTransform` | "Hankel of f" | 🟡 C | Just J₀(ρ)·exp(-ρ·0.3) — that's the kernel evaluated, not the transform of any function. |
| `mellinTransform` | Mellin kernel | 🔵 B | x^(s-1)·e^(-x) is the integrand. Not the transform itself. |
| `stieltjesTransform` | Stieltjes | 🔵 B | Midpoint on the substitution t = u/(1−u), which carries [0, ∞) onto [0, 1), 64 nodes. Round 6: the integral runs to infinity and the sum stopped at t = 5 with h = 0.25 — worst error 1.6e-2 at z = 0.5, an order and a half outside this tier, and the bound failed at every reachable z. Now 2.0e-5 worst, 2.2e-9 at z = 1, checked against e^z·E₁(z). |
| `cauchyIntegral` | Cauchy formula | 🟢 A | Round 6: singularity subtraction, ∮f/(z−z₀)dz = ∮[f(z)−f(z₀)]/(z−z₀)dz + f(z₀)·2πi·n(z₀). The regular integrand is the polynomial z + z₀ for f = z²+c, so the quadrature never meets the pole, and the winding number is counted by argument increments. Plain quadrature broke as z₀ neared the contour and the reachable region crosses it (\|z₀\| reaches 2.47 against R = 2): peak 1.28 / 4.37 / 14.7 / 35.1 across grids 25 / 90 / 161 / 400, and 33 % low inside the contour. Now exact to 1e-12 at every mesh density. |
| `stocksFormula` | Green's theorem | 🟢 A | Curl computed analytically, exact. |
| `poissonIntegral` | Poisson formula | 🔵 B | Trapezoid on 96 nodes, radius capped at 0.9. Round 6: for boundary data cos(3φ+s) the integral is exactly r³cos(3θ+s), and a trapezoid on N nodes also picks up the modes N±3 with weights r^(N∓3) — at N = 16 and r = 0.95 that is a worst absolute error of 1.52 on a quantity bounded by 1. Now 8.1e-5. |
| `continuousWavelet` | CWT scalogram | 🔵 B | Integrated in ξ = (τ−b)/a over \|ξ\| ≤ 5, 64 nodes, so the window follows the scale. Round 6: the grid was fixed at twenty samples of step 0.3 while the scale runs down to a = 0.1, whose oscillation has period 0.126 in τ — the wavelet simply did not land on it (error 0.39 at a = 0.1, 0.62 at a = 0.35, on a quantity of order 1) — and at the wide end the same fixed window cut the wavelet off. Worst error now 1e-6 over the whole scale range. |
| `fourierSlice` | Slice theorem | 🟡 C | Decorative; doesn't actually compute slice. |

### 10. Topology & Geometry (16) — 5 A · 4 B · 7 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `mobiusStrip` | Möbius strip | 🔵 B | Simplified parametrization, correct topology. |
| `kleinBottle` | Klein bottle figure-8 | 🔵 B | Approximate immersion. |
| `torusKnot` | Torus knot | 🟡 C | A phase field with a Gaussian ring envelope, not a (p,q) parametrisation: the winding measured on r = 1 gives p = 2 toroidal cycles, but the "poloidal" winding is in radius rather than around the tube, and at the default slider the (p,q) pair names a link rather than a knot. Round 8: tier B asserts a bounded 1e-3…1e-7 approximation to something, and there is no parametrisation here to approximate. |
| `boysSurface` | Boy's surface | 🟡 C | Simplified RP² approximation. |
| `romanSurface` | Steiner Roman | 🟡 C | Approximate implicit solve. |
| `enneperSurface` | Enneper | 🔵 B | u²-v² is the z-coordinate, exact projection. |
| `scherkSurface` | Scherk minimal | 🟢 A | y = (1/a)·log\|cos(a·x)/cos(a·z)\|, a = 2·freq — Scherk's first surface. Round 8: the prefactor was a flat 0.25, and a graph of this form is minimal only when it equals 1/a, so the surface shipped was a vertically compressed Scherk graph with mean curvature reaching 1.05 where minimality requires 0. Sympy now confirms 2H·(1+\|∇y\|²)^{3/2} ≡ 0 for the shipped prefactor, and the plateau share at the fold is 0.1 %. |
| `catenoid` | Catenoid | 🟢 A | a·cosh(z/a) exact. Round 5 clamped it to ±1.5 because the far field reaches 82 units at the default slider; round 6 replaced that with `soften(1.2, 1.9)` after measuring what the clamp cost — 49.6 % of the mesh flat at the default slider, 95.8 % at the maximum. The fold brings that to 27.1 %, and the remainder is intrinsic: cosh(2·z·freq) is so steep that over half the plate is far field at any display bound. The neck and the zero level set are inside the identity region and are bit-identical to before. |
| `helicoid` | Helicoid | 🟢 A | c·θ exact height. The animation rotates the azimuth and folds it back into (−π, π], so the surface spins about its axis; it used to add an unwrapped t·0.3 to θ, which translated the whole mesh out of the framed volume over the length of a set. |
| `hyperbolicParaboloid` | x²/a-z²/b | 🟢 A | Exact saddle. |
| `torusSection` | Torus implicit | 🟢 A | (√(x²+z²)−R)²+y²=r², solved for y; the residual is 5.6e-17 across the tube at amp = 1. Round 8: an extra factor of 0.5 halved the vertical semi-axis, so the section drawn was an ellipse of aspect 2:1 and the equation above held only on the tube's boundary curve. |
| `breatherSurface` | Breather pseudosphere | 🟡 C | **Known open item.** Round 5 found the a² factor missing from the denominator a[(1−a²)cosh²(aT) + a²sin²(√(1−a²)P)], and the scalar built on it is not a coordinate of the breather surface either. Round 6 could not verify a replacement: the test a pseudospherical surface must pass is Gaussian curvature identically −1, and both parametrisations tried came back with K running +0.21…−1.23 (the curvature routine itself was checked on a sphere to 8 digits and on a tractricoid to −1.0000000). Downgraded to C, which is what an unverified decorative scalar deserves, rather than left at B on a claim nobody has checked. What round 6 did fix is the ±0.6 clamp, which was pinning 66.3 % of the mesh flat at the default sliders and 100 % at the top of the range; it is now `soften(0.45, 0.95)`. |
| `pseudosphere` | Tractricoid | 🟡 C | log(tan(T/2)) + cos(T), the tractrix profile, revolved. Round 8 corrected two claims. The profile was log(tan(T/2)) + **sech**(T): sech and cos agree to first order at T = 0 and diverge at once, by 0.571 over the drawn range, so the curve this row called "the tractrix" was not one. And the radial coordinate is the plate radius under a monotone map, not arcsin of it, so what is drawn is that profile revolved and **not** a surface of constant negative curvature — the tier drops to C for the same reason `breatherSurface` did rather than assert a curvature nobody verified. Round 6: the parameter is defined only on (0, π), and clamping the plate radius into that interval gave every vertex past radius π/freq one shared value — a flat ring over 38.4 % of the mesh. A monotone map of [0, ∞) onto (0, π) shows the whole trumpet instead of cutting it off. Both ends of the profile run to infinity, so the fold rather than a clamp keeps it in frame. |
| `crossCap` | Cross-cap | 🟡 C | Just x·z product — not actual cross-cap parametrization. |
| `alexanderHorned` | Alexander horned | 🟡 C | 2–5 iteration schematic — not actual wild embedding. |
| `hopfFibration` | Hopf fibration | 🔵 B | Phase visualization, structurally faithful. |

### 11. Cellular Automata (16) — 13 A · 1 B · 2 C · 0 D

The cleanest collection: integer-valued automata with discrete rules — these are **exact by construction** on the simulation grid. Eleven of the sixteen go through `createCachedHeavySampler` and are bilinearly interpolated onto the adaptive display mesh (up to 160×160 segments, scaled to GPU capability); five are not, and are evaluated directly at every vertex — `rule30`, `rule90`, `rule110`, `rule184` call `cellularRule` per vertex, and `voronoiCA` takes an argmin per vertex.

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `rule30` | Rule 30 (Wolfram) | 🟢 A | Exact 8-bit lookup on 64-cell grid. |
| `rule90` | Rule 90 (XOR) | 🟢 A | Exact. |
| `rule110` | Rule 110 (Turing complete) | 🟢 A | Exact. |
| `rule184` | Rule 184 (Traffic) | 🟢 A | Exact. |
| `gameOfLifeDensity` | Game of Life B3/S23 | 🟢 A | Exact CA on 48×48 internal grid. Round 6 replaced the seed: `(i·2654435761) >>> 0` is a Weyl sequence, equidistributed rather than independent (χ² = 7.9 over 100 buckets where chance gives 99 ± 14), so almost every live cell was isolated and generation 1 killed 97 % of the population — the plate measured a peak of exactly 0 at t = 1.5. The rule was never wrong; it was being fed a lattice instead of a soup. On a murmur3-finalised hash the same rule settles around 5 % alive, as Life does. |
| `briansBrain` | Brian's Brain | 🟢 A | Exact 3-state CA on 48×48 internal grid. |
| `langtonAnt` | Langton's Ant | 🟢 A | Exact deterministic ant on 64×64 internal grid. |
| `cyclicCA` | Cyclic CA | 🟢 A | Exact on 48×48 internal grid. Round 6 replaced the seed for the same reason, and here it was degenerate rather than merely poor: `(i·2246822519) >>> 0 % N` depends only on the column whenever N divides a power of two, so at N = 4 and N = 8 the variance down every column was exactly 0 — vertical stripes instead of spirals. |
| `wiredFire` | Wireworld | 🟢 A | Exact 4-state CA on 50×50 internal grid. |
| `sandpile` | Abelian Sandpile | 🟢 A | Exact toppling rule on 40×40 internal grid. |
| `voronoiCA` | Voronoi tessellation | 🟢 A | Exact nearest-seed, and exact is the right word — the kernel matched an independent implementation to 0 over 33 640 points and to 0 violations of the perpendicular-bisector characterisation. It is not an automaton and nothing grows: there is no lattice, no neighbourhood and no transition rule, only argmin over 5+round(8·comp) moving seeds, recomputed from scratch at every vertex of every frame. The plate shows exactly N flat levels at any t. |
| `excitableMedia` | FitzHugh-Nagumo | 🟡 C | Real FHN PDE on 64×64 internal grid, explicit Euler at dt = 0.1, bilinearly interpolated to the display mesh. Round 6 corrected the error claim rather than the code: the time-stepping error alone is 3.9e-3 in u, whose display range is [0, 1] — about four times the ~10⁻³ this row used to assert, before any spatial error on a front two cells wide. The number stated is now the measured one. Round 8: explicit Euler at dt = 0.1 contributes 3.9e-3 against solve_ivp on a field displayed over [0, 1] — above the 10⁻³ ceiling tier B sets. The number was already stated correctly in this row; only the letter was wrong. |
| `reactionDiffusion` | Gray-Scott | 🟡 C | Real Gray-Scott PDE on 64×64 internal grid, configurable F/k regimes, bilinearly interpolated to the display mesh. Round 6 corrected the error claim rather than the code: explicit Euler at dt = 1.0 contributes 5.5e-2 to 8.5e-2 in the displayed clamp(4v, 0, 1), whose range is exactly [0, 1], and 1.7e-2 in v itself — seventeen to eighty-five times the ~10⁻³ this row used to assert. Reducing dt would cost a proportional number of iterations on a device that already carries this entry as the heaviest in the catalogue, so the number is stated instead of the tier being pretended. Round 8: explicit Euler at dt = 1.0 contributes 2.5e-2 to 8.5e-2 against solve_ivp on a field displayed over [0, 1] — one to two orders past tier B's ceiling. Reducing dt would cost a proportional number of iterations on the heaviest entry in the catalogue, so the letter moves rather than the code. |
| `forestFire` | Forest Fire CA | 🟢 A | Exact tree/fire/ash CA on 50×50 internal grid. |
| `conway3D` | Conway 3D | 🔵 B | Real 3D B5-7/S6 simulation on 18³ grid, 3–5 generations, bilinearly interpolated to the display mesh. Round 6 corrected the description: what is extracted is not a mid-y slice but the MEAN of three neighbouring slices, which is a projection and smooths the rule's own structure. Replaced a 1D Wolfram rule. |
| `turmite` | Turmite | 🟢 A | 2-state 2-colour turmite on a 56×56 internal grid. Round 6 replaced the transition table: both state-0 rows of the old one wrote state 0, so the state-1 rows were unreachable and the machine degenerated into a one-state ant of period 8 — 4 raised cells out of 3136. The new table is the survivor of an exhaustive run over all 65 536 rules of the family, scored on both states being used, the pattern still growing at the end of the run, and fill; it reaches 7.7 % of the plate at 700 steps and 39.3 % at 6000, where the runner-up saturates at 7.0 %. The step count rose to 1500 + comp·3000 to make the complexity slider visible (19 % → 35 %). |

### 12. Quantum Mechanics (16) — 14 A · 1 B · 1 C · 0 D

| Key | Name | Tier | Rationale |
|-----|------|:----:|-----------|
| `particleBox1D` | Particle in box | 🟢 A | (2/L)·sin²(nπx/L) exact. |
| `harmonicOscillator` | QM harmonic \|ψ_n\|² | 🟢 A | Hermite recurrence + Gaussian envelope, exact. |
| `hydrogenS` | H 1s orbital | 🟢 A | 4·exp(-2r) radial part exact (Bohr units). |
| `hydrogen2p` | H 2p orbital | 🔵 B | Radial part exact; angular part approximated as cos(l·θ) instead of full Y₁₀ spherical harmonic. |
| `tunneling` | Quantum tunneling | 🟡 C | Schematic piecewise wavefunction: a pure decaying exponential inside the barrier and T = e^{−2κL} for the transmission. Round 8 measured it against the exact rectangular-barrier solution (four matching conditions solved symbolically in sympy and again numerically in mpmath; control: \|t\|²+\|r\|² = 1 exactly, and the closed form reproduced to 2.2e-19). The exact in-barrier envelope carries a growing e^{+κx} piece this does not, and e^{−2κL} omits the 16E(V₀−E)/V₀² prefactor: the exact T is 0.39× to 3.97× the drawn one across E/V₀, and no choice of E brings the envelope closer than 8.5e-3. The code's own comment says "schematic"; the tier now agrees with it. |
| `wavePacket` | Gaussian wave packet | 🟢 A | exp(−(x−vt)²/4σ²)·cos(kx−ωt), squared, and the arithmetic matches to 8.6e-16. Round 8: v, k and ω are set independently, so no ħ and m make them a solution of the free Schrödinger equation simultaneously — what is drawn is the stated expression, not a propagating solution of that equation, and the row no longer implies otherwise. The clock is folded to a 24-unit period (round 4), so the packet is still at 0.44–0.49 of its boot peak after four hours. |
| `spinorVisualization` | Bloch sphere | 🟢 A | ⟨σx⟩ = sin θ·cos φ, formed from the state in the caption; exact to 1.1e-16 against explicit Pauli algebra. Round 8: this row used to describe the population difference cos²(θ/2) − sin²(θ/2) = cos θ, which round 6 had already replaced — and cos θ is φ-independent, so the two differ by 70.7 % of full scale. |
| `doubleSlitProbability` | Two-slit \|ψ\|² | 🟢 A | Round 6: 2I₀(1 + cos δ) with δ = k(r₁ − r₂), which is the formula the caption states. The 1/r amplitudes it carried are a near-field detail the caption never claimed, and both sources sit inside the plate, so near them r fell to the 1e-3 regulariser and the intensity went as 1/r²: peak 58.6 world units against a ~3-unit frame, and because the spike lives between vertices its height depended on the mesh — 1.9 / 324 / 84 / 3706 across grids 25 / 49 / 90 / 161, a spread of ×1926. Now bounded in [0, 2], identical at every density, fringe visibility 1. |
| `densityMatrix` | ρ diagonal | 🟢 A | Σ pₖ·\|ψₖ\|² with thermal weights. |
| `landauLevels` | Landau levels | 🟢 A | Generalized Laguerre L_n^0 recurrence, exact to 4.7e-16 against mpmath and scipy for every reachable n; replaced a hardcoded n=1 approximation. Round 8: the caption's claim that this is the m = ±n pair was withdrawn — [L_n^0(r²)]²e^{−r²} is the m = 0 radial density, and the cos²(nθ) factor over it is a turning pattern, not an eigenstate (the m = ±n pair vanishes at the origin; this surface is brightest there). |
| `schrodingerSoliton` | NLS soliton | 🟢 A | \|ψ\|² = A²·sech²(A(x−vt)), the soliton density; the NLS residual computed symbolically is zero. Round 8: the kernel, this row and the in-app caption named three different quantities — A²sech², A·sech² and A·sech — of which only the first is what is drawn. |
| `coherentState` | Wigner of coherent | 🟢 A | 2·exp(-2\|α-β\|²) exact. |
| `atomicOrbitals` | sp² hybrid (xz-plane) | 🟢 A | (1/√3)(2s + √2(p_x cos φ + p_z sin φ)) with 2s and 2p radial parts, machine-exact against a symbolic reference. Renamed from a misleading "sp³". Round 8: the "3-lobe geometry at 120°" this row used to credit never reaches the screen — one hybrid is one lobe with its small back lobe, and only one φ is drawn at a time. |
| `bellState` | Bell correlation | 🟢 A | E(a,b) = -cos(a-b) exact. |
| `feynmanPath` | Free propagator | 🟢 A | (m/2πiħt)^½·exp(imx²/2ħt) — real part. Round 6 restored the (1/i)^{1/2} = e^{−iπ/4} that was dropped: the real part is cos(x²/2T − π/4), and forty-five degrees moves every fringe, so this was a change of pattern and not of scale. The clock is folded to a 24-unit period (round 5) so the 1/√T amplitude replays instead of fading. |
| `quantumZeno` | Zeno survival | 🟢 A | cos²ᴺ(ωt/2N) exact. |

---

## GPU displacement ladder (38 branches)

`computeMode()` in `src/shaders.js` is a 38-way if/else on `uMode`, and `main()`
**assigns** `pos.y` from it rather than accumulating, so a branch that returns
zero is a flat plate in a flat colour — `vH` feeds the palette too.

These branches are GLSL and cannot be evaluated in the Node test suite. They
were measured by transliterating each branch into JS (the ladder uses only
`length`, `atan`, `exp`, `sin`, `cos`, `pow`, `abs`, `tanh`, all of which match
JS semantics; the one exception is `mod`, added to mode 16 in round 6 and
transliterated as `x − y·floor(x/y)`, which is what GLSL means by it and is
**not** JS `%` for a negative first argument — that difference is the whole
point of the branch, whose argument goes negative on every wrap) and taking the surface
span over [−3.5, 3.5]² in three uniform states: silence, mid-level music, and
loud. The regression tests that guard the two repairs read the shader source.

**Two branches drew nothing.**

| Mode | Label then | Span | Cause |
|-----:|------------|------|-------|
| 10 | 11. τ(n) Ramanujan Tau | 7.9·10⁻⁶ | every term carried `sin(fn*3.14159)` — that is sin(nπ) = 0 for integer n |
| 30 | 31. Dragon Curve | 1.1·10⁻¹⁶ | summand `sin(5n·x)cos(5n·z)` is odd in n, the unrolled weight `exp(-4.*.3)` was even, so every ±n pair cancelled exactly |

Mode 10 now carries the tau coefficients its label names (1, −24, 252, −1472,
4830, −6048, −16744, scaled by 10⁻³); mode 30 carries the sign of n in its
exponent, which is what the loop it was unrolled from would have produced.
Mode 8 is unrolled the same way and is unaffected — its summand `cos(ang·n)` is
even, so its pairs add. The difference is the parity of the summand.

**Two more had no floor or no ears.**

- Mode 11 multiplied its whole sum by `sin(fn*t*2.)`, where `t` is `uTreble`,
  not time — span 0.0 in silence. Given an offset, like every other branch has.
- Modes 35 and 36, labelled "EQ 3D" and "Vocoder", read neither `uBass` nor
  `uMid` nor `uTreble`: their span was identical to the digit in silence and
  under loud music. The three bands now drive the harmonics they name.

**Nineteen labels named mathematics that was not in the branch.** Δ(τ) is
q∏(1−qⁿ)²⁴ and mode 8 is a theta sum; η(τ) is q^{1/24}∏(1−qⁿ) and mode 14 is
`sin(8r)·cos(4θ)`; j(τ) has a pole at q → 0 and mode 15 is a sum of sines;
E₄ needs the divisor sum σ₃; none of the eight branches under "FRACTALS &
CHAOS" iterates anything. Those labels are now descriptive of what the branch
computes. The three that were accurate keep their names: mode 6 (Ramanujan
theta), mode 9 (θ₃(q)), mode 37 (spectral centroid, which really is
(treble+ε)/(treble+bass+2ε)), and mode 10 now joins them.

Presets store the numeric `uMode`, not the label, so no saved preset moved.

**Second pass — two of the round-5 repairs needed repairing.** Both were found
by re-deriving the fixes independently rather than by reading their rationales.

- Mode 11's floor was written as `sin(fn*(0.35+t*2.))`, with the offset *inside*
  the harmonic index. That phases all seven harmonics together and they add
  constructively: span went 2.046 → 3.290 under loud audio and 3.070 → 4.935
  with the sliders up, against a camera half-frame of about 3.26. The branch was
  in frame everywhere before the repair and was not after it. Written as
  `sin(fn*t*2.+0.6)` the offset shifts every harmonic by the same amount:
  silence 0.680, loud 1.998, sliders up 2.997 — a floor, and a ceiling slightly
  below what the branch had before either repair.
- `gamma`'s overflow fix was applied to the n ≥ 0.5 branch only. The reflection
  branch computes Γ(1−n) with the same `Math.pow` and π/Infinity is 0, so
  `gamma(n)` returned **exactly zero** for every n ≲ −141.5 — Γ(−141.5) is
  1.39·10⁻²⁴⁴ and even Γ(−170.5) ≈ −3.3·10⁻³⁰⁸ still fits a double. Half a fix
  under a comment claiming a whole one. Both branches now fall back to logs.

---

## Previously Fixed Defects (Tier D → resolved)

All three Tier D defects identified in Round 1 have been fixed and verified by automated tests. Listed here for historical reference.

### `tinkerbell` (Fractals) — fixed in Round 1 → Tier B
`isFinite` guard was inside the loop body, missing final-iteration overflow. Post-loop guard added: `if (!isFinite(py)) return 0;`. Now Tier B — stable 12-iteration Tinkerbell map.

### `dragon` (Fractals) — fixed in Round 1 → Tier B
Was using shader-noise hash instead of Heighway IFS. Replaced with deterministic IFS via complex rotation and bit-pattern branch selection. Now Tier B.

### `jacobian` (Linear Algebra) — fixed in Round 1 → Tier A
Operator precedence bug: `amp*0.1` was only scaling the second product term, not the full determinant expression. Parentheses added: `((ux/(2*h))*(vz/(2*h)) - (uz/(2*h))*(vx/(2*h))) * amp * 0.1`. Now Tier A.

---

## Marketing-Defensible Claims

### ✓ Defensible (current state — defects fixed + Tier C upgrades)

> **166 mathematical formulas with verifiable numerical accuracy.**
> 128 closed-form analytic expressions evaluated at IEEE 754 double precision.
> 42 well-validated approximations with documented bounded error (≤ 10⁻³ to 10⁻⁷), including real PDE simulations on adaptive internal grids with bilinear interpolation to the full-resolution display mesh.
> Source-available, open test suite (the validation file, including regression tests for previously identified defects and validation tests against canonical mpmath/NIST DLMF reference values).

### ✓ Defensible (alternative — domain-coverage emphasis)

> **Implements 192 canonical mathematical models across 12 domains** — special functions, statistical distributions, complex analysis, Fourier theory, dynamical systems, integral transforms, topology, quantum mechanics, cellular automata. 86% achieve numerical accuracy verifiable against scipy/Wolfram references; 14% are visualization-grade for systems where exact real-time evaluation is computationally prohibitive at 60 fps.

### ✓ Defensible (slogan)

> **166 formulas. Verifiable accuracy. Open tests.**

### ✗ Not defensible without major rework

> ~~"100% scientific accuracy"~~ — too vague; will be challenged on first audit.
> ~~"All 192 formulas mathematically exact"~~ — false (Tier C is 24 formulas).
> ~~"Real-time numerical solutions"~~ — implies simulation fidelity that 8-step Euler does not provide.

---

## How to Verify

<!-- This is the count for this file alone, same as the "Test
     suite" line above — move both together. `npm test` reports 208. -->
The companion file `tests/math-validation.test.js` is executable and covers:
- All 128 Tier A formulas at canonical reference points (boundary values, known special-function values, identity tests).
- Sanity checks for Tier B formulas (PDF integration, convergence behaviour, polynomial fit boundary error, PDE simulation stability).
- Qualitative checks for Tier C formulas (peak location, sign changes, energy bounds, determinism).
- Regression tests for all three previously fixed Tier D defects.
- Schema integrity: every formula has `name`, `formula`, and `f`. Catalog count, finite output, bounded output across all formulas.

Run with:
```bash
node --test tests/math-validation.test.js
```

All of them currently pass against the live `math-collections.js`.

---

## Methodology Notes

**Reference implementations used for Tier A verification**:
- scipy.special (gamma, bessel, erf, hyp2f1, lambertw, etc.)
- mpmath (high-precision arbitrary-accuracy reference)
- Wolfram Alpha for spot-checks
- NIST DLMF (Digital Library of Mathematical Functions) for canonical values

**Tolerances**:
- Tier A: 10⁻¹² absolute (limited by float64 round-trip noise)
- Tier B: 10⁻³ absolute or stated polynomial bound
- Tier C: qualitative (peak position, sign, monotonicity, asymptotic limit)

**Audio modulation handling**:
For all formulas, validation uses `{amp: 1, freq: 1, comp: 0.5, time: 0}` — the unmodulated baseline. Audio-modulated outputs are correctly viewed as **scaled visualizations** of the underlying baseline, not separate mathematical objects. This is documented in the user-facing UI as "audio-reactive parameters modulate canonical formulas — set defaults for unmodulated reference."

**The `time` argument is a session clock, not a physical time**:
`time` starts at 0 when the page loads and advances 0.008 per animation frame for as long as the tab is open; nothing in the UI rewinds it. Validating at `time: 0` is therefore validating at the only instant a decaying solution is guaranteed to be alive, and eight entries were found rendering a flat plate — or, for `helicoid`, a mesh translated clean out of the framed volume — one or two minutes into a set. Those eight (`heat2D`, `dampedOscillator`, `heatEquation`, `fishersEquation`, `wavePacket`, `schrodingerSoliton`, `complexHeat`, `helicoid`) now fold the clock back into a per-entry period before using it, so the solution replays instead of running out. The mathematics of each is unchanged and `time: 0` still evaluates exactly as this document describes; what changed is which physical time a given session age maps to. `tests/math-validation.test.js` asserts each of them is still drawing after thirty minutes of uptime.

**Grid resolution note**:
Internal simulation grids for heavy formulas (cellular automata, PDEs) use fixed sizes of 40×40 to 64×64. These are bilinearly interpolated onto the adaptive display mesh (60–200 segments depending on GPU capability). Validation tests use the internal grid resolution, not the display resolution. Accuracy figures for Tier B formulas (e.g. "~10⁻³ accuracy") are measured at the internal grid level; interpolation to higher display resolutions does not improve numerical accuracy but produces visually smoother output.

---

*This document is the authoritative source for VIMATHIC's mathematical accuracy claims. Update when formulas are added or modified.*
