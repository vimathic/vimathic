/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

import * as THREE from 'three';
import { OBJLoader }  from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
varying float vH;
// SURF lighting: pass post-displacement world position and view direction to FS
// so the fragment shader can reconstruct surface normals via screen-space
// derivatives. Both varyings are written unconditionally — they're cheap, and
// the FS only consumes them when uLighting==1.
varying vec3  vWorldPos;
varying vec3  vViewDir;

// ── Helper functions ──────────────────────────────────────────────────────────
float turb(vec2 p){float t=0.;for(float i=1.;i<5.;i++)t+=abs(sin(p.x*i)*cos(p.y*i))/i;return t;}
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
  else if(mode==10){float s=0.;for(int n=1;n<=7;n++){float fn=float(n);s+=sin(fn*3.14159)*exp(-fn*.3)*sin(r*fn*5.*wi*(0.5+t));}y=s*.4*(0.3+b*.7)*a;}
  else if(mode==11){float s=0.;for(int n=1;n<=7;n++){float fn=float(n);s+=exp(-fn*r*.3)*cos(ang*fn*2.)*sin(fn*t*2.);}y=s*.5*(0.3+b*.7)*a;}
  else if(mode==12){y=exp(-r*.6)*sin(r*8.*wi*(0.5+t))*(0.3+b*.7)*a;}
  else if(mode==13){float e=0.;for(int n=1;n<=5;n++){float fn=float(n);e+=cos(ang*fn*4.)*exp(-r*.15*fn);}y=e*.4*(0.3+b*.7)*a;}
  else if(mode==14){y=sin(r*8.*wi*(0.5+t))*cos(ang*4.)*(0.3+b*.7)*a+bt*.3;}
  else if(mode==15){float s=0.;for(int n=1;n<=6;n++){float fn=float(n);s+=sin(fn*r*5.*wi*(0.5+t))*cos(fn*ang);}y=s*.25*(0.3+b*.7)*a;}
  else if(mode==16){y=h_sech(r*2.-T*2.-(b*.8+.1)*3.)*(0.6+b*.6)*a+bt*.4;}
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
  // FIX: mode 30 loop n=-4..4 unrolled for WebGL1
  else if(mode==30){float s=0.;s+=sin(xz.x*-4.*5.*wi)*cos(xz.y*-4.*5.*wi)*exp(-4.*.3);s+=sin(xz.x*-3.*5.*wi)*cos(xz.y*-3.*5.*wi)*exp(-3.*.3);s+=sin(xz.x*-2.*5.*wi)*cos(xz.y*-2.*5.*wi)*exp(-2.*.3);s+=sin(xz.x*-1.*5.*wi)*cos(xz.y*-1.*5.*wi)*exp(-1.*.3);s+=0.;s+=sin(xz.x*1.*5.*wi)*cos(xz.y*1.*5.*wi)*exp(-1.*.3);s+=sin(xz.x*2.*5.*wi)*cos(xz.y*2.*5.*wi)*exp(-2.*.3);s+=sin(xz.x*3.*5.*wi)*cos(xz.y*3.*5.*wi)*exp(-3.*.3);s+=sin(xz.x*4.*5.*wi)*cos(xz.y*4.*5.*wi)*exp(-4.*.3);y=s*.25*(0.3+b*.7)*a+bt*.4;}
  else if(mode==31){float s=0.;for(int n=1;n<=5;n++){float fn=float(n);s+=cos(r*fn*4.*wi*(0.5+t)+T*fn*.3)*exp(-r*.15);}y=s*.2*(0.3+b*.7)*a+bt*.3;}
  else if(mode==32){y=sin(r*8.*wi+T)*(0.2+b*.8)*a+turb(xz*(2.+t)*wi)*b*.2+sin(ang*4.)*.1+bt*.4;}
  else if(mode==33){y=sin(r*10.*wi*(0.5+t))*exp(-r*.3)*(0.3+b*.7)*a;}
  else if(mode==34){y=sin(r*12.*wi*(0.5+t))*exp(-r*.3)*(0.3+b*.7)*a;}
  else if(mode==35){float eq=0.;for(int i=1;i<=4;i++){float fi=float(i);eq+=sin(r*8.*wi*fi)*.2;}y=eq*.4*a;}
  else if(mode==36){float v3=0.;for(int i=1;i<=4;i++){float fi=float(i);v3+=sin(r*10.*wi*fi)*.2;}y=v3*.5*a;}
  // Spectral Centroid: frequency scales with treble/bass ratio — the wave
  // gets denser when highs dominate, sparser when lows dominate. Ratio is
  // normalised so silence (b≈t≈0) lands at the neutral midpoint. Note: the
  // name 'centroid' is reserved in GLSL ES 3.0 (centroid-qualifier), so the
  // local is called 'specCenter' instead.
  else if(mode==37){float specCenter=(t+0.001)/(t+b+0.002);float freq=4.+specCenter*16.*wi;y=sin(r*freq-T*2.)*exp(-r*0.25)*(0.3+b*0.7)*a+sin(ang*4.)*0.06*t;}
  else{y=sin(r*10.*wi*(0.5+t))*(0.3+b*.7)*a;}
  return y;
}

