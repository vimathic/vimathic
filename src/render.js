import * as THREE from 'three';
import { OrbitControls }   from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer }  from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }      from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass }  from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { VS, FS } from './shaders.js';

// ── Planet texture cache — persists across shape switches ─────────────────────
const _planetTexCache = new Map();

function _makePlanetTexture(baseHex, hasCraters) {
  const key = `${baseHex}_${hasCraters}`;
  if (_planetTexCache.has(key)) return _planetTexCache.get(key);
  const size = 256, cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const r0=(baseHex>>16)&0xff, g0=(baseHex>>8)&0xff, b0=baseHex&0xff;
  const rd=Math.round(r0*.7), gd=Math.round(g0*.7), bd=Math.round(b0*.7);
  ctx.fillStyle = `rgb(${rd},${gd},${bd})`; ctx.fillRect(0,0,size,size);
  const seed = baseHex % 37;
  for (let i = 0; i < 280; i++) {
    const px=(Math.sin(i*seed+1.3)*.5+.5)*size, py=(Math.cos(i*seed*1.7+.9)*.5+.5)*size;
    const rs=1+Math.abs(Math.sin(i*.41))*6, bright=Math.random()>.5;
    const dr=bright?18:-18, dg=bright?14:-14, db=bright?10:-10;
    ctx.fillStyle=`rgba(${Math.min(255,rd+dr)},${Math.min(255,gd+dg)},${Math.min(255,bd+db)},0.35)`;
    ctx.beginPath(); ctx.arc(px,py,rs,0,Math.PI*2); ctx.fill();
  }
  if (hasCraters) {
    for (let c=0; c<14; c++) {
      const cx=Math.random()*size, cy=Math.random()*size, cr=3+Math.random()*14;
      ctx.strokeStyle=`rgba(${Math.max(0,rd-30)},${Math.max(0,gd-30)},${Math.max(0,bd-30)},0.7)`;
      ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=`rgba(${Math.max(0,rd-20)},${Math.max(0,gd-20)},${Math.max(0,bd-20)},0.4)`; ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  _planetTexCache.set(key, tex);
  return tex;
}

// ═════════════════════════════════════════════════════════════════════════════
// Post-processing FX shader definitions
// Pass order: RenderPass → Bloom → GodRays → MotionBlur → ChromaticAberration
//             → Afterimage → FilmGrainVignette
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

class TransitionManager {
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
   * @returns {{ cancel: function }} — call .cancel() to abort early
   */
  start(slot, duration, onUpdate, onDone, easeFn = easeInOutCubic) {
    // Cancel any in-flight tween in this slot
    this._slots.get(slot)?.cancel();

    let cancelled = false;
    const startTime = performance.now();

    const tween = {
      cancel: () => { cancelled = true; this._slots.delete(slot); },
      tick:   () => {
        if (cancelled) return false;
        const raw    = Math.min(1, (performance.now() - startTime) / duration);
        const eased  = easeFn(raw);
        onUpdate(eased);
        if (raw >= 1) {
          onDone?.();
          this._slots.delete(slot);
          return false; // remove from active set
        }
        return true; // keep running
      },
    };

    this._slots.set(slot, tween);
    return tween;
  }

  /** Must be called once per animation frame (from RenderEngine.updateUniforms) */
  tick() {
    for (const [slot, tween] of this._slots) {
      if (!tween.tick()) this._slots.delete(slot);
    }
  }

  /** True if any transition is currently running */
  get isActive() { return this._slots.size > 0; }
}

// ─────────────────────────────────────────────────────────────────────────────
// RenderEngine
// ─────────────────────────────────────────────────────────────────────────────
export class RenderEngine {
  constructor(isMobile, CFG) {
    this.isMobile = isMobile;
    this.CFG      = CFG;

    // ── Three.js core ─────────────────────────────────────────────────────────
    this.scene    = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050515);
    this.scene.fog = new THREE.FogExp2(0x050515, 0.007);

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
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.0 : 1.5));
    this.renderer.setClearColor(0x050515, 1);
    document.body.appendChild(this.renderer.domElement);

    // WebGL2 capability detection. On WebGL1-only contexts we ship lower
    // geometry density and force-disable the two heaviest post passes
    // (God Rays, Motion Blur) further down in the pipeline setup.
    const isWebGL2 = this.renderer.capabilities.isWebGL2;
    if (!isWebGL2) {
      console.warn('[VIMATHIC] WebGL 2 not available — reducing quality for compatibility.');
      CFG.planeSegs = Math.min(CFG.planeSegs, 60);
    }
    this._isWebGL2 = isWebGL2;

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
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bloom
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.15);
    this.composer.addPass(this.bloomPass);

    // ── FX pipeline — appended after bloom ───────────────────────────────────
    // Pass order is significant: AfterimagePass must run AFTER God Rays and
    // Motion Blur, otherwise trails accumulate on unprocessed frames and
    // distort both effects.

    // Pass 3: God Rays — screen-space radial scattering from bright areas.
    this.godRaysPass = new ShaderPass(GodRaysShader);
    this.godRaysPass.enabled = false;
    this.composer.addPass(this.godRaysPass);

    // Pass 4: Motion Blur — directional blur along camera velocity.
    this.motionBlurPass = new ShaderPass(MotionBlurShader);
    this.motionBlurPass.enabled = false;
    this.composer.addPass(this.motionBlurPass);

    // Pass 5: Chromatic Aberration — RGB channel split toward frame edges.
    this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
    this.chromaticPass.enabled = false;
    this.composer.addPass(this.chromaticPass);

    // Pass 6: Afterglow / Trailing — placed AFTER god rays and motion blur
    // (see pipeline note above).
    this.afterimagePass = new AfterimagePass(0.87); // damp: higher = longer trails
    this.afterimagePass.enabled = false;
    this.composer.addPass(this.afterimagePass);

    // Pass 7: Film Grain + Vignette — final "lens" look. Enabled by default
    // with a subtle vignette; grain starts off.
    this.filmGrainVigPass = new ShaderPass(FilmGrainVignetteShader);
    this.filmGrainVigPass.uniforms.uGrainOn.value = 0.0; // grain off by default
    this.filmGrainVigPass.uniforms.uVigOn.value   = 1.0; // vignette on by default
    this.filmGrainVigPass.enabled = true;
    this.composer.addPass(this.filmGrainVigPass);

    // ── Mobile / WebGL1 budget enforcement ───────────────────────────────────
    // Mobile GPUs choke on the 48-sample God Rays loop; motion blur is also
    // disabled because the extra texture reads per pixel cost too much.
    if (isMobile) {
      this.godRaysPass.enabled    = false;
      this.motionBlurPass.enabled = false;
      this.filmGrainVigPass.uniforms.uVignetteAmt.value = 0.4;
    }
    if (!this._isWebGL2) {
      this.godRaysPass.enabled    = false;
      this.motionBlurPass.enabled = false;
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
    this.scene.add(new THREE.AmbientLight(0x1a1035, 0.8));
    const ml = new THREE.DirectionalLight(0xffcc88, 1.2); ml.position.set(3,5,2); this.scene.add(ml);
    const bl = new THREE.DirectionalLight(0x6688ff, 0.5); bl.position.set(-2,1,-3); this.scene.add(bl);
    this.fillLight  = new THREE.PointLight(0xff8844, 0.5); this.fillLight.position.set(0,-1.5,0); this.scene.add(this.fillLight);
    this.magicLight = new THREE.PointLight(0xaa66ff, 0.6); this.magicLight.position.set(1.5,2,2); this.scene.add(this.magicLight);
    this.beatLight  = new THREE.PointLight(0xff3a7a, 0, 5); this.beatLight.position.set(0,2,0); this.scene.add(this.beatLight);

    // ── Stars ──────────────────────────────────────────────────────────────────
    const sp = new Float32Array(1200*3);
    for (let i=0; i<sp.length; i+=3) { sp[i]=(Math.random()-.5)*200; sp[i+1]=(Math.random()-.5)*100; sp[i+2]=(Math.random()-.5)*100-40; }
    const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sp,3));
    this.stars = new THREE.Points(sGeo, new THREE.PointsMaterial({ color:0xffffff, size:.05, transparent:true, opacity:.35 }));
    this.scene.add(this.stars);

    this.grid = new THREE.GridHelper(9, 28, 0x88aaff, 0x3355aa);
    this.grid.position.y = -1.3; this.grid.material.transparent = true; this.grid.material.opacity = 0.1;
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
               // SURF lighting: 1 = on (surface mode), 0 = off (wireframe/points).
               // Starts at 0 because startup mode is wireframe.
               uLighting:     { value: 0   },
             };
    this.gpuMat  = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.U,
      side: THREE.DoubleSide,
      // dFdx/dFdy in the fragment shader need GL_OES_standard_derivatives on WebGL1.
      // No-op on WebGL2 where derivatives are core. Three.js wires the extension
      // string into the compiled source when this flag is set.
      extensions: { derivatives: true },
    });
    this.gpuMesh = new THREE.Mesh(gpuGeo, this.gpuMat);
    this.scene.add(this.gpuMesh);
    this.gpuPtsProxy = null;

    // ── Shape state ───────────────────────────────────────────────────────────
    // Startup shape: pyramid-smooth (matches HTML default + RESET ALL target).
    // Initialize as 'plane' first so setShape() has valid prior state, then swap.
    this.currentShape    = 'plane';
    this.solarPlanets    = [];
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
    };

    // ── Transition system ─────────────────────────────────────────────────────
    this.transitions = new TransitionManager();
    // Durations (ms) — shorter on mobile to stay within GPU budget
    this._tDurShape  = isMobile ? 300 : 400;   // half the morph (deflate or inflate)
    this._tDurMode   = isMobile ? 600 : 1200;  // GPU mode crossfade
    this._tDurColor  = isMobile ? 300 : 600;   // color scheme crossfade
    this._tDurCPU    = isMobile ? 400 : 800;   // CPU formula blend
    this._tDurCamera = isMobile ? 600 : 1000;  // preset-driven camera tween (default)

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
  }

  // ── Uniforms ─────────────────────────────────────────────────────────────────
  updateUniforms(time, audio) {
    // Advance all in-flight transitions first
    this.transitions.tick();

    this.U.uTime.value   = time;
    this.U.uBass.value   = audio.bass   * audio.bassSens;
    this.U.uMid.value    = audio.mid;
    this.U.uTreble.value = audio.treble * audio.trebleSens;
    this.U.uBeat.value   = audio.beatInt
    this.U.uAmp.value    = audio.amp;
    this.U.uWI.value     = audio.waveInt;
    // uCM is NOT updated here during a color crossfade — setColorSchemeAnimated()
    // manages uCM/uCMNext/uCMBlend directly.

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
   * If called while a morph is already running, the in-flight tween is
   * cancelled and the geometry is swapped immediately so the new shape starts
   * inflating without waiting for the old deflate to finish.
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
    // Cancel any in-flight morph
    this.transitions.start('morph-deflate', 0, () => {});
    this.transitions.start('morph-inflate', 0, () => {});
    this.U.uMorphProgress.value = 1.0;

    const dur = this._tDurShape;

    this.transitions.start('morph-deflate', dur, p => {
      this.U.uMorphProgress.value = 1.0 - p;
    }, () => {
      this.U.uMorphProgress.value = 0.0;
      if (onFlat) onFlat();

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
   * Interrupt-safe: if called mid-fade, the current blend value is inherited
   * so the visual stays continuous.
   *
   * @param {number} mode — integer mode index
   */
  setGPUModeAnimated(mode) {
    // Inherit current blend position so interrupts look continuous
    const startBlend = this.U.uModeBlend.value;
    // Mid-fade: the "from" is now wherever the blend currently sits
    if (startBlend > 0) {
      this.U.uMode.value     = this.U.uModeNext.value;
      this.U.uModeBlend.value = 0.0;
    }
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
   * @param {number} cm — target color scheme index
   */
  setColorSchemeAnimated(cm) {
    const startBlend = this.U.uCMBlend.value;
    if (startBlend > 0) {
      this.U.uCM.value      = this.U.uCMNext.value;
      this.U.uCMBlend.value = 0.0;
    }
    this.U.uCMNext.value  = cm;

    this.transitions.start('color', this._tDurColor, p => {
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
   * Auto-rotate is paused for the tween's duration so the camera physics
   * loop doesn't fight with our position writes. Restored on completion.
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
    }, opts.easing);
  }

  updateLights(time, audio) {
    const { bass, mid, beatInt, beatPunch } = audio;
    this.magicLight.position.x = 1.8 + Math.sin(time*.6)*1.3;
    this.magicLight.position.z = 1.5 + Math.cos(time*.7)*1.6;
    this.magicLight.intensity  = .5 + Math.sin(time*1.1)*.18 + Math.min(1,bass)*.5;
    this.fillLight.intensity   = .4 + Math.sin(time*.8)*.1  + Math.min(1,mid)*.3;
    this.beatLight.intensity   = beatInt * 2.0 * beatPunch;
    this.stars.rotation.y      = time * .015;

    // Update God Rays light position to track magicLight in screen space
    if (this.godRaysPass.enabled) {
      this._updateGodRaysLightPos(this.magicLight.position);
    }

    // Update motion blur velocity from camera movement
    if (this.motionBlurPass.enabled) {
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

  // ── Viz modes ────────────────────────────────────────────────────────────────
  setVizModeGPU(mode) {
    this.vizMode = mode;
    if (this.gpuPtsProxy) { this.scene.remove(this.gpuPtsProxy); this.gpuPtsProxy.geometry.dispose(); this.gpuPtsProxy = null; }
    this.gpuMesh.visible  = true;
    this.gpuMat.wireframe = false;
    this.U.uPointSize.value = 1.0;
    // SURF lighting is only meaningful on filled surfaces. Wireframe has no
    // surface area for derivatives to sample; points are single-pixel quads
    // where dFdx/dFdy of vWorldPos is degenerate. Turn lighting off for both.
    this.U.uLighting.value = (mode === 'surface') ? 1 : 0;
    if (mode === 'wireframe') {
      this.gpuMat.wireframe = true;
    } else if (mode === 'points') {
      this.gpuMesh.visible = false;
      this.U.uPointSize.value = 5.0;
      const ptsMat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS, uniforms: this.U,
        side: THREE.DoubleSide,
        // Shares uniforms (including uLighting=0) with gpuMat — extension flag
        // still needed because Three.js compiles per-material.
        extensions: { derivatives: true },
      });
      this.gpuPtsProxy = new THREE.Points(this.gpuMesh.geometry, ptsMat);
      this.scene.add(this.gpuPtsProxy);
    }
  }

  // ── Shape switching ──────────────────────────────────────────────────────────
  /**
   * Instant geometry swap (no animation). Used internally by setShapeAnimated()
   * at the flat frame, and directly by code that doesn't need the morph effect
   * (initial load, solar system).
   */
  setShape(shape) {
    if (this.isShapeChanging) { this.pendingShape = shape; return; }
    this.isShapeChanging = true;
    this.currentShape    = shape;
    this.clearSolarSystem();

    const newGeo = this._buildShapeGeo(shape);
    if (['plane','circle','disc','hex'].includes(shape)) newGeo.rotateX(-Math.PI/2);

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
      case 'sphere':           return new THREE.SphereGeometry(3.5, seg, seg);
      case 'box':              return new THREE.BoxGeometry(5,5,5, lo,lo,lo);
      case 'cylinder':         return new THREE.CylinderGeometry(2.5,2.5,5, lo,lo);
      case 'cone':             return new THREE.ConeGeometry(3.2,5.5, lo,lo);
      case 'disc':             return new THREE.CylinderGeometry(3.5,3.5,.08, lo,lo);
      case 'ring':             return new THREE.TorusGeometry(3.0,.35, 24, seg);
      case 'circle':           return new THREE.CircleGeometry(3.5, seg);
      case 'torus':            return new THREE.TorusGeometry(2.8,1.1, 80, seg);
      case 'torusknot':        return new THREE.TorusKnotGeometry(2.2,.65, seg*2, 16, 2, 3);
      case 'hex':              return new THREE.CylinderGeometry(3.2,3.2,.5, 6, lo);
      case 'pyramid':          return new THREE.ConeGeometry(3.2,5, 4, lo);
      case 'pyramid-smooth':   return new THREE.ConeGeometry(3.2,5, lo, lo);
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
      default:                 return new THREE.PlaneGeometry(this.CFG.planeSize, this.CFG.planeSize, seg, seg);
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
  _buildSolarSystem() {
    const planets = [
      { r:.28, dist:2.0, speed:1.8, color:0x888888, craters:true  },
      { r:.45, dist:3.0, speed:1.2, color:0xddaa66, craters:false },
      { r:.50, dist:4.2, speed:0.9, color:0x3399ff, craters:false },
      { r:.30, dist:5.5, speed:0.7, color:0xff4422, craters:true  },
      { r:.90, dist:7.2, speed:0.4, color:0xffcc88, craters:false },
      { r:.72, dist:9.0, speed:0.3, color:0xaaddcc, craters:false, rings:true },
    ];
    planets.forEach(pd => {
      const pivot = new THREE.Object3D(); this.scene.add(pivot);
      const pg  = new THREE.SphereGeometry(pd.r, 32, 32);
      const pm  = new THREE.MeshStandardMaterial({ map: _makePlanetTexture(pd.color, pd.craters),
        roughness: .65+Math.random()*.2, metalness: .05+Math.random()*.1 });
      const mesh = new THREE.Mesh(pg, pm);
      mesh.position.set(pd.dist, 0, 0); pivot.add(mesh);
      if (pd.rings) {
        const rg  = new THREE.TorusGeometry(pd.r*1.85, pd.r*.28, 3, 64);
        const rm  = new THREE.MeshStandardMaterial({ color:0xc8b080, roughness:.9, metalness:.05, side:THREE.DoubleSide, transparent:true, opacity:.75 });
        const ring = new THREE.Mesh(rg, rm);
        ring.rotation.x = Math.PI*.42; mesh.add(ring);
      }
      this.solarPlanets.push({ pivot, mesh, speed: pd.speed });
    });
  }

  clearSolarSystem() {
    this.solarPlanets.forEach(p => {
      p.mesh.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
      this.scene.remove(p.pivot);
      p.mesh.geometry.dispose(); p.mesh.material.dispose();
    });
    this.solarPlanets = [];
  }

  updateSolarSystem(bass) {
    if (this.currentShape !== 'solar') return;
    this.solarPlanets.forEach(p => { p.pivot.rotation.y += .005 * p.speed * (1 + bass * 1.5); });
  }

  // ── Misc ──────────────────────────────────────────────────────────────────────
  disposeCPUResources() {
    if (this.cpuMesh)     { this.scene.remove(this.cpuMesh); this.cpuMesh.geometry?.dispose(); this.cpuMesh.material?.dispose(); this.cpuMesh = null; }
    if (this.cpuPts)      { this.scene.remove(this.cpuPts);  this.cpuPts.geometry?.dispose();  this.cpuPts.material?.dispose();  this.cpuPts  = null; }
    if (this.gpuPtsProxy) { this.scene.remove(this.gpuPtsProxy); this.gpuPtsProxy.geometry?.dispose(); this.gpuPtsProxy.material?.dispose(); this.gpuPtsProxy = null; }
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
   * Performance tier for gating effect quality.
   *   'low'    = mobile / WebGL1
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
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  /** Toggle transparent background for alpha-channel output (chroma-key free). */
  setTransparentBackground(enabled) {
    this.transparentBg = enabled;
    if (enabled) {
      this.scene.background = null;
      this.scene.fog        = null;
      this.renderer.setClearColor(0x000000, 0);
      this.stars.visible = false;
      this.grid.visible  = false;
    } else {
      this.scene.background = new THREE.Color(0x050515);
      this.scene.fog        = new THREE.FogExp2(0x050515, 0.007);
      this.renderer.setClearColor(0x050515, 1);
      this.stars.visible = true;
      this.grid.visible  = true;
    }
  }

  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }

  // ═══════════════════════════════════════════════════════════════════════════
  // Post-processing FX — public control API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Chromatic Aberration — RGB lens dispersion toward frame edges.
   * @param {boolean} enabled
   * @param {number}  strength  0.001 (subtle) – 0.008 (heavy). Default 0.003.
   */
  setChromaticAberration(enabled, strength = 0.003) {
    this.chromaticPass.enabled = enabled;
    if (enabled) {
      this.chromaticPass.uniforms.uStrength.value = Math.max(0, strength);
    }
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
    this.afterimagePass.enabled = enabled;
    if (enabled) {
      // AfterimagePass exposes its uniform as 'damp'
      this.afterimagePass.uniforms['damp'].value = Math.min(0.98, Math.max(0.0, amount));
    }
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
    this.godRaysPass.enabled = enabled;
    if (enabled) {
      this.godRaysPass.uniforms.uExposure.value  = Math.max(0, intensity);
      this.godRaysPass.uniforms.uDecay.value     = Math.min(0.99, Math.max(0.8, decay));
      this.godRaysPass.uniforms.uThreshold.value = Math.max(0, threshold);
    }
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
    this.motionBlurPass.enabled = enabled;
    if (enabled) {
      this.motionBlurPass.uniforms.uAmount.value = Math.max(0, amount);
      this._mbClampSpeed = Math.max(0.005, maxSpeed);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Post-processing FX — internal per-frame helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Project a world-space point to screen UV (0–1) and write it into the
   * God Rays light position uniform. Called from updateLights() using
   * magicLight.position, or manually for a custom light source.
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
   * Motion Blur is enabled.
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
    if (this.godRaysPass.enabled) this._updateGodRaysLightPos(worldPos);
  }
}
