/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

// math-collections.js — COMPLETE CATALOG OF MATHEMATICAL FORMULAS FOR VIMATHIC
// Total collections: 12
// Total formulas: 192
// Format: f(x, z, time, { amp, freq, comp }) → float Y

// ── Shared math helpers ───────────────────────────────────────────────────────
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp  = (a, b, t)   => a + (b - a) * t;

/**
 * FIX(#5, #6, r4): fold the session clock back into [0, period) so a solution
 * that evolves with `t` replays instead of running out.
 *
 * The `time` these formulas receive is not a physical time. main.js starts it
 * at 0 and adds 0.008 on every animation frame for as long as the tab is open;
 * STOP MOTION pauses it, nothing rewinds it, and no formula is ever handed a
 * zero of its own. Eight entries read it as the age of a decaying or
 * translating solution and were measured going out over the length of a set —
 * dampedOscillator fell from a 0.39 peak to 2·10⁻⁵ after two minutes of uptime
 * and never came back, wavePacket and schrodingerSoliton translated their
 * packets off the domain to exactly zero, and helicoid ramped its whole mesh
 * to y ≈ 24 after half an hour against a framed volume about 3 units high.
 * Only a page reload recovered any of them.
 *
 * The period is chosen per entry so the interesting part of the evolution is
 * what plays, and so the quietest instant of a cycle stays within an order of
 * magnitude of the entry's own t = 0 peak. The cost is one seam per cycle,
 * paid against a surface that was otherwise a flat plate; t = 0 is left
 * bit-identical, so every baseline assertion in the suite is unmoved.
 */
const replayTime = (t, period) => { const p = t % period; return p < 0 ? p + period : p; };

/**
 * FIX(#6, r4): the angular companion to replayTime — fold an azimuth back into
 * (−π, π], the half-open interval Math.atan2 itself returns, so a rotated
 * azimuth lands exactly where atan2 left it when the rotation is zero.
 *
 * Written as a residue plus one correction rather than the tidier
 * `π − replayTime(π − a, TAU)`: for an `a` one ulp above −π that subtraction
 * rounds to exactly TAU, the residue comes back 0, and the seam flips by the
 * full height of the surface at a single vertex.
 */
const wrapAzimuth = a => {
  const m = a % TAU;
  return m > Math.PI ? m - TAU : (m <= -Math.PI ? m + TAU : m);
};

/**
 * Gamma function via Lanczos approximation (g=7, ~10⁻¹⁵ accuracy).
 * Fully iterative — uses the reflection formula gamma(n) = π / (sin(πn) · gamma(1-n))
 * for n < 0.5 to keep the Lanczos input in its accurate range without recursion.
 */
export function gamma(n) {
  if (n <= 0 && Number.isInteger(n)) return Infinity; // poles at non-positive integers
  if (n < 0.5) {
    // Reflection formula: Γ(n)·Γ(1-n) = π/sin(πn) → Γ(n) = π / (sin(πn)·Γ(1-n))
    // Compute Γ(1-n) via the same Lanczos series. Note: Lanczos expects
    // (input - 1) as its argument, so after `n1 = 1 - n` we must also
    // shift n1 -= 1 before feeding into the series.
    let n1 = 1 - n;
    n1 -= 1;
    const g = 7;
    const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
      771.32342877765313,-176.61502916214059,12.507343278686905,
      -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
    let x1 = c[0];
    for (let i = 1; i < g + 2; i++) x1 += c[i] / (n1 + i);
    const t1 = n1 + g + 0.5;
    const gammaOneMinusN = Math.sqrt(TAU) * Math.pow(t1, n1 + 0.5) * Math.exp(-t1) * x1;
    // FIX(r5, second pass): the log-space fallback below the positive branch was
    // added first and this arm was left with the mine it was supposed to close.
    // Γ(1−n) is computed by the same Math.pow(t1, n1+0.5) that overflows around
    // n1 ≈ 142, and π/Infinity is 0 — so gamma(n) returned EXACTLY ZERO for every
    // n ≲ −141.5, where the true value is comfortably representable: Γ(−141.5) is
    // 1.39·10⁻²⁴⁴ and even Γ(−170.5) ≈ −3.3·10⁻³⁰⁸ still fits a double. Half a
    // fix under a comment that claimed a whole one.
    if (Number.isFinite(gammaOneMinusN)) {
      return Math.PI / (Math.sin(Math.PI * n) * gammaOneMinusN);
    }
    const sinPn = Math.sin(Math.PI * n);
    const logGammaOneMinusN = 0.5 * Math.log(TAU) + (n1 + 0.5) * Math.log(t1) - t1 + Math.log(x1);
    const logOut = Math.log(Math.PI) - Math.log(Math.abs(sinPn)) - logGammaOneMinusN;
    return Math.sign(sinPn) * Math.exp(logOut);
  }
  n -= 1;
  const g = 7;
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
    771.32342877765313,-176.61502916214059,12.507343278686905,
    -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (n + i);
  const t2 = n + g + 0.5;
  const out = Math.sqrt(TAU) * Math.pow(t2, n + 0.5) * Math.exp(-t2) * x;
  // FIX: Math.pow(t2, n+0.5) overflows a double at n ≈ 142.2 even though the
  // product it belongs to does not — the exp(-t2) that brings it back down is
  // applied afterwards. Measured: Γ(142.2) = 5.11·10²⁴³ came back fine and
  // Γ(142.3) came back Infinity, against a true overflow threshold of
  // n ≈ 171.62. Nothing in the catalogue reaches it (gamma_fn clamps its
  // argument to [0.2, 3.8], chiSquare asks for Γ(k/2) with k ∈ {5…8}), but
  // this function is exported and the suite calls it directly, so the mine
  // stays live for the next caller. Redoing the same expression in logs costs
  // one branch that never fires on the hot path and leaves every reachable
  // value bit-identical.
  if (Number.isFinite(out)) return out;
  const logOut = 0.5 * Math.log(TAU) + (n + 0.5) * Math.log(t2) - t2 + Math.log(x);
  return Math.exp(logOut);
}

/** Bessel J0 via polynomial approximation */
function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const p1 = 57568490574.0 + y*(-13362590354.0 + y*(651619640.7 + y*(-11214424.18 + y*(77392.33017 + y*(-184.9052456)))));
    const q1 = 57568490411.0 + y*(1029532985.0 + y*(9494680.718 + y*(59272.64853 + y*(267.8532712 + y*1.0))));
    return p1 / q1;
  }
  const z = 8 / ax, y = z * z, xx = ax - 0.785398164;
  const p1 = 1 + y*(-0.1098628627e-2 + y*(0.2734510407e-4 + y*(-0.2073370639e-5 + y*0.2093887211e-6)));
  const q1 = -0.1562499995e-1 + y*(0.1430488765e-3 + y*(-0.6911147651e-5 + y*(0.7621095161e-6 - y*0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * q1);
}

/** Bessel J1 via Numerical Recipes polynomial approximation. Max error ~1.3e-7. */
function besselJ1(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const p1 = x * (72362614232.0 + y*(-7895059235.0 + y*(242396853.1 + y*(-2972611.439 + y*(15704.48260 + y*(-30.16036606))))));
    const q1 = 144725228442.0 + y*(2300535178.0 + y*(18583304.74 + y*(99447.43394 + y*(376.9991397 + y*1.0))));
    return p1 / q1;
  }
  const z = 8 / ax, y = z * z, xx = ax - 2.356194491;
  const p1 = 1 + y*(0.183105e-2 + y*(-0.3516396496e-4 + y*(0.2457520174e-5 + y*(-0.240337019e-6))));
  const q1 = 0.04687499995 + y*(-0.2002690873e-3 + y*(0.8449199096e-5 + y*(-0.88228987e-6 + y*0.105787412e-6)));
  const result = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * q1);
  return x < 0 ? -result : result;
}

/**
 * Legendre P_n(x). Closed forms for n ≤ 6, Bonnet's recurrence above that.
 *
 * FIX: the `default:` arm used to hand back P₆ for every n outside {0…5} —
 * 7, 12, −1, 2.5, NaN all drew P₆ with no error anywhere. The only caller in
 * the catalogue (legendre2) asks for n = round(1+comp·4) with comp ∈ [0.5, 0.9],
 * so n ∈ {3,4,5} and the arm was unreachable; that is exactly what let it sit
 * there. Bonnet's recurrence (n+1)P_{n+1} = (2n+1)xP_n − nP_{n−1} answers any
 * non-negative integer, and the closed forms are kept ahead of it so the
 * reachable degrees stay bit-identical rather than picking up recurrence
 * round-off. Non-integer and negative n return NaN, which the caller's own
 * isFinite guard turns into a flat vertex instead of a wrong surface.
 */
function legendreP(n, x) {
  switch(n) {
    case 0: return 1;
    case 1: return x;
    case 2: return 0.5*(3*x*x - 1);
    case 3: return 0.5*(5*x*x*x - 3*x);
    case 4: return 0.125*(35*x*x*x*x - 30*x*x + 3);
    case 5: return 0.125*(63*Math.pow(x,5) - 70*x*x*x + 15*x);
    case 6: return 0.0625*(231*Math.pow(x,6) - 315*Math.pow(x,4) + 105*x*x - 5);
  }
  if (!Number.isInteger(n) || n < 0) return NaN;
  let p0 = 0.0625*(231*Math.pow(x,6) - 315*Math.pow(x,4) + 105*x*x - 5);   // P₆
  let p1 = 0.0625*(429*Math.pow(x,7) - 693*Math.pow(x,5) + 315*x*x*x - 35*x); // P₇
  if (n === 7) return p1;
  for (let k = 7; k < n; k++) {
    const p2 = ((2*k + 1)*x*p1 - k*p0) / (k + 1);
    p0 = p1; p1 = p2;
  }
  return p1;
}

/** Generalized Laguerre L_n^α(x) via recurrence. n must be >=0 integer. */
function laguerreL(n, alpha, x) {
  if (n === 0) return 1;
  if (n === 1) return 1 + alpha - x;
  let lp = 1, lc = 1 + alpha - x;
  for (let k = 1; k < n; k++) {
    const lnext = ((2*k + 1 + alpha - x) * lc - (k + alpha) * lp) / (k + 1);
    lp = lc;
    lc = lnext;
  }
  return lc;
}

/**
 * Dawson's integral F(x) = e^{−x²}∫₀ˣ e^{t²}dt, by Rybicki's method.
 *
 * Rybicki (1989), "Dawson's integral and the sampling theorem": the integral is
 * the convolution of a Gaussian with 1/x, and the sampling theorem turns that
 * into F(x) = 1/√π · Σ_{n odd} e^{−(x−nh)²}/n on a lattice of step h. Recentring
 * the lattice on the nearest even multiple of h keeps the sample off the nodes,
 * so one expression covers the whole real line.
 *
 * FIX: what stood here was Taylor below |x| = 3.5 and a five-term asymptotic
 * series above it, with a code comment claiming "both ~10⁻¹⁰". Measured against
 * Gauss–Legendre quadrature of the defining integral: 1.9·10⁻¹² at x = 3.4 and
 * 3.2·10⁻⁵ at x = 3.5 — a seven-order step at the seam, inside the domain the
 * entry actually reaches (xv = x·freq·1.5 gets to 5.25 at the default wave
 * intensity). No term count fixes it: the asymptotic series for F is divergent
 * and its smallest term at x = 3.5 is already ~10⁻⁶, so the error there has a
 * floor no truncation can go under.
 *
 * h = 0.25 puts the sampling error at e^{−(π/2h)²} ≈ 7·10⁻¹⁸; fifteen terms
 * take the lattice sum out to e^{−(29h)²} ≈ 10⁻²³. Below |x| = 0.2 the lattice
 * sum loses relative precision to cancellation, so the Maclaurin series
 * F = x − 2x³/3 + 4x⁵/15 − 8x⁷/105 answers instead — exact to 10⁻¹⁶ there.
 */
const DAWSON_H = 0.25;
const DAWSON_C = Array.from({ length: 15 }, (_, i) => Math.exp(-(((2*i + 1) * DAWSON_H) ** 2)));
function dawsonF(x) {
  const ax = Math.abs(x);
  if (ax < 0.2) {
    // Maclaurin F(x) = Σ (−1)ⁿ2ⁿx^{2n+1}/(2n+1)!!, term ratio −2x²/(2n+1).
    // Summed to exhaustion rather than truncated at four terms: at x = 0.2 the
    // fifth term is 16x⁹/945 ≈ 8.7·10⁻⁹, and a four-term Horner left exactly
    // that as a step at the seam (measured 8.6·10⁻⁹ across x = 0.2), which is
    // the same kind of discontinuity this rewrite exists to remove.
    const x2 = x * x;
    let term = x, sum = x;
    for (let n = 1; n < 20; n++) {
      term = -term * 2 * x2 / (2*n + 1);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-18) break;
    }
    return sum;
  }
  const n0 = 2 * Math.round(0.5 * ax / DAWSON_H);
  const xp = ax - n0 * DAWSON_H;
  let e1 = Math.exp(2 * xp * DAWSON_H);
  const e2 = e1 * e1;
  // n0 is even, so d1 and d2 are odd and never land on the pole at zero.
  let d1 = n0 + 1, d2 = d1 - 2, sum = 0;
  for (let i = 0; i < DAWSON_C.length; i++) {
    sum += DAWSON_C[i] * (e1 / d1 + 1 / (d2 * e1));
    d1 += 2; d2 -= 2; e1 *= e2;
  }
  return Math.sign(x) * Math.exp(-xp * xp) * sum / Math.sqrt(Math.PI);
}

/**
 * Clausen function Cl₂(θ) = −∫₀^θ ln|2 sin(t/2)| dt.
 *
 * FIX: the entry summed twelve terms of the Fourier series Σ sin(kθ)/k². That
 * series converges like 1/N — fine in the middle of the period, useless at the
 * ends, where Cl₂ has infinite slope. The entry is documented tier B (error
 * ≤ 10⁻³…10⁻⁷) and did not hold it near θ = 0 or 2π.
 *
 * Replaced by the log-sine expansion, which is what the Fourier series is hiding.
 * From ln(sin u / u) = −Σ ζ(2n)u^{2n}/(n π^{2n}) with u = t/2:
 *   ln(2 sin(t/2)) = ln t − Σ_{n≥1} ζ(2n) t^{2n} / (n (2π)^{2n})
 * and integrating term by term from 0 to θ,
 *   Cl₂(θ) = θ − θ ln θ + θ · Σ_{n≥1} ζ(2n)/(n(2n+1)) · (θ/2π)^{2n}.
 * All terms positive, ratio (θ/2π)², so on θ ∈ [0, π] — where the reflections
 * below put every argument — twenty terms reach machine precision.
 *
 * Reductions used: Cl₂ has period 2π, and Cl₂(2π − θ) = −Cl₂(θ).
 */
const CLAUSEN_Z = (() => {
  // ζ(2n)/(n(2n+1)) for n = 1…20. ζ(2n) → 1 fast, so the tail is summed
  // directly; the first five are the closed forms, kept exact.
  const zeta2n = [Math.PI**2/6, Math.PI**4/90, Math.PI**6/945, Math.PI**8/9450, Math.PI**10/93555];
  const out = [];
  for (let n = 1; n <= 20; n++) {
    let z = zeta2n[n - 1];
    if (z === undefined) { z = 0; for (let k = 1; k <= 12; k++) z += Math.pow(k, -2*n); }
    out.push(z / (n * (2*n + 1)));
  }
  return out;
})();
function clausenCl2(theta) {
  let th = theta % TAU;
  if (th < 0) th += TAU;
  if (th === 0 || th === Math.PI) return 0;
  if (th > Math.PI) return -clausenCl2(TAU - th);
  const q = (th / TAU) ** 2;
  let p = q, s = 0;
  for (let i = 0; i < CLAUSEN_Z.length; i++) { s += CLAUSEN_Z[i] * p; p *= q; }
  return th - th * Math.log(th) + th * s;
}

/**
 * Airy function Ai(x) — Maclaurin series on |x| ≤ 8, asymptotics beyond.
 *
 * FIX: the entry marched y″ = x·y outward from the exact (Ai(0), Ai′(0)) seed
 * with RK4 at dx = 0.15. Round 4 had already fixed that march once — it used to
 * impose the x = 0 seed at x = −3 and integrate a different solution entirely —
 * but no forward march of this equation can survive: the growing Bi solution is
 * amplified by every step, and whatever round-off seeds it takes over.
 * Measured on the shipped code, Ai came back NEGATIVE from ξ ≈ 4.88 onward,
 * while the true Ai(x) is positive for every x > 0. ξ = x·freq·1.5 reaches 5.25
 * at the default wave intensity, so the wrong sign was on screen out of the box.
 * The code comment claimed the march held to |x| ≈ 6.
 *
 * ACCURACY, corrected on the second pass. The first version of this note claimed
 * ~10⁻¹⁴ and the entry was rated tier A on it. That was optimistic: the series is
 * alternating, so it loses digits to cancellation exactly where |Ai| is smallest.
 * At x = 8 the largest partial sum is 1.34·10⁶ against |Ai| = 4.7·10⁻⁸ — about
 * 2.5 significant digits survive out of sixteen. Measured against a Decimal
 * reference at 130+ digits, a contour integral and the Bessel identity
 * Ai(−y) = √(y/3)·(J_{1/3}+J_{−1/3}), all three agreeing: absolute error is
 * ≤10⁻¹³ over |x| ≤ 5.25 (the window the default wave intensity reaches) and
 * ≤10⁻⁸ over the whole reachable |x| ≤ 24, with the worst point at the x = −8
 * seam. That is tier B, and the document now says so. On the mesh it is
 * invisible either way — 10⁻⁸ against a frame about 3 units high — but the
 * number in the document has to be the number that was measured.
 *
 * Series instead of marching: y″ = xy has c_{n+3} = c_n/((n+2)(n+3)), so
 *   Ai(x) = Ai(0)·f(x) − Ai′(0)·g(x),
 *   f = 1 + x³/6 + x⁶/180 + …,  g = x + x⁴/12 + x⁷/504 + …
 * with Ai(0) = 3^{−2/3}/Γ(2/3) and −Ai′(0) = 3^{−1/3}/Γ(1/3). Past |x| = 8 the
 * alternating terms cost more digits than the answer has, so the standard
 * asymptotic expansions take over — the decaying one on the right, the
 * oscillatory one on the left, both to three terms in 1/ζ with ζ = ⅔|x|^{3/2}.
 *
 * This is also cheaper than what it replaces: O(1) per vertex against a loop
 * that ran |ξ|/0.15 RK4 steps, i.e. up to 160 of them at the top of the slider.
 */
function airyAi(x) {
  const ax = Math.abs(x);
  if (ax <= 8) {
    const x3 = x * x * x;
    let f = 1, ft = 1, g = x, gt = x;
    for (let k = 0; k < 60; k++) {
      ft *= x3 / ((3*k + 2) * (3*k + 3)); f += ft;
      gt *= x3 / ((3*k + 3) * (3*k + 4)); g += gt;
      if (Math.abs(ft) + Math.abs(gt) < 1e-19) break;
    }
    return 0.3550280538878172 * f - 0.2588194037928068 * g;
  }
  const zeta = (2/3) * Math.pow(ax, 1.5), z4 = Math.pow(ax, 0.25);
  // DLMF 9.7: u₀…u₅ of the Airy asymptotic expansion.
  const u1 = 5/72, u2 = 385/10368, u3 = 85085/2239488,
        u4 = 37182145/1289945088, u5 = 5391411025/75246796800;
  const z2 = zeta*zeta, z3 = z2*zeta, z5 = z3*z2;
  if (x > 0) {
    const s = 1 - u1/zeta + u2/z2 - u3/z3 + u4/(z2*z2) - u5/z5;
    return Math.exp(-zeta) / (2 * Math.sqrt(Math.PI) * z4) * s;
  }
  const th = zeta + Math.PI/4;
  const p = 1 - u2/z2 + u4/(z2*z2), q = u1/zeta - u3/z3 + u5/z5;
  return (Math.sin(th) * p - Math.cos(th) * q) / (Math.sqrt(Math.PI) * z4);
}

/** Normal distribution PDF */
const normalPDF = (x, mu, sigma) =>
  Math.exp(-0.5*((x-mu)/sigma)**2) / (sigma * Math.sqrt(TAU));

/** Lorenz attractor step (simple Euler) */
function lorenzY(x, z, t, sigma=10, rho=28, beta=2.667) {
  const steps = 8, dt = 0.004;
  let cx = x*2, cy = rho*0.1, cz = z*2;
  for (let i = 0; i < steps; i++) {
    const dx = sigma*(cy - cx), dy = cx*(rho - cz) - cy, dz = cx*cy - beta*cz;
    cx += dx*dt; cy += dy*dt; cz += dz*dt;
  }
  return cy * 0.018;
}

/** Rule-n 1D cellular automaton row → value at position x */
function cellularRule(rule, x, z, time) {
  const width = 64;
  const gen = Math.floor((z + 3.5) / 7 * 32) + 1;
  let row = new Uint8Array(width);
  row[Math.floor(width/2)] = 1;
  for (let g = 0; g < gen; g++) {
    const next = new Uint8Array(width);
    for (let i = 0; i < width; i++) {
      const l = row[(i-1+width)%width], c = row[i], r = row[(i+1)%width];
      const idx = (l<<2)|(c<<1)|r;
      next[i] = (rule >> idx) & 1;
    }
    row = next;
  }
  const ix = Math.floor((x + 3.5) / 7 * width);
  return row[clamp(ix, 0, width-1)] ? 0.4 : -0.1;
}