void main(){
  vec3 pos=position;
  float b=clamp(uBass,0.,1.2),t=clamp(uTreble,0.,1.2),m=clamp(uMid,0.,1.),bt=0./*beat disabled*/;
  float a=uAmp,wi=uWI,T=uTime;

  if(uMathMode==0){
    // GPU mode: compute both current and next, blend between them
    float y    = computeMode(uMode,    pos.xz, b, t, m, bt, a, wi, T);
    float yNxt = computeMode(uModeNext, pos.xz, b, t, m, bt, a, wi, T);
    // uMorphProgress scales the whole displacement (1=full, 0=flat for shape swap)
    pos.y = mix(y, yNxt, uModeBlend) * uMorphProgress;
  } else {
    // CPU math mode: pos.y already written by applyHeightField().
    // Apply uMorphProgress so shape transitions still deflate/inflate.
    pos.y = pos.y * uMorphProgress;
  }

  vH=pos.y;
  gl_PointSize=uPointSize;
  // Compute world-space position AFTER all displacement so derived normals are correct
  vec4 _wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = _wp.xyz;
  vViewDir  = cameraPosition - _wp.xyz;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);
}`;

// ── Fragment shader — 36 color schemes (0-35) ─────────────────────────────────
//
// Transition uniform added:
//   uCMNext  — color scheme to blend toward
//   uCMBlend — 0=current only, 1=next only (crossfade, 0.6 s)
//
// All 36 scheme functions are defined once in _COLOR_FUNS below and injected
// into both export const FS and SE_FS_TEMPLATE via template interpolation.
// _COLOR_FUNS also contains the getColor() dispatcher, so user-written
// fragment shaders in the editor can call getColor(uCM, t) and get every
// palette without copy-pasting a 36-way if-cascade.
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

// ── _COLOR_FUNS — single source of truth for all 36 GLSL color functions ─────
// Used in both export const FS and SE_FS_TEMPLATE. Edit here only.
//
// IMPORTANT: when adding a new palette, update three things in lockstep:
//   1. Add the vec3 function below.
//   2. Add an `else if(cm==N)` branch in getColor() below.
//   3. Bump COLOR_SCHEME_COUNT in params.js (which feeds MIDI range, the
//      shuffle bag in main.js, and the E-key cycle modulus).
//
// getColor() is included in this block — not duplicated into FS — so user
// fragments in the shader editor can call it too. Previously the dispatcher
// lived inside FS only, and SE_FS_TEMPLATE users either copy-pasted a 36-way
// if-cascade or got undefined-`c` artefacts when uCM landed outside 0..23.
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
  else            return bioluminescence(t);  // 35 + safe default
}
`;

export const FS = `
uniform int   uCM, uCMNext;
uniform float uCMBlend;
// SURF lighting (gated by uLighting): time + audio bands drive light direction
// and audio-reactive specular / rim. Skipped entirely in wireframe and points
// modes by setting uLighting=0 in setVizModeGPU().
//
// NOTE: dFdx/dFdy in main() require GL_OES_standard_derivatives on WebGL1, but
// in WebGL2 / GLSL ES 3.00 they are core built-ins and the extension directive
// is illegal (must appear before any non-preprocessor tokens, and three.js
// prepends its own preamble before user source). The clean fix is: don't put
// any #extension directive here — instead set 'extensions: { derivatives: true }'
// on the ShaderMaterial. Three.js then injects the directive into the WebGL1
// preamble at the correct position, and skips it on WebGL2 where it's a no-op.
uniform int   uLighting;
uniform float uTime, uBass, uTreble;
varying float vH;
varying vec3  vWorldPos;
varying vec3  vViewDir;

${_COLOR_FUNS}

// ── Main ─────────────────────────────────────────────────────────────────────
void main(){
  float t = clamp((vH+.8)*.6,.03,.97);
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
    float ambient = 0.30;
    color = color * (ambient + diff * 0.85)
          + color * rim
          + vec3(spec);
  }

  gl_FragColor = vec4(color, 1.0);
}`;

