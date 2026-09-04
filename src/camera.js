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

// ── Field of view: the one set of bounds ──────────────────────────────────
// A runaway fov locks the projection matrix into a state the user cannot get
// out of by fixing what caused it (see runScript's commit below). Every path
// that writes camera.fov from a value we did not compute ourselves — a
// programmer script, a preset snapshot — narrows it through here, so there is
// one rule rather than two that can drift apart.
//
// NOT a guard: clampFov(NaN) is NaN. Callers must establish Number.isFinite
// first, exactly as the commit below does with keep().
const FOV_MIN = 10;
const FOV_MAX = 160;
export const clampFov = fov => Math.max(FOV_MIN, Math.min(FOV_MAX, fov));

// ── CameraSystem ──────────────────────────────────────────────────────────────
// FIX(r11): the eight knobs a camera script reads as p.*. They used to exist
// only as an object literal in the constructor, so nothing could put them back:
// RESET ALL sweeps the PARAMS registry, and exactly one of the eight —
// rotSpeed — has an entry there, while resetScript() reset cpActive, cpFn,
// cpSource, fov and roll and left cpParams alone. Seven of eight survived the
// button that says it resets everything, carrying a previous script's radius,
// height, gravity, damping, bassReact and roll into the next one.
const CP_DEFAULT_PARAMS = Object.freeze({
  rotSpeed: 0.00002, radius: 7.2, height: 3.2, gravity: 0.0004,
  bassReact: 1.0, damping: 0.996, fov: 45, roll: 0,
});

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
    // Held true by whoever is tweening the camera (preset and clip applies,
    // through RenderEngine.tweenCameraTo). Automated motion stands down while
    // it is up, the same way it does for userInt — but unlike autoRot this is
    // not a user setting, so a tween can borrow the camera without changing
    // what the AUTO-ROTATE button reports. Flipping autoRot for this is what
    // used to make the button do the opposite of its own label mid-clip.
    this.tweenHold = false;
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
    // FIX: source of the script behind cpFn. #ce-code cannot stand in for it —
    // the preset gallery and selectKeyframe both overwrite the textarea without
    // loading anything, so a snapshot built from it recorded a script the user
    // was merely reading. Kept here because loadScript otherwise retains only
    // the compiled function and the text is unrecoverable from it.
    this.cpSource     = null;
    this.cpParams     = { ...CP_DEFAULT_PARAMS };
    this.cpKeyframes  = [];
    this.cpSelectedKf = null;
    this._cpState     = { velY:0, phase:0 };
    // FIX(#13, r2): bank angle (radians) the last runScript() tick asked for —
    // absolute, never accumulated. Kept as state instead of applied on the spot:
    // the main loop's next orbit.update() would erase it (see applyRoll()).
    this.cpRoll       = 0;

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
      // Fired when something other than the sliders writes cpParams — a
      // preset apply or a MIDI CC — so the panel can follow. Without it those
      // eight sliders were write-only and the thumbs went stale.
      onParamsChanged:  ()                     => {},
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
    // tweenHold belongs in the same breath as the other two: main.js's frame
    // loop checks all three before calling, and a guard restated in two places
    // is only as good as its weaker copy. A caller that checked autoRot and
    // userInt but forgot the hold would fight a preset's camera tween on every
    // frame of it.
    if (!this.autoRot || this.userInt || this.tweenHold) return;
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
    this._setScriptStatus('clear', '');
    try {
      this.cpFn = new Function('ctx', `const {time,bass,mid,treble,beat,bpm,R,cam,target,state,p,sin,cos,abs,pow,lerp,clamp,orbit}=ctx; ${code}`);
      this.cpActive  = true;
      this.cpSource  = code;   // FIX: set with cpFn, so the two never disagree
      this._cpState  = { velY:0, phase:0 };
      // FIX(#13, r2): fresh script → fresh roll. Armed while auto-rotate is off
      // it gets no runScript() tick, so the old bank angle would hang around.
      this.cpRoll    = 0;
      this._setScriptStatus('ok', '✔ Running', 2000);
    } catch (e) {
      this._setScriptStatus('error', '⚠ Parse: ' + e.message);
      this.cpActive = false;
    }
  }

  /**
   * Write the status line, cancelling any auto-clear still pending.
   *
   * FIX: the 2 s tidy-up armed by "✔ Running" used to outlive whatever came
   * next. A runtime error arrives one frame after the apply and disarms the
   * script; two seconds later the stale timer blanked it, leaving an operator
   * with a camera back on auto-orbit and no explanation anywhere. Pressing
   * APPLY twice inside two seconds wiped a parse error the same way. One
   * writer, and the timer belongs to the message that armed it.
   *
   * @param {string} type          — 'ok' | 'error' | 'clear'
   * @param {string} msg           — text for the badge
   * @param {number} [autoClearMs] — blank the line after this long; 0 = keep
   */
  _setScriptStatus(type, msg, autoClearMs = 0) {
    clearTimeout(this._statusTimer);
    this._statusTimer = null;
    this.cb.onScriptStatus(type, msg);
    if (autoClearMs > 0) {
      this._statusTimer = setTimeout(() => {
        this._statusTimer = null;
        this.cb.onScriptStatus('clear', '');
      }, autoClearMs);
    }
  }

  /**
   * Disarm script mode and return to built-in physics. Also resets FOV
   * and roll because scripts commonly mutate them; without the reset the
   * camera would carry the script's final FOV/roll into physics mode.
   */
  resetScript() {
    this.cpActive = false; this.cpFn = null; this.cpSource = null; this._cpState = {};
    // The eight script knobs go back to factory with the script itself. A
    // fresh object rather than an assign, so a script that added its own keys
    // to p.* does not leave them behind either. The editor's eight sliders read
    // these, so they are told — otherwise this fix would leave the panel
    // showing numbers the camera no longer holds, which is the same class of
    // defect one layer up.
    this.cpParams = { ...CP_DEFAULT_PARAMS };
    this.cb?.onParamsChanged?.();
    this.cb.onSetCode(CP_DEFAULT);
    this._setScriptStatus('clear', '');
    this.camera.fov = 45; this.camera.updateProjectionMatrix();
    // FIX(#13, r2): drop the stored roll alongside the visible one — levelling
    // rotation.z alone would be undone by applyRoll() on the next frame.
    this.cpRoll = 0;
    this.camera.rotation.z = 0;
    this.setCamPhysics('dark_matter');
  }

  /**
   * FIX(#13, r3): the single gate for "the programmer script is what's driving
   * the camera". Its per-frame tick and the roll applied on its behalf must ask
   * the same question — a reader with weaker conditions goes on re-applying the
   * last bank angle after the script stopped, and OrbitControls cannot undo it.
   */
  isScriptDriving() {
    return this.cpActive && this.autoRot && !this.userInt && !this.tweenHold;
  }

  /**
   * Flip the camera to the opposite side of what it is looking at — the W
   * hotkey, "Flip camera 180° around its orbit".
   *
   * A flip is a reflection through the target's vertical axis: distance from
   * the target and height are the operator's, and a turn does not get to
   * change them.
   *
   * FIX: this lived in main.js's keydown switch and built the new position out
   * of rotAngle and the constant CFG.autoRotRadius instead of reading where the
   * camera was. rotAngle only moves inside updatePhysics, which is gated on
   * `autoRot && !userInt`, and auto-rotate ships OFF — so in a default session
   * it is permanently 0 and W flipped nothing: it threw the camera onto a
   * circle of radius 7.2 at azimuth 180°, then back to 0° on the next press,
   * discarding the zoom and the angle each time. The orbit target was ignored
   * as well, so after panning the turn was not even around the subject.
   *
   * rotAngle still advances by π: it is the accumulator the physics loop and
   * the programmer's orbit() helper share, and leaving it behind would have
   * auto-rotate swing the camera back on its next tick.
   */
  flipAzimuth() {
    const t = this.orbit.target;
    const p = this.camera.position;
    this.rotAngle += Math.PI;
    this.camera.position.set(2 * t.x - p.x, p.y, 2 * t.z - p.z);
    // OrbitControls caches the camera's position as a spherical coordinate;
    // update() is what re-derives it, and without it the next drag snaps back.
    this.orbit.update();
  }

  /**
   * Per-frame evaluation of the active script. Builds the ctx bag once,
   * runs the active keyframe (if any) as a pre-script, then the main
   * script. Both can mutate ctx.cam / ctx.target / ctx.fov / ctx.roll /
   * ctx.rotAngle; we copy the final values back onto the three.js camera
   * and orbit controls afterwards.
   *
   * Errors in the MAIN script flip cpActive off — a script that throws
   * every frame would otherwise flood the console and steal frame budget;
   * the failure also surfaces to the status badge so the user sees what
   * broke. Keyframe errors are swallowed and do NOT disarm: the keyframe
   * is usually still being edited, so it costs one caught exception per
   * frame until it compiles or the user moves off it.
   */
  runScript(time, bass, mid, treble, beatInt) {
    if (!this.cpFn || !this.isScriptDriving()) return;

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
      this._setScriptStatus('error', '⚠ ' + e.message);
      this.cpActive = false; return;
    }

    // Commit ctx back to camera / orbit. FOV is clamped because a runaway
    // script writing fov=99999 used to lock the projection matrix into
    // an unrecoverable state; clamp keeps the picture usable while the
    // user fixes the typo.
    //
    // FIX: a clamp is not a guard — Math.max(10, Math.min(160, NaN)) is NaN,
    // and only `roll` below had the finite check its comment claims parity
    // with. NaN here is unrecoverable by fixing the script: every value is
    // seeded back from the camera each tick, and the default template and most
    // gallery presets read it through lerp(), which keeps NaN forever. One
    // frame of `pow(bass - 0.5, 0.5)` was enough to stop the scene drawing
    // until RESET. Keeping the last good value leaves the picture usable,
    // which is exactly what the clamp above is for.
    const keep = (v, prev) => (Number.isFinite(v) ? v : prev);
    if (Number.isFinite(ctx.rotAngle)) this.rotAngle = ctx.rotAngle;
    this.camera.position.set(
      keep(ctx.cam.x, this.camera.position.x),
      keep(ctx.cam.y, this.camera.position.y),
      keep(ctx.cam.z, this.camera.position.z),
    );
    this.orbit.target.set(
      keep(ctx.target.x, this.orbit.target.x),
      keep(ctx.target.y, this.orbit.target.y),
      keep(ctx.target.z, this.orbit.target.z),
    );
    const fov = keep(ctx.fov, this.camera.fov);
    if (fov !== this.camera.fov) { this.camera.fov = clampFov(fov); this.camera.updateProjectionMatrix(); }
    this.orbit.update();
    // FIX(#13, r2): only record the roll — applyRoll() puts it on after main.js's
    // last orbit.update(), which would otherwise wipe a tilt applied here (see
    // there). The non-finite guard mirrors the FOV clamp: rotateZ() on a NaN
    // poisons the quaternion permanently, with no visible way back.
    this.cpRoll = Number.isFinite(ctx.roll) ? ctx.roll : 0;
  }

  /**
   * Apply the roll recorded by the last runScript() tick. main.js is the only
   * caller and must call it after the frame's final orbit.update(), just before
   * the composer pass: that update() ends in a lookAt() which rebuilds the
   * camera quaternion — it wipes a tilt applied any earlier, and by re-levelling
   * every frame it is also why a relative rotateZ() cannot accumulate. rotateZ()
   * turns the camera about its own view axis and leaves position, look direction
   * and camera.up alone, so OrbitControls keeps dragging normally.
   *
   * FIX(#13, r3): gated on isScriptDriving(), not cpActive alone — the tilt must
   * expire with the script that asked for it (mouse grab, auto-rotate off,
   * runtime error, resetScript), or it stays welded on with no way to level it.
   * The truthiness test keeps roll === 0 free of quaternion work.
   */
  applyRoll() {
    if (!this.isScriptDriving() || !this.cpRoll) return;
    this.camera.rotateZ(this.cpRoll);
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

  /**
   * Remove the keyframe at the given index in the sorted display order.
   *
   * FIX: the index really is a display-order one — the list is drawn from a
   * sorted copy and ui/modals.js hands the row number straight back — but this
   * spliced the raw array, which is in insertion order (addKeyframeAtPlayhead
   * only pushes; every reader sorts a copy). The two agree only while
   * keyframes happen to be added in ascending time, so adding one at 80% and
   * then one at 20% made the ✕ on the "20.0%" row delete the 80% keyframe.
   * Dragging a marker past its neighbour reaches the same state, since the
   * drag writes kf.t and leaves the array order alone. No undo, code gone.
   *
   * Resolve through the same sorted copy the renderer uses, then remove by
   * identity. Sorting per call rather than holding a sorted invariant matches
   * _resolveKeyframe above, for the same reason: the array is small and edits
   * come from the editor, not from hot-path code.
   *
   * An index no row can produce is a no-op. That guard is load-bearing for
   * negative values: splice(-1, 1) counts from the end and would quietly eat
   * the last keyframe.
   */
  deleteKeyframe(idx) {
    const target = [...this.cpKeyframes].sort((a,b) => a.t - b.t)[idx];
    if (!target) return;
    this.cpKeyframes.splice(this.cpKeyframes.indexOf(target), 1);
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
