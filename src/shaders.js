/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

import * as THREE from 'three';
import { OBJLoader }  from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BAND_COUNT, BAND_PAN_TILT } from './audio.js';

/**
 * The band lookup, shared by the built-in vertex shader and by the one the
 * editor compiles, so a user-written shader can read the spectrum the same way.
 *
 * A uniform array rather than a texture: 24 floats is far inside the smallest
 * vertex-uniform budget WebGL2 guarantees (1024 components), needs no format
 * negotiation and no filtering rules, and — unlike a texture fetch — is exact.
 *
 * The lookup INTERPOLATES between neighbouring bands instead of stepping. Both
 * were tried on the plane at 161 segments: stepping puts a visible crease at
 * each of the 23 band boundaries, because two adjacent rings of vertices get
 * levels that differ by whatever the music does, and a mesh cannot hide a
 * discontinuity that large. Interpolating keeps the rings legible — the band
 * structure is still what you see — without the seams.
 *
 * uBandR is the radius the body actually occupies, written per shape change, so
 * band 23 lands on the rim of whatever is on screen rather than at a fixed
 * distance that a small body never reaches.
 */
export const BAND_GLSL = `
uniform float uBands[${BAND_COUNT}];
// Where each band sits between the speakers, -1..+1, matched index for index
// with uBands. Written from AudioEngine.bandPan; all zeros for mono material,
// for a silent band, and whenever the side tap is missing.
uniform float uBandPan[${BAND_COUNT}];
uniform float uBandDepth, uBandR;
uniform int   uBandMode;
float bandAtU(float u){
  float x = clamp(u, 0., 1.) * float(${BAND_COUNT} - 1);
  int i = int(floor(x));
  int j = min(i + 1, ${BAND_COUNT} - 1);
  // ── Stereo, applied HERE and nowhere else ─────────────────────────────────
  // Every band term in every program goes through this one lookup — the
  // character path, the radius rule, the editor template's bandAtRadius — so
  // putting the stereo tilt inside it is what makes "the left of the body
  // answers the left of the mix" true everywhere at once, with no call site
  // changed and no guard loosened to let a new factor through.
  //
  // It reads \`position\` directly rather than taking the coordinate as an
  // argument: the attribute is in scope in every vertex program, and it is the
  // UNDISPLACED body, so the side a vertex is on cannot drift while the surface
  // moves. The clamp makes the weighting a smooth ramp across the body instead
  // of a sign, which would draw a seam straight down the middle at x = 0.
  //
  // At pan 0 the factor is exactly 1.0 and this returns precisely the mix it
  // always did — mono material, a silent band and a browser without a channel
  // splitter are all bit-identical to before the stereo tap existed.
  float lvl = mix(uBands[i], uBands[j], fract(x));
  float pan = mix(uBandPan[i], uBandPan[j], fract(x));
  return lvl * (1. + ${BAND_PAN_TILT.toFixed(2)} * pan * clamp(position.x / max(uBandR, 1e-3), -1., 1.));
}
float bandAtRadius(float r){
  return bandAtU(r / max(uBandR, 1e-3));
}`;