// ── ShaderEditor ──────────────────────────────────────────────────────────────

const SE_VS_TEMPLATE = body => `uniform float uTime,uBass,uMid,uTreble,uAmp,uBeat,uWI;
uniform int uMode,uMathMode,uModeNext;
uniform float uMorphProgress,uModeBlend;
varying float vH;
float turb(vec2 p){float t=0.;for(float i=1.;i<5.;i++)t+=abs(sin(p.x*i)*cos(p.y*i))/i;return t;}
float ramu(vec2 p){float r=length(p),a=atan(p.y,p.x),s=0.;for(int n=-6;n<=6;n++){float fn=float(n);s+=cos(a*fn)*exp(-r*.28*fn*fn);}return tanh(s*.7);}
float h_sech(float x){float e=exp(-abs(x));return 2.*e/(1.+e*e);}
void main(){vec3 pos=position;
  float b=clamp(uBass,0.,1.2),t=clamp(uTreble,0.,1.2),m=clamp(uMid,0.,1.),bt=0./*beat disabled*/;
  float r=length(pos.xz),ang=atan(pos.z,pos.x),y=0.,a=uAmp,wi=uWI,T=uTime;
  ${body}
  if(uMathMode==0){pos.y=y;}
  vH=pos.y;gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);}`;

// Template wrapping user frag body — _COLOR_FUNS provides all 36 color
// functions AND the getColor() dispatcher, so a user fragment can just do
// `c = getColor(uCM, t);` and cover every palette without copy-pasting a
// 36-way if-cascade.
const SE_FS_TEMPLATE = body => `uniform int uCM,uCMNext;uniform float uCMBlend;varying float vH;
${_COLOR_FUNS}
void main(){float t=clamp((vH+.8)*.6,.03,.97);vec3 c;
  ${body}
  gl_FragColor=vec4(c,1.);}`;

// ── Shader editor default code snippets ───────────────────────────────────────
const SE_DEFAULT_VERT = `// b bass  t treble  m mid  bt beat  T time  wi waveInt  a amp
// pos.x pos.z = coords   r = radius   ang = angle
y = sin(r * 8.0 * wi + T) * (0.2 + b * 0.8) * a
  + turb(pos.xz * (2.0 + t) * wi) * b * 0.3
  + bt * 0.5;`;

// Default frag code shown in editor: routes through getColor(uCM, t), which
// covers all 36 palettes — so picking any scheme from the dropdown Just Works
// without the user editing the fragment.
//
// All 36 functions are callable by name from custom code:
//   0  tealOrange      1  bladeRunner       2  matrix          3  bleachBypass
//   4  outrun          5  vaporwave         6  neonNoir        7  sunsetGrid
//   8  viridis         9  inferno          10  plasma         11  cividis
//  12  aurora         13  lava             14  deepOcean      15  electricViolet
//  16  amber          17  emerald          18  sapphire       19  obsidian
//  20  transformativeTeal  21 electricFuchsia  22 bioGraphing  23 greenGlow
//  24  cyberpunkGold  25 arcticFire        26 bloodMoon       27 cosmicDust
//  28  toxicWaste     29 cherryBlossom     30 midnightChrome  31 solarFlare
//  32  deepSpace      33 acidRain          34 volcanic        35 bioluminescence
const SE_DEFAULT_FRAG = `// t = normalised height 0..1   uCM = scheme index 0..35
// getColor(uCM, t) dispatches to one of 36 palettes. You can also call
// any palette by name directly, e.g.  c = lava(t)  or  c = cyberpunkGold(t);
c = getColor(uCM, t);`;

