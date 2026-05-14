// camera.js — automated camera motion for the visualizer.
//
// CameraSystem owns the orbit camera and exposes three layered behaviours:
//
//   1. Built-in physics modes (updatePhysics): hand-tuned numerical models
//      keyed by `camPhysics` — dark_matter (slow orbit, gentle vertical
//      drift), cosmos (free-floating with audio-coupled velocity), and
//      moon (hopping orbit). These run when auto-rotate is on and no
//      programmer script is active.
//
//   2. Camera programmer (loadScript / runScript): a user-supplied
//      JavaScript snippet compiled via `new Function`. It receives a `ctx`
//      bag with audio values, math helpers, an orbit() shortcut, and
//      writable camera state. This is the intentional eval surface — like
//      Shadertoy or codepen, it lets the user script motion live. Errors
//      surface through onScriptStatus and disarm the script rather than
//      throw up the stack.
//
//   3. Keyframes timeline (cpKeyframes): pairs of { t∈[0,1], code }. Before
//      each runScript() tick, the latest keyframe whose t is ≤ elapsed
//      track fraction is evaluated as a "pre-script" that may mutate ctx.
//      The main script then runs on top of that, so keyframe code sets
//      parameters and the main script reacts.
//
// ── Manual user interaction ───────────────────────────────────────────────
// When the user grabs the camera with the mouse, controls.js sets
// `userInt = true` for the duration of the interaction. Both updatePhysics
// and runScript no-op while that flag is held — the user's manual orbit
// must not fight automated motion.
//
// ── DOM-free by design ────────────────────────────────────────────────────
// CameraSystem doesn't reach into the DOM. Everything UI-shaped (editor
// open, script status badge, timeline render, code-pane updates) goes
// through the cb.* callbacks, which UIController wires up. Keeps the camera
// logic unit-testable in Node and decouples the timeline persistence from
// any particular DOM layout.

// ── Camera programmer: default code shown when the editor opens ──────────
// This template is user-facing — it appears verbatim in the code pane on
// first open and after Reset. The leading comment teaches the available
// names; edits here are visible to every user, so prefer additions over
// renames.
const CP_DEFAULT = `// p = PARAMS tab  state = persistent object  ctx.cam/target writable
// — Wow flight: orbit + climb/dive + bank turns + beat punch —
state.phase = (state.phase || 0) + 0.012 + bass * 0.018;

// Vertical sweep: oscillates from low to high. pow() shapes the curve
// so it lingers at top & bottom for a moment before snapping back.
const sweep = sin(state.phase * 0.6);
const h     = clamp(p.height + pow(abs(sweep), 0.7) * 5.5 * (sweep >= 0 ? 1 : -1), 1.0, 9.5);

// Lateral maneuvers: orbit radius breathes on a different frequency
// so left/right swings don't sync with up/down — feels improvised.
const widen = 1 + sin(state.phase * 0.43) * 0.3;

// Beat punch: short radial dash on every detected beat. Tight decay
// keeps it from accumulating under fast tempos.
state.dash = (state.dash || 0) * 0.55 + beat * 0.4;
const r    = clamp(p.radius * widen - state.dash, p.radius * 0.55, p.radius * 1.4);

orbit(r, p.rotSpeed * (1 + bass * p.bassReact) * 1.8, h);

// Target sways opposite of camera for parallax + tracks bass on Y.
ctx.target.x = -sin(state.phase * 0.43) * 0.6;
ctx.target.y = 0.2 + mid * 0.5 + sweep * 0.4;

// FOV breathing + beat zoom-out for punch.
ctx.fov  = lerp(ctx.fov, p.fov + 8 + beat * 14 + bass * 6, 0.15);

// Bank into the turn like a plane in a virage. Direction follows the
// derivative of horizontal motion (cos), magnitude grows with bass.
ctx.roll = cos(state.phase * 0.43) * (0.12 + bass * 0.18 + p.roll);`;