// ── Vertex shader — 38 modes ──────────────────────────────────────────────────
// Transition uniforms added:
//   uMorphProgress — geometry shape morph (1=normal, 0=flat/collapsed)
//   uModeNext      — GPU shader mode to blend toward
//   uModeBlend     — 0=current mode only, 1=next mode only (crossfade)
//
// The 38-mode if/else ladder is extracted into computeMode() so it can be
// called twice (once for uMode, once for uModeNext) without code duplication.
// GLSL functions with int arguments are supported in GLSL ES 1.00+.
export const VS = `
uniform float uTime,uBass,uMid,uTreble,uAmp,uBeat,uWI,uPointSize;
uniform int   uMode,uMathMode,uModeNext;
uniform float uMorphProgress,uModeBlend;
// ── The colour channel ────────────────────────────────────────────────────────
// vH is the ONLY thing the fragment shader colours by: t = clamp((vH+.8)*.6,
// .03,.97), i.e. the palette's live window is vH in [-0.75, +0.8167] — solve
// .03/.6-.8 and .97/.6-.8, 1.567 units wide — which is the size of the
// audio-driven displacement and nothing wider. That window is
// what makes the palette the audio channel: measured on mode 0, the field
// spans +-0.14 in silence (nothing clamps, on any of the twenty shapes) and
// reaches -1.49..+2.00 with uAmp 1.5 and bass 1.0, where the ramp clips 64 % of
// the plane's area — it clipped that loud before round 10 as well, and this
// change neither improves nor worsens it.
//
// Since round 10 the shape keeps its own y, so pos.y is body + field and no
// longer fits that window at all — a sphere spans +-3.5. Measured on the
// catalogue at boot uniforms in silence, colouring by pos.y put 73-100 % of the
// surface of FOURTEEN of the twenty shapes on a CLAMPED, flat colour (the boot
// shape 81.5 %, octahedron 100 %) where it had been 0 % on every one of them.
// The other six are accounted for: plane, disc, circle, hex and tetrahedron
// read 0.0 %, and solar reads 37.7 %. So vH
// is written from the DISPLACEMENT, not from the absolute height, and geometry
// and colour become two independent channels instead of one contested one.
//
// uVHField says which of the two the CPU path left in the attribute:
//   0 — pos.y IS the value to colour by (GPU mode, Volume, Collapse). Volume
//       and Collapse have always written base + displacement and have always
//       clamped, and this uniform is what keeps them bit-identical.
//   1 — Surface mode: applyHeightField wrote base + field, so the field is
//       recovered as pos.y - aBaseY.
// aBaseY is the shape's own y, uploaded once per shape by RenderEngine.setShape
// (a static attribute, never touched per frame). A geometry that does not carry
// it reads 0 — which is exactly the value that makes the subtraction a no-op,
// and is also what applyHeightField falls back to when it has no base.
uniform int   uVHField;
attribute float aBaseY;
attribute float aField;
// ── The band's own contribution, per vertex ─────────────────────────────────
// PTS draws the surface as points, and a point can do two things a triangle
// cannot: change size, and leave the sheet. Both want the BAND's displacement
// on its own — not the whole displacement, which is mostly the formula, and not
// the band level, which knows nothing about where this vertex listens.
//
// In GPU mode the vertex program already has it: f - fBase is exactly the band
// term, for free, and exactly 0.0 when the layer is off. In CPU mode the
// displacement is baked into the position attribute before any shader runs, so
// the writers hand it over here instead. Zero-filled by attachBaseY, so a
// geometry that predates the layer reads 0 and the points stay a plain cloud.
attribute float aBand;
// ── The body's own share of the band coordinate ─────────────────────────────
// Everything the shader can measure by itself is the FORMULA: bandCoordOfMode
// samples computeMode around pos.xz and knows nothing about the shape those
// samples are being drawn on. A vertex shader cannot see its neighbours, so a
// curvature it computed itself is not available at any price — the value is
// measured once on the CPU in MathVisualizer._capturePristine and uploaded,
// exactly as aBaseY is, and exactly the same array is handed to the CPU map.
// In [-1, 1]; 0 means this body has no curvature texture to spend, which is the
// honest answer for a plane and for every flat-shaded polyhedron.
attribute float aBodyK;
// 1 while the points proxy is the thing being drawn, 0 otherwise — set beside
// uPointSize in setVizModeGPU, for the same reason and with the same lifetime.
// It cannot be inferred inside the shader: uPtStyle is 0 both outside PTS and
// for the plain-square style, and the proxy shares this whole uniform block
// with the mesh and with any imported model.
// (No backticks in this file's GLSL comments — the shader sources are template
// literals, and one closed VS in the middle of a sentence.)
uniform float uPtBand;
// WHICH band this point listens to, 0…1, or -1 where the layer is off. Written
// here and read by the fragment shader, which shifts the palette parameter by
// it — see the tint note in FS. The CPU path hands it over in aBandU, because
// by the time this program runs its displacement is already baked into the
// position; the GPU path has the coordinate in hand and passes it straight out.
attribute float aBandU;
varying float vBandU;
varying float vH;
// SURF lighting: pass post-displacement world position and view direction to FS
// so the fragment shader can reconstruct surface normals via screen-space
// derivatives. Both varyings are written unconditionally — they're cheap, and
// the FS only consumes them when uLighting==1.
varying vec3  vWorldPos;
${BAND_GLSL}
varying vec3  vViewDir;

// ── Helper functions ──────────────────────────────────────────────────────────
// A deterministic per-vertex value in [-1, 1], for the PTS scatter. Signed and
// roughly symmetric, so a region sprays both ways and does not simply inflate;
// deterministic, so the grain belongs to the vertex rather than shimmering. It
// is fed the ORIGINAL position, never the displaced one, for that second reason.
// The usual sin/fract hash: its statistics are poor and its behaviour differs
// between drivers, and neither matters for a value whose only job is to be
// different from its neighbour's.
float ptSpray(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453)*2.-1.;}
// ── turb — four waves, and why none of them runs along an axis ───────────────
// It used to be sum |sin(p.x*i) * cos(p.y*i)| / i, and that spelling drew a
// GRID on the surface. Two properties of it, both load-bearing:
//
//   * abs() breaks the first derivative wherever its argument crosses zero, and
//     those crossings are the straight lines p.x*i = k*pi. A crease in the
//     height is a jump in the normal, and Mirror reflects the jump as a hard
//     edge — the brighter the band, the more of it there is to see.
//   * the term is SEPARABLE, f(x)*g(z), so the crease lines run along X and Z
//     and nowhere else. Separable plus kinked is a lattice, in world
//     coordinates, identical under every formula and every shape.
//
// Measured on the shipped tree, plane at 256 segments, low bands at 1.0, over
// the vertices where SHATTER has weight (u > 0.6): |d2h/dx2| within half a mesh
// step of a kink line was 1.63x its value elsewhere on eigenField and 1.43x on
// determinant. With the abs() alone removed both ratios go to 0.97-1.02, which
// is what says the kink — not the frequency content — is what drew the grid.
//
// This spelling drops the abs() AND the axes: four plane waves, each with its
// own direction (angle i*1.7+0.4, an irrational-ish step so no two of the four
// come within 15 degrees of each other and none within 30 degrees of an axis)
// and its own phase. Same ratio measurement: 0.96-1.06.
//
// The scale and offset are not decoration. Two call sites depend on turb's
// STATISTICS rather than on its shape — bandMotion centres it on 0.9 to make
// SHATTER shake instead of inflate, and modes 0/3/32 add it as relief with a
// fixed gain — so the replacement is fitted to the old mean and standard
// deviation over the domain the call sites use (p = 3.5*(x,z), x,z in +-3.5):
// old mean 0.8464 sd 0.3446 range 0.003..1.679, new mean 0.8462 sd 0.3446
// range 0.015..1.693. Drift in the mean is 2e-4.
float turb(vec2 p){float t=0.;for(float i=1.;i<5.;i++){float a=i*1.7+0.4;t+=sin(dot(p,vec2(cos(a),sin(a)))*i+i*2.3)/i;}return t*0.408+0.846;}
float ramu(vec2 p){float r=length(p),a=atan(p.y,p.x),s=0.;s+=cos(a*-6.)*exp(-r*.28*36.);s+=cos(a*-5.)*exp(-r*.28*25.);s+=cos(a*-4.)*exp(-r*.28*16.);s+=cos(a*-3.)*exp(-r*.28*9.);s+=cos(a*-2.)*exp(-r*.28*4.);s+=cos(a*-1.)*exp(-r*.28*1.);s+=1.;s+=cos(a*1.)*exp(-r*.28*1.);s+=cos(a*2.)*exp(-r*.28*4.);s+=cos(a*3.)*exp(-r*.28*9.);s+=cos(a*4.)*exp(-r*.28*16.);s+=cos(a*5.)*exp(-r*.28*25.);s+=cos(a*6.)*exp(-r*.28*36.);return tanh(s*.7);}
float h_sech(float x){float e=exp(-abs(x));return 2.*e/(1.+e*e);}

// ── computeMode — evaluate displacement for one GPU mode ─────────────────────
// Called twice in main() so both uMode and uModeNext can be blended.
// All 38 original formulas are preserved exactly, only wrapped in a function.
float computeMode(int mode, vec2 xz, float b, float t, float m,
                  float bt, float a, float wi, float T) {
  float r  = length(xz);
  float ang= atan(xz.y, xz.x);
  float y  = 0.;
  if(mode==0){y=sin(r*8.*wi+T)*(0.2+b*.8)*a+sin(xz.x*5.*m*wi)*.1+turb(xz*(2.+t)*wi)*b*.3+bt*.5;}
  else if(mode==1){y=sin(r*12.*wi*(0.5+t)+T)*exp(-r*.5)*(0.2+b*.8)*a+bt*.4;}
  else if(mode==2){y=sin(r*20.*wi*(0.5+t))*(0.2+b*.8)*a+sin(ang*6.)*.1*wi+bt*.3;}
  else if(mode==3){y=turb(xz*(3.+t*2.)*wi)*(0.3+b*.7)*a+sin(r*12.*wi)*.1+bt*.6;}
  else if(mode==4){y=sin(r*15.*wi-T*3.)*exp(-r*.3)*(0.3+b*.7)*a+sin(ang*8.)*.08*wi+bt*.4;}
  else if(mode==5){y=pow(abs(sin(r*25.*wi*(0.5+t))),2.)*(0.2+b*.6)*a+bt*.5;}
  else if(mode==6){y=ramu(xz*(0.8+b*.5)*wi)*(0.3+b*.7)*a+sin(r*12.*wi)*.08+bt*.3;}
  else if(mode==7){y=sin(r*10.*wi*(0.5+t)-T*4.)*exp(-r*.4)*(0.3+b*.7)*a+sin(xz.x*6.*wi)*cos(xz.y*6.*wi)*.08+bt*.4;}
  // FIX: mode 8 loop n=-6..6 unrolled for WebGL1
  else if(mode==8){float s=0.;s+=cos(ang*-6.)*exp(-r*.25*36.*(0.5+t));s+=cos(ang*-5.)*exp(-r*.25*25.*(0.5+t));s+=cos(ang*-4.)*exp(-r*.25*16.*(0.5+t));s+=cos(ang*-3.)*exp(-r*.25*9.*(0.5+t));s+=cos(ang*-2.)*exp(-r*.25*4.*(0.5+t));s+=cos(ang*-1.)*exp(-r*.25*1.*(0.5+t));s+=1.;s+=cos(ang*1.)*exp(-r*.25*1.*(0.5+t));s+=cos(ang*2.)*exp(-r*.25*4.*(0.5+t));s+=cos(ang*3.)*exp(-r*.25*9.*(0.5+t));s+=cos(ang*4.)*exp(-r*.25*16.*(0.5+t));s+=cos(ang*5.)*exp(-r*.25*25.*(0.5+t));s+=cos(ang*6.)*exp(-r*.25*36.*(0.5+t));y=tanh(s*.7)*(0.3+b*.7)*a;}
  else if(mode==9){float s=0.;for(int n=-8;n<=8;n++){float fn=float(n);s+=cos(ang*fn*2.)*exp(-r*.3*fn*fn*(0.5+t));}y=s*.5*(0.3+b*.7)*a;}
  // FIX: this branch drew nothing at all. Every term carried the factor
  // sin(fn*3.14159) with fn integer — that is sin(nπ), which is zero: the seven
  // values are 2.7e-6, −5.3e-6, 8.0e-6, −1.1e-5, 1.3e-5, −1.6e-5, 1.9e-5, all
  // of them float residue. Measured surface span over [−3.5, 3.5]² was 7.9e-6
  // against 0.75…5.5 for its neighbours in the block, and pos.y is assigned,
  // not accumulated, so picking mode 11 gave a flat plate in a flat colour.
  // Now weighted by τ(n) itself — 1, −24, 252, −1472, 4830, −6048, −16744,
  // the coefficients of q∏(1−qⁿ)²⁴ — scaled by 10⁻³ so the sum lands in the
  // same amplitude band as the rest of the ladder. Unrolled to match the other
  // WebGL1-safe branches here.
  else if(mode==10){float s=0.;
    s+= 0.001*exp(-1.*.3)*sin(r*1.*5.*wi*(0.5+t));
    s+=-0.024*exp(-2.*.3)*sin(r*2.*5.*wi*(0.5+t));
    s+= 0.252*exp(-3.*.3)*sin(r*3.*5.*wi*(0.5+t));
    s+=-1.472*exp(-4.*.3)*sin(r*4.*5.*wi*(0.5+t));
    s+= 4.830*exp(-5.*.3)*sin(r*5.*5.*wi*(0.5+t));
    s+=-6.048*exp(-6.*.3)*sin(r*6.*5.*wi*(0.5+t));
    s+=-16.744*exp(-7.*.3)*sin(r*7.*5.*wi*(0.5+t));
    y=s*.4*(0.3+b*.7)*a;}
  // FIX: t here is uTreble, not time, and the whole sum was multiplied by
  // sin(fn*t*2.) — which is exactly zero when there is no treble. Measured span
  // in silence: 0.0e+0, against 0.98 at half treble. Every other branch keeps a
  // floor (the (0.3+b*.7) factor bottoms out at 0.3); this one had none, so the
  // surface was a flat plate any time the track went quiet.
  //
  // FIX(second pass): the first repair wrote the offset INSIDE the harmonic
  // index — sin(fn*(0.35+t*2.)) — which lines all seven harmonics up in phase
  // and adds them constructively. Floor gained, ceiling lost: span went 2.046 →
  // 3.290 under loud audio and 3.070 → 4.935 with the sliders up, against a
  // camera half-frame of about 3.26. The offset belongs outside the index, so
  // it shifts every harmonic by the same amount instead of by a multiple of it:
  // silence 0.680 (was 0.0), loud 1.998, sliders up 2.997 — a floor, and a
  // ceiling now slightly under what the branch had before either repair.
  // FIX(r7): the sentence above was measured at one value of uTreble and is
  // false at the worst one. A constant offset gives every harmonic the SAME
  // phase, so near t = 0.1 all seven still add: sweeping uTreble across [0, 1]
  // with the sliders up, the peak is 6.653 against 5.663 for the branch before
  // either repair — 17 % above, not under. The offset is what makes the floor,
  // so it stays and the branch is scaled by 5.663/6.653 = 0.851 instead:
  // .5 → .425. Worst peak 5.655, and silence keeps a span of 0.62 where the
  // shipped branch had exactly 0.
  else if(mode==11){float s=0.;for(int n=1;n<=7;n++){float fn=float(n);s+=exp(-fn*r*.3)*cos(ang*fn*2.)*sin(fn*t*2.+0.6);}y=s*.425*(0.3+b*.7)*a;}
  else if(mode==12){y=exp(-r*.6)*sin(r*8.*wi*(0.5+t))*(0.3+b*.7)*a;}
  else if(mode==13){float e=0.;for(int n=1;n<=5;n++){float fn=float(n);e+=cos(ang*fn*4.)*exp(-r*.15*fn);}y=e*.4*(0.3+b*.7)*a;}
  else if(mode==14){y=sin(r*8.*wi*(0.5+t))*cos(ang*4.)*(0.3+b*.7)*a+bt*.3;}
  else if(mode==15){float s=0.;for(int n=1;n<=6;n++){float fn=float(n);s+=sin(fn*r*5.*wi*(0.5+t))*cos(fn*ang);}y=s*.25*(0.3+b*.7)*a;}
  // FIX(r6): the crest sits at r = T + 1.5(0.8b+0.1) and T is uTime, which
  // only grows — so the pulse crossed the plane's half-diagonal of 4.9497 at
  // T ≈ 4.2 and never came back. Span fell under 1 % of its T=0 value after
  // 15.5 s of uptime, reached 7.5e-14 at 42 s and was literally 0.000e+0 from
  // thirty minutes on: a flat plate for the rest of the session, with the whole
  // mesh pinned at the extreme. Folding the ARGUMENT into one period rather
  // than the time turns it into a train of the same pulse, and costs nothing:
  // sech is even, so mod(u+5., 10.)-5. matches value for value across the wrap
  // (seam 1.3e-9, against 4.8e-3 for an ordinary 0.008 frame step — one 60 Hz
  // frame of the 0.48 units/s clock, FIX(#50)), where
  // wrapping the time instead would teleport the crest back to the centre with
  // a seam of 1.32 — 264 frame steps. Spacing is 5 in r against a corner at
  // 4.9497, so exactly one crest is on the plate at a time, as before; the
  // branch is identical to what shipped at T=0 wherever the crest is (6.7e-16
  // inside r<2.5) and its peak is untouched at every slider setting — 0.4199 at
  // the factory sliders, 2.9700 at the top of both.
  else if(mode==16){float u=r*2.-T*2.-(b*.8+.1)*3.;y=h_sech(mod(u+5.,10.)-5.)*(0.6+b*.6)*a+bt*.4;}
  else if(mode==17){y=sin(xz.x*6.*wi*(0.5+t))*cos(xz.y*6.*wi*(0.5+t))*(0.3+b*.7)*a+bt*.4;}
  else if(mode==18){float s=0.;for(int n=1;n<=4;n++){float fn=float(n);s+=sin(r*fn*4.*wi*(0.5+t)+ang*fn)*exp(-r*.2*fn);}y=s*.3*(0.3+b*.7)*a;}
  else if(mode==19){float s=0.;for(int n=1;n<=4;n++){float fn=float(n);s+=cos(xz.x*fn*5.*wi)*sin(xz.y*fn*5.*wi);}y=s*.2*(0.3+b*.7)*a+bt*.4;}
  else if(mode==20){float s=0.;for(int n=1;n<=5;n++){float fn=float(n);s+=sin(r*fn*3.*wi*(0.5+t)+T*fn*.5)*exp(-r*.15*fn);}y=s*.25*(0.3+b*.7)*a;}
  else if(mode==21){float s=0.;for(int n=1;n<=6;n++){float fn=float(n);s+=cos(ang*fn)*sin(r*fn*4.*wi*(0.5+t))*exp(-r*.1);}y=s*.2*(0.3+b*.7)*a+bt*.3;}
  else if(mode==22){float s=0.;for(int n=1;n<=4;n++){float fn=float(n);s+=sin(r*fn*6.*wi*(0.5+t))*cos(xz.x*fn*3.*wi);}y=s*.25*(0.3+b*.7)*a;}
  else if(mode==23){float s=0.;for(int n=1;n<=5;n++){float fn=float(n);s+=sin(ang*fn*2.+T*.5)*exp(-r*.2)*sin(r*fn*5.*wi*(0.5+t));}y=s*.3*(0.3+b*.7)*a;}
  else if(mode==24){float s=0.;for(int n=1;n<=6;n++){float fn=float(n);s+=cos(r*fn*4.*wi*(0.5+t)+ang*fn*3.);}y=s*.15*(0.3+b*.7)*a+bt*.3;}
  else if(mode==25){y=sin(r*10.*wi*(0.5+t)+ang*3.-T*2.)*exp(-r*.3)*(0.3+b*.7)*a+bt*.4;}
  else if(mode==26){float s=0.;for(int n=1;n<=5;n++){float fn=float(n);s+=sin(r*fn*5.*wi*(0.5+t))*cos(ang*fn)/(fn);}y=s*.4*(0.3+b*.7)*a;}
  else if(mode==27){float s=0.;for(int n=1;n<=4;n++){float fn=float(n);s+=sin(xz.x*fn*4.*wi*(0.5+t))*cos(xz.y*fn*4.*wi*(0.5+t))/(fn*.5);}y=s*.2*(0.3+b*.7)*a+bt*.3;}
  else if(mode==28){y=sin(r*12.*wi*(0.5+t))*sin(ang*5.)*(0.3+b*.7)*a+bt*.4;}
  else if(mode==29){float s=0.;for(int n=1;n<=4;n++){float fn=float(n);s+=exp(-r*.2*fn)*sin(r*fn*6.*wi*(0.5+t)+ang*fn*2.);}y=s*.35*(0.3+b*.7)*a;}
  // FIX: mode 30 loop n=-4..4 unrolled for WebGL1 — and the unrolling killed it.
  // The summand sin(5n·x)·cos(5n·z) is ODD in n, and the weight as written was
  // EVEN: the n = −4 term carried exp(-4.*.3), exactly what the n = +4 term
  // carried. So every pair cancelled and the branch returned zero for all x, z,
  // wi, b, a — measured span 1.1e-16, pure round-off. (Its sibling unrolling at
  // mode==8 survives because its summand cos(ang·n) is even, so its pairs add
  // instead of cancelling. The difference is the parity of the summand, not of
  // the weight.) The exponent now carries the sign of n, which is what a loop
  // over exp(-fn*.3) would have produced; the pairs combine to
  // −2·sin(5n·x)·cos(5n·z)·sinh(0.3n) and the surface spans ~1.1 at b = 0.5.
  else if(mode==30){float s=0.;s+=sin(xz.x*-4.*5.*wi)*cos(xz.y*-4.*5.*wi)*exp(4.*.3);s+=sin(xz.x*-3.*5.*wi)*cos(xz.y*-3.*5.*wi)*exp(3.*.3);s+=sin(xz.x*-2.*5.*wi)*cos(xz.y*-2.*5.*wi)*exp(2.*.3);s+=sin(xz.x*-1.*5.*wi)*cos(xz.y*-1.*5.*wi)*exp(1.*.3);s+=0.;s+=sin(xz.x*1.*5.*wi)*cos(xz.y*1.*5.*wi)*exp(-1.*.3);s+=sin(xz.x*2.*5.*wi)*cos(xz.y*2.*5.*wi)*exp(-2.*.3);s+=sin(xz.x*3.*5.*wi)*cos(xz.y*3.*5.*wi)*exp(-3.*.3);s+=sin(xz.x*4.*5.*wi)*cos(xz.y*4.*5.*wi)*exp(-4.*.3);y=s*.25*(0.3+b*.7)*a+bt*.4;}
  else if(mode==31){float s=0.;for(int n=1;n<=5;n++){float fn=float(n);s+=cos(r*fn*4.*wi*(0.5+t)+T*fn*.3)*exp(-r*.15);}y=s*.2*(0.3+b*.7)*a+bt*.3;}
  else if(mode==32){y=sin(r*8.*wi+T)*(0.2+b*.8)*a+turb(xz*(2.+t)*wi)*b*.2+sin(ang*4.)*.1+bt*.4;}
  else if(mode==33){y=sin(r*10.*wi*(0.5+t))*exp(-r*.3)*(0.3+b*.7)*a;}
  else if(mode==34){y=sin(r*12.*wi*(0.5+t))*exp(-r*.3)*(0.3+b*.7)*a;}
  // FIX: an equaliser and a vocoder that did not read the spectrum. Both branches
  // used only uAmp and uWI — no uBass, no uMid, no uTreble anywhere in them — so
  // their output was identical in silence and under loud music. Measured: the
  // surface span came to 5.172e-1 and 6.465e-1 in all three uniform states,
  // digit for digit, while the other 36 modes all moved. The bands now drive
  // the harmonics they are named for: low harmonic ← bass, middle ← mid, upper
  // two ← treble, which is what a three-band EQ display and a channel vocoder
  // both do.
  // FIX(r7): wiring the bands in was right; paying for them out of the silent
  // level was not. The floors went from a flat 0.2 per term to 0.10/0.10/0.08/
  // 0.05 and 0.08/0.08/0.06/0.04, so with nothing playing the two plates lost
  // most of their relief — span 0.297 against 0.362 and 0.300 against 0.452 —
  // and a VJ who has not started the track yet sees a nearly flat sheet. The
  // floor is 0.15 on every term now, which lands silence at 0.384 and 0.440,
  // and the band coefficients absorb the difference so the loud end does not
  // grow: peak with the sliders up 1.294 and 1.325 against 1.379 and 1.421.
  else if(mode==35){float eq=0.;
    eq+=sin(r* 8.*wi     )*(0.15+b*.45);
    eq+=sin(r* 8.*wi*2.  )*(0.15+m*.45);
    eq+=sin(r* 8.*wi*3.  )*(0.15+t*.38);
    eq+=sin(r* 8.*wi*4.  )*(0.15+t*.15);
    y=eq*.4*a;}
  else if(mode==36){float v3=0.;
    v3+=sin(r*10.*wi     )*(0.15+b*.38);
    v3+=sin(r*10.*wi*2.  )*(0.15+m*.33)*cos(ang*2.);
    v3+=sin(r*10.*wi*3.  )*(0.15+t*.26)*cos(ang*3.);
    v3+=sin(r*10.*wi*4.  )*(0.15+t*.09)*cos(ang*4.);
    y=v3*.5*a;}
  // Spectral Centroid: frequency scales with treble/bass ratio — the wave
  // gets denser when highs dominate, sparser when lows dominate. Ratio is
  // normalised so silence (b≈t≈0) lands at the neutral midpoint. Note: the
  // name 'centroid' is reserved in GLSL ES 3.0 (centroid-qualifier), so the
  // local is called 'specCenter' instead.
  else if(mode==37){float specCenter=(t+0.001)/(t+b+0.002);float freq=4.+specCenter*16.*wi;y=sin(r*freq-T*2.)*exp(-r*0.25)*(0.3+b*0.7)*a+sin(ang*4.)*0.06*t;}
  else{y=sin(r*10.*wi*(0.5+t))*(0.3+b*.7)*a;}
  return y;
}

// ── Where the music lands, decided by the MODE rather than by the radius ─────
// The CPU path builds this as a map, once per formula change, because it can
// sample the field on a lattice (src/band-map.js). A shader has no neighbours
// and no memory — but it does have the field itself, so it can ask for it eight
// more times and measure the texture directly.
//
// THE ONLY FRAME-TIME FIGURE THIS FILE EVER RECORDED DOES NOT DESCRIBE THIS
// CODE, and saying so is cheaper than leaving a number that reads as current.
// It used to stand here: "four extra computeMode calls cost 60 -> 59 fps on the
// plane and 55 -> 53 on sierpinski-tetra's 196 608 vertices", measured on this
// device's GPU (PowerVR through Vulkan). The stencil below takes EIGHT taps,
// not four, and "git log -S" puts the sentence and the eight taps in the same
// commit (80c3e75, #64) — so the figure was measured on a draft that never
// reached this branch, and no eight-tap frame time has been recorded since.
// Treat it as history, not as the current budget. What HAS been measured since
// is compile time, and that measurement is in bandCoordOfMode below.
//
// TWO THINGS ARE HELD FIXED, and both matter:
//   * the audio arguments are pinned at 0.5 rather than the live bass/treble.
//     computeMode READS them, so a live reading would let the sound choose
//     which band it is modulated by — the layout would breathe with the music
//     instead of belonging to the formula.
//   * the time is pinned at BAND_T. The layout is a property of the shape a
//     mode draws, not of the frame it is on; a live clock would make the bands
//     crawl across the surface while the music plays through them.
// ── HOW a band moves a point, not only how far ──────────────────────────────
// Until this, all 24 bands did one thing: push the vertex out along the field.
// Loudness changed, the gesture did not — so a fractal and a smooth bell
// answered the same music the same way, which is the second half of "no magic".
//
// The gesture now follows the same coordinate the layout does. u is 0 where the
// formula is broad and 1 where it is finely corrugated, so:
//
//   u ~ 0    BREATHE   the whole region rises and falls together, one slow mass
//   u ~ 0.5  RIPPLE    a travelling wave runs through it, phase set by u so
//                      neighbouring bands do not move in lockstep
//   u ~ 1    SHATTER   turbulence, signed and zero-mean: the surface boils in
//                      place instead of swelling
//
// The three are crossfaded, never switched, because a hard boundary between two
// gestures reads as a seam on the mesh — the same reason the band lookup
// interpolates rather than steps.
//
// Zero-mean matters for the last two: a ripple that only pushed outward would
// just be a lumpier breathe. Signed motion is what makes fine detail read as
// vibration rather than as swelling.
// TIME ENTERS ONLY AS A PHASE, and that is a cost decision as much as a visual
// one. Sliding the turbulence through space (turb(xz*k + T)) reads much the same
// on screen but forces the noise to be recomputed every frame; as a phase, the
// noise depends on position alone, so the CPU path can precompute it once per
// map and multiply. Measured there: 25.2 ms per frame on 196 608 vertices with
// the noise live, 4.6 ms with it cached — the difference between unusable and
// free. The shader recomputes it regardless (it is four harmonics and the GPU
// does not care), but both paths must evaluate the SAME expression.
float bandMotion(float amp, float u, vec2 xz, float T, float rr){
  float breathe = amp;
  float ripple  = amp * sin(rr * 9.0 - T * 3.0 + u * 12.0);
  float toShatter = smoothstep(0.60, 0.92, u);
  // The noise is evaluated only where it has any weight. Most of a body sits
  // below u = 0.6, and turb() is four harmonics — skipping it there took the
  // heaviest body in the catalogue from 40 fps back to 50. The branch is not
  // coherent across vertices, which normally makes a GPU branch worthless, but
  // four transcendental pairs are worth more than the divergence costs here.
  float shatter = 0.0;
  if (toShatter > 0.0) {
    // turb() runs roughly 0..1.8 with a mean near 0.9; centring it is what makes
    // this shake rather than inflate.
    shatter = amp * (turb(xz * 3.5) - 0.9) * 1.7 * sin(T * 2.0 + u * 10.0);
  }
  return mix(mix(breathe, ripple, smoothstep(0.25, 0.60, u)), shatter, toShatter);
}

float bandCoordOfMode(int mode, vec2 xz, float a, float wi){
  // 0.03 rather than 0.05. A centred difference answers a sinusoid with
  // sin(kE)/E, which NULLS at kE = n*pi: at E = 0.05 the first null sits at
  // k = 63, and several modes reach that inside the Wave Intensity range (mode
  // 35's fourth harmonic is k = 32*wi, so wi ~ 1.96 makes its finest detail
  // read as perfectly smooth — the character inverted). At 0.03 the first null
  // moves to k = 105, past what the catalogue reaches at the top of the slider.
  // It cannot be removed, only pushed out: that is the honest limit of a
  // two-point estimate, and it is why the coarse step is a RATIO partner rather
  // than an independent measurement. Found by an external review.
  const float E = 0.03;          // fine finite-difference step, world units
  const float C = 4.0;           // the coarse step is C times the fine one
  const float BAND_T = 7.0;      // the same reference instant the CPU map uses
  // Two slopes, at two scales, with the audio pinned at 0.5 and the clock held.
  //
  // BOTH DIFFERENCES ARE CENTRED, and that is not tidiness. For a local
  // A*sin(kx+phi) the centred difference is A*sin(kE)/E * cos(kx+phi) at the
  // fine step and A*sin(kCE)/(CE) * cos(kx+phi) at the coarse one, so the
  // cos(kx+phi) — amplitude AND phase — cancels in the ratio below and what
  // survives is a function of kE alone. A one-sided difference is centred half
  // a step away from the vertex, that cancellation stops holding, and the ratio
  // starts reading where the phase happened to land instead of how fine the
  // field is. Sharing one centre is the reason the stencil costs eight taps and
  // not five.
  //
  // EIGHT TAPS, ONE CALL SITE. The loop is not a stylistic choice: it is what
  // keeps the compiled program small. Each textual computeMode call site is a
  // separate inlined copy of a 38-branch ladder, and the number of live copies
  // is the only lever on compile time anyone has found here. Written out, the
  // eight taps times bandTermOfMode's two coordinates plus main()'s two direct
  // calls made 18 live copies; gathered here they make 4 (2 + 2). Measured on
  // the captured uber program through ANGLE into SwiftShader — the only backend
  // here that answers at all, this device's own driver reading 515/426/493 ms
  // for the three variants, which is noise — as time to a first drawn pixel,
  // where a deferred compiler does its work. Three runs each:
  //     18 copies, taps written out : 4131 / 5011 / 4157 ms
  //      4 copies, one tap repeated : 2141 / 1596 / 1991 ms
  //      4 copies, THIS loop        : 1528 / 1440 / 1848 ms
  // So the translator kept the loop rather than unrolling it back to 18. A
  // driver that unrolls it anyway costs compile time, not correctness — the
  // values are the same either way.
  //
  // FEWER COPIES IS CHEAPER, BUT NOT IN PROPORTION, and the two toolchains that
  // have been measured bend in OPPOSITE directions — so no cost per copy is
  // quoted here, because nothing measured supports one. In the table above 4.5x
  // the copies costs 2.2x–3.5x the time (means 4433 ms against 1605 ms, 2.8x),
  // which is SUBlinear: well short of the 4.5x proportionality would ask for.
  // On the Windows toolchain the complaint came from — three preview builds
  // opened in one session with data cleared each time — 18 copies took 28.7 s
  // to load, while 4 copies and 2 copies were both indistinguishable from
  // instant and were never timed. That is SUPERlinear and steeply so, where
  // proportionality would have predicted about 6.4 s at four copies. The
  // direction is known, the shape is not, and the knee between 4 and 18 copies
  // on the platform that actually hurts has NOT been measured. That is why the
  // budget in tests/band-coord-inline-budget.test.js sits on 4 — the largest
  // count measured to be fast there — rather than on a guess in between.
  vec2 dF = vec2(0.), dC = vec2(0.);
  for (int i = 0; i < 8; i++) {
    // 0..3 walk the x arm, 4..7 the z arm. Inside an arm the four taps are
    // fine +, fine -, coarse +, coarse - — exactly the fx1/fx0/cx1/cx0 that
    // used to be spelled out, in that order and at those points.
    int j     = (i < 4) ? i : i - 4;
    vec2 dir  = (i < 4) ? vec2(1., 0.) : vec2(0., 1.);
    float h   = (j < 2) ? E : C * E;
    float sgn = (j == 0 || j == 2) ? 1. : -1.;
    float v = computeMode(mode, xz + dir * (sgn * h), .5,.5,.5, 0., a, wi, BAND_T);
    // dF.x accumulates fx1 + (-fx0), which in IEEE is fx1 - fx0; the other arm
    // only ever adds a signed zero to the component it does not own, and
    // length() below cannot tell -0. from +0.
    if (j < 2) dF += dir * (sgn * v);
    else       dC += dir * (sgn * v);
  }
  float gFine   = length(dF) / (2.*E);
  float gCoarse = length(dC) / (2.*C*E);
  // The RATIO of the two, which is what makes this a frequency rather than a
  // height: amplitude cancels, so a mode spanning 0.2 units and one spanning 5
  // are compared on the same scale. A smooth field measures the same slope at
  // both steps and lands mid-scale; a finely corrugated one has far more slope
  // at the fine step and lands high; a field with structure only at the coarse
  // step lands low.
  //
  // Bounded BY CONSTRUCTION, and that is not decoration — the first version of
  // this function used lap/grad with hand-picked constants, and where the slope
  // vanished it ran away, put the whole surface on band 23 and drove the body
  // out of frame. Nothing here can divide by zero or exceed the clamp.
  float ratio = (gFine + 1e-4) / (gCoarse + 1e-4);
  return clamp(0.5 + 0.5 * log(ratio) / log(3.0), 0., 1.);
}

/**
 * The whole band term for the character path: coordinate, amplitude, gesture.
 *
 * One function so the coordinate is computed ONCE — it costs eight evaluations
 * of the ladder, gathered through one call site — and so the caller can put the
 * whole thing inside a branch. When this was written the layer shipped OFF, and
 * the first version evaluated the coordinate before the depth test, so every
 * user paid for eight extra formula evaluations per vertex to render a feature
 * they had not switched on. Found by an external review.
 *
 * TWO COSTS THAT ARE EASY TO READ AS ONE, and the branches below only pay the
 * first of them:
 *   * PER VERTEX, PER FRAME: eight evaluations of the ladder. The uBandDepth
 *     guard at the call site and the uModeBlend > 0. guard here are what keep
 *     this proportional to the feature being used — the slider at 0 costs
 *     nothing, and outside a mode fade the second coordinate is not evaluated.
 *     Dragging the layer off has to give the frame time back, or "off" is only
 *     off on screen.
 *   * ONCE, AT COMPILE TIME: one inlined copy of the 38-branch ladder per
 *     CALL SITE, whatever any runtime guard says. A guard cannot remove text
 *     from the program; only sharing a call site can. That is why the stencil
 *     in bandCoordOfMode is a loop, and why the two calls below cost two copies
 *     rather than sixteen. Read the measurement there before adding a third.
 *
 * The coordinate is blended across a mode crossfade, the same way the surface
 * is. Without it the layout stayed on the outgoing mode for the whole fade and
 * then snapped to the incoming one in a single frame; the second coordinate is
 * only computed while a fade is actually running, which is under a second.
 *
 * THE BODY'S SHIFT, and why it is a fifth argument rather than something read
 * off a uniform: it is per VERTEX. bodyK is aBodyK at the call site, measured on
 * the CPU because a vertex program cannot see its neighbours, and the shift is
 * bounded at BODY_SHIFT_BANDS of 24 — 4/23 of the coordinate — so the body
 * redistributes the layout without ever taking it over. src/band-map.js's
 * applyBodyShift is this same law on the CPU side, and the two are mirrored by
 * name so a change to one names the other.
 */
float bandTermOfMode(vec2 xz, float a, float wi, float T, float bodyK, out float uOut){
  float u = bandCoordOfMode(uMode, xz, a, wi);
  if (uModeBlend > 0.) u = mix(u, bandCoordOfMode(uModeNext, xz, a, wi), uModeBlend);
  u = clamp(u + (4.0 / 23.0) * bodyK, 0., 1.);
  // Handed back rather than recomputed by the caller: the coordinate costs
  // eight ladder evaluations, and the colour tint needs exactly the one the
  // displacement used. Two evaluations would be two layouts on one body.
  uOut = u;
  return bandMotion(bandAtU(u), u, xz, T, length(xz));
}

void main(){
  vec3 pos=position;
  // bt is pinned to 0 by decision, not by omission — every +bt*.5 term in
  // computeMode is meant to be inert. Driving displacement straight from uBeat
  // snaps the whole surface on each onset, i.e. the rapid flashing DISCLAIMER
  // warns photosensitive users about; muting it here is what keeps the default
  // scene inside that warning. Beat detection itself still runs: it feeds the
  // camera BPM and the beat-synced recorder, and uBeat stays declared above, so
  // a shader written in the editor can still respond to the beat — the choice
  // is per-shader instead of forced on everyone. Restoring bt=uBeat brings the
  // seizure risk back to the out-of-the-box visualisation.
  float b=clamp(uBass,0.,1.2),t=clamp(uTreble,0.,1.2),m=clamp(uMid,0.,1.),bt=0./*intentional, see note above*/;
  float a=uAmp,wi=uWI,T=uTime;
  // The band's own displacement at this vertex, before uMorphProgress. Declared
  // out here because both branches have it and the tail needs it; neither branch
  // computes anything extra to fill it. Nothing but the PTS block below reads
  // it, so on triangles this is a dead float the compiler removes.
  float bandHere=0.;
  // -1 is "no layer here", and it has to be distinguishable from band 0, which
  // is a real answer. Both branches overwrite it when there is one.
  float bandU=-1.;

  if(uMathMode==0){
    // GPU mode: compute both current and next, blend between them
    float y    = computeMode(uMode,    pos.xz, b, t, m, bt, a, wi, T);
    float yNxt = computeMode(uModeNext, pos.xz, b, t, m, bt, a, wi, T);
    // FIX(r10 §1.5): ADD the field to the shape's own y, do not replace it.
    // Assignment made pos.y a pure function of pos.xz, so every vertex sharing
    // an (x,z) column landed on one point and the shape stopped existing.
    // Measured on the catalogue AS IT STOOD BEFORE ROUND 10 — c629b53's own
    // setShape, which still turned disc and hex onto edge — with GPU mode 0 at
    // the boot uniforms in silence (uAmp .7, bass = mid = treble = 0, uWI 1,
    // T 0) and uMorphProgress 1: 23.74 % of the catalogue's triangles came out
    // with exactly zero area (cylinder 98.8 %, box 66.7 %, hex 33.1 % — 34.2 %
    // if a 1e-15 area epsilon counts the slivers as well as the points), and
    // the surviving area, as a fraction of the SAME SHAPE'S UNDISPLACED area,
    // fell to 9.8 % for hex, 21.1 % for disc, 33.4 % for cylinder.
    // Both halves of that sentence are needed to re-derive it: on THIS tree's
    // catalogue, where disc and hex lie flat, the same probe reads hex 84.7 %
    // and disc 97.8 %. Only cylinder is unchanged, never having been in the
    // rotate list.
    // Adding degenerates nothing on any of the twenty, on either catalogue,
    // and shrinks nothing: on this tree the area readings run from 100.0 % of
    // the undisplaced shape up to 126.2 % (the plane, which is all field).
    // The factored form keeps uMorphProgress honest: at progress 0 the whole
    // thing — shape and field together — is still flat, which is what the
    // deflate/swap/inflate in setShapeAnimated relies on (see the "the mesh is
    // invisible there" note in render.js). A bare "pos.y +=" would leave the
    // solid standing at the flat frame and turn every shape swap into a cut.
    // On the two shapes the old assignment was RIGHT for — plane and circle,
    // whose own y is exactly 0 (rotateX leaves a 2.1e-16 residue and setShape
    // writes it back to zero, see render.js) — this is bit-exact: 0 of 130415
    // float32 vertices differ across progress 0/.25/.5/.75/1. That total is
    // the desktop plane's 25921 vertices and circle's 162, five progress
    // values each: 129605 + 810. Mobile is 33215 the same way.
    // ── The spectrum, laid across the radius ─────────────────────────────────
    // Everything above answers to three scalars — uBass, uMid, uTreble — and
    // each is the same number at every vertex, so the body can only breathe in
    // and out as a whole. This adds what that arrangement cannot express: WHERE
    // in the spectrum a given point listens. Distance from the axis picks a
    // Bark band, so the middle answers to the kick and the rim to the cymbals,
    // and a chord becomes a standing pattern of rings instead of one swell.
    //
    // Added INTO the field rather than displacing the vertex separately, which
    // is what the first draft did. Three things follow from being part of the
    // field and none of them from being beside it: the depth cap that keeps a
    // surface from folding through itself applies to these rings too, the
    // colour ramp sees them (vH is the field), and the CPU path in
    // applyHeightField can do the identical thing to the identical quantity
    // rather than approximate it.
    //
    // The branch, not a multiply, is what makes "off" bit-exact: adding 0.0
    // would flip a -0.0 field to +0.0, and tests/colour-ramp.test.js compares
    // float32 words. Guarded, the catalogue is untouched until this is turned on.
    // The whole ADDITION is conditional, not just the band value. An external
    // review caught the first version claiming more than it did: it guarded the
    // lookup but still evaluated mix(...) + bandY unconditionally, and adding
    // +0.0 turns a -0.0 field into +0.0 — precisely the case the guard was
    // written for, left in place by it. With the ternary around the sum, depth 0
    // yields the identical expression this line carried before the band layer
    // existed, so "off is bit-exact" is true rather than nearly true.
    //
    // Still one expression rather than a conditional re-assignment of f:
    // tests/helpers/glsl.js resolves a local to its DEFINITION, and a local that
    // is defined once and then amended cannot be resolved at all — the guard
    // would stop being able to say what this program draws.
    float fBase = mix(y, yNxt, uModeBlend);
    // Everything the layer costs now sits INSIDE the depth test, so a scene with
    // the slider at zero pays nothing at all. With the layout by radius the
    // gesture stays the plain push it always was: the radius says nothing about
    // the formula, so there is nothing to give a gesture to.
    //
    // ── And it must STAY that way, which is less obvious ─────────────────────
    // "Low bands should always breathe and high ones always shatter, whatever
    // the layout" is a reasonable thing to want, and under the character map it
    // is already true — the gesture is chosen by the same coordinate that picks
    // the band, so they cannot disagree. The only place it is not true is here,
    // the radius rule, and giving the gesture to this arm would break a promise
    // the code makes elsewhere: presets older than format v4 are migrated to
    // bandCharacter = false precisely so they render what they were captured
    // under (src/ui/presets.js). Motion they never had is not what they were.
    float f = uBandDepth > 0.
      ? fBase + (uBandMode == 1 ? bandTermOfMode(pos.xz, a, wi, T, aBodyK, bandU)
                                : bandAtU(length(pos.xz) / max(uBandR, 1e-3))) * uBandDepth
      : fBase;
    // f minus the field it was built from IS the band term — the difference of
    // two locals, not a second evaluation, so the eight ladder evaluations stay
    // bought once and stay inside the depth guard. At uBandDepth 0 the ternary
    // above returns fBase itself and this is exactly 0.0, which is what keeps
    // "off" costing nothing here too.
    bandHere = f - fBase;
    // Under the radius rule bandTermOfMode never runs, so the coordinate it
    // would have handed back has to be taken here instead. One length() against
    // the eight ladder evaluations the other branch already paid for.
    if (uBandDepth > 0. && uBandMode != 1) bandU = length(pos.xz) / max(uBandR, 1e-3);
    pos.y = (pos.y + f) * uMorphProgress;
    // The field alone, scaled the same way — bit-for-bit what vH carried
    // before round 10, when the height WAS the field: c629b53 stored
    // mix(y,yNxt,uModeBlend)*uMorphProgress and copied that into vH. Verified
    // on all 20 shapes at progress 0/.25/.5/.75/1 in two uniform states, 0 of
    // 1471360 float32 words differing (tests/colour-ramp.test.js).
    vH = f * uMorphProgress;
  } else {
    // CPU math mode: pos.y already written by applyHeightField() (Surface) or
    // by the volume/collapse writers, which put base + displacement there.
    // Apply uMorphProgress so shape transitions still deflate/inflate.
    // vH is read off the attribute BEFORE that scaling, so the Surface form is
    // (base + field - base) * progress rather than a difference of two scaled
    // numbers. Both are only rounding apart, and this order is the better one
    // where it matters — but NOT "everywhere", which is what this comment used
    // to say. Measured on all twenty shapes at progress 0/.25/.5/.75/1 under
    // four Surface formulas (pseudosphere, landauLevels, hyperbolicParaboloid,
    // mandelbrot) at the factory sliders, error taken against the field in
    // double precision and divided by that shape's own peak |field|:
    //   catalogue worst   this order 5.9e-8   the other 8.2e-6  (~140x)
    //   tetrahedron       this order 0.0e+0   the other up to 4.3e-7
    //     (12 vertices, base y +-2.02 — the sparsest shape in the catalogue,
    //      and the one the old sentence singled out. Not its biggest base:
    //      torus reaches +-3.90 and sphere +-3.50.)
    // The exception, stated because it is real: on 3 of the 80 (formula, shape)
    // pairs the other order rounds marginally better — disc under pseudosphere
    // 3.5e-8 against 4.0e-8, disc under landauLevels 2.7e-8 against 4.7e-8,
    // hex under hyperbolicParaboloid 3.0e-8 against 3.6e-8. All three sit at
    // the 1e-8 floor both forms bottom out on, and all three are shapes whose
    // base barely leaves zero (disc +-0.04, hex +-0.25) — exactly where there
    // is nothing to subtract. Nowhere does the shipped order lose by an amount
    // that survives the ramp: 1e-8 in vH is 6e-9 in the palette parameter,
    // against 1/255 = 4e-3 per colour step.
    // (Measured over the twenty shapes x five uMorphProgress values x four
    // Surface formulas, both orders evaluated in float32 and compared against
    // the field in double, normalised by that shape's own peak |field|. The
    // control that must fire — dropping the subtraction entirely — reads 1.5e+2
    // on the same scale. The probe that produced this lived outside the
    // repository, which by this repo's own rule for numbers means the figures
    // above are conditions-and-magnitude, not a reproducible table: what is
    // pinned here is the ORDER of the two forms, by tests/colour-ramp.test.js,
    // not the individual exponents.)
    // FIX(r11): uVHField == 2 means the CPU path left the field in its own
    // attribute, because the displacement no longer lives in y alone — it
    // follows the surface normal, and pos.y - aBaseY would hand the ramp
    // n_y·h instead of h. 1 keeps the subtraction for the geometries that have
    // no aField (imported models), 0 is the shader path, unchanged.
    vH = (uVHField == 2) ? aField * uMorphProgress
       : (uVHField == 1) ? (pos.y - aBaseY) * uMorphProgress
       : pos.y * uMorphProgress;
    // The CPU writers baked the band into the position before this program ran,
    // so they hand the term over in its own attribute rather than leaving it to
    // be recovered. aBand is 0 on a geometry that never carried the layer.
    bandHere = aBand;
    bandU = aBandU;
    pos.y = pos.y * uMorphProgress;
  }

  // ── PTS: the band scatters its own cloud ────────────────────────────────────
  // In SURF and WIRE the layer can only push the sheet in and out, because the
  // sheet has to stay a sheet. Points are under no such obligation, and the mode
  // exists for exactly that: a loud band can throw its region off the surface and
  // swell the grains it is made of, so the body reads as a cloud that the music
  // stirs rather than as a surface with ripples on it.
  //
  // Two channels, and they are deliberately different in kind:
  //   * ALONG THE NORMAL, signed and per-vertex random. The randomness is what
  //     makes it a cloud instead of a thicker sheet — a uniform push along the
  //     normal is just the displacement the surface already has. Frozen to the
  //     vertex's ORIGINAL position, so the grain does not crawl while the body
  //     moves under it.
  //   * IN SIZE, unsigned. A grain that shrank on the negative half of a ripple
  //     would blink at the ripple's own rate; abs() makes both halves of the
  //     gesture read as energy, which is what a size cue means.
  //
  // uPtBand is 0 everywhere except the points proxy, so both terms vanish for
  // triangles, for imported models, and for the mesh the proxy is standing in
  // for. bandHere is 0 whenever uBandDepth is, so dragging Spectrum Rings to
  // zero returns PTS to the plain cloud it has always drawn — the point-size
  // expression collapses to uPointSize exactly, not approximately.
  vBandU = bandU;
  float ptB = uPtBand * bandHere * uMorphProgress;
  // Inside the branch, not multiplied to nothing, and for two separate reasons
  // an external review named together:
  //   * COST. ptSpray is a sin and a fract, and outside PTS — which is most of
  //     the time — it was being paid by every vertex to be multiplied by zero.
  //     That is the same shape as the defect fc0c32c fixed one level up, where
  //     the band coordinate was computed before the depth test.
  //   * BITS. Adding 0.0 to pos is not a no-op: it turns a -0.0 component
  //     into +0.0.
  //     The contract in this file is that the layer OFF leaves the picture
  //     bit-identical, and an unconditional addition breaks it for every vertex
  //     of every mode, not only in PTS.
  // ptB is exactly 0 whenever uPtBand or uBandDepth is, so this is off in SURF,
  // in WIRE, under an imported model, and at depth zero.
  if (ptB != 0.) pos += normal * (ptSpray(position) * ptB * 0.8);
  gl_PointSize = uPointSize * (1. + 1.5 * abs(ptB));
  // Compute world-space position AFTER all displacement so derived normals are correct
  vec4 _wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = _wp.xyz;
  vViewDir  = cameraPosition - _wp.xyz;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);
}`;

