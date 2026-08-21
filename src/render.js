import * as THREE from 'three';
import { OrbitControls }   from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer }  from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }      from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass }  from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { VS, FS } from './shaders.js';
import { DEFAULT_SHAPE, normalizeShape } from './shapes.js';

// ═════════════════════════════════════════════════════════════════════════════
// Solar-system procedural assets — surfaces, clouds and ring profiles
//
// Everything a planet is made of is generated here and cached at module scope,
// so it survives shape switches: a rebuilt solar system must be the SAME solar
// system.
//
// FIX(#27): planets must be reproducible — presets and recordings replay the
// same solar system, but Math.random() made every session and every re-entry
// into 'solar' look different. Every generator below draws from an LCG seeded
// by the asset's own cache key instead, which makes each planet a pure function
// of its name. Local rather than imported from math-collections.js — three
// lines of arithmetic aren't worth the dependency.
//
// FIX(#27, r3): scope — seeded are the texture generators and the per-planet
// material numbers in _buildSolarSystem, nothing else. The starfield
// (`── Stars ──` block), updateGlitch(), and the '⚡ Reactive' entry of
// CP_PRESETS in camera.js (jitters ctx.cam.x/z every frame) stay on
// Math.random() by the owner's choice, so a frame is NOT bit-identical
// between sessions.
// ═════════════════════════════════════════════════════════════════════════════
const _solarTexCache = new Map();

// Operands stay below 2^53, so the multiply-mix is exact in a double.
function _hashSeed(key) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) h = ((h ^ key.charCodeAt(i)) * 1664525 + 1013904223) >>> 0;
  return h;
}

function _lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const _clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const _lerp    = (a, b, t) => a + (b - a) * t;
const _smooth  = (e0, e1, x) => { const t = _clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const _rgb     = hex => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
function _mix(a, b, t, out) {
  out[0] = _lerp(a[0], b[0], t); out[1] = _lerp(a[1], b[1], t); out[2] = _lerp(a[2], b[2], t);
  return out;
}

// ── Periodic value noise ──────────────────────────────────────────────────────
// The grid size IS the frequency, and lookups wrap in both axes, so a texture
// built from it has no seam where longitude 360° meets 0°. Latitude wraps too;
// the poles are a pinch point in any equirectangular map and no planet here is
// ever more than a few dozen pixels across on screen.
function _grid(rnd, n) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return { g, n };
}

function _nz({ g, n }, x, y) {
  const fx = x * n, fy = y * n;
  let x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  x0 = ((x0 % n) + n) % n; y0 = ((y0 % n) + n) % n;
  const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return _lerp(_lerp(g[y0 * n + x0], g[y0 * n + x1], sx),
               _lerp(g[y1 * n + x0], g[y1 * n + x1], sx), sy);
}

// Fractal sum: `octaves` layers from `base` upward, amplitude halving each time.
// Returns a sampler over (x, y) ∈ [0,1)², normalised back into [0,1].
function _fbm(rnd, base, octaves) {
  const gs = [], amps = []; let amp = 1, wsum = 0;
  for (let i = 0; i < octaves; i++) { gs.push(_grid(rnd, base << i)); amps.push(amp); wsum += amp; amp *= 0.5; }
  return (x, y) => {
    let s = 0;
    for (let i = 0; i < gs.length; i++) s += _nz(gs[i], x, y) * amps[i];
    return s / wsum;
  };
}

// ── Equirectangular rasteriser ────────────────────────────────────────────────
// `shade(u, v, out)` writes [r,g,b(,a)] for one texel. u is longitude, v runs
// from 0 at the north pole to 1 at the south — the same way SphereGeometry
// lays its UVs out, so no flip is needed anywhere.
function _paint(w, h, shade) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data, out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      shade((x + 0.5) / w, v, out);
      const i = (y * w + x) * 4;
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return { cv, ctx };
}

function _tex(cv, { wrapX = true, srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  // Colour maps carry sRGB bytes. Leaving them tagged linear — as the first
  // version of this did — makes every planet wash out, because the renderer
  // then converts already-encoded values a second time on the way out.
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrapX) t.wrapS = THREE.RepeatWrapping;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.anisotropy = 4; // clamped by the renderer to what the GPU actually has
  return t;
}

// ── Craters ───────────────────────────────────────────────────────────────────
// Drawn over the base coat with the 2D context rather than per texel: a crater
// is a rim, a floor and a shadow, and three arcs say that in a tenth of the
// code a distance field would need. Longitude is stretched by 1/cos(lat) so a
// crater near a pole stays round once the map is wrapped onto a sphere.
function _craters(ctx, rnd, w, h, n, opt) {
  for (let i = 0; i < n; i++) {
    const cx = rnd() * w, cy = (0.06 + rnd() * 0.88) * h;
    const lat = (0.5 - cy / h) * Math.PI;
    const rr  = (opt.min + Math.pow(rnd(), 2.2) * (opt.max - opt.min)) * h; // small ones dominate
    const sx  = rr / Math.max(0.28, Math.cos(lat));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx / rr, 1);
    // Floor, then a lit rim on one side and a shadowed rim on the other —
    // the light in these textures nominally comes from the upper left.
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${opt.floor},${0.30 + rnd() * 0.2})`; ctx.fill();
    ctx.lineWidth = Math.max(0.8, rr * 0.22);
    ctx.beginPath(); ctx.arc(0, 0, rr * 0.94, Math.PI * 0.85, Math.PI * 1.9);
    ctx.strokeStyle = `rgba(${opt.rim},0.5)`; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, rr * 0.94, Math.PI * 1.9, Math.PI * 2.85);
    ctx.strokeStyle = `rgba(${opt.shade},0.45)`; ctx.stroke();
    // Wrap: a crater that runs off one edge has to come back on the other.
    if (cx - sx < 0 || cx + sx > w) {
      ctx.restore(); ctx.save();
      ctx.translate(cx + (cx - sx < 0 ? w : -w), cy);
      ctx.scale(sx / rr, 1);
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${opt.floor},0.35)`; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, rr * 0.94, Math.PI * 0.85, Math.PI * 1.9);
      ctx.strokeStyle = `rgba(${opt.rim},0.5)`; ctx.lineWidth = Math.max(0.8, rr * 0.22); ctx.stroke();
    }
    ctx.restore();
  }
}

// ── Surface painters, one per class of world ─────────────────────────────────
// Each returns a shade() for _paint(). `p` is the planet's entry in PLANETS.

const _spotDefaults = { u: 0.62, v: 0.61, ru: 0.075, rv: 0.038, strength: 0.9 };

// Gas and ice giants: zonal flow. Latitude is warped by noise BEFORE it is
// banded, which is what makes belt edges ragged instead of drawn with a ruler,
// and the noise is sampled squashed in latitude so its features come out
// stretched along the flow.
function _giantShade(rnd, p) {
  const warp = _fbm(rnd, 3, 4), fine = _fbm(rnd, 8, 5), curl = _fbm(rnd, 5, 3);
  const belt = _rgb(p.belt), zone = _rgb(p.zone), polar = _rgb(p.polar);
  const spot = p.spot ? { ..._spotDefaults, ...p.spot, rgb: _rgb(p.spot.color) } : null;
  return (u, v, out) => {
    const lat = 1 - 2 * v;
    const w   = (warp(u, v * 3.2) - 0.5) * p.warp + (curl(u * 1.3, v * 6) - 0.5) * p.warp * 0.4;
    const t   = lat + w;
    let b = 0;
    for (let i = 0; i < p.bands.length; i++) b += Math.sin(t * Math.PI * p.bands[i][0] + p.bands[i][1]) * p.bands[i][2];
    _mix(belt, zone, _clamp01(b * 0.5 + 0.5), out);
    // Fine turbulence rides on top as brightness, not hue.
    const g = 1 + (fine(u * 0.8, v * 3.0) - 0.5) * p.grain;
    // Poles are colder, greyer and darker on every giant we have pictures of.
    const pz = _smooth(p.polarFrom, 1.0, Math.abs(lat));
    out[0] *= g; out[1] *= g; out[2] *= g;
    if (pz > 0) _mix(out, polar, pz * 0.75, out);
    if (spot) {
      // Elliptical, noise-warped, with a bright collar — the collar is what
      // reads as "storm" rather than "stain" at 30 px across.
      let du = Math.abs(u - spot.u); if (du > 0.5) du = 1 - du;
      const dv = v - spot.v;
      const dd = Math.sqrt((du / spot.ru) ** 2 + (dv / spot.rv) ** 2) + (curl(u * 2, v * 2) - 0.5) * 0.22;
      if (dd < 1.4) {
        _mix(out, spot.rgb, (1 - _smooth(0.55, 1.05, dd)) * spot.strength, out);
        const collar = 1 - Math.abs(dd - 1.12) / 0.22;
        if (collar > 0) _mix(out, zone, collar * 0.35, out);
      }
    }
    out[0] = _clamp01(out[0] / 255) * 255; out[1] = _clamp01(out[1] / 255) * 255; out[2] = _clamp01(out[2] / 255) * 255;
  };
}

// Airless rock: mottled regolith, then craters from _craters(). Mars adds dry
// albedo features and both caps.
function _rockShade(rnd, p) {
  const coarse = _fbm(rnd, 3, 5), fine = _fbm(rnd, 12, 3);
  const base = _rgb(p.base), dark = _rgb(p.dark), light = _rgb(p.light);
  const cap = p.cap ? _rgb(p.cap) : null;
  return (u, v, out) => {
    const lat = 1 - 2 * v;
    const c = coarse(u, v), f = fine(u, v * 1.6);
    _mix(base, c > p.maria ? light : dark, Math.abs(c - p.maria) * 1.8, out);
    const g = 0.86 + f * 0.28;
    out[0] *= g; out[1] *= g; out[2] *= g;
    if (cap) {
      // Caps are ragged and unequal: Mars' southern one is the bigger of the
      // two in the local winter, and neither has a clean edge.
      const north = _smooth(p.capFrom + (c - 0.5) * 0.09, p.capFrom + 0.14,  lat);
      const south = _smooth(p.capFrom + (f - 0.5) * 0.09, p.capFrom + 0.10, -lat * 1.06);
      _mix(out, cap, _clamp01(Math.max(north, south)) * 0.92, out);
    }
  };
}

// Venus: no surface, only cloud deck. Sheared noise gives the streaky
// super-rotating pattern; contrast stays low because in visible light Venus is
// a nearly featureless cream ball.
function _venusShade(rnd, p) {
  const a = _fbm(rnd, 3, 4), b = _fbm(rnd, 7, 4);
  const base = _rgb(p.base), dark = _rgb(p.dark), light = _rgb(p.light);
  return (u, v, out) => {
    const lat = 1 - 2 * v;
    const shear = u + lat * lat * 0.35;                 // faster at the equator
    const t = a(shear, v * 2.2) * 0.65 + b(shear * 1.6, v * 3.4) * 0.35;
    _mix(base, t > 0.5 ? light : dark, Math.abs(t - 0.5) * 1.5, out);
    const pz = _smooth(0.72, 1.0, Math.abs(lat));       // polar collars
    _mix(out, dark, pz * 0.35, out);
  };
}

// Earth: one fBm decides land or sea, latitude and a second fBm decide which
// biome the land gets, and the caps are painted last over everything.
function _earthShade(rnd) {
  const h = _fbm(rnd, 3, 5), arid = _fbm(rnd, 4, 3), detail = _fbm(rnd, 10, 3);
  const deep = _rgb(0x082a5c), shelf = _rgb(0x1a6ba4), sand = _rgb(0xbda471),
        green = _rgb(0x3d6a30), taiga = _rgb(0x2c4f35), ice = _rgb(0xeef4ff), rock = _rgb(0x776851);
  // Sea level, not guessed: the land field was sampled over the sphere with a
  // cos(lat) area weight, and 0.618 is the quantile that leaves 29 % of it dry
  // — Earth's actual figure. At the obvious-looking 0.50 the planet came out
  // two-thirds continent, which is Pangaea, not Earth.
  const SEA = 0.618;
  const t3 = [0, 0, 0];
  return (u, v, out) => {
    const lat = 1 - 2 * v;
    const land = h(u, v) + 0.10 * Math.cos(lat * 2.2) - 0.06;
    _mix(deep, shelf, _smooth(SEA - 0.17, SEA, land), out);
    // The coast is a blend across a band, not an `if`: a hard threshold on a
    // 512-wide map draws the shoreline in visible texel staircases.
    const shore = _smooth(SEA - 0.015, SEA + 0.02, land);
    if (shore > 0) {
      const dry = arid(u, v * 1.4);
      // Deserts sit under the descending limb of the Hadley cells, near ±25°,
      // and nowhere else; everything outside that band greens up.
      const desert = _smooth(0.20, 0.04, Math.abs(Math.abs(lat) - 0.27)) * dry;
      _mix(green, sand, _clamp01(desert * 1.7), t3);
      _mix(t3, taiga, _smooth(0.42, 0.72, Math.abs(lat)), t3);
      _mix(t3, rock, _smooth(SEA + 0.06, SEA + 0.16, land) * 0.55, t3);
      const g = 0.90 + detail(u, v) * 0.20;
      t3[0] *= g; t3[1] *= g; t3[2] *= g;
      _mix(out, t3, shore, out);
    }
    const cap = Math.max(_smooth(0.80, 0.90, lat), _smooth(0.76, 0.86, -lat));
    if (cap > 0) _mix(out, ice, cap * (shore < 0.5 ? 0.82 : 1.0), out);
  };
}

// Cloud sheet for Earth — white where the fBm clears a latitude-dependent bar.
// The bar is low over the ITCZ and the storm tracks, high over the horse
// latitudes, which is why the deserts underneath stay visible.
function _cloudShade(rnd) {
  const c = _fbm(rnd, 4, 5), w = _fbm(rnd, 9, 3);
  // The bar is measured, like the sea level: the same field crosses 0.506 over
  // 60 % of the sphere and 0.541 over 45 %, so the ±0.045 swing below runs the
  // cover from roughly 70 % in the convergence zones down to 30 % over the
  // horse latitudes. The first draft used 0.68 and produced a cloudless Earth.
  return (u, v, out) => {
    const lat = 1 - 2 * v;
    const bar = 0.520 - 0.045 * Math.cos(lat * Math.PI * 3.0) + 0.03 * _smooth(0.72, 1.0, Math.abs(lat));
    const t = c(u + lat * 0.12, v * 1.5) * 0.7 + w(u, v) * 0.3;
    const a = _smooth(bar, bar + 0.10, t);
    out[0] = 255; out[1] = 255; out[2] = 255;
    out[3] = Math.round(_clamp01(a) * 225);
  };
}

// ── Ring profiles ─────────────────────────────────────────────────────────────
// A ring is a 1-D radial function, so its texture is one row wide in latitude
// and 1024 samples across the gap between inner and outer edge. `bands` are
// [r0, r1, alpha, colour] in planet radii, composited in order into [r,g,b,a]
// with a in 0..1. Two rules, both of which cost a rewrite to find:
//
// A later band REPLACES coverage inside its own span instead of adding to it.
// Adding was the first version and it inverted every nested gap: Saturn's Encke
// gap is a low-alpha band lying inside the A ring, and 0.64 + 0.06 is more
// opaque than the ring it is supposed to cut a lane through. The Cassini
// division only ever looked right by luck — it abuts its neighbours rather than
// nesting inside one, so nothing was underneath it to add to.
//
// Each edge ramp is CENTRED on the band edge rather than held inside the span.
// Held inside, two abutting bands both fade to zero at the radius they share:
// the B ring came out split by a fully transparent line ~37 texels wide, with
// three more junctions like it. Centred, a pair crossfades across the junction
// and the total coverage stays continuous.
//
// Exported through SOLAR_MODEL so the ring tests can assert against the profile
// the renderer actually paints, instead of re-deriving a model of it.
function _ringProfile(bands) {
  const rgbs = bands.map(b => _rgb(b[3]));
  return (r, out) => {
    let a = 0; out[0] = out[1] = out[2] = 0;
    for (let i = 0; i < bands.length; i++) {
      const [r0, r1, ba] = bands[i];
      const e = Math.min(0.02, (r1 - r0) * 0.5);        // ramp width, scaled to the band
      if (r < r0 - e || r > r1 + e) continue;
      const cov = _smooth(r0 - e / 2, r0 + e / 2, r) * (1 - _smooth(r1 - e / 2, r1 + e / 2, r));
      if (cov <= 0) continue;
      out[0] = _lerp(out[0], rgbs[i][0], cov);
      out[1] = _lerp(out[1], rgbs[i][1], cov);
      out[2] = _lerp(out[2], rgbs[i][2], cov);
      a = _lerp(a, ba, cov);
    }
    out[3] = a;
    return out;
  };
}

// Ringlet noise on top keeps the big smooth bands from looking like paint.
function _makeRingTexture(key, inner, outer, bands) {
  const cached = _solarTexCache.get(key);
  if (cached) return cached;
  const rnd = _lcg(_hashSeed(key));
  const fine = _fbm(rnd, 24, 4), W = 1024, H = 4;
  const profile = _ringProfile(bands);
  const { cv } = _paint(W, H, (u, _v, out) => {
    profile(inner + u * (outer - inner), out);
    out[3] = Math.round(_clamp01(out[3] * (0.80 + fine(u, 0.5) * 0.42)) * 255);
  });
  const t = _tex(cv, { wrapX: false, mips: false });
  _solarTexCache.set(key, t);
  return t;
}