// ── Camera programmer: shipped preset gallery ────────────────────────────
// Each entry is { name, code } where `code` is loaded straight into the
// editor when the user clicks the preset. Names start with an emoji so the
// gallery scans at a glance. The strings use literal "\n" because the
// editor splits on newlines for line-numbering — escape sequences in
// template literals keep that explicit.
const CP_PRESETS = [
  { name:'🎬 Cinematic',  code:`const dolly=lerp(state.dolly||1,1+bass*.6,.08);state.dolly=dolly;\norbit(p.radius*1.3/dolly,p.rotSpeed*.5,p.height*.7+sin(time*.05)*1.5+bass*1.2);\nctx.target.y=0.3+bass*.5+sin(time*.08)*.2;\nctx.target.x=sin(time*.04)*.3;\nctx.fov=lerp(ctx.fov,42-bass*10+beat*8,0.08);\nctx.roll=sin(time*.12)*.05+bass*.04;` },
  { name:'⚡ Reactive',   code:`orbit(p.radius,p.rotSpeed*(1+bass*4),p.height+bass*2);\nstate.shake=(state.shake||0)*.7+beat*.4;\nctx.cam.x+=(Math.random()-.5)*state.shake;\nctx.cam.z+=(Math.random()-.5)*state.shake;\nctx.fov=lerp(ctx.fov,p.fov+beat*18,0.18);\nctx.target.y=bass*.6;` },
  { name:'🌊 Float',      code:`state.phase=(state.phase||0)+.008+bass*.004;\nstate.wave=(state.wave||0)*.92+beat*.7;\nconst h=clamp(p.height+sin(state.phase*.7)*2.2+sin(state.phase*.31)*1.1+state.wave*.8,1.0,9.5);\norbit(p.radius*(1+sin(state.phase*.5)*.25),p.rotSpeed*(1+bass*.5),h);\nctx.target.y=sin(time*.06)*.4+state.wave*.3;\nctx.target.x=cos(state.phase*.5)*.4;\nctx.fov=42+sin(state.phase*.4)*8+state.wave*4;\nctx.roll=sin(state.phase*.35)*.15+bass*.08;` },
  { name:'🎡 Spiral',     code:`state.rMod=lerp(state.rMod||p.radius,beat?p.radius*.35:p.radius*1.05,0.08);\nstate.spin=(state.spin||1)*.95+beat*.6;\nconst h=clamp(p.height+sin(time*.5)*2.5+beat*1.5,1.0,9.5);\norbit(state.rMod,p.rotSpeed*(3+state.spin*4),h);\nctx.target.y=treble*.5+beat*.3;\nctx.target.x=sin(time*.2)*.5;\nctx.fov=lerp(ctx.fov,55+beat*22+bass*8,0.15);\nctx.roll=sin(time*.4)*.18+state.spin*.05;` },
  { name:'🔭 Telescope',  code:`orbit(p.radius*.45,p.rotSpeed*.2,1.2+bass*.8);\nctx.fov=lerp(ctx.fov,22+treble*12,0.04);\nctx.target.y=0.05;\nctx.roll=sin(time*.08)*.02;` },
  { name:'🎢 Roller',     code:`state.t=(state.t||0)+.006+bass*.008;\nctx.cam.x=sin(state.t)*p.radius;\nctx.cam.y=1.5+Math.pow(Math.abs(sin(state.t*.5)),2)*5;\nctx.cam.z=cos(state.t)*p.radius;\nctx.fov=70+bass*15;\nctx.roll=sin(state.t*2)*.3*p.roll;` },
  { name:'🌑 Dark Matter',code:`state.spiral=(state.spiral||0)+p.rotSpeed*60+bass*.02;\nconst pull=lerp(state.pull||1,1-bass*.3,.06);state.pull=pull;\nconst rad=p.radius*pull*(1+sin(state.spiral*.13)*.2);\nctx.cam.x=sin(state.spiral)*rad;\nctx.cam.y=p.height+sin(state.spiral*.27)*1.8+cos(state.spiral*.41)*.9;\nctx.cam.z=cos(state.spiral)*rad;\nctx.target.x=cos(state.spiral*.5)*treble*.4;\nctx.target.y=0.1+bass*.3;\nctx.fov=lerp(ctx.fov,p.fov+bass*12-treble*4,0.1);\nctx.roll=sin(state.spiral*.7)*.1*bass;` },
  { name:'🌙 Moon',       code:`state.phase=(state.phase||0)+.018+bass*.008;\nconst hop=Math.pow(Math.abs(sin(state.phase*.38)),.6)*2.6;\nconst sway=cos(state.phase*.76)*.12;\norbit(p.radius*1.1+sway,p.rotSpeed*.6,1.1+hop);\nctx.target.x=sway*.5;\nctx.target.y=.05+hop*.04;` },
];