// ── Fragment shader — 54 color schemes (0-53) ─────────────────────────────────
// FIX(#28): every count in this file is 54 (0..53) — COLOR_SCHEME_COUNT in
// params.js is authoritative; the prose lagged behind the DARK series (36..43)
// once already, which is why tests/palette-catalogue.test.js now checks the
// enumerations against each other instead of trusting a note like this one.
//
// Transition uniform added:
//   uCMNext  — color scheme to blend toward
//   uCMBlend — 0=current only, 1=next only (crossfade, 0.6 s)
//
// All 54 scheme functions are defined once in _COLOR_FUNS below and injected
// into both export const FS and SE_FS_TEMPLATE via template interpolation.
// _COLOR_FUNS also contains the getColor() dispatcher, so user-written
// fragment shaders in the editor can call getColor(uCM, t) and get every
// palette without copy-pasting a 54-way if-cascade.
//
// Layout:
//   CINEMATIC  0  tealOrange   1  bladeRunner   2  matrix      3  bleachBypass
//   SYNTHWAVE  4  outrun       5  vaporwave      6  neonNoir    7  sunsetGrid
//   SCIENTIFIC 8  viridis      9  inferno       10  plasma     11  cividis
//   PREMIUM   12  aurora      13  lava          14  deepOcean  15  electricViolet
//   MONOCHROME 16 amber       17  emerald       18  sapphire   19  obsidian
//   TRENDING  20  transformativeTeal  21 electricFuchsia  22 bioGraphing  23 greenGlow
//   NEW       24  cyberpunkGold  25 arcticFire  26 bloodMoon  27 cosmicDust
//             28  toxicWaste  29 cherryBlossom  30 midnightChrome 31 solarFlare
//             32  deepSpace   33 acidRain       34 volcanic    35 bioluminescence
//   DARK      36  charcoalSmoke  37 slateIndigo  38 mossStone  39 petrol
//             40  emberBlack  41 burgundyVelvet 42 midnightForest 43 coalPlum
//   NIGHT     44  burgundyBlack  45 crimsonAbyss 46 tarnishedGold 47 fathomBlue
//             48  cedarSmoke  49 fernShadow     50 orchidAsh      51 driedRose
//             52  deepJade    53 rustSlate