// ── Hydrogen wavefunctions |ψ|² for (n,l,m) ─────────────────────────────────
function hydrogenPsi(n, l, x, z, t) {
  const r = Math.sqrt(x*x + z*z) + 0.01;
  const theta = Math.atan2(z, x);
  const a0 = 1.0;
  // Radial factor via associated Laguerre (simplified for low n)
  let R;
  if      (n===1 && l===0) R = 2*Math.exp(-r/a0);
  else if (n===2 && l===0) R = (2-r/a0)*Math.exp(-r/(2*a0))/Math.sqrt(8);
  else if (n===2 && l===1) R = (r/a0)*Math.exp(-r/(2*a0))/Math.sqrt(24);
  // FIX: R₃₀ was missing its normalisation. The true radial function is
  // 2/(81√3)·(27−18r+2r²)e^{−r/3}; the code had 1/81, low by a factor 2/√3, so
  // |ψ|² came out low by 4/3. Unreachable from the catalogue today — hydrogenS
  // asks for (1,0) and hydrogen2p for (2,1) — and a constant factor would have
  // drowned in `amp` anyway, but the three siblings beside it are all correctly
  // normalised (2e^{−r}, (2−r)e^{−r/2}/√8, r·e^{−r/2}/√24) and this one was the
  // odd one out.
  else if (n===3 && l===0) R = 2*(27-18*(r/a0)+2*(r/a0)**2)*Math.exp(-r/(3*a0))/(81*Math.sqrt(3));
  else                     R = Math.exp(-r/(n*a0));
  // FIX: `Math.cos(l*theta + t*0.3)` degenerates to cos(0.3·t) when l = 0, and
  // the square of that is a factor the whole surface is multiplied by. An s
  // state has no angular dependence and, being a stationary state, no time
  // dependence either — hydrogenS is documented as |ψ₁₀₀|² = 1/π·e^{−2r} and
  // rated tier A on exactly that. Measured before this fix: peak |y| fell from
  // 3.623 at t = 0 to 4.9·10⁻¹¹ at t = 5.236 and back, i.e. the 1s orbital
  // blinked out completely every π/0.3 = 10.47 formula units — 21.8 s of wall
  // clock at 60 fps — and did it for the whole life of the tab. Same failure
  // family as the seven entries replayTime was added for in round 4, only
  // periodic instead of monotone, which is why the drift test's hand-written
  // list did not have it. l ≥ 1 keeps the rotating angular factor: there the
  // cos never vanishes over a full azimuth, so nothing collapses.
  const Y = l === 0 ? 1 : Math.cos(l*theta + t*0.3);
  return R*R * Y * Y * 0.6;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE OPTIMIZATION: Cached grid sampler for heavy CPU formulas
// (Game of Life, Langton's Ant, Sandpile, etc.)
// Precomputes small 2D grid (e.g. 48x48 or 64x64) once per frame/tick,
// then uses fast bilinear interpolation for all vertices.
// This eliminates O(vertices × simulation_steps) bottleneck.
// ═══════════════════════════════════════════════════════════════════════════════

/** Bilinear interpolation on a res×res Float32Array (row-major). u,v in [0,1]. */
function sampleGrid(grid, res, u, v) {
  if (res < 2) return grid[0] ?? 0;
  u = clamp(u * (res - 1), 0, res - 1);
  v = clamp(v * (res - 1), 0, res - 1);
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const x1 = Math.min(x0 + 1, res - 1);
  const y1 = Math.min(y0 + 1, res - 1);
  const fx = u - x0, fy = v - y0;
  const i00 = y0 * res + x0;
  const i10 = y0 * res + x1;
  const i01 = y1 * res + x0;
  const i11 = y1 * res + x1;
  const v00 = grid[i00] ?? 0;
  const v10 = grid[i10] ?? 0;
  const v01 = grid[i01] ?? 0;
  const v11 = grid[i11] ?? 0;
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

// FIX(#12): tolerance on the cached audio params before the grid is
// recomputed. The params are pure audio: amp ≈ [0, 2] and
// comp = 0.5 + mid·0.4 ∈ [0.5, 0.9]. 0.05 is below the noise floor of a
// sustained tone (analyser jitter between frames is a few thousandths) yet
// well under a visible step: for the simulators here amp is a linear output
// scale — 0.05 is a 5% height change — and comp only nudges an iteration
// count or a regime constant (e.g. ±3 of 60-120 Gray-Scott iterations).
// So a quiet or steady passage keeps the cache, while music that actually
// moves the params invalidates it, which is the whole point of the fix.
const HEAVY_PARAM_EPS = 0.05;

// Staleness threshold on the formula clock, unchanged from the original
// cache: `time` advances 0.008 per rendered frame, so on its own this trigger
// fires roughly every 3rd frame — the ~20Hz baseline the heavy formulas have
// always animated at. Left ungated below, so that baseline is preserved
// exactly whatever the ceiling does to the params trigger.
const HEAVY_TIME_EPS = 0.016;

// FIX(#12, r2): ceiling on how often the params trigger may rebuild the
// simulation, counted in ticks. Adding params to the cache key was right —
// the heavy formulas really were tracking the music at only ~20Hz — but it
// left the rebuild rate unbounded: amp = audio.amp·(1+bass·0.5) clears
// HEAVY_PARAM_EPS on ~83% of frames of real music, so the simulation rebuilt
// on essentially every frame, ~3× the old load. Affordable in the surface
// worker, not on the main thread, where MathVisualizer._tickCollapse
// evaluates these same formulas synchronously inside a 16.7ms budget (on the
// reference host one rebuild costs 4.2ms for Conway 3D, 2.0ms for
// Reaction-Diffusion, 2.2ms for Excitable Media).
//
// 2 ticks caps the rebuild rate at ~30Hz — half the worst case #12
// introduced, still well above the ~20Hz it was fixing, and the same rate the
// mobile render path runs at. Every rebuild resets the counter, including a
// time-triggered one, so 30Hz is the ceiling on rebuilds from all triggers
// combined and not just on the params one.
//
// Counted in TICKS rather than in `t`: `t` is not a usable clock here. The
// callers pass t = time + beatInt·0.3, and beatInt decays 0.04 per frame
// (audio.js), so for the ~25 frames after every beat t moves by
// 0.008 − 0.012 = −0.004 per frame — backwards, and four times slower than
// the frame rate. A ceiling expressed in t collapses onto HEAVY_TIME_EPS in
// exactly that regime and silently throws #12's responsiveness away
// (measured: identical rebuild counts, 16.3Hz, params trigger dead).
const HEAVY_MIN_RECOMPUTE_TICKS = 2;

/**
 * Wrapper for heavy formulas. simulator(t, params, res) returns Float32Array(res*res)
 * of pre-scaled Y values (including *amp). The wrapper caches the grid for the
 * current t AND the current audio params (FIX(#12) — it used to key on t
 * alone) and samples it with bilinear interp. Runs simulator ONLY once per
 * tick. Preserves exact original visual behavior (including Dimensional
 * Collapse).
 */
function createCachedHeavySampler(simulator, defaultRes = 64) {
  let cachedGrid = null;
  let lastT = -Infinity;
  // FIX(#12): the params the cached grid was actually computed with. NaN
  // seeds force the first call through, same as `!cachedGrid` does for t.
  //
  // amp and comp only: every simulator wrapped here destructures exactly
  // {amp, comp} — none reads freq, so invalidating on freq would rebuild the
  // simulation for a grid that comes out bit-identical. If a future heavy
  // simulator does take freq, add it to both the seed and the test below,
  // otherwise it will silently render stale.
  let lastAmp = NaN, lastComp = NaN;
  // FIX(#12, r2): tick clock for the rebuild ceiling. Every vertex of a tick
  // is evaluated with the same t, so a change in t is exactly one new tick —
  // which makes this a frame counter, the thing t itself is not (see
  // HEAVY_MIN_RECOMPUTE_TICKS).
  let lastSeenT = NaN, ticksSinceRebuild = 0;
  return function(x, z, t, params = {}) {
    // Defaults mirror the simulators' own destructuring defaults, so the
    // comparison sees exactly the values the simulator would use.
    const { amp = 1, comp = 1 } = params;
    // FIX(#12): the cache key used to be time alone, so with time advancing
    // 0.008/frame against a 0.016 threshold roughly two frames in three
    // resampled a grid computed from stale audio params. Params now take part
    // in invalidation, guarded by HEAVY_PARAM_EPS so micro-jitter does not
    // rebuild the simulation.
    //
    // FIX(#12, r2): the original wording here claimed the eleven heavy
    // formulas had "stopped reacting to the music". They had not — they
    // reacted on every rebuild, which is ~16-20Hz (measured: 163 rebuilds
    // over 600 frames of simulated playback). Undersampled, not deaf. The
    // distinction is the whole reason this fix is a ceiling and not a
    // rewrite.
    //
    // Cost stays bounded: every vertex of a tick is evaluated with the same
    // t and the same params object, so the worst case is still ONE simulation
    // per tick (never the O(vertices × steps) blow-up this wrapper exists to
    // prevent).
    if (t !== lastSeenT) { lastSeenT = t; ticksSinceRebuild++; }

    // FIX(#12, r2): "one per tick" was not a tight enough bound — see
    // HEAVY_MIN_RECOMPUTE_TICKS. The time trigger keeps its original,
    // ungated behaviour; only the params trigger #12 added is rate-limited.
    //
    // The exemption: a caller asking for an instant we have already rebuilt
    // at, but with different params, is asking for a grid that has never
    // existed — handing back the cached one is exactly the staleness #12
    // fixed, and there is no rate to limit because no frame has elapsed. A
    // render loop advances t on every tick, so this is unreachable from the
    // hot path; it costs it nothing. (Volume mode can freeze its clock while
    // params keep moving, but VOLUME_FORMULAS contains no cached sampler —
    // these eleven are reached only through Surface and Collapse.)
    const paramsMoved = Math.abs(amp  - lastAmp)  > HEAVY_PARAM_EPS
                     || Math.abs(comp - lastComp) > HEAVY_PARAM_EPS;
    const stale = !cachedGrid
      || Math.abs(t - lastT) > HEAVY_TIME_EPS
      || (paramsMoved && (ticksSinceRebuild >= HEAVY_MIN_RECOMPUTE_TICKS || t === lastT));
    if (stale) {
      cachedGrid = simulator(t, params, defaultRes);
      lastT = t;
      lastAmp = amp; lastComp = comp;
      ticksSinceRebuild = 0;
    }
    const u = (x + 3.5) / 7.0;
    const v = (z + 3.5) / 7.0;
    return sampleGrid(cachedGrid, defaultRes, u, v);
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 1 — FRACTALS & CHAOS
// ═══════════════════════════════════════════════════════════════════════════════
const FRACTALS_AND_CHAOS = {
  name: 'FRACTALS & CHAOS',
  icon: '🌀',
  formulas: {
    mandelbrot: {
      name: 'Mandelbrot Escape',
      formula: 'z_{n+1} = z_n² + c',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let zx = 0, zy = 0;
        const cx = x*freq*0.6, cy = z*freq*0.6;
        let it = 0, maxIt = 6 + Math.floor(comp*10);
        while (zx*zx+zy*zy < 4 && it < maxIt) {
          const nx = zx*zx - zy*zy + cx; zy = 2*zx*zy + cy; zx = nx; it++;
        }
        return (1 - it/maxIt) * amp * 0.7;
      }
    },
    julia: {
      name: 'Julia Set (animated)',
      formula: 'z_{n+1} = z_n² + c(t)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const cr = -0.7269 + Math.sin(t*0.4)*0.2, ci = 0.1889 + Math.cos(t*0.3)*0.15;
        let zx = x*freq*0.7, zy = z*freq*0.7;
        let it = 0, maxIt = 6 + Math.floor(comp*10);
        while (zx*zx+zy*zy < 4 && it < maxIt) {
          const nx = zx*zx - zy*zy + cr; zy = 2*zx*zy + ci; zx = nx; it++;
        }
        return (1 - it/maxIt) * amp * 0.8;
      }
    },
    burningShip: {
      name: 'Burning Ship',
      formula: 'z_{n+1} = (|Re|+i|Im|)² + c',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let zx = 0, zy = 0;
        const cx = x*freq*0.5 - 1.7, cy = z*freq*0.5;
        let it = 0, maxIt = 6 + Math.floor(comp*10);
        while (zx*zx+zy*zy < 4 && it < maxIt) {
          const nx = zx*zx - zy*zy + cx; zy = 2*Math.abs(zx)*Math.abs(zy) + cy; zx = Math.abs(nx); it++;
        }
        return (1 - it/maxIt) * amp * 0.7;
      }
    },
    lorenz: {
      name: 'Lorenz Attractor Slice',
      formula: 'ẋ=σ(y−x), ẏ=x(ρ−z)−y, ż=xy−βz',
      f(x, z, t, {amp=1, freq=1, comp=1}) { return lorenzY(x*freq, z*freq, t) * amp; }
    },
    rossler: {
      name: 'Rössler Attractor',
      formula: 'ẋ=−y−z, ẏ=x+ay, ż=b+z(x−c)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=0.2, b=0.2, c=5.7+comp, steps=12, dt=0.003;
        let cx=x*freq, cy=0.1, cz=z*freq+comp;
        for (let i=0; i<steps; i++) {
          const dx=-(cy+cz), dy=cx+a*cy, dz=b+cz*(cx-c);
          cx+=dx*dt; cy+=dy*dt; cz+=dz*dt;
        }
        return cy * 0.12 * amp;
      }
    },
    newtonFractal: {
      name: 'Newton Fractal z³−1',
      formula: 'z ← z − f(z)/f\'(z)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let zx=x*freq, zy=z*freq;
        const maxIt = 4 + Math.floor(comp*8);
        for (let i=0; i<maxIt; i++) {
          const r2=zx*zx+zy*zy, r4=r2*r2;
          if (r4 < 1e-12) break;
          const nx = (2*zx/3) + (zx*zx-zy*zy)/(3*r4);
          const ny = (2*zy/3) - (2*zx*zy)/(3*r4);
          zx=nx; zy=ny;
        }
        return (Math.atan2(zy, zx) / Math.PI) * amp * 0.5;
      }
    },
    sierpinski: {
      name: 'Sierpiński IFS Height',
      formula: 'IFS: 3 affine contractions',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let px=(x+3.5)/7, pz=(z+3.5)/7, v=1;
        const depth = 2 + Math.floor(comp*4);
        for (let i=0; i<depth; i++) {
          const sx=Math.floor(px*2), sz=Math.floor(pz*2);
          if (sx===1 && sz===1) { v=0; break; }
          px=px*2-sx; pz=pz*2-sz;
        }
        return v * amp * 0.4 * (0.6 + Math.sin(t*0.5)*0.4);
      }
    },
    lyapunov: {
      name: 'Lyapunov Exponent Map',
      formula: 'λ = lim 1/n Σ ln|f\'(xₙ)|',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=(x+3.5)/7*3+2.6, b=(z+3.5)/7*3+2.6;
        let xn=0.5, lam=0, n=0;
        const seq = [a,b,a,b], len=4, steps=20+Math.floor(comp*20);
        for (let i=0; i<steps; i++) {
          const r=seq[i%len]; xn=r*xn*(1-xn);
          lam += Math.log(Math.abs(r*(1-2*xn)));
          if (isFinite(lam)) n++;
        }
        return clamp((n>0?lam/n:0) * 0.25 * amp, -0.8, 0.8);
      }
    },
    dragon: {
      name: 'Dragon Curve Density',
      formula: 'Heighway dragon IFS: f₁(z)=(1+i)z/2, f₂(z)=1−(1−i)z/2',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let px=x*freq, pz=z*freq, v=0;
        const depth = 8 + Math.floor(comp*6);
        const r = 1/Math.sqrt(2), angle = Math.PI/4;
        const cosA=Math.cos(angle)*r, sinA=Math.sin(angle)*r;
        // Deterministic LCG seeded by integer-quantized position — true
        // chaos-game IFS sampling. A hash-based shader-noise variant
        // (sin·43758) was rejected because it produces spatially correlated
        // artifacts that don't represent the Heighway dragon's distribution.
        let seed = ((Math.floor(px*1000)*73856093) ^ (Math.floor(pz*1000)*19349663)) >>> 0;
        for (let i=0; i<depth; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          if ((seed & 0x80000000) === 0) {
            const nx=cosA*px-sinA*pz, nz=sinA*px+cosA*pz;
            px=nx; pz=nz;
          } else {
            const nx=-cosA*px+sinA*pz+1, nz=-sinA*px-cosA*pz;
            px=nx; pz=nz;
          }
          v += Math.exp(-4*(px*px+pz*pz)) * 0.15;
        }
        return clamp(v * amp, 0, 0.9);
      }
    },
    chua: {
      name: 'Chua Circuit Attractor',
      formula: 'ẋ=α(y−x−f(x)), ẏ=x−y+z, ż=−βy',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const alpha=15.6, beta=28, steps=10, dt=0.003;
        let cx=x*freq*0.5, cy=0.01, cz=z*freq*0.5;
        for (let i=0; i<steps; i++) {
          const m0=-1.143, m1=-0.714, br=1;
          const fx = m1*cx + 0.5*(m0-m1)*(Math.abs(cx+br)-Math.abs(cx-br));
          const dx=alpha*(cy-cx-fx), dy=cx-cy+cz, dz=-beta*cy;
          cx+=dx*dt; cy+=dy*dt; cz+=dz*dt;
        }
        return cy * 0.15 * amp;
      }
    },
    cantorDust: {
      name: 'Cantor Dust',
      formula: 'Remove middle third recursively',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let px=(x+3.5)/7, pz=(z+3.5)/7;
        let v=1;
        const depth=2+Math.floor(comp*4);
        for (let i=0; i<depth; i++) {
          const fx=px*3, fz=pz*3, ix=Math.floor(fx), iz=Math.floor(fz);
          if (ix===1 || iz===1) { v=0; break; }
          px=fx-ix; pz=fz-iz;
        }
        return v * amp * 0.35 * (0.7 + Math.sin(t*0.4)*0.3);
      }
    },
    ikeda: {
      name: 'Ikeda Map',
      formula: 'z_{n+1} = a + b·z_n·e^{i(k−p/(1+|z_n|²))}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let zx=x*freq*0.5, zy=z*freq*0.5;
        const a=0.85+comp*0.05, b=0.9, k=0.4, p=6;
        const steps=8;
        for (let i=0; i<steps; i++) {
          const r2=zx*zx+zy*zy, th=k-p/(1+r2);
          const nx=a+b*(zx*Math.cos(th)-zy*Math.sin(th));
          zy=b*(zx*Math.sin(th)+zy*Math.cos(th)); zx=nx;
        }
        return zy * 0.3 * amp;
      }
    },
    logistic: {
      name: 'Logistic Map Bifurcation',
      formula: 'x_{n+1} = r·x_n·(1−x_n)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const r=2.5+(x+3.5)/7*1.5, steps=40+Math.floor(comp*40);
        let xn=0.5;
        for (let i=0; i<steps; i++) xn=r*xn*(1-xn);
        const target=(z+3.5)/7;
        return Math.exp(-50*(xn-target)**2) * amp * 0.5;
      }
    },
    duffing: {
      name: 'Duffing Oscillator',
      formula: 'ẍ−x+x³=γcos(ωt)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const gamma=0.3+comp*0.15, omega=1.2, delta=0.15;
        const dt=0.01, steps=15;
        let px=x*0.5, pv=z*0.3;
        for (let i=0; i<steps; i++) {
          const F=-delta*pv+px-px*px*px+gamma*Math.cos(omega*(t+i*dt));
          pv+=F*dt; px+=pv*dt;
        }
        return px * 0.3 * amp;
      }
    },
    henon: {
      name: 'Hénon Map',
      formula: 'x_{n+1}=1−ax_n²+y_n, y_{n+1}=bx_n',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=1.4, b=0.3+(comp-0.5)*0.2;
        let px=x*freq, py=z*freq;
        for (let i=0; i<20; i++) {
          const nx=1-a*px*px+py; py=b*px; px=nx;
          if (!isFinite(px)||!isFinite(py)) return 0;
          // Escape before the doubles overflow, not after. The canonical
          // attractor lives inside |x|<=1.3, so anything past 10 is a diverging
          // orbit: at 20 iterations it reaches ~1e38, and testing isFinite on
          // the double lets those through — the Float32 height field then
          // stores +-Infinity and the rasteriser drops every triangle touching
          // such a vertex. Same escape tinkerbell already carries.
          if (Math.abs(px) > 10 || Math.abs(py) > 10) return 0;
        }
        return py * 0.3 * amp;
      }
    },
    tinkerbell: {
      name: 'Tinkerbell Map',
      formula: 'x_{n+1}=x_n²−y_n²+ax+by',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let px=x*0.3, py=z*0.3;
        const a=-0.3, b=-0.6013, c=2.0, d=0.5;
        for (let i=0; i<12; i++) {
          const nx=px*px-py*py+a*px+b*py; py=2*px*py+c*px+d*py; px=nx;
          if (!isFinite(px)||!isFinite(py)) return 0;
          // Escape guard. Trajectories with magnitude > 10 are visually
          // meaningless and overflow Float32 downstream. Catch them early —
          // unguarded iteration can reach ~1e+267 within a few more steps.
          if (Math.abs(px) > 10 || Math.abs(py) > 10) return 0;
        }
        return py * 0.18 * amp;
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 2 — SPECIAL FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════
const SPECIAL_FUNCTIONS = {
  name: 'SPECIAL FUNCTIONS',
  icon: '∿',
  formulas: {
    bessel0: {
      name: 'Bessel J₀ Radial',
      formula: 'J₀(r) = Σ (−1)^m/(m!)² (r/2)^{2m}',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq*3;
        return besselJ0(r) * amp * 0.6 * (1+Math.sin(t*0.5)*0.2);
      }
    },
    bessel1: {
      name: 'Bessel J₁ Radial',
      formula: 'J₁(r)',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq*3;
        // Numerical Recipes J₁ polynomial — max error ~10⁻⁷.
        return besselJ1(r)*amp*0.5*(1+Math.cos(t*0.4)*0.2);
      }
    },
    legendre2: {
      // FIX(#8, r4): the label said P₂ and the entry cannot draw P₂. The degree
      // is n = round(1 + comp·4) and comp is `0.5 + mid·0.4` at every site that
      // builds it, so comp ∈ [0.5, 0.9] and n ∈ {3, 4, 5}; P₂ would need
      // comp < 0.375, which no audio, slider or MIDI path produces. The
      // arithmetic is right — the name was naming a surface nobody could reach.
      // MATHEMATICAL_ACCURACY.md had already been corrected to "Legendre P_n
      // Surface"; this brings the code along. (The <option> text in index.html
      // still reads "Legendre P₂ Surface" and needs the same edit.)
      name: 'Legendre Pₙ Surface',
      formula: 'Pₙ(x), n = 3…5',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*4), xn=clamp(x*freq*0.28,-1,1);
        return legendreP(n, xn) * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    gamma_fn: {
      name: 'Gamma Function',
      formula: 'Γ(n) = (n−1)!',
      // FIX: the surface was 0.12·ln|Γ(n)|, and the entry is called "Gamma
      // Function" with the caption Γ(n) = (n−1)! and a tier-A rating. A
      // logarithm is not one of the studio's documented wrappers (amp, a fixed
      // scale, the exp(−z²k) envelope, a light time modulation) — it is a
      // different function, not a scaled one, and nothing said so.
      //
      // Over the window the entry actually shows, n ∈ [0.2, 3.8], Γ runs from
      // 4.591 down through its minimum 0.8856 at n = 1.4616 and back up to
      // 4.694 — a range that fits the frame directly, so the log was not even
      // buying headroom. Plotted straight, the surface now has the feature that
      // makes Γ recognisable: the single minimum between 1 and 2.
      f(x, z, t, {amp=1, freq=1}) {
        const n=clamp(0.2+(x+3.5)/7*3.6, 0.2, 3.8);
        return clamp(gamma(n)*0.22-0.6, -0.8, 0.8) * amp * Math.exp(-z*z*0.5);
      }
    },
    erf: {
      name: 'Error Function erf(x)',
      formula: 'erf(x) = 2/√π ∫₀ˣ e^{−t²} dt',
      // FIX: the Abramowitz & Stegun §7.1.26 Horner fit that stood here is
      // accurate to 1.5·10⁻⁷ by construction, and measured 1.394·10⁻⁷ at
      // x = 0.045 against Gauss–Legendre quadrature of the defining integral.
      // That is a tier-B number under this project's own definitions, while the
      // entry is documented tier A ("~14 significant digits") — and the two
      // Bessel entries, quoting the same 1.5·10⁻⁷ bound, sit in tier B.
      //
      // The series below is the all-positive rearrangement
      //   erf(x) = 2/√π · e^{−x²} · Σ 2ⁿx^{2n+1}/(2n+1)!!
      // (term ratio 2x²/(2n+3), so it starts shrinking once n > x²). Being
      // positive term by term it has none of the alternating cancellation that
      // makes the naive Taylor series unusable, and it holds machine precision
      // everywhere instead of bottoming out at a fixed 10⁻⁷. Past |x| = 6 the
      // result is 1 to within 2·10⁻¹⁷, so the tail short-circuits rather than
      // summing three hundred terms per vertex.
      f(x, z, t, {amp=1, freq=1}) {
        const y=x*freq, ay=Math.abs(y);
        let e;
        if (ay >= 6) e = 1;
        else {
          const y2=ay*ay;
          let term=ay, sum=ay;
          for (let n=0; n<400; n++) {
            term *= 2*y2/(2*n + 3);
            sum += term;
            if (term < sum*1e-17) break;
          }
          e = 2/Math.sqrt(Math.PI)*Math.exp(-y2)*sum;
        }
        return Math.sign(y)*e * amp * 0.5 * Math.exp(-z*z*0.4);
      }
    },
    zeta: {
      name: 'Riemann Zeta (real axis)',
      formula: 'ζ(s) = Σ 1/nˢ',
      // FIX: 14–22 terms of Σ n^{−s} is not ζ(s) anywhere near s = 1. Measured
      // against the true value: at the left edge of the displayed window
      // (s = 1.05) the sum came to 3.084 against ζ = 20.581 — low by 85 %, and
      // still 83 % low with the term count at its maximum. Shifting the domain
      // to start at 1.05, which MATHEMATICAL_ACCURACY.md credits with "avoiding
      // the issue", removes the divergence at s ≤ 1 and does nothing at all
      // about the convergence rate: no term count reachable at 60 fps helps,
      // since the tail of Σn^{−1.05} needs ~10⁴⁰ terms.
      //
      // Euler–Maclaurin closes it in the same arithmetic budget: sum the first
      // fifteen terms directly, then add the integral tail and two Bernoulli
      // corrections. That is exact to ~10⁻¹² across the whole window.
      //
      // Two knock-on changes the fix forces, both deliberate:
      //  • `comp` used to set the term count, i.e. it modulated the error. With
      //    the sum converged there is no error left to modulate, so comp now
      //    stretches the s-window; at comp = 0.5 that window is exactly the
      //    [1.05, 5.05] this entry has always drawn.
      //  • the display map is retuned. ζ now spans 20.58 down to 1.00 where the
      //    truncated sum spanned 3.46 down to 1.00, so the old `·0.08 − 0.3`
      //    saturates the clamp. The log compresses that back into the frame and
      //    keeps the same sense (height falls as s grows) over a wider range
      //    than the ±0.2 the entry used to occupy.
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const s=clamp(1.05+(x+3.5)/7*(2+comp*4), 1.05, 7.05);
        const N=16;
        let sum=0;
        for (let n=1; n<N; n++) sum+=Math.pow(n,-s);
        const Ns=Math.pow(N,-s);
        sum += Ns*0.5 + N*Ns/(s-1) + s*Ns/N/12 - s*(s+1)*(s+2)*Ns/(N*N*N)/720;
        return clamp(Math.log(sum)*0.25-0.35, -0.7, 0.7) * amp * Math.exp(-z*z*0.3);
      }
    },
    airy: {
      name: 'Airy Function Ai(x)',
      formula: 'Ai(x), Ai\'\'(x) = x·Ai(x)',
      // History, because it took two rounds to get here. Round 4 fixed a march
      // that imposed the x = 0 seed at x = −3 — the right initial condition at
      // the wrong point selects a different combination of Ai and Bi, so the
      // result was not Ai anywhere (it came out −0.365 at x = 0 against
      // Ai(0) = +0.355), and the loop never ran at all for ξ < −3, leaving a
      // constant shelf where Ai should oscillate. Moving the seed to the point
      // it describes and going from Euler to RK4 fixed those two, and left the
      // third: no forward march of y″ = x·y survives, because it amplifies the
      // growing Bi solution on every step. Measured on that code, Ai came back
      // negative from ξ ≈ 4.88 — inside the ξ ≤ 5.25 the default wave intensity
      // reaches — where the true Ai is positive everywhere. The march is now
      // gone entirely; see airyAi() among the shared helpers.
      f(x, z, t, {amp=1, freq=1}) {
        return clamp(airyAi(x*freq*1.5) * amp * 0.7 * Math.exp(-z*z*0.3), -0.8, 0.8);
      }
    },
    hypergeometric: {
      name: '₂F₁ Hypergeometric',
      formula: '₂F₁(a,b;c;z) = Σ (a)ₙ(b)ₙ/(c)ₙ·zⁿ/n!',
      // FIX: twelve terms with an early exit at 10⁻⁸ that never fired. At the
      // right edge of the reachable domain (z = 0.875 at the default wave
      // intensity, 0.95 once the clamp bites) the twelfth term is still
      // 2.5·10⁻², so the loop always ran to its cap and stopped there — a hard
      // truncation two orders outside the 10⁻³ floor of the tier B this entry
      // is documented at.
      //
      // Euler's transformation ₂F₁(a,b;c;z) = (1−z)^{c−a−b}·₂F₁(c−a,c−b;c;z)
      // does not change |z|, so the geometric rate is the same — what it changes
      // is the algebraic factor: terms fall as zⁿ·n^{−1.5−comp} instead of
      // zⁿ·n^{comp−1.5}, which is worth two to three orders by the hundredth
      // term. With the cap at 120 and the exit tightened to a relative 10⁻¹²,
      // the worst reachable point lands well inside tier B and everywhere else
      // is at machine precision.
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const zv=clamp(x*freq*0.25,-0.95,0.95), a=0.5, b=0.5+comp, c=1.5;
        const A=c-a, B=c-b;
        let sum=1, term=1;
        for (let n=1; n<=120; n++) {
          term*=((A+n-1)*(B+n-1))/((c+n-1)*n)*zv;
          sum+=term;
          if (Math.abs(term)<Math.abs(sum)*1e-12) break;
        }
        const F=Math.pow(1-zv, c-a-b)*sum;
        return clamp(F * 0.15 * amp * Math.exp(-z*z*0.4), -0.8, 0.8);
      }
    },
    laguerre: {
      name: 'Laguerre Polynomial',
      formula: 'L_n(x) = eˣ/n! d^n/dx^n(x^n e^{−x})',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const xv=clamp((x+3.5)/7*6, 0, 6), n=Math.round(1+comp*4);
        // Recurrence: L₀=1, L₁=1-x, L_{n+1}=((2n+1-x)Ln - nL_{n-1})/(n+1)
        let lp=1, lc=1-xv;
        for (let i=1; i<n; i++) { const t2=((2*i+1-xv)*lc - i*lp)/(i+1); lp=lc; lc=t2; }
        return clamp(lc * 0.15 * amp * Math.exp(-z*z*0.3), -0.7, 0.7);
      }
    },
    chebyshev: {
      name: 'Chebyshev T_n(x)',
      formula: 'T_n(cos θ) = cos(nθ)',
      // FIX: the ±(1−10⁻⁹) guard inside acos cost 2.5·10⁻⁸ at |x| = 1, where
      // T_n(±1) = (±1)ⁿ exactly. That is not one vertex: xv is itself clamped to
      // [−1, 1], so every point past |x·freq·0.28| = 1 saturates there — the
      // whole rim of the surface at the default wave intensity. The guard also
      // was not buying anything: acos(±1) is exactly 0 and π, and xv is already
      // inside the domain by the clamp on the line above.
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const xv=clamp(x*freq*0.28,-1,1), n=Math.round(1+comp*6);
        return Math.cos(n*Math.acos(xv)) * amp * 0.45 * Math.exp(-z*z*0.3);
      }
    },
    sinc: {
      // The kernel is exact; the caption was not. What is drawn is the radial
      // ("sombrero") sinc of r = √(x²+z²)·freq·2, not sinc of the x coordinate.
      name: 'Cardinal Sinc (radial)',
      formula: 'sinc(r) = sin(πr)/(πr), r = √(x²+z²)',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq*2+1e-8;
        return Math.sin(Math.PI*r)/(Math.PI*r) * amp * 0.6;
      }
    },
    ellipticK: {
      name: 'Elliptic Integral K(k)',
      formula: 'K(k) = ∫₀^{π/2} dθ/√(1−k²sin²θ)',
      f(x, z, t, {amp=1, freq=1}) {
        const kk=clamp((x+3.5)/7*0.98, 0.01, 0.99);
        const N=16; let K=0;
        for (let i=0; i<N; i++) {
          const th=(i+0.5)*Math.PI/2/N;
          K+=1/Math.sqrt(1-kk*kk*Math.sin(th)**2);
        }
        K*=Math.PI/2/N;
        return clamp(K * 0.2 - 0.3, -0.5, 0.8) * amp * Math.exp(-z*z*0.35);
      }
    },
    dawson: {
      name: 'Dawson Function F(x)',
      formula: 'F(x) = e^{−x²} ∫₀ˣ e^{t²} dt',
      // The two-region implementation that stood here is now dawsonF() among the
      // shared helpers, rewritten to Rybicki's lattice sum — see the note there
      // for the seam it had and the measurements. Accuracy across the reachable
      // domain |xv| ≤ 24 is ~3·10⁻¹⁵ against Gauss–Legendre quadrature.
      f(x, z, t, {amp=1, freq=1}) {
        return clamp(dawsonF(x*freq*1.5) * 0.4 * amp, -0.6, 0.6) * Math.exp(-z*z*0.4);
      }
    },
    clausen: {
      name: 'Clausen Function',
      formula: 'Cl₂(θ) = −∫₀^θ ln|2sin(t/2)| dt',
      // The twelve-term Fourier sum is now clausenCl2() among the shared
      // helpers, rewritten to the log-sine expansion — see the note there.
      // Σ sin(kθ)/k² converges like 1/N, which is adequate mid-period and not
      // at the ends, where Cl₂ has infinite slope; the replacement is exact to
      // 10⁻¹⁶ at the canonical points (Catalan's constant at θ = π/2,
      // Cl₂(π/3) = 1.0149416064096537) across the whole period.
      f(x, z, t, {amp=1, freq=1}) {
        return clausenCl2((x+3.5)/7*TAU) * 0.3 * amp * Math.exp(-z*z*0.4);
      }
    },
    polygamma: {
      name: 'Digamma ψ(x)',
      formula: 'ψ(x) = Γ\'(x)/Γ(x)',
      f(x, z, t, {amp=1, freq=1}) {
        const xv=clamp(0.2+(x+3.5)/7*4, 0.2, 4.2);
        // Digamma ψ(x) via recurrence + asymptotic series, ~10⁻¹⁰ accuracy.
        // Uses ψ(x+1) = ψ(x) + 1/x to lift x to x ≥ 8 (where the asymptotic
        // series converges fast), then the standard Bernoulli expansion.
        let xa = xv, psi = 0;
        // Recur up: subtract 1/x for each step to keep ψ(xv) correct
        while (xa < 8) { psi -= 1/xa; xa += 1; }
        // Asymptotic: ψ(x) ≈ ln(x) - 1/(2x) - Σ B_{2k}/(2k·x^{2k}) for k=1,2,3,4
        // B_2=1/6, B_4=-1/30, B_6=1/42, B_8=-1/30
        const x2 = xa*xa, x4 = x2*x2, x6 = x4*x2, x8 = x6*x2;
        psi += Math.log(xa) - 1/(2*xa)
             - (1/6)/(2*x2)
             - (-1/30)/(4*x4)
             - (1/42)/(6*x6)
             - (-1/30)/(8*x8);
        return clamp(psi * 0.2 * amp, -0.6, 0.6) * Math.exp(-z*z*0.4);
      }
    },
    lambertW: {
      name: 'Lambert W Function',
      formula: 'W(x)e^{W(x)} = x',
      f(x, z, t, {amp=1, freq=1}) {
        const xv=(x+3.5)/7*5;
        // Halley iteration
        let w=xv<1?0.5:Math.log(xv);
        for (let i=0; i<6; i++) {
          const ew=Math.exp(w), wew=w*ew, den=wew+ew-(w+2)*(wew-xv)/(2*w+2);
          w-=(wew-xv)/den;
        }
        return clamp(w * 0.18 * amp, -0.5, 0.7) * Math.exp(-z*z*0.4);
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 3 — PROBABILITY & STATISTICS
// ═══════════════════════════════════════════════════════════════════════════════
const PROBABILITY_STATISTICS = {
  name: 'PROBABILITY & STATISTICS',
  icon: '📊',
  formulas: {
    gaussian: {
      name: 'Gaussian Bell Curve',
      formula: 'f(x) = 1/(σ√2π) e^{−(x−μ)²/2σ²}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const mu=Math.sin(t*0.3)*comp*0.5, sigma=0.6+comp*0.3;
        return normalPDF(x*freq, mu, sigma) * sigma * Math.sqrt(TAU) * amp * 0.55 * Math.exp(-z*z*0.35);
      }
    },
    bivariate: {
      name: 'Bivariate Gaussian',
      formula: 'f(x,z) = 1/(2πσ²) e^{−(x²+z²)/2σ²}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const s=0.8+comp*0.6, r=Math.sin(t*0.4)*comp*0.4;
        const det=1-r*r;
        return Math.exp(-((x*freq)**2 - 2*r*x*freq*z*freq + (z*freq)**2)/(2*det*s*s))/(TAU*s*s*Math.sqrt(det)) * amp * 2;
      }
    },
    cauchy: {
      name: 'Cauchy Distribution',
      formula: 'f(x) = 1/(π(1+x²))',
      f(x, z, t, {amp=1, freq=1}) {
        return 1/(Math.PI*(1+(x*freq)**2)) * amp * 0.5 * Math.exp(-z*z*0.35);
      }
    },
    laplace: {
      name: 'Laplace Distribution',
      formula: 'f(x) = 1/(2b) e^{−|x|/b}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const b=0.5+comp*0.5;
        return Math.exp(-Math.abs(x*freq)/b)/(2*b) * amp * 0.5 * Math.exp(-z*z*0.35);
      }
    },
    maxwellBoltzmann: {
      name: 'Maxwell–Boltzmann',
      formula: 'f(v) = 4π(m/2πkT)^{3/2} v² e^{−mv²/2kT}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const v=clamp((x+3.5)/7*4, 0, 4), a=0.7+comp*0.4;
        return v*v*Math.exp(-v*v/(2*a*a)) * amp * 0.6 * Math.exp(-z*z*0.35);
      }
    },
    poisson: {
      name: 'Poisson PMF',
      formula: 'P(k;λ) = λᵏe^{−λ}/k!',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const k=clamp(Math.round((x+3.5)/7*10), 0, 10), lam=2+comp*4+Math.sin(t*0.3)*1.5;
        let logP=-lam+k*Math.log(lam);
        for (let i=1; i<=k; i++) logP-=Math.log(i);
        return Math.exp(logP) * amp * 0.5 * (k%2===0?1:-1)*Math.exp(-z*z*0.35)+0;
      }
    },
    randomWalk: {
      name: 'Brownian Motion (seeded)',
      formula: 'W(t) = Σ ξᵢ√dt',
      f(x, z, t, {amp=1, freq=1}) {
        // Deterministic pseudo-random walk seeded by x
        let v=0, seed=Math.round((x+3.5)*57.3);
        const steps=16;
        for (let i=0; i<steps; i++) {
          seed=(seed*1664525+1013904223)&0xffffffff;
          v+=(((seed>>>16)&0xff)/255-0.5)*0.15;
        }
        return v * amp * Math.exp(-z*z*0.35) * (1+Math.sin(t*0.3)*0.2);
      }
    },
    ornsteinUhlenbeck: {
      name: 'Ornstein–Uhlenbeck',
      formula: 'dXt = θ(μ−Xt)dt + σdWt',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const theta=1+comp, mu=0, sigma=0.4, dt=0.05, steps=20;
        let v=x*0.5;
        for (let i=0; i<steps; i++) {
          const seed=(i*2654435761+Math.round(x*100))>>>0;
          const noise=((seed&0xffff)/65535-0.5)*2;
          v+=theta*(mu-v)*dt + sigma*noise*Math.sqrt(dt);
        }
        return v * 0.4 * amp * Math.exp(-z*z*0.35);
      }
    },
    chiSquare: {
      name: 'Chi-Squared Distribution',
      formula: 'f(x;k) = x^{k/2−1}e^{−x/2}/(2^{k/2}Γ(k/2))',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const k=Math.round(1+comp*7), xv=clamp((x+3.5)/7*10, 0.01, 10);
        const logf=(k/2-1)*Math.log(xv)-xv/2-(k/2)*Math.log(2)-Math.log(Math.abs(gamma(k/2)));
        return clamp(Math.exp(logf), 0, 0.8) * amp * Math.exp(-z*z*0.35);
      }
    },
    studentT: {
      name: "Student's t Distribution",
      formula: 'f(t;ν) ∝ (1+t²/ν)^{−(ν+1)/2}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const nu=Math.max(1, Math.round(1+comp*9)), xv=x*freq;
        return Math.pow(1+xv*xv/nu, -(nu+1)/2) * amp * 0.5 * Math.exp(-z*z*0.35);
      }
    },
    entropyLandscape: {
      name: 'Shannon Entropy Surface',
      formula: 'H = −Σ p·log₂(p)',
      f(x, z, t, {amp=1, freq=1}) {
        const p=clamp((x+3.5)/7, 0.001, 0.999);
        const H=-(p*Math.log2(p)+(1-p)*Math.log2(1-p));
        return H * amp * 0.45 * Math.exp(-z*z*0.35);
      }
    },
    mixtureGaussians: {
      name: 'Gaussian Mixture',
      formula: 'f = Σ wᵢ·N(μᵢ,σᵢ)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(2+comp*3);
        let v=0;
        for (let i=0; i<n; i++) {
          const mu=Math.cos(i*TAU/n+t*0.2)*1.5*freq, sigma=0.4+i*0.1;
          v+=normalPDF(x, mu, sigma);
        }
        return v * 0.4 * amp * Math.exp(-z*z*0.35);
      }
    },
    pareto: {
      name: 'Pareto Distribution',
      formula: 'f(x;α,xm) = αxmᵅ/x^{α+1}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const xv=clamp((x+3.5)/7*4+0.5, 0.5, 4.5), alpha=1+comp*2, xm=0.5;
        const v=xv>=xm ? alpha*Math.pow(xm,alpha)/Math.pow(xv,alpha+1) : 0;
        return v * amp * 0.3 * Math.exp(-z*z*0.35);
      }
    },
    kernelDensity: {
      name: 'Kernel Density Estimate',
      formula: 'f̂(x) = 1/nh Σ K((x−xᵢ)/h)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const pts=[-1.5,-0.8,0,0.4,1.1,1.8], h=0.4+comp*0.3;
        let v=0;
        for (const mu of pts) v+=normalPDF(x*freq, mu, h);
        return v/pts.length * amp * 0.45 * Math.exp(-z*z*0.35);
      }
    },
    vonMises: {
      name: 'von Mises Distribution',
      formula: 'f(θ;μ,κ) = e^{κcos(θ−μ)}/(2πI₀(κ))',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const theta=x*freq*Math.PI, mu=t*0.4, kappa=1+comp*4;
        return Math.exp(kappa*Math.cos(theta-mu)) * amp * 0.25 * Math.exp(-z*z*0.35);
      }
    },
    metropolisWalk: {
      name: 'MCMC Metropolis Walk',
      formula: 'Accept if e^{−ΔE/T} > U[0,1]',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const target = v => normalPDF(v, 0, 0.8) + normalPDF(v, 1.5, 0.4)*0.6;
        let v=0, hist=0;
        for (let i=0; i<40; i++) {
          const seed=(i*2246822519+Math.round(x*1000))>>>0;
          const proposal=v+((seed&0xffff)/65535-0.5)*0.8*(1+comp);
          // Deterministic pseudo-random acceptance test — keeps the surface
          // reproducible frame to frame instead of flickering as Math.random()
          // would. Hash combines proposal position with the step index.
          //
          // FIX(#4, r4): the hash used to read `v` and the global clock, which
          // produced exactly the flicker the sentence above says it prevents:
          // `t` advances 0.008 per rendered frame, moving the sine argument
          // 2.49 rad, so the accept/reject decision for all 40 steps was
          // uncorrelated between consecutive frames and the height field
          // changed by 95% of its own peak every 16 ms. The step index carries
          // the decorrelation the clock was being used for, and the proposal —
          // which the comment always claimed was hashed — is what the coin
          // should depend on anyway. Audio still reaches the chain through
          // comp, which sets the proposal width.
          if (((Math.sin(proposal*127.1+i*311.7)*43758.5453)%1+1)%1 < target(proposal)/Math.max(1e-8,target(v))) v=proposal;
        }
        return Math.exp(-3*(v-x*freq)**2) * amp * 0.5 * Math.exp(-z*z*0.4);
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 4 — LINEAR ALGEBRA
// ═══════════════════════════════════════════════════════════════════════════════
const LINEAR_ALGEBRA = {
  name: 'LINEAR ALGEBRA',
  icon: '⊞',
  formulas: {
    eigenField: {
      name: 'Eigenvector Field',
      formula: 'Av = λv',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a11=Math.cos(t*0.3), a12=Math.sin(t*0.4)*comp;
        const a21=-Math.sin(t*0.4)*comp, a22=-Math.cos(t*0.3);
        return (a11*x*freq + a12*z*freq) * amp * 0.3 + (a21*x*freq + a22*z*freq) * amp * 0.2;
      }
    },
    determinant: {
      name: 'Determinant Surface',
      formula: 'det(A(x,z))',
      f(x, z, t, {amp=1, freq=1}) {
        const a=x*freq, b=Math.sin(t*0.4), c=Math.cos(t*0.3), d=z*freq;
        return (a*d-b*c) * amp * 0.3;
      }
    },
    svdSpectrum: {
      name: 'SVD Singular Values',
      formula: 'A = UΣVᵀ, σ₁ = √(½(‖A‖²_F + √(‖A‖⁴_F − 4·det²)))',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // Closed-form largest singular value σ_max of a real 2×2 matrix.
        // SVD singular values are always real (they come from √eigenvalues
        // of AᵀA), so the discriminant under the inner square root is
        // non-negative by construction:
        //   σ_max = √(½(‖A‖²_F + √(‖A‖⁴_F − 4·det(A)²)))
        const a=x*freq+comp, b=Math.sin(t*0.5), c=z*freq, d=Math.cos(t*0.3);
        const fro2 = a*a + b*b + c*c + d*d;        // ‖A‖²_F
        const det  = a*d - b*c;
        const disc = Math.sqrt(Math.max(0, fro2*fro2 - 4*det*det));
        return Math.sqrt((fro2 + disc) / 2) * amp * 0.15;
      }
    },
    trace: {
      name: 'Matrix Trace Wave',
      formula: 'tr(Aⁿ)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*3), r=Math.sqrt(x*x+z*z)*freq;
        return Math.pow(Math.cos(r), n) * amp * 0.5;
      }
    },
    tensorField: {
      name: '2D Tensor Field',
      formula: 'T = [[x²,xz],[xz,z²]]',
      f(x, z, t, {amp=1, freq=1}) {
        const f2=freq*0.7;
        return (x*f2*x*f2 + x*f2*z*f2 + z*f2*z*f2) * amp * 0.12;
      }
    },
    hessian: {
      name: 'Hessian Determinant (2D)',
      formula: 'H = f_xx·f_zz − f_xz²',
      f(x, z, t, {amp=1, freq=1}) {
        const f2=freq*2, fxx=-f2*f2*Math.sin(f2*x), fzz=-f2*f2*Math.sin(f2*z), fxz=0;
        return (fxx*fzz-fxz*fxz) * amp * 0.02;
      }
    },
    rotationMatrix: {
      name: 'Rotation Matrix Flow',
      formula: 'R(θ)·[x,z]',
      f(x, z, t, {amp=1, freq=1}) {
        const th=t*0.5, rx=Math.cos(th)*x*freq-Math.sin(th)*z*freq;
        return Math.sin(rx * Math.PI) * amp * 0.4;
      }
    },
    gram: {
      name: 'Gram–Schmidt Surface',
      formula: 'e₁=v₁/|v₁|, e₂=v₂−(v₂·e₁)e₁',
      f(x, z, t, {amp=1, freq=1}) {
        const v1x=Math.cos(t*0.3), v1z=Math.sin(t*0.3);
        const n1=Math.sqrt(v1x*v1x+v1z*v1z)+1e-9;
        const e1x=v1x/n1, e1z=v1z/n1;
        const dot=x*freq*e1x+z*freq*e1z;
        const e2x=x*freq-dot*e1x, e2z=z*freq-dot*e1z;
        return Math.sqrt(e2x*e2x+e2z*e2z) * amp * 0.25;
      }
    },
    quadraticForm: {
      name: 'Quadratic Form xᵀAx',
      formula: 'Q = ax²+2bxz+cz²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=1+Math.sin(t*0.4)*comp, b=Math.cos(t*0.5)*comp*0.5, c=1+Math.cos(t*0.3)*comp;
        return (a*x*x+2*b*x*z+c*z*z)*freq*freq * amp * 0.07;
      }
    },
    nullspace: {
      name: 'Nullspace Projection',
      formula: 'Px = x − Aᵀ(AAᵀ)⁻¹Ax',
      f(x, z, t, {amp=1, freq=1}) {
        const ax=Math.cos(t*0.4), az=Math.sin(t*0.4);
        const dot=ax*x*freq+az*z*freq;
        const px=x*freq-ax*dot, pz=z*freq-az*dot;
        return Math.sin(Math.sqrt(px*px+pz*pz)*3) * amp * 0.4;
      }
    },
    spectralRadius: {
      name: 'Spectral Radius Map',
      formula: 'ρ(A) = max|λᵢ|',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=x*freq*(1+comp), b=z*freq, c=Math.sin(t*0.5)*comp, d=-x*freq;
        const disc=(a+d)**2-4*(a*d-b*c);
        return clamp(Math.sqrt(Math.abs(disc))*0.3*amp, 0, 0.8);
      }
    },
    matrixExp: {
      name: 'Matrix Exponential',
      formula: 'e^A = Σ Aⁿ/n!',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const r=Math.sqrt(x*x+z*z)*freq;
        return (Math.cosh(r*comp)*Math.cos(r) - 1) * amp * 0.2;
      }
    },
    kronecker: {
      name: 'Kronecker Product Pattern',
      formula: 'A ⊗ B',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const gx=Math.floor((x+3.5)/7*4+0.5), gz=Math.floor((z+3.5)/7*4+0.5);
        const fx=(x+3.5)/7*4-gx+0.5, fz=(z+3.5)/7*4-gz+0.5;
        const A=Math.sin(gx*1.1+t*0.3)*Math.cos(gz*0.9);
        const B=Math.sin(fx*Math.PI*2*freq)*Math.cos(fz*Math.PI*2*freq);
        return A*B*amp*0.4;
      }
    },
    vectorField: {
      name: 'Curl of Vector Field',
      formula: '∇×F = (∂Fz/∂x − ∂Fx/∂z)ŷ',
      f(x, z, t, {amp=1, freq=1}) {
        const h=0.01, f2=freq;
        // F must be rotational, or there is nothing to see: the previous field
        // was F = (sin(x·f)·cos(z·f), cos(x·f)·sin(z·f)), a gradient field, and
        // the curl of a gradient is identically zero — the stencil below was
        // correct and returned 1e-14 everywhere, i.e. a dead-flat plate.
        // F = (Fx, Fz) = (−sin(z·f), sin(x·f)) has curl (cos(x·f)+cos(z·f))·f.
        // Dividing by f keeps a derivative-valued formula from scaling with the
        // frequency slider.
        const dFz_dx=(Math.sin((x+h)*f2)-Math.sin((x-h)*f2))/(2*h);
        const dFx_dz=(-Math.sin((z+h)*f2)+Math.sin((z-h)*f2))/(2*h);
        return (dFz_dx-dFx_dz)/Math.max(f2,1e-6) * amp * 0.25;
      }
    },
    jacobian: {
      name: 'Jacobian Determinant',
      formula: 'J = det[∂(u,v)/∂(x,z)]',
      f(x, z, t, {amp=1, freq=1}) {
        const h=0.01, f2=freq;
        const ux=Math.cos((x+h)*f2+z*f2)-Math.cos((x-h)*f2+z*f2);
        const uz=Math.cos(x*f2+(z+h)*f2)-Math.cos(x*f2+(z-h)*f2);
        const vx=Math.sin((x+h)*f2*1.3)-Math.sin((x-h)*f2*1.3);
        const vz=Math.sin(z*f2*0.9+(z+h)*f2)-Math.sin(z*f2*0.9+(z-h)*f2);
        // Parenthesize the full determinant so amp*0.1 scales the result
        // rather than only the second product term.
        return ((ux/(2*h))*(vz/(2*h)) - (uz/(2*h))*(vx/(2*h))) * amp * 0.1;
      }
    },
    manifoldCurvature: {
      name: 'Gaussian Curvature',
      formula: 'K = (eg−f²)/(EG−F²)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const f2=freq, s=Math.sin, c=Math.cos, h=0.05;
        const F0 = (x,z) => (s(x*f2)+s(z*f2))*(0.3+comp*0.3);
        const fxx=(F0(x+h,z)-2*F0(x,z)+F0(x-h,z))/h/h;
        const fzz=(F0(x,z+h)-2*F0(x,z)+F0(x,z-h))/h/h;
        const fxz=(F0(x+h,z+h)-F0(x+h,z-h)-F0(x-h,z+h)+F0(x-h,z-h))/(4*h*h);
        const K=(fxx*fzz-fxz*fxz)*amp*0.15;
        return clamp(K,-0.6,0.6);
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 5 — TRIGONOMETRY
// ═══════════════════════════════════════════════════════════════════════════════
const TRIGONOMETRY = {
  name: 'TRIGONOMETRY',
  icon: '📐',
  formulas: {
    sinCos: {
      name: 'sin·cos Product',
      formula: 'f = sin(ax)·cos(bz)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        return Math.sin(x*freq*(1+comp)*2)*Math.cos(z*freq*(1+comp)*2) * amp * 0.5;
      }
    },
    pythagorean: {
      name: 'Pythagorean Identity Wave',
      formula: 'sin²+cos²=1 → height = sin²(rx)−½',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq*2+1e-9;
        const s=Math.sin(r+t), c=Math.cos(r+t);
        return (s*s - c*c) * amp * 0.45;
      }
    },
    sumAngle: {
      name: 'Sum of Angles Identity',
      formula: 'sin(α+β) = sin α cos β + cos α sin β',
      f(x, z, t, {amp=1, freq=1}) {
        const alpha=x*freq*2+t*0.5, beta=z*freq*2;
        const direct=Math.sin(alpha+beta);
        const expanded=Math.sin(alpha)*Math.cos(beta)+Math.cos(alpha)*Math.sin(beta);
        return direct * amp * 0.45 + (direct-expanded)*2;  // direct+residual
      }
    },
    doublAngle: {
      name: 'Double Angle',
      formula: 'sin(2x)=2sin(x)cos(x)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const xv=x*freq*(1+comp);
        return Math.sin(2*xv) * amp * 0.5 * Math.exp(-z*z*0.3) * (1+Math.sin(t*0.5)*0.2);
      }
    },
    halfAngle: {
      name: 'Half-Angle Formula',
      formula: 'sin(x/2) = ±√((1−cosx)/2)',
      f(x, z, t, {amp=1, freq=1}) {
        const xv=x*freq*2;
        return Math.sin(xv/2) * amp * 0.5 * Math.exp(-z*z*0.35);
      }
    },
    productSum: {
      name: 'Product-to-Sum',
      formula: '2sin(A)sin(B)=cos(A−B)−cos(A+B)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const A=x*freq*(1+comp)+t*0.3, B=z*freq*(1+comp);
        return 2*Math.sin(A)*Math.sin(B) * amp * 0.45;
      }
    },
    tangentWave: {
      name: 'Tanh / Smooth Step',
      formula: 'tanh(x) = (eˣ−e⁻ˣ)/(eˣ+e⁻ˣ)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        return Math.tanh(x*freq*(1+comp)*2) * amp * 0.45 * Math.exp(-z*z*0.35);
      }
    },
    lissajous: {
      name: 'Lissajous Height',
      formula: 'y = sin(ax+δ)·sin(bz)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=Math.round(1+comp*3), b=Math.round(1+comp*2);
        return Math.sin(a*x*freq+t*0.5)*Math.sin(b*z*freq) * amp * 0.45;
      }
    },
    hyperbolicGeom: {
      name: 'Cosh²−Sinh²=1 Surface',
      formula: 'cosh²(x)−sinh²(x) = 1 → cosh(r)',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq;
        return (Math.cosh(r*0.7)-1) * amp * 0.25;
      }
    },
    chebyshevTrig: {
      name: 'Chebyshev via cos(n·arccos)',
      formula: 'T_n(cos θ) = cos(nθ)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(2+comp*5), theta=x*freq*Math.PI*0.9;
        return Math.cos(n*theta) * amp * 0.45 * Math.exp(-z*z*0.3);
      }
    },
    standingWave: {
      name: 'Standing Wave',
      formula: 'y = A·sin(kx)·cos(ωt)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        return Math.sin(x*freq*(1+comp)*3)*Math.cos(t*(1+comp)*2) * amp * 0.5 * Math.exp(-z*z*0.25);
      }
    },
    travelingWave: {
      name: 'Traveling Wave',
      formula: 'y = A·sin(kx−ωt)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        return Math.sin(x*freq*3-t*(1+comp)*2) * amp * 0.5 * Math.exp(-z*z*0.25);
      }
    },
    modeInterference: {
      name: 'Mode Interference',
      formula: 'Σ sin(nπx)·cos(nωt)/n',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let v=0;
        for (let n=1; n<=6; n++) v+=Math.sin(n*x*freq*2)*Math.cos(n*t*0.8)/n;
        return v * amp * 0.3 * Math.exp(-z*z*0.25);
      }
    },
    circularFunctions: {
      name: 'sec / csc / cot Landscape',
      formula: 'sec=1/cos, csc=1/sin',
      f(x, z, t, {amp=1, freq=1}) {
        const xv=x*freq*2, zv=z*freq*2;
        const c=Math.cos(xv+t*0.3), s=Math.sin(zv);
        return clamp((Math.abs(c)>0.1 ? 1/c : 0) * (Math.abs(s)>0.1 ? 1/s : 0) * 0.04 * amp, -0.7, 0.7);
      }
    },
    atan2Field: {
      name: 'atan2 Phase Field',
      formula: 'φ(x,z) = atan2(z,x)',
      f(x, z, t, {amp=1, freq=1}) {
        const angle=Math.atan2(z, x);
        const r=Math.sqrt(x*x+z*z)*freq;
        return Math.sin(angle*3+r*2-t) * amp * 0.45;
      }
    },
    inverseTrig: {
      name: 'Arcsin / Arccos Surface',
      formula: 'arcsin(x)+arccos(x) = π/2',
      f(x, z, t, {amp=1, freq=1}) {
        const xv=clamp(x*freq*0.28,-1+1e-6,1-1e-6);
        return Math.asin(Math.max(-1+1e-9,Math.min(1-1e-9,xv))) * amp * 0.3 * Math.exp(-z*z*0.35);
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 6 — COMPLEX NUMBERS
// ═══════════════════════════════════════════════════════════════════════════════
const COMPLEX_NUMBERS = {
  name: 'COMPLEX NUMBERS',
  icon: '🔄',
  formulas: {
    euler: {
      name: "Euler's Formula Re(e^{ix})",
      formula: 'e^{iθ} = cos θ + i·sin θ',
      f(x, z, t, {amp=1, freq=1}) {
        const theta=x*freq*2;
        return Math.cos(theta+t*0.5) * amp * 0.45 * Math.exp(-z*z*0.3);
      }
    },
    eulerIm: {
      name: "Euler's Formula Im(e^{iz})",
      formula: 'Im(e^{i(x+iz)}) = e^{−z}sin(x)',
      f(x, z, t, {amp=1, freq=1}) {
        return Math.exp(-z*freq)*Math.sin(x*freq+t*0.4) * amp * 0.45;
      }
    },
    moivre: {
      name: "De Moivre's Theorem",
      formula: '(cos θ+i sin θ)^n = cos(nθ)+i sin(nθ)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*6), theta=x*freq*2;
        return Math.cos(n*theta+t*0.3) * amp * 0.45 * Math.exp(-z*z*0.3);
      }
    },
    complexPower: {
      name: 'Complex Power |z^z|',
      formula: '|z^z|, z = x+iz',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq+1e-9;
        const theta=Math.atan2(z*freq,x*freq);
        const logMod=Math.log(r), arg=theta;
        // FIX(#2, r4): |z^z| = exp(Re(z·Log z)) = exp(x·ln|z| − y·arg z). The
        // first term used to be `r*logMod` — the modulus in place of the real
        // part. The two are the same number only on the positive real axis,
        // where every existing assertion for this entry happened to sit; over
        // the whole x < 0 half the result was exponentially too large (at
        // z = −2 it returned 0.4 against a true 0.025) and a fifth of the mesh
        // sat pinned at the +0.7 clamp instead of collapsing toward zero.
        const realExp=x*freq*logMod-z*freq*arg;
        return clamp(Math.exp(realExp)*0.1*amp,-0.7,0.7);
      }
    },
    rootsOfUnity: {
      name: 'n-th Roots of Unity Heights',
      formula: 'z_k = e^{2πik/n}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(3+comp*5);
        let v=0;
        for (let k=0; k<n; k++) {
          const re=Math.cos(TAU*k/n+t*0.3), im=Math.sin(TAU*k/n+t*0.3);
          v+=Math.exp(-4*((x*freq-re)**2+(z*freq-im)**2));
        }
        return v * amp * 0.4;
      }
    },
    complexLog: {
      name: 'Complex Logarithm',
      formula: 'Log(z) = ln|z| + i·arg(z)',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt((x*freq)**2+(z*freq)**2)+1e-9;
        return Math.log(r) * amp * 0.2 * (1+Math.sin(t*0.4)*0.2);
      }
    },
    riemannSphere: {
      name: 'Riemann Sphere Projection',
      formula: 'ξ = 2x/(x²+z²+1), η = (x²+z²−1)/(x²+z²+1)',
      f(x, z, t, {amp=1, freq=1}) {
        const r2=(x*freq)**2+(z*freq)**2;
        return (r2-1)/(r2+1) * amp * 0.5;
      }
    },
    mobiusTransform: {
      name: 'Möbius Transformation',
      formula: 'f(z) = (az+b)/(cz+d)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=1, b=Math.sin(t*0.4)*comp, c=Math.cos(t*0.3)*comp, d=1;
        const zre=x*freq, zim=z*freq;
        const cre=c*zre+d, cim=c*zim;
        const den2=cre*cre+cim*cim+1e-9;
        const num_re=a*zre+b, num_im=a*zim;
        const wre=(num_re*cre+num_im*cim)/den2;
        return clamp(wre * amp * 0.35,-0.7,0.7);
      }
    },
    cauchyRiemann: {
      name: 'Cauchy–Riemann Satisfaction',
      formula: '∂u/∂x=∂v/∂z, ∂u/∂z=−∂v/∂x',
      f(x, z, t, {amp=1, freq=1}) {
        // Re(z²) = x²-z² — analytic → CR satisfied
        return ((x*freq)**2-(z*freq)**2) * amp * 0.18 * (1+Math.sin(t*0.3)*0.2);
      }
    },
    complexSin: {
      name: 'Complex sin(z) Real Part',
      formula: 'Re(sin(x+iz)) = sin(x)cosh(z)',
      f(x, z, t, {amp=1, freq=1}) {
        return clamp(Math.sin(x*freq+t*0.3)*Math.cosh(z*freq*0.5) * amp * 0.3,-0.7,0.7);
      }
    },
    juliaPotential: {
      name: 'Julia Potential',
      formula: 'G(z) = lim log|fⁿ(z)|/2ⁿ',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const cr=-0.4+Math.sin(t*0.2)*0.3*comp, ci=0.6+Math.cos(t*0.15)*0.2*comp;
        let zx=x*freq, zy=z*freq, r2=0;
        const maxIt=12;
        for (let i=0; i<maxIt; i++) {
          r2=zx*zx+zy*zy;
          if (r2>100) return Math.log(Math.log(Math.sqrt(r2)))/Math.log(2) * amp * 0.2;
          const nx=zx*zx-zy*zy+cr; zy=2*zx*zy+ci; zx=nx;
        }
        return 0;
      }
    },
    windingNumber: {
      name: 'Winding Number Field',
      formula: 'n(γ,z₀) = 1/(2πi) ∮ dz/(z−z₀)',
      f(x, z, t, {amp=1, freq=1, comp=0.5}) {
        // Numerical winding number n(γ, z₀) via direct integration of
        // dz/(z-z₀) around contour γ = circle of radius R=1 traversed
        // n_loops times. By Cauchy: n_loops if z₀ inside, 0 outside.
        // n_loops = round(comp·3 + 1), R = 1.
        const z0re = x * freq * 0.5;
        const z0im = z * freq * 0.5;
        const R = 1.0;
        const n_loops = Math.round(1 + comp * 3);
        const N = 48;
        let imSum = 0; // we only need imaginary part of ∮dz/(z-z₀)
        for (let k = 0; k < N; k++) {
          const phi = (k + 0.5) * (n_loops * 2 * Math.PI / N) + t * 0.05;
          const zRe = R * Math.cos(phi), zIm = R * Math.sin(phi);
          const dzRe = -R * Math.sin(phi) * (n_loops * 2 * Math.PI / N);
          const dzIm =  R * Math.cos(phi) * (n_loops * 2 * Math.PI / N);
          const drRe = zRe - z0re, drIm = zIm - z0im;
          const drMag2 = drRe*drRe + drIm*drIm + 1e-9;
          // 1/(z-z₀) · dz: take imaginary part directly
          // Re(1/dr) = drRe/|dr|², Im(1/dr) = -drIm/|dr|²
          // (Re/dr + i·Im/dr)·(dzRe + i·dzIm)
          // Im of product = Re(1/dr)·dzIm + Im(1/dr)·dzRe
          imSum += (drRe * dzIm - drIm * dzRe) / drMag2;
        }
        // Winding number = imSum / (2π)
        const winding = imSum / (2 * Math.PI);
        return winding * amp * 0.18;
      }
    },
    blaschke: {
      name: 'Blaschke Product |B(z)|',
      formula: 'B(z) = Π (z−aₖ)/(1−āₖz)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(2+comp*3);
        let re=1, im=0;
        for (let k=0; k<n; k++) {
          const ak_re=Math.cos(TAU*k/n+t*0.2)*0.6, ak_im=Math.sin(TAU*k/n+t*0.2)*0.6;
          const zr=x*freq, zi=z*freq;
          const num_r=zr-ak_re, num_i=zi-ak_im;
          const den_r=1-ak_re*zr-ak_im*zi, den_i=-ak_re*zi+ak_im*zr;
          const d2=den_r*den_r+den_i*den_i+1e-9;
          const wr=(num_r*den_r+num_i*den_i)/d2, wi=(-num_r*den_i+num_i*den_r)/d2;
          const nr=re*wr-im*wi, ni=re*wi+im*wr;
          re=nr; im=ni;
        }
        return clamp(Math.sqrt(re*re+im*im) * amp * 0.45 - 0.2,-0.5,0.6);
      }
    },
    complexHeat: {
      name: 'Heat Kernel in ℂ',
      formula: 'K(z,t) = 1/(4πt)·e^{−|z|²/4t}',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(#5, r4): the kernel spreads and fades as 1/t, so on the session
        // clock it just kept fading — 8.2·10⁻² at boot down to 5.6·10⁻⁴ half an
        // hour in. 24 replays the spread from 0.3 out to 1.5, where the peak is
        // a fifth of the boot value; see replayTime.
        const T=0.3+replayTime(t, 24)*0.05, r2=(x*freq)**2+(z*freq)**2;
        return Math.exp(-r2/(4*T))/(4*Math.PI*T) * amp * 0.4;
      }
    },
    argandField: {
      name: 'Argand Phase Color',
      formula: 'arg(z^n)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*4);
        const theta=Math.atan2(z*freq,x*freq);
        return Math.sin(n*theta+t*0.4) * amp * 0.45;
      }
    },
    riemannZetaStrip: {
      name: 'Riemann ζ Critical Strip',
      formula: 'Re(ζ(½+it)) along t-axis',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const T=(x*freq+3.5)/7*30, N=10+Math.round(comp*20);
        let re=0, im=0;
        for (let n=1; n<=N; n++) {
          const logn=Math.log(n), phase=T*logn;
          re+=Math.cos(phase)/Math.sqrt(n);
          im-=Math.sin(phase)/Math.sqrt(n);
        }
        return (re*Math.cos(z*freq)-im*Math.sin(z*freq)) * amp * 0.15;
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 7 — FOURIER SERIES
// ═══════════════════════════════════════════════════════════════════════════════
const FOURIER_SERIES = {
  name: 'FOURIER SERIES',
  icon: '〜',
  formulas: {
    sineWave: {
      name: 'Fundamental Sine',
      formula: 'f(x) = sin(2πx/L)',
      f(x, z, t, {amp=1, freq=1}) {
        return Math.sin(x*freq*TAU*0.3+t) * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    squareWave: {
      name: 'Square Wave (Fourier)',
      formula: '4/π Σ sin((2k−1)x)/(2k−1)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=1+Math.round(comp*14); let v=0;
        for (let k=1; k<=N; k++) v+=Math.sin((2*k-1)*x*freq*2+t)/(2*k-1);
        return v*(4/Math.PI) * amp * 0.3 * Math.exp(-z*z*0.25);
      }
    },
    sawtoothWave: {
      name: 'Sawtooth Wave (Fourier)',
      formula: '2/π Σ (−1)^{k+1} sin(kx)/k',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=1+Math.round(comp*14); let v=0;
        for (let k=1; k<=N; k++) v+=Math.pow(-1,k+1)*Math.sin(k*x*freq*2+t)/k;
        return v*(2/Math.PI) * amp * 0.35 * Math.exp(-z*z*0.25);
      }
    },
    triangleWave: {
      name: 'Triangle Wave (Fourier)',
      formula: '8/π² Σ (−1)^k sin((2k+1)x)/(2k+1)²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=1+Math.round(comp*12); let v=0;
        for (let k=0; k<=N; k++) v+=Math.pow(-1,k)*Math.sin((2*k+1)*x*freq*2+t)/(2*k+1)**2;
        return v*(8/Math.PI**2) * amp * 0.4 * Math.exp(-z*z*0.25);
      }
    },
    pulseWave: {
      name: 'Pulse Wave',
      formula: 'f(x)=2/π Σ sin(nπD)cos(nx)/n, D=duty',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const D=0.2+comp*0.6, N=12; let v=D;
        for (let n=1; n<=N; n++) v+=2*Math.sin(n*Math.PI*D)*Math.cos(n*x*freq*2+t)/(n*Math.PI);
        return v * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    gibbsPhenomenon: {
      name: "Gibbs Phenomenon",
      formula: 'Overshoot ≈ 9% at discontinuity',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=1+Math.round(comp*20); let v=0;
        for (let k=1; k<=N; k++) v+=Math.sin((2*k-1)*x*freq*2)/(2*k-1);
        return v*(4/Math.PI) * amp * 0.3 * Math.exp(-z*z*0.25);
      }
    },
    heat2D: {
      name: 'Fourier Heat Equation',
      formula: 'u = Σ bₙsin(nπx)e^{−n²π²t}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(#5, r4): τ is diffusion time and t is the session clock, so every
        // mode decayed for good — the surface was down to 2·10⁻⁴ of its boot
        // peak five minutes in. 30 replays the diffusion from τ = 0.01 to 0.16,
        // by which point the fundamental has faded to a quarter; see replayTime.
        const N=5+Math.round(comp*6), tau=0.01+replayTime(t, 30)*0.005; let v=0;
        for (let n=1; n<=N; n++) {
          const bn=(n%2===0)?0:4/(n*Math.PI);
          v+=bn*Math.sin(n*Math.PI*(x*freq+0.5))*Math.exp(-n*n*Math.PI**2*tau);
        }
        return v * amp * 0.4 * Math.exp(-z*z*0.25);
      }
    },
    parseval: {
      name: 'Parseval Energy Spectrum',
      formula: '‖f‖² = Σ |cₙ|² (Parseval)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=clamp(Math.round((x+3.5)/7*14)+1, 1, 15);
        const cn_sq=(n%2===1) ? 4/(n*n*Math.PI*Math.PI) : 0.01/(n*n);
        return Math.sqrt(cn_sq) * amp * (4+comp*2) * Math.exp(-z*z*0.3) * (1+Math.sin(t*0.5)*0.15);
      }
    },
    wavelets: {
      name: 'Haar Wavelet',
      formula: 'ψ(x) = +1 [0,½), −1 [½,1)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const scale=Math.pow(2, Math.round(comp*4)), xv=(x*freq+3.5)/7;
        let v=0;
        for (let j=0; j<scale; j++) {
          const local=xv*scale-j;
          v+=(local>=0&&local<0.5)?1:(local>=0.5&&local<1)?-1:0;
        }
        return (v/scale) * amp * 0.4 * Math.exp(-z*z*0.3);
      }
    },
    dct: {
      name: 'Discrete Cosine Transform',
      formula: 'DCT-II: X[k] = Σ x[n]cos(π(n+½)k/N)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=8, k=clamp(Math.round((x+3.5)/7*N), 0, N-1);
        // FIX(#1, r4): the sum used to run the k-th basis vector over n with no
        // x[n] in it at all — Σₙ cos(π(n+½)k/N), which is the DCT-II of the
        // constant 1 and therefore exactly 0 for every k ≥ 1 by orthogonality.
        // Seven of the eight bands were identically zero, so 94% of the mesh
        // was a flat plate that nothing could move, while the entry's own
        // displayed formula string promises a transform of some x[n].
        //
        // There is now a signal to transform: a two-harmonic test tone whose
        // fundamental f₀ = 1 + comp·3 rides the mid band, chosen over a single
        // sinusoid because a lone harmonic leaves half the bins empty at
        // comp = 0.5. X[k] is the full DCT-II of it, normalised by N/2 — the
        // coefficient a unit sinusoid on a bin produces — so the surface keeps
        // the height range it had.
        const f0=1+comp*3;
        let v=0;
        for (let n=0; n<N; n++) {
          const xn=Math.sin(TAU*f0*(n+0.5)/N)+0.5*Math.sin(TAU*2*f0*(n+0.5)/N);
          v+=xn*Math.cos(Math.PI*(n+0.5)*k/N);
        }
        return (v*2/N) * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    convolution: {
      name: 'Convolution (f*g)',
      formula: '(f*g)(x) = ∫ f(τ)g(x−τ)dτ',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=20; let v=0;
        const g = xi => Math.exp(-xi*xi*4);
        for (let i=0; i<N; i++) {
          const tau=-2+i*4/N;
          const fx=Math.sin(tau*freq*3+t)*0.5;
          v+=fx*g(x*freq-tau)*4/N;
        }
        return v * amp * 0.4 * Math.exp(-z*z*0.3);
      }
    },
    spectralLeakage: {
      name: 'Spectral Leakage',
      formula: 'Windowed DFT spectral smear',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=32, f0=4+comp*4; let re=0, im=0;
        for (let n=0; n<N; n++) {
          const window=0.5-0.5*Math.cos(TAU*n/N); // Hann window
          const signal=Math.sin(TAU*f0*n/N)*window;
          const k=(x+3.5)/7*N;
          re+=signal*Math.cos(TAU*k*n/N);
          im+=signal*Math.sin(TAU*k*n/N);
        }
        return Math.sqrt(re*re+im*im)/N * amp * 0.8 * Math.exp(-z*z*0.3);
      }
    },
    harmonics: {
      name: 'Harmonic Series Sum',
      formula: 'f = Σ aₙsin(nωt+φₙ)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=3+Math.round(comp*8); let v=0;
        for (let n=1; n<=N; n++) v+=Math.sin(n*x*freq*2+n*t*0.4)/(n*n);
        return v * amp * 0.4 * Math.exp(-z*z*0.25);
      }
    },
    stochasticFourier: {
      name: 'Random Phase Fourier',
      formula: 'f = Σ cos(nω₀t+φₙ)/n',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=5+Math.round(comp*10); let v=0;
        for (let n=1; n<=N; n++) {
          // Deterministic "random" phases via LCG
          const phi=((n*2654435761)>>>0)/0xffffffff*TAU;
          v+=Math.cos(n*x*freq*2+t*n*0.3+phi)/n;
        }
        return v * amp * 0.3 * Math.exp(-z*z*0.25);
      }
    },
    fejerKernel: {
      name: 'Fejér Kernel',
      formula: 'F_N(x) = 1/N |sin(Nx/2)/sin(x/2)|²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=2+Math.round(comp*14), xv=x*freq*2+1e-6;
        const v=Math.sin(N*xv/2)/Math.sin(xv/2);
        return v*v/N * amp * 0.06 * Math.exp(-z*z*0.25);
      }
    },
    dirichletKernel: {
      name: 'Dirichlet Kernel',
      formula: 'D_N(x) = Σ_{k=−N}^N e^{ikx} = sin((N+½)x)/sin(x/2)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=2+Math.round(comp*12), xv=x*freq*2+1e-6;
        return Math.sin((N+0.5)*xv)/Math.sin(xv/2) * amp * 0.06 * Math.exp(-z*z*0.25);
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 8 — DIFFERENTIAL EQUATIONS
// ═══════════════════════════════════════════════════════════════════════════════
const DIFFERENTIAL_EQUATIONS = {
  name: 'DIFFERENTIAL EQUATIONS',
  icon: 'dy/dx',
  formulas: {
    simpleHarmonic: {
      name: 'Simple Harmonic Oscillator',
      formula: 'ẍ + ω²x = 0 → x(t)=A cos(ωt+φ)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const omega=1+comp*2;
        return Math.cos(omega*(x*freq+t)) * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    dampedOscillator: {
      name: 'Damped Harmonic Oscillator',
      formula: 'ẍ + 2γẋ + ω₀²x = 0',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const gamma=0.1+comp*0.4, omega=1+comp;
        // FIX(#5, r4): T is the oscillator's own time and the ring dies inside
        // exp(−γT), so on the session clock the surface was flat within two
        // minutes (peak 2·10⁻⁵ against 0.39 at boot). 6 is the shortest period
        // in the catalogue because γ reaches 0.46: it replays a full ring-down
        // and starts the next one; see replayTime.
        const T=x*freq+replayTime(t, 6)*0.5+3.5;
        return Math.exp(-gamma*T)*Math.cos(omega*T) * amp * 0.5 * Math.exp(-z*z*0.25);
      }
    },
    forcedOscillator: {
      name: 'Driven Resonance',
      formula: 'ẍ + 2γẋ + ω₀²x = F cos(ωt)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const omega=0.5+comp*1.5, omega0=1.2, gamma=0.15, F=1;
        const denom=Math.sqrt((omega0**2-omega**2)**2+(2*gamma*omega)**2);
        const A_ss=F/Math.max(denom,0.01);
        return A_ss*Math.cos(omega*(x*freq+t)-Math.atan2(2*gamma*omega,omega0**2-omega**2)) * amp * 0.4 * Math.exp(-z*z*0.25);
      }
    },
    exponentialDecay: {
      name: 'Exponential Decay',
      formula: 'ẋ = −λx → x(t) = x₀e^{−λt}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const lambda=0.3+comp*0.7, T=clamp((x+3.5)/7*8, 0, 8);
        return Math.exp(-lambda*T) * amp * 0.55 * Math.exp(-z*z*0.3);
      }
    },
    logisticGrowth: {
      name: 'Logistic Growth',
      formula: 'ẋ = rx(1−x/K)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const r=1+comp*2, K=1, x0=0.05, T=clamp((x+3.5)/7*8, 0, 8);
        return K/(1+(K/x0-1)*Math.exp(-r*T)) * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    predatorPrey: {
      name: 'Lotka–Volterra',
      formula: 'ẋ=αx−βxy, ẏ=δxy−γy',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const alpha=1, beta=0.1, delta=0.075, gamma=1.5;
        const dt=0.05, steps=Math.round(5+comp*20);
        let px=10+x*freq*5, py=5+z*freq*2;
        for (let i=0; i<steps; i++) {
          const dx=(alpha*px-beta*px*py)*dt, dy=(delta*px*py-gamma*py)*dt;
          px=Math.max(0,px+dx); py=Math.max(0,py+dy);
        }
        return (py-5)*0.04 * amp;
      }
    },
    heatEquation: {
      name: 'Heat Equation (1D)',
      formula: '∂u/∂t = α ∂²u/∂x²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(#5, r4): same defect as heat2D one collection over — the
        // exponential is in the session clock, so the bar cooled to 10⁻⁵ of its
        // boot peak within five minutes and stayed there. 20 replays the
        // cooling to the point where the fundamental is a quarter of its
        // starting height; see replayTime.
        const alpha=0.5+comp*0.5, N=6, tp=replayTime(t, 20); let u=0;
        for (let n=1; n<=N; n++) {
          const bn=(n%2===0)?0:4/(n*Math.PI);
          u+=bn*Math.sin(n*Math.PI*(x*freq+0.5))*Math.exp(-alpha*n*n*Math.PI**2*Math.max(0,tp*0.01));
        }
        return u * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    waveEquation: {
      name: 'Wave Equation (1D)',
      formula: '∂²u/∂t² = c² ∂²u/∂x²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const c=0.5+comp*0.8, N=5; let u=0;
        for (let n=1; n<=N; n++) {
          const bn=(n%2===0)?0:4/(n*Math.PI);
          u+=bn*Math.sin(n*Math.PI*(x*freq+0.5))*Math.cos(n*Math.PI*c*t*0.3);
        }
        return u * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    laplacePDE: {
      name: 'Laplace Equation Solution',
      formula: '∇²u = 0 → u = Re(f(z)) analytic',
      f(x, z, t, {amp=1, freq=1}) {
        // Re(z²) = x²-z² is harmonic
        return ((x*freq)**2-(z*freq)**2) * amp * 0.2;
      }
    },
    eulerMethod: {
      name: 'Euler Method Trajectory',
      formula: 'y_{n+1} = yₙ + h·f(xₙ,yₙ)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const h=0.05, steps=Math.round((x+3.5)/7*50);
        let y=0.1, xi=-3.5;
        for (let i=0; i<steps; i++) {
          const dydx=-y*freq*(1+comp*0.5)+Math.sin(xi*freq);
          y+=dydx*h; xi+=h;
        }
        return y * amp * 0.3 * Math.exp(-z*z*0.3);
      }
    },
    rungeKutta4: {
      name: 'Runge-Kutta RK4',
      formula: 'k₁..k₄ weighted average',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const h=0.1, steps=Math.round((x+3.5)/7*30);
        const F=(xi,y) => -y*freq*(0.5+comp*0.3)+Math.cos(xi+t*0.3);
        let y=0, xi=-3;
        for (let i=0; i<steps; i++) {
          const k1=F(xi,y), k2=F(xi+h/2,y+h*k1/2);
          const k3=F(xi+h/2,y+h*k2/2), k4=F(xi+h,y+h*k3);
          y+=h*(k1+2*k2+2*k3+k4)/6; xi+=h;
        }
        return y * 0.25 * amp * Math.exp(-z*z*0.3);
      }
    },
    beamBending: {
      name: 'Euler–Bernoulli Beam',
      formula: "EI·y'''' = q(x)",
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // Sinusoidally loaded simply-supported beam exact solution
        const L=1, n=Math.round(1+comp*4);
        const q0=1, EI=1;
        const qn=q0*2/L*0.4;
        const xi=clamp((x*freq+3.5)/7, 0, 1);
        return qn*Math.sin(n*Math.PI*xi)/(EI*(n*Math.PI/L)**4) * amp * 3 * Math.exp(-z*z*0.3);
      }
    },
    schrodingerBox: {
      name: 'Particle in a Box',
      formula: 'ψₙ(x) = √(2/L)sin(nπx/L)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*5), L=1;
        const xi=clamp((x*freq+3.5)/7, 0, 1);
        const E=n*n*Math.PI*Math.PI;
        return Math.sqrt(2/L)*Math.sin(n*Math.PI*xi)*Math.cos(E*t*0.01) * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    reynoldsFlow: {
      name: 'Stokes Flow (low Re)',
      formula: 'μ∇²u = ∇p',
      f(x, z, t, {amp=1, freq=1}) {
        // Poiseuille: u = (1−r²), parabolic
        const r2=(z*freq)**2;
        return Math.max(0, 1-r2) * Math.sin(x*freq*0.5+t*0.3) * amp * 0.45;
      }
    },
    fishersEquation: {
      name: "Fisher's Equation (wave front)",
      formula: '∂u/∂t = D∂²u/∂x² + ru(1−u)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const D=0.5, r=1+comp, c_wave=Math.sqrt(4*D*r);
        // FIX(#5, r4): the front travels at c_wave·0.08 per unit of clock and
        // the clock never stops, so it walked off the right edge for good —
        // 5·10⁻⁵ of the boot peak after two minutes. 24 is one crossing of the
        // domain: the front sweeps through and the next one starts from the
        // left, which is what a travelling wave looks like; see replayTime.
        const xi=x*freq-c_wave*replayTime(t, 24)*0.08;
        return 1/(1+Math.exp(-xi*2)) * amp * 0.5 * Math.exp(-z*z*0.25);
      }
    },
    pendulumNonLinear: {
      name: 'Nonlinear Pendulum Phase',
      formula: 'θ̈ + sin(θ) = 0',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // Phase portrait: energy contours
        const theta=x*freq*Math.PI, omega=z*freq*2;
        const H=0.5*omega*omega-Math.cos(theta);
        return Math.sin(H*2+t*0.3) * amp * 0.35;
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 9 — INTEGRAL TRANSFORMS
// ═══════════════════════════════════════════════════════════════════════════════
const INTEGRAL_TRANSFORMS = {
  name: 'INTEGRAL TRANSFORMS',
  icon: '∫̂',
  formulas: {
    fourierTransform: {
      name: 'Fourier Transform (Gaussian)',
      formula: 'F̂[e^{−ax²}] = √(π/a)·e^{−ω²/4a}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=0.5+comp*0.5, omega=x*freq*3;
        return Math.sqrt(Math.PI/a)*Math.exp(-omega*omega/(4*a)) * amp * 0.25 * Math.exp(-z*z*0.3);
      }
    },
    fourierInverse: {
      name: 'Inverse Fourier (Rect)',
      formula: 'F⁻¹[rect(ω)] = sinc(x)',
      f(x, z, t, {amp=1, freq=1}) {
        const r=x*freq*4+1e-9;
        return Math.sin(r)/r * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    laplaceTransform: {
      name: 'Laplace Transform (step)',
      formula: 'L{1}(s) = 1/s',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const s=clamp((x+3.5)/7*5+0.1, 0.1, 5.1);
        return 1/s * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    laplaceDecay: {
      name: 'Laplace of Exponential',
      formula: 'L{e^{−at}}(s) = 1/(s+a)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const s=clamp((x+3.5)/7*5+0.1, 0.1, 5.1), a=0.5+comp*1.5;
        return 1/(s+a) * amp * 0.55 * Math.exp(-z*z*0.3);
      }
    },
    zTransform: {
      name: 'Z-Transform (geometric)',
      formula: 'Z{aⁿ}(z) = z/(z−a)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const zr=(x+3.5)/7*2.5+0.5, zi=z*freq*0.4, a=0.7+comp*0.2;
        const den_r=zr-a, den_i=zi;
        const den2=den_r*den_r+den_i*den_i+1e-9;
        return (zr*den_r+zi*den_i)/den2 * amp * 0.35;
      }
    },
    waveletTransform: {
      name: 'Morlet Wavelet',
      formula: 'ψ(t) = e^{iω₀t}·e^{−t²/2}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const omega0=5+comp*3, tau=z*freq*2, scale=0.5+comp*0.5;
        const xi=(x*freq-tau)/scale;
        return Math.exp(-xi*xi/2)*Math.cos(omega0*xi) * amp * 0.45;
      }
    },
    hilbertTransform: {
      name: 'Hilbert Transform',
      formula: 'H[sin(ωt)] = −cos(ωt)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const omega=1+comp*2;
        const original=Math.sin(omega*(x*freq+t));
        const hilbert=-Math.cos(omega*(x*freq+t));
        return (original+hilbert)*0.5 * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    radonTransform: {
      name: 'Radon Transform (sinogram)',
      formula: 'Rf(ρ,θ) = ∫ f(x,y)δ(x cosθ+y sinθ−ρ)dl',
      f(x, z, t, {amp=1, freq=1, comp=0.5}) {
        // Analytic 2D Radon transform of two Gaussians:
        //   f(x,y) = e^{-3(x²+y²)} + e^{-3((x-c)²+y²)}, where c = comp·1.2 + 0.5
        // Closed form: Rf(ρ,θ) = √(π/3)·[ e^{-3ρ²} + e^{-3(ρ-c·cosθ)²} ]
        // x → ρ axis, z → θ axis; result depends on both.
        const rho   = x * freq * 0.7;
        const theta = z * freq * Math.PI + t * 0.1;
        const c     = 0.5 + comp * 1.2;
        const proj1 = Math.exp(-3 * rho * rho);
        const d2    = rho - c * Math.cos(theta);
        const proj2 = Math.exp(-3 * d2 * d2);
        const norm  = Math.sqrt(Math.PI / 3);
        return (proj1 + proj2) * norm * amp * 0.35;
      }
    },
    hankelTransform: {
      name: 'Hankel Transform',
      formula: 'F_ν(ρ) = ∫₀^∞ f(r)J_ν(ρr)r dr',
      f(x, z, t, {amp=1, freq=1}) {
        const rho=Math.sqrt(x*x+z*z)*freq*2;
        return besselJ0(rho)*Math.exp(-rho*0.3) * amp * 0.55;
      }
    },
    mellinTransform: {
      name: 'Mellin Transform',
      formula: 'M{f}(s) = ∫₀^∞ x^{s−1}f(x)dx',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // Visualize Mellin kernel x^(s-1) for s = complex
        const s=1+comp*2, xv=clamp((x+3.5)/7*4+0.1, 0.1, 4.1);
        return Math.pow(xv, s-1)*Math.exp(-xv) * amp * 0.35 * Math.exp(-z*z*0.3);
      }
    },
    stieltjesTransform: {
      name: 'Stieltjes Transform',
      formula: 'Sf(z) = ∫₀^∞ f(t)/(z+t) dt',
      f(x, z, t, {amp=1, freq=1}) {
        const zv=clamp((x+3.5)/7*4+0.5, 0.5, 4.5);
        const N=20; let sum=0;
        for (let i=0; i<N; i++) {
          const tv=(i+0.5)*5/N;
          sum+=Math.exp(-tv)/(zv+tv)*5/N;
        }
        return sum * amp * 0.4 * Math.exp(-z*z*0.3);
      }
    },
    cauchyIntegral: {
      name: 'Cauchy Integral Formula',
      formula: 'f(z₀) = 1/(2πi)∮ f(z)/(z−z₀) dz',
      f(x, z, t, {amp=1, freq=1, comp=0.5}) {
        // Numerical evaluation of Cauchy's formula with f(z) = z² + c
        // (c = comp · 0.3), contour = circle of radius R = 2 around origin.
        // By Cauchy's theorem:
        //   z₀ inside  → integral equals f(z₀) = z₀² + c
        //   z₀ outside → integral is 0
        // Visualization shows the real part of the numerical result.
        const z0re = x * freq * 0.5;
        const z0im = z * freq * 0.5;
        const R = 2.0, c = comp * 0.3;
        const N = 48;
        let realSum = 0, imagSum = 0;
        for (let k = 0; k < N; k++) {
          const phi = (k + 0.5) * (2 * Math.PI / N) + t * 0.1;
          const zRe = R * Math.cos(phi), zIm = R * Math.sin(phi);
          // f(z) = z² + c
          const fRe = zRe*zRe - zIm*zIm + c;
          const fIm = 2 * zRe * zIm;
          // dz = i·R·e^(iφ)·dφ  → dz_re = -R·sin·dφ, dz_im = R·cos·dφ
          const dzRe = -R * Math.sin(phi) * (2*Math.PI/N);
          const dzIm =  R * Math.cos(phi) * (2*Math.PI/N);
          // (z - z₀)
          const drRe = zRe - z0re, drIm = zIm - z0im;
          const drMag2 = drRe*drRe + drIm*drIm;
          // f(z)/(z-z₀) = (fRe+i fIm)·(drRe-i drIm)/|drDelta|²
          const qRe = (fRe*drRe + fIm*drIm) / drMag2;
          const qIm = (fIm*drRe - fRe*drIm) / drMag2;
          // Multiply by dz: (qRe + i·qIm)·(dzRe + i·dzIm)
          realSum += qRe*dzRe - qIm*dzIm;
          imagSum += qRe*dzIm + qIm*dzRe;
        }
        // Divide by 2πi: divide by 2π and rotate by -π/2 (multiply by -i)
        const inv2pi = 1 / (2 * Math.PI);
        const result_re = imagSum * inv2pi;   // Re(sum / (2πi))
        return result_re * amp * 0.4;
      }
    },
    stocksFormula: {
      name: 'Green\'s Theorem Flow',
      formula: '∮ P dx+Q dy = ∬(∂Q/∂x−∂P/∂y)dA',
      f(x, z, t, {amp=1, freq=1}) {
        // Curl of F = (-y,x) → constant 2
        const dQdx=-Math.sin(x*freq)*Math.cos(z*freq)*freq;
        const dPdz= Math.cos(x*freq)*Math.sin(z*freq)*freq;
        return (dQdx-dPdz) * amp * 0.3;
      }
    },
    poissonIntegral: {
      name: 'Poisson Integral Formula',
      formula: 'u(r,θ) = 1/(2π) ∫ f(φ)(1−r²)/(1−2r cos(θ−φ)+r²)dφ',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.min(0.95, Math.sqrt(x*x+z*z)*freq*0.4), theta=Math.atan2(z,x);
        const N=16; let sum=0;
        for (let k=0; k<N; k++) {
          const phi=TAU*k/N;
          const f_phi=Math.cos(3*phi+t*0.3);
          sum+=f_phi*(1-r*r)/(1-2*r*Math.cos(theta-phi)+r*r);
        }
        return sum/N * amp * 0.35;
      }
    },
    continuousWavelet: {
      name: 'CWT Scalogram',
      formula: 'W(a,b) = 1/√a ∫ f(t)ψ*((t−b)/a)dt',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const b=x*freq, a=0.1+clamp((z+3.5)/7, 0, 1)*2;
        let v=0; const N=20;
        for (let i=0; i<N; i++) {
          const tau=-3+i*6/N;
          const signal=Math.sin(tau*(2+comp)*2+t);
          const xi=(tau-b)/a;
          const psi=Math.exp(-xi*xi/2)*Math.cos(5*xi);
          v+=signal*psi*6/N;
        }
        return v/Math.sqrt(a) * amp * 0.15;
      }
    },
    fourierSlice: {
      name: 'Fourier Slice Theorem',
      formula: 'Projection ↔ Slice of 2D FT',
      f(x, z, t, {amp=1, freq=1}) {
        const angle=z*0.5+t*0.3;
        const proj=Math.sin(Math.cos(angle)*x*freq*4+Math.sin(angle)*0.5);
        return proj * amp * 0.45;
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 10 — TOPOLOGY & GEOMETRY
// ═══════════════════════════════════════════════════════════════════════════════
const TOPOLOGY_GEOMETRY = {
  name: 'TOPOLOGY & GEOMETRY',
  icon: '∞',
  formulas: {
    mobiusStrip: {
      name: 'Möbius Strip Height',
      formula: 'r(u,v)=((1+v/2 cos(u/2))cos u, …)',
      f(x, z, t, {amp=1, freq=1}) {
        const u=Math.atan2(z*freq,x*freq), r=Math.sqrt(x*x+z*z)*freq;
        const v=clamp((r-0.6)*3, -1, 1);
        return v*Math.cos(u/2+t*0.3) * amp * 0.5;
      }
    },
    kleinBottle: {
      name: "Klein Bottle Cross-Section",
      formula: 'Immersion in ℝ³ — self-intersecting surface',
      f(x, z, t, {amp=1, freq=1}) {
        const u=x*freq*Math.PI, v=z*freq*Math.PI;
        // Figure-8 Klein cross-section
        const y=(1-Math.cos(u)/2)*Math.sin(v)-(Math.sin(u)/2)*Math.sin(2*v+t*0.2);
        return y * amp * 0.4;
      }
    },
    torusKnot: {
      name: 'Torus Knot Height Field',
      formula: 'K(p,q): p winds toroidally, q poloidally',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const p=2, q=3+Math.round(comp*2);
        const theta=Math.atan2(z*freq,x*freq);
        const r=Math.sqrt(x*x+z*z)*freq;
        return Math.sin(p*theta-q*r*2+t*0.4) * amp * 0.4 * Math.exp(-((r-0.8)**2)*5);
      }
    },
    boysSurface: {
      name: "Boy's Surface Slice",
      formula: 'RP² immersed in ℝ³',
      f(x, z, t, {amp=1, freq=1}) {
        const u=x*freq*2, v=z*freq*2;
        const y=(Math.sin(u)*Math.cos(v/2)+Math.sin(2*u)*Math.cos(v/2)**2)*0.4;
        return y * amp * (1+Math.sin(t*0.3)*0.15);
      }
    },
    romanSurface: {
      name: "Steiner's Roman Surface",
      formula: 'x²y²+y²z²+z²x² = r²xyz',
      f(x, z, t, {amp=1, freq=1}) {
        const a=1.5;
        const xv=x*freq, zv=z*freq;
        // y from implicit: x²y²+y²z²+z²x²=xyz·r², solve numerically (approx y=xz/2a)
        const yv=(xv*zv)/(2*a+Math.abs(xv)+Math.abs(zv)+1e-9);
        return yv * amp * (1+Math.sin(t*0.3)*0.2);
      }
    },
    enneperSurface: {
      name: 'Enneper Surface',
      formula: 'x=u−u³/3+uv², y=v−v³/3+vu², z=u²−v²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const u=x*freq*0.8, v=z*freq*0.8;
        return (u*u-v*v) * amp * 0.2 * (1+Math.sin(t*0.3)*comp*0.3);
      }
    },
    scherkSurface: {
      name: 'Scherk Minimal Surface',
      formula: 'e^z cos y = cos x',
      f(x, z, t, {amp=1, freq=1}) {
        const cx=Math.cos(x*freq*2), cz=Math.cos(z*freq*2+t*0.2);
        if (Math.abs(cx)<1e-3||Math.abs(cz)<1e-3) return 0;
        return clamp(Math.log(Math.abs(cx/cz))*0.25*amp,-0.7,0.7);
      }
    },
    catenoid: {
      name: 'Catenoid (Minimal)',
      formula: 'r = a·cosh(z/a)',
      // FIX: exact, and unwatchable over most of the slider. cosh(2·z·freq)
      // with |z| ≤ 3.5 leaves a frame about 3 units high almost immediately:
      // measured peak |y| is 6.2·10⁻¹ at freq = 0.3 (the slider minimum),
      // 8.2·10¹ at freq = 1 (its default), 3.3·10⁹ at freq = 3.5 (its maximum)
      // and 5.1·10¹² at the 4.55 that treble can push it to. The value stays
      // finite, so the isFinite guard in generateSurfaceFromFormula passes it
      // straight through to the mesh. This is the one defect class the accuracy
      // audit could not see, because the mathematics is right — the entry is
      // correctly rated A and was never worth a second look.
      //
      // The clamp leaves the catenoid itself untouched: the neck, and the whole
      // neighbourhood of the zero level set where the surface is legible, sit
      // well inside ±1.5. Only the far field — which was never on screen anyway,
      // just dragging the camera framing with it — saturates. At z = 0 the value
      // is 0.15 exactly, as before.
      f(x, z, t, {amp=1, freq=1}) {
        const a=0.5, Z=z*freq;
        const r=a*Math.cosh(Z/a), rxy=Math.sqrt(x*x)*freq;
        return clamp((r-rxy) * amp * 0.3, -1.5, 1.5);
      }
    },
    helicoid: {
      name: 'Helicoid',
      formula: 'x=r cos θ, y=cθ, z=r sin θ',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(#6, r4): the height used to be c·(theta + t·0.3). theta is bounded
        // to (−π, π] but the session clock is not, so the term was a pure
        // unbounded translation of the whole mesh: y ≈ 8 after ten minutes and
        // 24 after thirty, against a framed volume about 3 units high, with
        // nothing downstream clamping it. Rotating the azimuth instead — fold
        // theta + t·0.3 back into (−π, π] — makes the helicoid spin about its
        // axis, which is what the surface actually does, and keeps the height
        // inside the c·(−π, π] it is supposed to span. The fold keeps atan2's
        // own half-open convention, so the seam stays exactly where atan2
        // already puts it and t = 0 is bit-identical to the old code.
        const theta=Math.atan2(z*freq,x*freq), c=0.3+comp*0.3;
        return c*wrapAzimuth(theta+t*0.3) * amp * 0.25;
      }
    },
    hyperbolicParaboloid: {
      name: 'Hyperbolic Paraboloid',
      formula: 'z = x²/a² − y²/b²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=1+comp*0.5, b=1+comp*0.3;
        return ((x*freq)**2/a - (z*freq)**2/b) * amp * 0.25;
      }
    },
    torusSection: {
      name: 'Torus Cross Section',
      formula: '(√(x²+z²)−R)² + y² = r²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const R=1.5, r=0.5+comp*0.3;
        const dist=Math.sqrt(x*x+z*z)*freq-R;
        return Math.sqrt(Math.max(0, r*r-dist*dist)) * amp * 0.5 * Math.sign(x+z);
      }
    },
    breatherSurface: {
      name: 'Breather Surface',
      formula: 'Pseudospherical surface (kink soliton)',
      f(x, z, t, {amp=1, freq=1}) {
        const a=0.4, T=x*freq*1.5, P=z*freq*1.5+t*0.3;
        const denom=a*(1-a*a)*Math.cosh(a*T)**2+a*Math.sin(Math.sqrt(1-a*a)*P)**2;
        return clamp((-1+2*(1-a*a)*Math.cosh(a*T)**2/denom)*0.3*amp,-0.6,0.6);
      }
    },
    pseudosphere: {
      name: 'Pseudosphere (Tractricoid)',
      formula: 'Negative Gaussian curvature',
      f(x, z, t, {amp=1, freq=1}) {
        // Tractricoid parametrization is defined only for T ∈ (0, π) —
        // outside that range tan(T/2) goes negative and log() returns NaN.
        // Clamp slightly inside the asymptotes to keep the surface finite.
        const T=clamp(Math.sqrt(x*x+z*z)*freq, 0.01, Math.PI - 0.01);
        const theta=Math.atan2(z, x);
        return (Math.log(Math.tan(T/2))+1/Math.cosh(T)) * amp * 0.2;
      }
    },
    crossCap: {
      name: 'Cross-Cap (RP²)',
      formula: 'Hemi-sphere with antipodal gluing',
      f(x, z, t, {amp=1, freq=1}) {
        const u=x*freq, v=z*freq;
        return u*v * amp * 0.3 * (1+Math.sin(t*0.3)*0.2);
      }
    },
    alexanderHorned: {
      name: 'Alexander Horned (approximation)',
      formula: 'Wild embedding S²→ℝ³',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let px=x*freq, pz=z*freq;
        const depth=2+Math.round(comp*3);
        for (let d=0; d<depth; d++) {
          const theta=Math.atan2(pz, px), r=Math.sqrt(px*px+pz*pz);
          const fork=Math.round(theta/Math.PI)*Math.PI;
          px=(r-0.5)*Math.cos(2*theta-fork+t*0.05*d);
          pz=(r-0.5)*Math.sin(2*theta-fork+t*0.05*d);
        }
        return Math.sin(Math.sqrt(px*px+pz*pz)*5) * amp * 0.3;
      }
    },
    hopfFibration: {
      name: 'Hopf Fibration Projection',
      formula: 'S³ → S², fiber = S¹',
      f(x, z, t, {amp=1, freq=1}) {
        const theta=Math.atan2(z*freq, x*freq), r=Math.sqrt(x*x+z*z)*freq;
        // Visualize as phase-coupled circles
        return Math.sin(2*theta+r*4-t*0.5) * amp * 0.4 * Math.exp(-((r-1)**2)*4);
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 11 — CELLULAR AUTOMATA
// ═══════════════════════════════════════════════════════════════════════════════
const CELLULAR_AUTOMATA = {
  name: 'CELLULAR AUTOMATA',
  icon: '⬛',
  formulas: {
    rule30: {
      name: 'Rule 30 (Wolfram)',
      formula: '000→0,001→1,010→1,011→1,100→1,101→0,110→0,111→0',
      f(x, z, t, {amp=1}) { return cellularRule(30, x, z, t) * amp; }
    },
    rule90: {
      name: 'Rule 90 (XOR / Sierpiński)',
      formula: '∑ neighbors mod 2',
      f(x, z, t, {amp=1}) { return cellularRule(90, x, z, t) * amp; }
    },
    rule110: {
      name: 'Rule 110 (Turing complete)',
      formula: 'Universal computation',
      f(x, z, t, {amp=1}) { return cellularRule(110, x, z, t) * amp; }
    },
    rule184: {
      name: 'Rule 184 (Traffic model)',
      formula: 'CA model for 1D traffic flow',
      f(x, z, t, {amp=1}) { return cellularRule(184, x, z, t) * amp; }
    },
    gameOfLifeDensity: {
      name: "Game of Life (density)",
      formula: 'B3/S23 — birth if 3 nb, survive if 2-3',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const W = res, H = res;
        const gen = Math.round(t * comp * 2) % 30;
        let grid = new Uint8Array(W * H);
        // Seed glider pattern (centered for any res)
        const glider = [[0,1],[1,2],[2,0],[2,1],[2,2]];
        const offset = Math.floor((W - 4) / 2);
        for (const [gr, gc] of glider) {
          const rr = (gr + offset + H) % H;
          const cc = (gc + offset + W) % W;
          grid[rr * W + cc] = 1;
        }
        // Extra chaos seed
        for (let i = 0; i < W * H; i++) if (((i * 2654435761) >>> 0) % 100 < 8 + comp * 8) grid[i] = 1;
        for (let g = 0; g < gen; g++) {
          const next = new Uint8Array(W * H);
          for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
            let nb = 0;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              nb += grid[((r + dr + H) % H) * W + ((c + dc + W) % W)];
            }
            const alive = grid[r * W + c];
            next[r * W + c] = (alive && (nb === 2 || nb === 3)) || (!alive && nb === 3) ? 1 : 0;
          }
          grid = next;
        }
        const heights = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          heights[i] = grid[i] * amp * 0.45;
        }
        return heights;
      }, 48),
    },
    briansBrain: {
      name: "Brian's Brain",
      formula: '3-state: ON→DYING→OFF→(2 nb ON)→ON',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const W = res, H = res;
        const gen = Math.round(t * comp * 2) % 20;
        let grid = new Uint8Array(W * H);
        // FIX(#0, r4): the seed used to be ((i·1664525 + 1013904223) >>> 0) % 3
        // over the row-major index, which lays the repeating stripe 1,0,2,1,0,2…
        // along every row. The grid is 48 wide and 48 is a multiple of 3, so the
        // stripe lines up column for column between neighbouring rows and every
        // OFF cell ends up with exactly 3 ON neighbours — 4 on the rows where
        // the 32-bit wrap shifts the phase — and never the 2 the birth rule
        // needs. Generation 1 therefore produced zero births, generation 2 was
        // an empty board, and the mesh was a dead-flat plate for 18 of its 20
        // phases: the only entry in the catalogue that ignored AMPLITUDE.
        // Mixing the row and the column through different large odd multipliers
        // breaks that alignment, and the census then behaves like the soup
        // Brian's Brain is meant to be run from — 1506 live cells at generation
        // 0 settling to ~130 gliders by generation 19.
        for (let i = 0; i < W * H; i++) {
          const r = (i / W) | 0, c = i % W;
          grid[i] = (((r * 73856093) ^ (c * 19349663)) >>> 0) % 3;
        }
        for (let g = 0; g < gen; g++) {
          const next = new Uint8Array(W * H);
          for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
            const s = grid[r * W + c];
            if (s === 1) { next[r * W + c] = 2; continue; }
            if (s === 2) { next[r * W + c] = 0; continue; }
            let nb = 0;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              if (grid[((r + dr + H) % H) * W + ((c + dc + W) % W)] === 1) nb++;
            }
            next[r * W + c] = nb === 2 ? 1 : 0;
          }
          grid = next;
        }
        const heights = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          heights[i] = (grid[i] / 2) * amp * 0.45;
        }
        return heights;
      }, 48),
    },
    langtonAnt: {
      name: "Langton's Ant (trajectory density)",
      formula: 'Turn R on white, L on black; flip',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const W = res, H = res;
        const steps = 500 + Math.round(comp * 500);
        const grid = new Uint8Array(W * H);
        let ar = H / 2 | 0, ac = W / 2 | 0, dir = 0;
        const dr = [-1, 0, 1, 0], dc = [0, 1, 0, -1];
        for (let i = 0; i < steps; i++) {
          const idx = ar * W + ac;
          dir = (grid[idx] === 0) ? (dir + 1) % 4 : (dir + 3) % 4;
          grid[idx] ^= 1;
          ar = (ar + dr[dir] + H) % H; ac = (ac + dc[dir] + W) % W;
        }
        const heights = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          heights[i] = grid[i] * amp * 0.4;
        }
        return heights;
      }, 64),
    },
    cyclicCA: {
      name: 'Cyclic CA',
      formula: 'Cell advances if any nb = (state+1) mod N',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const W = res, H = res;
        const N = 4 + Math.round(comp * 4);
        const gen = Math.round(t * 0.5) % 15;
        let grid = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) grid[i] = ((i * 2246822519) >>> 0) % N;
        for (let g = 0; g < gen; g++) {
          const next = new Uint8Array(grid);
          for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
            const s = grid[r * W + c], ns = (s + 1) % N;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              if (grid[((r + dr + H) % H) * W + ((c + dc + W) % W)] === ns) {
                next[r * W + c] = ns; break;
              }
            }
          }
          grid = next;
        }
        const heights = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          heights[i] = (grid[i] / N) * amp * 0.45;
        }
        return heights;
      }, 48),
    },
    wiredFire: {
      name: 'Wireworld (wire / fire)',
      formula: 'Electron head→tail→wire→head if 1-2 nb heads',
      f: createCachedHeavySampler((t, {amp = 1}, res) => {
        const W = res, H = res;
        const grid = new Uint8Array(W * H);
        // Wire loop (scaled pattern for general res; original for ~50)
        const margin = Math.floor(W * 0.1);
        const top = Math.floor(H * 0.4);
        const bottom = Math.floor(H * 0.6);
        for (let i = margin; i < W - margin; i++) {
          grid[top * W + i] = 1;
          grid[bottom * W + i] = 1;
        }
        for (let i = top; i <= bottom; i++) {
          grid[i * W + margin] = 1;
          grid[i * W + (W - margin - 1)] = 1;
        }
        // Initial electron
        grid[top * W + margin + 1] = 2;
        grid[top * W + margin + 2] = 3;
        const gen = Math.round(t * 2) % 80;
        let g = new Uint8Array(grid);
        for (let step = 0; step < gen; step++) {
          const next = new Uint8Array(W * H);
          for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
            const s = g[r * W + c];
            if (s === 0) next[r * W + c] = 0;
            else if (s === 2) next[r * W + c] = 3;
            else if (s === 3) next[r * W + c] = 1;
            else { // wire=1
              let heads = 0;
              for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                if (g[((r + dr + H) % H) * W + ((c + dc + W) % W)] === 2) heads++;
              }
              next[r * W + c] = (heads === 1 || heads === 2) ? 2 : 1;
            }
          }
          g = next;
        }
        const heights = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          heights[i] = (g[i] / 3) * amp * 0.45;
        }
        return heights;
      }, 50),
    },
    sandpile: {
      name: 'Abelian Sandpile',
      formula: 'Topple if height ≥ 4 → distribute to neighbors',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const W = res, H = res;
        const grid = new Int32Array(W * H);
        const cx = W / 2 | 0, cz = H / 2 | 0;
        const grains = 200 + Math.round(comp * 400);
        grid[cz * W + cx] = grains;
        for (let iter = 0; iter < grains; iter++) {
          for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
            if (grid[r * W + c] >= 4) {
              grid[r * W + c] -= 4;
              grid[(r - 1) * W + c]++;
              grid[(r + 1) * W + c]++;
              grid[r * W + (c - 1)]++;
              grid[r * W + (c + 1)]++;
            }
          }
        }
        const heights = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          heights[i] = clamp(grid[i] * 0.08, 0, 0.6) * amp;
        }
        return heights;
      }, 40),
    },
    voronoiCA: {
      name: 'Voronoi Growth CA',
      formula: 'Nearest seed wins cell',
      f(x, z, t, {amp=1, comp=1}) {
        const N=5+Math.round(comp*8);
        const seeds=[];
        for (let i=0; i<N; i++) {
          seeds.push({
            x: Math.sin(i*2.4+t*0.2)*3,
            z: Math.cos(i*1.7+t*0.15)*3,
            v: (i/N)*0.7
          });
        }
        let best=Infinity, bv=0;
        for (const s of seeds) {
          const d=Math.sqrt((x*1-s.x)**2+(z*1-s.z)**2);
          if (d<best) { best=d; bv=s.v; }
        }
        return bv * amp;
      }
    },
    excitableMedia: {
      name: 'Excitable Medium (FitzHugh-Nagumo)',
      formula: '∂u/∂t = D∇²u + u(1−u)(u−a) − v;  ∂v/∂t = ε(u − γv)',
      // Full FitzHugh-Nagumo simulation on a 64² grid with explicit Euler.
      // Spiral waves emerge from a broken-front initial configuration.
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const N = 64;
        const D = 0.0001, dt = 0.1, dx2 = (1.0/N)**2;
        const a = 0.1, eps = 0.01, gamma = 0.5;
        // FIX(#28): no state survives between calls — u and v are freshly
        // allocated and re-seeded from the same broken front on every
        // invocation, so each recompute restarts the medium from scratch
        // rather than continuing the previous one. (The comment here used
        // to claim persistent state re-seeded when t went backwards.)
        let u = new Float32Array(N*N), v = new Float32Array(N*N);
        // Initial: broken front to seed spiral
        for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
          u[r*N+c] = (r < N/2) ? 1 : 0;
          v[r*N+c] = (c > N/2 && r > N/3 && r < 2*N/3) ? 0.3 : 0;
        }
        // FIX(#28): the iteration count depends on comp, not on t — the
        // integration always runs the same 60-120 Euler steps from the same
        // initial condition, so t alone does not advance the system. What t
        // controls is when the wrapper recomputes (see
        // createCachedHeavySampler); animation here comes from comp moving
        // with the audio.
        const iters = 60 + Math.round(comp*60);
        let un = new Float32Array(N*N), vn = new Float32Array(N*N);
        for (let it=0; it<iters; it++) {
          for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
            const idx = r*N + c;
            // Periodic Laplacian
            const rp = (r+1) % N, rm = (r-1+N) % N;
            const cp = (c+1) % N, cm = (c-1+N) % N;
            const lap = (u[rp*N+c]+u[rm*N+c]+u[r*N+cp]+u[r*N+cm] - 4*u[idx]) / dx2;
            un[idx] = u[idx] + dt * (D*lap + u[idx]*(1-u[idx])*(u[idx]-a) - v[idx]);
            vn[idx] = v[idx] + dt * eps * (u[idx] - gamma*v[idx]);
          }
          // Double-buffer swap
          const tu = u; u = un; un = tu;
          const tv = v; v = vn; vn = tv;
        }
        // Output u-field, sampled into res×res
        const out = new Float32Array(res * res);
        for (let r=0; r<res; r++) for (let c=0; c<res; c++) {
          const ri = Math.floor(r / res * N);
          const ci = Math.floor(c / res * N);
          out[r*res + c] = clamp(u[ri*N+ci], 0, 1) * amp * 0.5;
        }
        return out;
      }, 64),
    },
    reactionDiffusion: {
      name: 'Gray-Scott Pattern',
      formula: '∂u/∂t = Du∇²u − uv² + F(1−u);  ∂v/∂t = Dv∇²v + uv² − (F+k)v',
      // Gray-Scott reaction-diffusion on a 64² grid. The (F, k) parameter
      // space produces self-replicating spots, stripes, mitosis, holes —
      // `comp` traverses a slice of this regime.
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const N = 64;
        const Du = 0.16, Dv = 0.08, dt = 1.0;
        // F and k control regime: spots, stripes, mitosis, holes, etc.
        const F = 0.025 + comp*0.035;          // [0.025, 0.060]
        const k = 0.052 + (1-comp)*0.010;      // [0.052, 0.062]
        let u = new Float32Array(N*N), v = new Float32Array(N*N);
        // Initial: u=1 everywhere, v=0 except small patch at center
        u.fill(1); v.fill(0);
        for (let r=N/2-3; r<N/2+3; r++) for (let c=N/2-3; c<N/2+3; c++) {
          u[r*N+c] = 0.5; v[r*N+c] = 0.25;
        }
        const iters = 40 + Math.round(comp*40);
        const un = new Float32Array(N*N), vn = new Float32Array(N*N);
        for (let it=0; it<iters; it++) {
          for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
            const idx = r*N + c;
            const rp = (r+1) % N, rm = (r-1+N) % N;
            const cp = (c+1) % N, cm = (c-1+N) % N;
            const lapU = u[rp*N+c]+u[rm*N+c]+u[r*N+cp]+u[r*N+cm] - 4*u[idx];
            const lapV = v[rp*N+c]+v[rm*N+c]+v[r*N+cp]+v[r*N+cm] - 4*v[idx];
            const uvv = u[idx] * v[idx] * v[idx];
            un[idx] = u[idx] + dt * (Du*lapU - uvv + F*(1 - u[idx]));
            vn[idx] = v[idx] + dt * (Dv*lapV + uvv - (F+k)*v[idx]);
          }
          u.set(un); v.set(vn);
        }
        // Output v-field (the "pattern")
        const out = new Float32Array(res * res);
        for (let r=0; r<res; r++) for (let c=0; c<res; c++) {
          const ri = Math.floor(r / res * N);
          const ci = Math.floor(c / res * N);
          out[r*res + c] = clamp(v[ri*N+ci] * 4, 0, 1) * amp * 0.5;
        }
        return out;
      }, 64),
    },
    forestFire: {
      name: 'Forest Fire CA',
      formula: 'Tree→Fire if nb burning; Fire→Ash; Ash→Tree (p)',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const W = res, H = res;
        const gen = Math.round(t * comp) % 30;
        let grid = new Uint8Array(W * H); // 0=ash,1=tree,2=fire
        const lcg = (s) => ((s * 1664525 + 1013904223) >>> 0);
        let seed = 42;
        for (let i = 0; i < W * H; i++) { seed = lcg(seed); grid[i] = seed % 100 < 60 ? 1 : 0; }
        for (let i = 0; i < 3; i++) { const p = lcg(i * 7) * W * H >>> 0; grid[p % (W * H)] = 2; }
        for (let g = 0; g < gen; g++) {
          const next = new Uint8Array(W * H);
          for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
            const s = grid[r * W + c];
            if (s === 2) { next[r * W + c] = 0; continue; }
            if (s === 0) { seed = lcg(seed); next[r * W + c] = seed % 100 < 5 ? 1 : 0; continue; }
            let hasFire = false;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              if (grid[((r + dr + H) % H) * W + ((c + dc + W) % W)] === 2) hasFire = true;
            }
            seed = lcg(seed);
            next[r * W + c] = hasFire || (seed % 1000 < 2) ? 2 : 1;
          }
          grid = next;
        }
        const heights = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          heights[i] = (grid[i] / 2) * amp * 0.45;
        }
        return heights;
      }, 50),
    },
    conway3D: {
      name: 'Conway 3D Rule (slice)',
      formula: 'B5-7/S6 — 3D Game of Life rule, mid-y slice',
      // Full 3D B5-7/S6 simulation on an 18³ grid; returns the y=mid slice.
      // Initial configuration is hash-seeded (~30% density), then 3-5
      // generations are evolved.
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const N = 18;                        // 18³ = 5832 cells
        const idx = (xi, yi, zi) => ((xi+N)%N)*N*N + ((yi+N)%N)*N + ((zi+N)%N);
        let grid = new Uint8Array(N*N*N);
        // Seed: hash-based density ~30%
        const seed0 = Math.floor(t*2);
        for (let xi=0; xi<N; xi++) for (let yi=0; yi<N; yi++) for (let zi=0; zi<N; zi++) {
          const h = (xi*73856093 ^ yi*19349663 ^ zi*83492791 ^ seed0*2654435761) >>> 0;
          grid[idx(xi,yi,zi)] = (h & 0xff) < 76 ? 1 : 0;  // ~30%
        }
        // Run 3-5 generations of B5-7/S6
        const generations = 3 + Math.round(comp*2);
        let next = new Uint8Array(N*N*N);
        for (let g=0; g<generations; g++) {
          for (let xi=0; xi<N; xi++) for (let yi=0; yi<N; yi++) for (let zi=0; zi<N; zi++) {
            // Count Moore neighbors (26 in 3D)
            let n = 0;
            for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
              if (dx===0 && dy===0 && dz===0) continue;
              n += grid[idx(xi+dx, yi+dy, zi+dz)];
            }
            const cur = grid[idx(xi,yi,zi)];
            // B5-7/S6: born if n∈{5,6,7}, survives if n=6
            next[idx(xi,yi,zi)] = cur ? (n===6 ? 1 : 0) : ((n>=5 && n<=7) ? 1 : 0);
          }
          [grid, next] = [next, grid];
        }
        // Extract y=mid slice into res×res output (with bilinear upsampling)
        const out = new Float32Array(res * res);
        const yMid = (N/2)|0;
        for (let r=0; r<res; r++) for (let c=0; c<res; c++) {
          const xi = Math.floor(c / res * N);
          const zi = Math.floor(r / res * N);
          // Average mid-y slice with one above and below for smoother visual
          let v = grid[idx(xi, yMid, zi)] + grid[idx(xi, yMid-1, zi)] + grid[idx(xi, yMid+1, zi)];
          out[r*res + c] = (v / 3) * amp * 0.6;
        }
        return out;
      }, 64),
    },
    turmite: {
      name: 'Turmite (2D Turing machine)',
      formula: '2-state 2-color 2D Langton variant',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const W = res, H = res;
        const steps = 300 + Math.round(comp * 400);
        const grid = new Uint8Array(W * H);
        let r = H / 2 | 0, c = W / 2 | 0, dir = 0, state = 0;
        const dr = [-1, 0, 1, 0], dc = [0, 1, 0, -1];
        // Rule: {cell,state} → {newCell, newState, turn}
        // 0,0→1,0,R  0,1→1,1,L  1,0→0,0,R  1,1→0,1,N
        for (let i = 0; i < steps; i++) {
          const idx = r * W + c, cell = grid[idx];
          let turn;
          if (cell === 0 && state === 0) { grid[idx] = 1; state = 0; turn = 1; }
          else if (cell === 0 && state === 1) { grid[idx] = 1; state = 1; turn = -1; }
          else if (cell === 1 && state === 0) { grid[idx] = 0; state = 0; turn = 1; }
          else { grid[idx] = 0; state = 1; turn = 0; }
          dir = (dir + turn + 4) % 4;
          r = (r + dr[dir] + H) % H; c = (c + dc[dir] + W) % W;
        }
        const heights = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          heights[i] = grid[i] * amp * 0.4;
        }
        return heights;
      }, 56),
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTION 12 — QUANTUM MECHANICS
// ═══════════════════════════════════════════════════════════════════════════════
const QUANTUM_MECHANICS = {
  name: 'QUANTUM MECHANICS',
  icon: 'ψ',
  formulas: {
    particleBox1D: {
      name: 'Particle in 1D Box |ψ_n|²',
      formula: '|ψ_n|² = 2/L sin²(nπx/L)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*5), L=1, xi=clamp((x*freq+3.5)/7, 0, 1);
        const E=n*n; const psi=Math.sqrt(2/L)*Math.sin(n*Math.PI*xi);
        return psi*psi * amp * 0.5 * Math.exp(-z*z*0.3) * (0.8+Math.cos(E*t*0.015)*0.2);
      }
    },
    harmonicOscillator: {
      name: 'QM Harmonic Oscillator |ψ_n|²',
      formula: 'ψ_n = H_n(x)e^{−x²/2}/√(2ⁿn!√π)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(comp*6), xv=x*freq*2;
        // Hermite via recurrence
        let Hm=1, H=2*xv;
        for (let k=1; k<n; k++) { const tmp=2*xv*H-2*k*Hm; Hm=H; H=tmp; }
        const H_n = n===0 ? 1 : H;
        const psi=H_n*Math.exp(-xv*xv/2);
        return psi*psi * 0.003 * amp * Math.exp(-z*z*0.3) * (0.8+Math.cos(n*t*0.02)*0.2);
      }
    },
    hydrogenS: {
      name: 'Hydrogen 1s |ψ|²',
      formula: '|ψ₁₀₀|² = 1/π·e^{−2r}',
      f(x, z, t, {amp=1, freq=1}) {
        return hydrogenPsi(1, 0, x*freq, z*freq, t) * amp * 2;
      }
    },
    hydrogen2p: {
      name: 'Hydrogen 2p |ψ|²',
      formula: '|ψ₂₁₀|² ∝ r²e^{−r}cos²θ',
      f(x, z, t, {amp=1, freq=1}) {
        return hydrogenPsi(2, 1, x*freq*0.5, z*freq*0.5, t) * amp * 4;
      }
    },
    tunneling: {
      name: 'Quantum Tunneling',
      formula: 'T = e^{−2κL}, κ=√(2m(V₀−E))/ħ',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const kappa=1+comp*2;
        const xi=x*freq;
        let psi;
        if (xi < -0.5) psi=Math.cos(freq*xi*4+t);
        else if (xi > 0.5) psi=Math.exp(-kappa*0.5)*Math.cos(freq*xi*4+t);
        else psi=Math.exp(-kappa*Math.abs(xi))*0.7;
        return psi * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    wavePacket: {
      name: 'Gaussian Wave Packet',
      formula: 'ψ(x,t)=e^{−(x−vt)²/4σ²}e^{i(kx−ωt)}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const k=3+comp*3, v=0.5+comp*0.3, sigma=0.5;
        // FIX(#5, r4): the packet centre is at v·t·0.3, so on the session clock
        // it left the domain about twenty seconds in and the mesh was exactly
        // zero from there on — the worst of the seven. 16 carries the packet
        // from the middle to the right edge and starts it over; the carrier
        // phase replays with it so the wave stays continuous. See replayTime.
        const tp=replayTime(t, 16);
        const xt=x*freq-v*tp*0.3;
        const envelope=Math.exp(-xt*xt/(4*sigma*sigma));
        const psi=envelope*Math.cos(k*x*freq-k*k*tp*0.05);
        return psi*psi * amp * 0.5 * Math.exp(-z*z*0.25);
      }
    },
    spinorVisualization: {
      name: 'Spinor / Bloch Sphere Projection',
      formula: '|ψ⟩ = cos(θ/2)|0⟩+e^{iφ}sin(θ/2)|1⟩',
      f(x, z, t, {amp=1, freq=1}) {
        const theta=Math.PI*(x*freq+1)*0.5, phi=z*freq*Math.PI+t*0.4;
        const up=Math.cos(theta/2)**2, down=Math.sin(theta/2)**2;
        return (up-down)*Math.cos(phi) * amp * 0.45;
      }
    },
    doubleSlitProbability: {
      name: 'Double-Slit Interference |ψ|²',
      formula: '|ψ₁+ψ₂|² = 2I₀(1+cos(δ))',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const d=0.5+comp*0.5, k=8+comp*4;
        const r1=Math.sqrt((x*freq-d)**2+(z*freq+1e-3)**2)+1e-9;
        const r2=Math.sqrt((x*freq+d)**2+(z*freq+1e-3)**2)+1e-9;
        const psi1=Math.cos(k*r1)/r1, psi2=Math.cos(k*r2)/r2;
        return (psi1+psi2)**2 * amp * 0.15;
      }
    },
    densityMatrix: {
      name: 'Density Matrix ρ Diagonal',
      formula: 'ρ = Σ pᵢ|ψᵢ⟩⟨ψᵢ|',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*4);
        let rho=0;
        for (let k=1; k<=n; k++) {
          const pk=Math.exp(-k*0.5); // thermal weights
          const psi_k=Math.sin(k*Math.PI*(x*freq+0.5));
          rho+=pk*psi_k*psi_k;
        }
        return clamp(rho * amp * 0.3 * Math.exp(-z*z*0.3), 0, 0.7);
      }
    },
    landauLevels: {
      name: 'Landau Level (2D magnetic)',
      formula: 'E_n = ħωc(n+½), |ψ_n|² = L_n^0(r²)·e^(−r²)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(comp*5), omega_c=2+comp;
        const r2=(x*freq)**2+(z*freq)**2;
        // Generalized Laguerre L_n^0 via recurrence — exact for any n.
        const L_n = laguerreL(n, 0, r2);
        const psi=L_n*Math.exp(-r2/2)*Math.cos(n*Math.atan2(z,x)+omega_c*t*0.1);
        return psi*psi * amp * 0.4;
      }
    },
    schrodingerSoliton: {
      name: 'NLS Soliton',
      formula: '|ψ| = A·sech(A(x−vt))',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const A=1+comp, v=0.5;
        // FIX(#5, r4): the soliton translates at v·0.3 per unit of clock and
        // never returned — 3·10⁻⁷ of the boot peak two minutes in, exactly zero
        // by five. 24 is one pass of the domain, after which the next soliton
        // enters from the left; see replayTime.
        const xi=x*freq-v*replayTime(t, 24)*0.3;
        const sech=1/Math.cosh(A*xi);
        return sech*sech * amp * 0.5 * Math.exp(-z*z*0.25);
      }
    },
    coherentState: {
      name: 'Coherent State Wigner Function',
      formula: 'W(x,p) = 2e^{−2|α−β|²}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const alpha_re=Math.cos(t*(0.5+comp*0.3))*1.5;
        const alpha_im=Math.sin(t*(0.5+comp*0.3))*1.5;
        const d2=(x*freq-alpha_re)**2+(z*freq-alpha_im)**2;
        return 2*Math.exp(-2*d2) * amp * 0.4;
      }
    },
    atomicOrbitals: {
      name: 'sp² Hybrid (xz-plane projection)',
      formula: 'sp² = (1/√3)(s + √2·(p_x cosφ + p_z sinφ))',
      f(x, z, t, {amp=1, freq=1, comp=0.5}) {
        // Genuine sp² hybridization (3 lobes at 120°) is expressible in the
        // xz-plane: |sp²⟩ = (s + √2·(p_x cosφ + p_z sinφ)) / √3.
        // The φ parameter (driven by `comp`) rotates which lobe is "front".
        // Note: sp³ would need p_y, which is out of the visualization plane,
        // so this routine is restricted to sp².
        const r=Math.sqrt(x*x+z*z)*freq+1e-6, theta=Math.atan2(z,x);
        const phi=comp*Math.PI*2 + t*0.05;
        const psi_s = Math.exp(-r) / Math.sqrt(Math.PI);
        const psi_px= r*Math.exp(-r/2)*Math.cos(theta) / Math.sqrt(32*Math.PI);
        const psi_pz= r*Math.exp(-r/2)*Math.sin(theta) / Math.sqrt(32*Math.PI);
        const psi = (psi_s + Math.SQRT2*(psi_px*Math.cos(phi) + psi_pz*Math.sin(phi))) / Math.sqrt(3);
        return psi*psi * amp * 4;
      }
    },
    bellState: {
      name: 'Bell State Correlations',
      formula: '|Φ⁺⟩ = (|00⟩+|11⟩)/√2',
      f(x, z, t, {amp=1, freq=1}) {
        const phi1=x*freq*Math.PI, phi2=z*freq*Math.PI;
        // Simulate E(a,b) = -cos(a-b)
        return -Math.cos(phi1-phi2+t*0.3) * amp * 0.45;
      }
    },
    feynmanPath: {
      name: 'Feynman Path Integral (free particle)',
      formula: 'K(x,t) = (m/2πiħt)^½ e^{imx²/2ħt}',
      // FIX(#5-family): the eighth entry that read the session clock as the age
      // of a decaying solution, and the one the round-4 sweep missed because its
      // DRIFTERS list is written by hand. The propagator's amplitude is 1/√T
      // with T = 0.5 + 0.05·t, so it falls without bound and never returns:
      // measured at BOOT parameters, peak |y| went 4.356·10⁻¹ at t = 0 →
      // 1.070·10⁻¹ of that after thirty minutes of uptime → 0.076 after an hour
      // → 0.038 after four. It cleared the suite's "an order of magnitude below
      // boot" line at thirty minutes by 7 %, and failed it on any longer set.
      // Folding the clock to a 24-unit period keeps the quietest instant at
      // 1/√1.7 against 1/√0.5 at t = 0 — a factor 1.84, well inside the same
      // convention the other seven use — and leaves t = 0 bit-identical.
      f(x, z, t, {amp=1, freq=1}) {
        const T=0.5+replayTime(t, 24)*0.05;
        const phase=(x*freq)**2/(2*T);
        return Math.cos(phase) * amp * 0.4 / Math.sqrt(T) * Math.exp(-z*z*0.25);
      }
    },
    quantumZeno: {
      name: 'Quantum Zeno Effect',
      formula: 'P_survive(t) = cos²ᴺ(ωt/2N) → e^{−t²/τz}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=Math.round(1+comp*20), T=(x+3.5)/7*4;
        const omega=1;
        const P=Math.pow(Math.cos(omega*T/2/N)**2, N);
        return P * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER COLLECTION MAP
// ═══════════════════════════════════════════════════════════════════════════════
export const MATH_COLLECTIONS = {
  fractals:         FRACTALS_AND_CHAOS,
  specialFunctions: SPECIAL_FUNCTIONS,
  probability:      PROBABILITY_STATISTICS,
  linearAlgebra:    LINEAR_ALGEBRA,
  trigonometry:     TRIGONOMETRY,
  complexNumbers:   COMPLEX_NUMBERS,
  fourierSeries:    FOURIER_SERIES,
  differentialEqs:  DIFFERENTIAL_EQUATIONS,
  integralTransforms: INTEGRAL_TRANSFORMS,
  topology:         TOPOLOGY_GEOMETRY,
  cellularAutomata: CELLULAR_AUTOMATA,
  quantumMechanics: QUANTUM_MECHANICS,
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retrieve a single formula function by collection and key.
 * @param {string} collectionId — key in MATH_COLLECTIONS
 * @param {string} formulaKey   — key inside collection.formulas
 * @returns {{ name, formula, f } | null}
 */
export function getFormula(collectionId, formulaKey) {
  return MATH_COLLECTIONS[collectionId]?.formulas?.[formulaKey] ?? null;
}

/**
 * Get a flat list of all formulas for UI rendering.
 * @returns {Array<{ collectionId, collectionName, icon, key, name, formula }>}
 */
export function getAllFormulasList() {
  const list = [];
  for (const [colId, col] of Object.entries(MATH_COLLECTIONS)) {
    for (const [key, formula] of Object.entries(col.formulas)) {
      list.push({
        collectionId:   colId,
        collectionName: col.name,
        icon:           col.icon,
        key,
        name:           formula.name,
        formula:        formula.formula ?? '',
      });
    }
  }
  return list;
}

/**
 * Generate a Three.js-compatible height field from a formula.
 *
 * @param {Function}  fn       — formula.f(x, z, time, params) → y
 * @param {object}    params   — { amp, freq, comp }
 * @param {number}    gridSize — number of vertices per side (default 90)
 * @param {number}    extent   — half-width of grid in world units (default 3.5)
 * @param {number}    time     — current animation time
 * @returns {Float32Array}     — flat array of Y values [gridSize²], row-major
 */
export function generateSurfaceFromFormula(fn, params = {}, gridSize = 90, extent = 3.5, time = 0) {
  const { amp = 1, freq = 1, comp = 0.5 } = params;
  const out = new Float32Array(gridSize * gridSize);
  const step = (extent * 2) / (gridSize - 1);
  for (let zi = 0; zi < gridSize; zi++) {
    for (let xi = 0; xi < gridSize; xi++) {
      const x = -extent + xi * step;
      const z = -extent + zi * step;
      let y = 0;
      try { y = fn(x, z, time, { amp, freq, comp }); } catch (_) {}
      out[zi * gridSize + xi] = isFinite(y) ? y : 0;
    }
  }
  return out;
}

/**
 * Apply a height field (from generateSurfaceFromFormula) to an existing
 * Three.js BufferGeometry's position attribute (Y channel only).
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {Float32Array}         heightField — gridSize² values
 */
export function applyHeightField(geometry, heightField) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightField[i] ?? 0);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Generate a 3-component displacement field from a volume formula.
 *
 * Volume formulas have signature:
 *   f(x, y, z, time, params) → { dx, dy, dz }
 *
 * This allows full 3D deformation — each vertex is displaced along all axes.
 * Used with applyDisplacementField() which adds displacement to stored base positions.
 *
 * @param {Function}  fn       — formula.f(x, y, z, time, params) → {dx,dy,dz}
 * @param {object}    params   — { amp, freq, comp }
 * @param {number}    gridSize — vertices per side
 * @param {number}    extent   — half-width in world units
 * @param {number}    time     — animation time
 * @param {Float32Array} basePositions — flat [x0,y0,z0, x1,y1,z1,...] of original geometry
 * @returns {Float32Array}     — flat [dx0,dy0,dz0, dx1,dy1,dz1,...] length = count*3
 */
export function generateVolumeFromFormula(fn, params = {}, gridSize = 90, extent = 3.5, time = 0, basePositions = null) {
  const { amp = 1, freq = 1, comp = 0.5 } = params;
  const count = gridSize * gridSize;
  const out   = new Float32Array(count * 3);

  const step = (extent * 2) / (gridSize - 1);

  for (let zi = 0; zi < gridSize; zi++) {
    for (let xi = 0; xi < gridSize; xi++) {
      const idx = zi * gridSize + xi;

      // Base position — from geometry if provided, otherwise flat grid
      let bx, by, bz;
      if (basePositions) {
        bx = basePositions[idx * 3];
        by = basePositions[idx * 3 + 1];
        bz = basePositions[idx * 3 + 2];
      } else {
        bx = -extent + xi * step;
        by = 0;
        bz = -extent + zi * step;
      }

      let dx = 0, dy = 0, dz = 0;
      try {
        const r = fn(bx, by, bz, time, { amp, freq, comp });
        if (r && isFinite(r.dx)) dx = r.dx;
        if (r && isFinite(r.dy)) dy = r.dy;
        if (r && isFinite(r.dz)) dz = r.dz;
      } catch (_) {}

      out[idx * 3]     = dx;
      out[idx * 3 + 1] = dy;
      out[idx * 3 + 2] = dz;
    }
  }
  return out;
}

/**
 * Apply a displacement field to a Three.js BufferGeometry.
 * Adds displacement to stored base positions — non-destructive.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {Float32Array}         df           — [dx0,dy0,dz0, ...] length = count*3
 * @param {Float32Array}         basePositions — [x0,y0,z0, ...] original positions
 */
export function applyDisplacementField(geometry, df, basePositions) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      basePositions[i * 3]     + (df[i * 3]     ?? 0),
      basePositions[i * 3 + 1] + (df[i * 3 + 1] ?? 0),
      basePositions[i * 3 + 2] + (df[i * 3 + 2] ?? 0),
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Apply a scalar field as displacement along each vertex's normal direction.
 * For Collapse mode: pos = basePos + normal · scalar · strength.
 *
 * @param geometry      — Three.js BufferGeometry
 * @param scalarField   — Float32Array of length pos.count, one scalar per vertex
 * @param basePositions — flat Float32Array [x0,y0,z0,x1,y1,z1,...]
 * @param baseNormals   — flat Float32Array [nx0,ny0,nz0,...]
 * @param strength      — multiplier applied uniformly (default 1)
 */
export function applyCollapseField(geometry, scalarField, basePositions, baseNormals, strength = 1) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const s  = (scalarField[i] ?? 0) * strength;
    const bx = basePositions[i * 3],     by = basePositions[i * 3 + 1], bz = basePositions[i * 3 + 2];
    const nx = baseNormals[i * 3],       ny = baseNormals[i * 3 + 1],   nz = baseNormals[i * 3 + 2];
    pos.setXYZ(i, bx + nx * s, by + ny * s, bz + nz * s);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Generate a scalar field for Collapse mode using spherical (θ, φ) coordinates
 * relative to the geometry's centroid. Works for any topology.
 *
 * For each vertex i:
 *   r = |basePos_i - centroid|
 *   θ = atan2(z, x)            ∈ [-π, π]    (azimuth around Y axis)
 *   φ = acos((y - cy) / r)     ∈ [0, π]     (polar angle from +Y)
 *
 * Then evaluates fn(θ, φ, time, audioParams) — formula is reused but
 * re-interpreted: x_arg = θ, z_arg = φ. The formula's domain mapping
 * stays consistent (both arguments are in radian range, similar magnitude).
 *
 * @returns Float32Array of length basePositions.length / 3
 */
export function generateCollapseScalarField(fn, params = {}, basePositions, time = 0) {
  const { amp = 1, freq = 1, comp = 0.5 } = params;
  const N = basePositions.length / 3;
  const out = new Float32Array(N);

  // Compute centroid
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) {
    cx += basePositions[i * 3];
    cy += basePositions[i * 3 + 1];
    cz += basePositions[i * 3 + 2];
  }
  cx /= N; cy /= N; cz /= N;

  // Per-vertex spherical coords + formula evaluation
  for (let i = 0; i < N; i++) {
    const dx = basePositions[i * 3]     - cx;
    const dy = basePositions[i * 3 + 1] - cy;
    const dz = basePositions[i * 3 + 2] - cz;
    const r  = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const theta = Math.atan2(dz, dx);
    const phi   = r > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, dy / r))) : 0;

    let s = 0;
    try { s = fn(theta, phi, time, { amp, freq, comp }); } catch (_) {}
    out[i] = isFinite(s) ? s : 0;
  }
  return out;
}