const SE_PRESETS = [
  { name:'🌊 Ocean',    tab:'vert', code:`y = sin(r*8.*wi - T*2.) * exp(-r*.4) * (0.3+b*.9)*a\n  + sin(pos.x*6.*wi)*cos(pos.z*4.*wi)*.15*a;` },
  { name:'⚡ Lightning', tab:'vert', code:`y = sin(pos.x*20.*wi*(0.5+t)+T*5.) * (0.1+b*.6)*a\n  + sin(pos.z*18.*wi+T*3.)*(0.1+t*.5)*a + bt*0.8;` },
  { name:'🌀 Vortex',   tab:'vert', code:`float spiral=ang*3.+r*5.-T*2.;\ny = sin(spiral)*(0.2+b*.8)*a*exp(-r*.25) + cos(spiral*2.)*(0.1+t*.4)*a*.5;` },
  { name:'💎 Crystal',  tab:'vert', code:`float k=sin(pos.x*12.*wi)*cos(pos.z*12.*wi);\ny = k*(0.3+b*.7)*a + sin(r*20.*wi*(0.5+t))*0.15*a + bt*sin(ang*8.)*0.3;` },
  { name:'🔥 Plasma',   tab:'vert', code:`y = turb(pos.xz*(3.+b*2.)*wi)*(0.4+b*.8)*a\n  + sin(r*15.*wi-T*4.)*exp(-r*.2)*(0.2+t*.6)*a + bt*0.6;` },
  { name:'🎆 Ramanujan',tab:'vert', code:`float s=0.;\nfor(int n=-6;n<=6;n++){float fn=float(n); s+=cos(ang*fn)*exp(-r*.25*fn*fn*(0.5+t));}\ny = tanh(s*.7)*(0.3+b*.7)*a;` },
  { name:'🌈 Neon',     tab:'frag', code:`float h=t*6.28+T*.5;\nc=vec3(abs(sin(h+b*2.)),abs(sin(h+2.094+t)),abs(sin(h+4.189+m))) *(0.6+bt*0.4);` },
  { name:'🔆 Lava',     tab:'frag', code:`c=lava(t)*(0.7+b*0.5+bt*0.3);` },
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
    const vertBody = this._tab === 'vert' ? document.getElementById('se-code').value : this._vert;
    const fragBody = this._tab === 'frag' ? document.getElementById('se-code').value : this._frag;
    if (this._tab === 'vert') this._vert = vertBody;
    else this._frag = fragBody;

    const fullVS = SE_VS_TEMPLATE(vertBody);
    const fullFS = SE_FS_TEMPLATE(fragBody);

    // FIX v6: was using renderer.compile() which in Three.js r169 does NOT
    // throw on GLSL compile errors — it silently returns and the program
    // ends up using fallback magenta material. The try/catch around it
    // only caught JS-level errors (geometry construction etc.), missing
    // every actual shader bug.
    //
    // Now we use compileAsync() — Promise-based variant that REJECTS when
    // the WebGL program fails to link. It checks gl.getShaderInfoLog under
    // the hood, so we get the actual GLSL error message (with line number).
    const tGeo  = new THREE.PlaneGeometry(1, 1, 1, 1);
    const tMat  = new THREE.ShaderMaterial({
      vertexShader:   fullVS,
      fragmentShader: fullFS,
      uniforms:       this._render.U,
      side:           THREE.DoubleSide,
    });
    const tMesh = new THREE.Mesh(tGeo, tMat);
    this._render.scene.add(tMesh);

    // Save success/failure handlers separately so we can dispose the test
    // mesh in both paths.
    const cleanup = () => {
      this._render.scene.remove(tMesh);
      tMat.dispose();
      tGeo.dispose();
    };

    const onSuccess = () => {
      cleanup();
      this.customVS = fullVS;
      this.customFS = fullFS;
      this._render.gpuMat.vertexShader   = fullVS;
      this._render.gpuMat.fragmentShader = fullFS;
      this._render.gpuMat.needsUpdate    = true;
      if (this._render.gpuPtsProxy) {
        this._render.gpuPtsProxy.material.vertexShader   = fullVS;
        this._render.gpuPtsProxy.material.fragmentShader = fullFS;
        this._render.gpuPtsProxy.material.needsUpdate    = true;
      }
      errEl.style.color = 'var(--green)';
      errEl.textContent = '✔ Compiled & applied';
      this.cb.onCompileResult({ ok: true, message: '✔ Compiled & applied', line: null });
      setTimeout(() => {
        errEl.textContent = '';
        this.cb.onCompileResult({ ok: true, message: '', line: null });
      }, 2000);
    };

    const onFailure = (err) => {
      cleanup();
      const errorMsg  = err?.message || String(err) || 'Shader compile error';
      const errorLine = this._parseErrorLine(errorMsg, this._tab === 'vert' ? fullVS : fullFS, vertBody);
      const friendly  = this._friendlyError(errorMsg);
      errEl.style.color = '#f66';
      errEl.textContent = friendly;
      this.cb.onCompileResult({ ok: false, message: friendly, line: errorLine });
    };

    // Three.js compileAsync returns Promise<void> that resolves on link success
    // and rejects on shader/program compile failure with the InfoLog as message.
    if (typeof this._render.renderer.compileAsync === 'function') {
      this._render.renderer
        .compileAsync(this._render.scene, this._render.camera)
        .then(onSuccess)
        .catch(onFailure);
    } else {
      // Older Three.js without compileAsync — fall back to sync compile +
      // immediate render to a 1x1 RT to surface program link errors.
      try {
        this._render.renderer.compile(this._render.scene, this._render.camera);
        // Force one render — gl.useProgram triggers link and reveals errors
        // via gl.getProgramInfoLog if linkProgram failed.
        const rt = new THREE.WebGLRenderTarget(1, 1);
        this._render.renderer.setRenderTarget(rt);
        this._render.renderer.render(this._render.scene, this._render.camera);
        this._render.renderer.setRenderTarget(null);
        rt.dispose();
        // Check WebGL error queue
        const gl = this._render.renderer.getContext();
        const glErr = gl.getError();
        if (glErr !== gl.NO_ERROR) {
          throw new Error('WebGL error 0x' + glErr.toString(16));
        }
        onSuccess();
      } catch (e) { onFailure(e); }
    }
  }

  /**
   * Parse WebGL error strings like:
   *   "ERROR: 0:14: 'sin' : wrong operand types"
   *   "ERROR: Fragment shader compilation failed:\nERROR: 0:8:..."
   * Returns user-body-relative line number (1-based) or null.
   */
  _parseErrorLine(msg, fullShader, userBody) {
    // Count how many lines the template preamble adds
    const preambleLines = fullShader.split('\n').length - userBody.split('\n').length - 1;
    const m = msg.match(/ERROR:\s*\d+:(\d+)/);
    if (!m) return null;
    const absLine = parseInt(m[1], 10);
    const relLine = absLine - Math.max(0, preambleLines);
    return relLine >= 1 ? relLine : null;
  }

  /** Trim noisy WebGL driver boilerplate for cleaner display */
  _friendlyError(msg) {
    // Extract just the first ERROR: line — driver prefixes vary wildly
    const m = msg.match(/ERROR:.*$/m);
    if (m) return m[0].replace(/ERROR:\s*\d+:\d+:\s*/, 'Line ');
    return msg.split('\n')[0].substring(0, 120);
  }

  reset() {
    this._vert = SE_DEFAULT_VERT; this._frag = SE_DEFAULT_FRAG;
    this.customVS = null; this.customFS = null;
    document.getElementById('se-code').value = this._tab === 'vert' ? this._vert : this._frag;
    this._render.gpuMat.vertexShader   = VS;
    this._render.gpuMat.fragmentShader = FS;
    this._render.gpuMat.needsUpdate    = true;
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
    r.gpuMesh.visible = false;
    if (r.gpuPtsProxy) r.gpuPtsProxy.visible = false;
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
      document.getElementById('model-info').textContent = `✔ ${file.name} — ${this._meshes.length} mesh(es)`;
      document.getElementById('btn-clear-model').style.display = '';
      onLoading(true, 1, 'DONE');
    } catch (e) {
      console.error('Model load error:', e);
      document.getElementById('model-info').textContent = '⚠ ' + e.message;
      r.gpuMesh.visible = true;
      if (r.gpuPtsProxy) r.gpuPtsProxy.visible = true;
    }
    URL.revokeObjectURL(url);
    setTimeout(() => onLoading(false), 300);
  }

  clear() {
    if (!this._model) return;
    this._render.scene.remove(this._model);
    this._meshes.forEach(m => {
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => mt.dispose());
    });
    this._model = null; this._meshes = [];
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
      child.material = new THREE.ShaderMaterial({ vertexShader:vs, fragmentShader:fs, uniforms:this._render.U, side:THREE.DoubleSide });
      this._meshes.push(child);
    });
  }
}