// ── _COLOR_FUNS — single source of truth for all 54 GLSL color functions ─────
// Used in both export const FS and SE_FS_TEMPLATE. Edit here only.
//
// IMPORTANT: adding a palette means SIX places, not three. This list said three
// for a long time, and the three it left out are exactly the ones that fail in
// silence — see tests/palette-catalogue.test.js, which now checks all six
// against each other and against COLOR_SCHEME_COUNT.
//   1. Add the vec3 function below.
//   2. Add an `else if(cm==N)` branch in getColor() below.
//   3. Bump COLOR_SCHEME_COUNT in params.js (which feeds MIDI range, the
//      shuffle bag in main.js, and the E-key cycle modulus).
//   4. Add an <option value="N"> under #color-sel in index.html. Miss it and
//      the dropdown blanks out at that index — the defect params-wrap.test.js
//      was written for.
//   5. Add the name to the Layout comment in the FS header above.
//   6. Add it to the name list above SE_DEFAULT_FRAG, or the palette reads as
//      unsupported to shader-editor users (FIX(#28)).
//
// FIX(#28, r3): the range below read 0..23, left over from the 24-palette era.
// getColor() is included in this block — not duplicated into FS — so user
// fragments in the shader editor can call it too. Without it, SE_FS_TEMPLATE
// users copy-pasted the if-cascade or got undefined-`c` artefacts for any uCM
// their copy skipped; the dispatcher covers the whole 0..53 range.
const _COLOR_FUNS = `
vec3 tealOrange(float t){return mix(vec3(0.,0.706,0.847),vec3(1.,0.620,0.),t);}
vec3 bladeRunner(float t){vec3 a=vec3(.051,.008,.129),b=vec3(1.,.420,.208),c=vec3(0.,.898,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 matrix(float t){return mix(vec3(0.,.231,0.),vec3(0.,1.,.255),t);}
vec3 bleachBypass(float t){return mix(vec3(.173,.173,.173),vec3(.831,.788,.690),t);}
vec3 outrun(float t){vec3 a=vec3(.169,.059,.298),b=vec3(1.,0.,.498),c=vec3(0.,.941,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 vaporwave(float t){vec3 a=vec3(1.,.443,.808),b=vec3(.004,.804,.996),c=vec3(.725,.404,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 neonNoir(float t){vec3 a=vec3(.039,.039,.039),b=vec3(1.,0.,.235),c=vec3(0.,1.,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 sunsetGrid(float t){vec3 a=vec3(.102,.020,.188),b=vec3(1.,.165,.478),c=vec3(1.,.800,0.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 viridis(float t){vec3 a=vec3(.267,.004,.329),b=vec3(.129,.569,.549),c=vec3(.992,.906,.145);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 inferno(float t){vec3 a=vec3(0.,0.,.016),b=vec3(.733,.216,.329),c=vec3(.988,1.,.643);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 plasma(float t){vec3 a=vec3(.051,.031,.529),b=vec3(.800,.278,.471),c=vec3(.941,.976,.129);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 cividis(float t){vec3 a=vec3(0.,.125,.298),b=vec3(.486,.482,.471),c=vec3(1.,.933,.675);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 aurora(float t){vec3 a=vec3(.043,.239,.239),b=vec3(.176,.478,.431),c=vec3(.561,.851,.698),d=vec3(1.,.800,.835);float s=t*3.;return s<1.?mix(a,b,s):s<2.?mix(b,c,s-1.):mix(c,d,s-2.);}
vec3 lava(float t){vec3 a=vec3(.102,0.,0.),b=vec3(1.,.200,0.),c=vec3(1.,.667,0.),d=vec3(1.,1.,.400);float s=t*3.;return s<1.?mix(a,b,s):s<2.?mix(b,c,s-1.):mix(c,d,s-2.);}
vec3 deepOcean(float t){vec3 a=vec3(.008,0.,.141),b=vec3(.035,.035,.475),c=vec3(0.,.831,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 electricViolet(float t){vec3 a=vec3(.451,.012,.753),b=vec3(.925,.220,.737),c=vec3(.992,.937,.976);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 amber(float t){vec3 a=vec3(.102,.039,0.),b=vec3(.400,.200,0.),c=vec3(1.,.702,.400);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 emerald(float t){vec3 a=vec3(0.,.102,.051),b=vec3(0.,.400,.200),c=vec3(.400,1.,.702);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 sapphire(float t){vec3 a=vec3(0.,.051,.102),b=vec3(0.,.200,.400),c=vec3(.400,.702,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 obsidian(float t){vec3 a=vec3(.039,.039,.039),b=vec3(.200,.200,.200),c=vec3(.600,.600,.600);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 transformativeTeal(float t){vec3 a=vec3(0.,.502,.541),b=vec3(0.,.831,1.),c=vec3(.600,.902,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 electricFuchsia(float t){vec3 a=vec3(.102,0.,.200),b=vec3(1.,0.,1.),c=vec3(1.,.600,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 bioGraphing(float t){vec3 a=vec3(.706,.863,.902),b=vec3(.549,.784,.843),c=vec3(.314,.627,.706);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 greenGlow(float t){vec3 a=vec3(.078,.157,0.),b=vec3(.400,1.,0.),c=vec3(.800,1.,.400);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 cyberpunkGold(float t){vec3 a=vec3(.129,.0,.275),b=vec3(.827,.416,.0),c=vec3(1.,.973,.208);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 arcticFire(float t){vec3 a=vec3(0.,.059,.275),b=vec3(.004,.643,.996),c=vec3(1.,.588,.016);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 bloodMoon(float t){vec3 a=vec3(.051,0.,0.),b=vec3(.698,.031,.031),c=vec3(1.,.349,.0);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 cosmicDust(float t){vec3 a=vec3(.012,.020,.098),b=vec3(.278,.192,.698),c=vec3(.831,.765,1.);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 toxicWaste(float t){vec3 a=vec3(.012,.051,.0),b=vec3(.216,.894,.075),c=vec3(.906,1.,.106);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 cherryBlossom(float t){vec3 a=vec3(.400,.047,.157),b=vec3(.996,.376,.565),c=vec3(1.,.906,.925);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 midnightChrome(float t){vec3 a=vec3(.008,.012,.020),b=vec3(.216,.322,.486),c=vec3(.851,.906,.953);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 solarFlare(float t){vec3 a=vec3(.039,0.,0.),b=vec3(.890,.267,.0),c=vec3(1.,.933,.400);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 deepSpace(float t){vec3 a=vec3(.008,.004,.031),b=vec3(.314,.071,.698),c=vec3(1.,.251,.671);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 acidRain(float t){vec3 a=vec3(.016,.059,.016),b=vec3(.118,1.,.161),c=vec3(.800,1.,.976);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 volcanic(float t){vec3 a=vec3(.027,.016,.016),b=vec3(.671,.098,.016),c=vec3(1.,.867,.251),d=vec3(1.,1.,.900);float s=t*3.;return s<1.?mix(a,b,s):s<2.?mix(b,c,s-1.):mix(c,d,s-2.);}
vec3 bioluminescence(float t){vec3 a=vec3(.004,.027,.082),b=vec3(.0,.557,.698),c=vec3(.467,1.,.933);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}

// ── DARK series (36..43) ──────────────────────────────────────────────
// Eight palettes that stay in shadow values throughout t∈[0..1] —
// unlike the existing palettes, none of these terminate in a saturated
// or bright peak. Useful for atmospheric / moody sets, projectors that
// blow highlights, and laptop-screen previewing where neon palettes
// look raw. Max channel value in any endpoint ≤ 0.55 for the truly-
// dark four (36..39); ≤ 0.75 for the with-glow four (40..43), where
// the glow is intentionally smoldering rather than bright.
vec3 charcoalSmoke(float t){vec3 a=vec3(.063,.067,.078),b=vec3(.235,.243,.259),c=vec3(.471,.475,.486);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 slateIndigo(float t){vec3 a=vec3(.031,.039,.075),b=vec3(.157,.184,.314),c=vec3(.337,.341,.529);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 mossStone(float t){vec3 a=vec3(.075,.078,.063),b=vec3(.227,.243,.196),c=vec3(.412,.439,.349);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 petrol(float t){vec3 a=vec3(.020,.067,.082),b=vec3(.063,.231,.286),c=vec3(.231,.412,.471);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 emberBlack(float t){vec3 a=vec3(.027,.012,.008),b=vec3(.243,.094,.039),c=vec3(.624,.227,.075);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 burgundyVelvet(float t){vec3 a=vec3(.039,.012,.020),b=vec3(.243,.055,.106),c=vec3(.561,.122,.220);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 midnightForest(float t){vec3 a=vec3(.008,.027,.020),b=vec3(.043,.165,.106),c=vec3(.157,.435,.302);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 coalPlum(float t){vec3 a=vec3(.020,.012,.031),b=vec3(.137,.078,.180),c=vec3(.341,.235,.443);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}

// ── NIGHT series (44..53) ─────────────────────────────────────────────
// Built for one job the DARK series above does not do: staying dark on a
// dark screen while bloom is still reachable. The two are different
// contracts and the numbers say so — measured, not asserted:
//
//   Y = .2126R + .7152G + .0722B is not a nicety here. It is literally
//   what gates bloom: LuminosityHighPassShader calls luminance(), three
//   fills in the working-space coefficients, and the pass is built with
//   threshold 0.15 (render.js). So a palette's Y and the bloom gate are
//   directly comparable numbers.
//
//   FIX(night): comparable where getColor()'s return value IS the pixel,
//   which is WIRE and PTS with a Matte finish — the shipped startup state.
//   It is not the whole story in SURF, nor with any non-Matte material.
//   uLighting=1 puts color*(0.30 + diff*0.85) + color*rim + vec3(spec)*uGlare
//   between the palette and gl_FragColor, i.e. a gain and an ADDITIVE
//   white term; the reflection block runs in every viz mode and mixes in
//   studioEnv on top. Since 01.09 both additive terms are scaled by uGlare
//   (0.65, and 0.45 in NIGHT), so what the high-pass sees above the palette
//   is smaller than it was — but it is still above it, which is why the
//   paragraph below still says what it says. Both raise what the high-pass sees above the number
//   below. The contract still holds as written — it is a contract on the
//   palette, and it is what keeps the palette itself out of the glow — but
//   "nothing here blooms at rest" is a claim about the palette, not a
//   promise about every lit frame.
//
//   NIGHT contract, every stop and therefore the whole ramp (Y is affine
//   in the components and max_channel is a max of affine functions, so
//   both take their extremes at the stops):
//     max_channel ≤ 0.55, Y ≤ 0.28, Y(b) ≤ 0.14, Y at the top ≥ 0.17.
//
//   The floor is the point. Without it the first two drafts of 44 and 45
//   topped out at Y 0.100 and 0.148 — under the gate, so the Bloom slider
//   and the S punch were a no-op on them: the high-pass gates before the
//   strength multiply, and what never passes cannot be amplified.
//   With it: nothing here blooms at rest (field is ±0.14 in silence, and
//   the ramp only reaches the top on loud peaks), everything blooms on
//   peaks. That is the whole design — dark body, lit crest.
//
// Guarded by tests/palette-catalogue.test.js for enumeration only. The
// contract above is arithmetic on these literals; the four historical
// violations that motivated it are recorded there as reinjection cases.
//
// CORRECTION to the DARK comment above, which is wrong and stays wrong
// until someone re-tiers it deliberately: its two tiers are ordered by
// forced channel, not by darkness, and by darkness they invert.
// charcoalSmoke (36), labelled truly-dark, is the BRIGHTEST of the eight
// (Y peaks 0.461); burgundyVelvet (41) and coalPlum (43), labelled
// with-glow, are the two darkest (0.215, 0.262). Five of the eight clear
// the bloom gate in silence, so as a group DARK is not dark in the sense
// this series is. Numbers, not adjectives: notes/26-dark-palettes-v2.
vec3 burgundyBlack(float t){vec3 a=vec3(.016,.004,.008),b=vec3(.153,.027,.059),c=vec3(.529,.086,.169);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 crimsonAbyss(float t){vec3 a=vec3(.016,.031,.110),b=vec3(.129,.043,.118),c=vec3(.490,.102,.086);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 tarnishedGold(float t){vec3 a=vec3(.024,.016,.008),b=vec3(.122,.094,.031),c=vec3(.325,.267,.067);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 fathomBlue(float t){vec3 a=vec3(.008,.016,.055),b=vec3(.031,.086,.220),c=vec3(.110,.224,.392);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 cedarSmoke(float t){vec3 a=vec3(.039,.027,.020),b=vec3(.161,.110,.067),c=vec3(.325,.235,.157);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 fernShadow(float t){vec3 a=vec3(.008,.031,.012),b=vec3(.043,.122,.043),c=vec3(.106,.318,.098);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 orchidAsh(float t){vec3 a=vec3(.020,.008,.024),b=vec3(.129,.035,.122),c=vec3(.404,.102,.376);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 driedRose(float t){vec3 a=vec3(.043,.020,.027),b=vec3(.176,.086,.118),c=vec3(.392,.180,.259);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 deepJade(float t){vec3 a=vec3(.008,.031,.031),b=vec3(.024,.098,.098),c=vec3(.063,.271,.267);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}
vec3 rustSlate(float t){vec3 a=vec3(.024,.035,.063),b=vec3(.129,.075,.086),c=vec3(.400,.180,.075);return t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);}

// ── getColor — dispatcher so both main() and user-written fragments can call ─
// one entry point and get every palette. Out-of-range cm safely falls through
// to bioluminescence (35) — so picking a scheme that doesn't exist (e.g. from
// a preset saved in a future build) renders a working colour rather than
// undefined-variable garbage on the GPU.
vec3 getColor(int cm, float t){
  if     (cm== 0) return tealOrange(t);
  else if(cm== 1) return bladeRunner(t);
  else if(cm== 2) return matrix(t);
  else if(cm== 3) return bleachBypass(t);
  else if(cm== 4) return outrun(t);
  else if(cm== 5) return vaporwave(t);
  else if(cm== 6) return neonNoir(t);
  else if(cm== 7) return sunsetGrid(t);
  else if(cm== 8) return viridis(t);
  else if(cm== 9) return inferno(t);
  else if(cm==10) return plasma(t);
  else if(cm==11) return cividis(t);
  else if(cm==12) return aurora(t);
  else if(cm==13) return lava(t);
  else if(cm==14) return deepOcean(t);
  else if(cm==15) return electricViolet(t);
  else if(cm==16) return amber(t);
  else if(cm==17) return emerald(t);
  else if(cm==18) return sapphire(t);
  else if(cm==19) return obsidian(t);
  else if(cm==20) return transformativeTeal(t);
  else if(cm==21) return electricFuchsia(t);
  else if(cm==22) return bioGraphing(t);
  else if(cm==23) return greenGlow(t);
  else if(cm==24) return cyberpunkGold(t);
  else if(cm==25) return arcticFire(t);
  else if(cm==26) return bloodMoon(t);
  else if(cm==27) return cosmicDust(t);
  else if(cm==28) return toxicWaste(t);
  else if(cm==29) return cherryBlossom(t);
  else if(cm==30) return midnightChrome(t);
  else if(cm==31) return solarFlare(t);
  else if(cm==32) return deepSpace(t);
  else if(cm==33) return acidRain(t);
  else if(cm==34) return volcanic(t);
  else if(cm==35) return bioluminescence(t);
  // DARK series — moody / atmospheric, no bright peaks
  else if(cm==36) return charcoalSmoke(t);
  else if(cm==37) return slateIndigo(t);
  else if(cm==38) return mossStone(t);
  else if(cm==39) return petrol(t);
  else if(cm==40) return emberBlack(t);
  else if(cm==41) return burgundyVelvet(t);
  else if(cm==42) return midnightForest(t);
  else if(cm==43) return coalPlum(t);
  // NIGHT series — dark body, lit crest; see the block above getColor's table
  else if(cm==44) return burgundyBlack(t);
  else if(cm==45) return crimsonAbyss(t);
  else if(cm==46) return tarnishedGold(t);
  else if(cm==47) return fathomBlue(t);
  else if(cm==48) return cedarSmoke(t);
  else if(cm==49) return fernShadow(t);
  else if(cm==50) return orchidAsh(t);
  else if(cm==51) return driedRose(t);
  else if(cm==52) return deepJade(t);
  else if(cm==53) return rustSlate(t);
  else            return bioluminescence(t);  // safe default for out-of-range
}
`;

