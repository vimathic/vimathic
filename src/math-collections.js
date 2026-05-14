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
    return Math.PI / (Math.sin(Math.PI * n) * gammaOneMinusN);
  }
  n -= 1;
  const g = 7;
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
    771.32342877765313,-176.61502916214059,12.507343278686905,
    -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (n + i);
  const t2 = n + g + 0.5;
  return Math.sqrt(TAU) * Math.pow(t2, n + 0.5) * Math.exp(-t2) * x;
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

/** Legendre P_n(x), n up to 6 */
function legendreP(n, x) {
  switch(n) {
    case 0: return 1;
    case 1: return x;
    case 2: return 0.5*(3*x*x - 1);
    case 3: return 0.5*(5*x*x*x - 3*x);
    case 4: return 0.125*(35*x*x*x*x - 30*x*x + 3);
    case 5: return 0.125*(63*Math.pow(x,5) - 70*x*x*x + 15*x);
    default: return 0.0625*(231*Math.pow(x,6) - 315*Math.pow(x,4) + 105*x*x - 5);
  }
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
  else if (n===3 && l===0) R = (27-18*(r/a0)+2*(r/a0)**2)*Math.exp(-r/(3*a0))/81;
  else                     R = Math.exp(-r/(n*a0));
  const Y = Math.cos(l*theta + t*0.3); // angular part approximation
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

/**
 * Wrapper for heavy formulas. simulator(t, params, res) returns Float32Array(res*res)
 * of pre-scaled Y values (including *amp). The wrapper caches the grid for the
 * current t and samples with bilinear interp. Runs simulator ONLY once per tick.
 * Preserves exact original visual behavior (including Dimensional Collapse).
 */
function createCachedHeavySampler(simulator, defaultRes = 64) {
  let cachedGrid = null;
  let lastT = -Infinity;
  return function(x, z, t, params = {}) {
    if (Math.abs(t - lastT) > 0.016 || !cachedGrid) {
      cachedGrid = simulator(t, params, defaultRes);
      lastT = t;
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
      name: 'Legendre P₂ Surface',
      formula: 'P₂(x) = ½(3x²−1)',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const n=Math.round(1+comp*4), xn=clamp(x*freq*0.28,-1,1);
        return legendreP(n, xn) * amp * 0.5 * Math.exp(-z*z*0.3);
      }
    },
    gamma_fn: {
      name: 'Gamma Function',
      formula: 'Γ(n) = (n−1)!',
      f(x, z, t, {amp=1, freq=1}) {
        const n=clamp(0.2+(x+3.5)/7*3.6, 0.2, 3.8);
        return clamp(Math.log(Math.abs(gamma(n)))*0.12, -0.8, 0.8) * amp * Math.exp(-z*z*0.5);
      }
    },
    erf: {
      name: 'Error Function erf(x)',
      formula: 'erf(x) = 2/√π ∫₀ˣ e^{−t²} dt',
      f(x, z, t, {amp=1, freq=1}) {
        // Horner approximation
        const y=x*freq, t2=1/(1+0.3275911*Math.abs(y));
        const poly=t2*(0.254829592+t2*(-0.284496736+t2*(1.421413741+t2*(-1.453152027+t2*1.061405429))));
        return Math.sign(y)*(1-poly*Math.exp(-y*y)) * amp * 0.5 * Math.exp(-z*z*0.4);
      }
    },
    zeta: {
      name: 'Riemann Zeta (real axis)',
      formula: 'ζ(s) = Σ 1/nˢ',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const s=clamp(1.05+(x+3.5)/7*4, 1.05, 5.05);
        const terms=4+Math.floor(comp*20);
        let sum=0;
        for (let n=1; n<=terms; n++) sum+=1/Math.pow(n,s);
        return clamp(sum*0.08-0.3, -0.7, 0.7) * amp * Math.exp(-z*z*0.3);
      }
    },
    airy: {
      name: 'Airy Function Ai(x)',
      formula: 'Ai\'\'(x) = x·Ai(x)',
      f(x, z, t, {amp=1, freq=1}) {
        // Numerical integration, simple forward Euler from known values
        const xi=x*freq*1.5;
        const dx=0.05; let ai=0.3550280539, dai=-0.2588194038;
        let xx=-3.0;
        while (xx < xi) { const tmp=dai; dai+=ai*xx*dx; ai+=tmp*dx; xx+=dx; }
        return clamp(ai * amp * 0.7 * Math.exp(-z*z*0.3), -0.8, 0.8);
      }
    },
    hypergeometric: {
      name: '₂F₁ Hypergeometric',
      formula: '₂F₁(a,b;c;z) = Σ (a)ₙ(b)ₙ/(c)ₙ·zⁿ/n!',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const zv=clamp(x*freq*0.25,-0.95,0.95), a=0.5, b=0.5+comp, c=1.5;
        let sum=1, term=1;
        for (let n=1; n<=12; n++) {
          term*=((a+n-1)*(b+n-1))/((c+n-1)*n)*zv;
          sum+=term;
          if (Math.abs(term)<1e-8) break;
        }
        return clamp(sum * 0.15 * amp * Math.exp(-z*z*0.4), -0.8, 0.8);
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
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const xv=clamp(x*freq*0.28,-1,1), n=Math.round(1+comp*6);
        return Math.cos(n*Math.acos(Math.max(-1+1e-9,Math.min(1-1e-9,xv)))) * amp * 0.45 * Math.exp(-z*z*0.3);
      }
    },
    sinc: {
      name: 'Cardinal Sinc',
      formula: 'sinc(x) = sin(πx)/(πx)',
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
      f(x, z, t, {amp=1, freq=1}) {
        const xv=x*freq*1.5;
        // Two-region implementation, both ~10⁻¹⁰ accuracy vs mpmath:
        //   |x| < 3.5: Taylor series F(x) = Σ (-1)^n · 2^n · x^(2n+1) / (2n+1)!!
        //              25 terms suffice in this region.
        //   |x| ≥ 3.5: asymptotic series F(x) ≈ Σ (2n-1)!! / (2x)^(2n+1)
        const ax = Math.abs(xv);
        let F;
        if (ax < 3.5) {
          // Taylor series: term_{n+1}/term_n = -2x²/(2n+3) (no factorial blowup needed)
          let term = xv, sum = xv;
          const x2 = xv * xv;
          for (let n = 1; n < 50; n++) {
            term = -term * 2 * x2 / (2*n + 1);
            sum += term;
            if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
          }
          F = sum;
        } else {
          // Asymptotic: F(x) ~ 1/(2x) · [1 + 1/(2x²) + 3/(2x²)² + 15/(2x²)³ + ...]
          // Coefficients: (2k-1)!! for k=0,1,2,3,4
          const inv2 = 1 / (2 * xv * xv);
          F = (1 / (2 * xv)) * (1 + inv2 * (1 + inv2 * (3 + inv2 * (15 + inv2 * 105))));
        }
        return clamp(F * 0.4 * amp, -0.6, 0.6) * Math.exp(-z*z*0.4);
      }
    },
    clausen: {
      name: 'Clausen Function',
      formula: 'Cl₂(θ) = −∫₀^θ ln|2sin(t/2)| dt',
      f(x, z, t, {amp=1, freq=1}) {
        const th=(x+3.5)/7*TAU, N=12;
        let sum=0;
        for (let k=1; k<=N; k++) sum+=Math.sin(k*th)/(k*k);
        return sum * 0.3 * amp * Math.exp(-z*z*0.4);
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
          // would. Hash combines proposal position with global time.
          if (((Math.sin(v*127.1+t*311.7)*43758.5453)%1+1)%1 < target(proposal)/Math.max(1e-8,target(v))) v=proposal;
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
        const dFz_dx=(Math.cos((x+h)*f2)*Math.sin(z*f2)-Math.cos((x-h)*f2)*Math.sin(z*f2))/(2*h);
        const dFx_dz=(Math.sin(x*f2)*Math.cos((z+h)*f2)-Math.sin(x*f2)*Math.cos((z-h)*f2))/(2*h);
        return (dFz_dx-dFx_dz) * amp * 0.25;
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
        const realExp=r*logMod-z*freq*arg;
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
        const T=0.3+t*0.05, r2=(x*freq)**2+(z*freq)**2;
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
        const N=5+Math.round(comp*6), tau=0.01+t*0.005; let v=0;
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
        // Reconstruct from k-th basis vector
        let v=0;
        for (let n=0; n<N; n++) v+=Math.cos(Math.PI*(n+0.5)*k/N);
        return (v/N) * amp * 0.5 * Math.exp(-z*z*0.3);
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
        const T=x*freq+t*0.5+3.5;
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
        const alpha=0.5+comp*0.5, N=6; let u=0;
        for (let n=1; n<=N; n++) {
          const bn=(n%2===0)?0:4/(n*Math.PI);
          u+=bn*Math.sin(n*Math.PI*(x*freq+0.5))*Math.exp(-alpha*n*n*Math.PI**2*Math.max(0,t*0.01));
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
        const xi=x*freq-c_wave*t*0.08;
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
      f(x, z, t, {amp=1, freq=1}) {
        const a=0.5, Z=z*freq;
        const r=a*Math.cosh(Z/a), rxy=Math.sqrt(x*x)*freq;
        return (r-rxy) * amp * 0.3;
      }
    },
    helicoid: {
      name: 'Helicoid',
      formula: 'x=r cos θ, y=cθ, z=r sin θ',
      f(x, z, t, {amp=1, freq=1, comp=1}) {
        const theta=Math.atan2(z*freq,x*freq), c=0.3+comp*0.3;
        return c*(theta+t*0.3) * amp * 0.25;
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
        for (let i = 0; i < W * H; i++) grid[i] = ((i * 1664525 + 1013904223) >>> 0) % 3;
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
        // Persistent state: re-seed if t went backwards (track restart)
        let u = new Float32Array(N*N), v = new Float32Array(N*N);
        // Initial: broken front to seed spiral
        for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
          u[r*N+c] = (r < N/2) ? 1 : 0;
          v[r*N+c] = (c > N/2 && r > N/3 && r < 2*N/3) ? 0.3 : 0;
        }
        // Run iterations dependent on t (advances the system over time)
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
        const xt=x*freq-v*t*0.3;
        const envelope=Math.exp(-xt*xt/(4*sigma*sigma));
        const psi=envelope*Math.cos(k*x*freq-k*k*t*0.05);
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
        const xi=x*freq-v*t*0.3;
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
      f(x, z, t, {amp=1, freq=1}) {
        const T=0.5+t*0.05, hbar=1;
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
// Формат: f(x, y, z, time, {amp, freq, comp}) → {dx, dy, dz}
// Можно добавлять сюда новые формулы или генерировать через AI API
export const VOLUME_FORMULAS = {
  lorenzField: {
    name: 'Lorenz Vector Field',
    description: 'Classic chaotic attractor as displacement field',
    f(x, y, z, t, { amp = 1, freq = 1, comp = 0.5 }) {
      const sigma = 10, rho = 28, beta = 2.667;
      const dt = 0.012 * amp;
      const dx = sigma * (y - x) * dt * freq;
      const dy = (x * (rho - z) - y) * dt * freq * 0.15;
      const dz = (x * y - beta * z) * dt * freq * 0.1;
      return { dx, dy, dz };
    }
  },
  breathe: {
    name: 'Radial Breathe',
    description: 'Uniform expansion/contraction along surface normals',
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
    description: 'B-field of a magnetic dipole at origin',
    f(x, y, z, t, { amp = 1, freq = 1 }) {
      const r2   = x * x + y * y + z * z + 0.5;
      const r5   = Math.pow(r2, 2.5);
      const m    = amp * 0.8 * Math.sin(t * 0.3); // oscillating dipole moment
      const dot3 = 3 * z * m; // dipole along Z
      return {
        dx: dot3 * x / r5 * freq,
        dy: dot3 * y / r5 * freq,
        dz: (dot3 * z - m * r2) / r5 * freq,
      };
    }
  },
  fluidVortex: {
    name: 'Fluid Vortex',
    description: 'Incompressible vortex flow (curl field)',
    f(x, y, z, t, { amp = 1, freq = 1, comp = 0.5 }) {
      const r2  = x * x + z * z + 0.3;
      const str = amp * 0.5 / r2;
      const osc = Math.sin(t * 0.4 + y * freq);
      return {
        dx: -z * str * osc,
        dy:  Math.cos(y * freq + t) * amp * 0.1,
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