// ── Volume formula collection ─────────────────────────────────────────────────
// Signature: f(x, y, z, time, {amp, freq, comp}) → {dx, dy, dz}
// New entries go here; keep the signature identical — the visualizer calls
// every volume formula through it without introspection.
export const VOLUME_FORMULAS = {
  lorenzField: {
    name: 'Lorenz Vector Field',
    // FIX: the description promised an attractor and the three components were
    // scaled by three different constants — 1.200·10⁻², 1.800·10⁻³, 1.200·10⁻³,
    // a factor of ten between the first and the last. A vector field scaled
    // anisotropically is a different vector field: the direction is wrong at
    // every point, so what was drawn was not Lorenz. One scale for all three
    // fixes that; β is the canonical 8/3 rather than the rounded 2.667.
    //
    // The description is also honest now about what this is. The visualiser
    // applies it as ONE displacement from the stored base positions
    // (applyDisplacementField), not as an integration step fed back in, so no
    // orbit accumulates and no attractor can form. What the mesh shows is the
    // field itself — which is a real thing to show, and is what the name says.
    //
    // 0.0045 is set from the field's own size: |F| peaks near 135 over the
    // ±3.5 box the shapes occupy, so this puts the largest displacement around
    // 0.6 units, close to what the old dx term produced.
    description: 'Lorenz field σ=10, ρ=28, β=8/3 — the vector field itself, one displacement per vertex',
    f(x, y, z, t, { amp = 1, freq = 1, comp = 0.5 }) {
      const sigma = 10, rho = 28, beta = 8 / 3;
      const k = 0.0045 * amp * freq;
      return {
        dx: sigma * (y - x) * k,
        dy: (x * (rho - z) - y) * k,
        dz: (x * y - beta * z) * k,
      };
    }
  },
  breathe: {
    name: 'Radial Breathe',
    // The displacement is neither uniform (the sin(t·freq·2 + r·2) phase makes
    // it a wave along the radius — measured 0.363 at r = 1 against 0.111 at
    // r = 3) nor along surface normals (it points away from the origin, which
    // coincides with the normal on a sphere and on none of the other 19 shapes).
    description: 'Wave travelling outward along the radius from the centre',
    f(x, y, z, t, { amp = 1, freq = 1, comp = 0.5 }) {
      const r    = Math.sqrt(x * x + y * y + z * z) + 0.001;
      const wave = Math.sin(t * freq * 2 + r * 2) * amp * 0.4;
      return { dx: (x / r) * wave, dy: (y / r) * wave, dz: (z / r) * wave };
    }
  },
  twist: {
    name: 'Axial Twist',
    description: 'Rotation around Y axis proportional to height',
    f(x, y, z, t, { amp = 1, freq = 1, comp = 0.5 }) {
      const angle = y * freq * 1.2 * amp + t * 0.3;
      const cos   = Math.cos(angle) - 1;
      const sin   = Math.sin(angle);
      return {
        dx: x * cos - z * sin,
        dy: Math.sin(t * 0.5 + y) * amp * 0.15,
        dz: x * sin + z * cos,
      };
    }
  },
  rippleVolume: {
    name: 'Volumetric Ripple',
    description: 'Spherical wavefronts emanating from origin',
    f(x, y, z, t, { amp = 1, freq = 1 }) {
      const r    = Math.sqrt(x * x + y * y + z * z) + 0.001;
      const wave = Math.sin(r * freq * 3 - t * 2) * amp * 0.3 / (r + 0.5);
      return { dx: (x / r) * wave, dy: (y / r) * wave, dz: (z / r) * wave };
    }
  },
  magneticDipole: {
    name: 'Magnetic Dipole Field',
    // FIX: the ε = 0.5 that keeps the field finite at the origin was being
    // applied twice — once to the denominator, where it belongs, and once
    // inside the numerator's m·r² term, where it does not. That second use is
    // what made the result not a softened dipole but a different field:
    // measured against B = (3r̂(m·r̂) − m)/r³, the on-axis value was 73 % low at
    // r = 1 and 30 % low at r = 2, and the axis-to-equator ratio came to −1.667
    // where a dipole gives exactly −2.
    //
    // With the true r² restored in the numerator the ratio is −2 to a part in
    // 10³ by r = 2, and the field stays bounded at the origin on its own — the
    // numerator vanishes there faster than the denominator does, so no spike
    // replaces the one ε was hired to prevent.
    //
    // ε survives in the denominator by design, and the description says so:
    // a point dipole has no finite field at r = 0, and this one has to be
    // drawn on a mesh that passes through the origin.
    description: 'B-field of a magnetic dipole at the origin, regularised at r→0',
    f(x, y, z, t, { amp = 1, freq = 1 }) {
      const rr   = x * x + y * y + z * z;      // true r²
      const r5   = Math.pow(rr + 0.5, 2.5);    // regularised denominator
      const m    = amp * 0.8 * Math.sin(t * 0.3); // oscillating dipole moment
      const dot3 = 3 * z * m; // dipole along Z
      return {
        dx: dot3 * x / r5 * freq,
        dy: dot3 * y / r5 * freq,
        dz: (dot3 * z - m * rr) / r5 * freq,
      };
    }
  },
  fluidVortex: {
    name: 'Fluid Vortex',
    // FIX: the description claims incompressibility, which is the statement
    // ∇·v ≡ 0, and the field did not have it. The swirl in (x, z) is fine — the
    // two terms ∂dx/∂x and ∂dz/∂z cancel identically for any radial strength
    // function — but the vertical component was cos(y·freq + t), whose
    // y-derivative is the entire divergence: measured ∇·v = −amp·0.1·freq·
    // sin(y·freq + t), matching that prediction to seven digits, with
    // |∇·v|/|v| averaging 0.80 over the sample box. A control run on a field
    // that is solenoidal by construction returned exactly 0, so the reading
    // was the field's and not the difference stencil's.
    //
    // Driving the vertical wave from the cylindrical radius instead of from y
    // removes the only y-dependence in dy, so ∂dy/∂y vanishes and the field is
    // divergence-free everywhere, exactly. The visible motion is much the same:
    // a wave along the column instead of across it.
    description: 'Incompressible vortex flow — ∇·v = 0 exactly',
    f(x, y, z, t, { amp = 1, freq = 1, comp = 0.5 }) {
      const rho = Math.sqrt(x * x + z * z);
      const r2  = x * x + z * z + 0.3;
      const str = amp * 0.5 / r2;
      const osc = Math.sin(t * 0.4 + y * freq);
      return {
        dx: -z * str * osc,
        dy:  Math.cos(rho * freq + t) * amp * 0.1,
        dz:  x * str * osc,
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// UI COMPONENT — returns an HTML string ready to inject into any panel
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the collection/formula picker HTML.
 * Inject into a panel container, then call bindMathCollectionUI(onSelect).
 *
 * @returns {string} HTML string
 */
export function buildMathCollectionUI() {
  const groups = Object.entries(MATH_COLLECTIONS).map(([colId, col]) => {
    const opts = Object.entries(col.formulas).map(([key, f]) =>
      `<option value="${colId}::${key}">${f.name}</option>`
    ).join('');
    return `<optgroup label="${col.icon} ${col.name}">${opts}</optgroup>`;
  }).join('');

  return `
<div id="math-col-picker" style="display:flex;flex-direction:column;gap:6px">
  <div style="display:flex;gap:6px;align-items:center">
    <select id="math-formula-select"
      style="flex:1;background:#0d0d20;color:#8af;border:1px solid #223;padding:4px 6px;border-radius:4px;font-family:monospace;font-size:11px">
      ${groups}
    </select>
    <button id="math-apply-btn"
      style="background:#112244;color:#8af;border:1px solid #336;padding:4px 10px;border-radius:4px;cursor:pointer;font-family:monospace;font-size:11px">
      ▶ APPLY
    </button>
  </div>
  <div id="math-formula-info"
    style="font-family:monospace;font-size:10px;color:#556;padding:4px 6px;background:#090912;border-radius:3px;min-height:18px;word-break:break-all">
  </div>
</div>`;
}

/**
 * Bind the math collection UI to a callback.
 * Call after injecting buildMathCollectionUI() HTML into the DOM.
 *
 * @param {function({ collectionId, key, formula }): void} onSelect
 */
export function bindMathCollectionUI(onSelect) {
  const sel  = document.getElementById('math-formula-select');
  const btn  = document.getElementById('math-apply-btn');
  const info = document.getElementById('math-formula-info');

  const update = () => {
    const [colId, key] = sel.value.split('::');
    const f = getFormula(colId, key);
    if (f) info.textContent = f.formula ?? '';
  };

  sel.addEventListener('change', update);
  update();

  btn.addEventListener('click', () => {
    const [colId, key] = sel.value.split('::');
    const f = getFormula(colId, key);
    if (f && onSelect) onSelect({ collectionId: colId, key, formula: f });
  });
}