// ── Shared surface-material GLSL ───────────────────────────────────────────
// Extracted so both the main FS and the shader-editor FS template (SE_FS_
// TEMPLATE) include identical material code without copy-paste drift.
//
// _MATERIAL_UNIFORMS — uniform declarations for the reflection path.
// _STUDIO_ENV        — the procedural studio environment function.
// _MATERIAL_BLOCK    — the reflection composite. Expects locals `color`
//                      (vec3, in/out), `vWorldPos`, `vViewDir` to be in
//                      scope. Gated by uMaterial>0 so Matte costs nothing.
const _MATERIAL_UNIFORMS = `
uniform int   uMaterial;
uniform float uMetalness, uRoughness, uReflect, uFresnelP;
// How much of the white the surface throws back: 1.0 is what shipped before
// 01.09, and NIGHT asks for less than the normal palettes do. Declared here
// rather than beside the lighting uniforms because studioEnv reads it too, and
// the two blocks are included independently by the editor template. See the
// note on studioEnv for what it multiplies and, more to the point, what it
// deliberately does not.
uniform float uGlare;`;

// ── Particle shaping (PTS mode) ───────────────────────────────────────────────
// A point primitive is a screen-aligned square, which is why the POINTS mode
// used to offer exactly one look: big squares. gl_PointCoord gives the position
// inside that square, so a mask over it turns the same primitive into a round
// dot or a soft puff at no extra draw cost.
//
// Gated on uPtStyle > 0, and setParticleStyle() only ever raises it while the
// POINTS proxy is the thing drawing. That gate is not cosmetic: gl_PointCoord
// is undefined for triangle primitives, so the mesh and wireframe paths must
// not reach this code at all.
//
// Shared by FS and SE_FS_TEMPLATE — a custom shader from the editor gets the
// particle styles too, for the same reason the material block is shared: one
// owner, no drift between the built-in look and the user's.
const _POINT_UNIFORMS = `
uniform int uPtStyle;
// Coverage multiplier for the additive style, 1.0 everywhere else. It stands in
// for copies the cloud used to draw and no longer does: the proxy borrowed the
// mesh's triangle INDEX, so each vertex was submitted about six times at the
// same pixel, and under additive blending those six summed into the brightness
// smoke shipped with. See RenderEngine.PTS_GLOW_GAIN for the measurement.
//
// It is allowed to push the fragment's alpha above 1, and that is the whole
// reason one draw can stand in for six: additive blending weights by src.a, so
// six draws at a and one draw at 6a are the same sum. GLSL ES 1.00 would have
// clamped the output to [0,1] and made this a cap rather than a sum — but a
// ShaderMaterial in three r169 is compiled as "#version 300 es" with
// "layout(location = 0) out highp vec4 pc_fragColor" (verified on the running
// app: all 22 programs), and an ES 3.00 output into the composer's HalfFloat
// target is not clamped. Change either of those two facts and the gain silently
// becomes a ceiling.
uniform float uPtGain;`;

