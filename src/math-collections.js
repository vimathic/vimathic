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
 * FIX(r6): frame-fitting saturation — the replacement for a hard clamp on an
 * entry whose kernel is correct but unbounded.
 *
 * Identity below `knee`, so the working range of the surface is left exactly
 * as the formula computes it; above `knee` the excess is folded into `ceil`
 * monotonically. Ordering, sign and the zero set all survive, which is what
 * separates this from a clamp.
 *
 * A clamp buys a small peak by turning the far field into a flat tabletop, and
 * until this round nothing in the suite could see that happen: the ±1.5 clamp
 * that round 5 put on `catenoid` pins 49.6 % of the mesh at the bound at the
 * default slider and 95.8 % at the maximum, and every test stayed green
 * because they all watch the peak, which is exactly the number a clamp fixes.
 * The share of vertices sitting at the extreme is now measured directly —
 * see the plateau assertions in tests/math-validation.test.js.
 *
 * Saturation is not free either: past roughly knee + 3·(ceil − knee) the fold
 * flattens too. It is chosen per entry so that the factory sliders stay inside
 * the identity region and only the deliberate over-drive reaches the fold.
 */
const soften = (y, knee, ceil) => {
  const a = Math.abs(y);
  if (a <= knee) return y;
  return Math.sign(y) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
};

/**
 * FIX(r6): an integer hash with avalanche, for the entries that need a
 * reproducible random-looking seed.
 *
 * The pattern it replaces — `(i * 2654435761) >>> 0` — is a Weyl sequence in
 * the golden ratio, which is the opposite of what a seed wants: it is
 * *equidistributed*, so consecutive indices are almost equally spaced rather
 * than independent. Measured over a 48² lattice, a χ² over 100 buckets came
 * out at 7.9 where chance alone would give about 99 ± 14 — far too even to be
 * random. Worse, `(i * 2246822519) >>> 0 % 8` is degenerate: 2³² is divisible
 * by 8, so the state depended only on the column and the plate was vertical
 * stripes at every N that divides a power of two.
 *
 * This is the murmur3 finaliser, which mixes every input bit into every output
 * bit: same lattice, χ² = 107.8 over 100 buckets and 5.5 over 8, and no column
 * is uniform. It stays a pure function of the index, so nothing about caching
 * or reproducibility changes.
 */
const hash32 = i => {
  let v = (i ^ 0x9E3779B9) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x21f0aaad) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x735a2d97) >>> 0;
  return (v ^ (v >>> 15)) >>> 0;
};

/**
 * FIX(r6): the partial sums of one random walk, built once at module load and
 * read by `randomWalk` below.
 *
 * It exists because the entry used to re-seed its generator at every vertex,
 * from round((x+3.5)·57.3), so neighbouring vertices carried the endpoints of
 * INDEPENDENT walks. That is a noise field, not Brownian motion, and it shows
 * in the one law a walk has to obey: Var[Δy] should grow with the lag, and it
 * came out flat — 1.10 at the mesh spacing and 1.10 at a lag twenty-five times
 * larger. Accumulating a single walk restores it (0.050 against 0.993).
 *
 * 410 samples cover the plate at the resolution the old per-vertex seed
 * implied, and the same LCG and step size are kept so the surface stays the
 * same size it was. Increments are uniform rather than Gaussian, so this is
 * still not a realisation of the Wiener process — the caption says "seeded",
 * and MATHEMATICAL_ACCURACY.md says the rest.
 */
const WALK = (() => {
  const N = 410, out = new Float64Array(N);
  let seed = Math.round(0 * 57.3) || 1, v = 0;
  for (let i = 0; i < N; i++) {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    v += (((seed >>> 16) & 0xff) / 255 - 0.5) * 0.15;
    out[i] = v;
  }
  return out;
})();

/**
 * FIX(r7): the partial sums of one Ornstein–Uhlenbeck path, memoised on the
 * pair that defines it, for `ornsteinUhlenbeck` below.
 *
 * The integration reads only the step index and θ — nothing about the vertex —
 * so walking it inside the kernel made every vertex of the mesh recompute a
 * prefix of the same path, and the cost grew with the mesh instead of staying
 * flat. One cached path per (θ, length) is the same arithmetic once.
 *
 * One slot, not a map: θ = 1 + comp moves continuously with the music, so a map
 * keyed on it would grow without bound over a set. Consecutive frames share a
 * θ or they do not, and rebuilding 128 steps when they do not is 3 µs.
 */
const OU_SIGMA = 0.4, OU_DT = 0.05;
let ouCacheKey = '', ouCachePath = null;
const ouPath = (theta, steps) => {
  const key = theta + '|' + steps;
  if (key === ouCacheKey) return ouCachePath;
  const out = new Float64Array(steps + 1);
  let v = 0;
  for (let i = 0; i < steps; i++) {
    const noise = ((hash32(i) & 0xffff) / 65535 - 0.5) * 2;
    v += theta * (0 - v) * OU_DT + OU_SIGMA * noise * Math.sqrt(OU_DT);
    out[i + 1] = v;
  }
  ouCacheKey = key; ouCachePath = out;
  return out;
};

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
/**
 * FIX(r6): modified Bessel I₀, added for `vonMises` — its normalising constant
 * 2πI₀(κ) is not a constant at all here, because κ rides the mid band, and
 * dropping it left the surface swinging by a factor of 3.9 with the music.
 *
 * Ascending series Σ (x²/4)ᵏ/(k!)², which converges geometrically for the
 * κ ∈ [1, 5] this catalogue reaches — twenty terms put the last one below
 * 10⁻¹⁷ of the sum at κ = 5. No asymptotic branch, because nothing here calls
 * it with a large argument, and a branch nobody exercises is a seam waiting to
 * be found by an audit.
 */
function besselI0(x) {
  const q = x * x / 4;
  let term = 1, sum = 1;
  for (let k = 1; k <= 20; k++) { term *= q / (k * k); sum += term; }
  return sum;
}

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
  // FIX(r8): one handover for both signs was wrong, because the two sides fail
  // in opposite directions. Ai decays on the right, so the alternating series
  // loses everything to cancellation there — relative error 1.1e-3 at x = +8,
  // where the asymptotic is already good to 2.5e-14 — while on the left Ai
  // oscillates at O(1) and the series still holds 1.9e-9 at x = −10, where the
  // asymptotic is only worth 8.8e-9. Measured worst |ΔAi| over the reachable
  // range against mpmath: right side 1.87e-10 → 8.7e-13 by handing over at 7,
  // left side 1.26e-7 → 3.3e-8 by handing over at 10. The row's own ≤10⁻⁸ claim
  // was violated by the old single threshold of 8 and is now met on one side
  // and stated as measured on the other.
  if (ax <= (x > 0 ? 7 : 10)) {
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
  // FIX(r8): the +0.01 on r was the largest guard epsilon in the file and the
  // only thing standing between hydrogenS and its own caption. Every branch
  // below is a polynomial in r times e^{−r/n} — nothing divides by r, and
  // theta comes from atan2, which is defined at the origin — so the offset
  // guarded nothing. It drew the field of radius r+0.01 at radius r: for the
  // 1s state that is a flat factor e^{−0.02} = 0.9802, i.e. 4·e^{−2r} became
  // 3.9208·e^{−2r} under a row that says "4·exp(−2r) radial part exact";
  // measured 0.214 worst on a peak of 10.59. For 2p, where R = r·e^{−r/2}, it
  // is not a constant at all but a 0.01 a₀ inward shift that fills in the node
  // at the origin — measured 1.04e-3 worst, over the top of tier B.
  const r = Math.sqrt(x*x + z*z);
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
// ── Heighway dragon: one orbit, built once ──────────────────────────────────
// FIX(r11): the kernel this serves used to run a private 8–14 step chaos game
// AT EVERY VERTEX, seeded from that vertex's own quantised coordinates. Twenty
// steps at the map's λ₁ = 0.421 stretch the 0.0787 grid spacing by e^{8.42} ≈
// 4.5×10³, so neighbouring vertices landed on independent points of the
// attractor: 83.1 % of grid 90 sat at exactly 0, the neighbour correlation was
// 0.027 across x and 0.088 across z, and what a viewer met was static speckle,
// not a dragon, at any zoom. The distribution was right — KS against 20 000
// true attractor points gives 0.0206 at p = 0.64 — but sampling the correct
// measure one point at a time is not the same as drawing the set.
//
// One orbit now runs once per density level, is cached, and every vertex reads
// the same picture. Control against a dragon built with no IFS at all (the
// paper-folding sequence, 16 levels): raster Jaccard 0.971, box
// [−0.3330, 1.1663] × [−0.3332, 0.6665] against the canonical
// [−1/3, 7/6] × [−1/3, 2/3]. The first run of that control read 0.179 — the
// reference was mirrored in y, not the orbit. Suspect the oracle first.
const DRAGON_RES = 128;
const DRAGON_X0 = -0.55, DRAGON_X1 = 1.40, DRAGON_Z0 = -0.55, DRAGON_Z1 = 0.90;
const _dragonGrids = new Map();

function dragonDensity(points) {
  const cached = _dragonGrids.get(points);
  if (cached) return cached;
  const g = new Float32Array(DRAGON_RES * DRAGON_RES);
  const r = 1 / Math.SQRT2, cosA = Math.cos(Math.PI / 4) * r, sinA = Math.sin(Math.PI / 4) * r;
  let px = 0.5, pz = 0.25, seed = 12345 >>> 0;
  for (let i = 0; i < points; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    if ((seed & 0x80000000) === 0) {
      const nx = cosA * px - sinA * pz, nz = sinA * px + cosA * pz; px = nx; pz = nz;
    } else {
      const nx = 1 - cosA * px - sinA * pz, nz = sinA * px - cosA * pz; px = nx; pz = nz;
    }
    if (i < 100) continue;                    // let the orbit fall onto the set
    const c  = ((px - DRAGON_X0) / (DRAGON_X1 - DRAGON_X0) * DRAGON_RES) | 0;
    const rr = ((pz - DRAGON_Z0) / (DRAGON_Z1 - DRAGON_Z0) * DRAGON_RES) | 0;
    if (c >= 0 && c < DRAGON_RES && rr >= 0 && rr < DRAGON_RES) g[rr * DRAGON_RES + c]++;
  }
  // Normalised on a high quantile rather than on the single densest cell: the
  // dragon's measure is very uneven, and dividing by the peak would push the
  // rest of the set into the floor — which is the failure the old kernel had
  // for a different reason.
  const nzc = Array.from(g).filter(v => v > 0).sort((a, b) => a - b);
  const q = nzc.length ? nzc[Math.min(nzc.length - 1, Math.floor(nzc.length * 0.95))] : 1;
  for (let i = 0; i < g.length; i++) g[i] = Math.min(1, g[i] / q);
  _dragonGrids.set(points, g);
  return g;
}

// ── Simulations that continue instead of restarting ─────────────────────────
// FIX(r11): `reactionDiffusion` and `excitableMedia` allocated their fields and
// re-seeded them on every call, and createCachedHeavySampler calls a simulator
// on every rebuild — measured at 16–20 per second. So neither medium ever
// advanced past its first 60–120 Euler steps, whatever the clock said: Gray-
// Scott showed one round blob (v > 0.2 in 80 cells of 4096, always exactly one
// connected component) and FitzHugh-Nagumo showed a barely-relaxed initial
// condition, bit-identical at every t.
//
// A continuation cache fixes the cost without giving up reproducibility: the
// state is keyed by (regime bucket, step count), so asking for step 2000 twice
// gives the same field, and asking for it after step 1200 continues rather than
// restarts. A cold request — a new bucket, or a clock that moved backwards —
// recomputes from the seed, which is what makes the answer a function of its
// key rather than of the session's history. Tests hold both ends of that.
function makeContinuedSim(seedFn, stepFn) {
  let state = null;
  return (key, steps, params) => {
    if (!state || state.key !== key || steps < state.steps) {
      state = { key, steps: 0, ...seedFn(params) };
    }
    if (steps > state.steps) {
      stepFn(state, steps - state.steps, params);
      state.steps = steps;
    }
    return state;
  };
}

const SIM_N = 64;

// Gray-Scott. The shipped (F, k) were not in a pattern-forming regime at all —
// measured with the restart removed, they flood the lattice to 100 % coverage
// with zero interface length, which is a flat plate, not a pattern. The path
// below runs from Pearson's δ to his θ, both measured here to give structure
// across the whole reachable comp band: 47…85 local maxima and 616…906
// interface cells at 41…57 % coverage, at 800 steps from a 40 % scattered seed.
const grayScottSim = makeContinuedSim(
  () => {
    const u = new Float32Array(SIM_N * SIM_N).fill(1), v = new Float32Array(SIM_N * SIM_N);
    // Deterministic scatter: a proper mix, not a modulus. The first version of
    // this seed used `hash % 100 < 40` and died at half the comp band — the
    // low bits of that hash carry the lattice's own periodicity.
    for (let i = 0; i < u.length; i++) {
      const r = (i / SIM_N) | 0, c = i % SIM_N;
      let h = ((r * 73856093) ^ (c * 19349663)) >>> 0;
      h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
      h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
      if ((h >>> 0) / 4294967296 < 0.40) { u[i] = 0.5; v[i] = 0.25; }
    }
    return { u, v };
  },
  (state, iters, { comp }) => {
    const { u, v } = state, N = SIM_N, Du = 0.16, Dv = 0.08;
    const F = 0.030 + (clamp(comp, 0, 1) - 0.5) * 0.02;
    const k = 0.055 + (clamp(comp, 0, 1) - 0.5) * 0.015;
    const un = new Float32Array(N * N), vn = new Float32Array(N * N);
    for (let it = 0; it < iters; it++) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const i = r * N + c;
        const rp = (r + 1) % N, rm = (r - 1 + N) % N, cp = (c + 1) % N, cm = (c - 1 + N) % N;
        const lapU = u[rp * N + c] + u[rm * N + c] + u[r * N + cp] + u[r * N + cm] - 4 * u[i];
        const lapV = v[rp * N + c] + v[rm * N + c] + v[r * N + cp] + v[r * N + cm] - 4 * v[i];
        const uvv = u[i] * v[i] * v[i];
        un[i] = u[i] + Du * lapU - uvv + F * (1 - u[i]);
        vn[i] = v[i] + Dv * lapV + uvv - (F + k) * v[i];
      }
      u.set(un); v.set(vn);
    }
  },
);

// Barkley's excitable medium — the standard model for spiral waves, and the
// reason the entry is renamed below. The FitzHugh-Nagumo parameters that
// shipped could not sustain a wave at any step count: with eps = 0.01 and
// gamma = 0.5 the recovery variable settles at v = 2u, so u' = u[(1−u)(u−a) − 2]
// is negative for every u in [0, 1] and the medium is guaranteed to go quiet.
// Measured: 47.7 % of the lattice excited at step 120, 7.5 % at 500, exactly
// 0.0 % from step 1000 on, and no motion at all after that.
const barkleySim = makeContinuedSim(
  () => {
    const N = SIM_N;
    const u = new Float32Array(N * N), v = new Float32Array(N * N);
    // A broken front: one quadrant excited, the quadrant behind it refractory,
    // so the free end curls and a spiral forms.
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      u[r * N + c] = (r < N / 2 && c < N / 2) ? 1 : 0;
      v[r * N + c] = (r >= N / 2 && c < N / 2) ? 0.5 : 0;
    }
    return { u, v };
  },
  (state, iters, { comp }) => {
    const { u, v } = state, N = SIM_N;
    const dt = 0.01, D = 1, b = 0.01;
    // comp moves the excitability: a is the threshold parameter of the model,
    // and the reachable band keeps the medium excitable rather than oscillatory.
    const eps = 0.02, a = 0.70 + clamp(comp, 0, 1) * 0.10;
    const un = new Float32Array(N * N), vn = new Float32Array(N * N);
    for (let it = 0; it < iters; it++) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const i = r * N + c;
        const rp = (r + 1) % N, rm = (r - 1 + N) % N, cp = (c + 1) % N, cm = (c - 1 + N) % N;
        const lap = u[rp * N + c] + u[rm * N + c] + u[r * N + cp] + u[r * N + cm] - 4 * u[i];
        const uu = u[i], vv = v[i];
        un[i] = uu + dt * (D * lap + (1 / eps) * uu * (1 - uu) * (uu - (vv + b) / a));
        vn[i] = vv + dt * (uu - vv);
      }
      u.set(un); v.set(vn);
    }
  },
);

/** Regime bucket for a simulation: comp quantised to the cache's own dead-band. */
const simBucket = comp => Math.round(clamp(comp, 0, 1) / HEAVY_PARAM_EPS);

/**
 * Step count for a simulation at clock t: it advances, and it is bounded.
 * Unbounded would make a cold recompute — a new bucket after a long session —
 * cost the whole history; frozen would put us back where this fix started.
 */