// ── CameraSystem ──────────────────────────────────────────────────────────────
export class CameraSystem {
  constructor(camera, orbitControls, CFG) {
    this.camera = camera;
    this.orbit  = orbitControls;
    this.CFG    = CFG;

    // Orbit angle is shared between physics modes and the programmer's
    // orbit() helper; keeping it on `this` lets a script-mode session
    // resume from wherever physics left it (and vice versa).
    this.rotAngle  = 0;
    // autoRot defaults OFF so the camera holds still until the user opts
    // in via the AUTO-ROTATE button. A spinning startup view was reported
    // as disorienting before any audio is loaded.
    this.autoRot   = false;
    // Set by controls.js while the user is dragging the orbit camera.
    // updatePhysics and runScript both bail out while this is true so
    // automated motion can't fight the user's mouse.
    this.userInt   = false;

    // ── Built-in physics state ──────────────────────────────────────────
    // The three modes share rotAngle but each carries its own auxiliary
    // state. We never zero these on mode entry except through setCamPhysics,
    // which re-seeds from the current camera position for a continuous
    // visual transition.
    this.camPhysics       = 'dark_matter';
    this.cosmosVelY       = 0;
    this.cosmosPosY       = 3.2;
    this.cosmosTargetY    = 0;
    this.cosmosTargetYVel = 0;
    this.moonPhase        = 0;
    this.moonPosY         = 2.2;

    // ── Camera programmer state ─────────────────────────────────────────
    // cpFn is the compiled user function or null. cpParams is the live
    // PARAMS-tab object — references are kept stable so the editor's
    // sliders can mutate it in place and the next tick picks the change
    // up automatically. _cpState is the "persistent object" exposed to
    // scripts as `state`; reset whenever a new script loads.
    this.cpActive     = false;
    this.cpFn         = null;
    this.cpParams     = { rotSpeed:.00002, radius:7.2, height:3.2, gravity:.0004, bassReact:1.0, damping:.996, fov:45, roll:0 };
    this.cpKeyframes  = [];
    this.cpSelectedKf = null;
    this._cpState     = { velY:0, phase:0 };

    // BPM hint fed in from main.js each frame; exposed to scripts as ctx.bpm.
    this.estimatedBpm = 120;

    // ── Callbacks ───────────────────────────────────────────────────────
    // CameraSystem holds zero DOM references. Everything UI-shaped flows
    // through here and UIController wires the actual handlers in
    // modals.js. No-op defaults mean methods like resetScript() can fire
    // before the UI has attached without an undefined-call crash.
    this.cb = {
      onScriptStatus:   (_type, _msg)          => {},
      onSetCode:        (_code)                => {},
      onSwitchToCode:   ()                     => {},
      onOpenEditor:     (_defaultCode, _pres)  => {},
      onTimelineRender: (_keyframes, _sel)     => {},
      onPlayheadUpdate: (_fraction)            => {},
      onAutoRotChanged: (_enabled)             => {},
    };
  }