const _POINT_MASK = `
  float _pAlpha = 1.0;
  if (uPtStyle > 0) {
    // 0 at the centre of the sprite, 1 at the edge of its inscribed circle.
    float _pd = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (_pd > 1.0) discard;                 // square corners → round particle
    _pAlpha = uPtStyle == 2
      // Smoke: no hard edge at all. The core is bright and the falloff carries
      // most of the sprite, so the afterimage trail behind it reads as a wake
      // of ever-fainter particles rather than as a streak.
      ? pow(1.0 - _pd, 2.2)
      // Dot: solid core, antialiased rim.
      : smoothstep(1.0, 0.55, _pd);
    // Additive blending weights the colour by this, so multiplying here is the
    // same arithmetic the duplicate draws used to do — one draw carrying the
    // sum instead of N draws accumulating it. Left at 1.0 for the blended
    // styles, where a duplicate never showed and a gain would be a change.
    _pAlpha *= uPtGain;
  }`;

const _STUDIO_ENV = `
// Procedural studio environment — dark floor, brighter ceiling, three
// soft-box highlights. Sampled by reflect(-V,N); no cubemap texture needed
// (keeps the single-file bundle asset-free).
//
// ── uGlare, and why it multiplies the LAMPS and not the whole environment ───
// The complaint (01.09) is that the white cuts the eyes, in NIGHT most of all.
// Measured on the shipped tree — plane, Eigenvector Field, the slider values
// from the report, six frames per configuration, median:
//
//                    p99 luma   share > 0.7   mean of lit pixels
//   normal  mirror     0.467       0.006 %          0.170
//   normal  matte      0.828       3.586 %          0.316
//   NIGHT   mirror     0.409       0.000 %          0.233
//   NIGHT   matte      0.218       0.012 %          0.139
//
// Two different things, and the numbers separate them. In the normal palettes
// MATTE is the bright one — it has no reflection path at all, so what burns
// there is thewhite specular in the lighting block, which every material gets. In
// NIGHT the mirror is 1.67x the matte mean, on a mode whose whole promise is a
// dark picture: the palettes are built to a contract (max channel 0.55, Y 0.28
// at every stop) and the reflection is added AFTER the palette, so it walks
// straight through that guarantee.
//
// So the dimming is applied to the LAMPS — the three soft-boxes here, the
// specular in the lighting block, and the material's own highlight — and not
// to the environment gradient or to reflMix. Dimming the whole reflection would
// take a mirror's reflectivity away with the glare; dimming the sources leaves
// the surface as reflective as it was and makes what it reflects less blinding.
// The gradient (floor/mid/ceiling) is already below 0.4 and is what makes chrome
// read as chrome.
vec3 studioEnv(vec3 dir){
  vec3 d = normalize(dir);
  float y = d.y;
  vec3 floorC = vec3(0.02, 0.02, 0.03);
  vec3 midC   = vec3(0.10, 0.11, 0.14);
  vec3 ceilC  = vec3(0.30, 0.32, 0.38);
  vec3 base = y < 0.0 ? mix(midC, floorC, -y)
                      : mix(midC, ceilC,  y);
  float sb1 = smoothstep(0.55, 0.95, dot(d, normalize(vec3( 0.4, 0.8,  0.3))));
  float sb2 = smoothstep(0.70, 0.98, dot(d, normalize(vec3(-0.5, 0.7, -0.2))));
  float sb3 = smoothstep(0.80, 0.99, dot(d, normalize(vec3( 0.1, 0.6, -0.8))));
  base += vec3(1.0, 0.98, 0.92) * sb1 * 1.4 * uGlare;
  base += vec3(0.85, 0.9, 1.0)  * sb2 * 1.0 * uGlare;
  base += vec3(1.0, 0.95, 0.88) * sb3 * 0.7 * uGlare;
  return base;
}`;

// Reflection composite. Modifies `color` in place. Reconstructs its own
// normal from screen-space derivatives so it works regardless of how the
// vertex was displaced (GPU mode, CPU formula, volume, or user shader).
const _MATERIAL_BLOCK = `
  if (uMaterial > 0) {
    vec3 Nm = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    vec3 Vm = normalize(vViewDir);
    if (dot(Nm, Vm) < 0.0) Nm = -Nm;
    vec3 Rm  = reflect(-Vm, Nm);
    vec3 env = studioEnv(Rm);
    env = mix(env, env * 0.4 + vec3(0.04), uRoughness * 0.7);
    float fresM = pow(1.0 - max(dot(Nm, Vm), 0.0), uFresnelP);
    vec3 metalTint  = mix(vec3(1.0), color, uMetalness);
    vec3 reflection = env * metalTint;
    float reflMix = clamp(uReflect * (uMetalness * 0.6 + fresM * 0.7 + 0.15), 0.0, 1.0);
    color = mix(color, reflection, reflMix);
    float specM = pow(max(dot(Nm, Vm), 0.0), mix(8.0, 180.0, 1.0 - uRoughness));
    // The material's own highlight is a lamp too — white, additive, and at
    // mirror roughness it is a 180-power point. Dimmed with the rest of them;
    // reflMix above is left alone, so the finish keeps its reflectivity.
    color += vec3(specM) * (1.0 - uRoughness) * uReflect * 0.3 * uGlare;
  }`;

export const FS = `
uniform int   uCM, uCMNext;
uniform float uCMBlend;
// SURF lighting (gated by uLighting): time + audio bands drive light direction
// and audio-reactive specular / rim. Skipped entirely in wireframe and points
// modes by setting uLighting=0 in setVizModeGPU().
//
// NOTE: dFdx/dFdy in main() need no #extension directive and no 'extensions'
// flag on the ShaderMaterial. three r169 is WebGL2-only, so the shader always
// compiles as GLSL ES 3.00 where the derivatives are core built-ins — and the
// directive would be illegal there anyway (it must precede any non-preprocessor
// token, while three.js prepends its own preamble to user source).
// Don't add back 'extensions: { derivatives: true }' either — r169 honours only
// clipCullDistance and multiDraw, and silently drops anything else.
uniform int   uLighting;
uniform float uTime, uBass, uTreble;
// ── Surface material (PBR-style env reflections) ─────────────────────────
// uMaterial: 0 = Matte (reflections off, original look). >0 enables the
// reflection path. Shared with SE_FS_TEMPLATE via _MATERIAL_UNIFORMS.
${_MATERIAL_UNIFORMS}
// ── Particle style (PTS mode) ────────────────────────────────────────────
// 0 = square sprite (the original), 1 = round dot, 2 = soft smoke puff.
// Shared with SE_FS_TEMPLATE via _POINT_UNIFORMS.
${_POINT_UNIFORMS}
varying float vH;
varying float vBandU;
varying vec3  vWorldPos;
varying vec3  vViewDir;

${_COLOR_FUNS}
${_STUDIO_ENV}

// ── Main ─────────────────────────────────────────────────────────────────────
void main(){
  float t = clamp((vH+.8)*.6,.03,.97);
  // ── The spectrum as a colour map ──────────────────────────────────────────
  // Until this, the bands reached the palette only through vH: they moved the
  // surface, the surface is the ramp's parameter, so a loud band changed the
  // COLOUR of its zone but said nothing about WHICH band it was. Two zones
  // listening to a kick and to a hi-hat, equally loud, were the same colour.
  //
  // vBandU is that identity, and shifting t by it makes the layout readable as
  // a colour map: the low end sits at one place on the ramp, the top at
  // another, and the picture says where in the spectrum you are looking.
  //
  // ── Why this is a STATIC offset, and not driven by loudness ──────────────
  // Because the loudness version is the flicker this app damps everywhere else.
  // A band's level can move 0.24 of its range in one 60 Hz frame (BAND_TAU is
  // 60 ms), the layer reaches the ramp, and coherent brightness modulation at
  // hi-hat rate is the same class of risk that keeps uBeat pinned to 0 in the
  // vertex program and the starfield fade damped. vBandU does not move with the
  // MUSIC at all: the character map is frozen at a reference time and the GPU
  // coordinate is computed with the audio pinned at 0.5, so nothing the track
  // does changes this term.
  //
  // It is not literally constant, and the earlier version of this note said it
  // was. During a GPU mode crossfade bandTermOfMode blends the two modes'
  // coordinates and hands the blended one back, so the tint travels across the
  // palette while the fade runs. That is a one-way transition of under a
  // second, not a periodic modulation, and it is the same movement the surface
  // itself is making — but "adds no temporal modulation whatsoever" was false
  // and an external review said so. What is true, and is what the
  // photosensitivity argument needs, is that nothing here is driven by an
  // ONSET or by a band level.
  //
  // Bounded and re-clamped into the SAME [.03, .97] window, so every pixel is
  // still a colour the chosen palette declares. That is what keeps the NIGHT
  // contract (max channel 0.55, Y 0.28 at every stop) true without restating
  // it: nothing here can leave the ramp, only move along it.
  //
  // -1 is the "no layer" value written by the vertex program, and the step()
  // is what keeps depth 0 bit-identical rather than nearly so.
  t = clamp(t + step(0., vBandU) * .30 * (vBandU - .5), .03, .97);
  vec3 c    = getColor(uCM,    t);
  vec3 cNxt = getColor(uCMNext, t);
  // uCMBlend 0→1 crossfades between the two color schemes
  vec3 color = mix(c, cNxt, uCMBlend);

  if (uLighting == 1) {
    // Reconstruct geometric normal from screen-space derivatives of the
    // post-displacement world position. Works equally well for the 38 GPU
    // formulas (computed in VS) and the CPU heightfields (already baked into
    // position.y before VS runs). Per-pixel, so it's smoother than per-vertex
    // normals on dense grids and crisply faceted on sparse ones — both fit
    // the VJ aesthetic.
    vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    vec3 V = normalize(vViewDir);

    // Slowly orbiting "sun" — period ~18s at speed 0.35.
    // Held above the horizon (y=0.75) so the surface is mostly lit, not mostly black.
    float ls = 0.35;
    vec3  L  = normalize(vec3(sin(uTime * ls), 0.75, cos(uTime * ls)));

    // Half-Lambert wrap diffuse — softer falloff than raw Lambert, no harsh
    // self-shadow line. Standard for stylised rendering.
    float NdotL = dot(N, L);
    float diff  = NdotL * 0.5 + 0.5;

    // Blinn-Phong specular. Treble drives the punch — fast transients = sharp glints.
    vec3  H    = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 28.0) * (0.35 + uTreble * 0.65);

    // Fresnel rim glow. Strong at grazing angles; tinted in the surface's own
    // colour so it reinforces the palette instead of fighting it. Bass swells
    // make the rim breathe with the kick.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    float rim  = fres * (0.55 + uBass * 0.55);

    // Compose: ambient floor (so backlit areas keep their hue) + diffuse
    // multiply + coloured rim + white specular sparkle.
    //
    // The sparkle is the one term here that is NOT the palette's colour, and on
    // the shipped tree it is the brightest thing in the frame on a matte body:
    // p99 luma 0.828 against a mirror's 0.467, 3.59 % of the frame above 0.7.
    // uGlare is what that complaint about white turns into — see the
    // note on studioEnv. The diffuse, the ambient floor and the coloured rim are
    // untouched, so the body keeps its brightness and loses the glint.
    float ambient = 0.30;
    color = color * (ambient + diff * 0.85)
          + color * rim
          + vec3(spec) * uGlare;
  }

  // ── Surface material: studio-environment reflections ────────────────────
  // Shared with SE_FS_TEMPLATE via _MATERIAL_BLOCK. Gated by uMaterial>0 so
  // Matte (default) keeps the original look at zero cost. Runs independently
  // of uLighting so reflections appear in every viz mode. Expects color,
  // vWorldPos, vViewDir in scope — all present here.
  ${_MATERIAL_BLOCK}

  // ── Particle shaping ────────────────────────────────────────────────────
  // No-op unless the POINTS proxy is drawing (uPtStyle == 0 everywhere else),
  // so the surface and wireframe paths are bit-for-bit what they were.
  ${_POINT_MASK}

  gl_FragColor = vec4(color, _pAlpha);
}`;

// ── ShaderEditor ──────────────────────────────────────────────────────────────