// Surface + optional cloud sheet for one planet, cached by name.
function _makeSurface(p, lod) {
  const key = `surf_${p.name}_${lod}`;
  const cached = _solarTexCache.get(key);
  if (cached) return cached;
  const rnd = _lcg(_hashSeed(p.name));
  const w = Math.round(p.tex * lod), h = w >> 1;
  const shade = p.paint === 'giant' ? _giantShade(rnd, p)
              : p.paint === 'venus' ? _venusShade(rnd, p)
              : p.paint === 'earth' ? _earthShade(rnd)
              :                       _rockShade(rnd, p);
  const { cv, ctx } = _paint(w, h, shade);
  if (p.craters) _craters(ctx, rnd, w, h, Math.round(p.craters * lod * lod), p.craterInk);
  const t = _tex(cv);
  _solarTexCache.set(key, t);
  return t;
}

function _makeClouds(name, lod) {
  const key = `cloud_${name}_${lod}`;
  const cached = _solarTexCache.get(key);
  if (cached) return cached;
  const rnd = _lcg(_hashSeed(name + '_clouds'));
  const w = Math.round(512 * lod), h = w >> 1;
  const t = _tex(_paint(w, h, _cloudShade(rnd)).cv);
  _solarTexCache.set(key, t);
  return t;
}

// ═════════════════════════════════════════════════════════════════════════════
// The eight planets — real numbers, honestly compressed
//
// Nothing here is invented. `au`, `re`, `ecc`, `incl`, `node`, `peri`, `L0`,
// `tilt` and `day` are the published orbital and physical elements (J2000,
// IAU/NASA fact sheets); the ring band radii further down come from the same
// place, at the widths noted there. `albedo` is fact-sheet too, but it is
// documentation: no code reads it — it is the input to the exposure argument in
// _solarLighting(), which was done once, by hand, and is recorded there.
//
// What IS a compromise is scale, and it has to be: at true scale Neptune sits
// 77× farther out than Mercury while being 1/4 of Jupiter's width, so a frame
// that holds Neptune renders the inner four as four pixels in the corona of
// the sun. Both axes are therefore run through a power law that keeps the
// ORDER and the RATIOS' direction while pulling the extremes in:
//
//   distance = 3.15 · AU^0.42     Mercury 2.11 → Neptune 13.2 (real ratio 78 → 6.2)
//   radius   = 0.30 · R⊕^0.35     Mercury 0.21 → Jupiter 0.70 (real ratio 29 → 3.3)
//
// The 3.15 is set by the one hard clearance in the scene: the sun here is not a
// fixed sphere but the user's math surface, on a 1.2 base RADIUS. Mercury's
// PERIHELION is what has to clear that, not its mean distance — at the first
// value tried, 2.95, it closed to 1.36 and left 0.16 units of daylight. At 3.15
// it closes to 1.4653, i.e. 0.2653 of clearance, and Mercury is the tightest row
// in the table by a wide margin; tests/solar-system.test.js holds the line at
// 1.45.
//
// How much that clearance is really worth depends on the viz mode, and the
// honest answer is "all of it, except in two modes". Both surface paths displace
// in Y only (shaders.js writes `pos.y = …` and never touches x/z), so the sun's
// footprint in the orbital plane is pinned at 1.2 no matter what the formula or
// the music does — it grows tall, not wide. Collapse mode is the exception:
// applyCollapseField() moves every vertex along its own normal, which on a
// sphere is radial, and Volume mode displaces in all three axes. There a loud
// formula can push the surface past 1.4653 and swallow Mercury for as long as
// the peak happens to point at it. That is left alone deliberately — clamping
// the user's surface because of where a planet is would be the stranger
// behaviour of the two — but it is the reason this paragraph does not claim the
// clearance is absolute.
//
// Orbital speed is then NOT taken from the real periods — it is re-derived
// from the compressed distances by Kepler's third law (ω ∝ d^-3/2), so the
// system you see is internally consistent rather than a table of numbers that
// disagree with the geometry around them. Kepler's second law is applied per
// frame on top, which is why Mercury visibly hurries through perihelion.
// ═════════════════════════════════════════════════════════════════════════════
const SOLAR = {
  distK: 3.15, distP: 0.42,   // scene units = distK · AU^distP
  sizeK: 0.30, sizeP: 0.35,   // scene units = sizeK · (R/R⊕)^sizeP
  speed: 0.0042,              // Earth's mean angular step per frame, ≈25 s/orbit at 60 fps
};
const _au2u = au => SOLAR.distK * Math.pow(au, SOLAR.distP);
const _re2u = re => SOLAR.sizeK * Math.pow(re, SOLAR.sizeP);
const _rad  = deg => deg * Math.PI / 180;

// Ring band edges in planet radii: [inner, outer, opacity, colour]. Broad
// components first, gaps and narrow rings last — a later band wins inside its
// own span (see _ringProfile), which is how the Cassini division becomes a hole
// rather than a stripe, and it is why the order within each table matters.
//
// The RADII are published. The WIDTHS of the narrow rings are not: Uranus's are
// 1–12 km across, which is a tenth of a texel in a 1024-sample profile, so each
// is drawn at the ~200 km floor this resolution can actually resolve, centred on
// its real radius. Everything broad — Saturn's C/B/A, the divisions, Neptune's
// Lassell — is at its real width.
const RINGS = {
  Jupiter: [ // halo, main ring, gossamer — real, and so faint it is a hint at best
    [1.40, 1.71, 0.05, 0xa08a78], [1.71, 1.81, 0.20, 0xc0a087], [1.81, 2.55, 0.035, 0x9c8878],
  ],
  Saturn: [
    [1.235, 1.525, 0.34, 0xab9878],   // C ring ("crepe")
    [1.525, 1.760, 0.95, 0xe6d2ad],   // B ring, inner — the bright one
    [1.760, 1.950, 0.86, 0xd8c39a],   // B ring, outer
    [1.950, 2.025, 0.10, 0x8a7b62],   // Cassini division
    [2.025, 2.267, 0.64, 0xd2bd97],   // A ring
    [2.208, 2.222, 0.06, 0x6b6052],   // Encke gap
    [2.263, 2.267, 0.20, 0xc0ad88],   // Keeler gap region
    [2.320, 2.336, 0.30, 0xbfae8c],   // F ring
  ],
  // Uranus has thirteen rings; these are the ten classical ones plus the two
  // broad dust components, all nearly black — the system is charcoal, not ice.
  // Radii are R/25,559 km. ε is the wide bright one and it was missing from the
  // first version of this table: the outermost, most opaque band sat at λ's
  // radius instead, so the ring the comment singled out was not drawn at all.
  Uranus: [
    [1.481, 1.618, 0.022, 0x55595f],  // ζ — broad, faint, and really this far in
    [1.620, 1.980, 0.014, 0x55595f],  // interring dust, the Voyager forward-scatter sheet
    [1.633, 1.641, 0.28, 0x6d7076],   // 6
    [1.648, 1.656, 0.26, 0x6d7076],   // 5
    [1.662, 1.670, 0.28, 0x6d7076],   // 4
    [1.746, 1.754, 0.32, 0x757880],   // α
    [1.783, 1.791, 0.32, 0x757880],   // β
    [1.842, 1.850, 0.22, 0x6d7076],   // η
    [1.859, 1.867, 0.30, 0x757880],   // γ
    [1.886, 1.894, 0.30, 0x6d7076],   // δ
    [1.953, 1.961, 0.30, 0x82858c],   // λ — dust, faint in visible light
    [1.995, 2.008, 0.55, 0x8f9299],   // ε — 51,149 km, the one you can see
  ],
  Neptune: [
    [1.60, 2.60, 0.015, 0x5b7096],
    [1.690, 1.700, 0.10, 0x6b80a8],   // Galle
    [2.150, 2.310, 0.05, 0x5b7096],   // Lassell / Arago — before Le Verrier, which
    [2.145, 2.160, 0.18, 0x7089b4],   // Le Verrier sits inside its inner edge
    [2.530, 2.550, 0.22, 0x7089b4],   // Adams, with its arcs
  ],
};

const PLANETS = [
  { name: 'Mercury', au: 0.3871, re: 0.383, ecc: 0.2056, incl: 7.00, node: 48.3,  peri: 77.5,  L0: 252.3, tilt: 0.03,  day: 58.65, albedo: 0.14,
    paint: 'rock',  tex: 512, base: 0x8c8880, dark: 0x6a665f, light: 0xaaa59c, maria: 0.50, craters: 110,
    craterInk: { min: 0.006, max: 0.055, floor: '54,50,45', rim: '186,180,170', shade: '38,35,31' } },

  { name: 'Venus',   au: 0.7233, re: 0.949, ecc: 0.0068, incl: 3.39, node: 76.7,  peri: 131.6, L0: 182.0, tilt: 177.36, day: -243.0, albedo: 0.69,
    paint: 'venus', tex: 512, base: 0xd8c294, dark: 0xb9a179, light: 0xf4e8c8,
    atmo: { color: 0xf6e3b0, power: 2.4, strength: 0.42, scale: 1.02 } },

  { name: 'Earth',   au: 1.0000, re: 1.000, ecc: 0.0167, incl: 0.00, node: 0.0,   peri: 102.9, L0: 100.5, tilt: 23.44,  day: 0.9973, albedo: 0.31,
    paint: 'earth', tex: 512, clouds: true, moon: true, ocean: true,
    atmo: { color: 0x6fa8ff, power: 2.6, strength: 0.50, scale: 1.02 } },

  { name: 'Mars',    au: 1.5237, re: 0.532, ecc: 0.0934, incl: 1.85, node: 49.6,  peri: 336.1, L0: 355.4, tilt: 25.19,  day: 1.026, albedo: 0.25,
    paint: 'rock',  tex: 512, base: 0xa8552f, dark: 0x74402c, light: 0xc9834f, maria: 0.46, craters: 70,
    cap: 0xf0f4fa, capFrom: 0.80,
    craterInk: { min: 0.005, max: 0.04, floor: '86,44,28', rim: '208,150,110', shade: '60,30,20' },
    atmo: { color: 0xd8926a, power: 3.0, strength: 0.22, scale: 1.02 } },

  { name: 'Jupiter', au: 5.2029, re: 11.209, ecc: 0.0484, incl: 1.30, node: 100.5, peri: 14.8,  L0: 34.4,  tilt: 3.13,  day: 0.4136, albedo: 0.54,
    paint: 'giant', tex: 512, zone: 0xe9dcc2, belt: 0xa87a53, polar: 0x8d8079,
    bands: [[9.5, 0, 0.55], [21, 1.7, 0.26], [4.2, 0.6, 0.44], [38, 0.3, 0.10]],
    warp: 0.055, grain: 0.21, polarFrom: 0.72,
    spot: { color: 0xbb6444, u: 0.62, v: 0.615, ru: 0.085, rv: 0.040, strength: 0.92 },
    rings: 'Jupiter' },

  { name: 'Saturn',  au: 9.5367, re: 9.449, ecc: 0.0539, incl: 2.49, node: 113.7, peri: 92.4,  L0: 50.1,  tilt: 26.73, day: 0.4440, albedo: 0.50,
    paint: 'giant', tex: 512, zone: 0xf2e3bd, belt: 0xc9a870, polar: 0x9d9080,
    bands: [[7.5, 0.4, 0.44], [15, 2.1, 0.20], [3.4, 1.1, 0.36]],
    warp: 0.042, grain: 0.14, polarFrom: 0.74,
    rings: 'Saturn' },

  { name: 'Uranus',  au: 19.189, re: 4.007, ecc: 0.0472, incl: 0.77, node: 74.0,  peri: 170.9, L0: 314.1, tilt: 97.77, day: -0.7183, albedo: 0.49,
    paint: 'giant', tex: 256, zone: 0xc2e8e6, belt: 0xa9d6db, polar: 0xd2eeec,
    bands: [[5, 0.7, 0.30], [11, 1.4, 0.12]],
    warp: 0.028, grain: 0.05, polarFrom: 0.80,
    rings: 'Uranus', atmo: { color: 0x9fe4e8, power: 2.6, strength: 0.34, scale: 1.02 } },

  { name: 'Neptune', au: 30.070, re: 3.883, ecc: 0.0086, incl: 1.77, node: 131.8, peri: 44.9,  L0: 304.3, tilt: 28.32, day: 0.6713, albedo: 0.44,
    paint: 'giant', tex: 256, zone: 0x4a7fd8, belt: 0x2d58ad, polar: 0x6d96dc,
    bands: [[6.5, 0.9, 0.40], [13, 2.2, 0.18], [3, 0.2, 0.30]],
    warp: 0.038, grain: 0.10, polarFrom: 0.78,
    spot: { color: 0x1b3a78, u: 0.30, v: 0.63, ru: 0.07, rv: 0.035, strength: 0.75 },
    rings: 'Neptune', atmo: { color: 0x5b8cff, power: 2.6, strength: 0.36, scale: 1.02 } },
];

// The Moon rides along with Earth. Same painter as Mercury, plus maria.
const MOON = {
  name: 'Moon', paint: 'rock', tex: 256, base: 0x9a958d, dark: 0x555055, light: 0xb8b3aa, maria: 0.44, craters: 60,
  craterInk: { min: 0.008, max: 0.07, floor: '62,58,54', rim: '198,192,182', shade: '42,39,36' },
};

// Semi-latus-rectum form of the ellipse: r(ν) = a(1−e²)/(1+e·cos ν).
const _orbitR = (a, e, nu) => a * (1 - e * e) / (1 + e * Math.cos(nu));

// ── The placement conventions, as functions ───────────────────────────────────
// These are pulled out of _buildSolarSystem for one reason: the builder needs a
// canvas and a GPU and cannot be tested here, while every sign that decides
// WHERE a planet is and WHICH WAY it turns lives in three lines of arithmetic
// that need nothing. Both of the errors this file shipped with at first were in
// these signs, and a test that only read the table could not see either.

// Orbit plane, read right to left: tilt about the line of nodes, then swing that
// line round to the node's published longitude. The + on Ω is the whole point.
// With Ry(−Ω) each planet lands at L0 − 2Ω instead of L0 — _theta0 below already
// measures from the node, so the two uses of Ω subtract twice instead of
// cancelling, and the system quietly stops being J2000 while looking fine.
const _planeEuler = p => new THREE.Euler(_rad(p.incl), _rad(p.node), 0, 'YXZ');

// Where a planet starts, as an angle from its own ascending node.
const _theta0 = p => _rad(p.L0 - p.node);

// Spin: real sidereal days, compressed the same way distance is — and UNSIGNED.
// The direction is already carried by the obliquity: `tilt` is the IAU figure
// measured from the ORBIT normal, so Venus's 177.36° and Uranus's 97.77° put the
// positive pole below the plane, and turning positively about it IS retrograde on
// screen. Multiplying by sign(day) as well — the first version did — cancels
// exactly those two back to prograde, while the table, the comments and the
// tests all go on saying they turn backwards.
const _spinRate = p => 0.012 * Math.pow(1 / Math.abs(p.day), 0.4);

// The Moon's frame hangs off `holder`, whose +X points away from the sun, so
// what this rate advances is the Moon's angle from the sun — a PHASE cycle, not
// a revolution against the stars. The synodic month is the constant that belongs
// in that slot; the sidereal 27.32 was what the first version fed it, which is
// the right number for a frame that is NOT dragged along, and this one is.
//
// Only one of the two months can be right here, and it is worth saying which and
// why. The scene compresses the year by Kepler's third law on compressed radii
// (25 s) and the day by a 0.4 power on real rotation periods; those two laws do
// not agree with each other, so the ratio between month and year cannot come out
// real whichever constant goes in. Phases are what a viewer actually reads off a
// moon, so the phase cycle is the one made honest: 29.5 real Earth days become
// 3.9 apparent ones. Against the stars the Moon then comes round every 1.7
// apparent days, which is not the real 27.3-to-29.5 relationship and cannot be.
const _moonRate = 0.012 * Math.pow(1 / 29.53, 0.4);

// Exported for tests only — nothing in the app imports it. The table above is
// the one factual claim this product makes about anything outside itself, and a
// later edit can break its ordering, push a planet into the sun, or mirror every
// orbit without anything on screen looking obviously wrong.
// tests/solar-system.test.js pins the invariants that the compression is
// supposed to preserve, and drives the four functions above to pin the
// conventions the compression is not allowed to touch.
export const SOLAR_MODEL = {
  SOLAR, PLANETS, MOON, RINGS,
  au2u: _au2u, re2u: _re2u, orbitR: _orbitR,
  planeEuler: _planeEuler, theta0: _theta0, spinRate: _spinRate, moonRate: _moonRate,
  ringProfile: _ringProfile,
};

// ── Solar-system scene pieces ─────────────────────────────────────────────────