  // ── Built-in physics ──────────────────────────────────────────────────────
  //
  // Three hand-tuned models, each picked for a different musical feel:
  //
  //   cosmos      — slow free-floating drift, vertical velocity damped at
  //                 0.996 per frame so impulses fade over ~250 frames.
  //                 The target itself wanders along a separate damped
  //                 random-walk; combined effect is "weightless".
  //   moon        — sinusoidal hop (raised |sin|^0.6 for a bounce shape)
  //                 layered on a slow orbit. Lateral sway via cos at a
  //                 different period keeps the path non-circular.
  //   dark_matter — default; constant slow rotation with a tiny vertical
  //                 wobble. Stable enough to leave running in the background.
  //
  // All three are intentional dead-reckoning: there is no integration error
  // budget. Numbers are tuned by eye and any constant change will shift
  // the visible feel — adjust with care.
  updatePhysics(time, bass) {
    if (!this.autoRot || this.userInt) return;
    const r0 = this.CFG.autoRotRadius;
    if (this.camPhysics === 'cosmos') {
      this.rotAngle += 0.000006 + bass * 0.000003;
      this.cosmosVelY += Math.sin(time*.11)*.0006 + Math.cos(time*.07)*.0004 + (bass-.3)*.001;
      this.cosmosVelY *= 0.996;
      this.cosmosPosY = Math.max(1.2, Math.min(7.5, this.cosmosPosY + this.cosmosVelY));
      this.cosmosTargetYVel = (this.cosmosTargetYVel + Math.sin(time*.08)*.0003) * .99;
      this.cosmosTargetY    = Math.max(-.4, Math.min(.6, this.cosmosTargetY + this.cosmosTargetYVel));
      const cr = r0*1.55 + Math.sin(time*.05)*.4;
      this.camera.position.set(Math.sin(this.rotAngle)*cr, this.cosmosPosY, Math.cos(this.rotAngle)*cr);
      this.orbit.target.set(Math.sin(time*.04)*.25, this.cosmosTargetY, Math.cos(time*.06)*.25);
    } else if (this.camPhysics === 'moon') {
      this.rotAngle  += 0.000012 + bass * 0.000006;
      this.moonPhase += 0.018    + bass * 0.008;
      const hop  = Math.pow(Math.abs(Math.sin(this.moonPhase*.38)), .6) * 2.6;
      const sway = Math.cos(this.moonPhase*.76) * .12;
      this.camera.position.set(Math.sin(this.rotAngle)*(r0*1.1+sway), 1.1+hop, Math.cos(this.rotAngle)*(r0*1.1+sway));
      this.orbit.target.set(sway*.5, .05+hop*.04, 0);
    } else {
      this.rotAngle += 0.00002;
      this.camera.position.set(Math.sin(this.rotAngle)*r0, 3.2+Math.sin(this.rotAngle*.3)*.6, Math.cos(this.rotAngle)*r0);
      this.orbit.target.set(0, .1, 0);
    }
    this.orbit.update();
  }

  /**
   * Switch physics mode. Re-seeds the mode's auxiliary state from the
   * current camera position so the transition is visually continuous
   * (cosmos starts where the camera is, moon resets phase to zero).
   * Also enables auto-rotate as a side effect — picking a mode implies
   * the user wants automated motion.
   */
  setCamPhysics(mode) {
    this.camPhysics = mode;
    if (mode === 'cosmos') { this.cosmosPosY = this.camera.position.y; this.cosmosVelY = 0; this.cosmosTargetY = 0; this.cosmosTargetYVel = 0; }
    if (mode === 'moon')   { this.moonPhase = 0; this.moonPosY = this.camera.position.y; }
    this.autoRot = true;
    this.cb.onAutoRotChanged(true);
  }

  // ── Camera programmer ─────────────────────────────────────────────────────

  /**
   * Compile and arm a user-supplied script. The string is wrapped in a
   * destructuring preamble that injects ctx properties as local names,
   * giving the script `time`, `bass`, `orbit(...)`, etc. directly.
   *
   * Compilation uses `new Function`, which evaluates user JavaScript at
   * full privilege within this origin. This is intentional: the camera
   * editor is a coding surface, mirroring the shader editor. The trade-off
   * is that a malicious script could touch any global; mitigations are
   * (a) the editor only loads scripts the user typed or saved themselves,
   * (b) the script can only run while auto-rotate is on. We do not attempt
   * to sandbox — that would mean blocking access to Math etc. and turn the
   * editor into an unusable subset.
   *
   * Parse errors update the status badge and leave cpActive=false; runtime
   * errors are caught per-tick in runScript().
   */
  loadScript(code) {
    this.cb.onScriptStatus('clear', '');
    try {
      this.cpFn = new Function('ctx', `const {time,bass,mid,treble,beat,bpm,R,cam,target,state,p,sin,cos,abs,pow,lerp,clamp,orbit}=ctx; ${code}`);
      this.cpActive  = true;
      this._cpState  = { velY:0, phase:0 };
      this.cb.onScriptStatus('ok', '✔ Running');
      setTimeout(() => this.cb.onScriptStatus('clear', ''), 2000);
    } catch (e) {
      this.cb.onScriptStatus('error', '⚠ Parse: ' + e.message);
      this.cpActive = false;
    }
  }