const SE_VS_TEMPLATE = body => `uniform float uTime,uBass,uMid,uTreble,uAmp,uBeat,uWI,uPointSize;
uniform int uMode,uMathMode,uModeNext;
uniform float uMorphProgress,uModeBlend;
// uVHField / aBaseY — see the long note in VS. The editor's fragment template
// shares the same ramp (t=clamp((vH+.8)*.6,.03,.97)), so a user shader gets the
// same two channels: their body drives the palette through y, the shape it is
// drawn on drives the geometry. Both are declared unconditionally because the
// morph line below reads them whatever the body did.
uniform int uVHField;
attribute float aBaseY;
attribute float aField;
// aBand / uPtBand / ptSpray — the PTS cloud, mirrored from VS term for term. An
// editor shader is installed on the points proxy too, so leaving them out here
// would make Spectrum Rings scatter the grains with the built-in program and do
// nothing with a custom one — one control, two answers, depending on a mode the
// user was not thinking about. That exact defect has already been found once in
// this template, for this same layer.
attribute float aBand;
uniform float uPtBand;
// Mirrored from VS: which band this point listens to, for the fragment
// template's colour tint. The editor's band path is the RADIUS rule (it never
// consults uBandMode), so that is the coordinate it reports.
attribute float aBandU;
varying float vBandU;
varying float vH;
varying vec3  vWorldPos;
${BAND_GLSL}
varying vec3  vViewDir;
float ptSpray(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453)*2.-1.;}
// Word for word with the VS copy above — the editor template hands the user the
// same helpers the built-in programs have, and two spellings of turb would let
// a shader written in the editor draw a grid the built-in one no longer does.
float turb(vec2 p){float t=0.;for(float i=1.;i<5.;i++){float a=i*1.7+0.4;t+=sin(dot(p,vec2(cos(a),sin(a)))*i+i*2.3)/i;}return t*0.408+0.846;}
float ramu(vec2 p){float r=length(p),a=atan(p.y,p.x),s=0.;for(int n=-6;n<=6;n++){float fn=float(n);s+=cos(a*fn)*exp(-r*.28*fn*fn);}return tanh(s*.7);}
float h_sech(float x){float e=exp(-abs(x));return 2.*e/(1.+e*e);}
void main(){vec3 pos=position;
  // bt=0. for the same reason as in VS: beat-driven displacement flashes the
  // surface on every onset, which DISCLAIMER warns photosensitive users about.
  // Here it is only a default the user body can override — uBeat is declared
  // above and stays in scope, so an editor shader opts into beat response
  // knowingly (read uBeat, or assign bt=uBeat first) — which is why the +bt
  // terms in the shipped vertex snippets contribute nothing until they do.
  float b=clamp(uBass,0.,1.2),t=clamp(uTreble,0.,1.2),m=clamp(uMid,0.,1.),bt=0./*intentional, see note above*/;
  float r=length(pos.xz),ang=atan(pos.z,pos.x),y=0.,a=uAmp,wi=uWI,T=uTime;
  ${body}
  // FIX: scale by uMorphProgress, exactly as the built-in VS does in both of
  // its branches. The template declared the uniform and never read it, so
  // while an editor program was live a shape swap — D, R, a preset, a clip
  // step, all of which drive uMorphProgress 1 → 0 → 1 and swap the geometry at
  // the flat frame — produced no deflate and no inflate, just a cut in the
  // middle of an animation the rest of the app was still performing. The else
  // branch reproduces the built-in's CPU path, including its double scaling in
  // collapse mode (math-visualizer applies morphScale before this): parity
  // with the reference, not a new behaviour.
  // FIX(r10 §1.5): adds rather than replaces, for the same reason as the
  // built-in VS above — an editor shader was flattening the shape it was
  // drawn on into the graph of its own body. Parity with the reference. Two
  // contracts here, and they do NOT hold for the same set of saved bodies —
  // measured on the plane at progress 0/.25/.5/.75/1, 129605 float32
  // comparisons per body, against this template as it stood at c629b53:
  //   COLOUR is bit-identical for every body. Before round 10 vH was pos.y
  //     after this line, which in the GPU branch was y*uMorphProgress and
  //     never the body's own pos.y write; it is y*uMorphProgress now. 0 of
  //     129605 differ for a body writing only y, one writing only pos.y, and
  //     one writing both.
  //   GEOMETRY is bit-exact only for a body that writes y and leaves pos.y
  //     alone — which is what the shipped snippet and the built-in presets
  //     do: 0 of 129605. A body that writes pos.y ITSELF used to have that
  //     write discarded here and now keeps it, so it moves: 103680 of 129605
  //     for a body whose whole text is  pos.y = sin(r*3.)*.9;  (vertex 0 at
  //     progress .25, 0.0000 -> 0.1703). That is the fix and not a casualty
  //     of it — the old line silently threw the user's own pos.y away.
  //     (This example used to be spelled out in English because the guard in
  //     tests/shader-source-owner.test.js read prose as code. Round 10 gave
  //     that guard a reader that strips both comment kinds and splits on
  //     statements, so the GLSL is back. Measured: with the line above written
  //     as GLSL, shader-source-owner 23/0, colour-ramp 20/0 and gpu-shape-y
  //     21/0 all stay green, while unscaling the REAL write below turns them
  //     1, 3 and 7 red respectively.)
  // FIX(r10, colour): vH carries the DISPLACEMENT, not the absolute height —
  // the built-in VS above has the measurement and the reasoning. In the GPU
  // branch that is the body's own y, which is bit-for-bit what vH was here
  // before round 10, when the template stored y*uMorphProgress as the height
  // and copied that into vH.
  // The band layer reaches a user shader too, mirroring the built-in term for
  // term. It was missing here at first, and the effect was worse than "a
  // feature does not apply": with a custom shader live, Spectrum Rings did
  // nothing in GPU mode and the slider looked broken, while the SAME slider
  // kept working in CPU/formula mode — where applyHeightField bakes the layer
  // into the position attribute before any shader runs. One control, two
  // answers, depending on a mode the user was not thinking about. Found by an
  // external review.
  //
  // The ternary wraps the whole sum, so at depth 0 this is bit-identical to the
  // plain y it carried before, and vH gets the same value the geometry does.
  // bandHere is the band's own share of the displacement, recovered as fB - y
  // rather than evaluated a second time, exactly as the built-in VS recovers it
  // as f - fBase. At depth 0 the ternary returns y and this is exactly 0.
  //
  // ── bandU differs between the two branches, and that is not an oversight ──
  // GPU branch: the RADIUS, because this template's band term is
  // bandAtRadius — a user shader has always been outside the character path,
  // deliberately and pinned by tests/audio-band-shape.test.js.
  // CPU branch: aBandU, the character map, because in CPU mode the displacement
  // was baked by applyHeightField, which DOES use the map, whatever vertex
  // program is installed afterwards.
  // So each branch reports the layout its own geometry actually has, and the
  // colour agrees with the shape in both. What the user sees is that switching
  // math mode under a custom shader changes the layout — which it already did
  // before any of this, in the geometry alone; the tint now makes that visible
  // rather than introducing it. An external review flagged the difference; it
  // is real, it is older than the tint, and the alternative (colouring by rings
  // over a body the CPU laid out by the formula) would be worse.
  float bandHere=0.;
  float bandU=-1.;
  if(uMathMode==0){float fB=uBandDepth>0.?y+bandAtRadius(length(pos.xz))*uBandDepth:y;bandHere=fB-y;if(uBandDepth>0.)bandU=length(pos.xz)/max(uBandR,1e-3);pos.y=(pos.y+fB)*uMorphProgress;vH=fB*uMorphProgress;}else{bandHere=aBand;bandU=aBandU;vH=(uVHField==2)?aField*uMorphProgress:(uVHField==1)?(pos.y-aBaseY)*uMorphProgress:pos.y*uMorphProgress;pos.y=pos.y*uMorphProgress;}
  vBandU = bandU;
  // An editor shader is now installed on the POINTS proxy too, and a vertex
  // program that leaves gl_PointSize unwritten draws points of undefined size.
  // Mirrors the built-in VS, PTS cloud included; harmless in WIRE/SURF, which
  // ignore gl_PointSize, and inert everywhere uPtBand is 0.
  float ptB = uPtBand * bandHere * uMorphProgress;
  if (ptB != 0.) pos += normal * (ptSpray(position) * ptB * 0.8);
  gl_PointSize = uPointSize * (1. + 1.5 * abs(ptB));
  vec4 _wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = _wp.xyz;
  vViewDir  = cameraPosition - _wp.xyz;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);}`;

// FIX(#28): counts below track COLOR_SCHEME_COUNT — see the FS header note.
// Template wrapping user frag body — _COLOR_FUNS provides all 54 color
// functions AND the getColor() dispatcher, so a user fragment can just do
// `c = getColor(uCM, t);` and cover every palette without copy-pasting a
// 44-way if-cascade.
//
// Surface materials (studio-env reflections) also apply here: the chosen
// material runs over the user's `c` automatically (B+C). The user writes
// their colour into `c` as before; we copy it into `color`, run the shared
// _MATERIAL_BLOCK (which is a no-op when material is Matte / uMaterial==0),
// then output. Advanced users can additionally call studioEnv(),
// reflect(), and read uMetalness/uReflect/etc directly inside their body —
// the function, uniforms, and vWorldPos/vViewDir varyings are all in scope.
const SE_FS_TEMPLATE = body => `uniform int uCM,uCMNext;uniform float uCMBlend;
uniform float uTime,uBass,uMid,uTreble,uBeat;
${_MATERIAL_UNIFORMS}
${_POINT_UNIFORMS}
varying float vH;
// Mirrored from FS: which band this point listens to, and the same shift of the
// palette parameter by it. A user's fragment body still starts from the same t
// the built-in ramp produces, so the spectrum reads as a colour map with a
// custom shader live as well. Static per vertex, so it adds no flicker.
varying float vBandU;
varying vec3  vWorldPos;
varying vec3  vViewDir;
${_COLOR_FUNS}
${_STUDIO_ENV}
// uMid and uBeat are declared even though the default snippet uses neither:
// the Neon and Lava presets read them, and without the uniforms those two
// failed to compile at all. Audio is NOT aliased to short locals here the way
// the vertex template does it — this body is user code that gets saved into
// presets, so injecting names into its scope would collide with anyone who
// declared their own.
void main(){float t=clamp((vH+.8)*.6,.03,.97);
  t = clamp(t + step(0., vBandU) * .30 * (vBandU - .5), .03, .97);
  vec3 c=vec3(0.0);
  ${body}
  vec3 color = c;
  ${_MATERIAL_BLOCK}
  ${_POINT_MASK}
  gl_FragColor=vec4(color,_pAlpha);}`;

// ── Shader editor default code snippets ───────────────────────────────────────
const SE_DEFAULT_VERT = `// b bass  t treble  m mid  bt beat  T time  wi waveInt  a amp
// pos.x pos.z = coords   r = radius   ang = angle
y = sin(r * 8.0 * wi + T) * (0.2 + b * 0.8) * a
  + turb(pos.xz * (2.0 + t) * wi) * b * 0.3
  + bt * 0.5;`;

// Default frag code shown in editor: routes through getColor(uCM, t), which
// covers all 54 palettes — so picking any scheme from the dropdown Just Works
// without the user editing the fragment.
//
// FIX(#28): the list must stay complete — a name missing here reads as
// "unsupported" to editor users even though getColor() dispatches it.
// All 54 functions are callable by name from custom code:
//   0  tealOrange      1  bladeRunner       2  matrix          3  bleachBypass
//   4  outrun          5  vaporwave         6  neonNoir        7  sunsetGrid
//   8  viridis         9  inferno          10  plasma         11  cividis
//  12  aurora         13  lava             14  deepOcean      15  electricViolet
//  16  amber          17  emerald          18  sapphire       19  obsidian
//  20  transformativeTeal  21 electricFuchsia  22 bioGraphing  23 greenGlow
//  24  cyberpunkGold  25 arcticFire        26 bloodMoon       27 cosmicDust
//  28  toxicWaste     29 cherryBlossom     30 midnightChrome  31 solarFlare
//  32  deepSpace      33 acidRain          34 volcanic        35 bioluminescence
//  36  charcoalSmoke  37 slateIndigo       38 mossStone       39 petrol
//  40  emberBlack     41 burgundyVelvet    42 midnightForest  43 coalPlum
//  44  burgundyBlack  45 crimsonAbyss      46 tarnishedGold   47 fathomBlue
//  48  cedarSmoke     49 fernShadow        50 orchidAsh       51 driedRose
//  52  deepJade       53 rustSlate
const SE_DEFAULT_FRAG = `// t = palette ramp 0.03..0.97 — the DISPLACEMENT at this point, not the
// absolute height: the shader's own y in GPU mode, the height field in
// Surface mode. In Volume and Collapse nothing writes a field, so it falls
// back to pos.y after the morph scale. Then shifted by this
// point's Spectrum Rings band.   uCM = scheme index 0..53
// Audio comes in as uniforms here, not short locals: uBass uMid uTreble uBeat
// uTime. Note t is that ramp, not treble as in the vertex tab.
// getColor(uCM, t) dispatches to one of 54 palettes. You can also call
// any palette by name directly, e.g.  c = lava(t)  or  c = cyberpunkGold(t);
c = getColor(uCM, t);`;

const SE_PRESETS = [
  { name:'🌊 Ocean',    tab:'vert', code:`y = sin(r*8.*wi - T*2.) * exp(-r*.4) * (0.3+b*.9)*a\n  + sin(pos.x*6.*wi)*cos(pos.z*4.*wi)*.15*a;` },
  { name:'⚡ Lightning', tab:'vert', code:`y = sin(pos.x*20.*wi*(0.5+t)+T*5.) * (0.1+b*.6)*a\n  + sin(pos.z*18.*wi+T*3.)*(0.1+t*.5)*a + bt*0.8;` },
  { name:'🌀 Vortex',   tab:'vert', code:`float spiral=ang*3.+r*5.-T*2.;\ny = sin(spiral)*(0.2+b*.8)*a*exp(-r*.25) + cos(spiral*2.)*(0.1+t*.4)*a*.5;` },
  { name:'💎 Crystal',  tab:'vert', code:`float k=sin(pos.x*12.*wi)*cos(pos.z*12.*wi);\ny = k*(0.3+b*.7)*a + sin(r*20.*wi*(0.5+t))*0.15*a + bt*sin(ang*8.)*0.3;` },
  { name:'🔥 Plasma',   tab:'vert', code:`y = turb(pos.xz*(3.+b*2.)*wi)*(0.4+b*.8)*a\n  + sin(r*15.*wi-T*4.)*exp(-r*.2)*(0.2+t*.6)*a + bt*0.6;` },
  { name:'🎆 Ramanujan',tab:'vert', code:`float s=0.;\nfor(int n=-6;n<=6;n++){float fn=float(n); s+=cos(ang*fn)*exp(-r*.25*fn*fn*(0.5+t));}\ny = tanh(s*.7)*(0.3+b*.7)*a;` },
  { name:'🌈 Neon',     tab:'frag', code:`float h=t*6.28+uTime*.5;\nc=vec3(abs(sin(h+uBass*2.)),abs(sin(h+2.094+t)),abs(sin(h+4.189+uMid))) *(0.6+uBeat*0.4);` },
  { name:'🔆 Lava',     tab:'frag', code:`c=lava(t)*(0.7+uBass*0.5+uBeat*0.3);` },
];

export class ShaderEditor {
  /** @param {import('./render.js').RenderEngine} render */
  constructor(render) {
    this._render = render;
    this._tab    = 'vert';
    this._vert   = SE_DEFAULT_VERT;
    this._frag   = SE_DEFAULT_FRAG;
    this.customVS = null;
    this.customFS = null;
    // FIX: the bodies behind customVS/customFS — i.e. the last source that
    // actually compiled. _vert/_frag cannot stand in for them: they are draft
    // buffers the gallery, switchTab and compileAndApply's own pre-compile
    // write all move without anything having been applied. captureState needs
    // the source of the program that is LIVE, because applying a snapshot
    // with hasCustom compiles whatever body it carries.
    this._appliedVert = null;
    this._appliedFrag = null;

    // ── Callbacks — UI wires these in bindAll() ───────────────────────
    this.cb = {
      /** { ok:bool, message:string, line:number|null } */
      onCompileResult: (_r) => {},
      /** Called when open() is invoked — UI populates presets + textarea */
      onOpen:          (_tab, _code, _presets) => {},
      /** Tab switched */
      onTabSwitch:     (_tab, _code) => {},
    };
  }