// Limb glow: a slightly oversized shell with a Fresnel falloff, added over the
// planet.
//
// The obvious build — BackSide, so only the annulus outside the disc survives
// the depth test — is wrong, and looked it: the Fresnel term peaks at the
// SHELL's silhouette, which draws a hard bright outline around the planet
// instead of a glow. FrontSide puts the same falloff over the disc, brightest
// at the limb and fading inward, which is what an atmosphere actually does to
// a planet seen from outside.
function _atmosphere(radius, seg, atmo) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor:    { value: new THREE.Color(atmo.color) },
      uPower:    { value: atmo.power },
      uStrength: { value: atmo.strength },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uStrength;
      varying vec3 vN; varying vec3 vP;
      void main() {
        float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(-vP))), 0.0, 1.0), uPower);
        gl_FragColor = vec4(uColor, f * uStrength);
      }`,
    transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.FrontSide, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius * atmo.scale, seg[0], seg[1]), mat);
}

// Flat annulus in the planet's equatorial plane. RingGeometry's own UVs are a
// planar projection, useless for a radial band profile, so they are rewritten
// to "u = fraction of the way from the inner edge to the outer".
//
// Lit as a Lambert surface a ring would go black at equinox, when the sun sits
// in its plane — real ring particles keep scattering, so a slice of the map is
// fed back in as emission to hold a floor under the diffuse term.
function _ringMesh(key, r, bands, seg) {
  // Half a ramp of margin at each end: _ringProfile centres its edge ramps ON
  // the band edges, so an annulus that stopped exactly at the outermost edge
  // would cut the outer fade off square — the one hard edge the profile is
  // written to avoid.
  const pad = 0.02;
  const inner = bands.reduce((m, b) => Math.min(m, b[0]), Infinity) - pad;
  const outer = bands.reduce((m, b) => Math.max(m, b[1]), 0) + pad;
  const geo = new THREE.RingGeometry(r * inner, r * outer, seg, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const rr = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, _clamp01((rr - r * inner) / (r * (outer - inner))), 0.5);
  }
  uv.needsUpdate = true;
  const tex = _makeRingTexture(key, inner, outer, bands);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.45,
    roughness: 1, metalness: 0, side: THREE.DoubleSide,
    transparent: true, depthWrite: false,
  }));
  mesh.rotation.x = -Math.PI / 2;   // RingGeometry lies in XY; the equator is XZ
  mesh.renderOrder = 2;
  return mesh;
}

// A faint line on each orbit. Space has no such lines, but eight of these are
// what turn "some spheres" into "a system" the moment the camera pulls back.
function _orbitLine(a, e, periAngle) {
  const N = 192, pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const rr = _orbitR(a, e, th - periAngle);
    pts[i * 3] = Math.cos(th) * rr; pts[i * 3 + 1] = 0; pts[i * 3 + 2] = -Math.sin(th) * rr;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
    color: 0x6f8fc0, transparent: true, opacity: 0.13, depthWrite: false,
  }));
}

// The main asteroid belt, 2.06–3.28 AU. Sampled with the Kirkwood gaps cut
// out — the four resonances with Jupiter that really are swept clear — and
// with a vertical spread from the inclination distribution, halved, because at
// its true thickness the belt reads as fog rather than as a belt.
function _asteroidBelt(count) {
  const rnd = _lcg(_hashSeed('main-belt'));
  const GAPS = [[2.065, 0.022], [2.502, 0.030], [2.825, 0.018], [2.958, 0.020]];
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let au;
    do {
      // Density peaks in the middle of the belt, so two draws instead of one.
      au = 2.06 + (rnd() * 0.55 + rnd() * 0.67) * 1.0;
    } while (GAPS.some(([g, w]) => Math.abs(au - g) < w * (0.4 + rnd() * 0.6)));
    const r  = _au2u(au) * (1 + (rnd() - 0.5) * 0.03);
    const th = rnd() * Math.PI * 2;
    const inc = Math.tan((rnd() * rnd() * 14 + 0.4) * Math.PI / 180) * 0.5;
    pos[i * 3]     = Math.cos(th) * r;
    pos[i * 3 + 1] = (rnd() - 0.5) * 2 * inc * r;
    pos[i * 3 + 2] = -Math.sin(th) * r;
    // C-type (dark, carbonaceous) dominate the outer belt, S-type the inner.
    const stony = rnd() < _smooth(3.1, 2.1, au);
    c.setHex(stony ? 0xb9a184 : 0x6b6560).multiplyScalar(0.65 + rnd() * 0.5);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.035, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
// Post-processing FX shader definitions
// Pass order: RenderPass → Bloom → GodRays → MotionBlur → ChromaticAberration
//             → Afterimage → FilmGrainVignette
// Only RenderPass, Bloom and FilmGrainVignette are built at startup; the four
// in the middle are built on first enable — RenderEngine.FX_PASS_ORDER is the
// authoritative copy of that order and is what decides where they land.
// ═════════════════════════════════════════════════════════════════════════════

// ── 1. Chromatic Aberration ───────────────────────────────────────────────────
// Simulates lens dispersion: R/B channels split outward from the center.
// Strength is amplified quadratically so the effect is subtle at center,
// visible only toward the edges — matching real camera optics.
const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse:  { value: null },
    uStrength: { value: 0.003 }, // sensible default; 0.001–0.008 is the useful range
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float     uStrength;
    varying vec2      vUv;

    void main() {
      vec2  dir  = vUv - 0.5;               // vector from center
      float dist = dot(dir, dir);            // squared distance — cheaper than sqrt
      vec2  off  = dir * uStrength * dist * 8.0; // quadratic falloff from center

      float r = texture2D(tDiffuse, vUv + off).r;
      float g = texture2D(tDiffuse, vUv      ).g;
      float b = texture2D(tDiffuse, vUv - off).b;
      float a = texture2D(tDiffuse, vUv      ).a;

      gl_FragColor = vec4(r, g, b, a);
    }
  `,
};