  /**
   * Disarm script mode and return to built-in physics. Also resets FOV
   * and roll because scripts commonly mutate them; without the reset the
   * camera would carry the script's final FOV/roll into physics mode.
   */
  resetScript() {
    this.cpActive = false; this.cpFn = null; this._cpState = {};
    this.cb.onSetCode(CP_DEFAULT);
    this.cb.onScriptStatus('clear', '');
    this.camera.fov = 45; this.camera.updateProjectionMatrix();
    this.camera.rotation.z = 0;
    this.setCamPhysics('dark_matter');
  }

  /**
   * Per-frame evaluation of the active script. Builds the ctx bag once,
   * runs the active keyframe (if any) as a pre-script, then the main
   * script. Both can mutate ctx.cam / ctx.target / ctx.fov / ctx.roll /
   * ctx.rotAngle; we copy the final values back onto the three.js camera
   * and orbit controls afterwards.
   *
   * Errors in either script flip cpActive off — a script that throws
   * every frame would otherwise flood the console and steal frame budget.
   * Keyframe errors are swallowed silently because they're usually
   * transient (still being edited); main-script errors surface to the
   * status badge so the user sees what broke.
   */
  runScript(time, bass, mid, treble, beatInt) {
    if (!this.cpFn || !this.autoRot || this.userInt) return;

    const ctx = {
      time, bass, mid, treble,
      // beat is a 0/1 gate derived from a continuous beat intensity. The
      // 0.7 threshold matches what feels like "the beat" without firing
      // on every low-volume transient.
      beat: beatInt > 0.7 ? 1 : 0,
      bpm:  this.estimatedBpm,
      R:    this.CFG.autoRotRadius,
      // cam / target are *copies* — scripts write to ctx.cam.x etc. and we
      // assign back to the real camera after the script returns. This
      // means a script can read its own "previous" frame's values via
      // `state` but not via ctx.cam (which is fresh each tick).
      cam:    { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      target: { x: this.orbit.target.x,    y: this.orbit.target.y,    z: this.orbit.target.z    },
      fov:    this.camera.fov,
      roll:   0,
      state:  this._cpState,
      rotAngle: this.rotAngle,
      p:      this.cpParams,
      sin: Math.sin, cos: Math.cos, abs: Math.abs, pow: Math.pow,
      lerp:  (a,b,t) => a + (b-a)*t,
      clamp: (v,lo,hi) => Math.max(lo, Math.min(hi,v)),
      // orbit() helper writes camera-frame coordinates from polar inputs.
      // Sharing rotAngle through ctx (not `this`) lets scripts use orbit()
      // alongside their own rotation logic without fighting it.
      orbit: (radius, speed, height) => {
        ctx.rotAngle += speed;
        ctx.cam.x = Math.sin(ctx.rotAngle) * radius;
        ctx.cam.y = height;
        ctx.cam.z = Math.cos(ctx.rotAngle) * radius;
      },
    };

    // Keyframe pre-script. Compiled per-tick (cheap for small snippets;
    // not worth caching by string identity given the editor rewrites them
    // frequently). Errors are swallowed because the user is usually mid-edit.
    const kfCode = this._resolveKeyframe(this._kfT ?? 0);
    if (kfCode) try { new Function('ctx', `const {time,bass,mid,treble,beat,bpm,R,cam,target,state,p,sin,cos,abs,pow,lerp,clamp,orbit}=ctx; ${kfCode}`)(ctx); } catch (_) {}

    try {
      this.cpFn(ctx);
    } catch (e) {
      this.cb.onScriptStatus('error', '⚠ ' + e.message);
      this.cpActive = false; return;
    }

    // Commit ctx back to camera / orbit. FOV is clamped because a runaway
    // script writing fov=99999 used to lock the projection matrix into
    // an unrecoverable state; clamp keeps the picture usable while the
    // user fixes the typo.
    if (typeof ctx.rotAngle === 'number') this.rotAngle = ctx.rotAngle;
    this.camera.position.set(ctx.cam.x, ctx.cam.y, ctx.cam.z);
    this.orbit.target.set(ctx.target.x, ctx.target.y, ctx.target.z);
    if (ctx.fov !== this.camera.fov) { this.camera.fov = Math.max(10, Math.min(160, ctx.fov)); this.camera.updateProjectionMatrix(); }
    if (ctx.roll) this.camera.rotation.z = ctx.roll;
    this.orbit.update();
  }

  /**
   * Find the active keyframe at a given track fraction. The "active"
   * keyframe is the latest one whose t is ≤ elapsedFraction — i.e. the
   * one we've most recently passed. Returns null when no keyframes exist
   * or none have triggered yet.
   *
   * Sorts on every call rather than maintaining a sorted invariant
   * elsewhere; the array is small (typically <20 entries) and edits go
   * through the editor UI, not hot-path code.
   */
  _resolveKeyframe(elapsedFraction = 0) {
    if (!this.cpKeyframes.length) return null;
    const sorted = [...this.cpKeyframes].sort((a,b) => a.t - b.t);
    let active = null;
    for (const kf of sorted) { if (kf.t <= elapsedFraction) active = kf; }
    return active?.code ?? null;
  }

  /**
   * Stash the current track fraction so runScript() can pick the right
   * keyframe on its next tick. Decoupled from runScript signature because
   * the fraction comes from the audio engine, not the per-frame inputs.
   */
  setElapsedForKeyframe(elapsedFraction) {
    this._kfT = elapsedFraction;
  }

  // ── Timeline ──────────────────────────────────────────────────────────────

  /**
   * Insert a keyframe at the given track fraction, capturing the current
   * editor code. t is clamped to [0, 1] because the timeline UI doesn't
   * accept out-of-range positions and we don't want corrupt data to flow
   * in via preset import either.
   */
  addKeyframeAtPlayhead(code, elapsedFraction) {
    this.cpKeyframes.push({ t: Math.max(0, Math.min(1, elapsedFraction)), code });
    this.cpSelectedKf = this.cpKeyframes[this.cpKeyframes.length - 1];
    this.buildTimeline();
  }

  /** Make a keyframe current: load its code into the editor and refocus the code pane. */
  selectKeyframe(kf) {
    this.cpSelectedKf = kf;
    this.cb.onSetCode(kf.code);
    this.cb.onSwitchToCode();
    this.buildTimeline();
  }

  /** Remove the keyframe at the given index in the sorted display order. */
  deleteKeyframe(idx) {
    this.cpKeyframes.splice(idx, 1);
    if (!this.cpKeyframes.includes(this.cpSelectedKf)) this.cpSelectedKf = null;
    this.buildTimeline();
  }

  /** Ask UIController to repaint the timeline DOM with the current keyframes. */
  buildTimeline() {
    this.cb.onTimelineRender(this.cpKeyframes, this.cpSelectedKf);
  }

  /** Move the visible playhead. Called every frame while the editor is open. */
  updatePlayhead(elapsedFraction) {
    this.cb.onPlayheadUpdate(elapsedFraction);
  }

  // ── Editor open ───────────────────────────────────────────────────────────

  /** Open the camera-programmer editor with the default code + preset gallery. */
  openEditor() {
    this.cb.onOpenEditor(CP_DEFAULT, CP_PRESETS);
    this.buildTimeline();
  }

  /** Default starter code, exposed for callers that need to seed a new editor instance. */
  getDefaultCode() { return CP_DEFAULT; }
}