  open() {
    document.getElementById('shader-editor-overlay').classList.add('open');
    const code = this._tab === 'vert' ? this._vert : this._frag;
    document.getElementById('se-code').value = code;
    this.cb.onOpen(this._tab, code, SE_PRESETS);
    this._buildPresets();
  }

  compileAndApply() {
    const errEl = document.getElementById('se-error');
    errEl.textContent = '';
    // Whatever this run reports owns the status line from here on — see the
    // timer armed on success below.
    clearTimeout(this._okTimer);
    this._okTimer = null;
    const vertBody = this._tab === 'vert' ? document.getElementById('se-code').value : this._vert;
    const fragBody = this._tab === 'frag' ? document.getElementById('se-code').value : this._frag;
    if (this._tab === 'vert') this._vert = vertBody;
    else this._frag = fragBody;

    const fullVS = SE_VS_TEMPLATE(vertBody);
    const fullFS = SE_FS_TEMPLATE(fragBody);

    // Detecting a bad shader is the whole point of this button, and neither
    // obvious approach works in three r169:
    //   renderer.compile()      — creates the program, returns quietly on a
    //                             GLSL error; the try/catch around it only ever
    //                             caught JS-level failures.
    //   renderer.compileAsync() — resolves when the program is *ready*, not
    //                             when it is *valid*. It does not reject on a
    //                             link failure, so every broken shader was
    //                             reported to the user as "compiled & applied".
    // The supported hook is renderer.debug.onShaderError: three calls it in
    // place of its own console.error when a program fails to link, handing over
    // the gl objects so we can read the real InfoLog — with the line numbers
    // _parseErrorLine needs. Installing it also stops three from logging a wall
    // of shader source to the console on every typo.
    const tGeo  = new THREE.PlaneGeometry(1, 1, 1, 1);
    const tMat  = new THREE.ShaderMaterial({
      vertexShader:   fullVS,
      fragmentShader: fullFS,
      uniforms:       this._render.U,
      side:           THREE.DoubleSide,
    });
    // Same aBaseY fallback as gpuMat. SE_VS_TEMPLATE declares and reads the
    // attribute unconditionally, and the throwaway PlaneGeometry above never
    // went through attachBaseY, so without this the probe draw takes neither
    // of three's two paths for it and leaves the generic location holding
    // whatever the last program put there. See attachBaseY in render.js.
    tMat.defaultAttributeValues.aBaseY = [0];
    // aField and aBand are on the same footing and were missing here — the
    // template declares and reads all three, and the probe geometry carries
    // none of them. Left as it was, a compile probe could read whatever the
    // previous program left in those generic slots.
    tMat.defaultAttributeValues.aField = [0];
    tMat.defaultAttributeValues.aBand  = [0];
    tMat.defaultAttributeValues.aBandU = [-1];
    // Probe in a scene of its own rather than adding the test mesh to the live
    // one: compile()/render() would then walk every material in the scene —
    // seconds of work on a software GL — and the probe mesh could show up in
    // the visible frame for a tick.
    const tScene = new THREE.Scene();
    const tCam   = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    tCam.position.z = 2;
    tScene.add(new THREE.Mesh(tGeo, tMat));

    const cleanup = () => {
      tMat.dispose();
      tGeo.dispose();
    };

    const onSuccess = () => {
      cleanup();
      this.customVS = fullVS;
      this.customFS = fullFS;
      // FIX: remember the bodies, not just the assembled programs — a preset
      // stores the body and re-wraps it in the template on restore.
      this._appliedVert = vertBody;
      this._appliedFrag = fragBody;
      // One call reaches gpuMat, the live POINTS proxy, and any proxy built
      // later — see RenderEngine.applyShaderSource().
      this._render.applyShaderSource(fullVS, fullFS);
      errEl.style.color = 'var(--green)';
      errEl.textContent = '✔ Compiled & applied';
      this.cb.onCompileResult({ ok: true, message: '✔ Compiled & applied', line: null });
      // FIX: keep the handle. This tidy-up used to outlive whatever came next,
      // so a failure reported within two seconds — pressing APPLY twice while
      // fixing a typo is the ordinary way to get there — had its red message
      // and its line number blanked by the previous run's timer, leaving an
      // editor that said nothing about a shader that had not compiled. The
      // camera programmer's status line had the same defect.
      this._okTimer = setTimeout(() => {
        this._okTimer = null;
        errEl.textContent = '';
        this.cb.onCompileResult({ ok: true, message: '', line: null });
      }, 2000);
    };

    const onFailure = (err) => {
      cleanup();
      const errorMsg  = err?.message || String(err) || 'Shader compile error';
      // Both arguments follow the tab: the source the driver numbered its
      // message against, and the body the operator is looking at.
      const onVert = this._tab === 'vert';
      const src    = onVert
        ? (_failedSource?.vert ?? fullVS)
        : (_failedSource?.frag ?? fullFS);
      // A failure in the stage the operator is NOT looking at gets no gutter
      // mark: its line number counts through a different buffer entirely.
      const sameTab   = !_failedSource?.stage || _failedSource.stage === this._tab;
      const errorLine = sameTab
        ? this._parseErrorLine(errorMsg, src, onVert ? vertBody : fragBody)
        : null;
      const friendly  = this._friendlyError(errorMsg);
      errEl.style.color = '#f66';
      errEl.textContent = friendly;
      this.cb.onCompileResult({ ok: false, message: friendly, line: errorLine });
    };

    const renderer = this._render.renderer;
    const prevHook = renderer.debug.onShaderError;
    let captured = null;
    let _failedSource = null;
    renderer.debug.onShaderError = (gl, program, glVS, glFS) => {
      // Prefer whichever stage actually failed; the program log is the
      // fallback for link-time errors that neither shader reports.
      const vLog = gl.getShaderInfoLog(glVS) || '';
      const fLog = gl.getShaderInfoLog(glFS) || '';
      captured = (vLog + fLog).trim() || (gl.getProgramInfoLog(program) || '').trim()
              || 'Shader failed to link';
      // FIX: keep the source the DRIVER numbered its message against. three.js
      // prepends its own preamble — precision qualifiers, defines, built-in
      // uniforms — to the program before compiling it, so counting lines from
      // our own template output lands short by however long that preamble is.
      // Optional-chained because the honest fallback when a context does not
      // expose it is our assembled string, which is what was used before.
      _failedSource = {
        vert:  gl.getShaderSource?.(glVS) || null,
        frag:  gl.getShaderSource?.(glFS) || null,
        // Which stage the operator's message actually came from: a line from
        // the other buffer is worse than no line at all.
        stage: vLog.trim() ? 'vert' : (fLog.trim() ? 'frag' : null),
      };
    };

    try {
      // compile() builds the program; the link check three defers to first use
      // is what triggers the hook, so force one render to a throwaway target.
      // Rendering the real scene here would fight the animation loop.
      renderer.compile(tScene, tCam);
      const rt = new THREE.WebGLRenderTarget(1, 1);
      const prevRT = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(tScene, tCam);
      renderer.setRenderTarget(prevRT);
      rt.dispose();
    } catch (e) {
      captured = captured || e?.message || String(e);
    } finally {
      renderer.debug.onShaderError = prevHook;
    }

    if (captured) onFailure(new Error(captured));
    else onSuccess();
  }

  /**
   * Parse WebGL error strings like:
   *   "ERROR: 0:14: 'sin' : wrong operand types"
   *   "ERROR: Fragment shader compilation failed:\nERROR: 0:8:..."
   * Returns user-body-relative line number (1-based) or null.
   */
  _parseErrorLine(msg, fullShader, userBody) {
    const m = msg.match(/ERROR:\s*\d+:(\d+)/);
    if (!m) return null;

    // FIX: locate the body inside the assembled program instead of subtracting
    // line counts. The old arithmetic — full.lines - body.lines - 1 — treats
    // the template as a pure prefix, and it is not: it closes main() after the
    // body, so the trailing lines were counted as preamble and every reported
    // line came out short. It was also called with the VERTEX body while the
    // FRAGMENT tab was on screen, so on that tab the "preamble" was the
    // difference between two unrelated buffers.
    const at = fullShader.indexOf(userBody);
    if (at < 0) return null;
    const preambleLines = fullShader.slice(0, at).split('\n').length - 1;

    const relLine = parseInt(m[1], 10) - preambleLines;
    // A line outside the body belongs to the template, not to anything the
    // operator can see or fix. Painting the gutter there points at the wrong
    // text with the same confidence as a right answer.
    return relLine >= 1 && relLine <= userBody.split('\n').length ? relLine : null;
  }

  /** Trim noisy WebGL driver boilerplate for cleaner display */
  _friendlyError(msg) {
    // Extract just the first ERROR: line — driver prefixes vary wildly
    const m = msg.match(/ERROR:.*$/m);
    if (m) return m[0].replace(/ERROR:\s*\d+:\d+:\s*/, 'Line ');
    return msg.split('\n')[0].substring(0, 120);
  }

  /**
   * Put the built-in program back on screen without touching the editor's
   * text, its error line or the callbacks. Split out of reset() so a preset
   * that carries no custom shader can undo a live one mid-clip: reset() would
   * also stomp #se-code back to the defaults and re-fire onOpen.
   */
  revertToBuiltIn() {
    this.customVS = null; this.customFS = null;
    // Cleared with the programs they describe: no custom program is live, so
    // there is no applied body either. The editor text is deliberately left
    // alone (see the test of the same name).
    this._appliedVert = null; this._appliedFrag = null;
    this._render.applyShaderSource();
  }

  reset() {
    this._vert = SE_DEFAULT_VERT; this._frag = SE_DEFAULT_FRAG;
    this.revertToBuiltIn();
    document.getElementById('se-code').value = this._tab === 'vert' ? this._vert : this._frag;
    document.getElementById('se-error').textContent = '';
    this.cb.onCompileResult({ ok: true, message: '', line: null });
    this.cb.onOpen(this._tab, this._tab === 'vert' ? this._vert : this._frag, SE_PRESETS);
  }

  switchTab(tab) {
    if (this._tab === 'vert') this._vert = document.getElementById('se-code').value;
    else this._frag = document.getElementById('se-code').value;
    this._tab = tab;
    document.querySelectorAll('#shader-editor-box .se-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const code = tab === 'vert' ? this._vert : this._frag;
    document.getElementById('se-code').value = code;
    this.cb.onTabSwitch(tab, code);
  }

  _buildPresets() {
    const wrap = document.getElementById('se-preset-wrap');
    wrap.innerHTML = '';
    SE_PRESETS.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'se-preset'; btn.textContent = p.name;
      btn.onclick = () => {
        if (p.tab !== this._tab) this.switchTab(p.tab);
        document.getElementById('se-code').value = p.code;
        if (p.tab === 'vert') this._vert = p.code; else this._frag = p.code;
        this.cb.onTabSwitch(p.tab, p.code);
      };
      wrap.appendChild(btn);
    });
  }
}

// ── ModelLoader ───────────────────────────────────────────────────────────────
export class ModelLoader {
  /** @param {import('./render.js').RenderEngine} render */
  constructor(render) {
    this._render = render;
    this._model  = null;
    this._meshes = [];
  }

  async load(file, onLoading, getCustomShaders) {
    onLoading(true, 0, 'LOADING MODEL…');
    this.clear();
    const r = this._render;
    const ext = file.name.split('.').pop().toLowerCase();
    const url = URL.createObjectURL(file);
    try {
      let group;
      if (ext === 'obj') {
        group = await new Promise((res, rej) =>
          new OBJLoader().load(url, res, p => onLoading(true, 0.5 + p.loaded/p.total*.4, 'LOADING OBJ…'), rej));
      } else if (ext === 'gltf' || ext === 'glb') {
        const gltf = await new Promise((res, rej) =>
          new GLTFLoader().load(url, res, p => onLoading(true, 0.5 + p.loaded/p.total*.4, 'LOADING GLTF…'), rej));
        group = gltf.scene;
      } else { throw new Error('Unsupported: .' + ext); }

      onLoading(true, 0.95, 'APPLYING SHADER…');
      this._centerAndScale(group);
      const { vs, fs } = getCustomShaders();
      this._applyShader(group, vs || VS, fs || FS);
      this._model = group;
      r.scene.add(group);
      // FIX: the engine takes the stage over, instead of this method reaching
      // in to hide gpuMesh. Hiding it here was undone by the next viz-mode
      // change, and left the particle mask up over the model's triangles.
      r.setExternalModel(this._meshes);
      document.getElementById('model-info').textContent = `✔ ${file.name} — ${this._meshes.length} mesh(es)`;
      document.getElementById('btn-clear-model').style.display = '';
      onLoading(true, 1, 'DONE');
    } catch (e) {
      console.error('Model load error:', e);
      document.getElementById('model-info').textContent = '⚠ ' + e.message;
      // Nothing took the stage, so give it back — clear() above may have
      // removed a model that was working perfectly well before this attempt.
      r.setExternalModel(null);
    }
    URL.revokeObjectURL(url);
    setTimeout(() => onLoading(false), 300);
  }

  /**
   * Remove the imported model and give the stage back to the engine.
   *
   * FIX: the release was missing, so this left an empty scene — the built-in
   * mesh was hidden by load() and nothing turned it back on. That is also why
   * wiring up ✕ CLEAR MODEL needed this half first: the button would have
   * removed the model and shown nothing at all.
   */
  clear() {
    if (!this._model) return;
    this._render.scene.remove(this._model);
    this._meshes.forEach(m => {
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => mt.dispose());
    });
    this._model = null; this._meshes = [];
    this._render.setExternalModel(null);
  }

  _centerAndScale(group) {
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3(); box.getSize(size);
    const scale = 6 / Math.max(size.x, size.y, size.z);
    group.scale.setScalar(scale);
    const center = new THREE.Vector3(); box.getCenter(center);
    group.position.sub(center.multiplyScalar(scale));
    group.position.y = 0;
  }

  _applyShader(group, vs, fs) {
    group.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => m.dispose());
      const mat = new THREE.ShaderMaterial({ vertexShader:vs, fragmentShader:fs, uniforms:this._render.U, side:THREE.DoubleSide });
      // THIS is the case attachBaseY's docblock names as the real one: an
      // imported geometry never passes through setShape, so it carries no
      // aBaseY, while both VS and SE_VS_TEMPLATE read the attribute
      // unconditionally. Declaring the default is what makes three write 0
      // into the generic location instead of leaving the previous program's
      // value there. Survives the editor's swap: applyShaderSource mutates
      // .vertexShader in place and does not rebuild the material.
      mat.defaultAttributeValues.aBaseY = [0];
      // Same argument, same two other attributes an imported geometry does not
      // carry. aBand additionally has uPtBand forced to 0 while a model is on
      // stage, so it is belt and braces — but the belt is the one that broke
      // before, and a model is exactly the geometry attachBaseY never sees.
      mat.defaultAttributeValues.aField = [0];
      mat.defaultAttributeValues.aBand  = [0];
      mat.defaultAttributeValues.aBodyK = [0];
      mat.defaultAttributeValues.aBandU = [-1];
      child.material = mat;
      this._meshes.push(child);
    });
  }
}