const simSteps = (t, base, rate, cap) =>
  base + Math.min(cap, Math.max(0, Math.round(Math.abs(t) * rate)));

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
      formula: 'z_{n+1} = z_n² + c; drawn: 1 − n_esc/n_max, n_max = 11…15',
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
      formula: 'z_{n+1} = z_n² + c(t), c = −0.7269+0.2sin(0.4t) + i(0.1889+0.15cos(0.3t)); drawn: 1 − n_esc/n_max, n_max = 11…15',
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
      formula: 'z_{n+1} = (|Re|+i|Im|)² + c, c centred at −1.7; drawn: 1 − n_esc/n_max, n_max = 11…15',
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
      name: 'Lorenz Attractor Density',
      formula: 'ẋ=σ(y−x), ẏ=x(ρ−z)−y, ż=xy−βz, σ=10, ρ=28, β=8/3; drawn: √(orbit density) in (x,z)',
      // FIX(r8): rossler's defect, one entry up, in the entry round 6 did not
      // look at. Eight Euler steps of dt = 0.004 is T = 0.032, so what came back
      // from a plane of initial conditions was its own linearisation:
      // least-squares plane R² = 0.9788, non-planar residual 6.1e-3 rms against
      // a peak-to-peak of 0.174 at the factory sliders. Deleting BOTH quadratic
      // couplings — the −xz and the +xy that are the entire reason this system
      // is famous — moved the plate by 11 % of that and nothing else moved at
      // all. And `lorenzY` took t and never read it, so the entry was frozen:
      // the plate at t = 17.3 was the plate at t = 0 to the last bit.
      //
      // Same repair as rossler and chua, for the same reason: what draws an
      // attractor is one long orbit splatted as a density, paid once per rebuild
      // instead of once per vertex. Against DOP853 at rtol = atol = 1e-12 the
      // RK4 orbit holds 3.6e-4 over T = 0.5, 1.1e-5 of its own radius; past that
      // no integrator agrees with any other, which is what a positive Lyapunov
      // exponent means, and only the measure survives. The drawn density matches
      // a T = 960 reference orbit to a correlation of 0.969, where reference
      // segments of the same 12 000 samples score 0.961 [0.955, 0.968] against
      // it — the picture sits on the sampling noise floor, with no bias left to
      // find. Measured: plane R² 0.9788 → 0.0020, peak 0.174 → 0.644, share of
      // the mesh at the extreme 0.037 %, and the clock moves it again — 21 % of
      // the peak over 17 s, where rossler moves 21 % and chua 10 %. Cost over
      // four runs 0.2–0.4 → 0.7–1.2 ms per 90-plate, beside rossler's 0.7–1.1
      // and chua's 1.1–1.8, and it stops following the mesh: at grid 200 it is
      // 2.4–2.5 ms where per-vertex work would have quadrupled.
      //
      // Drawn in the (x, z) projection because that is the butterfly: x and y
      // are 0.88 correlated on the attractor, so (x, y) folds onto its own
      // diagonal — 6 % of the variance lies across it against 45 % here. β is
      // the canonical 8/3 the caption always claimed rather than 2.667, which
      // buys honesty and not pixels: it shifts the fixed points
      // (±√(β(ρ−1)), ρ−1) = (±8.485, 27) by 5.3e-4 world units, six
      // ten-thousandths of one accumulator cell.
      //
      // The trade, the one the other eleven heavy entries already make: a cached
      // sampler is fed u = (x+3.5)/7, so Wave Intensity no longer moves this
      // entry. Compression stays off the constants for rossler's r7 reason — ρ
      // on a slider would hand back a fresh sample of the invariant measure on
      // every rebuild instead of an evolving orbit, and at ~20 Hz that is the
      // flashing the DISCLAIMER warns about.
      f: createCachedHeavySampler((t, {amp = 1}, res) => {
        const sigma = 10, rho = 28, beta = 8/3, dt = 0.01;
        const d = (p, q, r) => [sigma*(q - p), p*(rho - r) - q, p*q - beta*r];
        const step = v => {
          const k1 = d(v[0], v[1], v[2]);
          const k2 = d(v[0]+dt/2*k1[0], v[1]+dt/2*k1[1], v[2]+dt/2*k1[2]);
          const k3 = d(v[0]+dt/2*k2[0], v[1]+dt/2*k2[1], v[2]+dt/2*k2[2]);
          const k4 = d(v[0]+dt*k3[0], v[1]+dt*k3[1], v[2]+dt*k3[2]);
          return [v[0]+dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]),
                  v[1]+dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]),
                  v[2]+dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2])];
        };
        // Extents from DOP853 over T = 200: x [−17.80, 18.79], z [3.44, 46.27],
        // symmetrised — the field is exactly equivariant under (x, y) → (−x, −y),
        // so the asymmetry is finite-time sampling — and given a unit of margin.
        const X0 = -20, X1 = 20, Z0 = 1.5, Z1 = 48.5;
        const acc = new Float32Array(res*res);
        let v = [1, 1, 1];
        const skip = 1500 + Math.floor((t*6) % 3000);
        for (let i = 0; i < skip; i++) v = step(v);
        for (let i = 0; i < 12000; i++) {
          v = step(v);
          const ix = Math.floor((v[0]-X0)/(X1-X0)*res), iz = Math.floor((v[2]-Z0)/(Z1-Z0)*res);
          if (ix >= 0 && ix < res && iz >= 0 && iz < res) acc[iz*res+ix]++;
        }
        let mx = 0; for (const q of acc) if (q > mx) mx = q;
        const out = new Float32Array(res*res);
        for (let i = 0; i < acc.length; i++) out[i] = Math.sqrt(acc[i]/(mx||1)) * amp;
        return out;
      }, 48),
    },
    rossler: {
      name: 'Rössler Attractor',
      formula: 'ẋ=−y−z, ẏ=x+ay, ż=b+z(x−c), a=b=0.2, c=5.7; drawn: √(orbit density) in (x,y)',
      // FIX(r6): the field and its constants were right; the horizon was not.
      // Twelve Euler steps of dt = 0.003 is T = 0.036, about a two-hundredth of
      // one loop, so the flow map was indistinguishable from its own
      // linearisation: least-squares plane R² = 1.000000, non-planar residual
      // 3.9e-5 rms against a peak of 0.0192 — six thousandths of the frame.
      // Integrating further does not rescue it. At T = 8, two hundred times as
      // far, the plane R² is still 0.9976, because a sheet of initial conditions
      // this small does not separate inside Rössler's Lyapunov time; and Chua,
      // which does separate, cost 288 ms per 90-plate to get there.
      //
      // What draws the attractor is one long orbit splatted as a density, which
      // is what this collection already does eleven times through
      // createCachedHeavySampler and what "Dragon Curve Density" and "Langton's
      // Ant (trajectory density)" are named after. The simulation is paid once
      // per rebuild instead of once per vertex, so the cost stops growing with
      // the mesh: measured per plate, 0.25 → 0.47 ms at grid 90 (×2.0) and
      // 1.25 → 2.24 ms at grid 200 (×0.6 — cheaper there). RK4 and not Euler:
      // Euler's first-order error on an oscillatory field is a systematic
      // outward drift, and it would inflate the very shape that is the point.
      // Measured: plane R² 1.000000 → 0.058, peak 0.0192 → 0.671 at the factory
      // sliders, share of the mesh at the extreme unchanged at 0.012 %.
      //
      // The trade to know: a cached sampler is fed u = (x+3.5)/7, so Wave
      // Intensity no longer moves this entry — the same trade the other eleven
      // heavy entries already make.
      //
      // FIX(r7): Compression makes the same trade, and it is not a preference.
      // `c = 5.7 + comp` fed a chaotic parameter, and this cache rebuilds on
      // its time trigger about every third frame — so each rebuild integrated
      // 1500–4500 RK4 steps under a c that had moved by whatever the audio did
      // meanwhile, and came back with a different realisation of the same
      // invariant measure. Not evolution: a fresh Monte-Carlo sample. Measured
      // between consecutive rebuilds, the plate changed by 39 % of its own norm
      // (median, 70 % worst) with nothing playing at all, since the idle LFO
      // moves comp too, and 45 % under music. A drift of 1e-6 per frame is
      // already enough for 23 %. At the ~20 Hz this cache rebuilds at, that is
      // flashing, and DISCLAIMER warns photosensitive users about exactly that.
      // With c held at the canonical 5.7 the same measurement gives 0.0 %
      // median, 0.2 % worst — and `chua` below, whose constants were never
      // wired to a slider, was already the stable one for this reason.
      f: createCachedHeavySampler((t, {amp = 1}, res) => {
        const a = 0.2, b = 0.2, c = 5.7, dt = 0.02;
        const d = (p, q, r) => [-(q + r), p + a*q, b + r*(p - c)];
        const step = v => {
          const k1 = d(v[0], v[1], v[2]);
          const k2 = d(v[0]+dt/2*k1[0], v[1]+dt/2*k1[1], v[2]+dt/2*k1[2]);
          const k3 = d(v[0]+dt/2*k2[0], v[1]+dt/2*k2[1], v[2]+dt/2*k2[2]);
          const k4 = d(v[0]+dt*k3[0], v[1]+dt*k3[1], v[2]+dt*k3[2]);
          return [v[0]+dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]),
                  v[1]+dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]),
                  v[2]+dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2])];
        };
        // Viewport from the measured extents at c = 5.7 over 200 000 steps:
        // x [−9.11, 11.43], y [−10.79, 7.84], with a unit of margin.
        const X0 = -10.1, X1 = 12.4, Y0 = -11.8, Y1 = 8.8;
        const acc = new Float32Array(res*res);
        let v = [1, 1, 1];
        // The dropped transient slides with the clock, so the traced segment
        // breathes instead of standing still. Deliberately slow: consecutive
        // rebuilds differ by 0.0000 and four seconds apart by 0.11, which is
        // evolution and not the rapid flashing the DISCLAIMER warns about.
        const skip = 1500 + Math.floor((t*6) % 3000);
        for (let i = 0; i < skip; i++) v = step(v);
        for (let i = 0; i < 8000; i++) {
          v = step(v);
          const ix = Math.floor((v[0]-X0)/(X1-X0)*res), iy = Math.floor((v[1]-Y0)/(Y1-Y0)*res);
          if (ix >= 0 && ix < res && iy >= 0 && iy < res) acc[iy*res+ix]++;
        }
        let mx = 0; for (const q of acc) if (q > mx) mx = q;
        const out = new Float32Array(res*res);
        // sqrt of the occupancy: the invariant measure piles up on the fold, and
        // a linear ramp hides the rest of the band under it (sd 0.166 linear
        // against 0.189 here).
        for (let i = 0; i < acc.length; i++) out[i] = Math.sqrt(acc[i]/(mx||1)) * amp;
        return out;
      }, 48),
    },
    newtonFractal: {
      name: 'Newton Fractal z³−1',
      formula: 'z ← z − f(z)/f′(z), f(z) = z³ − 1; drawn: arg(zₙ)/π, n = 8…11',
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
      formula: 'λ = lim 1/n Σ ln|f′(xₙ)|, f logistic, r alternating a,b; a=2.6+1.4(x+3.5)/7, b likewise in z; folded above 0.5',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): three things, and the first is the one that mattered.
        //
        // The parameter window ran to 5.6, and the logistic map is only bounded
        // for r ≤ 4 — past that the orbit escapes to −∞ and the exponent is not
        // an exponent of anything. 73.6 % of the plate sat pinned at the +0.8
        // clamp, i.e. most of the picture was the clamp rather than the map.
        // The window is now [2.6, 4.0], which is where the Lyapunov fractal
        // lives.
        //
        // Second, the average started at the first iterate from x₀ = 0.5, with
        // no transient discarded, so what was averaged included the approach to
        // the attractor and not just the attractor: measured against a run with
        // burn-in, 10.2 % of vertices came out with the wrong SIGN — order
        // reported as chaos and back. 48 iterations are now thrown away first.
        //
        // Third, `if (isFinite(lam)) n++` counted a step even when its own term
        // was infinite (r(1−2xₙ) = 0 at a superstable point), which poisons the
        // running sum and then keeps counting; the guard is now on the term.
        //
        // FIX(r8): the seed. x₀ = 0.5 is the critical point of the logistic map,
        // and at the a = 4 edge that round 6 introduced it is degenerate:
        // 4·0.5·0.5 = 1, then r·1·(1−1) = 0, and the orbit sits on the repelling
        // fixed point 0 for ever. Every |f′| is then exactly r, so λ collapses to
        // the closed form ½(ln a + ln b) — at the corner ln 4 = 1.3863, twice the
        // true ln 2 = 0.6931 that the tent-map conjugacy gives. No burn-in can
        // escape an exact fixed point, so all 21 vertices of the x = 3.5 edge were
        // wrong by more than 0.05 drawn units (median 0.137). x₀ = 0.3 is a
        // generic point of the interval — dynamically identical to 0.7, since
        // f(1−x) = f(x), so the choice is not a lucky orientation — and against
        // the limit at 40 dps it drops the edge median to 0.005 and the whole
        // plate's sign disagreement from 4.20 % to 2.10 %.
        const a=(x+3.5)/7*1.4+2.6, b=(z+3.5)/7*1.4+2.6;
        let xn=0.3;
        const seq = [a,b,a,b], len=4, warm=48, steps=48+Math.round(comp*48);
        for (let i=0; i<warm; i++) { const r=seq[i%len]; xn=r*xn*(1-xn); }
        let lam=0, n=0;
        for (let i=0; i<steps; i++) {
          const r=seq[(warm+i)%len]; xn=r*xn*(1-xn);
          const d=Math.abs(r*(1-2*xn));
          if (d>0 && isFinite(d)) { lam += Math.log(d); n++; }
        }
        return soften((n>0?lam/n:0) * 0.25 * amp, 0.5, 0.9);
      }
    },
    dragon: {
      name: 'Dragon Curve Density',
      formula: 'Heighway dragon: f\u2081(z)=(1+i)z/2, f\u2082(z)=1\u2212(1\u2212i)z/2; drawn: chaos-game density of ONE orbit (60k\u2026180k points as comp), centred in frame, freq zooms',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const g = dragonDensity(40000 + Math.round(clamp(comp, 0, 1) * 8) * 20000);
        // The attractor lives in [\u22121/3, 7/6] \u00d7 [\u22121/3, 2/3]. Its centre is put at
        // the centre of the plate and freq zooms, so the set fills the frame
        // instead of hiding in a fifth of it, which is where the plate axes as
        // the dragon's own coordinates used to leave it.
        const u = 0.41667 + x * freq * 0.26, v = 0.16667 + z * freq * 0.26;
        const fx = (u - DRAGON_X0) / (DRAGON_X1 - DRAGON_X0) * DRAGON_RES - 0.5;
        const fz = (v - DRAGON_Z0) / (DRAGON_Z1 - DRAGON_Z0) * DRAGON_RES - 0.5;
        const i0 = Math.floor(fx), j0 = Math.floor(fz);
        if (i0 < 0 || j0 < 0 || i0 + 1 >= DRAGON_RES || j0 + 1 >= DRAGON_RES) return 0;
        const tx = fx - i0, tz = fz - j0;
        const a = g[j0 * DRAGON_RES + i0],       b = g[j0 * DRAGON_RES + i0 + 1];
        const c = g[(j0 + 1) * DRAGON_RES + i0], d = g[(j0 + 1) * DRAGON_RES + i0 + 1];
        // Bilinear, so the height field is continuous across cell walls; the
        // density is already in [0, 1], so nothing needs folding here \u2014 the
        // round-8 fold, knee 0.9 and ceiling 1.8, guarded an unnormalised sum
        // of Gaussians that no longer exists. (The word for it is left out of
        // this comment on purpose: the #R8 guard reads kernels as source text
        // and would count a mention as a call.)
        const dens = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
        return dens * amp * 1.2;
      }
    },
    chua: {
      name: 'Chua Circuit Attractor',
      formula: 'ẋ=α(y−x−f(x)), ẏ=x−y+z, ż=−βy, α=15.6, β=28, f(x)=−0.714x−0.2145(|x+1|−|x−1|); drawn: √(orbit density) in (x,z)',
      // FIX(r6): the same defect as rossler above, and the same repair. Ten
      // Euler steps of dt = 0.003 is T = 0.030: plane R² 0.999839, non-planar
      // residual 6.3e-4 rms against a peak of 0.0118 — four thousandths of the
      // frame. Chua does become non-planar if integrated far enough (R² 0.088
      // at T = 1.5) but it costs 288 ms per 90-plate to get there, which is not
      // a per-vertex budget on this hardware.
      //
      // The scroll is drawn in the (x, z) projection: y only spans ±0.389 on the
      // attractor against ±2.263 and ±3.638 for x and z, so (x, y) would be a
      // sliver. Measured: plane R² 0.999839 → 0.079, peak 0.0118 → 0.664 at the
      // factory sliders, share of the mesh at the extreme unchanged at 0.012 %,
      // cost per plate 0.39 → 1.00 ms at grid 90 and 2.02 → 2.98 ms at grid 200.
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const alpha = 15.6, beta = 28, m0 = -1.143, m1 = -0.714, dt = 0.01;
        const d = (p, q, r) => {
          const fx = m1*p + 0.5*(m0-m1)*(Math.abs(p+1)-Math.abs(p-1));
          return [alpha*(q - p - fx), p - q + r, -beta*q];
        };
        const step = v => {
          const k1 = d(v[0], v[1], v[2]);
          const k2 = d(v[0]+dt/2*k1[0], v[1]+dt/2*k1[1], v[2]+dt/2*k1[2]);
          const k3 = d(v[0]+dt/2*k2[0], v[1]+dt/2*k2[1], v[2]+dt/2*k2[2]);
          const k4 = d(v[0]+dt*k3[0], v[1]+dt*k3[1], v[2]+dt*k3[2]);
          return [v[0]+dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]),
                  v[1]+dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]),
                  v[2]+dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2])];
        };
        // Measured extents of the double scroll: x ±2.263, z ±3.638.
        const X0 = -2.6, X1 = 2.6, Z0 = -4.1, Z1 = 4.1;
        const acc = new Float32Array(res*res);
        let v = [0.7, 0.01, -0.7];
        const skip = 1500 + Math.floor((t*6) % 3000);
        for (let i = 0; i < skip; i++) v = step(v);
        for (let i = 0; i < 12000; i++) {
          v = step(v);
          const ix = Math.floor((v[0]-X0)/(X1-X0)*res), iz = Math.floor((v[2]-Z0)/(Z1-Z0)*res);
          if (ix >= 0 && ix < res && iz >= 0 && iz < res) acc[iz*res+ix]++;
        }
        let mx = 0; for (const q of acc) if (q > mx) mx = q;
        const out = new Float32Array(res*res);
        for (let i = 0; i < acc.length; i++) out[i] = Math.sqrt(acc[i]/(mx||1)) * amp;
        return out;
      }, 48),
    },
    cantorDust: {
      name: 'Cantor Dust',
      formula: 'Remove middle third recursively in x and z',
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
      formula: 'z_{n+1} = a + b·z_n·e^{i(k−p/(1+|z_n|²))}, a = 0.85+0.05·comp, b = 0.9, k = 0.4, p = 6; drawn: Im z₈',
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
      formula: 'x_{n+1} = r·x_n·(1−x_n), r = 2.5+1.5(x+3.5)/7; drawn: e^{−50d²}, d = closest orbit approach to (z+3.5)/7',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): one orbit point was lit, so in the period-2 window only one
        // of the two branches appeared — the bifurcation the name promises was
        // never on screen, and which branch showed depended on the parity of
        // 40+floor(comp·40), so the picture jumped between branches as the
        // slider moved (measured at r = 3.196: target 0.514 at comp 0.50 and
        // 0.55, 0.799 at 0.525 and 0.575). Lighting the whole visited orbit is
        // what a bifurcation diagram is. Nearest-iterate instead of a sum of
        // Gaussians: identical picture, one exp() per vertex either way.
        const r=2.5+(x+3.5)/7*1.5, steps=40+Math.floor(comp*40);
        // FIX(r9): the seed — the substitution round 8 made in `lyapunov`
        // twenty lines above and left here. x₀ = 0.5 is the critical point of
        // the logistic map and the right edge of the r window is r = 4 exactly:
        // 4·½·½ = 1, then r·1·(1−1) = 0, and the orbit sits on the repelling
        // fixed point 0 for ever. The visited orbit is then ONE value, so the
        // r = 4 column — the chaotic edge a bifurcation diagram exists to show —
        // drew a single bump at the bottom: 28 of 81 vertices above 1e-3 against
        // 81 of 81 on its neighbour at x = 3.4125, and 1 distinct iterate over
        // the 24 sampled against 24 spanning [0.000789, 0.999803] at x₀ = 0.3.
        // 0.3 is a generic point, dynamically identical to 0.7 since
        // f(1−x) = f(x), so the choice is not a lucky orientation.
        //
        // The cost, measured on the meshes the app lays down, because "one
        // column changes" is not what happens: 1341 of 6561 vertices move by
        // more than 1e-3 at the factory sliders on grid 81 (5790 of 25921 on
        // 161), of which 80 are on the r = 4 edge (159 at grid 161) — a subset
        // of the chaotic count below, not a bucket beside it. The whole
        // population splits by the ATTRACTOR of its own column — the period
        // found by cycle closure to 1e-12 after 2e5 iterates (control:
        // r = 3.2 → 2, 3.5 → 4, 3.5644 → 16, 3.8320 → 3, and 3.9 and 4.0
        // aperiodic; no column below r∞ = 3.5699 is misread as aperiodic).
        // Grid 81 at the factory sliders: 1128 of the 1341 fall in the 19
        // aperiodic columns — the chaotic band, where the two seeds sample the
        // same attractor at different points and the speckle simply redraws —
        // and the other 213 fall in PERIODIC columns, where the burn-in
        // (40 + ⌊40·comp⌋, 60 here) has not reached the cycle yet: six columns
        // r = 2.9500–3.0438 astride the period-1 → 2 bifurcation at r = 3,
        // r = 3.4375 beside the period-2 → 4 one at r = 3.44949, and the
        // period-16 and period-10 windows at r = 3.6625 and 3.9063 ABOVE r∞.
        // The first draft's "1143 at r ≥ 3.5699" therefore both left 198
        // movers unexplained and counted 15 window vertices as chaos. Grid 161
        // at the same sliders: 5790 = 4718 chaotic + 1072 periodic, the
        // periodic ones in r = 2.9406–3.0438, 3.4281–3.5406, 3.6625 and
        // 3.9063. Those periodic movers are transient and not a difference of
        // attractor: 5000 extra iterates for BOTH seeds take 213 → 0 and
        // 1072 → 0 (worst |Δ| 7.0e-5), while the chaotic count does not
        // collapse under the same 5000 — 1128 → 1128 at grid 81, 4718 → 4816
        // at 161 — so the test is able to fail. They are small and nearly
        // lit-neutral besides: worst |Δ| 0.0119 at grid 81 with every one of
        // those columns keeping its lit count, 577 → 577; worst 0.0937 at grid
        // 161, where r = 3.4844 (period 4) is the only column to lose real
        // ground, 153 → 148 lit, and the periodic columns together go
        // 2429 → 2420. The split holds over the slider box as
        // total = chaotic + periodic — grid 81: 1442 = 1178 + 264 at amp 1,
        // 1373 = 1195 + 178 at the audio envelope, 1561 = 1293 + 268 at the
        // reachable over-drive, 909 = 825 + 84 at the floor; grid 161:
        // 6291 = 4971 + 1320, 6028 = 5071 + 957, 6960 = 5557 + 1403 and
        // 3931 = 3441 + 490. What
        // the picture keeps: lit share (> 1e-3) 82.81 % → 83.62 %, mean height
        // 0.172804 → 0.177029, per-column lit count moving 0.65 vertices on
        // average, peak 0.35 at the factory sliders and 1.125 over the whole
        // settings box — both unchanged — and no non-finite vertex.
        let xn=0.3;
        for (let i=0; i<steps; i++) xn=r*xn*(1-xn);
        const target=(z+3.5)/7;
        let d2=Infinity;
        for (let i=0; i<24; i++) { xn=r*xn*(1-xn); const d=xn-target; if (d*d<d2) d2=d*d; }
        return Math.exp(-50*d2) * amp * 0.5;
      }
    },
    duffing: {
      name: 'Duffing Oscillator',
      formula: 'ẍ + δẋ − x + x³ = γcos(ωt), δ = 0.25, γ = 0.3, ω = 1; drawn: √(orbit density) in (x, ẋ)',
      // FIX(r8): the flattest of the flow-map plates in this collection.
      // Fifteen Euler steps of dt = 0.01 is T = 0.15, a fortieth of one drive
      // period, so what stood here was position plus velocity times 0.15 —
      // least-squares plane R² = 0.99990. Deleting the terms that make the
      // equation Duffing moved the picture by 1.20 % of its own frame (the whole
      // restoring term −x + x³), 1.74 % (the cubic alone) and 0.24 % (the drive).
      // A plate in which the nonlinearity is worth under two hundredths is not a
      // plate of the nonlinearity. rossler and chua were condemned for exactly
      // this at R² = 1.000000 and 0.999839 and repaired in round 6; duffing was
      // flatter than chua and was left.
      //
      // Same repair, because it is the same defect: one long orbit splatted as a
      // density, instead of a sheet of initial conditions carried a hair's
      // breadth. Measured: plane R² 0.999905 → 0.007436, peak 0.391 → 0.634 at
      // the factory sliders, cost 1.21 → 1.81 ms per 90-plate and 5.74 → 2.46 ms
      // per 200-plate — cheaper there, because the simulation is now paid once
      // per rebuild instead of once per vertex. RK4 and not Euler, for the
      // reason rossler gives: at dt = 0.01 it tracks DOP853 to 1.1e-8 over a
      // drive period and a half, where Euler's first-order error on an
      // oscillatory field is a systematic outward drift.
      //
      // The constants are Holmes's two-well set (δ = 0.25, γ = 0.30, ω = 1) and
      // not the γ = 0.3 + comp·0.15 that stood here. γ is a chaotic parameter,
      // and FIX(r7) above records what the audio does to one of those: every
      // rebuild comes back a fresh realisation of a different invariant measure
      // rather than the next moment of one system. Frozen, the plate changes by
      // 0.0 % between consecutive rebuilds (2.1 % worst) and 15.2 % four seconds
      // apart, which is evolution and not the flashing DISCLAIMER warns about.
      // Largest Lyapunov exponent measured +0.133, so this is an attractor and
      // not a closed curve.
      //
      // The (x, ẋ) plane and not a Poincaré section: a section takes one point
      // per drive period, so filling a 48² grid is ~10⁴ periods, six million RK4
      // steps. The continuous orbit needs 24 000. Against 370 000 DOP853 samples
      // of the same measure the drawn field correlates 0.729 — and 24 000
      // samples of the DOP853 orbit itself correlate 0.769 ± 0.03, so the gap is
      // the sample count and not the integrator.
      //
      // The trade the other thirteen heavy entries already make: fed
      // u = (x+3.5)/7, this entry no longer answers Wave Intensity, and with γ
      // frozen it no longer answers Compression either (measured 0.0000 across
      // comp 0.1–0.9).
      f: createCachedHeavySampler((t, {amp = 1}, res) => {
        const delta = 0.25, gamma = 0.3, omega = 1, dt = 0.01;
        const d = (s, p, v) => [v, -delta*v + p - p*p*p + gamma*Math.cos(omega*s)];
        const step = (s, u) => {
          const k1 = d(s, u[0], u[1]);
          const k2 = d(s+dt/2, u[0]+dt/2*k1[0], u[1]+dt/2*k1[1]);
          const k3 = d(s+dt/2, u[0]+dt/2*k2[0], u[1]+dt/2*k2[1]);
          const k4 = d(s+dt,   u[0]+dt*k3[0],   u[1]+dt*k3[1]);
          return [u[0]+dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]),
                  u[1]+dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1])];
        };
        // Measured extents of the attractor at these constants: x ±1.480,
        // ẋ ±0.831, with a margin. All of a 370 000-sample orbit lands inside.
        const X0 = -1.62, X1 = 1.62, V0 = -0.95, V1 = 0.95;
        const acc = new Float32Array(res*res);
        let u = [0.5, 0.1], s = 0;
        // The dropped transient slides with the clock, as in rossler above, so
        // the traced segment breathes instead of standing still.
        const skip = 3000 + Math.floor((t*6) % 3000);
        for (let i = 0; i < skip; i++) { u = step(s, u); s += dt; }
        for (let i = 0; i < 24000; i++) {
          u = step(s, u); s += dt;
          const ix = Math.floor((u[0]-X0)/(X1-X0)*res), iv = Math.floor((u[1]-V0)/(V1-V0)*res);
          if (ix >= 0 && ix < res && iv >= 0 && iv < res) acc[iv*res+ix]++;
        }
        let mx = 0; for (const q of acc) if (q > mx) mx = q;
        const out = new Float32Array(res*res);
        // sqrt of the occupancy, as in rossler: the invariant measure piles up
        // on the fold and a linear ramp hides the rest of the band under it.
        for (let i = 0; i < acc.length; i++) out[i] = Math.sqrt(acc[i]/(mx||1)) * amp;
        return out;
      }, 48),
    },
    henon: {
      name: 'Hénon Map',
      formula: 'x_{n+1}=1−ax_n²+y_n, y_{n+1}=bx_n, a=1.4, b=0.3+0.2(comp−½); drawn: y₂₀, 0 where |x|,|y| > 10',
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
      formula: 'x_{n+1}=x_n²−y_n²+ax_n+by_n, y_{n+1}=2x_ny_n+cx_n+dy_n, a=0.9, b=−0.6013, c=2, d=0.5; drawn: y₁₂, 0 where |x|,|y|>3',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let px=x*0.3, py=z*0.3;
        // FIX(r6): a = −0.3 is in no published parameter set. The canonical
        // Tinkerbell is a = 0.9 with these same b, c, d (the only other known
        // set is a = 0.3, b = 0.6, c = 2.0, d = 0.27). At a = −0.3 the bounded
        // invariant set measures x [−0.074, 0.062], y [−0.145, 0.113] — about a
        // twentieth of the canonical attractor along each axis — and the plate
        // carried sd 0.0127 against 0.1371 here. The caption above gained its
        // second line at the same time: the height drawn is y_{n+1}, and y's
        // recurrence was not written down anywhere.
        const a=0.9, b=-0.6013, c=2.0, d=0.5;
        for (let i=0; i<12; i++) {
          const nx=px*px-py*py+a*px+b*py; py=2*px*py+c*px+d*py; px=nx;
          if (!isFinite(px)||!isFinite(py)) return 0;
          // Escape guard. Trajectories with magnitude > 10 are visually
          // meaningless and overflow Float32 downstream. Catch them early —
          // unguarded iteration can reach ~1e+267 within a few more steps.
          // FIX(r6): the guard was |·| > 10, five times outside the canonical
          // attractor (x [−1.23, 0.46], y [−1.55, 0.54]). Orbits between 1.6 and
          // 10 are already escaping, so their twelfth iterate is arbitrary — and
          // it is those that set the peak, which is why the peak depended on
          // which vertices the mesh happened to put near one: ×1.84 across the
          // grid sizes the app actually uses (24 discrete values from 3 to 198,
          // set by the selected shape rather than by planeSegs), and ×2.22 once a = 0.9
          // made them bigger. At |·| > 3, twice the attractor's own extent, the
          // spread is ×1.19 and the peak is the surface rather than the guard.
          // 0.45 in place of 0.18 is the display constant that follows: the
          // ceiling fell from 1.8·amp to 0.54·amp, and the factory peak lands at
          // 0.810 with the top of both sliders at 2.604, inside a half-frame of 3.
          if (Math.abs(px) > 3 || Math.abs(py) > 3) return 0;
        }
        return py * 0.45 * amp;
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
      formula: 'Γ(n) = (n−1)! at integers; drawn: 0.22·Γ(n) − 0.6, n = 0.2…3.8',
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
      formula: 'ζ(s) = Σ 1/nˢ; drawn: 0.25·ln ζ(s) − 0.35, s = 1.05 … 3.05+4·comp',
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
      formula: '₂F₁(a,b;c;z) = Σ (a)ₙ(b)ₙ/(c)ₙ·zⁿ/n!; z = 0.25·freq·x clipped to ±0.95, height to ±0.8',
      // FIX: twelve terms with an early exit at 10⁻⁸ that never fired. At the
      // right edge of the reachable domain (z = 0.875 at the default wave
      // intensity, 0.95 once the clamp bites) the twelfth term is still
      // 2.5·10⁻², so the loop always ran to its cap and stopped there — a hard
      // truncation two orders outside the 10⁻³ floor of the tier B this entry
      // is documented at.
      //
      // Euler's transformation ₂F₁(a,b;c;z) = (1−z)^{c−a−b}·₂F₁(c−a,c−b;c;z)
      // does not change |z|, so the geometric rate is the same — what it changes
      // is the algebraic factor: terms fall as zⁿ·n^{c−a−b−1} = zⁿ·n^{−0.5−comp}
      // instead of zⁿ·n^{a+b−c−1} = zⁿ·n^{comp−1.5}. Measured at n = 120, z = 0.95:
      // comp = 0.9 gains 2.4 orders (6.752e-5 → 2.419e-7), comp = 0.7 gains 1.1,
      // and comp = 0.5 gains NOTHING — both exponents are −1.0 there and the two
      // terms agree to three digits. That is also where the worst reachable point
      // lies, so the 6.5e-5 the entry achieves is bought by the cap at 120, not
      // by the transformation. The relative 10⁻¹² exit never fires at z = 0.95:
      // the loop runs all 120 terms at every comp, i.e. the truncation is still
      // hard, just later.
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
      formula: 'L_n(x) = eˣ/n! d^n/dx^n(x^n e^{−x}), n = 3…5; height clipped at ±0.7',
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
      // FIX(r8): the +1e-8 that used to hold r off zero was the entire error of
      // this tier-A entry — measured worst |Δ| 8.22e-9 against mpmath at 40 dps
      // (amp 1, ρ ≈ 0.66, where |d sinc/dρ| is largest), and 0 against
      // sinc(ρ+1e-8), so nothing but the guard was wrong. It also put −6.0e-9 on
      // the ring ρ = 1, where sinc is exactly zero. sin(πρ)/(πρ) is 0/0 at
      // ρ = 0 and nowhere else — one vertex of the mesh — so the special case
      // goes there and the rest of the surface is machine-exact.
      name: 'Cardinal Sinc (radial)',
      formula: 'sinc(r) = sin(πr)/(πr) (normalised), r = √(x²+z²)·2·freq',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq*2;
        const s=r===0 ? 1 : Math.sin(Math.PI*r)/(Math.PI*r);
        return s * amp * 0.6;
      }
    },
    ellipticK: {
      name: 'Elliptic Integral K(k)',
      formula: 'K(k) = ∫₀^{π/2} dθ/√(1−k²sin²θ); drawn: 0.2·K(k) − 0.3, k = max(0.01, 0.98·(x+3.5)/7)',
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
      formula: 'ψ(x) = Γ′(x)/Γ(x), x = 0.2…4.2; height clipped at ±0.6',
      f(x, z, t, {amp=1, freq=1}) {
        const xv=clamp(0.2+(x+3.5)/7*4, 0.2, 4.2);
        // Digamma ψ(x) via recurrence + asymptotic series, ~10⁻¹⁰ accuracy.
        // Uses ψ(x+1) = ψ(x) + 1/x to lift x to x ≥ 8 (where the asymptotic
        // series converges fast), then the standard Bernoulli expansion.
        let xa = xv, psi = 0;
        // Recur up: subtract 1/x for each step to keep ψ(xv) correct
        // FIX(r8): the lift stopped at 8 with four Bernoulli terms, which leaves
        // the first dropped term B₁₀/(10·8¹⁰) = 7.06e-12 — and the measured
        // worst error was 6.77e-12, i.e. that term and nothing else. A tier-A
        // row promising machine precision cannot rest on it, and the row's own
        // prose already said ~10⁻¹⁰, contradicting its letter. Lifting to 12 and
        // carrying B₁₀ costs four more divisions per vertex and puts the first
        // dropped term at B₁₂/(12·12¹²) = 2.4e-15.
        while (xa < 12) { psi -= 1/xa; xa += 1; }
        // Asymptotic: ψ(x) ≈ ln(x) - 1/(2x) - Σ B_{2k}/(2k·x^{2k}) for k=1..5
        // B_2=1/6, B_4=-1/30, B_6=1/42, B_8=-1/30, B_10=5/66
        const x2 = xa*xa, x4 = x2*x2, x6 = x4*x2, x8 = x6*x2, x10 = x8*x2;
        psi += Math.log(xa) - 1/(2*xa)
             - (1/6)/(2*x2)
             - (-1/30)/(4*x4)
             - (1/42)/(6*x6)
             - (-1/30)/(8*x8)
             - (5/66)/(10*x10);
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
      formula: 'f = e^{−(x²−2ρxz+z²)/2σ²(1−ρ²)} / (2πσ²√(1−ρ²)), ρ = 0.4·comp·sin(0.4t)',
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
        // FIX(r6): the (k%2===0?1:-1) below was a contrast trick, and it put
        // 48.3 % of the surface under zero beneath a caption that reads
        // "P(k;λ) = λᵏe^{−λ}/k!". A probability mass function is non-negative by
        // definition; the magnitudes were already exact (1.9e-16 against an
        // exact-rational reference), so dropping the sign costs nothing but the
        // alternation. Peak |y| and the share of the mesh at the extreme are
        // identical before and after — 0.0683 and 0.4 % at the factory sliders.
        return Math.exp(logP) * amp * 0.5 * Math.exp(-z*z*0.35);
      }
    },
    randomWalk: {
      name: 'Brownian Motion (seeded)',
      formula: 'W(t) = Σ ξᵢ√dt',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6): the LCG was re-seeded at EVERY vertex from round((x+3.5)·57.3),
        // so neighbouring vertices carried the endpoints of independent walks —
        // white noise, not a path. Measured: Var[Δy]/(2·Var[y]) = 1.10 at the
        // mesh lag 0.078 and 1.10 at lag 2, flat where a path needs it ∝ lag.
        // One walk, accumulated along x and memoised, restores the increment
        // law at no per-frame cost: the 410 partial sums are built once.
        // FIX(r7): the factor was 0.12 under a note promising the surface kept
        // the size it had. It did not: one walk of 410 steps travels further
        // than the 16 the per-vertex seed used to accumulate, and 0.12 did not
        // pay that back — the peak came out 3.820× small at every t and every
        // slider (a pure scale, so one number fixes it), which left the entry
        // the sixth flattest of the 192. 0.12 × 3.820 restores it: peak 0.2959
        // against 0.2959 at t = 0, 0.3082 against 0.3082 at t = 0.7.
        const m = Math.max(0, Math.min(WALK.length-1, Math.round((x+3.5)*57.3)));
        return WALK[m] * 0.4584 * amp * Math.exp(-z*z*0.35) * (1+Math.sin(t*0.3)*0.2);
      }
    },
    ornsteinUhlenbeck: {
      name: 'Ornstein–Uhlenbeck',
      formula: 'dXt = θ(μ−Xt)dt + σdWt',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): there was no noise in what was drawn. The seed
        // (i·2654435761 + round(x·100)) was read through &0xffff, and
        // round(x·100) advances by only ~8 between neighbouring vertices out of
        // a 65536 period, so every vertex on the row was driven by the same
        // twenty increments. What varied along the row was the initial
        // condition, relaxing smoothly: total variation over span came out at
        // 1.09, which is what a monotone curve gives — a stochastic process
        // does not look like that.
        //
        // Now x is the time axis of a single sample path, integrated from the
        // left edge, so neighbouring vertices share their history and the path
        // is continuous — measured total variation over span 9.91. It is still
        // a pure function of position, so nothing about reproducibility or
        // caching changes. Checked against the two properties that define the
        // process rather than against another implementation: stationary
        // variance 1.84e-2 against σ²/(2θ) = 1.78e-2, and autocorrelation at
        // lag 1.0 of 0.194 against e^{−θ} = 0.223, both within what explicit
        // Euler at dt = 0.05 gives up.
        //
        // FIX(r8, docs): those two references are the continuum ones, and the
        // path drawn here is not the continuum process. Measured against the
        // AR(1) values an explicit-Euler path actually has, the row in
        // MATHEMATICAL_ACCURACY.md gives stationary variance 2.17e-2 against
        // 1.85e-2 and lag-1 autocorrelation 0.246 against 0.210 — about 17 %
        // out, and it is the discretisation rather than the noise: the hash32
        // increments pass a KS test against U(−1,1) at p = 0.86. This comment
        // stated only the round-6 pair, so the two files disagreed about the
        // same two quantities; the numbers here are the row's, not a fresh
        // measurement.
        //
        // The wave-intensity slider now selects how long a stretch of the path
        // is on screen; it used to do nothing at all here.
        //
        // FIX(r7): it selected that stretch by scaling x and not the recentring
        // offset — `(x·freq + 3.5)/7·steps` — so above freq = 1 both ends of
        // the row ran off the path and were held by the clamp. n = 0 does not
        // even enter the loop, so the left part returned a literal zero. The
        // share of each row sitting at its own edge value went 0.022 at freq 1
        // (the metric's own floor) to 0.178 at 1.2, 0.356 at 1.5 and 0.511 at
        // 2.0 — the tabletop this round set out to remove, moved just past the
        // factory slider where the plateau guard does not look. The stretch is
        // chosen by making the path longer instead, so the whole of it is
        // always on screen: at freq = 1 this is bit-identical to before.
        //
        // The path is also built once per (θ, length) rather than per vertex.
        // The loop body read only `i` and θ, so all 40 000 vertices of a 200²
        // mesh were re-walking prefixes of the same path: 3.01 ms per plate at
        // grid 90 against 0.73 ms before this entry was touched. Memoised the
        // way WALK above is, it is 0.75 ms. Still a pure function of position.
        const theta=1+comp, steps=clamp(Math.round(128*freq), 16, 512);
        const path=ouPath(theta, steps);
        const n=clamp(Math.round((x+3.5)/7*steps), 0, steps);
        return path[n] * 0.9 * amp * Math.exp(-z*z*0.35);
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
      // FIX(r8): p was held off its own endpoints by 0.001. Unlike a pole
      // guard, that was excluding a point where the function is defined —
      // p log p → 0, so H(0) = H(1) = 0 — and the two end columns of the plate
      // were drawn at H(0.001) = 0.0114 bits instead, measured 1.05e-2 of error
      // at amp 2.25 under a row rated A. NaN is what the clamp was really
      // avoiding (0·log 0), and a branch on the endpoints avoids it without
      // moving the abscissa.
      f(x, z, t, {amp=1, freq=1}) {
        const p=clamp((x+3.5)/7, 0, 1);
        const H=(p<=0||p>=1) ? 0 : -(p*Math.log2(p)+(1-p)*Math.log2(1-p));
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
        // FIX(r6): the normalisation 2*pi*I0(kappa) written in the caption was
        // dropped, and it is not a constant: kappa = 1 + comp*4 and comp rides
        // the mid band, so 2*pi*I0 runs 30.7 at comp 0.5 and 120.0 at comp 0.9.
        // The surface therefore changed height by a factor of 3.9 with the
        // music while claiming to be a probability density, and it stood 3.5
        // world units tall at the factory sliders against a ~3-unit frame.
        // With the normalisation restored it IS the density, and its peak
        // e^kappa/(2*pi*I0(kappa)) grows only as sqrt(kappa/2*pi).
        const theta=x*freq*Math.PI, mu=t*0.4, kappa=1+comp*4;
        return Math.exp(kappa*Math.cos(theta-mu))/(TAU*besselI0(kappa)) * amp * 1.6 * Math.exp(-z*z*0.35);
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
      formula: 'Av = λv, A = R(0.3t)·diag(1+comp,−1)·R(0.3t)ᵀ, v = freq·(x,z); drawn: (v×Av)/|v|, zero on the eigenvectors',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): two defects under one name, and the second explains the
        // first. Nothing eigen was computed — the height was 0.3·(Av)₁ +
        // 0.2·(Av)₂, a fixed linear functional of a matrix–vector product,
        // which the name and 'Av = λv' do not describe. And the old matrix
        // [[cos0.3t, comp·sin0.4t], [−comp·sin0.4t, −cos0.3t]] is EXACTLY zero
        // whenever cos(0.3t) and sin(0.4t) vanish together, i.e. at t = 5π +
        // 10πk: the whole plate went flat (peak 7.5e-17) once every 65 s of
        // playback and came back, which the round-4 uptime test stepped over.
        //
        // Now A(t) = R(θ)·diag(λ₁,λ₂)·R(θ)ᵀ with θ = 0.3t, λ₁ = 1+comp,
        // λ₂ = −1: symmetric, eigenvalues fixed and distinct, so A can never
        // degenerate — only its eigenvectors turn. v is an eigenvector exactly
        // when Av is parallel to v, so the height is the cross product
        // (v × Av)/|v| — the signed distance from Av to the line through v.
        // It vanishes precisely on the two eigenvectors, so the picture shows
        // them as a rotating pair of nodal lines, and it stays linear in |v|,
        // the same growth in the slider the entry had before.
        const th=t*0.3, c=Math.cos(th), s=Math.sin(th);
        const l1=1+comp, l2=-1;
        const a11=l1*c*c+l2*s*s, a12=(l1-l2)*c*s, a22=l1*s*s+l2*c*c;
        const vx=x*freq, vz=z*freq;
        const n=Math.sqrt(vx*vx+vz*vz);
        if (n < 1e-9) return 0;
        const ax=a11*vx+a12*vz, az=a12*vx+a22*vz;
        return ((vx*az - vz*ax) / n) * amp * 0.23;
      }
    },
    determinant: {
      name: 'Determinant Surface',
      formula: 'det A = freq²·x·z − sin 0.4t·cos 0.3t, A = [[freq·x, sin 0.4t],[cos 0.3t, freq·z]]',
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
      formula: 'tr(Aⁿ); drawn: cosⁿ(r), r = freq·√(x²+z²), n = 3…4',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*3), r=Math.sqrt(x*x+z*z)*freq;
        return Math.pow(Math.cos(r), n) * amp * 0.5;
      }
    },
    tensorField: {
      name: '2D Tensor Field',
      formula: 'T = [[u²,uw],[uw,w²]], u = 0.7·freq·x, w = 0.7·freq·z; drawn: T₁₁+T₁₂+T₂₂, not an invariant',
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
      formula: 'R(θ)·v, v = freq·[x,z], θ = 0.5t; drawn: sin(π·(R(θ)v)₁)',
      f(x, z, t, {amp=1, freq=1}) {
        const th=t*0.5, rx=Math.cos(th)*x*freq-Math.sin(th)*z*freq;
        return Math.sin(rx * Math.PI) * amp * 0.4;
      }
    },
    gram: {
      name: 'Gram–Schmidt Surface',
      formula: 'e₁=v₁/|v₁|, v₁=(cos 0.3t, sin 0.3t), e₂=v₂−(v₂·e₁)e₁; drawn: |e₂| = dist(v₂, span e₁), v₂ = freq·(x,z)',
      // FIX(r8): v₁ = (cos 0.3t, sin 0.3t) has |v₁| ≡ 1, so the +1e-9 that was
      // meant to keep the normalisation safe could never fire — it only made e₁
      // a non-unit vector by one part in 10⁹, which is the whole error of a row
      // rated A: measured 1.79e-8 worst over the reachable box.
      f(x, z, t, {amp=1, freq=1}) {
        const v1x=Math.cos(t*0.3), v1z=Math.sin(t*0.3);
        const n1=Math.sqrt(v1x*v1x+v1z*v1z);
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
      formula: 'Pv = v − Aᵀ(AAᵀ)⁻¹Av, A = [cos 0.4t, sin 0.4t], v = freq·(x,z); drawn: sin(3|Pv|)',
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
        // FIX(r6): √|disc| is |λ₁ − λ₂|, the SPREAD of the eigenvalues — the
        // tr/2 term and the halving from the quadratic formula were both
        // missing, and here the trace is not zero (tr = x·freq·comp), so the
        // two quantities are genuinely different: over the plate the ratio of
        // the old kernel to ρ ran across [0.220, 0.600], a spread of ×2.72,
        // which no constant rescaling can absorb.
        //
        // Both branches of the quadratic need saying out loud. Real pair: the
        // root larger in modulus is (|tr| + √disc)/2. Complex pair: λ and λ̄
        // multiply to det, so |λ| = √det — and that value is NOT a root of the
        // real characteristic polynomial, which is why the check for this fix
        // is split by branch (probes/fix-linalg.mjs; the first version of that
        // check forgot the split and failed a correct candidate).
        const a=x*freq*(1+comp), b=z*freq, c=Math.sin(t*0.5)*comp, d=-x*freq;
        const tr=a+d, det=a*d-b*c, disc=tr*tr-4*det;
        const rho = disc >= 0 ? (Math.abs(tr) + Math.sqrt(disc)) / 2 : Math.sqrt(det);
        // The clamp at 0.8 went with it: it was pinning 57.8 % of the mesh at
        // the default slider and 97.8 % at the maximum — a flat plate standing
        // in for a wrong number.
        return rho * amp * 0.27;
      }
    },
    matrixExp: {
      name: 'Matrix Exponential',
      formula: 'e^A = Σ Aⁿ/n!; drawn: cosh(r·comp)·cos(r) − 1, r = freq·√(x²+z²)',
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
        const f2=freq;
        // F must be rotational, or there is nothing to see: the previous field
        // was F = (sin(x·f)·cos(z·f), cos(x·f)·sin(z·f)), a gradient field, and
        // the curl of a gradient is identically zero — the stencil that used to
        // stand here was correct and returned 1e-14 everywhere, i.e. a
        // dead-flat plate. F = (Fx, Fz) = (−sin(z·f), sin(x·f)).
        //
        // FIX(r6): that stencil was central differences with h = 0.01, which
        // gives 4–5 correct digits, not the ~1e-10 tier A claims: measured
        // 3.3e-5 against the closed form at the default slider and 6.9e-4 at
        // the top of it. Both partial derivatives are elementary here, so
        // there is nothing to approximate — curl = f·(cos(x·f) + cos(z·f)),
        // and dividing by f keeps a derivative-valued formula from scaling
        // with the frequency slider.
        return (Math.cos(x*f2)+Math.cos(z*f2)) * amp * 0.25;
      }
    },
    jacobian: {
      name: 'Jacobian Determinant',
      formula: 'J = det[∂(u,v)/∂(x,z)]',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6): central differences with h = 0.01 gave 3–5 correct digits,
        // degrading with frequency — measured 9.1e-5 against the closed form at
        // the default slider, 3.9e-2 at the top — on an entry rated A.
        //
        // The map has to be written down before it can be differentiated, and
        // writing it down is what the old stencil never did. It varied only the
        // second occurrence of z in `sin(z·f·0.9 + z·f)`, so the derivative it
        // formed was f·cos(1.9·f·z) rather than 1.9·f·cos(1.9·f·z) — which is
        // the honest derivative of a different map, the one whose z-part
        // carries amplitude 1/1.9. That map is the one drawn here, unchanged:
        //   u = cos(f(x+z)),  v = sin(1.3·f·x) + sin(1.9·f·z)/1.9
        // and its Jacobian determinant is exact in closed form.
        const f2=freq;
        const J = f2*f2*Math.sin(f2*(x+z))*(1.3*Math.cos(1.3*f2*x) - Math.cos(1.9*f2*z));
        return J * amp * 0.1;
      }
    },
    manifoldCurvature: {
      name: 'Gaussian Curvature',
      formula: 'K = (eg−f²)/(EG−F²) of h(x,z) = (sin(x·freq)+sin(z·freq))(0.3+0.3·comp); folded above 1.2',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): only the numerator was computed. The first fundamental form
        // (EG − F²) = (1 + F_x² + F_z²)² is named in the formula string right
        // above and was missing from the code, so what was drawn was the
        // determinant of the Hessian — not a curvature but a different
        // quantity, off by up to 3.2e-2 against the exact K on a plate whose
        // whole range is 3.0e-2. That is a distortion of shape, not of scale.
        const f2=freq, s=Math.sin, c=Math.cos, h=0.05;
        const F0 = (x,z) => (s(x*f2)+s(z*f2))*(0.3+comp*0.3);
        const fx=(F0(x+h,z)-F0(x-h,z))/(2*h);
        const fz=(F0(x,z+h)-F0(x,z-h))/(2*h);
        const fxx=(F0(x+h,z)-2*F0(x,z)+F0(x-h,z))/h/h;
        const fzz=(F0(x,z+h)-2*F0(x,z)+F0(x,z-h))/h/h;
        const fxz=(F0(x+h,z+h)-F0(x+h,z-h)-F0(x-h,z+h)+F0(x-h,z-h))/(4*h*h);
        const g=1+fx*fx+fz*fz;
        // The display constant rose 0.15 → 6.0 with it. The old one was
        // calibrated against the numerator alone and left the surface 1 % of
        // the frame high — a flat plate at the default slider (peak 0.021) —
        // while the ±0.6 clamp flattened 84 % of the mesh at the top of the
        // slider. K itself grows as freq⁴ where both slopes vanish, so the
        // over-drive range is folded rather than cut: see `soften`.
        return soften((fxx*fzz-fxz*fxz)/(g*g)*amp*6.0, 1.2, 2.6);
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
      // FIX(r11): sin² + cos² = 1 is a constant; what this kernel forms is
      // sin² − cos², the other sign, which is −cos(2(r+t)) — the double-angle
      // identity, not the Pythagorean one. The arithmetic is exact either way
      // (checked against PARI/GP at 40 digits: at (1.3, −0.4) with the factory
      // sliders the kernel returns −0.20964089841172726 and −cos(2r)·0.7·0.45
      // agrees), so nothing about the drawing changes here — only the label
      // stops naming the wrong identity. A viewer who reads "Pythagorean
      // Identity" and sees a full-height radial wave has caught the app in a
      // claim it cannot keep: the identity's own value is 1 everywhere.
      name: 'Double-Angle Wave −cos 2(r+t)',
      formula: 'sin²(r+t) − cos²(r+t) = −cos(2(r+t)), r = 2·freq·√(x²+z²)',
      // FIX(r8): the +1e-9 on r guarded nothing — sin²−cos² = −cos(2r) is
      // analytic at the origin and there is no division here — and it cost
      // |d(−cos 2r)/dr|·1e-9·amp·0.45 = up to 2.03e-9, measured against mpmath,
      // under a row rated A (1e-10…1e-14).
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq*2;
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
      // FIX(r11): the name quoted an identity, cosh^2 - sinh^2 = 1, that the kernel never forms: it computes (cosh(0.7·freq·rho) - 1), an exponentially growing bowl. There are no squares and no difference anywhere in it.
      // Renamed from 'Cosh²−Sinh²=1 Surface': the <option> label is the only text a
      // viewer reads for an entry — the caption never reaches the DOM.
      name: 'cosh Bowl (cosh ρ − 1)',
      formula: 'cosh²−sinh²=1; drawn: cosh(0.7r) − 1, r = freq·√(x²+z²)',
      f(x, z, t, {amp=1, freq=1}) {
        const r=Math.sqrt(x*x+z*z)*freq;
        return (Math.cosh(r*0.7)-1) * amp * 0.25;
      }
    },
    chebyshevTrig: {
      name: 'Chebyshev Identity cos(nθ)',
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
      formula: 'Σ_{n≤6} sin(n k x)·cos(nωt)/n · e^{−z²/4}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        let v=0;
        for (let n=1; n<=6; n++) v+=Math.sin(n*x*freq*2)*Math.cos(n*t*0.8)/n;
        return v * amp * 0.3 * Math.exp(-z*z*0.25);
      }
    },
    circularFunctions: {
      name: 'sec · csc Landscape',
      formula: 'sec(2x·freq + 0.3t)·csc(2z·freq), pole band |cos|,|sin| ≤ 0.1 blanked to 0, clipped to ±0.7',
      f(x, z, t, {amp=1, freq=1}) {
        const xv=x*freq*2, zv=z*freq*2;
        const c=Math.cos(xv+t*0.3), s=Math.sin(zv);
        return clamp((Math.abs(c)>0.1 ? 1/c : 0) * (Math.abs(s)>0.1 ? 1/s : 0) * 0.04 * amp, -0.7, 0.7);
      }
    },
    atan2Field: {
      name: 'atan2 Phase Field',
      formula: 'φ(x,z) = atan2(z,x); drawn: sin(3φ + 2r − t), r = freq·√(x²+z²)',
      f(x, z, t, {amp=1, freq=1}) {
        const angle=Math.atan2(z, x);
        const r=Math.sqrt(x*x+z*z)*freq;
        return Math.sin(angle*3+r*2-t) * amp * 0.45;
      }
    },
    inverseTrig: {
      name: 'Arcsin Surface',
      formula: 'y = arcsin(clamp(x·f)) · e^{−0.35z²}',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6): the argument was held off +/-1 by 1e-6 and then again by
        // 1e-9, and asin(+/-1) = +/-pi/2 needs neither. The saturated rim is not
        // one vertex - at freq 1.5 it is 31.9 % of the row - and every point on
        // it sat 4.243e-4 world units below where it belongs, on an entry rated
        // A. Clamping to exactly +/-1 costs nothing and is exact.
        const xv=clamp(x*freq*0.28,-1,1);
        return Math.asin(xv) * amp * 0.3 * Math.exp(-z*z*0.35);
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
      formula: 'e^{iθ} = cos θ + i·sin θ; drawn: Re e^{i(θ+0.5t)}·e^{−0.3z²}, θ = 2·freq·x',
      f(x, z, t, {amp=1, freq=1}) {
        const theta=x*freq*2;
        return Math.cos(theta+t*0.5) * amp * 0.45 * Math.exp(-z*z*0.3);
      }
    },
    eulerIm: {
      name: "Euler's Formula Im(e^{iz})",
      formula: 'Im(e^{i(x+iz)}) = e^{−z}sin(x), x → freq·x+0.4t, z → freq·z, folded above 0.9',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6): the kernel is exact - this really is Im(e^{i(x+iz)}) - but
        // e^{-z*freq} has no envelope and no companion that decays, so the
        // z = -3.5 edge climbed to 10.4 world units at the FACTORY sliders
        // against a frame about 3 units high, and grew without limit across the
        // slider range. Folded rather than cut: the oscillation stays exactly
        // as computed wherever it is legible, and only the exponential tail
        // saturates.
        return soften(Math.exp(-z*freq)*Math.sin(x*freq+t*0.4) * amp * 0.45, 0.9, 1.8);
      }
    },
    moivre: {
      name: "De Moivre's Theorem",
      formula: '(cos θ+i sin θ)^n = cos(nθ)+i sin(nθ); drawn: cos(nθ+0.3t)·e^{−0.3z²}, θ = 2·freq·x, n = round(1+6·comp)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*6), theta=x*freq*2;
        return Math.cos(n*theta+t*0.3) * amp * 0.45 * Math.exp(-z*z*0.3);
      }
    },
    complexPower: {
      name: 'Complex Power |z^z|',
      formula: '|z^z|, z = freq·(x+iz), folded above 0.5',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r8): the +1e-9 that used to sit on r WAS this entry's whole
        // residual. Against mpmath's abs(mpc(x,z)**mpc(x,z)) at 50 dps (control:
        // |i^i| = e^{−π/2} = 0.20787957635076190855, |(1+i)^{1+i}| =
        // exp(ln√2 − π/4), both reproduced to 1e-51, and cross-checked in
        // PARI/GP) the drawn value was out by 4.77e-10 outside the fold; against
        // the same expression WITH the epsilon put back it agreed to 1.29e-16.
        // A row rated 1e-14 was reporting the size of its own guard constant.
        const r=Math.sqrt(x*x+z*z)*freq;
        const theta=Math.atan2(z*freq,x*freq);
        const logMod=Math.log(r), arg=theta;
        // FIX(#2, r4): |z^z| = exp(Re(z·Log z)) = exp(x·ln|z| − y·arg z). The
        // first term used to be `r*logMod` — the modulus in place of the real
        // part. The two are the same number only on the positive real axis,
        // where every existing assertion for this entry happened to sit; over
        // the whole x < 0 half the result was exponentially too large (at
        // z = −2 it returned 0.4 against a true 0.025) and a fifth of the mesh
        // sat pinned at the +0.7 clamp instead of collapsing toward zero.
        // r = 0 is not a pole and must not be handed the display bound: both
        // terms of the exponent go to zero with r (|x| ≤ r, |y·arg z| ≤ πr), so
        // |z^z| → 1 from every direction — mpmath over eight directions gives a
        // spread of 9.2e-2 at |z| = 1e-2 collapsing to 1.4e-28 at |z| = 1e-30.
        // The singularity is removable, so the limit is returned. Saturating
        // here instead would put back exactly the grid-parity needle round 6
        // took out of complexLog.
        const realExp=r===0 ? 0 : x*freq*logMod-z*freq*arg;
        // FIX(r6): clamp -> fold, for the same reason as elsewhere in this
        // round: exp grows without bound, so the cut produced a plateau (10.2 %
        // of the mesh at the default slider) where the surface should keep its
        // relief.
        return soften(Math.exp(realExp)*0.1*amp, 0.5, 0.85);
      }
    },
    rootsOfUnity: {
      name: 'n-th Roots of Unity Heights',
      formula: 'z_k = e^{i(2πk/n+0.3t)}, n = 6…8; drawn: Σ_k e^{−4|freq·z−z_k|²}, a bump at each root',
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
      formula: 'Log(z) = ln|z| + i·arg(z); drawn: Re Log = ln|z|, pulsed by (1+0.2sin(0.4t)), smoothed inside |z| < 0.08',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6): ln|z| runs to −∞ at the origin, and the +1e-9 regulariser
        // turned that into a needle of fixed depth rather than removing it:
        // wherever the mesh has a vertex at r = 0 — eleven of the twelve odd
        // grid sizes the app can reach, and the grid is set by the SHAPE and
        // not by planeSegs: round(sqrt(vertexCount)) takes 24 values from 3 to
        // 198 over the twenty shapes — one vertex sat 4.14 units
        // below a surface whose own peak is 0.58. The picture therefore had a
        // spike on some machines and not on others, and the depth of the spike
        // was set by the epsilon, which is a statement about floating point
        // rather than about the logarithm.
        //
        // Softening the radius itself says what is actually meant: the surface
        // is Log(z) outside a small disc, and the disc has a size a viewer
        // could see (0.08 world units) instead of 10⁻⁹.
        // FIX(r8): √(r²+ε²) is not ln|z| anywhere — the bias is ½ln(1+ε²/r²),
        // which is small but never zero, so "ln|z| outside a disc of radius
        // 0.08" was false on 100 % of the vertices and by 5.8e-2 at r = 0.07.
        // Outside the disc the logarithm is now itself; inside, the quadratic
        // that meets it in value and slope at the rim, which is what "a disc a
        // viewer can see" was always meant to say.
        const R0=0.08;
        const r=Math.hypot(x*freq, z*freq);
        const lg = r >= R0 ? Math.log(r) : Math.log(R0) + (r*r - R0*R0)/(2*R0*R0);
        return lg * amp * 0.2 * (1+Math.sin(t*0.4)*0.2);
      }
    },
    riemannSphere: {
      name: 'Riemann Sphere Projection',
      formula: 'ζ = (x²+z²−1)/(x²+z²+1) — the height of the stereographic image',
      f(x, z, t, {amp=1, freq=1}) {
        const r2=(x*freq)**2+(z*freq)**2;
        return (r2-1)/(r2+1) * amp * 0.5;
      }
    },
    mobiusTransform: {
      name: 'Möbius Transformation',
      formula: 'f(z) = (az+b)/(cz+d), a = d = 1, b = comp·sin(0.4t), c = comp·cos(0.3t); drawn: Re f, folded above 0.5',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const a=1, b=Math.sin(t*0.4)*comp, c=Math.cos(t*0.3)*comp, d=1;
        const zre=x*freq, zim=z*freq;
        const cre=c*zre+d, cim=c*zim;
        // FIX(r8): the +1e-9 on |cz+d|² was this entry's whole residual. Against
        // mpmath complex division at 50 dps (control: f(0) = b/d exactly, and
        // the cross-ratio of four points is invariant under the map to 3.3e-51)
        // the drawn value was out by 1.45e-9 outside the fold; against the same
        // division WITH the epsilon it agreed to 4.52e-17.
        const den2=cre*cre+cim*cim;
        const num_re=a*zre+b, num_im=a*zim;
        // The pole at z = −d/c is real, and there the epsilon was not softening
        // anything — it was choosing a finite height for an infinite value. With
        // it gone the numerator vanishes too, so the quotient is 0/0. |Re f| → ∞
        // on both sides of the pole, so the fold saturates on both sides; the
        // sign is not determined by the map (both are attained in every
        // neighbourhood), so the ceiling is returned through soften() itself
        // rather than as a literal, and stays tied to this entry's knees.
        if (den2===0) return soften(Infinity, 0.5, 0.85);
        const wre=(num_re*cre+num_im*cim)/den2;
        // FIX(r6): clamp -> fold. A Moebius map has a pole at z = -d/c, which is
        // inside the plate whenever |c| is large enough, so the cut was doing
        // real work - 10.8 % of the mesh flat at the default slider - but a fold
        // does the same work without erasing the neighbourhood of the pole.
        return soften(wre * amp * 0.35, 0.5, 0.85);
      }
    },
    cauchyRiemann: {
      name: 'Re(z²) — Harmonic Saddle',
      formula: 'u = Re(z²) = x²−z², harmonic, so CR hold identically',
      f(x, z, t, {amp=1, freq=1}) {
        // Re(z²) = x²-z² — analytic → CR satisfied
        return ((x*freq)**2-(z*freq)**2) * amp * 0.18 * (1+Math.sin(t*0.3)*0.2);
      }
    },
    complexSin: {
      // FIX(r11): the name promised Re sin(z), and the real part of a holomorphic function must be harmonic. The plate is sin(freq·x)·cosh(freq·z/2) — the imaginary axis compressed by two — so Delta u = (-1 + 1/4)u = -0.75u, never zero, and freq cannot absorb the two because it scales both axes alike. Deviation from the named function at the app's boot sliders: 2.858 world units.
      // Renamed from 'Complex sin(z) Real Part': the <option> label is the only text a
      // viewer reads for an entry — the caption never reaches the DOM.
      name: 'sin x · cosh(z/2) Surface',
      formula: 'Re(sin(x+iz/2)) = sin(x)cosh(z/2), x → freq·x+0.3t, z → freq·z, folded above 0.7',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r8): the same repair round 6 gave catenoid, applied to the clamp
        // it missed. cosh grows, so the ±0.7 cut was not a safety net but the
        // picture over most of the slider: 84.2 % of the mesh sat bit-exactly
        // on the bound at the slider maxima (the quantity being cut reaches 969
        // world units there), 51.8 % at the FACTORY amplitude once freq passes
        // 3.0, 40.8 % at amp max with freq left at 1. Round 6 measured its
        // one-third criterion at the factory sliders alone, where this entry
        // peaks at 0.622 and the clamp never bites, which is why it survived.
        //
        // The knee is the old bound, so `soften` is the identity exactly where
        // the clamp was not biting: 400 000 random points over the reachable
        // box are bit-identical to the old kernel wherever |value| ≤ 0.7, and
        // the factory picture is unchanged to the last bit. Above it the excess
        // is folded instead of cut, so the tabletop keeps its ordering and its
        // gradient. It does not make cosh gentle — at the maxima most of the
        // plate still sits within a hair of the ceiling — but nothing is
        // bit-equal to its neighbour any more, and the shoulder is real.
        return soften(Math.sin(x*freq+t*0.3)*Math.cosh(z*freq*0.5) * amp * 0.3, 0.7, 1.4);
      }
    },
    juliaPotential: {
      name: 'Julia Potential',
      formula: 'G(z) = lim log|fⁿ(z)|/2ⁿ',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const cr=-0.4+Math.sin(t*0.2)*0.3*comp, ci=0.6+Math.cos(t*0.15)*0.2*comp;
        // FIX(r6): the caption defines G(z) = lim log|fⁿ(z)|/2ⁿ, and the 2⁻ⁿ is
        // what makes that limit exist — it is the whole content of the Green's
        // function. The code returned log₂(log|z_n|) instead: the logarithm of
        // the potential, plus the escape index, which is a different surface.
        // Against G computed to convergence (200 iterations, escape radius
        // 10⁵⁰) the old expression was off by up to 2.158 on a range whose own
        // maximum is 1.612 — the error exceeded the quantity. Now 1.8e-3, the
        // truncation left by stopping at twelve iterations.
        let zx=x*freq, zy=z*freq, r2=0;
        const maxIt=12;
        for (let i=0; i<maxIt; i++) {
          r2=zx*zx+zy*zy;
          if (r2>100) return Math.log(Math.sqrt(r2))/Math.pow(2,i) * amp * 0.55;
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
        // FIX(r6): the contour was traversed n_loops times but sampled N = 48
        // times TOTAL, so each loop got only 12–16 nodes. Deep inside and far
        // outside that still gave the right integer — this was never wrong at
        // the centre — but the undersampled midpoint sum carries a ring of
        // spurious poles at |z₀| = 1, on the contour itself, and there the
        // value is whatever the mesh happens to land on: peak 0.62 / 1.39 /
        // 7.87 / 6.22 across grids 25 / 90 / 161 / 400, a spread of ×12.8. The
        // grid is round(sqrt(vertexCount)) of the SELECTED SHAPE — 24 discrete
        // values from 3 to 198, not planeSegs, which is only ever 80 or 160 —
        // so that ring was a different picture on every machine AND on every
        // shape.
        //
        // A winding number is an integer, and the way to compute one is to
        // accumulate argument increments rather than to integrate 1/(z−z₀):
        // each step contributes the angle subtended at z₀, folded into (−π, π],
        // and nothing blows up however close z₀ comes to the contour. Nodes are
        // now per loop, not shared between them. Result: exactly n_loops inside
        // and exactly 0 outside, identical at every mesh density.
        const N = 32 * n_loops;
        let total = 0, prev = 0;
        for (let k = 0; k <= N; k++) {
          const phi = k * (n_loops * 2 * Math.PI / N) + t * 0.05;
          const arg = Math.atan2(R * Math.sin(phi) - z0im, R * Math.cos(phi) - z0re);
          if (k > 0) {
            let d = arg - prev;
            while (d >  Math.PI) d -= 2*Math.PI;
            while (d < -Math.PI) d += 2*Math.PI;
            total += d;
          }
          prev = arg;
        }
        return (total / (2 * Math.PI)) * amp * 0.18;
      }
    },
    blaschke: {
      name: 'Blaschke Product |B(z)|',
      formula: 'B(z) = Π (z−aₖ)/(1−āₖz), aₖ = 0.6e^{i(2πk/n+0.2t)}; drawn: 0.45·amp·|B| − 0.2, folded above 0.45',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(2+comp*3);
        let re=1, im=0;
        for (let k=0; k<n; k++) {
          const ak_re=Math.cos(TAU*k/n+t*0.2)*0.6, ak_im=Math.sin(TAU*k/n+t*0.2)*0.6;
          const zr=x*freq, zi=z*freq;
          const num_r=zr-ak_re, num_i=zi-ak_im;
          const den_r=1-ak_re*zr-ak_im*zi, den_i=-ak_re*zi+ak_im*zr;
          // FIX(r8): the +1e-9 on |1−āₖz|² was this entry's whole residual, and
          // it is measurable without implementing anything: for |aₖ| < 1 the
          // Blaschke product has |B| = 1 on |z| = 1 identically, so the drawn
          // height on the unit circle must be soften(amp·0.45 − 0.2) exactly.
          // It was off by 3.65e-9 at amp = 1 — the size of the guard. Away from
          // the circle, against mpmath at 50 dps, 3.50e-9 outside the fold,
          // against the same product WITH the epsilon 2.49e-16.
          const d2=den_r*den_r+den_i*den_i;
          // 1 − āₖz vanishes at z = 1/āₖ, modulus 1/0.6 = 1.667, which is inside
          // the plate at every reachable freq. |aⱼ| = 0.6 there for every j, so
          // no other factor can be zero at the same point: |B| really is
          // infinite, and the fold's ceiling is the honest height. Returned
          // through soften() so it tracks this entry's knees.
          if (d2===0) return soften(Infinity, 0.45, 0.85);
          const wr=(num_r*den_r+num_i*den_i)/d2, wi=(-num_r*den_i+num_i*den_r)/d2;
          const nr=re*wr-im*wi, ni=re*wi+im*wr;
          re=nr; im=ni;
        }
        // FIX(r6): |B| grows fast outside the unit disc, and the +/-0.6 clamp
        // swallowed the surface - 89.7 % of the mesh pinned flat at the bound at
        // the default wave intensity, 99.6 % at the top of the slider. The
        // viewer got a small disc on a table. Folded instead of cut.
        return soften(Math.sqrt(re*re+im*im) * amp * 0.45 - 0.2, 0.45, 0.85);
      }
    },
    complexHeat: {
      name: 'Heat Kernel in ℂ',
      formula: 'K(z,τ) = 1/(4πτ)·e^{−|z|²/4τ}, τ = 0.3+0.05·(t mod 24), replayed every 24 units of t ≈ 50 s at 60 fps',
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
      // FIX(r11): the height is sin(n·arg z), not arg z, so the surface is two-valued in the very phase it claims to show; n = round(1+4·comp) never reaches 1. The colour is taken from the height alone, so 'Color' named nothing of its own either.
      // Renamed from 'Argand Phase Color': the <option> label is the only text a
      // viewer reads for an entry — the caption never reaches the DOM.
      name: 'Phase Petals sin(n·arg z)',
      // FIX(r8): what is drawn is the sine of the named quantity, not the
      // quantity — so the surface is two-to-one in the phase (π/6 and 5π/6 give
      // the same height) and spans ±0.45 rather than ±π. The accuracy row's own
      // rationale column already said sin(n·θ); only this line disagreed.
      formula: 'sin(arg(zⁿ))',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*4);
        const theta=Math.atan2(z*freq,x*freq);
        return Math.sin(n*theta+t*0.4) * amp * 0.45;
      }
    },
    riemannZetaStrip: {
      name: 'Riemann ζ Critical Line',
      formula: 'ζ(½+iT), T = 30(freq·x+3.5)/7; drawn: Re(e^{i·freq·z}·ζ) — the critical line, turned by z',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r9): Σ_{n≤N} n^{−(½+iT)} converges NOWHERE on the critical line,
        // so this was not ζ and would not have become ζ with more terms. Against
        // mpmath at 40 dps the z = 0 row carried rms 0.1405 on an oracle rms of
        // 0.1238 at the FACTORY sliders — 113.5 % — with 15 of 86 sampled
        // vertices on the wrong side of zero, i.e. the zeros a reader looks for
        // were not ζ's. Worst vertex 0.9508 at T = 0, where the partial sum
        // reads Σ n^{−½} = +7.60 against ζ(½) = −1.4604.
        //
        // Euler–Maclaurin closes it inside the same term budget — the repair
        // `zeta` took in round 5, carried over to complex s: N−1 direct terms,
        // the integral tail, then four Bernoulli corrections. Worst error on the
        // same row is now 1.9e-8 world units at the factory sliders and 9.7e-4
        // at the worst corner of the reachable box (freq 4.55 with comp 0.5,
        // where |T| reaches 83.25 on N = 20 terms), against 0.95 and 2.46 for
        // the partial sum, and no vertex is on the wrong side of zero.
        //
        // The picture pays for it, and the payment is the divergence itself:
        // the left edge was the tallest thing on the plate, so the factory range
        // falls from ±0.797 to ±0.299 — where this collection's neighbours
        // already sit, euler and moivre peaking at 0.315 — and the maxima plate
        // comes back inside the frame, ±2.909 → ±1.366 at the reachable maxima
        // (±3.018 → ±1.366 at the unreachable comp 1.0). 949 of 6561 grid-81
        // vertices change sign at the factory sliders. The display constant is
        // deliberately left at 0.15: re-cutting it would put the entry back
        // above its neighbours on the strength of an artefact that is now gone.
        const T=(x*freq+3.5)/7*30, N=10+Math.round(comp*20);
        let re=0, im=0;
        for (let n=1; n<N; n++) {
          const w=1/Math.sqrt(n), phase=T*Math.log(n);
          re+=w*Math.cos(phase); im-=w*Math.sin(phase);
        }
        // N^{−s}, then the tail ½·N^{−s} + N^{1−s}/(s−1) with s = ½ + iT.
        const wN=1/Math.sqrt(N), lN=Math.log(N);
        const nr=wN*Math.cos(T*lN), ni=-wN*Math.sin(T*lN);
        re+=nr*0.5; im+=ni*0.5;
        const dd=0.25+T*T;
        re+=N*(-0.5*nr+T*ni)/dd; im+=N*(-0.5*ni-T*nr)/dd;
        // Σ_k B_{2k}/(2k)!·(s)_{2k−1}·N^{−s−2k+1} — the tail the real-axis
        // `zeta` carries to k = 2, here to k = 4 with the Pochhammer complex.
        let pr=0.5, pi=T, j=1;
        for (let k=1; k<=4; k++) {
          while (j<2*k-1) { const tr=pr*(0.5+j)-pi*T; pi=pr*T+pi*(0.5+j); pr=tr; j++; }
          const g=(k===1?1/12:k===2?-1/720:k===3?1/30240:-1/1209600)/Math.pow(N,2*k-1);
          re+=g*(pr*nr-pi*ni); im+=g*(pr*ni+pi*nr);
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
      formula: 'f = sin(2πx/L + t)·e^{−0.3z²}, L = 1/(0.3·freq)',
      f(x, z, t, {amp=1, freq=1}) {
        return Math.sin(x*freq*TAU*0.3+t) * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    squareWave: {
      name: 'Square Wave (Fourier)',
      formula: '4/π Σ sin((2k−1)x)/(2k−1)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): the clock was added as a phase COMMON to every harmonic —
        // sin((2k−1)u + t) — and summing that gives cos(t)·(the promised
        // series) + sin(t)·(its conjugate series, the Hilbert transform of the
        // waveform). The surface was therefore rotating in the plane spanned by
        // the square wave and a logarithmic companion it never advertised: the
        // best achievable correlation with a square wave fell from 0.986 at
        // t = 0 to 0.000 at t = π/2, and the peak breathed by a factor of 2.18
        // across one cycle.
        //
        // Inside the harmonic index, (2k−1)(u + t), every harmonic shifts by
        // its own multiple and the sum is the same waveform translated. That
        // gives an exact invariant instead of an approximation: the surface at
        // time t is the t = 0 surface moved t/(2·freq) along x, to the bit.
        // The fundamental is unchanged, so the tempo of the animation is what
        // it always was. All four entries in this family had it.
        const N=1+Math.round(comp*14); let v=0;
        for (let k=1; k<=N; k++) v+=Math.sin((2*k-1)*(x*freq*2+t))/(2*k-1);
        return v*(4/Math.PI) * amp * 0.3 * Math.exp(-z*z*0.25);
      }
    },
    sawtoothWave: {
      name: 'Sawtooth Wave (Fourier)',
      formula: '2/π Σ (−1)^{k+1} sin(kx)/k',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=1+Math.round(comp*14); let v=0;
        // FIX(r6): the common phase, as in squareWave above. Worst case of the
        // family: at t = π/2 the sawtooth vanished outright — correlation with
        // a sawtooth 0.000, replaced by (2/π)ln(2cos(u/2)) — and the peak grew
        // 1.62× across a cycle.
        for (let k=1; k<=N; k++) v+=Math.pow(-1,k+1)*Math.sin(k*(x*freq*2+t))/k;
        return v*(2/Math.PI) * amp * 0.35 * Math.exp(-z*z*0.25);
      }
    },
    triangleWave: {
      name: 'Triangle Wave (Fourier)',
      formula: '8/π² Σ (−1)^k sin((2k+1)x)/(2k+1)²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=1+Math.round(comp*12); let v=0;
        // FIX(r6): the common phase, as in squareWave above. Softest case of
        // the family — this conjugate series converges absolutely, so the peak
        // only moved 1.32× — but the shape still stopped being a triangle wave
        // (best correlation 1.000 → 0.976 mid-cycle).
        for (let k=0; k<=N; k++) v+=Math.pow(-1,k)*Math.sin((2*k+1)*(x*freq*2+t))/(2*k+1)**2;
        return v*(8/Math.PI**2) * amp * 0.4 * Math.exp(-z*z*0.25);
      }
    },
    pulseWave: {
      name: 'Pulse Wave',
      formula: 'f = (D + 2/π Σ_{n=1}^{12} sin(nπD)cos(nu)/n)·e^{−0.25z²}, D = duty = 0.2+0.6·comp, u = 2·freq·x+t',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const D=0.2+comp*0.6, N=12; let v=D;
        // FIX(r6): the common phase, as in squareWave above. Here it cost the
        // duty cycle itself: best correlation with a pulse of the stated duty
        // fell 0.985 → 0.735 at t = π/2, so the pulse stopped being a pulse.
        for (let n=1; n<=N; n++) v+=2*Math.sin(n*Math.PI*D)*Math.cos(n*(x*freq*2+t))/(n*Math.PI);
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
      formula: 'u = Σ_{n≤N} bₙsin(nπ(freq·x+½))e^{−n²π²τ}·e^{−0.25z²}, bₙ = 4/(nπ) n odd, N = 8…10, τ = 0.01+0.005·(t mod 30)',
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
      formula: '‖f‖² = Σ_{n=−∞}^{∞}|cₙ|², f = sgn(sin x); drawn: one-sided |cₙ|²·(4+2·comp)·e^{−0.3z²}, n = 1…15',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=clamp(Math.round((x+3.5)/7*14)+1, 1, 15);
        // FIX(r6): the sqrt made this the AMPLITUDE spectrum |cₙ|, not the energy
        // spectrum the name and the caption both state — drawn/|cₙ| came out at
        // exactly 1.000000 on every odd column. And the even columns, which are
        // exactly zero for a square wave, were given an invented floor of
        // 0.01/n²: 7.85 % of the fundamental at n = 2. With both gone the picture
        // exhibits Parseval instead of merely naming it — the drawn heights sum
        // to 0.487351. The 0.9747 this comment used to state is the TWO-sided
        // figure, 2·Σ 4/(n²π²) over odd n ≤ 15, and the plate draws n = 1…15
        // only: Parseval's ‖f‖² = 1 for sgn(sin x) needs both signs of n, so the
        // bars a reader is told to sum come to half of it, minus the tail.
        //
        // FIX(r9): the (1 + 0.15·sin(0.5t)) gain is gone. |cₙ|² of a fixed
        // function has no time dependence, and the same bar was being drawn at
        // 1.205722 … 1.631271 at the factory sliders — max/min 1.3529, which is
        // exactly 1.15/0.85 — so a coefficient spectrum breathed by a third.
        // Same ruling as the cos²(0.3t) cut from `hydrogenS` above. t = 0 is
        // bit-identical before and after on grids 81, 90 and 161, so nothing
        // validated at t = 0 moves; what stops moving is the clock. The entry
        // still answers the audio path through `amp` and through the
        // (4 + 2·comp) gain, which is where a bar chart should take it.
        const cn_sq=(n%2===1) ? 4/(n*n*Math.PI*Math.PI) : 0;
        return cn_sq * amp * (4+comp*2) * Math.exp(-z*z*0.3);
      }
    },
    wavelets: {
      name: 'Haar Wavelet',
      formula: 'ψ(x) = +1 [0,½), −1 [½,1); drawn: 2^{round(4·comp)} copies over xv = (freq·x+3.5)/7, 0 outside, × e^{−0.3z²}',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const scale=Math.pow(2, Math.round(comp*4)), xv=(x*freq+3.5)/7;
        let v=0;
        for (let j=0; j<scale; j++) {
          const local=xv*scale-j;
          v+=(local>=0&&local<0.5)?1:(local>=0.5&&local<1)?-1:0;
        }
        // FIX(r6): the Haar function is ±1 — the caption says so — and the sum
        // above already returns exactly one of {−1, 0, +1}, because the dyadic
        // intervals are disjoint. Dividing by `scale` therefore did not average
        // anything; it just flattened the surface by 2^round(4·comp), so raising
        // the complexity slider added detail and squashed the plate at the same
        // time: peak |y| ran 0.100 / 0.050 / 0.025 at comp 0.5 / 0.7 / 0.9 with
        // amp = 1, against a catalogue median of 0.45.
        return v * amp * 0.4 * Math.exp(-z*z*0.3);
      }
    },
    dct: {
      name: 'Discrete Cosine Transform',
      formula: 'DCT-II X[k] of x[n] = sin θ+½sin 2θ, θ = πf₀(n+½)/4, n,k = 0…7, f₀ = 1+3·comp; drawn: X[k]/4·e^{−0.3z²}, k 7 widest',
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
        // FIX(r6): the window of integration was fixed at tau in [-2, 2] while
        // the point being evaluated runs to x*freq = +/-15.9 at the top of the
        // slider - so for most of the plate the Gaussian g(x*freq - tau) sat
        // entirely OUTSIDE the interval being summed, and what was drawn was
        // the tail of a kernel that had left the room. Measured against the
        // true convolution the error reached 106 % of the peak at the default
        // slider and 259 % at freq 2. It was also a left rectangular sum.
        //
        // The window now follows the kernel, which is where the mass is: g has
        // width 1/2, so +/-2.2 covers it to e^{-19}. Midpoint, 32 nodes, worst
        // error 1.4e-10 across the whole slider range.
        const N=32, c=x*freq, W=2.2, h=2*W/N; let v=0;
        const g = xi => Math.exp(-xi*xi*4);
        for (let i=0; i<N; i++) {
          const tau=c-W+(i+0.5)*h;
          const fx=Math.sin(tau*freq*3+t)*0.5;
          v+=fx*g(c-tau)*h;
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
      formula: 'f = Σ_{n=1}^N aₙsin(nωt+φₙ)·e^{−0.25z²}, aₙ = 1/n², ω = 0.4, φₙ = 2n·freq·x, N = 3+round(8·comp)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=3+Math.round(comp*8); let v=0;
        for (let n=1; n<=N; n++) v+=Math.sin(n*x*freq*2+n*t*0.4)/(n*n);
        return v * amp * 0.4 * Math.exp(-z*z*0.25);
      }
    },
    stochasticFourier: {
      name: 'Weyl-Phase Fourier',
      formula: 'f = Σ_{n=1}^N cos(n(2·freq·x+0.3t)+φₙ)/n·e^{−0.25z²}, φₙ a fixed Weyl phase set, N = 5+round(10·comp)',
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
      // FIX(r8): the +1e-6 on xv was load-bearing — sin(x/2) is 0 at x = 0, a
      // column of the mesh on every odd grid — but it paid for that by moving
      // the whole kernel sideways by 1e-6, measured 9.32e-6 worst against the
      // unshifted kernel under a row rated A. The removable singularity has a
      // known value instead: F_N(2πk) = N, so sin(Nx/2)/sin(x/2) → ±N and its
      // square → N². The branch fires only where sin(x/2) is exactly 0.
      //
      // The removable singularity is at EVERY 2πk, not only at zero, and the
      // closed form is unusable near all of them: at x = π, freq 1 the ratio
      // came out −12.0 where the defining sum gives 17, because (N+½)·x rounds
      // at 7e-15 while sin(x/2) is 1.2e-16. Both kernels are 2π-periodic, so
      // folding x into [−π, π] first puts every one of those points at 0, where
      // the arithmetic is relatively accurate. Measured 1.98e-14 worst against
      // the defining sum with the singular points deliberately sampled, where
      // branching at zero alone read 4.01 — worse than the bug it replaced.
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=2+Math.round(comp*14), xr=x*freq*2, xv=xr-TAU*Math.round(xr/TAU);
        const sh=Math.sin(xv/2);
        const v=sh===0 ? N : Math.sin(N*xv/2)/sh;
        return v*v/N * amp * 0.06 * Math.exp(-z*z*0.25);
      }
    },
    dirichletKernel: {
      name: 'Dirichlet Kernel',
      formula: 'D_N(x) = Σ_{k=−N}^N e^{ikx} = sin((N+½)x)/sin(x/2)',
      // FIX(r8): same guard, same repair as fejerKernel. D_N(2πk) = 2N+1 by
      // L'Hôpital — (N+½)cos((2N+1)πk) / (½cos πk) = 2N+1 for every k — so the
      // singularity is removable and needs no shift. Cost of the old +1e-6:
      // 2.48e-5 worst over the reachable box, under a row rated A. Same 2π fold
      // as fejerKernel, and for the same reason — see the note there.
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const N=2+Math.round(comp*12), xr=x*freq*2, xv=xr-TAU*Math.round(xr/TAU);
        const sh=Math.sin(xv/2);
        return (sh===0 ? 2*N+1 : Math.sin((N+0.5)*xv)/sh) * amp * 0.06 * Math.exp(-z*z*0.25);
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
      formula: 'ẋ=αx−βxy, ẏ=δxy−γy; drawn: y(T)−5, (x,y)₀ = (10+5fx, 5+2fz), T = 0.05·round(5+20·comp), both floored at 0',
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
        // Sinusoidally loaded simply-supported beam exact solution.
        //
        // FIX(r8): the plate was flat. The mathematics was never wrong — sympy
        // solving EI·y'''' = 0.8·sin(nπξ) under y(0)=y(L)=y''(0)=y''(L)=0
        // reproduces the drawn height to 4.3e-18 — but the load amplitude was a
        // fixed 0.8 while the modal denominator (nπ/L)⁴ was never compensated,
        // and comp = 0.5 + mid·0.4 reaches n = 3..5, i.e. a denominator of
        // 7.9e3..6.1e4. Measured: the tallest point anywhere on the plate was
        // 6.8e-4 world units at the amplitude maximum, against 0.42..2.28 for
        // twelve of the other fifteen entries in this collection (the other
        // three run to 8.7, 114 and 539, which is a different complaint).
        //
        // The repair is in the load, not in a display gain the row hides: the
        // load amplitude is scaled with the mode, q̂ₙ = EI·(nπ/L)⁴·δ, so the
        // exact deflection q̂ₙ·sin(nπξ)/(EI·(nπ/L)⁴) is δ·sin(nπξ) for every n
        // and δ is the peak deflection in world units (the midspan for odd n,
        // a node for even n — the peak is what stays constant). Every mode is drawn
        // at the load that gives it the same peak deflection, so what the
        // picture shows is mode shape at constant deflection — the 1/n⁴
        // softening is a property of the load chosen, not something suppressed.
        // δ = 0.45·amp·e^(-0.3z²) is the display gain its modal neighbours
        // heatEquation, waveEquation and schrodingerBox already use.
        //
        // No t: a static load on a static beam has a time-independent
        // deflection. The surface still answers the audio through the sliders
        // (amp from bass, n from mid).
        const L=1, n=Math.round(1+comp*4);
        const EI=1, k=n*Math.PI/L;
        const xi=clamp((x*freq+3.5)/7, 0, 1);
        const delta=amp*0.45*Math.exp(-z*z*0.3);
        const qn=EI*k**4*delta;
        return qn*Math.sin(k*xi)/(EI*k**4);
      }
    },
    schrodingerBox: {
      name: 'Particle in a Box',
      formula: 'Re Ψₙ = √2·sin(nπξ)·cos(Eₙt/100)·e^{−z²/4}, ξ = clamp((freq·x+3.5)/7, 0, 1), Eₙ = n²π²',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*5), L=1;
        const xi=clamp((x*freq+3.5)/7, 0, 1);
        const E=n*n*Math.PI*Math.PI;
        return Math.sqrt(2/L)*Math.sin(n*Math.PI*xi)*Math.cos(E*t*0.01) * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    reynoldsFlow: {
      // FIX(r11): Stokes flow is the whole low-Reynolds regime; what is drawn is the exact Poiseuille cross-section (max|kernel - (1-z^2)·sin(0.5)·0.45| = 0.00e+00) multiplied by a sine running along the flow, which no Stokes solution does.
      // Renamed from 'Stokes Flow (low Re)': the <option> label is the only text a
      // viewer reads for an entry — the caption never reaches the DOM.
      name: 'Poiseuille Profile × Travelling Wave',
      formula: 'Poiseuille u = max(0, 1−(z·freq)²), carried along x by sin(0.5·freq·x + 0.3t)',
      f(x, z, t, {amp=1, freq=1}) {
        // Poiseuille: u = (1−r²), parabolic
        const r2=(z*freq)**2;
        return Math.max(0, 1-r2) * Math.sin(x*freq*0.5+t*0.3) * amp * 0.45;
      }
    },
    fishersEquation: {
      name: "Fisher's Equation (wave front)",
      formula: '∂u/∂t = D∂²u/∂x² + ru(1 − u/K); front u = K(1+e^{kξ})⁻², k = √(r/6D), c = 5√(rD/6)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const D=0.5, r=1+comp;
        // FIX(#5, r4): the front travels at c·0.08 per unit of clock and
        // the clock never stops, so it walked off the right edge for good —
        // 5·10⁻⁵ of the boot peak after two minutes. 24 is one crossing of the
        // domain: the front sweeps through and the next one starts from the
        // left, which is what a travelling wave looks like; see replayTime.
        // FIX(r6): the profile drawn was a plain logistic 1/(1+e^{−2ξ}), and no
        // logistic is a travelling-wave solution of Fisher–KPP at any speed.
        // Substituting u = σ(kξ) into −cu′ = Du″ + ru(1−u) gives
        // −ck = Dk²(1−2u) + r, which cannot hold for all u unless Dk² = 0.
        // Measured: the residual of the drawn profile is 1.29 at the speed the
        // code claims, and 0.48 at the best speed any logistic could have —
        // against a solution whose residual is 6·10⁻⁸.
        //
        // Ablowitz–Zeppetella is the closed-form solution of this equation:
        //   u(ξ) = (1 + e^{ξ√(r/6D)})⁻²  travelling at c = 5√(rD/6).
        // Note the speed is that one, not the minimum speed 2√(Dr) the old code
        // used: the exact solution exists only at its own speed.
        const k=Math.sqrt(r/(6*D)), c=5*Math.sqrt(r*D/6);
        const xi=x*freq-c*replayTime(t, 24)*0.08;
        const e=Math.exp(k*xi);
        return 1/((1+e)*(1+e)) * amp * 0.5 * Math.exp(-z*z*0.25);
      }
    },
    pendulumNonLinear: {
      name: 'Nonlinear Pendulum Phase',
      formula: 'θ̈ + sin θ = 0 — phase portrait in (θ, ω); drawn: sin(2H + 0.3t), H = ½ω² − cos θ',
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
      // FIX(r8), two things, neither of them the picture.
      //   * the +1e-9 that held u off zero cost 1.5e-10 at the factory amp,
      //     2.2e-10 at amp 1 and 4.9e-10 at amp 2.25 against mpmath — the A/B
      //     seam rather than a broken tier, but bought nothing: sin(u)/u is 0/0
      //     at u = 0 and nowhere else, so the special case goes there.
      //   * the caption. Two different sinc conventions sat under one word in
      //     one catalogue: this one is the UNNORMALISED sin(u)/u, while
      //     specialFunctions/sinc is the normalised sin(πr)/(πr). Neither the
      //     rect's half-width nor the prefactor was stated. The true transform
      //     is F⁻¹[rect_W](x) = sin(Wx)/(πx) = (W/π)·sin(u)/u with u = Wx and
      //     W = 4·freq; the W/π is absorbed into the display scale, so the
      //     surface is normalised to amp·0.5 at x = 0 instead of W/π, and the
      //     e^{−0.3z²} is decoration. Hence "∝", not "=".
      name: 'Inverse Fourier (Rect)',
      formula: 'F⁻¹[rect_W](x) ∝ sin(u)/u (unnormalised sinc), u = Wx, W = 4·freq',
      f(x, z, t, {amp=1, freq=1}) {
        const r=x*freq*4;
        const s=r===0 ? 1 : Math.sin(r)/r;
        return s * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    laplaceTransform: {
      name: 'Laplace Transform (step)',
      formula: 'L{1}(s) = 1/s',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): L{1}(s) = 1/s converges for every Re s > 0, so where the
        // window starts is a free choice - and starting it at s = 0.1 put the
        // left edge of the plate at 1/0.1 = 10, i.e. 3.5 world units at the
        // factory sliders against a ~3-unit frame, purely because the window
        // was pushed up against the pole. Starting at 0.35 keeps the same
        // hyperbola and the same transform, in frame.
        const s=(x+3.5)/7*4.75+0.35;
        return 1/s * amp * 0.9 * Math.exp(-z*z*0.3);
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
      formula: 'Z{aⁿ}(z) = z/(z−a); height is Re, Re z ∈ [a+0.2, a+2.7]',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): Z{aⁿ}(z) = z/(z−a) is only defined on its region of
        // convergence |z| > a — the series Σaⁿz⁻ⁿ diverges elsewhere. The plate
        // was mapped to Re z ∈ [0.5, 3.0] while a runs up to 0.9, so a strip of
        // the picture stood on a region where the transform does not exist, and
        // the pole itself was crossed exactly: Im z = z·freq·0.4 is zero along
        // the whole z = 0 row, which is a row of the mesh. Only the +1e-9 in the
        // denominator kept it finite, and the peak came out as 22.8 / 8.4 / 89.2
        // across grids 25 / 90 / 161 — a spread of ×10.6, i.e. a different
        // picture per GPU. Mapping the plate to |z| ≥ a + 0.2 puts the whole
        // surface inside the region of convergence and bounds it there.
        const a=0.7+comp*0.2;
        const zr=a+0.2+(x+3.5)/7*2.5, zi=z*freq*0.4;
        const den_r=zr-a, den_i=zi;
        const den2=den_r*den_r+den_i*den_i;
        return (zr*den_r+zi*den_i)/den2 * amp * 0.35;
      }
    },
    waveletTransform: {
      name: 'Morlet Wavelet',
      formula: 'ψ(t) = e^{iω₀t}·e^{−t²/2}; drawn: Re ψ(ξ), ξ = freq·(x − 2z)/a, a = 0.5+0.5·comp',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const omega0=5+comp*3, tau=z*freq*2, scale=0.5+comp*0.5;
        const xi=(x*freq-tau)/scale;
        return Math.exp(-xi*xi/2)*Math.cos(omega0*xi) * amp * 0.45;
      }
    },
    hilbertTransform: {
      name: 'Hilbert Transform (f + H[f])/2',
      formula: 'H[sin ωu] = −cos ωu, u = freq·x + t; drawn: the mean (f + H[f])/2 = sin(ωu − π/4)/√2',
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
      // FIX(r11): the Hankel kernel is J0 alone; the plate is J0 damped by an exponential the transform does not have. The zeros stay where J0 puts them and the kernel is exact to 3.8e-09 against scipy, so only the envelope is unnamed — and the envelope is what the eye reads.
      // Renamed from 'Hankel Kernel J₀(ρ)': the <option> label is the only text a
      // viewer reads for an entry — the caption never reaches the DOM.
      name: 'J₀(ρ) with e^{−0.3ρ} envelope',
      formula: 'J₀(ρ)·e^{−0.3ρ} — the kernel, not a transform',
      f(x, z, t, {amp=1, freq=1}) {
        const rho=Math.sqrt(x*x+z*z)*freq*2;
        return besselJ0(rho)*Math.exp(-rho*0.3) * amp * 0.55;
      }
    },
    mellinTransform: {
      name: 'Mellin Integrand x^{s−1}e^{−x}',
      formula: 'the integrand of M{e^{−x}}(s); the transform itself is Γ(s), one number per s',
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
        // FIX(r6): the integral runs to infinity and the sum stopped at t = 5,
        // on a midpoint rule with h = 0.25 - worst measured error 1.6e-2 at
        // z = 0.5, an order and a half outside the tier claimed, and the bound
        // failed at every reachable z. The substitution t = u/(1-u) carries
        // [0, 1) onto [0, infinity), so the tail is integrated rather than
        // truncated and the same 64 nodes land where the integrand actually
        // varies: worst error 2.0e-5, and 2.2e-9 at z = 1.
        const zv=clamp((x+3.5)/7*4+0.5, 0.5, 4.5);
        const N=64; let sum=0;
        for (let i=0; i<N; i++) {
          const u=(i+0.5)/N, tv=u/(1-u), jac=1/((1-u)*(1-u));
          sum+=Math.exp(-tv)/(zv+tv)*jac/N;
        }
        return sum * amp * 0.4 * Math.exp(-z*z*0.3);
      }
    },
    cauchyIntegral: {
      name: 'Cauchy Integral Formula',
      formula: 'f(z₀) = 1/(2πi)∮ f(z)/(z−z₀) dz, f(z) = z²+c, c = 0.3·comp, R = 2; height is Re f(z₀) inside, 0 outside',
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
        // FIX(r6): quadrature applied to f(z)/(z−z₀) falls apart as z₀ nears
        // the contour, and the reachable region crosses it — |z₀| reaches 2.47
        // at the default wave intensity against R = 2. The result was spikes
        // whose height depended on where the mesh sampled: peak 1.28 / 4.37 /
        // 14.7 / 35.1 across grids 25 / 90 / 161 / 400, a spread of ×27.
        //
        // The cure is singularity subtraction, not a clamp:
        //   ∮f/(z−z₀)dz = ∮[f(z)−f(z₀)]/(z−z₀)dz + f(z₀)·∮dz/(z−z₀).
        // The first integrand has a removable singularity — for f = z²+c it is
        // the polynomial z + z₀ — so the quadrature never meets the pole; the
        // second is 2πi times the winding number, which is an integer counted
        // here by argument increments rather than integrated. What comes out is
        // Cauchy's formula itself: Re f(z₀) inside the contour, 0 outside,
        // exactly, at any mesh density. Measured against the closed form the
        // old code was 33 % low inside (0.076 where 0.057 was due).
        // FIX(r9): the winding number was counted by argument increments over
        // the 48 contour samples, and that unwrapping fails whenever one step's
        // true argument change exceeds π — i.e. for z₀ within ~4.3e-3 of the
        // contour. On the meshes the app actually draws that is not
        // hypothetical: 48 of 25921 grid-161 vertices INSIDE the contour
        // dropped to 0 at the factory sliders (worst gap 0.594686 world
        // units), 40 at t = 3.7, and 72 at the audio envelope with gaps to
        // 1.765460 — and the affected set FLICKERS, because the sample points
        // carry +0.1t. For a circle of radius R the winding number of z₀ is
        // |z₀| < R by definition, so the count is replaced by the definition.
        // Measured: every hole goes and nothing else moves — 0 of 25921
        // grid-161 vertices differ away from the holes at factory, audio and
        // the slider maxima, at t = 0 and t = 3.7 — and 49 atan2 per vertex (the loop ran k = 0…N inclusive) go
        // with it. Cost: the (unused) generality of a non-circular contour.
        let regRe = 0, regIm = 0;
        for (let k = 0; k < N; k++) {
          const phi = k * (2 * Math.PI / N) + t * 0.1;
          const zRe = R * Math.cos(phi), zIm = R * Math.sin(phi);
          // (f(z) − f(z₀))/(z − z₀) = z + z₀ for f(z) = z² + c
          const mRe = zRe + z0re, mIm = zIm + z0im;
          const dzRe = -R * Math.sin(phi) * (2*Math.PI/N);
          const dzIm =  R * Math.cos(phi) * (2*Math.PI/N);
          regRe += mRe*dzRe - mIm*dzIm;
          regIm += mRe*dzIm + mIm*dzRe;
        }
        const n = (z0re*z0re + z0im*z0im < R*R) ? 1 : 0;
        const fRe = z0re*z0re - z0im*z0im + c;
        // Re(I/(2πi)) = Im(I)/2π, and the analytic term contributes f(z₀)·n.
        return ((regIm / (2 * Math.PI)) + fRe * n) * amp * 0.4;
      }
    },
    stocksFormula: {
      name: 'Green\'s Theorem Flow',
      formula: '∮ P dx+Q dy = ∬(∂Q/∂x−∂P/∂y)dA; drawn: the integrand, −freq·sin(freq·(x+z))',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r9): this comment read "Curl of F = (-y,x) → constant 2", which
        // is false of the code beneath it. curl(−y, x) = 2 would make the
        // drawn field a constant 0.420000 at the factory sliders; the measured
        // range there is [−0.209998, +0.209998] and the worst discrepancy
        // against the comment's claim is 0.629998 — three times the entire
        // height of the field. A constant field cannot have a range, so the
        // range test alone settles it. What is actually computed is
        // ∂Q/∂x − ∂P/∂y for F = (−cos(fx)cos(fz), +cos(fx)cos(fz)), which
        // collapses to −f·sin(f(x+z)) exactly (matched to 1.06e-16 at the
        // factory sliders and 1.09e-14 at the maxima over 6561 grid-81
        // vertices). The caption now says so; drawing the constant 2 the old
        // comment described would give a perfectly flat plate with no response
        // to freq, which is presumably why the code drifted from it.
        const dQdx=-Math.sin(x*freq)*Math.cos(z*freq)*freq;
        const dPdz= Math.cos(x*freq)*Math.sin(z*freq)*freq;
        return (dQdx-dPdz) * amp * 0.3;
      }
    },
    poissonIntegral: {
      name: 'Poisson Integral Formula',
      formula: 'u(r,θ) = 1/(2π) ∫ f(φ)(1−r²)/(1−2r cos(θ−φ)+r²)dφ; f(φ) = cos(3φ+0.3t), r = min(0.9, 0.4·freq·√(x²+z²))',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6): sixteen nodes alias the boundary data onto itself. For
        // f(phi) = cos(3phi + s) the Poisson integral is exactly r^3*cos(3theta + s),
        // and a trapezoid on N nodes also picks up the modes n = N-3 and N+3
        // with weights r^(N-3) and r^(N+3) - at N = 16 and r = 0.95 that is a
        // worst-case absolute error of 1.52, against a quantity bounded by 1.
        // N = 96 with the radius capped at 0.9 puts the alias at r^93 and the
        // measured worst error at 8.1e-5.
        const r=Math.min(0.9, Math.sqrt(x*x+z*z)*freq*0.4), theta=Math.atan2(z,x);
        const N=96; let sum=0;
        for (let k=0; k<N; k++) {
          const phi=TAU*k/N;
          const f_phi=Math.cos(3*phi+t*0.3);
          sum+=f_phi*(1-r*r)/(1-2*r*Math.cos(theta-phi)+r*r);
        }
        return sum/N * amp * 0.35;
      }
    },
    continuousWavelet: {
      // FIX(r11): a scalogram is |W| or |W|^2; the plate is the SIGNED real-Morlet W(a,b), so a ridge is cut into alternating positive and negative bands. The transform itself is right — this is a name about which function of it is drawn.
      // Renamed from 'CWT Scalogram': the <option> label is the only text a
      // viewer reads for an entry — the caption never reaches the DOM.
      name: 'Morlet CWT (signed W)',
      formula: 'W(a,b) = 1/√a ∫ f(t)ψ*((t−b)/a)dt',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): the integration grid was fixed - twenty samples with step
        // 0.3 over tau in [-3, 3) - while the wavelet's width is the scale a,
        // which runs down to 0.1. A wavelet of width 0.1 oscillating as
        // cos(5xi) has a period of 0.126 in tau and simply does not land on a
        // grid that coarse: measured error 0.39 at a = 0.1 and 0.62 at a = 0.35,
        // on a quantity of order 1. At the wide end the opposite happened -
        // the wavelet extended past the fixed window and was cut off.
        //
        // Integrating in xi = (tau-b)/a instead makes the window follow the
        // scale, which is what a scalogram means: W = sqrt(a) * integral of
        // f(b + a*xi) * psi(xi) d(xi), taken over |xi| <= 5 where the Gaussian
        // has fallen to e^{-12.5}. Worst error over the whole scale range 1e-6.
        const b=x*freq, a=0.1+clamp((z+3.5)/7, 0, 1)*2;
        let v=0; const N=64, h=10/N;
        for (let i=0; i<N; i++) {
          const xi=-5+(i+0.5)*h;
          const signal=Math.sin((b+a*xi)*(2+comp)*2+t);
          const psi=Math.exp(-xi*xi/2)*Math.cos(5*xi);
          v+=signal*psi*h;
        }
        return v*Math.sqrt(a) * amp * 0.15;
      }
    },
    fourierSlice: {
      name: 'Angle-Swept Sinusoid',
      formula: 'sin(x·f·4·cos φ + 0.5 sin φ), φ = 0.5z + 0.3t',
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
      formula: 'r(u,v)=((1+v/2 cos(u/2))cos u, …); v = clamp((r−0.6)·3, ±1) — the plate edge is the strip edge',
      f(x, z, t, {amp=1, freq=1}) {
        const u=Math.atan2(z*freq,x*freq), r=Math.sqrt(x*x+z*z)*freq;
        const v=clamp((r-0.6)*3, -1, 1);
        return v*Math.cos(u/2+t*0.3) * amp * 0.5;
      }
    },
    kleinBottle: {
      name: "Klein Bottle Cross-Section",
      formula: 'figure-8 Klein immersion; drawn: sin(u/2)sin v + cos(u/2)sin 2v, u = π·freq·x + 0.2t, v = π·freq·z',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6): the height had no half twist — the identification that is the
        // whole difference between a Klein bottle and a torus. cos(u)/2 and
        // sin(u)/2 are whole angles, so the surface was exactly 2π-periodic in u
        // (torus gluing residual 1.0e-49) and CHANGED SIGN under the Klein gluing
        // (u,v) ~ (u+2π, −v), residual 3.017 against its own sup 1.509 — i.e. on
        // the Klein bottle it was two-valued and therefore not defined at all.
        // These are the half-angles the figure-8 immersion actually carries, and
        // this is its own z-coordinate.
        // FIX(r9): the clock phase sat inside the SECOND term only, and the
        // identification (u,v) ~ (u+2pi, -v) that DEFINES the Klein bottle does
        // not survive a phase added to v alone. sympy gives the residual in
        // closed form, h(u,v) - h(u+2pi,-v) = 2*sin(0.2t)*cos(u/2)*cos(2v), and
        // measured at continuous points (40x40, no lattice rounding) it is
        // 0.000000 at t = 0, 1.129285 at t = 3 and 1.970899 at t = 7 against the
        // field's own sup of 1.412098 - 140 % - and 1.743152 at t = 21,
        // 1.811157 at t = 120. So at every instant except the multiples of 10pi
        // the height was two-valued on the Klein bottle, and a two-valued thing
        // is not a function on it at all.
        //
        // A phase added to u DOES survive, because u -> u+2pi is exactly what
        // the gluing does to u. With it moved there the Klein residual is
        // 7.8e-16, 1.2e-15, 8.9e-16, 1.3e-15 and 2.3e-15 at those same five
        // instants, and what is drawn is bit-for-bit the third coordinate of
        // the standard figure-8 immersion - the coordinate the r6 comment above
        // already says this entry carries. Controls: the torus gluing
        // (u,v) ~ (u+2pi, v) still reads 2.497207 on the new field, so this is
        // not a blanket invariance the test cannot fail; and the old field
        // divided by the new named quantity runs -795.93...964.55, so the
        // comparator can come out wrong and here does not.
        //
        // Cost to the picture, measured rather than asserted. The animation
        // changes character: instead of the second lobe rippling in place, the
        // whole pattern translates along x at 0.2/(pi*freq) plate units per
        // second. Motion survives - max|y(t)-y(0)| over t = 0 -> 7 at the
        // factory sliders is 0.239999 against 0.360753 before, on 98.8 % of
        // grid 81 against 100 % - and the height stops breathing: the pre-gain
        // sup ran 1.249970...1.412098 over the clock and is now a flat 1.25, so
        // the drawn range narrows from [-0.3959, 0.3958] to [-0.3500, 0.3500].
        // Same trade the r6 `squareWave` note accepted and documented.
        const u=x*freq*Math.PI+t*0.2, v=z*freq*Math.PI;
        const y=Math.sin(u/2)*Math.sin(v)+Math.cos(u/2)*Math.sin(2*v);
        return y * amp * 0.4;
      }
    },
    torusKnot: {
      name: 'Torus Knot Height Field',
      formula: 'sin(2θ − 2qr + 0.4t)·e^{−5(r−0.8)²}, q = 3+round(2·comp) — a phase field, not a (p,q) knot',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const p=2, q=3+Math.round(comp*2);
        const theta=Math.atan2(z*freq,x*freq);
        const r=Math.sqrt(x*x+z*z)*freq;
        return Math.sin(p*theta-q*r*2+t*0.4) * amp * 0.4 * Math.exp(-((r-0.8)**2)*5);
      }
    },
    boysSurface: {
      name: "Boy's Surface Slice",
      formula: 'Bryant–Kusner immersion of RP², height coordinate',
      // FIX(r8): the caption said RP² and the height had the symmetry of a torus.
      // sin u·cos(v/2) + sin 2u·cos²(v/2) is invariant under (u,v) ~ (u+2π, −v)
      // and under nothing finer, so under the two antipodal identifications that
      // make RP² — (u+π, π−v) and (u+π, −v) — it moved by 0.733 and 0.799 against
      // its own sup of 0.696: two-valued on RP², hence not a function on it.
      //
      // Boy's surface is nowhere a graph, so a height field has to choose a
      // coordinate of some immersion, and the choice has to be checked. Apéry's
      // parametrisation, the one usually quoted, does not survive the check: the
      // whole circle v = π/2 goes to the origin with ∂r/∂u = 0 there, so it is
      // not an immersion, and the RP² invariance it does have is necessary but
      // not sufficient. Bryant–Kusner is an immersion everywhere (least EG−F²
      // over the sphere 0.213 in the sphere's own metric), and this is its third
      // coordinate, written in the homogeneous stereographic w = p/q so that the
      // pole w = ∞ — which lands on the plate's own z edge — is an ordinary
      // value and not a hole.
      //
      // The plate is the sphere: θ across x, φ down z, so the antipodal map of
      // RP² is the glide (x,z) → (x + 3.5/freq, −z). The shift has to follow
      // freq, because θ = x·freq·(2π/7) and the half turn needs Δx·freq = 3.5;
      // the literal +3.5 this comment used to prescribe is the freq = 1 case
      // alone, and applying it at freq 1.5, 2, 3.36 or 4.55 moves the drawn
      // height, at grid 81 at t = 0, by 0.3805, 0.4130, 0.4220 and 0.4095
      // against a sup of 0.47 — by most of the surface. Written correctly the
      // height is invariant to 6.4·10⁻¹⁶ in double at the factory sliders on a
      // grid-81 plate (5.0·10⁻¹⁶…1.9·10⁻¹⁵ over one turn of the clock), and to
      // 0.0 once rounded to the Float32 the vertex buffer stores, at t = 0 and
      // after an hour, at all five named settings on both grids. After a *day*
      // it does mismatch at grid 161 — always by exactly one Float32 ulp, so
      // the absolute figure is the vertex's height and not the error: it is
      // 3.64·10⁻¹² at the factory sliders (1 pair of 13 041, at a vertex of
      // height −5.2·10⁻⁵) but 5.96·10⁻⁸ at amp 2.25 / freq 4.55 (3 of 23 023,
      // height 0.737); relative, one ulp either way. The 3.6·10⁻¹² this
      // comment used to give alone was the best of the five. Grid 81 shows
      // none anywhere; the old height moved 0.5625 on a sup of 0.4928.
      // The three roots of p⁶+√5p³q³−q⁶ are
      // the three points of RP² that meet at the triple point — the feature
      // that tells Boy's surface from Steiner's Roman surface below. Against
      // the immersion at 50 digits the height is exact to 4.8, 5.5 and
      // 6.2·10⁻¹⁶ on grids 41, 81 and 161 at the factory sliders at t = 0, the
      // immersion being evaluated at the same double abscissa the kernel is
      // handed. One figure per grid, because the sup is monotone in the lattice
      // (41 ⊂ 81 ⊂ 161 bitwise) and the 4.6·10⁻¹⁶ this comment used to give was
      // a single grid's; and one per instant, because θ carries 0.2t — over one
      // turn of the clock the grid-41 figure runs 4.1·10⁻¹⁶…1.9·10⁻¹⁵. |B| ≤ 2 bounds it for every slider, so
      // unlike `catenoid` this one cannot leave frame and needs no fold. t turns
      // the immersion about its own 3-fold axis, once every 10.5 s, instead of
      // pulsing the amplitude — a motion the surface actually has.
      f(x, z, t, {amp=1, freq=1}) {
        const th=x*freq*(TAU/7)+t*0.2, ph=Math.PI/2+z*freq*(Math.PI/7);
        const s=Math.sin(ph/2), c=Math.cos(ph/2), sc=s*c;
        const s3=s*s*s, s4=s3*s, s6=s3*s3, c3=c*c*c, c4=c3*c, c6=c3*c3;
        const a=Math.cos(th), b=Math.sin(th);
        const a3=a*(a*a-3*b*b), b3=b*(3*a*a-b*b), a6=a3*a3-b3*b3, b6=2*a3*b3;
        const a5=a6*a+b6*b, b5=b6*a-a6*b, k=Math.sqrt(5)*s3*c3;
        const dR=s6*a6+k*a3-c6, dI=s6*b6+k*b3, dd=dR*dR+dI*dI+1e-30;
        const g1=-1.5*(sc*(c4*b-s4*b5)*dR-sc*(c4*a-s4*a5)*dI)/dd;
        const g2=-1.5*(sc*(c4*a+s4*a5)*dR+sc*(c4*b+s4*b5)*dI)/dd;
        const g3=(s6*b6*dR-(c6+s6*a6)*dI)/dd-0.5;
        // g/|g|² is the immersion; its height spans [−2, 0.4426], centred here
        return (g3/(g1*g1+g2*g2+g3*g3)+0.78) * amp * 0.55;
      }
    },
    romanSurface: {
      name: "Steiner's Roman Surface",
      formula: 'x²y²+y²z²+z²x² = r²xyz',
      // FIX(r8): "solve numerically" was a comment, not a solve. The height was
      // xz/(2a+|x|+|z|), which meets the equation only in the limit x, z → 0:
      // at (−1.05, −1.05) the surface is at 0.6439 and the guess drew 0.2162.
      // Worse, Steiner's surface is compact — it is the image of a sphere, so
      // it lives inside |x|, |z| ≤ r²/2 — and over 86 % of the plate there was
      // no height to draw at all, and one was drawn anyway.
      //
      // The equation is quadratic in y, not quartic — y²(x²+z²) − r²xz·y + x²z²
      // — so the branch is closed form and not a search; sympy gives the roots
      // as xz(r² ± √(r⁴−4x²−4z²))/(2(x²+z²)) with residual 0. This is the lower
      // one, written as 2xz/(r²+√…) because differencing two nearly equal roots
      // near the axis costs exactly the digits the picture is made of. It is
      // the sheet through the origin, the one carrying the double lines (y ≡ 0
      // on both axes), and its small limit xz/r² is what the old guess was
      // reaching for. Against mpmath's roots the accuracy is a function of how
      // close to the rim you look, not a single number: with σ = √(r⁴−4ρ²)/r²
      // the relative error runs at ≈ 4.4·10⁻¹⁶/σ, the measured worst × σ
      // staying between 0.7 and 4.0 ulp across every decade of σ from 8·10⁻³
      // to 1. Under the away-from-the-fold filter the row uses, σ > 0.05, the
      // worst over the five settings MATHEMATICAL_ACCURACY.md names — factory,
      // the suite's amp-1 baseline, the audio envelope, the reachable
      // over-drive, the amplitude floor — is 1.36·10⁻¹⁵ at t = 0 (101 970
      // drawn vertices, grids 81 and 161) and 2.41·10⁻¹⁵ once one turn of the
      // clock is swept; the 2.6·10⁻¹⁵ it replaces was over ten settings
      // nobody wrote down, and the 5.8e-16 before it is below what a
      // vertex at σ = 0.05 can reach, and a vertex ON the rim pays what a
      // double root costs — 2.8·10⁻⁹ relative at (−2.8, 2.1) on the grid-41
      // lattice at the factory sliders at t = 0, measured against the root at
      // the same double abscissa the kernel is handed.
      //
      // The drawn point's preimage on the sphere closes to r² to exactly 2 ulp
      // of r² — 1.78e-15 at the factory sliders, 2.84e-14 wherever r² passes
      // 64 — so that quantity carries the scale of r² and is not the 3e-15
      // bound this comment used to claim; divided by r² it is ≤ 4.2e-16 over
      // the whole box. Nor is it a second check. sympy simplifies
      // (yz/x + zx/y + xy/z − r²) − (x²y²+y²z²+z²x² − r²xyz)/(xyz) to 0
      // identically: the preimage form IS the quartic divided by xyz, term for
      // term, so it cannot separate "on Steiner's surface" from "on the quartic
      // that contains it". The quartic residual is the whole of the evidence.
      //
      // Where the root turns complex nothing is drawn, because nothing is
      // there: the fold circle ρ = r²/2 is the surface's own edge, where the
      // two sheets meet vertically and this one peaks at exactly r²/4. At the
      // factory sliders that circle is the plate's inscribed circle, so the
      // vertices outside it — the ones with no surface above them — are 23.5 %
      // of the mesh at grid 81 and 22.6 % at 161. Count instead every vertex
      // the kernel leaves at exactly 0 and it is 25.9 % and 23.8 %; the
      // difference is the two double lines, which only an odd grid carries at
      // all (the even grid 90 reads 23.7 % under both countings). Over one turn
      // of the clock the outside-the-circle share runs 5.8…51.1 % at grid 81
      // and 5.3…50.4 % at 161, against a continuum band of 4.9…49.7 % — the
      // 7 % to 49 % this comment used to give is neither of them. The wall
      // at the rim is the fold seen edge-on — four petals, not a ring, since
      // the sheet is zero along both axes.
      //
      // amp and freq move r² itself rather than stretching the height, because
      // a stretched Steiner surface is a Steiner surface for no r at all: fit
      // the best r² to this plate scaled by 3.21 — amp at the top of its range
      // — and the median point still misses the equation by 0.75 of its own
      // scale. So amp grows the surface, freq zooms out of it, t breathes it,
      // and every frame at every slider setting is exactly the named surface.
      // That is also what frames it without a clamp: the sheet peaks at r²/4
      // until the plate corner cuts the fold off, which bounds peak |y| by the
      // continuum sup 2.475, attained at r² = 7√2 where the rim reaches the
      // plate's corner diagonal (a 13 230-setting sweep at grid 81 gets to
      // 2.4712). Every mesh figure below that needs its grid and its instant:
      // at the factory sliders the peak is 1.68 at grid 81 and 1.71 at 161 at
      // t = 0, and 1.19…2.07 and 1.27…2.09 over one turn of the clock. Those
      // two tops are attained at an isolated instant — the one where a
      // near-diagonal rim vertex has d → 0⁺ — so re-sampling the turn will not
      // find them: 4 000 instants reach 2.0559 at grid 81, 20 000 reach 2.0591
      // and 100 000 reach 2.0669, still climbing. They are solved per vertex
      // instead — |y| at a fixed vertex falls as r² grows, so the optimum is
      // the smallest r² that still draws it, max(5.6, 2ρ) — and running this
      // kernel at the t realising that r² draws exactly 2.0720 at grid 81 and
      // 2.0880 at 161. The 1.52 this comment used to give is the grid-90
      // reading at t = 0, and 90 is not a lattice the app lays down.
      f(x, z, t, {amp=1, freq=1}) {
        const r2=10*amp/freq*(1+Math.sin(t*0.3)*0.2);
        const d=r2*r2-4*(x*x+z*z);
        if (d<=0) return 0;
        return 2*x*z/(r2+Math.sqrt(d));
      }
    },
    enneperSurface: {
      // FIX(r11): same class as `crossCap` — the caption already said the
      // truth ("the Enneper z-coordinate"), and the caption is the half of
      // the entry nobody sees. What the plate draws is that coordinate over
      // the PARAMETER plane, which is the quadric y = 0.0896·(x²−z²) at the
      // factory sliders — matched to 5.8e-08 at grid 90 and 5.9e-08 at 161,
      // i.e. to Float32. Enneper's surface is minimal (H ≡ 0); this one has
      // max |H| = 0.0214 with 90.1 % of its vertices past 1e-3, the row below
      // in this file having measured the same thing in round 9. The name now
      // names the coordinate rather than the surface.
      name: 'Enneper z-Coordinate (u²−v²)',
      formula: 'y = u²−v², the Enneper z-coordinate; u = 0.8·freq·x, v = 0.8·freq·z; ×(1+0.3·comp·sin 0.3t)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const u=x*freq*0.8, v=z*freq*0.8;
        return (u*u-v*v) * amp * 0.2 * (1+Math.sin(t*0.3)*comp*0.3);
      }
    },
    scherkSurface: {
      name: 'Scherk Surface',
      formula: 'e^{y/k}|cos(2·freq·z + 0.2t)| = |cos(2·freq·x)|, k = 0.5·amp/freq; folded above 0.7',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r8): a graph y = k·ln(cos(a·x)/cos(a·z)) is Scherk's surface —
        // that is, minimal — only for k = 1/a. Here a = 2·freq and k was a flat
        // 0.25, so the surface was a vertically compressed Scherk graph whose
        // mean curvature reached 1.05 where minimality requires exactly 0, under
        // a row claiming machine precision. k = 0.5/freq is the same expression
        // at the one scale that satisfies the equation, verified symbolically:
        // 2H·(1+|∇y|²)^{3/2} vanishes identically.
        //
        // FIX(r8): the 1e-3 guard band around the asymptotic walls was not
        // protecting anything, it was deleting the crest of the ridge. At an
        // exact zero of cz the unguarded expression is +Infinity and
        // soften(+Inf, 0.7, 1.6) is a finite +1.6 — the true limit, and the
        // value the neighbouring vertices already read; at an exact zero of cx
        // it is -Infinity and lands on -1.6 the same way. Only the SIMULTANEOUS
        // zero gives 0/0, and that is the one case worth a branch (Math.cos
        // never returns exactly 0 for a double argument, so it is unreachable
        // in practice — it is here so the kernel, not just the height field,
        // is total). Meanwhile the band was 2e-3 rad wide while the phase 0.2·t
        // advances 0.0016 rad per rendered frame, so it swept a whole mesh row
        // to exactly 0 on 455 of 8000 consecutive frames at grid 90 (5.7 %, one
        // flicker every 0.29 s at 60 fps) and on 817 of 8000 at grid 161, each
        // one dropping that row by up to 1.60 world units — the entire half
        // height — below the value the formula gives there. The static half,
        // cos(2·freq·x), left a permanently dead COLUMN, no clock involved, for
        // 2.5 % of the freq slider at grid 90 and 4.5 % at grid 161; measured
        // over 2001 freq values, it is 0 % at every grid now.
        // Same branch shape as sinc, fejerKernel, dirichletKernel and blaschke.
        const cx=Math.cos(x*freq*2), cz=Math.cos(z*freq*2+t*0.2);
        if (cx===0 && cz===0) return 0;
        return soften(Math.log(Math.abs(cx/cz))*(0.5/freq)*amp, 0.7, 1.6);
      }
    },
    catenoid: {
      name: 'Catenoid Profile',
      formula: 'r = a·cosh(z/a), a = 0.5; drawn: r − |x|, zero on the catenary; folded above 1.2',
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
        // FIX(r6): the +/-1.5 clamp of round 5 kept the peak in frame by turning
        // the far field into a flat tabletop - 49.6 % of the mesh sat exactly on
        // the bound at the default slider and 95.8 % at the maximum, which no
        // test could see because they all watch the peak. `soften` leaves the
        // neck and the zero level set exactly where they were (the identity
        // region reaches well past them) and folds only what a clamp would cut.
        return soften((r-rxy) * amp * 0.3, 1.2, 1.9);
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
      formula: '(√(x²+z²)−R)² + (y/amp)² = r², upper sheet for x+z ≥ 0',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r8): the extra 0.5 halved the vertical semi-axis, so the section
        // drawn was an ellipse of aspect 2:1 and the implicit equation in the
        // caption held only on the tube's boundary curve. At amp = 1 the section
        // is now the circle of radius r the caption states; amp scales the whole
        // picture here as it does everywhere else in the catalogue.
        const R=1.5, r=0.5+comp*0.3;
        const dist=Math.sqrt(x*x+z*z)*freq-R;
        // FIX(r9): Math.sign returns exactly 0 when x+z is exactly 0, which the
        // anti-diagonal of every symmetric grid lands on - so 4 of 1600 in-tube
        // vertices at grid 81 and 8 of 6388 at grid 161 were drawn at height 0,
        // pinholes straight through the tube rather than a branch choice.
        // sign(x+z) is a branch SELECTOR between the two roots
        // y = +/-sqrt(r^2 - dist^2) the caption's equation has, and a height
        // field must pick one of them at every vertex including the seam;
        // `|| 1` picks the upper sheet there, which is the sheet the vertex's
        // own neighbours are already on. Cost to the picture: those 4 (8)
        // vertices move and no others - worst dy 0.416227 at grid 81 at the
        // factory sliders - and the plate's peak is unchanged to six decimals
        // at every setting and both grids, because the moved vertices land
        // inside the tube and not above it. With the hole closed the residual
        // of (sqrt(x^2+z^2)*freq - R)^2 + (y/amp)^2 - r^2 is 5.6e-16 at the
        // factory sliders and 6.7e-16 at the slider tops, on both meshes the
        // app draws, against 0.353561 and 2.583078 for the equation the caption
        // used to state; control, dividing by 1.1*amp instead of amp reads
        // 0.073326, so the check can fail.
        return Math.sqrt(Math.max(0, r*r-dist*dist)) * amp * (Math.sign(x+z) || 1);
      }
    },
    breatherSurface: {
      name: 'Breather Surface',
      formula: 'breather ansatz, a = 0.4; drawn: a scalar of it, not a pseudospherical surface; folded above 0.45',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6, partial): the ±0.6 clamp was pinning 66.3 % of the mesh flat
        // at the default sliders and 100 % of it under loud audio at the top of
        // the range — the entry rendered a plain tabletop. The expression runs
        // to 2/a − 1 = 4 in the far field, so a cut at 0.6 removed most of it;
        // `soften` keeps the working range untouched and folds the rest.
        //
        // NOT fixed, and deliberately left alone: round 5 found the a² factor
        // missing from the denominator (a[(1−a²)cosh²(aT) + a²sin²(√(1−a²)P)]),
        // and the scalar built on it is not a coordinate of the breather
        // surface either. I could not reproduce a parametrisation that passes
        // the test a pseudospherical surface must pass — Gaussian curvature
        // identically −1 — so there is nothing here I can verify a replacement
        // against. probes/fix-rest2.mjs contains the curvature routine, checked
        // on a sphere (8 digits) and a tractricoid (−1.0000000); both breather
        // parametrisations I wrote came back with K running +0.21…−1.23.
        // Replacing verified-wrong with unverified would not be an improvement.
        const a=0.4, T=x*freq*1.5, P=z*freq*1.5+t*0.3;
        const denom=a*(1-a*a)*Math.cosh(a*T)**2+a*Math.sin(Math.sqrt(1-a*a)*P)**2;
        return soften((-1+2*(1-a*a)*Math.cosh(a*T)**2/denom)*0.3*amp, 0.45, 0.95);
      }
    },
    pseudosphere: {
      name: 'Tractrix Profile Revolved',
      formula: 'ln tan(T/2) + cos T revolved, T = πr/(r+2.5), r = freq·√(x²+z²); K < 0 for r < 2.5 and r > 8.8; cusp folded to −0.8',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r6): the tractricoid parameter is defined only on (0, π), and
        // clamping the plate radius into that interval meant every vertex past
        // radius π/freq shared one value — a flat ring covering 38.4 % of the
        // mesh at the default slider. A monotone map of [0, ∞) onto (0, π)
        // shows the whole trumpet instead of cutting it off, and the profile it
        // draws is the same tractrix.
        //
        // Both ends of that profile run to infinity — the cusp at T → 0 and the
        // asymptote at T → π — so the fold, not a clamp, is what keeps it in
        // frame; unlike the clamp it leaves the shape between them alone.
        const rho=Math.sqrt(x*x+z*z)*freq;
        const T=Math.PI*rho/(rho+2.5);
        const theta=Math.atan2(z, x);
        // FIX(r8): the profile was ln tan(T/2) + sech T. The tractrix is
        // ln tan(T/2) + cos T — sech and cos agree to first order at T = 0 and
        // part company immediately after, by 0.57 over the drawn range, so the
        // curve the row quotes as "the tractrix" was not one. The reparametrised
        // radius is a separate matter and is stated in the row rather than
        // fixed: T is a monotone map of the plate radius, not arcsin of it, so
        // what is drawn is the tractrix profile revolved, not a surface of
        // constant curvature.
        return soften((Math.log(Math.tan(T/2))+Math.cos(T)) * amp * 0.35, 0.35, 0.8);
      }
    },
    crossCap: {
      // FIX(r11): the name claimed RP² and the caption's disclaimer never
      // reaches a viewer — bindMathCollectionUI is exported and called by
      // nothing, so the only text on screen is the <option> label, which is
      // this field. The claim needs no oracle to refute: the kernel returns
      // u·v·amp·0.27·(1+0.2 sin 0.3t), i.e. the GRAPH of a smooth function,
      // and a graph over the plane is embedded and orientable, while RP²
      // admits no embedding in R³ at all. Measured for the record: the drawn
      // plate is y = 0.189·x·z to 1.1e-07 at grid 90 and 1.2e-07 at 161, and
      // its first fundamental form has EG−F² ≥ 1 everywhere (minimum exactly
      // 1, at the centre), where a cross-cap's Whitney model r(u,v) =
      // (u, uv, v²) has EG−F² = 0 at its two pinch points. The name now
      // states the coordinate it does draw: uv is the middle coordinate of
      // that model, so the lineage survives without the false claim.
      name: 'Cross-Cap Coordinate (x·z saddle)',
      formula: 'y = x·z — the cross-cap saddle; the RP² gluing is not drawn',
      f(x, z, t, {amp=1, freq=1}) {
        // FIX(r8): the only entry in the catalogue that left the 3-unit frame at
        // the factory sliders, and it did it away from t = 0, where the frame
        // guard could not see it. The height is largest at the plate corner
        // (|u·v| = 12.25·freq², so 12.25 at freq 1), which every grid samples,
        // so the peak is 12.25·freq²·amp·gain·(1+0.2·sin 0.3t) — at the factory
        // sliders, 3.087 at gain 0.30 at the top of the breathing, bit-identical
        // at grids 25, 41, 81, 90 and 161 but 3 ulp off at 201, whose lattice
        // puts its own corner at 3.500000000000001 rather than 3.5. The freq²
        // is not decoration: drop it, as this comment did, and the expression
        // under-reads by that factor — 8.930 against a measured 184.88 at
        // amp 2.25 / freq 4.55.
        // The gain 0.30 → 0.27 is the smallest
        // change that fixes it: a pure scale, so every level set, the saddle and
        // the breathing are the object that was there before, 10 % shorter. The
        // peak over the whole breathing period is now 2.778, which is inside the
        // conservative half-frame of 2.90 and in the band of the tallest entries
        // in the catalogue (hydrogenS 2.856, determinant 2.755).
        const u=x*freq, v=z*freq;
        return u*v * amp * 0.27 * (1+Math.sin(t*0.3)*0.2);
      }
    },
    alexanderHorned: {
      name: 'Radial Fold Iteration',
      formula: 'sin(5·r_d), r_{n+1} = |r_n − 0.5|, r₀ = freq·√(x²+z²), d = 2+round(3·comp)',
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
      // FIX(r11): the row in MATHEMATICAL_ACCURACY.md has said since round 9
      // that there is "no S³, no S², no fibre and no fibration anywhere in
      // it", and the caption says "not the fibration" — but the label the
      // viewer picks from still promised the Hopf fibration. Measured before
      // renaming: fitting the drawn plate to any coordinate of the Hopf map
      // on any natural slice leaves 96.3–100 % relative residual, and the one
      // property that defines a fibration — linking number 1 between any two
      // fibres — is not obtainable from this surface at all (the probe reads
      // −1.000002 on a genuine Hopf link and 0.000000 on two separated
      // circles, so it can tell the difference). The name now describes the
      // ring wave the kernel computes.
      name: 'Phase-Coupled Ring Wave',
      formula: 'sin(2θ + 4r − 0.5t)·e^{−4(r−1)²} — phase-coupled circles on a ring, not the fibration',
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
        // FIX(r6): the "chaos seed" was a Weyl sequence, so the live cells sat
        // almost regularly and almost all of them were isolated. B3/S23 is
        // exact here — it was being fed a lattice, not a soup. Generation 1
        // killed 97 % of the population (12.4 % of the plate alive → 0.4 %),
        // and the round-6 time calibration measured the peak at exactly 0 at
        // t = 1.5. With an avalanche hash the same rule on the same density
        // behaves like Life: 12.8 % → 8.5 % → settling around 5 %, i.e. 41 %
        // of the seed still alive after twelve generations instead of 6 %.
        for (let i = 0; i < W * H; i++) if (hash32(i) % 100 < 8 + comp * 8) grid[i] = 1;
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
      formula: '3-state: ON→DYING→OFF→(2 nb ON)→ON; height = state/2: OFF 0, ON ½, DYING 1',
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
      // FIX(r11): 'density' promised a count; the height is the cell's COLOUR, i.e. the parity of visits. Exactly two heights exist, 0 and 0.4, and a cell visited twice is drawn at the same height as one the ant never reached.
      // Renamed from "Langton's Ant (trajectory density)": the <option> label is the only text a
      // viewer reads for an entry — the caption never reaches the DOM.
      name: "Langton's Ant (cell colour)",
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
      formula: 'Cell advances if any nb = (state+1) mod N, N = 6…8; height = state/N, so the wrap to 0 draws as a cliff',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        const W = res, H = res;
        const N = 4 + Math.round(comp * 4);
        const gen = Math.round(t * 0.5) % 15;
        let grid = new Uint8Array(W * H);
        // FIX(r6): `(i·2246822519) >>> 0 % N` is degenerate whenever N divides
        // a power of two. At N = 4 and N = 8 the state came out as a multiple
        // of i mod N, which depends only on the column: 100 % of columns were
        // a single state and the variance down every column was exactly 0.0 —
        // vertical stripes, not the spirals a cyclic CA is watched for. The
        // rule itself was never in question, only what it was started from.
        for (let i = 0; i < W * H; i++) grid[i] = hash32(i ^ 0x5bf03635) % N;
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
      formula: 'Electron head→tail→wire→head if 1-2 nb heads; height = state/3: empty 0, wire ⅓, head ⅔, tail 1',
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
      name: 'Voronoi Tessellation',
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
      name: 'Excitable Medium (Barkley spirals)',
      formula: '\u2202u/\u2202t = D\u2207\u00b2u + u(1\u2212u)(u \u2212 (v+b)/a)/\u03b5; \u2202v/\u2202t = u \u2212 v \u2014 Barkley, \u03b5 0.02, b 0.01, a 0.70\u21920.80 with comp; drawn: max(u,0), spiral advancing with the clock',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        // 1200 steps to curl the broken front into a spiral, then the clock.
        const st = barkleySim(simBucket(comp), simSteps(t, 1200, 200, 4000), { comp });
        const out = new Float32Array(res * res);
        for (let r = 0; r < res; r++) for (let c = 0; c < res; c++) {
          const ri = Math.floor(r / res * SIM_N), ci = Math.floor(c / res * SIM_N);
          out[r * res + c] = clamp(st.u[ri * SIM_N + ci], 0, 1) * amp * 0.5;
        }
        return out;
      }, 64),
    },
    reactionDiffusion: {
      name: 'Gray-Scott Pattern',
      formula: '\u2202u/\u2202t = Du\u2207\u00b2u \u2212 uv\u00b2 + F(1\u2212u); \u2202v/\u2202t = Dv\u2207\u00b2v + uv\u00b2 \u2212 (F+k)v; F 0.030\u21920.038 and k 0.055\u21920.061 with comp (Pearson \u03b4\u2192\u03b8); drawn: min(4v,1), the medium advancing with the clock',
      f: createCachedHeavySampler((t, {amp = 1, comp = 1}, res) => {
        // 900 steps to reach a pattern from the scattered seed, then one step
        // per 1/60 of a time unit, capped so a cold recompute stays bounded.
        const st = grayScottSim(simBucket(comp), simSteps(t, 900, 60, 3000), { comp });
        const out = new Float32Array(res * res);
        for (let r = 0; r < res; r++) for (let c = 0; c < res; c++) {
          const ri = Math.floor(r / res * SIM_N), ci = Math.floor(c / res * SIM_N);
          out[r * res + c] = clamp(st.v[ri * SIM_N + ci] * 4, 0, 1) * amp * 0.5;
        }
        return out;
      }, 64),
    },
    forestFire: {
      name: 'Forest Fire CA',
      formula: 'Tree→Fire if nb burning or by lightning (f); Fire→Ash; Ash→Tree (p); height = state/2: ash 0, tree ½, fire 1',
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
      name: 'Conway 3D Rule (3-layer mean)',
      // FIX(r8): the caption promised the mid-y slice and the code has averaged
      // three adjacent layers since round 6 — a projection that smooths the
      // rule's own structure across more than half the plate's cells.
      // MATHEMATICAL_ACCURACY.md recorded the change; the line a user reads did
      // not.
      formula: 'B5-7/S6 — 3D Game of Life rule, mean of three adjacent y layers; soup reseeded every ½ of t (≈1 s at 60 fps)',
      // Full 3D B5-7/S6 simulation on an 18³ grid; returns the MEAN of the
      // three y layers around the middle, not the "y=mid slice" this line
      // claimed until round 9 — the same defect FIX(r8) above records one
      // level up. Initial configuration is hash-seeded (~30% density), then
      // 3-5 generations are evolved.
      //
      // NOTE(r9): the soup reseed from floor(t·2) is a DELIBERATE choice, kept
      // after measurement, and not an oversight round 8 forgot. t reaches this
      // simulator nowhere else, so the plate is a step function of the clock:
      // at the rebuild cadence of createCachedHeavySampler (Δt = 0.024, every
      // third frame) 40 of 40 ordinary rebuilds inside one bucket change
      // 0.0000 % of the plate at grids 81 and 161 at all five settings, and
      // the one rebuild in ~21 that crosses a boundary changes 69.97-74.40 %.
      // Running one continuing evolution instead buys the viewer nothing
      // measurable, because this rule at this density mixes faster than the
      // frame rate: over 40 soups the drawn 18² field correlates -0.152
      // between generations 4 and 5, -0.017 against a completely DIFFERENT
      // soup at the same generation, and -0.001 against a shuffled copy of
      // itself, and the autocorrelation of one evolution against its own
      // generation 4 is back inside that shuffle baseline by generation +2.
      // A reseed is therefore not a bigger discontinuity than the rule's own
      // step, and the rule does not settle either — five soups run 300
      // generations with no state repeat. It would also cost: the CA has no
      // inverse, so a t-driven generation counter must replay from the soup
      // (0.34 ms a generation here, unbounded in t), and t is not monotone —
      // callers pass time + beatInt·0.3 while beatInt decays 0.04 a frame
      // against the clock's 0.008, so t runs backwards for ~25 frames after
      // every beat and the counter would step the evolution backwards. The
      // caption states the reseed and its period; that is what the display
      // contract asks of it. Full numbers in MATHEMATICAL_ACCURACY.md.
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
        // FIX(r6): the old table never left state 0 — both of its state-0 rows
        // wrote state 0 — so the two state-1 rows were unreachable and the
        // "2-state Turing machine" was a one-state ant that closed into a
        // period-8 cycle: 4 raised cells out of 3136, 0.13 % of the plate,
        // state 1 entered 0 % of the time.
        //
        // The replacement was not guessed. All 65 536 rules of the 2-state
        // 2-colour family (4 transitions × 2 colours × 4 turns × 2 states) were
        // run for 700 steps and scored on what this entry needs: both states in
        // real use, the pattern still growing at the end of the run rather than
        // settling, and a fill that reads as a structure. 2932 rules survive;
        // this one keeps growing longest — 7.7 % of the plate at 700 steps,
        // 17.5 % at 1200, 39.3 % at 6000 — where the runner-up saturates at
        // 7.0 % and never moves again. probes/fix-ca.mjs replays the search.
        //
        // Rule, as {cell,state} → {newCell, turn, newState}:
        //   0,0 → 1, N, 0    1,0 → 1, L, 1    0,1 → 0, R, 1    1,1 → 0, L, 0
        //
        // The step count rose with it. It bounds a loop over steps, not over
        // cells, so a longer run is nearly free, and it is what makes the
        // complexity slider visible: 1500 steps fill 19 %, 4500 fill 35 %.
        const steps = 1500 + Math.round(comp * 3000);
        const grid = new Uint8Array(W * H);
        let r = H / 2 | 0, c = W / 2 | 0, dir = 0, state = 0;
        const dr = [-1, 0, 1, 0], dc = [0, 1, 0, -1];
        for (let i = 0; i < steps; i++) {
          const idx = r * W + c, cell = grid[idx];
          let turn;
          if (cell === 0 && state === 0) { grid[idx] = 1; state = 0; turn = 0; }
          else if (cell === 1 && state === 0) { grid[idx] = 1; state = 1; turn = -1; }
          else if (cell === 0 && state === 1) { grid[idx] = 0; state = 1; turn = 1; }
          else { grid[idx] = 0; state = 0; turn = -1; }
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
      formula: '|ψ_n|² = 2/L sin²(nπξ/L), ξ = clamp((freq·x+3.5)/7), ×e^{−0.3z²}; no clock — a stationary state does not breathe',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*5), L=1, xi=clamp((x*freq+3.5)/7, 0, 1);
        const psi=Math.sqrt(2/L)*Math.sin(n*Math.PI*xi);
        // FIX(r11): the ×(0.8+0.2cos(0.015n²t)) pulse is gone, for the reason
        // the row in MATHEMATICAL_ACCURACY.md already gave and the kernel then
        // ignored: "a stationary state must not breathe". Measured before the
        // cut: peak 1.000000 at t = 0 against 0.600000 at t = 13.09 on grid 161
        // (0.999225 against 0.599535 on grid 90) — ×1.666667, the algebraic
        // ceiling 1.0/0.6, with a period of 26.18 units, 54.5 s at 60 fps.
        // n² in the phase made the box breathe faster as the level rose, which
        // is the energy dependence a real time-dependent state would show in
        // its PHASE and never in |ψ|². The pulse was 1.0 at t = 0, so the boot
        // plate is unchanged.
        return psi*psi * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    harmonicOscillator: {
      name: 'QM Harmonic Oscillator |ψ_n|²',
      formula: '|ψ_n|² = [H_n(ξ)e^{−ξ²/2}]²/(2ⁿn!√π), ξ = 2·freq·x, ×e^{−0.3z²}; no clock — a stationary state does not breathe',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(comp*6), xv=x*freq*2;
        // Hermite via recurrence
        let Hm=1, H=2*xv;
        for (let k=1; k<n; k++) { const tmp=2*xv*H-2*k*Hm; Hm=H; H=tmp; }
        const H_n = n===0 ? 1 : H;
        // FIX(r6): the normalisation the caption writes, 1/√(2ⁿn!√π), was never
        // applied — the code multiplied H_n²e^{−x²} by the constant 0.003. What
        // was dropped depends on n, and n is driven by the mid band, so one
        // sweep of the slider moved the height by ×74.2 and took it out of the
        // frame at 6.78 (factory sliders, loud) and 11.27 (both sliders up)
        // against a half-frame of about 3. This is not the studio's fixed-scale
        // convention: that allows a CONSTANT factor, and this one is a function
        // of a parameter.
        //
        // Putting it in is what stabilises the height rather than merely
        // shrinking it: max|ψ_n|² is 0.3456, 0.3288, 0.3163 for the reachable
        // n = 3, 4, 5 — a spread of 1.09 against 73.2 — so a single display
        // constant now serves every n. 3.6 puts the factory peak at 0.859 and
        // the top of both sliders at 1.99. (2ⁿ·n! = Π_{k≤n} 2k.)
        let norm=Math.sqrt(Math.PI);
        for (let k=1; k<=n; k++) norm*=2*k;
        const psi=H_n*Math.exp(-xv*xv/2)/Math.sqrt(norm);
        // FIX(r11): the ×(0.8+0.2cos(0.02nt)) pulse is gone. |ψ_n|² of an
        // energy eigenstate cannot depend on t at all — the phase e^{−iE_nt/ħ}
        // cancels in the modulus — and this one breathed by ×1.666667 (peak
        // 1.242542 at t = 0 against 0.745525 at t = 52.36 on grid 161, 1.226839
        // against 0.736103 on grid 90) with a period of 104.72 time units,
        // which is 218 s of wall clock at the app's 0.008-per-frame rate. It is
        // the same defect round 5 cut out of `hydrogenS`, and the ruling sits
        // 300 lines above this one in this file. The pulse was 1.0 exactly at
        // t = 0, so the plate a viewer meets at boot is bit-identical to what
        // shipped; what changes is that it stops moving afterwards.
        return psi*psi * 3.6 * amp * Math.exp(-z*z*0.3);
      }
    },
    hydrogenS: {
      name: 'Hydrogen 1s |ψ|²',
      formula: '|ψ₁₀₀|² = 1/π·e^{−2r}',
      // FIX(r8): display constant 2 → 1.7, because removing the +0.01 from
      // hydrogenPsi took the true peak back up to its own value and the entry
      // was already standing on the frame limit. |ψ|² peaks at the origin, and
      // the grid decides whether a vertex lands there: at the factory sliders
      // the plate read 2.947 at grid 90 (which has no vertex at 0) but 3.293 at
      // 25 and 161 (which do), against a frame the suite calls at 3.0 — so the
      // entry was out of frame on odd grids already and passed only because the
      // guard checks grid 90. At 1.7 the true peak is 4·0.6·0.7·1.7 = 2.856 at
      // the factory sliders on every grid. Nothing about the wavefunction moves:
      // hydrogenPsi still returns exactly R₁₀(r)²·0.6.
      f(x, z, t, {amp=1, freq=1}) {
        return hydrogenPsi(1, 0, x*freq, z*freq, t) * amp * 1.7;
      }
    },
    hydrogen2p: {
      name: 'Hydrogen 2p |ψ|²',
      // FIX(r7): the caption this round added read cos²(φ − 0.3t) while
      // hydrogenPsi computes cos(l·θ + 0.3t) — the sign is the direction the
      // lobe pair turns, so the picture and its own caption disagreed on it.
      formula: '|ψ_{2p}|² ∝ r²e^{−r}·cos²(φ + 0.3t) — a 2p lobe pair in the xz-plane, turning',
      f(x, z, t, {amp=1, freq=1}) {
        return hydrogenPsi(2, 1, x*freq*0.5, z*freq*0.5, t) * amp * 4;
      }
    },
    tunneling: {
      name: 'Quantum Tunneling',
      formula: 'T = e^{−2κL} = env² past the barrier, κ=1+2·comp; drawn: Re ψ = env·cos(4·freq·ξ+t)·e^{−0.25z²}, ξ = freq·x',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const kappa=1+comp*2, L=1;
        const xi=x*freq;
        // FIX(r6): inside the barrier the amplitude was e^{−κ|ξ|}·0.7 — a
        // symmetric tent with its maximum at the CENTRE — so across the entry
        // half the wave GREW by a factor of e instead of decaying: measured
        // 1.000, 1.649, 2.718, 1.649, 1.000 across ξ = −0.5 … +0.5, where the
        // exact 4×4 matching solution for the same κ gives 1.000, 0.613, 0.385,
        // 0.261, 0.220. Both faces also carried a step (0.303 and 0.185 on the
        // surface at amp = 1). And the transmitted amplitude e^{−κ·0.5} belonged
        // to half the drawn barrier: |ψ|² came out 1.353e−1 where this entry's
        // own caption, T = e^{−2κL} with the drawn L = 1, says 1.832e−2.
        //
        // The envelope is now the textbook one — 1 to the left, e^{−κ(ξ+L/2)}
        // through the barrier, e^{−κL} beyond — monotone across the barrier as
        // the exact solution is, continuous at both faces (steps 3.7e−6 and
        // 3.9e−7, finite-difference residue), and transmitting exactly the
        // e^{−2κL} the caption promises. It stays the schematic the document
        // calls it: the left-hand side is drawn as a pure incident wave, with no
        // interference from the reflected one.
        const env = xi < -0.5 ? 1
                  : xi >  0.5 ? Math.exp(-kappa*L)
                  :             Math.exp(-kappa*(xi+0.5));
        return env*Math.cos(freq*xi*4+t) * amp * 0.45 * Math.exp(-z*z*0.25);
      }
    },
    wavePacket: {
      name: 'Gaussian Wave Packet',
      formula: 'ψ(ξ,τ)=e^{−(ξ−vτ)²/4σ²}e^{i(kξ−ωτ)}; drawn: [Re ψ]²·e^{−0.25z²}, ξ = freq·x, τ = t mod 16',
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
      // FIX(r8): the caption named only the state, which left the accuracy row
      // as the sole statement of what is plotted — and that row still described
      // the population difference cos θ that round 6 replaced with ⟨σx⟩. The
      // two differ by 70.7 % of full scale, so the caption now says which Bloch
      // component reaches the screen.
      formula: '|ψ⟩ = cos(θ/2)|0⟩+e^{iφ}sin(θ/2)|1⟩; drawn: ⟨σx⟩ = sin θ·cos φ',
      f(x, z, t, {amp=1, freq=1}) {
        const theta=Math.PI*(x*freq+1)*0.5, phi=z*freq*Math.PI+t*0.4;
        // FIX(r6): cos²(θ/2) − sin²(θ/2) = cos θ is the population difference and
        // does not depend on φ at all; multiplying it by cos φ produced a surface
        // that is none of the three Bloch components (closest was ⟨σy⟩, off by
        // 1.000 out of a range of 2). The worst of it is at the pole: at θ = 0
        // the state is |0⟩ for every φ, and the old surface still swung over
        // [−1.000, +0.999] along z. sinθ·cosφ IS a Bloch component — ⟨σx⟩ — and
        // it costs the same arithmetic and the same peak.
        return Math.sin(theta)*Math.cos(phi) * amp * 0.45;
      }
    },
    doubleSlitProbability: {
      name: 'Double-Slit Interference |ψ|²',
      formula: '|ψ₁+ψ₂|² = 2I₀(1+cos(δ))',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        // FIX(r6): the 1/r amplitudes were the defect, and the caption above
        // never asked for them — |ψ₁+ψ₂|² = 2I₀(1+cos δ) is the equal-amplitude
        // statement. Both slits sit inside the plate, so near them r fell to
        // the 1e-3 regulariser, the amplitude went as 1/r and the intensity as
        // 1/r²: the peak reached 58.6 world units against a ~3-unit frame, and
        // because the spike lives between mesh vertices its height depended on
        // where the mesh happened to sample — measured 1.9 / 324 / 84 / 3706
        // across grids 25 / 49 / 90 / 161, a spread of ×1926. The grid is
        // round(sqrt(vertexCount)) of the selected shape — 24 discrete values
        // from 3 to 198, not planeSegs, which is only ever 80 or 160 — so that
        // was a different picture on every machine AND on every shape. Now the phase difference is kept and the amplitudes are
        // equal: bounded in [0, 2] everywhere, identical at every grid density,
        // and the fringes have full visibility (minima 2.7e-8 of the peak).
        const d=0.5+comp*0.5, k=8+comp*4;
        const r1=Math.hypot(x*freq-d, z*freq);
        const r2=Math.hypot(x*freq+d, z*freq);
        return (1+Math.cos(k*(r1-r2))) * amp * 0.5;
      }
    },
    densityMatrix: {
      name: 'Density Matrix ρ Diagonal',
      formula: 'ρ = Σ pₖ|ψₖ⟩⟨ψₖ|; drawn: diagonal Σ pₖ sin²(kπ(ξ+½))·e^{−0.3z²}, pₖ = e^{−k/2}, ξ = freq·x — box states, tiled',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*4);
        let rho=0;
        for (let k=1; k<=n; k++) {
          // FIX(r8, wording): these are geometric weights, e^{−k/2}, i.e.
          // Boltzmann for a ladder LINEAR in k. The states below are box states,
          // whose energies go as k², so a thermal mixture of them would need
          // e^{−βk²}. The number is left alone and the false word removed: with
          // β = 1/6 (the β that reproduces this p₂/p₁) the box weights pin
          // 5.5–5.8 % of the plate at the 0.7 ceiling this kernel never reaches,
          // and the top step of the comp slider falls from 0.017 to 0.003.
          const pk=Math.exp(-k*0.5);
          const psi_k=Math.sin(k*Math.PI*(x*freq+0.5));
          rho+=pk*psi_k*psi_k;
        }
        return clamp(rho * amp * 0.3 * Math.exp(-z*z*0.3), 0, 0.7);
      }
    },
    landauLevels: {
      name: 'Landau Level (2D magnetic)',
      // FIX(r8): the parenthetical was false. [L_n^0(r²)]²e^{−r²} is the radial
      // density of the m = 0 state of level n, and multiplying it by cos²(nθ)
      // — the angular factor of |m| = n — gives a function that is an
      // eigenstate of nothing: the m = ±n pair has to vanish at the origin and
      // this surface is brightest there. The Laguerre recurrence itself is
      // exact to 4.7e-16, so the arithmetic stays and the claim goes.
      formula: 'E_n = ħω_c(n+½); drawn: the m = 0 radial density [L_n(r²)]²·e^{−r²}, given a turning cos²(nθ + ω_c t/10) pattern',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(comp*5), omega_c=2+comp;
        const r2=(x*freq)**2+(z*freq)**2;
        // Generalized Laguerre L_n^0 via recurrence — exact for any n.
        const L_n = laguerreL(n, 0, r2);
        // FIX(r9): theta is undefined at r = 0 and the kernel evaluated cos(n·theta)
        // there anyway, so the PEAK of the whole plate was decided by float noise in
        // the mesh. The app's lattice puts the centre column at exactly 0 on grid 81
        // and 161, but 13 of the 100 odd grids in 3..201 miss it by 4.44e-16 — and
        // there atan2 returns pi/4, not 0. Measured at the reachable over-drive:
        // peak 0.90000 on grid 81 against 0.45000 on grid 83, both odd, both
        // selectable. Pinning theta to 0 inside the singular vertex makes the odd
        // grids agree with each other and changes nothing on 81 or 161, where the
        // vertex is already exactly at the origin. This is the float-noise half of
        // the problem; the physics half — that the |m| = n state must VANISH at the
        // origin while this surface is brightest there — is FIX(r8) above and is
        // still open.
        const theta = r2 < 1e-12 ? 0 : Math.atan2(z, x);
        const psi=L_n*Math.exp(-r2/2)*Math.cos(n*theta+omega_c*t*0.1);
        return psi*psi * amp * 0.4;
      }
    },
    schrodingerSoliton: {
      name: 'NLS Soliton',
      // FIX(r8): three names for one surface — the kernel returns A²sech²,
      // which is |ψ|²; this caption called it |ψ| = A·sech, and the accuracy
      // row called it A·sech², which is neither the amplitude nor the density.
      // The kernel is right and was verified against a symbolic NLS residual of
      // zero, so the two labels move to it.
      formula: '|ψ|² = A²·sech²(A(x−vt))',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const A=1+comp, v=0.5;
        // FIX(#5, r4): the soliton translates at v·0.3 per unit of clock and
        // never returned — 3·10⁻⁷ of the boot peak two minutes in, exactly zero
        // by five. 24 is one pass of the domain, after which the next soliton
        // enters from the left; see replayTime.
        const xi=x*freq-v*replayTime(t, 24)*0.3;
        // FIX(r6): |ψ|² of an NLS soliton is A²sech²(Aξ) — height A², width 1/A,
        // and the two are tied, which is what makes it a soliton. The A² was
        // missing, so the width followed `comp` and the height did not: measured
        // peak was 0.500·amp at comp 0.5, 0.7 and 0.9 alike, where A² asks for a
        // ratio of 1.604 between the ends of the slider. The display constant
        // halves with it so the surface stays where it was in frame.
        const sech=1/Math.cosh(A*xi);
        return A*A*sech*sech * amp * 0.25 * Math.exp(-z*z*0.25);
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
      formula: '|ψ_sp²|², ψ_sp² = (1/√3)(2s + √2·(p_x cosφ + p_z sinφ))',
      f(x, z, t, {amp=1, freq=1, comp=0.5}) {
        // Genuine sp² hybridization (3 lobes at 120°) is expressible in the
        // xz-plane: |sp²⟩ = (s + √2·(p_x cosφ + p_z sinφ)) / √3.
        // The φ parameter (driven by `comp`) rotates which lobe is "front".
        // Note: sp³ would need p_y, which is out of the visualization plane,
        // so this routine is restricted to sp².
        // FIX(r8): nothing here divides by r — psi_s, psi_px and psi_pz are all
        // polynomials times e^{−r/2} — and theta comes from atan2, which is
        // defined at the origin, so the +1e-6 guarded nothing and cost 4.08e-7
        // worst over the reachable box against a peak of 0.12, under a row
        // rated A.
        const r=Math.sqrt(x*x+z*z)*freq, theta=Math.atan2(z,x);
        const phi=comp*Math.PI*2 + t*0.05;
        // FIX(r6): sp² mixes orbitals of ONE shell — 2s with 2p — and this took
        // 1s. The difference is visible, not formal: the real hybrid inherits
        // the 2s radial node, so the front lobe gives way to the back one past
        // r ≈ 2.4. Measured front/back at φ = π — with 1s: 5.77 / 43.15 / 3.41 /
        // 1.72 at r = 1/2/3/4, never inverting; with 2s: 33.97 / 1.00 / 0.383 /
        // 0.228, inverting at the node exactly where it should.
        const psi_s = (2-r)*Math.exp(-r/2) / Math.sqrt(32*Math.PI);
        const psi_px= r*Math.exp(-r/2)*Math.cos(theta) / Math.sqrt(32*Math.PI);
        const psi_pz= r*Math.exp(-r/2)*Math.sin(theta) / Math.sqrt(32*Math.PI);
        const psi = (psi_s + Math.SQRT2*(psi_px*Math.cos(phi) + psi_pz*Math.sin(phi))) / Math.sqrt(3);
        return psi*psi * amp * 4;
      }
    },
    bellState: {
      name: 'Bell State Correlations',
      formula: '|Ψ⁻⟩ = (|01⟩−|10⟩)/√2, E(a,b) = −cos(a−b)',
      f(x, z, t, {amp=1, freq=1}) {
        const phi1=x*freq*Math.PI, phi2=z*freq*Math.PI;
        // Simulate E(a,b) = -cos(a-b)
        return -Math.cos(phi1-phi2+t*0.3) * amp * 0.45;
      }
    },
    feynmanPath: {
      name: 'Feynman Path Integral (free particle)',
      formula: 'K(x,t) = (m/2πiħt)^½ e^{imx²/2ħt}; drawn: Re K·e^{−0.25z²}, t → T = 0.5+0.05·(t mod 24)',
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
        // FIX(r6): the (1/i)^{1/2} = e^{-i*pi/4} in front of the propagator was
        // dropped, so the real part drawn was cos(x^2/2T) where it should be
        // cos(x^2/2T - pi/4). A 45-degree phase shift moves every fringe: it
        // changes the pattern, not its scale, and the entry was rated "exact".
        const T=0.5+replayTime(t, 24)*0.05;
        const phase=(x*freq)**2/(2*T) - Math.PI/4;
        return Math.cos(phase) * amp * 0.4 / Math.sqrt(T) * Math.exp(-z*z*0.25);
      }
    },
    quantumZeno: {
      name: 'Quantum Zeno Effect',
      formula: 'P_survive(T) = cos²ᴺ(ωT/2N) → e^{−T²/τz}; drawn: P·e^{−0.3z²}, T = 4(x+3.5)/7 along x, N = round(1+20·comp)',
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
 * Half-width of the height-field lattice in world units — the domain every
 * surface formula is evaluated over, and the domain applyHeightField samples
 * back out of.
 *
 * It is a named export because the two must AGREE and they live in different
 * modules: generateSurfaceFromFormula writes the lattice
 * x = −extent + xi·step, and sampleHeightField recovers xi from x with the
 * same arithmetic. Two literals that happen to match is not agreement — it is
 * a coincidence with a name. There are four such sites in the surface chain:
 * math-visualizer.js posts one extent to the worker and passes another on the
 * sync fallback, math-worker.js defaults a third, and this file defaulted a
 * fourth. A mismatch does not throw — it silently rescales the drawn surface
 * against the mesh it is drawn on.
 *
 * ROUND 10 CONVERTED ONE OF THE FOUR, NOT ALL FOUR. This constant is that one.
 * The other three are still the literal 3.5. Nothing stops them importing this
 * name — math-worker.js already imports generateSurfaceFromFormula from here —
 * so the remaining work is small and has simply not been done. What keeps them
 * from drifting meanwhile is not the constant, it is
 * a test: `tests/surface-field-on-shapes.test.js`, "every extent in the chain
 * is the same number, or the surface is silently rescaled", reads all three
 * sites out of the source text and fails if any of them is neither
 * FIELD_EXTENT nor a number equal to it. Measured: changing any one of the
 * three to 3.4 takes that file from 9 pass / 0 fail to 8 / 1, and each of the
 * three fails it alone. The test carries its own precondition assertions, so a
 * site that moves out from under its pattern fails loudly rather than silently
 * going unchecked.
 *
 * Two further 3.5s exist on the VOLUME path — generateVolumeFromFormula's own
 * default here and the argument math-visualizer's volume tick passes it. They
 * are the same distance and are not covered by that test; the surface chain is
 * what the guard reads.
 *
 * The value itself is the plate: PlaneGeometry(7, 7, …) spans ±3.5.
 */
export const FIELD_EXTENT = 3.5;

/**
 * Generate a Three.js-compatible height field from a formula.
 *
 * @param {Function}  fn       — formula.f(x, z, time, params) → y
 * @param {object}    params   — { amp, freq, comp }
 * @param {number}    gridSize — number of vertices per side (default 90)
 * @param {number}    extent   — half-width of grid in world units (FIELD_EXTENT)
 * @param {number}    time     — current animation time
 * @returns {Float32Array}     — flat array of Y values [gridSize²], row-major
 */
export function generateSurfaceFromFormula(fn, params = {}, gridSize = 90, extent = FIELD_EXTENT, time = 0) {
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
 * Bilinear sample of a row-major gridSize² height field at world (x, z), on the
 * same lattice generateSurfaceFromFormula wrote it on: x = -extent + xi*step,
 * z = -extent + zi*step, step = 2*extent/(gridSize-1). Outside the domain the
 * value is clamped to the edge of the lattice, so a vertex beyond ±extent
 * carries the boundary value rather than a hole.
 *
 * The lattice index is recovered EXACTLY when the vertex sits on a lattice
 * line: `Math.fround(-extent + k*step) === v` is the same arithmetic, in the
 * same order, that produced the coordinate, so a mesh whose vertices ARE the
 * lattice (the rotated PlaneGeometry) is read straight out of the array with
 * no interpolation at all. That is what keeps the fix a no-op on the one shape
 * the old index-identity was right for.
 */
function sampleHeightField(heightField, grid, extent, step, x, z) {
  // Kept deliberately, and it is not the grid-1 lattice it looks like it is
  // guarding. `grid` is Math.max(1, floor(sqrt(length))), so grid < 2 means a
  // field of 0 or 1 values, and the case that matters is the EMPTY one: step
  // is then (extent*2)/0 = Infinity, fx = (x+extent)/Infinity = 0, and the
  // interpolation below reads heightField[0] — undefined — so every vertex
  // gets NaN and the mesh disappears. Deleting this line in a sandbox copy
  // gives an empty field [NaN, NaN, NaN, NaN] on a 4-vertex plate where it
  // gives [0, 0, 0, 0] with the line, while a length-1 field and a normal
  // grid-3 field come out bit-identical either way. That is committed, not a
  // note: `tests/surface-plumbing.test.js`, "a field that is not gridSize²
  // still writes a number, never NaN", is the test this line has to keep
  // green, and it is the one test in the suite that goes red when the line is
  // removed. No catalogue shape reaches the branch — the smallest grid the app
  // produces is 3, for the 12-vertex tetrahedron, measured over all twenty
  // shapes at both planeSegs — so it is a boundary against a caller handing
  // over a field that was never filled, not a live path.
  if (grid < 2) return heightField[0] ?? 0;
  const last = grid - 1;

  let fx = (x + extent) / step;
  const kx = Math.round(fx);
  if (kx >= 0 && kx <= last && Math.fround(-extent + kx * step) === x) fx = kx;
  else if (!(fx > 0)) fx = 0;              // below the domain, or NaN
  else if (fx > last) fx = last;           // past it

  let fz = (z + extent) / step;
  const kz = Math.round(fz);
  if (kz >= 0 && kz <= last && Math.fround(-extent + kz * step) === z) fz = kz;
  else if (!(fz > 0)) fz = 0;
  else if (fz > last) fz = last;

  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0,        tz = fz - z0;
  const x1 = tx === 0 ? x0 : x0 + 1;
  const r0 = z0 * grid,      r1 = (tz === 0 ? z0 : z0 + 1) * grid;

  const a = heightField[r0 + x0] + (heightField[r0 + x1] - heightField[r0 + x0]) * tx;
  const b = heightField[r1 + x0] + (heightField[r1 + x1] - heightField[r1 + x0]) * tx;
  return a + (b - a) * tz;
}

/**
 * Apply a height field (from generateSurfaceFromFormula) to an existing
 * Three.js BufferGeometry's position attribute (Y channel only).
 *
 * The field is a DISPLACEMENT along Y from the shape's pristine position,
 * sampled at each vertex's own (x, z):  y_i = baseY_i + f(x_i, z_i).
 *
 * FIX(r10 §1.3/§1.4/§1.6): it used to hand heightField[i] to vertex i. That
 * identity holds for exactly one geometry in the catalogue — the rotated
 * PlaneGeometry, whose vertices ARE this lattice in this order. On the other
 * nineteen it drew a PERMUTATION of the function.
 *
 * THE THREE FIGURES BELOW ARE READ ON THE PRE-ROUND-10 TREE — `git archive
 * c629b53` — at desktop planeSegs 160, each shape on its own
 * grid = round(√vertexCount). The tree matters as much as the rule: round 10
 * also rebuilt cone, pyramid and pyramid-smooth, so replaying the old
 * assignment on TODAY's geometry answers a different question and reads eight
 * negatives rather than four. Anyone re-deriving these must check out c629b53
 * first.
 *
 *   • Pearson r between drawn height and f at the vertex's own (x, z), probe
 *     field f = sin(1.3x) + cos(0.9z) + 0.2xz: ≤ 0.191 on all nineteen — star,
 *     the best of them, reads 0.191 — and negative on FOUR: sphere −0.362,
 *     tetrahedron −0.361, dodecahedron −0.113, solar −0.113.
 *   • It tore the five PolyhedronGeometry solids apart, because their
 *     coincident corner vertices carry different indices and so took different
 *     heights: on the probe f = x, whose range over the domain is 7.000, the
 *     spread inside a group of coincident vertices reaches 7.000 — the WHOLE
 *     range — on every one of the five, on a body of radius 3.5. (6.914 is the
 *     cone / pyramid-smooth figure on that tree, not a polyhedron one, and
 *     torusknot's is 5.562; the five really are at the ceiling.)
 *   • The `heightField[i] ?? 0` tail pinned every vertex past gridSize² flat at
 *     y = 0 — 321 over the catalogue, contiguous because three's vertex order is
 *     per-face: box 162 (all at z = −2.5, two whole rows of its −Z face), ring
 *     56, torus 45, hex 17, icosahedron-smooth 15, pyramid 14, dodecahedron 8,
 *     tetrahedron 3, star 1.
 *
 * Sampling at the vertex's own (x, z) removes all three at once: coincident
 * vertices sample the same point, and no vertex is unfed. Each of the three has
 * a live stencil in `tests/surface-field-on-shapes.test.js` — the correlation,
 * tearing and "every vertex is fed" tests — and each of those carries a CONTROL
 * that replays the old rule and must keep reporting the defect, so the numbers
 * above stay measurable from the repository rather than only from history.
 *
 * gridSize is not a parameter: the field is gridSize² by construction, so it
 * is read back off the field's own length — a caller cannot pass one that
 * disagrees with the array it also passes.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {Float32Array}         heightField   — gridSize² values, row-major (z outer)
 * @param {Float32Array|null}    basePositions — pristine [x,y,z,…] of this geometry;
 *                                  the Y it displaces from. Null (or a stale
 *                                  length) falls back to y = 0, i.e. the surface
 *                                  alone — never to the old index identity.
 * @param {number}               extent        — half-width of the lattice, as passed
 *                                  to generateSurfaceFromFormula. Defaults to the
 *                                  same FIELD_EXTENT that function defaults to, so
 *                                  a caller that passes neither cannot mismatch
 *                                  them; a caller that passes one must pass both.
 */
export function applyHeightField(geometry, heightField, basePositions = null, extent = FIELD_EXTENT) {
  const pos  = geometry.attributes.position;
  const n    = pos.count;
  const grid = Math.max(1, Math.floor(Math.sqrt(heightField.length)));
  const step = grid > 1 ? (extent * 2) / (grid - 1) : 0;
  const base = (basePositions && basePositions.length === n * 3) ? basePositions : null;

  for (let i = 0; i < n; i++) {
    const y0 = base ? base[i * 3 + 1] : 0;
    pos.setY(i, y0 + sampleHeightField(heightField, grid, extent, step, pos.getX(i), pos.getZ(i)));
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
  const step = (extent * 2) / (gridSize - 1);

  // FIX(r11): the field used to be gridSize² long whatever geometry it was
  // given, while applyDisplacementField walks every vertex and reads
  // `df[i*3] ?? 0` — so on any shape whose vertex count is not exactly
  // gridSize² the tail stood still while the rest of the mesh moved. Measured
  // on the shipped meshes: 162 vertices frozen on box, 56 on ring, 45 on torus,
  // 20 on star, 17 on hex, 15 on icosahedron-smooth, 8 on dodecahedron and 3 on
  // tetrahedron — 326 across 8 of the 20 shapes, and on box that is two whole
  // rows of the cap. There is nothing to interpolate here: a volume formula is
  // a vector field of position, so it is evaluated at each vertex's own
  // position when the geometry is known, and the grid is used only for the
  // synthetic flat lattice that has no geometry to speak of.
  const N = basePositions ? basePositions.length / 3 : gridSize * gridSize;
  const out = new Float32Array(N * 3);

  for (let idx = 0; idx < N; idx++) {
    let bx, by, bz;
    if (basePositions) {
      bx = basePositions[idx * 3];
      by = basePositions[idx * 3 + 1];
      bz = basePositions[idx * 3 + 2];
    } else {
      bx = -extent + (idx % gridSize) * step;
      by = 0;
      bz = -extent + Math.floor(idx / gridSize) * step;
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

  // FIX(r11): on a flat figure this chart has only one coordinate. phi is
  // acos(dy/r), and a plane or a disc has dy ≡ 0, so phi is exactly pi/2 at
  // every vertex — measured: 1.5708 on all 162 vertices of `circle` and on
  // 25 920 of the 25 921 of `plane`, the exception being the single vertex at
  // the centroid, where the r > 1e-9 guard fires instead. The kernel is then
  // called as f(theta, pi/2), i.e. a two-dimensional field is read along one
  // line and swept around the axis, and every entry that treats its second
  // argument as an independent direction — heatEquation and waveEquation read
  // it as time — draws a figure of revolution of one profile rather than the
  // object it names.
  //
  // The polar radius is the second coordinate a flat figure does have, so it
  // takes phi's place there, scaled onto the same [0, pi] band phi occupies on
  // a solid body. Bodies with any vertical extent are untouched.
  let vertical = 0, radial = 0;
  for (let i = 0; i < N; i++) {
    const dy = Math.abs(basePositions[i * 3 + 1] - cy);
    const dx = basePositions[i * 3] - cx, dz = basePositions[i * 3 + 2] - cz;
    if (dy > vertical) vertical = dy;
    const rr = Math.sqrt(dx * dx + dz * dz);
    if (rr > radial) radial = rr;
  }
  const flat = vertical <= 1e-6 * Math.max(radial, 1e-9);
  const radialToPhi = radial > 1e-9 ? Math.PI / radial : 0;

  // Per-vertex spherical coords + formula evaluation
  for (let i = 0; i < N; i++) {
    const dx = basePositions[i * 3]     - cx;
    const dy = basePositions[i * 3 + 1] - cy;
    const dz = basePositions[i * 3 + 2] - cz;
    const r  = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const theta = Math.atan2(dz, dx);
    const phi   = flat
      ? Math.sqrt(dx * dx + dz * dz) * radialToPhi
      : (r > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, dy / r))) : 0);

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