// ── 2. Film Grain + Vignette ──────────────────────────────────────────────────
// Combined in one pass to save a full-screen texture read.
// Grain uses a hash-based PRNG animated by uTime so it never repeats.
// Vignette darkens the frame edges with a smooth radial curve.
// Each component can be toggled independently via uGrainOn / uVigOn.
const FilmGrainVignetteShader = {
  uniforms: {
    tDiffuse:       { value: null },
    uTime:          { value: 0.0  },
    uGrainIntensity:{ value: 0.06 }, // 0 = invisible, 0.15 = heavy
    uVignetteAmt:   { value: 0.55 }, // 0 = no vignette, 1 = heavy
    uGrainOn:       { value: 1.0  }, // binary toggle (use float for smooth GLSL branching)
    uVigOn:         { value: 1.0  },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float     uTime;
    uniform float     uGrainIntensity;
    uniform float     uVignetteAmt;
    uniform float     uGrainOn;
    uniform float     uVigOn;
    varying vec2      vUv;

    // High-quality hash from Inigo Quilez (no visible pattern at any zoom)
    float hash(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Film grain — animated noise, framerate-independent via uTime
      if (uGrainOn > 0.5) {
        float grain = hash(vUv + fract(uTime * 0.11173)) * 2.0 - 1.0;
        color.rgb += grain * uGrainIntensity;
      }

      // Vignette — smooth darkening toward the frame border
      if (uVigOn > 0.5) {
        vec2  c   = vUv - 0.5;
        float vig = 1.0 - dot(c, c) * uVignetteAmt * 3.8;
        color.rgb *= clamp(vig, 0.0, 1.0);
      }

      gl_FragColor = color;
    }
  `,
};

// ── 3. God Rays (screen-space radial light scattering) ────────────────────────
// Classic Crepuscular Rays via iterative radial sampling (Sousa 2007).
// Each sample step marches from the current UV toward the light source.
// Only pixels above a luminance threshold feed into the ray accumulation,
// so the effect naturally traces bright geometry like bloomed mesh peaks.
// 48 samples is a good quality/cost balance; drop to 24 on lower-end hardware.
const GodRaysShader = {
  uniforms: {
    tDiffuse:  { value: null },
    uLightPos: { value: new THREE.Vector2(0.5, 0.6) }, // screen-space (0–1), updated each frame
    uExposure: { value: 0.12  }, // overall brightness of rays
    uDecay:    { value: 0.965 }, // exponential falloff per step; 0.95–0.98 works well
    uDensity:  { value: 0.88  }, // controls how far back samples reach
    uWeight:   { value: 0.38  }, // per-sample weight multiplier
    uThreshold:{ value: 0.35  }, // luminance threshold; pixels below this don't cast rays
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2      uLightPos;
    uniform float     uExposure;
    uniform float     uDecay;
    uniform float     uDensity;
    uniform float     uWeight;
    uniform float     uThreshold;
    varying vec2      vUv;

    const int SAMPLES = 48;

    void main() {
      vec2  delta = (vUv - uLightPos) / float(SAMPLES) * uDensity;
      vec2  uv    = vUv;
      float decay = 1.0;
      vec4  rays  = vec4(0.0);

      for (int i = 0; i < SAMPLES; i++) {
        uv -= delta;
        vec4  s   = texture2D(tDiffuse, clamp(uv, 0.001, 0.999));
        float lum = dot(s.rgb, vec3(0.299, 0.587, 0.114));
        // Only bright areas (bloomed peaks, bright geometry) cast rays
        s *= step(uThreshold, lum);
        s *= decay * uWeight;
        rays  += s;
        decay *= uDecay;
      }

      gl_FragColor = texture2D(tDiffuse, vUv) + rays * uExposure;
    }
  `,
};

// ── 4. Motion Blur ────────────────────────────────────────────────────────────
// Samples the image along the camera velocity vector in screen space.
// uVelocity is updated each frame by projecting the world origin through
// the current and previous camera matrices (see _updateMotionBlur below).
// 8 samples keep GPU cost low; increase to 12–16 for higher quality.
const MotionBlurShader = {
  uniforms: {
    tDiffuse:  { value: null },
    uVelocity: { value: new THREE.Vector2(0.0, 0.0) }, // screen-space velocity (NDC delta)
    uAmount:   { value: 1.0 }, // intensity multiplier
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2      uVelocity;
    uniform float     uAmount;
    varying vec2      vUv;

    const int SAMPLES = 8;

    void main() {
      vec2 vel   = uVelocity * uAmount;
      vec4 color = texture2D(tDiffuse, vUv);
      float w    = 1.0;

      for (int i = 1; i <= SAMPLES; i++) {
        float t = float(i) / float(SAMPLES + 1);
        color += texture2D(tDiffuse, clamp(vUv + vel * t, 0.001, 0.999));
        w += 1.0;
      }

      gl_FragColor = color / w;
    }
  `,
};

// ─────────────────────────────────────────────────────────────────────────────
// TransitionManager — lightweight tween scheduler
//
// Runs arbitrary 0→1 animations keyed by a slot string so that starting a
// new transition in the same slot automatically cancels the previous one
// (e.g. rapidly clicking between GPU modes doesn't stack up orphaned tweens).
//
// Easing functions follow the standard cubic in-out curve which feels natural
// for both fast (colour, 0.6 s) and slow (shape morph, 0.8 s × 2) transitions.
// ─────────────────────────────────────────────────────────────────────────────

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// The ground grid's resting opacity. Every path that shows the grid sets only
// `visible`, so the material must be back at this value whenever it is hidden —
// see fadeGrid(), which is the only thing allowed to move it.
export const GRID_OPACITY = 0.1;
const GRID_FADE_MS = 400;

// Exported for tests/camera-tween-damping.test.js: the cancel path below is
// half of a fix, and a hand-rolled stand-in would not pin it.
export class TransitionManager {
  constructor() {
    // Map<slot, tween> — at most one active tween per slot
    this._slots = new Map();
  }

  /**
   * Start (or restart) a tween in the given slot.
   * @param {string}   slot       — unique key, e.g. 'mode', 'color', 'morph'
   * @param {number}   duration   — milliseconds
   * @param {function} onUpdate   — called with eased progress [0, 1] every tick
   * @param {function} [onDone]   — called once when progress reaches 1
   * @param {function} [easeFn]   — defaults to cubic in-out
   * @param {function} [onCancel] — called instead of onDone if the tween is
   *                                aborted, so state a tween borrowed for its
   *                                duration (and restores in onDone) is still
   *                                given back when a replacement pre-empts it
   * @returns {{ cancel: function }} — call .cancel() to abort early
   */
  start(slot, duration, onUpdate, onDone, easeFn = easeInOutCubic, onCancel) {
    // Cancel any in-flight tween in this slot
    this._slots.get(slot)?.cancel();

    let cancelled = false;
    const startTime = performance.now();

    const tween = {
      cancel: () => { cancelled = true; this._slots.delete(slot); onCancel?.(); },
      tick:   () => {
        if (cancelled) return false;
        const raw    = Math.min(1, (performance.now() - startTime) / duration);
        const eased  = easeFn(raw);
        onUpdate(eased);
        if (raw >= 1) {
          // FIX: retire this tween BEFORE its onDone runs. A callback that
          // starts a new tween in the same slot — a morph triggered from the
          // flat frame of the morph before it — used to have its replacement
          // deleted the instant it was installed, by this line and by the loop
          // in tick(). The work queued for that second morph then never ran at
          // all, silently.
          this._slots.delete(slot);
          onDone?.();
          return false; // already removed from the active set
        }
        return true; // keep running
      },
    };

    this._slots.set(slot, tween);
    return tween;
  }

  /** Abort the tween in a slot, running its onCancel. */
  cancel(slot) { this._slots.get(slot)?.cancel(); }

  /** Must be called once per animation frame (from RenderEngine.updateUniforms) */
  tick() {
    for (const [slot, tween] of this._slots) {
      // Only retire the tween we just ticked: its onDone may have installed a
      // replacement in the same slot, and deleting that would drop it.
      if (!tween.tick() && this._slots.get(slot) === tween) this._slots.delete(slot);
    }
  }

  /** True if any transition is currently running */
  get isActive() { return this._slots.size > 0; }
}

/**
 * Freeze a geometry's own Y into the static `aBaseY` attribute the vertex
 * program reads.
 *
 * One value per vertex, written once when the geometry is built and never
 * again: nothing in the frame loop looks at it, and the Surface tick only ever
 * writes `position`, so the buffer's version stays 0 for the life of the shape
 * and the GPU upload happens on the shape change alone.
 *
 * A geometry that never passes through here has no such attribute — imported
 * OBJ/GLTF meshes are the real case, since they get the vertex program without
 * ever going through setShape. three then takes neither the buffer path nor the
 * vertexAttrib path for it and the location keeps whatever GENERIC value was
 * last left there by some other program (three 0.169.0, three.module.js:15589
 * — the `materialDefaultAttributeValues !== undefined` arm, whose default case
 * calls gl.vertexAttrib1fv at :15610 — and :15480, the
 * `geometryAttribute !== undefined` branch that is skipped). The GL spec's
 * initial generic value is (0,0,0,1), but "initial" is not "current": three's
 * own Material default table (:12325) sets `color` to [1,1,1], and a location
 * index reused between programs carries that over.
 *
 * So every material that installs a program reading `aBaseY` declares
 * `defaultAttributeValues.aBaseY = [0]`, which makes three call
 * vertexAttrib1fv(loc, [0]) on exactly the geometries that lack the attribute.
 * Zero is the value that makes `pos.y - aBaseY` a no-op, i.e. the pre-round-10
 * behaviour, and it is the same fallback applyHeightField takes when it has no
 * base positions — so the two agree instead of disagreeing, and the agreement
 * is the app's choice rather than the driver's leftovers.
 *
 * There are four such materials, and only two of them live in this file. Named
 * rather than numbered on purpose — the round's own rule for citations, written
 * after four line references in MATHEMATICAL_ACCURACY.md rotted the same day
 * they were added, and after this very table shipped with all four numbers
 * eight to twelve lines stale:
 *   render.js    RenderEngine's constructor, `this.gpuMat`      — VS
 *   render.js    RenderEngine#setVizModeGPU, `ptsMat`           — this.activeVS
 *   shaders.js   ShaderEditor#compileAndApply, `tMat`           — SE_VS_TEMPLATE(body)
 *   shaders.js   ModelLoader#_applyShader, `mat`                — vs || VS  ← the imported case
 * All four are built and inspected by tests/model-abasey-default.test.js, which
 * is what keeps this list from drifting again: it constructs each material
 * through the shipped code path rather than grepping for the declaration.
 * FIX(r10 wave 3): the last two were missed. The docblock said "every material
 * built here", which was true and beside the point: the materials that ever
 * carry a MODEL mesh are built in shaders.js, and neither declared anything —
 * so the one case named above as "the real case" was the one left open.
 * applyShaderSource (:1779) mutates .vertexShader in place rather than
 * rebuilding, so the declaration survives an editor swap on all four.
 * Solar-system materials (_atmosphere at :610 and the ring/planet programs
 * below it) are NOT on this list: their vertex programs never mention aBaseY.
 *
 * Nothing in this VM links GLSL, so the declaration is checked by reading it
 * off the four real material objects (tests/model-abasey-default.test.js);
 * the generic-value behaviour itself is three's code, cited above, not a guess.
 *
 * @param {THREE.BufferGeometry} geo
 */
function attachBaseY(geo) {
  const pos = geo.attributes.position;
  if (!pos) return;
  const n = pos.count;
  const baseY = new Float32Array(n);
  for (let i = 0; i < n; i++) baseY[i] = pos.getY(i);
  geo.setAttribute('aBaseY', new THREE.BufferAttribute(baseY, 1));
  // FIX(r11): the field itself, carried per vertex.
  //
  // The ramp used to recover it by subtraction — pos.y − aBaseY — which is the
  // field exactly while the displacement lives in y and nowhere else. Once the
  // field follows the surface normal that difference is n_y·h, so on a sphere's
  // equator the ramp reads ~0 and on the lower half it reads the field with the
  // sign flipped: measured, the correlation between what the viewer sees and
  // the formula falls from 1.000 to ≈0.000 on every non-flat shape. Colour and
  // geometry have to be two channels, which is what round 10 established; this
  // attribute is that separation made explicit rather than reconstructed.
  geo.setAttribute('aField', new THREE.BufferAttribute(new Float32Array(n), 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// RenderEngine
// ─────────────────────────────────────────────────────────────────────────────
// ── Colours that are meant to be seen as written ─────────────────────────
// FIX(r11): three converts a colour given as sRGB bytes INTO the working
// linear space on construction (ColorManagement.enabled is true by default
// in r152+), and the matching conversion back out lives in the
// <colorspace_fragment> chunk that only three's own materials carry. This
// app draws its frame through custom GLSL, so nothing performs it: a value
// authored as sRGB bytes reaches the screen linearised, i.e. darker and
// more saturated than written. Measured: 0x050515 displays as 0x000002,
// 0x88aaff as 0x3f67ff, 0x3355aa as 0x081767, mid grey 0x808080 as 0x373737.
//
// The 44 shader palettes are unaffected — they never pass through
// THREE.Color and land exactly as authored, which is why the mismatch went
// unnoticed. Adding a global output transform would fix these few colours
// and shift all 44, so the narrow repair is the right one: declare these
// values in the space they are actually written to.
export const uiColor = hex => new THREE.Color().setRGB(
  ((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255,
  THREE.LinearSRGBColorSpace,
);

export class RenderEngine {
  // ── Surface material presets ──────────────────────────────────────────
  // Each preset is the four FS reflection scalars plus an `on` flag.
  // Matte has on:false so it costs nothing (FS skips the whole block).
  //   metalness — 0 dielectric (neutral reflection) … 1 metal (colour-tinted)
  //   roughness — 0 mirror-sharp … 1 fully diffuse (env darkened/blurred)
  //   reflect   — overall reflection strength multiplier
  //   fresnelP  — grazing-angle falloff exponent (higher = tighter rim)
  // FIX(#28): the label map lives in ui/controls.js, not params.js.
  // Keys must match the <option value> in index.html #surface-material-sel
  // and the labels in the _matDescriptions map in ui/controls.js.
  static SURFACE_MATERIALS = {
    matte:  { on:false, metalness:0.0, roughness:1.00, reflect:0.00, fresnelP:1.5 },
    glossy: { on:true,  metalness:0.3, roughness:0.25, reflect:0.50, fresnelP:3.0 },
    mirror: { on:true,  metalness:1.0, roughness:0.02, reflect:1.00, fresnelP:5.0 },
    metal:  { on:true,  metalness:1.0, roughness:0.30, reflect:0.85, fresnelP:4.0 },
    velvet: { on:true,  metalness:0.0, roughness:0.90, reflect:0.10, fresnelP:1.2 },
    glass:  { on:true,  metalness:0.1, roughness:0.05, reflect:0.70, fresnelP:5.0 },
  };

  // ── Particle styles (PTS viz mode) ────────────────────────────────────
  // A point primitive is a screen-aligned square, so POINTS mode had exactly
  // one look. Each style here is the four things that turn that square into
  // something else: how big it is, which mask the fragment shader runs over
  // gl_PointCoord (_POINT_MASK in shaders.js), how it blends, and how much
  // afterglow trails behind it.
  //
  //   size    — gl_PointSize, in framebuffer pixels
  //   mask    — uPtStyle: 0 square · 1 round dot · 2 soft puff
  //   glow    — additive blending (and no depth write, which additive needs
  //             to accumulate instead of z-rejecting its own cloud)
  //   trail   — AfterimagePass damp, 0 = pass stays off
  //
  // Keys must match the <option value> in index.html #particle-style-sel and
  // the descriptions in ui/controls.js — same contract as SURFACE_MATERIALS.
  static PARTICLE_STYLES = {
    squares: { size: 5.0, mask: 0, glow: false, trail: 0    },
    dots:    { size: 2.6, mask: 1, glow: false, trail: 0    },
    // Smoke is the dots' particle, not a bigger one: the sprite is only wide
    // enough to give the falloff somewhere to fade, and the visible core lands
    // near the dots'. What makes it read as smoke is the wake, so the damp sits
    // high — a shorter one looks like a smear rather than a trail of particles.
    smoke:   { size: 3.4, mask: 2, glow: true,  trail: 0.93 },
  };

  // ── Composer pipeline order ───────────────────────────────────────────────
  // Property names of every pass, in the order the composer must execute them.
  // The composer renders passes in array order, so this list IS the picture:
  // God Rays before Afterimage means trails accumulate over ray-lit frames;
  // swap them and the trails smear the rays instead. Lazily built passes are
  // placed by _fxSlot(), which reads this list and the composer's ACTUAL
  // contents — never a literal index, which would keep working right up until
  // a pass is added or removed above it and then quietly shift the pipeline.
  static FX_PASS_ORDER = [
    'renderPass', 'bloomPass', 'godRaysPass', 'motionBlurPass',
    'chromaticPass', 'afterimagePass', 'filmGrainVigPass',
  ];

  constructor(isMobile, CFG) {
    this.isMobile = isMobile;
    this.CFG      = CFG;
    this.currentMaterial = 'matte';
    // Remembered across viz-mode switches the same way the surface material is:
    // PTS is often a place you pass through, and coming back to a look you
    // chose should not cost another trip to the dropdown.
    this.currentParticleStyle = 'squares';

    // ── Three.js core ─────────────────────────────────────────────────────────
    this.scene    = new THREE.Scene();
    this.scene.background = uiColor(0x050515);
    this.scene.fog = new THREE.FogExp2(uiColor(0x050515), 0.007);

    this.camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 800);
    // Bottom-up startup view: looking straight up at the object's underside.
    // 0.001 z-offset prevents OrbitControls gimbal lock at exact axis alignment.
    this.camera.position.set(0, -7, 0.001);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      alpha: true,   // required for transparent background output
    });
    // FIX(#26): via _pixelRatio(), which onResize() re-applies — see its doc.
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(uiColor(0x050515), 1);
    document.body.appendChild(this.renderer.domElement);

    // FIX(#29): no WebGL1 fallback on purpose. r169 dropped the WebGL1 renderer
    // and pins capabilities.isWebGL2 to `true`, so anything guarded by it is
    // dead code — and without WebGL2 the renderer never constructs at all.

    // Performance tier detection — gates higher-density geometry on capable
    // GPUs. Supports WebGPU (navigator.gpu), NVIDIA/RTX, AMD RX 7000-series,
    // and large texture-limit cards. 'ultra' is reserved for future compute/
    // raytracing work; falls back to the WebGL path for everything else.
    this.performanceTier = this._detectPerformanceTier();
    if (this.performanceTier === 'ultra' || this.performanceTier === 'high') {
      CFG.planeSegs = Math.max(CFG.planeSegs, 160);
    }

    // ── Effect composer — base passes ─────────────────────────────────────────
    this.composer = new EffectComposer(this.renderer);
    // Kept as a field so every slot named in FX_PASS_ORDER resolves to a real
    // property — _fxSlot() looks passes up by those names.
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Bloom — on by default, so it is built here.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.15);
    this.composer.addPass(this.bloomPass);

    // ── FX pipeline — the four optional passes are built on first enable ─────
    // They start disabled and nothing in the app switches them on yet, so
    // constructing them here would charge every single session for frames that
    // never render: AfterimagePass allocates two full-screen half-float render
    // targets up front (tens of MB of VRAM at 1080p) and each ShaderPass
    // compiles its program during startup. _fxPass() builds one on the first
    // enabling call and keeps it forever after, so toggling costs nothing on
    // the second and later calls.
    //
    // Declared here purely so the fields exist before any setter runs; the
    // composer slot each one gets is decided by FX_PASS_ORDER, not by the
    // order of these lines.
    this.godRaysPass    = null; // Pass 3: screen-space radial scattering from bright areas
    this.motionBlurPass = null; // Pass 4: directional blur along camera velocity
    this.chromaticPass  = null; // Pass 5: RGB channel split toward frame edges
    this.afterimagePass = null; // Pass 6: afterglow / trailing — must follow god rays + motion blur

    // Pass 7: Film Grain + Vignette — final "lens" look. Enabled by default
    // with a subtle vignette; grain starts off.
    this.filmGrainVigPass = new ShaderPass(FilmGrainVignetteShader);
    this.filmGrainVigPass.uniforms.uGrainOn.value = 0.0; // grain off by default
    this.filmGrainVigPass.uniforms.uVigOn.value   = 1.0; // vignette on by default
    this.filmGrainVigPass.enabled = true;
    this.composer.addPass(this.filmGrainVigPass);

    // ── Mobile budget enforcement ────────────────────────────────────────────
    // Mobile GPUs choke on the 48-sample God Rays loop; motion blur is also
    // refused because the extra texture reads per pixel cost too much. Those
    // two rejections live in setGodRays/setMotionBlur, which bail out before
    // building anything — on mobile the passes are never even constructed, so
    // there is nothing left to switch off here.
    // FIX(#29): the parallel WebGL1 kill-switch is gone — see the WebGL2-only
    // note at the renderer construction above.
    if (isMobile) {
      this.filmGrainVigPass.uniforms.uVignetteAmt.value = 0.4;
    }

    // ── Motion blur — screen-space velocity tracking state ───────────────────
    // The world origin is projected through the camera each frame; the delta
    // between consecutive projections is the screen-space velocity vector.
    this._prevOriginNDC = new THREE.Vector3(0, 0, 0).project(this.camera);
    this._mbClampSpeed  = 0.04; // max velocity magnitude to prevent extreme blur

    // ── OrbitControls ─────────────────────────────────────────────────────────
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.01;
    this.orbit.rotateSpeed = 0.51;   this.orbit.zoomSpeed = 0.2;
    this.orbit.target.set(0, 0, 0);

    // WebGL context loss/restore. Hard-reload after a delay if the auto
    // restore path throws — far better than a blank canvas.
    this.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      setTimeout(() => { try { this.renderer.forceContextRestore(); } catch(_) { location.reload(); } }, 1500);
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { /* re-init handled by Three.js */ });

    // ── Lights ────────────────────────────────────────────────────────────────
    // Kept as fields because the solar system borrows the rig: a studio key
    // light from the upper right is exactly wrong for a scene whose light
    // source is the object in the middle, so _solarLighting() re-points it and
    // puts it back on the way out. Nothing else in the scene is affected —
    // every other material here is a ShaderMaterial, Points or Line, and none
    // of those read scene lights at all.
    this.ambient  = new THREE.AmbientLight(0x1a1035, 0.8); this.scene.add(this.ambient);
    this.keyLight = new THREE.DirectionalLight(0xffcc88, 1.2); this.keyLight.position.set(3,5,2); this.scene.add(this.keyLight);
    this.rimLight = new THREE.DirectionalLight(0x6688ff, 0.5); this.rimLight.position.set(-2,1,-3); this.scene.add(this.rimLight);
    this.fillLight  = new THREE.PointLight(0xff8844, 0.5); this.fillLight.position.set(0,-1.5,0); this.scene.add(this.fillLight);
    this.magicLight = new THREE.PointLight(0xaa66ff, 0.6); this.magicLight.position.set(1.5,2,2); this.scene.add(this.magicLight);
    this.beatLight  = new THREE.PointLight(0xff3a7a, 0, 5); this.beatLight.position.set(0,2,0); this.scene.add(this.beatLight);

    // ── Stars ──────────────────────────────────────────────────────────────────
    const sp = new Float32Array(1200*3);
    for (let i=0; i<sp.length; i+=3) { sp[i]=(Math.random()-.5)*200; sp[i+1]=(Math.random()-.5)*100; sp[i+2]=(Math.random()-.5)*100-40; }
    const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sp,3));
    this.stars = new THREE.Points(sGeo, new THREE.PointsMaterial({ color:0xffffff, size:.05, transparent:true, opacity:.35 }));
    this.scene.add(this.stars);

    this.grid = new THREE.GridHelper(9, 28, uiColor(0x88aaff), uiColor(0x3355aa));
    this.grid.position.y = -1.3; this.grid.material.transparent = true;
    this.grid.material.opacity = GRID_OPACITY;
    this.scene.add(this.grid);

    // ── GPU mesh + uniforms ───────────────────────────────────────────────────
    const gpuGeo = new THREE.PlaneGeometry(CFG.planeSize, CFG.planeSize, CFG.planeSegs, CFG.planeSegs);
    gpuGeo.rotateX(-Math.PI/2);
    this.U = { uTime:{value:0}, uBass:{value:0}, uMid:{value:0}, uTreble:{value:0},
               uAmp:{value:.7}, uBeat:{value:0}, uWI:{value:1}, uMode:{value:0}, uCM:{value:0}, uMathMode:{value:0},
               // Shape morph: 1 = full displacement, 0 = flat (deflate/inflate)
               uMorphProgress:{ value: 1.0 },
               // GPU mode crossfade: blend from uMode → uModeNext over uModeBlend
               uModeNext:     { value: 0   },
               uModeBlend:    { value: 0.0 },
               // Color scheme crossfade: blend from uCM → uCMNext over uCMBlend
               uCMNext:       { value: 0   },
               uCMBlend:      { value: 0.0 },
               uPointSize:    { value: 1.0 },
               // Colour channel — which value the vertex program hands the ramp.
               // 0 = pos.y as written (GPU mode, and the Volume/Collapse CPU
               // modes, which have always coloured by base + displacement).
               // 1 = Surface mode, where the CPU wrote base + field and the
               // ramp wants the field alone, recovered as pos.y - aBaseY.
               // MathVisualizer owns this: it is the only thing that knows
               // which CPU mode is running. See the note at the top of VS.
               uVHField:      { value: 0   },
               // SURF lighting: 1 = on (surface mode), 0 = off (wireframe/points).
               // Starts at 0 because startup mode is wireframe.
               uLighting:     { value: 0   },
               // Surface material — studio-env reflections. uMaterial=0 (Matte)
               // keeps the original look; >0 enables the reflection path in FS.
               // The four scalars are a preset pushed by setSurfaceMaterial().
               uMaterial:     { value: 0   },
               uMetalness:    { value: 0.0 },
               uRoughness:    { value: 1.0 },
               uReflect:      { value: 0.0 },
               uFresnelP:     { value: 1.5 },
               // Particle style — 0 keeps the square point sprite the FS mask
               // is a no-op for. Only ever raised while the POINTS proxy draws:
               // gl_PointCoord is undefined for triangles. See setParticleStyle.
               uPtStyle:      { value: 0   },
             };
    this.gpuMat  = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.U,
      side: THREE.DoubleSide,
      // FIX(#29): no `extensions: { derivatives: true }` — dFdx/dFdy are core
      // built-ins in WebGL2, and r169 honours only clipCullDistance/multiDraw,
      // so the flag was a no-op. Adding it back changes nothing.
    });
    // The fallback for a geometry that has no aBaseY — imported model meshes,
    // which never pass through setShape/attachBaseY. Without the entry the
    // attribute reads the driver's leftover generic value; with it, zero, which
    // makes the ramp's `pos.y - aBaseY` the identity. See attachBaseY.
    this.gpuMat.defaultAttributeValues.aBaseY = [0];
    // Same contract for the field: a geometry without it (an imported model)
    // reads 0, and uVHField never reaches 2 for those, so the ramp keeps its
    // previous source rather than going flat.
    this.gpuMat.defaultAttributeValues.aField = [0];
    this.gpuMesh = new THREE.Mesh(gpuGeo, this.gpuMat);
    this.scene.add(this.gpuMesh);
    this.gpuPtsProxy = null;

    // The meshes of an imported model, while one is on the stage. Empty means
    // the procedural mesh is what draws. ModelLoader hands them over through
    // setExternalModel() — see it for why the engine has to know, rather than
    // the loader flipping gpuMesh.visible behind its back.
    this.modelMeshes = [];

    // Which program source is live. The shader editor may replace it, and the
    // points proxy is rebuilt on every entry into POINTS mode — without a
    // single owner the proxy was always constructed from the built-ins, so an
    // applied custom shader silently vanished in PTS and reappeared in SURF.
    // Write both through applyShaderSource() and there is nowhere to forget.
    this.activeVS = VS;
    this.activeFS = FS;

    // ── Shape state ───────────────────────────────────────────────────────────
    // Startup shape: pyramid-smooth (matches HTML default + RESET ALL target).
    // Initialize as 'plane' first so setShape() has valid prior state, then swap.
    this.currentShape    = 'plane';
    this.solarPlanets    = [];
    this.solarGroup      = null;
    this.solarBelt       = null;
    this.solarBeltRate   = 0;
    this.sunLight        = null;
    // Must exist before the first setShape(): it calls clearSolarSystem()
    // unconditionally, and _solarLighting(false) has to know there is nothing
    // to restore yet.
    this._solarLit       = false;
    this._lightSave      = null;
    this.isShapeChanging = false;
    this.pendingShape    = null;

    // Callback object — main.js wires concrete handlers. No-op defaults
    // so RenderEngine code can fire callbacks unconditionally without
    // worrying whether anyone has subscribed yet. Currently only
    // onShapeChange exists, fired at the end of setShape() to let
    // MathVisualizer capture a fresh pristine snapshot of the new
    // geometry.
    this.cb = {
      onShapeChange: (_shape) => {},
      // Fired when a bloom punch hands the value back, so the panel slider can
      // follow. Not fired when something else claimed bloom meanwhile — see
      // punchBloom.
      onBloomRestored: (_value) => {},
    };

    // ── Transition system ─────────────────────────────────────────────────────
    this.transitions = new TransitionManager();
    // Durations (ms) — shorter on mobile to stay within GPU budget
    this._tDurShape    = isMobile ? 300 : 400;   // half the morph (deflate or inflate)
    this._tDurMode     = isMobile ? 600 : 1200;  // GPU mode crossfade
    this._tDurColor    = isMobile ? 300 : 600;   // color scheme crossfade
    this._tDurCPU      = isMobile ? 400 : 800;   // CPU formula blend
    this._tDurCamera   = isMobile ? 600 : 1000;  // preset-driven camera tween (default)
    this._tDurMaterial = isMobile ? 400 : 700;   // surface-material scalar tween (default)

    // Viz / render mode
    this.vizMode    = 'surface';
    this.renderMode = 'gpu';

    // Glitch
    this.glitchActive = false;
    this.glitchUntil  = 0;

    // Transparent background state
    this.transparentBg = false;

    // CPU mesh slots — populated by MathVisualizer when a CPU formula is active.
    this.cpuMesh = null; this.cpuPts = null; this.cpuGeo = null;
    this.cpuMat  = null; this.cpuPtsMat = null;

    // ── Startup state: match the user-facing "RESET ALL" / HTML default ──
    // Applied at end of constructor, after all infra is ready. Synchronous
    // setShape() does an instant geometry swap so the page opens directly
    // with this view — no visible morph from a brief Plane frame.
    this.setShape('pyramid-smooth');
    this.U.uCM.value = 16;          // Amber color scheme (matches color-sel default)
    this.setVizModeGPU('wireframe'); // wireframe (matches mode-wireframe.active in HTML)
    if (this.grid) this.grid.visible = false;

    // No frame has been drawn, so no GPU mode has been seen. updateUniforms()
    // maintains this; setGPUModeAnimated() reads it to know whether it has
    // anything to fade FROM. The page boots on the CPU formula path
    // (main.js selects one), so `false` is also the honest starting value.
    this._gpuModeWasShown = false;
  }

  // ── Uniforms ─────────────────────────────────────────────────────────────────
  updateUniforms(time, audio) {
    // Advance all in-flight transitions first
    this.transitions.tick();

    this.U.uTime.value   = time;
    this.U.uBass.value   = audio.bass   * audio.bassSens;
    this.U.uMid.value    = audio.mid;
    this.U.uTreble.value = audio.treble * audio.trebleSens;
    this.U.uBeat.value   = audio.beatInt;
    this.U.uAmp.value    = audio.amp;
    this.U.uWI.value     = audio.waveInt;
    // uCM is NOT updated here during a color crossfade — setColorSchemeAnimated()
    // manages uCM/uCMNext/uCMBlend directly.

    // Who owns the surface in the frame about to be drawn. The vertex shader
    // applies a GPU mode only under `if (uMathMode == 0)`, so while the CPU
    // formula path is active no mode is on screen no matter what uMode says —
    // and a crossfade may only fade from something that was actually seen.
    this._gpuModeWasShown = this.U.uMathMode.value === 0;

    // Advance grain noise time
    if (this.filmGrainVigPass.enabled) {
      this.filmGrainVigPass.uniforms.uTime.value = time;
    }
  }

  // ── Animated shape transition — "deflate → swap → inflate" ───────────────────
  /**
   * Two-phase morph for shape changes:
   *   Phase 1 (deflate): animate uMorphProgress 1→0 so the surface collapses flat.
   *   Geometry swap: call the synchronous setShape() at the flat frame.
   *   Phase 2 (inflate): animate uMorphProgress 0→1 as the new shape rises up.
   *
   * If called while a morph is already running, the surface keeps collapsing
   * from the height it is at, over the remaining fraction of the duration —
   * never springing back to full size — and the geometry is swapped at THAT
   * flat frame. Work queued for the flat frame of every superseded morph runs
   * there too, together: see triggerMorphTransition.
   *
   * @param {string} shape — same values accepted by setShape()
   */
  setShapeAnimated(shape) {
    this.triggerMorphTransition(() => this.setShape(shape));
  }
  /**
   * Used by setShapeAnimated (which swaps geometry at flat) and by CPU math
   * formula changes (which need the same visual morph but keep the same
   * geometry — only the height field changes).
   *
   * @param {()=>void} [onFlat] — called at the flat frame (uMorphProgress === 0)
   */
  triggerMorphTransition(onFlat) {
    // FIX: queue the work instead of closing over it. Restarting the slots
    // below cancels the in-flight morph, and a cancelled tween never runs its
    // onDone — which is where onFlat lived, so the scheduled work was dropped.
    // That is not decoration: applyState puts the shape swap, the formula
    // change and the deform switch in there on purpose, to land together at
    // one flat frame. Load a preset, press a shape hotkey inside the 400 ms
    // window, and the preset's geometry work vanished while its UI half had
    // already been written. A superseded morph now hands its queue to the
    // morph replacing it, and it runs at THAT morph's flat frame — still at a
    // flat frame, which is the whole point (the mesh is invisible there).
    if (onFlat) (this._pendingMorphFlat ??= []).push(onFlat);

    // Cancel any in-flight morph
    this.transitions.start('morph-deflate', 0, () => {});
    this.transitions.start('morph-inflate', 0, () => {});

    const dur = this._tDurShape;

    // FIX: keep collapsing from where the surface actually is. This used to
    // hard-write uMorphProgress back to 1.0 and run a fresh full-length
    // deflate, so a shape pressed mid-morph sprang the half-collapsed mesh back
    // to full size and started over — the largest visible discontinuity
    // available, in the one mechanism whose entire job is to avoid a cut — and
    // pushed the flat frame a whole duration further away. The remaining
    // travel is proportional, so the morph still lands at the same speed; the
    // clamp covers a morph triggered from the flat frame itself, where there is
    // nothing left to collapse and the duration would otherwise be zero.
    const from = this.U.uMorphProgress.value;

    this.transitions.start('morph-deflate', Math.max(1, dur * from), p => {
      this.U.uMorphProgress.value = from * (1.0 - p);
    }, () => {
      this.U.uMorphProgress.value = 0.0;
      // Drained before running: a callback that triggers another morph must
      // not see its own entry still queued.
      const pending = this._pendingMorphFlat ?? [];
      this._pendingMorphFlat = [];
      for (const fn of pending) fn();

      this.transitions.start('morph-inflate', dur, p => {
        this.U.uMorphProgress.value = p;
      }, () => {
        this.U.uMorphProgress.value = 1.0;
      });
    });
  }

  // ── Animated GPU shader mode crossfade ───────────────────────────────────────
  /**
   * Crossfades from the current GPU mode to a new one over ~1.2s.
   * uModeNext carries the destination mode; uModeBlend drives the mix().
   * On completion uMode is updated and uModeBlend resets to 0 so the shader
   * evaluates only one branch in steady state (no performance penalty).
   *
   * Interrupt-safe: the shader can only mix two modes, so an interrupted fade
   * has to collapse to one of its ends — it collapses to whichever end is
   * nearer, which is the most continuity two slots can give.
   *
   * @param {number} mode — integer mode index
   */
  setGPUModeAnimated(mode) {
    // FIX: only fade from a mode that was actually on screen. Leaving the CPU
    // formula path there is none — uMathMode gated the shader's displacement
    // off, so uMode still held the boot default or a mode from an earlier GPU
    // session, and the fade spent its first third drawing that at full
    // strength. bootPersist restores a saved shader through the same pair of
    // calls, so every reload opened on mode 0 before arriving where it was
    // asked to be. With nothing to fade from, the chosen mode is simply on.
    if (!this._gpuModeWasShown) {
      this.transitions.cancel('mode');
      this.U.uMode.value      = mode;
      this.U.uModeNext.value  = mode;
      this.U.uModeBlend.value = 0.0;
      return;
    }

    const startBlend = this.U.uModeBlend.value;
    // FIX: mid-fade, collapse to the NEARER end. Taking uModeNext whenever the
    // blend was above zero picked the far end for exactly the common case —
    // interrupting a fade shortly after it began — and cut the frame to a mode
    // the user had barely glimpsed, only to fade away from it. Now the jump is
    // at most half a step, and below the halfway point the "from" end simply
    // stays where the eye already is.
    if (startBlend > 0.5) {
      this.U.uMode.value = this.U.uModeNext.value;
    }
    this.U.uModeBlend.value = 0.0;
    this.U.uModeNext.value  = mode;

    this.transitions.start('mode', this._tDurMode, p => {
      this.U.uModeBlend.value = p;
    }, () => {
      // Commit: current = next, clear blend so only one branch runs
      this.U.uMode.value      = mode;
      this.U.uModeNext.value  = mode;
      this.U.uModeBlend.value = 0.0;
    });
  }

  // ── Animated color scheme crossfade ──────────────────────────────────────────
  /**
   * Crossfades between two color schemes in the fragment shader over ~0.6s.
   * Same interrupt-safe pattern as setGPUModeAnimated().
   *
   * @param {number} cm                — target color scheme index
   * @param {object} [opts]
   * @param {number} [opts.duration]   — milliseconds, default this._tDurColor.
   *                                     AUTO COLOUR asks for a longer fade than
   *                                     a hand-picked palette: an unattended
   *                                     change should read as drift, not as a
   *                                     cut, so the cycler scales it off its own
   *                                     period (see ui/auto-cycle.js).
   */
  setColorSchemeAnimated(cm, opts = {}) {
    const dur = opts.duration ?? this._tDurColor;
    const startBlend = this.U.uCMBlend.value;
    // Same near-end rule as setGPUModeAnimated, and it bites hardest here:
    // AUTO COLOUR scales its fade off the track's period, up to 3 s, so
    // picking a palette by hand half a second into an automatic drift used to
    // cut the screen to the palette the cycler had chosen — full strength, one
    // frame — before fading to the one actually asked for.
    if (startBlend > 0.5) {
      this.U.uCM.value = this.U.uCMNext.value;
    }
    this.U.uCMBlend.value = 0.0;
    this.U.uCMNext.value  = cm;

    this.transitions.start('color', dur, p => {
      this.U.uCMBlend.value = p;
    }, () => {
      this.U.uCM.value      = cm;
      this.U.uCMNext.value  = cm;
      this.U.uCMBlend.value = 0.0;
    });
  }

  // ── Animated camera tween ────────────────────────────────────────────────────
  /**
   * Smoothly transition camera position, orbit target, and FOV.
   * Used by preset and clip-player apply paths to avoid hard cuts between
   * camera states. Snapshots the START values at call time, so the tween is
   * always relative to where the camera actually IS, not where it was
   * supposed to be — handles user dragging the orbit mid-tween cleanly.
   *
   * Automated camera motion has to stand down for the tween's duration, or the
   * physics loop and a programmer script overwrite these position writes on the
   * next frame and the tween is invisible. That is the CALLER's job and its
   * signal is CameraSystem.tweenHold — this method has no reference to the
   * camera system. It used to be described here as "auto-rotate is paused",
   * which was both the wrong owner and the wrong mechanism: the pause was done
   * by writing the user's AUTO-ROTATE setting, so the button spent every clip
   * step describing the opposite of its own flag.
   *
   * Interruption: starting a new camera tween cancels any in-flight one
   * (TransitionManager slot 'camera').
   *
   * OrbitControls interaction:
   *   OrbitControls with enableDamping=true keeps an internal spherical state
   *   (offset, target) that it lerps toward each frame. Writing camera.position
   *   from outside while damping is on causes the next orbit.update() to pull
   *   the camera back to its OLD spherical — producing a "jump → snap-back →
   *   jump" oscillation. So damping is DISABLED for the tween's duration,
   *   position+target+camera.lookAt are written directly each frame, and
   *   damping is re-enabled on completion. The final orbit.update() syncs
   *   the internal spherical to the new state so subsequent damping doesn't
   *   yank us back.
   *
   * @param {object}   target            — { pos:{x,y,z}, target:{x,y,z}, fov:number }
   * @param {object}   [opts]
   * @param {number}   [opts.duration]   — milliseconds, default this._tDurCamera
   * @param {function} [opts.easing]     — easing fn, default cubic in-out
   * @param {function} [opts.onDone]     — fired once tween completes
   */
  tweenCameraTo(target, opts = {}) {
    const dur = opts.duration ?? this._tDurCamera;

    // Retire any in-flight camera tween BEFORE reading enableDamping below.
    // A tween borrows damping for its duration and gives it back in _commit,
    // which only runs when it completes; a second preset clicked mid-flight
    // used to snapshot the borrowed `false` and then "restore" it, so the
    // orbit camera lost its damping for the rest of the session. Cancelling
    // here runs the outgoing tween's onCancel first, so the snapshot below
    // reads the user's real setting.
    this.transitions.cancel('camera');

    // Helper: write final state and re-sync OrbitControls' internal spherical.
    const _commit = (toPos, toTarget, toFov, prevDamping) => {
      this.camera.position.set(toPos.x, toPos.y, toPos.z);
      this.orbit.target.set(toTarget.x, toTarget.y, toTarget.z);
      if (toFov !== this.camera.fov) {
        this.camera.fov = toFov;
        this.camera.updateProjectionMatrix();
      }
      // lookAt + update BEFORE re-enabling damping → spherical is sync'd
      // from the FINAL state, so no snap-back when damping kicks back in.
      this.camera.lookAt(this.orbit.target);
      this.orbit.update();
      this.orbit.enableDamping = prevDamping;
      opts.onDone?.();
    };

    // Instant path: zero/negative duration → snap, used for initial load.
    if (dur <= 0) {
      const prevDamping = this.orbit.enableDamping;
      this.orbit.enableDamping = false;
      _commit(
        target.pos    ?? { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        target.target ?? { x: this.orbit.target.x,    y: this.orbit.target.y,    z: this.orbit.target.z    },
        target.fov    ?? this.camera.fov,
        prevDamping,
      );
      return;
    }

    // Snapshot current values as the tween's "from" — this is what makes the
    // animation feel natural even after user drag mid-tween or rapid clip steps.
    const fromPos    = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
    const fromTarget = { x: this.orbit.target.x,    y: this.orbit.target.y,    z: this.orbit.target.z    };
    const fromFov    = this.camera.fov;

    const toPos    = target.pos    ?? fromPos;
    const toTarget = target.target ?? fromTarget;
    const toFov    = target.fov    ?? fromFov;

    // Disable OrbitControls damping for the tween's duration (see OrbitControls
    // interaction note in the doc block above).
    const prevDamping = this.orbit.enableDamping;
    this.orbit.enableDamping = false;

    this.transitions.start('camera', dur, p => {
      this.camera.position.set(
        fromPos.x + (toPos.x - fromPos.x) * p,
        fromPos.y + (toPos.y - fromPos.y) * p,
        fromPos.z + (toPos.z - fromPos.z) * p,
      );
      this.orbit.target.set(
        fromTarget.x + (toTarget.x - fromTarget.x) * p,
        fromTarget.y + (toTarget.y - fromTarget.y) * p,
        fromTarget.z + (toTarget.z - fromTarget.z) * p,
      );
      const fov = fromFov + (toFov - fromFov) * p;
      if (fov !== this.camera.fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      // lookAt rotates the camera to face the (interpolated) target. Without
      // this, the camera rotation stays fixed at the start orientation while
      // the position drifts — the subject slides off-screen.
      this.camera.lookAt(this.orbit.target);
    }, () => {
      // Snap to exact final values and restore damping.
      _commit(toPos, toTarget, toFov, prevDamping);
    }, opts.easing, () => {
      // Pre-empted by another camera move: hand damping back, but leave the
      // camera where it is — the replacement tween snapshots from here.
      this.orbit.enableDamping = prevDamping;
    });
  }

  updateLights(time, audio) {
    const { bass, mid, beatInt, beatPunch } = audio;
    this.magicLight.position.x = 1.8 + Math.sin(time*.6)*1.3;
    this.magicLight.position.z = 1.5 + Math.cos(time*.7)*1.6;
    this.magicLight.intensity  = .5 + Math.sin(time*1.1)*.18 + Math.min(1,bass)*.5;
    this.fillLight.intensity   = .4 + Math.sin(time*.8)*.1  + Math.min(1,mid)*.3;
    this.beatLight.intensity   = beatInt * 2.0 * beatPunch;
    this.stars.rotation.y      = time * .015;

    // Update God Rays light position to track magicLight in screen space.
    // `?.` covers the pass never having been built — an unbuilt pass is an
    // off pass, so there is no uniform to feed either way.
    if (this.godRaysPass?.enabled) {
      this._updateGodRaysLightPos(this.magicLight.position);
    }

    // Update motion blur velocity from camera movement
    if (this.motionBlurPass?.enabled) {
      this._updateMotionBlur();
    }
  }

  // ── Glitch ───────────────────────────────────────────────────────────────────
  updateGlitch() {
    if (!this.glitchActive) return;
    if (Date.now() < this.glitchUntil) {
      this.renderer.setViewport(Math.random()*6-3, Math.random()*6-3, innerWidth, innerHeight);
    } else {
      this.glitchActive = false;
      this.renderer.setViewport(0, 0, innerWidth, innerHeight);
    }
  }

  triggerGlitch(duration = 200) {
    this.glitchActive = true;
    this.glitchUntil  = Date.now() + duration;
  }

  /**
   * Install a GLSL program pair into every material that draws the GPU mesh,
   * and remember it as the live source so a proxy built later inherits it.
   * Called with no arguments to go back to the built-ins.
   *
   * Single owner on purpose: there are two materials (gpuMat and the POINTS
   * proxy) and three writers (the shader editor's apply, its reset, and the
   * proxy's own construction). Every combination of "one writer missed one
   * material" was a visible bug: a custom shader that disappeared in PTS, and
   * a RESET that reported success while the points kept the old program.
   *
   * FIX: an imported model is a third family of materials, and it was missed
   * the same way — with a model up, gpuMat and the proxy are both hidden, so
   * APPLY and RESET printed "✔ Compiled & applied" while the only thing on
   * screen kept the program it was built with. Only a re-import picked a
   * change up.
   */
  applyShaderSource(vs = VS, fs = FS) {
    this.activeVS = vs;
    this.activeFS = fs;
    for (const m of [this.gpuMat, this.gpuPtsProxy?.material, ...this.modelMeshes.map(x => x.material)]) {
      if (!m) continue;
      m.vertexShader   = vs;
      m.fragmentShader = fs;
      m.needsUpdate    = true;
    }
  }

  /**
   * Hand the stage to an imported model, or take it back.
   *
   * FIX: ModelLoader used to write `r.gpuMesh.visible = false` once and hope.
   * Nothing else in the engine knew a second drawer existed, so every path
   * that touches the procedural mesh — viz-mode buttons, preset apply, RESET
   * ALL — undid it, and the shader editor's single owner never reached the
   * model at all. Making the model an engine-level fact is what closes all of
   * those at once, rather than teaching each caller about model imports.
   *
   * Taking the stage back replays the recorded viz mode, so a mode chosen
   * while the model was up (the panel accepted the click and highlighted the
   * button) is what the user gets when the model leaves.
   *
   * @param {THREE.Mesh[]|null} meshes — the model's meshes, or null to release
   */
  setExternalModel(meshes) {
    this.modelMeshes = meshes ?? [];
    // Re-running the current mode is the whole implementation: it hides or
    // shows the procedural mesh, drops or rebuilds the points proxy, and puts
    // the particle mask where it belongs — all in one place that already knows
    // the rules.
    this.setVizModeGPU(this.vizMode);
  }

  // ── Viz modes ────────────────────────────────────────────────────────────────
  setVizModeGPU(mode) {
    this.vizMode = mode;
    // FIX(#3): the proxy only BORROWS gpuMesh.geometry, which setShape() owns and
    // disposes; disposing it here kills the live mesh's buffer on every mode
    // click. Cloning per proxy was rejected — megabytes copied per button press
    // at 160×160 segments, plus two buffers for MathVisualizer to keep in sync.
    // FIX(#3, r3): the material IS the proxy's own (rebuilt on each entry into
    // points mode), so it must be released here — otherwise every mode cycle
    // strands a compiled ShaderMaterial and its GL program.
    if (this.gpuPtsProxy) {
      this.scene.remove(this.gpuPtsProxy);
      this.gpuPtsProxy.material?.dispose();
      this.gpuPtsProxy = null;
    }
    this.gpuMesh.visible  = this.modelMeshes.length === 0;
    this.gpuMat.wireframe = false;
    this.U.uPointSize.value = 1.0;
    if (mode !== 'points') {
      // Leaving PTS: the particle mask must not run over triangles, and the
      // smoke style's afterglow belongs to the style, not to the session — a
      // trail left armed would smear the surface the user just switched to.
      // The chosen style itself is remembered in currentParticleStyle.
      this.U.uPtStyle.value = 0;
      this.setAfterglow(false);
    }
    // SURF lighting is only meaningful on filled surfaces. Wireframe has no
    // surface area for derivatives to sample; points are single-pixel quads
    // where dFdx/dFdy of vWorldPos is degenerate. Turn lighting off for both.
    this.U.uLighting.value = (mode === 'surface') ? 1 : 0;

    // FIX: while an imported model is on the stage, the mode is recorded and
    // nothing else happens — the procedural mesh stays hidden and no points
    // proxy is built. Before this, every mode button (and every preset apply,
    // and RESET ALL) popped the built-in pyramid back inside the model, with
    // nothing in the UI able to hide it again. PTS was worse than that: the
    // proxy raises uPtStyle, the model's meshes share this very uniform block,
    // and gl_PointCoord is undefined for triangles — the mask then discards
    // the model entirely. setExternalModel(null) replays the mode recorded
    // here, so the choice made meanwhile is not lost.
    if (this.modelMeshes.length) {
      this.U.uPtStyle.value = 0;
      this.setAfterglow(false);
      return;
    }

    if (mode === 'wireframe') {
      this.gpuMat.wireframe = true;
    } else if (mode === 'points') {
      this.gpuMesh.visible = false;
      const ptsMat = new THREE.ShaderMaterial({
        vertexShader: this.activeVS, fragmentShader: this.activeFS, uniforms: this.U,
        side: THREE.DoubleSide,
        // Shares uniforms (including uLighting=0) with gpuMat.
        // FIX(#29): no `extensions: { derivatives: true }` — ignored by r169,
        // same reason as on gpuMat above.
      });
      // Same aBaseY fallback as gpuMat. The proxy shares gpuMesh.geometry,
      // which always carries the attribute, so this is a no-op today — it is
      // here so the two materials that run the same vertex program cannot
      // disagree about what the missing case means.
      ptsMat.defaultAttributeValues.aBaseY = [0];
      ptsMat.defaultAttributeValues.aField = [0];
      // Geometry is deliberately shared with gpuMesh, not cloned — see the
      // dispose note at the top of this method.
      this.gpuPtsProxy = new THREE.Points(this.gpuMesh.geometry, ptsMat);
      this.scene.add(this.gpuPtsProxy);
      // Point size, mask, blending and trail all come from the style rather
      // than from a literal here — the proxy is rebuilt on every entry into
      // PTS, so this is also what restores the style after a mode round-trip.
      this.setParticleStyle(this.currentParticleStyle);
    }
  }

  // ── Particle style (PTS viz mode) ─────────────────────────────────────────
  /**
   * Apply one of RenderEngine.PARTICLE_STYLES to the points proxy.
   *
   * Three things move together and that is why they live in one call: the
   * sprite size (a uniform), the fragment mask (a uniform), and the material's
   * blending — a soft additive puff and a crisp opaque dot want opposite
   * settings, and setting one without the others gives neither look.
   *
   * Outside PTS the style is only remembered. Nothing to apply: the proxy does
   * not exist, and uPtStyle must stay 0 because gl_PointCoord is undefined for
   * the triangles the mesh draws. An imported model is the same situation for
   * the same reason — it draws triangles through this uniform block — so it
   * gets the same treatment.
   *
   * ── About the trail ──────────────────────────────────────────────────────
   * The smoke style borrows the composer's AfterimagePass: every frame blends
   * with a decayed copy of the previous one, so each particle drags a wake of
   * ever-fainter copies of itself. That is a screen-space effect on purpose —
   * it works the same whether the positions come from a GPU shader or from the
   * CPU worker, where a "render the cloud again at t-dt" trick would show
   * nothing at all (CPU positions are baked into the attribute buffer, not
   * computed from uTime). The pass is the style's for as long as the style is
   * live; setVizModeGPU turns it off on the way out of PTS.
   *
   * @param {string} name — key into RenderEngine.PARTICLE_STYLES
   */
  setParticleStyle(name) {
    const s = RenderEngine.PARTICLE_STYLES[name];
    this.currentParticleStyle = s ? name : 'squares';
    const style = s ?? RenderEngine.PARTICLE_STYLES.squares;

    if (this.vizMode !== 'points' || this.modelMeshes.length) return;

    this.U.uPointSize.value = style.size;
    this.U.uPtStyle.value   = style.mask;

    const m = this.gpuPtsProxy?.material;
    if (m) {
      // A masked sprite has partial alpha at its rim; without transparent the
      // rim is drawn opaque and the round dot is square again.
      m.transparent = style.mask > 0;
      m.blending    = style.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.depthWrite  = !style.glow;
      m.needsUpdate = true;
    }

    this.setAfterglow(style.trail > 0, style.trail || 0.87);
  }

  // ── Surface material (studio-env reflections) ─────────────────────────────
  /**
   * Apply a PBR-style material preset. Pushes four scalars into the shared
   * uniforms; the FS reflection path reads them. uMaterial>0 enables the
   * path (Matte=0 keeps the original flat-shaded look at zero cost).
   *
   * Works across all viz modes (surface / volume / collapse / GPU) because
   * the reflection block in FS is independent of uLighting and reconstructs
   * its own normal from screen-space derivatives.
   *
   * @param {string} name — key into RenderEngine.SURFACE_MATERIALS
   */
  setSurfaceMaterial(name) {
    const m = RenderEngine.SURFACE_MATERIALS[name] ?? RenderEngine.SURFACE_MATERIALS.matte;
    // An instant set is the last word: retire any material tween first, or the
    // one still in flight keeps writing the four scalars every frame and the
    // "instant" values survive for a few frames at most. RESET ALL and the
    // WIRE/PTS force-to-Matte both come through here.
    this.transitions.cancel('material');
    this.currentMaterial = name;
    this.U.uMaterial.value  = m.on ? 1 : 0;
    this.U.uMetalness.value = m.metalness;
    this.U.uRoughness.value = m.roughness;
    this.U.uReflect.value   = m.reflect;
    this.U.uFresnelP.value  = m.fresnelP;
  }

  /**
   * Same preset switch, faded instead of cut. Interpolates the four reflection
   * scalars from wherever they are right now to the target preset's, so a
   * Glossy → Mirror change slides through the intermediate finishes rather than
   * snapping. Interrupt-safe by construction: the start values are read from
   * the live uniforms at call time, so a second call mid-fade continues from
   * the frame on screen (the TransitionManager's 'material' slot cancels the
   * first tween).
   *
   * ── Why uMaterial is forced on for the whole fade ──────────────────────────
   * The FS reflection block is gated on `uMaterial > 0`, and Matte's preset
   * carries reflect 0. Every term inside the block is multiplied by uReflect,
   * so running the block with Matte's scalars renders identically to skipping
   * it — which means holding the gate open costs nothing visually and lets
   * matte→metal grow out of the flat look instead of popping on at frame one
   * (and metal→matte fade to flat instead of snapping off at the last frame).
   * The gate is set to the target's real `on` flag when the tween commits, so
   * Matte still ends up costing nothing once it is reached.
   *
   * @param {string} name              — key into RenderEngine.SURFACE_MATERIALS
   * @param {object} [opts]
   * @param {number} [opts.duration]   — milliseconds, default this._tDurMaterial.
   *                                     <= 0 delegates to the instant path.
   */
  setSurfaceMaterialAnimated(name, opts = {}) {
    const dur = opts.duration ?? this._tDurMaterial;
    if (!(dur > 0)) { this.setSurfaceMaterial(name); return; }

    const to = RenderEngine.SURFACE_MATERIALS[name] ?? RenderEngine.SURFACE_MATERIALS.matte;
    const from = {
      metalness: this.U.uMetalness.value,
      roughness: this.U.uRoughness.value,
      reflect:   this.U.uReflect.value,
      fresnelP:  this.U.uFresnelP.value,
    };

    // Name the destination immediately, before the pixels get there: preset
    // capture and the WIRE/PTS material rule both read currentMaterial, and
    // mid-fade they should see where we are going, not where we came from.
    this.currentMaterial   = name;
    this.U.uMaterial.value = 1;

    const lerp = (a, b, p) => a + (b - a) * p;
    this.transitions.start('material', dur, p => {
      this.U.uMetalness.value = lerp(from.metalness, to.metalness, p);
      this.U.uRoughness.value = lerp(from.roughness, to.roughness, p);
      this.U.uReflect.value   = lerp(from.reflect,   to.reflect,   p);
      this.U.uFresnelP.value  = lerp(from.fresnelP,  to.fresnelP,  p);
    }, () => {
      this.U.uMaterial.value  = to.on ? 1 : 0;
      this.U.uMetalness.value = to.metalness;
      this.U.uRoughness.value = to.roughness;
      this.U.uReflect.value   = to.reflect;
      this.U.uFresnelP.value  = to.fresnelP;
    });
  }

  // ── Shape switching ──────────────────────────────────────────────────────────
  /**
   * Instant geometry swap (no animation). Used internally by setShapeAnimated()
   * at the flat frame, and directly by code that doesn't need the morph effect
   * (initial load, solar system).
   */
  setShape(shape) {
    // Resolve first, so every field, callback and rotation rule below sees a
    // value this build can actually draw. A known name comes back unchanged;
    // an unknown one — a retired preset, hand-edited JSON, localStorage left
    // by another build — becomes the boot shape and says so on the console.
    // Until round 10 an unknown name reached _buildShapeGeo's `default:` and
    // came back a PlaneGeometry that the rotate list below never touched,
    // because that list keys off the NAME: a 7x7 plate standing on edge in
    // XY, 161 distinct (x,z) against the 25921 a real 'plane' gives. Silent,
    // on a boot path — bootPersist() restores the persisted state on every
    // page open.
    shape = normalizeShape(shape);
    if (this.isShapeChanging) { this.pendingShape = shape; return; }
    this.isShapeChanging = true;
    this.currentShape    = shape;
    this.clearSolarSystem();

    const newGeo = this._buildShapeGeo(shape);
    // PlaneGeometry and CircleGeometry are authored in the XY plane, so they
    // need this quarter turn to lie flat in XZ — the plane the whole app
    // displaces out of along +Y. CylinderGeometry is authored with its axis
    // already along Y, so 'disc' and 'hex' arrive flat and the same turn
    // stood them on EDGE: area-weighted mean |n.y| 0.978 -> 0.014 for disc
    // and 0.847 -> 0.088 for hex, and the startup camera (which looks
    // straight up the Y axis) saw a 0.08-thick rim instead of the face —
    // silhouette 38.44 -> 0.56. Keep this list to the XY-authored geometries.
    if (['plane','circle'].includes(shape)) {
      newGeo.rotateX(-Math.PI/2);
      // cos(-PI/2) is 6.12e-17, not 0, so the turn leaves the plate's own Y at
      // up to 2.14e-16 instead of flat (25760 of the 25921 vertices are off
      // zero). That was invisible while the height field REPLACED Y; since
      // round 10 it is ADDED to Y, so those vertices keep the residue wherever
      // the field is too small to round it away — measured at the factory
      // sliders, grid 161, t = 0: 174 of 25921 vertices on `pseudosphere` and
      // 168 on `landauLevels` come out with a different float32 Y if this loop
      // is skipped.
      // FIX(r10 wave 3): the condition used to read "wherever the field is
      // exactly zero", which is not what those two counts measure — NEITHER
      // formula has a single exactly-zero value anywhere on the 161x161
      // lattice. The vertices that keep the residue are the ones where the
      // field is small enough that 2.14e-16 is still half a float32 ULP of it,
      // i.e. |field| below roughly 3.6e-9: the differing vertices run
      // 4.1e-15 … 3.6e-9 on pseudosphere and 1.4e-36 … 1.0e-9 on landauLevels.
      // Exact zeros do exist elsewhere in the catalogue, and there the old
      // wording is right: `mandelbrot` has 2939 of them and every one of its
      // 2850 differing vertices sits on one.
      // The amount is fifteen orders below anything a viewer can see; the
      // point is the exactness of the claim, not the size of the number. A
      // plate laid down in XZ has y = 0, and the field is then the only thing
      // that moves it — which is what makes round 10 a provable no-op on the
      // plane.
      const py = newGeo.attributes.position;
      for (let i = 0; i < py.count; i++) py.setY(i, 0);
      py.needsUpdate = true;
    }

    // aBaseY — the shape's own y, frozen. The colour ramp needs it to subtract
    // the body back out in Surface mode (see the note at the top of VS); it is
    // written here, once, from the geometry as built, and never again — no tick
    // touches it, so the attribute uploads on the shape change and on no frame
    // after it. It is also exactly the Y that MathVisualizer's pristine
    // snapshot captures a moment later (the hook below fires before any tick
    // can run), which is what makes `pos.y - aBaseY` the field and nothing else.
    attachBaseY(newGeo);

    const oldGpuGeo = this.gpuMesh.geometry;
    const oldPtsGeo = this.gpuPtsProxy?.geometry ?? null;

    // Swap geometry first, dispose old one in the next rAF. This gives the
    // GPU one frame to finish using the old buffer; the explicit reference
    // guarantees we dispose it even if pendingShape triggers another swap
    // before this callback runs.
    this.gpuMesh.geometry = newGeo;
    if (this.gpuPtsProxy) this.gpuPtsProxy.geometry = newGeo;

    requestAnimationFrame(() => {
      // Guard against double-dispose: a rapid second swap may have already
      // replaced gpuMesh.geometry with something newer.
      if (oldGpuGeo !== this.gpuMesh.geometry) oldGpuGeo.dispose();
      if (oldPtsGeo && oldPtsGeo !== newGeo && oldPtsGeo !== oldGpuGeo) oldPtsGeo.dispose();
      this.isShapeChanging = false;
      if (this.pendingShape) { const n = this.pendingShape; this.pendingShape = null; this.setShape(n); }
    });

    if (shape === 'solar') this._buildSolarSystem();

    // Notify subscribers (mainly MathVisualizer) that the shape changed.
    // Called synchronously after geometry swap so the callback sees the
    // new vertex buffer when it captures a pristine snapshot. Fires
    // unconditionally — covers every entry point including R/D hotkeys,
    // preset apply, clip-player, and direct setShape calls during boot.
    this.cb?.onShapeChange?.(shape);
  }

  _buildShapeGeo(shape) {
    const seg = this.CFG.planeSegs, lo = this.isMobile ? 40 : 80;
    switch (shape) {
      // 'plane' used to be served by `default:` — which is why an unknown
      // name silently became a plane, and an unrotated one at that. It gets
      // its own label so the default branch can stop being a shape.
      case 'plane':            return new THREE.PlaneGeometry(this.CFG.planeSize, this.CFG.planeSize, seg, seg);
      case 'sphere':           return new THREE.SphereGeometry(3.5, seg, seg);
      case 'box':              return new THREE.BoxGeometry(5,5,5, lo,lo,lo);
      case 'cylinder':         return new THREE.CylinderGeometry(2.5,2.5,5, lo,lo);
      // three r169 builds ConeGeometry as CylinderGeometry(0, r, ...), and
      // buildTorso tests the PARAMETER radiusTop, not the radius of the row
      // it is on:
      //     if ( radiusTop    > 0 ) indices.push( a, b, d );
      //     if ( radiusBottom > 0 ) indices.push( b, c, d );
      // With radiusTop === 0 the (a,b,d) half of EVERY torso quad is dropped,
      // in every row and not only the degenerate one at the apex — 6400 of the
      // 80×80 = 12800 torso triangles, exactly half, plus the 80-triangle top
      // cap the same flag gates: 6480 triangles here where the closed build
      // has 12960. That draws 64.51 of an exact 96.08 units of surface (the
      // 80-gon three actually builds, not the smooth cone) and leaves 18960
      // boundary edges on a mesh that ought to be closed. At heightSegments=1
      // the dropped triangle really is degenerate, which is why this survived
      // ordinary use — and the app boots in wireframe, where a missing
      // diagonal reads as a quad mesh rather than as a hole.
      // A 1 mm top radius takes the same code path with radiusTop > 0 and
      // closes the mesh: 0 boundary edges, area exact to 0.02 %. The tip
      // becomes a cap 0.002 across on a body 6.4 across — 3e-6 % of the
      // surface, sub-pixel at any framing this app uses.
      case 'cone':             return new THREE.CylinderGeometry(0.001,3.2,5.5, lo,lo);
      case 'disc':             return new THREE.CylinderGeometry(3.5,3.5,.08, lo,lo);
      case 'ring':             return new THREE.TorusGeometry(3.0,.35, 24, seg);
      case 'circle':           return new THREE.CircleGeometry(3.5, seg);
      case 'torus':            return new THREE.TorusGeometry(2.8,1.1, 80, seg);
      case 'torusknot':        return new THREE.TorusKnotGeometry(2.2,.65, seg*2, 16, 2, 3);
      case 'hex':              return new THREE.CylinderGeometry(3.2,3.2,.5, 6, lo);
      // Cones under other names — the identical three r169 defect. Note
      // 'pyramid-smooth' is the boot shape, so this half-drawn shell is what
      // a first-time viewer has been looking at.
      case 'pyramid':          return new THREE.CylinderGeometry(0.001,3.2,5, 4, lo);
      case 'pyramid-smooth':   return new THREE.CylinderGeometry(0.001,3.2,5, lo, lo);
      // Polyhedra — detail must be 0 for the shape to actually look like
      // the named polyhedron. The second arg to Tetrahedron/Octahedron/
      // Icosahedron/DodecahedronGeometry is a subdivision count; each
      // level splits every triangle into 4 and PROJECTS vertices onto a
      // sphere of the given radius. So detail=8..16 produces tens of
      // thousands of triangles arranged into a smooth sphere, no longer
      // visually distinguishable from SphereGeometry. The original
      // intent was probably "more vertices = smoother CPU-formula
      // displacement", but it destroyed the shape identity — a
      // "tetrahedron" with 65k faces is just a sphere. Math-formula
      // displacement on these low-poly geometries renders with visible
      // faceting along edges, which is acceptable as an artistic look.
      // Users who want smooth math-formula surfaces have Sphere directly.
      case 'tetrahedron':      return new THREE.TetrahedronGeometry(3.5, 0);
      case 'octahedron':       return new THREE.OctahedronGeometry(3.5, 0);
      case 'icosahedron':      return new THREE.IcosahedronGeometry(3.5, 0);
      // 'icosahedron-smooth' keeps detail=1 — that's the deliberately
      // subdivided variant (20 faces → 80), distinct from the sharp
      // 20-face icosahedron above. Name advertises the subdivision.
      case 'icosahedron-smooth': return new THREE.IcosahedronGeometry(3.5, 1);
      case 'dodecahedron':     return new THREE.DodecahedronGeometry(3.5, 0);
      case 'star':             return this._buildStarGeo();
      case 'solar':            return new THREE.SphereGeometry(1.2, 64, 64);
      // Not a name this build knows. setShape() resolves every value through
      // normalizeShape() before it reaches here, so this is the second line
      // of defence: for direct callers, and for a `case` deleted without its
      // whitelist entry. It must NOT be a PlaneGeometry — the rotate list
      // above keys off the NAME, so a plane built under an unknown name is
      // never laid flat. The recursion terminates because DEFAULT_SHAPE has
      // its own `case`, which tests/shape-fallback-and-hf-once.test.js pins
      // ('the shape whitelist is the only list of shape values' — it parses
      // the case labels out of this very method and asserts DEFAULT_SHAPE is
      // among them); without that pin a mis-set DEFAULT_SHAPE would turn this
      // into a stack overflow.
      default:                 return this._buildShapeGeo(DEFAULT_SHAPE);
    }
  }

  _buildStarGeo() {
    const spikes=6, outerR=3.5, innerR=1.6, depth=.9;
    const pts=[]; const angleStep=Math.PI/spikes;
    for (let i=0; i<spikes*2; i++) { const a=i*angleStep-Math.PI/2, r=i%2===0?outerR:innerR; pts.push([Math.cos(a)*r, Math.sin(a)*r]); }
    const n=pts.length, hD=depth/2, verts=[], indices=[];
    pts.forEach(p => verts.push(p[0],p[1], hD));
    pts.forEach(p => verts.push(p[0],p[1],-hD));
    verts.push(0,0,hD); verts.push(0,0,-hD);
    const cf=n*2, cb=n*2+1;
    for (let i=0; i<n; i++) { const nx=(i+1)%n; indices.push(cf,i,nx,cb,n+nx,n+i,i,n+i,nx,nx,n+i,n+nx); }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
    geo.setIndex(indices); geo.computeVertexNormals(); return geo;
  }

  // ── Solar system ─────────────────────────────────────────────────────────────
  /**
   * Builds all eight planets, their rings, moons and the main asteroid belt
   * from the PLANETS table, and re-aims the light rig at the middle of the
   * scene. Everything lands in one group so teardown is one removal and one
   * traversal.
   *
   * Node chain per planet, and every link earns its place:
   *
   *   plane   orbital plane — node longitude, then inclination (fixed)
   *    └ pivot    the orbit itself — this is what advances each frame
   *       └ holder    sits at r(ν), which changes: the orbits are ellipses
   *          ├ tilt      counter-rotates the orbit away, then applies obliquity,
   *          │  │        so the axis stays pointing at one place in the sky
   *          │  ├ mesh      the planet, spinning on that tilted axis
   *          │  ├ clouds    Earth only, turning slightly faster than the ground
   *          │  ├ atmo      limb glow
   *          │  └ ring      equatorial, therefore under `tilt` and not under `mesh`
   *          └ moonPivot  orbits the planet, not the tilted planet
   */
  _buildSolarSystem() {
    const lod  = this.isMobile ? 0.5 : 1;
    const segA = this.isMobile ? [32, 20] : [56, 36];   // planets
    const segB = this.isMobile ? [16, 12] : [28, 18];   // moons, atmospheres
    const ringSeg = this.isMobile ? 96 : 192;

    const group = this.solarGroup = new THREE.Group();
    group.name = 'solarSystem';
    this.scene.add(group);

    const dEarth = _au2u(1);
    for (const p of PLANETS) {
      const a = _au2u(p.au), r = _re2u(p.re);
      const peri = _rad(p.peri - p.node);

      const plane = new THREE.Object3D();
      plane.rotation.copy(_planeEuler(p));
      group.add(plane);
      plane.add(_orbitLine(a, p.ecc, peri));

      const pivot = new THREE.Object3D(); plane.add(pivot);
      const holder = new THREE.Object3D(); pivot.add(holder);
      const tilt = new THREE.Object3D();
      tilt.rotation.order = 'YXZ';
      tilt.rotation.z = _rad(p.tilt);
      holder.add(tilt);

      // FIX(#27): the material's own numbers are seeded from the planet's name,
      // the same key its texture is cached under, so a rebuilt planet keeps its
      // finish. The material stays per-instance — clearSolarSystem() disposes
      // it; only the numbers are pinned.
      const prnd = _lcg(_hashSeed(p.name + '_mat'));
      const tex  = _makeSurface(p, lod);
      const mat  = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: (p.paint === 'giant' ? 0.92 : 0.96) - prnd() * 0.06,
        metalness: 0.0,
      });
      // A rocky world's own albedo map doubles as its relief: craters get real
      // depth for the price of a uniform, since the texture is already bound.
      if (p.paint === 'rock') { mat.bumpMap = tex; mat.bumpScale = 0.45 * lod; }
      // Earth's green channel is high over land and low over ocean, which is
      // exactly the roughness split water and rock want — so the sea catches a
      // highlight and the continents do not.
      // Earth had its albedo map wired in as a roughness map too — the green
      // channel does split land from sea the right way round, but a point-source
      // sun through it puts a blown white highlight in the middle of a continent.
      // A flat, slightly damp finish reads better than a specular that is right
      // in principle and wrong on screen.
      if (p.ocean) mat.roughness = 0.82;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, segA[0], segA[1]), mat);
      tilt.add(mesh);

      let clouds = null;
      if (p.clouds) {
        clouds = new THREE.Mesh(new THREE.SphereGeometry(r * 1.015, segA[0], segA[1]),
          new THREE.MeshStandardMaterial({ map: _makeClouds(p.name, lod), transparent: true, roughness: 1, metalness: 0, depthWrite: false }));
        tilt.add(clouds);
      }
      if (p.atmo) tilt.add(_atmosphere(r, segB, p.atmo));
      if (p.rings) tilt.add(_ringMesh(`ring_${p.name}`, r, RINGS[p.rings], ringSeg));

      let moonPivot = null;
      if (p.moon) {
        moonPivot = new THREE.Object3D();
        // The Moon's orbit is inclined ~5° to the ecliptic, not to Earth's
        // equator — so it hangs off `holder`, above the obliquity node.
        moonPivot.rotation.x = _rad(5.14);
        holder.add(moonPivot);
        const mr = r * 0.273;
        const mm = new THREE.Mesh(new THREE.SphereGeometry(mr, segB[0], segB[1]),
          new THREE.MeshStandardMaterial({ map: _makeSurface(MOON, lod), roughness: 0.96, metalness: 0 }));
        // 60 Earth radii is the true distance and is unusable here — it would
        // put the Moon a third of the way to Venus. Pulled in to 3.4 radii,
        // the one number in this file that is chosen by eye.
        mm.position.x = r * 3.4;
        moonPivot.add(mm);
      }

      this.solarPlanets.push({
        pivot, holder, tilt, mesh, clouds, moon: moonPivot,
        a, ecc: p.ecc, peri,
        theta: _theta0(p),
        // Kepler III on the compressed radii, and the √(1−e²) that makes the
        // per-frame 1/r² sweep average out to exactly this rate.
        n: SOLAR.speed * Math.pow(dEarth / a, 1.5) * Math.sqrt(1 - p.ecc * p.ecc),
        spin: _spinRate(p),
        moonRate: _moonRate,
      });
    }

    this.solarBelt = _asteroidBelt(this.isMobile ? 700 : 1600);
    this.solarBeltRate = SOLAR.speed * Math.pow(dEarth / _au2u(2.7), 1.5);
    group.add(this.solarBelt);

    this._solarLighting(true);
  }

  /**
   * Swaps the studio rig for a star at the origin, and back. Not for a star
   * ALONE: ambient goes up to 2.2 and a cold rim stays at 0.35, because a single
   * point source leaves night sides at pure black, where a planet stops reading
   * as a sphere and becomes a lit crescent on nothing.
   *
   * Two numbers here are set from arithmetic, not taste.
   *
   * Decay is 0.75, not the physical 2. At inverse-square, an exposure that
   * suits Earth leaves Neptune at 1.4 % of it — true, and unwatchable. At
   * d^-0.75 the sun still visibly falls off (Mercury lands 3.9× Neptune) with
   * the outer half of the system still lit. It is the same order of compression
   * already applied to distance and radius, applied to light.
   *
   * Intensity is then the largest value that clips nothing. Peak diffuse for a
   * surface facing the sun is (I / d^0.75)·albedo/π — three's punctual lights
   * carry no 4π, and Lambert divides by π — so the binding case is Earth's cloud
   * tops, whose near-white albedo hits 1.0 first: 6.4 puts them at 0.86, with
   * Neptune's brightest channel near 0.2. Ambient and the rim add on top of
   * that, which takes Earth's blue channel to ~1.0 — at the edge, not over it,
   * and the reason 6.4 is not 7. The first draft used 22, which blew Mars,
   * Saturn and Venus to flat white; the planets looked untextured, and the
   * textures were fine.
   */
  _solarLighting(on) {
    if (on === this._solarLit) return;
    this._solarLit = on;
    if (on) {
      this._lightSave = { amb: this.ambient.intensity, key: this.keyLight.intensity, rim: this.rimLight.intensity };
      this.ambient.intensity  = 2.2;
      this.keyLight.intensity = 0;      // the sun is the key light now
      this.rimLight.intensity = 0.35;   // cold fill, so night sides read as round
      // updateLights() writes the intensity of these THREE every frame, so they
      // have to be switched off by visibility or they come straight back. Two of
      // them are studio fills; the third is beatLight, a magenta point 2 units
      // above the sun with a 5-unit cutoff, which reached Mercury through Mars
      // and left the inner four throbbing pink on every onset while the outer
      // four did not. The bass still drives this scene — it drives the orbits.
      this.fillLight.visible  = false;
      this.magicLight.visible = false;
      this.beatLight.visible  = false;
      this.sunLight = new THREE.PointLight(0xfff1dd, 6.4, 0, 0.75);
      this.scene.add(this.sunLight);
    } else {
      this.ambient.intensity  = this._lightSave.amb;
      this.keyLight.intensity = this._lightSave.key;
      this.rimLight.intensity = this._lightSave.rim;
      this.fillLight.visible  = true;
      this.magicLight.visible = true;
      this.beatLight.visible  = true;
      if (this.sunLight) { this.scene.remove(this.sunLight); this.sunLight.dispose(); this.sunLight = null; }
    }
  }

  clearSolarSystem() {
    if (this.solarGroup) {
      this.solarGroup.traverse(o => {
        // Textures are deliberately NOT disposed: they live in the module-level
        // cache so the next entry into 'solar' rebuilds the same worlds without
        // repainting them. Material.dispose() frees the program, not the maps.
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.scene.remove(this.solarGroup);
      this.solarGroup = null;
    }
    this.solarBelt = null;
    this.solarPlanets = [];
    this._solarLighting(false);
  }

  updateSolarSystem(bass) {
    if (this.currentShape !== 'solar' || !this.solarGroup) return;
    const k = 1 + bass * 1.5;
    for (const p of this.solarPlanets) {
      const r = _orbitR(p.a, p.ecc, p.theta - p.peri);
      // Kepler's second law: equal areas in equal times, so the angular rate
      // goes as 1/r². Mercury gains half again its mean rate at perihelion.
      p.theta += p.n * (p.a / r) * (p.a / r) * k;
      p.pivot.rotation.y  = p.theta;
      p.holder.position.x = r;
      p.tilt.rotation.y   = -p.theta;   // hold the axis still in world space
      p.mesh.rotation.y  += p.spin * k;
      if (p.clouds) p.clouds.rotation.y += p.spin * 1.09 * k;
      if (p.moon)   p.moon.rotation.y   += p.moonRate * k;
    }
    if (this.solarBelt) this.solarBelt.rotation.y += this.solarBeltRate * k;
  }

  // ── Misc ──────────────────────────────────────────────────────────────────────
  disposeCPUResources() {
    if (this.cpuMesh)     { this.scene.remove(this.cpuMesh); this.cpuMesh.geometry?.dispose(); this.cpuMesh.material?.dispose(); this.cpuMesh = null; }
    if (this.cpuPts)      { this.scene.remove(this.cpuPts);  this.cpuPts.geometry?.dispose();  this.cpuPts.material?.dispose();  this.cpuPts  = null; }
    // FIX(#3): same shared-buffer trap as in setVizModeGPU() — the proxy's
    // geometry belongs to gpuMesh, so only its own material is disposed here.
    if (this.gpuPtsProxy) { this.scene.remove(this.gpuPtsProxy); this.gpuPtsProxy.material?.dispose(); this.gpuPtsProxy = null; }
    this.cpuGeo = null; this.cpuMat = null; this.cpuPtsMat = null;
  }

  updatePerfMetrics() {
    const el = document.getElementById('gpu-mem');
    if (!el) return;
    el.style.display = 'block';
    const info = this.renderer.info;
    el.textContent = `▲ ${info.render.triangles}△ | ${info.memory.geometries} geo`;
  }

  /**
   * Device pixel ratio budget — the single place the formula lives.
   * Capped because the backing store cost grows with the square of the ratio:
   * 1.0 on phones (fill-rate bound), 1.5 on desktop (diminishing returns above).
   * FIX(#26): called at construction AND from onResize(), so a DPR change
   * (other monitor, page zoom) re-sizes the backing store.
   */
  _pixelRatio() {
    return Math.min(devicePixelRatio, this.isMobile ? 1.0 : 1.5);
  }

  /**
   * Performance tier for gating effect quality.
   *   'low'    = mobile
   *   'medium' = integrated GPU
   *   'high'   = discrete GPU (NVIDIA, RTX, GeForce, Radeon RX 7+, or maxTextureSize ≥ 16384)
   *   'ultra'  = WebGPU available — reserved for future compute / raytracing paths
   */
  _detectPerformanceTier() {
    if (this.isMobile) return 'low';

    if ('gpu' in navigator && navigator.gpu) {
      return 'ultra';
    }

    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    let rendererStr = '';
    if (debugInfo) {
      rendererStr = (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ||
                     gl.getParameter(gl.RENDERER) || '').toUpperCase();
    } else {
      rendererStr = (gl.getParameter(gl.RENDERER) || '').toUpperCase();
    }

    const isHighEnd = rendererStr.includes('NVIDIA') || rendererStr.includes('RTX') ||
                      rendererStr.includes('GEFORCE') || rendererStr.includes('RADEON RX 7') ||
                      this.renderer.capabilities.maxTextureSize >= 16384;

    return isHighEnd ? 'high' : 'medium';
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    // FIX(#26): recompute the ratio instead of echoing the one frozen in the
    // constructor. setPixelRatio() goes FIRST — setSize() multiplies by the
    // current ratio when it sizes the drawing buffer.
    const dpr = this._pixelRatio();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(innerWidth, innerHeight);
    // Resizes only the passes the composer actually holds, so the lazily built
    // FX passes need no mention here — one created later is sized on insert
    // from these same dimensions.
    this.composer.setSize(innerWidth, innerHeight);
    this.composer.setPixelRatio(dpr);
  }

  /**
   * Fade the ground grid in or out. The only writer of grid.material.opacity
   * outside construction.
   *
   * FIX: the fade used to live in main.js's G handler as a bare rAF loop that
   * approached its target geometrically and stopped at ~0.1% opacity, then set
   * visible = false. Nothing ever put the opacity back, and every other way of
   * showing the grid — the ⊞ GRID button, a preset, leaving transparent
   * background — writes only `visible`. So after one G the grid could be
   * switched "on" and stay invisible, with the button lit and reporting ON.
   * Ending both directions at GRID_OPACITY keeps those paths honest.
   *
   * Fading IN also had to raise `visible` up front: with it set only at the
   * end, the whole fade ran on a hidden object and the grid popped in at full
   * strength instead of appearing gradually.
   */
  fadeGrid(on) {
    const g = this.grid;
    if (!g) return;
    // Fading in starts from nothing and raises `visible` up front, so the fade
    // is actually seen. Fading out starts wherever the material is now, which
    // may be mid-fade if G was pressed twice quickly.
    if (on) { g.material.opacity = 0; g.visible = true; }
    const from   = g.material.opacity;
    const target = on ? GRID_OPACITY : 0;
    // FIX(r4): what this fade left `visible` at. onDone lands GRID_FADE_MS
    // later, and ⊞ GRID, a preset or setTransparentBackground may have written
    // grid.visible in between — writing `on` regardless put the grid back on
    // over a button reading OFF, or back into a transparent-background capture.
    // Same "only if nothing claimed it meanwhile" test the restore branch of
    // setTransparentBackground already makes; this is the one writer that lands
    // long after the fact.
    const claimed = g.visible;
    this.transitions.start('grid-fade', GRID_FADE_MS, p => {
      g.material.opacity = from + (target - from) * p;
    }, () => {
      if (g.visible === claimed) g.visible = on;
      // Hidden grids rest at full opacity, never at the 0 the fade ended on.
      // That is what keeps every other path honest: the ⊞ GRID button, a
      // preset and setTransparentBackground all write only `visible`, and a
      // grid left at 0 would come back invisible while its button read ON.
      if (!on) g.material.opacity = GRID_OPACITY;
    });
  }

  /**
   * Punch the bloom up for a moment — the S hotkey's flash.
   *
   * FIX: this lived in main.js's key handler, which captured the strength on
   * the first press and wrote it back 200 ms later without asking what the
   * value was by then. Every other writer of bloom goes through
   * PARAMS.bloom.set — the panel slider, a MIDI CC, a clip step, a preset
   * apply, RESET ALL — and nothing modulates it per frame, so any write inside
   * that window is somebody's fresh intent. It was overwritten. The restore now
   * happens only if the punch is still the value on the engine, and the engine
   * owns the state the way it owns the grid fade.
   *
   * @param {number} [amount] — added to the captured strength, clamped at 1.5
   * @param {number} [ms]     — how long the punch lasts
   */
  punchBloom(amount = 0.8, ms = 200) {
    if (!this.bloomPass) return;
    // Only the first press of a rapid burst captures: later ones inside the
    // window would otherwise capture the punched value and never come back.
    if (this._bloomPunchOrig == null) this._bloomPunchOrig = this.bloomPass.strength;
    clearTimeout(this._bloomPunchTimer);

    const punch = Math.min(1.5, this._bloomPunchOrig + amount);
    this.bloomPass.strength = punch;

    this._bloomPunchTimer = setTimeout(() => {
      const orig = this._bloomPunchOrig ?? 0.55;
      this._bloomPunchTimer = null;
      this._bloomPunchOrig  = null;
      // Somebody set bloom while the punch was up: that is a fresh intent and
      // this timer has no business undoing it.
      if (this.bloomPass.strength !== punch) return;
      this.bloomPass.strength = orig;
      this.cb.onBloomRestored?.(orig);
    }, ms);
  }

  /** Toggle transparent background for alpha-channel output (chroma-key free). */
  setTransparentBackground(enabled) {
    const wasEnabled = this.transparentBg;
    this.transparentBg = enabled;
    if (enabled) {
      // FIX: remember what the grid was doing. The restore branch used to
      // write `true` unconditionally, and the grid ships hidden — so one
      // on→off round trip put a grid into the scene (and into captureStream,
      // the second screen and the recorder) that the user never switched on,
      // leaving the ⊞ GRID button reading the opposite of reality from then
      // on. Stars need no such care: nothing else writes stars.visible, so
      // true is always the right answer for them.
      //
      // FIX(r2): only on the way IN. Enabling twice — the panel button and the
      // output modal drive the same call — used to re-snapshot the `false` we
      // had just forced ourselves, losing a grid that was genuinely on.
      if (!wasEnabled) this._gridBeforeTransparent = this.grid.visible;
      this.scene.background = null;
      this.scene.fog        = null;
      this.renderer.setClearColor(0x000000, 0);
      this.stars.visible = false;
      this.grid.visible  = false;
    } else {
      this.scene.background = uiColor(0x050515);
      this.scene.fog        = new THREE.FogExp2(uiColor(0x050515), 0.007);
      this.renderer.setClearColor(uiColor(0x050515), 1);
      this.stars.visible = true;
      // FIX(r2): give the grid back only if nothing claimed it meanwhile. The
      // snapshot is right for a bare round trip and wrong the moment ⊞ GRID,
      // the G fade or a preset writes grid.visible in between — restoring then
      // switched OFF a grid the operator had just switched on, with the button
      // left lit. Still false means nobody touched what we forced.
      if (!this.grid.visible) this.grid.visible = this._gridBeforeTransparent ?? false;
    }
  }

  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }

  // ═══════════════════════════════════════════════════════════════════════════
  // Post-processing FX — public control API
  //
  // The four optional passes are created on demand (see _fxPass), so every
  // reference to them outside the setters must tolerate `null` — that is what
  // "off" looks like before the first enable. Once built, a pass lives as long
  // as the composer does: disabling only clears its `enabled` flag, because
  // tearing it down would put the render-target allocation and the shader
  // compile back on the toggle path. Any future teardown must reach them
  // through `?.` for the same reason.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Composer index a lazily built pass must be inserted at. Derived from the
   * passes actually present right now: take the nearest pass DOWNSTREAM of
   * `key` that already exists and sit in front of it; if nothing downstream is
   * built, this pass belongs at the tail. Reading the live array rather than
   * counting slots is what keeps the order correct no matter which subset of
   * the optional passes happens to exist at the time of the call.
   * @param {string} key — property name, must appear in FX_PASS_ORDER
   */
  _fxSlot(key) {
    const order  = RenderEngine.FX_PASS_ORDER;
    const passes = this.composer.passes;
    for (let i = order.indexOf(key) + 1; i < order.length; i++) {
      const idx = passes.indexOf(this[order[i]]); // null / absent ⇒ -1, skipped
      if (idx !== -1) return idx;
    }
    return passes.length;
  }

  /**
   * Empty an AfterimagePass's two accumulation targets.
   *
   * Transparent black rather than the scene's clear colour: the pass's shader
   * takes a max() against the previous frame, so a black-but-opaque buffer
   * would pin output alpha near 1 for the whole decay — visible in the
   * transparent-background output path, which is exactly where an unexpected
   * opaque frame costs the most.
   */
  _clearAfterimage(pass) {
    const r = this.renderer;
    if (!r || !pass?.textureOld || !pass?.textureComp) return;
    const prevTarget = r.getRenderTarget();
    const prevColor  = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha  = r.getClearAlpha();

    r.setClearColor(0x000000, 0);
    for (const target of [pass.textureOld, pass.textureComp]) {
      r.setRenderTarget(target);
      r.clear(true, false, false);
    }

    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
  }

  /**
   * Resolve the pass a setter is about to touch, building it if this is the
   * call that turns it on. Returns null when the caller is disabling a pass
   * that was never built — nothing to do, and constructing one just to set
   * enabled=false would defeat the whole point.
   *
   * The pass is inserted DISABLED — ShaderPass defaults to enabled, and the
   * setters flip the flag only after pushing their uniforms, so the effect can
   * never render one frame with stock settings. insertPass() sizes the new
   * pass from the composer's current dimensions, so one built after a resize
   * is born at the right resolution — that is why onResize() needs no
   * lazy-pass special case.
   *
   * @param {string}     key      — property name, must appear in FX_PASS_ORDER
   * @param {boolean}    enabled  — what the setter was asked to do
   * @param {()=>object} build    — constructs the pass; called at most once
   */
  _fxPass(key, enabled, build) {
    if (!enabled) return this[key];
    if (!this[key]) {
      const pass = build();
      pass.enabled = false;
      this[key] = pass;
      this.composer.insertPass(pass, this._fxSlot(key));
    }
    return this[key];
  }

  /**
   * Chromatic Aberration — RGB lens dispersion toward frame edges.
   * @param {boolean} enabled
   * @param {number}  strength  0.001 (subtle) – 0.008 (heavy). Default 0.003.
   */
  setChromaticAberration(enabled, strength = 0.003) {
    const pass = this._fxPass('chromaticPass', enabled, () => new ShaderPass(ChromaticAberrationShader));
    if (!pass) return; // never built ⇒ already off
    if (enabled) {
      pass.uniforms.uStrength.value = Math.max(0, strength);
    }
    pass.enabled = enabled;
  }

  /**
   * Film Grain + Vignette — analog noise and edge darkening.
   * Grain and vignette can be toggled independently via the optional flags.
   * @param {boolean} enabled       Master toggle for the entire pass.
   * @param {number}  intensity     Grain strength. 0.04 (whisper) – 0.15 (heavy). Default 0.06.
   * @param {number}  vignetteAmt   Vignette strength. 0 = none, 1 = heavy. Default 0.55.
   * @param {boolean} grainOnly     If true, keeps vignette on regardless of `enabled`.
   */
  setFilmGrain(enabled, intensity = 0.06, vignetteAmt = 0.55, grainOnly = false) {
    this.filmGrainVigPass.uniforms.uGrainOn.value       = enabled ? 1.0 : 0.0;
    this.filmGrainVigPass.uniforms.uGrainIntensity.value = Math.max(0, intensity);
    if (!grainOnly) {
      this.filmGrainVigPass.uniforms.uVigOn.value     = enabled ? 1.0 : 0.0;
      this.filmGrainVigPass.uniforms.uVignetteAmt.value = Math.max(0, vignetteAmt);
    }
    // Keep pass alive as long as vignette is also active (they share one pass)
    const vigActive = this.filmGrainVigPass.uniforms.uVigOn.value > 0.5;
    this.filmGrainVigPass.enabled = enabled || vigActive;
  }

  /**
   * Vignette only — control edge darkening independently from grain.
   * @param {boolean} enabled
   * @param {number}  amount   0 = none, 1 = heavy. Default 0.55.
   */
  setVignette(enabled, amount = 0.55) {
    this.filmGrainVigPass.uniforms.uVigOn.value      = enabled ? 1.0 : 0.0;
    this.filmGrainVigPass.uniforms.uVignetteAmt.value = Math.max(0, amount);
    const grainActive = this.filmGrainVigPass.uniforms.uGrainOn.value > 0.5;
    this.filmGrainVigPass.enabled = enabled || grainActive;
  }

  /**
   * Afterglow / Trailing — motion trails by blending with a decayed
   * version of the previous frame.
   * @param {boolean} enabled
   * @param {number}  amount  0.5 (short trail) – 0.97 (very long ghost). Default 0.87.
   */
  setAfterglow(enabled, amount = 0.87) {
    // The constructor arg is the same damp default the uniform write below
    // overrides on this very call; it matters only if a future caller enables
    // the pass without passing an amount.
    const pass = this._fxPass('afterimagePass', enabled, () => new AfterimagePass(0.87));
    if (!pass) return; // never built ⇒ already off
    if (enabled) {
      // FIX: start from an empty buffer. AfterimagePass accumulates into two
      // render targets and offers no way to clear them, and the composer skips
      // a disabled pass outright rather than letting it decay — so switching
      // the trail off froze whatever frame was in there, and switching it back
      // on (a style round trip, a preset, a clip step) blended that stale frame
      // into the live picture for the length of a decay: a ghost of a shape the
      // operator had already left. Only on a genuine off→on, so a preset
      // re-applying the same style mid-trail does not blink it.
      if (!pass.enabled) this._clearAfterimage(pass);
      // AfterimagePass exposes its uniform as 'damp'
      pass.uniforms['damp'].value = Math.min(0.98, Math.max(0.0, amount));
    }
    pass.enabled = enabled;
  }

  /**
   * God Rays — screen-space crepuscular ray scattering.
   * Disabled automatically on mobile regardless of the `enabled` argument
   * because the 48-sample loop is too heavy for low-end GPUs.
   * @param {boolean} enabled
   * @param {number}  intensity   Exposure of the ray accumulation. 0.05–0.25. Default 0.12.
   * @param {number}  decay       Per-step exponential falloff. 0.94–0.98. Default 0.965.
   * @param {number}  threshold   Luminance cutoff: pixels below this don't cast rays. Default 0.35.
   */
  setGodRays(enabled, intensity = 0.12, decay = 0.965, threshold = 0.35) {
    if (this.isMobile && enabled) {
      console.info('[VimathicFX] God Rays are disabled on mobile for GPU budget reasons.');
      return;
    }
    const pass = this._fxPass('godRaysPass', enabled, () => new ShaderPass(GodRaysShader));
    if (!pass) return; // never built ⇒ already off
    if (enabled) {
      pass.uniforms.uExposure.value  = Math.max(0, intensity);
      pass.uniforms.uDecay.value     = Math.min(0.99, Math.max(0.8, decay));
      pass.uniforms.uThreshold.value = Math.max(0, threshold);
    }
    pass.enabled = enabled;
  }

  /**
   * Motion Blur — directional blur along camera velocity in screen space.
   * Disabled automatically on mobile.
   * @param {boolean} enabled
   * @param {number}  amount   Velocity multiplier. 0.5 (subtle) – 2.0 (heavy). Default 1.0.
   * @param {number}  maxSpeed Clamp on the raw velocity to avoid extreme blur. Default 0.04.
   */
  setMotionBlur(enabled, amount = 1.0, maxSpeed = 0.04) {
    if (this.isMobile && enabled) {
      console.info('[VimathicFX] Motion Blur is disabled on mobile for GPU budget reasons.');
      return;
    }
    const pass = this._fxPass('motionBlurPass', enabled, () => new ShaderPass(MotionBlurShader));
    if (!pass) return; // never built ⇒ already off
    if (enabled) {
      pass.uniforms.uAmount.value = Math.max(0, amount);
      this._mbClampSpeed = Math.max(0.005, maxSpeed);
    }
    pass.enabled = enabled;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Post-processing FX — internal per-frame helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Project a world-space point to screen UV (0–1) and write it into the
   * God Rays light position uniform. Called from updateLights() using
   * magicLight.position, or manually for a custom light source.
   * Callers must have checked godRaysPass — this writes into it unguarded,
   * and the pass only exists once setGodRays() has turned the effect on.
   * @param {THREE.Vector3} worldPos
   */
  _updateGodRaysLightPos(worldPos) {
    const ndc = worldPos.clone().project(this.camera);
    // Convert NDC (-1..1) → UV (0..1)
    this.godRaysPass.uniforms.uLightPos.value.set(
      (ndc.x + 1.0) * 0.5,
      (ndc.y + 1.0) * 0.5,
    );
  }

  /**
   * Computes screen-space camera velocity by projecting the world origin
   * through consecutive camera matrices. Called from updateLights() when
   * Motion Blur is enabled — which also means the pass exists, so the
   * uniform write at the end is unguarded on purpose.
   */
  _updateMotionBlur() {
    // Project world origin (0,0,0) into NDC for the current frame
    const curr = new THREE.Vector3(0, 0, 0).project(this.camera);

    // Velocity = delta in NDC space, halved to convert to UV delta
    let vx = (curr.x - this._prevOriginNDC.x) * 0.5;
    let vy = (curr.y - this._prevOriginNDC.y) * 0.5;

    // Clamp magnitude to prevent extreme blur during fast snaps
    const len = Math.sqrt(vx*vx + vy*vy);
    if (len > this._mbClampSpeed) {
      const scale = this._mbClampSpeed / len;
      vx *= scale; vy *= scale;
    }

    this.motionBlurPass.uniforms.uVelocity.value.set(vx, vy);
    this._prevOriginNDC.copy(curr);
  }

  /**
   * Convenience method — update the God Rays light source from any world-space
   * position. Call this from the animate loop to track a moving object rather
   * than the default magicLight.
   * @param {THREE.Vector3} worldPos
   */
  updateGodRaysLightPos(worldPos) {
    // Same `?.` reasoning as in updateLights: no pass ⇒ the effect is off.
    if (this.godRaysPass?.enabled) this._updateGodRaysLightPos(worldPos);
  }
}
